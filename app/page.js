'use client';
import { useEffect, useRef, useState } from 'react';

const KEY = 'trippin.v1';

const COUNTRY_LIST = [
  ['', '指定なし'], ['TW', '台湾'], ['KR', '韓国'], ['HK', '香港'], ['CN', '中国'], ['VN', 'ベトナム'],
  ['TH', 'タイ'], ['SG', 'シンガポール'], ['MY', 'マレーシア'], ['PH', 'フィリピン'], ['JP', '日本'],
];
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
  const [srcUrl, setSrcUrl] = useState('');
  const [results, setResults] = useState([]);
  const [nextToken, setNextToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const lastQuery = useRef(null);
  const sentinel = useRef(null);

  // リスト
  const [trip, setTrip] = useState('すべて');
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => {
    try { const s = localStorage.getItem(KEY); if (s) setItems(JSON.parse(s)); } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
  }, [items, loaded]);

  async function runSearch(more = false) {
    if (busy) return;
    const q = more ? lastQuery.current : { keyword, area, country, minRating: Number(minRating), minReviews: Number(minReviews) };
    if (!more && !keyword.trim() && !area.trim()) { setError('キーワードか場所を入力してください'); return; }
    setBusy(true); setError('');
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
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
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
  function addCandidate(p) {
    if (savedIds.has(p.placeId)) return;
    setItems((prev) => [{ ...p, id: p.placeId, trip: area.trim() || countryName(country) || '未分類', srcUrl: srcUrl.trim(), done: false, rec: false, addedAt: Date.now() }, ...prev]);
  }
  function update(id, patch) { setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i))); }
  function remove(id) { setItems((prev) => prev.filter((i) => i.id !== id)); setConfirmId(null); }

  const trips = [...new Set(items.map((i) => i.trip))];
  const inTrip = items.filter((i) => trip === 'すべて' || i.trip === trip);
  const cand = inTrip.filter((i) => !i.done);
  const done = inTrip.filter((i) => i.done).sort((a, b) => (b.rec ? 1 : 0) - (a.rec ? 1 : 0));

  function ListCard({ it }) {
    const src = sourceLabel(it.srcUrl);
    return (
      <article className={'item' + (it.done ? ' done' : '')}>
        {it.photo ? <img className="thumb" src={photoSrc(it.photo)} alt="" loading="lazy" /> : <div className="thumb" />}
        <div className="body">
          <div className="top">
            <div>
              <p className="name">{it.name}</p>
              {it.altName && <p className="alt">{it.altName}</p>}
            </div>
            {it.done && (
              <button className={'star' + (it.rec ? ' on' : '')} aria-label="おすすめマーク" aria-pressed={!!it.rec} onClick={() => update(it.id, { rec: !it.rec })}>★</button>
            )}
          </div>
          <Rating p={it} />
          <span className="meta">
            <span className="pill">{it.trip}</span>
            {src && <span className="pill">{src}で発見</span>}
            {it.done && it.rec && <span className="pill" style={{ color: 'var(--star)' }}>おすすめ</span>}
          </span>
          {confirmId === it.id ? (
            <div className="confirm">
              削除しますか？
              <button className="btn" onClick={() => remove(it.id)}>削除する</button>
              <button className="btn ghost" onClick={() => setConfirmId(null)}>やめる</button>
            </div>
          ) : (
            <div className="acts">
              <a href={it.mapsUrl} target="_blank" rel="noopener">Googleマップ</a>
              {it.srcUrl && <a href={it.srcUrl} target="_blank" rel="noopener">元の投稿</a>}
              {it.done
                ? <button onClick={() => update(it.id, { done: false, rec: false })}>候補に戻す</button>
                : <button className="go" onClick={() => update(it.id, { done: true })}>行った</button>}
              <button className="del" onClick={() => setConfirmId(it.id)}>削除</button>
            </div>
          )}
        </div>
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
            <label htmlFor="src">見つけた投稿のURL（任意・YouTubeやインスタ）
              <input id="src" type="url" inputMode="url" value={srcUrl} onChange={(e) => setSrcUrl(e.target.value)} placeholder="https://" />
            </label>
            <button className="btn" type="submit" disabled={busy}>{busy && !results.length ? 'さがしています…' : 'さがす'}</button>
            <p className="hint">国を選ぶと、その国の中だけを探します。候補に追加したお店は、「場所」（空なら国）の名前のリストにまとまります。</p>
            {error && <p className="err">{error}</p>}
          </form>

          <div className="list">
            {searched && !sorted.length && <div className="empty">条件に合うお店が見つかりませんでした。<br />評価やレビューの条件をゆるめてみてください。</div>}
            {sorted.map((p) => (
              <article className="item" key={p.placeId}>
                {p.photo ? <img className="thumb" src={photoSrc(p.photo)} alt="" loading="lazy" /> : <div className="thumb" />}
                <div className="body">
                  <div>
                    <p className="name">{p.name}</p>
                    {p.altName && <p className="alt">{p.altName}</p>}
                  </div>
                  <Rating p={p} />
                  <div>
                    <p className="addr">{p.address}</p>
                    {p.altAddress && <p className="addr alt-addr">{p.altAddress}</p>}
                  </div>
                  <div className="acts">
                    {savedIds.has(p.placeId)
                      ? <button className="added" disabled>候補に追加済み</button>
                      : <button className="add" onClick={() => addCandidate(p)}>候補に追加</button>}
                    <a href={p.mapsUrl} target="_blank" rel="noopener">Googleマップ</a>
                  </div>
                </div>
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
          <div className="list">
            {(tab === 'cand' ? cand : done).map((it) => <ListCard key={it.id} it={it} />)}
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
