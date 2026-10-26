// お店検索（Google Places API (New) テキスト検索）
// APIキーはサーバー側だけで使い、ブラウザには出さない
import { gfetch, MOCK } from './gfetch';
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
  // 営業時間も検索と同じ料金区分で一緒に取れる（候補に入れたあと別に取りに行かなくていい）
  'places.regularOpeningHours.periods',
  'places.utcOffsetMinutes',
  'nextPageToken',
].join(',');

export const KEY = () => process.env.GOOGLE_MAPS_API_KEY || (MOCK ? 'mock' : '');

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

async function searchOnce(textQuery, minRating, pageToken, languageCode, country, extra = {}) {
  const body = { textQuery, languageCode, pageSize: 20, ...extra };
  if (minRating) body.minRating = minRating;
  const box = COUNTRIES[country];
  // locationBias（宿泊先・現在地の近く）と国の範囲は同時に指定できないので、そのときは国の範囲は結果の国で絞る
  if (box && !body.locationBias) {
    body.locationRestriction = {
      rectangle: { low: { latitude: box[0], longitude: box[1] }, high: { latitude: box[2], longitude: box[3] } },
    };
  }
  if (pageToken) body.pageToken = pageToken;
  const res = await gfetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY(),
      'X-Goog-FieldMask': FIELDS,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[tabibi] searchText', res.status, data?.error?.message);
    throw new Error(res.status === 429 ? 'Googleの検索が混み合っています。少し待ってからもう一度試してください' : '検索に失敗しました。言葉を変えて、もう一度試してください');
  }
  return data;
}

// 国ごとの現地の言語（Grab・Uber に貼る現地表記を取るため）
const LANG = { TW: 'zh-TW', KR: 'ko', HK: 'zh-HK', CN: 'zh-CN', VN: 'vi', TH: 'th', SG: 'en', MY: 'en', PH: 'en', JP: 'ja' };

