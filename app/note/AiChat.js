'use client';
// タビセツを作る：はじめから最後までチャットボット。
// 最初は「テンプレートで作る／AIで作る」の質問だけ。答えると、ボットが「入力中…」のあと次の質問がふわっと出てくる
import { useEffect, useRef, useState } from 'react';
import { TEMPLATES, SIZES } from './NoteCanvas';
import { TASTES } from './tastes';
import { FONTS } from './fonts';

const TYPES = ['トリセツ風ポスター', '旅の雑誌の1ページ', '絵日記', '映画のポスター風'];
const PICKS = [
  ['touch', '絵のタッチは？', [['watercolor', '水彩'], ['pencil', '色えんぴつ'], ['marker', 'マーカー手描き'], ['anime', 'アニメ風イラスト'], ['collage', '雑誌の切り抜きコラージュ']]],
  ['photo', '行った場所の写真はどうする？', [['real', '写真をそのまま使う'], ['redraw', 'イラストに描き直す']]],
  ['density', 'にぎやかさは？', [['clean', 'すっきり'], ['normal', 'ふつう'], ['packed', 'ぎっしり']]],
  ['color', '色の雰囲気は？', [['pastel', 'パステル'], ['vivid', 'ビビッド'], ['muted', 'くすみカラー'], ['mono', '白黒＋差し色']]],
  ['font', '文字の雰囲気は？', [['round', '手書き丸文字'], ['brush', '筆文字'], ['pop', 'ポップ'], ['mincho', '上品な明朝']]],
];
const PEOPLE_STYLES = [['cutout', '写真を切り抜いて貼る'], ['likeness', '似顔絵イラスト'], ['chibi', 'ゆるかわミニキャラ']];
const labelOf = (list, v) => (list.find(([k]) => k === v) || [])[1];
const TYPING_MS = 700;

// AIに渡す「どう描くか」をまとめる（NoteMaker から呼ぶ）
export function aiOptions(note) {
  const st = note.aiStyle || 'auto';
  const pr = note.aiPrefs || {};
  const people = (note.people || []).length && note.aiPeopleStyle !== 'none' ? (note.aiPeopleStyle || 'cutout') : 'none';
  const photo = st === 'pick' && pr.photo === 'redraw' ? 'redraw' : 'real';
  const memo = note.aiMemo || '';
  if (note.aiEdited && note.aiBrief) return { custom: note.aiBrief, peopleStyle: people, photo };
  if (st === 'mine') return { custom: note.aiCustom || '', peopleStyle: people, photo };
  if (st === 'pick') return { custom: briefText(note), peopleStyle: people, photo };
  return { prefs: memo ? { memo: memo.slice(0, 60) } : undefined, peopleStyle: people, photo };
}
export function briefText(note) {
  const st = note.aiStyle || 'auto';
  const pr = note.aiPrefs || {};
  const tpl = TASTES.find((t) => t.id === note.aiTaste)?.label || TEMPLATES.find((t) => t.id === note.tpl)?.label || '';
  if (st === 'mine') return note.aiCustom || '';
  const lines = [];
  if (st === 'pick') {
    lines.push(`${pr.type || 'トリセツ風ポスター'}を作ってください。`);
    const look = [pr.touch && `絵のタッチは${labelOf(PICKS[0][2], pr.touch)}`, pr.color && `色は${labelOf(PICKS[3][2], pr.color)}`, pr.font && `文字は${labelOf(PICKS[4][2], pr.font)}`].filter(Boolean);
    if (look.length) lines.push(look.join('、') + 'の雰囲気で。');
    if (pr.density) lines.push(`にぎやかさは「${labelOf(PICKS[2][2], pr.density)}」。`);
    lines.push(pr.photo === 'redraw' ? '行った場所の写真はイラストに描き直す。' : '行った場所の写真はそのまま写真として使う。');
  } else {
    lines.push(`「${tpl}」の雰囲気で、おまかせで作ってください。`);
  }
  if (note.aiMemo) lines.push(`こだわり：${note.aiMemo}`);
  return lines.join('\n');
}

