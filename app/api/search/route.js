import { KEY, searchPage, fillTranslations, decodeToken, encodeToken, guessCountry } from '../../lib/places';
import { str, num, latLng, country as countryOf, bad } from '../../lib/validate';
import { friendly } from '../../lib/gfetch';

export const maxDuration = 30;

export async function POST(req) {
  if (!KEY()) {
    return Response.json({ error: '検索の設定がまだ終わっていません（運営者の設定待ち）' }, { status: 500 });
  }
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad('入力が正しくありません');
    const keyword = str(body.keyword, 100);
    const area = str(body.area, 60);
    const minRating = num(body.minRating, 0, 5, 0);
    const minReviews = Math.floor(num(body.minReviews, 0, 100000, 0));
    const pageToken = typeof body.pageToken === 'string' && body.pageToken.length <= 4000 ? body.pageToken : null;
    const jaOnly = body.jaOnly === true;
    const near = latLng(body.near);
    // 国を選んでいないときは、場所・キーワードの地名から国を当てる。
    // 当たらないときは検索しない（国を決めてもらってから、Googleへの検索は1回だけにする）
    const country = countryOf(body.country) || (jaOnly ? '' : guessCountry(area, keyword));
    const opts = { jaOnly: !!jaOnly };
    // 宿泊先の近くでさがす：宿泊先から3kmを中心に探す（範囲外のお店も少しは出る）
    const extra = near
      ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 3000 } } }
      : {};
    const textQuery = [keyword, area].filter(Boolean).join(' ');
    if (!textQuery) return bad('キーワードか場所を入力してください');
    // 宿泊先の近くでさがすときは国がわからなくても、日本語の1回だけで探せる
    if (!country && !near && !jaOnly && !pageToken) {
      return Response.json({ error: '国をえらんでから、さがしてください', needCountry: true }, { status: 400 });
    }

    // レビュー件数で絞るとき：1ページずつ取り、10件そろったら止める（自動で取るのは次の1ページまで＝最大2回）
    // 続きは「もっと見る」で同じように取る
    if (minReviews > 0) {
      let all = [];
      let tokens = decodeToken(pageToken);
      for (let i = 0; i < 2; i++) {
        const { places, next } = await searchPage(textQuery, minRating, tokens, country, extra, opts);
        all = all.concat(places.filter((p) => p.reviews >= minReviews));
        tokens = next;
        if (!tokens || all.length >= 10) break;
      }
      return Response.json({ places: await fillTranslations(all), nextPageToken: encodeToken(tokens), country });
    }

    const { places, next } = await searchPage(textQuery, minRating, decodeToken(pageToken), country, extra, opts);
    const filled = await fillTranslations(places);
    return Response.json({ places: filled, nextPageToken: encodeToken(next), country });
  } catch (e) {
    return Response.json({ error: friendly(e, '検索に失敗しました。少し待ってからもう一度試してください') }, { status: 502 });
  }
}
