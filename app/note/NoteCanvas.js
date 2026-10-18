'use client';
// 1枚ノート（旅の取扱説明書）の見た目。幅1080pxで作って、そのまま画像にする
// テンプレートごとに並べ方から別のデザイン。背景の絵・ステッカーは public/note/ に用意してある
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
  lovely: { post: [92, 92, 84, 92], story: [110, 92, 104, 92] },
  water: { post: [124, 132, 112, 132], story: [150, 128, 146, 128] },
  sky: { post: [100, 70, 190, 70], story: [140, 70, 290, 70] },
  vintage: { post: [100, 100, 96, 100], story: [118, 100, 116, 100] },
  notebook: { post: [80, 76, 78, 128], story: [96, 76, 110, 128] },
  collage: { post: [124, 128, 120, 128], story: [150, 124, 146, 124] },
};

const st = (tpl, name) => `/note/${tpl}-${name}.png`;
const nm = (it) => it.altName || it.name;
const pad2 = (n) => String(n).padStart(2, '0');
function catSticker(c) {
  if (['朝食', '昼食', '夕食', '夜食', '朝市', '夜市', '酒場'].includes(c)) return 'food';
  if (['カフェ', 'おやつ'].includes(c)) return 'cafe';
  if (c === '買物') return 'shop';
  if (c === '観光') return 'camera';
  return 'pin';
}
function Ph({ src, className = '', style }) {
  return src ? <img className={'ph ' + className} src={src} alt="" style={style} /> : <div className={'ph ph-empty ' + className} style={style} />;
}
function Title({ note, tpl, className = '' }) {
  const t = note.title || '';
  return (
    <h1 className={'nt-title ' + className}>
      {tpl === 'collage'
        ? [...t].map((ch, i) => <span key={i} className={'nt-ch' + (ch === ' ' || ch === '　' ? ' sp' : '')}>{ch}</span>)
        : <span>{t}</span>}
    </h1>
  );
}
function Box({ tpl, icon, label, className = '', children }) {
  return (
    <div className={'bx ' + className}>
      <p className="bx-h">{icon && <img src={st(tpl, icon)} alt="" />}<span>{label}</span></p>
      {children}
    </div>
  );
}
function Info({ rows }) {
  return <dl className="info">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}
function Best({ list }) {
  return <ol className="best">{list.map((s, i) => <li key={s.it.id}><b>{i + 1}</b><span>{nm(s.it)}</span></li>)}</ol>;
}
function Logo({ note }) {
  return note.logo ? <img className="nt-logo" src="/logo.png" alt="Tabibi" /> : null;
}

// 旅のバランス（レーダーチャート）：行った場所のカテゴリーから
const AXES = [
  ['グルメ', ['朝食', '昼食', '夕食', '夜食', '朝市']],
  ['カフェ', ['カフェ', 'おやつ']],
  ['観光', ['観光']],
  ['買物', ['買物']],
  ['夜あそび', ['夜市', '酒場']],
  ['癒し', ['美容', 'マッサージ']],
];
function Radar({ spots, color, size = 300 }) {
  const v = AXES.map(([, cs]) => spots.filter((s) => cs.includes(s.it.category)).length);
  const mx = Math.max(1, ...v);
  const R = size * 0.3, c = size / 2;
  const pt = (i, r) => { const a = (Math.PI * 2 * i) / 6 - Math.PI / 2; return [c + Math.cos(a) * r, c + Math.sin(a) * r]; };
  const poly = (k) => AXES.map((_, i) => pt(i, R * k).join(',')).join(' ');
  return (
    <svg className="radar" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {[1, 0.66, 0.33].map((k) => <polygon key={k} points={poly(k)} fill="none" stroke="rgba(0,0,0,.18)" strokeWidth="2" />)}
      {AXES.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="rgba(0,0,0,.15)" strokeWidth="2" />; })}
      <polygon points={AXES.map((_, i) => pt(i, R * (0.12 + 0.88 * (v[i] / mx))).join(',')).join(' ')} fill={color} fillOpacity=".45" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      {AXES.map(([label], i) => { const [x, y] = pt(i, R + size * 0.1); return <text key={i} x={x} y={y + 8} textAnchor="middle" fontSize={size * 0.095} fill="currentColor">{label}</text>; })}
    </svg>
  );
}

