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

export const CALL_MAX_CANDS = 5; // 候補の数の上限
export const CALL_MAX_GROUPS = 4; // テーブル（グループ）の数の上限
export const CALL_MAX_PEOPLE = 30; // 全テーブルの合計人数の上限

// テーブル（グループ）をそろえる：大人・子どもの人数、子どもの年齢、近くの席の希望。合計が0のものは落とす
function cleanGroups(list, s) {
  const n = (v) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= 0 && x <= CALL_MAX_PEOPLE ? x : 0; };
  const out = [];
  let sum = 0;
  for (const g of Array.isArray(list) ? list.slice(0, CALL_MAX_GROUPS) : []) {
    const adults = n(g?.adults), children = n(g?.children);
    if (adults + children < 1 || sum + adults + children > CALL_MAX_PEOPLE) continue;
    sum += adults + children;
    out.push({ adults, children, childAges: children ? s(g?.childAges, 40) : '', near: g?.near === false ? false : true });
  }
  return out;
}

// 予約の中身（画面から送られてくる値をそろえる。おかしな値はここで落とす）
// 新しい形：candidates（最大5。日にち・時間・時間の幅）と groups（最大4。大人・子ども・年齢・近くの席）と partial（all＝全テーブルが取れる時間だけ／any＝片方だけでも）
// 古い形：date/time/timeTo/people/alts も同じ意味に直す（古い画面・保存済みの記録が動くように）
// どちらの形でも、date/time/timeTo/people/alts（第1候補と第2候補以降・合計人数）を埋めて返す
export function cleanRequest(r) {
  const s = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F<>]/g, ' ').trim().slice(0, n) : '');
  const hm0 = (v) => (/^\d{2}:\d{2}$/.test(v) ? v : '');
  const people0 = Math.round(Number(r?.people));
  let groups = cleanGroups(r?.groups, s);
  if (!groups.length) {
    const p = Number.isFinite(people0) && people0 >= 1 && people0 <= CALL_MAX_PEOPLE ? people0 : 0;
    groups = p ? [{ adults: p, children: 0, childAges: '', near: true }] : [];
  }
  const total = groups.reduce((a, g) => a + g.adults + g.children, 0);
  // 候補：新しい形（candidates）を先に。無ければ古い形（date/time + alts）
  const cands = [];
  const addCand = (c, people) => {
    const d = s(c?.date, 10), t = hm0(s(c?.time, 5)), to = hm0(s(c?.timeTo, 5));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !t || cands.length >= CALL_MAX_CANDS) return;
    const cand = { date: d, time: t, timeTo: to && to > t ? to : '', people };
    if (cands.some((x) => x.date === cand.date && x.time === cand.time && x.timeTo === cand.timeTo && x.people === cand.people)) return;
    cands.push(cand);
  };
  if (Array.isArray(r?.candidates) && r.candidates.length) {
    for (const c of r.candidates.slice(0, CALL_MAX_CANDS + 3)) addCand(c, total);
  } else {
    addCand(r, total);
    for (const a of Array.isArray(r?.alts) ? r.alts.slice(0, CALL_MAX_CANDS - 1) : []) {
      const ap = Math.round(Number(a?.people));
      addCand(a, groups.length === 1 && Number.isFinite(ap) && ap >= 1 && ap <= CALL_MAX_PEOPLE ? ap : total);
    }
  }
  const first = cands[0] || { date: '', time: '', timeTo: '' };
  const out = {
    date: first.date,
    time: first.time,
    people: total,
    groups,
    partial: r?.partial === 'any' ? 'any' : 'all', // 複数テーブルのとき：all＝全テーブルが取れる時間だけ予約する／any＝片方だけでも予約する
    name: s(r?.name, 40), // 予約の名前（ローマ字かカタカナ）
    gender: r?.gender === 'f' ? 'f' : 'm', // 呼び方（中国語の先生・小姐など）
    flex: s(r?.flex, 60), // 時間の融通（例：19時〜20時ならOK）
    note: s(r?.note, 120), // ひとこと（例：窓際の席がいい）
    callback: intlPhone(s(r?.callback, 30)), // 連絡先（必須。お店に聞かれたら国番号つきで伝える。2026-11-22：番号が無いと断る店があるため）
    timeTo: first.timeTo || '', // 第1候補の時間の幅の終わり（「19:00〜20:30の間ならOK」の20:30。空なら時間ぴったりだけ）
    alts: cands.slice(1), // 第2候補以降（日にち・時間の幅・人数。1つ目が無理なときに聞く。最大4つ）
    candidates: cands, // 第1〜第5候補（順番どおり）
  };
  if (!out.date || !out.time || !out.people || !out.name || !out.callback) return null;
  return out;
}

