export const rpcJson = async () => ({ ok: true, data: true });
export const callUpdate = async () => {};
export const twilioSignatureOk = async () => true;
export const claudeOnce = async () => '{}';

// 偽のAI：電話の仕組み（待ち・聞き取れない声・周りの音・しるし）の試験用に、気の利く人が言いそうな返事を作る。
// 2026-11-22 から本物のAIには決まりで指図せず、聞こえた事実（黙っていた・聞き取れなかった等）だけを渡す。ここではその事実から判断する
const REQ = 'はい、ありがとうございます。本日十一月二十二日、日曜日の十九時に、ふたりでご予約をお願いできますでしょうか。';
const recap = (t) => `はい、ありがとうございます。日本のお客様で、お名前はウエノ様です。本日${t}、ふたりでよろしいでしょうか。[RECAP]`;
const close = (t) => `ありがとうございます。それでは本日${t}、ふたり、ウエノ様でお願いいたします。失礼いたします。[END]`;
const YES = /はい|大丈夫|どうぞ|いいですよ|かしこまり|ええ|OK|もしもし/;

export async function* claudeStream(env, { messages }) {
  const u = messages[messages.length - 1].content;
  const asstAll = messages.filter((m) => m.role === 'assistant').map((m) => m.content);
  const last = asstAll[asstAll.length - 1] || '';
  const isGreetAsk = /お時間よろしい|お電話よろしい/.test(last);
  const isRecap = /ウエノ様です/.test(last) && /よろしいでしょうか/.test(last);
  const isWait = /お待ちしております|お願いします。$/.test(last);
  const recapTime = (() => { const r = [...asstAll].reverse().find((a) => /ウエノ様です/.test(a)) || ''; return /二十時/.test(r) ? '二十時' : /十九時半/.test(r) ? '十九時半' : '十九時'; })();
  const count = (re) => asstAll.filter((a) => re.test(a)).length;
  const onShop = (t) => {
    const tail = t.slice(-24);
    if (/待って|お待ちください/.test(t) && !/満席|空いて/.test(t)) return isGreetAsk ? 'はい、お待ちしております。[WAIT]' : 'はい、お願いします。[WAIT]';
    if (/予約は受け|やってない|休み|定休/.test(t)) return '承知しました。ありがとうございます。失礼いたします。[END]';
    if (isRecap) {
      if (/いえ|違/.test(t) && /半/.test(t)) return close('十九時半');
      if (YES.test(t)) return close(recapTime);
      return '[IGNORE]';
    }
    if (/満席|いっぱい/.test(tail) && !/空いて|なら/.test(tail)) return '承知しました。近い時間で空いている時間はありますでしょうか。';
    if (/二十時/.test(tail)) return recap('二十時');
    if (/半|なら空いて|なら大丈夫/.test(tail)) return recap('十九時半');
    if (/何名|人数/.test(t)) return 'ふたりです。';
    if (/^(画面|テレビ|中国)/.test(t) && !YES.test(tail)) return '[IGNORE]';
    if (isGreetAsk || isWait && !/ご予約/.test(asstAll.join(''))) return YES.test(t) ? REQ : '[IGNORE]';
    if (YES.test(t)) return /ご予約|大丈夫でしょうか/.test(last) || isWait ? recap('十九時') : REQ;
    return '[IGNORE]';
  };
  let out;
  if (/passed after your introduction/.test(u)) out = count(/お電話よろしい/) >= 2 ? 'またおかけ直しいたします。失礼いたします。[END]' : 'もしもし、今お電話よろしいでしょうか。';
  else if (/since they asked you to wait/.test(u)) out = 'もしもし、お待ちしております。';
  else if (/passed after your last line/.test(u)) {
    if (isRecap) out = close(recapTime); // 確認のあとの無言：短い「はい」が聞こえなかったとみる
    else if (/ again/.test(u)) out = recap('十九時'); // 聞き直しても無言：短い「はい」が届いていないとみる
    else out = '恐れ入ります、十九時にふたり、ご予約は大丈夫でしょうか。';
  } else if (/could not be turned into text/.test(u)) {
    if (/one-word/.test(u)) out = isGreetAsk ? REQ : isRecap ? close(recapTime) : recap('十九時');
    else out = count(/もう一度お願い/) >= 2 ? '申し訳ありません、改めてお電話いたします。失礼いたします。[END]' : '申し訳ありません、もう一度お願いできますか。';
  } else {
    const m = u.match(/were actually: "([^"]*)"/);
    out = onShop(m ? m[1] : u.replace(/\n\(.*\)$/s, ''));
  }
  if (globalThis.NO_RECAP_MARK) out = out.replace('[RECAP]', '');
  await new Promise((r) => setTimeout(r, 400)); // AIが考える時間
  yield out;
}
