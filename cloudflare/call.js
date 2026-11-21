// タビビコール：電話の会話（Twilio ConversationRelay と WebSocket でつなぐ）と、電話の状態の知らせ
// ・/call/ws     … お店が話したこと（文字）が届く → Claude が現地語で返事 → Twilio が読み上げる
// ・/call/status … Twilio から「呼び出し中・出た・切れた・出なかった」が届く
// どちらも、電話を始めたときに作った合言葉（k）が合うときだけ動く。サイトのパスワードはかけない（Twilio が来るため）
import { CALL_BLOCK_SEC, GREETING, GOODBYE, THANKS, callSystemPrompt, summaryPrompt } from '../app/lib/call.js';
import { rpcJson, callUpdate, claudeStream, claudeOnce, twilioSignatureOk } from '../app/lib/call-server.js';

const extend = (p, use) => rpcJson('call_extend', { cid: p.c, secret: p.k, use }).then((r) => r.ok && r.data === true).catch(() => false);

const END = '[END]';
const RECAP = '[RECAP]';
const UNHEARD = '（短い返事・文字にならず）';
// 短い「はい」（各国語・英語・日本語）
const SHORT_YES = /^[\s,.，。、!！~～]*(好|好的|好啊|可以|對|对|是|是的|嗯|沒問題|没问题|行|ok|okay|okey|yes|yeah|sure|네|예|넵|오케이|はい|ええ|うん|係|得|vâng|dạ|được|ค่ะ|ครับ|ya|oui|sì|sí|ja)([\s,.，。、!！~～]*(好|好的|可以|對|对|ok|okay|네|예|はい))*[\s,.，。、!！?？~～]*$/i; // AIが最後の確認（日時・人数・名前）を言ったしるし
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

  // ---- 会話の順番（ターン）の決まり ----
  // Twilio から届く「AIが話している/やめた（agentSpeaking）」「お店が話している/やめた（clientSpeaking）」の知らせで動く（時間の見込みでは動かない）。
  // ・お店が話し終わったのに文字が届かない（短い「OK」「はい」「好」等の聞き取り漏れ）→「短い返事（たぶんはい）」として話を進める
  // ・AIが言い終わってから、お店が何も話さないまま一定時間 → 段階に合わせて進める（あいさつ後は用件へ、確認後はお礼して切る、ほかは短く聞き直す）
  // 2026-11-21 社長の電話テストで、時間の見込みのずれ・短い返事の聞き取り漏れで何度も止まったため、作り直した
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
        this.stage = 'greeting'; // あいさつ（今お時間よろしいですか）への返事を待つ段階
        this.say(g, { interruptible: false });
        this.history.push({ role: 'user', content: '(The call has connected.)' }, { role: 'assistant', content: g });
        this.transcript.push({ who: 'ai', text: g });
      }, 1500);
      this.timers.push(this.hello);
    } else if (m.type === 'info' && m.name === 'agentSpeaking') {
      this.agentSpeaking = m.value === 'on';
      this.speakEvents = true;
      if (this.agentSpeaking) { this.clearWait(); this.agentOnAt = Date.now(); }
      else { this.agentOffAt = Date.now(); this.armWait(); }
    } else if (m.type === 'info' && m.name === 'clientSpeaking') {
      if (m.value === 'on') {
        this.shopTalking = true;
        this.shopOnAt = Date.now();
        this.turnHandled = false;
        this.partial = '';
        this.clearWait();
        if (this.unheardTimer) clearTimeout(this.unheardTimer);
      } else {
        this.shopTalking = false;
        this.shopOffAt = Date.now();
        // 話し終わったのに文字が届かない：少し待っても届かなければ「聞き取れない短い返事」として進める
        if (!this.turnHandled) {
          if (this.unheardTimer) clearTimeout(this.unheardTimer);
          this.unheardTimer = setTimeout(() => this.onUnheard(), 2000);
          this.timers.push(this.unheardTimer);
        }
      }
    } else if (m.type === 'prompt') {
      const said = String(m.voicePrompt || '').trim();
      if (!said || this.ending) return;
      if (m.last === false) { this.partial = said; return; } // 途中の文字（確定しないまま終わることがある）
      this.onShop(said);
    } else if (m.type === 'error') {
      console.error('[tabibi] relay error', m.description);
      (this.relayErrors ||= []).push(String(m.description || '').slice(0, 200));
    }
  }

  // AIの読み上げを送る（話し始め・話し終わりの知らせが来ない場合の保険として、長さから見込んだ時刻にも待ちを仕掛ける）
  say(text, { interruptible } = {}) {
    const o = { type: 'text', token: text, last: true };
    if (interruptible === false) o.interruptible = false;
    this.send(o);
    this.armBackupWait(text);
  }

  armBackupWait(text) {
    if (this.backupTimer) clearTimeout(this.backupTimer);
    this.backupTimer = setTimeout(() => { if (!this.agentSpeaking && !this.shopTalking) this.armWait(); }, 2500 + text.length * 350);
    this.timers.push(this.backupTimer);
  }

  clearWait() { if (this.waitTimer) { clearTimeout(this.waitTimer); this.waitTimer = null; } }

  // AIが言い終わったあと、お店が黙っているときの待ち
  armWait() {
    this.clearWait();
    if (this.ending || this.finished || this.busy || this.shopTalking) return;
    const ms = this.stage === 'greeting' ? 3000 : this.stage === 'recap' ? 4000 : 7000;
    this.waitTimer = setTimeout(() => {
      this.waitTimer = null;
      if (this.ending || this.finished || this.busy || this.shopTalking || this.agentSpeaking) return;
      if (this.stage === 'greeting') {
        // あいさつのあと黙っている：聞き直さずに用件へ
        this.stage = 'talk';
        this.reply('(No answer was heard after your introduction. Go straight to the booking request now. Do not ask whether they can hear you and do not introduce yourself again.)');
      } else if (this.stage === 'recap') {
        // 最後の確認のあと黙っている：お店はもう受けている。お礼を言って切る
        this.reply('(The shop did not object to your recap. The booking is agreed. Reply only with a short thank-you and goodbye, and end with [END].)');
      } else {
        this.silentCount = (this.silentCount || 0) + 1;
        if (this.silentCount >= 3) { this.sayGoodbye(); return; }
        this.reply('(No reply was heard. If the booking was already agreed, just thank them, say goodbye and end with [END]. Otherwise repeat only your last question in one short phrase. If you already did this twice, say goodbye and end with [END].)');
      }
    }, ms);
    this.timers.push(this.waitTimer);
  }

  // お店が話し終わったのに文字が届かなかった
  onUnheard() {
    this.unheardTimer = null;
    if (this.turnHandled || this.ending || this.finished) return;
    if (this.partial) { this.onShop(this.partial); return; }
    // あいさつの最中に始まって終わった声（電話に出たときの「もしもし」）は返事ではない
    if (this.stage === 'greeting' && this.agentSpeaking) { this.turnHandled = true; return; }
    this.turnHandled = true;
    this.heard = true;
    this.unheardAt = Date.now();
    this.transcript.push({ who: 'shop', text: UNHEARD });
    const wasGreeting = this.stage === 'greeting';
    this.stage = this.stage === 'greeting' ? 'talk' : this.stage;
    this.reply(`(The shop answered with something short that could not be transcribed — almost certainly a short yes such as OK / 好 / 네 / はい. Treat it as YES and move on to the next step${wasGreeting ? ' (the booking request)' : ''}. Do not ask whether they can hear you.)`);
  }

  // お店の言葉（文字）が届いた
  onShop(said) {
    if (this.unheardTimer) { clearTimeout(this.unheardTimer); this.unheardTimer = null; }
    // 「聞き取れない短い返事」として進めた直後に、その文字が遅れて届いた：記録だけ書き換えて、二重に返事しない
    if (this.turnHandled && this.unheardAt && Date.now() - this.unheardAt < 6000) {
      const i = this.transcript.findLastIndex((t) => t.who === 'shop' && t.text === UNHEARD);
      if (i >= 0) this.transcript[i].text = said;
      this.unheardAt = 0;
      // 「はい」だった：そのまま。違うことを言っていた（満席・別の時間など）：言い直して、その言葉に答える
      if (!SHORT_YES.test(said)) { this.stage = 'talk'; this.reply(`(Correction: the shop's last words were actually: "${said}". Answer that, instead of assuming they said yes. Anything you said after assuming yes does not count.)`); }
      return;
    }
    this.turnHandled = true;
    this.heard = true;
    this.clearWait();
    this.transcript.push({ who: 'shop', text: said });
    if (!this.greeted) {
      // お店が先に話した：決まったあいさつはやめ、返事の頭で名乗る
      clearTimeout(this.hello);
      this.greeted = true;
      this.stage = 'talk';
      this.reply(`${said}\n(The shop answered first. You have not introduced yourself yet. Start your reply with a short version of this introduction: "${GREETING[this.brief.lang]}")`);
      return;
    }
    if (this.stage === 'greeting') {
      // あいさつを言っている最中の「喂/您好/もしもし」は、電話に出たときの声：返事ではないので待つ
      if (this.agentSpeaking && HELLO_ONLY.test(said)) return;
      this.stage = 'talk';
      this.reply(`${said}\n(You already finished your introduction. If they only said hello or yes, do not introduce yourself again; go straight to the booking request.)`);
      return;
    }
    this.reply(said);
  }

  async reply(said) {
    if (this.busy) this.busy.abort();
    this.clearWait();
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
    // [END] だけで何も言わなかったとき：決まったお礼を言ってから切る
    if (done && !spoken) spoken = THANKS[this.brief.lang] || THANKS['en-US'];
    this.send({ type: 'text', token: spoken.length > sent ? spoken.slice(sent) : '', last: true });
    if (spoken) {
      this.history.push({ role: 'assistant', content: spoken });
      this.transcript.push({ who: 'ai', text: spoken });
    }
    if (!spoken && !done && !this.emptyRetry) {
      // 何も言わない返事だった：1回だけ言い直させる（黙ったままにしない）
      this.emptyRetry = true;
      this.reply('(You said nothing. Say your next line now, following the steps.)');
      return;
    }
    if (spoken) this.emptyRetry = false;
    if (recap) this.stage = 'recap';
    if (done) { this.hangUpAfter(spoken); return; }
    this.armBackupWait(spoken || ' ');
    if (this.speakEvents && !this.agentSpeaking && spoken) {
      // 話し始めの知らせを待つ（来なければ保険の待ちが動く）
    }
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
