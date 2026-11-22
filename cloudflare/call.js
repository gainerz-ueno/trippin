// タビビコール：電話の会話（Twilio ConversationRelay と WebSocket でつなぐ）と、電話の状態の知らせ
// ・/call/ws     … お店が話したこと（文字）が届く → Claude が現地語で返事 → Twilio が読み上げる
// ・/call/status … Twilio から「呼び出し中・出た・切れた・出なかった」が届く
// どちらも、電話を始めたときに作った合言葉（k）が合うときだけ動く。サイトのパスワードはかけない（Twilio が来るため）
import { CALL_BLOCK_SEC, GREETING, GOODBYE, THANKS, callSystemPrompt, summaryPrompt, romajiToKana } from '../app/lib/call.js';
import { rpcJson, callUpdate, claudeStream, claudeOnce, twilioSignatureOk } from '../app/lib/call-server.js';

const extend = (p, use) => rpcJson('call_extend', { cid: p.c, secret: p.k, use }).then((r) => r.ok && r.data === true).catch(() => false);

const END = '[END]';
const RECAP = '[RECAP]';
const IGNORE = '[IGNORE]'; // AIが「お店の返事ではない（テレビ・周りの声）」と判断したしるし
const UNHEARD = '（短い返事・文字にならず）';
// お店の言葉の見分け（確認のあとに聞き直しを繰り返さないため。2026-11-21 社長の電話：テレビの声が「的人我们就可以…」「啊我」等の文字になり、AIが確認を4回繰り返した）
const NEG = /不接|不收|不開|不开|不提供|沒辦法|没办法|받지 않|예약을 안|予約は受け|受け付けて|休|關門|关门|打烊|候位|排隊|排队|現場|现场|휴무|쉬는|쉽니다|안 받|closed|walk-in|first come|不是|不對|不对|錯|错|改|換|换|不行|不可以|不能|沒有|没有|沒位|没位|客滿|客满|滿了|满了|無法|无法|不好意思|唔得|冇|아니|안 돼|안돼|없어|없습니다|못|만석|いいえ|無理|できません|ありません|満席|いっぱい|\bno\b|\bnot\b|\bfull\b|sorry|can't|cannot|không|ไม่|tidak|\bnon\b|nein|complet|\bpas\b/i;
const ASKING = /[?？]|嗎|吗|什麼|什么|幾|几|哪|誰|谁|電話|电话|號碼|号码|名字|貴姓|贵姓|怎麼|怎么|까|나요|번호|이름|성함|ですか|お名前|電話番号|what|when|which|who|how|phone|number|spell/i;
const TIMEISH = /\d|點|点|時|时|시|분|半|小時|小时|o'clock|pm|am/i;
const HOLD = /少々|お待ち|待って|稍等|等一下|等等|請稍|请稍|잠시|잠깐|기다려|hold on|one moment|just a moment|wait/i; // 「少々お待ちください」：確かめに行っている
const SILENT = '（返事が聞こえず・はいとみなして進めた）';
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
      else {
        this.agentOffAt = Date.now();
        // あいさつを言い終えた：言い終わりの直前（2.5秒以内）に返事があれば、それを返事として進む。なければ返事を待つ
        if (this.stage === 'greeting' && this.greetHeard && Date.now() - this.greetHeard.at < 2500 && !this.shopTalking) {
          const g = this.greetHeard.said; this.greetHeard = null;
          this.stage = 'talk';
          this.reply(`${g}\n(You already finished your introduction. If they only said hello or yes, do not introduce yourself again; go straight to the booking request.)`);
          return;
        }
        this.greetHeard = null;
        this.waitDeadline = Date.now() + (this.holding ? 30000 : this.stage === 'greeting' ? 3500 : 4000);
        this.armWait();
      }
    } else if (m.type === 'info' && m.name === 'clientSpeaking') {
      if (m.value === 'on') {
        this.shopTalking = true;
        this.shopOnAt = Date.now();

        this.turnHandled = false;
        this.partial = '';
        // 待ちは止めない（テレビ等で「話している」が長く続くと、ずっと待ってしまうため。待ちの側で、話し始めて間もない間だけ少し延ばす）
        if (this.unheardTimer) clearTimeout(this.unheardTimer);
      } else {
        this.shopTalking = false;
        this.shopOffAt = Date.now();
        // 話し終わったのに文字が届かない：少し待っても届かなければ「聞き取れない短い返事」として進める
        if (!this.turnHandled) {
          if (this.unheardTimer) clearTimeout(this.unheardTimer);
          this.unheardTimer = setTimeout(() => this.onUnheard(), 3000); // 文字は話し終わりから少し遅れて届く（2秒では早すぎた）
          this.timers.push(this.unheardTimer);
        }
      }
    } else if (m.type === 'prompt') {
      const said = String(m.voicePrompt || '').trim();
      if (!said || this.ending) return;
      if (m.last === false) {
        // 途中の文字（確定しないまま終わることがある。2026-11-21 社長の「OK」がこれだけで終わった）：1.5秒たっても確定しなければ、これを返事として使う
        this.partial = said;
        this.turnHandled = false;
        if (this.unheardTimer) clearTimeout(this.unheardTimer);
        this.unheardTimer = setTimeout(() => this.onUnheard(), 1500);
        this.timers.push(this.unheardTimer);
        return;
      }
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
    this.lastAiAt = Date.now();
    this.armBackupWait(text);
  }

  armBackupWait(text) {
    if (this.backupTimer) clearTimeout(this.backupTimer);
    this.backupTimer = setTimeout(() => { if (!this.agentSpeaking) this.armWait(); }, 2500 + text.length * 350);
    this.timers.push(this.backupTimer);
  }

  clearWait() { if (this.waitTimer) { clearTimeout(this.waitTimer); this.waitTimer = null; } }

  // AIが言い終わったあと、お店が黙っているときの待ち
  armWait() {
    this.clearWait();
    if (this.ending || this.finished || this.busy) return;
    // Twilio の「お店が話している」知らせは、文字になった声にしか来ない（2026-11-21 社長の電話の記録で確認：「OK」は知らせも文字も何も届かなかった）。
    // そのため「黙っている」は「文字にならない短い返事（OK・はい等）をした」かもしれない。止まらないよう、待ちは短く、はい/いいえで答える問いなら「はい」として進める
    // 待ちの期限はAIが言い終わった時から数える。周りの音（テレビ等）で延ばさない（ずっと待ち続けないように）
    if (!this.waitDeadline) this.waitDeadline = Date.now() + (this.holding ? 30000 : this.stage === 'greeting' ? 3000 : 4000);
    const ms = Math.max(300, this.waitDeadline - Date.now());
    this.waitTimer = setTimeout(() => {
      this.waitTimer = null;
      if (this.ending || this.finished || this.busy || this.agentSpeaking) return;
      // お店が話し始めて2.5秒以内なら、言い終わるのを少し待つ（それより長く続く声はテレビ等とみなして待たない）
      // お店がAIの言い終わったあとに話し始めていたら、言い終わるまで待つ（最大12秒）。AIの話にかぶって始まった声（テレビ等）は待たない
      // 2026-11-21 社長の電話：「その日は満席です」を言っている途中で「返事なし」と判断していた（2.5秒で打ち切っていたため）
      // 待つのは話し始めから6秒まで（あいさつのあとは3秒）。テレビが鳴り続けると「話している」が終わらず、文字も確定しないまま止まっていた（2026-11-22 社長の電話：あいさつのあとの「はい」がテレビの声とつながり、12秒以上待って社長が切った）
      const cap = this.stage === 'greeting' ? 3000 : 6000;
      if (this.shopTalking && !this.startedOverAgent() && Date.now() - (this.shopOnAt || 0) < cap) { this.waitDeadline = Date.now() + 500; this.armWait(); return; }
      // 待ちきれなかった：途中の文字があればそれを返事として使う（テレビ混じりなら長い文字の決まりで、最後の答えだけに返事する）
      if (this.shopTalking && this.partial && this.stage !== 'greeting') { const p = this.partial; this.partial = ''; this.turnHandled = true; this.onShop(p); return; }
      // お店が話し終わって、文字を待っている間（文字にならなかった声の判断の前）は、無言とみなさない
      if (this.unheardTimer) { this.waitDeadline = Date.now() + 1000; this.armWait(); return; }
      this.waitDeadline = null;
      this.silentCount = (this.silentCount || 0) + 1;
      if (this.silentCount >= 4) { this.sayGoodbye(); return; }
      this.transcript.push({ who: 'shop', text: SILENT });
      if (this.stage === 'greeting') {
        // あいさつのあと：聞き直さずに用件へ
        this.stage = 'talk';
        this.reply('(No answer was heard after your introduction — they may have said a short yes that could not be heard. Go straight to the booking request now. Do not ask whether they can hear you and do not introduce yourself again.)');
      } else if (this.stage === 'recap') {
        // 最後の確認のあと：はいとみなしてお礼を言って切る
        this.finishThanks();
      } else if (this.silentCount === 1) {
        // 用件・別の時間などを聞いたあとの1回目の無言：「はい」とみなさない。答えが文字にならなかった（満席などの文だった）かもしれないので、短く聞き直す
        // 2026-11-22 社長の電話：「十九時は満席です」が文字にならず、無言として「はい」で進めていた
        this.reply('(Nothing was heard after your last line. Their answer may not have come through (it could have been a NO, a different time, or a question). Do NOT assume yes yet. Ask the same thing again once, in one very short polite sentence (for example: 恐れ入ります、十九時にふたり、ご予約は大丈夫でしょうか。). Never ask whether they can hear you.)');
      } else {
        this.reply('(Nothing was heard again. The shop most likely answered with a short word that the system cannot hear, such as OK / はい. If your last line was a yes/no question (for example asking whether they can take the booking), treat it as YES and go to the next step (give the name and the one recap question). If it was another kind of question, repeat it in one short phrase. Never ask whether they can hear you.)');
      }
    }, ms);
    this.timers.push(this.waitTimer);
  }

  // 今のお店の声は、AIの話と2秒以上重なっていたか（お店はふつうAIが話し終わってから答える。AIの話の上でずっと続いている声はテレビ・周りの声）
  // 言い終わりの直前・直後に少し重なるだけの声は返事として扱う（電話の遅れで少し重なることがあるため）
  startedOverAgent() {
    const on = this.shopOnAt || 0;
    const end = this.shopTalking ? Date.now() : (this.shopOffAt || Date.now());
    const aOn = this.agentOnAt || 0;
    const aOff = this.agentSpeaking ? Date.now() : (this.agentOffAt || 0);
    if (!aOn || aOff < aOn) return false;
    return Math.min(end, aOff) - Math.max(on, aOn) > 2000;
  }

  // お店が話し終わったのに文字が届かなかった
  onUnheard() {
    this.unheardTimer = null;
    if (this.turnHandled || this.ending || this.finished) return;
    if (this.partial) { const p = this.partial; this.partial = ''; this.onShop(p); return; }
    // AIが今の言葉を言い出す前に終わっていた声は、今の問いへの返事ではない（前の問いに二重に答えたことにしない）
    if ((this.shopOffAt || 0) < (this.lastAiAt || 0)) { this.turnHandled = true; return; }
    // あいさつの最中に始まって終わった声（電話に出たときの「もしもし」）は返事ではない
    if (this.stage === 'greeting' && this.agentSpeaking) { this.turnHandled = true; return; }
    this.turnHandled = true;
    this.heard = true;
    // 文字にならなかった声の長さ：短い（1.2秒まで）なら「はい/OK」、長いなら文（「十九時は満席です」等）。
    // 長い声を「はい」とみなすと、満席なのに予約を進めてしまう（2026-11-22 社長の電話）→ 聞き直す（同じ問いに2回まで。それでもだめなら、はっきりしないとして切る）
    const len = (this.shopOffAt || Date.now()) - (this.shopOnAt || Date.now());
    if (this.stage !== 'greeting' && len > 1200) {
      this.unclearAsks = (this.unclearAsks || 0) + 1;
      this.transcript.push({ who: 'shop', text: '（返事が聞き取れず）' });
      if (this.unclearAsks <= 2) {
        this.reply(`(The shop said a full sentence but it could not be heard clearly — it may have been a NO, a different time, or a question. Do NOT assume yes. Politely ask them to say it once more, in one very short sentence (for example: 申し訳ありません、もう一度お願いできますか。).)`);
      } else {
        this.reply(`(The shop's answer still could not be heard. Apologize briefly, say you will call back, and say goodbye with [END]. Do not claim the booking is made.)`);
      }
      return;
    }
    this.unheardAt = Date.now();
    this.transcript.push({ who: 'shop', text: UNHEARD });
    const wasGreeting = this.stage === 'greeting';
    this.stage = this.stage === 'greeting' ? 'talk' : this.stage;
    this.reply(`(The shop answered with something short that could not be transcribed — almost certainly a short yes such as OK / 好 / 네 / はい. Treat it as YES and move on to the next step${wasGreeting ? ' (the booking request)' : ''}. Do not ask whether they can hear you.)`);
  }

  // お店の言葉（文字）が届いた
  onShop(said) {
    this.snapBefore = { stage: this.stage, silent: this.silentCount || 0 }; // 周りの音だったときに戻すため
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
    const meaningful = NEG.test(said) || ASKING.test(said) || TIMEISH.test(said) || HOLD.test(said);
    // AIの話にかぶって始まり、3秒以上続いた声：お店の返事ではなくテレビ・周りの声とみなす（2026-11-21 社長の電話：テレビの「…何にそれを使うんですか」にAIが答えて、社長の返事にかぶった）
    const tail = said.slice(-20); // 長い声の最後にお店の答えがつながっていることがある（2026-11-22 社長の電話：テレビの話の最後に「十九時半は空いてます」）
    if (this.greeted && this.stage !== 'greeting' && this.startedOverAgent() && (this.shopOffAt || Date.now()) - (this.shopOnAt || 0) > 3000 && !NEG.test(said) && !TIMEISH.test(tail) && !ASKING.test(tail) && !/空|あい|大丈夫|いけ|ok|可以|好|되|가능/i.test(tail)) {
      this.transcript.push({ who: 'shop', text: `（周りの音：${said}）` });
      return;
    }
    if (this.greeted && this.stage !== 'greeting' && (this.busy || this.agentSpeaking) && !meaningful) {
      // AIが返事を作っている・話している最中に届いた、意味のはっきりしない言葉：周りの音とみなして記録だけ（話を乱さない）
      this.transcript.push({ who: 'shop', text: `（周りの音：${said}）` });
      return;
    }
    this.heard = true;
    this.silentCount = 0;
    this.unclearAsks = 0;
    if (!HOLD.test(said)) this.holding = false;
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
      // あいさつ（今お時間よろしいですか）を言っている最中の声は、言葉に関係なく返事として扱わない：あいさつを言い終えてから返事を待つ
      // 2026-11-21 社長の電話：あいさつの途中の「こんにちは」を返事とみなし、あいさつの直後に間を空けずに用件を話し始めていた
      // （言い終わりの直前に重なった返事は、言い終えた時に使う）
      if (this.agentSpeaking || this.busy) { this.greetHeard = { said, at: Date.now() }; return; }
      this.stage = 'talk';
      this.reply(`${said}\n(You already finished your introduction. If they only said hello or yes, do not introduce yourself again; go straight to the booking request.)`);
      return;
    }
    if (this.stage === 'recap') {
      // 確認はもう言った：はっきり「違う/できない」か質問でなければ、確認が取れたとしてお礼を言って切る（AIに聞き直させない）
      // 時間・数の入った返事（「いえ、十九時半です」等）は訂正かもしれないので、AIに渡して確かめさせる（2026-11-22 の通し試験で見つけた）
      if (!NEG.test(said) && !ASKING.test(said) && !TIMEISH.test(said) && !/いえ|違|ちが|じゃなく|ではなく/.test(said)) { this.finishThanks(); return; }
      this.reply(`${said}\n(You have ALREADY asked the recap. Do not repeat the recap or ask again. If this is the shop clearly saying something is wrong, fix only that in one short phrase, then end the call the same way (thank them, state the corrected booking once, goodbye, [END]). If it is a question, answer it in one short sentence. Then end the call: thank them, state the agreed booking once as the final arrangement (for Japanese: 「それでは本日十九時半、ふたり、ウエノ様でお願いいたします。失礼いたします。」 with the agreed time) and add [END]. If it does not make sense as the shop's answer, reply only [IGNORE].)`);
      return;
    }
    if (HOLD.test(said) && !NEG.test(said) && !TIMEISH.test(said)) {
      // 「少々お待ちください」：はいと答えて、戻ってくるまで（最大30秒）黙って待つ。「はい」として先へ進めない（2026-11-22 通し試験で見つけた）
      this.holding = true;
      this.reply(`${said}\n(They asked you to wait. Reply only with a very short "OK, I'll wait" in the local language (for Japanese: はい、お願いします。). Then wait silently. Do not repeat your request and do not move to the next step.)`);
      return;
    }
    if (this.askedOnce && !NEG.test(said) && !ASKING.test(said) && !TIMEISH.test(said) && said.replace(/[\s,.，。、!！?？~～]/g, '').length <= 12) {
      // 用件を聞いたあとの、はっきりしない短い言葉：「はい」として名前と確認へ進む（同じ質問を繰り返さない）
      this.reply(`${said}\n(Treat this as YES to your request. Go straight to step 2: say the guest is Japanese, give the name once, and ask the one short recap question with [RECAP]. Do not repeat your request.)`);
      return;
    }
    if (said.replace(/[\s,.，。、!！?？~～-]/g, '').length > 25) {
      // 長い文字：テレビ・周りの声とお店の返事が1つにつながって届いた（2026-11-22 社長の電話：テレビの話の最後に「十九時は満席です」がつながり、AIが聞き直していた）
      this.reply(`${said}\n(This transcript is long because TV or other people's voices got mixed in with the staff's words. Ignore everything that is not about this booking. Find the staff's actual answer (usually at the end — for example fully booked, a different time, yes or no) and respond to that answer only. Do not ask them to repeat if a clear answer is in it.)`);
      return;
    }
    this.reply(said);
  }

  // 確認が取れた：決まったお礼を言って切る（AIに作らせない）
  finishThanks() {
    if (this.busy) this.busy.abort();
    // 締めのあいさつ：決まったお礼だけだと素っ気なく、すぐ切っていた（2026-11-22 社長「最後の終わり方がちょっと」）。
    // 決まった予約の内容（時間・人数）を1回だけ言ってお礼し、[END] で切る。AIが変なことを言っても、この返事のあとは必ず切る
    if (!this.closing) {
      this.closing = true;
      this.reply('(The booking is agreed. Say a warm, natural closing in ONE or TWO short sentences: thank them, state the agreed booking once (date word, time, number of people, name) as the final arrangement — not as a question — and say goodbye politely. For Japanese, exactly this shape: 「ありがとうございます。それでは本日二十時、ふたり、ウエノ様でお願いいたします。失礼いたします。」 End with [END]. Do not ask anything.)');
      return;
    }
    const t = THANKS[this.brief.lang] || THANKS['en-US'];
    this.send({ type: 'text', token: t, last: true });
    this.history.push({ role: 'assistant', content: t });
    this.transcript.push({ who: 'ai', text: t });
    this.hangUpAfter(t);
  }

  async reply(said) {
    if (this.busy) this.busy.abort();
    this.clearWait();
    // 周りの音と判断されたら元に戻せるよう、今の会話の形を控えておく
    const snapLen = this.history.length, snapLast = this.history[snapLen - 1] && { ...this.history[snapLen - 1] }, snapStage = this.stage, snapSilent = this.silentCount;
    // 同じ人が続けて話したら1つにまとめる（Claude には交互に渡す決まり）
    const last = this.history[this.history.length - 1];
    if (last?.role === 'user') last.content += ' ' + said;
    else this.history.push({ role: 'user', content: said });
    const ac = new AbortController();
    this.busy = ac;
    let text = '', sent = 0;
    try {
      for await (const t of claudeStream(this.env, { system: this.system, messages: this.history, maxTokens: 400, signal: ac.signal })) {
        if (ac.signal.aborted) return; // 新しい返事に切り替わった：古い返事は読み上げない（2つ続けて話さないように）
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
    if (ac.signal.aborted) return;
    if (this.busy === ac) this.busy = null;
    if (text.includes(IGNORE) && !text.replace(IGNORE, '').replace(/\[[^\]]*\]/g, '').trim()) {
      // お店の返事ではなかった（テレビ・周りの声）：何も言わず、会話を元に戻して、返事を待ち続ける
      this.history.length = snapLen;
      if (snapLast) this.history[snapLen - 1] = snapLast;
      this.stage = this.snapBefore ? this.snapBefore.stage : snapStage;
      this.silentCount = this.snapBefore ? this.snapBefore.silent : snapSilent;
      this.snapBefore = null;
      const i = this.transcript.findLastIndex((t) => t.who === 'shop');
      if (i >= 0 && !this.transcript[i].text.startsWith('（周りの音')) this.transcript[i].text = `（周りの音：${this.transcript[i].text}）`;
      this.send({ type: 'text', token: '', last: true });
      this.armWait();
      return;
    }
    const done = text.includes(END) || (this.closing && !!text.replace(IGNORE, '').trim()); // 締めのあいさつのあとは必ず切る
    // 最後の確認のしるし：[RECAP] を付け忘れても、名前を言って問いで終わっていれば確認とみなす（2026-11-22 電話テスト：付け忘れて、お店の「はい、大丈夫です」のあとに確認をもう一度言っていた）
    const nm = String(this.brief.request?.name || '');
    const saysName = nm && (text.toLowerCase().includes(nm.toLowerCase()) || text.includes(romajiToKana(nm)));
    const recap = text.includes(RECAP) || (this.stage === 'talk' && saysName && /[?？]|でしょうか|ですか|嗎|吗|對嗎|对吗|까요|니까|죠|correct|right/.test(text.slice(-30)));
    let spoken = text.replace(END, '').replace(RECAP, '').replace(IGNORE, '').replace(/\[[^\]]*\]?$/, '').trim();
    // [END] だけで何も言わなかったとき：決まったお礼を言ってから切る
    if (done && !spoken) spoken = THANKS[this.brief.lang] || THANKS['en-US'];
    this.send({ type: 'text', token: spoken.length > sent ? spoken.slice(sent) : '', last: true });
    if (spoken) this.lastAiAt = Date.now();
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
    if (spoken) { this.emptyRetry = false; this.waitDeadline = null; }
    this.snapBefore = null;
    if (recap) this.stage = 'recap';
    else if (this.stage === 'talk' && spoken) this.askedOnce = true; // 用件を聞いた（このあとの短い言葉は「はい」として扱う）
    if (!done && snapStage === 'recap' && spoken) {
      // 確認のあとにAIがまた話した（確認のやり直しを含む）：2回目は認めず締める（確認の繰り返しで終わらなくなるのを防ぐ。2026-11-22 通し試験で見つけた）
      this.afterRecapTalks = (this.afterRecapTalks || 0) + 1;
      if (this.afterRecapTalks >= 2) { this.finishThanks(); return; }
    }
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
  // 2026-11-22：日本語・社長の電話の再現（あいさつの最中に「もしもし」→言い終わり直後に「はい」→少々お待ちください→テレビの声＋満席→十九時半→はい）
  const ja = (t) => `<Say language="ja-JP" voice="Google.ja-JP-Standard-A">${t}</Say>`;
  return twiml([pause(2), ja('もしもし'), pause(11), ja('はい'), pause(9), ja('少々お待ちください'), pause(5),
    ja('お待たせしました。中国の国営メディアは、日本のこうした懸念に反論していたのです。十九時は満席です。'), pause(6),
    ja('十九時半なら空いてます。'), pause(13), ja('はい、大丈夫です。'), pause(6)].join(''));
}
