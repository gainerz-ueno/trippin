// パスワードを確かめて、合っていればログインの印（クッキー）を渡す
import { SUPABASE_URL, SUPABASE_KEY } from '../../lib/supabase-public.js';
import { lockKey, lockLeftMs, applyFail, clientIp } from '../../lib/loginsafety.mjs';

async function tokenFor(pw) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('trippin-login-v1'));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sameText(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

// 総当たりで当てられないよう、5回間違えたら30分ロックする（レジレジ kitchen-pos と同じ決まり）
// ・数えるのは Supabase の login_try / login_ok（Worker が入れ替わっても消えない）
// ・Supabase につながらないときだけ、この Worker の中の記録（fails）で数える
const fails = new Map();

// 返すのはロックが残っている秒数。つながらなければ null
async function rpc(fn, key) {
  if (process.env.TABIBI_MOCK === '1') return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    const n = await r.json();
    return typeof n === 'number' ? n : null;
  } catch { return null; }
}

export async function POST(req) {
  const pw = process.env.SITE_PASSWORD;
  const form = await req.formData();
  const input = String(form.get('password') || '').slice(0, 200);
  // 相手の特定は cf-connecting-ip だけ（x-forwarded-for などは相手が偽れるので使わない）
  const key = await lockKey(pw, clientIp(req.headers));
  const base = new URL(req.url);
  const wait = () => Response.redirect(new URL('/login?e=wait', base), 303);

  // パスワードを比べる前に、1回分を数える。上限なら比べずに断る（同時に送られても5回を超えて試せない）
  // ・Supabase：login_try が判定と加算を1つの SQL 関数の中でやる
  // ・つながらないとき：この Worker の中で数える（確かめる→数えるの間に await を挟まない）
  const left = await rpc('login_try', key);
  if (left === null) {
    if (lockLeftMs(fails.get(key)) > 0) return wait();
    fails.set(key, applyFail(fails.get(key)));
    if (fails.size > 5000) fails.clear();
  } else if (left > 0) return wait();
  // 文字を1文字ずつ比べる時間から推測されないよう、同じ時間で比べる
  if (!pw || !(await sameText(input, pw))) {
    return Response.redirect(new URL('/login?e=1', base), 303);
  }
  // 合っていたら、数えた1回分を戻す（正しく入れた人が上限に近づかないように）
  fails.delete(key);
  await rpc('login_ok', key);
  const res = new Response(null, { status: 303, headers: { Location: new URL('/', base).toString() } });
  res.headers.append(
    'Set-Cookie',
    `trippin_auth=${await tokenFor(pw)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; HttpOnly; Secure; SameSite=Lax`
  );
  return res;
}
