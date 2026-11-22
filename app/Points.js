'use client';
// ポイント（2026-11-22 社長決定のポイント制）
// ・上の帯に残りのポイントと「ポイントを買う」を出す（ログインしている人だけ）
// ・ポイントが足りないとき（tabibi:needpoints）は買う画面を開く。ログインが要るとき（tabibi:needlogin）はログインの案内を出す
// ・決済画面（Stripe）から戻ってきたら（?points=paid）、残りを確かめ直して知らせる
import { useEffect, useState, useCallback } from 'react';
import { supa } from './cloud';

async function call(method = 'GET') {
  const { data } = await supa().auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error('Googleでログインしてください');
  const r = await fetch('/api/points', { method, headers: { Authorization: 'Bearer ' + t }, signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) throw new Error(d?.error || 'ポイントを確認できませんでした');
  return d;
}

const COST = ['お店の検索：2pt', 'スクショからさがす：3pt', 'お店の詳細を見る：1pt', '口コミを見る：1pt', 'AIのおすすめ：1pt', 'AIで画像を作る：3pt', 'タビビコール（お店への電話予約）：45pt（3分ごと）'];
const seenKey = (id) => `tabibi:ptwelcome:${id}`;

export default function Points({ user, onSignIn }) {
  const [welcome, setWelcome] = useState(false);
  const [p, setP] = useState(null); // { balance, owner, pack, canBuy, cost }
  const [open, setOpen] = useState(false);
  const [login, setLogin] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { if (user) call().then((d) => { setP(d); if (d.added) setMsg(`${d.pack.points}ポイントを追加しました`); }).catch(() => {}); }, [user]);

  useEffect(() => { if (user) load(); else setP(null); }, [user, load]);
  // はじめてログインした人に、ポイントのしくみを一度だけ見せる（運営者には出さない）
  useEffect(() => {
    if (!user || !p || p.owner) return;
    try { if (!localStorage.getItem(seenKey(user.id))) setWelcome(true); } catch {}
  }, [user, p]);
  const closeWelcome = () => { setWelcome(false); try { localStorage.setItem(seenKey(user.id), '1'); } catch {} };
  useEffect(() => {
    const need = () => { setOpen(true); load(); };
    const needLogin = () => setLogin(true);
    window.addEventListener('tabibi:needpoints', need);
    window.addEventListener('tabibi:needlogin', needLogin);
    window.addEventListener('tabibi:points', load);
    return () => { window.removeEventListener('tabibi:needpoints', need); window.removeEventListener('tabibi:needlogin', needLogin); window.removeEventListener('tabibi:points', load); };
  }, [load]);
  // 決済画面から戻ってきた
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const u = new URL(window.location.href);
    const st = u.searchParams.get('points');
    if (!st) return;
    u.searchParams.delete('points');
    window.history.replaceState(null, '', u.pathname + u.search + u.hash);
    if (st === 'paid') { setMsg('お支払いを確かめています…'); setTimeout(load, 1500); }
  }, [load]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t); }, [msg]);

  const buy = async () => {
    setBusy(true);
    try { const d = await call('POST'); window.location.href = d.url; } catch (e) { setMsg(e.message); setBusy(false); }
  };

  return (
    <>
      {user && p && (
        <span className="pt-bar">
          <button type="button" className="pt-chip" onClick={() => setOpen(true)} aria-label="ポイントの残りと使い方を見る">
            <span className="pt-lbl">ポイント</span><b>{p.owner ? '使い放題' : `${p.balance}pt`}</b>
          </button>
          <button type="button" className="pt-buynow" onClick={() => setOpen(true)}>ポイントを買う</button>
        </span>
      )}
      {!user && (
        <button type="button" className="pt-chip" onClick={() => setLogin(true)} aria-label="ログインしてお試しポイントをもらう">
          <span className="pt-lbl">ポイント</span><b>お試し10pt</b>
        </button>
      )}
      {welcome && p && (
        <div className="prem-back" role="dialog" aria-modal="true" aria-labelledby="pt-w" onClick={closeWelcome}>
          <div className="prem" onClick={(e) => e.stopPropagation()}>
            <h2 id="pt-w">お試し10ポイントをプレゼント</h2>
            <p>Tabibi は、使った分だけポイントを使うしくみです。月額の料金はかかりません。</p>
            <ul className="pt-cost">{COST.map((c) => <li key={c}>{c}</li>)}</ul>
            <p>足りなくなったら、上の「ポイントを買う」から買えます（{p.pack?.yen?.toLocaleString('ja-JP') || '1,000'}円で{p.pack?.points || 150}ポイント）。</p>
            <button type="button" className="btn pt-buy" onClick={closeWelcome}>さっそく使ってみる</button>
          </div>
        </div>
      )}
      {msg && <div className="pt-toast" role="status">{msg}</div>}
      {login && !user && (
        <div className="prem-back" role="dialog" aria-modal="true" onClick={() => setLogin(false)}>
          <div className="prem" onClick={(e) => e.stopPropagation()}>
            <h2>ログインしてください</h2>
            <p>お店の検索などはポイントを使うため、Googleでのログインが必要です。はじめての方には、お試しの10ポイントが付きます。</p>
            <button type="button" className="btn pt-buy" onClick={() => { setLogin(false); onSignIn(); }}>Googleでログインする</button>
            <button type="button" className="btn ghost" onClick={() => setLogin(false)}>閉じる</button>
          </div>
        </div>
      )}
      {open && user && (
        <div className="prem-back" role="dialog" aria-modal="true" aria-labelledby="pt-h" onClick={() => setOpen(false)}>
          <div className="prem" onClick={(e) => e.stopPropagation()}>
            <h2 id="pt-h">ポイント</h2>
            <p className="pt-now">いまのポイント：<b>{p ? (p.owner ? '使い放題（運営者）' : `${p.balance}pt`) : '確認中…'}</b></p>
            <ul className="pt-cost">{COST.map((c) => <li key={c}>{c}</li>)}</ul>
            {p?.canBuy === false
              ? <p className="hint">ポイントの購入はただいま準備中です。</p>
              : <button type="button" className="btn pt-buy" disabled={busy || !p} onClick={buy}>{busy ? '決済の画面を開いています…' : `ポイントを買う（${p?.pack?.yen?.toLocaleString('ja-JP') || '1,000'}円で${p?.pack?.points || 150}pt）`}</button>}
            <p className="hint">お支払いは Stripe の画面で行います。</p>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>閉じる</button>
          </div>
        </div>
      )}
    </>
  );
}
