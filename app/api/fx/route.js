// 為替の相場（円が基準）。無料の取得元 open.er-api.com（鍵なし）から取り、6時間はサーバー側で使い回す
// 取得元は1日1回しか更新されないので、これで十分（呼び出しの上限にも当たらない）
import { pickRates } from '../../lib/fx.mjs';

export async function GET() {
  // 試験用（TABIBI_MOCK=1 のときだけ。外へつながらない部屋で画面を確かめる用。2026-11-13 に取得元から取った数字）
  if (process.env.TABIBI_MOCK) {
    return Response.json({ updated: 'Fri, 13 Nov 2026 00:02:31 +0000', rates: { TWD: 0.206247, KRW: 8.349869, HKD: 0.049096, CNY: 0.041827, VND: 160.774119, THB: 0.211912, SGD: 0.008049, MYR: 0.025528, PHP: 0.398935, USD: 0.006258, EUR: 0.005656 } });
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/JPY', { signal: AbortSignal.timeout(8000), cf: { cacheTtl: 21600, cacheEverything: true } });
    if (!res.ok) throw new Error('status ' + res.status);
    const out = pickRates(await res.json());
    if (!out) throw new Error('bad body');
    return Response.json(out, { headers: { 'Cache-Control': 'private, max-age=3600' } });
  } catch {
    return Response.json({ error: '為替の相場を取れませんでした。少し待ってからもう一度ためしてください' }, { status: 502 });
  }
}
