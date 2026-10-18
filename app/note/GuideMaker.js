'use client';
// 自分のガイドブック：保存したタビセツを選んで並べ、表紙（テンプレート／AI）をつけて1冊にする
import { useEffect, useRef, useState } from 'react';
import './note.css';
import CoverCanvas from './CoverCanvas';
import { TEMPLATES, SIZES, sizeOf } from './NoteCanvas';
import { FONTS, loadFont, fontOf } from './fonts';
import { Scaled, toB64, renderNode, callAi, aiLeft } from './util';
import { listPhotos } from '../photos';
import { ensurePhotos, listPages, deletePage, guideUrls, listGuides, saveGuide, deleteGuide, savePage } from '../cloud';

const keyOf = (p) => p.cloudId || 'L' + p.id;
const blank = (author = '') => ({ id: null, title: '', author, description: '', page_ids: [], cover_id: null, published: true });

export default function GuideMaker({ items, folders, trip: trip0, user, onSignIn, onClose, unsorted }) {
  const [pages, setPages] = useState(null); // 保存したタビセツ・表紙
  const [urls, setUrls] = useState({});
  const [guides, setGuides] = useState([]);
  const [g, setG] = useState(blank());
  const [cv, setCv] = useState({ mode: 'tpl', tpl: 'lovely', font: 'hachimaru', size: 'post', title: '', sub: '', author: '', date: '', photo: null });
  const [folder, setFolder] = useState(trip0);
  const [photos, setPhotos] = useState([]); // 表紙に使える写真 [{key,url}]
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [left, setLeft] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [boxW, setBoxW] = useState(320);
  const boxRef = useRef(null);
  const coverRef = useRef(null);
  const photoUrls = useRef([]);

  const foldersWithDone = folders.filter((f) => items.some((i) => i.done && i.trip === f));

  async function reload() {
    try {
      const [ps, gs] = await Promise.all([listPages(), listGuides()]);
      setPages(ps); setGuides(gs);
      setUrls(await guideUrls(ps.map((p) => p.path)));
    } catch (e) { setErr('読み込めませんでした。少し時間をおいて開き直してください'); setPages([]); }
  }
  useEffect(() => { if (user) reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);
  useEffect(() => { FONTS.forEach((f) => loadFont(f.id)); }, []);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el); setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, [pages]);
  useEffect(() => { if (cv.mode === 'ai' && user) aiLeft().then((n) => n != null && setLeft(n)); }, [cv.mode, user?.id]);

  // 表紙に使う写真（えらんだフォルダの「行った」写真）
  useEffect(() => {
    let alive = true;
    (async () => {
      const its = items.filter((i) => i.done && i.trip === folder);
      const out = [];
      const made = [];
      for (const it of its) {
        try { await ensurePhotos(it.id); } catch {}
        for (const p of (await listPhotos(it.id)).filter((x) => x.kind === 'visit')) {
          const url = URL.createObjectURL(p.blob); made.push(url); out.push({ key: keyOf(p), url });
        }
      }
      if (!alive) { made.forEach((u) => URL.revokeObjectURL(u)); return; }
      photoUrls.current.forEach((u) => URL.revokeObjectURL(u));
      photoUrls.current = made;
      setPhotos(out);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);
  useEffect(() => () => photoUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  if (!user) {
    return (
      <div className="nm panel">
        <div className="nm-head"><h2>ガイドブックにまとめる</h2><button type="button" className="nm-close" onClick={onClose}>閉じる</button></div>
        <p className="nm-hint">ガイドブックはクラウドに保存して、リンクで見てもらう仕組みです。Googleでログインすると作れます。</p>
        <div className="nm-acts"><button type="button" onClick={onSignIn} style={{ gridColumn: '1 / -1' }}>Googleでログイン</button></div>
      </div>
    );
  }

  const notes = (pages || []).filter((p) => p.kind === 'note');
  const covers = (pages || []).filter((p) => p.kind === 'cover');
  const pageById = new Map((pages || []).map((p) => [p.id, p]));
  const sel = g.page_ids.filter((id) => pageById.has(id));
  const coverPage = g.cover_id && pageById.get(g.cover_id);
  const photoUrl = (cv.photo && photos.find((p) => p.key === cv.photo)?.url) || photos[0]?.url || null;
  const size = sizeOf(cv.size);
  const thumbW = Math.max(60, Math.floor((boxW - 20 - 48) / 3));
  const place = folder === unsorted ? '' : folder;
  const coverText = {
    title: cv.title || g.title || (place ? `${place}の旅` : '旅のガイドブック'),
    sub: cv.sub || `${(g.author || 'わたし')}の歩き方`,
    author: cv.author || g.author, date: cv.date,
  };

  function togglePage(id) {
    setG((x) => ({ ...x, page_ids: x.page_ids.includes(id) ? x.page_ids.filter((i) => i !== id) : [...x.page_ids, id] }));
  }
  function move(id, d) {
    setG((x) => {
      const a = x.page_ids.filter((i) => pageById.has(i));
      const i = a.indexOf(id); const j = i + d;
      if (i < 0 || j < 0 || j >= a.length) return x;
      [a[i], a[j]] = [a[j], a[i]];
      return { ...x, page_ids: a };
    });
  }
  async function removePage(p) {
    setConfirmDel(null);
    try {
      await deletePage(p);
      setG((x) => ({ ...x, page_ids: x.page_ids.filter((i) => i !== p.id), cover_id: x.cover_id === p.id ? null : x.cover_id }));
      await reload();
    } catch (e) { setErr(e.message || '削除できませんでした'); }
  }

  async function makeCover() {
    setBusy('cover'); setErr('');
    try {
      let blob;
      if (cv.mode === 'ai') {
        blob = await callAi({ kind: 'cover', tpl: cv.tpl, size: cv.size, place, ...coverText, cover: await toB64(photoUrl) });
      } else {
        blob = await renderNode(coverRef.current, size, cv.font);
      }
      const row = await savePage({ blob, kind: 'cover', trip: folder, title: coverText.title });
      setG((x) => ({ ...x, cover_id: row.id }));
      await reload();
    } catch (e) { setErr(e.message || '表紙を作れませんでした'); }
    setBusy('');
    if (cv.mode === 'ai') aiLeft().then((n) => n != null && setLeft(n));
  }

  async function save() {
    setBusy('save'); setErr(''); setMsg('');
    try {
      if (!g.title.trim()) throw new Error('ガイドブックの名前を入れてください');
      if (!sel.length) throw new Error('ページを1つ以上えらんでください');
      const row = await saveGuide({ ...g, page_ids: sel });
      setG((x) => ({ ...x, id: row.id }));
      setMsg(row.id);
      await reload();
    } catch (e) { setErr(e.message || '保存できませんでした'); }
    setBusy('');
  }
  function edit(x) {
    setG({ id: x.id, title: x.title, author: x.author, description: x.description, page_ids: x.page_ids || [], cover_id: x.cover_id, published: x.published });
    setMsg(''); setErr('');
    setTimeout(() => document.getElementById('gm-edit')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
  async function remove(id) {
    setConfirmDel(null);
    try { await deleteGuide(id); if (g.id === id) setG(blank(g.author)); await reload(); } catch (e) { setErr(e.message || '削除できませんでした'); }
  }
  const link = (id) => `${window.location.origin}/g/${id}`;
  async function copy(id) { try { await navigator.clipboard.writeText(link(id)); setMsg(id); } catch {} }

  return (
    <div className="nm panel gm">
      <div className="nm-head"><h2>ガイドブックにまとめる</h2><button type="button" className="nm-close" onClick={onClose}>閉じる</button></div>
      {pages === null && <p className="nm-hint">読み込んでいます…</p>}

      {guides.length > 0 && (
        <>
          <p className="nm-step">作ったガイドブック</p>
          <ul className="gm-list">
            {guides.map((x) => {
              const c = x.cover_id && pageById.get(x.cover_id);
              return (
                <li key={x.id}>
                  {c && urls[c.path] ? <img src={urls[c.path]} alt="" /> : <span className="ph0" />}
                  <div className="gm-li">
                    <b>{x.title}</b>
                    <small>{(x.page_ids || []).length}ページ・{x.published ? 'リンクで公開中' : '非公開'}</small>
                    <div className="gm-li-acts">
                      {x.published && <a href={`/g/${x.id}`} target="_blank" rel="noopener noreferrer">見る</a>}
                      {x.published && <button type="button" onClick={() => copy(x.id)}>リンクをコピー</button>}
                      <button type="button" onClick={() => edit(x)}>直す</button>
                      {confirmDel === 'g:' + x.id
                        ? <><button type="button" className="del-yes" onClick={() => remove(x.id)}>削除する</button><button type="button" onClick={() => setConfirmDel(null)}>やめる</button></>
                        : <button type="button" onClick={() => setConfirmDel('g:' + x.id)}>削除</button>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div id="gm-edit" />
      <p className="nm-step">{g.id ? '① ガイドブックを直す' : '① 新しいガイドブック'}</p>
      {g.id && <button type="button" className="nm-seg" onClick={() => { setG(blank(g.author)); setMsg(''); }}>新しく作る</button>}
      <label className="nm-field">ガイドブックの名前<input value={g.title} maxLength={60} placeholder="例：のりの台北ガイド" onChange={(e) => setG({ ...g, title: e.target.value })} /></label>
      <div className="nm-2">
        <label className="nm-field">書いた人<input value={g.author} maxLength={30} placeholder="例：のり" onChange={(e) => setG({ ...g, author: e.target.value })} /></label>
        <label className="nm-check" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={g.published} onChange={(e) => setG({ ...g, published: e.target.checked })} />リンクで公開する</label>
      </div>
      <label className="nm-field">紹介文<textarea value={g.description} maxLength={300} placeholder="例：はじめての台北で、朝ごはんと夜市を食べ歩いた3日間。" onChange={(e) => setG({ ...g, description: e.target.value })} /></label>

      <p className="nm-step">② ページをえらぶ<small>えらんだ順に並びます（{sel.length}ページ）</small></p>
      {notes.length === 0 ? (
        <p className="nm-hint">まだ保存したタビセツがありません。「タビセツを作る」で画像にしたあと「わたしのタビセツに保存」を押すと、ここに並びます。</p>
      ) : (
        <div className="gm-grid">
          {notes.map((p) => {
            const n = sel.indexOf(p.id);
            return (
              <div key={p.id} className="gm-pg">
                <button type="button" className="nm-ph gm-ph" aria-pressed={n >= 0} onClick={() => togglePage(p.id)}>
                  {urls[p.path] && <img src={urls[p.path]} alt="" />}{n >= 0 && <i>{n + 1}</i>}
                </button>
                <small>{p.title || p.trip}</small>
                {confirmDel === p.id
                  ? <span className="gm-del"><button type="button" className="del-yes" onClick={() => removePage(p)}>削除する</button><button type="button" onClick={() => setConfirmDel(null)}>やめる</button></span>
                  : <button type="button" className="gm-x" onClick={() => setConfirmDel(p.id)}>削除</button>}
              </div>
            );
          })}
        </div>
      )}
      {sel.length > 1 && (
        <div className="gm-order">
          {sel.map((id, i) => (
            <span key={id}><b>{i + 1}</b>{pageById.get(id)?.title || ''}
              <button type="button" onClick={() => move(id, -1)} disabled={i === 0} aria-label="前へ">←</button>
              <button type="button" onClick={() => move(id, 1)} disabled={i === sel.length - 1} aria-label="後ろへ">→</button>
            </span>
          ))}
        </div>
      )}

      <p className="nm-step">③ 表紙</p>
      {coverPage && urls[coverPage.path] && (
        <div className="gm-cover-now"><img src={urls[coverPage.path]} alt="表紙" /><small>いまの表紙</small></div>
      )}
      {covers.length > 1 && (
        <div className="nm-phs">
          {covers.map((p) => (
            <button key={p.id} type="button" className="nm-ph" aria-pressed={g.cover_id === p.id} onClick={() => setG({ ...g, cover_id: p.id })}>{urls[p.path] && <img src={urls[p.path]} alt="" />}</button>
          ))}
        </div>
      )}
      <div className="nm-mode" role="tablist" aria-label="表紙の作り方">
        <button type="button" role="tab" aria-selected={cv.mode === 'tpl'} onClick={() => setCv({ ...cv, mode: 'tpl' })}>テンプレートで作る<small>すぐできる・何枚でも</small></button>
        <button type="button" role="tab" aria-selected={cv.mode === 'ai'} onClick={() => setCv({ ...cv, mode: 'ai' })}>AIで作る<small>イラストに仕上げる</small></button>
      </div>
      <div className="nm-tpls" ref={boxRef}>
        {TEMPLATES.map((t) => (
          <button key={t.id} type="button" className="nm-tpl" aria-pressed={cv.tpl === t.id} onClick={() => setCv({ ...cv, tpl: t.id, font: t.font })}>
            {cv.mode === 'ai' ? (
              <div className="nm-mini nm-ai-mini" style={{ backgroundImage: `url(/note/${t.id}-post.jpg)`, height: Math.round(thumbW * 1.25) }}><img src={`/note/${t.id}-camera.png`} alt="" /></div>
            ) : (
              <div className="nm-mini"><Scaled width={thumbW} size={size}><CoverCanvas cover={{ ...cv, ...coverText, tpl: t.id, font: t.font }} photoUrl={photoUrl} /></Scaled></div>
            )}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="nm-row">
        {SIZES.map((x) => <button key={x.id} type="button" className="nm-seg" aria-pressed={cv.size === x.id} onClick={() => setCv({ ...cv, size: x.id })}>{x.label}</button>)}
      </div>
      {cv.mode === 'tpl' && (
        <div className="nm-fonts">
          {FONTS.map((f) => (
            <button key={f.id} type="button" className="nm-font" aria-pressed={cv.font === f.id} onClick={() => setCv({ ...cv, font: f.id })}>
              <b style={{ fontFamily: `"${f.family}"` }}>タビセツ</b><small>{f.label}</small>
            </button>
          ))}
        </div>
      )}
      <div className="nm-2">
        <label className="nm-field">表紙のタイトル<input value={cv.title} maxLength={24} placeholder={coverText.title} onChange={(e) => setCv({ ...cv, title: e.target.value })} /></label>
        <label className="nm-field">小見出し<input value={cv.sub} maxLength={16} placeholder={coverText.sub} onChange={(e) => setCv({ ...cv, sub: e.target.value })} /></label>
      </div>
      <label className="nm-field">日付<input value={cv.date} maxLength={24} placeholder="例：2026.10" onChange={(e) => setCv({ ...cv, date: e.target.value })} /></label>
      {foldersWithDone.length > 1 && (
        <label className="nm-field">写真をえらぶフォルダ
          <select value={folder} onChange={(e) => setFolder(e.target.value)} style={{ font: 'inherit', fontSize: 16, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--ink)' }}>
            {foldersWithDone.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
      )}
      {photos.length > 0 ? (
        <>
          <p className="nm-hint">表紙のメインの写真（景色や料理の写真）</p>
          <div className="nm-phs">
            {photos.map((p) => (
              <button key={p.key} type="button" className="nm-ph" aria-pressed={(cv.photo || photos[0]?.key) === p.key} onClick={() => setCv({ ...cv, photo: p.key })}><img src={p.url} alt="" /></button>
            ))}
          </div>
        </>
      ) : <p className="nm-hint">このフォルダの「行った」に写真がありません。</p>}
      {cv.mode === 'tpl' && (
        <div className="nm-preview" style={{ width: boxW }}>
          <Scaled width={boxW} size={size}><CoverCanvas cover={{ ...cv, ...coverText }} photoUrl={photoUrl} nodeRef={coverRef} /></Scaled>
        </div>
      )}
      <div className="nm-acts">
        <button type="button" className={cv.mode === 'ai' ? 'nm-ai-btn' : ''} onClick={makeCover} disabled={!!busy || (cv.mode === 'ai' && left === 0)} style={{ gridColumn: '1 / -1' }}>
          {busy === 'cover' ? (cv.mode === 'ai' ? 'AIが描いています…（30秒ほど）' : '表紙を作っています…') : cv.mode === 'ai' && left === 0 ? '今日の回数を使い切りました' : 'この表紙を作る'}
          {cv.mode === 'ai' && busy !== 'cover' && left != null && left > 0 && <small>{left >= 999 ? '回数の制限なし（運営者）' : `今日あと${left}回`}</small>}
        </button>
      </div>

      <p className="nm-step">④ 保存する</p>
      {err && <p className="nm-err">{err}</p>}
      <div className="nm-acts">
        <button type="button" onClick={save} disabled={!!busy} style={{ gridColumn: '1 / -1' }}>{busy === 'save' ? '保存しています…' : g.id ? 'ガイドブックを保存し直す' : 'ガイドブックを作る'}</button>
      </div>
      {msg && (
        <div className="gm-done">
          <p>保存しました。{guides.find((x) => x.id === msg)?.published ? 'リンクを送ると、だれでもスマホでめくって読めます。' : '「リンクで公開する」にチェックを入れて保存し直すと、リンクで見てもらえます。'}</p>
          {guides.find((x) => x.id === msg)?.published && (
            <div className="nm-acts">
              <a className="gm-btn" href={`/g/${msg}`} target="_blank" rel="noopener noreferrer">ガイドブックを見る</a>
              <button type="button" className="sub" onClick={() => copy(msg)}>リンクをコピー</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
