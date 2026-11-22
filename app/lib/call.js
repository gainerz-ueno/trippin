// タビビコール（AIが現地語でお店に予約の電話をかける）の決まりごと
// ・画面（CallSheet.js）と、電話をかける仕組み（app/api/call・cloudflare/call.js）の両方から使う
// ・鍵や合言葉はここに書かない

export const CALL_POINTS = 45; // 1回（3分）に使うポイント（2026-11-22 ポイント制）
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

// 連絡先の番号を国番号つき（+81 90 1234 5678 の形）にそろえる。日本の 0 から始まる番号は +81 に直す
export function intlPhone(v) {
  const d = String(v || '').replace(/[^0-9+]/g, '');
  let n = d.startsWith('+') ? d.slice(1) : d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? '81' + d.slice(1) : d;
  if (!/^[0-9]{9,15}$/.test(n)) return '';
  if (n.startsWith('81')) { const r = n.slice(2); return `+81 ${r.slice(0, 2)} ${r.slice(2, r.length - 4)} ${r.slice(-4)}`; }
  return '+' + n;
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
    gender: r?.gender === 'f' ? 'f' : 'm', // 呼び方（中国語の先生・小姐など）
    flex: s(r?.flex, 60), // 時間の融通（例：19時〜20時ならOK）
    note: s(r?.note, 120), // ひとこと（例：窓際の席がいい）
    callback: intlPhone(s(r?.callback, 30)), // 連絡先（必須。お店に聞かれたら国番号つきで伝える。2026-11-22：番号が無いと断る店があるため）
    timeTo: '', // 第1候補の時間の幅の終わり（「19:00〜20:30の間ならOK」の20:30。空なら時間ぴったりだけ）
    alts: [], // 第2・第3候補（日にち・時間の幅・人数。1つ目が無理なときに聞く）
  };
  if (!out.date || !out.time || !out.people || !out.name || !out.callback) return null;
  const hm = (v) => (/^\d{2}:\d{2}$/.test(v) ? v : '');
  const to = hm(s(r?.timeTo, 5));
  out.timeTo = to && to > out.time ? to : '';
  for (const a of Array.isArray(r?.alts) ? r.alts.slice(0, 2) : []) {
    const ad = s(a?.date, 10), at = hm(s(a?.time, 5)), aTo = hm(s(a?.timeTo, 5));
    const ap = Math.round(Number(a?.people));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ad) || !at) continue;
    const alt = { date: ad, time: at, timeTo: aTo && aTo > at ? aTo : '', people: Number.isFinite(ap) && ap >= 1 && ap <= 30 ? ap : out.people };
    const same = (x) => x.date === alt.date && x.time === alt.time && x.timeTo === alt.timeTo && x.people === alt.people;
    if (same(out) || out.alts.some(same)) continue;
    out.alts.push(alt);
  }
  return out;
}

