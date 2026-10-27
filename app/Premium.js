'use client';
// プレミアム（予定）の案内。決済はまだ作っていない（Stripe はあとで）。
// 料金・回数は app/lib/plan.js（根拠は docs/マネタイズ根拠.md）。いまのプランはサーバーで決まる（Supabase の entitlements）
import { useEffect, useState } from 'react';
import { PLAN, PLAN_NAME, yen } from './lib/plan';
import { aiPlan } from './note/util';
import { logEvent } from './cloud';

export default function PremiumSheet({ user, onSignIn, onClose }) {
  const [me, setMe] = useState(undefined); // undefined=読み込み中 / null=わからない
  const [sent, setSent] = useState(false);
  useEffect(() => {
    logEvent('prem_sheet');
    if (!user) { setMe(null); return; }
    aiPlan().then((d) => setMe(d || null));
  }, [user]);
  const want = (which) => { logEvent('prem_interest', which); setSent(true); };
  const isPrem = me && /^premium/.test(me.plan);
  return (
    <div className="prem-back" role="dialog" aria-modal="true" aria-label="プレミアム" onClick={onClose}>
      <section className="prem" onClick={(e) => e.stopPropagation()}>
        <header className="prem-head">
          <h2>Tabibi プレミアム</h2>
          <button type="button" className="x" onClick={onClose} aria-label="閉じる">×</button>
        </header>
        {user ? (
          <p className="prem-now">
            いまのプラン：<b>{me === undefined ? '確認中…' : me ? (me.plan === 'owner' ? '運営者（回数の制限なし）' : PLAN_NAME[me.plan] || '無料') : 'わかりませんでした'}</b>
            {me && me.plan !== 'owner' && <>　「AIで作る」あと<b>{me.left}</b>回{me.plan === 'free' ? '（無料のお試し）' : me.plan === 'premium_month' ? '（今月）' : '（この1年）'}</>}
          </p>
        ) : (
          <p className="prem-now">プランの確認には <button type="button" className="linkbtn" onClick={onSignIn}>Googleでログイン</button> してください。</p>
        )}
        <div className="prem-cols">
          <div className="prem-col">
            <h3>無料</h3>
            <ul>
              <li>お店の登録（Googleマップ・SNS・スクショ）</li>
              <li>カテゴリー・メモ・写真・営業時間・地図</li>
              <li>宿泊先から回る順番（旅程づくり）</li>
              <li>候補 → 行ったお店 → eタビセツ（テンプレート）</li>
              <li>自分だけのeガイドブック・共有リンク</li>
              <li>お土産の記録・おすすめマーク</li>
              <li>「AIで作る」<b>合計{PLAN.AI_FREE_TOTAL}回</b>（お試し）</li>
            </ul>
          </div>
          <div className="prem-col on">
            <h3>プレミアム</h3>
            <p className="prem-price"><b>{yen(PLAN.PRICE_MONTH)}</b>／月　または　<b>{yen(PLAN.PRICE_YEAR)}</b>／年</p>
            <ul>
              <li>無料の機能すべて</li>
              <li>「AIで作る」（eタビセツ・表紙・直す）<b>月{PLAN.AI_MONTH}回</b>（年払いは<b>年{PLAN.AI_YEAR}回</b>）</li>
            </ul>
          </div>
        </div>
        <p className="hint">お支払いはまだ準備中です（料金は予定）。使いたい方は下のボタンを押してください。準備ができたらお知らせします。</p>
        {isPrem ? <p className="prem-ok">プレミアムをお使いいただいています。</p> : sent ? <p className="prem-ok">ありがとうございます。準備ができたらお知らせします。</p> : (
          <div className="prem-btns">
            <button type="button" className="btn" onClick={() => want('month')}>月払いで使いたい（{yen(PLAN.PRICE_MONTH)}）</button>
            <button type="button" className="btn ghost" onClick={() => want('year')}>年払いで使いたい（{yen(PLAN.PRICE_YEAR)}）</button>
          </div>
        )}
      </section>
    </div>
  );
}
