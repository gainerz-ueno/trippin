// 「AIで作る」1枚ノート：写真と文字をまとめて画像AI（Gemini）に渡し、1枚の絵として描かせる
// ・Googleでログインしている人だけ。1人1日3回まで（回数はSupabaseで数える。失敗したら回数を戻す）
import sharp from 'sharp';
import { createHash, timingSafeEqual } from 'node:crypto';
import { SUPABASE_URL, SUPABASE_KEY } from '../../lib/supabase-public';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MODEL = 'gemini-3-pro-image';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

// 【一時的】動作確認用の合言葉（ハッシュだけを置く）。確認が終わったら消す
const TEST_HASH = '567c583e3b8e9a8e2969adf27a331a1243bfb7b2002f2cb03fc8b2e62e23ad72';
function isTest(t) {
  if (!t) return false;
  const a = Buffer.from(createHash('sha256').update(String(t)).digest('hex'));
  const b = Buffer.from(TEST_HASH);
  return a.length === b.length && timingSafeEqual(a, b);
}

const STYLES = {
  lovely: 'cute kawaii pastel pink theme: pink polka-dot paper, hearts, ribbons, bows, sparkles, soft colored-pencil and pastel watercolor illustrations, rounded pink label tags',
  water: 'elegant soft watercolor theme: delicate pastel roses, peonies, lavender and eucalyptus painted in loose watercolor, airy off-white watercolor paper, refined and feminine, thin elegant frames',
  sky: 'fresh bright sky-blue watercolor theme: blue sky with fluffy clouds, fields of light-blue nemophila flowers and green leaves, airplane doodles, clean white panels with blue borders',
  vintage: 'elegant vintage botanical theme: aged cream antique paper, sepia ink line art, dusty rose and sage green botanical sprigs, antique stamps, ornate thin frames, serif-like lettering',
  notebook: 'hand-drawn notebook journal theme: lined notebook paper with spiral binding, colorful marker doodles, washi tape, sticky notes, check boxes, highlighter marks, diary handwriting',
  collage: 'stylish magazine scrapbook collage theme like a trendy Japanese SNS "トリセツ" poster: cut-out photos, torn paper, stickers, gold crowns, hearts, palm trees, a wooden signpost, brush lettering, pastel highlighter labels',
};
const AXES = [
  ['グルメ', ['朝食', '昼食', '夕食', '夜食', '朝市']],
  ['カフェ', ['カフェ', 'おやつ']],
  ['観光', ['観光']],
  ['買物', ['買物']],
  ['夜あそび', ['夜市', '酒場']],
  ['癒し', ['美容', 'マッサージ']],
];

