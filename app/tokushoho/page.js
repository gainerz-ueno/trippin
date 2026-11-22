
export const metadata = { title: '特定商取引法に基づく表記｜Tabibi' };

// パスワードなしで誰でも見られるページ（middleware.js の PUBLIC に入れてある）
const ROWS = [
  ['販売事業者', 'コネクター合同会社（CONEXTOR）'],
  ['運営責任者', '植野 博徳'],
  ['所在地', '〒101-0051 東京都千代田区神田神保町3丁目11番6号 神保町ビル10階'],
  ['電話番号', '050-6879-4071'],
  ['メールアドレス', 'info@conextor.jp'],
  ['サービス名', 'Tabibi（タビビ）'],
  ['販売価格', [
    'Tabibi ポイント：150ポイント 1,000円（税込）。',
    'ポイントの使い方：お店の検索 1回2ポイント、スクショからさがす 1回3ポイント、お店の詳細を見る 1回1ポイント、口コミを見る 1回1ポイント、AIのおすすめ 1回1ポイント、AIで画像を作る 1回3ポイント、タビビコール（AIによる電話予約の代行）通話3分ごとに45ポイント。',
    'はじめてご利用の方には、お試しの10ポイントを差し上げます。',
  ]],
  ['商品代金以外の必要料金', 'インターネット接続にかかる通信料はお客様のご負担となります。'],
  ['お支払い方法', 'クレジットカード決済（Stripe）'],
  ['お支払い時期', 'ポイントのご購入時に、その都度お支払いいただきます。'],
  ['サービスの提供時期', 'お支払い完了後、すぐにポイントが加わり、ご利用いただけます。'],
  ['返品・キャンセル（返金）について', [
    'ご購入いただいたポイントは、サービスの性質上、ご購入後の返品・キャンセル・払い戻しはできません。',
    'タビビコールで、お店が電話に出なかったとき・話し中だったときは、使ったポイントを戻します。検索・お店の詳細・口コミ・スクショからさがす・AIのおすすめ・AIで画像を作るがうまくいかなかったときも、ポイントを戻します。',
  ]],
  ['動作環境', 'iPhone・Android・パソコンの最新のブラウザ（Safari・Chrome など）'],
];

export default function Tokushoho() {
  return (
    <main className="wrap legal">
      <header>
        <a href="/" aria-label="Tabibi"><img src="/logo.png" alt="Tabibi" width="720" height="168" style={{ width: 160, height: 'auto' }} /></a>
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
        <p className="hint">最終更新日：2026年11月7日</p>
        <p className="hint"><a href="/privacy">プライバシーポリシー</a></p>
      </section>
    </main>
  );
}
