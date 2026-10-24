'use client';
// eタビセツで使うフォント（Google Fonts から、使うときだけ読み込む）
export const FONTS = [
  { id: 'yomogi', label: '手書き', family: 'Yomogi', q: 'Yomogi' },
  { id: 'klee', label: 'ペン字', family: 'Klee One', q: 'Klee+One:wght@400;600' },
  { id: 'kurenaido', label: '筆ペン', family: 'Zen Kurenaido', q: 'Zen+Kurenaido' },
  { id: 'hachimaru', label: '丸文字', family: 'Hachi Maru Pop', q: 'Hachi+Maru+Pop' },
  { id: 'yusei', label: 'マジック', family: 'Yusei Magic', q: 'Yusei+Magic' },
  { id: 'maru', label: '丸ゴシック', family: 'Zen Maru Gothic', q: 'Zen+Maru+Gothic:wght@500;700' },
  { id: 'pop', label: 'ポップ', family: 'Mochiy Pop One', q: 'Mochiy+Pop+One' },
  { id: 'mincho', label: '明朝', family: 'Zen Old Mincho', q: 'Zen+Old+Mincho:wght@400;700' },
  { id: 'decol', label: 'デコ明朝', family: 'Kaisei Decol', q: 'Kaisei+Decol:wght@400;700' },
];
export const fontOf = (id) => FONTS.find((f) => f.id === id) || FONTS[0];

const cssText = new Map(); // id -> Promise<string>

// フォントのCSSを読み込んでページに入れる（画像にするときに中身を使うので、自分で取ってくる）
export function loadFont(id) {
  const f = fontOf(id);
  if (!cssText.has(f.id)) {
    const p = fetch(`https://fonts.googleapis.com/css2?family=${f.q}&display=swap`)
      .then((r) => (r.ok ? r.text() : ''))
      .then((t) => {
        if (t) {
          const st = document.createElement('style');
          st.dataset.noteFont = f.id;
          st.textContent = t;
          document.head.appendChild(st);
        }
        return t;
      })
      .catch(() => '');
    cssText.set(f.id, p);
  }
  return cssText.get(f.id);
}

// unicode-range に、文字が1つでも入っているか
function inRange(range, cps) {
  if (!range) return true;
  const parts = range.split(',').map((s) => s.trim().replace(/^U\+/i, ''));
  const spans = parts.map((p) => {
    if (p.includes('?')) return [parseInt(p.replace(/\?/g, '0'), 16), parseInt(p.replace(/\?/g, 'F'), 16)];
    const [a, b] = p.split('-');
    return [parseInt(a, 16), parseInt(b || a, 16)];
  });
  for (const c of cps) for (const [a, b] of spans) if (c >= a && c <= b) return true;
  return false;
}

const dataUrlCache = new Map();
function toDataUrl(url) {
  if (!dataUrlCache.has(url)) {
    dataUrlCache.set(url, fetch(url).then((r) => r.blob()).then((b) => new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(b);
    })));
  }
  return dataUrlCache.get(url);
}

// 画像にするための @font-face（eタビセツに出てくる文字の分だけ。通信量を小さくする）
export async function embedCss(id, text) {
  const f = fontOf(id);
  await loadFont(f.id);
  const css = await cssText.get(f.id);
  const cps = new Set([...text].map((ch) => ch.codePointAt(0)));
  try { await document.fonts.load(`16px "${f.family}"`, text); await document.fonts.load(`bold 16px "${f.family}"`, text); } catch {}
  const blocks = css.match(/@font-face\s*{[^}]*}/g) || [];
  const out = await Promise.all(blocks.map(async (b) => {
    const range = (b.match(/unicode-range:\s*([^;]+);/) || [])[1];
    if (!inRange(range, cps)) return '';
    const url = (b.match(/url\(([^)]+)\)/) || [])[1];
    if (!url) return '';
    try {
      const data = await toDataUrl(url.replace(/['"]/g, ''));
      return b.replace(/url\([^)]+\)/, `url(${data})`);
    } catch { return ''; }
  }));
  return out.filter(Boolean).join('\n');
}
