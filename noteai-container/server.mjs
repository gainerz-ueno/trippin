// コンテナの中で動く小さなサーバー。
// Worker から回ってきた「AIで作る」の注文（POST /api/noteai）を、Vercel のときと同じ中身（app/api/noteai/draw.js）で処理する。
import { createServer } from 'node:http';
import { POST } from './app/api/noteai/draw.js';

const PORT = Number(process.env.PORT) || 8080;

createServer(async (req, res) => {
  try {
    if (req.method !== 'POST' || !req.url.startsWith('/api/noteai')) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const request = new Request(`http://localhost${req.url}`, { method: 'POST', headers, body: Buffer.concat(chunks) });
    const out = await POST(request);
    const h = {};
    out.headers.forEach((v, k) => { h[k] = v; });
    res.writeHead(out.status, h).end(Buffer.from(await out.arrayBuffer()));
  } catch (e) {
    console.error('noteai server', e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'AIがうまく描けませんでした。もう一度試してください' }));
  }
}).listen(PORT, '0.0.0.0', () => console.log(`noteai listening on ${PORT}`));
