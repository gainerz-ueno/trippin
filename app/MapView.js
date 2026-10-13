'use client';
import { useEffect, useRef, useState } from 'react';

// Google マップの読み込み（1回だけ）
let loader = null;
function loadMaps() {
  if (typeof window === 'undefined') return Promise.reject();
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (loader) return loader;
  loader = fetch('/api/mapkey')
    .then((r) => r.json())
    .then(({ key }) => {
      if (!key) throw new Error('地図の鍵が設定されていません');
      return new Promise((resolve, reject) => {
        window.__trippinMapsReady = () => resolve(window.google.maps);
        const s = document.createElement('script');
        s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&language=ja&callback=__trippinMapsReady&loading=async`;
        s.async = true;
        s.onerror = () => reject(new Error('地図を読み込めませんでした'));
        document.head.appendChild(s);
      });
    })
    .catch((e) => {
      loader = null;
      throw e;
    });
  return loader;
}

const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 候補・行ったのお店を、カテゴリーの色のピンで地図に並べる
export default function MapView({ items, colorOf, photoSrc, hotels = [], visible = true }) {
  const box = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const info = useRef(null);
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadMaps()
      .then((maps) => {
        if (!alive || !box.current) return;
        map.current = new maps.Map(box.current, {
          center: { lat: 25.04, lng: 121.53 },
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        info.current = new maps.InfoWindow();
        setReady(true);
      })
      .catch((e) => alive && setErr(e?.message || '地図を読み込めませんでした'));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!ready || !visible) return;
    const maps = window.google.maps;
    markers.current.forEach((m) => m.setMap(null));
    markers.current = [];
    const pts = items.filter((i) => i.lat != null && i.lng != null);
    const hs = hotels.filter((h) => h && h.lat != null && h.lng != null);
    if (!pts.length && !hs.length) return;

    const bounds = new maps.LatLngBounds();
    // ホテル（黒い四角に「H」）
    hs.forEach((h) => {
      const pos = { lat: h.lat, lng: h.lng };
      bounds.extend(pos);
      const m = new maps.Marker({
        position: pos,
        map: map.current,
        title: h.name,
        icon: { path: 'M -11,-11 L 11,-11 L 11,11 L -11,11 Z', fillColor: '#1C2836', fillOpacity: 1, strokeColor: '#FFFFFF', strokeWeight: 2, scale: 1 },
        label: { text: 'H', color: '#FFFFFF', fontSize: '13px', fontWeight: '700' },
        zIndex: 2000,
      });
      m.addListener('click', () => {
        info.current.setContent(
          `<div style="max-width:220px;color:#1C2836"><div style="font-size:12px;color:#5E6E80">泊まるホテル</div>` +
            `<div style="font-weight:700;font-size:14px">${esc(h.name)}</div>` +
            (h.mapsUrl ? `<a href="${esc(h.mapsUrl)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;font-size:12px;color:#2F5D7C">Googleマップで開く</a>` : '') +
            `</div>`
        );
        info.current.open({ map: map.current, anchor: m });
      });
      markers.current.push(m);
    });
    pts.forEach((it) => {
      const no = items.indexOf(it) + 1;
      const pos = { lat: it.lat, lng: it.lng };
      bounds.extend(pos);
      const m = new maps.Marker({
        position: pos,
        map: map.current,
        title: it.name,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 13,
          fillColor: colorOf(it.category),
          fillOpacity: 1,
          strokeColor: it.done ? '#1C2836' : '#FFFFFF',
          strokeWeight: it.done ? 3 : 2,
        },
        label: { text: String(no), color: '#FFFFFF', fontSize: '13px', fontWeight: '700' },
        zIndex: 1000 - no,
      });
      m.addListener('click', () => {
        const img = it.photo ? `<img src="${photoSrc(it.photo)}" alt="" style="width:100%;height:96px;object-fit:cover;border-radius:8px;margin-bottom:6px">` : '';
        info.current.setContent(
          `<div style="max-width:220px;font-family:inherit;color:#1C2836">${img}` +
            `<div style="font-weight:700;font-size:14px">${no}. ${esc(it.name)}</div>` +
            (it.altName ? `<div style="font-size:12px;margin-top:2px">${esc(it.altName)}</div>` : '') +
            `<div style="font-size:12px;color:#5E6E80;margin-top:4px">${esc(it.category || 'カテゴリーなし')}${it.done ? '・行った' : '・候補'}</div>` +
            (it.mapsUrl ? `<a href="${esc(it.mapsUrl)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;font-size:12px;color:#2F5D7C">Googleマップで開く</a>` : '') +
            `</div>`
        );
        info.current.open({ map: map.current, anchor: m });
      });
      markers.current.push(m);
    });
    const all = [...pts, ...hs];
    if (all.length === 1) {
      map.current.setCenter({ lat: all[0].lat, lng: all[0].lng });
      map.current.setZoom(15);
    } else {
      map.current.fitBounds(bounds, 40);
    }
  }, [ready, items, colorOf, photoSrc, hotels, visible]);

  if (err) return <div className="empty">{err}</div>;
  return (
    <div className="mapwrap">
      <div ref={box} className="map" />
      {ready && !items.some((i) => i.lat != null) && <p className="hint">地図に出せるお店がありません。</p>}
    </div>
  );
}
