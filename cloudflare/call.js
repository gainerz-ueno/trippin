// タビビコール：電話の会話（Twilio ConversationRelay と WebSocket でつなぐ）と、電話の状態の知らせ
// ・/call/ws     … お店が話したこと（文字）が届く → Claude が現地語で返事 → Twilio が読み上げる
// ・/call/status … Twilio から「呼び出し中・出た・切れた・出なかった」が届く
// どちらも、電話を始めたときに作った合言葉（k）が合うときだけ動く。サイトのパスワードはかけない（Twilio が来るため）
import { CALL_BLOCK_SEC, GREETING, callSystemPrompt, summaryPrompt } from '../app/lib/call.js';
import { rpcJson, callUpdate, claudeStream, claudeOnce, twilioSignatureOk } from '../app/lib/call-server.js';

const extend = (p, use) => rpcJson('call_extend', { cid: p.c, secret: p.k, use }).then((r) => r.ok && r.data === true).catch(() => false);

const END = '[END]';
const ID = /^[0-9a-f-]{36}$/;
const KEYRX = /^[0-9a-f]{64}$/;

function params(url) {
  const u = new URL(url);
  const c = u.searchParams.get('c') || '', k = u.searchParams.get('k') || '';
  return ID.test(c) && KEYRX.test(k) ? { c, k } : null;
}

// ---- 電話の状態（Twilio → ここ） ----
const STATUS = { queued: 'calling', initiated: 'calling', ringing: 'ringing', 'in-progress': 'talking', busy: 'busy', 'no-answer': 'no_answer', failed: 'failed', canceled: 'canceled', completed: 'done' };

export async function handleStatus(request, env) {
  const p = params(request.url);
  if (!p || request.method !== 'POST') return new Response('bad', { status: 400 });
  const form = Object.fromEntries(new URLSearchParams(await request.text()));
  const ok = await twilioSignatureOk(env.TWILIO_AUTH_TOKEN, request.url, form, request.headers.get('x-twilio-signature'));
  if (!ok) return new Response('forbidden', { status: 403 });
  const st = STATUS[form.CallStatus];
  if (!st) return new Response('ok');
  const patch = { status: st, call_sid: form.CallSid };
  if (form.CallDuration) patch.duration = Number(form.CallDuration) || 0;
  if (st === 'no_answer') patch.result = { summary_ja: 'お店が電話に出ませんでした。回数は戻してあります。営業時間内に、もう一度試してください。' };
  if (st === 'busy') patch.result = { summary_ja: 'お店の電話が話し中でした。回数は戻してあります。少し時間をおいて、もう一度試してください。' };
  if (st === 'failed' || st === 'canceled') patch.result = { summary_ja: '電話がつながりませんでした。回数は戻してあります。' };
  if (st === 'done') delete patch.status; // 「終わった」は会話のまとめと一緒に書く（まとめが先に終わっていることもある）
  await callUpdate(p.c, p.k, patch);
  // 会話が始まる前に切れた（出たけどすぐ切られた等）ときは、ここで終わりにする（会話があったときは会話のまとめが終わりにする）
  if (st === 'done') {
    const b = await rpcJson('call_brief', { cid: p.c, secret: p.k });
    if (b.ok && b.data && (b.data.status === 'calling' || b.data.status === 'ringing')) {
      await callUpdate(p.c, p.k, { status: 'done', outcome: 'unclear', result: { summary_ja: 'お店とお話しできないまま電話が切れました。' } });
    }
  }
  return new Response('ok');
}

// ---- 電話の会話（Twilio ⇄ ここ ⇄ Claude） ----
export async function handleWs(request, env, ctx) {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
  const p = params(request.url);
  if (!p) return new Response('bad', { status: 400 });
  // Twilio から来たか（署名）。URL は wss:// で署名されている
  const sig = request.headers.get('x-twilio-signature');
  const wss = request.url.replace(/^https:/, 'wss:');
  const signed = (await twilioSignatureOk(env.TWILIO_AUTH_TOKEN, wss, null, sig)) || (await twilioSignatureOk(env.TWILIO_AUTH_TOKEN, request.url, null, sig));
  if (!signed) console.warn('[tabibi] call ws signature mismatch');
  const b = await rpcJson('call_brief', { cid: p.c, secret: p.k });
  if (!b.ok || !b.data) return new Response('forbidden', { status: 403 });
  const brief = b.data;

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  const session = new CallSession(env, ctx, server, p, brief);
  server.addEventListener('message', (ev) => session.onMessage(ev.data));
  server.addEventListener('close', () => session.finish('closed'));
  server.addEventListener('error', () => session.finish('error'));
  return new Response(null, { status: 101, webSocket: client });
}

export class CallSession {
  constructor(env, ctx, ws, p, brief) {
    this.env = env;
    this.ctx = ctx;
    this.ws = ws;
    this.p = p;
    this.brief = brief;
    this.system = callSystemPrompt({ lang: brief.lang, placeName: brief.place_name, request: brief.request });
    // 最初のあいさつは Twilio が読み上げ済み
    this.history = [{ role: 'assistant', content: GREETING[brief.lang] }];
    this.transcript = [{ who: 'ai', text: GREETING[brief.lang] }];
    this.start = Date.now();
    this.busy = null; // 返事を作っている途中（話をさえぎられたら止める）
    this.ending = false;
    this.finished = false;
    // 3分ごとにチケットを1枚使う。区切りの20秒前に「次の1枚が残っているか」を見て、残っていなければ締めくくる
    this.timers = [];
    this.block(1);
  }

