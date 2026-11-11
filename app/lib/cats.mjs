// 基本カテゴリー（名前と色。地図のピンにも使う）。page.js と試験の両方から読む
export const BASE_CATS = [
  ['観光', '#2F7D6B'], ['遊ぶ', '#9AAE1C'], ['朝市', '#C9822B'], ['夜市', '#5B4BA8'], ['朝食', '#E0A526'], ['昼食', '#D9692E'],
  ['夕食', '#B8432F'], ['夜食', '#3F4F86'], ['おやつ', '#D45C8C'], ['カフェ', '#8A5A3C'], ['酒場', '#8E2F4F'],
  ['買物', '#2E7FB8'], ['美容', '#C2569E'], ['マッサージ', '#4E9A5B'],
];
export const BASE_CAT_NAMES = BASE_CATS.map(([n]) => n);
export const CUSTOM_COLOR = '#6B7A8C';

// 基本カテゴリーと自分で作ったカテゴリーを、重ならない1つの一覧にする（「マッサージ」が2つ出ないように）
export function allCats(customCats = []) {
  return [...new Set([...BASE_CAT_NAMES, ...customCats.filter(Boolean)])];
}
// 自分で作ったカテゴリーの一覧から、基本と同じ名前・空・重なりを除く
export function cleanCustomCats(customCats = []) {
  const base = new Set(BASE_CAT_NAMES);
  return [...new Set(customCats.filter((c) => c && !base.has(c)))];
}
