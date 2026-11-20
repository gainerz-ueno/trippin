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

// 時間切れで切るときの最後のあいさつ（AIの返事が間に合わないときもこれを言ってから切る）
export const GOODBYE = {
  'ko-KR': '시간 관계상 이만 통화를 마치겠습니다. 감사합니다. 안녕히 계세요.',
  'cmn-TW': '因為時間關係，今天先到這裡。謝謝您，再見。',
  'yue-HK': '因為時間關係，今日講到呢度先。多謝你，拜拜。',
  'vi-VN': 'Vì hết thời gian, tôi xin phép kết thúc cuộc gọi. Cảm ơn anh chị, chào anh chị.',
  'th-TH': 'ขอบคุณมากค่ะ ขออนุญาตวางสายก่อนนะคะ สวัสดีค่ะ',
  'id-ID': 'Karena waktunya habis, saya akhiri teleponnya. Terima kasih, selamat siang.',
  'fr-FR': 'Je dois raccrocher, merci beaucoup et au revoir.',
  'it-IT': 'Devo chiudere la chiamata, grazie mille e arrivederci.',
  'es-ES': 'Tengo que colgar, muchas gracias y hasta luego.',
  'de-DE': 'Ich muss jetzt leider auflegen. Vielen Dank und auf Wiederhören.',
  'ja-JP': 'お時間となりましたので、これで失礼いたします。ありがとうございました。',
  'en-US': 'I have to end the call now. Thank you very much, goodbye.',
};
GOODBYE['en-AU'] = GOODBYE['en-GB'] = GOODBYE['en-US'];

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
  // 台湾の中国語・香港の広東語：声は Google。聞き取りは Deepgram（Google の電話向けの聞き取りは台湾・香港の言葉に対応していないため。2026-11-20 テストで切れた）
  'cmn-TW': { ttsLanguage: 'cmn-TW', ttsProvider: 'Google', voice: 'cmn-TW-Wavenet-A', transcriptionProvider: 'Deepgram', transcriptionLanguage: 'zh-TW', speechModel: 'nova-2-general' },
  'yue-HK': { ttsLanguage: 'yue-HK', ttsProvider: 'Google', voice: 'yue-HK-Standard-A', transcriptionProvider: 'Deepgram', transcriptionLanguage: 'zh-HK', speechModel: 'nova-2-general' },
};

const LANG_NAME = {
  'ko-KR': 'Korean', 'cmn-TW': 'Mandarin Chinese as spoken in Taiwan (Traditional characters)', 'yue-HK': 'Cantonese as spoken in Hong Kong (Traditional characters, colloquial Cantonese)',
  'vi-VN': 'Vietnamese', 'th-TH': 'Thai (use polite particles)', 'id-ID': 'Indonesian', 'fr-FR': 'French', 'it-IT': 'Italian', 'es-ES': 'Spanish', 'de-DE': 'German',
  'en-US': 'English', 'en-AU': 'English', 'en-GB': 'English', 'ja-JP': 'Japanese',
};

const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ローマ字の名前をカタカナに（UENO → ウエノ。英語読みされないように）
const KANA = { a:'ア',i:'イ',u:'ウ',e:'エ',o:'オ',ka:'カ',ki:'キ',ku:'ク',ke:'ケ',ko:'コ',sa:'サ',shi:'シ',si:'シ',su:'ス',se:'セ',so:'ソ',ta:'タ',chi:'チ',ti:'チ',tsu:'ツ',tu:'ツ',te:'テ',to:'ト',na:'ナ',ni:'ニ',nu:'ヌ',ne:'ネ',no:'ノ',ha:'ハ',hi:'ヒ',fu:'フ',hu:'フ',he:'ヘ',ho:'ホ',ma:'マ',mi:'ミ',mu:'ム',me:'メ',mo:'モ',ya:'ヤ',yu:'ユ',yo:'ヨ',ra:'ラ',ri:'リ',ru:'ル',re:'レ',ro:'ロ',wa:'ワ',wo:'ヲ',ga:'ガ',gi:'ギ',gu:'グ',ge:'ゲ',go:'ゴ',za:'ザ',ji:'ジ',zi:'ジ',zu:'ズ',ze:'ゼ',zo:'ゾ',da:'ダ',de:'デ',do:'ド',ba:'バ',bi:'ビ',bu:'ブ',be:'ベ',bo:'ボ',pa:'パ',pi:'ピ',pu:'プ',pe:'ペ',po:'ポ',
  kya:'キャ',kyu:'キュ',kyo:'キョ',sha:'シャ',shu:'シュ',sho:'ショ',cha:'チャ',chu:'チュ',cho:'チョ',nya:'ニャ',nyu:'ニュ',nyo:'ニョ',hya:'ヒャ',hyu:'ヒュ',hyo:'ヒョ',mya:'ミャ',myu:'ミュ',myo:'ミョ',rya:'リャ',ryu:'リュ',ryo:'リョ',gya:'ギャ',gyu:'ギュ',gyo:'ギョ',ja:'ジャ',ju:'ジュ',jo:'ジョ',bya:'ビャ',byu:'ビュ',byo:'ビョ',pya:'ピャ',pyu:'ピュ',pyo:'ピョ' };
