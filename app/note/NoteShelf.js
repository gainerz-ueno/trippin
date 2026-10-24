'use client';
// 行ったタブ：まず「eタビセツを作る」。作ったeタビセツがここにたまり、2枚たまったら「eガイドブックにまとめる」が出てくる
import { useEffect, useState } from 'react';
import { listPages, listGuides, guideUrls } from '../cloud';

const NEED = 2; // eガイドブックにまとめられるeタビセツの枚数

export default function NoteShelf({ user, onSignIn, onMakeNote, onMakeGuide, refreshKey }) {
  const [pages, setPages] = useState(null); // null＝読み込み中
  const [guides, setGuides] = useState(0);
  const [urls, setUrls] = useState({});

  useEffect(() => {
    let off = false;
    if (!user) { setPages([]); setGuides(0); return undefined; }
    (async () => {
      try {
        const [ps, gs] = await Promise.all([listPages(), listGuides()]);
        const notes = ps.filter((p) => p.kind === 'note');
        if (off) return;
        setPages(notes); setGuides(gs.length);
        const u = await guideUrls(notes.slice(0, 12).map((p) => p.path));
        if (!off) setUrls(u);
      } catch { if (!off) setPages([]); }
    })();
    return () => { off = true; };
  }, [user?.id, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = pages?.length || 0;
  return (
    <div className="shelf">
      <div className="shelf-hero">
        <div className="sh-text">
          <span className="sh-kicker">TRAVEL MANUAL</span>
          <b className="sh-title">旅の1枚、<br />eタビセツを作ろう</b>
          <span className="sh-lead">行った場所の写真と感想で、インスタに映える1枚に</span>
          <button type="button" className="nm-open shelf-make" onClick={onMakeNote}>eタビセツを作る</button>
        </div>
        <div className="sh-pics" aria-hidden="true">
          <img src="/note/taste-yumekawa.jpg" alt="" />
          <img src="/note/taste-pop.jpg" alt="" />
        </div>
      </div>

      <div className="shelf-box">
        <div className="shelf-head">
          <b>わたしのeタビセツ</b>
          {user && pages && <span>{n}枚</span>}
        </div>

        {!user && (
          <>
            <p className="shelf-hint">作ったeタビセツは、Googleでログインすると保存してためておけます。{NEED}枚たまると、eガイドブックにまとめられます。</p>
            <button type="button" className="shelf-sub" onClick={onSignIn}>Googleでログイン</button>
          </>
        )}

        {user && pages === null && <p className="shelf-hint">読み込んでいます…</p>}

        {user && n > 0 && (
          <div className="shelf-row">
            {pages.slice(0, 12).map((p) => (
              <span key={p.id} className="shelf-pg">{urls[p.path] ? <img src={urls[p.path]} alt={p.title || ''} /> : null}</span>
            ))}
          </div>
        )}

        {user && pages && n === 0 && (
          <p className="shelf-hint">eタビセツができたら「わたしのeタビセツに保存」を押すと、ここにたまります。{NEED}枚たまると、eガイドブックにまとめられます。</p>
        )}

        {user && pages && n > 0 && n < NEED && (
          <div className="shelf-progress">
            <div className="shelf-bar"><i style={{ width: `${(n / NEED) * 100}%` }} /></div>
            <p>あと{NEED - n}枚でeガイドブックが作れます</p>
          </div>
        )}

        {user && n >= NEED && (
          <button type="button" className="nm-open guide shelf-guide" onClick={onMakeGuide}>eガイドブックにまとめる<small>eタビセツ{n}枚から選んで1冊に</small></button>
        )}

        {user && guides > 0 && (
          <button type="button" className="shelf-sub" onClick={onMakeGuide}>作ったeガイドブック（{guides}冊）を見る</button>
        )}
      </div>
    </div>
  );
}
