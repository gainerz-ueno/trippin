// タビビコールの電話テスト用「お店役」（運営者のテストだけ）：タビビの050番号にかかってきた電話に、決まった台詞で出る。
// タビビコールが自分の番号（TWILIO_FROM）にかけたときだけ答え、ほかの電話は断る。
// 目的：本物の電話回線を通して、お店の短い返事（可以・好・對）が文字になってAIに届くかを、社長の電話を使わずに確かめる
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { twilioSignatureOk } from '../../../lib/call-server';

const xml = (body) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { 'content-type': 'text/xml' } });
const say = (t) => `<Say language="cmn-TW" voice="Google.cmn-TW-Standard-A">${t}</Say>`;
const pause = (s) => `<Pause length="${s}"/>`;

export async function POST(req) {
  let env; try { env = getCloudflareContext().env; } catch { env = process.env; }
  const form = Object.fromEntries(await req.formData());
  const ok = await twilioSignatureOk(env.TWILIO_AUTH_TOKEN, req.url, form, req.headers.get('x-twilio-signature'));
  if (!ok || form.From !== env.TWILIO_FROM) return xml('<Reject/>');
  // あいさつ（約9秒）→ 返事 → 用件（約7秒）→ 返事 → 確認（約5秒）→ 返事 → 終わり
  return xml([
    pause(1), say('喂，您好'),
    pause(10), say('可以'),
    pause(9), say('好'),
    pause(8), say('對'),
    pause(6), say('好，再見'),
    pause(4),
  ].join(''));
}
