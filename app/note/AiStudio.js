'use client';
// 「AIで作る」：おまかせ／好みを選ぶ／チャットでプロンプトを作る → できたらチャットで直す（版を残して戻せる）
import { useEffect, useRef, useState } from 'react';
import { toB64, callAi } from './util';

// ---- 好みを選ぶ ----
export const PREF_GROUPS = [
  ['touch', '絵のタッチ', [['watercolor', '水彩'], ['pencil', '色えんぴつ'], ['marker', 'マーカー手描き'], ['anime', 'イラスト（アニメ風）'], ['collage', '雑誌の切り抜き風']]],
  ['hero', 'わたしたちの入れ方', [['cutout', '写真を切り抜いて貼る'], ['likeness', '似顔絵イラスト'], ['chibi', 'ゆるかわミニキャラ'], ['none', '入れない']]],
  ['photo', '行った場所の写真', [['real', '写真をそのまま使う'], ['redraw', 'イラストに描き直す']]],
  ['density', 'にぎやかさ', [['clean', 'すっきり'], ['normal', 'ふつう'], ['packed', 'ぎっしり']]],
  ['color', '色', [['pastel', 'パステル'], ['vivid', 'ビビッド'], ['muted', 'くすみカラー'], ['mono', '白黒＋差し色']]],
  ['font', '文字', [['round', '手書き丸文字'], ['brush', '筆文字'], ['pop', 'ポップ'], ['mincho', '上品な明朝']]],
];
const PREF_DEFAULT = {
  lovely: { touch: 'pencil', hero: 'chibi', density: 'packed', color: 'pastel', font: 'round' },
  water: { touch: 'watercolor', hero: 'cutout', density: 'normal', color: 'pastel', font: 'mincho' },
  sky: { touch: 'watercolor', hero: 'cutout', density: 'normal', color: 'vivid', font: 'round' },
  vintage: { touch: 'watercolor', hero: 'likeness', density: 'clean', color: 'muted', font: 'mincho' },
  notebook: { touch: 'marker', hero: 'chibi', density: 'packed', color: 'vivid', font: 'round' },
  collage: { touch: 'collage', hero: 'cutout', density: 'packed', color: 'vivid', font: 'brush' },
};
export const prefDefault = (tpl) => ({ photo: 'real', ...(PREF_DEFAULT[tpl] || PREF_DEFAULT.lovely), memo: '' });

