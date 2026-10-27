'use client';
// ブラウザからサーバー（/api/…）を呼ぶときの共通の入り口
// ・決めた時間で打ち切る（「読み込み中…」のまま止まらないように）
// ・エラーは必ず日本語で返す（英語のエラーや「Unexpected token」を画面に出さない）

const hasJa = (s) => /[぀-ヿ一-鿿]/.test(s || '');

export function jaError(e, fallback = 'うまくいきませんでした。もう一度試してください') {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return '時間がかかりすぎたので止めました。電波のよいところで、もう一度試してください';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'インターネットにつながっていません。電波のよいところで、もう一度試してください';
  const m = String(e?.message || '');
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return '通信できませんでした。電波のよいところで、もう一度試してください';
  return hasJa(m) ? m : fallback;
}

export async function api(url, { method = 'GET', body, timeout = 20000, fallback, headers } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new Error(jaError(e, fallback));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    if (res.status === 401) throw new Error('ログインが切れました。ページを開き直して、パスワードを入れてください');
    if (res.status === 429) throw new Error(data?.error || '短い時間に使いすぎです。1分ほど待ってからもう一度試してください');
    if (res.status === 413) throw new Error('写真が大きすぎて送れませんでした。枚数を減らしてもう一度試してください');
    throw new Error(hasJa(data?.error) ? data.error : fallback || 'うまくいきませんでした。もう一度試してください');
  }
  return data;
}

// Googleマップで開くリンク（お店のリンクがないときは、店名とIDから作る。無料のURL）
export function mapsLink(p) {
  const u = p?.mapsUrl;
  if (typeof u === 'string' && /^https:\/\//.test(u)) return u;
  const q = encodeURIComponent(p?.name || p?.altName || '');
  return `https://www.google.com/maps/search/?api=1&query=${q}${p?.placeId ? `&query_place_id=${encodeURIComponent(p.placeId)}` : ''}`;
}
