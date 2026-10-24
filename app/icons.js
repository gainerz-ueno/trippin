// Tabibi のアイコン（ロゴの3色：コーラル・イエロー・ティール）
// 画像ではなく図形で描くので、どの画面でもくっきり・軽い

const C = { coral: '#E5483B', coralDark: '#B8362B', coralLight: '#FF8A7E', yellow: '#F4B23A', yellowDark: '#E09A1E', yellowLight: '#FFE7A8', teal: '#0F8F8A', tealDark: '#0B6E6A', tealLight: '#BFE9E6', ink: '#1E2633' };

// さがす画面のカテゴリーのアイコン（押すとそのカテゴリーで検索）
export const CAT_SEARCH = [
  { id: 'gourmet', label: 'グルメ', q: 'グルメ 人気店' },
  { id: 'cafe', label: 'カフェ', q: 'カフェ' },
  { id: 'sight', label: '観光', q: '観光スポット' },
  { id: 'night', label: '夜市', q: '夜市' },
  { id: 'shop', label: '買物', q: 'ショッピング' },
  { id: 'relax', label: '癒し', q: 'マッサージ スパ' },
];

export function CatIcon({ id, size = 48 }) {
  const p = { width: size, height: size, viewBox: '0 0 48 48', 'aria-hidden': true };
  switch (id) {
    case 'gourmet':
      return (
        <svg {...p}>
          <path d="M31 4l-9 18" stroke={C.ink} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M37 6l-12 16" stroke={C.ink} strokeWidth="2.6" strokeLinecap="round" />
          <ellipse cx="24" cy="23" rx="17" ry="5" fill={C.yellow} />
          <path d="M12 22c3-2 5 2 8 0s5 2 8 0 5 2 8 0" stroke={C.yellowLight} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M6 23h36c0 9-8 16-18 16S6 32 6 23z" fill={C.coral} />
          <path d="M10 27c2 4 6 7 11 8" stroke={C.coralLight} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <rect x="16" y="38" width="16" height="5" rx="2.5" fill={C.coralDark} />
        </svg>
      );
    case 'cafe':
      return (
        <svg {...p}>
          <rect x="26" y="2" width="4" height="18" rx="2" fill={C.coral} transform="rotate(14 28 11)" />
          <path d="M12 14h24l-3.5 29a3 3 0 0 1-3 2.5h-11a3 3 0 0 1-3-2.5z" fill={C.tealLight} />
          <path d="M14.6 26h18.8l-2.2 17a3 3 0 0 1-3 2.5h-8.4a3 3 0 0 1-3-2.5z" fill={C.yellow} />
          <circle cx="20" cy="40" r="2.2" fill={C.ink} />
          <circle cx="25" cy="41" r="2.2" fill={C.ink} />
          <circle cx="28" cy="37" r="2.2" fill={C.ink} />
          <rect x="9" y="11" width="30" height="6" rx="3" fill={C.teal} />
          <path d="M16 19l1 5" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity=".8" />
        </svg>
      );
    case 'sight':
      return (
        <svg {...p}>
          <path d="M2 42l14-18 9 11 6-7 15 14z" fill={C.teal} />
          <path d="M16 24l4 5-4-1-3 3z" fill={C.tealLight} />
          <path d="M24 4a11 11 0 0 1 11 11c0 8-11 18-11 18S13 23 13 15A11 11 0 0 1 24 4z" fill={C.coral} />
          <circle cx="24" cy="15" r="4.5" fill="#FFFFFF" />
          <path d="M17 10a8 8 0 0 1 4-3" stroke={C.coralLight} strokeWidth="2" strokeLinecap="round" fill="none" />
          <rect x="2" y="42" width="44" height="3" rx="1.5" fill={C.tealDark} />
        </svg>
      );
    case 'night':
      return (
        <svg {...p}>
          <path d="M2 6c8 5 36 5 44 0" stroke={C.ink} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M14 8v5M34 8v5" stroke={C.ink} strokeWidth="2" />
          {[14, 34].map((x) => (
            <g key={x}>
              <rect x={x - 5} y="12" width="10" height="4" rx="1.5" fill={C.yellow} />
              <ellipse cx={x} cy="25" rx="10" ry="10" fill={C.coral} />
              <path d={`M${x} 15c-3 3-3 17 0 20M${x} 15c3 3 3 17 0 20`} stroke={C.coralDark} strokeWidth="1.6" fill="none" />
              <rect x={x - 5} y="34" width="10" height="4" rx="1.5" fill={C.yellow} />
              <path d={`M${x} 38v5`} stroke={C.yellow} strokeWidth="2" strokeLinecap="round" />
            </g>
          ))}
          <path d="M8 21a7 7 0 0 1 3-4" stroke={C.coralLight} strokeWidth="2" strokeLinecap="round" fill="none" />
        </svg>
      );
    case 'shop':
      return (
        <svg {...p}>
          <path d="M17 17v-4a7 7 0 0 1 14 0v4" stroke={C.coral} strokeWidth="3.2" fill="none" strokeLinecap="round" />
          <path d="M9 15h30l-2.5 27a3 3 0 0 1-3 2.7h-19a3 3 0 0 1-3-2.7z" fill={C.yellow} />
          <path d="M33 15h6l-2.5 27a3 3 0 0 1-3 2.7h-2z" fill={C.yellowDark} />
          <circle cx="17" cy="20" r="1.8" fill={C.coralDark} />
          <circle cx="31" cy="20" r="1.8" fill={C.coralDark} />
          <path d="M18 30h12" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
          <path d="M24 30l6 10h-9z" fill={C.teal} />
        </svg>
      );
    case 'relax':
      return (
        <svg {...p}>
          <path d="M4 34c6 4 12 6 20 6s14-2 20-6c-4 9-11 12-20 12S8 43 4 34z" fill={C.teal} />
          <path d="M24 8c6 6 7 16 0 26-7-10-6-20 0-26z" fill={C.coral} />
          <path d="M24 34c-9-1-15-7-15-16 7 0 13 6 15 16z" fill={C.coralLight} />
          <path d="M24 34c9-1 15-7 15-16-7 0-13 6-15 16z" fill={C.coralLight} />
          <path d="M22 14c-1 3-1 7 0 10" stroke="#FFD7D2" strokeWidth="2" strokeLinecap="round" fill="none" />
          <circle cx="38" cy="8" r="3" fill={C.yellow} />
          <circle cx="10" cy="10" r="2" fill={C.yellow} />
        </svg>
      );
    case 'shot':
      return (
        <svg {...p}>
          <rect x="12" y="3" width="24" height="42" rx="6" fill={C.teal} />
          <rect x="15" y="8" width="18" height="28" rx="2.5" fill="#FFFFFF" />
          <path d="M18 22l4 4 8-9" stroke={C.coral} strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="20" y="39" width="8" height="2.6" rx="1.3" fill={C.tealLight} />
          <circle cx="38" cy="9" r="3" fill={C.yellow} />
        </svg>
      );
    case 'ai':
      return (
        <svg {...p}>
          <rect x="4" y="4" width="40" height="40" rx="12" fill={C.yellow} />
          <path d="M22 11l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill={C.ink} />
          <path d="M34 28l1.4 3.6L39 33l-3.6 1.4L34 38l-1.4-3.6L29 33l3.6-1.4z" fill={C.coral} />
        </svg>
      );
    default:
      return null;
  }
}

