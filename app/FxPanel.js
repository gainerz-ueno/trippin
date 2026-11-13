'use client';
// 為替レート：①相場 ②現地の銀行の現金 ③カード を並べて見せ、両替の電卓を付ける
// ・相場だけが本物の数字（外部の取得元）。現金・カードは「相場＋上乗せ幅（％）」の目安で、幅は自分で変えられる（銀行・カード会社ごとに違うため）
import { useEffect, useState } from 'react';
import { CURRENCIES, currencyOf } from './lib/money';
import { DEFAULT_CASH_PCT, DEFAULT_CARD_PCT, rows, toYen, fromYen, parseAmount } from './lib/fx.mjs';

const num = (n, d = 2) => Number(n).toLocaleString('ja-JP', { maximumFractionDigits: d });
// 円の表示：1円未満の単位（ウォン・ドン）は小数を出す
const yenText = (y) => (y >= 100 ? num(y, 0) : y >= 1 ? num(y, 2) : num(y, 4));
const pctOf = (s, d) => { const n = Number(String(s).replace(/[,，\s]/g, '')); return Number.isFinite(n) && n >= 0 && n <= 30 ? n : d; };

export default function FxPanel({ country }) {
  const [cur, setCur] = useState(() => { const c = currencyOf(country); return c === 'JPY' ? 'TWD' : c; });
  const [data, setData] = useState(null); // { rates, updated }
  const [err, setErr] = useState('');
  const [cashS, setCashS] = useState(String(DEFAULT_CASH_PCT));
  const [cardS, setCardS] = useState(String(DEFAULT_CARD_PCT));
  const [dir, setDir] = useState('toYen'); // toYen：現地のお金→円 / toLocal：円→現地のお金
  const [amt, setAmt] = useState('');

  useEffect(() => {
    let live = true;
    fetch('/api/fx').then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!live) return;
      if (!r.ok || !j.rates) setErr(j.error || '為替の相場を取れませんでした'); else setData(j);
    }).catch(() => live && setErr('為替の相場を取れませんでした。通信を確かめてください'));
    return () => { live = false; };
  }, []);

  const meta = CURRENCIES.find(([k]) => k === cur) || [cur, cur, cur];
  const cashPct = pctOf(cashS, DEFAULT_CASH_PCT);
  const cardPct = pctOf(cardS, DEFAULT_CARD_PCT);
  const list = data ? rows(data.rates, cur, cashPct, cardPct) : [];
  const a = parseAmount(amt);
  const pctFor = { market: 0, cash: cashPct, card: cardPct };
  const updated = data?.updated ? new Date(data.updated) : null;
  const updatedText = updated && !Number.isNaN(updated.getTime()) ? `${updated.getMonth() + 1}月${updated.getDate()}日` : '';

  return (
    <section className="fx panel" id="fx">
      <div className="sv-head"><h2>為替レート</h2></div>
      <label>旅先のお金
        <select id="fxcur" value={cur} onChange={(e) => setCur(e.target.value)}>
          {CURRENCIES.filter(([k]) => k !== 'JPY').map(([k, sym, label]) => <option key={k} value={k}>{label}（{sym}）</option>)}
        </select>
      </label>
      {err && <p className="err">{err}</p>}
      {!data && !err && <p className="hint">相場を読み込み中…</p>}
      {data && !data.rates[cur] && <p className="hint">この通貨の相場は取得元にありませんでした。</p>}
      {data && data.rates[cur] && (
        <>
          <ul className="fx-rows">
            {list.map((r) => (
              <li key={r.key} className={'fx-row ' + r.key}>
                <span className="fx-l">{r.label}{r.key !== 'market' && <small>相場＋{pctFor[r.key]}%</small>}</span>
                <b className="fx-v">1{meta[1]} ＝ {yenText(r.yen)}円</b>
              </li>
            ))}
          </ul>
          <div className="fx-pct">
            <label>現金の上乗せ（％）<input id="fxcash" inputMode="decimal" value={cashS} onChange={(e) => setCashS(e.target.value)} /></label>
            <label>カードの上乗せ（％）<input id="fxcard" inputMode="decimal" value={cardS} onChange={(e) => setCardS(e.target.value)} /></label>
          </div>
          <p className="hint">相場は外部の取得元の数字（1日1回の更新{updatedText ? `・${updatedText}分` : ''}）です。現金・カードは目安で、実際のレートは銀行・両替所・カード会社で変わります。上乗せの％は、お手持ちの明細や両替所の掲示に合わせて直せます。</p>

          <div className="fx-calc">
            <h3>両替の電卓</h3>
            <div className="chips">
              <button type="button" aria-pressed={dir === 'toYen'} onClick={() => setDir('toYen')}>{meta[1]} → 円</button>
              <button type="button" aria-pressed={dir === 'toLocal'} onClick={() => setDir('toLocal')}>円 → {meta[1]}</button>
            </div>
            <label>{dir === 'toYen' ? `金額（${meta[2]}）` : '金額（円）'}
              <input id="fxamt" inputMode="decimal" value={amt} placeholder={dir === 'toYen' ? '例：450' : '例：10000'} onChange={(e) => setAmt(e.target.value)} />
            </label>
            {a !== '' && (
              <ul className="fx-rows">
                {list.map((r) => {
                  const v = dir === 'toYen' ? toYen(a, data.rates, cur, r.pct) : fromYen(a, data.rates, cur, r.pct);
                  return (
                    <li key={r.key} className={'fx-row ' + r.key}>
                      <span className="fx-l">{r.label}</span>
                      <b className="fx-v">{v == null ? '—' : dir === 'toYen' ? `約${num(v, 0)}円` : `約${num(v, a >= 1000 ? 0 : 2)}${meta[1]}`}</b>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
      <p className="fx-credit"><a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">Rates By Exchange Rate API</a></p>
    </section>
  );
}
