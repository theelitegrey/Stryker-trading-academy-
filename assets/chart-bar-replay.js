// TradeZoro — Charts BAR REPLAY (ES module)
//
// Owner order 2026-10-12: "Add a full bar replay feature like tradingview", inside Charts (not the
// separate replay.html). Our look; phone first; no server.
//
// HOW IT WORKS
// - Every data provider is wrapped once more (wrapFactory below, outermost). While replay is OFF
//   the wrapper is a pass-through. While it is ON, getBars() only ever answers with bars revealed
//   at the replay clock E (assets/bar-replay-core.js reveal(): complete bars + a forming last bar
//   rebuilt from complete "update interval" bars), and subscribe() is a silent replay feed instead
//   of the live socket. So everything Vela computes from the bars (native indicators, Pine scripts
//   incl. TradeZoro + community scripts, request.security, drawings' anchors) only ever sees the
//   past: no lookahead. Timeframe / symbol switches reload through the same wrapper, so they keep
//   the replay time.
// - Entering, stepping back and exiting clear Vela's shared bar cache (sharedBarStore) and reload
//   every cell, so live bars never leak into replay and replay bars never leak into the live chart.
// - Stepping forward pushes the newly revealed bars through each cell's normal live path (onBar),
//   which re-runs indicators on the revealed bars only.
// - Paper trading (assets/chart-paper.js setReplay / replayFeed) switches to a separate Replay
//   account and fills only on revealed bars of the update interval.
// - Live-clock add-ons read window.__stkReplay (countdown, data dot, market pill, GEX, order flow).
//
// Education only. Not financial advice.

const Core = window.BarReplayCore;
const LS_KEY = 'stryker_bar_replay_v1';
const SPEEDS = [10, 3, 1, 0.5, 0.3, 0.1];          // steps (bars of the update interval) per second
// INTRA-BAR REPLAY (Owner 2026-10-14: "if we are getting tick data, why are the candles not moving
// fast? In live chart and in replay?"): real-time speeds. The clock runs continuously at RT x real
// time and the forming candle is drawn from a price path inside the current update-interval bar, so
// a candle forms the way it traded instead of appearing whole. The path is the 1-second record of
// the real trades when the server has it (TICKS1S_URL, fed by the order-flow tick feeder), otherwise
// a simulated path through the bar's own open/high/low/close (open -> low -> high -> close for an up
// bar, open -> high -> low -> close for a down bar), labelled "(simulated path)". No lookahead: the
// chart, indicators and paper fills only ever see the part of the path before the clock.
const RT_SPEEDS = [1, 2, 5, 10, 30, 60];
const RT_FRAME_MS = 66;                               // ~15 visible updates per second while playing
// GET ?sym=NQ&from=<sec>&to=<sec> -> {tick, m:[[minuteEpochSec, [[sec,o,h,l,c,vol],...]],...]}, real prices,
// only seconds that traded. Book-recorder Worker, fed by the order-flow tick feeder (one tick pull for
// both). NQ ES YM GC SI CL (+ micros mapped to the mini); about the last 6 days and growing.
import { rtHeadersReady } from './rt-access.js?v=640';
const TICKS1S_URL = 'https://book-recorder.theelitegrey.workers.dev/ticks1s';
const TICK_ROOTS = { NQ: 'NQ', ES: 'ES', YM: 'YM', GC: 'GC', SI: 'SI', CL: 'CL', MNQ: 'NQ', MES: 'ES', MYM: 'YM', MGC: 'GC', SIL: 'SI', MCL: 'CL' };
const HOUR = 3600e3;
const STEP_TFS = ['1', '5', '15', '30', '60', '240', 'D'];
const AHEAD_BARS = 400;                               // fetched ahead of the clock per series
const MAX_BUF = 6000;                                 // bars kept per buffered series (memory cap)
const MAX_UNDO = 200;

// ------------------------------------------------------------------ state
const S = {
  on: false, E: 0, speed: 1, stepTf: '', playing: false, busy: false, undo: [],
  sel: false, timer: null, rt: 0,   // rt > 0: real-time intra-bar replay at rt x; 0: whole steps
  fallTf: '',          // the interval replay actually steps by when stepTf has no data at the clock
  noted: ''            // "<symbol>|<stepTf>|<fallTf>" the member was already told about
};
// The interval replay steps by: the member's choice, or the fallback when that has no data here.
const effTf = () => S.fallTf || S.stepTf;
const inners = new Map();     // provider name -> the provider below this wrapper
const subs = new Set();       // { name, ticker, tf, onBar } replay feeds of the live cells
const bufs = new Map();       // name|ticker|tf -> { bars, to, end }
window.__stkReplay = {
  get on(){ return S.on; }, now(){ return S.on ? S.E : Date.now(); },
  get E(){ return S.E; }, get playing(){ return S.playing; }, get speed(){ return S.speed; }, get stepTf(){ return effTf(); }, get rt(){ return S.rt; }
};

