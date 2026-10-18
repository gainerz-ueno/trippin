// 「AIで作る」1枚ノート：写真と文字をまとめて画像AI（Gemini）に渡し、1枚の絵として描かせる
// ・Googleでログインしている人だけ。1人1日3回まで（回数はSupabaseで数える。失敗したら回数を戻す）
import sharp from 'sharp';
import { SUPABASE_URL, SUPABASE_KEY } from '../../lib/supabase-public';
import { createHash, timingSafeEqual } from 'node:crypto';
// 【一時的】動作確認用（確認が終わったら消す）
const TEST_HASH = '567c583e3b8e9a8e2969adf27a331a1243bfb7b2002f2cb03fc8b2e62e23ad72';
function isTest(t) { if (!t) return false; const a = Buffer.from(createHash('sha256').update(String(t)).digest('hex')); const b = Buffer.from(TEST_HASH); return a.length === b.length && timingSafeEqual(a, b); }

export const runtime = 'nodejs';
export const maxDuration = 120;

const MODEL = 'gemini-3-pro-image';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

const STYLES = {
  lovely: 'cute kawaii pastel pink theme: pink polka-dot paper, hearts, ribbons, bows, sparkles, soft colored-pencil and pastel watercolor illustrations, rounded pink label tags',
  water: 'elegant soft watercolor theme: delicate pastel roses, peonies, lavender and eucalyptus painted in loose watercolor, airy off-white watercolor paper, refined and feminine, thin elegant frames',
  sky: 'fresh bright sky-blue watercolor theme: blue sky with fluffy clouds, fields of light-blue nemophila flowers and green leaves, airplane doodles, clean white panels with blue borders',
  vintage: 'elegant vintage botanical theme: aged cream antique paper, sepia ink line art, dusty rose and sage green botanical sprigs, antique stamps, ornate thin frames, serif-like lettering',
  notebook: 'hand-drawn notebook journal theme: lined notebook paper with spiral binding, colorful marker doodles, washi tape, sticky notes, check boxes, highlighter marks, diary handwriting',
  collage: 'stylish magazine scrapbook collage theme like a trendy Japanese SNS "トリセツ" poster: cut-out photos, torn paper, stickers, gold crowns, hearts, palm trees, a wooden signpost, brush lettering, pastel highlighter labels',
};
// 「わたしたちの写真」の入れ方（ページのすみに小さめに入れる。真ん中にはしない）
const PEOPLE = {
  cutout: 'as cut-out photos along their outlines with a white sticker border; keep them photographic and faithful to the original photos (same faces, hair and clothes)',
  likeness: 'as small portrait illustrations that closely keep their faces, hairstyles and outfits',
  chibi: 'as adorable small chibi characters (about 2 heads tall) that keep their hairstyles and outfits',
};

// 「好みを選ぶ」の選択肢（決まった言葉だけ受け付ける）
const PREFS = {
  touch: {
    watercolor: 'soft transparent watercolor painting',
    pencil: 'soft colored-pencil drawing with gentle pastel shading',
    marker: 'hand-drawn marker and fine-liner doodle illustration',
    anime: 'clean, cute Japanese anime-style illustration with crisp line art',
    collage: 'magazine scrapbook collage with cut-out photos, torn paper and stickers',
  },
  density: {
    clean: 'clean and airy layout with generous white space and only a few decorations',
    normal: 'balanced layout with a moderate amount of decorations',
    packed: 'densely packed, lively layout where every corner is filled with small illustrations, icons, stickers and doodles, like a popular Japanese SNS "トリセツ" poster',
  },
  color: {
    pastel: 'soft pastel color palette',
    vivid: 'bright, vivid, saturated color palette',
    muted: 'muted, dusty, calm color palette',
    mono: 'mostly black and white with one accent color',
  },
  font: {
    round: 'cute rounded hand-written Japanese lettering',
    brush: 'bold brush-calligraphy style Japanese lettering',
    pop: 'bold, playful pop-style Japanese lettering',
    mincho: 'elegant serif (Mincho-style) Japanese lettering',
  },
};
function prefText(p) {
  if (!p || typeof p !== 'object') return '';
  const out = [];
  for (const k of Object.keys(PREFS)) if (PREFS[k][p[k]]) out.push(PREFS[k][p[k]]);
  const memo = s(p.memo, 60);
  return (out.length ? `User preferences (follow them, they override the theme where they conflict): ${out.join('; ')}.` : '') + (memo ? ` Extra request from the user (in Japanese): 「${memo}」.` : '');
}

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
function img(b64, max = 2_000_000) {
  if (typeof b64 !== 'string' || b64.length > max || !/^[A-Za-z0-9+/=]+$/.test(b64)) return null;
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
// 運営者のアカウントは回数の制限なし（動作確認のため）。ログインしているアカウントをSupabaseで確かめる
const UNLIMITED = new Set(['be07854d-c007-4404-85cd-fddc9867e5ff']);
async function isUnlimited(token) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!r.ok) return false;
    const u = await r.json();
    return UNLIMITED.has(u?.id);
  } catch { return false; }
}

