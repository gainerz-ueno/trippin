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
  'places.addressComponents',
  'nextPageToken',
].join(',');

const KEY = () => process.env.GOOGLE_MAPS_API_KEY;

// 国ごとの範囲（南西の角・北東の角）
const COUNTRIES = {
  TW: [21.8, 118.1, 25.4, 122.1],
  KR: [33.0, 124.5, 38.7, 132.0],
  HK: [22.13, 113.8, 22.57, 114.45],
  CN: [18.0, 73.5, 53.6, 134.8],
  VN: [8.4, 102.1, 23.4, 109.5],
  TH: [5.6, 97.3, 20.5, 105.7],
  SG: [1.15, 103.6, 1.48, 104.1],
  MY: [0.85, 99.6, 7.4, 119.3],
  PH: [4.5, 116.9, 21.2, 126.7],
  JP: [24.0, 122.9, 45.6, 146.0],
};

async function searchOnce(textQuery, minRating, pageToken, languageCode, country) {
  const body = { textQuery, languageCode, pageSize: 20 };
  if (minRating) body.minRating = minRating;
  const box = COUNTRIES[country];
  if (box) {
    body.locationRestriction = {
      rectangle: { low: { latitude: box[0], longitude: box[1] }, high: { latitude: box[2], longitude: box[3] } },
    };
  }
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

// 国ごとの現地の言語（Grab・Uber に貼る現地表記を取るため）
const LANG = { TW: 'zh-TW', KR: 'ko', HK: 'zh-HK', CN: 'zh-CN', VN: 'vi', TH: 'th', SG: 'en', MY: 'en', PH: 'en', JP: 'ja' };

const countryOf = (p) =>
  (p.addressComponents || []).find((c) => c.types?.includes('country'))?.shortText || '';

function mostCommonCountry(places) {
  const n = {};
  for (const p of places) { const c = countryOf(p); if (c) n[c] = (n[c] || 0) + 1; }
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

// 1件ずつ現地の言語で名前・住所を取る（検索結果に出てこなかったお店用）
async function detailsIn(id, lang) {
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${id}?languageCode=${lang}`, {
      headers: { 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': 'id,displayName,formattedAddress' },
      cache: 'no-store',
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// 日本語と現地の言語で同じ検索をして、1ページ分を返す
async function searchPage(textQuery, minRating, tokens, country) {
  const ja = await searchOnce(textQuery, minRating, tokens?.ja, 'ja', country);
  const jaPlaces = (ja.places || []).filter((p) => !COUNTRIES[country] || countryOf(p) === country);
  const lang = tokens?.lang || LANG[country] || LANG[mostCommonCountry(jaPlaces)] || 'en';

  let localNext = null;
  const localMap = new Map();
  if (lang !== 'ja') {
    const local = await searchOnce(textQuery, minRating, tokens?.local, lang, country).catch(() => ({ places: [] }));
    localNext = local.nextPageToken || null;
    for (const lp of local.places || []) localMap.set(lp.id, lp);
    const missing = jaPlaces.filter((p) => !localMap.has(p.id));
    const got = await Promise.all(missing.map((p) => detailsIn(p.id, lang)));
    got.forEach((lp) => { if (lp?.id) localMap.set(lp.id, lp); });
  }

  const places = jaPlaces.map((p) => shape(p, localMap.get(p.id), lang));
  const next = ja.nextPageToken ? { ja: ja.nextPageToken, local: localNext, lang } : null;
  return { places, next };
}

const count = (s, re) => (String(s).match(re) || []).length;
const latin = (s) => count(s, /\p{Script=Latin}/gu);
// かなが入っていて、かな・漢字が主体か（「…, ベトナム」のように国名だけ日本語のものは対象外）
const hasKana = (s) =>
  count(s, /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu) > latin(s) &&
  /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s);
// 漢字が主体の文字列か（ラテン文字より漢字が多い）
const hanDominant = (s) => count(s, /\p{Script=Han}/gu) > latin(s);

// name・address = 現地の表記（Grab・Uber に貼る用）
// altName・altAddress = 日本人が読める表記（文字列=表示 / 'translate'=Geminiで作る / ''=出さない）
function shape(p, lp, lang) {
  const jaName = p.displayName?.text || '';
  const jaAddress = p.formattedAddress || '';
  const name = (lang !== 'ja' && lp?.displayName?.text) || jaName;
  const address = (lang !== 'ja' && lp?.formattedAddress) || jaAddress;

  let altName = '';
  if (lang !== 'ja' && !hasKana(name) && !hanDominant(name)) {
    altName = hasKana(jaName) && jaName !== name ? jaName : 'translate';
  } else if (lang !== 'ja' && hanDominant(name) && hasKana(jaName) && jaName !== name) {
    altName = jaName;
  }
  const altAddress = lang !== 'ja' && !hasKana(address) && !hanDominant(address) ? 'translate' : '';

  return {
    placeId: p.id,
    name,
    address,
    altName,
    altAddress,
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

// Gemini で店名は読み方のカタカナ、住所は日本語表記に（使えないときは null）
let lastAiError = '';
async function geminiJapanese(jobs) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { lastAiError = 'no key'; return null; }
  const items = jobs.map(([, field, src], i) => ({ i, kind: field === 'altName' ? 'name' : 'address', text: src }));
  const prompt = [
    '海外のお店の店名と住所を、日本人旅行者が読める日本語表記にしてください。',
    '- name（店名）: 固有名詞は意味で訳さず、現地の読み方をカタカナにする（例: "Phở Thìn" → "フォー・ティン", "Family pho" → "ファミリー・フォー"）。料理の種類などを説明する部分だけ自然な日本語にしてよい。',
    '- address（住所）: 通り名・地区名・都市名はカタカナ、番地の数字はそのまま、国名は日本語。区切りは「、」。',
    '入力と同じ順番・同じ件数で、{"out": ["...", ...]} のJSONだけを返す。',
    JSON.stringify(items),
  ].join('\n');
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
        cache: 'no-store',
      }
    );
    const data = await res.json();
    if (!res.ok) { lastAiError = `${res.status} ${data?.error?.message || ''}`.slice(0, 300); return null; }
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    const out = JSON.parse(text).out;
    if (Array.isArray(out) && out.length === jobs.length) { lastAiError = ''; return out; }
    lastAiError = 'unexpected output';
    return null;
  } catch (e) {
    lastAiError = String(e?.message || e).slice(0, 300);
    return null;
  }
}

// 翻訳が必要なものをまとめて日本語に（Gemini → だめならGoogle翻訳 → だめなら並べない）
async function fillTranslations(places) {
  const jobs = [];
  for (const p of places) {
    if (p.altName === 'translate') jobs.push([p, 'altName', p.name]);
    if (p.altAddress === 'translate') jobs.push([p, 'altAddress', p.address]);
  }
  if (!jobs.length) return places;
  const ai = await geminiJapanese(jobs);
  if (ai) {
    jobs.forEach(([p, field, src], i) => {
      const t = String(ai[i] || '').trim();
      p[field] = t && t !== src ? t : '';
    });
    return places;
  }
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
    return Response.json({ places: filled, nextPageToken: encodeToken(next), aiStatus: lastAiError || 'ok' });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
