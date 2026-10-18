'use client';
// ガイドブックを読むページ（リンクを知っている人なら、ログインもパスワードもいらない）
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { fetchGuide, guideUrls } from '../../cloud';

export default function GuidePage() {
  const { id } = useParams();
  const [g, setG] = useState(undefined); // undefined=読み込み中 / null=見つからない
  const [urls, setUrls] = useState({});
  const [big, setBig] = useState(null);

  useEffect(() => {
    if (!/^[A-Za-z0-9]{10}$/.test(String(id || ''))) { setG(null); return; }
    (async () => {
      try {
        const d = await fetchGuide(id);
        if (!d) { setG(null); return; }
        setG(d);
        setUrls(await guideUrls([d.cover, ...(d.pages || [])]));
        document.title = `${d.title} | Tabibi`;
      } catch { setG(null); }
    })();
  }, [id]);

  const list = g ? [g.cover, ...(g.pages || [])].filter(Boolean) : [];
  return (
    <main className="gv">
      <header className="gv-head">
        <a href="/" className="gv-logo"><img src="/logo.png" alt="Tabibi" width="720" height="168" /></a>
        <span>旅のガイドブック</span>
      </header>
      {g === undefined && <p className="gv-msg">読み込んでいます…</p>}
      {g === null && <p className="gv-msg">このガイドブックは見つかりませんでした。公開が止められたか、リンクがまちがっているかもしれません。</p>}
      {g && (
        <>
          <section className="gv-intro">
            <h1>{g.title}</h1>
            {g.author && <p className="gv-by">by {g.author}</p>}
            {g.description && <p className="gv-desc">{g.description}</p>}
            <p className="gv-count">{(g.pages || []).length}ページ</p>
          </section>
          <div className="gv-pages">
            {list.map((p, i) => (
              <figure key={p + i} className="gv-page">
                {urls[p] ? <img src={urls[p]} alt={i === 0 && g.cover ? '表紙' : `${i}ページ目`} loading={i < 2 ? 'eager' : 'lazy'} onClick={() => setBig(urls[p])} /> : <div className="gv-ph" />}
                <figcaption>{i === 0 && g.cover ? '表紙' : `${g.cover ? i : i + 1} / ${(g.pages || []).length}`}</figcaption>
              </figure>
            ))}
          </div>
          <footer className="gv-foot">
            <p>このガイドブックは「Tabibi」で作られました。</p>
            <a href="/">Tabibiで自分のガイドブックを作る</a>
          </footer>
        </>
      )}
      {big && (
        <div className="gv-big" role="dialog" onClick={() => setBig(null)}>
          <img src={big} alt="" />
        </div>
      )}
      <style>{`
        .gv{max-width:640px;margin:0 auto;padding:16px 16px 60px;display:flex;flex-direction:column;gap:16px}
        .gv-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
        .gv-logo img{height:32px;width:auto;display:block}
        .gv-head span{font-size:12px;color:var(--sub)}
        .gv-msg{color:var(--sub);text-align:center;padding:40px 0}
        .gv-intro{display:flex;flex-direction:column;gap:6px}
        .gv-intro h1{font-size:26px;line-height:1.3;margin:0}
        .gv-by{margin:0;color:var(--sub);font-weight:700}
        .gv-desc{margin:0;white-space:pre-wrap;line-height:1.7}
        .gv-count{margin:0;font-size:12px;color:var(--sub)}
        .gv-pages{display:flex;flex-direction:column;gap:18px}
        .gv-page{margin:0;display:flex;flex-direction:column;gap:6px;align-items:center}
        .gv-page img{width:100%;height:auto;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.15);cursor:zoom-in;background:var(--chip)}
        .gv-ph{width:100%;aspect-ratio:4/5;border-radius:10px;background:var(--chip)}
        .gv-page figcaption{font-size:12px;color:var(--sub)}
        .gv-foot{text-align:center;display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1px solid var(--line)}
        .gv-foot p{margin:0;font-size:13px;color:var(--sub)}
        .gv-foot a{display:inline-block;margin:0 auto;font-weight:700;background:var(--accent);color:var(--accent-ink);padding:12px 20px;border-radius:12px;text-decoration:none}
        .gv-big{position:fixed;inset:0;background:rgba(0,0,0,.9);display:grid;place-items:center;z-index:50;padding:10px}
        .gv-big img{max-width:100%;max-height:100%;object-fit:contain}
      `}</style>
    </main>
  );
}
