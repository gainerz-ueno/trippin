// ポイント：残りを見る（GET）・買う（POST：Stripe の決済画面を作る）
// 支払いが済んだかは、戻ってきたときと残りを見るときに Stripe に確かめてから足す（settleOrders）
import { PACK, bearer, envOf, myPoints, service, stripe, userOf, settleOrders } from '../../lib/points';
import { MOCK } from '../../lib/gfetch';

const json = (o, status = 200) => Response.json(o, { status });

export async function GET(req) {
  const token = bearer(req);
  if (!token) return json({ error: 'Googleでログインしてください', needLogin: true }, 401);
  if (MOCK) return json({ balance: 10, owner: false, pack: PACK });
  const u = await userOf(token);
  if (!u) return json({ error: 'Googleでログインしてください', needLogin: true }, 401);
  const added = await settleOrders(u.id).catch(() => 0);
  const p = await myPoints(token);
  if (!p.ok || !p.data) return json({ error: 'ポイントを確認できませんでした' }, 500);
  return json({ ...p.data, added, pack: PACK, canBuy: !!(envOf().STRIPE_SECRET_KEY && envOf().SUPABASE_SERVICE_ROLE_KEY) });
}

export async function POST(req) {
  const token = bearer(req);
  if (!token) return json({ error: 'Googleでログインしてください', needLogin: true }, 401);
  const env = envOf();
  if (!env.STRIPE_SECRET_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'ポイントの購入はただいま準備中です' }, 503);
  const u = await userOf(token);
  if (!u) return json({ error: 'Googleでログインしてください', needLogin: true }, 401);
  const origin = new URL(req.url).origin;
  const s = await stripe('/checkout/sessions', {
    mode: 'payment',
    client_reference_id: u.id,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'jpy',
    'line_items[0][price_data][unit_amount]': String(PACK.yen),
    'line_items[0][price_data][product_data][name]': `Tabibi ポイント ${PACK.points}pt`,
    'metadata[points]': String(PACK.points),
    'metadata[user_id]': u.id,
    ...(u.email ? { customer_email: u.email } : {}),
    locale: 'ja',
    success_url: `${origin}/?points=paid`,
    cancel_url: `${origin}/?points=cancel`,
  });
  if (!s.ok || !s.data?.id || !s.data?.url) return json({ error: '決済の画面を作れませんでした。もう一度試してください' }, 502);
  const o = await service('/rest/v1/point_orders', { method: 'POST', body: { id: s.data.id, user_id: u.id, points: PACK.points, amount: PACK.yen } });
  if (!o.ok) return json({ error: '注文を記録できませんでした。もう一度試してください' }, 500);
  return json({ url: s.data.url });
}