// 線のアイコン（文字色で描く）
const L = (d, extra = {}) => function Line({ size = 20, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...extra} {...rest}>
      {d}
    </svg>
  );
};
export const IcSearch = L(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>);
export const IcBookmark = L(<path d="M6 3h12v18l-6-4-6 4z" />);
export const IcCheckCircle = L(<><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>);
export const IcCheck = L(<path d="M5 12l5 5 9-10" />, { strokeWidth: 2.6 });
export const IcPin = L(<><path d="M12 21s-7-6.3-7-12a7 7 0 0 1 14 0c0 5.7-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>);
export const IcPen = L(<path d="M4 20h4L19 9l-4-4L4 16z" />);
export const IcHotel = L(<><path d="M3 21V8l9-5 9 5v13" /><path d="M9 21v-6h6v6" /></>);
export const IcPlane = L(<path d="M2 16l20-8-6 13-3-6-6-2z" />);
export const IcUser = L(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>);
export const IcDown = L(<path d="M6 9l6 6 6-6" />, { strokeWidth: 2.6 });
export const IcRight = L(<path d="M9 6l6 6-6 6" />, { strokeWidth: 2.4 });
export const IcPlus = L(<path d="M12 5v14M5 12h14" />, { strokeWidth: 2.4 });
export const IcBack = L(<path d="M15 6l-6 6 6 6" />, { strokeWidth: 2.4 });
export function IcMore({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" />
    </svg>
  );
}
