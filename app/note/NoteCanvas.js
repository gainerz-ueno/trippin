'use client';
// 1枚ノートの見た目（テンプレート6種）。幅1080pxで作って、そのまま画像にする
import { fontOf } from './fonts';

export const TEMPLATES = [
  { id: 'lovely', label: 'ラブリー', font: 'hachimaru' },
  { id: 'water', label: '水彩フラワー', font: 'klee' },
  { id: 'sky', label: '青空', font: 'maru' },
  { id: 'vintage', label: 'ヴィンテージ', font: 'mincho' },
  { id: 'notebook', label: 'ノート', font: 'yomogi' },
  { id: 'collage', label: 'コラージュ', font: 'yusei' },
];
export const SIZES = [
  { id: 'post', label: '投稿用（4:5）', w: 1080, h: 1350 },
  { id: 'story', label: 'ストーリー用（9:16）', w: 1080, h: 1920 },
];
export const sizeOf = (id) => SIZES.find((s) => s.id === id) || SIZES[0];

// ---- 飾り（自前の図形） ----
function rnd(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
function Flower({ x, y, r, n = 5, c, cc = '#FFF2A8', rot = 0, op = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} opacity={op}>
      {Array.from({ length: n }, (_, i) => (
        <ellipse key={i} cx="0" cy={-r * 0.52} rx={r * 0.4} ry={r * 0.56} fill={c} transform={`rotate(${(i * 360) / n})`} />
      ))}
      <circle r={r * 0.26} fill={cc} />
    </g>
  );
}
function Heart({ x, y, s, c, rot = 0, op = 1 }) {
  return <path transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`} opacity={op} fill={c}
    d="M0 0.38 C-0.95 -0.22 -0.5 -1 0 -0.5 C0.5 -1 0.95 -0.22 0 0.38Z" />;
}
function Star({ x, y, r, c, rot = 0, op = 1, inner = 0.45 }) {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * inner : r;
    return `${(Math.cos(a) * rr).toFixed(1)},${(Math.sin(a) * rr).toFixed(1)}`;
  }).join(' ');
  return <polygon transform={`translate(${x} ${y}) rotate(${rot})`} points={pts} fill={c} opacity={op} />;
}
function Sparkle({ x, y, r, c }) {
  return <path transform={`translate(${x} ${y})`} fill={c} d={`M0 ${-r} Q${r * 0.15} ${-r * 0.15} ${r} 0 Q${r * 0.15} ${r * 0.15} 0 ${r} Q${-r * 0.15} ${r * 0.15} ${-r} 0 Q${-r * 0.15} ${-r * 0.15} 0 ${-r}Z`} />;
}
function Leaf({ x, y, l, c, rot }) {
  return <path transform={`translate(${x} ${y}) rotate(${rot})`} fill={c} d={`M0 0 Q${l * 0.35} ${-l * 0.5} 0 ${-l} Q${-l * 0.35} ${-l * 0.5} 0 0Z`} />;
}
function Sprig({ x, y, s, rot, c }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      <path d="M0 0 Q20 -60 10 -130" stroke={c} strokeWidth="3" fill="none" />
      {[[3, -25, -50], [8, -45, 45], [12, -70, -45], [13, -92, 40], [11, -115, -30]].map(([lx, ly, r], i) => <Leaf key={i} x={lx} y={ly} l={34} c={c} rot={r} />)}
    </g>
  );
}
function Cluster({ x, y, s, colors }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <Leaf x={-10} y={10} l={70} c="#9CC59A" rot={-120} />
      <Leaf x={10} y={10} l={64} c="#B5D6A7" rot={110} />
      <Leaf x={0} y={0} l={60} c="#8DBB8C" rot={200} />
      <Flower x={0} y={0} r={46} c={colors[0]} cc="#FFE7A3" />
      <Flower x={52} y={-26} r={30} c={colors[1]} cc="#FFF4C9" rot={20} />
      <Flower x={-44} y={-34} r={26} c={colors[2]} cc="#FFF4C9" rot={-15} />
      <circle cx="36" cy="34" r="7" fill={colors[1]} />
      <circle cx="-30" cy="30" r="5" fill={colors[0]} />
    </g>
  );
}

function Deco({ tpl, w, h, front }) {
  const r = rnd(tpl.length * 977 + h);
  const items = [];
  if (tpl === 'lovely' && !front) {
    const cols = ['#FF9CBB', '#FFC2D4', '#FF6F9C', '#FFB0C8'];
    for (let i = 0; i < 16; i++) {
      const side = i % 4;
      const x = side === 0 ? r() * 60 + 10 : side === 1 ? w - 10 - r() * 60 : r() * w;
      const y = side === 2 ? r() * 50 + 10 : side === 3 ? h - 10 - r() * 50 : r() * h;
      items.push(<Heart key={'h' + i} x={x} y={y} s={18 + r() * 26} c={cols[i % 4]} rot={-25 + r() * 50} />);
    }
    for (let i = 0; i < 8; i++) items.push(<Sparkle key={'s' + i} x={r() * w} y={i % 2 ? r() * 60 + 8 : h - r() * 60 - 8} r={10 + r() * 10} c="#FFFFFF" />);
  }
  if (tpl === 'water' && front) {
    const pal = [['#F4A6B8', '#F9C8A0', '#C9B5EC'], ['#F7B7A3', '#F4A6B8', '#F9DC8C'], ['#C9B5EC', '#F4A6B8', '#F9C8A0'], ['#F9C8A0', '#C9B5EC', '#F4A6B8']];
    items.push(<Cluster key="c1" x={34} y={40} s={0.95} colors={pal[0]} />);
    items.push(<Cluster key="c2" x={w - 40} y={46} s={0.8} colors={pal[1]} />);
    items.push(<Cluster key="c3" x={w - 34} y={h - 34} s={1} colors={pal[2]} />);
    items.push(<Cluster key="c4" x={40} y={h - 40} s={0.75} colors={pal[3]} />);
  }
  if (tpl === 'sky') {
    if (!front) {
      [[140, 70, 1], [w - 200, 110, 0.8], [w / 2 + 60, 40, 0.6]].forEach(([x, y, s], i) => items.push(
        <g key={'cl' + i} transform={`translate(${x} ${y}) scale(${s})`} fill="#FFFFFF" opacity=".9">
          <circle cx="0" cy="0" r="40" /><circle cx="45" cy="-15" r="50" /><circle cx="95" cy="5" r="38" /><rect x="0" y="0" width="95" height="40" />
        </g>));
    } else {
      for (let i = 0; i < 40; i++) {
        const x = (i / 40) * w + r() * 30;
        const y = h - 8 - r() * 40;
        items.push(<Flower key={'f' + i} x={x} y={y} r={14 + r() * 12} c={r() > 0.3 ? '#7FB8F0' : '#A9D2FA'} cc="#FFFFFF" rot={r() * 70} />);
      }
      for (let i = 0; i < 7; i++) items.push(<Flower key={'t' + i} x={w - 20 - r() * 110} y={20 + r() * 100} r={12 + r() * 10} c="#7FB8F0" cc="#FFFFFF" rot={r() * 70} />);
    }
  }
  if (tpl === 'vintage') {
    if (!front) {
      items.push(<rect key="f1" x="30" y="30" width={w - 60} height={h - 60} fill="none" stroke="#9C7C55" strokeWidth="3" />);
      items.push(<rect key="f2" x="42" y="42" width={w - 84} height={h - 84} fill="none" stroke="#9C7C55" strokeWidth="1.5" />);
    } else {
      items.push(<Sprig key="s1" x={70} y={190} s={0.9} rot={-20} c="#8A9A5B" />);
      items.push(<Sprig key="s2" x={w - 70} y={190} s={0.9} rot={20} c="#8A9A5B" />);
      items.push(<Flower key="r1" x={64} y={70} r={18} c="#C9A0A6" cc="#E8D3B0" />);
      items.push(<Flower key="r2" x={w - 64} y={70} r={18} c="#C9A0A6" cc="#E8D3B0" />);
    }
  }
  if (tpl === 'notebook' && !front) {
    for (let y = 60; y < h; y += 110) items.push(<circle key={'ho' + y} cx="44" cy={y} r="13" fill="#E9E4D8" stroke="#D6CFBF" strokeWidth="2" />);
    for (let i = 0; i < 6; i++) items.push(<Star key={'st' + i} x={w - 40 - r() * 30} y={80 + r() * (h - 160)} r={12 + r() * 8} c="#FFD84D" rot={r() * 40} />);
  }
  if (tpl === 'collage') {
    if (!front) {
      for (let i = 0; i < 5; i++) {
        const x = r() * w; const y = r() * h;
        items.push(<rect key={'tp' + i} x={x} y={y} width="160" height="40" fill="rgba(255,255,255,.35)" transform={`rotate(${-30 + r() * 60} ${x} ${y})`} />);
      }
    } else {
      [[40, 40, '#FFD400'], [w - 44, 60, '#FF6B6B'], [w - 50, h - 50, '#4ECDC4'], [46, h - 60, '#FFD400']].forEach(([x, y, c], i) => items.push(
        <g key={'sk' + i}><Star x={x} y={y} r={34} c="#FFFFFF" rot={i * 12} inner={0.5} /><Star x={x} y={y} r={26} c={c} rot={i * 12} inner={0.5} /></g>));
    }
  }
  if (!items.length) return null;
  return <svg className={'nt-deco' + (front ? ' front' : '')} viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">{items}</svg>;
}

function NumMark({ tpl, n }) {
  const label = tpl === 'vintage' || tpl === 'notebook' ? String(n).padStart(2, '0') : String(n);
  if (tpl === 'lovely') {
    return (
      <span className="nt-num shape">
        <svg viewBox="-1 -1.05 2 1.5" aria-hidden="true"><path fill="#FF5C8D" d="M0 0.38 C-0.95 -0.22 -0.5 -1 0 -0.5 C0.5 -1 0.95 -0.22 0 0.38Z" /></svg>
        <b>{label}</b>
      </span>
    );
  }
  if (tpl === 'sky') {
    return (
      <span className="nt-num shape">
        <svg viewBox="-50 -50 100 100" aria-hidden="true"><Flower x={0} y={0} r={48} c="#5AAEE6" cc="#5AAEE6" /></svg>
        <b>{label}</b>
      </span>
    );
  }
  return <span className="nt-num"><b>{label}</b></span>;
}

// 写真がないときの飾り
function NoPhoto({ tpl }) {
  const m = {
    lovely: <Heart x={0} y={8} s={46} c="#FFB3C9" />,
    water: <Flower x={0} y={0} r={36} c="#F4A6B8" cc="#FFE7A3" />,
    sky: <Flower x={0} y={0} r={36} c="#7FB8F0" cc="#FFFFFF" />,
    vintage: <Flower x={0} y={0} r={34} c="#C9A0A6" cc="#E8D3B0" />,
    notebook: <Star x={0} y={2} r={38} c="#FFD84D" />,
    collage: <Star x={0} y={2} r={38} c="#FF6B6B" inner={0.5} />,
  };
  return <svg viewBox="-120 -80 240 160" aria-hidden="true">{m[tpl]}</svg>;
}

// レイアウト（お店の数とサイズで決める）
function layout(n, story) {
  const cols = n <= 3 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  const horiz = cols === 1 && n >= 2 && !(story && n === 2);
  let fs, fn, lines;
  if (n === 1) { fs = 36; fn = 50; lines = story ? 9 : 6; }
  else if (horiz) { fs = n === 2 ? 32 : 28; fn = n === 2 ? 42 : 36; lines = n === 2 ? (story ? 10 : 7) : (story ? 8 : 5); }
  else if (cols === 1) { fs = 32; fn = 42; lines = 4; }
  else if (rows === 2) { fs = 27; fn = 34; lines = story ? 6 : 4; }
  else { fs = 25; fn = 31; lines = story ? 5 : 3; }
  return { cols, rows, horiz, fs, fn, lines };
}

export default function NoteCanvas({ note, spots, coverUrl, nodeRef, className = '' }) {
  const size = sizeOf(note.size);
  const story = size.id === 'story';
  const tpl = note.tpl;
  const f = fontOf(note.font);
  const n = Math.max(1, spots.length);
  const L = layout(n, story);
  const title = note.title || '';
  const tl = [...title].length;
  const tfs = tl <= 7 ? 96 : tl <= 10 ? 82 : tl <= 14 ? 66 : 54;
  const head = story ? 300 : 210;
  const vars = {
    width: size.w, height: size.h, fontFamily: `"${f.family}", "Zen Maru Gothic", sans-serif`,
    '--cols': L.cols, '--rows': L.rows, '--fs': L.fs + 'px', '--fn': L.fn + 'px', '--lines': L.lines,
    '--tfs': tfs + 'px', '--head': head + 'px', '--cov': (coverUrl ? (story ? 260 : 190) : 0) + 'px',
  };
  const titleNode = tpl === 'collage'
    ? [...title].map((ch, i) => <span key={i} className={'nt-ch' + (ch === ' ' || ch === '　' ? ' sp' : '')}>{ch}</span>)
    : <span>{title}</span>;

  return (
    <div ref={nodeRef} className={`nt ${tpl} ${className}`} style={vars}>
      <Deco tpl={tpl} w={size.w} h={size.h} />
      <header className="nt-head">
        {coverUrl && <img className="nt-cover" src={coverUrl} alt="" />}
        <div className="nt-htxt">
          {note.sub && <p className="nt-sub"><span>{note.sub}</span></p>}
          <h1 className="nt-title">{titleNode}</h1>
          {(note.date || note.by) && (
            <p className="nt-meta">{note.date && <span>{note.date}</span>}{note.by && <span>by {note.by}</span>}</p>
          )}
        </div>
      </header>
      <section className="nt-grid">
        {spots.map((s, i) => {
          const span = L.cols === 2 && spots.length % 2 === 1 && i === spots.length - 1;
          const h = L.horiz || span;
          const ph = s.urls.slice(0, 2);
          const name = s.it.altName || s.it.name;
          return (
            <article key={s.it.id} className={'nt-card' + (h ? ' h' : '') + (span ? ' span2' : '')}>
              <div className="nt-top">
                <NumMark tpl={tpl} n={i + 1} />
                <div className="nt-nm">
                  <h2 className="nt-name">{name}</h2>
                  {(s.it.category || s.it.rec) && (
                    <p className="nt-tags">
                      {s.it.category && <span className="nt-cat">{s.it.category}</span>}
                      {s.it.rec && <span className="nt-rec">おすすめ</span>}
                    </p>
                  )}
                </div>
              </div>
              {ph.length > 0 ? (
                <div className={'nt-ph k' + ph.length}>
                  {(tpl === 'notebook' || tpl === 'collage') && <i className="nt-tape" />}
                  {ph.map((u, j) => <img key={j} src={u} alt="" />)}
                </div>
              ) : (
                <div className="nt-ph none"><NoPhoto tpl={tpl} /></div>
              )}
              {s.text && <p className="nt-text">{s.text}</p>}
            </article>
          );
        })}
      </section>
      {(note.words || note.logo) && (
        <footer className="nt-foot">
          {note.words ? <p className="nt-words">{note.words}</p> : <span />}
          {note.logo && <img className="nt-logo" src="/logo.png" alt="Tabibi" />}
        </footer>
      )}
      <Deco tpl={tpl} w={size.w} h={size.h} front />
    </div>
  );
}
