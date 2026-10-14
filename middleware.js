import { NextResponse } from 'next/server';

// サイト全体にパスワードをかける（Vercel の環境変数 SITE_PASSWORD）
// ・正しいパスワードを入れたら、そのスマホに1年間ログインの印（クッキー）を残す
// ・検索やAIの仕組み（/api）もログインしていないと使えない＝他人に勝手に使われない
const COOKIE = 'trippin_auth';

async function tokenFor(pw) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('trippin-login-v1'));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 同じ人が短時間に検索・AIを使いすぎないようにする（1分に30回まで）
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 30;
}
const LIMITED = ['/api/search', '/api/recommend', '/api/screenshot', '/api/details'];

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  if (pathname === '/login' || pathname === '/api/login') return NextResponse.next();

  const pw = process.env.SITE_PASSWORD;
  if (!pw) {
    return new NextResponse('パスワードがまだ設定されていません（Vercel の SITE_PASSWORD）', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const ok = req.cookies.get(COOKIE)?.value === (await tokenFor(pw));
  if (!ok) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'ログインしてください' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', req.url));
  }

  if (LIMITED.some((p) => pathname.startsWith(p))) {
    const ip = req.ip || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (tooMany(ip)) return NextResponse.json({ error: '短い時間に使いすぎです。1分ほど待ってからもう一度試してください' }, { status: 429 });
  }
  return NextResponse.next();
}

export const config = {
  // ロゴ・アイコン・シェア用画像はログインなしで見せる（LINEやSNSでリンクを送ったときに画像を出すため）
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|logo-tagline.png|og.png|icon-512.png|icon-192.png|icon-maskable-512.png|favicon-32.png|apple-icon.png|manifest.webmanifest).*)'],
};
