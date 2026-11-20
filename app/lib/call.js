// タビビコール（AIが現地語でお店に予約の電話をかける）の決まりごと
// ・画面（CallSheet.js）と、電話をかける仕組み（app/api/call・cloudflare/call.js）の両方から使う
// ・鍵や合言葉はここに書かない

export const CALL_PRICE = 300; // 円／1回（回数券。5回1,500円など）
export const CALL_BLOCK_SEC = 180; // チケット1枚で話せる時間（3分）。3分ごとに1枚ずつ使い、残りがなくなったら切る
export const CALL_MAX_BLOCKS = 10; // 念のための上限（10枚＝30分）。保留のまま放っておかれても、これより長くはならない

// 電話番号の国番号 → 話す言語（日本人がよく行く国）。日本は運営者のテストだけ
// 長い国番号を先に見る（+852 香港を +85… より先に、+1671 グアムを +1 より先に、など）
export const CALL_LANGS = {
  '+82': { lang: 'ko-KR', country: 'KR', name: '韓国語' },
  '+886': { lang: 'cmn-TW', country: 'TW', name: '中国語（台湾）' },
  '+852': { lang: 'yue-HK', country: 'HK', name: '広東語（香港）' },
  '+84': { lang: 'vi-VN', country: 'VN', name: 'ベトナム語' },
  '+66': { lang: 'th-TH', country: 'TH', name: 'タイ語' },
  '+65': { lang: 'en-US', country: 'SG', name: '英語（シンガポール）' },
  '+63': { lang: 'en-US', country: 'PH', name: '英語（フィリピン）' },
  '+60': { lang: 'en-US', country: 'MY', name: '英語（マレーシア）' },
  '+62': { lang: 'id-ID', country: 'ID', name: 'インドネシア語' },
  '+1': { lang: 'en-US', country: 'US', name: '英語（アメリカ・ハワイ・グアム）' },
  '+61': { lang: 'en-AU', country: 'AU', name: '英語（オーストラリア）' },
  '+44': { lang: 'en-GB', country: 'GB', name: '英語（イギリス）' },
  '+33': { lang: 'fr-FR', country: 'FR', name: 'フランス語' },
  '+39': { lang: 'it-IT', country: 'IT', name: 'イタリア語' },
  '+34': { lang: 'es-ES', country: 'ES', name: 'スペイン語' },
  '+49': { lang: 'de-DE', country: 'DE', name: 'ドイツ語' },
  '+81': { lang: 'ja-JP', country: 'JP', name: '日本語', testOnly: true },
};
const BY_LEN = Object.entries(CALL_LANGS).sort((a, b) => b[0].length - a[0].length);

export function langOfPhone(e164) {
  for (const [cc, v] of BY_LEN) if (e164.startsWith(cc)) return v;
  return null;
}

// "+82 2-123-4567" → "+8221234567"
export function toE164(s) {
  const t = String(s || '').replace(/[\s()\-‐－.]/g, '');
  return /^\+[0-9]{6,16}$/.test(t) ? t : '';
}

// 予約の中身（画面から送られてくる値をそろえる。おかしな値はここで落とす）
export function cleanRequest(r) {
  const s = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F<>]/g, ' ').trim().slice(0, n) : '');
  const date = s(r?.date, 10);
  const time = s(r?.time, 5);
  const people = Math.round(Number(r?.people));
  const out = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    time: /^\d{2}:\d{2}$/.test(time) ? time : '',
    people: Number.isFinite(people) && people >= 1 && people <= 30 ? people : 0,
    name: s(r?.name, 40), // 予約の名前（ローマ字かカタカナ）
    flex: s(r?.flex, 60), // 時間の融通（例：19時〜20時ならOK）
    note: s(r?.note, 120), // ひとこと（例：窓際の席がいい）
    callback: s(r?.callback, 30), // 連絡先（任意）
  };
  if (!out.date || !out.time || !out.people || !out.name) return null;
  return out;
}

// 電話に出たときの最初のあいさつ（AIであることをはじめに名乗る）
export const GREETING = {
  'ko-KR': '안녕하세요. 일본인 여행객을 대신해 예약 문의를 드리는 AI 예약 도우미입니다. 잠시 통화 괜찮으실까요?',
  'cmn-TW': '您好，我是代替日本旅客打電話詢問訂位的 AI 訂位助理。請問現在方便說話嗎？',
  'yue-HK': '你好，我係代表一位日本旅客打嚟問訂位嘅 AI 訂位助手。請問而家方便講幾句嗎？',
  'vi-VN': 'Xin chào, tôi là trợ lý đặt chỗ AI, gọi thay cho một du khách Nhật Bản để hỏi đặt bàn. Anh chị có tiện nghe máy một chút không ạ?',
  'th-TH': 'สวัสดีค่ะ ดิฉันเป็นผู้ช่วยจองโต๊ะ AI โทรแทนนักท่องเที่ยวชาวญี่ปุ่นเพื่อสอบถามการจองค่ะ สะดวกคุยสักครู่ไหมคะ',
  'id-ID': 'Halo, saya asisten pemesanan AI yang menelepon atas nama seorang wisatawan dari Jepang untuk menanyakan reservasi. Apakah ada waktu sebentar?',
  'fr-FR': "Bonjour, je suis un assistant de réservation IA qui appelle au nom d'un voyageur japonais pour une réservation. Avez-vous un instant ?",
  'it-IT': 'Buongiorno, sono un assistente IA per le prenotazioni e chiamo per conto di un viaggiatore giapponese. Ha un momento?',
  'es-ES': 'Hola, soy un asistente de reservas con IA y llamo en nombre de un viajero japonés para hacer una reserva. ¿Tiene un momento?',
  'de-DE': 'Guten Tag, hier ist ein KI-Reservierungsassistent. Ich rufe im Auftrag eines Reisenden aus Japan wegen einer Reservierung an. Haben Sie kurz Zeit?',
  'ja-JP': 'お忙しいところ失礼します。日本からの旅行者に代わって予約のお問い合わせをしている、AIの予約アシスタントです。少しお時間よろしいでしょうか。',
  'en-US': 'Hello, this is an AI booking assistant calling on behalf of a traveler from Japan about a reservation. Do you have a moment?',
};
GREETING['en-AU'] = GREETING['en-GB'] = GREETING['en-US'];

