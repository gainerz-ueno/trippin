// スクリーンショットから店名・街・国を読み取る（Gemini）
const COUNTRY_CODES = ['TW', 'KR', 'HK', 'CN', 'VN', 'TH', 'SG', 'MY', 'PH', 'JP'];

export async function POST(req) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: '読み取りの設定がされていません' }, { status: 500 });
  try {
    const { image, mimeType = 'image/jpeg' } = await req.json();
    if (!image || image.length > 6_000_000) {
      return Response.json({ error: '画像が大きすぎるか、読み込めませんでした' }, { status: 400 });
    }
    const prompt = [
      'これはインスタグラムやYouTubeなどのスクリーンショットです。紹介されているお店・名所を読み取ってください。',
      '看板・キャプション・位置情報タグ・ハッシュタグ・字幕など、画面に写っている情報をすべて手がかりにしてください。',
      '各お店について、Googleマップで検索して見つかる店名（現地の表記があればそれ、なければ書かれている表記）、街（例: 台北、ホーチミン、ソウル）、国コードを返してください。',
      `国コードは ${COUNTRY_CODES.join(', ')} のどれか。わからない・該当しないときは空文字。`,
      '店名が読み取れないお店は入れないでください。推測で店名を作らないでください。',
      '{"shops":[{"name":"...","city":"...","country":"..."}]} のJSONだけを返す。見つからなければ {"shops":[]}。',
    ].join('\n');
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimeType, data: image } }, { text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
        cache: 'no-store',
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || '読み取りに失敗しました');
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '{}';
    const shops = (JSON.parse(text).shops || [])
      .filter((s) => s && String(s.name || '').trim())
      .slice(0, 8)
      .map((s) => ({
        name: String(s.name).trim(),
        city: String(s.city || '').trim(),
        country: COUNTRY_CODES.includes(s.country) ? s.country : '',
      }));
    return Response.json({ shops });
  } catch (e) {
    return Response.json({ error: e.message || '読み取りに失敗しました' }, { status: 500 });
  }
}
