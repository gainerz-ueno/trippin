// 料金・無料と有料の線・作り手の取り分（数字の根拠は docs/マネタイズ根拠.md）
// ここの数字を変えるときは、必ず docs/マネタイズ根拠.md と supabase/migrations/20261027_premium.sql も同じにする
export const PLAN = {
  // プレミアムの料金（予定。決済はまだ作っていない）
  PRICE_MONTH: 480, // 円／月：tabiori premium・NAVITIME Travel プレミアムと同じ（App Store）
  PRICE_YEAR: 3900, // 円／年：tabiori premium（年額）と同じ（App Store）
  // 「AIで作る」（絵をかく・直す）の回数。1回＝最大 約23.48円（2K画像 $0.134＋写真14枚×$0.0011、1ドル157.15円）
  // 回数＝（手数料を引いた売上 × 55%）÷ 23.48円 の切り捨て。55%＝AI製品の粗利の平均45%（ICONIQ 2025）の残り
  AI_FREE_TOTAL: 1, // 無料：1つのアカウントで合計1回（お試し）＝旅行アプリの有料化率1.78%×3,900円×95.7%×55%÷23.48円
  AI_MONTH: 10, // 月払い：毎月10回（日本時間の1日から）＝480円×95.7%×55%÷23.48円
  AI_YEAR: 87, // 年払い：1年で87回＝3,900円×95.7%×55%÷23.48円
  // 有料のeガイドブック（作り手が決める値段の範囲と、運営の取り分）
  GUIDE_MIN: 100, // 円：note の有料記事と同じ下限
  GUIDE_MAX: 50000, // 円：note の有料記事と同じ上限（通常会員）
  GUIDE_MAX_PAGES: 60, // 1冊に入れられるページ（cloud.js の saveGuide と同じ）
  CARD_RATE: 0.036, // Stripe 国内カード手数料
  PLATFORM_RATE: 0.10, // 運営の取り分：note の有料記事と同じ10%（カード手数料を引いた残りにかける）
};

export const PLAN_NAME = { free: '無料', premium_month: 'プレミアム（月払い）', premium_year: 'プレミアム（年払い）' };

// 有料のeガイドブックが1冊売れたときの内訳（端数は切り捨て＝作り手に多く残る。note と同じ計算の順番）
export function guideSplit(price) {
  const p = Math.max(0, Math.floor(Number(price) || 0));
  const card = Math.floor(p * PLAN.CARD_RATE);
  const platform = Math.floor((p - card) * PLAN.PLATFORM_RATE);
  return { price: p, card, platform, creator: p - card - platform };
}

export const validGuidePrice = (n) => n === 0 || (Number.isInteger(n) && n >= PLAN.GUIDE_MIN && n <= PLAN.GUIDE_MAX);

export const yen = (n) => Number(n).toLocaleString('ja-JP') + '円';
