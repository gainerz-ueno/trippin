// お店の写真（APIキーを隠したまま写真のURLへ転送する）
import { KEY } from '../../lib/places';
import { gfetch } from '../../lib/gfetch';

export async function GET(req) {
  const name = new URL(req.url).searchParams.get('name') || '';
  if (name.length > 1000 || !/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(name)) {
    return new Response('bad request', { status: 400 });
  }
  if (!KEY()) return new Response('not configured', { status: 500 });
  try {
    const url = `https://places.googleapis.com/v1/${name}/media?maxWidthPx=480&skipHttpRedirect=true&key=${KEY()}`;
    const res = await gfetch(url, {}, 8000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.photoUri) return new Response('not found', { status: 404 });
    // 同じ写真を何度もGoogleに取りに行かないよう、ブラウザと Cloudflare（cloudflare/worker.js）に1日覚えさせる
    return new Response(null, {
      status: 302,
      headers: { Location: data.photoUri, 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
    });
  } catch {
    return new Response('timeout', { status: 504 });
  }
}