// 電話に出たときの最初のあいさつ（まず「日本のお客様の代わりの予約の電話」と言い、そのあとAIだと名乗る。2026-11-21 社長：AIが先だと怪しい電話と思われて切られる）
export const GREETING = {
  'ko-KR': '안녕하세요. 일본 손님을 대신해서 예약 문의 전화 드렸습니다. 저는 AI 예약 도우미입니다. 잠시 통화 괜찮으실까요?',
  'cmn-TW': '您好，我這邊是代替日本客人打電話來訂位的，我是 AI 訂位助理。請問現在方便說話嗎？',
  'yue-HK': '你好，我代一位日本客人打嚟訂位，我係 AI 訂位助手。請問而家方便講幾句嗎？',
  'vi-VN': 'Xin chào, tôi gọi thay cho một khách người Nhật để đặt bàn. Tôi là trợ lý đặt chỗ AI. Anh chị có tiện nghe máy một chút không ạ?',
  'th-TH': 'สวัสดีค่ะ โทรมาแทนลูกค้าชาวญี่ปุ่นเพื่อจองโต๊ะค่ะ ดิฉันเป็นผู้ช่วยจองโต๊ะ AI ค่ะ สะดวกคุยสักครู่ไหมคะ',
  'id-ID': 'Halo, saya menelepon atas nama tamu dari Jepang untuk reservasi. Saya asisten pemesanan AI. Apakah ada waktu sebentar?',
  'fr-FR': "Bonjour, j'appelle au nom d'un client japonais pour une réservation. Je suis un assistant de réservation IA. Avez-vous un instant ?",
  'it-IT': 'Buongiorno, chiamo per conto di un cliente giapponese per una prenotazione. Sono un assistente IA. Ha un momento?',
  'es-ES': 'Hola, llamo en nombre de un cliente japonés para hacer una reserva. Soy un asistente de reservas con IA. ¿Tiene un momento?',
  'de-DE': 'Guten Tag, ich rufe im Auftrag eines Gastes aus Japan wegen einer Reservierung an. Ich bin ein KI-Reservierungsassistent. Haben Sie kurz Zeit?',
  'ja-JP': 'お忙しいところ失礼します。日本からのお客様に代わって、予約のお電話をしております。AIの予約アシスタントです。少しお時間よろしいでしょうか。',
  'en-US': 'Hello, I\'m calling on behalf of a guest from Japan to make a reservation. I\'m an AI booking assistant. Do you have a moment?',
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

// 予約が決まったあとのお礼（AIのお礼が空だったときに代わりに言う。何も言わずに切らないため）
export const THANKS = {
  'ko-KR': '네, 감사합니다. 안녕히 계세요.',
  'cmn-TW': '好的，謝謝您，麻煩您了，再見。',
  'yue-HK': '好，唔該晒，拜拜。',
  'vi-VN': 'Dạ, cảm ơn anh chị nhiều. Chào anh chị.',
  'th-TH': 'ขอบคุณมากค่ะ สวัสดีค่ะ',
  'id-ID': 'Baik, terima kasih banyak. Selamat siang.',
  'fr-FR': 'Merci beaucoup, au revoir.',
  'it-IT': 'Grazie mille, arrivederci.',
  'es-ES': 'Muchas gracias, hasta luego.',
  'de-DE': 'Vielen Dank, auf Wiederhören.',
  'ja-JP': 'ありがとうございます。失礼いたします。',
  'en-US': 'Thank you very much, goodbye.',
};
THANKS['en-AU'] = THANKS['en-GB'] = THANKS['en-US'];

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
  // 日本語：声を決めないと ElevenLabs の標準の声になり、日本語が不自然で聞き取れなかった（2026-11-22 社長の電話）。Google の日本語の声にする
  'ja-JP': { language: 'ja-JP', ttsProvider: 'Google', voice: 'ja-JP-Neural2-B' },
  // 台湾の中国語・香港の広東語：声は Google。聞き取りは Deepgram（Google の電話向けの聞き取りは台湾・香港の言葉に対応していないため。2026-11-20 テストで切れた）
  'cmn-TW': { ttsLanguage: 'cmn-TW', ttsProvider: 'Google', voice: 'cmn-TW-Wavenet-A', transcriptionProvider: 'Deepgram', transcriptionLanguage: 'zh-CN', speechModel: 'nova-2-general' },
  'yue-HK': { ttsLanguage: 'yue-HK', ttsProvider: 'Google', voice: 'yue-HK-Standard-A', transcriptionProvider: 'Deepgram', transcriptionLanguage: 'zh-HK', speechModel: 'nova-2-general' },
};

