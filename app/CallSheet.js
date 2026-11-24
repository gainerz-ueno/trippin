'use client';
// タビビコール：保存したお店に、AIが現地語で予約の電話をかける画面
// ・日にち・時間・人数・名前を入れる → AIが電話（最大3分）→ 結果を日本語で見せる
// ・ポイントを45pt使う（3分ごと。2026-11-22 ポイント制）。お店が出なかった・話し中だったときはポイントを戻す
import { useEffect, useRef, useState } from 'react';
import { accessToken } from './note/util';
import { CALL_BLOCK_SEC, CALL_LANGS, CALL_MAX_CANDS as MAX_CANDS, CALL_MAX_GROUPS as MAX_GROUPS, CALL_MAX_PEOPLE, groupLines, langOfPhone, toE164 } from './lib/call';

// お店の国の言葉（例：現地の言葉（韓国語））
function localLang(phone) {
  const L = langOfPhone(toE164(phone));
  return L && !L.testOnly ? `現地の言葉（${L.name}）` : '現地の言葉';
}

// テストで話す言語（重ならないように）
const TEST_LANGS = [...new Map(Object.values(CALL_LANGS).map((x) => [x.lang, x.name])).entries()];

const STATUS_JA = {
  calling: '電話をかけています…',
  ringing: 'お店を呼び出しています…',
  talking: 'AIがお店と話しています…',
  done: '電話が終わりました',
  no_answer: 'お店が電話に出ませんでした',
  busy: 'お店の電話が話し中でした',
  failed: '電話がつながりませんでした',
  canceled: '電話を取りやめました',
};
const OUTCOME_JA = { booked: '予約できました', alternative: '条件を変えて予約できました', declined: '予約できませんでした', unclear: '結果がはっきりしません' };
const FINAL = new Set(['done', 'no_answer', 'busy', 'failed', 'canceled']);
const NAME_KEY = 'tabibi.call.name';

async function callApi(path, opts = {}) {
  const t = await accessToken();
  if (!t) throw new Error('Googleでログインしてください');
  let r;
  try {
    r = await fetch(path, {
      ...opts,
      headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), Authorization: 'Bearer ' + t },
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error('通信できませんでした。電波のよいところで、もう一度試してください');
  }
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) {
    const e = new Error(d?.error || 'うまくいきませんでした。もう一度試してください');
    e.data = d;
    throw e;
  }
  return d;
}

const todayLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

function Result({ c }) {
  const [open, setOpen] = useState(false);
  if (!c) return null;
  const final = FINAL.has(c.status) && (c.status !== 'done' || c.result);
  const gl = final && c.status === 'done' ? groupLines(c.result?.groups) : [];
  const someOnly = gl.length > 1 && gl.some((x) => x.ok) && gl.some((x) => !x.ok);
  const noneOk = gl.length > 1 && gl.every((x) => !x.ok);
  return (
    <div className={'call-res ' + (someOnly ? 'alternative' : c.outcome || '')}>
      <p className="call-st">{final && c.status === 'done' ? (someOnly ? '一部のテーブルだけ予約できました' : noneOk && c.outcome === 'declined' ? '予約は取っていません' : OUTCOME_JA[c.outcome] || STATUS_JA.done) : STATUS_JA[c.status] || STATUS_JA.calling}</p>
      {gl.length > 1 && (
        <ul className="call-groups">
          {gl.map((x) => <li key={x.key} className={x.ok ? 'ok' : 'ng'}>{x.text}</li>)}
        </ul>
      )}
      {!final && <p className="hint">そのまま待ってください。画面を閉じても電話は続き、結果はあとでここに残ります。</p>}
      {final && c.tickets > 0 && !c.is_test && <p className="hint">この電話で使ったポイント：{c.tickets * 45}pt</p>}
      {c.result?.summary_ja && <p className="call-sum">{c.result.summary_ja}</p>}
      {c.result?.notes_ja && <p className="call-notes">{c.result.notes_ja}</p>}
      {Array.isArray(c.transcript) && c.transcript.length > 1 && (
        <>
          <button type="button" className="linkbtn" onClick={() => setOpen(!open)}>{open ? '会話の記録を閉じる' : '会話の記録を見る（現地語）'}</button>
          {open && (
            <ul className="call-log">
              {c.transcript.map((t, i) => <li key={i} className={t.who}><b>{t.who === 'ai' ? 'AI' : 'お店'}</b>{t.text}</li>)}
            </ul>
          )}
        </>
      )}
      {c.is_test && <p className="hint">テストの電話です（回数は使っていません）</p>}
    </div>
  );
}

