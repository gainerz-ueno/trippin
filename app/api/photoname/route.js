// 期限切れになった写真の名前を取り直す
// 取るのは photos だけ（Google の料金表で無料の区分「Place Details Essentials (IDs Only)」）
import { KEY } from '../../lib/places';
import { gfetch, friendly } from '../../lib/gfetch';

export async function GET(req) {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (id.length > 300 || !/^[A-Za-z0-9_-]+$/.test(id)) return Response.json({ error: 'お店の指定が正しくありません' }, { status: 400 });
  if (!KEY()) return Response.json({ error: '写真の設定がまだ終わっていません' }, { status: 500 });
  try {
    const res = await gfetch(`https://places.googleapis.com/v1/places/${id}`, {
      headers: { 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': 'photos' },
      cache: 'no-store',
    }, 8000);
    const p = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('写真を取得できませんでした');
    return Response.json({ photo: p.photos?.[0]?.name || null });
  } catch (e) {
    return Response.json({ error: friendly(e, '写真を取得できませんでした') }, { status: 502 });
  }
}
