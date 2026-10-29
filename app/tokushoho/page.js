
export const metadata = { title: '特定商取引法に基づく表記｜Tabibi' };

// パスワードなしで誰でも見られるページ（middleware.js の PUBLIC に入れてある）
const ROWS = [
  ['販売事業者', 'CONEXTOR合同会社'],
  ['運営責任者', '植野 博徳'],
  ['所在地', '〒101-0051 東京都千代田区神田神保町3丁目11番6号 神保町ビル10階'],
  ['電話番号', '050-6879-4071'],
  ['メールアドレス', 'info@conextor.jp'],
  ['サービス名', 'Tabibi（タビビ）'],
  ['販売価格', [
    'タビビコール（AIによる電話予約の代行）：1回300円（税込）',
    '各機能の購入画面にも価格を表示します。',
  ]],
  ['商品代金以外の必要料金', 'インターネット接続にかかる通信料はお客様のご負担となります。'],
  ['お支払い方法', 'クレジットカード決済（Stripe）'],
  ['お支払い時期', [
    'タビビコール：ご利用（お申し込み）の都度、お支払いいただきます。',
  ]],
  ['サービスの提供時期', 'お支払い完了後、すぐにご利用いただけます。'],
  ['返品・キャンセル（返金）について', [
    'デジタルサービスの性質上、お支払い後の返金・キャンセルはお受けしておりません。',
    'ただし、当社の不具合によりサービスをご利用いただけなかった場合や、タビビコールで電話がつながらず予約の代行ができなかった場合は、その分の料金をお返しします。上記メールアドレスまでご連絡ください。',
  ]],
  ['動作環境', 'iPhone・Android・パソコンの最新のブラウザ（Safari・Chrome など）'],
];

export default function Tokushoho() {
  return (
    <main className="wrap legal">
      <header>
        <a href="/login" aria-label="Tabibi"><img src="/logo.png" alt="Tabibi" width="720" height="168" style={{ width: 160, height: 'auto' }} /></a>
      </header>
      <section className="panel">
        <h1 className="legal-h">特定商取引法に基づく表記</h1>
        <dl className="legal-dl">
          {ROWS.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{Array.isArray(v) ? v.map((t) => <p key={t}>{t}</p>) : <p>{v}</p>}</dd>
            </div>
          ))}
        </dl>
        <p className="hint">最終更新日：2026年10月28日</p>
      </section>
    </main>
  );
}