export const LANGS = Object.values(LANG);
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
    const res = await gfetch(`https://places.googleapis.com/v1/places/${id}?languageCode=${encodeURIComponent(lang)}`, {
      headers: { 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': 'id,displayName,formattedAddress' },
      cache: 'no-store',
    }, 8000);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// 国を選んでいないとき、地名から国を当てる（当たればGoogleへの検索は1回で済む）
// ・「場所」の欄：国名も街の名前も使う
// ・「キーワード」の欄：街の名前だけ（「韓国料理」「タイ料理」のような料理名で国を決めつけないため）
const CITY = [
  ['TW', '台湾|臺灣|Taiwan', '台北|臺北|台中|臺中|台南|臺南|高雄|九份|淡水|士林|西門|永康街|花蓮|基隆|新北|桃園|宜蘭|墾丁|日月潭|阿里山|Taipei|Kaohsiung|Tainan|Taichung'],
  ['KR', '韓国|Korea', 'ソウル|釜山|明洞|弘大|江南|東大門|仁川|済州|景福宮|梨泰院|Seoul|Busan'],
  ['HK', '香港|Hong ?Kong', '九龍|尖沙咀|旺角|銅鑼湾|中環|Kowloon'],
  ['VN', 'ベトナム|Vietnam|Viet Nam', 'ホーチミン|ハノイ|ダナン|ホイアン|フエ|ニャチャン|フーコック|Ho Chi Minh|Hanoi|Da ?Nang|Hoi An'],
  ['TH', 'タイ|Thailand', 'バンコク|プーケット|チェンマイ|パタヤ|アユタヤ|Bangkok|Phuket|Chiang ?Mai'],
  ['SG', 'シンガポール|Singapore', 'シンガポール|Singapore'],
  ['MY', 'マレーシア|Malaysia', 'クアラルンプール|ペナン|コタキナバル|ランカウイ|Kuala Lumpur|Penang'],
  ['PH', 'フィリピン|Philippines', 'マニラ|セブ|ボラカイ|Manila|Cebu'],
  ['CN', '中国|China', '上海|北京|広州|深圳|成都|西安|杭州|Shanghai|Beijing'],
].map(([c, nation, city]) => [c, new RegExp(nation + '|' + city, 'i'), new RegExp(city, 'i')]);
export function guessCountry(area, keyword) {
  const pick = (list) => (list.length === 1 ? list[0] : '');
  const byArea = pick(CITY.filter(([, all]) => all.test(area || '')).map(([c]) => c));
  if (byArea || area) return byArea;
  return pick(CITY.filter(([, , city]) => city.test(keyword || '')).map(([c]) => c));
}

// 1ページ分を返す
// ・国を選んでいるとき：現地の言語で1回だけ検索（日本語表記はAIで作る）→ Googleへの検索は1回
// ・国を選んでいないとき：日本語で検索して国を判定 → 現地の言語でもう1回（現地の表記を取るため）
// ・opts.jaOnly：日本語の1回だけ（AIナビの近く探し用。現地の表記は選ばれたお店だけ後で取る）
export async function searchPage(textQuery, minRating, tokens, country, extra = {}, opts = {}) {
  const lang0 = LANG[country];
  if (tokens?.single || (lang0 && !tokens?.ja && !opts.jaOnly)) {
    const lang = tokens?.lang || lang0;
    const r = await searchOnce(textQuery, minRating, tokens?.local, lang, country, extra);
    const raw = (r.places || []).filter((p) => !COUNTRIES[country] || countryOf(p) === country);
    const places = raw.map((p) => shape(p, p, lang, false));
    const next = r.nextPageToken ? { single: true, local: r.nextPageToken, lang } : null;
    return { places, next, lang };
  }

  const ja = await searchOnce(textQuery, minRating, tokens?.ja, 'ja', country, extra);
  const jaPlaces = (ja.places || []).filter((p) => !COUNTRIES[country] || countryOf(p) === country);
  const lang = tokens?.lang || lang0 || LANG[mostCommonCountry(jaPlaces)] || 'en';

  if (opts.jaOnly) return { places: jaPlaces.map((p) => shape(p, null, 'ja')), next: null, lang };

  let localNext = null;
  const localMap = new Map();
  if (lang !== 'ja') {
    const local = await searchOnce(textQuery, minRating, tokens?.local, lang, country, extra).catch(() => ({ places: [] }));
    localNext = local.nextPageToken || null;
    for (const lp of local.places || []) localMap.set(lp.id, lp);
    // 現地の言語の検索に出てこなかったお店だけ1件ずつ取る（1件ごとに料金がかかるので最大6件まで）
    const missing = jaPlaces.filter((p) => !localMap.has(p.id)).slice(0, 6);
    const got = await Promise.all(missing.map((p) => detailsIn(p.id, lang)));
    got.forEach((lp) => { if (lp?.id) localMap.set(lp.id, lp); });
  }

  const places = jaPlaces.map((p) => shape(p, localMap.get(p.id), lang));
  const next = ja.nextPageToken ? { ja: ja.nextPageToken, local: localNext, lang } : null;
  return { places, next, lang };
}

// 日本語で取ったお店（AIナビで選ばれた数件）に、現地の店名・住所を付ける
export async function localize(places, lang) {
  if (!lang || lang === 'ja') return places;
  return Promise.all(
    places.map(async (p) => {
      const lp = await detailsIn(p.placeId, lang);
      if (!lp) return p;
      const name = lp.displayName?.text || p.name;
      const address = lp.formattedAddress || p.address;
      return { ...p, name, address, ...alts(name, address, p.name, lang, true) };
    })
  );
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
function alts(name, address, jaName, lang, jaKnown) {
  let altName = '';
  if (lang !== 'ja' && !hasKana(name) && !hanDominant(name)) {
    altName = jaKnown && hasKana(jaName) && jaName !== name ? jaName : 'translate';
  } else if (lang !== 'ja' && jaKnown && hanDominant(name) && hasKana(jaName) && jaName !== name) {
    altName = jaName;
  }
  const altAddress = lang !== 'ja' && !hasKana(address) && !hanDominant(address) ? 'translate' : '';
  return { altName, altAddress };
}

// 営業時間（曜日ごとの表示は日本語で作る。月曜はじまり）
const DAYS = ['日', '月', '火', '水', '木', '金', '土'];
const hm = (t) => `${t.hour ?? 0}:${String(t.minute ?? 0).padStart(2, '0')}`;
function hoursOf(p) {
  const periods = p.regularOpeningHours?.periods || [];
  const offset = p.utcOffsetMinutes ?? 0;
  let hours = [];
  if (periods.length === 1 && !periods[0].close) {
    hours = [1, 2, 3, 4, 5, 6, 0].map((d) => `${DAYS[d]}曜日: 24時間営業`);
  } else if (periods.length) {
    hours = [1, 2, 3, 4, 5, 6, 0].map((d) => {
      const list = periods.filter((x) => x.open?.day === d).map((x) => `${hm(x.open)}～${x.close ? hm(x.close) : ''}`);
      return `${DAYS[d]}曜日: ${list.length ? list.join('、') : '定休日'}`;
    });
  }
  return { hours, periods, offset, at: Date.now() };
}

// jaKnown=false：日本語の表記を取っていない（現地の言語1回だけで検索したとき）
function shape(p, lp, lang, jaKnown = true) {
  const jaName = jaKnown ? p.displayName?.text || '' : '';
  const jaAddress = jaKnown ? p.formattedAddress || '' : '';
  const name = (lang !== 'ja' && lp?.displayName?.text) || jaName || p.displayName?.text || '';
  const address = (lang !== 'ja' && lp?.formattedAddress) || jaAddress || p.formattedAddress || '';
  const { altName, altAddress } = alts(name, address, jaName, lang, jaKnown);

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
    country: countryOf(p),
    hoursInfo: hoursOf(p),
  };
}

// Gemini で店名は読み方のカタカナ、住所は日本語表記に（使えないときは null）
export let lastAiError = '';
async function geminiJapanese(jobs) {
  const key = process.env.GEMINI_API_KEY || (MOCK ? 'mock' : '');
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
    const res = await gfetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
        cache: 'no-store',
      },
      12000
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
export async function fillTranslations(places) {
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
    const res = await gfetch(`https://translation.googleapis.com/language/translate/v2?key=${KEY()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: jobs.map((j) => j[2]), target: 'ja', format: 'text' }),
      cache: 'no-store',
    }, 8000);
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

// 「もっと見る」の続きの印（ブラウザから戻ってくるので、中身を確かめてから使う）
export function decodeToken(t) {
  if (!t) return null;
  try {
    const o = JSON.parse(Buffer.from(t, 'base64url').toString());
    if (!o || typeof o !== 'object') return null;
    const tok = (v) => (typeof v === 'string' && v.length <= 2000 ? v : null);
    return { single: o.single === true, ja: tok(o.ja), local: tok(o.local), lang: LANGS.includes(o.lang) || o.lang === 'en' || o.lang === 'ja' ? o.lang : null };
  } catch { return null; }
}
export function encodeToken(t) {
  return t ? Buffer.from(JSON.stringify(t)).toString('base64url') : null;
}

