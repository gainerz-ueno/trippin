// 「AIで作る」の回数の確認（あと何回使えるか）と、そのための共通の部品
// ・回数を見るだけなら sharp が要らないので、ここは Cloudflare の Worker でそのまま動かす（コンテナを起こさない）
// ・draw.js（絵を描く部分・コンテナで動く）からも使う。コンテナの中では Node の決まりで、読み込むファイル名に .js まで書く
// ・回数は1人1日3回（数えるのはSupabaseの use_ai_credit。失敗したら回数を戻す）
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
// テスト用：トークンは mock-token:ユーザー名。1人1日3回（本番の use_ai_credit と同じ）
const mockUses = new Map();
function mockRpc(fn, token, body) {
  const ok = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
  const m = /^mock-token(?::([\w-]{1,40}))?$/.exec(token);
  if (!m) return new Response('{}', { status: 401 });
  const name = m[1] || 'mock-user';
  const limit = 3;
  const n = mockUses.get(name) || 0;
  if (fn === 'my_points') return ok({ balance: Math.max(0, limit - n) * 3 });
  if (fn === 'points_spend') { if (n >= limit) return ok(null); mockUses.set(name, n + 1); return ok('t' + (n + 1)); }
  if (fn === 'points_refund') { mockUses.set(name, Math.max(0, n - 1)); return ok(true); }
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
  // あと何回作れるか＝ポイントの残り÷3（2026-11-22 ポイント制）
  const r = await rpc('my_points', token);
  if (r.status === 401 || r.status === 403) return json({ error: 'Googleでログインしてください' }, 401);
  if (!r.ok) return json({ error: '回数を確認できませんでした' }, 500);
  const p = await r.json().catch(() => null);
  if (typeof p?.balance !== 'number') return json({ error: '回数を確認できませんでした' }, 500);
  return json({ left: Math.floor(p.balance / 3), points: p.balance });
}
