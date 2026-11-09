// ログインの入口（route.js）の試験。Supabase につながらない状態（テスト用モード）で、Worker の中の数え方を確かめる
// ・偽のヘッダー（x-forwarded-for・x-real-ip）を付けても、同じ人として数える
// ・同時に送っても、パスワードを比べられるのは5回まで
// SQL（login_try）の同時送信は、Supabase に流したあとで窓口が別に確かめる（この試験では動かせない）
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, lockKey } from '../app/lib/loginsafety.mjs';

process.env.TABIBI_MOCK = '1';
process.env.SITE_PASSWORD = 'correct-horse';

const { POST } = await import('../app/api/login/route.js');

let seq = 0;
async function attempt(password, headers = {}) {
  const body = new FormData();
  body.set('password', password);
  const req = new Request('https://tabibi.example/api/login', { method: 'POST', body, headers });
  const res = await POST(req);
  const loc = res.headers.get('location') || '';
  if (res.status === 303 && loc.endsWith('/login?e=wait')) return 'wait';
  if (res.status === 303 && loc.endsWith('/login?e=1')) return 'wrong';
  if (res.status === 303 && new URL(loc).pathname === '/') return 'ok';
  return `other:${res.status}:${loc}`;
}
const freshIp = () => `198.51.100.${(++seq % 250) + 1}`;

test('① clientIp は cf-connecting-ip だけを使う', () => {
  assert.equal(clientIp(new Headers({ 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '2.2.2.2' })), '203.0.113.5');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '2.2.2.2' })), 'unknown');
  assert.equal(clientIp(new Headers()), 'unknown');
});

test('① 偽の x-forwarded-for・x-real-ip を毎回変えても、同じ人として数える（5回で止まる）', async () => {
  const ip = freshIp();
  const results = [];
  for (let i = 0; i < 8; i++) {
    results.push(await attempt('wrong' + i, { 'cf-connecting-ip': ip, 'x-forwarded-for': `10.0.0.${i}, 10.9.9.9`, 'x-real-ip': `10.1.1.${i}` }));
  }
  assert.deepEqual(results, ['wrong', 'wrong', 'wrong', 'wrong', 'wrong', 'wait', 'wait', 'wait']);
});

test('① cf-connecting-ip が違えば別の人として数える', async () => {
  const a = freshIp();
  const b = freshIp();
  for (let i = 0; i < 6; i++) await attempt('x', { 'cf-connecting-ip': a });
  assert.equal(await attempt('x', { 'cf-connecting-ip': a }), 'wait');
  assert.equal(await attempt('x', { 'cf-connecting-ip': b }), 'wrong');
});

test('① 印（lockKey）は、偽のヘッダーでは変わらない', async () => {
  const h1 = new Headers({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '9.9.9.9' });
  const h2 = new Headers({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '8.8.8.8', 'x-real-ip': '7.7.7.7' });
  assert.equal(await lockKey('pw', clientIp(h1)), await lockKey('pw', clientIp(h2)));
});

test('② 同時に20通送っても、パスワードを比べられるのは5回まで（残りは断る）', async () => {
  const ip = freshIp();
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => attempt('wrong' + i, { 'cf-connecting-ip': ip, 'x-forwarded-for': `10.0.1.${i}` })));
  assert.equal(results.filter((r) => r === 'wrong').length, 5);
  assert.equal(results.filter((r) => r === 'wait').length, 15);
});

test('② ロック中は、正しいパスワードでも入れない', async () => {
  const ip = freshIp();
  for (let i = 0; i < 5; i++) await attempt('bad', { 'cf-connecting-ip': ip });
  assert.equal(await attempt('correct-horse', { 'cf-connecting-ip': ip }), 'wait');
});

test('② 正しく入れた人は、数えた分が戻る（何度入っても上限にならない）', async () => {
  const ip = freshIp();
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 3; i++) assert.equal(await attempt('bad', { 'cf-connecting-ip': ip }), 'wrong');
    assert.equal(await attempt('correct-horse', { 'cf-connecting-ip': ip }), 'ok');
  }
});