export function romajiToKana(name) {
  const t = String(name || '').trim();
  if (!/^[A-Za-z\s\-']+$/.test(t)) return t; // すでにカタカナ等ならそのまま
  return t.toLowerCase().split(/[\s\-]+/).map((w) => {
    let out = '', i = 0;
    while (i < w.length) {
      if (w[i] === 'n' && (i + 1 === w.length || !'aiueoy'.includes(w[i + 1]))) { out += 'ン'; i += 1; continue; }
      if (i + 1 < w.length && w[i] === w[i + 1] && !'aiueon'.includes(w[i])) { out += 'ッ'; i += 1; continue; }
      if ('aiueo'.includes(w[i]) && i > 0 && w[i] === 'u' && 'o'.includes(w[i - 1])) { out += 'ウ'; i += 1; continue; }
      const k = [3, 2, 1].map((n) => w.slice(i, i + n)).find((x) => KANA[x]);
      if (!k) return null;
      out += KANA[k]; i += k.length;
    }
    return out;
  }).reduce((a, b) => (a === null || b === null ? null : a + (a ? '・' : '') + b), '') ?? t;
}

// 日にちを、その国の人が声に出す形で（年は言わない。日本語の日にちは読みをかなで）
const JA_DAY = { 1:'ついたち',2:'ふつか',3:'みっか',4:'よっか',5:'いつか',6:'むいか',7:'なのか',8:'ようか',9:'ここのか',10:'とおか',14:'じゅうよっか',20:'はつか',24:'にじゅうよっか' };
const JA_WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const KO_WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export function spokenDate(lang, date) {
  const d = new Date(date + 'T00:00:00Z');
  const m = d.getUTCMonth() + 1, day = d.getUTCDate(), w = d.getUTCDay();
  if (lang === 'ja-JP') return `${m}月${JA_DAY[day] || day + 'にち'}、${JA_WEEK[w]}曜日`;
  if (lang === 'ko-KR') return `${m}월 ${day}일 ${KO_WEEK[w]}요일`;
  return '';
}

// 電話で話すAIへの指示
export function callSystemPrompt({ lang, placeName, request }) {
  const d = new Date(request.date + 'T00:00:00Z');
  const wd = WEEK[d.getUTCDay()];
  const kana = romajiToKana(request.name);
  const sd = spokenDate(lang, request.date);
  return `You are an AI reservation assistant on a live phone call with a restaurant or shop called "${placeName}".
You are calling on behalf of a traveler from Japan who cannot speak the local language. You already introduced yourself as an AI booking assistant.

Speak ONLY in ${LANG_NAME[lang]}. Talk like a polite, natural phone caller. Keep every reply short: one or two short sentences. Never use lists, emoji, markdown, or romanization notes. Write numbers, dates and times the way a native speaker would say them aloud. Never say the year.

The reservation the traveler wants:
- Date: ${request.date} (${wd})${sd ? ` — write it exactly like this when you say it: "${sd}"` : ''}
- Time: ${request.time}
- Number of people: ${request.people}
- Name for the booking: ${request.name} — this is a Japanese name, pronounced in Japanese as "${kana}". Always write it in ${LANG_NAME[lang]} script as it sounds in Japanese (for example Korean "우에노" for ウエノ, Japanese "ウエノ"). Never read it as an English word and never spell it letter by letter unless they ask for the spelling.${request.flex ? `\n- Flexibility: ${request.flex}` : ''}${request.note ? `\n- Request: ${request.note}` : ''}${request.callback ? `\n- Contact if they ask: ${request.callback}` : ''}

How to run the call:
1. Ask whether you can book a table for the date, time and number of people above. Say the date, time and number of people clearly and slowly.
2. If that time is not available, ask what nearby times are available that day and accept one only if it fits the flexibility above; otherwise thank them and end.
3. Tell them the name. If they ask something you do not know (phone number, deposit, card, allergies), say the traveler will confirm when they arrive, unless it is listed above.
4. The date, time, number of people and name MUST be confirmed. Before ending, repeat all four in one sentence and ask "Is that correct?". Do not treat the booking as done until they clearly say yes to that recap. If they correct something, repeat the corrected recap and ask again.
5. After they confirm, your LAST reply is only a short thank-you and goodbye (for example "ありがとうございます。失礼いたします。"), with the marker [END] at the very end. Never end the call without saying goodbye.
If they say they do not take reservations, are closed, or will not talk to an AI, thank them, say goodbye, and end with [END].
If you hear only silence or noise twice, say goodbye and end with [END].
Understanding short answers:
- Shop staff often answer very briefly. Treat any short agreement as YES, in any language: the local word for yes (for example 네, 예, 응, 好, 對, 可以, 係, vâng, dạ, được, ครับ, ค่ะ, ya, oui, sì, sí, ja), English "yes", "yeah", "OK", "okay", "sure", and Japanese "はい". Speech recognition may write these oddly (for example "오케이", "오게", "하이", "예스", "오키"); treat those as yes too.
- If a reply is short and unclear, assume the most likely meaning in context and move forward. Never ask the same question more than twice; after that, go straight to the final recap.
- If the staff switch to English, continue the call in simple, slow English. If they switch back, follow them.
Never invent details. Never agree to pay anything.`;
}

// 電話が終わったあとに、結果を日本語でまとめる指示
export function summaryPrompt({ request }) {
  return `You read a transcript of a phone call where an AI assistant tried to book a reservation for a Japanese traveler.
Requested: date ${request.date}, time ${request.time}, ${request.people} people, name "${request.name}".
Return ONLY a JSON object, no other text:
{"outcome":"booked|declined|alternative|unclear","date":"YYYY-MM-DD or empty","time":"HH:MM or empty","people":number or 0,"summary_ja":"結果を日本語で2〜3文。決まった日時・人数・名前、お店から言われた注意（席の時間制限・遅れたら取り消し等）があれば入れる","notes_ja":"お店に伝えたこと・聞かれたことを日本語で短く。なければ空"}
"booked" = the shop said yes (in any language, including short answers like 네 / OK / yes / はい) to the full recap (date, time, people, name). If they never confirmed the recap, use "unclear". "alternative" = booked but at a different time/date or with changes. "declined" = no booking was made. "unclear" = cannot tell.`;
}
