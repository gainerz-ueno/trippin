import { KEY, searchPage, fillTranslations, decodeToken, encodeToken } from '../../lib/places';

export async function POST(req) {
  if (!KEY()) {
    return Response.json({ error: 'APIキーが設定されていません' }, { status: 500 });
  }
  try {
    const { keyword = '', area = '', country = '', minRating = 0, minReviews = 0, pageToken = null } = await req.json();
    const textQuery = [keyword, area].map((s) => String(s).trim()).filter(Boolean).join(' ');
    if (!textQuery) return Response.json({ error: 'キーワードか場所を入力してください' }, { status: 400 });

    // レビュー件数で絞るときは、最大60件（3ページ）をまとめて取ってから絞る
    if (minReviews > 0) {
      let all = [];
      let tokens = null;
      for (let i = 0; i < 3; i++) {
        const { places, next } = await searchPage(textQuery, minRating, tokens, country);
        all = all.concat(places);
        tokens = next;
        if (!tokens) break;
      }
      const filtered = all.filter((p) => p.reviews >= minReviews);
      return Response.json({ places: await fillTranslations(filtered), nextPageToken: null });
    }

    const { places, next } = await searchPage(textQuery, minRating, decodeToken(pageToken), country);
    const filled = await fillTranslations(places);
    return Response.json({ places: filled, nextPageToken: encodeToken(next),  });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