  send(o) {
    try { this.ws.send(JSON.stringify(o)); } catch {}
  }

  onMessage(raw) {
    let m;
    try { m = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
    if (m.type === 'setup') {
      this.ctx.waitUntil(callUpdate(this.p.c, this.p.k, { status: 'talking', call_sid: m.callSid }));
    } else if (m.type === 'prompt' && m.last !== false) {
      const said = String(m.voicePrompt || '').trim();
      if (!said || this.ending) return;
      this.transcript.push({ who: 'shop', text: said });
      this.reply(said);
    } else if (m.type === 'interrupt') {
      // お店の人が話し始めたら、言いかけの返事は止める（言えたところまでを記録）
      if (this.busy) this.busy.abort();
      const last = this.history[this.history.length - 1];
      if (last?.role === 'assistant' && m.utteranceUntilInterrupt) last.content = m.utteranceUntilInterrupt;
    } else if (m.type === 'error') {
      console.error('[tabibi] relay error', m.description);
    }
  }

  async reply(said) {
    if (this.busy) this.busy.abort();
    // 同じ人が続けて話したら1つにまとめる（Claude には交互に渡す決まり）
    const last = this.history[this.history.length - 1];
    if (last?.role === 'user') last.content += ' ' + said;
    else this.history.push({ role: 'user', content: said });
    const ac = new AbortController();
    this.busy = ac;
    let text = '', sent = 0;
    try {
      for await (const t of claudeStream(this.env, { system: this.system, messages: this.history, signal: ac.signal })) {
        text += t;
        // [END] の手前までを少しずつ読み上げに回す（[ の途中で止めて、[END] を読み上げないように）
        const cut = text.indexOf('[');
        const safe = cut >= 0 ? cut : text.length;
        if (safe > sent) {
          this.send({ type: 'text', token: text.slice(sent, safe), last: false });
          sent = safe;
        }
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      console.error('[tabibi] claude', String(e?.message || e));
      text = text || '';
    }
    if (this.busy === ac) this.busy = null;
    const done = text.includes(END);
    const spoken = text.replace(END, '').replace(/\[[^\]]*\]?$/, '').trim();
    if (spoken.length > sent) this.send({ type: 'text', token: spoken.slice(sent), last: true });
    else this.send({ type: 'text', token: '', last: true });
    if (spoken) {
      this.history.push({ role: 'assistant', content: spoken });
      this.transcript.push({ who: 'ai', text: spoken });
    }
    if (done) this.hangUpAfter(spoken);
  }

  // n 枚目の3分の区切り
  block(n) {
    const end = n * CALL_BLOCK_SEC * 1000;
    const wait = (ms) => Math.max(0, this.start + ms - Date.now());
    this.timers.push(setTimeout(async () => {
      if (this.ending || this.finished) return;
      if (!(await extend(this.p, false))) this.wrapUp();
    }, wait(end - 20000)));
    this.timers.push(setTimeout(async () => {
      if (this.ending || this.finished) return;
      if (await extend(this.p, true)) this.block(n + 1);
      else this.send({ type: 'end', handoffData: '{"reason":"no_tickets"}' });
    }, wait(end)));
  }

  // 締めくくり（チケットの残りがないとき、3分の区切りの少し手前）：お礼を言って切る
  wrapUp() {
    if (this.ending || this.finished) return;
    this.history.push({ role: 'user', content: '(The call is about to reach its time limit. Confirm what was agreed in one short sentence, thank them, and end with [END].)' });
    this.reply('');
  }

  // 最後のひとことを読み終わるくらいまで待ってから切る
  hangUpAfter(spoken) {
    this.ending = true;
    const ms = Math.min(12000, 1500 + spoken.length * 120);
    this.ctx.waitUntil(new Promise((r) => setTimeout(() => { this.send({ type: 'end', handoffData: '{"reason":"done"}' }); r(); }, ms)));
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.timers.forEach(clearTimeout);
    if (this.busy) this.busy.abort();
    this.ctx.waitUntil(this.summarize());
  }

  async summarize() {
    const talked = this.transcript.some((t) => t.who === 'shop');
    let result = { summary_ja: 'お店の人と話す前に電話が切れました。', notes_ja: '' }, outcome = 'unclear';
    if (talked) {
      const lines = this.transcript.map((t) => `${t.who === 'ai' ? 'AI' : 'SHOP'}: ${t.text}`).join('\n');
      try {
        const out = await claudeOnce(this.env, { system: summaryPrompt({ request: this.brief.request }), user: lines });
        const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
        outcome = ['booked', 'declined', 'alternative', 'unclear'].includes(j.outcome) ? j.outcome : 'unclear';
        result = {
          summary_ja: String(j.summary_ja || '').slice(0, 600),
          notes_ja: String(j.notes_ja || '').slice(0, 600),
          date: /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? j.date : '',
          time: /^\d{2}:\d{2}$/.test(j.time) ? j.time : '',
          people: Number(j.people) > 0 ? Math.round(Number(j.people)) : 0,
        };
      } catch (e) {
        console.error('[tabibi] summary', String(e?.message || e));
        result = { summary_ja: '結果をまとめられませんでした。下の会話の記録を見てください。', notes_ja: '' };
      }
    }
    await callUpdate(this.p.c, this.p.k, {
      status: 'done', outcome, result,
      transcript: this.transcript.slice(0, 80).map((t) => ({ who: t.who, text: t.text.slice(0, 500) })),
      duration: Math.round((Date.now() - this.start) / 1000),
    });
  }
}
