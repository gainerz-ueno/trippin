// 期限切れになった写真の名前を取り直す
// 取るのは photos だけ（Google の料金表で無料の区分「Place Details Essentials (IDs Only)」）
export async function GET(req) {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (id.length > 300 || !/^[A-Za-z0-9_-]+$/.test(id)) return Response.json({ error: 'bad request' }, { status: 400 });
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${id}`, {
      headers: { 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY, 'X-Goog-FieldMask': 'photos' },
      cache: 'no-store',
    });
    const p = await res.json();
    if (!res.ok) throw new Error(p?.error?.message || '写真を取得できませんでした');
    return Response.json({ photo: p.photos?.[0]?.name || null });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
