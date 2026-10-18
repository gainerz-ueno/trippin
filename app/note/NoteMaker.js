'use client';
// 「行った」のお店・スポットから、1枚ノート（画像）を作る
import { useEffect, useMemo, useRef, useState } from 'react';
import './note.css';
import NoteCanvas, { TEMPLATES, SIZES, sizeOf } from './NoteCanvas';
import { FONTS, loadFont } from './fonts';
import { Scaled, toB64, renderNode, callAi, aiLeft, downloadBlob, shareBlob } from './util';
import { addPhotos, listPhotos } from '../photos';
import { ensurePhotos, savePage } from '../cloud';

const MAX = 6;
const keyOf = (p) => p.cloudId || 'L' + p.id;

export function defaultNote(trip, items, unsorted) {
  const done = items.filter((i) => i.done && i.trip === trip).sort((a, b) => (b.rec ? 1 : 0) - (a.rec ? 1 : 0));
  return {
    tpl: 'lovely', font: 'hachimaru', size: 'post',
    title: trip === unsorted ? '旅のノート' : `${trip}の旅`, sub: '旅の取扱説明書', by: '', who: '', date: '', words: '', logo: true,
    spots: done.slice(0, MAX).map((i) => ({ id: i.id, text: null, photos: null })),
    updatedAt: 0,
  };
}

// AIで作るときの雰囲気の見本（テンプレートの背景の絵）
const AI_NOTE = '写真と文字をAIがまとめて、1枚のイラストに描きます（1日3回まで）';

