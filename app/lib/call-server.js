// タビビコールのサーバー側の部品（Twilio・Supabase・Claude）。鍵は Cloudflare のシークレットから読む
// ・TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN：Twilio の鍵
// ・TWILIO_FROM：かける側の番号（050番号。届くまではテスト用に確認済みの番号）
// ・ANTHROPIC_API_KEY：Claude（会話と結果のまとめ）
import { SUPABASE_URL, SUPABASE_KEY } from './supabase-public.js';

export const CLAUDE_MODEL = 'claude-haiku-5-5';

export function rpc(fn, body, token) {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token || SUPABASE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  }).catch(() => new Response('null', { status: 503 }));
}

export async function rpcJson(fn, body, token) {
  const r = await rpc(fn, body, token);
  if (!r.ok) return { ok: false, status: r.status, data: null };
  return { ok: true, status: r.status, data: await r.json().catch(() => null) };
}

export const callUpdate = (id, secret, patch) => rpc('call_update', { cid: id, secret, patch });

export function randomSecret() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function relayTwiml({ wsUrl, greeting, voice }) {
  const attrs = { url: wsUrl, welcomeGreeting: greeting, interruptible: 'speech', welcomeGreetingInterruptible: 'none', ...voice };
  const a = Object.entries(attrs).map(([k, v]) => `${k}="${xml(v)}"`).join(' ');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><ConversationRelay ${a}/></Connect><Hangup/></Response>`;
}

export async function twilioCreateCall(env, { to, twiml, statusUrl, timeLimit }) {
  const sid = env.TWILIO_ACCOUNT_SID, tok = env.TWILIO_AUTH_TOKEN;
  const form = new URLSearchParams({ To: to, From: env.TWILIO_FROM, Twiml: twiml, TimeLimit: String(timeLimit), Timeout: '30', StatusCallback: statusUrl, StatusCallbackMethod: 'POST' });
  for (const ev of ['initiated', 'ringing', 'answered', 'completed']) form.append('StatusCallbackEvent', ev);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${sid}:${tok}`), 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`twilio ${r.status} ${d?.code || ''} ${d?.message || ''}`);
  return d;
}

// Twilio から届いたものか確かめる（X-Twilio-Signature）
export async function twilioSignatureOk(authToken, url, params, signature) {
  if (!authToken || !signature) return false;
  let data = url;
  if (params) for (const k of Object.keys(params).sort()) data += k + params[k];
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (b64.length !== signature.length) return false;
  let d = 0;
  for (let i = 0; i < b64.length; i++) d |= b64.charCodeAt(i) ^ signature.charCodeAt(i);
  return d === 0;
}

// Claude に1回だけ聞く（結果のまとめ）
export async function claudeOnce(env, { system, user, maxTokens = 600 }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    signal: AbortSignal.timeout(30000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`claude ${r.status} ${d?.error?.message || ''}`);
  return (d.content || []).map((c) => c.text || '').join('');
}

// Claude の返事を少しずつ受け取る（電話の会話用。待ち時間を短くするため）
export async function* claudeStream(env, { system, messages, maxTokens = 220, signal }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages, stream: true }),
    signal,
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => '');
    throw new Error(`claude ${r.status} ${t.slice(0, 200)}`);
  }
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = block.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line.slice(6)); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') yield ev.delta.text;
      if (ev.type === 'error') throw new Error('claude stream ' + (ev.error?.message || ''));
    }
  }
}
