export const rpcJson = async () => ({ ok: true, data: true });
export const callUpdate = async () => {};
export const twilioSignatureOk = async () => true;
export const claudeOnce = async () => '{}';
// 偽のAI：本物の AI がしそうな返事を、渡された内容から作る
export async function* claudeStream(env, { messages }) {
  const u = messages[messages.length - 1].content;
  const asst = messages.filter(m => m.role === 'assistant').map(m => m.content).join('|');
  let out;
  const f = globalThis.FAKE_LLM;
  if (f) out = f(u, asst, messages);
  if (out === undefined && /They asked you to wait/.test(u)) out = 'はい、お願いします。';
  if (out === undefined) {
    if (/ALREADY asked the recap/.test(u)) out = /半/.test(u.split('\n')[0]) ? '失礼しました、十九時半ですね。ありがとうございます。失礼いたします。[END]' : 'ありがとうございます。失礼いたします。[END]';
    else     if (/満席|いっぱい/.test(u) && !/空いて|なら/.test(u)) out = '承知しました。近い時間で空いている時間はありますでしょうか。';
    else if (/二十時/.test(u)) out = 'はい、ありがとうございます。日本のお客様で、お名前はウエノさんです。本日二十時、ふたりでよろしいでしょうか。[RECAP]';
    else if (/半|なら空いて|なら大丈夫/.test(u)) out = 'はい、ありがとうございます。日本のお客様で、お名前はウエノさんです。本日十九時半、ふたりでよろしいでしょうか。[RECAP]';
    else if (/お名前|名前は/.test(u)) out = 'はい、ウエノです。日本のお客様です。[RECAP]';
    else if (/Do NOT assume yes yet|could not be heard clearly|once more/.test(u)) out = '恐れ入ります、十九時にふたり、ご予約は大丈夫でしょうか。';
    else if (/introduction|go straight to the booking request/.test(u) && !/booking request now/.test(u) && /^(画面|テレビ|中国)/.test(u)) out = '[IGNORE]';
    else if (/introduction|booking request/.test(u)) out = 'はい、ありがとうございます。本日十一月二十二日、日曜日の十九時に、ふたりでご予約をお願いできますでしょうか。';
    else if (/ALREADY asked the recap/.test(u)) out = /半/.test(u) ? '失礼しました、十九時半ですね。ありがとうございます。失礼いたします。[END]' : 'ありがとうございます。失礼いたします。[END]';
    else if (/TV or other/.test(u)) out = /満席/.test(u.slice(-40)) ? '承知しました。近い時間で空いている時間はありますでしょうか。' : 'はい、ありがとうございます。日本のお客様で、お名前はウエノさんです。本日十九時、ふたりでよろしいでしょうか。[RECAP]';
    else if (/Treat it as YES|treat it as YES|Treat this as YES/.test(u)) out = 'はい、ありがとうございます。日本のお客様で、お名前はウエノさんです。本日十九時、ふたりでよろしいでしょうか。[RECAP]';
    else if (/still could not be heard/.test(u)) out = '申し訳ありません、改めてお電話いたします。失礼いたします。[END]';
    else if (/予約は受け|やってない|休み|定休/.test(u)) out = '承知しました。ありがとうございます。失礼いたします。[END]';
    else if (/何名|人数/.test(u)) out = 'ふたりです。';
    
    else if (/大丈夫|はい|どうぞ|いいですよ|かしこまり/.test(u)) out = asst.includes('RECAP_DONE') ? 'ありがとうございます。[END]' : 'はい、ありがとうございます。日本のお客様で、お名前はウエノさんです。本日十九時、ふたりでよろしいでしょうか。[RECAP]';
    else out = '[IGNORE]';
  }
  await new Promise(r => setTimeout(r, 400)); // AIが考える時間
  yield out;
}