const json = (o, status = 200) => Response.json(o, { status });
const s = (v, max) => (typeof v === 'string' ? v.replace(/[「」\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
const short = (t, max) => { const a = [...t]; return a.length > max ? a.slice(0, max - 1).join('') + '…' : t; };
function img(b64) {
  if (typeof b64 !== 'string' || b64.length > 2_000_000 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return null;
  const buf = Buffer.from(b64, 'base64');
  return buf[0] === 0xff && buf[1] === 0xd8 ? b64 : null; // JPEGだけ
}

async function rpc(fn, token, body = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}
const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').slice(0, 4000);

// 今日あと何回使えるか
export async function GET(req) {
  const token = bearer(req);
  if (!token) return json({ error: 'Googleでログインしてください' }, 401);
  const r = await rpc('ai_credits_left', token);
  if (r.status === 401 || r.status === 403) return json({ error: 'Googleでログインしてください' }, 401);
  if (!r.ok) return json({ error: '回数を確認できませんでした' }, 500);
  return json({ left: await r.json() });
}

function buildPrompt(d) {
  const ar = d.size === 'story' ? '9:16' : '4:5';
  const n = d.spots.length;
  const info = [['行き先', d.place], ['いつ', d.date], ['だれと', d.who], ['行った場所', n + 'か所'], ['書いた人', d.by]].filter(([, v]) => v);
  const counts = AXES.map(([k, cs]) => `${k} ${d.spots.filter((p) => cs.includes(p.cat)).length}`).join(', ');
  const spots = d.spots.map((p, i) => `     ${i + 1}. 「${p.name}」${p.text ? ` — note: 「${short(p.text, 34)}」` : ''}${p.img ? ` (recreate from PHOTO ${p.photoNo})` : ''}`).join('\n');
  const best = d.spots.slice(0, 3).map((p, i) => `${i + 1}位 「${p.name}」`).join(' / ');
  return [
    `Design ONE finished, high-quality vertical poster image (aspect ratio ${ar}) in Japanese: a "旅のトリセツ" (travel instruction manual) infographic, in the style of the hugely popular Japanese social-media "トリセツ" collage posters. Packed, lively and stylish, with a hand-made feel: many small hand-drawn illustrations, icons, doodles, stickers and decorations fill the space, yet every panel stays clean and readable.`,
    `Theme / art style: ${STYLES[d.tpl]}.`,
    'Layout:',
    `- Top: the big hand-lettered title 「${d.title || '旅のトリセツ'}」${d.sub ? ` with a smaller subtitle 「${d.sub}」` : ''}.`,
    d.cover
      ? `- Center (the hero, about 40% of the page): the main subject of PHOTO 1. If PHOTO 1 shows a person, draw that person large in a polished semi-realistic illustration style that keeps their face, hairstyle and outfit recognizable, standing in front of an illustrated scenic backdrop of ${d.place || 'the travel destination'} (famous landmarks, a wooden signpost with place names). If it shows no person, make that scene the big hero illustration.`
      : `- Center (the hero, about 40% of the page): a big illustrated scenic view of ${d.place || 'the travel destination'} with its famous landmarks, built from the place photos.`,
    '- Around the hero, arrange labeled panels with hand-lettered headings and marker-highlight labels:',
    `  * 「基本情報」 panel with rows: ${info.map(([k, v]) => `「${k}」「${v}」`).join(' / ')}`,
    `  * 「行った場所」: one small framed photo card per place, with the place name and its short hand-written note:\n${spots}`,
    n > 1 ? `  * 「BEST 3」 ranking with gold crowns: ${best}` : '',
    `  * 「旅のバランス」 hexagon radar chart with axes グルメ, カフェ, 観光, 買物, 夜あそび, 癒し (relative values: ${counts})`,
    d.words ? `  * 「ひとこと」 speech bubble saying 「${d.words}」` : '',
    '  * cute hand-drawn icons of things from this trip (the foods, drinks, shops and sights above), plus travel doodles: airplane, suitcase, map pin, camera, stars, hearts, crowns.',
    'Text rules: write every Japanese text exactly as given inside 「」 (without the brackets), with correct characters, clearly legible, in cute hand-written Japanese lettering. Do not invent other Japanese sentences. Short decorative English phrases such as "My Travel Manual" or "Good Trip!" are fine. No logos, no brand names, no watermarks, no QR codes, no app UI.',
    'Fill the whole canvas edge to edge with no white margin.',
  ].filter(Boolean).join('\n');
}

export async function POST(req) {
  const test = isTest(req.headers.get('x-art-token'));
  let body;
  try { body = await req.json(); } catch { return json({ error: 'データが読めませんでした' }, 400); }

  // 動作確認用：見本の写真を作る（一時的）
  if (test && typeof body.raw === 'string') {
    const out = await gen([{ text: body.raw.slice(0, 3000) }], body.aspect === '9:16' ? '9:16' : body.aspect === '1:1' ? '1:1' : '4:5');
    if (!out.ok) return json({ error: out.error }, 502);
    return new Response(out.jpg, { headers: { 'content-type': 'image/jpeg' } });
  }

  // 入力チェック
  const tpl = STYLES[body.tpl] ? body.tpl : null;
  const size = body.size === 'story' ? 'story' : 'post';
  const spotsIn = Array.isArray(body.spots) ? body.spots.slice(0, 6) : [];
  if (!tpl || !spotsIn.length) return json({ error: 'お店とデザインをえらんでください' }, 400);
  const d = {
    tpl, size,
    title: s(body.title, 24), sub: s(body.sub, 12), place: s(body.place, 30), date: s(body.date, 24),
    who: s(body.who, 20), by: s(body.by, 20), words: s(body.words, 80),
    cover: img(body.cover),
    spots: spotsIn.map((p) => ({ name: s(p?.name, 40), cat: s(p?.cat, 20), text: s(p?.text, 200), img: img(p?.img) })).filter((p) => p.name),
  };
  if (!d.spots.length) return json({ error: 'お店をえらんでください' }, 400);
  let no = d.cover ? 1 : 0;
  d.spots.forEach((p) => { if (p.img) p.photoNo = ++no; });

  // 回数（1人1日3回まで）
  let token = null, ticket = null;
  if (!test) {
    token = bearer(req);
    if (!token) return json({ error: 'Googleでログインしてください' }, 401);
    const r = await rpc('use_ai_credit', token);
    if (r.status === 401 || r.status === 403) return json({ error: 'Googleでログインしてください' }, 401);
    if (!r.ok) return json({ error: '回数を確認できませんでした' }, 500);
    ticket = await r.json();
    if (!ticket) return json({ error: '「AIで作る」は1日3回までです。また明日使ってください' }, 429);
  }

  const parts = [{ text: buildPrompt(d) }];
  if (d.cover) parts.push({ text: 'PHOTO 1 (main photo):' }, { inlineData: { mimeType: 'image/jpeg', data: d.cover } });
  d.spots.forEach((p) => { if (p.img) parts.push({ text: `PHOTO ${p.photoNo} (place: ${p.name}):` }, { inlineData: { mimeType: 'image/jpeg', data: p.img } }); });

  const out = await gen(parts, size === 'story' ? '9:16' : '4:5');
  if (!out.ok) {
    if (ticket) await rpc('refund_ai_credit', token, { ticket }).catch(() => {});
    return json({ error: 'AIがうまく描けませんでした。もう一度試してください（回数は減っていません）' }, 502);
  }
  return new Response(out.jpg, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } });
}

async function gen(parts, aspect) {
  try {
    const r = await fetch(`${GEMINI}/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect, imageSize: '2K' } } }),
    });
    const d = await r.json();
    const part = d.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) return { ok: false, error: d.error?.message || d.candidates?.[0]?.finishReason || 'no image' };
    // 画面で扱いやすい大きさ（幅1440px）のJPEGにする
    const jpg = await sharp(Buffer.from(part.inlineData.data, 'base64')).resize({ width: 1440, withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    return { ok: true, jpg };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