export default function CallSheet({ place, user, onSignIn, onClose }) {
  const [me, setMe] = useState(undefined); // { left, owner, calls }
  const [err, setErr] = useState('');
  const [form, setForm] = useState(() => {
    let name = '';
    let gender = 'm', callback = '';
    try { name = localStorage.getItem(NAME_KEY) || ''; gender = localStorage.getItem(NAME_KEY + '.g') || 'm'; callback = localStorage.getItem(NAME_KEY + '.tel') || ''; } catch {}
    const L = langOfPhone(toE164(place.phone));
    return {
      cands: [{ date: todayLocal(), time: '19:00', timeTo: '20:00' }], // 候補（最大5つ）
      groups: [{ adults: 2, children: 0, childAges: '', near: true }], // テーブル（最大4つ）
      partial: 'all', // all＝全テーブルが取れる時間だけ予約する／any＝片方だけでも予約する
      name, gender, callback, flex: '', note: '', testPhone: '', testLang: L && !L.testOnly ? L.lang : 'ko-KR',
    };
  });
  const [sending, setSending] = useState(false);
  const [call, setCall] = useState(null);
  const poll = useRef(null);

  const load = () => callApi('/api/call').then(setMe).catch((e) => { setMe(null); setErr(e.message); });
  useEffect(() => {
    if (!user) { setMe(null); return; }
    load();
    return () => clearTimeout(poll.current);
  }, [user]);

  const watch = (id) => {
    clearTimeout(poll.current);
    const tick = async () => {
      try {
        const c = await callApi('/api/call?id=' + id);
        setCall(c);
        if (FINAL.has(c.status) && (c.status !== 'done' || c.result)) { load(); return; }
      } catch {}
      poll.current = setTimeout(tick, 3000);
    };
    tick();
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setCand = (i, k, v) => setForm((f) => ({ ...f, cands: f.cands.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  // 候補を足す：日にちは前の候補から引き継ぐ（同じ日の時間違いが多いため）
  const addCand = () => setForm((f) => (f.cands.length >= MAX_CANDS ? f : { ...f, cands: [...f.cands, { ...f.cands[f.cands.length - 1] }] }));
  const delCand = (i) => setForm((f) => ({ ...f, cands: f.cands.filter((_, j) => j !== i) }));
  const setGroup = (i, k, v) => setForm((f) => ({ ...f, groups: f.groups.map((g, j) => (j === i ? { ...g, [k]: v } : g)) }));
  const addGroup = () => setForm((f) => (f.groups.length >= MAX_GROUPS ? f : { ...f, groups: [...f.groups, { adults: 2, children: 0, childAges: '', near: true }] }));
  const delGroup = (i) => setForm((f) => ({ ...f, groups: f.groups.filter((_, j) => j !== i) }));
  const sizes = form.groups.map((g) => g.adults + g.children);
  const total = sizes.reduce((a, b) => a + b, 0);
  const start = async () => {
    setErr('');
    if (sizes.some((n) => n < 1)) { setErr('テーブルの人数が0名になっています。大人か子どもを1名以上にしてください'); return; }
    if (total > CALL_MAX_PEOPLE) { setErr(`全部で${CALL_MAX_PEOPLE}名までです（いま${total}名）`); return; }
    if (form.cands.some((c) => !c.date || !c.time)) { setErr('候補の日にちと時間を入れてください（使わない候補は「消す」を押してください）'); return; }
    if (!form.name.trim()) { setErr('予約の名前を入れてください（ローマ字かカタカナ）'); return; }
    if (form.callback.replace(/[^0-9]/g, '').length < 9) { setErr('連絡先の電話番号を入れてください（お店に聞かれることが多いため）'); return; }
    setSending(true);
    try {
      try { localStorage.setItem(NAME_KEY, form.name.trim()); localStorage.setItem(NAME_KEY + '.g', form.gender); localStorage.setItem(NAME_KEY + '.tel', form.callback.trim()); } catch {}
      const request = {
        candidates: form.cands.map((c) => ({ date: c.date, time: c.time, timeTo: c.timeTo > c.time ? c.timeTo : '' })),
        groups: form.groups.map((g) => ({ adults: g.adults, children: g.children, childAges: g.children ? g.childAges.trim() : '', near: g.near })),
        partial: form.partial,
        name: form.name.trim(), gender: form.gender, callback: form.callback.trim(), flex: form.flex.trim(), note: form.note.trim(),
      };
      const body = { placeId: place.placeId, placeName: place.altName || place.name, request };
      if (me?.owner && form.testPhone.trim()) { body.testPhone = form.testPhone.trim(); body.testLang = form.testLang; }
      const d = await callApi('/api/call', { method: 'POST', body: JSON.stringify(body) });
      setCall({ id: d.id, status: 'calling' });
      watch(d.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSending(false);
    }
  };

  const busy = call && !(FINAL.has(call.status) && (call.status !== 'done' || call.result));
  const past = (me?.calls || []).filter((c) => c.place_id === place.placeId && c.id !== call?.id).slice(0, 5);

  return (
    <div className="prem-back" role="dialog" aria-modal="true" aria-label="タビビコール" onClick={onClose}>
      <section className="prem call" onClick={(e) => e.stopPropagation()}>
        <header className="prem-head">
          <h2>タビビコール</h2>
          <button type="button" className="x" onClick={onClose} aria-label="閉じる">×</button>
        </header>
        <p className="call-shop"><b>{place.name}</b>{place.altName && place.altName !== place.name ? <span>{place.altName}</span> : null}</p>
        <p className="prem-now">AIが{localLang(place.phone)}で予約の電話をかけて、結果を日本語でお知らせします。45ポイントで{CALL_BLOCK_SEC / 60}分。{CALL_BLOCK_SEC / 60}分を超えると、{CALL_BLOCK_SEC / 60}分ごとに45ポイントずつ使い、ポイントが足りなくなると電話は切れます。お店が出なかったときや話し中のときは、ポイントを戻します。</p>

        {!user ? (
          <p className="prem-now">使うには <button type="button" className="linkbtn" onClick={onSignIn}>Googleでログイン</button> してください。</p>
        ) : call ? (
          <>
            <Result c={call} />
            {!busy && <button type="button" className="btn ghost" onClick={() => { setCall(null); }}>もう一度かける</button>}
          </>
        ) : (
          <>
            <p className="prem-now">ポイント：<b>{me === undefined ? '確認中…' : me ? (me.owner ? '運営者（制限なし）' : `${me.points ?? me.left * 45}pt（1回45pt）`) : 'わかりませんでした'}</b></p>
            {me && !me.owner && me.left < 1 ? (
              <p className="hint">ポイントが足りません（1回45pt）。<button type="button" className="btn pt-buy" onClick={() => window.dispatchEvent(new CustomEvent('tabibi:needpoints'))}>ポイントを買う</button></p>
            ) : (
              <div className="call-form">
                {form.groups.map((g, i) => (
                  <fieldset key={'g' + i} className="wide call-cand call-group">
                    <legend>テーブル{i + 1}（{g.adults + g.children}名）</legend>
                    <label>大人
                      <select value={g.adults} onChange={(e) => setGroup(i, 'adults', Number(e.target.value))}>
                        {Array.from({ length: 13 }, (_, n) => n).map((n) => <option key={n} value={n}>{n}名</option>)}
                      </select>
                    </label>
                    <label>子ども
                      <select value={g.children} onChange={(e) => setGroup(i, 'children', Number(e.target.value))}>
                        {Array.from({ length: 9 }, (_, n) => n).map((n) => <option key={n} value={n}>{n}名</option>)}
                      </select>
                    </label>
                    {g.children > 0 && (
                      <label className="wide">子どもの年齢（学年）
                        <input value={g.childAges} maxLength={40} placeholder="例：小1、4歳" onChange={(e) => setGroup(i, 'childAges', e.target.value)} />
                      </label>
                    )}
                    {form.groups.length > 1 && (
                      <label className="wide">席
                        <select value={g.near ? 'near' : 'apart'} onChange={(e) => setGroup(i, 'near', e.target.value === 'near')}>
                          <option value="near">近くの席が望ましい</option>
                          <option value="apart">離れてもよい</option>
                        </select>
                      </label>
                    )}
                    {form.groups.length > 1 && <button type="button" className="linkbtn call-del wide" onClick={() => delGroup(i)}>テーブル{i + 1}を消す</button>}
                  </fieldset>
                ))}
                {form.groups.length < MAX_GROUPS && <button type="button" className="btn ghost wide" onClick={addGroup}>＋テーブルを足す</button>}
                <p className="call-total wide" aria-live="polite">合計：<b>{sizes.length > 1 ? `${sizes.map((n) => n + '名').join('＋')}＝${total}名` : `${total}名`}</b></p>
                {form.groups.length > 1 && (
                  <label className="wide">片方しか取れないとき
                    <select value={form.partial} onChange={set('partial')}>
                      <option value="all">全テーブルが取れる時間だけ予約する（おすすめ）</option>
                      <option value="any">片方だけでも予約する（取れなかったテーブルは次の候補で聞く）</option>
                    </select>
                  </label>
                )}
                {form.cands.map((c, i) => (
                  <fieldset key={'c' + i} className="wide call-cand">
                    <legend>第{i + 1}候補{i > 0 ? '（任意）' : ''}</legend>
                    <label className="wide">日にち<input type="date" value={c.date} min={todayLocal()} onChange={(e) => setCand(i, 'date', e.target.value)} /></label>
                    <label>何時から<input type="time" value={c.time} step="900" onChange={(e) => setCand(i, 'time', e.target.value)} /></label>
                    <label>何時まで<input type="time" value={c.timeTo} step="900" onChange={(e) => setCand(i, 'timeTo', e.target.value)} /></label>
                    {i > 0 && <button type="button" className="linkbtn call-del" onClick={() => delCand(i)}>消す</button>}
                  </fieldset>
                ))}
                {form.cands.length < MAX_CANDS && <button type="button" className="btn ghost wide" onClick={addCand}>＋候補を足す</button>}
                <p className="hint wide">「何時から〜何時まで」の間で空いていれば予約します（ぴったりの時間だけなら「何時まで」を空けてください）。第1候補から順に、お店へ聞きます（最大{MAX_CANDS}つ）。人数はどの候補でも同じです。</p>
                <label className="wide">予約の名前（ローマ字かカタカナ）<input value={form.name} maxLength={40} placeholder="例：UENO" onChange={set('name')} /></label>
                <label>呼び方
                  <select value={form.gender} onChange={set('gender')}>
                    <option value="m">男性（〇〇先生など）</option>
                    <option value="f">女性（〇〇小姐など）</option>
                  </select>
                </label>
                <label className="wide">連絡先の電話番号（必須・お店に聞かれたら国番号つきで伝えます）<input value={form.callback} maxLength={30} inputMode="tel" placeholder="例：+81 90-1234-5678" onChange={set('callback')} /></label>
                <label className="wide">お店に伝えたいこと（任意）<input value={form.note} maxLength={120} placeholder="例：子ども1人います" onChange={set('note')} /></label>
                {me?.owner && (
                  <fieldset className="wide call-test">
                    <legend>運営者のテスト（入れると、このお店ではなくこの番号にかけます）</legend>
                    <label>テストの番号<input value={form.testPhone} inputMode="tel" placeholder="+8190..." onChange={set('testPhone')} /></label>
                    <label>話す言語
                      <select value={form.testLang} onChange={set('testLang')}>
                        {TEST_LANGS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                      </select>
                    </label>
                  </fieldset>
                )}
              </div>
            )}
            {err && <p className="err">{err}</p>}
            {me && (me.owner || me.left > 0) && (
              <button type="button" className="btn" disabled={sending} onClick={start}>{sending ? '電話をかけています…' : 'AIに電話してもらう'}</button>
            )}
          </>
        )}
        {call && err && <p className="err">{err}</p>}

        {past.length > 0 && (
          <div className="call-past">
            <p className="rv-label">このお店へのこれまでの電話</p>
            <ul>
              {past.map((c) => (
                <li key={c.id}>
                  <button type="button" className="linkbtn" onClick={() => { setCall({ id: c.id, status: c.status }); watch(c.id); }}>
                    {new Date(c.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}　{c.status === 'done' ? OUTCOME_JA[c.outcome] || STATUS_JA.done : STATUS_JA[c.status]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
