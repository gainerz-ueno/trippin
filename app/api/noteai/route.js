// 「AIで作る」eタビセツ：写真と文字をまとめて画像AI（Gemini）に渡し、1枚の絵として描かせる
// ・Googleでログインしている人だけ。1人1日3回まで（回数はSupabaseで数える。失敗したら回数を戻す）
import sharp from 'sharp';
import { SUPABASE_URL, SUPABASE_KEY } from '../../lib/supabase-public';
import { gfetch, MOCK } from '../../lib/gfetch';
const GKEY = () => process.env.GEMINI_API_KEY || (MOCK ? 'mock' : '');

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
// AIで作るときの「雰囲気」（スキル：インスタのトリセツ／ファッション雑誌 から）
// layout: torisetsu＝トリセツ型（主役＋見出しつきの枠がたくさん）／ magazine＝ファッション雑誌型（大きな英字の題字＋大きな写真）
const TASTES = {
  yumekawa: { layout: 'torisetsu', style: 'yume-kawaii pastel pink: white to pale-pink background with tiny polka dots, pink + a little mint/light-blue, rounded bubbly pink title lettering with a thick white outline, hearts, ribbons, sparkles, paw-like cute stamps, soft colored-pencil doodles', heading: 'each panel heading is white text on a rounded pink color band with a small heart icon' },
  watercolor: { layout: 'torisetsu', style: 'airy watercolor natural: white watercolor paper with loose watercolor flower wreaths (roses, lavender, eucalyptus) in the corners, navy / lavender / sage green, a navy handwritten English script plus a bold navy Japanese title, small watercolor landscape illustrations of the destination', heading: 'each panel heading is navy text with a small watercolor flower and a thin underline' },
  otona: { layout: 'torisetsu', style: 'grown-up muted elegance: ivory / greige background, dusty pink, lavender and sage, elegant Japanese Mincho (serif) title with an English calligraphy line "Travel Manual", white roses, antique books, a vintage camera and coffee cup as small still-life decorations, generous calm spacing', heading: 'numbered headings 01, 02, 03 ... in small dusty-colored circles followed by Mincho text, with checkbox bullet lists' },
  techo: { layout: 'torisetsu', style: 'planner / notebook journal: warm beige grid notebook paper, brown ink and soft pastel highlighter marks, handwritten lettering, polaroid photos held by washi tape and paper clips, sticky notes, small doodle arrows, a cozy hand-made feel', heading: 'each panel heading is handwritten with a pastel highlighter stroke behind it' },
  pop: { layout: 'torisetsu', style: 'pop magazine collage: white background with photo collage, black + hot pink + gold, a HUGE extra-bold black brush-lettered title where one key word is hot pink, gold crowns, stars, palm trees, signposts, bold English handwriting like "Good Trip!", energetic and stylish', heading: 'each panel heading is bold black brush lettering with a pink marker underline and a small gold crown or star' },
  genki: { layout: 'torisetsu', style: 'cheerful colorful: bright blue sky and flower field background, blue / red / yellow / green, a chunky pop title with a thick dark outline on a wooden sign board, a round "保存版" badge in the top-left corner, lots of hearts and paw-like stamps, white rounded panels', heading: 'each panel heading has a colorful round icon on the left and bold colored text' },
  chic: { layout: 'magazine', style: 'simple & chic Japanese women\'s magazine (30s): clean white background, generous white space, one accent color (dusty terracotta), refined Mincho headlines with tight letter spacing, an elegant high-contrast serif English masthead with an italic line, square-cornered photos, almost no decorations', heading: '' },
  mode: { layout: 'magazine', style: 'high-fashion mode magazine: black and white with ONE strong accent color (red), a huge bold high-contrast serif English masthead, dramatic full-bleed cropping of the main photo, bold minimal typography, no cute decorations at all', heading: '' },
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
  ['グルメ', ['朝食', '昼食', '夕食', '夜食', '朝市', '夜市', '屋台']],
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
  // テスト用モード：回数の数え方だけ、にせ物で動かす（1日3回）
  if (MOCK) return mockRpc(fn, token);
  // つながらないときは「回数を確認できませんでした」として扱う（落ちないように）
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  }).catch(() => new Response('{}', { status: 503 }));
}
const mockUses = new Map();
function mockRpc(fn, token) {
  const ok = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
  if (token !== 'mock-token') return new Response('{}', { status: 401 });
  const n = mockUses.get(token) || 0;
  if (fn === 'ai_credits_left') return ok(Math.max(0, 3 - n));
  if (fn === 'use_ai_credit') { if (n >= 3) return ok(null); mockUses.set(token, n + 1); return ok('t' + (n + 1)); }
  if (fn === 'refund_ai_credit') { mockUses.set(token, Math.max(0, n - 1)); return ok(true); }
  return new Response('{}', { status: 404 });
}
const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').slice(0, 4000);

