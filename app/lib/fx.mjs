// 為替レートの計算（画面と試験で同じものを使う）
// 取得元：ExchangeRate-API の無料版（open.er-api.com。鍵なし・1日1回更新・出典表示つきで商用も可）。rates[通貨] ＝ 1円あたりの現地通貨
export const FX_CODES = ['TWD', 'KRW', 'HKD', 'CNY', 'VND', 'THB', 'SGD', 'MYR', 'PHP', 'USD', 'EUR'];
// 「現金」「カード」は目安。相場に上乗せされる幅（％）の初期値。画面で自分で変えられる
export const DEFAULT_CASH_PCT = 3;
export const DEFAULT_CARD_PCT = 2;

// 取ってきた中身から、使う通貨の数字だけを取り出す（数字でないもの・0以下は捨てる）
export function pickRates(json) {
  if (!json || json.result !== 'success' || !json.rates || typeof json.rates !== 'object') return null;
  const rates = {};
  for (const c of FX_CODES) {
    const v = Number(json.rates[c]);
    if (Number.isFinite(v) && v > 0) rates[c] = v;
  }
  if (Object.keys(rates).length === 0) return null;
  return { rates, updated: typeof json.time_last_update_utc === 'string' ? json.time_last_update_utc : '' };
}

// 現地通貨1単位が何円か。pct は上乗せ幅（％）。円で払う側が多く払う向きに上乗せする
export function yenPer(rates, cur, pct = 0) {
  const r = rates && rates[cur];
  if (!(r > 0)) return null;
  const p = Number(pct);
  return (1 / r) * (1 + (Number.isFinite(p) && p > 0 ? p : 0) / 100);
}

// 現地のお金 → 円
export function toYen(amount, rates, cur, pct = 0) {
  const y = yenPer(rates, cur, pct);
  const a = Number(amount);
  if (y == null || amount === '' || amount == null || !Number.isFinite(a) || a < 0) return null;
  return a * y;
}

// 円 → 現地のお金（同じ上乗せ幅で、同じ金額の円から手に入る現地のお金）
export function fromYen(yen, rates, cur, pct = 0) {
  const y = yenPer(rates, cur, pct);
  const a = Number(yen);
  if (y == null || yen === '' || yen == null || !Number.isFinite(a) || a < 0) return null;
  return a / y;
}

// 3つの行（相場・現金・カード）
export function rows(rates, cur, cashPct = DEFAULT_CASH_PCT, cardPct = DEFAULT_CARD_PCT) {
  return [
    { key: 'market', label: '相場', pct: 0 },
    { key: 'cash', label: '現金（目安）', pct: cashPct },
    { key: 'card', label: 'カード（想定）', pct: cardPct },
  ].map((r) => ({ ...r, yen: yenPer(rates, cur, r.pct) }));
}

// 入力欄の文字を数字にする（全角・カンマ・空白に対応）。数字にならなければ ''
export function parseAmount(s) {
  const t = String(s ?? '').replace(/[０-９．]/g, (c) => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0))).replace(/[,，\s]/g, '');
  if (t === '' || !/^\d*\.?\d+$|^\d+\.$/.test(t)) return '';
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n < 1e12 ? n : '';
}
