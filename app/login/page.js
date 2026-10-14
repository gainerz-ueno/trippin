export const metadata = { title: 'Tabibi' };

export default function Login({ searchParams }) {
  const e = searchParams?.e;
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
    </main>
  );
}
