// ホーム画面に追加したときのアプリの情報（名前・アイコン・開き方）
export default function manifest() {
  return {
    name: 'Tabibi',
    short_name: 'Tabibi',
    description: '旅を、ビビッと。旅行前に行きたいお店・名所をまとめて、旅先で使うアプリ',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#EEF3F7',
    theme_color: '#EEF3F7',
    lang: 'ja',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
