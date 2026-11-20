// タビビコール：電話をかける（POST）／残り回数と電話の結果を見る（GET）
// ・Googleでログインしている人だけ。回数券を1つ使う（Supabase の call_start。つながらなかったら戻す）
// ・電話番号は画面から受け取らず、保存したお店の番号を Google から取り直す（ほかの番号に勝手にかけられないように）
// ・運営者だけ、テストとして自分のスマホにかけられる（公開前に本物のお店へかけないため）
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { KEY } from '../../lib/places';
import { gfetch, MOCK } from '../../lib/gfetch';
import { CALL_BLOCK_SEC, CALL_MAX_BLOCKS, GREETING, VOICE, cleanRequest, langOfPhone, toE164 } from '../../lib/call';
import { rpcJson, randomSecret, relayTwiml, twilioCreateCall, callUpdate } from '../../lib/call-server';
import { SUPABASE_URL, SUPABASE_KEY } from '../../lib/supabase-public';

const json = (o, status = 200) => Response.json(o, { status });
const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').slice(0, 4000);
function envOf() {
  try { return getCloudflareContext().env; } catch { return process.env; }
}

async function placePhone(placeId) {
  if (!KEY()) throw new Error('お店の電話番号を調べる設定がまだ終わっていません');
  const r = await gfetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: { 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': 'internationalPhoneNumber' },
    cache: 'no-store',
  }, 10000);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('お店の電話番号を調べられませんでした。少し待ってからもう一度試してください');
  return toE164(d.internationalPhoneNumber);
}

// テスト用モード（自分のパソコンだけ）：本物の電話をかけずに、画面の流れだけ確かめる
const mockCalls = new Map();
function mockGet(id) {
  if (!id) return json({ left: 3, owner: true, calls: [...mockCalls.values()].map(({ t, ...c }) => c) });
  const c = mockCalls.get(id);
  if (!c) return json({ error: 'この電話は見つかりませんでした' }, 404);
  const s = (Date.now() - c.t) / 1000;
  const status = s < 3 ? 'calling' : s < 6 ? 'ringing' : s < 10 ? 'talking' : 'done';
  const done = status === 'done';
  return json({ ...c, t: undefined, status, outcome: done ? 'alternative' : null,
    tickets: done ? 1 : 1, result: done ? { summary_ja: '19時は満席のため、19時30分に2名で予約できました。名前はUENOです。', notes_ja: '席は2時間制だそうです。' } : null,
    transcript: done ? [{ who: 'ai', text: '안녕하세요. AI 예약 도우미입니다.' }, { who: 'shop', text: '네 말씀하세요' }, { who: 'ai', text: '7시에 2명 가능할까요?' }, { who: 'shop', text: '7시 반은 돼요' }] : null });
}

export async function GET(req) {
  const token = bearer(req);
  if (!token) return json({ error: 'Googleでログインしてください' }, 401);
  const id = new URL(req.url).searchParams.get('id') || '';
  if (MOCK) return mockGet(id);
  if (id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: '電話の指定が正しくありません' }, 400);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/calls?id=eq.${id}&select=id,created_at,place_name,lang,request,status,outcome,result,transcript,duration,charged,tickets,is_test`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (!r || !r.ok) return json({ error: '電話の様子を確認できませんでした' }, r?.status === 401 ? 401 : 500);
    const rows = await r.json().catch(() => []);
    if (!rows[0]) return json({ error: 'この電話は見つかりませんでした' }, 404);
    return json(rows[0]);
  }
  const c = await rpcJson('my_call_credits', {}, token);
  if (c.status === 401 || c.status === 403) return json({ error: 'Googleでログインしてください' }, 401);
  if (!c.ok || !c.data) return json({ error: '回数を確認できませんでした（運営者の設定待ちの可能性があります）' }, 500);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/calls?select=id,created_at,place_id,place_name,status,outcome,result,is_test&order=created_at.desc&limit=20`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  const list = r && r.ok ? await r.json().catch(() => []) : [];
  return json({ left: c.data.left, owner: !!c.data.owner, calls: list });
}

