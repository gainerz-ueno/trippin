import { KEY, searchPage, fillTranslations, decodeToken, encodeToken } from '../../lib/places';

export async function POST(req) {
  if (!KEY()) {
    return Response.json({ error: 'APIキーが設定されていません' }, { status: 500 });
  }
  try {
    const { keyword = '', area = '', country = '', minRating = 0, minReviews = 0, pageToken = null, jaOnly = false } = await req.json();
    // 国を決めずに探すとGoogleへの検索が2回になるので、国は必ず選んでもらう（ホテル探しは日本語1回だけ）
    if (!country && !jaOnly) return Response.json({ error: '国を選んでください' }, { status: 400 });
    const opts = { jaOnly: !!jaOnly };
    const textQuery = [keyword, area].map((s) => String(s).trim()).filter(Boolean).join(' ');
    if (!textQuery) return Response.json({ error: 'キーワードか場所を入力してください' }, { status: 400 });

    // レビュー件数で絞るとき：1ページずつ取り、10件そろったら止める（最大3ページ）
    // 続きは「もっと見る」で同じように取る
    if (minReviews > 0) {
      let all = [];
      let tokens = decodeToken(pageToken);
      for (let i = 0; i < 3; i++) {
        const { places, next } = await searchPage(textQuery, minRating, tokens, country, {}, opts);
        all = all.concat(places.filter((p) => p.reviews >= minReviews));
        tokens = next;
        if (!tokens || all.length >= 10) break;
      }
      return Response.json({ places: await fillTranslations(all), nextPageToken: encodeToken(tokens) });
    }

    const { places, next } = await searchPage(textQuery, minRating, decodeToken(pageToken), country, {}, opts);
    const filled = await fillTranslations(places);
    return Response.json({ places: filled, nextPageToken: encodeToken(next),  });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