// ------------------------------------------------------------------ admin: hide replay markings
// Owner order 2026-10-16. Setting lives in chart-settings.js (admin only). Active = replay on AND
// admin AND the flag is set. Shown as html[data-stk-rh] (CSS in assets/style.css hides the markings).
const RH_KEY = 'stryker_replay_hide';
function rhFlag() { try { return localStorage.getItem(RH_KEY) === '1'; } catch (e) { return false; } }
function rhActive() { return !!(S.on && window.__stkIsAdmin === true && rhFlag()); }
function rhApply() {
  const on = rhActive();
  document.documentElement.toggleAttribute('data-stk-rh', on);
  if (on) rhDot();
  rhClock(on);
  const d = document.getElementById('stkr-rhdot'); if (d) d.hidden = !on;
  try { window.dispatchEvent(new Event('resize')); } catch (e) {}
}
function rhSet(v) {
  if (window.__stkSettings && window.__stkSettings.setReplayHide) window.__stkSettings.setReplayHide(v);
  else { try { localStorage.setItem(RH_KEY, v ? '1' : '0'); } catch (e) {} }
  rhApply();
}
// The chart's bottom-bar clock (Vela, .vela-bb-clock) shows the wall clock. While markings are hidden it follows the replay clock
// instead (same zone, read from the UTC+h label beside it), so a recording shows one consistent time. Owner order 2026-10-18.
let rhClockObs = null;
function rhClockText() {
  const c = document.querySelector('.vela-bb-clock'); if (!c) return null;
  const z = c.parentElement && /UTC([+-])(\d+)(?::(\d+))?/.exec(c.parentElement.textContent || '');
  const off = z ? (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + (+z[3] || 0)) : 0;
  const d = new Date(S.E + off * 60000), p2 = (n) => String(n).padStart(2, '0');
  return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds());
}
function rhClock(on) {
  const c = document.querySelector('.vela-bb-clock');
  if (rhClockObs) { rhClockObs.disconnect(); rhClockObs = null; }
  if (!on || !c) return;
  let busy = false;
  const fix = () => { if (busy) return; busy = true; const t = rhClockText(); if (t && c.textContent !== t) c.textContent = t; busy = false; };
  rhClockObs = new MutationObserver(fix);
  rhClockObs.observe(c, { childList: true, characterData: true, subtree: true });
  fix();
}
function rhDot() {
  if (document.getElementById('stkr-rhdot')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'stkr-rhdot'; b.setAttribute('aria-label', 'Show replay markings'); b.title = 'Show replay markings (Shift+H)';
  b.addEventListener('click', (e) => { e.stopPropagation(); rhSet(false); });
  document.body.appendChild(b);
}

// ------------------------------------------------------------------ provider wrapper
export function wrapProvider(inner, name) {
  inners.set(name, inner);
  const getBars = async (ticker, tf, range = {}) => {
    if (!S.on) return inner.getBars(ticker, tf, range);
    return revealed(name, ticker, tf, range);
  };
  const subscribe = (ticker, tf, onBar, opts) => {
    if (!S.on) return inner.subscribe ? inner.subscribe(ticker, tf, onBar, opts) : () => {};
    const sub = { name, ticker, tf, onBar };
    subs.add(sub);
    return () => subs.delete(sub);
  };
  const progressive = inner.getBarsProgressive ? (ticker, tf, range, onBatch, opts) => {
    if (!S.on) return inner.getBarsProgressive(ticker, tf, range, onBatch, opts);
    return revealed(name, ticker, tf, range);
  } : undefined;
  return new Proxy(inner, {
    get(t, prop) {
      if (prop === 'getBars') return getBars;
      if (prop === 'subscribe') return subscribe;
      if (prop === 'getBarsProgressive') return progressive;
      const v = t[prop];
      return typeof v === 'function' ? v.bind(t) : v;
    }
  });
}
export const wrapFactory = (factory, name) => () => wrapProvider(factory(), name);

const bkey = (name, ticker, tf) => name + '|' + ticker + '|' + tf;
function stepFor(name, ticker, tf) {
  // the update interval applies to every series of the active symbol that is coarser than it
  const a = S.active;
  const step = effTf();
  if (!a || a.name !== name || a.ticker !== ticker || !step) return null;
  const ms = Core.tfMs(tf), sMs = Core.tfMs(step);
  if (!ms || !sMs || sMs >= ms) return null;
  const b = bufs.get(bkey(name, ticker, step));
  return b ? { bars: b.bars, ms: sMs } : null;
}

// The bars a getBars(range) may see at clock E.
async function revealed(name, ticker, tf, range) {
  const ms = Core.tfMs(tf);
  if (!ms) return [];                               // seconds / tick bars: not in replay
  const E = S.E, inner = inners.get(name);
  const to = Math.min(range.to != null ? range.to : Infinity, E - 1);
  if (range.from != null && range.from > to) return [];
  let bars = [];
  try {
    bars = await inner.getBars(ticker, tf, { from: range.from, to, limit: range.limit != null ? range.limit + 2 : (range.from != null ? undefined : 600) }) || [];
  } catch (e) { bars = []; }
  const b = bufs.get(bkey(name, ticker, tf));
  if (b) bars = Core.merge(bars, b.bars.filter((x) => x.time < E && (range.from == null || x.time >= range.from)));
  const st = stepFor(name, ticker, tf);
  if (st) {
    // the forming bar must be rebuilt from step bars: make sure they cover it
    let lastT = null;
    for (let i = bars.length - 1; i >= 0; i--) if (bars[i].time < E) { lastT = bars[i].time; break; }
    await ensure(name, ticker, effTf(), E, lastT);
    const st2 = stepFor(name, ticker, tf);
    return Core.reveal(bars, ms, st2.bars, st2.ms, E, { from: range.from, to: range.to, limit: range.limit });
  }
  return Core.reveal(bars, ms, null, 0, E, { from: range.from, to: range.to, limit: range.limit });
}

// Make sure the buffer of a series covers [.., target] and holds some bars beyond it.
// needFrom: also cover back to this time (the start of a forming chart bar built from steps).
async function ensure(name, ticker, tf, target, needFrom) {
  const k = bkey(name, ticker, tf), ms = Core.tfMs(tf), inner = inners.get(name);
  if (!ms || !inner) return null;
  let b = bufs.get(k);
  const want0 = Math.min(target - ms * 3, needFrom != null ? needFrom - 1 : Infinity);
  if (!b) { b = { bars: [], from: want0 + 1, to: want0, end: false }; bufs.set(k, b); }
  if (want0 + 1 < b.from) {
    let got = [];
    try { got = await inner.getBars(ticker, tf, { from: want0 + 1, to: b.from - 1 }) || []; } catch (e) { got = []; }
    b.bars = Core.merge(b.bars, got.filter((x) => x.time >= want0 + 1 && x.time < b.from));
    b.from = want0 + 1;
  }
  let guard = 12;
  while (!b.end && guard-- > 0 && (b.to < target || Core.aheadCount(b.bars, target) < 3)) {
    const from = b.to + 1;
    const to = Math.min(from + ms * AHEAD_BARS, Date.now());
    let got = [];
    try { got = await inner.getBars(ticker, tf, { from, to }) || []; } catch (e) { got = []; }
    b.bars = Core.merge(b.bars, got.filter((x) => x.time >= from && x.time <= to));
    b.to = to;
    if (to >= Date.now() - 1000) b.end = true;
  }
  // memory cap: keep the newest MAX_BUF, but never drop what sits right around the clock
  if (b.bars.length > MAX_BUF) {
    const i = Core.firstAtOrAfter(b.bars, S.E);
    const cut = Math.max(0, Math.min(b.bars.length - MAX_BUF, i - 1500));
    if (cut > 0) { b.bars = b.bars.slice(cut); b.from = b.bars[0].time; }
  }
  return b;
}

// ------------------------------------------------------------------ data depth
// History depth differs per interval (futures: 1m ~29 days, 5m-30m ~59 days, 1h ~2 years, see
// functions/api/chart/_bars.js). A step series "covers" the clock when its first bar that is not
// complete at E starts inside the next chart bar that is not complete yet. Otherwise stepping by it
// would skip real chart bars (or find nothing and look like the end of the data).
async function nextChartBar(a, E) {
  const ms = Core.tfMs(a.tf);
  const cb = await ensure(a.name, a.ticker, a.tf, E);
  if (!cb || !ms) return null;
  const bars = cb.bars;
  let i = Core.firstAtOrAfter(bars, E) - 1;
  if (i < 0 || Core.endAt(bars, i, ms) <= E) i++;
  if (i >= bars.length) return { none: true, end: cb.end };
  return { time: bars[i].time, end: Core.endAt(bars, i, ms), edge: cb.end && i === bars.length - 1 };
}
// { ok, E1 } for stepping by tf at clock E. nb = nextChartBar().
async function coverage(a, tf, E, nb) {
  const sMs = Core.tfMs(tf);
  const sb = await ensure(a.name, a.ticker, tf, E, nb && !nb.none ? nb.time : undefined);
  if (!sb || !sMs) return { ok: false, E1: null };
  const E1 = Core.nextE(sb.bars, sMs, E);
  if (E1 == null) return { ok: false, E1: null, end: sb.end };
  if (tf === a.tf || !nb || nb.none) return { ok: true, E1 };
  const k = Core.firstAtOrAfter(sb.bars, E1) - 1;            // the step bar that ends at E1
  const st = k >= 0 ? sb.bars[k].time : E1 - sMs;
  return { ok: st < nb.end, E1 };
}
// Candidates finest-first: the member's interval, then every finer-than-chart interval, the chart last.
function stepCandidates(a) {
  const ms = Core.tfMs(a.tf), pref = S.stepTf || a.tf, pMs = Core.tfMs(pref);
  const out = [pref];
  for (const t of STEP_TFS) {
    const m = Core.tfMs(t);
    if (m > pMs && m < ms && validStepTf(a.tf, t)) out.push(t);
  }
  if (!out.includes(String(a.tf))) out.push(String(a.tf));
  return out;
}
// Pick the interval to step by at clock E. Returns { tf, E1, nb } (E1 null = nothing ahead).
async function resolveStep(a, E) {
  const nb = await nextChartBar(a, E);
  let pick = null;
  for (const tf of stepCandidates(a)) {
    const c = await coverage(a, tf, E, nb);
    if (c.ok) { pick = { tf, E1: c.E1 }; break; }
  }
  const pref = S.stepTf || a.tf;
  const tf = pick ? pick.tf : effTf() || pref;
  const fall = tf !== pref ? tf : '';
  if (fall !== S.fallTf) {
    S.fallTf = fall;
    if (fall) {
      const key = a.ticker + '|' + pref + '|' + fall;
      if (S.noted !== key) {
        S.noted = key;
        toast(pref === '1'
          ? '1m data only goes back about a month here, so replay steps by ' + Core.tfLabel(fall) + '.'
          : Core.tfLabel(pref) + ' data does not go back this far here, so replay steps by ' + Core.tfLabel(fall) + '.');
      }
    }
  }
  return { tf, E1: pick ? pick.E1 : null, nb };
}

// ------------------------------------------------------------------ chart access
let WS = null, OPT = {};
const cellOf = (id) => { try { return WS.cell(id); } catch (e) { return null; } };
const cells = () => { try { return (WS.context().cells || []).map((c) => cellOf(c.id)).filter(Boolean); } catch (e) { return []; } };
const activeCell = () => { try { return cellOf(WS.active.id) || WS.active; } catch (e) { return null; } };
const R_of = (cell) => { try { return cell.chart.renderer.renderer; } catch (e) { return null; } };
const orch = (cell) => { try { return cell.chart.orchestrator; } catch (e) { return null; } };
const rawBars = (cell) => { const o = orch(cell); return (o && o.rawBars) || []; };
const isPhone = () => window.innerWidth <= 700;
function resolveCell(cell) {
  if (!cell) return null;
  const sym = String(cell.symbol || '');
  let r = null;
  try { r = cell.chart.data.resolve(sym); } catch (e) {}
  if (r && r.provider && r.ticker) return { name: r.provider, ticker: r.ticker, tf: cell.timeframe };
  const m = /^([a-z_]+):(.+)$/i.exec(sym);
  if (m && inners.has(m[1].toLowerCase())) return { name: m[1].toLowerCase(), ticker: m[2], tf: cell.timeframe };
  return null;
}
function clearCache() { try { OPT.store && OPT.store.clear(); } catch (e) {} }
// Reload every cell through the wrapper (same symbol/timeframe; drawings and indicators stay).
async function reloadAll() {
  clearCache();
  await Promise.all(cells().map(async (cell) => {
    const o = orch(cell); if (!o) return;
    try {
      await cell.chart.setMarket({ data: [] });       // forces a full reload of the same market
    } catch (e) { console.warn('TradeZoro replay: reload', e); }
    try { delete o.config.market.data; } catch (e) {}   // an empty `data` = not offline: drop the flag
  }));
}

// ------------------------------------------------------------------ the replay itself
function fmtET(ms) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)) + ' ET';
  } catch (e) { return new Date(ms).toISOString(); }
}
function save() {
  if (!S.on) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ E: S.E, speed: S.speed, rt: S.rt, stepTf: S.stepTf, undo: S.undo.slice(-50),
      sym: (activeCell() || {}).symbol, tf: (activeCell() || {}).timeframe }));
  } catch (e) {}
}
function defaultStepTf(tf) {
  const ms = Core.tfMs(tf);
  if (!ms) return '';
  if (ms <= 60000) return String(tf);
  return '1';
}
function validStepTf(tf, step) {
  const ms = Core.tfMs(tf), s = Core.tfMs(step);
  return !!(ms && s && s <= ms && (ms % s === 0 || ms >= Core.DAY));
}

