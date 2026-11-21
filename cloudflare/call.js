// タビビコール：電話の会話（Twilio ConversationRelay と WebSocket でつなぐ）と、電話の状態の知らせ
// ・/call/ws     … お店が話したこと（文字）が届く → Claude が現地語で返事 → Twilio が読み上げる
// ・/call/status … Twilio から「呼び出し中・出た・切れた・出なかった」が届く
// どちらも、電話を始めたときに作った合言葉（k）が合うときだけ動く。サイトのパスワードはかけない（Twilio が来るため）
import { CALL_BLOCK_SEC, GREETING, GOODBYE, THANKS, callSystemPrompt, summaryPrompt } from '../app/lib/call.js';
import { rpcJson, callUpdate, claudeStream, claudeOnce, twilioSignatureOk } from '../app/lib/call-server.js';

const extend = (p, use) => rpcJson('call_extend', { cid: p.c, secret: p.k, use }).then((r) => r.ok && r.data === true).catch(() => false);

const END = '[END]';
const RECAP = '[RECAP]'; // AIが最後の確認（日時・人数・名前）を言ったしるし
// 電話に出たときの「もしもし」だけの言葉（聞き取りの崩れ「为・位」なども含む）
const HELLO_ONLY = /^(?:[\s,.，。、!！?？~～]*(?:喂+|为|位|餵|唯|威|您好|你好|哈囉|哈啰|hello|hi|여보세요|안녕하세요|もしもし|alo|allo|a lô))+[\s,.，。、!！?？~～]*$/i;
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
    } else if (b.ok && b.data && b.data.status === 'talking') {
      // 会話の仕組みが途中で止まったとき（読み上げ・聞き取りの設定エラー等）、「話しています」のまま残らないようにする
      await new Promise((r) => setTimeout(r, 10000));
      const b2 = await rpcJson('call_brief', { cid: p.c, secret: p.k });
      if (b2.ok && b2.data && b2.data.status === 'talking') {
        await callUpdate(p.c, p.k, { status: 'done', outcome: 'unclear', result: { summary_ja: '会話の途中で電話が切れました（仕組みの不具合の可能性があります）。' } });
      }
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
    // 最初のあいさつは、つながって少し待ってから言う（お店が先に話したら、名乗りを返事の頭に入れる）
    this.history = [];
    this.transcript = [];
    this.greeted = false;
    this.start = Date.now();
    this.busy = null; // 返事を作っている途中（話をさえぎられたら止める）
    this.ending = false;
    this.finished = false;
    // 3分ごとにチケットを1枚使う。区切りの20秒前に「次の1枚が残っているか」を見て、残っていなければ締めくくる
    this.timers = [];
    this.block(1);
  }

  // 調べ用の記録（届いた知らせ・送ったもの・時刻）。結果の debug に残す
  log(dir, o) {
    if ((this.dbg ||= []).length > 300) return;
    const x = { t: Date.now() - this.start, d: dir, ty: o.type };
    for (const k of ['last', 'voicePrompt', 'utteranceUntilInterrupt', 'description', 'name', 'value', 'token', 'interruptible']) if (o[k] !== undefined && o[k] !== '') x[k] = typeof o[k] === 'string' ? o[k].slice(0, 80) : o[k];
    this.dbg.push(x);
  }

  send(o) {
    this.log('out', o);
    try { this.ws.send(JSON.stringify(o)); } catch {}
  }

  onMessage(raw) {
    let m;
    try { m = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
    if (m.type !== 'setup') this.log('in', m); else this.log('in', { type: 'setup' });
    if (m.type === 'setup') {
      this.ctx.waitUntil(callUpdate(this.p.c, this.p.k, { status: 'talking', call_sid: m.callSid }));
      // つながった直後の「ピピッ」と重ならないよう、1.5秒待ってからあいさつ
      this.hello = setTimeout(() => {
        if (this.ending || this.finished || this.greeted) return;
        const g = GREETING[this.brief.lang];
        this.greeted = true;
        this.greetEndsAt = Date.now() + g.length * 220; // あいさつを言い終わるおおよその時刻
        this.send({ type: 'text', token: g, last: true, interruptible: false }); // お店が「喂/您好」と言っても、あいさつは最後まで言う
        this.history.push({ role: 'user', content: '(The call has connected.)' }, { role: 'assistant', content: g });
        this.transcript.push({ who: 'ai', text: g });
        this.armGreetWait();
      }, 1500);
      this.timers.push(this.hello);
    } else if (m.type === 'prompt' && m.last !== false) {
      const said = String(m.voicePrompt || '').trim();
      if (!said || this.ending) return;
      this.heard = true;
      this.recapWaiting = false;
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      this.transcript.push({ who: 'shop', text: said });
      if (this.greeted && this.history.length === 2 && Date.now() < (this.greetEndsAt || 0) + 800 && HELLO_ONLY.test(said)) {
        // あいさつの途中に聞こえた「喂/您好」等（電話に出たときの声）は返事ではない：あいさつの問い（今お時間よろしいですか）への返事を待つ
        // 2026-11-21 社長「お時間いいですかと聞いて、返事していないのに話し続けた」（記録ではお店の声が「为」）
        this.armGreetWait();
        return;
      }
      if (this.greeted && this.history.length === 2) {
        // あいさつの最中・直後にお店が話した：あいさつは言い終えている前提で、その言葉に自然に続ける
        this.reply(`${said}\n(You already finished your introduction. If they only said hello, do not introduce yourself again; go straight to the booking request.)`);
        return;
      }
      if (!this.greeted) {
        // お店が先に話した：決まったあいさつはやめ、返事の頭で名乗る
        clearTimeout(this.hello);
        this.greeted = true;
        this.reply(`${said}\n(The shop answered first. You have not introduced yourself yet. Start your reply with a short version of this introduction: "${GREETING[this.brief.lang]}")`);
        return;
      }
      this.reply(said);
    } else if (m.type === 'interrupt') {
      // お店の人が話し始めたら、言いかけの返事は止める（言えたところまでを記録）
      if (this.busy) this.busy.abort();
      const last = this.history[this.history.length - 1];
      if (last?.role === 'assistant' && m.utteranceUntilInterrupt) last.content = m.utteranceUntilInterrupt;
    } else if (m.type === 'error') {
      console.error('[tabibi] relay error', m.description);
      (this.relayErrors ||= []).push(String(m.description || '').slice(0, 200));
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
    const recap = text.includes(RECAP);
    let spoken = text.replace(END, '').replace(RECAP, '').replace(/\[[^\]]*\]?$/, '').trim();
    // [END] だけで何も言わなかったとき：決まったお礼を言ってから切る（2026-11-21 電話テストで無言のまま切れた）
    if (done && !spoken) spoken = THANKS[this.brief.lang] || THANKS['en-US'];
    if (spoken.length > sent) this.send({ type: 'text', token: spoken.slice(sent), last: true });
    else this.send({ type: 'text', token: '', last: true });
    if (spoken) {
      this.history.push({ role: 'assistant', content: spoken });
      this.transcript.push({ who: 'ai', text: spoken });
    }
    if (done) this.hangUpAfter(spoken);
    else if (spoken && recap) {
      // 最後の確認のあと：お店はもう受けている。短い「OK」等が文字にならないことがあるので、4秒黙っていたら確認が取れたとしてお礼を言って切る（2026-11-21 社長「OKと言っているのに進まなかった」）
      this.recapWaiting = true;
      this.armSilence(Math.min(30000, spoken.length * 250) + 4000);
    } else if (spoken) this.armAfterSpeaking(spoken);
  }

  // AIが言い終わるころから数えて、お店の返事が無いまま12秒たったら話しかけ直す
  armAfterSpeaking(spoken) {
    this.armSilence(Math.min(30000, spoken.length * 250) + 12000);
  }

  // あいさつ（今お時間よろしいですか）のあと：返事が文字にならないことがある（短い「可以」等の聞き取り漏れ。2026-11-21 社長の電話で2回）
  // あいさつを言い終わって3秒たっても何も届かなければ、聞き直さずに予約の用件に進む（「聞こえますか」で止めない）
  armGreetWait() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    const ms = Math.max(0, (this.greetEndsAt || Date.now()) - Date.now()) + 3000;
    this.silenceTimer = setTimeout(() => {
      if (this.ending || this.finished || this.busy || this.history.length !== 2) return;
      this.history.push({ role: 'user', content: '(No answer was heard after your introduction, but they may have said yes quietly. Go straight to the booking request now. Do not ask whether they can hear you and do not introduce yourself again.)' });
      this.reply('');
    }, ms);
    this.timers.push(this.silenceTimer);
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
      else this.sayGoodbye();
    }, wait(end)));
  }

  // 締めくくり（チケットの残りがないとき、3分の区切りの少し手前）：お礼を言って切る
  wrapUp() {
    if (this.ending || this.finished) return;
    this.wrapping = true;
    this.history.push({ role: 'user', content: '(The call is about to reach its time limit. Confirm what was agreed in one short sentence, thank them, say goodbye, and end with [END].)' });
    this.reply('');
  }

  // お店の声が文字にならないまま黙りが続いたら、AIからもう一度話しかける（無言のまま待ち続けないように）
  armSilence(ms) {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      if (this.ending || this.finished || this.busy) return;
      if (this.recapWaiting) {
        this.recapWaiting = false;
        this.history.push({ role: 'user', content: '(The shop did not object to your recap; they probably answered OK quietly. The booking is agreed. Reply only with a short thank-you and goodbye, and end with [END].)' });
        this.reply('');
        return;
      }
      this.silentCount = (this.silentCount || 0) + 1;
      if (this.silentCount >= 3) { this.sayGoodbye(); return; }
      this.history.push({ role: 'user', content: '(No reply was heard for a while. If the booking was already agreed, just thank them, say goodbye and end with [END]. Otherwise briefly check that they can hear you and repeat only your last question, slowly. If you already did this once, say goodbye and end with [END].)' });
      this.reply('');
    }, ms);
    this.timers.push(this.silenceTimer);
  }

  // 時間切れ：AIの返事を止めて、決まったあいさつを言ってから切る（何も言わずに切れないように）
  sayGoodbye() {
    if (this.finished) return;
    if (this.busy) this.busy.abort();
    const bye = GOODBYE[this.brief.lang] || GOODBYE['en-US'];
    this.send({ type: 'text', token: bye, last: true });
    this.transcript.push({ who: 'ai', text: bye });
    this.hangUpAfter(bye);
  }

  // 最後のひとことを読み終わるくらいまで待ってから切る
  hangUpAfter(spoken) {
    this.ending = true;
    const ms = Math.min(25000, 3000 + spoken.length * 220); // 最後のあいさつを言い切ってから切る
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
    const errs = (this.relayErrors || []).length ? `（仕組みのエラー：${this.relayErrors.join(' / ')}）` : '';
    let result = { summary_ja: 'お店の人と話す前に電話が切れました。' + (this.heard ? '' : 'お店の声を聞き取れませんでした。'), notes_ja: errs }, outcome = 'unclear';
    if (talked) {
      const lines = this.transcript.map((t) => `${t.who === 'ai' ? 'AI' : 'SHOP'}: ${t.text}`).join('\n');
      try {
        // まとめは長くなることがあるので余裕を持たせ、読めなければ1回だけやり直す
        let j = null;
        for (let i = 0; i < 2 && !j; i++) {
          const out = await claudeOnce(this.env, { system: summaryPrompt({ request: this.brief.request }), user: lines, maxTokens: 1500 });
          try { j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); } catch { j = null; }
        }
        if (!j) throw new Error('summary json');
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
    if (this.brief.is_test) result.debug = this.dbg || []; // テストの電話だけ：届いた知らせの記録（原因を調べるため）
    await callUpdate(this.p.c, this.p.k, {
      status: 'done', outcome, result,
      transcript: this.transcript.slice(0, 80).map((t) => ({ who: t.who, text: t.text.slice(0, 500) })),
      duration: Math.round((Date.now() - this.start) / 1000),
    });
  }
}

