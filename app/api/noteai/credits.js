// 「AIで作る」の回数の確認（あと何回使えるか）と、そのための共通の部品
// ・回数を見るだけなら sharp が要らないので、ここは Cloudflare の Worker でそのまま動かす（コンテナを起こさない）
// ・draw.js（絵を描く部分・コンテナで動く）からも使う。コンテナの中では Node の決まりで、読み込むファイル名に .js まで書く
// ・回数は無料／プレミアムで決まる（app/lib/plan.js。数えるのはSupabaseの ai_quota_use。失敗したら回数を戻す）
import { PLAN } from '../../lib/plan.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../../lib/supabase-public.js';
import { MOCK } from '../../lib/gfetch.js';

export const json = (o, status = 200) => Response.json(o, { status });

export async function rpc(fn, token, body = {}) {
  // テスト用モード：回数の数え方だけ、にせ物で動かす（本物と同じ回数の決まり）
  if (MOCK) return mockRpc(fn, token, body);
  // つながらないときは「回数を確認できませんでした」として扱う（落ちないように）
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  }).catch(() => new Response('{}', { status: 503 }));
}
// テスト用：トークンは mock-token:ユーザー名。名前が premium で始まる人は月払い、premiumyear で始まる人は年払い
const mockUses = new Map();
function mockRpc(fn, token, body) {
  const ok = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
  const m = /^mock-token(?::([\w-]{1,40}))?$/.exec(token);
  if (!m) return new Response('{}', { status: 401 });
  const name = m[1] || 'mock-user';
  const plan = name.startsWith('premiumyear') ? 'premium_year' : name.startsWith('premium') ? 'premium_month' : 'free';
  const limit = plan === 'premium_year' ? PLAN.AI_YEAR : plan === 'premium_month' ? PLAN.AI_MONTH : PLAN.AI_FREE_TOTAL;
  const n = mockUses.get(name) || 0;
  if (fn === 'my_plan') return ok({ plan, limit, used: n, left: Math.max(0, limit - n) });
  if (fn === 'ai_quota_use') { if (n >= limit) return ok(null); mockUses.set(name, n + 1); return ok('t' + (n + 1)); }
  if (fn === 'ai_quota_refund') { mockUses.set(name, Math.max(0, n - 1)); return ok(true); }
  return new Response('{}', { status: 404 });
}
export const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').slice(0, 4000);

// あと何回使えるか
// 運営者のアカウントは回数の制限なし（動作確認のため）。ログインしているアカウントをSupabaseで確かめる
const UNLIMITED = new Set(['be07854d-c007-4404-85cd-fddc9867e5ff']);
export async function isUnlimited(token) {
  if (MOCK) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return false;
    const u = await r.json();
    return UNLIMITED.has(u?.id);
  } catch { return false; }
}

export async function GET(req) {
  const token = bearer(req);
  if (!token) return json({ error: 'Googleでログインしてください' }, 401);
  if (await isUnlimited(token)) return json({ left: 999, plan: 'owner', limit: 999 });
  const r = await rpc('my_plan', token);
  if (r.status === 401 || r.status === 403) return json({ error: 'Googleでログインしてください' }, 401);
  if (!r.ok) return json({ error: '回数を確認できませんでした' }, 500);
  const p = await r.json().catch(() => null);
  if (!p || typeof p.left !== 'number') return json({ error: '回数を確認できませんでした' }, 500);
  return json({ left: p.left, plan: p.plan, limit: p.limit });
}