async function start(E, how) {
  const cell = activeCell();
  const a = resolveCell(cell);
  if (!a) { toast('Bar replay needs a chart with a market symbol.', 'error'); return false; }
  if (!Core.tfMs(a.tf)) { toast('Bar replay works on minute, hour, day, week and month charts. Switch off seconds / tick bars first.', 'error'); return false; }
  stop();
  const wasOn = S.on;
  S.on = true; S.E = Math.floor(E); S.active = a;
  if (!validStepTf(a.tf, S.stepTf)) S.stepTf = defaultStepTf(a.tf);
  if (!wasOn) { S.undo = []; bufs.clear(); subs.clear(); }
  S.fallTf = '';
  if (!wasOn && OPT.Paper && OPT.Paper.setReplay) { try { OPT.Paper.setReplay({ now: () => S.E }); } catch (e) { console.warn('TradeZoro replay: paper', e); } }
  document.documentElement.classList.add('stk-replay');
  ui.show();
  ui.busy(true);
  try {
    await ensure(a.name, a.ticker, S.stepTf || a.tf, S.E);
    await resolveStep(a, S.E);
    await reloadAll();
  } finally { ui.busy(false); }
  if (!rawBars(activeCell()).length) {
    toast('No ' + Core.tfLabel(a.tf) + ' history this far back for this symbol. Pick a later date or a higher timeframe.', 'error');
  }
  seedPaper();
  save(); ui.render();
  return true;
}

async function exit() {
  stop();
  if (!S.on) return;
  S.on = false; S.undo = []; S.active = null; S.fallTf = '';
  bufs.clear(); subs.clear();
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
  if (OPT.Paper && OPT.Paper.setReplay) { try { OPT.Paper.setReplay(null); } catch (e) { console.warn('TradeZoro replay: paper', e); } }
  document.documentElement.classList.remove('stk-replay');
  ui.hide();
  await reloadAll();
}

function seriesFeeds() {
  // one entry per symbol: the finest buffered series we have for it
  const by = new Map();
  for (const s of subs) {
    const k = s.name + ':' + s.ticker, ms = Core.tfMs(s.tf);
    const cur = by.get(k);
    if (!cur || ms < cur.ms) by.set(k, { name: s.name, ticker: s.ticker, tf: s.tf, ms });
  }
  const step = effTf();
  if (S.active && step) {
    const k = S.active.name + ':' + S.active.ticker, ms = Core.tfMs(step), cur = by.get(k);
    if (!cur || ms < cur.ms) by.set(k, { name: S.active.name, ticker: S.active.ticker, tf: step, ms });
  }
  return by;
}
function seedPaper() {
  if (!OPT.Paper || !OPT.Paper.replayFeed) return;
  for (const cell of cells()) {
    const bars = rawBars(cell), b = bars[bars.length - 1];
    if (b) { try { OPT.Paper.replayFeed(cell.symbol, [{ t: b.time, o: b.close, h: b.close, l: b.close, c: b.close }], true); } catch (e) {} }
  }
}

