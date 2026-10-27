// テスト用のにせ物のGoogle（Places API (New)・Gemini・翻訳）
// TABIBI_MOCK=1 のときだけ使う。本物のキーがない場所で、画面の流れを最後まで確かめるためのもの

// [id, 国, 緯度, 経度, 種類, 評価, 件数, {言語: [名前, 住所]}]
const SPOTS = [
  ['mockTW1', 'TW', 25.0418, 121.5065, 'レストラン', 4.3, 5210, { 'zh-TW': ['金峰魯肉飯', '100台灣台北市中正區羅斯福路一段10號之1'], ja: ['金峰魯肉飯', '台湾 台北市中正区羅斯福路一段10号之1'] }],
  ['mockTW2', 'TW', 25.0329, 121.5250, 'レストラン', 4.1, 2380, { 'zh-TW': ['黃記魯肉飯', '100台灣台北市中正區南昌路一段1號'], ja: ['黄記魯肉飯', '台湾 台北市中正区南昌路一段1号'] }],
  ['mockTW3', 'TW', 25.0880, 121.5240, '夜市', 4.4, 61200, { 'zh-TW': ['士林夜市', '111台灣台北市士林區基河路101號'], ja: ['士林夜市', '台湾 台北市士林区基河路101号'] }],
  ['mockTW4', 'TW', 25.0345, 121.5645, '観光名所', 4.6, 98000, { 'zh-TW': ['台北101', '110台灣台北市信義區信義路五段7號'], ja: ['台北101', '台湾 台北市信義区信義路五段7号'] }],
  ['mockTW5', 'TW', 25.0330, 121.5300, '朝食レストラン', 4.2, 15000, { 'zh-TW': ['阜杭豆漿', '100台灣台北市中正區忠孝東路一段108號2樓'], ja: ['阜杭豆漿', '台湾 台北市中正区忠孝東路一段108号2階'] }],
  ['mockTW6', 'TW', 25.0478, 121.5170, 'ホテル', 4.4, 8800, { 'zh-TW': ['台北凱撒大飯店', '100台灣台北市中正區忠孝西路一段38號'], ja: ['シーザーパーク台北', '台湾 台北市中正区忠孝西路一段38号'] }],
  ['mockVN1', 'VN', 10.7769, 106.7009, 'フォー専門店', 4.5, 7200, { vi: ['Phở Hòa Pasteur', '260C Pasteur, Phường 8, Quận 3, Hồ Chí Minh, Việt Nam'], ja: ['Phở Hòa Pasteur', '260C Pasteur, Phường 8, Quận 3, Hồ Chí Minh, ベトナム'] }],
  ['mockVN2', 'VN', 10.7725, 106.6980, '市場', 4.0, 45000, { vi: ['Chợ Bến Thành', 'Lê Lợi, Phường Bến Thành, Quận 1, Hồ Chí Minh, Việt Nam'], ja: ['ベンタイン市場', 'Lê Lợi, Phường Bến Thành, Quận 1, Hồ Chí Minh, ベトナム'] }],
  ['mockKR1', 'KR', 37.5636, 126.9820, '市場', 4.3, 30000, { ko: ['명동 거리', '서울특별시 중구 명동'], ja: ['明洞', '韓国 ソウル特別市中区明洞'] }],
];

// 営業時間（毎日 7:00〜22:00、日曜休み）
const PERIODS = [1, 2, 3, 4, 5, 6].map((d) => ({ open: { day: d, hour: 7, minute: 0 }, close: { day: d, hour: 22, minute: 0 } }));
const WEEK = ['月曜日: 7時00分～22時00分', '火曜日: 7時00分～22時00分', '水曜日: 7時00分～22時00分', '木曜日: 7時00分～22時00分', '金曜日: 7時00分～22時00分', '土曜日: 7時00分～22時00分', '日曜日: 定休日'];
const OFFSET = { TW: 480, VN: 420, KR: 540 };

export const mockCalls = []; // 何回Googleに聞いたか（費用の確かめ用）

function place(s, lang) {
  const [id, country, lat, lng, type, rating, n, names] = s;
  const [name, addr] = names[lang] || names.ja || Object.values(names)[0];
  return {
    id,
    displayName: { text: name, languageCode: lang },
    formattedAddress: addr,
    rating,
    userRatingCount: n,
    googleMapsUri: `https://maps.google.com/?cid=${id}`,
    location: { latitude: lat, longitude: lng },
    photos: [{ name: `places/${id}/photos/p1`, authorAttributions: [{ displayName: 'テスト撮影者' }] }, { name: `places/${id}/photos/p2`, authorAttributions: [] }],
    currentOpeningHours: { openNow: true },
    primaryTypeDisplayName: { text: type },
    addressComponents: [{ shortText: country, types: ['country', 'political'] }],
    regularOpeningHours: { periods: PERIODS, weekdayDescriptions: WEEK },
    utcOffsetMinutes: OFFSET[country] ?? 480,
    internationalPhoneNumber: '+886 2 0000 0000',
    websiteUri: 'https://example.com/',
    priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
    reviews: [{ rating: 5, relativePublishTimeDescription: '1 か月前', authorAttribution: { displayName: 'テスト太郎' }, text: { text: 'とてもおいしかったです' }, originalText: { text: '很好吃' } }],
  };
}

function inBox(s, box) {
  if (!box) return true;
  const { low, high } = box.rectangle;
  return s[2] >= low.latitude && s[2] <= high.latitude && s[3] >= low.longitude && s[3] <= high.longitude;
}