// 今日あと何回使えるか
// 運営者のアカウントは回数の制限なし（動作確認のため）。ログインしているアカウントをSupabaseで確かめる
const UNLIMITED = new Set(['be07854d-c007-4404-85cd-fddc9867e5ff']);
async function isUnlimited(token) {
  if (MOCK) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
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
  return `- 「わたしたち」 corner (small, about 15% of the page, near a side or bottom - NOT the center): the travelers from the "us" reference photos, shown ${PEOPLE[d.peopleStyle] || PEOPLE.cutout}. Show exactly the people in those photos (${d.people.length} photo${d.people.length > 1 ? 's' : ''}), each person once - do NOT add any other person who is not in those photos.`;
}

// トリセツ型（スキル：insta-torisetsu-design）
function torisetsuPrompt(d, t, info, spots, counts, best, photoRule) {
  const n = d.spots.length;
  return [
    `Design ONE finished, high-quality vertical image (aspect ratio ${d.size === 'story' ? '9:16' : '4:5'}) in Japanese: a travel "トリセツ" (取扱説明書 / instruction manual) infographic exactly like the trendy Japanese Instagram トリセツ posters - packed, lively and stylish, every panel clean and readable.`,
    `Taste / art direction (follow it strictly, use ONE taste only): ${t.style}.`,
    d.prefs,
    'Layout, from top to bottom:',
    `- Title: big lettering 「${d.title || '旅のトリセツ'}」 using about 70% of the width, near the top center. ${d.sub ? `Under it, a ribbon or band with the subtitle 「${d.sub}」. ` : ''}Add a small English script line "My Travel Manual".`,
    d.cover
      ? `- Main visual (about 35% of the page, center): the MAIN photo of the trip (a scene or food, like a travel guidebook)${d.photo !== 'redraw' ? ', used as a real photograph - keep it photographic and faithful, only crop it' : ', redrawn as an illustration'}, as a cut-out with a white sticker border or inside a soft rounded / arch frame. Do not put a person large in the center.`
      : `- Main visual (about 35% of the page, center): a big illustration of ${d.place || 'the destination'} and its famous sights. Do not put a person large in the center.`,
    `- Around the main visual: 6 to 9 panels arranged in 2-3 columns. ${t.heading}. Use the SAME heading style for every panel. Inside panels use short bullet lines (checkbox / heart bullets), each line short.`,
    `  * 「基本情報」 panel: ${info.map(([k, v]) => `「${k}」「${v}」`).join(' / ')}`,
    `  * 「行った場所」: exactly ${n} cards (one per place, each once), each with its photo on top and the place name + short hand-written note under it:\n${spots}`,
    n > 1 ? `  * 「BEST 3」 ranking with crowns and big numbers: ${best}` : '',
    `  * 「旅のバランス」 hexagon radar chart, axes グルメ, カフェ, 観光, 買物, 夜あそび, 癒し with these exact numbers written at each axis: ${counts}`,
    peopleLine(d) ? '  ' + peopleLine(d).replace(/^- /, '* ') : '',
    d.words ? `  * a speech bubble near the main visual saying 「${d.words}」` : '',
    `- Bottom: a closing band${d.words ? '' : ' with a short English phrase like "Good Trip!"'}.`,
    '- Fill small gaps with tiny hand-drawn decorations of this trip (its foods, drinks, sights) and travel doodles (airplane, map pin, camera, stars, hearts) - no empty holes, but never cover text.',
    '- Keep important text away from the outer 8% edge (Instagram crops the grid view).',
    photoRule,
  ];
}

