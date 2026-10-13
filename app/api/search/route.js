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

const KEY = () => process.env.GOOGLE_MAPS_API_KEY;

async function searchOnce(textQuery, minRating, pageToken, languageCode) {
  const body = { textQuery, languageCode, pageSize: 20 };
  if (minRating) body.minRating = minRating;
  if (pageToken) body.pageToken = pageToken;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY(),
      'X-Goog-FieldMask': FIELDS,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || '検索に失敗しました');
  return data;
}

// 日本語と中国語（台湾）で同じ検索をして、1ページ分を返す
async function searchPage(textQuery, minRating, tokens) {
  const [ja, zh] = await Promise.all([
    searchOnce(textQuery, minRating, tokens?.ja, 'ja'),
    searchOnce(textQuery, minRating, tokens?.zh, 'zh-TW').catch(() => ({ places: [] })),
  ]);
  const zhMap = new Map((zh.places || []).map((p) => [p.id, p]));
  const places = (ja.places || []).map((p) => shape(p, zhMap.get(p.id)));
  const next = ja.nextPageToken ? { ja: ja.nextPageToken, zh: zh.nextPageToken || null } : null;
  return { places, next };
}

const count = (s, re) => (String(s).match(re) || []).length;
const latin = (s) => count(s, /\p{Script=Latin}/gu);
// かな・漢字が主体か（「…, ベトナム」のように国名だけ日本語の住所は対象外）
const hasKana = (s) =>
  count(s, /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu) > latin(s) &&
  /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s);
// 漢字が主体の文字列か（ラテン文字より漢字が多い）
const hanDominant = (s) => count(s, /\p{Script=Han}/gu) > latin(s);

function shape(p, zhPlace) {
  const name = p.displayName?.text || '';
  const address = p.formattedAddress || '';
  const zhName = zhPlace?.displayName?.text || '';
  const zhAddress = zhPlace?.formattedAddress || '';
  return {
    placeId: p.id,
    name,
    address,
    // 日本人が読めない表記のときに並べて出す名前・住所
    altName: pickAlt(name, zhName),
    altAddress: pickAlt(address, zhAddress),
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

// 戻り値: 文字列=そのまま並べる / 'translate'=日本語に翻訳する / ''=並べない
function pickAlt(text, zhText) {
  if (!text) return '';
  if (hasKana(text) || hanDominant(text)) return ''; // すでに日本語・漢字で読める
  if (zhText && zhText !== text && hanDominant(zhText)) return zhText; // 漢字の国
  return 'translate';
}

// 翻訳が必要なものをまとめて日本語に（翻訳が使えないときは並べない）
async function fillTranslations(places) {
  const jobs = [];
  for (const p of places) {
    if (p.altName === 'translate') jobs.push([p, 'altName', p.name]);
    if (p.altAddress === 'translate') jobs.push([p, 'altAddress', p.address]);
  }
  if (!jobs.length) return places;
  try {
    const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${KEY()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: jobs.map((j) => j[2]), target: 'ja', format: 'text' }),
      cache: 'no-store',
    });
    const data = await res.json();
    const out = data?.data?.translations;
    if (!res.ok || !out) throw new Error();
    jobs.forEach(([p, field, src], i) => {
      const t = out[i]?.translatedText || '';
      p[field] = t && t !== src ? t : '';
    });
  } catch {
    jobs.forEach(([p, field]) => { p[field] = ''; });
  }
  return places;
}

function decodeToken(t) {
  if (!t) return null;
  try { return JSON.parse(Buffer.from(t, 'base64url').toString()); } catch { return null; }
}
function encodeToken(t) {
  return t ? Buffer.from(JSON.stringify(t)).toString('base64url') : null;
}

export async function POST(req) {
  if (!KEY()) {
    return Response.json({ error: 'APIキーが設定されていません' }, { status: 500 });
  }
  try {
    const { keyword = '', area = '', minRating = 0, minReviews = 0, pageToken = null } = await req.json();
    const textQuery = [keyword, area].map((s) => String(s).trim()).filter(Boolean).join(' ');
    if (!textQuery) return Response.json({ error: 'キーワードか場所を入力してください' }, { status: 400 });

    // レビュー件数で絞るときは、最大60件（3ページ）をまとめて取ってから絞る
    if (minReviews > 0) {
      let all = [];
      let tokens = null;
      for (let i = 0; i < 3; i++) {
        const { places, next } = await searchPage(textQuery, minRating, tokens);
        all = all.concat(places);
        tokens = next;
        if (!tokens) break;
      }
      const filtered = all.filter((p) => p.reviews >= minReviews);
      return Response.json({ places: await fillTranslations(filtered), nextPageToken: null });
    }

    const { places, next } = await searchPage(textQuery, minRating, decodeToken(pageToken));
    return Response.json({ places: await fillTranslations(places), nextPageToken: encodeToken(next) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