export default function NoteMaker({ items, folders, trip: trip0, notes, onSave, onPhotosAdded, photoVer, unsorted, onClose, user, onSignIn }) {
  const tripsWithDone = folders.filter((f) => items.some((i) => i.done && i.trip === f));
  const [trip, setTrip] = useState(tripsWithDone.includes(trip0) ? trip0 : tripsWithDone[0] || trip0);
  const note = notes[trip] || defaultNote(trip, items, unsorted);
  const [photoMap, setPhotoMap] = useState({}); // itemId -> [{key, url}]
  const [busy, setBusy] = useState(false);
  const [addBusy, setAddBusy] = useState(null);
  const [err, setErr] = useState('');
  const [out, setOut] = useState(null); // { url, blob, ext }
  const [left, setLeft] = useState(null); // AIで作る：今日あと何回
  const [boxW, setBoxW] = useState(320);
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const urls = useRef([]);

  const mode = note.mode === 'ai' ? 'ai' : 'tpl';
  const doneHere = items.filter((i) => i.done && i.trip === trip);
  const byId = new Map(items.map((i) => [i.id, i]));
  const spots = note.spots.map((s) => ({ s, it: byId.get(s.id) })).filter((x) => x.it && x.it.done);
  const spotIds = spots.map((x) => x.it.id).join(',');

  function save(patch) {
    onSave(trip, { ...note, ...patch, updatedAt: Date.now() });
    setOut(null);
  }

  // フォントは全部読み込んでおく（えらぶ画面で見本を出すため。使う文字の分だけ通信する）
  useEffect(() => { FONTS.forEach((f) => loadFont(f.id)); }, []);

  // 幅に合わせて縮める
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // えらんだお店の「行った」写真を読み込む
  async function loadPhotos() {
    const ids = spotIds ? spotIds.split(',') : [];
    const next = {};
    const made = [];
    for (const id of ids) {
      try { await ensurePhotos(id); } catch {}
      const list = (await listPhotos(id)).filter((p) => p.kind === 'visit');
      next[id] = list.map((p) => { const url = URL.createObjectURL(p.blob); made.push(url); return { key: keyOf(p), url }; });
    }
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = made;
    setPhotoMap(next);
    return next;
  }
  useEffect(() => { loadPhotos(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [spotIds, photoVer]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const photoKeys = (s) => {
    const list = photoMap[s.id] || [];
    if (s.photos) return s.photos.filter((k) => list.some((p) => p.key === k));
    return list.length ? [list[0].key] : [];
  };
  const place = trip === unsorted ? '' : trip;
  const urlOf = (id, k) => (photoMap[id] || []).find((p) => p.key === k)?.url;
  const allPhotos = spots.flatMap(({ it }) => (photoMap[it.id] || []).map((p) => ({ ...p, id: it.id })));
  // 主役の写真：えらんでいなければ1枚目の写真（「なし」をえらんだら null）
  const coverUrl = note.cover === null ? null : (note.cover ? allPhotos.find((p) => p.key === note.cover)?.url : null) || allPhotos[0]?.url || null;
  const coverKey = note.cover === null ? null : (note.cover && allPhotos.some((p) => p.key === note.cover) ? note.cover : allPhotos[0]?.key);

  const canvasSpots = spots.map(({ s, it }) => ({
    it, text: (s.text ?? it.review ?? '').trim(), urls: photoKeys(s).map((k) => urlOf(it.id, k)).filter(Boolean),
  }));

  function toggleSpot(id) {
    const has = note.spots.some((s) => s.id === id);
    if (has) save({ spots: note.spots.filter((s) => s.id !== id) });
    else if (spots.length < MAX) save({ spots: [...note.spots.filter((s) => byId.get(s.id)?.done), { id, text: null, photos: null }] });
  }
  function patchSpot(id, patch) { save({ spots: note.spots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }); }
  function move(id, d) {
    const arr = spots.map((x) => x.s);
    const i = arr.findIndex((s) => s.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    save({ spots: arr });
  }
  function togglePhoto(s, k) {
    const cur = photoKeys(s);
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k].slice(-2);
    patchSpot(s.id, { photos: next });
  }
  async function addMore(s, files) {
    if (!files?.length) return;
    setAddBusy(s.id); setErr('');
    try {
      const before = new Set((photoMap[s.id] || []).map((p) => p.key));
      const cur = photoKeys(s);
      await addPhotos(s.id, [...files], 'visit');
      const after = (await listPhotos(s.id)).filter((p) => p.kind === 'visit').map(keyOf);
      const added = after.filter((k) => !before.has(k));
      patchSpot(s.id, { photos: [...cur, ...added].slice(0, 2) });
      onPhotosAdded?.();
    } catch (e) { setErr(e.message || '写真を追加できませんでした'); }
    setAddBusy(null);
  }

  // AIで作る：今日あと何回使えるか
  async function loadLeft() { const n = await aiLeft(); if (n != null) setLeft(n); }
  useEffect(() => { if (mode === 'ai' && user) loadLeft(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode, user?.id]);

  async function makeAi() {
    setBusy(true); setErr(''); setOut(null);
    try {
      const body = {
        tpl: note.tpl, size: note.size, title: note.title, sub: note.sub, place, date: note.date, who: note.who, by: note.by, words: note.words,
        cover: await toB64(coverUrl),
        spots: await Promise.all(canvasSpots.map(async (sp) => ({
          name: sp.it.altName || sp.it.name, cat: sp.it.category || '', text: sp.text, img: await toB64(sp.urls[0]),
        }))),
      };
      const blob = await callAi(body);
      setOut({ url: URL.createObjectURL(blob), blob, ext: 'jpg' });
      setTimeout(() => document.getElementById('nm-out')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) { setErr(e.message || 'AIで作れませんでした'); }
    setBusy(false);
    loadLeft();
  }

  async function makeImage() {
    setBusy(true); setErr(''); setOut(null);
    try {
      const blob = await renderNode(canvasRef.current, sizeOf(note.size), note.font);
      setOut({ url: URL.createObjectURL(blob), blob, ext: 'png' });
      setTimeout(() => document.getElementById('nm-out')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) { setErr(e.message || '画像を作れませんでした'); }
    setBusy(false);
  }
  const fileName = `tabibi-${(note.title || 'note').replace(/[\\/:*?"<>|\s]+/g, '_')}.${out?.ext || 'png'}`;
  function share() { if (out) shareBlob(out.blob, fileName); }
  function download() { if (out) downloadBlob(out.blob, fileName); }
  // ガイドブックのページとしてクラウドに保存
  const [saved, setSaved] = useState('');
  async function addToGuide() {
    if (!out) return;
    setSaved('saving');
    try { await savePage({ blob: out.blob, kind: 'note', trip, title: note.title }); setSaved('done'); }
    catch (e) { setSaved(''); setErr(e.message || '保存できませんでした'); }
  }
  useEffect(() => { setSaved(''); }, [out]);
  useEffect(() => () => { if (out) URL.revokeObjectURL(out.url); }, [out]);

  const size = sizeOf(note.size);
  const thumbW = Math.max(60, Math.floor((boxW - 20 - 48) / 3)); // すき間10px×2、枠と余白16px×3
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;

  return (
    <div className="nm panel">
      <div className="nm-head">
        <h2>1枚ノートを作る</h2>
        <button type="button" className="nm-close" onClick={onClose}>閉じる</button>
      </div>
      <div className="nm-mode" role="tablist" aria-label="作り方">
        <button type="button" role="tab" aria-selected={mode === 'tpl'} onClick={() => save({ mode: 'tpl' })}>テンプレートで作る<small>すぐできる・何枚でも</small></button>
        <button type="button" role="tab" aria-selected={mode === 'ai'} onClick={() => save({ mode: 'ai' })}>AIで作る<small>イラストに仕上げる</small></button>
      </div>
      {mode === 'ai' && <p className="nm-hint">{AI_NOTE}</p>}

      {tripsWithDone.length > 1 && (
        <label className="nm-field">フォルダ
          <select value={trip} onChange={(e) => { setTrip(e.target.value); setOut(null); }} style={{ font: 'inherit', fontSize: 16, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--ink)' }}>
            {tripsWithDone.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
      )}

      <p className="nm-step">① お店・スポットをえらぶ<small>{MAX}つまで（{spots.length}/{MAX}）</small></p>
      {doneHere.length === 0 ? (
        <p className="nm-hint">このフォルダにはまだ「行った」お店がありません。</p>
      ) : (
        <ul className="nm-spots">
          {doneHere.map((it) => {
            const on = spots.some((x) => x.it.id === it.id);
            const first = (photoMap[it.id] || [])[0];
            return (
              <li key={it.id}>
                <label className={on ? 'on' : ''}>
                  <input type="checkbox" checked={on} disabled={!on && spots.length >= MAX} onChange={() => toggleSpot(it.id)} />
                  {first ? <img src={first.url} alt="" /> : <span className="ph0" />}
                  <span className="nm-sn">{it.altName || it.name}<small>{[it.category, it.rec ? 'おすすめ' : '', it.review ? '感想あり' : ''].filter(Boolean).join('・')}</small></span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <p className="nm-step">② {mode === 'ai' ? '雰囲気をえらぶ' : 'デザインをえらぶ'}</p>
      <div className="nm-tpls" ref={boxRef}>
        {mode === 'ai' && TEMPLATES.map((t) => (
          <button key={t.id} type="button" className="nm-tpl" aria-pressed={note.tpl === t.id} onClick={() => save({ tpl: t.id, font: t.font })}>
            <div className="nm-mini nm-ai-mini" style={{ backgroundImage: `url(/note/${t.id}-post.jpg)`, height: Math.round(thumbW * 1.25) }}>
              <img src={`/note/${t.id}-camera.png`} alt="" />
            </div>
            <span>{t.label}</span>
          </button>
        ))}
        {mode === 'tpl' && TEMPLATES.map((t) => (
          <button key={t.id} type="button" className="nm-tpl" aria-pressed={note.tpl === t.id} onClick={() => save({ tpl: t.id, font: t.font })}>
            <div className="nm-mini">
              <Scaled width={thumbW} size={size}>
                <NoteCanvas note={{ ...note, tpl: t.id, font: t.font }} spots={canvasSpots} coverUrl={coverUrl} place={place} />
              </Scaled>
            </div>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="nm-row">
        {SIZES.map((s) => <button key={s.id} type="button" className="nm-seg" aria-pressed={note.size === s.id} onClick={() => save({ size: s.id })}>{s.label}</button>)}
      </div>

      {mode === 'tpl' && (
        <>
          <p className="nm-step">③ 文字（フォント）をえらぶ</p>
          <div className="nm-fonts">
            {FONTS.map((f) => (
              <button key={f.id} type="button" className="nm-font" aria-pressed={note.font === f.id} onClick={() => save({ font: f.id })}>
                <b style={{ fontFamily: `"${f.family}"` }}>旅ノート</b>
                <small>{f.label}</small>
              </button>
            ))}
          </div>
        </>
      )}

      <p className="nm-step">{mode === 'ai' ? '③' : '④'} タイトル・名前</p>
      <label className="nm-field">タイトル<input value={note.title} maxLength={24} onChange={(e) => save({ title: e.target.value })} /></label>
      <div className="nm-2">
        <label className="nm-field">小見出し<input value={note.sub} maxLength={12} onChange={(e) => save({ sub: e.target.value })} /></label>
        <label className="nm-field">日付<input value={note.date} maxLength={24} placeholder="例：2026.10" onChange={(e) => save({ date: e.target.value })} /></label>
      </div>
      <div className="nm-2">
        <label className="nm-field">だれと<input value={note.who || ''} maxLength={20} placeholder="例：友だち3人" onChange={(e) => save({ who: e.target.value })} /></label>
        <label className="nm-field">書いた人<input value={note.by} maxLength={20} placeholder="例：のり" onChange={(e) => save({ by: e.target.value })} /></label>
      </div>
      <label className="nm-field">ひとこと<textarea value={note.words} maxLength={120} placeholder="例：また行きたい！次は夜市をもっと回りたい" onChange={(e) => save({ words: e.target.value })} /></label>
      {allPhotos.length > 0 && (
        <>
          <p className="nm-hint">{mode === 'ai' ? '主役の写真（あなたが写っている写真をえらぶと、あなたが真ん中に大きく描かれます）' : '真ん中に大きく入れる写真'}</p>
          <div className="nm-phs">
            <button type="button" className="nm-ph" aria-pressed={coverKey == null} onClick={() => save({ cover: null })} style={{ fontSize: 12, color: 'var(--sub)' }}>なし</button>
            {allPhotos.map((p) => (
              <button key={p.key} type="button" className="nm-ph" aria-pressed={coverKey === p.key} onClick={() => save({ cover: p.key })}><img src={p.url} alt="" /></button>
            ))}
          </div>
        </>
      )}
      {mode === 'tpl' && <label className="nm-check"><input type="checkbox" checked={!!note.logo} onChange={(e) => save({ logo: e.target.checked })} />Tabibiのロゴを入れる</label>}

      {spots.length > 0 && <p className="nm-step">{mode === 'ai' ? '④' : '⑤'} 写真とコメント<small>{mode === 'ai' ? 'AIには1枚目の写真を使います' : '写真は2枚まで'}。上から3つが「BEST 3」になります</small></p>}
      {spots.map(({ s, it }, i) => {
        const keys = photoKeys(s);
        return (
          <div key={it.id} className="nm-spot">
            <div className="nm-spot-h">
              <b>{i + 1}. {it.altName || it.name}</b>
              <button type="button" onClick={() => move(it.id, -1)} disabled={i === 0} aria-label="上へ">↑</button>
              <button type="button" onClick={() => move(it.id, 1)} disabled={i === spots.length - 1} aria-label="下へ">↓</button>
            </div>
            <div className="nm-phs">
              {(photoMap[it.id] || []).map((p) => {
                const n = keys.indexOf(p.key);
                return (
                  <button key={p.key} type="button" className="nm-ph" aria-pressed={n >= 0} onClick={() => togglePhoto(s, p.key)}>
                    <img src={p.url} alt="" />{n >= 0 && <i>{n + 1}</i>}
                  </button>
                );
              })}
              <label className="nm-add">
                {addBusy === it.id ? '保存中…' : <>＋<br />写真を追加</>}
                <input type="file" accept="image/*" multiple hidden onChange={(e) => { addMore(s, e.target.files); e.target.value = ''; }} />
              </label>
            </div>
            <label className="nm-field">コメント
              <textarea value={s.text ?? it.review ?? ''} maxLength={200} placeholder="例：豆乳と焼餅を注文。甘い豆乳が絶品" onChange={(e) => patchSpot(it.id, { text: e.target.value })} />
            </label>
          </div>
        );
      })}

      {mode === 'tpl' ? (
        <>
          <p className="nm-step">⑥ できあがり</p>
          <div className="nm-preview" style={{ width: boxW }}>
            <Scaled width={boxW} size={size}>
              <NoteCanvas note={note} spots={canvasSpots} coverUrl={coverUrl} nodeRef={canvasRef} place={place} />
            </Scaled>
          </div>
          {err && <p className="nm-err">{err}</p>}
          <div className="nm-acts">
            <button type="button" onClick={makeImage} disabled={busy || spots.length === 0} style={{ gridColumn: '1 / -1' }}>{busy ? '画像を作っています…' : '画像にする'}</button>
          </div>
        </>
      ) : (
        <>
          <p className="nm-step">⑤ AIで作る</p>
          {!user ? (
            <div className="nm-acts">
              <p className="nm-hint" style={{ gridColumn: '1 / -1' }}>「AIで作る」はGoogleでログインすると使えます。</p>
              <button type="button" onClick={onSignIn} style={{ gridColumn: '1 / -1' }}>Googleでログイン</button>
            </div>
          ) : (
            <>
              {err && <p className="nm-err">{err}</p>}
              <div className="nm-acts">
                <button type="button" className="nm-ai-btn" onClick={makeAi} disabled={busy || spots.length === 0 || left === 0} style={{ gridColumn: '1 / -1' }}>
                  {busy ? 'AIが描いています…（30秒ほど）' : left === 0 ? '今日の回数を使い切りました' : 'AIで作る'}
                  {!busy && left != null && left > 0 && <small>今日あと{left}回</small>}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {out && (
        <div id="nm-out" className="nm-out nm">
          <img src={out.url} alt="できあがったノート" />
          <p className="nm-hint">画像を長押しして保存することもできます。</p>
          <div className="nm-acts">
            {canShare && <button type="button" onClick={share}>SNSにシェア</button>}
            <button type="button" className={canShare ? 'sub' : ''} onClick={download} style={canShare ? undefined : { gridColumn: '1 / -1' }}>画像を保存</button>
            {user ? (
              <button type="button" className="sub nm-guide-add" onClick={addToGuide} disabled={saved !== ''} style={{ gridColumn: '1 / -1' }}>
                {saved === 'done' ? 'ガイドブック用に保存しました' : saved === 'saving' ? '保存しています…' : 'ガイドブックに入れる'}
              </button>
            ) : (
              <p className="nm-hint" style={{ gridColumn: '1 / -1' }}>Googleでログインすると、このノートを「自分のガイドブック」に入れられます。</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
