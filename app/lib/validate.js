// 入力チェック（サーバー側）：型・長さ・範囲をそろえて、おかしな値はここで落とす
export const COUNTRY_CODES = ['TW', 'KR', 'HK', 'CN', 'VN', 'TH', 'SG', 'MY', 'PH', 'JP'];

export function str(v, max = 100) {
  if (typeof v !== 'string') return '';
  // 制御文字を取り除き、長さを切る
  return v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}
export function num(v, min, max, dflt = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
}
export function latLng(v) {
  if (!v || typeof v !== 'object') return null;
  const lat = Number(v.lat), lng = Number(v.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
export const country = (v) => (COUNTRY_CODES.includes(v) ? v : '');
export const bad = (msg) => Response.json({ error: msg }, { status: 400 });