export async function GET(req) {
  const token = bearer(req);
  if (!token) return json({ error: 'Googleでログインしてください' }, 401);
  if (await isUnlimited(token)) return json({ left: 999 });
  const r = await rpc('ai_credits_left', token);
  if (r.status === 401 || r.status === 403) return json({ error: 'Googleでログインしてください' }, 401);
  if (!r.ok) return json({ error: '回数を確認できませんでした' }, 500);
  return json({ left: await r.json() });
}

function peopleLine(d) {
  if (!d.people.length || d.peopleStyle === 'none') return '';
  return `- 「わたしたち」 corner (small, about 15% of the page, near a side or bottom - NOT the center): the travelers from the "us" reference photos, shown ${PEOPLE[d.peopleStyle] || PEOPLE.cutout}. Every person in those photos appears once.`;
}

function buildPrompt(d) {
  const ar = d.size === 'story' ? '9:16' : '4:5';
  const n = d.spots.length;
  const info = [['行き先', d.place], ['いつ', d.date], ['だれと', d.who], ['行った場所', n + 'か所'], ['書いた人', d.by]].filter(([, v]) => v);
  const counts = AXES.map(([k, cs]) => `${k} ${d.spots.filter((p) => cs.includes(p.cat)).length}`).join(', ');
  const real = d.photo !== 'redraw';
  const spots = d.spots.map((p, i) => `     ${i + 1}. 「${p.name}」${p.text ? ` — note: 「${short(p.text, 34)}」` : ' — no note (write only the name, do not invent a note)'}${p.imgs.length ? (real ? ` (put its ${p.imgs.length > 1 ? `${p.imgs.length} reference photos` : 'reference photo'} itself here as real photographs)` : ' (draw it from its reference images)') : ''}`).join('\n');
  const photoRule = real
    ? 'Photos: put each place\'s reference photo into its card as an actual photograph. Keep it photographic and faithful to the original (same scene, colors and composition) - only crop it to fit the frame. Do NOT redraw those photos as illustrations.'
    : 'Photos: redraw each place\'s reference image as an illustration in the same art style, keeping what is in it recognizable.';
  const best = d.spots.slice(0, 3).map((p, i) => `${i + 1}位 「${p.name}」`).join(' / ');
  if (d.custom) {
    return [
      `Create ONE finished, high-quality vertical image (aspect ratio ${ar}) in Japanese for a travel record, following the user's design brief below.`,
      `User's design brief (written in Japanese; follow it carefully): 「${d.custom}」`,
      `Base art style if the brief does not say otherwise: ${STYLES[d.tpl]}.`,
      'Content to use where it fits the brief:',
      `- Title 「${d.title || '旅のトリセツ'}」${d.sub ? ` / subtitle 「${d.sub}」` : ''}`,
      d.cover ? `- The MAIN photo (scenery or food of the trip) should be the biggest image${real ? ', used as a real photograph' : ''}.` : '',
      peopleLine(d),
      `- Basic info: ${info.map(([k, v]) => `「${k}」「${v}」`).join(' / ')}`,
      `- Places visited (exactly ${n}, each once):\n${spots}`,
      n > 1 ? `- Ranking: ${best}` : '',
      `- Trip balance radar values: ${counts}`,
      d.words ? `- One-line comment: 「${d.words}」` : '',
      photoRule,
      'Text rules: write every Japanese text exactly as given inside 「」 (without the brackets), with correct characters, clearly legible. Do not invent other Japanese sentences. Never write words like "PHOTO", "reference" or any photo numbers. No logos, no brand names, no watermarks, no QR codes, no app UI. Nothing sexual, violent or hateful.',
      'Fill the whole canvas edge to edge with no white margin.',
    ].filter(Boolean).join('\n');
  }
  return [
    `Design ONE finished, high-quality vertical poster image (aspect ratio ${ar}) in Japanese: a "旅のトリセツ" (travel instruction manual) infographic, in the style of the hugely popular Japanese social-media "トリセツ" collage posters. Packed, lively and stylish, with a hand-made feel: many small hand-drawn illustrations, icons, doodles, stickers and decorations fill the space, yet every panel stays clean and readable.`,
    `Theme / art style: ${STYLES[d.tpl]}.`,
    d.prefs,
    'Layout:',
    `- Top: the big hand-lettered title 「${d.title || '旅のトリセツ'}」${d.sub ? ` with a smaller subtitle 「${d.sub}」` : ''}.`,
    d.cover
      ? `- Center (the main visual, about 35% of the page): the MAIN photo of the trip (a scene or food, like a travel guidebook), ${real ? 'used large as a real photograph - keep it photographic and faithful, only crop it' : 'redrawn large as a beautiful illustration'}, decorated with ${d.place ? `the destination name 「${d.place}」 and ` : ''}small travel doodles around it. Do not put a person large in the center.`
      : `- Center (the main visual, about 35% of the page): a big illustrated scenic view of ${d.place || 'the travel destination'} with its famous landmarks. Do not put a person large in the center.`,
    peopleLine(d),
    '- Around the hero, arrange labeled panels with hand-lettered headings and marker-highlight labels:',
    `  * 「基本情報」 panel with rows: ${info.map(([k, v]) => `「${k}」「${v}」`).join(' / ')}`,
    `  * 「行った場所」: exactly ${n} small framed photo cards, one for each place below and each place only once, with the place name and its short hand-written note:\n${spots}`,
    n > 1 ? `  * 「BEST 3」 ranking with gold crowns: ${best}` : '',
    `  * 「旅のバランス」 hexagon radar chart with axes グルメ, カフェ, 観光, 買物, 夜あそび, 癒し (relative values: ${counts})`,
    d.words ? `  * 「ひとこと」 speech bubble saying 「${d.words}」` : '',
    '  * cute hand-drawn icons of things from this trip (the foods, drinks, shops and sights above), plus travel doodles: airplane, suitcase, map pin, camera, stars, hearts, crowns.',
    photoRule,
    'Text rules: write every Japanese text exactly as given inside 「」 (without the brackets), with correct characters, clearly legible, in cute hand-written Japanese lettering. Do not invent other Japanese sentences. Short decorative English phrases such as "My Travel Manual" or "Good Trip!" are fine. Never write words like "PHOTO", "reference" or any photo numbers on the image. No logos, no brand names, no watermarks, no QR codes, no app UI.',
    'Fill the whole canvas edge to edge with no white margin.',
  ].filter(Boolean).join('\n');
}