// ---- チャットで聞く質問（決まった質問をアプリの中で出すだけ。AIは使わない） ----
const FREE = '自分で書く';
const QUESTIONS = [
  { id: 'type', q: 'どんな1枚にしたい？', opts: ['トリセツ風ポスター', '旅の雑誌の1ページ', '絵日記', '映画のポスター風'], free: true },
  { id: 'touch', q: 'いいね！絵のタッチは？', opts: ['水彩', '色えんぴつ', 'マーカー手描き', 'アニメ風イラスト', '雑誌の切り抜きコラージュ'], free: true },
  { id: 'hero', q: 'わたしたちの写真はどう入れる？', opts: ['写真を切り抜いて貼る', '似顔絵イラスト', 'ゆるかわミニキャラ', '入れない'] },
  { id: 'photo', q: '行った場所の写真はどうする？', opts: ['写真をそのまま使う', 'イラストに描き直す'] },
  { id: 'bg', q: '背景はどうする？', opts: ['行き先の名所', '街なみ', 'きらきらの夜景', '花畑や自然'], free: true },
  { id: 'color', q: '色の雰囲気は？', opts: ['パステル', 'ビビッド', 'くすみカラー', '白黒＋差し色'], free: true },
  { id: 'font', q: '文字の雰囲気は？', opts: ['手書き丸文字', '筆文字', 'ポップ', '上品な明朝'], free: true },
  { id: 'items', q: '入れる項目をえらんでね（いくつでも）', opts: ['基本情報', '行った場所', 'BEST 3', '旅のバランス', 'ひとこと', '好きなものアイコン'], multi: true },
  { id: 'eng', q: '飾りの英語を入れる？', opts: ['Good Trip!', 'My Travel Manual', 'Bon Voyage', '入れない'], free: true },
  { id: 'ng', q: '入れたくないものはある？', opts: ['特になし'], free: true },
];
const SKIP = 'おまかせ';
function composePrompt(a) {
  const v = (k) => (a[k] && a[k] !== SKIP ? a[k] : '');
  const lines = [];
  lines.push(`${v('type') || 'トリセツ風ポスター'}を作ってください。`);
  const look = [v('touch') && `絵のタッチは${v('touch')}`, v('color') && `色は${v('color')}`, v('font') && `文字は${v('font')}`].filter(Boolean);
  if (look.length) lines.push(look.join('、') + 'の雰囲気で。');
  if (v('hero')) lines.push(v('hero') === '入れない' ? 'わたしたちの写真は入れない。' : `わたしたちの写真は「${v('hero')}」で、すみに小さめに入れる。`);
  if (v('photo')) lines.push(`行った場所の写真は「${v('photo')}」。`);
  if (v('bg')) lines.push(`背景は${v('bg')}。`);
  if (Array.isArray(a.items) && a.items.length) lines.push(`入れる項目：${a.items.join('、')}。`);
  if (v('eng') && v('eng') !== '入れない') lines.push(`飾りの英語として「${v('eng')}」を入れる。`);
  if (v('eng') === '入れない') lines.push('英語の飾り文字は入れない。');
  if (v('ng') && v('ng') !== '特になし') lines.push(`入れないもの：${v('ng')}。`);
  return lines.join('\n');
}

// ---- できたあとに直す ----
const FIXES = [
  { label: '文字を直す', ask: 'どこをどう直す？', ph: '例：「九份」の字がくずれているので直して' },
  { label: '色を変える', ask: 'どんな色にする？', opts: ['もっとパステルに', 'もっと鮮やかに', 'くすみカラーに'] },
  { label: '主役の描き方を変える', ask: 'どう変える？', opts: ['もっと本人に似せて', 'ゆるかわミニキャラにして', 'もっと笑顔にして'] },
  { label: '背景を変える', ask: 'どんな背景にする？', ph: '例：夕焼けの空にして' },
  { label: '飾りを増やす・減らす', ask: 'どうする？', opts: ['飾りをもっと増やして', '飾りを減らしてすっきり'] },
  { label: FREE, ask: '直したいところを書いてね', ph: '例：タイトルをもっと大きく' },
];

function Chips({ opts, onPick, extra }) {
  return (
    <div className="as-chips">
      {opts.map((o) => <button key={o} type="button" onClick={() => onPick(o)}>{o}</button>)}
      {extra}
    </div>
  );
}
function FreeInput({ ph, onSend, max = 120 }) {
  const [v, setV] = useState('');
  return (
    <form className="as-free" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onSend(v.trim()); setV(''); } }}>
      <input value={v} maxLength={max} placeholder={ph || '入力してね'} onChange={(e) => setV(e.target.value)} autoFocus />
      <button type="submit" disabled={!v.trim()}>送る</button>
    </form>
  );
}

