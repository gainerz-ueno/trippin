// Cloudflare の入口（Worker）。
// ・画面とほとんどの機能は、@opennextjs/cloudflare で Cloudflare 用に組み立てた Next.js（.open-next/worker.js）がそのまま動かす
// ・「AIで作る」の絵を描く部分だけは sharp（画像の切り貼り・縮小の部品）が要るので「コンテナ」で動かす（下の NoteAi）
//   使わない時間が続くとコンテナは眠り、費用はかからない。次に使うときは数秒で起き上がる（AIが描く時間に比べればわずか）
import { Container } from '@cloudflare/containers';
import handler from '../.open-next/worker.js';
import { handleWs, handleStatus } from './call.js';

export class NoteAi extends Container {
  defaultPort = 8080;
  // 10分使われなければ眠る
  sleepAfter = '10m';
  // 画像AI（Gemini）と Supabase への通信に必要
  enableInternet = true;

  constructor(ctx, env) {
    super(ctx, env);
    // コンテナに渡すのは、絵を描くのに要る鍵だけ
    this.envVars = { GEMINI_API_KEY: env.GEMINI_API_KEY || '', PORT: '8080', NODE_ENV: 'production' };
  }

  // 届いた注文をコンテナに渡す。
  // （Next.js 側の仕組みが「Request」の形を入れ替えているため、そのままだと渡せない。中身を取り出して渡し直す）
  async fetch(request) {
    return this.containerFetch(request.url, { method: request.method, headers: request.headers, body: request.body });
  }
}

export default {
  async fetch(request, env, ctx) {
    // お店の写真（/api/photo）の転送先は、Vercel のときと同じく1日覚えておく（Google に何度も取りに行かず、費用を抑える）
    const url = new URL(request.url);
    // タビビコール：電話の会話と電話の状態（Twilio から来る。中身は cloudflare/call.js）
    if (url.pathname === '/call/ws') return handleWs(request, env, ctx);
    if (url.pathname === '/call/status') return handleStatus(request, env);
    if (request.method === 'GET' && url.pathname === '/api/photo') {
      const cache = caches.default;
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await handler.fetch(request, env, ctx);
      if (res.status === 302) ctx.waitUntil(cache.put(request, res.clone()));
      return res;
    }
    return handler.fetch(request, env, ctx);
  },
};