const LANG_NAME = {
  'ko-KR': 'Korean', 'cmn-TW': 'Taiwanese Mandarin (華語, as spoken in Taiwan, Traditional characters). Use Taiwanese wording and expressions, not mainland ones (for example 訂位, 幾位, 好的, 謝謝您, 麻煩您), and say times the Taiwanese way (晚上七點). The staff\'s words reach you through speech recognition that may write them in Simplified characters or mainland wording; understand them normally', 'yue-HK': 'Cantonese as spoken in Hong Kong (Traditional characters, colloquial Cantonese)',
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
const ZH_WEEK = ['日', '一', '二', '三', '四', '五', '六'];
export function spokenDate(lang, date) {
  const d = new Date(date + 'T00:00:00Z');
  const m = d.getUTCMonth() + 1, day = d.getUTCDate(), w = d.getUTCDay();
  if (lang === 'ja-JP') return `${m}月${JA_DAY[day] || day + '日'}、${JA_WEEK[w]}曜日`;
  if (lang === 'ko-KR') return `${m}월 ${day}일 ${KO_WEEK[w]}요일`;
  if (lang === 'cmn-TW' || lang === 'yue-HK') return `${m}月${day}號，星期${ZH_WEEK[w]}`;
  return '';
}

// お店の国の今日から見た言い方（明日・明後日・今週〇曜・来週〇曜）
const TZ = { 'ko-KR': 9, 'ja-JP': 9, 'cmn-TW': 8, 'yue-HK': 8, 'vi-VN': 7, 'th-TH': 7, 'id-ID': 7, 'fr-FR': 1, 'it-IT': 1, 'es-ES': 1, 'de-DE': 1, 'en-GB': 0, 'en-US': -5, 'en-AU': 10 };
export function relativeDay(lang, date, now = Date.now()) {
  const local = new Date(now + (TZ[lang] ?? 9) * 3600000);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const d = Date.parse(date + 'T00:00:00Z');
  const diff = Math.round((d - today) / 86400000);
  const wd = WEEK[new Date(d).getUTCDay()];
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === 2) return 'the day after tomorrow';
  const mon = (t) => t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000; // その週の月曜
  const weeks = Math.round((mon(d) - mon(today)) / (7 * 86400000));
  if (weeks === 0) return `this ${wd}`;
  if (weeks === 1) return `next ${wd}`;
  return '';
}

// 「明日」などを、その言語の言葉にして渡す（英語の tomorrow のまま渡すと、AIが別の言語に訳すことがある。
// 2026-11-22 社長の電話：日本語の電話なのに台湾のお店の名前につられて「明天」と言った）
const VI_WEEK = ['Chủ nhật', 'thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy'];
export function localDayWord(lang, rel, date) {
  if (!rel) return '';
  const w = new Date(date + 'T00:00:00Z').getUTCDay();
  const zh = lang === 'cmn-TW' || lang === 'yue-HK';
  const T = {
    'ja-JP': { today: '本日', tomorrow: '明日', after: '明後日', this: `今週の${JA_WEEK[w]}曜日`, next: `来週の${JA_WEEK[w]}曜日` },
    'ko-KR': { today: '오늘', tomorrow: '내일', after: '모레', this: `이번 주 ${KO_WEEK[w]}요일`, next: `다음 주 ${KO_WEEK[w]}요일` },
    'vi-VN': { today: 'hôm nay', tomorrow: 'ngày mai', after: 'ngày kia', this: `${VI_WEEK[w]} tuần này`, next: `${VI_WEEK[w]} tuần sau` },
  }[lang] || (zh ? { today: '今天', tomorrow: '明天', after: '後天', this: `這個星期${ZH_WEEK[w]}`, next: `下個星期${ZH_WEEK[w]}` } : null);
  if (!T) return rel;
  if (rel === 'today') return T.today;
  if (rel === 'tomorrow') return T.tomorrow;
  if (rel === 'the day after tomorrow') return T.after;
  if (rel.startsWith('this ')) return T.this;
  if (rel.startsWith('next ')) return T.next;
  return rel;
}

// 名前の伝え方（言語ごと）。日本の名前は「〇〇さん」と日本語の音で言い、念のためローマ字を1文字ずつ
const cap = (n) => n.split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
const NAME_HOW = {
  'ja-JP': (k) => `Say "${k}様" (never さん — you are speaking for your customer).`,
  'ko-KR': (k) => `Say it as it sounds in Japanese with "상" (for example "우에노 상" for ウエノ).`,
  'cmn-TW': (k, n, g) => `Say "${cap(n)}${g === 'f' ? '小姐' : '先生'}".`,
  'yue-HK': (k, n, g) => `Say "${cap(n)}${g === 'f' ? '小姐' : '先生'}".`,
};