async function stepForward(opts) {
  if (!S.on || S.busy) return false;
  const paperDone = !!(opts && opts.paperDone);   // the intra-bar loop already fed this step's path
  const a = S.active; if (!a) return false;
  S.busy = true;
  try {
    const r = await resolveStep(a, S.E);
    let E1 = r.E1;
    if (E1 == null) {
      stop(); ui.render();
      // only the real live edge is "the newest bar"; anything else is a gap in the data
      if (r.nb && (r.nb.none ? r.nb.end : r.nb.edge)) toast('Replay reached the newest bar. Jump to real-time to go back to the live chart.');
      else toast('No more ' + Core.tfLabel(a.tf) + ' data after this point for this symbol.', 'error');
      return false;
    }
    // hard guard: never move past the end of the next chart bar that is not revealed yet
    if (r.nb && !r.nb.none && E1 > r.nb.end) E1 = r.nb.end;
    await Promise.all([...subs].map((s) => ensure(s.name, s.ticker, s.tf, E1)));
    await Promise.all([...seriesFeeds().values()].map((f) => ensure(f.name, f.ticker, f.tf, E1)));
    const E0 = S.E;
    S.undo.push(E0); if (S.undo.length > MAX_UNDO) S.undo.shift();
    S.E = E1;
    for (const s of [...subs]) {
      const ms = Core.tfMs(s.tf); if (!ms) continue;
      const b = bufs.get(bkey(s.name, s.ticker, s.tf)); if (!b) continue;
      const st = stepFor(s.name, s.ticker, s.tf);
      const out = Core.reveal(b.bars, ms, st && st.bars, st && st.ms, E1, { from: E0 - ms * 2 });
      for (const bar of out) { try { s.onBar(bar); } catch (e) {} }
    }
    if (OPT.Paper && OPT.Paper.replayFeed) {
      for (const f of seriesFeeds().values()) {
        if (paperDone && a && f.name === a.name && f.ticker === a.ticker) continue;
        const b = bufs.get(bkey(f.name, f.ticker, f.tf)); if (!b) continue;
        const segs = Core.segments(b.bars, f.ms, E0, E1);
        if (segs.length) { try { OPT.Paper.replayFeed(f.name + ':' + f.ticker, segs, false); } catch (e) { console.warn('TradeZoro replay: paper feed', e); } }
      }
    }
    save(); ui.render();
    return true;
  } finally { S.busy = false; }
}

async function stepBack() {
  if (!S.on || S.busy || !S.undo.length) return false;
  stop();
  S.busy = true;
  try {
    S.E = S.undo.pop();
    ui.busy(true);
    await reloadAll();
    seedPaper();
    save(); ui.render();
  } finally { S.busy = false; ui.busy(false); }
  return true;
}

function play() {
  if (!S.on || S.playing) return;
  S.playing = true; ui.render();
  if (S.rt > 0) { playTicks(); return; }
  const loop = async () => {
    if (!S.playing) return;
    const t0 = performance.now();
    const ok = await stepForward();
    if (!S.playing) return;
    if (!ok && !S.busy) { stop(); ui.render(); return; }
    const wait = Math.max(0, 1000 / S.speed - (performance.now() - t0));
    S.timer = setTimeout(loop, wait);
  };
  loop();
}
function stop() { S.playing = false; if (S.timer) { clearTimeout(S.timer); S.timer = null; } path.flushPaper(); }

// ------------------------------------------------------------------ intra-bar (tick) replay
const path = (() => {
  const tickCache = new Map();   // bkey -> price increment guessed from the data
  const real = new Map();        // root|hourStartMs -> Map(sec -> [o,h,l,c,v]) | null (none) | Promise
  const decided = new Map();     // step bar key -> waypoints | null (simulated)
  const waited = new Map();
  let paperQ = [], paperSym = '', paperAt = 0, lastPx = null, lastHi = 0, lastLo = 0, lastKey = '';
  const decs = (x) => { const t = String(x); const i = t.indexOf('.'); return i < 0 ? 0 : Math.min(8, t.length - i - 1); };
  function tickOf(k, bars) {
    if (tickCache.has(k)) return tickCache.get(k);
    let d = 0;
    const n = Math.min(bars.length, 200);
    for (let i = bars.length - n; i < bars.length; i++) { const b = bars[i]; d = Math.max(d, decs(b.open), decs(b.high), decs(b.low), decs(b.close)); }
    const f = Math.pow(10, d), base = n ? Math.round(bars[bars.length - 1].close * f) : 0;
    const gcd = (a, b) => { while (b) { [a, b] = [b, a % b]; } return a; };
    let g = 0;
    for (let i = bars.length - n; i < bars.length && g !== 1; i++) {
      const b = bars[i];
      for (const v of [b.open, b.high, b.low, b.close]) g = gcd(g, Math.abs(Math.round(v * f) - base));
    }
    const t = g > 0 ? g / f : 1 / f;
    tickCache.set(k, t);
    return t;
  }
  const snap = (v, t) => (t > 0 ? Math.round(Math.round(v / t) * t * 1e8) / 1e8 : v);
  // waypoints [[offsetMs, price]] through one update-interval bar
  function synthetic(b, ms) {
    const up = b.close >= b.open;
    return [[0, b.open], [ms / 3, up ? b.low : b.high], [ms * 2 / 3, up ? b.high : b.low], [ms - 1, b.close]];
  }
  // One hour of 1-second bars per request, cached: root|hourStartMs -> Map(epochSec -> [o,h,l,c,v]),
  // null = no record, or a pending Promise.
  function hourOf(root, h) {
    const k = root + '|' + h;
    if (real.has(k)) return real.get(k);
    if (h > Date.now()) return null;
    const p = rtHeadersReady().then((hd) => fetch(TICKS1S_URL + '?sym=' + root + '&from=' + (h / 1000) + '&to=' + ((h + HOUR) / 1000 - 1), { headers: hd }))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const m = new Map();
        for (const [min, secs] of (j && j.m) || []) for (const x of secs || []) m.set(min + x[0], x.slice(1));
        real.set(k, m.size ? m : null);
      })
      .catch(() => real.set(k, null));
    real.set(k, p);
    while (real.size > 48) real.delete(real.keys().next().value);
    return p;
  }
  // Waypoints [[offsetMs, price, cumVolume]] through step bar b from the real 1-second bars, or null
  // (not loaded yet / no record). Each traded second moves open -> low/high -> close inside that
  // second; nothing from a later second is used before the clock reaches it.
  // undefined = no tick record possible here; Promise = still loading; null = none; array = waypoints
  function realPath(name, ticker, b, ms) {
    if (!TICKS1S_URL || ms > HOUR || name !== 'futures') return undefined;
    const root = TICK_ROOTS[String(ticker).replace(/[0-9]*!?$/, '').toUpperCase()];
    if (!root) return undefined;
    const h0 = Math.floor(b.time / HOUR) * HOUR, h1 = Math.floor((b.time + ms - 1) / HOUR) * HOUR;
    const hs = h0 === h1 ? [h0] : [h0, h1];
    const maps = hs.map((h) => hourOf(root, h));
    // read ahead: the next hour once the clock is in the last 15 min of this one
    if ((b.time % HOUR) >= HOUR - 15 * 60e3) hourOf(root, h1 + HOUR);
    const pend = maps.find((m) => m && m.then);
    if (pend) return pend;
    if (maps.some((m) => !m)) return null;
    const pts = [];
    let vol = 0;
    for (let t = b.time; t < b.time + ms; t += 1000) {
      const x = (maps.length > 1 && t >= h1 ? maps[1] : maps[0]).get(t / 1000);
      if (!x) continue;
      const [o, hi, lo, c, v] = x, t0 = t - b.time, up = c >= o;
      pts.push([t0, o, vol], [t0 + 250, up ? lo : hi, vol], [t0 + 500, up ? hi : lo, vol]);
      vol += v || 0;
      pts.push([t0 + 999, c, vol]);
    }
    if (!pts.length) return null;
    if (pts[0][0] > 0) pts.unshift([0, pts[0][1], 0]);
    return pts;
  }
  // the partial bar of step bar b at offset off (ms into the bar); interp: move between waypoints
  function partial(b, pts, off, interp, t) {
    let hi = -Infinity, lo = Infinity, px = pts[0][1], cv = null;
    for (let i = 0; i < pts.length; i++) {
      const [o, p, v] = pts[i];
      if (o > off) {
        if (interp && i > 0) { const [o0, p0] = pts[i - 1]; px = snap(p0 + (p - p0) * (off - o0) / Math.max(1, o - o0), t); }
        break;
      }
      px = p; if (v != null) cv = v;
      if (p > hi) hi = p; if (p < lo) lo = p;
    }
    if (px > hi) hi = px; if (px < lo) lo = px;
    const frac = Math.max(0, Math.min(1, off / Math.max(1, pts[pts.length - 1][0] + 1)));
    if (b.open > hi) hi = b.open; if (b.open < lo) lo = b.open;
    return { time: b.time, open: b.open, high: hi, low: lo, close: px, volume: cv != null ? cv : Math.round((b.volume || 0) * frac) };
  }
  return {
    // { bar, step, sim } for the update-interval bar the clock E sits in, or { gapTo } / null
    at(a, E) {
      const step = effTf(), ms = Core.tfMs(step);
      const k = bkey(a.name, a.ticker, step), buf = bufs.get(k);
      if (!buf || !ms) return null;
      const steps = buf.bars;
      const i = Core.firstAtOrAfter(steps, E + 1) - 1;
      if (i < 0 || Core.endAt(steps, i, ms) <= E) {
        const nx = steps[i + 1];
        return nx ? { gapTo: nx.time } : null;
      }
      const b = steps[i], end = Core.endAt(steps, i, ms), len = end - b.time;
      // one decision per step bar (real or simulated), so a candle never switches path halfway
      const dk = k + '|' + b.time;
      let rp = decided.get(dk);
      if (rp === undefined) {
        rp = realPath(a.name, a.ticker, b, len);
        if (rp && rp.then) {
          if (E <= b.time + 1000 && waited.get(dk) == null) { waited.set(dk, 1); return { pending: rp }; }
          rp = null;            // still loading after one wait: simulate this bar
        }
        decided.set(dk, rp || null);
        if (decided.size > 4000) decided.delete(decided.keys().next().value);
      }
      const pts = rp || synthetic(b, len);
      return { bar: partial(b, pts, E - b.time, !rp, tickOf(k, steps)), step: b, end, sim: !rp, ms };
    },
    // queue one paper segment (the move since the last update); sent to the paper engine <= 4/s
    paper(sym, p, key) {
      if (!OPT.Paper || !OPT.Paper.replayFeed) return;
      if (key !== lastKey) { lastPx = p.open; lastHi = p.open; lastLo = p.open; lastKey = key; }
      if (sym !== paperSym) { this.flushPaper(); paperSym = sym; }
      const o = lastPx == null ? p.open : lastPx;
      // a new bar high/low reached between two frames was traded in this segment
      const h = Math.max(o, p.close, p.high > lastHi ? p.high : -Infinity), l = Math.min(o, p.close, p.low < lastLo ? p.low : Infinity);
      paperQ.push({ t: p.time, o, h, l, c: p.close });
      lastPx = p.close; lastHi = Math.max(lastHi, p.high); lastLo = Math.min(lastLo, p.low);
      if (performance.now() - paperAt > 250) this.flushPaper();
    },
    flushPaper() {
      if (!paperQ.length) return;
      const q = paperQ; paperQ = []; paperAt = performance.now();
      try { OPT.Paper && OPT.Paper.replayFeed && OPT.Paper.replayFeed(paperSym, q, false); } catch (e) { console.warn('TradeZoro replay: paper feed', e); }
    },
    reset() { lastPx = null; lastKey = ''; paperQ = []; decided.clear(); waited.clear(); }
  };
})();

