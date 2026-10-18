// 【一時的】1枚ノートのテンプレート用の絵を作るためだけの入口（作り終わったら消す）
// 合言葉（ハッシュだけをここに置く）を知っている人しか使えない
import { createHash, timingSafeEqual } from 'node:crypto';
const HASH = '567c583e3b8e9a8e2969adf27a331a1243bfb7b2002f2cb03fc8b2e62e23ad72';
function ok(t) {
  const a = Buffer.from(createHash('sha256').update(String(t || '')).digest('hex'));
  const b = Buffer.from(HASH);
  return a.length === b.length && timingSafeEqual(a, b);
}
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export async function GET(req) {
  if (!ok(req.headers.get('x-art-token'))) return new Response('not found', { status: 404 });
  const r = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } });
  const d = await r.json();
  return Response.json((d.models || []).map((m) => ({ name: m.name, methods: m.supportedGenerationMethods })).filter((m) => /image/i.test(m.name)));
}
export async function POST(req) {
  if (!ok(req.headers.get('x-art-token'))) return new Response('not found', { status: 404 });
  const { model, prompt, aspect } = await req.json();
  if (!/^[a-z0-9.\-]+$/.test(model || '')) return new Response('bad', { status: 400 });
  const r = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: String(prompt).slice(0, 4000) }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect || '1:1' } } }),
  });
  const d = await r.json();
  const part = d.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) return Response.json({ error: d.error?.message || 'no image', raw: JSON.stringify(d).slice(0, 500) }, { status: 502 });
  return new Response(Buffer.from(part.inlineData.data, 'base64'), { headers: { 'content-type': part.inlineData.mimeType || 'image/png' } });
}
export const maxDuration = 60;