// ---------- ラブリー：真ん中に丸い写真、まわりをピンクの枠でかこむ ----------
function Lovely({ note, tpl, spots, coverUrl, info, best, story }) {
  const Spot = (s, i) => (
    <Box key={s.it.id} tpl={tpl} icon={catSticker(s.it.category)} label={`${i + 1}. ${nm(s.it)}`} className="lv-spot">
      <div className="lv-row">
        <Ph src={s.urls[0]} className="lv-ph" />
        {s.text && <p className="lv-t">{s.text}</p>}
      </div>
    </Box>
  );
  const left = [];
  const right = [];
  spots.forEach((s, i) => (i % 2 ? right : left).push(Spot(s, i)));
  const words = note.words ? <Box key="w" tpl={tpl} icon="talk" label="ひとこと" className="lv-words"><p className="lv-t">{note.words}</p></Box> : null;
  if (words) (right.length < left.length ? right : left).push(words);
  const center = [
    <div key="ph" className="lv-photo"><Ph src={coverUrl} /><img className="lv-cam" src={st(tpl, 'camera')} alt="" /></div>,
    <Box key="info" tpl={tpl} icon="suitcase" label="基本情報" className="lv-info"><Info rows={info} /></Box>,
  ];
  if (best.length > 1) center.push(<Box key="best" tpl={tpl} icon="crown" label="BEST 3" className="lv-best"><Best list={best} /></Box>);
  const two = !right.length;
  return (
    <>
      <header className="lv-head">{note.sub && <p className="nt-sub"><span>{note.sub}</span></p>}<Title note={note} tpl={tpl} /></header>
      <div className={'lv-body' + (two ? ' two' : '')}>
        <div className="lv-col">{left}</div>
        <div className="lv-col lv-center">{center}</div>
        {!two && <div className="lv-col">{right}</div>}
      </div>
      <footer className="nt-foot"><Logo note={note} /></footer>
    </>
  );
}

// ---------- 水彩フラワー：番号つきの見出し（01〜07）で上品に ----------
function Water({ note, tpl, spots, coverUrl, info, story, H }) {
  const n = Math.max(1, spots.length);
  const avail = H - (story ? 560 : 470);
  const per = avail / n;
  const phs = Math.round(Math.max(76, Math.min(story ? 330 : 250, per - 62)));
  const lines = Math.max(2, Math.floor(phs / (story ? 36 : 31)));
  return (
    <>
      <header className="wt-head">
        {note.sub && <p className="wt-sub">{note.sub}</p>}
        <Title note={note} tpl={tpl} />
        <p className="wt-orn"><i /><b>❦</b><i /></p>
      </header>
      <div className="wt-body">
        <div className="wt-left">
          <div className="wt-arch"><Ph src={coverUrl} /></div>
          <section className="wt-sec">
            <div className="wt-sh"><span className="wt-no">01</span><h2>基本スペック</h2></div>
            <Info rows={info} />
          </section>
          {note.words && <p className="wt-words">{note.words}</p>}
        </div>
        <div className="wt-right">
          {spots.map((s, i) => (
            <section key={s.it.id} className="wt-sec wt-spot">
              <div className="wt-sh"><span className="wt-no">{pad2(i + 2)}</span><h2>{nm(s.it)}</h2>{s.it.category && <em>{s.it.category}</em>}</div>
              <div className="wt-row">
                <Ph src={s.urls[0]} style={{ width: phs, height: phs }} />
                {s.text && <p className="wt-t" style={{ WebkitLineClamp: lines }}>{s.text}</p>}
              </div>
            </section>
          ))}
        </div>
      </div>
      <footer className="nt-foot"><Logo note={note} /></footer>
    </>
  );
}

