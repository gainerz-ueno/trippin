// 地図表示用の鍵（Trippin のサイトと地図表示だけに制限した鍵）をブラウザに渡す
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(
    { key: process.env.GOOGLE_MAPS_BROWSER_KEY || '' },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