// 読み上げ・聞き取りの設定（Twilio ConversationRelay）
export const VOICE = {
  'ko-KR': { language: 'ko-KR' },
  'vi-VN': { language: 'vi-VN' },
  'th-TH': { language: 'th-TH' },
  'id-ID': { language: 'id-ID' },
  'fr-FR': { language: 'fr-FR' },
  'it-IT': { language: 'it-IT' },
  'es-ES': { language: 'es-ES' },
  'de-DE': { language: 'de-DE' },
  'en-US': { language: 'en-US' },
  'en-AU': { language: 'en-AU' },
  'en-GB': { language: 'en-GB' },
  'ja-JP': { language: 'ja-JP' },
  // 台湾の中国語・香港の広東語は既定の声がないので Google の声と聞き取りを使う
  'cmn-TW': { ttsLanguage: 'cmn-TW', transcriptionLanguage: 'cmn-Hant-TW', ttsProvider: 'Google', voice: 'cmn-TW-Wavenet-A', transcriptionProvider: 'Google' },
  'yue-HK': { ttsLanguage: 'yue-HK', transcriptionLanguage: 'yue-Hant-HK', ttsProvider: 'Google', voice: 'yue-HK-Standard-A', transcriptionProvider: 'Google' },
};

const LANG_NAME = {
  'ko-KR': 'Korean', 'cmn-TW': 'Mandarin Chinese as spoken in Taiwan (Traditional characters)', 'yue-HK': 'Cantonese as spoken in Hong Kong (Traditional characters, colloquial Cantonese)',
  'vi-VN': 'Vietnamese', 'th-TH': 'Thai (use polite particles)', 'id-ID': 'Indonesian', 'fr-FR': 'French', 'it-IT': 'Italian', 'es-ES': 'Spanish', 'de-DE': 'German',
  'en-US': 'English', 'en-AU': 'English', 'en-GB': 'English', 'ja-JP': 'Japanese',
};

const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// 電話で話すAIへの指示
export function callSystemPrompt({ lang, placeName, request }) {
  const d = new Date(request.date + 'T00:00:00Z');
  const wd = WEEK[d.getUTCDay()];
  return `You are an AI reservation assistant on a live phone call with a restaurant or shop called "${placeName}".
You are calling on behalf of a traveler from Japan who cannot speak the local language. You already introduced yourself as an AI booking assistant.

Speak ONLY in ${LANG_NAME[lang]}. Talk like a polite, natural phone caller. Keep every reply short: one or two short sentences. Never use lists, emoji, markdown, or romanization notes. Write numbers, dates and times the way a native speaker would say them aloud.

The reservation the traveler wants:
- Date: ${request.date} (${wd})
- Time: ${request.time}
- Number of people: ${request.people}
- Name for the booking: ${request.name}${request.flex ? `\n- Flexibility: ${request.flex}` : ''}${request.note ? `\n- Request: ${request.note}` : ''}${request.callback ? `\n- Contact if they ask: ${request.callback}` : ''}

How to run the call:
1. Ask whether you can book a table for the date, time and number of people above.
2. If that time is not available, ask what nearby times are available that day and accept one only if it fits the flexibility above; otherwise thank them and end.
3. If they ask for the name, spell it slowly. If they ask something you do not know (phone number, deposit, card, allergies), say the traveler will confirm when they arrive, unless it is listed above.
4. Before ending, repeat the final booking (date, time, people, name) once to confirm.
5. End politely. When the conversation is finished, put the marker [END] at the very end of your last reply.
If they say they do not take reservations, are closed, or will not talk to an AI, thank them politely and end with [END].
If you hear only silence or noise twice, say goodbye and end with [END].
Never invent details. Never agree to pay anything.`;
}

// 電話が終わったあとに、結果を日本語でまとめる指示
export function summaryPrompt({ request }) {
  return `You read a transcript of a phone call where an AI assistant tried to book a reservation for a Japanese traveler.
Requested: date ${request.date}, time ${request.time}, ${request.people} people, name "${request.name}".
Return ONLY a JSON object, no other text:
{"outcome":"booked|declined|alternative|unclear","date":"YYYY-MM-DD or empty","time":"HH:MM or empty","people":number or 0,"summary_ja":"結果を日本語で2〜3文。決まった日時・人数・名前、お店から言われた注意（席の時間制限・遅れたら取り消し等）があれば入れる","notes_ja":"お店に伝えたこと・聞かれたことを日本語で短く。なければ空"}
"booked" = the shop confirmed the requested booking. "alternative" = booked but at a different time/date or with changes. "declined" = no booking was made. "unclear" = cannot tell.`;
}
