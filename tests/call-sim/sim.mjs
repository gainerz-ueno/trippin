import { CallSession } from './call.mjs';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 時間を速く回す（実時間の 1/SPEED）
const SPEED = 8;
const _st = globalThis.setTimeout, _now = Date.now.bind(Date); let t0 = _now();
Date.now = () => t0 + (_now() - t0) * SPEED;
globalThis.setTimeout = (f, ms, ...a) => _st(f, (ms || 0) / SPEED, ...a);
const wait = (ms) => new Promise(r => _st(r, ms / SPEED));

export async function run(name, shop, { lang = 'ja-JP', limit = 120000 } = {}) {
  const lines = []; const gaps = []; let lastEnd = 0; let buf = ''; let ended = false; let aiIdx = 0;
  const s = new CallSession({}, { waitUntil: (p) => p }, { send: (raw) => {
    const o = JSON.parse(raw);
    if (o.type === 'end') { ended = true; return; }
    if (o.type !== 'text') return;
    buf += o.token || '';
    if (o.last) { const line = buf; buf = ''; if (!line.trim()) return; speakAi(line); }
  } }, { c: 'x', k: 'y' }, { lang, place_name: 't', request: { date: '2026-11-22', time: '19:00', people: 2, name: 'Ueno' }, is_test: true });
  s.log = () => {};
  const m = (o) => s.onMessage(JSON.stringify(o));
  async function speakAi(line) {
    const idx = aiIdx++; lines.push(['AI', line]); const st = Date.now(); if (lastEnd) gaps.push(st - lastEnd);
    m({ type: 'info', name: 'agentSpeaking', value: 'on' });
    const dur = line.length * 130;
    const acts = shop(line, idx) || [];
    for (const a of acts.filter(a => a.during != null)) doShop(a, a.during);
    await wait(dur);
    lastEnd = Date.now();
    m({ type: 'info', name: 'agentSpeaking', value: 'off' });
    for (const a of acts.filter(a => a.during == null)) doShop(a, a.after ?? 800);
  }
  async function doShop(a, delay) {
    await wait(delay);
    if (ended) return;
    const dur = a.dur ?? Math.max(600, (a.say || '').length * 150);
    if (a.mode === 'silent') return;
    m({ type: 'info', name: 'clientSpeaking', value: 'on' });
    if (a.mode === 'stuck') { if (a.partial) { await wait(a.partialAt ?? 3000); m({ type: 'prompt', voicePrompt: a.partial, last: false }); } return; } // テレビで「話している」が終わらない
    await wait(dur);
    m({ type: 'info', name: 'clientSpeaking', value: 'off' });
    lines.push(['店', a.mode === 'untranscribed' ? `(${a.say}・文字にならず)` : a.say]);
    if (a.mode !== 'untranscribed') { await wait(a.late ?? 300); m({ type: 'prompt', voicePrompt: a.say, last: true }); }
  }
  m({ type: 'setup', callSid: 'CA1' });
  const start = Date.now();
  while (!ended && Date.now() - start < limit) await wait(500);
  s.timers.forEach(clearTimeout); s.clearWait();
  return { name, ended, maxGap: Math.round(Math.max(0, ...gaps) / 100) / 10, secs: Math.round((Date.now() - start) / 1000), lines, transcript: s.transcript };
}
