'use client';
// 行ったタブ：まず「1枚ノートを作る」。作ったノートがここにたまり、2枚たまったら「ガイドブックにまとめる」が出てくる
import { useEffect, useState } from 'react';
import { listPages, listGuides, guideUrls } from '../cloud';

const NEED = 2; // ガイドブックにまとめられるノートの枚数

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
      <button type="button" className="nm-open shelf-make" onClick={onMakeNote}>
        1枚ノートを作る<small>行った場所の写真と感想で、旅の1枚をつくる</small>
      </button>

      <div className="shelf-box">
        <div className="shelf-head">
          <b>わたしのノート</b>
          {user && pages && <span>{n}枚</span>}
        </div>

        {!user && (
          <>
            <p className="shelf-hint">作ったノートは、Googleでログインすると保存してためておけます。{NEED}枚たまると、ガイドブックにまとめられます。</p>
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
          <p className="shelf-hint">ノートができたら「わたしのノートに保存」を押すと、ここにたまります。{NEED}枚たまると、ガイドブックにまとめられます。</p>
        )}

        {user && pages && n > 0 && n < NEED && (
          <div className="shelf-progress">
            <div className="shelf-bar"><i style={{ width: `${(n / NEED) * 100}%` }} /></div>
            <p>あと{NEED - n}枚でガイドブックが作れます</p>
          </div>
        )}

        {user && n >= NEED && (
          <button type="button" className="nm-open guide shelf-guide" onClick={onMakeGuide}>ガイドブックにまとめる<small>ノート{n}枚から選んで1冊に</small></button>
        )}

        {user && guides > 0 && (
          <button type="button" className="shelf-sub" onClick={onMakeGuide}>作ったガイドブック（{guides}冊）を見る</button>
        )}
      </div>
    </div>
  );
}