function coverPrompt(d) {
  const ar = d.size === 'story' ? '9:16' : '4:5';
  return [
    `Design ONE finished, high-quality travel GUIDEBOOK COVER image (aspect ratio ${ar}) in Japanese, like the cover of a stylish Japanese travel magazine or guidebook made by the traveler themself.`,
    `Theme / art style: ${STYLES[d.tpl]}.`,
    d.prefs,
    d.custom ? `User's design brief (written in Japanese; follow it carefully): 「${d.custom}」` : '',
    `- A big, eye-catching hand-lettered title 「${d.title || '旅のガイドブック'}」${d.sub ? ` and a subtitle 「${d.sub}」` : ''}.`,
    '- A small decorative label "TRAVEL GUIDE BOOK".',
    d.author || d.date ? `- A small line at the bottom: 「${[d.author && 'by ' + d.author, d.date].filter(Boolean).join('　')}」` : '',
    d.cover
      ? `- Main visual (about half of the cover): the MAIN photo of the trip (a scene or food, like a real travel guidebook cover), ${d.photo !== 'redraw' ? 'used large as a real photograph - keep it photographic and faithful, only crop it' : 'redrawn large as a beautiful illustration'}. Do not put a person large in the center.`
      : `- Main visual (about half of the cover): a big illustrated scenic view of ${d.place || 'the travel destination'} with its famous landmarks.`,
    peopleLine(d),
    '- Decorate with cute hand-drawn travel icons and doodles (airplane, suitcase, map pin, camera, local foods, stars, hearts).',
    'Text rules: write every Japanese text exactly as given inside 「」 (without the brackets), with correct characters, clearly legible. Do not invent other Japanese text. Never write words like "PHOTO" or "reference". No logos, no brand names, no watermarks, no barcodes, no prices.',
    'Fill the whole canvas edge to edge with no white margin.',
  ].filter(Boolean).join('\n');
}

