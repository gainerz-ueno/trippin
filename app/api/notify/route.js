// ログイン・設定変更のとき、本人にメールで知らせる（Resend。送り主 noreply@tabibi.jp）
// ・送り先は、ログインの印（トークン）から Supabase で確かめた本人のメールだけ。画面から送られた宛先は使わない
// ・鍵は Cloudflare の秘密の値 RESEND_API_KEY から読む。コードには書かない
// ・鍵が無い／送れないときは、メールを送らずに記録だけ残し、画面は止めない（いつも 200 を返す）
// ・同じ種類は10分に1回まで（Supabase の log_security_event が判断）
import { SUPABASE_URL, SUPABASE_KEY } from '../../lib/supabase-public.js';
import { isKind, buildMail, deviceLabel } from '../../lib/loginsafety.mjs';

const FROM = 'Tabibi <noreply@tabibi.jp>';
const json = (o) => Response.json(o, { status: 200 });
const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').slice(0, 4000);

async function sb(path, token, body) {
  return fetch(`${SUPABASE_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
}

export async function POST(req) {
  try {
    const token = bearer(req);
    const kind = String((await req.json().catch(() => ({}))).kind || '');
    if (!token || !isKind(kind)) return json({ sent: false, reason: 'bad-request' });

    // テスト用モード（本物の Supabase・Resend を使わない）：送らずに記録だけ
    if (process.env.TABIBI_MOCK === '1') {
      console.log(`[notify] テスト用モードのため送信せず記録のみ kind=${kind}`);
      return json({ sent: false, reason: 'mock' });
    }

    const ur = await sb('/auth/v1/user', token);
    if (!ur.ok) return json({ sent: false, reason: 'not-logged-in' });
    const email = String((await ur.json())?.email || '');
    if (!email) return json({ sent: false, reason: 'no-email' });

    const device = deviceLabel(req.headers.get('user-agent'));
    const rr = await sb('/rest/v1/rpc/log_security_event', token, { k: kind, dev: device });
    if (!rr.ok) { console.warn(`[notify] 記録できませんでした kind=${kind} status=${rr.status}`); return json({ sent: false, reason: 'log-failed' }); }
    const eventId = await rr.json();
    if (eventId === null) return json({ sent: false, reason: 'recent' });

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn(`[notify] RESEND_API_KEY が未設定のため、メールは送らず記録のみ kind=${kind} event=${eventId}`);
      return json({ sent: false, reason: 'no-key' });
    }
    const mail = buildMail(kind, { at: Date.now(), device });
    const sr = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [email], subject: mail.subject, text: mail.text, html: mail.html }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (!sr || !sr.ok) {
      console.warn(`[notify] メールを送れませんでした kind=${kind} event=${eventId} status=${sr ? sr.status : 'つながらない'}`);
      return json({ sent: false, reason: 'send-failed' });
    }
    await sb('/rest/v1/rpc/mark_security_event_mailed', token, { eid: eventId }).catch(() => {});
    return json({ sent: true });
  } catch (e) {
    console.warn('[notify] 想定外のエラー', e && e.message);
    return json({ sent: false, reason: 'error' });
  }
}
