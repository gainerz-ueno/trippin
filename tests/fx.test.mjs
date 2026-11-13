// 為替の計算の試験（`node --test` で動く）
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickRates, yenPer, toYen, fromYen, rows, parseAmount } from '../app/lib/fx.mjs';

const RATES = { TWD: 0.2, KRW: 10, USD: 0.005 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('1 相場：1円=0.2台湾ドルなら 1台湾ドル=5円', () => {
  near(yenPer(RATES, 'TWD'), 5);
  near(toYen(450, RATES, 'TWD'), 2250);
});
test('2 現金・カードの上乗せは、円で多く払う向き', () => {
  near(yenPer(RATES, 'TWD', 3), 5.15);
  near(toYen(100, RATES, 'KRW', 2), 10.2);
  const r = rows(RATES, 'TWD', 3, 2);
  assert.deepEqual(r.map((x) => x.key), ['market', 'cash', 'card']);
  assert.ok(r[0].yen < r[2].yen && r[2].yen < r[1].yen);
});
test('3 円→現地のお金は、上乗せがあると少なくなる', () => {
  near(fromYen(1000, RATES, 'TWD'), 200);
  assert.ok(fromYen(1000, RATES, 'TWD', 3) < 200);
});
test('4 知らない通貨・空・負の数・数字でないものは null', () => {
  assert.equal(yenPer(RATES, 'XXX'), null);
  assert.equal(toYen('', RATES, 'TWD'), null);
  assert.equal(toYen(-1, RATES, 'TWD'), null);
  assert.equal(toYen('abc', RATES, 'TWD'), null);
  assert.equal(yenPer(null, 'TWD'), null);
});
test('5 取得元の中身：成功なら使う通貨だけ・失敗や壊れた中身は null', () => {
  const ok = pickRates({ result: 'success', time_last_update_utc: 'Fri, 13 Nov 2026 00:02:31 +0000', rates: { TWD: 0.2, ABC: 3, KRW: 0, THB: 'x', USD: 0.006 } });
  assert.deepEqual(ok.rates, { TWD: 0.2, USD: 0.006 });
  assert.equal(ok.updated, 'Fri, 13 Nov 2026 00:02:31 +0000');
  assert.equal(pickRates({ result: 'error' }), null);
  assert.equal(pickRates(null), null);
  assert.equal(pickRates({ result: 'success', rates: { ABC: 1 } }), null);
});
test('6 入力の読み取り：全角・カンマ・空白に対応、おかしいものは空', () => {
  assert.equal(parseAmount('１，２５０'), 1250);
  assert.equal(parseAmount(' 12.5 '), 12.5);
  assert.equal(parseAmount(''), '');
  assert.equal(parseAmount('1e5'), '');
  assert.equal(parseAmount('-3'), '');
  assert.equal(parseAmount('abc'), '');
});
