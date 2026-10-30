'use client';
// お店の写真（小さい四角）
// 写真は1枚ごとにGoogleの料金がかかるので、上から5件だけ自動で出し、6件目からは「写真を見る」を押したときだけ取りに行く
import { useState } from 'react';

export const AUTO_PHOTOS = 5;

export function Cam({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

const photoSrc = (name) => `/api/photo?name=${encodeURIComponent(name)}`;

// name：写真の名前（Google）／auto：自動で出すか／onOpen：写真を押したとき（詳細を開くなど）
export default function PhotoThumb({ name, auto, onOpen, onError, label = '詳細を見る' }) {
  const [show, setShow] = useState(false);
  if (!name) return <div className="thumb" />;
  if (!auto && !show) {
    return (
      <button type="button" className="thumb thumb-tap" onClick={() => setShow(true)}>
        <Cam />写真を見る
      </button>
    );
  }
  const img = <img className="thumb" src={photoSrc(name)} alt="" loading="lazy" onError={onError} />;
  if (!onOpen) return img;
  return <button type="button" className="thumbbtn" onClick={onOpen} aria-label={label}>{img}</button>;
}