function pick(fields, p) {
  // フィールドマスクに入っているものだけ返す（本物と同じく、頼んでいないものは返さない）
  const want = fields.split(',').map((f) => f.trim().replace(/^places\./, ''));
  const out = {};
  for (const f of want) {
    const top = f.split('.')[0];
    if (p[top] !== undefined) out[top] = p[top];
  }
  return out;
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

function searchText(body, mask) {
  const q = String(body.textQuery || '');
  if (/エラー|error/i.test(q)) return json({ error: { message: 'Request had invalid argument (mock)' } }, 400);
  const lang = body.languageCode || 'ja';
  let list = SPOTS.filter((s) => inBox(s, body.locationRestriction));
  const words = q.split(/\s+/).filter(Boolean);
  // その言語の名前・住所だけで当てる（本物も、日本語の名前は現地の言語の検索では当たらないことがある）
  const namesIn = (s) => (s[7][lang] ? [s[7][lang]] : Object.values(s[7]));
  const hit = list.filter((s) => words.some((w) => namesIn(s).some(([n, a]) => n.includes(w) || a.includes(w)) || s[4].includes(w)));
  if (hit.length) list = hit;
  if (/ホテル|hotel/i.test(q)) list = SPOTS.filter((s) => s[4] === 'ホテル');
  if (/なし|nothing/.test(q)) list = [];
  if (body.minRating) list = list.filter((s) => s[5] >= body.minRating);
  // 1ページ4件まで。続きはページトークンで
  const start = body.pageToken ? Number(body.pageToken.replace('p', '')) || 0 : 0;
  const page = list.slice(start, start + 4);
  const next = start + 4 < list.length ? 'p' + (start + 4) : undefined;
  const places = page.map((s) => pick(mask, place(s, lang)));
  return json({ places, ...(next && mask.includes('nextPageToken') ? { nextPageToken: next } : {}) });
}

// テスト用の絵（幅200px。青＝直した絵、ピンク＝新しく描いた絵。まん中に赤い丸）
const MOCK_JPG = {
  '4:5|edit': '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',
  '4:5|new': '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',
  '9:16|edit': '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',
  '9:16|new': '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',
};

async function gemini(url, body) {
  const parts = body?.contents?.[0]?.parts || [];
  const text = parts.map((p) => p.text || '').join('\n');
  const reply = (o) => json({ candidates: [{ content: { parts: [{ text: typeof o === 'string' ? o : JSON.stringify(o) }] } }] });
  if (/image/.test(url) && body?.generationConfig?.responseModalities?.includes('IMAGE')) {
    // Cloudflare の Worker には sharp が無いので、作り置きの絵（縦長2種×色2種）を返す。縦横の比が合わないときは 4:5 を使う
    const ar = body.generationConfig.imageConfig?.aspectRatio || '4:5';
    const kind = text.includes('Edit') || text.includes('edit') ? 'edit' : 'new';
    const data = MOCK_JPG[`${ar}|${kind}`] || MOCK_JPG[`4:5|${kind}`];
    return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data } }] } }] });
  }
  if (text.includes('日本人旅行者が読める日本語表記')) {
    const items = JSON.parse(text.split('\n').filter((l) => l.startsWith('[')).pop() || '[]');
    return reply({ out: items.map((x) => (x.kind === 'name' ? `（読み）${x.text.slice(0, 8)}` : `（日本語）${x.text}`)) });
  }
  if (text.includes('短い検索語')) return reply({ searchQuery: 'レストラン' });
  if (text.includes('付き添う')) {
    const line = text.split('\n').find((l) => l.startsWith('候補リスト: ')) || '';
    const near = text.split('\n').find((l) => l.startsWith('近くで今開いているお店: ')) || '';
    const list = JSON.parse(line.replace('候補リスト: ', '') || '[]');
    const nearby = JSON.parse(near.replace('近くで今開いているお店: ', '') || '[]');
    const picks = [...list.slice(0, 2), ...nearby.slice(0, 1)].map((x) => ({ id: x.id, reason: 'テストの理由です' }));
    return reply({ answer: 'テストの答えです。近い順におすすめします。', picks });
  }
  if (text.includes('スクリーンショット')) return reply({ shops: [{ name: '金峰魯肉飯', city: '台北', country: 'TW' }] });
  if (text.includes('RED outline')) return reply('EN: make it bigger\nJA: 大きくします');
  return reply({});
}

export async function mockGoogle(url, opts = {}) {
  mockCalls.push(url.replace(/key=[^&]+/, 'key=…'));
  if (process.env.TABIBI_MOCK_LOG === '1') console.log('[mock-google]', url.replace(/key=[^&]+/, 'key=…').slice(0, 120));
  const u = new URL(url);
  const mask = (opts.headers && (opts.headers['X-Goog-FieldMask'] || opts.headers['x-goog-fieldmask'])) || '';
  let body = null;
  try { body = opts.body ? JSON.parse(opts.body) : null; } catch {}
  if (u.host === 'places.googleapis.com') {
    if (u.pathname === '/v1/places:searchText') return searchText(body || {}, mask);
    const media = u.pathname.match(/^\/v1\/(places\/[^/]+\/photos\/[^/]+)\/media$/);
    if (media) return json({ name: media[1], photoUri: '/icon-512.png' });
    const m = u.pathname.match(/^\/v1\/places\/([^/]+)$/);
    if (m) {
      const s = SPOTS.find((x) => x[0] === m[1]);
      if (!s) return json({ error: { message: 'Not found (mock)' } }, 404);
      return json(pick(mask, place(s, u.searchParams.get('languageCode') || 'ja')));
    }
  }
  if (u.host === 'generativelanguage.googleapis.com') return gemini(url, body);
  if (u.host === 'translation.googleapis.com') return json({ data: { translations: (body?.q || []).map((t) => ({ translatedText: '（訳）' + t })) } });
  return json({ error: { message: 'unknown mock url' } }, 404);
}
