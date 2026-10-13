'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './MapView';
import { addPhotos, listPhotos, deletePhoto, deletePhotosOf } from './photos';

const KEY = 'trippin.v1';

const COUNTRY_LIST = [
  ['', '指定なし'], ['TW', '台湾'], ['KR', '韓国'], ['HK', '香港'], ['CN', '中国'], ['VN', 'ベトナム'],
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
function FolderBar({ folders, current, counts, onSelect, onCreate, onRename, onDelete }) {
  const [mode, setMode] = useState(null); // 'new' / 'edit'
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
      {current && mode !== 'new' && (
        <button type="button" className="fb-edit" onClick={() => { setMode(mode === 'edit' ? null : 'edit'); setName(current); setConfirm(false); }}>「{current}」の名前の変更・削除</button>
      )}
      {mode === 'new' && (
        <form className="new-cat" onSubmit={submitNew}>
          <input id="newfolder" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例：台湾 2026年3月" maxLength={30} />
          <button className="btn" type="submit">作る</button>
        </form>
      )}
      {mode === 'edit' && (
        confirm ? (
          <div className="confirm">「{current}」とその中のお店{counts[current] || 0}件を削除しますか？
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

const countryName = (c) => (c ? (COUNTRY_LIST.find(([k]) => k === c) || [, ''])[1] : '');

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

// お店の詳細（Trippin の中で開く）
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
    fetch(`/api/details?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((x) => {
        if (!alive) return;
        if (x.error) { setErr(x.error); return; }
        detailCache.set(id, x);
        setD(x);
      })
      .catch(() => alive && setErr('詳細を取得できませんでした'));
    return () => { alive = false; };
  }, [id]);

  if (err) return <div className="detail"><p className="err">{err}</p></div>;
  if (!d) return <div className="detail"><p className="hint">読み込み中…</p></div>;

  return (
    <div className="detail">
      {d.photos.length > 0 && (
        <div className="photos">
          {d.photos.map((ph) => (
            <figure key={ph.name}>
              <img src={photoSrc(ph.name)} alt="" loading="lazy" />
              {ph.by && <figcaption>写真: {ph.by}</figcaption>}
            </figure>
          ))}
        </div>
      )}

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
          {d.website && <p><b>ホームページ</b><a href={d.website} target="_blank" rel="noopener">{d.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a></p>}
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

      {d.mapsUrl && <a className="btn ghost full" href={d.mapsUrl} target="_blank" rel="noopener">Googleマップで全部見る</a>}
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
  const road = km * 1.3;
  const dist = km < 1 ? `${Math.round(km * 1000 / 10) * 10}m` : `${km.toFixed(1)}km`;
  if (road <= 3) return `ホテルから約${dist}・徒歩約${Math.max(1, Math.round((road / 4.5) * 60))}分`;
  return `ホテルから約${dist}・車で約${Math.max(5, Math.round((road / 25) * 60))}分`;
}

// 泊まるホテルをGoogleマップから選ぶ
function HotelPicker({ trip, current, onPick, onClear, onClose }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function search(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: q.trim(), area: trip === '未分類' ? '' : trip }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '検索に失敗しました');
      setList(d.places.slice(0, 8));
      if (!d.places.length) setErr('見つかりませんでした。ホテル名を変えて試してください。');
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="picker">
      <div className="picker-head">
        <b>{trip}で泊まるホテル</b>
        <button type="button" className="x" onClick={onClose} aria-label="閉じる">×</button>
      </div>
      <form className="new-cat" onSubmit={search}>
        <input id="hotelq" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ホテル名（例：シェラトン）" />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'さがしています…' : 'さがす'}</button>
      </form>
      {err && <p className="err">{err}</p>}
      {list.length > 0 && (
        <ul className="hotel-list">
          {list.map((h) => (
            <li key={h.placeId}>
              <button type="button" onClick={() => onPick({ placeId: h.placeId, name: h.name, altName: h.altName, address: h.address, lat: h.lat, lng: h.lng, mapsUrl: h.mapsUrl })}>
                <b>{h.name}</b>
                {h.altName && <span>{h.altName}</span>}
                <span className="addr">{h.address}</span>
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
  }, [itemId, ver]);
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
                <button type="button" className="btn" onClick={async () => { await deletePhoto(big.id); setBig(null); setPhotos((ps) => ps.filter((x) => x.id !== big.id)); }}>削除する</button>
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
      const r = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, here, hotel, items: payload, localTime: localTimeLabel(offset), trip, walk, car }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'AIに聞けませんでした');
      setRes(d);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <button type="button" className="ai-open" onClick={() => setOpen(true)}>AIナビゲーター（この後どんな気分）</button>;
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
                    <a href={it.mapsUrl} target="_blank" rel="noopener">Googleマップ</a>
                  </div>
                </div>
              );
            }
            const pl = pk.place;
            return (
              <div className="ai-pick" key={i}>
                <p className="ai-pick-name"><span className="ai-tag near">近く</span>{pl.altName || pl.name}</p>
                <p className="ai-sub">{pl.name}{pl.rating != null ? `　★${pl.rating.toFixed(1)}（${pl.reviews.toLocaleString()}件）` : ''}</p>
                <p className="ai-reason">{pk.reason}</p>
                <div className="acts side-acts-inline">
                  <a href={pl.mapsUrl} target="_blank" rel="noopener">Googleマップ</a>
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
  const sentinel = useRef(null);
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
  const [confirmId, setConfirmId] = useState(null);
  const [openDetail, setOpenDetail] = useState(null);
  const [customCats, setCustomCats] = useState([]);
  const [pickFor, setPickFor] = useState(null); // 's:placeId'（候補に追加）/ 'l:id'（カテゴリー変更）
  const [catFilter, setCatFilter] = useState('すべて');
  const [editCats, setEditCats] = useState(false);
  const [view, setView] = useState('list'); // 'list' / 'map'
  const [memoFor, setMemoFor] = useState(null);
  const [reviewFor, setReviewFor] = useState(null);
  const [hotels, setHotels] = useState({}); // 旅行先 → ホテル
  const [hotelEdit, setHotelEdit] = useState(false);
  const [photoVer, setPhotoVer] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(null);
  async function onPhotos(itemId, files, kind) {
    if (!files?.length) return;
    setPhotoBusy(itemId);
    try { await addPhotos(itemId, Array.from(files), kind); } catch {}
    setPhotoBusy(null);
    setPhotoVer((v) => v + 1);
  }
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60000); return () => clearInterval(t); }, []);
  const toggleDetail = (k) => setOpenDetail((cur) => (cur === k ? null : k));

  useEffect(() => {
    // フォルダが決まっていないお店は「未分類」に入れる（消えて見えないように）
    const fixTrip = (arr) => arr.map((i) => (i.trip ? i : { ...i, trip: '未分類' }));
    try { const s = localStorage.getItem(KEY); if (s) setItems(fixTrip(JSON.parse(s))); } catch {}
    try { const c = localStorage.getItem(CATS_KEY); if (c) setCustomCats(JSON.parse(c)); } catch {}
    try { const h = localStorage.getItem('trippin.hotels'); if (h) setHotels(JSON.parse(h)); } catch {}
    try {
      const f = JSON.parse(localStorage.getItem('trippin.folders') || '[]');
      const its = fixTrip(JSON.parse(localStorage.getItem(KEY) || '[]'));
      const merged = [...new Set([...f, ...its.map((i) => i.trip).filter(Boolean)])];
      setFolders(merged);
      const cur = localStorage.getItem('trippin.folder');
      setTrip(cur && merged.includes(cur) ? cur : merged[0] || '');
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(CATS_KEY, JSON.stringify(customCats)); } catch {}
  }, [customCats, loaded]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem('trippin.hotels', JSON.stringify(hotels)); } catch {}
  }, [hotels, loaded]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem('trippin.folders', JSON.stringify(folders)); localStorage.setItem('trippin.folder', trip); } catch {}
  }, [folders, trip, loaded]);
  function createFolder(n) {
    setFolders((prev) => (prev.includes(n) ? prev : [...prev, n]));
    setTrip(n);
  }
  function renameFolder(from, to) {
    setFolders((prev) => prev.map((f) => (f === from ? to : f)).filter((f, i, a) => a.indexOf(f) === i));
    setItems((prev) => prev.map((i) => (i.trip === from ? { ...i, trip: to } : i)));
    setHotels((prev) => { const n = { ...prev }; if (n[from]) { n[to] = n[from]; delete n[from]; } return n; });
    setTrip(to);
  }
  function deleteFolder(name) {
    const gone = items.filter((i) => i.trip === name).map((i) => i.id);
    setItems((prev) => prev.filter((i) => i.trip !== name));
    gone.forEach((id) => deletePhotosOf(id).catch(() => {}));
    setHotels((prev) => { const n = { ...prev }; delete n[name]; return n; });
    const rest = allFolders.filter((f) => f !== name);
    setFolders(rest);
    setTrip(rest[0] || '');
  }
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
  }, [items, loaded]);

  async function runSearch(more = false, override = null) {
    if (busy) return;
    const q = more ? lastQuery.current : { keyword, area, country, minRating: Number(minRating), minReviews: Number(minReviews), ...(override || {}) };
    if (!more && !String(q.keyword).trim() && !String(q.area).trim()) { setError('キーワードか場所を入力してください'); return; }
    setBusy(true); setMoreBusy(more); setError('');
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...q, pageToken: more ? nextToken : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '検索に失敗しました');
      lastQuery.current = q;
      setResults((prev) => (more ? prev.concat(data.places) : data.places));
      setNextToken(data.nextPageToken);
      setSearched(true);
      if (!more) setSearchSeq((n) => n + 1);
    } catch (e) {
      setError(e.message);
    } finally {
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
    setKeyword(sh.name); setArea(sh.city); setCountry(sh.country);
    runSearch(false, { keyword: sh.name, area: sh.city, country: sh.country });
  }

  async function readShot(file) {
    if (!file) return;
    shotFile.current = file;
    setShotBusy(true); setShotShops([]); setShotMsg(''); setError('');
    try {
      const image = await shrink(file);
      const res = await fetch('/api/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, mimeType: 'image/jpeg' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '読み取りに失敗しました');
      if (!data.shops.length) { setShotMsg('お店の名前を読み取れませんでした。店名が写っているスクショで試すか、キーワードに入れて探してください。'); return; }
      setShotShops(data.shops);
      if (data.shops.length === 1) searchShop(data.shops[0]);
    } catch (e) {
      setShotMsg(e.message);
    } finally {
      setShotBusy(false);
      if (shotInput.current) shotInput.current.value = '';
    }
  }

  // 下までスクロールしたら次の20件
  useEffect(() => {
    if (!sentinel.current || !nextToken) return;
    const ob = new IntersectionObserver((es) => { if (es[0].isIntersecting) runSearch(true); }, { rootMargin: '200px' });
    ob.observe(sentinel.current);
    return () => ob.disconnect();
  });

  const sorted = [...results];
  if (sort === 'rating') sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  if (sort === 'reviews') sorted.sort((a, b) => b.reviews - a.reviews);
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
    let folder = tripName || trip;
    if (!folder) { folder = area.trim() || countryName(country) || '未分類'; createFolder(folder); }
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
    setItems((prev) => prev.map((i) => (i.category === from ? { ...i, category: to } : i)));
    if (catFilter === from) setCatFilter(to);
  }
  function deleteCat(name) {
    setCustomCats((prev) => prev.filter((c) => c !== name));
    setItems((prev) => prev.map((i) => (i.category === name ? { ...i, category: '' } : i)));
    if (catFilter === name) setCatFilter('すべて');
  }
  // 候補・行ったのお店の営業時間を取っておく（7日たったら取り直す）
  const hoursBusy = useRef(false);
  useEffect(() => {
    if (!loaded || hoursBusy.current) return;
    const need = items.filter((i) => i.placeId && (!i.hoursInfo || Date.now() - i.hoursInfo.at > 7 * 864e5));
    if (!need.length) return;
    hoursBusy.current = true;
    (async () => {
      for (const it of need) {
        try {
          const r = await fetch(`/api/details?id=${encodeURIComponent(it.placeId)}`);
          const d = await r.json();
          if (d.error) continue;
          detailCache.set(it.placeId, d);
          const hoursInfo = { hours: d.hours || [], periods: d.periods || [], offset: d.offset || 0, at: Date.now() };
          setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, hoursInfo } : x)));
        } catch {}
      }
      hoursBusy.current = false;
    })();
  }, [items, loaded]);

  function update(id, patch) { setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i))); }
  function remove(id) { setItems((prev) => prev.filter((i) => i.id !== id)); setConfirmId(null); deletePhotosOf(id).catch(() => {}); }

  const trips = folders;
  const allFolders = [...new Set([...folders, ...items.map((i) => i.trip).filter(Boolean)])];
  const folderCounts = {};
  items.forEach((i) => { folderCounts[i.trip] = (folderCounts[i.trip] || 0) + 1; });
  const inTrip = items.filter((i) => i.trip === trip && (catFilter === 'すべて' || (catFilter === 'なし' ? !i.category : i.category === catFilter)));
  const usedCats = [...new Set(items.filter((i) => i.trip === trip).map((i) => i.category || 'なし'))];
  const catOrder = [...BASE_CATS.map(([n]) => n), ...customCats, 'なし'];
  usedCats.sort((a, b) => catOrder.indexOf(a) - catOrder.indexOf(b));
  const cand = inTrip.filter((i) => !i.done);
  const done = inTrip.filter((i) => i.done).sort((a, b) => (b.rec ? 1 : 0) - (a.rec ? 1 : 0));
  const shown = tab === 'cand' ? cand : done;
  const hotelTrip = trip || null;
  const mapHotels = useMemo(() => [hotelTrip && hotels[hotelTrip]].filter(Boolean), [hotels, hotelTrip]);
  const mapKey = shown.map((i) => `${i.id}:${i.category}:${i.done}:${i.rec}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mapItems = useMemo(() => shown, [mapKey]);

  function ListCard({ it, no }) {
    const src = sourceLabel(it.srcUrl);
    return (
      <article key={it.id} id={'item-' + it.id} className={'item' + (it.done ? ' done' : '')}>
        <div className="item-top">
          <div className="thumbwrap side">
            <button type="button" className="thumbbtn" onClick={() => toggleDetail('l:' + it.id)} aria-label="詳細を見る">
              {it.photo ? <img className="thumb" src={photoSrc(it.photo)} alt="" loading="lazy" /> : <div className="thumb" />}
            </button>
            <span className="no" style={{ '--c': catColor(it.category) }}>{no}</span>
            {it.done && (
              <button className={'star photo-star' + (it.rec ? ' on' : '')} aria-label="おすすめマーク" aria-pressed={!!it.rec} onClick={() => update(it.id, { rec: !it.rec })}>★</button>
            )}
            <div className="side-acts">
              <a href={it.mapsUrl} target="_blank" rel="noopener">Googleマップ</a>
              {it.done
                ? <button onClick={() => update(it.id, { done: false, rec: false })}>候補に戻す</button>
                : <button className="go" onClick={() => update(it.id, { done: true })}>行った</button>}
              <button onClick={() => setMemoFor(memoFor === it.id ? null : it.id)}>{it.memo ? 'メモを直す' : 'メモ'}</button>
              <label className="photo-add">
                {photoBusy === it.id ? '保存中…' : it.done ? '写真を追加' : 'メモ画像を追加'}
                <input type="file" accept="image/*" multiple hidden onChange={(e) => { onPhotos(it.id, e.target.files, it.done ? 'visit' : 'memo'); e.target.value = ''; }} />
              </label>
              {it.srcUrl && <a href={it.srcUrl} target="_blank" rel="noopener">元の投稿</a>}
              {confirmId === it.id ? (
                <div className="side-confirm">
                  <span>削除しますか？</span>
                  <button className="del-yes" onClick={() => remove(it.id)}>削除する</button>
                  <button onClick={() => setConfirmId(null)}>やめる</button>
                </div>
              ) : (
                <button className="del" onClick={() => setConfirmId(it.id)}>削除</button>
              )}
            </div>
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
            {fromHotel(hotels[it.trip], it) && <p className="fromhotel">{fromHotel(hotels[it.trip], it)}</p>}
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
      <header>
        <h1>Trip<span>pin</span></h1>
        <div className="tag">行きたい場所リスト</div>
      </header>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'search'} onClick={() => setTab('search')}>さがす</button>
        <button role="tab" aria-selected={tab === 'cand'} onClick={() => setTab('cand')}>候補 <span className="count">{cand.length}</span></button>
        <button role="tab" aria-selected={tab === 'done'} onClick={() => setTab('done')}>行った <span className="count">{done.length}</span></button>
      </div>

      {tab === 'search' && (
        <>
          <form className="panel" onSubmit={(e) => { e.preventDefault(); shotFile.current = null; setShotShops([]); runSearch(false); }}>
            <h2>Googleマップでお店をさがす</h2>
            <label htmlFor="kw">キーワード・店名
              <input id="kw" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="例：魯肉飯" />
            </label>
            <div className="row">
              <label htmlFor="ct">国（任意）
                <select id="ct" value={country} onChange={(e) => setCountry(e.target.value)}>
                  {COUNTRY_LIST.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label htmlFor="area">場所
                <input id="area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="例：台北" />
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
<div className="shot">
              <input ref={shotInput} id="shot" type="file" accept="image/*" hidden onChange={(e) => readShot(e.target.files?.[0])} />
              <button type="button" className="btn ghost" disabled={shotBusy} onClick={() => shotInput.current?.click()}>
                {shotBusy ? 'スクショを読み取っています…' : 'スクショからさがす'}
              </button>
              <p className="shot-lead">SNSのスクショ画像から独自AIが店名・街・国を読み取って検索</p>
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
            <button className="btn" type="submit" disabled={busy}>{busy && !moreBusy ? 'さがしています…' : 'さがす'}</button>
            <p className="hint">国を選ぶと、その国の中だけを探します。</p>
            {error && <p className="err">{error}</p>}
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
                </select>
              </div>
            )}
            {hereMsg && <p className="hint">{hereMsg}</p>}
            {searched && !sorted.length && <div className="empty">条件に合うお店が見つかりませんでした。<br />評価やレビューの条件をゆるめてみてください。</div>}
            {sorted.map((p) => (
              <article className="item" key={p.placeId}>
                <div className="item-top">
                  <div className="thumbwrap side">
                    <button type="button" className="thumbbtn" onClick={() => toggleDetail('s:' + p.placeId)} aria-label="詳細を見る">
                      {p.photo ? <img className="thumb" src={photoSrc(p.photo)} alt="" loading="lazy" /> : <div className="thumb" />}
                    </button>
                    <div className="side-acts">
                      <a href={p.mapsUrl} target="_blank" rel="noopener">Googleマップ</a>
                      {savedIds.has(p.placeId)
                        ? <button className="added" disabled>追加済み</button>
                        : <button className="add" aria-expanded={pickFor === 's:' + p.placeId} onClick={() => setPickFor(pickFor === 's:' + p.placeId ? null : 's:' + p.placeId)}>候補に追加 ▾</button>}
                      {pickFor === 's:' + p.placeId && !savedIds.has(p.placeId) && (
                        <CategoryDropdown customCats={customCats} onAddCustom={addCustomCat}
                          onPick={(c) => addCandidate(p, c)} onClose={closePick} />
                      )}
                    </div>
                  </div>
                  <div className="body">
                    <NameBlock p={p} />
                    <Rating p={p} />
                    {sort === 'near' && here && p.lat != null && <p className="dist">現在地から{distanceKm(here, p).toFixed(1)}km</p>}
                  </div>
                </div>
                <button type="button" className={'detailbar' + (openDetail === 's:' + p.placeId ? ' on' : '')} onClick={() => toggleDetail('s:' + p.placeId)}>
                  {openDetail === 's:' + p.placeId ? '詳細を閉じる' : '詳細を開く'}
                </button>
                {openDetail === 's:' + p.placeId && <DetailPanel id={p.placeId} />}
              </article>
            ))}
            {nextToken && <div ref={sentinel} className="more">{busy ? '読み込み中…' : ''}</div>}
          </div>
        </>
      )}

      {tab !== 'search' && (
        <>
          <FolderBar folders={allFolders} current={trip} counts={folderCounts} onSelect={(f) => { setTrip(f); setCatFilter('すべて'); }}
            onCreate={createFolder} onRename={renameFolder} onDelete={deleteFolder} />
          {usedCats.length > 0 && (
            <div className="chips cat-filter">
              {['すべて', ...usedCats].map((c) => (
                <button key={c} aria-pressed={c === catFilter} style={c !== 'すべて' && c !== 'なし' ? { '--c': catColor(c) } : undefined}
                  className={c !== 'すべて' && c !== 'なし' ? 'dot' : ''} onClick={() => setCatFilter(c)}>{c}</button>
              ))}
              <button className="edit-cats" aria-pressed={editCats} onClick={() => setEditCats((v) => !v)}>カテゴリーの編集</button>
            </div>
          )}
          {tab === 'cand' && cand.length > 0 && (
            <AiPanel items={cand} hotel={hotelTrip ? hotels[hotelTrip] : null} trip={hotelTrip || ''} customCats={customCats} onAddCustom={addCustomCat}
              savedIds={savedIds} onAdd={(pl, c) => addCandidate(pl, c, trip || null)}
              onShow={(id) => { setView('list'); setTimeout(() => document.getElementById('item-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }} />
          )}
          {trips.length > 0 && (
            <div className="hotelbar">
              {hotelTrip ? (
                hotels[hotelTrip] ? (
                  <>
                    <span className="hb-label">ホテル</span>
                    <span className="hb-name">{hotels[hotelTrip].name}</span>
                    <button type="button" onClick={() => setHotelEdit((v) => !v)}>変更</button>
                  </>
                ) : (
                  <>
                    <span className="hb-label">ホテル</span>
                    <span className="hb-none">{hotelTrip}のホテルは未設定</span>
                    <button type="button" className="hb-set" onClick={() => setHotelEdit((v) => !v)}>ホテルを設定</button>
                  </>
                )
              ) : (
                <span className="hb-none">上で旅行先を選ぶと、泊まるホテルを設定できます</span>
              )}
            </div>
          )}
          {hotelEdit && hotelTrip && (
            <HotelPicker trip={hotelTrip} current={hotels[hotelTrip]}
              onPick={(h) => { setHotels((prev) => ({ ...prev, [hotelTrip]: h })); setHotelEdit(false); }}
              onClear={() => { setHotels((prev) => { const n = { ...prev }; delete n[hotelTrip]; return n; }); setHotelEdit(false); }}
              onClose={() => setHotelEdit(false)} />
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
          {view === 'map' && (shown.length > 0 || mapHotels.length > 0) && <MapView items={mapItems} colorOf={catColor} photoSrc={photoSrc} hotels={mapHotels} />}
          <div className="list">
            {shown.map((it, i) => ListCard({ it, no: i + 1 }))}
            {loaded && (tab === 'cand' ? cand : done).length === 0 && (
              <div className="empty">
                {tab === 'cand'
                  ? <>まだ候補がありません。<br />「さがす」からお店を見つけて追加してください。</>
                  : <>まだ行ったお店はありません。<br />候補のお店で「行った」を押すとここに移ります。</>}
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