// ---------- 青空：写真が主役のタイル ----------
function Sky({ note, tpl, spots, coverUrl, info }) {
  const n = Math.min(6, Math.max(1, spots.length));
  const areas = 'abcdef';
  const chips = info.filter(([k]) => k !== '行った場所');
  return (
    <>
      <header className="sk-head">
        {coverUrl && <Ph src={coverUrl} className="sk-cov" />}
        <div className="sk-ht">
          {note.sub && <p className="sk-sub">{note.sub}</p>}
          <Title note={note} tpl={tpl} />
          {chips.length > 0 && <p className="sk-chips">{chips.map(([k, v]) => <span key={k}><b>{k}</b>{v}</span>)}</p>}
        </div>
      </header>
      <div className={'sk-grid n' + n}>
        {spots.map((s, i) => (
          <figure key={s.it.id} className={'sk-tile' + (i === 0 ? ' hero' : '')} style={{ gridArea: areas[i] }}>
            <div className="sk-pw">
              <Ph src={s.urls[0]} />
              {i < 3 && n > 1 && <span className={'sk-medal m' + (i + 1)}>{i + 1}</span>}
              <img className="sk-st" src={st(tpl, catSticker(s.it.category))} alt="" />
            </div>
            <figcaption><b>{nm(s.it)}</b>{s.text && <span>{s.text}</span>}</figcaption>
          </figure>
        ))}
      </div>
      <footer className="nt-foot sk-foot">
        {note.words ? <p className="sk-words"><img src={st(tpl, 'talk')} alt="" /><span>{note.words}</span></p> : <span />}
        <Logo note={note} />
      </footer>
    </>
  );
}

// ---------- ヴィンテージ：行った場所ごとに縦の列 ----------
function Vintage({ note, tpl, spots, coverUrl, info, best }) {
  const n = Math.max(1, spots.length);
  const cols = n <= 3 ? n : n === 4 ? 2 : 3;
  const meta = info.filter(([k]) => ['行き先', 'いつ', 'だれと'].includes(k)).map(([, v]) => v);
  if (note.by) meta.push('by ' + note.by);
  return (
    <>
      <header className="vt-head">
        {note.sub && <p className="vt-sub">{note.sub}</p>}
        <Title note={note} tpl={tpl} />
        {meta.length > 0 && <p className="vt-meta">{meta.join('　·　')}</p>}
      </header>
      <div className="vt-cols" style={{ '--c': cols, '--r': Math.ceil(n / cols) }}>
        {spots.map((s, i) => (
          <article key={s.it.id} className="vt-col">
            <Ph src={s.urls[0]} className="vt-ph" />
            <p className="vt-no">No.{i + 1}</p>
            <h2 className="vt-name">{nm(s.it)}</h2>
            {s.it.category && <p className="vt-cat">{s.it.category}</p>}
            {s.text && <p className="vt-t">{s.text}</p>}
          </article>
        ))}
      </div>
      {(coverUrl || best.length > 1 || note.words) && <div className="vt-bottom">
        {coverUrl && <Ph src={coverUrl} className="vt-cov" />}
        {best.length > 1 && <Box tpl={tpl} icon="crown" label="お気に入り" className="vt-box"><Best list={best} /></Box>}
        {note.words && <Box tpl={tpl} icon="talk" label="ひとこと" className="vt-box"><p className="vt-w">{note.words}</p></Box>}
      </div>}
      <footer className="nt-foot"><Logo note={note} /></footer>
    </>
  );
}

// ---------- ノート：写真をテープで貼った日記 ----------
function Notebook({ note, tpl, spots, coverUrl, info, best }) {
  const pics = [coverUrl, ...spots.map((s) => s.urls[0])].filter((u, i, a) => u && a.indexOf(u) === i).slice(0, 4);
  const k = pics.length;
  const h = k <= 1 ? 100 : Math.min(100, (100 / k) * 1.45);
  const meta = info.filter(([kk]) => ['いつ', '行き先', 'だれと'].includes(kk)).map(([, v]) => v);
  return (
    <>
      <header className="nb-head">
        {meta.length > 0 && <p className="nb-date">{meta.join(' ／ ')}</p>}
        <Title note={note} tpl={tpl} />
        {note.sub && <p className="nb-sub">{note.sub}</p>}
      </header>
      <div className="nb-body">
        {k > 0 && (
          <div className="nb-pics">
            {pics.map((u, i) => (
              <div key={i} className="nb-pol" style={{
                top: (k === 1 ? 0 : (i * (100 - h)) / (k - 1)) + '%', height: h + '%',
                left: i % 2 ? '14%' : '0%', transform: `rotate(${i % 2 ? 3 : -4}deg)`,
              }}>
                <i className="nb-tape" />
                <Ph src={u} />
              </div>
            ))}
          </div>
        )}
        <div className="nb-list">
          <p className="nb-lh"><img src={st(tpl, 'pin')} alt="" />行ったところ</p>
          {spots.map((s) => (
            <div key={s.it.id} className="nb-item">
              <p className="nb-name"><svg viewBox="0 0 40 40" aria-hidden="true"><rect x="4" y="6" width="28" height="28" rx="4" fill="#fff" stroke="#333" strokeWidth="3" /><path d="M10 20 L18 28 L36 6" fill="none" stroke="#E5484D" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></svg><span>{nm(s.it)}</span></p>
              {s.text && <p className="nb-t">{s.text}</p>}
            </div>
          ))}
        </div>
      </div>
      <div className={'nb-bottom' + (best.length > 1 || note.words ? '' : ' slim')}>
        {best.length > 1 && (
          <div className="nb-sticky"><p className="nb-sh"><img src={st(tpl, 'crown')} alt="" />BEST 3</p><Best list={best} /></div>
        )}
        {note.words && <div className="nb-bubble"><img src={st(tpl, 'talk')} alt="" /><p>{note.words}</p></div>}
        <div className="nb-logo">{note.by && <span>by {note.by}</span>}<Logo note={note} /></div>
      </div>
    </>
  );
}