// 確認の問いの見本（その言語だけで書く。ほかの言語の見本を渡すと、その言葉がまざる）
const RECAP_EX = {
  'ja-JP': '「明日十九時、ふたり、ウエノ様でよろしいでしょうか。」',
  'ko-KR': '"내일 일곱 시, 두 명, 우에노 상 맞을까요?"',
  'cmn-TW': '"明天七點，兩位，Ueno先生，對嗎？"',
  'yue-HK': '"聽日七點，兩位，Ueno先生，啱唔啱？"',
  'vi-VN': '"Ngày mai bảy giờ tối, hai người, tên Ueno, đúng không ạ?"',
};
const NAME_EX = {
  'ja-JP': '「日本のお客様で、お名前はウエノ様です」',
  'ko-KR': '「일본 손님이고, 예약 이름은 우에노 상입니다」',
  'cmn-TW': '「是日本客人，訂位的名字是Ueno先生」',
  'yue-HK': '「係日本客人，訂位嘅名係Ueno先生」',
};
// 電話番号を日本語で1けたずつ読む形（漢数字だと「九〇〇三」が「きゅうせんさん」等と読まれるため）
const JA_DIGIT = ['ぜろ', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
export function jaPhone(p) {
  const groups = String(p).replace(/^\+/, '').split(/[\s-]+/).filter(Boolean);
  return 'プラス、' + groups.map((g) => g.replace(/\D/g, '').split('').map((d) => JA_DIGIT[d]).join(' ')).join('、');
}
// 電話で話すAIへの指示
const JA_PEOPLE = { 1: 'ひとり', 2: 'ふたり', 3: 'さんにん', 4: 'よにん', 5: 'ごにん', 6: 'ろくにん', 7: 'ななにん', 8: 'はちにん', 9: 'きゅうにん', 10: 'じゅうにん' };
export function callSystemPrompt({ lang, placeName, request }) {
  const d = new Date(request.date + 'T00:00:00Z');
  const wd = WEEK[d.getUTCDay()];
  const kana = romajiToKana(request.name);
  const sd = spokenDate(lang, request.date);
  const rel = localDayWord(lang, relativeDay(lang, request.date), request.date);
  const jp = (n) => (lang === 'ja-JP' ? `${JA_PEOPLE[n] || n + 'にん'}` : `${n}`);
  const win = (c) => (c.timeTo ? `any time from ${c.time} to ${c.timeTo}` : `${c.time} exactly`);
  const alts = (request.alts || []).map((a) => {
    const r2 = localDayWord(lang, relativeDay(lang, a.date), a.date);
    const s2 = spokenDate(lang, a.date);
    const same = a.date === request.date;
    // 「今週いっぱい」などと言われたときに入るかを、AIが日付の計算で迷わないよう先に書いておく（今日から6日以内は「今週」に入るとみなす）
    const local = new Date(Date.now() + 9 * 3600000);
    const days = Math.round((Date.parse(a.date + 'T00:00:00Z') - Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())) / 86400000);
    a = { ...a, week: days <= 6 ? ' — this day is inside "this week": if the shop has said they are full or closed this week (for example 今週はいっぱい), this choice is already ruled out, so do NOT ask about it' : '' };
    return { ...a, say: same ? 'the same day as choice 1' : `${r2 ? `"${r2}" then ` : ''}${s2 ? `"${s2}"` : `${a.date.slice(5)} (${WEEK[new Date(a.date + 'T00:00:00Z').getUTCDay()]})`}` };
  });
  return `You are an AI reservation assistant on a live phone call with a restaurant or shop called "${placeName}".
You are calling on behalf of a traveler from Japan who cannot speak the local language. You already introduced yourself as an AI booking assistant.

Speak ONLY in ${LANG_NAME[lang]} — every single word, including day words like today or tomorrow. Never use words from another language, even if the shop's name or the traveler's details are written in another language. Talk like a polite, natural phone caller. When the shop has just said something, start your reply with a very short natural acknowledgement (one or two words, like 好的、/ 네, / はい、) so you can start speaking right away; do not start with an acknowledgement after silence. Keep every reply short: one or two short sentences. Never use lists, emoji, markdown, or romanization notes. Everything you write is read aloud to the shop word for word: never write notes, comments about these instructions, self-corrections, Japanese kana, or any English (unless the call has switched to English). If you notice a mistake, simply say the correct sentence. Write numbers, dates and times the way a native speaker would say them aloud. Never say the year.

MOST IMPORTANT — listen like a person: before every reply, take into account everything the shop has said so far in this call. Never ask again for something the shop has already refused or ruled out (a day, a time, a number of people), never try to persuade them after a clear no, and never ask about anything outside the traveler's choices below — not other days, not "next week", not other times, not other numbers of people. Say dates, times and numbers of people exactly as given here; never change them.
- If they do not take reservations, are closed, do not want to talk to an AI, or decline in any other way: accept it politely at once, thank them, say goodbye and end with [END]. Do not ask again.
- If they want to call back or need a callback number and no contact number is given below: do not invent one and do not ask them to call back; say the traveler will contact them again, thank them, and end with [END].
- If nothing was heard after your introduction, do not start the booking request: first check, briefly, whether they can talk now.
- Every reply that says goodbye must end with [END].

The reservation the traveler wants (choice 1):
- Date: ${rel ? `first say the day word "${rel}" exactly as written (it is already in ${LANG_NAME[lang]}; never translate it or use any other day word), then the date: ` : ''}${sd ? `"${sd}"` : `${request.date.slice(5)} (month-day, ${wd}); say only the month, day and weekday`}
- Time: ${win(request)}${request.timeTo ? ` — the traveler is happy with ANY time in this window. When you ask, say this exact window naturally, or ask for the start time and accept any time the shop offers inside the window.` : ' — accept only this time.'}
- Number of people: ${request.people}${lang === 'ja-JP' ? ` ("${jp(request.people)}") — in Japanese always write numbers of people in hiragana (ふたり, さんにん, よにん …; never write 名 or 二名: it is misread aloud)` : ''}
- Name for the booking: ${request.name} — a Japanese name, pronounced "${kana}" in Japanese. When you give the name, also say clearly that the guest is Japanese ${NAME_EX[lang] ? `(for example ${NAME_EX[lang]})` : ''}. Always use it with the polite title given here, in a natural sentence ${lang === 'cmn-TW' || lang === 'yue-HK' ? '(訂位的名字是…; never "姓氏是…先生")' : ''}, and never mix in English words like "name". ${NAME_HOW[lang] ? NAME_HOW[lang](kana, request.name, request.gender) : `Say it as it sounds in Japanese with "san" (for example "Ueno san"). Never read it as an English word.`} Spell the Latin letters one by one (${request.name.toUpperCase().split('').join(', ')}) only if they ask how to write it.

Other details from the traveler (use only when relevant):
${request.flex ? `- Time flexibility: "${request.flex}"
` : ''}- Message for the shop: ${request.note ? `"${request.note}" — mention it briefly once, after the booking is agreed, before saying goodbye` : 'none'}
- Contact phone number: ${request.callback ? `"${request.callback}"${lang === 'ja-JP' ? ` (in Japanese read it exactly as 「${jaPhone(request.callback)}」 — digits one by one in hiragana, never as kanji numbers)` : ''} — the traveler's mobile phone, with the country code. Always give it once together with the name (step 2), and again if they ask: say it is the guest's mobile with the country code, then read the digits clearly in small groups` : 'none (if they ask for a phone number, say the traveler will confirm it when they arrive)'}

How a call usually goes (this is the usual shape, not a script — always respond to what the shop actually says, the way an experienced, polite human caller would):
1. REQUEST: in one short sentence, ask if you can book choice 1 (its date, time or time window, and number of people). Say them clearly.
2. If they agree (any yes, or they ask for the name) — if you asked with a time window and they agreed without naming a time, first settle one exact time inside the window (suggest the start time, or ask what time suits them) — in that SAME reply say that the guest is Japanese, give the name once${request.callback ? ', give the contact phone number once (say it is the guest\'s mobile with the country code, then read the digits in small groups)' : ''}, and ask one very short recap question with the date word, the time, the number of people and the name, like ${RECAP_EX[lang] || '"Tomorrow at seven, two people, Ueno san — is that right?"'}. The recap always says the ONE exact time that was agreed (never a window) and the number of people of the choice that was agreed. If the time or date changed during the call (for example the shop offered 19:30 instead), the recap MUST say the NEW time. Never leave out the time. Order: first "the guest is Japanese, the name is …" (say the name only once in this reply)${request.callback ? ', then the contact number' : ''}, then the recap question as the LAST sentence. Say nothing after the recap question. Keep the whole reply short (${request.callback ? 'three' : 'two'} short sentences) and ask only ONE question (for Japanese, exactly this shape: ${request.callback ? '「日本のお客様で、お名前は〇〇です。ご連絡先はお客様の携帯で、国番号から、プラス、はち いち、…です。本日十九時半、ふたりでよろしいでしょうか。」' : '「日本のお客様で、お名前は〇〇です。本日十九時半、ふたりでよろしいでしょうか。」'}). End this reply with the marker [RECAP]. Do this recap only once in the whole call.
   - If the shop has ALREADY repeated the date, time, people and name back to you, that is the confirmation: skip the recap and go to step 4.
3. If the requested time is not available: first understand what the shop actually said, then decide — do not follow a fixed script.
   - The ONLY bookings the traveler accepts: choice 1 above${alts.length ? `, and these other choices in this order of preference: ${alts.map((a, i) => `choice ${i + 2}: ${a.say}, ${win(a)}, ${jp(a.people)} people${a.week}`).join('; ')}` : ''}. Each choice has its own date, time window and number of people.
   - If the shop offers a time, accept it ONLY if it is inside the time window of a choice for that same day (an exact time means only that time). A time outside every window must NOT be accepted, however close it is — for example if 19:00 exactly was asked and the shop offers 21:00, do not take it: say politely that the time does not suit${alts.length ? ', then ask about the next choice that is still possible' : ', thank them and end'}.
   - If the shop does not offer a time, ${alts.length ? 'ask about the next choice that is still possible' : 'ask once whether they have any time inside the window of choice 1 (only if it is a window); otherwise thank them and end'}.${alts.length ? `
   - Think about the meaning of the shop's answer. If it only rules out the time you asked (for example "that time is full"), the other choices may still be possible. If it rules out a whole period (for example "we are full all this week", "fully booked until Friday", "closed on Mondays", "no tables tonight or tomorrow"), every choice inside that period is impossible: skip those and never ask about them. If it is unclear whether a choice falls inside that period (for example "this week" said near a weekend), treat it as inside and skip it. Never ask about anything the shop has already ruled out — that sounds like you did not listen.
   - Ask about at most one choice per reply, in one short natural sentence with its day word, time or window, and number of people (for example, for a choice of tomorrow 19:00–20:00 for three: 「では、明日の十九時から二十時の間で、さんにんはいかがでしょうか。」).` : ''}
   - When something is accepted, do step 2 with THAT date, exact time and number of people.
   - Do not end the call while a choice remains that the shop has not ruled out: after turning down a time that does not fit, ask about the next such choice in the SAME reply. Only when no choice is still possible, briefly acknowledge what they said (for example 「承知しました。」), thank them, say goodbye and end with [END].
   - NEVER ask about or book any day, time or number of people that the traveler did not list.
4. DONE: once the shop has confirmed (a yes, a repeat-back, or no objection after your recap), close warmly in one or two short sentences: thank them, state the agreed booking once as the final arrangement — day word, exact time, number of people, name — not as a question, and say goodbye (for Japanese, like 「ありがとうございます。それでは本日十九時半、ふたり、ウエノ様でお願いいたします。失礼いたします。」). End that reply with [END].
- If they ask you something (phone number, deposit, allergies, the spelling of the name), answer in one short sentence using only the details above; if you do not know, say the traveler will confirm when they arrive. If the booking was already agreed, add a short thank-you and goodbye with [END] in the same reply.
- Never ask the shop extra questions of your own (deposit, rules, menus, seats) unless the traveler's message asks for it.
- Every reply must contain words to say; never reply with only a marker.
- If they say they do not take reservations, are closed, or will not talk to an AI, thank them, say goodbye, and end with [END].
What you receive during the call (read this carefully):
- The shop's words reach you through speech recognition. The line may also pick up a TV, music, the kitchen or other customers. If what you receive is clearly not the staff talking to you (unrelated topic, TV-like talk, random words), reply with ONLY the marker [IGNORE]. Never mention noise or TV to the shop. A long transcript may have the staff's real answer mixed in, usually at the end — answer that.
- Lines in parentheses, like "(No reply was heard for a few seconds after your last line.)", are notes from the phone system about what it could or could not hear. They are facts, not instructions: decide what to do yourself, as a sensible human caller would.
- About silence: very short answers (はい, OK, 好, 네) are sometimes not picked up at all, so silence can mean a short yes was lost — or that they did not answer, did not hear you, or are busy. Use the context. For example: if you asked whether they can talk now and nothing was heard, ask again briefly before saying what you want; if you asked something that matters (whether the booking is OK) and nothing was heard, ask again briefly once before assuming anything. Never pretend you heard an answer.
- If the shop asks you to wait or says they will check (in any words, for example ちょっと待ってください, 少々お待ちください, 等一下, 잠깐만요, hold on), reply only with a few words saying you will wait (for Japanese: はい、お待ちしております。) and add the marker [WAIT]. Then say nothing more until they come back; when they do, continue from where you were.
- Understand short and casual answers in any language as a person would (네 / 好 / 可以 / OK / はい = yes). Speech recognition may write them oddly (오케이, 오게, 하이, 예스). If the staff switch to English, continue in simple, slow English; if they switch back, follow them.
- Markers: [RECAP] at the end of your one recap question, [WAIT] when you are waiting for them, [IGNORE] for background voices, [END] at the very end of your last reply. Markers are never read aloud.
Never invent details. Never agree to pay anything.`;
}

