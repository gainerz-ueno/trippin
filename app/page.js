'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NaverLinks, inKorea } from './naver';
import { CatIcon, CAT_SEARCH, IcSearch, IcBookmark, IcCheckCircle, IcCheck, IcPin, IcPen, IcHotel, IcPlane, IcUser, IcDown, IcRight, IcMore } from './icons';
import dynamic from 'next/dynamic';
import MapView from './MapView';
// eタビセツ（開いたときだけ読み込む）
const NoteMaker = dynamic(() => import('./note/NoteMaker'), { ssr: false });
const GuideMaker = dynamic(() => import('./note/GuideMaker'), { ssr: false });
const NoteShelf = dynamic(() => import('./note/NoteShelf'), { ssr: false });
import { safeUrl } from './lib/safeurl';
import { api, jaError, mapsLink } from './lib/api';
import { addPhotos, listPhotos, deletePhoto, deletePhotosOf } from './photos';
import { supa, setUser as setCloudUser, signIn, signOut, pullItems, upsertItems, deleteItems, pullSettings, pushSettings, pullPhotoRows, ensurePhotos, uploadMissingPhotos, mergeItems, getShare, createShare, deleteShare, renameShare } from './cloud';

const KEY = 'trippin.v1';

const COUNTRY_LIST = [
  ['TW', '台湾'], ['KR', '韓国'], ['HK', '香港'], ['CN', '中国'], ['VN', 'ベトナム'],
  ['TH', 'タイ'], ['SG', 'シンガポール'], ['MY', 'マレーシア'], ['PH', 'フィリピン'], ['JP', '日本'],
];
// 基本カテゴリー（色は地図のピンにも使う）
const BASE_CATS = [
  ['観光', '#2F7D6B'], ['朝市', '#C9822B'], ['夜市', '#5B4BA8'], ['朝食', '#E0A526'], ['昼食', '#D9692E'],
  ['夕食', '#B8432F'], ['夜食', '#3F4F86'], ['おやつ', '#D45C8C'], ['カフェ', '#8A5A3C'], ['酒場', '#8E2F4F'],
  ['買物', '#2E7FB8'], ['美容', '#C2569E'], ['マッサージ', '#4E9A5B'],
];
const CUSTOM_COLOR = '#6B7A8C';
const CATS_KEY = 'trippin.cats';
const catColor = (c) => (BASE_CATS.find(([n]) => n === c) || [, CUSTOM_COLOR])[1];

// カテゴリーを選ぶ（＋ 新しいカテゴリー）
function CategoryPicker({ customCats, current, onPick, onAddCustom, onClose, title }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const boxRef = useRef(null);
  useEffect(() => { boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, []);
  const all = [...BASE_CATS.map(([n]) => n), ...customCats];
  function submitNew(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (!all.includes(n)) onAddCustom(n);
    onPick(n);
  }
  return (
    <div className="picker" ref={boxRef}>
      <div className="picker-head">
        <b>{title}</b>
        <button type="button" className="x" onClick={onClose} aria-label="閉じる">×</button>
      </div>
      <div className="cat-chips">
        {all.map((c) => (
          <button type="button" key={c} className={'cat' + (c === current ? ' sel' : '')} style={{ '--c': catColor(c) }} onClick={() => onPick(c)}>{c}</button>
        ))}
        <button type="button" className={'cat none' + (!current ? ' sel' : '')} onClick={() => onPick('')}>なし</button>
        {!adding && <button type="button" className="cat add-cat" onClick={() => setAdding(true)}>＋ 新しいカテゴリー</button>}
      </div>
      {adding && (
        <form className="new-cat" onSubmit={submitNew}>
          <input id="newcat" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例：屋台" maxLength={12} />
          <button className="btn" type="submit">作って選ぶ</button>
        </form>
      )}
    </div>
  );
}

// 「候補に追加」の下に出るカテゴリーのプルダウン
function CategoryDropdown({ customCats, onPick, onAddCustom, onClose }) {
  const ref = useRef(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const all = [...BASE_CATS.map(([n]) => n), ...customCats];
  useEffect(() => {
    const out = (e) => { const box = ref.current?.parentElement; if (box && !box.contains(e.target)) onClose(); };
    document.addEventListener('pointerdown', out);
    return () => document.removeEventListener('pointerdown', out);
  }, [onClose]);
  return (
    <div className="dropdown" ref={ref} role="menu">
      <p className="dd-title">カテゴリーを選んで追加</p>
      <ul>
        {all.map((c) => (
          <li key={c}><button type="button" role="menuitem" onClick={() => onPick(c)}><i style={{ background: catColor(c) }} />{c}</button></li>
        ))}
        <li><button type="button" role="menuitem" className="dd-none" onClick={() => onPick('')}>なし</button></li>
        <li>
          {adding ? (
            <form className="dd-new" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (!n) return; if (!all.includes(n)) onAddCustom(n); onPick(n); }}>
              <input id="ddnew" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="新しいカテゴリー" maxLength={12} />
              <button className="btn" type="submit">追加</button>
            </form>
          ) : (
            <button type="button" role="menuitem" className="dd-add" onClick={() => setAdding(true)}>＋ 新しいカテゴリー</button>
          )}
        </li>
      </ul>
    </div>
  );
}

// フォルダ（旅行ごとに自分で名前を付けて分ける）
const UNSORTED = '未分類';