// Push the forming candle at clock E to every replay feed of the active symbol.
function pushPartial(a, E, P) {
  for (const s of [...subs]) {
    if (s.name !== a.name || s.ticker !== a.ticker) continue;
    const ms = Core.tfMs(s.tf); if (!ms || ms < P.ms) continue;
    let bar;
    if (ms === P.ms) bar = Object.assign({}, P.bar);
    else {
      const b = bufs.get(bkey(s.name, s.ticker, s.tf)); if (!b) continue;
      const i = Core.firstAtOrAfter(b.bars, E + 1) - 1;
      if (i < 0 || Core.endAt(b.bars, i, ms) <= E || P.bar.time < b.bars[i].time) continue;
      const st = stepFor(s.name, s.ticker, s.tf);
      const done = st ? Core.formingAt(b.bars, i, ms, st.bars, st.ms, E) : null;
      bar = done ? Object.assign({}, done) : { time: b.bars[i].time, open: P.bar.open, high: P.bar.high, low: P.bar.low, close: P.bar.close, volume: 0 };
      if (done) {
        if (P.bar.high > bar.high) bar.high = P.bar.high;
        if (P.bar.low < bar.low) bar.low = P.bar.low;
        bar.close = P.bar.close; bar.volume = (bar.volume || 0) + (P.bar.volume || 0);
      } else bar.volume = P.bar.volume;
    }
    try { s.onBar(bar); } catch (e) {}
  }
  path.paper(a.name + ':' + a.ticker, P.bar, P.step.time);
}

function playTicks() {
  let last = performance.now(), uiAt = 0;
  const frame = async () => {
    if (!S.playing || !S.on) return;
    const now = performance.now();
    const dt = Math.min(1000, now - last); last = now;
    const a = S.active;
    if (!a || S.busy) { S.timer = setTimeout(safe, RT_FRAME_MS); return; }
    let target = S.E + dt * S.rt, guard = 8;
    while (guard-- > 0 && S.playing) {
      const P = path.at(a, S.E);
      if (!P) {                                     // nothing buffered here: let the step logic fetch / end
        const ok = await stepForward();
        if (!ok) { if (!S.busy) { stop(); ui.render(); } return; }
        continue;
      }
      if (P.pending) {                              // tick record loading: hold the clock (<= 2.5 s)
        await Promise.race([P.pending, new Promise((r) => setTimeout(r, 2500))]);
        last = performance.now(); target = S.E;
        continue;
      }
      if (P.gapTo != null) {                        // market closed / no bar: jump to the next bar's open
        if (P.gapTo > S.E) { S.E = P.gapTo; target = Math.max(target, P.gapTo); }
        else break;
        continue;
      }
      if (target < P.end) {
        S.E = Math.floor(target);
        const Q = path.at(a, S.E);
        if (Q && Q.bar) pushPartial(a, S.E, Q);
        if (Q && Q.bar && Q.sim !== S.sim) { S.sim = Q.sim; ui.render(); }
        break;
      }
      // the step bar completes: reveal it through the normal step path (indicators, other symbols)
      const fin = path.at(a, P.end - 1);
      if (fin && fin.bar) path.paper(a.name + ':' + a.ticker, Object.assign({}, fin.bar, { close: P.step.close, high: P.step.high, low: P.step.low }), P.step.time);
      path.flushPaper();
      const ok = await stepForward({ paperDone: true });
      if (!ok) { if (!S.busy) { stop(); ui.render(); } return; }
    }
    if (now - uiAt > 500) { uiAt = now; ui.render(); save(); }
    if (S.playing) S.timer = setTimeout(safe, RT_FRAME_MS);
  };
  path.reset();
  const safe = () => frame().catch((e) => { console.warn('TradeZoro replay: tick play', e); if (S.playing) S.timer = setTimeout(safe, RT_FRAME_MS); });
  safe();
}
function toggle() { if (S.playing) { stop(); ui.render(); } else play(); }

