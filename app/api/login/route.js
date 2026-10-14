// パスワードを確かめて、合っていればログインの印（クッキー）を渡す
async function tokenFor(pw) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('trippin-login-v1'));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 総当たりで当てられないよう、間違いが続いたら少し待たせる
const fails = new Map();

export async function POST(req) {
  const pw = process.env.SITE_PASSWORD;
  const form = await req.formData();
  const input = String(form.get('password') || '');
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const f = fails.get(ip) || { n: 0, until: 0 };
  const base = new URL(req.url);

  if (Date.now() < f.until) return Response.redirect(new URL('/login?e=wait', base), 303);
  if (!pw || input !== pw) {
    f.n += 1;
    if (f.n >= 5) { f.until = Date.now() + 5 * 60000; f.n = 0; }
    fails.set(ip, f);
    return Response.redirect(new URL('/login?e=1', base), 303);
  }
  fails.delete(ip);
  const res = new Response(null, { status: 303, headers: { Location: new URL('/', base).toString() } });
  res.headers.append(
    'Set-Cookie',
    `trippin_auth=${await tokenFor(pw)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; HttpOnly; Secure; SameSite=Lax`
  );
  return res;
}
