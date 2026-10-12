// お店の写真（APIキーを隠したまま写真のURLへ転送する）
export async function GET(req) {
  const name = new URL(req.url).searchParams.get('name') || '';
  if (!/^places\/[^/]+\/photos\/[^/]+$/.test(name)) {
    return new Response('bad request', { status: 400 });
  }
  const url = `https://places.googleapis.com/v1/${name}/media?maxWidthPx=480&skipHttpRedirect=true&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || !data.photoUri) return new Response('not found', { status: 404 });
  return Response.redirect(data.photoUri, 302);
}
