// 距離・回る順番・Googleマップの道案内リンク（どれも計算だけ。Googleへの有料の問い合わせはしない）

export function distanceKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const has = (p) => p && p.lat != null && p.lng != null;

// 2つの場所のあいだ（直線距離から、歩き・車のだいたいの時間）
export function leg(a, b) {
  if (!has(a) || !has(b)) return null;
  const km = distanceKm(a, b);
  if (km > 80) return null; // 別の街・別の国（意味のない数字を出さない）
  const road = km * 1.3;
  const dist = km < 1 ? `${Math.max(10, Math.round((km * 1000) / 10) * 10)}m` : `${km.toFixed(1)}km`;
  const walk = road <= 2.5;
  const min = walk ? Math.max(1, Math.round((road / 4.5) * 60)) : Math.max(5, Math.round((road / 25) * 60));
  return { km, walk, text: `${walk ? '徒歩' : '車で'}約${min}分・${dist}`, min };
}

// 時間帯の順番（朝食→観光→昼食→カフェ→夕食→夜市…）
const SLOT = { 朝市: 0, 朝食: 0, 観光: 1, 買物: 2, 昼食: 3, カフェ: 4, おやつ: 4, 美容: 5, マッサージ: 5, 夕食: 6, 夜市: 7, 酒場: 7, 夜食: 8 };
export const slotOf = (cat) => (cat in SLOT ? SLOT[cat] : 2);
export const SLOT_LABEL = ['朝', '午前', '日中', '昼', '午後', '夕方前', '夜', '夜', '深夜'];

// 近い順（いちばん近いところへ次々に行く）。位置のわからない場所は最後に
export function nearestOrder(start, list) {
  const rest = list.filter(has);
  const out = [];
  let cur = has(start) ? start : rest[0];
  while (rest.length) {
    let bi = 0, bd = Infinity;
    rest.forEach((p, i) => { const d = distanceKm(cur, p); if (d < bd) { bd = d; bi = i; } });
    cur = rest.splice(bi, 1)[0];
    out.push(cur);
  }
  return [...out, ...list.filter((p) => !has(p))];
}

// 時間帯の順に分けて、その中で近い順（前の場所から続けて）
export function timeOrder(start, list) {
  const groups = new Map();
  list.forEach((p) => { const s = slotOf(p.category); if (!groups.has(s)) groups.set(s, []); groups.get(s).push(p); });
  const out = [];
  let cur = start;
  [...groups.keys()].sort((a, b) => a - b).forEach((s) => {
    const g = nearestOrder(cur, groups.get(s));
    out.push(...g);
    const last = [...g].reverse().find(has);
    if (last) cur = last;
  });
  return out;
}

const ll = (p) => `${p.lat},${p.lng}`;
// Googleマップの道案内（無料のリンク）
export function dirLink(from, to) {
  if (!has(to)) return null;
  const l = has(from) ? leg(from, to) : null;
  const q = new URLSearchParams({ api: '1', destination: ll(to), travelmode: !l || l.walk ? 'walking' : 'driving' });
  if (has(from)) q.set('origin', ll(from));
  if (to.placeId) q.set('destination_place_id', to.placeId);
  if (from?.placeId) q.set('origin_place_id', from.placeId);
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}
// 1日の道のり全部（経由地はGoogleマップのリンクで9か所まで）
export function dayRouteLink(hotel, stops) {
  const pts = stops.filter(has);
  if (!pts.length) return null;
  const start = has(hotel) ? hotel : pts[0];
  const end = has(hotel) ? hotel : pts[pts.length - 1];
  const mid = has(hotel) ? pts : pts.slice(1, -1);
  const q = new URLSearchParams({ api: '1', origin: ll(start), destination: ll(end), travelmode: 'walking' });
  if (mid.length) q.set('waypoints', mid.slice(0, 9).map(ll).join('|'));
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}
