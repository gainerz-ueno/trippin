import { PLAN, yen } from '../lib/plan';

export const metadata = { title: 'Tabibi' };

export default async function Login({ searchParams }) {
  const e = (await searchParams)?.e;
  return (
    <main className="wrap">
      <header>
        <h1 className="logo"><img src="/logo.png" alt="Tabibi" width="720" height="168" /></h1>
      </header>
      <form className="panel" method="post" action="/api/login">
        <label htmlFor="pw">パスワード
          <input id="pw" name="password" type="password" autoComplete="current-password" autoFocus required />
        </label>
        <button className="btn" type="submit">入る</button>
        {e === '1' && <p className="err">パスワードが違います</p>}
        {e === 'wait' && <p className="err">間違いが続いたので、5分ほど待ってからもう一度入れてください</p>}
      </form>
      <section className="panel">
        <h2>Tabibi（タビビ）とは</h2>
        <p className="hint">旅行前に行きたいお店・名所をGoogleマップから探して候補リストにまとめ、旅のしおり（eタビセツ）やeガイドブックを作れる旅行アプリです。有料のプレミアム（{yen(PLAN.PRICE_MONTH)}／月・{yen(PLAN.PRICE_YEAR)}／年）と、旅行先のお店へAIが電話予約を代行する「タビビコール」（1回300円）があります。</p>
      </section>
      <footer className="legal-foot">
        <a href="/tokushoho">特定商取引法に基づく表記</a>
        <span>運営：CONEXTOR合同会社</span>
      </footer>
    </main>
  );
}
