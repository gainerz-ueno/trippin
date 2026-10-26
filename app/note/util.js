'use client';
// eタビセツ・eガイドブックで共通に使うもの
import { supa } from '../cloud';
import { embedCss } from './fonts';
import { jaError } from '../lib/api';

// 小さく縮めて見せる（中身は1080pxのまま）
export function Scaled({ width, children, size }) {
  const k = width / size.w;
  return (
    <div style={{ width, height: Math.round(size.h * k), position: 'relative', overflow: 'hidden' }}>
      <div style={{ width: size.w, height: size.h, transform: `scale(${k})`, transformOrigin: '0 0', position: 'absolute', top: 0, left: 0 }}>
        {children}
      </div>
    </div>
  );
}

// 画像AIに渡す写真（長い辺1024pxのJPEG）
export async function toB64(url, max = 1024) {
  if (!url) return null;
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}

export async function accessToken() {
  try { const { data } = await supa().auth.getSession(); return data.session?.access_token || null; } catch { return null; }
}

// 画面の部品をそのまま画像（PNG）にする
export async function renderNode(node, size, fontId) {
  const { toBlob } = await import('html-to-image');
  const fontEmbedCSS = await embedCss(fontId, (node.textContent || '') + '0123456789');
  await Promise.all([...node.querySelectorAll('img')].map((img) => (img.decode ? img.decode().catch(() => {}) : null)));
  const opts = { width: size.w, height: size.h, pixelRatio: 1, fontEmbedCSS, skipAutoScale: true };
  let blob = await toBlob(node, opts);
  // Safari は1回目に写真が抜けることがあるので、もう1回作る
  if (/^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent)) blob = await toBlob(node, opts);
  if (!blob) throw new Error('画像を作れませんでした');
  return blob;
}

// 「AIで作る」（eタビセツ・表紙）。成功すると画像（JPEG）が返る
export async function callAi(body) {
  const t = await accessToken();
  if (!t) throw new Error('「AIで作る」はGoogleでログインすると使えます');
  let r;
  try {
    // 絵を描くのに1分以上かかることがあるので、2分で打ち切る
    r = await fetch('/api/noteai', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(body), signal: AbortSignal.timeout(130000) });
  } catch (e) {
    throw new Error(jaError(e, 'AIで作れませんでした。もう一度試してください'));
  }
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    if (r.status === 413) throw new Error('写真が大きすぎて送れませんでした。写真の枚数を減らしてもう一度試してください');
    if (r.status === 429 && d.quota) { const { logEvent } = await import('../cloud'); logEvent('ai_quota_hit'); }
    throw new Error(/[\u3040-\u30ff\u4e00-\u9fff]/.test(d.error || '') ? d.error : 'AIで作れませんでした。もう一度試してください');
  }
  const b = await r.blob();
  try { b.fixJa = decodeURIComponent(r.headers.get('x-fix-ja') || ''); } catch { b.fixJa = ''; }
  return b;
}
export async function aiLeft() {
  const d = await aiPlan();
  return d ? d.left : null;
}
// いまのプラン（無料／プレミアム）と「AIで作る」の残り回数。決めるのはサーバー（Supabase の entitlements）
export async function aiPlan() {
  const t = await accessToken();
  if (!t) return null;
  try {
    const r = await fetch('/api/noteai', { headers: { Authorization: 'Bearer ' + t }, signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    return r.ok && typeof d.left === 'number' ? { left: d.left, plan: d.plan || 'free', limit: d.limit ?? null } : null;
  } catch { return null; }
}

// 画像を保存・シェア
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export async function shareBlob(blob, name) {
  const file = new File([blob], name, { type: blob.type || 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  downloadBlob(blob, name);
}
