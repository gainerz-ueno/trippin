// タビビコールの会話テスト（運営者だけ）：電話をかけずに、AI同士（お店役・予約役）で会話を回して、
// 予約役の話し方（繰り返し・名前・日にち・締め）を確かめる。本物の電話・回数券は使わない
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { GREETING, callSystemPrompt, summaryPrompt, cleanRequest } from '../../../lib/call';
import { rpcJson, claudeChat, claudeOnce } from '../../../lib/call-server';

const json = (o, status = 200) => Response.json(o, { status });
const END = '[END]';

const SHOP = {
  normal: '店員として自然に受け答えする。空いているので予約を受ける。返事は短め。',
  terse: '忙しい店員。返事はとても短く（好・可以・嗯・對・OK など一言）だけで答える。',
  hello_first: '電話に出たらまず「喂，您好，北門」と言う。そのあとは普通に予約を受ける。',
  full: '19時は満席。19時半なら空いていると答える。',
  spelling: '名前を聞いたら、つづりを聞き返す。そのあと予約を受ける。',
  impatient: '確認を何度もされるのが嫌いな店員。2回目の確認をされたら「對啦，好了」と少し不機嫌に言う。',
};

function shopSystem(lang, scenario) {
  const L = { 'cmn-TW': '台湾華語（繁体字）', 'yue-HK': '広東語', 'ko-KR': '韓国語', 'ja-JP': '日本語', 'vi-VN': 'ベトナム語', 'th-TH': 'タイ語' }[lang] || 'その国の言葉';
  return `あなたは飲食店の電話に出た店員。${L}だけで話す。${SHOP[scenario] || SHOP.normal}
AIの予約アシスタントから予約の電話がかかってくる。店員の言葉だけを1〜2文で書く（説明・かっこ書き不要）。会話が終わったと思ったら「再見」など普通に挨拶して終える。`;
}

export async function POST(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').slice(0, 4000);
  if (!token) return json({ error: 'ログインしてください' }, 401);
  const me = await rpcJson('my_call_credits', {}, token);
  if (!me.ok || !me.data?.owner) return json({ error: '運営者だけが使えます' }, 403);
  let env; try { env = getCloudflareContext().env; } catch { env = process.env; }
  const body = await req.json().catch(() => ({}));
  const lang = GREETING[body.lang] ? body.lang : 'cmn-TW';
  const scenario = SHOP[body.scenario] ? body.scenario : 'normal';
  const request = cleanRequest(body.request || {});
  if (!request) return json({ error: '予約の中身が足りません' }, 400);
  const system = callSystemPrompt({ lang, placeName: body.placeName || '北門', request });
  const agent = [], shop = [], transcript = [];
  // 同じ側が続いたら1つにまとめる（Claude には交互に渡す決まり）
  const add = (arr, role, content) => {
    const last = arr[arr.length - 1];
    if (last && last.role === role) last.content += '\n' + content; else arr.push({ role, content });
  };
  const say = (who, text) => {
    transcript.push({ who, text });
    if (who === 'ai') { add(agent, 'assistant', text); add(shop, 'user', text); }
    else { add(agent, 'user', text); add(shop, 'assistant', text); }
  };
  try {
    if (scenario === 'hello_first') {
      shop.push({ role: 'user', content: '（電話が鳴った。出てください）' });
      const first = (await claudeChat(env, { system: shopSystem(lang, scenario), messages: shop })).trim();
      shop.pop();
      transcript.push({ who: 'shop', text: first });
      // 本番と同じく、あいさつは最後まで言い、そのあとお店の言葉に答える
      agent.push({ role: 'user', content: '(The call has connected.)' }, { role: 'assistant', content: GREETING[lang] });
      transcript.push({ who: 'ai', text: GREETING[lang] });
      shop.push({ role: 'user', content: first + '（相手：）' + GREETING[lang] });
      agent.push({ role: 'user', content: `${first}\n(You already finished your introduction. If they only said hello, do not introduce yourself again; go straight to the booking request.)` });
    } else {
      agent.push({ role: 'user', content: '(The call has connected.)' }, { role: 'assistant', content: GREETING[lang] });
      transcript.push({ who: 'ai', text: GREETING[lang] });
      shop.push({ role: 'user', content: GREETING[lang] });
      const s1 = (await claudeChat(env, { system: shopSystem(lang, scenario), messages: shop })).trim();
      shop.push({ role: 'assistant', content: s1 });
      agent.push({ role: 'user', content: s1 });
      transcript.push({ who: 'shop', text: s1 });
    }
    let ended = false;
    for (let turn = 0; turn < 10 && !ended; turn++) {
      const a = (await claudeChat(env, { system, messages: agent, maxTokens: 220 })).trim();
      ended = a.includes(END);
      say('ai', a.replace(END, '').trim());
      if (ended) break;
      const s = (await claudeChat(env, { system: shopSystem(lang, scenario), messages: shop })).trim();
      say('shop', s);
    }
    let summary = null;
    try {
      const lines = transcript.map((t) => `${t.who === 'ai' ? 'AI' : 'SHOP'}: ${t.text}`).join('\n');
      const out = await claudeOnce(env, { system: summaryPrompt({ request }), user: lines, maxTokens: 1500 });
      summary = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    } catch { summary = null; }
    return json({ lang, scenario, ended, aiTurns: transcript.filter((t) => t.who === 'ai').length, transcript, summary });
  } catch (e) {
    return json({ error: String(e?.message || e).slice(0, 300), transcript }, 500);
  }
}
