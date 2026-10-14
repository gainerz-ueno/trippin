import { KEY, searchPage, fillTranslations, decodeToken, encodeToken } from '../../lib/places';
import { str, num, latLng, country as countryOf, bad } from '../../lib/validate';

export async function POST(req) {
  if (!KEY()) {
    return Response.json({ error: 'APIキーが設定されていません' }, { status: 500 });
  }
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad('入力が正しくありません');
    const keyword = str(body.keyword, 100);
    const area = str(body.area, 60);
    const country = countryOf(body.country);
    const minRating = num(body.minRating, 0, 5, 0);
    const minReviews = Math.floor(num(body.minReviews, 0, 100000, 0));
    const pageToken = typeof body.pageToken === 'string' && body.pageToken.length <= 4000 ? body.pageToken : null;
    const jaOnly = body.jaOnly === true;
    const near = latLng(body.near);
    // 国を決めずに探すとGoogleへの検索が2回になるので、国は必ず選んでもらう（ホテル探しは日本語1回だけ）
    if (!country && !jaOnly) return Response.json({ error: '国を選んでください' }, { status: 400 });
    const opts = { jaOnly: !!jaOnly };
    // 宿泊先の近くでさがす：宿泊先から3kmを中心に探す（範囲外のお店も少しは出る）
    const extra = near
      ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 3000 } } }
      : {};
    const textQuery = [keyword, area].map((s) => String(s).trim()).filter(Boolean).join(' ');
    if (!textQuery) return Response.json({ error: 'キーワードか場所を入力してください' }, { status: 400 });

    // レビュー件数で絞るとき：1ページずつ取り、10件そろったら止める（最大3ページ）
    // 続きは「もっと見る」で同じように取る
    if (minReviews > 0) {
      let all = [];
      let tokens = decodeToken(pageToken);
      for (let i = 0; i < 3; i++) {
        const { places, next } = await searchPage(textQuery, minRating, tokens, country, extra, opts);
        all = all.concat(places.filter((p) => p.reviews >= minReviews));
        tokens = next;
        if (!tokens || all.length >= 10) break;
      }
      return Response.json({ places: await fillTranslations(all), nextPageToken: encodeToken(tokens) });
    }

    const { places, next } = await searchPage(textQuery, minRating, decodeToken(pageToken), country, extra, opts);
    const filled = await fillTranslations(places);
    return Response.json({ places: filled, nextPageToken: encodeToken(next),  });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
