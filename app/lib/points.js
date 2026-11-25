// ポイント制（2026-11-22 社長決定）のサーバー側の部品
// ・1000円＝150ポイント。お店の検索2pt／口コミ1pt／AIで画像3pt／タビビコール45pt（3分ごと）。はじめての人にお試し10pt
// ・減らす・戻すは Supabase の関数（points_spend / points_refund）で、本人のログインの印を使う
// ・足す（買ったとき）は Stripe で支払い済みを確かめてから、管理用の鍵（SUPABASE_SERVICE_ROLE_KEY）で points_grant を呼ぶ
// 鍵は Cloudflare のシークレット（STRIPE_SECRET_KEY・SUPABASE_SERVICE_ROLE_KEY）。画面やログに出さない
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { SUPABASE_URL, SUPABASE_KEY } from './supabase-public';
import { MOCK } from './gfetch';

export const PACK = { yen: 1000, points: 150 }; // 1回の購入
export const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').slice(0, 4000);
export function envOf() {
  try { return getCloudflareContext().env; } catch { return process.env; }
}

async function rpcUser(fn, token, body = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!r) return { ok: false, status: 503 };
  const data = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
}

// ポイントを使う。{ ok:true, ticket } ／ { ok:false, res: 返すべき Response }
export async function spend(req, kind) {
  if (MOCK) return { ok: true, ticket: 'mock' };
  const token = bearer(req);
  if (!token) return { ok: false, res: Response.json({ error: 'Googleでログインしてください', needLogin: true }, { status: 401 }) };
  const r = await rpcUser('points_spend', token, { kind });
  if (r.status === 401 || r.status === 403) return { ok: false, res: Response.json({ error: 'Googleでログインしてください', needLogin: true }, { status: 401 }) };
  if (!r.ok) return { ok: false, res: Response.json({ error: 'ポイントを確認できませんでした。もう一度試してください' }, { status: 500 }) };
  if (!r.data) return { ok: false, res: Response.json({ error: 'ポイントが足りません。ポイントを買ってから、もう一度試してください', needPoints: true }, { status: 402 }) };
  return { ok: true, ticket: r.data, token };
}

// うまくいかなかったときに戻す
export async function refund(s) {
  if (!s?.ticket || s.ticket === 'owner' || s.ticket === 'mock') return;
  await rpcUser('points_refund', s.token, { ticket: s.ticket }).catch(() => {});
}

export const myPoints = (token) => rpcUser('my_points', token);

// 管理用の鍵で Supabase を呼ぶ（買ったポイントを足すときだけ）
export async function service(path, { method = 'GET', body, prefer } = {}) {
  const key = envOf().SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { ok: false, status: 503 };
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { apikey: key, ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }), 'content-type': 'application/json', ...(prefer ? { Prefer: prefer } : (/\/rpc\//.test(path) ? {} : { Prefer: 'return=minimal' })) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!r) return { ok: false, status: 503 };
  const data = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
}

// Stripe を呼ぶ（form 形式）
export async function stripe(path, params, method = 'POST') {
  const key = envOf().STRIPE_SECRET_KEY;
  if (!key) return { ok: false, status: 503, data: null };
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const r = await fetch(`https://api.stripe.com/v1${path}${method === 'GET' && body ? '?' + body : ''}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : body,
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (!r) return { ok: false, status: 503, data: null };
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
}

// ログインしている人の ID（Supabase で確かめる）
export async function userOf(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const u = await r.json().catch(() => null);
  return u?.id ? u : null;
}

// まだ足していない支払い済みの注文があれば足す（決済画面から戻ってきたとき・残りを見たとき）
export async function settleOrders(userId) {
  const o = await service(`/rest/v1/point_orders?user_id=eq.${userId}&status=eq.open&created_at=gt.${new Date(Date.now() - 2 * 864e5).toISOString()}&select=id`);
  if (!o.ok || !Array.isArray(o.data)) return 0;
  let n = 0;
  for (const { id } of o.data.slice(0, 5)) {
    const s = await stripe(`/checkout/sessions/${encodeURIComponent(id)}`, null, 'GET');
    if (!s.ok || !s.data) continue;
    if (s.data.payment_status === 'paid' && s.data.client_reference_id === userId) {
      const g = await service('/rest/v1/rpc/points_grant', { method: 'POST', body: { order_id: id } });
      if (g.ok && g.data === true) n++;
    } else if (s.data.status === 'expired') {
      await service(`/rest/v1/point_orders?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'expired' } });
    }
  }
  return n;
}
