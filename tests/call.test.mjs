// タビビコール：予約の中身の整え方（cleanRequest）・AIへの指示・結果の画面用の行
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRequest, callSystemPrompt, summaryPrompt, cleanResultGroups, groupLines } from '../app/lib/call.js';

const base = { name: 'UENO', callback: '+81 90 1234 5678', gender: 'm' };
const boss = {
  ...base,
  candidates: [
    { date: '2026-11-27', time: '18:00', timeTo: '' },
    { date: '2026-11-27', time: '18:30', timeTo: '' },
    { date: '2026-11-27', time: '19:00', timeTo: '' },
    { date: '2026-11-27', time: '17:30', timeTo: '' },
    { date: '', time: '', timeTo: '' },
  ],
  groups: [
    { adults: 4, children: 1, childAges: '小1', near: true },
    { adults: 4, children: 0, near: true },
  ],
  partial: 'all',
};

test('社長の例：候補4つ・テーブル2つ（合計9名）', () => {
  const r = cleanRequest(boss);
  assert.equal(r.candidates.length, 4);
  assert.deepEqual(r.candidates.map((c) => c.time), ['18:00', '18:30', '19:00', '17:30']);
  assert.equal(r.groups.length, 2);
  assert.equal(r.people, 9);
  assert.equal(r.groups[0].childAges, '小1');
  assert.equal(r.partial, 'all');
  assert.equal(r.alts.length, 3); // 古い形の見方でも第2候補以降が入る
  assert.equal(r.time, '18:00');
});

test('候補は5つまで・テーブルは4つまで・合計30名まで', () => {
  const cands = Array.from({ length: 8 }, (_, i) => ({ date: '2026-11-27', time: `1${i}:00` }));
  const r = cleanRequest({ ...base, candidates: cands, groups: Array.from({ length: 6 }, () => ({ adults: 2 })) });
  assert.equal(r.candidates.length, 5);
  assert.equal(r.groups.length, 4);
  const big = cleanRequest({ ...base, candidates: cands, groups: [{ adults: 20 }, { adults: 8 }, { adults: 5 }] });
  assert.equal(big.people, 28); // 3つ目を足すと30を超えるので落とす
  assert.equal(big.groups.length, 2);
});

test('おかしな値は落とす', () => {
  const r = cleanRequest({ ...base, candidates: [{ date: 'x', time: '19:00' }, { date: '2026-11-27', time: '25' }, { date: '2026-11-27', time: '19:00', timeTo: '18:00' }], groups: [{ adults: -3 }, { adults: 'あ', children: 0 }, { adults: 2, children: 1, childAges: '<b>小1</b>' }], partial: 'zzz' });
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].timeTo, ''); // 終わりが始まりより前なら空
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].childAges.includes('<'), false);
  assert.equal(r.partial, 'all');
  assert.equal(cleanRequest({ ...base, candidates: [], groups: [{ adults: 2 }] }), null);
  assert.equal(cleanRequest({ ...base, candidates: [{ date: '2026-11-27', time: '19:00' }], groups: [{ adults: 0, children: 0 }] }), null);
});

test('古い形（date/time/people/alts）も同じ意味に直る', () => {
  const r = cleanRequest({ ...base, date: '2026-11-27', time: '19:00', timeTo: '20:00', people: 3, alts: [{ date: '2026-11-28', time: '18:00', people: 4 }, { date: '2026-11-27', time: '19:00', timeTo: '20:00', people: 3 }, { date: '2026-11-29', time: '12:00' }, { date: '2026-11-30', time: '12:00' }] });
  assert.equal(r.people, 3);
  assert.deepEqual(r.groups, [{ adults: 3, children: 0, childAges: '', near: true }]);
  assert.equal(r.timeTo, '20:00');
  assert.equal(r.alts.length, 3); // 同じ候補は落とす
  assert.equal(r.alts[0].people, 4); // 古い形は候補ごとの人数も残す
  assert.equal(r.alts[1].people, 3);
  assert.equal(cleanRequest({ ...base, time: '19:00', people: 2 }), null); // 日にち無し
});

test('1テーブルのAIへの指示は今までと同じ形（複数テーブルの文は入らない）', () => {
  const r = cleanRequest({ ...base, date: '2026-11-27', time: '19:00', people: 2 });
  const p = callSystemPrompt({ lang: 'ko-KR', placeName: 'テスト', request: r });
  assert.match(p, /The reservation the traveler wants \(choice 1\)/);
  assert.doesNotMatch(p, /SEVERAL TABLES/);
  assert.match(summaryPrompt({ request: r }), /"summary_ja"/);
  assert.doesNotMatch(summaryPrompt({ request: r }), /"groups"/);
});

test('複数テーブルのAIへの指示：人数・小1・近くの席・候補の順番・全テーブルが取れる時間だけ', () => {
  const r = cleanRequest(boss);
  const p = callSystemPrompt({ lang: 'ko-KR', placeName: 'オバルタン忠武路店', request: r });
  assert.match(p, /SEVERAL TABLES/);
  assert.match(p, /Table 1: 5 people/);
  assert.match(p, /Table 2: 4 people/);
  assert.match(p, /4 adults and 1 child/);
  assert.match(p, /"小1"/);
  assert.match(p, /NEAR/);
  assert.match(p, /ALL TABLES OR NOTHING/);
  assert.match(p, /do NOT book anything/);
  const i = ['18:00 exactly', '18:30 exactly', '19:00 exactly', '17:30 exactly'].map((t) => p.indexOf(t));
  assert.ok(i.every((x) => x > 0) && [...i].sort((a, b) => a - b).join() === i.join(), '候補が第1〜第4の順に並ぶ');
  assert.match(p, /choice 2: the same day as choice 1/);
  assert.doesNotMatch(p, /choice 5/);
  assert.match(p, /What you receive during the call/); // 共通の決まり（聞き取り・マーカー）が残る
  // 片方でもよい
  const any = callSystemPrompt({ lang: 'ko-KR', placeName: 'x', request: cleanRequest({ ...boss, partial: 'any' }) });
  assert.match(any, /PARTIAL BOOKING IS OK/);
  assert.doesNotMatch(any, /ALL TABLES OR NOTHING/);
  // 離れてもよい
  const apart = callSystemPrompt({ lang: 'ko-KR', placeName: 'x', request: cleanRequest({ ...boss, groups: [{ adults: 4, children: 1, near: false }, { adults: 4 }] }) });
  assert.match(apart, /may be apart/);
});

test('複数テーブルの結果のまとめ指示は groups を返させる', () => {
  const p = summaryPrompt({ request: cleanRequest(boss) });
  assert.match(p, /"groups":\[\{"table":1/);
  assert.match(p, /"table":2/);
});

test('結果の整理と画面の行', () => {
  const gs = cleanResultGroups([{ table: 9, outcome: 'booked', date: '2026-11-27', time: '18:30', people: 5 }, { outcome: 'declined', date: '2026-11-27', time: '18:30', people: 4 }, { outcome: 'ばつ', people: 'x' }]);
  assert.equal(gs[0].table, 1);
  assert.equal(gs[1].date, ''); // 予約できていないテーブルに日時は付けない
  assert.equal(gs[2].outcome, 'unclear');
  const lines = groupLines(gs).map((x) => x.text);
  assert.equal(lines[0], 'テーブル1（5名）：11月27日18:30 予約できました');
  assert.equal(lines[1], 'テーブル2（4名）：予約できませんでした');
  assert.deepEqual(groupLines(undefined), []); // groups が無い今までの記録
});