function Free({ ph, init = '', onSend, max = 120, multi }) {
  const [v, setV] = useState(init);
  return (
    <form className="as-free" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSend(v.trim()); }}>
      {multi
        ? <textarea value={v} maxLength={max} placeholder={ph} onChange={(e) => setV(e.target.value)} rows={2} autoFocus />
        : <input value={v} maxLength={max} placeholder={ph} onChange={(e) => setV(e.target.value)} autoFocus />}
      <button type="submit" disabled={!v.trim()}>送る</button>
    </form>
  );
}

export default function ChatFlow(props) {
  const { note, save, user, onSignIn, trips, trip, setTrip, doneHere, spots, photoMap, toggleSpot, togglePhoto, photoKeys, addMore, addBusy,
    allPhotos, coverKey, peoplePool, peopleKeys, togglePeople, addPeople, peopleBusy, prompts, onPrompts, max,
    renderTplThumbs, tplFinal, aiFinal } = props;
  const [mode, setMode] = useState(null); // 'tpl' / 'ai'（毎回ここから始める）
  const [A, setA] = useState({}); // このチャットでの答え（id -> {t, k}）
  const [editAt, setEditAt] = useState(null);
  const [freeOpen, setFreeOpen] = useState(false);
  const [shown, setShown] = useState(null); // 「入力中…」のあと表示した質問
  const [pName, setPName] = useState('');
  const endRef = useRef(null);
  const urlOf = (k) => [...allPhotos, ...peoplePool].find((p) => p.key === k)?.url;
  const ai = mode === 'ai';

  function answer(id, t, patch = {}, keys) {
    if (Object.keys(patch).length) save(patch);
    setA((x) => ({ ...x, [id]: { t, k: keys } }));
    setEditAt(null); setFreeOpen(false);
  }
  const spotPatch = (id, text) => ({ spots: note.spots.map((x) => (x.id === id ? { ...x, text } : x)) });
  const chips = (list, onPick) => (
    <div className="as-chips">{list.map(([v, l]) => <button key={v} type="button" onClick={() => onPick(v, l)}>{l}</button>)}</div>
  );
  const freeBtn = (label = '自分で書く') => <button type="button" className="as-free-btn" onClick={() => setFreeOpen(true)}>{label}</button>;
  const photoGrid = (list, selected, onToggle, extra) => (
    <div className="ac-grid">
      {list.map((p) => {
        const n = selected.indexOf(p.key);
        return <button key={p.key} type="button" className="nm-ph" aria-pressed={n >= 0} onClick={() => onToggle(p.key)}><img src={p.url} alt="" />{n >= 0 && <i>{n + 1}</i>}</button>;
      })}
      {extra}
    </div>
  );
  const addLabel = (busy, onFiles) => (
    <label className="nm-add">{busy ? '保存中…' : <>＋<br />写真を追加</>}
      <input type="file" accept="image/*" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
    </label>
  );

  // ---- 質問の順番（答えによって増えたり減ったりする） ----
  const Q = [];
  Q.push({
    id: 'mode', bot: 'どっちで作る？',
    ui: () => (
      <div className="ac-modes">
        <button type="button" onClick={() => { setMode('tpl'); save({ mode: 'tpl' }); answer('mode', 'テンプレートで作る'); }}><b>テンプレートで作る</b><small>すぐできる・何枚でも</small></button>
        <button type="button" onClick={() => { setMode('ai'); save({ mode: 'ai' }); answer('mode', 'AIで作る'); }}><b>AIで作る</b><small>写真と文字をAIがイラストに仕上げる（1日3回まで）</small></button>
      </div>
    ),
  });
  if (mode) {
    if (ai && !user) {
      Q.push({ id: 'login', bot: '「AIで作る」は、Googleでログインすると使えるよ', ui: () => <div className="as-chips"><button type="button" className="as-ok" onClick={onSignIn}>Googleでログイン</button></div> });
    }
    if (trips.length > 1) {
      Q.push({ id: 'folder', bot: 'どの旅のタビセツにする？', ui: () => chips(trips.map((f) => [f, f]), (v) => { setTrip(v); answer('folder', v); }) });
    }
    if (!doneHere.length) {
      Q.push({ id: 'none', bot: 'このフォルダにはまだ「行った」お店がないよ。先に「行った」に入れてね', ui: () => null });
    }
    Q.push({
      id: 'shops', bot: `どのお店・スポットを入れる？（${max}つまで。えらんだ順に並んで、上から3つが「BEST 3」になるよ）`,
      ui: () => (
        <>
          <div className="ac-shops">
            {doneHere.map((it) => {
              const n = spots.findIndex((x) => x.it.id === it.id);
              const first = (photoMap[it.id] || [])[0];
              return (
                <button key={it.id} type="button" aria-pressed={n >= 0} disabled={n < 0 && spots.length >= max} onClick={() => toggleSpot(it.id)}>
                  {first ? <img src={first.url} alt="" /> : <span className="ph0" />}
                  <span>{it.altName || it.name}</span>{n >= 0 && <i>{n + 1}</i>}
                </button>
              );
            })}
          </div>
          <button type="button" className="as-ok ac-ok" disabled={!spots.length} onClick={() => answer('shops', spots.map((x) => x.it.altName || x.it.name).join('・'))}>これで決定（{spots.length}か所）</button>
        </>
      ),
    });
    if (ai) {
      Q.push({
        id: 'tpl', bot: '雰囲気はどれにする？',
        ui: () => (
          <div className="ac-tpls ac-tastes">
            {TASTES.map((t) => (
              <button key={t.id} type="button" onClick={() => answer('tpl', t.label, { tpl: t.tpl, font: t.font, aiTaste: t.id })}>
                <img className="ac-taste-img" src={`/note/taste-${t.id}.jpg`} alt="" loading="lazy" />
                <b>{t.label}</b><small>{t.sub}</small>
              </button>
            ))}
          </div>
        ),
      });
    } else {
      Q.push({ id: 'tpl', bot: 'デザインはどれにする？', ui: () => renderTplThumbs((t) => answer('tpl', t.label, { tpl: t.id, font: t.font })) });
    }
    Q.push({ id: 'size', bot: 'どこに載せる？（サイズ）', ui: () => chips(SIZES.map((x) => [x.id, x.label]), (v, l) => answer('size', l, { size: v })) });
    if (!ai) {
      Q.push({
        id: 'font', bot: '文字（フォント）はどれにする？',
        ui: () => (
          <div className="nm-fonts">
            {FONTS.map((f) => (
              <button key={f.id} type="button" className="nm-font" onClick={() => answer('font', f.label, { font: f.id })}>
                <b style={{ fontFamily: `"${f.family}"` }}>タビセツ</b><small>{f.label}</small>
              </button>
            ))}
          </div>
        ),
      });
    }
    if (allPhotos.length) {
      Q.push({
        id: 'cover', bot: '真ん中に大きく入れる写真はどれ？（景色や料理の写真がおすすめ）',
        ui: () => photoGrid(allPhotos, coverKey ? [coverKey] : [], (k) => answer('cover', 'この写真', { cover: k }, [k]),
          <button type="button" className="nm-ph ac-none" onClick={() => answer('cover', '入れない', { cover: null })}>入れない</button>),
      });
    }
    if (ai) {
      Q.push({
        id: 'people', bot: 'わたしたちの写真はある？（3枚まで。すみに小さく入るよ）',
        ui: () => (
          <>
            {photoGrid(peoplePool, peopleKeys, togglePeople, addLabel(peopleBusy, addPeople))}
            <div className="as-chips">
              <button type="button" className="as-ok" disabled={!peopleKeys.length} onClick={() => answer('people', `${peopleKeys.length}枚`, { aiPeopleStyle: note.aiPeopleStyle === 'none' ? 'cutout' : note.aiPeopleStyle }, peopleKeys)}>これで決定</button>
              <button type="button" onClick={() => answer('people', '入れない', { people: [], aiPeopleStyle: 'none' })}>入れない</button>
            </div>
          </>
        ),
      });
      if (peopleKeys.length && note.aiPeopleStyle !== 'none') {
        Q.push({ id: 'pstyle', bot: 'わたしたちはどう入れる？', ui: () => chips(PEOPLE_STYLES, (v, l) => answer('pstyle', l, { aiPeopleStyle: v })) });
      }
    }
    spots.forEach(({ s, it }) => {
      const name = it.altName || it.name;
      const list = photoMap[it.id] || [];
      Q.push({
        id: 'ph:' + it.id, bot: `「${name}」の写真はどれにする？（2枚まで）`,
        ui: () => (
          <>
            {photoGrid(list, photoKeys(s), (k) => togglePhoto(s, k), addLabel(addBusy === it.id, (f) => addMore(s, f)))}
            <button type="button" className="as-ok ac-ok" onClick={() => answer('ph:' + it.id, photoKeys(s).length ? `${photoKeys(s).length}枚` : '写真なし', {}, photoKeys(s))}>これで決定</button>
          </>
        ),
      });
      const cur = (s.text ?? (it.review || it.memo || '')).trim();
      Q.push({
        id: 'cm:' + it.id, bot: cur ? `「${name}」のひとことは、これでいい？\n「${cur}」` : `「${name}」のひとことは？`,
        ui: () => (
          <>
            <div className="as-chips">
              {cur && <button type="button" className="as-ok" onClick={() => answer('cm:' + it.id, cur, spotPatch(it.id, cur))}>このままでOK</button>}
              {freeBtn(cur ? '書き直す' : '書く')}
              <button type="button" onClick={() => answer('cm:' + it.id, 'なし', spotPatch(it.id, ''))}>なし</button>
            </div>
            {freeOpen && <Free multi max={200} init={cur} ph="例：豆乳と焼餅が絶品" onSend={(t) => answer('cm:' + it.id, t, spotPatch(it.id, t))} />}
          </>
        ),
      });
    });
    const textQ = (id, bot, field, sugg, ph, max2 = 24) => Q.push({
      id, bot,
      ui: () => (
        <>
          <div className="as-chips">
            {[...new Set(sugg.filter(Boolean))].map((x) => <button key={x} type="button" onClick={() => answer(id, x, { [field]: x === 'なし' ? '' : x })}>{x}</button>)}
            {freeBtn()}
          </div>
          {freeOpen && <Free ph={ph} max={max2} onSend={(t) => answer(id, t, { [field]: t })} />}
        </>
      ),
    });
    const now = new Date();
    textQ('title', 'タイトルは？', 'title', [note.title], '例：台湾夜市特集');
    textQ('sub', '小見出しはどうする？', 'sub', [note.sub, 'なし'], '例：正しい夜市の歩き方', 12);
    textQ('date', 'いつ行った？', 'date', [note.date, `${now.getFullYear()}.${now.getMonth() + 1}`, 'なし'], '例：2026.10');
    textQ('who', 'だれと行った？', 'who', [note.who, 'ひとり旅', '友だちと', '家族と', '恋人と', 'なし'], '例：仲良し3人組', 20);
    textQ('by', '書いた人の名前は？', 'by', [note.by, 'なし'], '例：のり', 20);
    textQ('words', '最後に、旅のひとことをどうぞ', 'words', [note.words, 'なし'], '例：また行きたくなる夜市', 80);
    if (!ai) {
      Q.push({ id: 'logo', bot: 'Tabibiのロゴを入れる？', ui: () => chips([['y', '入れる'], ['n', '入れない']], (v, l) => answer('logo', l, { logo: v === 'y' })) });
    } else {
      Q.push({
        id: 'style', bot: '絵の描き方はどうする？',
        ui: () => (
          <div className="as-chips">
            <button type="button" onClick={() => answer('style', 'おまかせ', { aiStyle: 'auto', aiEdited: false })}>おまかせ</button>
            <button type="button" onClick={() => answer('style', '自分で選ぶ', { aiStyle: 'pick', aiEdited: false })}>自分で選ぶ</button>
            {prompts.map((p) => <button key={p.name} type="button" onClick={() => answer('style', 'マイプロンプト：' + p.name, { aiStyle: 'mine', aiCustom: p.text, aiEdited: false })}>マイプロンプト：{p.name}</button>)}
          </div>
        ),
      });
      if ((note.aiStyle || 'auto') === 'pick') {
        const pr = note.aiPrefs || {};
        Q.push({
          id: 'p:type', bot: 'どんな1枚にしたい？',
          ui: () => (
            <>
              <div className="as-chips">{TYPES.map((x) => <button key={x} type="button" onClick={() => answer('p:type', x, { aiPrefs: { ...pr, type: x } })}>{x}</button>)}{freeBtn()}</div>
              {freeOpen && <Free ph="例：映画のパンフレット風" max={40} onSend={(t) => answer('p:type', t, { aiPrefs: { ...pr, type: t } })} />}
            </>
          ),
        });
        PICKS.forEach(([k, bot, opts]) => Q.push({
          id: 'p:' + k, bot,
          ui: () => chips([...opts, ['', 'おまかせ']], (v, l) => answer('p:' + k, l, { aiPrefs: { ...pr, [k]: v || undefined } })),
        }));
      }
      if ((note.aiStyle || 'auto') !== 'mine') {
        Q.push({
          id: 'memo', bot: '入れたいもの・入れたくないもの、こだわりはある？',
          ui: () => (
            <>
              <div className="as-chips"><button type="button" onClick={() => answer('memo', '特になし', { aiMemo: '' })}>特になし</button>{freeBtn()}</div>
              {freeOpen && <Free ph="例：猫のイラストを入れて" max={60} onSend={(t) => answer('memo', t, { aiMemo: t })} />}
            </>
          ),
        });
      }
    }
    const brief = note.aiEdited && note.aiBrief ? note.aiBrief : briefText(note);
    Q.push({
      id: 'final', final: true,
      bot: ai ? '準備できたよ！この内容でAIに頼むね。直したいところは、上の自分の答えを押すと答え直せるよ' : 'できたよ！こんな感じになったよ。直したいところは、上の自分の答えを押すと答え直せるよ',
      ui: () => (ai ? (
        <>
          <details className="ac-brief">
            <summary>AIへのお願い（プロンプト）を見る・書き直す</summary>
            <textarea className="as-prompt" value={brief} maxLength={1200} onChange={(e) => save({ aiBrief: e.target.value, aiEdited: true })} />
            <div className="as-row">
              <input value={pName} maxLength={30} placeholder="名前をつけて保存" onChange={(e) => setPName(e.target.value)} />
              <button type="button" disabled={!brief.trim()} onClick={() => { const n = (pName || brief.split('\n')[0]).slice(0, 30); onPrompts([{ name: n, text: brief }, ...prompts.filter((p) => p.name !== n)].slice(0, 20)); setPName(''); }}>マイプロンプトに保存</button>
            </div>
          </details>
          {aiFinal}
        </>
      ) : tplFinal),
    });
  }

  const nextQ = editAt ? Q.find((q) => q.id === editAt) : Q.find((q) => !A[q.id] && !(q.final && A.final));
  const curId = nextQ?.id || null;
  // 次の質問は「入力中…」を少し見せてから、ふわっと出す
  useEffect(() => {
    if (!curId) return;
    setShown(null);
    const t = setTimeout(() => { setShown(curId); }, TYPING_MS);
    return () => clearTimeout(t);
  }, [curId]);
  useEffect(() => { setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 60); }, [curId, shown]);

  return (
    <div className="as-chat ac">
      {Q.filter((q) => A[q.id] && q.id !== editAt && !q.final).map((q) => {
        const a = A[q.id];
        return (
          <div key={q.id} className="as-pair">
            <p className="as-bot">{q.bot}</p>
            <button type="button" className="as-me" title="押すと答え直せます"
              onClick={() => { if (q.id === 'mode') { setMode(null); setA({}); setEditAt(null); return; } setEditAt(q.id); setFreeOpen(false); }}>
              {a.k?.length ? <span className="ac-thumbs">{a.k.map((k) => urlOf(k) && <img key={k} src={urlOf(k)} alt="" />)}</span> : null}
              {a.t}
            </button>
          </div>
        );
      })}
      {nextQ && (shown !== curId ? (
        <p className="as-bot ac-typing" aria-label="入力中"><i /><i /><i /></p>
      ) : (
        <div className="as-pair ac-now" id="ac-now" key={curId}>
          <p className="as-bot">{nextQ.bot}</p>
          <div className="ac-ui">{nextQ.ui()}</div>
          {editAt && <button type="button" className="as-stop" onClick={() => setEditAt(null)}>やめる</button>}
        </div>
      ))}
      {mode && <button type="button" className="as-stop" onClick={() => { setMode(null); setA({}); setEditAt(null); }}>最初からやり直す</button>}
      <div ref={endRef} />
    </div>
  );
}