// ------------------------------------------------------------------ start points
function fromBarIndex(cell, i) {
  const bars = rawBars(cell); const ms = Core.tfMs(cell.timeframe);
  if (!bars.length || !ms) return null;
  i = Math.max(0, Math.min(bars.length - 1, i));
  return Core.endAt(bars, i, ms);
}
async function startAtDate(ms) {
  if (!Number.isFinite(ms)) return;
  if (ms > Date.now()) { toast('Pick a date in the past.', 'error'); return; }
  const cell = activeCell(), a = resolveCell(cell); if (!a) return;
  // probe the data: is there anything at or before that time?
  let probe = [];
  try { probe = await inners.get(a.name).getBars(a.ticker, a.tf, { to: ms, limit: 5 }) || []; } catch (e) {}
  if (!probe.length || probe[probe.length - 1].time < ms - Core.tfMs(a.tf) * 400 && ms - probe[probe.length - 1].time > 7 * Core.DAY) {
    toast('No ' + Core.tfLabel(a.tf) + ' data that far back for this symbol. Try a later date or a higher timeframe (1m data goes back about a month on futures).', 'error');
    if (!probe.length) return;
  }
  const i = Core.firstAtOrAfter(probe, ms);
  const idx = Math.max(0, i - 1 >= 0 && probe[Math.min(i, probe.length - 1)].time > ms ? i - 1 : Math.min(i, probe.length - 1));
  const end = Core.endAt(probe, idx, Core.tfMs(a.tf));
  await start(end, 'date');
}
async function startFirst() {
  const cell = activeCell(); const bars = rawBars(cell);
  if (!bars.length) return;
  await start(fromBarIndex(cell, Math.min(bars.length - 1, 50)), 'first');
}
async function startRandom() {
  const cell = activeCell(); const bars = rawBars(cell);
  if (bars.length < 60) { await startFirst(); return; }
  const lo = 50, hi = bars.length - 20;
  await start(fromBarIndex(cell, lo + Math.floor(Math.random() * Math.max(1, hi - lo))), 'random');
}

// ------------------------------------------------------------------ scissor select
const sel = { el: null, line: null, shade: null, tip: null, cell: null, idx: -1 };
function selectMode(on) {
  if (on === S.sel) return;
  S.sel = on;
  const host = document.getElementById('vela-chart');
  if (!on) {
    if (sel.el) sel.el.remove();
    sel.el = null; document.removeEventListener('keydown', selKey, true);
    ui.render();
    return;
  }
  stop();
  const ov = el('div', { class: 'stkr-sel', role: 'application', 'aria-label': 'Select the bar where replay starts. Press Escape to cancel.' });
  sel.line = el('div', { class: 'stkr-sel-line' });
  sel.shade = el('div', { class: 'stkr-sel-shade' });
  sel.tip = el('div', { class: 'stkr-sel-tip', text: isPhone() ? 'Tap a bar to start replay there' : 'Click a bar to start replay there · Esc to cancel' });
  const cancel = el('button', { type: 'button', class: 'stkr-sel-x', text: 'Cancel', onclick: (e) => { e.stopPropagation(); selectMode(false); } });
  ov.append(sel.shade, sel.line, sel.tip, cancel);
  (host || document.body).appendChild(ov);
  sel.el = ov;
  const move = (e) => track(e.clientX, e.clientY);
  ov.addEventListener('pointermove', move);
  ov.addEventListener('pointerdown', move);
  ov.addEventListener('click', async (e) => {
    if (e.target === cancel) return;
    track(e.clientX, e.clientY);
    if (!sel.cell || sel.idx < 0) return;
    const cell = sel.cell, idx = sel.idx;
    try { WS.setActiveCell && WS.setActiveCell(cell.id); } catch (e2) {}
    selectMode(false);
    await start(fromBarIndex(cell, idx), 'select');
  });
  document.addEventListener('keydown', selKey, true);
  ui.render();
}
function selKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); selectMode(false); } }
function track(x, y) {
  sel.cell = null; sel.idx = -1;
  const host = sel.el && sel.el.parentElement; if (!host) return;
  const hr = host.getBoundingClientRect();
  for (const cell of cells()) {
    const R = R_of(cell); const cv = R && R.input && R.input.el; if (!cv || !R.coords) continue;
    const r = cv.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const bars = rawBars(cell); if (!bars.length) return;
    let lx = x - r.left;
    if (lx > R.coords.width) lx = R.coords.width;
    let idx = Math.round(R.coords.xToLogical(lx));
    idx = Math.max(0, Math.min(bars.length - 1, idx));
    const bx = R.coords.logicalToX(idx) + r.left;
    sel.cell = cell; sel.idx = idx;
    sel.line.style.left = (bx - hr.left) + 'px';
    sel.line.style.top = (r.top - hr.top) + 'px'; sel.line.style.height = r.height + 'px';
    sel.shade.style.left = (bx - hr.left) + 'px'; sel.shade.style.top = (r.top - hr.top) + 'px';
    sel.shade.style.width = Math.max(0, r.left + Math.min(R.coords.width, r.width) - bx) + 'px'; sel.shade.style.height = r.height + 'px';
    sel.line.hidden = false; sel.shade.hidden = false;
    sel.tip.textContent = 'Start at ' + fmtET(bars[idx].time);
    return;
  }
  if (sel.line) { sel.line.hidden = true; sel.shade.hidden = true; }
}

