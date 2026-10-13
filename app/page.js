'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import MapView from './MapView';

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
  const all = [...BASE_CATS.map(([n]) => n), ...customCats];
  function submitNew(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (!all.includes(n)) onAddCustom(n);
    onPick(n);
  }
  return (
    <div className="picker">
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

const countryName = (c) => (COUNTRY_LIST.find(([k]) => k === c) || [, ''])[1];

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
  return (
    <div className="nb">
      <div className="line">
        <p className="name">{p.name}</p>
        <CopyBtn text={p.name} label="店名" />
      </div>
      {p.altName && <p className="alt">{p.altName}</p>}
      {withAddress && p.address && (
        <div className="line addr-line">
          <p className="addr">{p.address}</p>
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
  const srcUrl = '';
  const [shotBusy, setShotBusy] = useState(false);
  const [shotShops, setShotShops] = useState([]);
  const [shotMsg, setShotMsg] = useState('');
  const shotInput = useRef(null);
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
  const [trip, setTrip] = useState('すべて');
  const [confirmId, setConfirmId] = useState(null);
  const [openDetail, setOpenDetail] = useState(null);
  const [customCats, setCustomCats] = useState([]);
  const [pickFor, setPickFor] = useState(null); // 's:placeId'（候補に追加）/ 'l:id'（カテゴリー変更）
  const [catFilter, setCatFilter] = useState('すべて');
  const [editCats, setEditCats] = useState(false);
  const [view, setView] = useState('list'); // 'list' / 'map'
  const toggleDetail = (k) => setOpenDetail((cur) => (cur === k ? null : k));

  useEffect(() => {
    try { const s = localStorage.getItem(KEY); if (s) setItems(JSON.parse(s)); } catch {}
    try { const c = localStorage.getItem(CATS_KEY); if (c) setCustomCats(JSON.parse(c)); } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(CATS_KEY, JSON.stringify(customCats)); } catch {}
  }, [customCats, loaded]);
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

  const savedIds = new Set(items.map((i) => i.placeId));
  function addCandidate(p, category = '') {
    if (savedIds.has(p.placeId)) return;
    setItems((prev) => [{ ...p, id: p.placeId, category, trip: area.trim() || countryName(country) || '未分類', srcUrl: srcUrl.trim(), done: false, rec: false, addedAt: Date.now() }, ...prev]);
    setPickFor(null);
  }
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
  function update(id, patch) { setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i))); }
  function remove(id) { setItems((prev) => prev.filter((i) => i.id !== id)); setConfirmId(null); }

  const trips = [...new Set(items.map((i) => i.trip))];
  const inTrip = items.filter((i) => (trip === 'すべて' || i.trip === trip) && (catFilter === 'すべて' || (catFilter === 'なし' ? !i.category : i.category === catFilter)));
  const usedCats = [...new Set(items.filter((i) => trip === 'すべて' || i.trip === trip).map((i) => i.category || 'なし'))];
  const catOrder = [...BASE_CATS.map(([n]) => n), ...customCats, 'なし'];
  usedCats.sort((a, b) => catOrder.indexOf(a) - catOrder.indexOf(b));
  const cand = inTrip.filter((i) => !i.done);
  const done = inTrip.filter((i) => i.done).sort((a, b) => (b.rec ? 1 : 0) - (a.rec ? 1 : 0));
  const shown = tab === 'cand' ? cand : done;
  const mapKey = shown.map((i) => `${i.id}:${i.category}:${i.done}:${i.rec}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mapItems = useMemo(() => shown, [mapKey]);

  function ListCard({ it, no }) {
    const src = sourceLabel(it.srcUrl);
    return (
      <article className={'item' + (it.done ? ' done' : '')}>
        <div className="item-top">
          <div className="thumbwrap">
            <button type="button" className="thumbbtn" onClick={() => toggleDetail('l:' + it.id)} aria-label="詳細を見る">
              {it.photo ? <img className="thumb" src={photoSrc(it.photo)} alt="" loading="lazy" /> : <div className="thumb" />}
            </button>
            <span className="no" style={{ '--c': catColor(it.category) }}>{no}</span>
          </div>
          <div className="body">
            <div className="top">
              <NameBlock p={it} />
              {it.done && (
                <button className={'star' + (it.rec ? ' on' : '')} aria-label="おすすめマーク" aria-pressed={!!it.rec} onClick={() => update(it.id, { rec: !it.rec })}>★</button>
              )}
            </div>
            <Rating p={it} />
            <span className="meta">
              <button type="button" className={'cat small' + (it.category ? ' sel' : ' none')} style={{ '--c': catColor(it.category) }} onClick={() => setPickFor(pickFor === 'l:' + it.id ? null : 'l:' + it.id)}>{it.category || 'カテゴリーなし'} ▾</button>
              <span className="pill">{it.trip}</span>
              {src && <span className="pill">{src}で発見</span>}
              {it.done && it.rec && <span className="pill" style={{ color: 'var(--star)' }}>おすすめ</span>}
            </span>
          </div>
        </div>
        {confirmId === it.id ? (
          <div className="confirm">
            削除しますか？
            <button className="btn" onClick={() => remove(it.id)}>削除する</button>
            <button className="btn ghost" onClick={() => setConfirmId(null)}>やめる</button>
          </div>
        ) : (
          <div className="acts">
            <button className={openDetail === 'l:' + it.id ? 'on' : ''} onClick={() => toggleDetail('l:' + it.id)}>{openDetail === 'l:' + it.id ? '詳細を閉じる' : '詳細'}</button>
            <a href={it.mapsUrl} target="_blank" rel="noopener">Googleマップ</a>
            {it.srcUrl && <a href={it.srcUrl} target="_blank" rel="noopener">元の投稿</a>}
            {it.done
              ? <button onClick={() => update(it.id, { done: false, rec: false })}>候補に戻す</button>
              : <button className="go" onClick={() => update(it.id, { done: true })}>行った</button>}
            <button className="del" onClick={() => setConfirmId(it.id)}>削除</button>
          </div>
        )}
        {pickFor === 'l:' + it.id && (
          <CategoryPicker title="カテゴリーを変える" customCats={customCats} current={it.category} onAddCustom={addCustomCat}
            onPick={(c) => { update(it.id, { category: c }); setPickFor(null); }} onClose={() => setPickFor(null)} />
        )}
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
          <form className="panel" onSubmit={(e) => { e.preventDefault(); runSearch(false); }}>
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
            <div className="row3">
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
              <label htmlFor="so">並び順
                <select id="so" value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="relevance">おすすめ順</option>
                  <option value="rating">評価が高い順</option>
                  <option value="reviews">レビューが多い順</option>
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
            <p className="hint">国を選ぶと、その国の中だけを探します。候補に追加したお店は、「場所」（空なら国）の名前のリストにまとまります。</p>
            {error && <p className="err">{error}</p>}
          </form>

          <div className="list" ref={resultsTop} style={{ scrollMarginTop: '72px' }}>
            {searched && sorted.length > 0 && <p className="result-head">{sorted.length}{nextToken ? '件以上' : '件'}見つかりました</p>}
            {searched && !sorted.length && <div className="empty">条件に合うお店が見つかりませんでした。<br />評価やレビューの条件をゆるめてみてください。</div>}
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
                  </div>
                </div>
                <div className="acts">
                  <button className={openDetail === 's:' + p.placeId ? 'on' : ''} onClick={() => toggleDetail('s:' + p.placeId)}>{openDetail === 's:' + p.placeId ? '詳細を閉じる' : '詳細'}</button>
                  {savedIds.has(p.placeId)
                    ? <button className="added" disabled>候補に追加済み</button>
                    : <button className="add" onClick={() => setPickFor(pickFor === 's:' + p.placeId ? null : 's:' + p.placeId)}>候補に追加</button>}
                  <a href={p.mapsUrl} target="_blank" rel="noopener">Googleマップ</a>
                </div>
                {pickFor === 's:' + p.placeId && !savedIds.has(p.placeId) && (
                  <CategoryPicker title="カテゴリーを選んで追加" customCats={customCats} current={null} onAddCustom={addCustomCat}
                    onPick={(c) => addCandidate(p, c)} onClose={() => setPickFor(null)} />
                )}
                {openDetail === 's:' + p.placeId && <DetailPanel id={p.placeId} />}
              </article>
            ))}
            {nextToken && <div ref={sentinel} className="more">{busy ? '読み込み中…' : ''}</div>}
          </div>
        </>
      )}

      {tab !== 'search' && (
        <>
          {trips.length > 1 && (
            <div className="chips">
              {['すべて', ...trips].map((t) => (
                <button key={t} aria-pressed={t === trip} onClick={() => setTrip(t)}>{t}</button>
              ))}
            </div>
          )}
          {usedCats.length > 0 && (
            <div className="chips cat-filter">
              {['すべて', ...usedCats].map((c) => (
                <button key={c} aria-pressed={c === catFilter} style={c !== 'すべて' && c !== 'なし' ? { '--c': catColor(c) } : undefined}
                  className={c !== 'すべて' && c !== 'なし' ? 'dot' : ''} onClick={() => setCatFilter(c)}>{c}</button>
              ))}
              <button className="edit-cats" aria-pressed={editCats} onClick={() => setEditCats((v) => !v)}>カテゴリーの編集</button>
            </div>
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
          {view === 'map' && shown.length > 0 && <MapView items={mapItems} colorOf={catColor} photoSrc={photoSrc} />}
          <div className="list">
            {shown.map((it, i) => <ListCard key={it.id} it={it} no={i + 1} />)}
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
