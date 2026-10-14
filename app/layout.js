import './globals.css';

export const metadata = {
  metadataBase: new URL('https://tabibi.jp'),
  title: 'Tabibi',
  description: '旅を、ビビッと。旅行前に行きたいお店・名所をGoogleマップから探して、候補リストにまとめるアプリ',
  icons: { icon: '/icon-512.png', apple: '/apple-icon.png' },
  openGraph: { title: 'Tabibi', description: '旅を、ビビッと。', images: ['/og.png'], siteName: 'Tabibi', locale: 'ja_JP', type: 'website' },
  twitter: { card: 'summary_large_image', images: ['/og.png'] },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700;900&family=Noto+Sans+JP:wght@400;500;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