// ---------- コラージュ：大きな写真のまわりに好きなものを散らす ----------
function Collage({ note, tpl, spots, coverUrl, info, best }) {
  const n = Math.max(1, spots.length);
  const cap = info.filter(([k]) => ['行き先', 'いつ', 'だれと'].includes(k)).map(([, v]) => v).join(' ・ ');
  return (
    <>
      <header className="cl-head">{note.sub && <p className="cl-sub"><span>{note.sub}</span></p>}<Title note={note} tpl={tpl} /></header>
      <div className="cl-top">
        <div className="cl-big"><Ph src={coverUrl} /><p className="cl-cap">{cap}</p><i className="cl-tape" /></div>
        <div className="cl-side">
          {best.length > 1 && <Box tpl={tpl} icon="crown" label="ランキング" className="cl-card cl-rank"><Best list={best} /></Box>}
          <Box tpl={tpl} icon="pin" label="旅のバランス" className="cl-card cl-radar"><Radar spots={spots} color="#FF6B6B" /></Box>
        </div>
      </div>
      <div className="cl-spots" style={{ '--c': n <= 3 ? n : 3, '--r': n <= 3 ? 1 : 2 }}>
        {spots.map((s, i) => (
          <article key={s.it.id} className="cl-pol" style={{ transform: `rotate(${[-3, 2.5, -1.5, 3, -2.5, 1.5][i]}deg)` }}>
            <Ph src={s.urls[0]} />
            <h2>{nm(s.it)}</h2>
            {s.text && <p>{s.text}</p>}
            <img className="cl-st" src={st(tpl, catSticker(s.it.category))} alt="" />
          </article>
        ))}
      </div>
      <footer className="nt-foot">
        {note.words ? <p className="cl-words"><img src={st(tpl, 'talk')} alt="" /><span>{note.words}</span></p> : <span />}
        <Logo note={note} />
      </footer>
    </>
  );
}

const LAYOUTS = { lovely: Lovely, water: Water, sky: Sky, vintage: Vintage, notebook: Notebook, collage: Collage };

export default function NoteCanvas({ note, spots, coverUrl, nodeRef, place }) {
  const size = sizeOf(note.size);
  const story = size.id === 'story';
  const tpl = LAYOUTS[note.tpl] ? note.tpl : 'lovely';
  const f = fontOf(note.font);
  const [pt, pr, pb, pl] = PAD[tpl][size.id];
  const tl = [...(note.title || '')].length;
  const tfs = tl <= 6 ? 88 : tl <= 9 ? 76 : tl <= 12 ? 62 : 50;
  const info = [
    ['行き先', place], ['いつ', note.date], ['だれと', note.who],
    ['行った場所', spots.length ? `${spots.length}か所` : ''], ['書いた人', note.by],
  ].filter(([, v]) => v);
  const best = spots.slice(0, 3);
  const L = LAYOUTS[tpl];
  return (
    <div ref={nodeRef} className={`nt ${tpl} ${story ? 'story' : 'post'}`} style={{
      width: size.w, height: size.h, padding: `${pt}px ${pr}px ${pb}px ${pl}px`,
      backgroundImage: `url(/note/${tpl}-${size.id}.jpg)`,
      fontFamily: `"${f.family}", "Zen Maru Gothic", sans-serif`, '--tfs': tfs + 'px',
    }}>
      <L note={note} tpl={tpl} spots={spots} coverUrl={coverUrl} info={info} best={best} story={story} H={size.h} />
    </div>
  );
}
