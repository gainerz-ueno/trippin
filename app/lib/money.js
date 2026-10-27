// 現地のお金（お土産の値段）
export const CURRENCIES = [
  ['TWD', 'NT$', '台湾ドル'], ['KRW', '₩', '韓国ウォン'], ['HKD', 'HK$', '香港ドル'], ['CNY', '元', '人民元'],
  ['VND', '₫', 'ベトナムドン'], ['THB', '฿', 'タイバーツ'], ['SGD', 'S$', 'シンガポールドル'], ['MYR', 'RM', 'リンギット'],
  ['PHP', '₱', 'フィリピンペソ'], ['JPY', '円', '日本円'], ['USD', 'US$', '米ドル'], ['EUR', '€', 'ユーロ'],
];
const BY_COUNTRY = { TW: 'TWD', KR: 'KRW', HK: 'HKD', CN: 'CNY', VN: 'VND', TH: 'THB', SG: 'SGD', MY: 'MYR', PH: 'PHP', JP: 'JPY' };
export const currencyOf = (country) => BY_COUNTRY[country] || 'TWD';
const AFTER = new Set(['CNY', 'JPY', 'VND']);

export function money(amount, cur) {
  if (amount == null || amount === '' || !Number.isFinite(Number(amount))) return '';
  const c = CURRENCIES.find(([k]) => k === cur) || [cur, cur];
  const n = Number(amount).toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  return AFTER.has(c[0]) ? `${n}${c[1]}` : `${c[1]}${n}`;
}

// 通貨ごとの合計（例：NT$1,250 ＋ ₩30,000）
export function totals(list) {
  const t = new Map();
  list.forEach((s) => { const n = Number(s.price); if (s.price !== '' && s.price != null && Number.isFinite(n)) t.set(s.currency, (t.get(s.currency) || 0) + n); });
  return [...t.entries()].map(([c, n]) => money(n, c));
}