// ---- 電話テスト用「お店役」（運営者のテストだけ） ----
// タビビの050番号にかかってきた電話に、決まった台詞（台湾華語）で出る。タビビコールが自分の番号（TWILIO_FROM）にかけたときだけ答え、ほかは断る。
// 目的：本物の電話回線を通して、お店の短い返事（可以・好・對）が文字になってAIに届くかを、社長の電話を使わずに確かめる
export async function handleShopbot(request, env) {
  const twiml = (body) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { 'content-type': 'text/xml' } });
  if (request.method !== 'POST') return twiml('<Reject/>');
  const form = Object.fromEntries(await request.formData());
  const ok = await twilioSignatureOk(env.TWILIO_AUTH_TOKEN, request.url, form, request.headers.get('x-twilio-signature'));
  if (!ok || form.From !== env.TWILIO_FROM) return twiml('<Reject/>');
  const say = (t) => `<Say language="cmn-TW" voice="Google.cmn-TW-Standard-A">${t}</Say>`;
  const pause = (s) => `<Pause length="${s}"/>`;
  // あいさつ（約9秒）→ 返事 → 用件（約7秒）→ 返事 → 確認（約5秒）→ 返事 → 終わり
  return twiml([pause(1), say('喂，您好'), pause(10), say('可以'), pause(9), say('好'), pause(8), say('對'), pause(6), say('好，再見'), pause(4)].join(''));
}
