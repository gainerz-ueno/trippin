'use client';
// お土産の記録（旅のあとに、実際に買ったものを登録する）
// 名前・買ったお店（リストのお店をえらぶ／自分で書く）・現地のお金での値段・写真・ひとこと・おすすめマーク（★。お店のおすすめマークと同じ呼び名にそろえた）
import { useRef, useState } from 'react';
import { CURRENCIES, currencyOf, money, totals } from './lib/money';
import { logEvent } from './cloud';

export const MAX_SOUVENIRS = 50; // 1つの旅に入れられる数
const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// 写真は長い辺480pxのJPEGにして、データの中に入れる（共有リンク・eタビセツでもそのまま使える）
export function souvenirPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 480 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => reject(new Error('写真を読み込めませんでした'));
    img.src = URL.createObjectURL(file);
  });
}

export const shopName = (s, items) => {
  if (s.shopId) { const it = items.find((i) => i.id === s.shopId); if (it) return it.altName || it.name; }
  return s.shopText || '';
};
// 写真のURLは data:image/jpeg だけを使う（ほかのものは出さない）
export const safePhoto = (u) => (typeof u === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(u) ? u : null);

function Editor({ init, items, country, onSave, onCancel, onDelete }) {
  const [v, setV] = useState(() => init || { name: '', shopId: '', shopText: '', price: '', currency: currencyOf(country), memo: '', good: false, photo: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef(null);
  const set = (p) => setV((x) => ({ ...x, ...p }));
  async function pick(f) {
    if (!f) return;
    setBusy(true); setErr('');
    try { set({ photo: await souvenirPhoto(f) }); } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  function submit(e) {
    e.preventDefault();
    const name = v.name.trim();
    if (!name) { setErr('お土産の名前を入れてください'); return; }
    const p = String(v.price).replace(/[,，\s]/g, '');
    if (p !== '' && !(Number(p) >= 0 && Number(p) < 1e10)) { setErr('値段は数字で入れてください'); return; }
    // リストのお店をえらんだときも名前を残しておく（あとでお店を消しても「どこで買ったか」が残るように）
    const shop = v.shopId ? items.find((i) => i.id === v.shopId) : null;
    onSave({ ...v, name: name.slice(0, 40), shopId: shop ? shop.id : '', shopText: (shop ? shop.altName || shop.name : v.shopText.trim()).slice(0, 40), memo: v.memo.trim().slice(0, 200), price: p === '' ? '' : Number(p) });
  }
  return (
    <form className="sv-edit" onSubmit={submit}>
      <div className="sv-edit-top">
        <button type="button" className="sv-photo-pick" onClick={() => fileRef.current?.click()} aria-label="写真をえらぶ">
          {safePhoto(v.photo) ? <img src={v.photo} alt="" /> : <span>{busy ? '読み込み中…' : <>＋<br />写真</>}</span>}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        <label className="sv-grow">お土産の名前<input id="svname" value={v.name} maxLength={40} placeholder="例：パイナップルケーキ" onChange={(e) => set({ name: e.target.value })} /></label>
      </div>
      {safePhoto(v.photo) && <button type="button" className="fb-edit sv-photo-del" onClick={() => set({ photo: null })}>写真を外す</button>}
      <label>買ったお店
        <select id="svshop" value={v.shopId || ''} onChange={(e) => set({ shopId: e.target.value })}>
          <option value="">自分で書く（リストにないお店）</option>
          {items.map((it) => <option key={it.id} value={it.id}>{it.altName || it.name}</option>)}
        </select>
      </label>
      {!v.shopId && <input id="svshoptext" value={v.shopText} maxLength={40} placeholder="例：空港の免税店" onChange={(e) => set({ shopText: e.target.value })} aria-label="お店の名前" />}
      <div className="sv-price">
        <label className="sv-grow">値段（現地のお金）<input id="svprice" inputMode="decimal" value={v.price} placeholder="例：450" onChange={(e) => set({ price: e.target.value })} /></label>
        <label>お金<select id="svcur" value={v.currency} onChange={(e) => set({ currency: e.target.value })}>
          {CURRENCIES.map(([k, sym, label]) => <option key={k} value={k}>{label}（{sym}）</option>)}
        </select></label>
      </div>
      <label>ひとこと（共有リンク・eタビセツでも見えます）<textarea id="svmemo" rows={2} value={v.memo} maxLength={200} placeholder="例：会社のおみやげに。個包装で配りやすい" onChange={(e) => set({ memo: e.target.value })} /></label>
      <label className="sv-good"><input type="checkbox" checked={!!v.good} onChange={(e) => set({ good: e.target.checked })} />★ おすすめマーク</label>
      {err && <p className="err">{err}</p>}
      <div className="memo-acts">
        <button className="btn" type="submit" disabled={busy}>{init ? '保存' : '登録する'}</button>
        <button className="btn ghost" type="button" onClick={onCancel}>やめる</button>
        {onDelete && (confirm
          ? <><button type="button" className="btn" onClick={onDelete}>削除する</button></>
          : <button type="button" className="btn ghost sv-del" onClick={() => setConfirm(true)}>削除</button>)}
      </div>
    </form>
  );
}

export function SouvenirCard({ s, items, onEdit, onToggleGood }) {
  const shop = shopName(s, items);
  return (
    <article className={'sv-card' + (s.good ? ' good' : '')}>
      {safePhoto(s.photo) ? <img className="sv-img" src={s.photo} alt="" /> : <div className="sv-img sv-img0" aria-hidden="true">お土産</div>}
      <div className="sv-body">
        <p className="sv-name">{s.name}</p>
        <p className="sv-sub">{[shop && `${shop}で購入`, money(s.price, s.currency)].filter(Boolean).join('・')}</p>
        {s.memo && <p className="sv-memo">{s.memo}</p>}
        <div className="sv-acts">
          {onToggleGood ? (
            <button type="button" className={'sv-goodbtn' + (s.good ? ' on' : '')} aria-pressed={!!s.good} onClick={onToggleGood}>{s.good ? '★ おすすめ' : '☆ おすすめ'}</button>
          ) : s.good ? <span className="sv-goodbtn on">★ おすすめ</span> : null}
          {onEdit && <button type="button" className="sv-editbtn" onClick={onEdit}>直す</button>}
        </div>
      </div>
    </article>
  );
}

export default function SouvenirPanel({ trip, items, list, country, onAdd, onUpdate, onDelete }) {
  const [mode, setMode] = useState(null); // 'new' / id
  const [onlyGood, setOnlyGood] = useState(false);
  const shown = list.filter((s) => !onlyGood || s.good);
  const sum = totals(list);
  return (
    <section className="sv panel" id="souvenirs">
      <div className="sv-head">
        <h2>お土産<small>{list.length}こ</small></h2>
        {mode !== 'new' && list.length < MAX_SOUVENIRS && <button type="button" className="btn" onClick={() => setMode('new')}>＋ お土産を登録</button>}
      </div>
      {list.length === 0 && mode !== 'new' && <p className="hint">旅で実際に買ったお土産を記録できます。お店・値段・写真・ひとことを残しておくと、次の旅や友だちへのおすすめに使えます（eタビセツ・eガイドブックにも入れられます）。</p>}
      {sum.length > 0 && <p className="sv-total">合計 {sum.join(' ＋ ')}</p>}
      {list.some((s) => s.good) && list.length > 1 && (
        <div className="chips"><button type="button" aria-pressed={!onlyGood} onClick={() => setOnlyGood(false)}>すべて</button><button type="button" aria-pressed={onlyGood} onClick={() => setOnlyGood(true)}>★ おすすめ</button></div>
      )}
      {mode === 'new' && (
        <Editor items={items} country={country} onCancel={() => setMode(null)}
          onSave={(v) => { onAdd({ ...v, id: newId(), trip, at: Date.now() }); setMode(null); }} />
      )}
      <div className="sv-list">
        {shown.map((s) => (mode === s.id ? (
          <Editor key={s.id} init={s} items={items} country={country} onCancel={() => setMode(null)}
            onSave={(v) => { onUpdate(s.id, v); setMode(null); }} onDelete={() => { onDelete(s.id); setMode(null); }} />
        ) : (
          <SouvenirCard key={s.id} s={s} items={items} onEdit={() => setMode(s.id)} onToggleGood={() => { if (!s.good) logEvent('sv_mark'); onUpdate(s.id, { good: !s.good }); }} />
        )))}
      </div>
    </section>
  );
}
