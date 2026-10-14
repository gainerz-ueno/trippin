// 画面に出すリンクは http / https だけにする（javascript: などを使ったスクリプト混入を防ぐ）
export function safeUrl(u) {
  if (typeof u !== 'string') return '';
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.toString() : '';
  } catch {
    return '';
  }
}
