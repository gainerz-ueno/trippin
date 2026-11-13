// ログイン対策の部品（画面にも Worker にも依存しない＝そのまま試験できる）
// ・ロック：5回失敗したら30分（レジレジ kitchen-pos と同じ決まり）
// ・メール通知：本文を作る／端末の説明を作る
// supabase/migrations/20261109_login_safety.sql の login_try（試した数を数えてロックを決める関数）と同じ決まりにしてある

export const MAX_FAILS = 5;
export const LOCK_MS = 30 * 60 * 1000;
export const TERMS_VERSION = '2026-11-09';

// state = { n: 試した数, last: 最後の失敗の時刻(ms), until: ロックが終わる時刻(ms) }
export function lockLeftMs(state, now = Date.now()) {
  return state && state.until > now ? state.until - now : 0;
}

// 失敗を1回数える。ロック中は数え足さない。最後の失敗から30分たっていたら数え直す
export function applyFail(state, now = Date.now()) {
  const s = state || { n: 0, last: 0, until: 0 };
  if (lockLeftMs(s, now) > 0) return s;
  const base = now - s.last >= LOCK_MS ? 0 : s.n;
  const n = base + 1;
  if (n >= MAX_FAILS) return { n: 0, last: now, until: now + LOCK_MS };
  return { n, last: now, until: 0 };
}

// 相手の特定に使うのは cf-connecting-ip だけ（Cloudflare が付ける、訪問者本人の IP）。
// x-real-ip・x-forwarded-for は相手が自由に付けられる値なので使わない（毎回変えてロックを避けられるため）
export function clientIp(headers) {
  const v = headers && typeof headers.get === 'function' ? headers.get('cf-connecting-ip') : null;
  return (v && String(v).trim().slice(0, 64)) || 'unknown';
}

// 同じ人の失敗を数えるための名前。IP をそのまま置かず、サイトのパスワードで混ぜた印にする
// （外の人が他人の印を作ってロックを悪用できないように）
export async function lockKey(secret, ip) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret || 'none')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('trippin-lock-v1:' + String(ip || 'unknown')));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

// ---- メール通知 ----
export const KINDS = {
  login: { subject: 'Tabibi にログインしました', what: 'Google アカウントで Tabibi にログインしました。' },
  share_create: { subject: 'Tabibi：共有リンクを作りました', what: 'フォルダの共有リンクを作りました。リンクを知っている人はお店の一覧を見られます。' },
  share_delete: { subject: 'Tabibi：共有をやめました', what: 'フォルダの共有をやめました。' },
  guide_publish: { subject: 'Tabibi：eガイドブックを公開しました', what: 'eガイドブックを「リンクで公開」にして保存しました。リンクを知っている人はだれでも読めます。' },
};
export const isKind = (k) => Object.prototype.hasOwnProperty.call(KINDS, k);

// 端末の説明（ユーザーエージェントから、機種と見ているアプリだけを短く）
export function deviceLabel(ua) {
  const s = String(ua || '');
  const os = /iPhone|iPad/.test(s) ? 'iPhone / iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Macintosh|Mac OS X/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : '不明な端末';
  const br = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Chrome\/|CriOS/.test(s) ? 'Chrome' : /Firefox\/|FxiOS/.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : '不明なブラウザ';
  return `${os}・${br}`;
}

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function jaTime(ms) {
  return new Date(ms + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16).replace(/-/g, '/') + '（日本時間）';
}

export function buildMail(kind, { at = Date.now(), device = '' } = {}) {
  const k = KINDS[kind];
  if (!k) return null;
  const lines = [
    k.what,
    `日時：${jaTime(at)}`,
    `端末：${device || '不明な端末'}`,
    '',
    'ご自身の操作であれば、このメールへの対応は要りません。',
    '心当たりがないときは、Google アカウントのパスワードを変更し、info@conextor.jp までご連絡ください。',
    '',
    'Tabibi（運営：コネクター合同会社）',
  ];
  return {
    subject: k.subject,
    text: lines.join('\n'),
    html: '<div style="font-family:sans-serif;line-height:1.7">' + lines.map((l) => (l ? `<p style="margin:0 0 8px">${esc(l)}</p>` : '<br>')).join('') + '</div>',
  };
}