// ------------------------------------------------------------------ UI
function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'text') n.textContent = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else n.setAttribute(k, attrs[k]);
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const svg = (p, w) => '<svg width="' + (w || 16) + '" height="' + (w || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
const ICON = {
  replay: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M10 9l5 3-5 3z" fill="currentColor"/>',
  play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  fwd: '<path d="M5 5l10 7-10 7z" fill="currentColor"/><path d="M19 5v14"/>',
  back: '<path d="M19 5L9 12l10 7z" fill="currentColor"/><path d="M5 5v14"/>',
  live: '<path d="M5 12h12"/><path d="M13 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  scissor: '<path d="M12 3v18"/><path d="M8 7l4-4 4 4"/>',
  grip: '<circle cx="9" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="17" r="1.2" fill="currentColor"/><circle cx="15" cy="17" r="1.2" fill="currentColor"/>'
};
function toast(m, type) { if (rhActive()) return; try { OPT.toast ? OPT.toast(m, type) : (window.showToast && window.showToast(type || 'success', m)); } catch (e) {} }

const ui = (() => {
  let btn, pop, badge, bar, playB, fwdB, backB, speedS, stepS, clock, spin, simL;
  function mountButton(barL) {
    btn = el('button', { type: 'button', class: 'stkc-btn stkr-btn', id: 'stkr-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Bar replay',
      html: svg(ICON.replay, 15) + '<span class="stkc-btn-l">Replay</span>' });
    pop = el('div', { class: 'stkc-pop stkr-pop', id: 'stkr-pop', role: 'menu', 'aria-label': 'Bar replay', hidden: '' });
    const item = (label, sub, fn) => el('button', { type: 'button', class: 'stkc-item stkr-item', role: 'menuitem', onclick: (e) => { e.stopPropagation(); close(); fn(); } },
      [el('span', { class: 'stkr-il', text: label }), sub ? el('span', { class: 'stkr-is', text: sub }) : null]);
    const date = el('input', { type: 'datetime-local', class: 'stkr-date', 'aria-label': 'Replay start date and time (New York time)' });
    const go = el('button', { type: 'button', class: 'stkc-btn stkr-go', text: 'Start', onclick: (e) => {
      e.stopPropagation();
      const v = date.value; if (!v) { date.focus(); return; }
      const m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(v); if (!m) return;
      const MH = window.StrykerMarketHours;
      const ms = MH && MH.nyToUtc ? MH.nyToUtc(+m[1], +m[2], +m[3], +m[4], +m[5]) : Date.parse(v);
      close(); startAtDate(ms);
    } });
    pop.append(
      el('p', { class: 'stkc-pop-h', text: 'Bar replay' }),
      item('Select bar', 'Pick the start on the chart', () => selectMode(true)),
      el('div', { class: 'stkr-dt' }, [el('label', { class: 'stkr-il', text: 'Select date (New York time)' }), el('div', { class: 'stkr-dtr' }, [date, go])]),
      item('Random bar', 'Somewhere in the loaded history', startRandom),
      item('First available bar', 'The oldest loaded bar', startFirst),
      el('p', { class: 'stkc-pop-s stkr-note', text: 'Replay hides the bars to the right and plays them back one by one. Indicators only see revealed bars. Paper trades use a separate Replay account.' })
    );
    const wrap = el('div', { class: 'stkc-menu stkr-menu' }, [btn, pop]);
    btn.addEventListener('click', (e) => { e.stopPropagation(); if (pop.hidden) open(); else close(); });
    document.addEventListener('click', (e) => { if (!pop.hidden && !wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { close(); btn.focus(); } });
    badge = el('span', { class: 'stkr-badge', role: 'status', 'aria-live': 'polite', hidden: '' });
    // right-hand toolbar group, first (the left group is full on phones: Owner layout rule, the
    // saved-layout menu must not be squeezed)
    barL.insertBefore(wrap, barL.firstChild);
    barL.insertBefore(badge, wrap);
  }
  function open() {
    pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
    const d = pop.querySelector('.stkr-date');
    if (d && !d.value) {
      const t = S.on ? S.E : Date.now() - 7 * Core.DAY;
      try {
        const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t));
        const g = (k) => (p.find((x) => x.type === k) || {}).value;
        d.value = g('year') + '-' + g('month') + '-' + g('day') + 'T' + (g('hour') === '24' ? '00' : g('hour')) + ':' + g('minute');
      } catch (e) {}
    }
  }
  function close() { if (pop) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } }

  function mountBar() {
    const B = (cls, label, icon, fn, extra) => el('button', Object.assign({ type: 'button', class: 'stkr-b ' + cls, 'aria-label': label, title: label, html: svg(icon), onclick: (e) => { e.stopPropagation(); fn(); } }, extra || {}));
    const grip = el('span', { class: 'stkr-grip', html: svg(ICON.grip, 14), 'aria-hidden': 'true', title: 'Drag to move' });
    const selB = B('stkr-selb', 'Select a new start bar', ICON.scissor, () => selectMode(true));
    backB = B('stkr-backb', 'Step back', ICON.back, stepBack);
    playB = B('stkr-playb', 'Play', ICON.play, toggle);
    fwdB = B('stkr-fwdb', 'Step forward (Shift+Right arrow)', ICON.fwd, () => { stop(); stepForward(); });
    speedS = el('select', { class: 'stkr-sel-in stkr-speed', 'aria-label': 'Replay speed', title: 'Speed: real time (candles form tick by tick) or whole bars per second' });
    const gRt = el('optgroup', { label: 'Real time (candle forms)' });
    RT_SPEEDS.forEach((m) => gRt.appendChild(el('option', { value: 'rt:' + m, text: m + 'x' })));
    const gSt = el('optgroup', { label: 'Bar per step' });
    SPEEDS.forEach((s) => gSt.appendChild(el('option', { value: String(s), text: s + ' bar' + (s === 1 ? '' : 's') + '/s' })));
    speedS.append(gRt, gSt);
    speedS.addEventListener('change', () => {
      const v = speedS.value, was = S.playing;
      if (was) stop();
      if (v.startsWith('rt:')) S.rt = +v.slice(3) || 1; else { S.rt = 0; S.speed = +v || 1; }
      save(); render();
      if (was) play();
    });
    simL = el('span', { class: 'stkr-sim', text: '(simulated path)', title: 'No recorded trades for this bar here: the candle moves open, low, high, close (up bar) or open, high, low, close (down bar).', hidden: '' });
    stepS = el('select', { class: 'stkr-sel-in stkr-step', 'aria-label': 'Update interval', title: 'Update interval: the forming candle builds from these bars' });
    stepS.addEventListener('change', async () => {
      stop();
      S.stepTf = stepS.value; S.fallTf = ''; bufs.clear();
      ui.busy(true);
      try { if (S.active) await resolveStep(S.active, S.E); await reloadAll(); } finally { ui.busy(false); }
      save(); render();
    });
    clock = el('span', { class: 'stkr-clock', 'aria-live': 'off' });
    spin = el('span', { class: 'stkr-spin', 'aria-hidden': 'true', hidden: '' });
    const liveB = el('button', { type: 'button', class: 'stkr-b stkr-live', title: 'Jump to real-time (exit replay)', 'aria-label': 'Jump to real-time', html: svg(ICON.live) + '<span>Real-time</span>', onclick: (e) => { e.stopPropagation(); exit(); } });
    const xB = B('stkr-xb', 'Exit replay', ICON.x, exit);
    bar = el('div', { class: 'stkr-bar', id: 'stkr-bar', role: 'toolbar', 'aria-label': 'Replay controls', hidden: '' },
      [grip, selB, el('span', { class: 'stkr-sep' }), backB, playB, fwdB, el('span', { class: 'stkr-sep' }), speedS, simL, stepS, clock, spin, el('span', { class: 'stkr-sep' }), liveB, xB]);
    document.body.appendChild(bar);
    // drag (desktop); docked at the bottom on phones
    let drag = null;
    grip.addEventListener('pointerdown', (e) => {
      if (isPhone()) return;
      const r = bar.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      grip.setPointerCapture(e.pointerId); e.preventDefault();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const x = Math.max(4, Math.min(window.innerWidth - bar.offsetWidth - 4, e.clientX - drag.dx));
      const y = Math.max(4, Math.min(window.innerHeight - bar.offsetHeight - 4, e.clientY - drag.dy));
      bar.style.left = x + 'px'; bar.style.top = y + 'px'; bar.style.bottom = 'auto'; bar.style.transform = 'none';
    });
    grip.addEventListener('pointerup', () => {
      if (!drag) return; drag = null;
      try { localStorage.setItem(LS_KEY + '_pos', JSON.stringify({ l: bar.style.left, t: bar.style.top })); } catch (e) {}
    });
    try { const p = JSON.parse(localStorage.getItem(LS_KEY + '_pos') || 'null'); if (p && !isPhone()) { bar.style.left = p.l; bar.style.top = p.t; bar.style.bottom = 'auto'; bar.style.transform = 'none'; } } catch (e) {}
    document.addEventListener('keydown', (e) => {
      if (!S.on) return;
      const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.shiftKey && e.key === 'ArrowRight') { e.preventDefault(); stop(); stepForward(); return; }
      // Admin-only extras (Owner 2026-10-16): control replay while the markings are hidden.
      if (window.__stkIsAdmin !== true || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (e.shiftKey && (k === 'H' || k === 'h')) { e.preventDefault(); rhSet(!rhFlag()); }
      else if (e.shiftKey && (k === 'X' || k === 'x')) { e.preventDefault(); exit(); }
      else if (e.shiftKey && k === 'ArrowLeft') { e.preventDefault(); stop(); stepBack(); }
      else if (e.shiftKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
        e.preventDefault();
        const list = SPEEDS, i = Math.max(0, list.indexOf(S.speed)), j = Math.min(list.length - 1, Math.max(0, i + (k === 'ArrowUp' ? -1 : 1)));
        const was = S.playing; if (was) stop(); S.rt = 0; S.speed = list[j]; save(); render(); if (was) play();
      }
      else if (!e.shiftKey && (k === ' ' || e.code === 'Space') && !(t && t.tagName === 'BUTTON')) { e.preventDefault(); toggle(); }
    });
    window.addEventListener('stk-rh-change', rhApply);
    window.addEventListener('stk-admin-change', rhApply);
    // phone: two-finger long-press brings the markings back
    let lp = 0;
    document.addEventListener('touchstart', (e) => { clearTimeout(lp); if (e.touches.length === 2 && rhActive()) lp = setTimeout(() => rhSet(false), 600); }, { passive: true });
    ['touchend', 'touchcancel', 'touchmove'].forEach((ev) => document.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
  }
  function fillSteps() {
    const a = S.active; if (!a) return;
    const ms = Core.tfMs(a.tf);
    stepS.innerHTML = '';
    const opts = STEP_TFS.filter((t) => validStepTf(a.tf, t) && Core.tfMs(t) < ms);
    stepS.appendChild(el('option', { value: String(a.tf), text: 'Step ' + Core.tfLabel(a.tf) }));
    opts.forEach((t) => stepS.appendChild(el('option', { value: t, text: 'Step ' + Core.tfLabel(t) })));
    const cur = effTf();
    stepS.value = cur && [...stepS.options].some((o) => o.value === cur) ? cur : String(a.tf);
    stepS.title = S.fallTf
      ? 'Update interval: ' + Core.tfLabel(S.stepTf || a.tf) + ' has no data this far back, so replay steps by ' + Core.tfLabel(S.fallTf)
      : 'Update interval: the forming candle builds from these bars';
    stepS.hidden = stepS.options.length < 2;
  }
  function render() {
    if (btn) { btn.classList.toggle('on', S.on || S.sel); }
    rhApply();
    if (!bar) return;
    if (badge) {
      badge.hidden = !S.on;
      badge.textContent = S.on ? (isPhone() ? 'REPLAY' : 'REPLAY · ' + fmtET(S.E)) : '';
      badge.title = S.on ? 'Bar replay at ' + fmtET(S.E) : '';
    }
    if (!S.on) return;
    clock.textContent = fmtET(S.E);
    playB.innerHTML = svg(S.playing ? ICON.pause : ICON.play);
    playB.setAttribute('aria-label', S.playing ? 'Pause' : 'Play'); playB.title = S.playing ? 'Pause' : 'Play';
    playB.classList.toggle('on', S.playing);
    backB.disabled = !S.undo.length;
    speedS.value = S.rt > 0 ? 'rt:' + S.rt : String(S.speed);
    simL.hidden = !(S.rt > 0 && S.sim);
    fillSteps();
  }
  return {
    mountButton, mountBar, render,
    show() { if (bar) bar.hidden = false; render(); },
    hide() { if (bar) bar.hidden = true; render(); },
    busy(b) { if (spin) spin.hidden = !b; if (bar) bar.classList.toggle('is-busy', !!b); }
  };
})();

