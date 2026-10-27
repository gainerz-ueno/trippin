// Google（Places・Gemini・翻訳）への問い合わせ
// ・待ちすぎない：決めた時間で打ち切る（固まったように見えるのを防ぐ）
// ・テスト用モード（TABIBI_MOCK=1）：本物のGoogleに行かず、にせ物の答えを返す（APIキーなしで全画面を動かして確かめるため）
import { mockGoogle } from './mock-google.js';

// 本物のキー（GOOGLE_MAPS_API_KEY）が入っている場所や、Vercel の本番では、まちがって付けても動かない
export const MOCK = process.env.TABIBI_MOCK === '1' && !process.env.GOOGLE_MAPS_API_KEY && process.env.VERCEL_ENV !== 'production';

export async function gfetch(url, opts = {}, ms = 15000) {
  if (MOCK) return mockGoogle(url, opts);
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

// 画面に出すエラーの言葉（英語のままのGoogleのエラーは出さない。中身はログに残す）
export function friendly(e, fallback) {
  const m = String(e?.message || '');
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return '時間がかかりすぎたので止めました。少し待ってからもう一度試してください';
  }
  // こちらで作った日本語のエラー（かなを含む）はそのまま。英語のまま来たもの（Googleのエラーなど）は出さない
  if (/[\u3040-\u30ff]/.test(m)) return m;
  console.error('[tabibi]', fallback, m);
  return fallback;
}