function editPrompt(d) {
  const area = d.box
    ? [
      'The user marked the part to change with a RED outline on the SECOND image (a marked copy of the same poster). '
      + `It is roughly the area from ${d.box.x0}% to ${d.box.x1}% of the width (from the left) and from ${d.box.y0}% to ${d.box.y1}% of the height (from the top).`,
      'Apply the change ONLY to that marked part. Edit the FIRST image (the clean one). The result must NOT contain any red outline or marking.',
    ]
    : [];
  return [
    'Edit the attached image (a finished Japanese travel poster).',
    `Apply ONLY this change requested by the user (written in Japanese): 「${d.instruction}」`,
    ...area,
    'Keep everything else the same: the layout, the illustrations, the people and every Japanese text exactly as it is, unless the requested change is about that part.',
    'All Japanese text must stay correct and clearly legible. Never add logos, brand names, watermarks, or words like "PHOTO". Nothing sexual, violent or hateful.',
    'Keep the same aspect ratio and fill the whole canvas edge to edge.',
  ].join('\n');
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'データが読めませんでした' }, 400); }

  // 入力チェック
  const tpl = STYLES[body.tpl] ? body.tpl : null;
  const size = body.size === 'story' ? 'story' : 'post';
  const isCover = body.kind === 'cover';
  const isEdit = body.kind === 'edit';
  if (isCover && !tpl) return json({ error: 'デザインをえらんでください' }, 400);
  if (isEdit) {
    const base = img(body.base, 3_500_000);
    const instruction = s(body.instruction, 300);
    if (!base || !instruction) return json({ error: '直したい内容を入れてください' }, 400);
    const mark = img(body.mark, 3_500_000);
    const b = body.box && typeof body.box === 'object' ? body.box : null;
    const n = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    const box = mark && b ? { x0: n(b.x0), y0: n(b.y0), x1: n(b.x1), y1: n(b.y1) } : null;
    const parts = [{ text: editPrompt({ instruction, box }) }, { text: 'FIRST image (clean, edit this one):' }, { inlineData: { mimeType: 'image/jpeg', data: base } }];
    if (box) parts.push({ text: 'SECOND image (marked copy - only shows where to edit):' }, { inlineData: { mimeType: 'image/jpeg', data: mark } });
    return run(req, parts, size);
  }
  const spotsIn = Array.isArray(body.spots) ? body.spots.slice(0, 6) : [];
  if (!isCover && (!tpl || !spotsIn.length)) return json({ error: 'お店とデザインをえらんでください' }, 400);
  const d = {
    tpl, size,
    title: s(body.title, 24), sub: s(body.sub, 12), place: s(body.place, 30), date: s(body.date, 24),
    who: s(body.who, 20), by: s(body.by, 20), words: s(body.words, 80), author: s(body.author, 30),
    prefs: prefText(body.prefs), custom: s(body.custom, 1200), photo: body.photo === 'redraw' ? 'redraw' : 'real',
    cover: img(body.cover),
    people: (Array.isArray(body.people) ? body.people : []).slice(0, 3).map((x) => img(x)).filter(Boolean),
    peopleStyle: ['cutout', 'likeness', 'chibi', 'none'].includes(body.peopleStyle) ? body.peopleStyle : 'cutout',
    spots: spotsIn.map((p) => ({
      name: s(p?.name, 40), cat: s(p?.cat, 20), text: s(p?.text, 200),
      imgs: (Array.isArray(p?.imgs) ? p.imgs : [p?.img]).slice(0, 2).map((x) => img(x)).filter(Boolean),
    })).filter((p) => p.name),
  };
  // 写真はAIに渡せる枚数に上限があるので、メイン→わたしたち→各お店の1枚目→2枚目の順に14枚まで
  let room = 14 - (d.cover ? 1 : 0) - (d.peopleStyle === 'none' ? 0 : d.people.length);
  if (d.peopleStyle === 'none') d.people = [];
  const firsts = d.spots.map((p) => p.imgs.slice(0, 1));
  const seconds = d.spots.map((p) => p.imgs.slice(1, 2));
  d.spots.forEach((p, i) => { p.imgs = []; if (room > 0 && firsts[i].length) { p.imgs.push(firsts[i][0]); room--; } });
  d.spots.forEach((p, i) => { if (room > 0 && seconds[i].length) { p.imgs.push(seconds[i][0]); room--; } });
  if (!isCover && !d.spots.length) return json({ error: 'お店をえらんでください' }, 400);

  const parts = [{ text: isCover ? coverPrompt(d) : buildPrompt(d) }];
  if (d.cover) parts.push({ text: 'MAIN photo of the trip (do not label it):' }, { inlineData: { mimeType: 'image/jpeg', data: d.cover } });
  d.people.forEach((x, i) => parts.push({ text: `"us" reference photo ${i + 1} - the travelers (do not label it):` }, { inlineData: { mimeType: 'image/jpeg', data: x } }));
  if (!isCover) d.spots.forEach((p) => p.imgs.forEach((x) => parts.push({ text: `Reference photo for the place 「${p.name}」 (do not label it):` }, { inlineData: { mimeType: 'image/jpeg', data: x } })));
  return run(req, parts, size);
}

