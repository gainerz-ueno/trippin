// お店の詳細（Google Places API (New) Place Details）
const FIELDS = [
  'id',
  'photos',
  'regularOpeningHours.weekdayDescriptions',
  'regularOpeningHours.periods',
  'currentOpeningHours.openNow',
  'utcOffsetMinutes',
  'internationalPhoneNumber',
  'nationalPhoneNumber',
  'websiteUri',
  'priceLevel',
  'priceRange',
  'reviews',
  'googleMapsUri',
].join(',');

const PRICE = {
  PRICE_LEVEL_FREE: '無料',
  PRICE_LEVEL_INEXPENSIVE: '¥',
  PRICE_LEVEL_MODERATE: '¥¥',
  PRICE_LEVEL_EXPENSIVE: '¥¥¥',
  PRICE_LEVEL_VERY_EXPENSIVE: '¥¥¥¥',
};

function money(m) {
  if (!m?.units) return '';
  return `${Number(m.units).toLocaleString('ja-JP')} ${m.currencyCode || ''}`.trim();
}

// lite=1：営業時間だけ（写真・口コミを取らないので安い料金区分になる）
const LITE = ['id', 'regularOpeningHours.weekdayDescriptions', 'regularOpeningHours.periods', 'utcOffsetMinutes'].join(',');

export async function GET(req) {
  const u = new URL(req.url);
  const id = u.searchParams.get('id') || '';
  const lite = u.searchParams.get('lite') === '1';
  if (id.length > 300 || !/^[A-Za-z0-9_-]+$/.test(id)) return Response.json({ error: 'bad request' }, { status: 400 });
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${id}?languageCode=ja`, {
      headers: { 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY, 'X-Goog-FieldMask': lite ? LITE : FIELDS },
      cache: 'no-store',
    });
    const p = await res.json();
    if (!res.ok) throw new Error(p?.error?.message || '詳細を取得できませんでした');

    // お店の現地時間での今日の曜日（Googleの曜日一覧は月曜始まり）
    const offset = p.utcOffsetMinutes ?? 0;
    const todayIndex = (new Date(Date.now() + offset * 60000).getUTCDay() + 6) % 7;

    const range = p.priceRange
      ? [money(p.priceRange.startPrice), money(p.priceRange.endPrice)].filter(Boolean).join(' 〜 ')
      : '';

    return Response.json({
      photos: (p.photos || []).slice(0, 3).map((ph) => ({
        name: ph.name,
        by: ph.authorAttributions?.[0]?.displayName || '',
      })),
      hours: p.regularOpeningHours?.weekdayDescriptions || [],
      periods: p.regularOpeningHours?.periods || [],
      offset,
      todayIndex,
      openNow: p.currentOpeningHours?.openNow ?? null,
      phone: p.internationalPhoneNumber || p.nationalPhoneNumber || '',
      website: p.websiteUri || '',
      price: PRICE[p.priceLevel] || '',
      priceRange: range,
      reviews: (p.reviews || []).slice(0, 5).map((r) => {
        const text = r.text?.text || '';
        const original = r.originalText?.text || '';
        return {
          rating: r.rating ?? null,
          when: r.relativePublishTimeDescription || '',
          author: r.authorAttribution?.displayName || '',
          text,
          original: original && original !== text ? original : '',
        };
      }),
      mapsUrl: p.googleMapsUri || '',
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
