// AIおすすめ：今いる場所・現地の時間・ホテル・候補のお店をふまえて提案する（Gemini）
import { searchPage, fillTranslations } from '../../lib/places';

const MODEL = 'gemini-3.8-flash';

async function gemini(prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }),
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'AIに聞けませんでした');
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '{}';
  return JSON.parse(text);
}

export async function POST(req) {
  if (!process.env.GEMINI_API_KEY) return Response.json({ error: 'AIの設定がされていません' }, { status: 500 });
  try {
    const { question = '', here = null, hotel = null, items = [], localTime = '', trip = '', walk = true, car = false } = await req.json();
    // 徒歩圏内：約1km（徒歩15分）／車移動：約8km（Grab・Uber・タクシーで20分）／両方：どちらも
    const radius = car ? 8000 : walk ? 1200 : 3000;
    const moveText = walk && car ? '徒歩圏内（約1km）と車移動（約8km、Grab・Uber・タクシー）の両方。近い順に混ぜて提案し、どちらで行くかを理由に書く'
      : car ? '車移動（Grab・Uber・タクシーで約8km以内）。徒歩では遠いお店もすすめてよい'
      : walk ? '徒歩圏内（約1km・徒歩15分以内）だけ。遠いお店はすすめない'
      : '指定なし';
    const q = String(question).trim() || 'このあとどこに行くのがおすすめ？';
    const center = here || (hotel && hotel.lat != null ? { lat: hotel.lat, lng: hotel.lng } : null);

    // 1) 質問から、近くのお店を探すための検索語を作る
    let nearby = [];
    if (center) {
      let searchQuery = 'レストラン';
      try {
        const k = await gemini(
          [
            '旅行者の質問から、Googleマップで近くのお店を探すための短い検索語（日本語、2〜4語）を1つ作ってください。',
            '例: 「近くで夕食どこがいい？」→「夕食 レストラン」、「甘いもの食べたい」→「スイーツ カフェ」、「マッサージ行きたい」→「マッサージ」',
            `旅行先: ${trip || '不明'} / 現地の時刻: ${localTime || '不明'}`,
            `質問: ${q}`,
            '{"searchQuery":"..."} のJSONだけを返す。',
          ].join('\n')
        );
        if (k?.searchQuery) searchQuery = String(k.searchQuery).slice(0, 40);
      } catch {}
      try {
        const { places } = await searchPage(searchQuery, 4, null, '', {
          openNow: true,
          pageSize: 10,
          locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius } },
        });
        nearby = await fillTranslations(places.filter((p) => (p.reviews || 0) >= 50).slice(0, 8));
      } catch {}
    }

    // 2) 候補と近くのお店から選んでもらう
    const listForAi = items.slice(0, 60).map((it) => ({
      id: 'L:' + it.id,
      name: it.altName ? `${it.name}（${it.altName}）` : it.name,
      category: it.category || '',
      open: it.open,
      today: it.today || '',
      fromHere: it.fromHere || '',
      fromHotel: it.fromHotel || '',
      rating: it.rating ?? null,
      memo: it.memo || '',
    }));
    const nearbyForAi = nearby.map((p) => ({
      id: 'N:' + p.placeId,
      name: p.altName ? `${p.name}（${p.altName}）` : p.name,
      type: p.type || '',
      rating: p.rating,
      reviews: p.reviews,
      open: true,
    }));

    const out = await gemini(
      [
        'あなたは旅行中の日本人に付き添う、現地に詳しい案内役です。質問に、日本語で短く具体的に答えてください。',
        '- まず「候補リスト」（本人が行きたいと保存したお店）から選ぶ。今営業中・近い・時間帯やカテゴリーが質問に合う・メモの内容、を重視する',
        '- 候補リストに合うお店が少ないときは「近くで今開いているお店」から足す',
        '- 営業時間外のお店はすすめない（明日以降の話なら可）',
        '- 3軒まで。各お店に、なぜ今そこがいいかの理由を1文で',
        '- answer は2〜3文。お店の名前は日本語の表記で書く',
        `旅行先: ${trip || '不明'}`,
        `現地の時刻: ${localTime || '不明'}`,
        `今いる場所: ${here ? 'わかっている（距離はfromHereを参照）' : hotel ? 'わからない（ホテル付近とみなす）' : 'わからない'}`,
        `ホテル: ${hotel?.name || '未設定'}`,
        `移動手段: ${moveText}`,
        `候補リスト: ${JSON.stringify(listForAi)}`,
        `近くで今開いているお店: ${JSON.stringify(nearbyForAi)}`,
        `質問: ${q}`,
        '{"answer":"...","picks":[{"id":"L:... または N:...","reason":"..."}]} のJSONだけを返す。',
      ].join('\n')
    );

    const nearbyMap = new Map(nearby.map((p) => [p.placeId, p]));
    const listIds = new Set(items.map((it) => it.id));
    const picks = (out.picks || [])
      .slice(0, 3)
      .map((pk) => {
        const id = String(pk.id || '');
        if (id.startsWith('L:') && listIds.has(id.slice(2))) return { kind: 'list', id: id.slice(2), reason: pk.reason || '' };
        if (id.startsWith('N:') && nearbyMap.has(id.slice(2))) return { kind: 'nearby', place: nearbyMap.get(id.slice(2)), reason: pk.reason || '' };
        return null;
      })
      .filter(Boolean);

    return Response.json({ answer: out.answer || '', picks });
  } catch (e) {
    return Response.json({ error: e.message || 'AIに聞けませんでした' }, { status: 500 });
  }
}