// ------------------------------------------------------------------ mount
export function mountBarReplay(ws, opts) {
  WS = ws; OPT = opts || {};
  const barR = document.querySelector('#stkc-bar .stkc-bar-r');
  if (barR) ui.mountButton(barR);
  ui.mountBar();
  // timeframe / symbol switch during replay: keep the clock, refresh the active series + steps
  const onChange = () => {
    if (!S.on) return;
    const a = resolveCell(activeCell());
    if (!a) return;
    const changed = !S.active || a.name !== S.active.name || a.ticker !== S.active.ticker || a.tf !== S.active.tf;
    S.active = a;
    if (changed) {
      if (!validStepTf(a.tf, S.stepTf)) S.stepTf = defaultStepTf(a.tf);
      S.fallTf = '';
      resolveStep(a, S.E).then(() => { seedPaper(); save(); ui.render(); });
    }
  };
  try { ws.on('state:changed', () => setTimeout(onChange, 0)); } catch (e) {}
  try { ws.on('layout:changed', () => setTimeout(onChange, 0)); } catch (e) {}
  // resume a saved session after reload
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) {}
  if (saved && Number.isFinite(saved.E)) {
    S.speed = SPEEDS.includes(saved.speed) ? saved.speed : 1;
    S.rt = RT_SPEEDS.includes(saved.rt) ? saved.rt : 0;
    S.stepTf = saved.stepTf || '';
    let tries = 0;
    const wait = () => {
      const c = activeCell();
      if (c && rawBars(c).length && resolveCell(c)) {
        start(saved.E, 'resume').then(() => { S.undo = Array.isArray(saved.undo) ? saved.undo.filter(Number.isFinite) : []; ui.render(); });
      } else if (tries++ < 60) setTimeout(wait, 250);
    };
    setTimeout(wait, 300);
  }
  window.__stkBarReplay = {
    get state(){ return { on: S.on, E: S.E, speed: S.speed, rt: S.rt, sim: !!S.sim, stepTf: S.stepTf, effTf: effTf(), fallTf: S.fallTf, playing: S.playing, undo: S.undo.length, busy: S.busy, active: S.active }; },
    start, exit, stepForward, stepBack, play, pause: () => { stop(); ui.render(); }, startAtDate, startRandom, startFirst, selectMode,
    setSpeed: (s) => { S.speed = s; S.rt = 0; save(); ui.render(); },
    setRealtime: (m) => { S.rt = RT_SPEEDS.includes(m) ? m : 1; save(); ui.render(); },
    setStepTf: async (t) => { S.stepTf = t; S.fallTf = ''; bufs.clear(); if (S.active) await resolveStep(S.active, S.E); await reloadAll(); save(); ui.render(); },
    buffers: () => [...bufs.entries()].map(([k, b]) => ({ k, n: b.bars.length, end: b.end })),
    subs: () => [...subs].map((s) => ({ name: s.name, ticker: s.ticker, tf: s.tf }))
  };
}
