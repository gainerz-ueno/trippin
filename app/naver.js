'use client';
// 韓国ではGoogleマップの道案内が十分に使えないので、韓国のスポットだけNAVER Mapでも開けるようにする
// （リンクで開くだけ。APIは使わないので費用はかからない）

// 緯度・経度が韓国の中か（日本の対馬・九州は外す）
export function inKorea(p) {
  const lat = Number(p?.lat), lng = Number(p?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < 33 || lat > 38.7 || lng < 124.5 || lng > 131) return false;
  if (lat < 34.8 && lng > 129.1) return false; // 対馬・壱岐・九州
  if (lng > 129.7 && lat < 37) return false; // 日本海側の日本
  return true;
}

const APP = 'https://tabibi.jp';
const webSearch = (name) => `https://map.naver.com/p/search/${encodeURIComponent(name || '')}`;

// アプリがあればアプリで、なければブラウザ版のNAVER Mapで開く
function openNaver(path, params, webUrl) {
  const q = new URLSearchParams({ ...params, appname: APP }).toString();
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) {
    location.href = `intent://${path}?${q}#Intent;scheme=nmap;package=com.nhn.android.nmap;S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
    return;
  }
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    const start = Date.now();
    location.href = `nmap://${path}?${q}`;
    setTimeout(() => { if (!document.hidden && Date.now() - start < 2500) location.href = webUrl; }, 1500);
    return;
  }
  window.open(webUrl, '_blank', 'noopener,noreferrer');
}

export function NaverLinks({ place, route = true }) {
  if (!inKorea(place)) return null;
  const name = place.name || place.altName || '';
  const ll = { lat: String(place.lat), lng: String(place.lng) };
  return (
    <>
      <button type="button" className="naver" onClick={() => openNaver('place', { ...ll, name }, webSearch(name))}>NAVER Map</button>
      {route && (
        <button type="button" className="naver" onClick={() => openNaver('route/public', { dlat: ll.lat, dlng: ll.lng, dname: name }, webSearch(name))}>道案内<small>NAVER Map</small></button>
      )}
    </>
  );
}
