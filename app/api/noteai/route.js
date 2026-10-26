// 「AIで作る」eタビセツの入口
// ・GET（今日あと何回使えるか）… ここ（Cloudflare の Worker）で答える。中身は credits.js
// ・POST（絵を描く・直す）… 絵の切り貼り・縮小に sharp を使うので、Cloudflare の「コンテナ」で動かす。
//   届いた注文（ログインの印も含めて）をそのままコンテナへ回し、返ってきた答えをそのまま返す。
//   絵を描く中身は draw.js（コンテナの中で、Vercel のときと同じ sharp で動く）
import { getCloudflareContext } from '@opennextjs/cloudflare';

export { GET } from './credits.js';

export async function POST(req) {
  const { env } = getCloudflareContext();
  // コンテナは1台にまとめる（使わない時間が続くと眠り、費用がかからない）
  const box = env.NOTEAI.get(env.NOTEAI.idFromName('main'));
  const headers = new Headers();
  for (const k of ['content-type', 'authorization']) {
    const v = req.headers.get(k);
    if (v) headers.set(k, v);
  }
  return box.fetch('http://noteai/api/noteai', { method: 'POST', headers, body: await req.arrayBuffer() });
}