// 「11月27日18:30」の形
const dateTimeJa = (date, time) => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date || '');
  return `${m ? `${Number(m[1])}月${Number(m[2])}日` : ''}${time || ''}`;
};

// 結果の画面用：テーブルごとの1行（groups があるときだけ）。例：「テーブル1（5名）：11月27日18:30 予約できました」
export function groupLines(groups) {
  return (Array.isArray(groups) ? groups : []).map((g, i) => {
    const n = g.people > 0 ? `（${g.people}名）` : '';
    const what = g.outcome === 'booked' ? `${dateTimeJa(g.date, g.time)} 予約できました`.trim() : g.outcome === 'declined' ? '予約できませんでした' : '結果がはっきりしません';
    return { key: i, ok: g.outcome === 'booked', text: `テーブル${g.table || i + 1}${n}：${what}` };
  });
}

// 電話のあとのまとめ（AIが返したテーブルごとの結果）をそろえる。おかしな値は落とす
export function cleanResultGroups(list) {
  const out = [];
  for (const g of Array.isArray(list) ? list.slice(0, CALL_MAX_GROUPS) : []) {
    const oc = ['booked', 'declined', 'unclear'].includes(g?.outcome) ? g.outcome : 'unclear';
    const date = typeof g?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g.date) ? g.date : '';
    const time = typeof g?.time === 'string' && /^\d{2}:\d{2}$/.test(g.time) ? g.time : '';
    const p = Math.round(Number(g?.people));
    out.push({ table: out.length + 1, outcome: oc, date: oc === 'booked' ? date : '', time: oc === 'booked' ? time : '', people: Number.isFinite(p) && p >= 1 && p <= CALL_MAX_PEOPLE ? p : 0 });
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
// 学年・年齢の書き方を、お店に伝える年齢の目安に（お店は「何歳？」と聞く）
const AGE_HINT = 'Japanese school grades: 小1 = first grade of elementary school, about 6-7 years old; 小2 = 7-8; 小3 = 8-9; 小4 = 9-10; 小5 = 10-11; 小6 = 11-12; 中1 = 12-13; 中2 = 13-14; 中3 = 14-15; 高1 = 15-16. 年少 = 3 years old, 年中 = 4, 年長 = 5 (kindergarten). "N歳" or "Nさい" = N years old.';

// 複数テーブル（グループ）のときの指示：1つの電話で全テーブルをまとめて聞く
function groupsPrompt({ lang, placeName, request }) {
  const base = legacyPrompt({ lang, placeName, request: { ...request, alts: [], groups: undefined } });
  const head = base.slice(0, base.indexOf('The reservation the traveler wants'));
  const tail = base.slice(base.indexOf('What you receive during the call'));
  const G = request.groups;
  const total = G.reduce((a, g) => a + g.adults + g.children, 0);
  const kana = romajiToKana(request.name);
  const cands = (request.candidates && request.candidates.length ? request.candidates : [{ date: request.date, time: request.time, timeTo: request.timeTo }]);
  const win = (c) => (c.timeTo ? `any time from ${c.time} to ${c.timeTo}` : `${c.time} exactly`);
  const nw = (n) => (lang === 'ja-JP' ? JA_PEOPLE[n] || n + 'にん' : String(n));
  const groupLines = G.map((g, i) => {
    const n = g.adults + g.children;
    const kids = g.children ? ` — ${g.adults} adult${g.adults === 1 ? '' : 's'} and ${g.children} child${g.children === 1 ? '' : 'ren'}${g.childAges ? ` (traveler wrote the child's age/grade as "${g.childAges}")` : ''}` : (g.adults ? ` — ${g.adults} adults, no children` : '');
    return `- Table ${i + 1}: ${n} people (say "${nw(n)}")${kids}. Seats: ${g.near ? 'the traveler would like this table NEAR the other table(s) — ask for nearby seats' : 'the tables may be apart from each other'}.`;
  }).join('\n');
  const tablesSay = G.map((g) => nw(g.adults + g.children)).join(' / ');
  const candLines = cands.map((c, i) => {
    const rel = localDayWord(lang, relativeDay(lang, c.date), c.date);
    const sdc = spokenDate(lang, c.date);
    const sameDay = i > 0 && c.date === cands[0].date;
    const when = sameDay ? 'the same day as choice 1' : `${rel ? `"${rel}" then ` : ''}${sdc ? `"${sdc}"` : `${c.date.slice(5)} (${WEEK[new Date(c.date + 'T00:00:00Z').getUTCDay()]})`}`;
    return `  choice ${i + 1}: ${when}, ${win(c)}`;
  }).join('\n');
  const all = request.partial !== 'any';
  const hasKids = G.some((g) => g.children > 0);
  const callbackLine = request.callback ? `
- Contact phone number: "${request.callback}"${lang === 'ja-JP' ? ` (in Japanese read it exactly as 「${jaPhone(request.callback)}」 — digits one by one in hiragana)` : ''} — the traveler's mobile phone, with the country code. Give it once together with the name at the recap step, and again if they ask.` : '';
  return `${head}The reservation the traveler wants — SEVERAL TABLES IN ONE CALL (${G.length} tables, ${total} people in total, all under one name):
${groupLines}
- The tables are for the same party of friends/family: ask for ALL tables together in the SAME request and the SAME time, in one short sentence, for example "two tables, for ${tablesSay} people${G.some((g) => g.near) ? ', with seats close to each other' : ''}". Do not ask about the tables one by one unless the shop can only do some of them (see below).
- Choices in the traveler's order of preference (ask in exactly this order; the first one is the most wanted):
${candLines}
  Each choice has its own time or time window. A time is acceptable ONLY if it is inside the window of a choice on that same day (an exact time means only that time).
- Name for the booking: ${request.name} — the SAME name for every table; a Japanese name, pronounced "${kana}" in Japanese. When you give the name, also say clearly that the guest is Japanese ${NAME_EX[lang] ? `(for example ${NAME_EX[lang]})` : ''}. ${NAME_HOW[lang] ? NAME_HOW[lang](kana, request.name, request.gender) : `Say it as it sounds in Japanese with "san" (for example "Ueno san"). Never read it as an English word.`} Spell the Latin letters one by one (${request.name.toUpperCase().split('').join(', ')}) only if they ask how to write it.
- Children: ${hasKids ? `there ${G.reduce((a, g) => a + g.children, 0) === 1 ? 'is a child' : 'are children'} in the party (see the tables above). When you ask for the tables, mention briefly that the party includes children (for example "including one child"). If the shop asks about the children's ages, a child seat, a kids' chair or a kids' menu, answer from the details above: give the age in years (${AGE_HINT}); if the shop asks something about the child you do not know, say the traveler will confirm when they arrive. Never invent an age.` : 'none.'}

Other details from the traveler (use only when relevant):
${request.flex ? `- Time flexibility: "${request.flex}"
` : ''}- Message for the shop: ${request.note ? `"${request.note}" — mention it briefly once, after the booking is agreed, before saying goodbye` : 'none'}${callbackLine}

How this call goes — MULTIPLE TABLES (not a script; always respond to what the shop actually says, like an experienced, polite human caller):
1. REQUEST: ask whether choice 1 is possible for ALL tables together: its date, the time or time window, the number of tables and the number of people at each table, and (if wanted) seats close together. One or two short sentences.
${all ? `2. RULE — ALL TABLES OR NOTHING: the traveler books ONLY a time when the shop can seat EVERY table (all ${G.length}) at the same time. If at some choice the shop can take only some of the tables (for example one table but not the other), do NOT agree to it and do NOT book anything: politely say that you need all the tables together, remember what the shop said is possible, and in the SAME reply ask about the next choice that is still possible. Never say "just that one is fine".` : `2. RULE — PARTIAL BOOKING IS OK: the traveler accepts booking only some of the tables. If at a choice the shop can take only some of the tables, accept those (say which table(s), by number of people), and then in the SAME reply ask about the next choice that is still possible for ONLY the tables that are not booked yet (say their number of people). Keep going through the choices until every table is booked or no choice is left. Never ask again for a table that is already booked.`}
3. If the shop offers a time: accept it ONLY if it is inside the window of a choice (same day). A time outside every window must NOT be accepted, however close it is — say politely that it does not suit and ask about the next choice. Never ask about or accept any day, time, number of people or number of tables that the traveler did not list. Never add a choice of your own.
4. If the first choice is not available, do NOT go through the remaining choices one at a time — that sounds pushy. In ONE short reply, ask whether ANY of the OTHER times the traveler listed would work for all the tables together, naming those other times briefly in that single sentence (for example 「では、同じ日の十八時半、十九時、十七時半のいずれかで、二テーブルは空いていますでしょうか。」). Leave out any time the shop has already ruled out: if the shop said they are full for the whole day or a whole period (for example "full all evening", "fully booked this week", "closed that day"), every choice inside it is ruled out — do not name those, and if none remain, go straight to step 6. Ask about the other times only this ONE time; if the shop says none are available, do not ask again — go to step 6.
5. WHEN ${all ? 'ALL TABLES CAN BE BOOKED AT THE SAME CHOICE' : 'THE BOOKINGS ARE SETTLED (all tables booked, or no choice is left but some tables are booked)'}: in ONE reply say that the guest is Japanese, give the name once${request.callback ? ', give the contact phone number once (the guest\'s mobile with the country code, digits in small groups)' : ''}, and ask ONE short recap question, as the LAST sentence, that says the day word, the ONE exact time, the number of people at EACH table (and the number of tables) and the name${all ? '' : ' — and, if the bookings are on different days or times, each one'} (for example ${RECAP_EX[lang] || '"Tomorrow at seven, two tables for four and five people, Ueno san — is that right?"'}, but with the real tables and numbers of this call). End this reply with [RECAP]. Do this recap only ONCE in the whole call. The name is the same for every table; say it only once. If the shop has ALREADY repeated the date, time, tables and name back, skip the recap and go to step 7.
6. ${all ? 'IF NO CHOICE WORKS FOR ALL TABLES: do NOT book anything, and do NOT keep asking or pushing. Briefly acknowledge what the shop said, say clearly that you will not book now and that the traveler will contact them again, thank them, say goodbye and end with [END]. Do not ask any further question and do not book even if they offer something. (If the shop volunteered which times or tables are free, you may note it in your closing, but never probe for more.)' : 'IF NO CHOICE IS LEFT and some table could not be booked: thank them, say goodbye and end with [END] (after the recap if something was booked).'}
7. DONE: once the shop has confirmed (a yes, a repeat-back, or no objection after your recap), close warmly in one or two short sentences: thank them, state the agreed booking once as the final arrangement — day word, exact time, the tables and numbers of people, name — not as a question, and say goodbye. End that reply with [END].
- If they ask you something (phone number, deposit, allergies, the children's ages, a child seat, the spelling of the name), answer in one short sentence using only the details above; if you do not know, say the traveler will confirm when they arrive.
- Never ask the shop extra questions of your own (deposit, rules, menus) except what step 6 allows, and asking for seats close together. Never add a choice, a time or a number of people of your own until the shop has settled this one.
- Every reply must contain words to say; never reply with only a marker.
- If they say they do not take reservations, are closed, or will not talk to an AI, thank them, say goodbye, and end with [END].
${tail}`;
}

export function callSystemPrompt({ lang, placeName, request }) {
  if (Array.isArray(request.groups) && request.groups.length > 1) return groupsPrompt({ lang, placeName, request });
  return legacyPrompt({ lang, placeName, request });
}

function legacyPrompt({ lang, placeName, request }) {
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
${request.groups?.length === 1 && request.groups[0].children > 0 ? `- Children: ${request.groups[0].children} of the people are children${request.groups[0].childAges ? ` (age/grade written by the traveler: "${request.groups[0].childAges}". ${AGE_HINT})` : ''}. Mention it briefly with the request, and answer if the shop asks about ages or a child seat. Never invent an age.
` : ''}- Name for the booking: ${request.name} — a Japanese name, pronounced "${kana}" in Japanese. When you give the name, also say clearly that the guest is Japanese ${NAME_EX[lang] ? `(for example ${NAME_EX[lang]})` : ''}. Always use it with the polite title given here, in a natural sentence ${lang === 'cmn-TW' || lang === 'yue-HK' ? '(訂位的名字是…; never "姓氏是…先生")' : ''}, and never mix in English words like "name". ${NAME_HOW[lang] ? NAME_HOW[lang](kana, request.name, request.gender) : `Say it as it sounds in Japanese with "san" (for example "Ueno san"). Never read it as an English word.`} Spell the Latin letters one by one (${request.name.toUpperCase().split('').join(', ')}) only if they ask how to write it.

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
   - If the first choice is refused, do NOT go through the other choices one at a time — that sounds pushy. In ONE short reply, ask whether ANY of the OTHER times the traveler listed would work, naming them briefly in that single sentence (for example 「では、明日の十九時、もしくは二十時はいかがでしょうか。」). Leave out any time already ruled out; ask this only ONCE.` : ''}
   - When something is accepted, do step 2 with THAT date, exact time and number of people.
   - Ask about the other choices only this one combined time. When no choice is still possible (or the shop says none of the other times work), briefly acknowledge what they said (for example 「承知しました。」), thank them, say goodbye and end with [END]. Do not keep asking.
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
function groupsSummaryPrompt({ request }) {
  const G = request.groups;
  const cands = request.candidates && request.candidates.length ? request.candidates : [{ date: request.date, time: request.time, timeTo: request.timeTo }];
  const wd = (d) => WEEK[new Date(d + 'T00:00:00Z').getUTCDay()];
  return `You read a transcript of a phone call where an AI assistant tried to book ${G.length} tables in ONE call for a Japanese traveler (name "${request.name}").
Tables: ${G.map((g, i) => `table ${i + 1} = ${g.adults + g.children} people (${g.adults} adults, ${g.children} children)`).join('; ')}.
Choices in order: ${cands.map((c, i) => `${i + 1}) ${c.date} (${wd(c.date)}) ${c.time}${c.timeTo ? `–${c.timeTo}` : ''}`).join(', ')}. Use these weekdays when you write dates.
The traveler's rule: ${request.partial === 'any' ? 'booking only some of the tables is OK.' : 'book ONLY a time when ALL tables can be seated; if only some tables were available, nothing should be booked.'}
Return ONLY a JSON object, no other text:
{"outcome":"booked|declined|alternative|unclear","date":"YYYY-MM-DD or empty","time":"HH:MM or empty","people":number or 0,"groups":[${G.map((g, i) => `{"table":${i + 1},"outcome":"booked|declined|unclear","date":"YYYY-MM-DD or empty","time":"HH:MM or empty","people":${g.adults + g.children}}`).join(',')}],"summary_ja":"結果を日本語で2〜4文。テーブルごとに、決まった日時・人数・名前、取れなかったテーブルがあればその理由（満席など）、お店から言われた空きの状況（例：19時なら4名のテーブルだけ空いている）、注意（席の時間制限・遅れたら取り消し等）を入れる","notes_ja":"お店に伝えたこと・聞かれたこと（子どもの年齢・子ども用の椅子など）を日本語で短く。なければ空"}
"groups" must have exactly one item per table, in the same order. For each table: "booked" = the shop agreed (and did not refuse later) to that table on that date and time — put the agreed date, time and the table's number of people; "declined" = that table was NOT booked (leave date and time empty); "unclear" = cannot tell. Tables that the shop agreed together share the same date and time. If the shop said they could seat only some tables at some time but the call ended WITHOUT agreeing a booking, those tables are "declined" and the availability the shop mentioned goes into summary_ja (it is only information, not a booking).
Top-level "outcome": "booked" = every table is booked (at any choice the traveler listed); "alternative" = at least one table booked but not all of them; "declined" = no table was booked; "unclear" = cannot tell. Top-level date/time/people = the first booked table (empty/0 if none).
A line "SHOP: （返事が聞こえず）" means nothing was heard. A line "SHOP: （短い返事・文字にならず）" means the shop said something short that speech recognition could not turn into text. If a booking relied only on such lines (no clear spoken agreement anywhere), return "unclear" for it and say in notes_ja that お店の返事がはっきり聞き取れなかったため、予約が取れたかは確かではありません.
A table is "booked" when the shop gave an affirmative answer (in any language, including short ones like 네 / 예 / 可以 / 好 / OK / yes / はい) to that table's requested date, time and size and did NOT refuse it afterwards — even if the shop's reply to the AI's final recap was short or not cleanly heard, as long as such an affirmative appears for it somewhere in the call and there is no later refusal. In that case say in notes_ja which answers were short or not clearly heard. Use "unclear" for a table only when you genuinely cannot tell whether the shop agreed. (This never overrides the traveler's all-tables rule above: when the rule is all-or-nothing and any table was refused, nothing is booked.)`;
}

export function summaryPrompt({ request }) {
  if (Array.isArray(request.groups) && request.groups.length > 1) return groupsSummaryPrompt({ request });
  return `You read a transcript of a phone call where an AI assistant tried to book a reservation for a Japanese traveler.
Requested: date ${request.date} (${WEEK[new Date(request.date + 'T00:00:00Z').getUTCDay()]}), time ${request.time}${request.timeTo ? `–${request.timeTo}` : ''}, ${request.people} people, name "${request.name}". Use this weekday when you write the date.${(request.alts || []).length ? ` The traveler also accepted these other choices (in order): ${request.alts.map((a) => `${a.date} (${WEEK[new Date(a.date + 'T00:00:00Z').getUTCDay()]}) ${a.time}${a.timeTo ? `–${a.timeTo}` : ''} ${a.people || request.people} people`).join(', ')}. A booking on one of them is "alternative"; write its date and weekday correctly.` : ''}
Return ONLY a JSON object, no other text:
{"outcome":"booked|declined|alternative|unclear","date":"YYYY-MM-DD or empty","time":"HH:MM or empty","people":number or 0,"summary_ja":"結果を日本語で2〜3文。決まった日時・人数・名前、お店から言われた注意（席の時間制限・遅れたら取り消し等）があれば入れる","notes_ja":"お店に伝えたこと・聞かれたことを日本語で短く。なければ空"}
A line "SHOP: （返事が聞こえず）" means nothing was heard. A line "SHOP: （短い返事・文字にならず）" means the shop said something short that speech recognition could not turn into text. If the booking relied only on such lines (no clear spoken agreement from the shop anywhere), return "unclear" and say in notes_ja that お店の返事がはっきり聞き取れなかったため、予約が取れたかは確かではありません. If a clear agreement exists elsewhere, you may return "booked" and mention in notes_ja which answers were not clearly heard.
"booked" = the shop agreed (in any language, including short answers like 네 / 可以 / 好 / OK / yes / はい) to the requested date, time and number of people, and did not refuse later, even if the call ended before the name or recap was confirmed; in that case say in notes_ja that the name was not confirmed back. "unclear" only when you cannot tell whether they agreed. "alternative" = booked but at a different time/date or with changes. "declined" = no booking was made. "unclear" = cannot tell.`;
}