export default function AiStudio({ note, save, buildBody, user, onSignIn, left, refreshLeft, onImage, hasOut, prompts, onPrompts, busy, setBusy, hideSub, bare }) {
  const sub = note.aiSub || 'auto';
  const prefs = note.aiPrefs || prefDefault(note.tpl);
  const chat = note.aiChat || { answers: {}, prompt: '', edited: false, done: false };
  const [freeFor, setFreeFor] = useState(null); // 「自分で書く」を開いている質問
  const [multi, setMulti] = useState([]);
  const [editAt, setEditAt] = useState(null); // 答え直す質問
  const [versions, setVersions] = useState([]); // [{url, blob}]
  const [cur, setCur] = useState(-1);
  const [fixLog, setFixLog] = useState([]); // [{who, text}]
  const [fix, setFix] = useState(null); // えらんだ直し方
  const [err, setErr] = useState('');
  const [pName, setPName] = useState('');
  const endRef = useRef(null);

  useEffect(() => () => versions.forEach((v) => URL.revokeObjectURL(v.url)), []); // eslint-disable-line react-hooks/exhaustive-deps
  // えらんでいる版を、保存・シェア・ガイドブックの対象にする
  useEffect(() => { if (cur >= 0 && versions[cur]) onImage(versions[cur].blob); }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!hasOut && cur >= 0 && versions[cur]) onImage(versions[cur].blob); }, [hasOut]); // eslint-disable-line react-hooks/exhaustive-deps

  const setChat = (patch) => save({ aiChat: { ...chat, ...patch } });
  const answered = QUESTIONS.filter((q) => chat.answers[q.id] !== undefined);
  const nextQ = editAt ? QUESTIONS.find((q) => q.id === editAt) : (chat.done ? null : QUESTIONS.find((q) => chat.answers[q.id] === undefined));
  const prompt = chat.edited ? chat.prompt : composePrompt(chat.answers);

  function answer(q, a) {
    const answers = { ...chat.answers, [q.id]: a };
    const all = QUESTIONS.every((x) => answers[x.id] !== undefined);
    setChat({ answers, done: chat.done || all, edited: false, prompt: '' });
    setFreeFor(null); setMulti([]); setEditAt(null);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
  }

  async function generate() {
    setBusy(true); setErr('');
    try {
      const body = await buildBody();
      if (!bare) { body.photo = 'real'; body.peopleStyle = 'cutout'; }
      if (bare) { /* チャットで集めた内容をそのまま使う */ }
      else if (sub === 'pick') { body.prefs = prefs; body.photo = prefs.photo === 'redraw' ? 'redraw' : 'real'; body.peopleStyle = ['cutout', 'likeness', 'chibi', 'none'].includes(prefs.hero) ? prefs.hero : 'cutout'; }
      else if (sub === 'chat') { body.custom = prompt.slice(0, 1200); body.photo = /イラストに描き直す/.test(prompt) ? 'redraw' : 'real';
        body.peopleStyle = /写真は入れない/.test(prompt) ? 'none' : /ミニキャラ/.test(prompt) ? 'chibi' : /似顔絵/.test(prompt) ? 'likeness' : 'cutout'; }
      const blob = await callAi(body);
      const v = { url: URL.createObjectURL(blob), blob };
      setVersions((a) => [...a, v]);
      setCur(versions.length);
      setFixLog([{ who: 'bot', text: 'できたよ！直したいところはある？' }]);
      setFix(null);
      setTimeout(() => document.getElementById('as-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch (e) { setErr(e.message || 'AIで作れませんでした'); }
    setBusy(false); refreshLeft();
  }

  async function applyFix(text) {
    const base = versions[cur];
    if (!base) return;
    setFixLog((l) => [...l, { who: 'me', text }]);
    setFix(null);
    setBusy(true); setErr('');
    try {
      const b64 = await toB64(base.url, 1440);
      const blob = await callAi({ kind: 'edit', size: note.size, base: b64, instruction: text });
      const v = { url: URL.createObjectURL(blob), blob };
      setVersions((a) => [...a, v]);
      setCur(versions.length);
      setFixLog((l) => [...l, { who: 'bot', text: `直したよ！（${versions.length + 1}枚目）ほかに直したいところはある？` }]);
    } catch (e) {
      setFixLog((l) => [...l, { who: 'bot', text: e.message || 'うまく直せなかった…もう一度ためしてね' }]);
    }
    setBusy(false); refreshLeft();
  }

  function savePrompt() {
    const name = (pName || prompt.split('\n')[0]).slice(0, 30);
    onPrompts([{ name, text: prompt }, ...prompts.filter((p) => p.name !== name)].slice(0, 20));
    setPName('');
  }

  if (!user) {
    return (
      <div className="nm-acts">
        <p className="nm-hint" style={{ gridColumn: '1 / -1' }}>「AIで作る」はGoogleでログインすると使えます。</p>
        <button type="button" onClick={onSignIn} style={{ gridColumn: '1 / -1' }}>Googleでログイン</button>
      </div>
    );
  }

  const canMake = !busy && left !== 0;
  const makeLabel = busy ? 'AIが描いています…（30秒ほど）' : left === 0 ? '今日の回数を使い切りました' : versions.length ? 'もう一度ちがう絵で作る' : 'AIで作る';

  return (
    <div className="as">
      {!hideSub && <div className="as-sub" role="tablist" aria-label="AIへの伝え方">
        {[['auto', 'おまかせ'], ['pick', '好みを選ぶ'], ['chat', 'チャットで作る']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={sub === k} onClick={() => save({ aiSub: k })}>{l}</button>
        ))}
      </div>}

      {!bare && sub === 'auto' && <p className="nm-hint">えらんだ雰囲気で、AIがおまかせで仕上げます。</p>}

      {!bare && sub === 'pick' && (
        <div className="as-pick">
          {PREF_GROUPS.map(([k, label, opts]) => (
            <div key={k} className="as-pg">
              <p>{label}</p>
              <div className="as-chips">
                {opts.map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={prefs[k] === v} onClick={() => save({ aiPrefs: { ...prefs, [k]: v } })}>{l}</button>
                ))}
              </div>
            </div>
          ))}
          <label className="nm-field">こだわりメモ（60文字まで）
            <input value={prefs.memo || ''} maxLength={60} placeholder="例：猫のイラストを入れて" onChange={(e) => save({ aiPrefs: { ...prefs, memo: e.target.value } })} />
          </label>
          <button type="button" className="nm-seg" onClick={() => save({ aiPrefs: prefDefault(note.tpl) })}>おすすめに戻す</button>
        </div>
      )}

      {!bare && sub === 'chat' && (
        <div className="as-chat">
          {prompts.length > 0 && (
            <div className="as-mine">
              <p>マイプロンプト</p>
              <div className="as-chips">
                {prompts.map((p) => (
                  <button key={p.name} type="button" onClick={() => setChat({ prompt: p.text, edited: true, done: true })}>{p.name}</button>
                ))}
              </div>
            </div>
          )}
          {answered.map((q) => (
            <div key={q.id} className="as-pair">
              <p className="as-bot">{q.q}</p>
              <button type="button" className="as-me" onClick={() => { setEditAt(q.id); setFreeFor(null); setMulti(Array.isArray(chat.answers[q.id]) ? chat.answers[q.id] : []); }} title="押すと答え直せます">
                {Array.isArray(chat.answers[q.id]) ? chat.answers[q.id].join('・') || SKIP : chat.answers[q.id]}
              </button>
            </div>
          ))}
          {answered.length === 0 && !nextQ && null}
          {nextQ && (
            <div className="as-pair as-now">
              <p className="as-bot">{nextQ.q}</p>
              {nextQ.multi ? (
                <div className="as-chips">
                  {nextQ.opts.map((o) => (
                    <button key={o} type="button" aria-pressed={multi.includes(o)} onClick={() => setMulti((m) => (m.includes(o) ? m.filter((x) => x !== o) : [...m, o]))}>{o}</button>
                  ))}
                  <button type="button" className="as-ok" onClick={() => answer(nextQ, multi)}>決定</button>
                </div>
              ) : (
                <>
                  <Chips opts={[...nextQ.opts, SKIP]} onPick={(o) => answer(nextQ, o)}
                    extra={nextQ.free && <button type="button" className="as-free-btn" onClick={() => setFreeFor(nextQ.id)}>{FREE}</button>} />
                  {freeFor === nextQ.id && <FreeInput onSend={(t) => answer(nextQ, t)} />}
                </>
              )}
              {!chat.done && answered.length > 0 && !editAt && (
                <button type="button" className="as-stop" onClick={() => setChat({ done: true })}>もうこれで作る</button>
              )}
            </div>
          )}
          {(chat.done || chat.edited) && !editAt && (
            <div className="as-pair">
              <p className="as-bot">できたよ！このプロンプトで作るね。自由に書き直してもOK</p>
              <textarea className="as-prompt" value={prompt} maxLength={1200} onChange={(e) => setChat({ prompt: e.target.value, edited: true, done: true })} />
              <div className="as-row">
                <input value={pName} maxLength={30} placeholder="名前をつけて保存" onChange={(e) => setPName(e.target.value)} />
                <button type="button" onClick={savePrompt} disabled={!prompt.trim()}>マイプロンプトに保存</button>
              </div>
              <button type="button" className="as-stop" onClick={() => { setChat({ answers: {}, prompt: '', edited: false, done: false }); setEditAt(null); }}>最初からやり直す</button>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {err && <p className="nm-err">{err}</p>}
      <div className="nm-acts">
        <button type="button" className="nm-ai-btn" onClick={generate} disabled={!canMake || (!bare && sub === 'chat' && !(chat.done || chat.edited))} style={{ gridColumn: '1 / -1' }}>
          {makeLabel}
          {!busy && left != null && left > 0 && <small>{left >= 999 ? '回数の制限なし（運営者）' : `今日あと${left}回（直すときも1回に数えます）`}</small>}
        </button>
      </div>

      {versions.length > 0 && (
        <div id="as-result" className="as-result">
          <img className="as-main" src={versions[cur]?.url} alt="できあがった絵" />
          {versions.length > 1 && (
            <div className="as-vers">
              {versions.map((v, i) => (
                <button key={v.url} type="button" aria-pressed={i === cur} onClick={() => setCur(i)}><img src={v.url} alt="" /><i>{i + 1}</i></button>
              ))}
            </div>
          )}
          {versions.length > 1 && (
            <div className="nm-row">
              <button type="button" className="nm-seg" disabled={cur <= 0} onClick={() => setCur(cur - 1)}>1つ前に戻す</button>
              <button type="button" className="nm-seg" disabled={cur === 0} onClick={() => setCur(0)}>1枚目に戻す</button>
            </div>
          )}
          <div className="as-chat as-fix">
            {fixLog.map((m, i) => <p key={i} className={m.who === 'bot' ? 'as-bot' : 'as-me as-me-static'}>{m.text}</p>)}
            {busy && <p className="as-bot as-typing">描き直しています…</p>}
            {!busy && !fix && (
              <Chips opts={FIXES.map((f) => f.label)} onPick={(l) => {
                const f = FIXES.find((x) => x.label === l);
                setFix(f); setFixLog((x) => [...x, { who: 'me', text: l }, { who: 'bot', text: f.ask }]);
              }} extra={<button type="button" className="as-ok" onClick={() => setFixLog((x) => [...x, { who: 'me', text: 'これで完成' }, { who: 'bot', text: 'おつかれさま！下のボタンから保存・シェアできるよ' }])}>これで完成</button>} />
            )}
            {!busy && fix && (
              <>
                {fix.opts && <Chips opts={fix.opts} onPick={(o) => applyFix(o)} />}
                <FreeInput ph={fix.ph || '自分で書く'} max={300} onSend={(t) => applyFix(t)} />
                <button type="button" className="as-stop" onClick={() => { setFix(null); setFixLog((x) => x.slice(0, -2)); }}>やめる</button>
              </>
            )}
            {left === 0 && <p className="nm-hint">今日の回数を使い切ったので、直すのはまた明日できます。</p>}
          </div>
        </div>
      )}
    </div>
  );
}