export async function POST(req) {
  const env = envOf();
  const token = bearer(req);
  if (!token) return json({ error: 'Googleでログインしてください' }, 401);
  if (MOCK) {
    const b = await req.json().catch(() => null);
    if (!cleanRequest(b?.request)) return json({ error: '日にち・時間・人数・名前を入れてください' }, 400);
    const id = crypto.randomUUID();
    mockCalls.set(id, { id, t: Date.now(), created_at: new Date().toISOString(), place_id: b.placeId, place_name: b.placeName, request: b.request, is_test: !!b.testPhone });
    return json({ id });
  }
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM || !env.ANTHROPIC_API_KEY) {
    return json({ error: '電話の設定がまだ終わっていません（運営者の設定待ち）' }, 503);
  }
  const body = await req.json().catch(() => null);
  const request = cleanRequest(body?.request);
  if (!request) return json({ error: '日にち・時間・人数・名前を入れてください' }, 400);
  const placeId = typeof body?.placeId === 'string' ? body.placeId : '';
  const placeName = typeof body?.placeName === 'string' ? body.placeName.replace(/[\u0000-\u001F<>]/g, ' ').slice(0, 200) : '';
  if (!placeName) return json({ error: 'お店の指定が正しくありません' }, 400);

  const me = await rpcJson('my_call_credits', {}, token);
  if (me.status === 401 || me.status === 403) return json({ error: 'Googleでログインしてください' }, 401);
  if (!me.ok || !me.data) return json({ error: '回数を確認できませんでした' }, 500);
  const owner = !!me.data.owner;

  let phone = '';
  let isTest = false;
  if (body?.testPhone) {
    if (!owner) return json({ error: 'テスト用の番号は使えません' }, 403);
    phone = toE164(body.testPhone);
    isTest = true;
    if (!phone) return json({ error: 'テスト用の番号は +81 から始まる形で入れてください' }, 400);
  } else {
    if (!/^[A-Za-z0-9_-]{1,300}$/.test(placeId)) return json({ error: 'お店の指定が正しくありません' }, 400);
    try { phone = await placePhone(placeId); } catch (e) { return json({ error: e.message }, 502); }
    if (!phone) return json({ error: 'このお店の電話番号がGoogleマップに載っていませんでした' }, 400);
  }
  const L = langOfPhone(phone);
  if (!L) return json({ error: 'この国のお店にはまだ電話できません' }, 400);
  if (L.testOnly && !isTest) return json({ error: '日本のお店には電話できません' }, 400);
  // テストのときは、話す言語を選べる（自分のスマホで韓国語の会話を試すため）
  const lang = isTest && typeof body?.testLang === 'string' && VOICE[body.testLang] ? body.testLang : L.lang;

  if (!owner && me.data.left < 1) return json({ error: '回数券が残っていません', needCredits: true }, 402);

  const secret = randomSecret();
  const started = await rpcJson('call_start', { p: { place_id: placeId, place_name: placeName, phone, lang, request, is_test: isTest }, secret }, token);
  if (!started.ok) return json({ error: '電話を始められませんでした（運営者の設定待ちの可能性があります）' }, 500);
  const id = started.data;
  if (!id) return json({ error: 'いま別の電話をかけているか、回数券が残っていません' }, 409);

  const origin = new URL(req.url).origin;
  const host = new URL(origin).host;
  const q = `c=${id}&k=${secret}`;
  try {
    const twiml = relayTwiml({ wsUrl: `wss://${host}/call/ws?${q}`, greeting: GREETING[lang], voice: VOICE[lang] });
    // 電話の長さの上限：持っているチケット（はじめの1枚＋残り）× 3分。運営者は念のための上限まで
    const blocks = owner ? CALL_MAX_BLOCKS : Math.min(CALL_MAX_BLOCKS, Math.max(1, Number(me.data.left) || 1));
    const c = await twilioCreateCall(env, { to: phone, twiml, statusUrl: `${origin}/call/status?${q}`, timeLimit: blocks * CALL_BLOCK_SEC + 15 });
    await callUpdate(id, secret, { call_sid: c.sid, status: 'calling' });
  } catch (e) {
    console.error('[tabibi] call start', String(e?.message || e));
    await callUpdate(id, secret, { status: 'failed', result: { summary_ja: '電話をかけられませんでした。回数は戻してあります。' } });
    return json({ error: '電話をかけられませんでした。回数は戻してあります。少し待ってからもう一度試してください' }, 502);
  }
  return json({ id });
}
