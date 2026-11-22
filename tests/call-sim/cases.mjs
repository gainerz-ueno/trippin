import { run } from './sim.mjs';
const T = (say, o = {}) => ({ say, ...o });
// 店の返事の決め方：AIの言葉（line）を見て返す
const flow = (o) => (line, i) => {
  if (i === 0) return o.greet;
  if (/恐れ入ります|大丈夫でしょうか/.test(line)) return o.reask;
  if (/[?？]|ますでしょうか|でしょうか/.test(line) && /十九時に|十九時、|19時/.test(line) && !/よろしい/.test(line)) return o.request;
  if (/空いている時間|近い時間|ほかに/.test(line)) return o.alt;
  if (/よろしいでしょうか/.test(line)) return o.recap;
  if (/大丈夫でしょうか/.test(line)) return o.reask;
  return [];
};
const cases = [
  ['普通：はい→はい大丈夫→はい', flow({ greet: [T('はい')], request: [T('はい、大丈夫です')], recap: [T('はい')] }), 'booked19'],
  ['あいさつの最中に「もしもし」→言い終わってすぐ「はい」', flow({ greet: [T('もしもし', { during: 500 }), T('はい', { after: 300 })], request: [T('はい、大丈夫です')], recap: [T('はい')] }), 'booked19'],
  ['あいさつ直後に「はい」（言い終わる直前）', flow({ greet: [T('はい', { during: 9000 })], request: [T('大丈夫ですよ')], recap: [T('はい')] }), 'booked19'],
  ['あいさつに「はい」が文字にならない', flow({ greet: [T('はい', { mode: 'untranscribed' })], request: [T('はい、大丈夫です')], recap: [T('はい')] }), 'booked19'],
  ['あいさつのあとテレビが鳴り続ける（今日の社長の電話）', flow({ greet: [T('画面では', { during: 1000, dur: 1300 }), T('はい。画面ではアクセス許可です', { mode: 'stuck', partial: 'はい。画面ではアクセス許可です。今回は初めての人が', partialAt: 12000 })], request: [T('はい、大丈夫です')], recap: [T('はい')] }), 'booked19'],
  ['満席→19時半→はい', flow({ greet: [T('はい')], request: [T('十九時は満席です')], alt: [T('十九時半なら空いてます')], recap: [T('はい')] }), 'booked1930'],
  ['満席が文字にならない（無言）→聞き直し→満席', flow({ greet: [T('はい')], request: [T('', { mode: 'silent' })], reask: [T('十九時は満席です')], alt: [T('十九時半なら空いてます')], recap: [T('はい')] }), 'booked1930'],
  ['満席が長い声で文字にならない→聞き直し→満席', flow({ greet: [T('はい')], request: [T('十九時は満席です', { mode: 'untranscribed', dur: 2000 })], reask: [T('十九時は満席です')], alt: [T('十九時半なら空いてます')], recap: [T('はい')] }), 'booked1930'],
  ['テレビの声＋満席がつながる', flow({ greet: [T('はい')], request: [T('中国の国営メディアは日本のこうした懸念に反論していたのです。十九時は満席です', { dur: 4500 })], alt: [T('十九時半なら空いてます')], recap: [T('はい')] }), 'booked1930'],
  ['用件のあとテレビが鳴り続けて文字が確定しない', flow({ greet: [T('はい')], request: [T('', { mode: 'stuck', partial: 'ニュースです。十九時は満席です', partialAt: 4000 })], alt: [T('十九時半なら空いてます')], recap: [T('はい')] }), 'booked1930'],
  ['「はい」が文字にならない（短いOK）', flow({ greet: [T('はい')], request: [T('OK', { mode: 'untranscribed', dur: 500 })], recap: [T('はい')] }), 'booked19'],
  ['満席を4秒かけてゆっくり言う', flow({ greet: [T('はい')], request: [T('その時間は、ちょっと満席でして', { dur: 4000 })], alt: [T('十九時半なら空いてます')], recap: [T('はい')] }), 'booked1930'],
  ['確認に無言', flow({ greet: [T('はい')], request: [T('はい、大丈夫です')], recap: [T('', { mode: 'silent' })] }), 'booked19'],
  ['確認に「いえ、十九時半です」', flow({ greet: [T('はい')], request: [T('十九時は満席です')], alt: [T('十九時半なら空いてます')], recap: [T('いえ、十九時半です')] }), 'booked1930'],
  ['用件に「何名様ですか？」→ふたり→大丈夫', (line, i) => i === 0 ? [T('はい')] : i === 1 ? [T('何名様ですか？')] : /ふたり/.test(line) && !/よろしい/.test(line) ? [T('はい、大丈夫です')] : /よろしい/.test(line) ? [T('はい')] : [], 'booked19'],
  ['用件に「少々お待ちください」→5秒→大丈夫', (line, i) => i === 0 ? [T('はい')] : i === 1 ? [T('少々お待ちください'), T('お待たせしました、大丈夫です', { after: 6000 })] : /よろしい/.test(line) ? [T('はい')] : [], 'booked19'],
  ['満席→「二十時なら」→はい', flow({ greet: [T('はい')], request: [T('十九時は満席です')], alt: [T('二十時なら空いてます')], recap: [T('はい')] }), 'any'],
  ['予約は受けていない', flow({ greet: [T('はい')], request: [T('うちは予約は受けてないんです')] }), 'declined'],
];
let ok = 0;
for (const [name, shop, want] of cases) {
  const r = await run(name, shop);
  const ai = r.lines.filter(l => l[0] === 'AI').map(l => l[1]);
  const last = ai.join(' ');
  const recapLine = ai.slice(1).find(l => /よろしいでしょうか/.test(l)) || '';
  let pass = r.ended && r.maxGap <= 10;
  if (want === 'booked19') pass &&= /十九時、ふたり/.test(recapLine) && !/半/.test(recapLine);
  if (want === 'booked1930') pass &&= /十九時半/.test(recapLine) && /空いている時間|近い時間/.test(last);
  if (/少々/.test(name)) pass &&= ai.some(l => /^はい、お願いします/.test(l)) && ai.findIndex(l => /^はい、お願いします/.test(l)) < ai.findIndex((l, k) => k > 0 && /よろしいでしょうか/.test(l));
  if (want === 'declined') pass &&= !recapLine;
  if (pass) ok++;
  console.log((pass ? '○' : '×') + ' ' + name + `（${r.secs}秒・いちばん長い間 ${r.maxGap}秒${r.ended ? '' : '・終わらない'}）`);
  if (!pass) for (const l of r.lines) console.log('     ', l[0], l[1]);
}
console.log(`${ok}/${cases.length}`);
process.exit(0);
