# 「AIで作る」eタビセツの絵を描く部分（sharp を使う）だけを動かす、Cloudflare のコンテナの入れ物。
# 画面やほかの機能は Worker（@opennextjs/cloudflare）で動くので、ここには入れない。
# 組み立ての場所はリポジトリのいちばん上（wrangler.jsonc の image_build_context）。
FROM mirror.gcr.io/library/node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY noteai-container/package.json noteai-container/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY noteai-container/server.mjs ./server.mjs
COPY app/api/noteai/draw.js app/api/noteai/credits.js ./app/api/noteai/
COPY app/lib/supabase-public.js app/lib/plan.js app/lib/gfetch.js app/lib/mock-google.js ./app/lib/
EXPOSE 8080
CMD ["node", "server.mjs"]
