'use client';
// 1日の回る順番（旅程づくり）
// ・日をえらんで、候補・行ったのお店／名所から行き先を足す（足すと時間帯の順＝朝食→観光→昼食…の位置に入る）
// ・宿泊先（ホテル）から出発してホテルに戻る。「近い順に並べ替え」は保存してある位置から計算するだけ（Googleへの問い合わせなし＝無料）
// ・指でつかんで並べ替え／↑↓、場所と場所のあいだの距離、Googleマップの道案内
import { useEffect, useRef, useState } from 'react';
import { leg, dirLink, dayRouteLink, nearestOrder, timeOrder, slotOf } from './lib/geo';

const newId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const dayLabel = (d, i) => `${i + 1}日目${d.date ? `（${fmtDate(d.date)}）` : ''}`;
function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return s;
  const wd = '日月火水木金土'[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()];
  return `${Number(m[2])}/${Number(m[3])}${wd}`;
}
const nm = (it) => it.altName || it.name;

// その日の行き先（消したお店は飛ばす）
export function dayStops(day, items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  return (day?.stops || []).map((id) => byId.get(id)).filter(Boolean);
}

function Leg({ from, to, readOnly }) {
  const l = leg(from, to);
  const href = dirLink(from, to);
  return (
    <li className="pl-leg">
      <span className="pl-line" aria-hidden="true" />
      <span className="pl-leg-t">{l ? l.text : from && from.lat != null ? '距離はわかりません' : !from ? '今いる場所から' : ''}</span>
      {href && <a className="pl-dir" href={href} target="_blank" rel="noopener noreferrer">{readOnly ? '道順' : 'ここへの道順'}</a>}
    </li>
  );
}

