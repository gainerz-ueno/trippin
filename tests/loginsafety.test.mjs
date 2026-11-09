// ログイン対策の試験（Node 標準の node:test。`npm test` で動く。動かすのは仕組みの側）
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFail, lockLeftMs, lockKey, deviceLabel, buildMail, isKind, MAX_FAILS, LOCK_MS, KINDS } from '../app/lib/loginsafety.mjs';

const T0 = Date.UTC(2026, 10, 9, 0, 0, 0);

test('② 4回の失敗ではロックしない', () => {
  let s = null;
  for (let i = 0; i < MAX_FAILS - 1; i++) s = applyFail(s, T0 + i * 1000);
  assert.equal(s.n, 4);
  assert.equal(lockLeftMs(s, T0 + 5000), 0);
});

test('② 5回目の失敗で30分ロックする', () => {
  let s = null;
  for (let i = 0; i < MAX_FAILS; i++) s = applyFail(s, T0 + i * 1000);
  const at = T0 + 4000;
  assert.equal(lockLeftMs(s, at), LOCK_MS);
  assert.equal(lockLeftMs(s, at + 29 * 60000), LOCK_MS - 29 * 60000);
});

test('② 30分たつとロックが外れる', () => {
  let s = null;
  for (let i = 0; i < MAX_FAILS; i++) s = applyFail(s, T0);
  assert.equal(lockLeftMs(s, T0 + LOCK_MS), 0);
  assert.equal(lockLeftMs(s, T0 + LOCK_MS + 1), 0);
});

test('② ロック中の失敗はロックを延ばさない', () => {
  let s = null;
  for (let i = 0; i < MAX_FAILS; i++) s = applyFail(s, T0);
  const again = applyFail(s, T0 + 60000);
  assert.equal(again.until, s.until);
});

test('② ロックが外れたあと、また5回失敗すれば再びロックする', () => {
  let s = null;
  for (let i = 0; i < MAX_FAILS; i++) s = applyFail(s, T0);
  const later = T0 + LOCK_MS + 1000;
  for (let i = 0; i < MAX_FAILS; i++) s = applyFail(s, later + i);
  assert.ok(lockLeftMs(s, later + 10) > 0);
});

test('② 最後の失敗から30分あくと数え直す', () => {
  let s = applyFail(null, T0);
  s = applyFail(s, T0 + 1000);
  s = applyFail(s, T0 + LOCK_MS + 5000);
  assert.equal(s.n, 1);
});

test('② ロックの印は同じ入力なら同じ・IPやパスワードが違えば別・IPをそのまま含まない', async () => {
  const a = await lockKey('pw', '203.0.113.5');
  assert.equal(a, await lockKey('pw', '203.0.113.5'));
  assert.notEqual(a, await lockKey('pw', '203.0.113.6'));
  assert.notEqual(a, await lockKey('other', '203.0.113.5'));
  assert.ok(!a.includes('203'));
  assert.match(a, /^[0-9a-f]{40}$/);
});

test('③ 通知の種類は決まった4つだけ', () => {
  assert.deepEqual(Object.keys(KINDS).sort(), ['guide_publish', 'login', 'share_create', 'share_delete']);
  assert.equal(isKind('login'), true);
  assert.equal(isKind('constructor'), false);
  assert.equal(isKind('__proto__'), false);
  assert.equal(isKind(''), false);
});

test('③ 端末の説明', () => {
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'iPhone / iPad・Safari');
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'), 'Windows・Edge');
  assert.equal(deviceLabel(''), '不明な端末・不明なブラウザ');
});

test('③ メール本文：日時（日本時間）・端末・種類が入り、鍵やメールアドレスは入らない', () => {
  const m = buildMail('login', { at: Date.UTC(2026, 10, 9, 0, 30), device: 'Windows・Chrome' });
  assert.equal(m.subject, 'Tabibi にログインしました');
  assert.ok(m.text.includes('2026/11/09 09:30（日本時間）'));
  assert.ok(m.text.includes('Windows・Chrome'));
  assert.ok(m.text.includes('心当たりがないとき'));
  assert.ok(!/@|re_[A-Za-z0-9]/.test(m.text.replace('info@conextor.jp', '')));
});

test('③ メール本文：端末名に入った記号は HTML として動かない', () => {
  const m = buildMail('share_create', { device: '<script>alert(1)</script>' });
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.html.includes('&lt;script&gt;'));
});

test('③ 知らない種類は本文を作らない', () => {
  assert.equal(buildMail('nope'), null);
});

test('料金・金額の言葉をメールに入れない', () => {
  for (const k of Object.keys(KINDS)) {
    const m = buildMail(k, { device: 'x' });
    assert.ok(!/円|¥|料金|プラン|月額/.test(m.text), k);
  }
});
