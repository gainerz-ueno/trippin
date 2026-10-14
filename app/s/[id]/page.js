'use client';
// 共有リンクで見るページ（ログインもパスワードもいらない。見るだけ）
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import MapView from '../../MapView';
import { fetchShared } from '../../cloud';
import { safeUrl } from '../../lib/safeurl';

const BASE_CATS = {
  観光: '#2F7D6B', 朝市: '#C9822B', 夜市: '#5B4BA8', 朝食: '#E0A526', 昼食: '#D9692E', 夕食: '#B8432F', 夜食: '#3F4F86',
  おやつ: '#D45C8C', カフェ: '#8A5A3C', 酒場: '#8E2F4F', 買物: '#2E7FB8', 美容: '#C2569E', マッサージ: '#4E9A5B',
};
const catColor = (c) => BASE_CATS[c] || '#6B7A8C';
const photoSrc = (name) => (name ? `/api/photo?name=${encodeURIComponent(name)}` : null);

function localNow(offset = 0) {
  const d = new Date(Date.now() + offset * 60000);
  return { day: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
function openState(h) {
  if (!h?.periods?.length) return null;
  if (h.periods.length === 1 && !h.periods[0].close) return true;
  const { day, min } = localNow(h.offset);
  const now = day * 1440 + min, W = 7 * 1440;
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
  return (h.hours[(localNow(h.offset).day + 6) % 7] || '').replace(/^[^:：]+[:：]\s*/, '');
}

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch {} t.remove();
    }
    setDone(true); setTimeout(() => setDone(false), 1500);
  }
  return <button type="button" className={'copy' + (done ? ' ok' : '')} onClick={copy}>{done ? 'コピーしました' : 'コピー'}</button>;
}

export default function SharedFolder() {
  const params = useParams();
  const [data, setData] = useState(undefined);
  const [tab, setTab] = useState('cand');
  const [view, setView] = useState('list');
  useEffect(() => {
    (/^[A-Za-z0-9]{10}$/.test(params.id || '') ? fetchShared(params.id) : Promise.resolve(null)).then((d) => setData(d || null)).catch(() => setData(null));
  }, [params.id]);
  const items = data?.items || [];
  const cand = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done).sort((a, b) => (b.rec ? 1 : 0) - (a.rec ? 1 : 0));
  const shown = tab === 'cand' ? cand : done;
  const mapItems = useMemo(() => shown, [tab, data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="wrap">
      <header>
        <h1 className="logo"><img src="/logo.png" alt="Tabibi" width="720" height="168" /></h1>
        <div className="tag">共有されたリスト</div>
      </header>
      {data === undefined && <p className="hint">読み込み中…</p>}
      {data === null && <div className="empty">このリンクは見られません。<br />共有がやめられたか、リンクがまちがっています。</div>}
      {data && (
        <>
          <h2 className="share-title">{data.folder}</h2>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'cand'} onClick={() => setTab('cand')}>候補 <span className="count">{cand.length}</span></button>
            <button role="tab" aria-selected={tab === 'done'} onClick={() => setTab('done')}>行った <span className="count">{done.length}</span></button>
          </div>
          <div className="viewtoggle" role="tablist" aria-label="表示の切り替え">
            <button role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>リスト</button>
            <button role="tab" aria-selected={view === 'map'} onClick={() => setView('map')}>地図</button>
          </div>
          {view === 'map' && shown.length > 0 && <MapView items={mapItems} colorOf={catColor} photoSrc={photoSrc} hotels={[]} />}
          <div className="list">
            {shown.length === 0 && <div className="empty">{tab === 'cand' ? 'まだお店がありません。' : 'まだ行ったお店はありません。'}</div>}
            {shown.map((it, i) => (
              <article key={it.id} className={'item' + (it.done ? ' done' : '')}>
                <div className="item-top">
                  <div className="thumbwrap side">
                    {it.photo ? <img className="thumb" src={photoSrc(it.photo)} alt="" loading="lazy" /> : <div className="thumb" />}
                    <span className="no" style={{ '--c': catColor(it.category) }}>{i + 1}</span>
                    <div className="side-acts">
                      {safeUrl(it.mapsUrl) && <a href={safeUrl(it.mapsUrl)} target="_blank" rel="noopener noreferrer">Googleマップ</a>}
                    </div>
                  </div>
                  <div className="body">
                    <div className="nb">
                      <div className="line"><p className="name">{it.name}</p><CopyBtn text={it.name} /></div>
                      {it.altName && <p className="alt">{it.altName}</p>}
                      {it.address && <div className="line addr-line"><p className="addr">{it.address}</p><CopyBtn text={it.address} /></div>}
                    </div>
                    <span className="meta">
                      {it.rating != null && <span className="rate"><b>★</b> {Number(it.rating).toFixed(1)} <span className="addr">（{(it.reviews || 0).toLocaleString()}件）</span></span>}
                    </span>
                    {it.hoursInfo && (
                      <p className="today">
                        {openState(it.hoursInfo) === true && <span className="open">営業中</span>}
                        {openState(it.hoursInfo) === false && <span className="closed">営業時間外</span>}
                        <span>{todayHours(it.hoursInfo) ? '今日 ' + todayHours(it.hoursInfo) : '営業時間の情報なし'}</span>
                      </p>
                    )}
                    <span className="meta">
                      {it.category && <span className="cat small sel" style={{ '--c': catColor(it.category) }}>{it.category}</span>}
                      {it.done && it.rec && <span className="pill" style={{ color: 'var(--star)' }}>おすすめ</span>}
                    </span>
                  </div>
                </div>
                {it.done && it.review && (
                  <div className="review"><p className="rv-label">感想</p><p className="review-text">{it.review}</p></div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
