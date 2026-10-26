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
  const hit = list.filter((s) => words.some((w) => Object.values(s[7]).some(([n, a]) => n.includes(w) || a.includes(w)) || s[4].includes(w)));
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

async function gemini(url, body) {
  const parts = body?.contents?.[0]?.parts || [];
  const text = parts.map((p) => p.text || '').join('\n');
  const reply = (o) => json({ candidates: [{ content: { parts: [{ text: typeof o === 'string' ? o : JSON.stringify(o) }] } }] });
  if (/image/.test(url) && body?.generationConfig?.responseModalities?.includes('IMAGE')) {
    const sharp = (await import('sharp')).default;
    const ar = body.generationConfig.imageConfig?.aspectRatio || '4:5';
    const [w, h] = ar.split(':').map(Number);
    const W = 400, H = Math.round((W * h) / w);
    const color = text.includes('Edit') || text.includes('edit') ? '#7FB8E5' : '#F7D6E0';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${color}"/><circle cx="${W / 2}" cy="${H / 2}" r="${W / 4}" fill="#E5483B"/></svg>`;
    const buf = await sharp(Buffer.from(svg)).jpeg().toBuffer();
    return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } }] } }] });
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