// ファッション雑誌型（スキル：fashion-magazine-layout）
function magazinePrompt(d, t, info, spots, counts, best, photoRule) {
  const n = d.spots.length;
  return [
    `Design ONE finished, high-quality vertical image (aspect ratio ${d.size === 'story' ? '9:16' : '4:5'}) in Japanese that looks like a stylish Japanese fashion-magazine special feature page about a trip.`,
    `Taste / art direction (follow it strictly): ${t.style}.`,
    d.prefs,
    'Layout:',
    `- Masthead: the destination name ${d.place ? `(「${d.place}」) ` : ''}written in English capital letters, very large across the full width of the top - the single biggest text on the page. Small issue text near it: "TRAVEL ISSUE" and the date${d.date ? ` 「${d.date}」` : ''}.`,
    d.cover
      ? `- Main photo: the MAIN photo of the trip (a scene or food) about two thirds of the page, slightly off-center, ${d.photo !== 'redraw' ? 'used as a real photograph, faithful, only cropped (bold magazine cropping is welcome)' : 'redrawn as a refined illustration'}; let the top of the photo subject slightly overlap the masthead letters for depth. Do not put a person large in the center.`
      : `- Main photo: a beautiful photographic view of ${d.place || 'the destination'} about two thirds of the page, slightly off-center, overlapping the masthead slightly.`,
    `- Cover lines (3 levels): the main feature line 「${d.title || '旅の記録'}」 large${d.sub ? ` with 「${d.sub}」 under it` : ''}; then short small lines on the left and right of the photo: ${info.map(([k, v]) => `「${k}」「${v}」`).join(' / ')}${n > 1 ? ` and the ranking ${best}` : ''}.`,
    `- A strip of exactly ${n} small square-cornered photos (one per place, each once) numbered ①②③..., with a tiny caption for each number (place name + short note):\n${spots}`,
    `- A small, simple, elegant hexagon chart 「旅のバランス」 with axes グルメ, カフェ, 観光, 買物, 夜あそび, 癒し and these exact numbers: ${counts}.`,
    peopleLine(d),
    d.words ? `- A short quote in the magazine style: 「${d.words}」` : '',
    '- One small round badge with 「保存版」.',
    '- Use at most 2 typefaces and 2-3 text colors. Very few decorations (no cute stickers). Plenty of rhythm between big and small type.',
    '- Do NOT use any real magazine name, logo, barcode or price.',
    photoRule,
  ];
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
      `Base art style if the brief does not say otherwise: ${TASTES[d.taste]?.style || STYLES[d.tpl]}.`,
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
  const t = TASTES[d.taste];
  if (t) {
    return [...(t.layout === 'magazine' ? magazinePrompt : torisetsuPrompt)(d, t, info, spots, counts, best, photoRule),
      'Text rules: write every Japanese text exactly as given inside 「」 (without the brackets), with correct characters, clearly legible. Do not invent other Japanese sentences. Never write words like "PHOTO", "reference" or any photo numbers. No real brand logos, no watermarks, no QR codes, no app UI. Nothing sexual, violent or hateful.',
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
    `- A big, eye-catching hand-lettered title 「${d.title || '旅のeガイドブック'}」${d.sub ? ` and a subtitle 「${d.sub}」` : ''}.`,
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
  return [
    'Edit the attached image (a finished Japanese travel poster).',
    `The user wants this change (written in Japanese): 「${d.instruction}」`,
    'Make the change clearly and visibly - the user must be able to see the difference at a glance. Returning the image unchanged is a failure.',
    'Keep everything that is not part of the requested change the same: the layout, the illustrations, the people and every Japanese text exactly as it is.',
    'All Japanese text must stay correct and clearly legible. Never add logos, brand names, watermarks, or words like "PHOTO". Nothing sexual, violent or hateful.',
    'Keep the same aspect ratio and fill the whole canvas edge to edge.',
  ].join('\n');
}

// 囲んだ場所だけを切り出して、そこだけAIに直してもらう
function areaPrompt(d) {
  return [
    'The FIRST image is a cut-out part of a finished Japanese travel poster. Edit this part.',
    `The user wants this change (written in Japanese): 「${d.instruction}」`,
    d.concrete ? `What exactly to do: ${d.concrete}` : '',
    d.retry ? 'IMPORTANT: a previous attempt returned the image without the change. This time the change MUST be clearly visible.' : '',
    'The SECOND image is the same part with a RED outline drawn by the user around the thing to change. The change is about what is inside the red outline.',
    'Make the change clearly and visibly - the user must be able to see the difference at a glance. Returning the image unchanged is a failure.',
    'If the user asks to make something bigger, enlarge it a lot (about 1.5 times) and move or shrink the things next to it to make room. If they ask to remove something, fill the space naturally with the background.',
    'Only along the very outer border of the image (a thin strip) keep the background the same, because this part will be pasted back into the poster. Inside, you may move, resize and redraw freely to make the change.',
    'The result must NOT contain any red outline or marking. All Japanese text must stay correct and clearly legible. No logos, watermarks or words like "PHOTO".',
    'Keep the same aspect ratio and fill the whole canvas edge to edge.',
  ].join('\n');
}

// 「〜が低い」のようなあいまいな言い方を、AIが確実に直せる具体的な指示に言いかえる（安いテキスト用AIで）
const TEXT_MODEL = 'gemini-2.5-flash';
async function understand(instruction, markedB64) {
  try {
    const r = await gfetch(`${GEMINI}/${TEXT_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': GKEY(), 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: [
            'This is part of a Japanese travel poster. The user drew a RED outline around the thing they want changed, and wrote this request in Japanese:',
            `「${instruction}」`,
            'Look at what is inside the red outline and rewrite the request as ONE clear, concrete image-edit instruction in English that says exactly what to change and what it should become (exact numbers, words, colors, sizes, shapes).',
            'If the request is a complaint (for example "X is low", "X is too small", "this is wrong"), turn it into the fix (raise X to a clearly higher value, make it bigger, correct it). If a chart value must change, also say how the chart shape must change to match.',
            'Write any Japanese text that must appear on the image inside 「」 exactly.',
            'Reply in exactly two lines:',
            'EN: <the instruction in English>',
            'JA: <what you will do, in short natural Japanese, under 30 characters>',
          ].join('\n') },
          { inlineData: { mimeType: 'image/jpeg', data: markedB64 } },
        ] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }, 20000);
    const d = await r.json();
    const t = (d.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
    const en = (t.match(/EN:\s*(.+)/) || [])[1]?.trim();
    const ja = (t.match(/JA:\s*(.+)/) || [])[1]?.trim();
    return en ? { en: en.slice(0, 500), ja: (ja || '').slice(0, 60) } : null;
  } catch { return null; }
}

// 直す前と後がほとんど同じかどうか
async function sameish(a, b, w, h) {
  const g = (x) => sharp(x, x.length === w * h * 3 ? { raw: { width: w, height: h, channels: 3 } } : undefined).resize(48, Math.max(8, Math.round(48 * h / w)), { fit: 'fill' }).greyscale().raw().toBuffer();
  const [p, q] = await Promise.all([g(a), g(b)]);
  let sum = 0; for (let i = 0; i < p.length; i++) sum += Math.abs(p[i] - q[i]);
  return sum / p.length;
}

const RATIOS = [['1:1', 1], ['4:5', 0.8], ['3:4', 0.75], ['2:3', 2 / 3], ['9:16', 0.5625], ['5:4', 1.25], ['4:3', 4 / 3], ['3:2', 1.5], ['16:9', 16 / 9]];
async function editArea(base, mark, box, instruction) {
  const bb = Buffer.from(base, 'base64');
  const { width: W, height: H } = await sharp(bb).metadata();
  // 囲んだ範囲のまわりに少し余白をとり、AIが描ける縦横比に合わせる
  let x0 = (box.x0 / 100) * W, x1 = (box.x1 / 100) * W, y0 = (box.y0 / 100) * H, y1 = (box.y1 / 100) * H;
  const m = 0.12 * Math.min(W, H);
  x0 -= m; x1 += m; y0 -= m; y1 += m;
  let w = Math.max(x1 - x0, W * 0.4), h = Math.max(y1 - y0, W * 0.4);
  const r = w / h;
  const [ar, rv] = RATIOS.reduce((a, b) => (Math.abs(Math.log(b[1] / r)) < Math.abs(Math.log(a[1] / r)) ? b : a));
  if (w / h < rv) w = h * rv; else h = w / rv;
  if (w > W) { w = W; h = Math.min(H, w / rv); }
  if (h > H) { h = H; w = Math.min(W, h * rv); }
  w = Math.round(w); h = Math.round(h);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const left = Math.round(Math.max(0, Math.min(W - w, cx - w / 2)));
  const top = Math.round(Math.max(0, Math.min(H - h, cy - h / 2)));
  const cut = (buf) => sharp(buf).resize(W, H, { fit: 'fill' }).extract({ left, top, width: w, height: h }).jpeg({ quality: 92 }).toBuffer();
  const [c1, c2] = await Promise.all([cut(bb), cut(Buffer.from(mark, 'base64'))]);
  const u = await understand(instruction, c2.toString('base64'));
  const orig = await sharp(c1).removeAlpha().raw().toBuffer();
  let fixed = null, diff = 0;
  for (let t = 0; t < 2; t++) {
    const parts = [{ text: areaPrompt({ instruction, concrete: u?.en, retry: t > 0 }) },
      { text: 'FIRST image (the part to edit):' }, { inlineData: { mimeType: 'image/jpeg', data: c1.toString('base64') } },
      { text: 'SECOND image (same part, red outline shows what to change):' }, { inlineData: { mimeType: 'image/jpeg', data: c2.toString('base64') } }];
    const o = await gen(parts, ar, true);
    if (!o.ok) { if (fixed) break; return o; }
    fixed = await sharp(o.raw).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    diff = await sameish(fixed, orig, w, h);
    console.log('noteai edit', JSON.stringify({ instruction, en: u?.en, try: t, diff: Math.round(diff * 10) / 10 }));
    if (diff >= 3) break; // ちゃんと変わっていればOK。ほとんど同じなら1回だけやり直す
  }
  // 直した部分を元の絵に、ふちをなじませて貼りもどす
  const f = Math.max(6, Math.round(Math.min(w, h) * 0.06));
  // AIが全体の色味を少し変えてしまうことがあるので、ふちの色に合わせて戻す
  for (let ch = 0; ch < 3; ch++) {
    let sa = 0, sb = 0, qa = 0, qb = 0, n = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      if (Math.min(x, y, w - 1 - x, h - 1 - y) > f * 2) continue;
      const i = (y * w + x) * 3 + ch; const a = fixed[i], b = orig[i];
      sa += a; sb += b; qa += a * a; qb += b * b; n++;
    }
    const ma = sa / n, mb = sb / n, da = Math.sqrt(Math.max(1, qa / n - ma * ma)), db = Math.sqrt(Math.max(1, qb / n - mb * mb));
    const k = Math.max(0.7, Math.min(1.4, db / da));
    for (let i = ch; i < fixed.length; i += 3) fixed[i] = Math.max(0, Math.min(255, Math.round((fixed[i] - ma) * k + mb)));
  }
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = Math.min(left > 0 ? x : f, top > 0 ? y : f, left + w < W ? w - 1 - x : f, top + h < H ? h - 1 - y : f);
      const a = Math.max(0, Math.min(1, e / f));
      const i = (y * w + x), j = i * 3, k = i * 4;
      px[k] = fixed[j]; px[k + 1] = fixed[j + 1]; px[k + 2] = fixed[j + 2]; px[k + 3] = Math.round(a * 255);
    }
  }
  const patch = await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  const jpg = await sharp(bb).composite([{ input: patch, left, top }]).resize({ width: 1440, withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  return { ok: true, jpg, ja: u?.ja || '', en: u?.en || '', diff };
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
    if (box) return run(req, () => editArea(base, mark, box, instruction));
    const parts = [{ text: editPrompt({ instruction }) }, { inlineData: { mimeType: 'image/jpeg', data: base } }];
    return run(req, () => gen(parts, size === 'story' ? '9:16' : '4:5'));
  }
  const spotsIn = Array.isArray(body.spots) ? body.spots.slice(0, 6) : [];
  if (!isCover && (!tpl || !spotsIn.length)) return json({ error: 'お店とデザインをえらんでください' }, 400);
  const d = {
    tpl, size, taste: TASTES[body.taste] ? body.taste : null,
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
  return run(req, () => gen(parts, size === 'story' ? '9:16' : '4:5'));
}

// 回数を1つ使って絵を描く（1人1日3回まで。うまく描けなかったら回数を戻す）
async function run(req, job) {
  if (!GKEY()) return json({ error: '「AIで作る」の設定がまだ終わっていません（運営者の設定待ち）' }, 500);
  const make = async () => { try { return await job(); } catch (e) { console.error('noteai', e); return { ok: false, error: String(e?.message || e) }; } };
  const token = bearer(req);
  if (!token) return json({ error: 'Googleでログインしてください' }, 401);
  if (await isUnlimited(token)) {
    const o = await make();
    if (!o.ok) return json({ error: 'AIがうまく描けませんでした。もう一度試してください' }, 502);
    return new Response(o.jpg, { headers: imgHeaders(o) });
  }
  const r = await rpc('use_ai_credit', token);
  if (r.status === 401 || r.status === 403) return json({ error: 'Googleでログインしてください' }, 401);
  if (!r.ok) return json({ error: '回数を確認できませんでした' }, 500);
  const ticket = await r.json();
  if (!ticket) return json({ error: '「AIで作る」は1日3回までです（直すときも1回に数えます）。また明日使ってください' }, 429);

  const out = await make();
  if (!out.ok) {
    await rpc('refund_ai_credit', token, { ticket }).catch(() => {});
    return json({ error: 'AIがうまく描けませんでした。もう一度試してください（回数は減っていません）' }, 502);
  }
  return new Response(out.jpg, { headers: imgHeaders(out) });
}
function imgHeaders(o) {
  const h = { 'content-type': 'image/jpeg', 'cache-control': 'no-store' };
  if (o.ja) h['x-fix-ja'] = encodeURIComponent(o.ja);
  return h;
}

async function gen(parts, aspect, rawOut) {
  try {
    const r = await gfetch(`${GEMINI}/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': GKEY(), 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect, imageSize: '2K' } } }),
    }, 100000);
    const d = await r.json().catch(() => ({}));
    const part = d.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) return { ok: false, error: d.error?.message || d.candidates?.[0]?.finishReason || 'no image' };
    if (rawOut) return { ok: true, raw: Buffer.from(part.inlineData.data, 'base64') };
    // 画面で扱いやすい大きさ（幅1440px）のJPEGにする
    const jpg = await sharp(Buffer.from(part.inlineData.data, 'base64')).resize({ width: 1440, withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    return { ok: true, jpg };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
