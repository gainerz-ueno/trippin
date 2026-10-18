'use client';
// 1枚ノート（旅の取扱説明書）の見た目。幅1080pxで作って、そのまま画像にする
// 背景の絵・ステッカーは public/note/ に用意してある（テンプレートごと）
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

// 絵のふちにかからないよう、中身を置く範囲（上 右 下 左）
const PAD = {
  lovely: { post: [92, 96, 88, 96], story: [110, 96, 110, 96] },
  water: { post: [128, 138, 118, 138], story: [150, 132, 150, 132] },
  sky: { post: [116, 72, 210, 72], story: [150, 72, 300, 72] },
  vintage: { post: [104, 104, 104, 104], story: [120, 104, 120, 104] },
  notebook: { post: [84, 80, 84, 132], story: [100, 80, 120, 132] },
  collage: { post: [128, 138, 128, 138], story: [150, 132, 150, 132] },
};

const st = (tpl, name) => `/note/${tpl}-${name}.png`;
function catSticker(c) {
  if (['朝食', '昼食', '夕食', '夜食', '朝市', '夜市', '酒場'].includes(c)) return 'food';
  if (['カフェ', 'おやつ'].includes(c)) return 'cafe';
  if (c === '買物') return 'shop';
  if (c === '観光') return 'camera';
  return 'pin';
}

function BoxHead({ tpl, icon, children }) {
  return (
    <p className="nt-bh">
      <img className="nt-bh-ic" src={st(tpl, icon)} alt="" />
      <span>{children}</span>
    </p>
  );
}

// お店の数とサイズで、下の「行った場所」の並べ方を決める
function grid(n, story) {
  if (n <= 3) return { cols: n, rows: 1, fs: n === 1 ? 30 : 26, fn: n === 1 ? 36 : 30, lines: story ? 5 : (n === 1 ? 4 : 3) };
  if (n === 4) return { cols: 2, rows: 2, fs: 23, fn: 27, lines: story ? 3 : 2 };
  return story ? { cols: 2, rows: 3, fs: 23, fn: 27, lines: 2 } : { cols: 3, rows: 2, fs: 21, fn: 24, lines: 2 };
}

export default function NoteCanvas({ note, spots, coverUrl, nodeRef, place }) {
  const size = sizeOf(note.size);
  const story = size.id === 'story';
  const tpl = note.tpl;
  const f = fontOf(note.font);
  const n = Math.max(1, spots.length);
  const G = grid(n, story);
  const [pt, pr, pb, pl] = (PAD[tpl] || PAD.lovely)[size.id];
  const title = note.title || '';
  const tl = [...title].length;
  const tfs = tl <= 6 ? 92 : tl <= 9 ? 80 : tl <= 12 ? 64 : 52;
  const mid = story ? 430 : ({ sky: 262, water: 280 }[tpl] || 300);
  const vars = {
    width: size.w, height: size.h, padding: `${pt}px ${pr}px ${pb}px ${pl}px`,
    backgroundImage: `url(/note/${tpl}-${size.id}.jpg)`,
    fontFamily: `"${f.family}", "Zen Maru Gothic", sans-serif`,
    '--cols': G.cols, '--rows': G.rows, '--fs': G.fs + 'px', '--fn': G.fn + 'px', '--lines': G.lines,
    '--tfs': tfs + 'px', '--mid': mid + 'px',
  };
  const titleNode = tpl === 'collage'
    ? [...title].map((ch, i) => <span key={i} className={'nt-ch' + (ch === ' ' || ch === '　' ? ' sp' : '')}>{ch}</span>)
    : <span>{title}</span>;
  const info = [
    ['行き先', place],
    ['いつ', note.date],
    ['だれと', note.who],
    ['行った場所', spots.length ? `${spots.length}か所` : ''],
  ].filter(([, v]) => v);
  const best = spots.slice(0, 3);

  return (
    <div ref={nodeRef} className={`nt ${tpl} ${story ? 'story' : 'post'}`} style={vars}>
      <header className="nt-head">
        {note.sub && (
          <p className="nt-sub"><span>{note.sub}</span></p>
        )}
        <h1 className="nt-title">{titleNode}</h1>
      </header>

      <section className="nt-mid">
        <div className="nt-box nt-info">
          <BoxHead tpl={tpl} icon="suitcase">基本情報</BoxHead>
          <dl>
            {info.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
            {note.by && <div><dt>書いた人</dt><dd>{note.by}</dd></div>}
          </dl>
        </div>
        <div className="nt-cov">
          {coverUrl ? <img className="nt-cov-img" src={coverUrl} alt="" /> : <div className="nt-cov-img empty" />}
          <img className="nt-cov-st" src={st(tpl, 'camera')} alt="" />
        </div>
        <div className="nt-box nt-rank">
          <BoxHead tpl={tpl} icon="crown">BEST 3</BoxHead>
          <ol>
            {best.map((s, i) => (
              <li key={s.it.id}><b>{i + 1}</b><span>{s.it.altName || s.it.name}</span></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="nt-box nt-spots">
        <BoxHead tpl={tpl} icon="pin">行った場所</BoxHead>
        <div className="nt-grid">
          {spots.map((s, i) => {
            const ph = s.urls.slice(0, 2);
            return (
              <article key={s.it.id} className="nt-card">
                <div className={'nt-ph k' + ph.length}>
                  {ph.length ? ph.map((u, j) => <img key={j} src={u} alt="" />) : <div className="nt-ph-empty" />}
                  <span className="nt-num">{i + 1}</span>
                  <img className="nt-cat-st" src={st(tpl, catSticker(s.it.category))} alt="" />
                </div>
                <h2 className="nt-name">{s.it.altName || s.it.name}</h2>
                {s.text && <p className="nt-text">{s.text}</p>}
              </article>
            );
          })}
        </div>
      </section>

      {(note.words || note.logo) && (
        <footer className="nt-foot">
          {note.words ? (
            <div className="nt-words">
              <img src={st(tpl, 'talk')} alt="" />
              <p>{note.words}</p>
            </div>
          ) : <span />}
          {note.logo && <img className="nt-logo" src="/logo.png" alt="Tabibi" />}
        </footer>
      )}
    </div>
  );
}
