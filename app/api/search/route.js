// お店検索（Google Places API (New) テキスト検索）
// APIキーはサーバー側だけで使い、ブラウザには出さない
const FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.location',
  'places.photos',
  'places.currentOpeningHours.openNow',
  'places.primaryTypeDisplayName',
  'nextPageToken',
].join(',');

async function searchOnce(textQuery, minRating, pageToken) {
  const body = { textQuery, languageCode: 'ja', pageSize: 20 };
  if (minRating) body.minRating = minRating;
  if (pageToken) body.pageToken = pageToken;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': FIELDS,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || '検索に失敗しました');
  return data;
}

function shape(p) {
  return {
    placeId: p.id,
    name: p.displayName?.text || '',
    address: p.formattedAddress || '',
    rating: p.rating ?? null,
    reviews: p.userRatingCount ?? 0,
    mapsUrl: p.googleMapsUri || '',
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    photo: p.photos?.[0]?.name || null,
    openNow: p.currentOpeningHours?.openNow ?? null,
    type: p.primaryTypeDisplayName?.text || '',
  };
}

export async function POST(req) {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return Response.json({ error: 'APIキーが設定されていません' }, { status: 500 });
  }
  try {
    const { keyword = '', area = '', minRating = 0, minReviews = 0, pageToken = null } = await req.json();
    const textQuery = [keyword, area].map((s) => String(s).trim()).filter(Boolean).join(' ');
    if (!textQuery) return Response.json({ error: 'キーワードか場所を入力してください' }, { status: 400 });

    // レビュー件数で絞るときは、最大60件（3ページ）をまとめて取ってから絞る
    if (minReviews > 0) {
      let all = [];
      let token = null;
      for (let i = 0; i < 3; i++) {
        const d = await searchOnce(textQuery, minRating, token);
        all = all.concat((d.places || []).map(shape));
        token = d.nextPageToken;
        if (!token) break;
      }
      return Response.json({ places: all.filter((p) => p.reviews >= minReviews), nextPageToken: null });
    }

    const d = await searchOnce(textQuery, minRating, pageToken);
    return Response.json({ places: (d.places || []).map(shape), nextPageToken: d.nextPageToken || null });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
