// タビビコール：候補5つ・複数テーブルの決まり（app/lib/call.js）の試験
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRequest, callSystemPrompt, summaryPrompt, groupLines, cleanResultGroups } from '../app/lib/call.js';

const base = { name: 'UENO', callback: '+81 90 1234 5678', gender: 'm' };
const boss = {
  ...base,
  candidates: [
    { date: '2026-11-27', time: '18:00' }, { date: '2026-11-27', time: '18:30' },
    { date: '2026-11-27', time: '19:00' }, { date: '2026-11-27', time: '17:30' }, { date: '', time: '' },
  ],
  groups: [{ adults: 4, children: 1, childAges: '小1', near: true }, { adults: 4, children: 0, near: true }],
};

test('社長の例：候補4つ・テーブル2つ・合計9名', () => {
  const r = cleanRequest(boss);
  assert.equal(r.candidates.length, 4);
  assert.deepEqual(r.candidates.map((c) => c.time), ['18:00', '18:30', '19:00', '17:30']);
  assert.equal(r.groups.length, 2);
  assert.equal(r.people, 9);
  assert.equal(r.partial, 'all');
  assert.equal(r.alts.length, 3);
});

test('候補は最大5つ、テーブルは最大4つ、合計30名まで', () => {
  const c = Array.from({ length: 8 }, (_, i) => ({ date: '2026-11-27', time: `1${i}:00` }));
  assert.equal(cleanRequest({ ...base, candidates: c, groups: [{ adults: 2 }] }).candidates.length, 5);
  const g = Array.from({ length: 6 }, () => ({ adults: 2 }));
  assert.equal(cleanRequest({ ...base, candidates: c, groups: g }).groups.length, 4);
  const big = [{ adults: 20 }, { adults: 20 }];
  assert.equal(cleanRequest({ ...base, candidates: c, groups: big }).groups.length, 1);
});

test('古い形（date/time/people/alts）が同じ意味に直る', () => {
  const r = cleanRequest({ ...base, date: '2026-11-27', time: '19:00', timeTo: '20:00', people: 3, alts: [{ date: '2026-11-28', time: '18:00', people: 2 }] });
  assert.equal(r.people, 3);
  assert.equal(r.groups.length, 1);
  assert.equal(r.timeTo, '20:00');
  assert.equal(r.alts[0].people, 2);
  assert.equal(r.candidates.length, 2);
});

test('おかしな値は落とす', () => {
  assert.equal(cleanRequest({ ...base, date: '2026-11-27', time: '19:00', people: 0 }), null);
  assert.equal(cleanRequest({ ...base, date: 'x', time: '19:00', people: 2 }), null);
  const r = cleanRequest({ ...base, candidates: [{ date: '2026-11-27', time: '25x' }, { date: '2026-11-27', time: '19:00' }], groups: [{ adults: -3, children: 'a' }, { adults: 2 }] });
  assert.equal(r.groups.length, 1);
  assert.equal(r.candidates.length, 1);
});

test('指示：2テーブル・小1・近くの席・順番・全部取れる時間だけ', () => {
  const request = cleanRequest(boss);
  const p = callSystemPrompt({ lang: 'ko-KR', placeName: 'オバルタン', request });
  for (const w of ['2 tables', 'Table 1: 5 people', 'Table 2: 4 people', '小1', 'NEAR', 'choice 1', 'choice 4', 'ALL TABLES OR NOTHING', 'SAME name']) {
    assert.ok(p.includes(w) || p.toLowerCase().includes(w.toLowerCase()), w);
  }
  assert.ok(p.indexOf('choice 1') < p.indexOf('choice 2') && p.indexOf('choice 3') < p.indexOf('choice 4'));
  assert.ok(p.includes('18:00') && p.includes('17:30'));
});

test('「片方でもよい」のときは取れたテーブルを予約して次の候補へ', () => {
  const p = callSystemPrompt({ lang: 'ko-KR', placeName: 'x', request: cleanRequest({ ...boss, partial: 'any' }) });
  assert.ok(p.includes('PARTIAL BOOKING IS OK'));
  assert.ok(!p.includes('ALL TABLES OR NOTHING'));
});

test('1テーブルは今までの指示のまま', () => {
  const request = cleanRequest({ ...base, date: '2026-11-27', time: '19:00', people: 2 });
  const p = callSystemPrompt({ lang: 'ko-KR', placeName: 'x', request });
  assert.ok(!p.includes('SEVERAL TABLES'));
  assert.ok(summaryPrompt({ request }).includes('"outcome"'));
  assert.ok(!summaryPrompt({ request }).includes('"groups"'));
});

test('まとめの指示は groups を返させる', () => {
  const s = summaryPrompt({ request: cleanRequest(boss) });
  assert.ok(s.includes('"groups"') && s.includes('"table":2'));
});

test('結果の画面：テーブルごとの行', () => {
  const gs = cleanResultGroups([
    { outcome: 'booked', date: '2026-11-27', time: '18:30', people: 5 },
    { outcome: 'declined', people: 4 },
    { outcome: 'ばぐ', date: 'x' },
  ]);
  const l = groupLines(gs);
  assert.equal(l[0].text, 'テーブル1（5名）：11月27日18:30 予約できました');
  assert.equal(l[1].text, 'テーブル2（4名）：予約できませんでした');
  assert.equal(l[2].text, 'テーブル3：結果がはっきりしません');
  assert.deepEqual(groupLines(undefined), []);
});