// 回数を1つ使って絵を描く（1人1日3回まで。うまく描けなかったら回数を戻す）
async function run(req, parts, size) {
  if (isTest(req.headers.get('x-art-token'))) { const o = await gen(parts, size === 'story' ? '9:16' : '4:5'); return o.ok ? new Response(o.jpg, { headers: { 'content-type': 'image/jpeg' } }) : json({ error: o.error }, 502); }
  const token = bearer(req);
  if (!token) return json({ error: 'Googleでログインしてください' }, 401);
  if (await isUnlimited(token)) {
    const o = await gen(parts, size === 'story' ? '9:16' : '4:5');
    if (!o.ok) return json({ error: 'AIがうまく描けませんでした。もう一度試してください' }, 502);
    return new Response(o.jpg, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } });
  }
  const r = await rpc('use_ai_credit', token);
  if (r.status === 401 || r.status === 403) return json({ error: 'Googleでログインしてください' }, 401);
  if (!r.ok) return json({ error: '回数を確認できませんでした' }, 500);
  const ticket = await r.json();
  if (!ticket) return json({ error: '「AIで作る」は1日3回までです（直すときも1回に数えます）。また明日使ってください' }, 429);

  const out = await gen(parts, size === 'story' ? '9:16' : '4:5');
  if (!out.ok) {
    await rpc('refund_ai_credit', token, { ticket }).catch(() => {});
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