// フォルダの共有（リンクを作る・コピー・やめる）
function SharePanel({ folder, user }) {
  const [id, setId] = useState(undefined); // undefined=調べ中 / null=共有していない
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!user) return;
    let alive = true;
    setId(undefined);
    getShare(folder).then((x) => alive && setId(x)).catch(() => alive && setId(null));
    return () => { alive = false; };
  }, [folder, user]);
  if (!user) return <p className="hint">共有するには、右上の「Googleでログイン」からログインしてください。</p>;
  if (id === undefined) return <p className="hint">読み込み中…</p>;
  const url = id ? `${window.location.origin}/s/${id}` : '';
  async function run(fn) { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(jaError(e, '共有の設定を変えられませんでした。もう一度試してください')); } setBusy(false); }
  return (
    <div className="share-panel">
      {id ? (
        <>
          <p className="hint">このリンクを知っている人は、「{folder}」のお店を見られます（見るだけ。メモは見えません）。</p>
          <div className="line share-line"><p className="share-url">{url}</p><CopyBtn text={url} label="共有リンク" /></div>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => run(async () => { await deleteShare(folder); setId(null); })}>共有をやめる</button>
        </>
      ) : (
        <>
          <p className="hint">リンクを作ると、そのリンクを知っている人が「{folder}」のお店を見られます（見るだけ。メモは見えません）。</p>
          <button type="button" className="btn" disabled={busy} onClick={() => run(async () => setId(await createShare(folder)))}>共有リンクを作る</button>
        </>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

function FolderBar({ folders, current, counts, totals = {}, onSelect, onCreate, onRename, onDelete, user }) {
  const [mode, setMode] = useState(null); // 'new' / 'edit' / 'share'
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(false);
  function submitNew(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    onCreate(n); setName(''); setMode(null);
  }
  function submitRename(e) {
    e.preventDefault();
    const n = name.trim();
    if (n && n !== current) onRename(current, n);
    setMode(null);
  }
  return (
    <div className="folderbar">
      <div className="fb-row">
        <span className="fb-label">フォルダ</span>
        <div className="fb-chips">
          {folders.map((f) => (
            <button type="button" key={f} aria-pressed={f === current} onClick={() => { onSelect(f); setMode(null); }}>
              {f}<span className="fb-count">{counts[f] || 0}</span>
            </button>
          ))}
          <button type="button" className="fb-new" onClick={() => { setMode(mode === 'new' ? null : 'new'); setName(''); }}>＋ 新しいフォルダ</button>
        </div>
      </div>
      {current && current !== UNSORTED && mode !== 'new' && (
        <div className="fb-links">
          <button type="button" className="fb-edit" onClick={() => setMode(mode === 'share' ? null : 'share')}>「{current}」を共有</button>
          <button type="button" className="fb-edit" onClick={() => { setMode(mode === 'edit' ? null : 'edit'); setName(current); setConfirm(false); }}>「{current}」の名前の変更・削除</button>
        </div>
      )}
      {mode === 'share' && current !== UNSORTED && <SharePanel folder={current} user={user} />}
      {mode === 'new' && (
        <form className="new-cat" onSubmit={submitNew}>
          <input id="newfolder" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例：台湾 2026年3月" maxLength={30} />
          <button className="btn" type="submit">作る</button>
        </form>
      )}
      {mode === 'edit' && (
        confirm ? (
          <div className="confirm">「{current}」とその中のお店{totals[current] || 0}件（候補と行ったの両方）を削除しますか？
            <button className="btn" type="button" onClick={() => { onDelete(current); setConfirm(false); setMode(null); }}>削除する</button>
            <button className="btn ghost" type="button" onClick={() => setConfirm(false)}>やめる</button>
          </div>
        ) : (
          <form className="new-cat" onSubmit={submitRename}>
            <input id="renfolder" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
            <button className="btn" type="submit">名前を保存</button>
            <button className="btn ghost" type="button" onClick={() => setConfirm(true)}>削除</button>
          </form>
        )
      )}
    </div>
  );
}

// 自分で作ったカテゴリーの名前変更・削除
function CustomCatEditor({ customCats, onRename, onDelete }) {
  const [editing, setEditing] = useState(null);
  const [val, setVal] = useState('');
  const [confirm, setConfirm] = useState(null);
  if (!customCats.length) return <p className="hint">自分で作ったカテゴリーはまだありません。「候補に追加」やカテゴリーの変更のときに「＋ 新しいカテゴリー」から作れます。</p>;
  return (
    <ul className="cat-edit">
      {customCats.map((c) => (
        <li key={c}>
          {editing === c ? (
            <form onSubmit={(e) => { e.preventDefault(); const v = val.trim(); if (v && v !== c) onRename(c, v); setEditing(null); }}>
              <input id={'ren-' + c} autoFocus value={val} onChange={(e) => setVal(e.target.value)} maxLength={12} />
              <button className="btn" type="submit">保存</button>
              <button className="btn ghost" type="button" onClick={() => setEditing(null)}>やめる</button>
            </form>
          ) : confirm === c ? (
            <div className="confirm">「{c}」を削除しますか？（このカテゴリーのお店は「なし」になります）
              <button className="btn" type="button" onClick={() => { onDelete(c); setConfirm(null); }}>削除する</button>
              <button className="btn ghost" type="button" onClick={() => setConfirm(null)}>やめる</button>
            </div>
          ) : (
            <>
              <span className="cat sel" style={{ '--c': CUSTOM_COLOR }}>{c}</span>
              <span className="cat-edit-acts">
                <button type="button" onClick={() => { setEditing(c); setVal(c); }}>名前を変える</button>
                <button type="button" className="del" onClick={() => setConfirm(c)}>削除</button>
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}


function sourceLabel(u) {
  if (!u) return null;
  if (/youtube\.com|youtu\.be/.test(u)) return 'YouTube';
  if (/instagram\.com/.test(u)) return 'インスタ';
  if (/google\.[^/]+\/maps|maps\.app\.goo\.gl/.test(u)) return 'Googleマップ';
  return 'Web';
}

function photoSrc(name) {
  return name ? `/api/photo?name=${encodeURIComponent(name)}` : null;
}

// タップでコピー（Grab・Uber の行き先に貼る用）
function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement('textarea');
      t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch {}
      t.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  }
  return (
    <button type="button" className={'copy' + (done ? ' ok' : '')} onClick={copy} aria-label={label + 'をコピー'}>
      {done ? 'コピーしました' : 'コピー'}
    </button>
  );
}

// 現地の店名・住所（コピー付き）と、日本語の表記
function NameBlock({ p, withAddress = true }) {
  const [openName, setOpenName] = useState(false);
  const [openAddr, setOpenAddr] = useState(false);
  return (
    <div className="nb">
      <div className="line">
        <p className={'name' + (openName ? ' full' : '')} onClick={() => setOpenName((v) => !v)} title="押すと全文">{p.name}</p>
        <CopyBtn text={p.name} label="店名" />
      </div>
      {p.altName && <p className="alt">{p.altName}</p>}
      {withAddress && p.address && (
        <div className="line addr-line">
          <p className={'addr' + (openAddr ? ' full' : '')} onClick={() => setOpenAddr((v) => !v)} title="押すと全文">{p.address}</p>
          <CopyBtn text={p.address} label="住所" />
        </div>
      )}
      {withAddress && p.altAddress && <p className="addr alt-addr">{p.altAddress}</p>}
    </div>
  );
}

// お店の詳細（Tabibi の中で開く）
const detailCache = new Map();

function Stars({ n }) {
  const r = Math.round(n || 0);
  return <span className="stars" aria-label={`星${n}`}>{'★'.repeat(r)}<span>{'★'.repeat(5 - r)}</span></span>;
}

function DetailPanel({ id }) {
  const [d, setD] = useState(detailCache.get(id) || null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (detailCache.has(id)) return;
    let alive = true;
    api(`/api/details?id=${encodeURIComponent(id)}`, { fallback: '詳細を取得できませんでした' })
      .then((x) => {
        if (!alive) return;
        detailCache.set(id, x);
        setD(x);
      })
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [id]);

  if (err) return <div className="detail"><p className="err">{err}</p></div>;
  if (!d) return <div className="detail"><p className="hint">読み込み中…</p></div>;

  return (
    <div className="detail">
      {d.photos.length > 0 && (
        <div className="photos">
          {d.photos.slice(0, 3).map((ph) => (
            <figure key={ph.name}>
              <img src={photoSrc(ph.name)} alt="" loading="lazy" />
              {ph.by && <figcaption>写真: {ph.by}</figcaption>}
            </figure>
          ))}
        </div>
      )}
      {/* 写真は3枚まで（1枚ごとに費用がかかるため）。続きはGoogleマップのお店情報で見る */}
      {safeUrl(d.mapsUrl) && <a className="btn ghost full" href={safeUrl(d.mapsUrl)} target="_blank" rel="noopener noreferrer">さらに詳しくみる</a>}

      {d.hours.length > 0 && (
        <section>
          <h3>営業時間 {d.openNow === true && <span className="open">営業中</span>}{d.openNow === false && <span className="closed">営業時間外</span>}</h3>
          <ul className="hours">
            {d.hours.map((h, i) => <li key={i} className={i === d.todayIndex ? 'today' : ''}>{h}</li>)}
          </ul>
        </section>
      )}

      {(d.phone || d.website || d.price || d.priceRange) && (
        <section className="facts">
          {d.phone && <p><b>電話</b><a href={`tel:${d.phone.replace(/\s/g, '')}`}>{d.phone}</a></p>}
          {d.website && <p><b>ホームページ</b><a href={safeUrl(d.website)} target="_blank" rel="noopener noreferrer">{d.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a></p>}
          {(d.price || d.priceRange) && <p><b>価格帯</b><span>{[d.price, d.priceRange].filter(Boolean).join('　')}</span></p>}
        </section>
      )}

      {d.reviews.length > 0 && (
        <section>
          <h3>口コミ</h3>
          <ul className="reviews">
            {d.reviews.map((r, i) => (
              <li key={i}>
                <p className="rv-head"><Stars n={r.rating} /> <span className="addr">{r.when}{r.author ? `・${r.author}` : ''}</span></p>
                <p className="rv-text">{r.text}</p>
                {r.original && <p className="rv-orig">{r.original}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

    </div>
  );
}

// 営業時間（お店の現地時間で計算）
function localNow(offset = 0) {
  const d = new Date(Date.now() + offset * 60000);
  return { day: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
function openState(h) {
  if (!h?.periods?.length) return null;
  if (h.periods.length === 1 && !h.periods[0].close) return true; // 24時間営業
  const { day, min } = localNow(h.offset);
  const now = day * 1440 + min;
  const W = 7 * 1440;
  for (const p of h.periods) {
    if (!p.open || !p.close) continue;
    const o = p.open.day * 1440 + p.open.hour * 60 + (p.open.minute || 0);
    let c = p.close.day * 1440 + p.close.hour * 60 + (p.close.minute || 0);
    if (c <= o) c += W;
    if ((now >= o && now < c) || (now + W >= o && now + W < c)) return true;
  }
  return false;
}
function todayHours(h) {
  if (!h?.hours?.length) return '';
  const { day } = localNow(h.offset);
  return h.hours[(day + 6) % 7] || '';
}

// ホテルからの距離（直線距離から、歩き・車のだいたいの時間を出す）
function distanceKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function fromHotel(h, it) {
  if (!h || h.lat == null || it.lat == null) return '';
  const km = distanceKm(h, it);
  if (km > 50) return ''; // 別の街・別の国のお店（「車で6947分」のような意味のない数字を出さない）
  const road = km * 1.3;
  const dist = km < 1 ? `${Math.round(km * 1000 / 10) * 10}m` : `${km.toFixed(1)}km`;
  if (road <= 3) return `ホテルから約${dist}・徒歩約${Math.max(1, Math.round((road / 4.5) * 60))}分`;
  return `ホテルから約${dist}・車で約${Math.max(5, Math.round((road / 25) * 60))}分`;
}

// 泊まるホテルをGoogleマップから選ぶ
function HotelPicker({ country: country0, current, onPick, onClear, onClose }) {
  const [country, setCountry] = useState(country0 || '');
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function search(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setErr('');
    try {
      // Grab・Uberでホテルに帰るときに貼れるよう、現地の表記（と日本語）も取る
      const d = await api('/api/search', { method: 'POST', body: { keyword: q.trim(), country }, timeout: 30000, fallback: '検索に失敗しました' });
      setList(d.places.slice(0, 8));
      if (!d.places.length) setErr('見つかりませんでした。ホテル名を変えて試してください。');
    } catch (e2) {
      setErr(jaError(e2, '検索に失敗しました'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="picker">
      <div className="picker-head">
        <b>今回の宿泊先（ホテル）を登録</b>
        <button type="button" className="x" onClick={onClose} aria-label="閉じる">×</button>
      </div>
      {current && (
        <div className="hotel-now">
          <p className="hint">いまの宿泊先（Grab・Uberで帰るときは、店名か住所をコピーして貼れます）</p>
          <NameBlock p={current} />
        </div>
      )}
      <label htmlFor="hotelct">国（えらばなくても探せます）
        <select id="hotelct" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">指定なし</option>
          {COUNTRY_LIST.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <form className="new-cat" onSubmit={search}>
        <input id="hotelq" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ホテル名（例：シェラトン）" />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'さがしています…' : 'さがす'}</button>
      </form>
      {err && <p className="err">{err}</p>}
      {list.length > 0 && (
        <ul className="hotel-list">
          {list.map((h) => (
            <li key={h.placeId}>
              <button type="button" onClick={() => onPick({ placeId: h.placeId, name: h.name, altName: h.altName, address: h.address, altAddress: h.altAddress, lat: h.lat, lng: h.lng, mapsUrl: h.mapsUrl, country: h.country || country })}>
                <b>{h.name}</b>
                {h.altName && <span>{h.altName}</span>}
                <span className="addr">{h.address}</span>
                {h.altAddress && <span className="addr">{h.altAddress}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {current && <button type="button" className="btn ghost" onClick={onClear}>ホテルの設定を外す</button>}
    </div>
  );
}

// 自分で撮った写真（このスマホの中に保存）
function PhotoStrip({ itemId, ver, kind }) {
  const [photos, setPhotos] = useState([]);
  const [big, setBig] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const urls = useRef([]);
  // クラウドにだけある写真（別の端末で撮ったもの）は、見たときに取ってくる
  const [cloudVer, setCloudVer] = useState(0);
  useEffect(() => {
    let alive = true;
    ensurePhotos(itemId).then((n) => { if (alive && n) setCloudVer((v) => v + 1); }).catch(() => {});
    return () => { alive = false; };
  }, [itemId, ver]);
  useEffect(() => {
    let alive = true;
    listPhotos(itemId)
      .then((list) => {
        if (!alive) return;
        urls.current.forEach((u) => URL.revokeObjectURL(u));
        const withUrl = list.map((p) => ({ ...p, url: URL.createObjectURL(p.blob) }));
        urls.current = withUrl.map((p) => p.url);
        setPhotos(withUrl);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [itemId, ver, cloudVer]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  if (!photos.length) return null;
  const groups = [
    ['メモ画像', photos.filter((p) => (p.kind || 'memo') === 'memo')],
    ['行った写真', photos.filter((p) => p.kind === 'visit')],
  ].filter(([t, l]) => l.length && (kind === 'visit' ? t === '行った写真' : t === 'メモ画像'));
  return (
    <>
      {groups.map(([title, list]) => (
        <div className="myphotos" key={title}>
          <p className="mp-title">{title} {list.length}枚</p>
          <div className="mp-strip">
            {list.map((p) => (
              <button type="button" key={p.id} onClick={() => { setBig(p); setConfirmDel(false); }}><img src={p.url} alt="" /></button>
            ))}
          </div>
        </div>
      ))}
      {big && (
        <div className="viewer" role="dialog" aria-label="写真" onClick={() => setBig(null)}>
          <img src={big.url} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="viewer-acts" onClick={(e) => e.stopPropagation()}>
            {confirmDel ? (
              <>
                <span>この写真を削除しますか？</span>
                <button type="button" className="btn" onClick={async () => { try { await deletePhoto(big.id); } catch {} setBig(null); setPhotos((ps) => ps.filter((x) => x.id !== big.id)); }}>削除する</button>
                <button type="button" className="btn ghost" onClick={() => setConfirmDel(false)}>やめる</button>
              </>
            ) : (
              <>
                <button type="button" className="btn ghost" onClick={() => setConfirmDel(true)}>削除</button>
                <button type="button" className="btn" onClick={() => setBig(null)}>閉じる</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// AIおすすめ（候補タブ）
const AI_PRESETS = ['食事', 'カフェ', 'スイーツ', '娯楽', '夜市', 'お酒', 'マッサージ'];
const moodQuestion = (m) => `この後は「${m}」の気分。どこがいい？`;

function localTimeLabel(offset) {
  const d = offset == null ? new Date() : new Date(Date.now() + offset * 60000);
  const get = (k) => (offset == null ? d[`get${k}`]() : d[`getUTC${k}`]());
  const wd = '日月火水木金土'[get('Day')];
  return `${get('Month') + 1}月${get('Date')}日(${wd}) ${String(get('Hours')).padStart(2, '0')}:${String(get('Minutes')).padStart(2, '0')}`;
}

function getHere() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

function AiPanel({ items, hotel, trip, customCats, onAddCustom, onAdd, savedIds, onShow }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [hereUsed, setHereUsed] = useState(null);
  const [pick, setPick] = useState(null);
  const [walk, setWalk] = useState(true);
  const [car, setCar] = useState(false);

  async function ask(question) {
    setBusy(true); setErr(''); setRes(null);
    try {
      const here = await getHere();
      setHereUsed(here ? 'here' : hotel ? 'hotel' : 'none');
      const offset = items.find((i) => i.hoursInfo)?.hoursInfo.offset;
      const payload = items.map((it) => ({
        id: it.id, name: it.name, altName: it.altName, category: it.category, rating: it.rating, memo: it.memo,
        open: it.hoursInfo ? openState(it.hoursInfo) : null,
        today: it.hoursInfo ? todayHours(it.hoursInfo) : '',
        fromHere: here && it.lat != null ? `${distanceKm(here, it).toFixed(1)}km` : '',
        fromHotel: fromHotel(hotel, it),
      }));
      const d = await api('/api/recommend', { method: 'POST', body: { question, here, hotel, items: payload.slice(0, 60), localTime: localTimeLabel(offset), trip, walk, car }, timeout: 60000, fallback: 'AIに聞けませんでした' });
      setRes({ answer: d.answer || '', picks: Array.isArray(d.picks) ? d.picks : [] });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return (
    <button type="button" className="ai-open" onClick={() => setOpen(true)}>
      <CatIcon id="ai" size={40} />
      <span className="ai-open-t"><b>AIナビゲーター</b><small>この後どんな気分？ 候補から次の行き先を提案</small></span>
      <IcRight size={18} />
    </button>
  );
  const byId = new Map(items.map((i) => [i.id, i]));
  return (
    <div className="ai">
      <div className="picker-head">
        <b>AIナビゲーター{trip ? `（${trip}）` : ''}</b>
        <button type="button" className="x" onClick={() => setOpen(false)} aria-label="閉じる">×</button>
      </div>
      <div className="ai-move">
        <label><input type="checkbox" checked={walk} onChange={(e) => setWalk(e.target.checked)} />徒歩圏内</label>
        <label><input type="checkbox" checked={car} onChange={(e) => setCar(e.target.checked)} />車移動</label>
      </div>
      <div className="cat-chips">
        {AI_PRESETS.map((t) => <button type="button" key={t} className="cat" disabled={busy} onClick={() => { setQ(''); ask(moodQuestion(t)); }}>{t}</button>)}
      </div>
      <form className="new-cat" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input id="aiq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="例：甘いものが食べたい" />
        <button className="btn" type="submit" disabled={busy}>{busy ? '考えています…' : '聞く'}</button>
      </form>
      <p className="hint">今いる場所（スマホの位置）・現地の時間・ホテル・候補のお店をもとに答えます。</p>
      {err && <p className="err">{err}</p>}
      {res && (
        <div className="ai-res">
          {hereUsed === 'hotel' && <p className="hint">今いる場所がわからなかったので、ホテルの近くとして考えました。</p>}
          {hereUsed === 'none' && <p className="hint">今いる場所がわからなかったので、距離は考えていません。</p>}
          <p className="ai-answer">{res.answer}</p>
          {res.picks.map((pk, i) => {
            if (pk.kind === 'list') {
              const it = byId.get(pk.id);
              if (!it) return null;
              return (
                <div className="ai-pick" key={i}>
                  <p className="ai-pick-name"><span className="ai-tag">候補</span>{it.altName || it.name}</p>
                  <p className="ai-reason">{pk.reason}</p>
                  <div className="acts">
                    <button type="button" onClick={() => onShow(it.id)}>リストで見る</button>
                    <a href={mapsLink(it)} target="_blank" rel="noopener noreferrer">Googleマップ</a>
                    <NaverLinks place={it} route={false} />
                  </div>
                </div>
              );
            }
            const pl = pk.place;
            if (!pl) return null;
            return (
              <div className="ai-pick" key={i}>
                <p className="ai-pick-name"><span className="ai-tag near">近く</span>{pl.altName || pl.name}</p>
                <NameBlock p={pl} />
                <p className="ai-sub">{pl.rating != null ? `★${pl.rating.toFixed(1)}（${(pl.reviews || 0).toLocaleString()}件）` : ''}</p>
                <p className="ai-reason">{pk.reason}</p>
                <div className="acts side-acts-inline">
                  <a href={mapsLink(pl)} target="_blank" rel="noopener noreferrer">Googleマップ</a>
                  <NaverLinks place={pl} route={false} />
                  {savedIds.has(pl.placeId)
                    ? <button type="button" disabled>追加済み</button>
                    : <button type="button" className="add" onClick={() => setPick(pick === pl.placeId ? null : pl.placeId)}>候補に追加 ▾</button>}
                  {pick === pl.placeId && !savedIds.has(pl.placeId) && (
                    <CategoryDropdown customCats={customCats} onAddCustom={onAddCustom} onPick={(c) => { onAdd(pl, c); setPick(null); }} onClose={() => setPick(null)} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// メモを書く（入力中の文字はここで持つ）
function MemoEditor({ initial, onSave, onCancel, placeholder = '例：並ぶので朝イチで行く。豆乳は甘いのを頼む' }) {
  const [v, setV] = useState(initial || '');
  return (
    <div className="memo-edit">
      <textarea id="memo" autoFocus rows={3} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />
      <div className="memo-acts">
        <button type="button" className="btn" onClick={() => onSave(v.trim())}>保存</button>
        <button type="button" className="btn ghost" onClick={onCancel}>やめる</button>
      </div>
    </div>
  );
}

function Rating({ p }) {
  return (
    <span className="meta">
      {p.rating != null && (
        <span className="rate"><b>★</b> {p.rating.toFixed(1)} <span className="addr">（{p.reviews.toLocaleString()}件）</span></span>
      )}
      {p.openNow === true && <span className="open">営業中</span>}
      {p.openNow === false && <span className="closed">営業時間外</span>}
      {p.type && <span className="pill">{p.type}</span>}
    </span>
  );
}

export default function Home() {
  const [tab, setTab] = useState('search');
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // 検索
  const [keyword, setKeyword] = useState('');
  const [area, setArea] = useState('');
  const [country, setCountry] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [minReviews, setMinReviews] = useState(0);
  const [sort, setSort] = useState('relevance');
  const [nearHotel, setNearHotel] = useState(true); // 宿泊先の近い順にさがす
  const [here, setHere] = useState(null);
  const [hereMsg, setHereMsg] = useState('');
  const srcUrl = '';
  const [shotBusy, setShotBusy] = useState(false);
  const [shotShops, setShotShops] = useState([]);
  const [shotMsg, setShotMsg] = useState('');
  const shotInput = useRef(null);
  const shotFile = useRef(null); // 「スクショからさがす」で使ったスクショ（候補に追加したお店に付ける）
  const [results, setResults] = useState([]);
  const [nextToken, setNextToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const lastQuery = useRef(null);
  const resultsTop = useRef(null);
  const [searchSeq, setSearchSeq] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);

  // 検索が終わったら結果の先頭へ移動する
  useEffect(() => {
    if (!searchSeq || !resultsTop.current) return;
    resultsTop.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [searchSeq]);

  // リスト
  const [trip, setTrip] = useState(''); // 今見ているフォルダ（＝追加先）
  const [folders, setFolders] = useState([]);
  const [moveFor, setMoveFor] = useState(null);
  useEffect(() => {
    if (!moveFor) return;
    const out = (e) => { if (!e.target.closest?.('.move-wrap')) setMoveFor(null); };
    document.addEventListener('pointerdown', out);
    return () => document.removeEventListener('pointerdown', out);
  }, [moveFor]);
  const [confirmId, setConfirmId] = useState(null);
  const [openDetail, setOpenDetail] = useState(null);
  const [customCats, setCustomCats] = useState([]);
  const [pickFor, setPickFor] = useState(null); // 's:placeId'（候補に追加）/ 'l:id'（カテゴリー変更）
  const [catFilter, setCatFilter] = useState('すべて');
  const [editCats, setEditCats] = useState(false);
  const [view, setView] = useState('list'); // 'list' / 'map'
  const [mapUsed, setMapUsed] = useState(false); // 地図は一度作ったら作り直さない（地図の表示回数を増やさない）
  useEffect(() => { if (view === 'map') setMapUsed(true); }, [view]);
  const [memoFor, setMemoFor] = useState(null);
  const [moreFor, setMoreFor] = useState(null); // 「…」メニューを開いているお店
  const [reviewFor, setReviewFor] = useState(null);
  const [hotel, setHotel] = useState(null); // 今回の宿泊先（1つ。すべての画面の軸）
  const useNear = !!(hotel && nearHotel && hotel.lat != null);
  const [hotelEdit, setHotelEdit] = useState(false);
  const [photoVer, setPhotoVer] = useState(0);
  const [notes, setNotes] = useState({}); // フォルダごとのeタビセツ
  const [noteOpen, setNoteOpen] = useState(false); // false / 'note' / 'guide'
  const [shelfKey, setShelfKey] = useState(0); // わたしのeタビセツを読み直す合図
  const saveNote = useCallback((t, n) => setNotes((prev) => ({ ...prev, [t]: n })), []);
  const [prompts, setPrompts] = useState([]); // マイプロンプト（AIで作る）
  const [photoBusy, setPhotoBusy] = useState(null);
  const [notice, setNotice] = useState('');
  async function onPhotos(itemId, files, kind) {
    if (!files?.length) return;
    setPhotoBusy(itemId); setNotice('');
    try { await addPhotos(itemId, Array.from(files), kind); }
    catch { setNotice('写真を保存できませんでした。スマホの空き容量を確かめるか、ほかの写真で試してください（シークレットモードでは保存できません）'); }
    setPhotoBusy(null);
    setPhotoVer((v) => v + 1);
  }
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60000); return () => clearInterval(t); }, []);
  const toggleDetail = (k) => setOpenDetail((cur) => (cur === k ? null : k));

  useEffect(() => {
    // フォルダが決まっていないお店は「未分類」に入れる（消えて見えないように）
    const fixTrip = (arr) => arr.map((i) => (i.trip ? i : { ...i, trip: UNSORTED }));
    try { const s = localStorage.getItem(KEY); if (s) setItems(fixTrip(JSON.parse(s))); } catch {}
    try { const c = localStorage.getItem(CATS_KEY); if (c) setCustomCats(JSON.parse(c)); } catch {}
    try {
      const h = localStorage.getItem('trippin.hotel');
      if (h) setHotel(JSON.parse(h));
      else {
        // 前の作り（フォルダごとのホテル）から引き継ぐ：開いていたフォルダのホテル、なければどれか1つ
        const old = JSON.parse(localStorage.getItem('trippin.hotels') || '{}');
        const cur = localStorage.getItem('trippin.folder');
        const pick = old[cur] || Object.values(old)[0];
        if (pick) setHotel(pick);
      }
    } catch {}
    try { const n = localStorage.getItem('trippin.notes'); if (n) setNotes(JSON.parse(n) || {}); } catch {}
    try { const pr = JSON.parse(localStorage.getItem('trippin.prompts') || '[]'); if (Array.isArray(pr)) setPrompts(pr); } catch {}
    try { const c = localStorage.getItem('trippin.country'); if (c && COUNTRY_LIST.some(([k]) => k === c)) setCountry(c); } catch {}
    try {
      const f = JSON.parse(localStorage.getItem('trippin.folders') || '[]');
      const its = fixTrip(JSON.parse(localStorage.getItem(KEY) || '[]'));
      const merged = [...new Set([...f, ...its.map((i) => i.trip).filter(Boolean)])];
      setFolders(merged);
      const cur = localStorage.getItem('trippin.folder');
      setTrip(cur && (cur === UNSORTED || merged.includes(cur)) ? cur : UNSORTED);
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(CATS_KEY, JSON.stringify(customCats)); } catch {}
  }, [customCats, loaded]);
  useEffect(() => {
    if (!loaded) return;
    try { if (hotel) localStorage.setItem('trippin.hotel', JSON.stringify(hotel)); else localStorage.removeItem('trippin.hotel'); } catch {}
  }, [hotel, loaded]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem('trippin.notes', JSON.stringify(notes)); localStorage.setItem('trippin.prompts', JSON.stringify(prompts)); } catch {}
  }, [notes, prompts, loaded]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem('trippin.folders', JSON.stringify(folders)); localStorage.setItem('trippin.folder', trip); } catch {}
  }, [folders, trip, loaded]);
  function createFolder(n) {
    if (n === UNSORTED) { setTrip(UNSORTED); return; }
    setFolders((prev) => (prev.includes(n) ? prev : [...prev, n]));
    setTrip(n);
  }
  function renameFolder(from, to) {
    if (from === UNSORTED || to === UNSORTED) return;
    renameShare(from, to).catch(() => {});
    setFolders((prev) => prev.map((f) => (f === from ? to : f)).filter((f, i, a) => a.indexOf(f) === i));
    setItems((prev) => prev.map((i) => (i.trip === from ? { ...i, trip: to, updatedAt: Date.now() } : i)));
    setNotes((prev) => { if (!prev[from]) return prev; const { [from]: n, ...rest } = prev; return { ...rest, [to]: n }; });
    setTrip(to);
  }
  function deleteFolder(name) {
    deleteShare(name).catch(() => {});
    const gone = items.filter((i) => i.trip === name).map((i) => i.id);
    setItems((prev) => prev.filter((i) => i.trip !== name));
    gone.forEach((id) => deletePhotosOf(id).catch(() => {}));
    const rest = allFolders.filter((f) => f !== name);
    setFolders(rest);
    setNotes((prev) => { const { [name]: _, ...rest2 } = prev; return rest2; });
    setTrip(UNSORTED);
  }
  // ---- ログインとクラウド保存 ----
  const [user, setUser] = useState(null);
  const [syncMsg, setSyncMsg] = useState('');
  const synced = useRef(false);       // はじめのそろえが終わったか
  const pushed = useRef(new Map());   // クラウドに送った内容（変わったものだけ送るため）
  useEffect(() => {
    const sb = supa();
    sb.auth.getSession().then(({ data }) => setUser(data.session?.user || null));
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => setUser(session?.user || null));
    return () => sub.subscription.unsubscribe();
  }, []);
  const settingsData = () => ({ folders, hotel, customCats, notes, prompts });
  useEffect(() => {
    if (!loaded || !user) { setCloudUser(null); synced.current = false; return; }
    let alive = true;
    setCloudUser(user.id);
    (async () => {
      setSyncMsg('クラウドとそろえています…');
      try {
        const key = 'trippin.synced.' + user.id;
        let known = new Set();
        try { known = new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch {}
        const [cloudItems, cloudSettings] = await Promise.all([pullItems(), pullSettings(), pullPhotoRows()]);
        if (!alive) return;
        const localItems = JSON.parse(localStorage.getItem(KEY) || '[]');
        const { merged, toUpload, removed } = mergeItems(localItems, cloudItems, known);
        removed.forEach((id) => deletePhotosOf(id).catch(() => {}));
        await upsertItems(toUpload);
        if (cloudSettings) {
          setFolders((prev) => [...new Set([...(cloudSettings.folders || []), ...prev])]);
          setCustomCats((prev) => [...new Set([...(cloudSettings.customCats || []), ...prev])]);
          if (cloudSettings.hotel !== undefined) setHotel(cloudSettings.hotel || null);
          // eタビセツはフォルダごとに新しいほうを使う
          if (Array.isArray(cloudSettings.prompts)) setPrompts((prev) => [...prev, ...cloudSettings.prompts.filter((c) => !prev.some((p) => p.name === c.name))].slice(0, 20));
          if (cloudSettings.notes) setNotes((prev) => {
            const out = { ...prev };
            for (const [k, v] of Object.entries(cloudSettings.notes)) if (!out[k] || (v?.updatedAt || 0) > (out[k].updatedAt || 0)) out[k] = v;
            return out;
          });
        } else {
          await pushSettings(settingsData());
        }
        pushed.current = new Map(merged.map((it) => [it.id, JSON.stringify(it)]));
        setItems(merged);
        try { localStorage.setItem(key, JSON.stringify(merged.map((it) => it.id))); } catch {}
        synced.current = true;
        setSyncMsg('');
        uploadMissingPhotos(new Set(merged.map((it) => it.id))).then(() => setPhotoVer((v) => v + 1));
      } catch (e) {
        setSyncMsg('クラウドとそろえられませんでした。電波のよいところで開き直してください。');
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, user?.id]);
  // お店が変わったら、変わったものだけクラウドへ送る（1秒まとめて）
  useEffect(() => {
    if (!user || !synced.current) return;
    const t = setTimeout(async () => {
      const cur = new Map(items.map((it) => [it.id, JSON.stringify(it)]));
      const changed = items.filter((it) => pushed.current.get(it.id) !== cur.get(it.id));
      const gone = [...pushed.current.keys()].filter((id) => !cur.has(id));
      try {
        await upsertItems(changed);
        await deleteItems(gone);
        pushed.current = cur;
        try { localStorage.setItem('trippin.synced.' + user.id, JSON.stringify(items.map((it) => it.id))); } catch {}
      } catch {}
    }, 1000);
    return () => clearTimeout(t);
  }, [items, user]);
  useEffect(() => {
    if (!user || !synced.current) return;
    const t = setTimeout(() => { pushSettings(settingsData()).catch(() => {}); }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, hotel, customCats, notes, prompts, user]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
  }, [items, loaded]);

  const searching = useRef(false); // 2回押しで同じ検索を2回しない（検索は1回ごとに料金がかかる）
  async function runSearch(more = false, override = null) {
    if (busy || searching.current) return;
    // 宿泊先の近い順にさがす：国は宿泊先の国、場所は使わない（宿泊先のまわりを探す）
    const near = useNear ? { lat: hotel.lat, lng: hotel.lng } : null;
    const base = useNear ? { area: '', country: hotel.country || country } : { area, country };
    const q = more ? lastQuery.current : { keyword, ...base, minRating: Number(minRating), minReviews: Number(minReviews), near, ...(override || {}) };
    if (!more && !String(q.keyword).trim() && !String(q.area).trim()) { setError('キーワードか場所を入力してください'); return; }
    searching.current = true;
    setBusy(true); setMoreBusy(more); setError('');
    try {
      const data = await api('/api/search', { method: 'POST', body: { ...q, pageToken: more ? nextToken : null }, timeout: 35000, fallback: '検索に失敗しました。もう一度試してください' });
      lastQuery.current = q;
      setResults((prev) => (more ? prev.concat(data.places) : data.places));
      setNextToken(data.nextPageToken);
      setSearched(true);
      if (!more) setSearchSeq((n) => n + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      searching.current = false;
      setBusy(false); setMoreBusy(false);
    }
  }

  // スクショを小さくしてから送る（長辺1600px・JPEG）
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.onerror = () => reject(new Error('画像を読み込めませんでした'));
      img.src = URL.createObjectURL(file);
    });
  }

  function searchShop(sh) {
    const c = sh.country || country;
    setKeyword(sh.name); setArea(sh.city); setCountry(c);
    runSearch(false, { keyword: sh.name, area: sh.city, country: c });
  }

  async function readShot(file) {
    if (!file) return;
    shotFile.current = file;
    setShotBusy(true); setShotShops([]); setShotMsg(''); setError('');
    try {
      const image = await shrink(file);
      const data = await api('/api/screenshot', { method: 'POST', body: { image, mimeType: 'image/jpeg' }, timeout: 40000, fallback: '読み取りに失敗しました' });
      if (!Array.isArray(data.shops) || !data.shops.length) { setShotMsg('お店の名前を読み取れませんでした。店名が写っているスクショで試すか、キーワードに入れて探してください。'); return; }
      setShotShops(data.shops);
      if (data.shops.length === 1) searchShop(data.shops[0]);
    } catch (e) {
      setShotMsg(jaError(e, '読み取りに失敗しました'));
    } finally {
      setShotBusy(false);
      if (shotInput.current) shotInput.current.value = '';
    }
  }


  const sorted = [...results];
  if (sort === 'rating') sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  if (sort === 'reviews') sorted.sort((a, b) => b.reviews - a.reviews);
  if (sort === 'hotel' && hotel?.lat != null) sorted.sort((a, b) => (a.lat == null ? 1e9 : distanceKm(hotel, a)) - (b.lat == null ? 1e9 : distanceKm(hotel, b)));
  if (sort === 'near' && here) sorted.sort((a, b) => (a.lat == null ? 1e9 : distanceKm(here, a)) - (b.lat == null ? 1e9 : distanceKm(here, b)));
  async function changeSort(v) {
    setSort(v); setHereMsg('');
    if (v !== 'near') return;
    setHereMsg('現在地を調べています…');
    const h = await getHere();
    if (h) { setHere(h); setHereMsg(''); }
    else setHereMsg('現在地がわかりませんでした。スマホの位置情報をオンにしてください。');
  }

  const savedIds = new Set(items.map((i) => i.placeId));
  function addCandidate(p, category = '', tripName = null) {
    if (savedIds.has(p.placeId)) return;
    // さがす画面から入れたお店は「未分類」へ。フォルダ分けは候補タブで自分でする
    const folder = tripName || UNSORTED;
    if (!tripName) setTrip(UNSORTED);
    setItems((prev) => [{ ...p, id: p.placeId, category, trip: folder, srcUrl: srcUrl.trim(), done: false, rec: false, addedAt: Date.now() }, ...prev]);
    setPickFor(null);
    if (!tripName && shotFile.current) {
      const f = shotFile.current;
      addPhotos(p.placeId, [f], 'memo').then(() => setPhotoVer((v) => v + 1)).catch(() => {});
    }
  }
  const closePick = useCallback(() => setPickFor(null), []);
  const addCustomCat = (n) => setCustomCats((prev) => (prev.includes(n) ? prev : [...prev, n]));
  function renameCat(from, to) {
    setCustomCats((prev) => prev.map((c) => (c === from ? to : c)).filter((c, i, a) => a.indexOf(c) === i));
    setItems((prev) => prev.map((i) => (i.category === from ? { ...i, category: to, updatedAt: Date.now() } : i)));
    if (catFilter === from) setCatFilter(to);
  }
  function deleteCat(name) {
    setCustomCats((prev) => prev.filter((c) => c !== name));
    setItems((prev) => prev.map((i) => (i.category === name ? { ...i, category: '', updatedAt: Date.now() } : i)));
    if (catFilter === name) setCatFilter('すべて');
  }
  // 候補に入れたお店の営業時間を、入れたときに1回だけ取っておく（取り直しはしない）
  const hoursBusy = useRef(false);
  const hoursTried = useRef(new Set()); // 取れなかったお店を何度も取りに行かない（1回ごとに料金がかかる）
  useEffect(() => {
    if (!loaded || hoursBusy.current) return;
    const need = items.filter((i) => i.placeId && !i.hoursInfo && !hoursTried.current.has(i.id));
    if (!need.length) return;
    hoursBusy.current = true;
    (async () => {
      for (const it of need) {
        hoursTried.current.add(it.id);
        try {
          const d = await api(`/api/details?id=${encodeURIComponent(it.placeId)}&lite=1`, { timeout: 15000 });
          const hoursInfo = { hours: d.hours || [], periods: d.periods || [], offset: d.offset || 0, at: Date.now() };
          setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, hoursInfo } : x)));
        } catch {}
      }
      hoursBusy.current = false;
    })();
  }, [items, loaded]);

  function update(id, patch) { setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: Date.now() } : i))); }
  // カードの写真が出なかったら（写真の名前の期限切れ）、そのお店の写真の名前を1回だけ取り直す（無料）
  const photoTried = useRef(new Set());
  async function refreshPhoto(it) {
    if (!it.placeId || photoTried.current.has(it.id)) return;
    photoTried.current.add(it.id);
    try {
      const d = await api(`/api/photoname?id=${encodeURIComponent(it.placeId)}`, { timeout: 10000 });
      if (d.photo !== undefined && d.photo !== it.photo) update(it.id, { photo: d.photo });
    } catch {}
  }
  function remove(id) { setItems((prev) => prev.filter((i) => i.id !== id)); setConfirmId(null); deletePhotosOf(id).catch(() => {}); }

  const allFolders = [UNSORTED, ...new Set([...folders, ...items.map((i) => i.trip)].filter((f) => f && f !== UNSORTED))];
  const trips = allFolders;
  // フォルダの数字は今のタブ（候補／行った）の件数、削除の確認は全部の件数
  const folderCounts = {};
  const folderTotals = {};
  items.forEach((i) => {
    folderTotals[i.trip] = (folderTotals[i.trip] || 0) + 1;
    if ((tab === 'done') === !!i.done) folderCounts[i.trip] = (folderCounts[i.trip] || 0) + 1;
  });
  // タブの数字は全フォルダの合計
  const candTotal = items.filter((i) => !i.done).length;
  const doneTotal = items.filter((i) => i.done).length;
  // 今のフォルダ・今のタブのお店（カテゴリーの絞り込み前）
  const inFolder = items.filter((i) => i.trip === trip && (tab === 'done') === !!i.done);
  const usedCats = [...new Set(inFolder.map((i) => i.category || 'なし'))];
  // 絞り込んでいたカテゴリーのお店がなくなったら「すべて」として扱う
  const cf = catFilter === 'すべて' || usedCats.includes(catFilter) ? catFilter : 'すべて';
  const inTrip = inFolder.filter((i) => cf === 'すべて' || (cf === 'なし' ? !i.category : i.category === cf));
  const catOrder = [...BASE_CATS.map(([n]) => n), ...customCats, 'なし'];
  usedCats.sort((a, b) => catOrder.indexOf(a) - catOrder.indexOf(b));
  const cand = inTrip.filter((i) => !i.done);
  const done = inTrip.filter((i) => i.done).sort((a, b) => (b.rec ? 1 : 0) - (a.rec ? 1 : 0));
  const shown = tab === 'cand' ? cand : done;
  const mapHotels = useMemo(() => [hotel].filter(Boolean), [hotel]);
  const mapKey = shown.map((i) => `${i.id}:${i.category}:${i.done}:${i.rec}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mapItems = useMemo(() => shown, [mapKey]);

  function ListCard({ it, no }) {
    const src = sourceLabel(it.srcUrl);
    return (
      <article key={it.id} id={'item-' + it.id} className={'item' + (it.done ? ' done' : '')}>
        <div className="item-top">
          <div className="thumbwrap">
            <button type="button" className="thumbbtn" onClick={() => toggleDetail('l:' + it.id)} aria-label="詳細を見る">
              {it.photo ? <img className="thumb" src={photoSrc(it.photo)} alt="" loading="lazy" onError={() => refreshPhoto(it)} /> : <div className="thumb" />}
            </button>
            <span className="no" style={{ '--c': catColor(it.category) }}>{no}</span>
            {it.done && (
              <button className={'star photo-star' + (it.rec ? ' on' : '')} aria-label="おすすめマーク" aria-pressed={!!it.rec} onClick={() => update(it.id, { rec: !it.rec })}>★</button>
            )}
          </div>
          <div className="body">
            <NameBlock p={it} />
            <Rating p={{ ...it, openNow: undefined }} />
            {it.hoursInfo && (
              <p className="today">
                {openState(it.hoursInfo) === true && <span className="open">営業中</span>}
                {openState(it.hoursInfo) === false && <span className="closed">営業時間外</span>}
                <span>{todayHours(it.hoursInfo) ? '今日 ' + todayHours(it.hoursInfo).replace(/^[^:：]+[:：]\s*/, '') : '営業時間の情報なし'}</span>
              </p>
            )}
            {fromHotel(hotel, it) && <p className="fromhotel">{fromHotel(hotel, it)}</p>}
            <span className="meta">
              <button type="button" className={'cat small' + (it.category ? ' sel' : ' none')} style={{ '--c': catColor(it.category) }} onClick={() => setPickFor(pickFor === 'l:' + it.id ? null : 'l:' + it.id)}>{it.category || 'カテゴリーなし'} ▾</button>
              <span className="move-wrap">
                <button type="button" className="pill pill-btn" onClick={() => setMoveFor(moveFor === it.id ? null : it.id)}>{it.trip} ▾</button>
                {moveFor === it.id && (
                  <div className="dropdown move-dd">
                    <p className="dd-title">別のフォルダに移す</p>
                    <ul>
                      {allFolders.filter((f) => f !== it.trip).map((f) => (
                        <li key={f}><button type="button" onClick={() => { update(it.id, { trip: f }); setMoveFor(null); }}>{f}</button></li>
                      ))}
                      {allFolders.length < 2 && <li><p className="dd-title">ほかのフォルダがありません</p></li>}
                    </ul>
                  </div>
                )}
              </span>
              {src && <span className="pill">{src}で発見</span>}
              {it.done && it.rec && <span className="pill" style={{ color: 'var(--star)' }}>おすすめ</span>}
            </span>
          </div>
        </div>
        <div className="actrow">
          {it.done
            ? <button type="button" className="act" onClick={() => update(it.id, { done: false, rec: false })}>候補に戻す</button>
            : <button type="button" className="act primary go" onClick={() => update(it.id, { done: true })}><IcCheck size={16} />行った</button>}
          <a className="act" href={mapsLink(it)} target="_blank" rel="noopener noreferrer"><IcPin size={16} />地図</a>
          <button type="button" className="act" onClick={() => setMemoFor(memoFor === it.id ? null : it.id)}><IcPen size={16} />メモ</button>
          <span className="dd-wrap">
            <button type="button" className="act icon" aria-label="そのほかの操作" aria-expanded={moreFor === it.id} onClick={() => setMoreFor(moreFor === it.id ? null : it.id)}><IcMore size={18} /></button>
            {moreFor === it.id && (
              <div className="dropdown more-dd">
                <ul>
                  <li>
                    <label className="dd-item photo-add">
                      {photoBusy === it.id ? '保存中…' : it.done ? '写真を追加' : 'メモ画像を追加'}
                      <input type="file" accept="image/*" multiple hidden onChange={(e) => { onPhotos(it.id, e.target.files, it.done ? 'visit' : 'memo'); e.target.value = ''; setMoreFor(null); }} />
                    </label>
                  </li>
                  {safeUrl(it.srcUrl) && <li><a className="dd-item" href={safeUrl(it.srcUrl)} target="_blank" rel="noopener noreferrer">元の投稿を見る</a></li>}
                  <li><button type="button" className="dd-item del" onClick={() => { setConfirmId(it.id); setMoreFor(null); }}>削除</button></li>
                </ul>
              </div>
            )}
          </span>
        </div>
        {inKorea(it) && <div className="actrow naver-row"><NaverLinks place={it} /></div>}
        {confirmId === it.id && (
          <div className="side-confirm">
            <span>「{it.altName || it.name}」を削除しますか？</span>
            <button className="del-yes" onClick={() => remove(it.id)}>削除する</button>
            <button onClick={() => setConfirmId(null)}>やめる</button>
          </div>
        )}
        {memoFor === it.id ? (
          <MemoEditor initial={it.memo} onSave={(v) => { update(it.id, { memo: v }); setMemoFor(null); }} onCancel={() => setMemoFor(null)} />
        ) : it.memo ? (
          <button type="button" className="memo" onClick={() => setMemoFor(it.id)} aria-label="メモを書き直す">{it.memo}</button>
        ) : null}

        {pickFor === 'l:' + it.id && (
          <CategoryPicker title="カテゴリーを変える" customCats={customCats} current={it.category} onAddCustom={addCustomCat}
            onPick={(c) => { update(it.id, { category: c }); setPickFor(null); }} onClose={() => setPickFor(null)} />
        )}
        <PhotoStrip itemId={it.id} ver={photoVer} kind={it.done ? 'visit' : 'memo'} />
        {it.done && (
          reviewFor === it.id ? (
            <MemoEditor initial={it.review} placeholder="例：豆乳と焼餅を注文。朝7時で15分待ち。甘い豆乳が絶品" onSave={(v) => { update(it.id, { review: v }); setReviewFor(null); }} onCancel={() => setReviewFor(null)} />
          ) : it.review ? (
            <div className="review">
              <p className="rv-label">感想</p>
              <button type="button" className="review-text" onClick={() => setReviewFor(it.id)} aria-label="感想を書き直す">{it.review}</button>
            </div>
          ) : (
            <button type="button" className="review-add" onClick={() => setReviewFor(it.id)}>感想を書く</button>
          )
        )}
        <button type="button" className={'detailbar' + (openDetail === 'l:' + it.id ? ' on' : '')} onClick={() => toggleDetail('l:' + it.id)}>
          {openDetail === 'l:' + it.id ? '詳細を閉じる' : '詳細を開く'}
        </button>
        {openDetail === 'l:' + it.id && <DetailPanel id={it.placeId || it.id} />}
      </article>
    );
  }

  return (
    <main className="wrap">
      <header className="apphead">
        <h1 className="logo"><img src="/logo.png" alt="Tabibi" width="720" height="168" /></h1>
        {user
          ? <button type="button" className="login-btn" onClick={() => signOut()}><IcUser size={16} />ログアウト</button>
          : <button type="button" className="login-btn on" onClick={() => signIn()}><IcUser size={16} />ログイン</button>}
      </header>

      {syncMsg && <p className="hint sync-msg">{syncMsg}</p>}
      {notice && <p className="err notice" role="alert" onClick={() => setNotice('')}>{notice}</p>}
      <div className="ctxrow">
        {tab === 'search' && (
        <label className="ctx-chip trip">
          <IcPlane size={15} />
          <span className="sr">旅（フォルダ）</span>
          <select value={trip} onChange={(e) => { setTrip(e.target.value); setCatFilter('すべて'); }}>
            {allFolders.map((f) => <option key={f} value={f}>{f === UNSORTED ? f : `${f}の旅`}</option>)}
          </select>
          <IcDown size={12} />
        </label>
        )}
        <button type="button" className={'ctx-chip hotel' + (hotel ? ' on' : '')} aria-expanded={hotelEdit} onClick={() => setHotelEdit((v) => !v)}>
          <IcHotel size={15} />
          <span className="ctx-t">{hotel ? hotel.name : '宿泊先を登録'}</span>
        </button>
      </div>
      {hotelEdit && (
        <HotelPicker country={country} current={hotel}
          onPick={(h) => { setHotel(h); setHotelEdit(false); if (h.country) { setCountry(h.country); try { localStorage.setItem('trippin.country', h.country); } catch {} } }}
          onClear={() => { setHotel(null); setHotelEdit(false); if (sort === 'hotel') setSort('relevance'); }}
          onClose={() => setHotelEdit(false)} />
      )}

      <nav className="tabs bottomnav" role="tablist" aria-label="メニュー">
        <button role="tab" aria-selected={tab === 'search'} onClick={() => { setTab('search'); window.scrollTo({ top: 0 }); }}><IcSearch size={24} /><span>さがす</span></button>
        <button role="tab" aria-selected={tab === 'cand'} onClick={() => { setTab('cand'); setCatFilter('すべて'); window.scrollTo({ top: 0 }); }}><IcBookmark size={24} /><span>候補 <span className="count">{candTotal}</span></span></button>
        <button role="tab" aria-selected={tab === 'done'} onClick={() => { setTab('done'); setCatFilter('すべて'); window.scrollTo({ top: 0 }); }}><IcCheckCircle size={24} /><span>行った <span className="count">{doneTotal}</span></span></button>
      </nav>

      {tab === 'search' && (
        <>
          <form className="panel" onSubmit={(e) => { e.preventDefault(); shotFile.current = null; setShotShops([]); runSearch(false); }}>
            <div className="search-head">
              <p>Googleマップのお店・名所から</p>
              <h2>どこに行く？</h2>
            </div>
            {hotel && (
              <label className="near-hotel"><input type="checkbox" checked={nearHotel} onChange={(e) => setNearHotel(e.target.checked)} />宿泊先の近い順にさがす</label>
            )}
            <label htmlFor="kw" className="kw">
              <IcSearch size={20} />
              <span className="sr">キーワード・店名</span>
              <input id="kw" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="店名・料理・エリア（例：魯肉飯）" />
            </label>
            <div className="catsearch" aria-label="カテゴリーからさがす">
              {CAT_SEARCH.map((c) => (
                <button type="button" key={c.id} disabled={busy} onClick={() => { setKeyword(c.q); shotFile.current = null; setShotShops([]); runSearch(false, { keyword: c.q }); }}>
                  <CatIcon id={c.id} size={44} />{c.label}
                </button>
              ))}
            </div>
            <div className="row">
              <label htmlFor="ct">国
                <select id="ct" value={useNear ? hotel.country || country : country} disabled={useNear} onChange={(e) => { setCountry(e.target.value); try { localStorage.setItem('trippin.country', e.target.value); } catch {} }}>
                  <option value="">指定なし</option>
                  {COUNTRY_LIST.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label htmlFor="area">場所
                <input id="area" value={useNear ? '' : area} disabled={useNear} onChange={(e) => setArea(e.target.value)} placeholder="例：台北" />
              </label>
            </div>
            <div className="row">
              <label htmlFor="mr">評価
                <select id="mr" value={minRating} onChange={(e) => setMinRating(e.target.value)}>
                  <option value={0}>指定なし</option>
                  <option value={3.5}>3.5以上</option>
                  <option value={4}>4.0以上</option>
                  <option value={4.5}>4.5以上</option>
                </select>
              </label>
              <label htmlFor="rv">レビュー
                <select id="rv" value={minReviews} onChange={(e) => setMinReviews(e.target.value)}>
                  <option value={0}>指定なし</option>
                  <option value={100}>100件以上</option>
                  <option value={500}>500件以上</option>
                  <option value={1000}>1000件以上</option>
                </select>
              </label>
            </div>
            <button className="btn search-go" type="submit" disabled={busy}>{busy && !moreBusy ? 'さがしています…' : 'さがす'}</button>
            {error && <p className="err">{error}</p>}
            <div className="shot">
              <input ref={shotInput} id="shot" type="file" accept="image/*" hidden onChange={(e) => readShot(e.target.files?.[0])} />
              <button type="button" className="shot-card" disabled={shotBusy} onClick={() => shotInput.current?.click()}>
                <CatIcon id="shot" size={44} />
                <span><b>{shotBusy ? 'スクショを読み取っています…' : 'スクショからさがす'}</b><small>SNSのスクショをAIが読み取って、お店・街・国を見つけます</small></span>
              </button>
              {shotShops.length > 1 && (
                <div className="shot-shops">
                  <p className="hint">読み取ったお店（押すと検索します）</p>
                  <div className="cat-chips">
                    {shotShops.map((sh, i) => (
                      <button type="button" key={i} className="cat" onClick={() => searchShop(sh)}>{sh.name}{sh.city ? `（${sh.city}）` : ''}</button>
                    ))}
                  </div>
                </div>
              )}
              {shotMsg && <p className="err">{shotMsg}</p>}
            </div>
            <p className="hint">国はえらばなくても探せます（例：キーワード「魯肉飯」＋場所「台北」）。えらぶと、その国の中だけを探します。</p>
          </form>

          <div className="list" ref={resultsTop} style={{ scrollMarginTop: '72px' }}>
            {searched && sorted.length > 0 && (
              <div className="result-bar">
                <p className="result-head">{sorted.length}{nextToken ? '件以上' : '件'}見つかりました</p>
                <select id="so" aria-label="並び順" value={sort} onChange={(e) => changeSort(e.target.value)}>
                  <option value="relevance">おすすめ順</option>
                  <option value="rating">点数が高い順</option>
                  <option value="reviews">レビューが多い順</option>
                  <option value="near">近い順（現在地から）</option>
                  {hotel && <option value="hotel">近い順（宿泊先から）</option>}
                </select>
              </div>
            )}
            {hereMsg && <p className="hint">{hereMsg}</p>}
            {searched && !sorted.length && (nextToken
              ? <div className="empty">ここまでに条件に合うお店はありませんでした。<br />「もっと見る」で続きを探せます。</div>
              : <div className="empty">条件に合うお店が見つかりませんでした。<br />評価やレビューの条件をゆるめてみてください。</div>)}
            {sorted.map((p) => (
              <article className="item" key={p.placeId}>
                <div className="item-top">
                  <div className="thumbwrap">
                    <button type="button" className="thumbbtn" onClick={() => toggleDetail('s:' + p.placeId)} aria-label="詳細を見る">
                      {p.photo ? <img className="thumb" src={photoSrc(p.photo)} alt="" loading="lazy" /> : <div className="thumb" />}
                    </button>
                  </div>
                  <div className="body">
                    <NameBlock p={p} />
                    <Rating p={p} />
                    {sort === 'near' && here && p.lat != null && <p className="dist">現在地から{distanceKm(here, p).toFixed(1)}km</p>}
                    {fromHotel(hotel, p) && <p className="fromhotel">{fromHotel(hotel, p)}</p>}
                  </div>
                </div>
                <div className="actrow">
                  {savedIds.has(p.placeId)
                    ? <button type="button" className="act added" disabled>追加済み（{items.find((i) => i.placeId === p.placeId)?.trip}）</button>
                    : (
                      <span className="dd-wrap grow">
                        <button type="button" className="act primary add" aria-expanded={pickFor === 's:' + p.placeId} onClick={() => setPickFor(pickFor === 's:' + p.placeId ? null : 's:' + p.placeId)}>候補に追加 ▾</button>
                        {pickFor === 's:' + p.placeId && (
                          <CategoryDropdown customCats={customCats} onAddCustom={addCustomCat}
                            onPick={(c) => addCandidate(p, c)} onClose={closePick} />
                        )}
                      </span>
                    )}
                  <a className="act" href={mapsLink(p)} target="_blank" rel="noopener noreferrer"><IcPin size={16} />地図</a>
                  <NaverLinks place={p} route={false} />
                </div>
                <button type="button" className={'detailbar' + (openDetail === 's:' + p.placeId ? ' on' : '')} onClick={() => toggleDetail('s:' + p.placeId)}>
                  {openDetail === 's:' + p.placeId ? '詳細を閉じる' : '詳細を開く'}
                </button>
                {openDetail === 's:' + p.placeId && <DetailPanel id={p.placeId} />}
              </article>
            ))}
            {nextToken && (
              <button type="button" className="btn ghost full more-btn" disabled={busy} onClick={() => runSearch(true)}>
                {moreBusy ? '読み込み中…' : 'もっと見る'}
              </button>
            )}
          </div>
        </>
      )}

      {tab !== 'search' && (
        <>
          <div className="trip-head">
            <h2>{trip === UNSORTED ? UNSORTED : `${trip}の旅`}</h2>
            <p>{hotel ? `宿泊先：${hotel.name} ・ ` : ''}候補 {items.filter((i) => i.trip === trip && !i.done).length} ・ 行った {items.filter((i) => i.trip === trip && i.done).length}</p>
          </div>
          <FolderBar folders={allFolders} current={trip} counts={folderCounts} totals={folderTotals} onSelect={(f) => { setTrip(f); setCatFilter('すべて'); }}
            onCreate={createFolder} onRename={renameFolder} onDelete={deleteFolder} user={user} />
          {usedCats.length > 0 && (
            <div className="chips cat-filter">
              {['すべて', ...usedCats].map((c) => (
                <button key={c} aria-pressed={c === cf} style={c !== 'すべて' && c !== 'なし' ? { '--c': catColor(c) } : undefined}
                  className={c !== 'すべて' && c !== 'なし' ? 'dot' : ''} onClick={() => setCatFilter(c)}>{c}</button>
              ))}
              <button className="edit-cats" aria-pressed={editCats} onClick={() => setEditCats((v) => !v)}>カテゴリーの編集</button>
            </div>
          )}
          {tab === 'cand' && inFolder.length > 0 && (
            <AiPanel items={inFolder} hotel={hotel} trip={trip === UNSORTED ? '' : trip} customCats={customCats} onAddCustom={addCustomCat}
              savedIds={savedIds} onAdd={(pl, c) => addCandidate(pl, c, trip || null)}
              onShow={(id) => { setView('list'); setTimeout(() => document.getElementById('item-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }} />
          )}
          {tab === 'done' && !noteOpen && doneTotal > 0 && (
            <NoteShelf user={user} onSignIn={() => signIn()} refreshKey={shelfKey}
              onMakeNote={() => setNoteOpen('note')} onMakeGuide={() => setNoteOpen('guide')} />
          )}
          {tab === 'done' && noteOpen === 'guide' && (
            <GuideMaker items={items} folders={allFolders} trip={trip} user={user} onSignIn={() => signIn()} onClose={() => { setNoteOpen(false); setShelfKey((k) => k + 1); }} unsorted={UNSORTED} />
          )}
          {tab === 'done' && noteOpen === 'note' && (
            <NoteMaker items={items} folders={allFolders} trip={trip} notes={notes} onSave={saveNote} unsorted={UNSORTED}
              photoVer={photoVer} onPhotosAdded={() => setPhotoVer((v) => v + 1)} onClose={() => { setNoteOpen(false); setShelfKey((k) => k + 1); }} user={user} onSignIn={() => signIn()} prompts={prompts} onPrompts={setPrompts} />
          )}
          <div className="viewtoggle" role="tablist" aria-label="表示の切り替え">
            <button role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>リスト</button>
            <button role="tab" aria-selected={view === 'map'} onClick={() => setView('map')}>地図</button>
          </div>
          {editCats && (
            <div className="panel">
              <h2>自分で作ったカテゴリー</h2>
              <CustomCatEditor customCats={customCats} onRename={renameCat} onDelete={deleteCat} />
            </div>
          )}
          {mapUsed && (
            <div hidden={view !== 'map' || (shown.length === 0 && mapHotels.length === 0)}>
              <MapView items={mapItems} colorOf={catColor} photoSrc={photoSrc} hotels={mapHotels} visible={view === 'map'} />
            </div>
          )}
          <div className="list">
            {shown.map((it, i) => ListCard({ it, no: i + 1 }))}
            {loaded && (tab === 'cand' ? cand : done).length === 0 && (
              <div className="empty">
                {tab === 'cand'
                  ? (candTotal > 0 ? <>「{trip}」にはまだ候補がありません。</> : <>まだ候補がありません。<br />「さがす」からお店を見つけて追加してください。</>)
                  : (doneTotal > 0 ? <>「{trip}」にはまだ行ったお店がありません。</> : <>まだ行ったお店はありません。<br />候補のお店で「行った」を押すとここに移ります。</>)}
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