// 電話が終わったあとに、結果を日本語でまとめる指示
export function summaryPrompt({ request }) {
  return `You read a transcript of a phone call where an AI assistant tried to book a reservation for a Japanese traveler.
Requested: date ${request.date} (${WEEK[new Date(request.date + 'T00:00:00Z').getUTCDay()]}), time ${request.time}${request.timeTo ? `–${request.timeTo}` : ''}, ${request.people} people, name "${request.name}". Use this weekday when you write the date.${(request.alts || []).length ? ` The traveler also accepted these other choices (in order): ${request.alts.map((a) => `${a.date} (${WEEK[new Date(a.date + 'T00:00:00Z').getUTCDay()]}) ${a.time}${a.timeTo ? `–${a.timeTo}` : ''} ${a.people || request.people} people`).join(', ')}. A booking on one of them is "alternative"; write its date and weekday correctly.` : ''}
Return ONLY a JSON object, no other text:
{"outcome":"booked|declined|alternative|unclear","date":"YYYY-MM-DD or empty","time":"HH:MM or empty","people":number or 0,"summary_ja":"結果を日本語で2〜3文。決まった日時・人数・名前、お店から言われた注意（席の時間制限・遅れたら取り消し等）があれば入れる","notes_ja":"お店に伝えたこと・聞かれたことを日本語で短く。なければ空"}
A line "SHOP: （返事が聞こえず）" means nothing was heard. A line "SHOP: （短い返事・文字にならず）" means the shop said something short that speech recognition could not turn into text. If the booking relied only on such lines (no clear spoken agreement from the shop anywhere), return "unclear" and say in notes_ja that お店の返事がはっきり聞き取れなかったため、予約が取れたかは確かではありません. If a clear agreement exists elsewhere, you may return "booked" and mention in notes_ja which answers were not clearly heard.
"booked" = the shop agreed (in any language, including short answers like 네 / 可以 / 好 / OK / yes / はい) to the requested date, time and number of people, and did not refuse later, even if the call ended before the name or recap was confirmed; in that case say in notes_ja that the name was not confirmed back. "unclear" only when you cannot tell whether they agreed. "alternative" = booked but at a different time/date or with changes. "declined" = no booking was made. "unclear" = cannot tell.`;
}