export default function PlanView({ plan, items, hotel, colorOf, onChange, onShowMap, readOnly = false, initialDay }) {
  const days = plan?.days || [];
  const [di, setDi] = useState(() => Math.max(0, days.findIndex((d) => d.id === initialDay)));
  const [confirmDel, setConfirmDel] = useState(false);
  const [drag, setDrag] = useState(null); // { id, over }
  const listRef = useRef(null);
  const day = days[Math.min(di, days.length - 1)];
  useEffect(() => { if (di > days.length - 1) setDi(Math.max(0, days.length - 1)); }, [days.length, di]);

  const stops = dayStops(day, items);
  const home = hotel && hotel.lat != null ? hotel : null;

  function save(nextDays) { onChange({ ...(plan || {}), days: nextDays }); }
  function patchDay(patch) { save(days.map((d) => (d.id === day.id ? { ...d, ...patch } : d))); }
  function setStops(list) { patchDay({ stops: list.map((x) => x.id) }); }
  function addDay() {
    const prev = days[days.length - 1];
    let date = '';
    if (prev?.date) { const t = new Date(prev.date + 'T00:00:00'); t.setDate(t.getDate() + 1); date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; }
    save([...days, { id: newId(), date, title: '', stops: [] }]);
    setDi(days.length);
  }
  function removeDay() { save(days.filter((d) => d.id !== day.id)); setDi(Math.max(0, di - 1)); setConfirmDel(false); }
  // 足すときは、時間帯の順（朝食→観光→昼食…）の位置に入れる
  function addStop(it) {
    const s = slotOf(it.category);
    let at = stops.length;
    for (let i = stops.length - 1; i >= 0; i--) { if (slotOf(stops[i].category) <= s) { at = i + 1; break; } if (i === 0) at = 0; }
    const next = [...stops]; next.splice(at, 0, it);
    setStops(next);
  }
  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops]; [next[i], next[j]] = [next[j], next[i]];
    setStops(next);
  }
  // 指でつかんで動かす（つまみ ≡ を押したまま上下に）
  function startDrag(e, id) {
    if (readOnly) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id, over: stops.findIndex((x) => x.id === id) });
  }
  function onDragMove(e) {
    if (!drag || !listRef.current) return;
    const rows = [...listRef.current.querySelectorAll('[data-stop]')];
    let over = rows.length - 1;
    for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { over = i; break; } }
    if (over !== drag.over) setDrag({ ...drag, over });
  }
  function endDrag() {
    if (!drag) return;
    const from = stops.findIndex((x) => x.id === drag.id);
    if (from >= 0 && drag.over !== from) { const next = [...stops]; const [x] = next.splice(from, 1); next.splice(drag.over, 0, x); setStops(next); }
    setDrag(null);
  }

  if (!days.length) {
    if (readOnly) return <div className="empty">回る順番はまだ作られていません。</div>;
    return (
      <div className="plan panel">
        <h2>1日の回る順番</h2>
        <p className="hint">日をえらんで、候補・行ったのお店や名所を足すと、朝食→観光→昼食…の順に並びます。{home ? 'ホテルから出発してホテルに戻る順で、' : ''}「近い順に並べ替え」もできます。</p>
        <button type="button" className="btn" onClick={addDay}>1日目を作る</button>
      </div>
    );
  }

  const inDay = new Set(day.stops);
  const otherDay = new Map();
  days.forEach((d, i) => { if (d.id !== day.id) d.stops.forEach((id) => otherDay.set(id, `${i + 1}日目`)); });
  const pool = items.filter((i) => !inDay.has(i.id));
  const legs = [home, ...stops, home].filter(Boolean);
  let km = 0, min = 0, unknown = false;
  for (let i = 1; i < legs.length; i++) { const l = leg(legs[i - 1], legs[i]); if (l) { km += l.km; min += l.min; } else unknown = true; }
  const route = dayRouteLink(home, stops);
  const shown = drag ? (() => { const a = [...stops]; const f = a.findIndex((x) => x.id === drag.id); const [x] = a.splice(f, 1); a.splice(drag.over, 0, x); return a; })() : stops;

  return (
    <div className="plan panel">
      {!readOnly && <h2>1日の回る順番</h2>}
      <div className="pl-days" role="tablist" aria-label="日をえらぶ">
        {days.map((d, i) => (
          <button key={d.id} type="button" role="tab" aria-selected={d.id === day.id} onClick={() => { setDi(i); setConfirmDel(false); }}>
            {dayLabel(d, i)}<small>{d.stops.length}か所</small>
          </button>
        ))}
        {!readOnly && <button type="button" className="pl-add-day" onClick={addDay}>＋ 日を足す</button>}
      </div>
      {readOnly ? (day.title && <p className="pl-title-ro">{day.title}</p>) : (
        <div className="pl-meta">
          <label>日付<input type="date" value={day.date || ''} onChange={(e) => patchDay({ date: e.target.value })} /></label>
          <label>この日のテーマ<input value={day.title || ''} maxLength={30} placeholder="例：九份と夜市" onChange={(e) => patchDay({ title: e.target.value })} /></label>
        </div>
      )}

      {stops.length > 0 && !readOnly && (
        <div className="pl-sort">
          <button type="button" className="btn ghost" onClick={() => setStops(timeOrder(home, stops))}>時間帯の順に並べる</button>
          <button type="button" className="btn" onClick={() => setStops(nearestOrder(home, stops))}>近い順に並べ替え</button>
        </div>
      )}
      {!home && !readOnly && <p className="hint">上の「宿泊先を登録」でホテルを入れると、ホテルから出発してホテルに戻る順番と距離が出ます。</p>}

      {stops.length === 0 ? (
        <p className="hint pl-empty">{readOnly ? 'この日の行き先はまだありません。' : 'まだ行き先がありません。下の「行き先を足す」からえらんでください。'}</p>
      ) : (
        <ol className="pl-list" ref={listRef} onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
          {home && (
            <li className="pl-end"><span className="pl-h">H</span><span><small>出発</small>{home.name}</span></li>
          )}
          {shown.map((it, i) => (
            <FragmentStop key={it.id}>
              {(i > 0 || home) && <Leg from={i === 0 ? home : shown[i - 1]} to={it} readOnly={readOnly} />}
              {i === 0 && !home && <Leg from={null} to={it} readOnly={readOnly} />}
              <li className={'pl-stop' + (drag?.id === it.id ? ' dragging' : '')} data-stop={it.id}>
                <span className="pl-no" style={{ '--c': colorOf(it.category) }}>{i + 1}</span>
                <span className="pl-name">
                  <b>{nm(it)}</b>
                  <small>{[it.category || 'カテゴリーなし', it.done ? '行った' : null].filter(Boolean).join('・')}</small>
                </span>
                {!readOnly && (
                  <span className="pl-ctl">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="前へ">↑</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === stops.length - 1} aria-label="後ろへ">↓</button>
                    <button type="button" className="pl-grip" aria-label="つかんで並べ替え" onPointerDown={(e) => startDrag(e, it.id)}>≡</button>
                    <button type="button" className="pl-x" onClick={() => setStops(stops.filter((x) => x.id !== it.id))} aria-label="この日から外す">×</button>
                  </span>
                )}
              </li>
            </FragmentStop>
          ))}
          {home && (
            <>
              <Leg from={shown[shown.length - 1]} to={home} readOnly={readOnly} />
              <li className="pl-end"><span className="pl-h">H</span><span><small>ホテルに戻る</small>{home.name}</span></li>
            </>
          )}
        </ol>
      )}

      {stops.length > 0 && (
        <div className="pl-sum">
          {km > 0 && <p>移動の合計 約{km.toFixed(1)}km・約{min >= 60 ? `${Math.floor(min / 60)}時間${min % 60 ? `${min % 60}分` : ''}` : `${min}分`}{unknown ? '（わからない区間を除く）' : ''}<small>直線距離からのめやす</small></p>}
          <div className="pl-sum-acts">
            {route && <a className="btn ghost" href={route} target="_blank" rel="noopener noreferrer">この1日をGoogleマップで見る</a>}
            {onShowMap && <button type="button" className="btn ghost" onClick={() => onShowMap(day.id)}>地図で番号を見る</button>}
          </div>
        </div>
      )}

      {!readOnly && (
        <div className="pl-pool">
          <p className="pl-pool-h">行き先を足す<small>押すと時間帯の順の位置に入ります</small></p>
          {pool.length === 0 ? <p className="hint">このフォルダのお店・名所は全部入っています。</p> : (
            <div className="pl-chips">
              {pool.map((it) => (
                <button key={it.id} type="button" onClick={() => addStop(it)}>
                  <i style={{ background: colorOf(it.category) }} />{nm(it)}
                  {otherDay.has(it.id) && <small>{otherDay.get(it.id)}</small>}
                </button>
              ))}
            </div>
          )}
          <div className="pl-del">
            {confirmDel ? (
              <span className="confirm">「{dayLabel(day, days.indexOf(day))}」を消しますか？
                <button type="button" className="btn" onClick={removeDay}>消す</button>
                <button type="button" className="btn ghost" onClick={() => setConfirmDel(false)}>やめる</button>
              </span>
            ) : <button type="button" className="fb-edit" onClick={() => setConfirmDel(true)}>この日を消す</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentStop({ children }) { return <>{children}</>; }
