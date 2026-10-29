'use client';
// タビビコール：保存したお店に、AIが現地語で予約の電話をかける画面
// ・日にち・時間・人数・名前を入れる → AIが電話（最大3分）→ 結果を日本語で見せる
// ・回数券（1回300円）を1つ使う。お店が出なかった・話し中だったときは回数を戻す
import { useEffect, useRef, useState } from 'react';
import { accessToken } from './note/util';
import { CALL_PRICE, CALL_MAX_SEC, CALL_LANGS } from './lib/call';

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
  return (
    <div className={'call-res ' + (c.outcome || '')}>
      <p className="call-st">{final && c.status === 'done' ? OUTCOME_JA[c.outcome] || STATUS_JA.done : STATUS_JA[c.status] || STATUS_JA.calling}</p>
      {!final && <p className="hint">そのまま待ってください（最大{CALL_MAX_SEC / 60}分）。画面を閉じても電話は続き、結果はあとでここに残ります。</p>}
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
    try { name = localStorage.getItem(NAME_KEY) || ''; } catch {}
    return { date: todayLocal(), time: '19:00', people: 2, name, flex: '', note: '', testPhone: '', testLang: 'ko-KR' };
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
  const start = async () => {
    setErr('');
    if (!form.name.trim()) { setErr('予約の名前を入れてください（ローマ字かカタカナ）'); return; }
    setSending(true);
    try {
      try { localStorage.setItem(NAME_KEY, form.name.trim()); } catch {}
      const request = { date: form.date, time: form.time, people: Number(form.people), name: form.name.trim(), flex: form.flex.trim(), note: form.note.trim() };
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
        <p className="prem-now">AIがお店の言葉で予約の電話をかけて、結果を日本語でお知らせします。1回{CALL_PRICE}円（回数券）・最大{CALL_MAX_SEC / 60}分。お店が出なかったときや話し中のときは、回数を戻します。</p>

        {!user ? (
          <p className="prem-now">使うには <button type="button" className="linkbtn" onClick={onSignIn}>Googleでログイン</button> してください。</p>
        ) : call ? (
          <>
            <Result c={call} />
            {!busy && <button type="button" className="btn ghost" onClick={() => { setCall(null); }}>もう一度かける</button>}
          </>
        ) : (
          <>
            <p className="prem-now">回数券：<b>{me === undefined ? '確認中…' : me ? (me.owner ? '運営者（制限なし）' : `あと${me.left}回`) : 'わかりませんでした'}</b></p>
            {me && !me.owner && me.left < 1 ? (
              <p className="hint">回数券が残っていません。回数券の購入はただいま準備中です。</p>
            ) : (
              <div className="call-form">
                <label>日にち<input type="date" value={form.date} min={todayLocal()} onChange={set('date')} /></label>
                <label>時間<input type="time" value={form.time} step="900" onChange={set('time')} /></label>
                <label>人数
                  <select value={form.people} onChange={set('people')}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}人</option>)}
                  </select>
                </label>
                <label className="wide">予約の名前（ローマ字かカタカナ）<input value={form.name} maxLength={40} placeholder="例：UENO" onChange={set('name')} /></label>
                <label className="wide">時間がずれてもいい範囲（任意）<input value={form.flex} maxLength={60} placeholder="例：18時〜20時ならOK" onChange={set('flex')} /></label>
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
