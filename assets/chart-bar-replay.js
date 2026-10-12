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
const STEP_TFS = ['1', '5', '15', '30', '60', '240', 'D'];
const AHEAD_BARS = 400;                               // fetched ahead of the clock per series
const MAX_BUF = 6000;                                 // bars kept per buffered series (memory cap)
const MAX_UNDO = 200;

// ------------------------------------------------------------------ state
const S = {
  on: false, E: 0, speed: 1, stepTf: '', playing: false, busy: false, undo: [],
  sel: false, timer: null
};
const inners = new Map();     // provider name -> the provider below this wrapper
const subs = new Set();       // { name, ticker, tf, onBar } replay feeds of the live cells
const bufs = new Map();       // name|ticker|tf -> { bars, to, end }
window.__stkReplay = {
  get on(){ return S.on; }, now(){ return S.on ? S.E : Date.now(); },
  get E(){ return S.E; }, get playing(){ return S.playing; }, get speed(){ return S.speed; }, get stepTf(){ return S.stepTf; }
};

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
  if (!a || a.name !== name || a.ticker !== ticker || !S.stepTf) return null;
  const ms = Core.tfMs(tf), sMs = Core.tfMs(S.stepTf);
  if (!ms || !sMs || sMs >= ms) return null;
  const b = bufs.get(bkey(name, ticker, S.stepTf));
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
    await ensure(name, ticker, S.stepTf, E, lastT);
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
    localStorage.setItem(LS_KEY, JSON.stringify({ E: S.E, speed: S.speed, stepTf: S.stepTf, undo: S.undo.slice(-50),
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
  if (!wasOn && OPT.Paper && OPT.Paper.setReplay) { try { OPT.Paper.setReplay({ now: () => S.E }); } catch (e) { console.warn('TradeZoro replay: paper', e); } }
  document.documentElement.classList.add('stk-replay');
  ui.show();
  ui.busy(true);
  try {
    await ensure(a.name, a.ticker, S.stepTf || a.tf, S.E);
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
  S.on = false; S.undo = []; S.active = null;
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
  if (S.active && S.stepTf) {
    const k = S.active.name + ':' + S.active.ticker, ms = Core.tfMs(S.stepTf), cur = by.get(k);
    if (!cur || ms < cur.ms) by.set(k, { name: S.active.name, ticker: S.active.ticker, tf: S.stepTf, ms });
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

async function stepForward() {
  if (!S.on || S.busy) return false;
  const a = S.active; if (!a) return false;
  S.busy = true;
  try {
    const tf = S.stepTf || a.tf, sMs = Core.tfMs(tf);
    const sb = await ensure(a.name, a.ticker, tf, S.E);
    const E1 = sb ? Core.nextE(sb.bars, sMs, S.E) : null;
    if (E1 == null) {
      stop(); ui.render();
      toast('Replay reached the newest bar. Jump to real-time to go back to the live chart.');
      return false;
    }
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
function stop() { S.playing = false; if (S.timer) { clearTimeout(S.timer); S.timer = null; } }
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
function toast(m, type) { try { OPT.toast ? OPT.toast(m, type) : (window.showToast && window.showToast(type || 'success', m)); } catch (e) {} }

const ui = (() => {
  let btn, pop, badge, bar, playB, fwdB, backB, speedS, stepS, clock, spin;
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
    barL.appendChild(wrap);
    barL.appendChild(badge);
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
    speedS = el('select', { class: 'stkr-sel-in stkr-speed', 'aria-label': 'Replay speed (steps per second)', title: 'Speed' });
    SPEEDS.forEach((s) => speedS.appendChild(el('option', { value: String(s), text: s + 'x' })));
    speedS.addEventListener('change', () => { S.speed = +speedS.value || 1; save(); });
    stepS = el('select', { class: 'stkr-sel-in stkr-step', 'aria-label': 'Update interval', title: 'Update interval: the forming candle builds from these bars' });
    stepS.addEventListener('change', async () => {
      stop();
      S.stepTf = stepS.value; bufs.clear();
      ui.busy(true);
      try { await reloadAll(); } finally { ui.busy(false); }
      save(); render();
    });
    clock = el('span', { class: 'stkr-clock', 'aria-live': 'off' });
    spin = el('span', { class: 'stkr-spin', 'aria-hidden': 'true', hidden: '' });
    const liveB = el('button', { type: 'button', class: 'stkr-b stkr-live', title: 'Jump to real-time (exit replay)', 'aria-label': 'Jump to real-time', html: svg(ICON.live) + '<span>Real-time</span>', onclick: (e) => { e.stopPropagation(); exit(); } });
    const xB = B('stkr-xb', 'Exit replay', ICON.x, exit);
    bar = el('div', { class: 'stkr-bar', id: 'stkr-bar', role: 'toolbar', 'aria-label': 'Replay controls', hidden: '' },
      [grip, selB, el('span', { class: 'stkr-sep' }), backB, playB, fwdB, el('span', { class: 'stkr-sep' }), speedS, stepS, clock, spin, el('span', { class: 'stkr-sep' }), liveB, xB]);
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
      if (e.shiftKey && e.key === 'ArrowRight') { e.preventDefault(); stop(); stepForward(); }
    });
  }
  function fillSteps() {
    const a = S.active; if (!a) return;
    const ms = Core.tfMs(a.tf);
    stepS.innerHTML = '';
    const opts = STEP_TFS.filter((t) => validStepTf(a.tf, t) && Core.tfMs(t) < ms);
    stepS.appendChild(el('option', { value: String(a.tf), text: 'Step ' + Core.tfLabel(a.tf) }));
    opts.forEach((t) => stepS.appendChild(el('option', { value: t, text: 'Step ' + Core.tfLabel(t) })));
    stepS.value = S.stepTf && [...stepS.options].some((o) => o.value === S.stepTf) ? S.stepTf : String(a.tf);
    stepS.hidden = stepS.options.length < 2;
  }
  function render() {
    if (btn) { btn.classList.toggle('on', S.on || S.sel); }
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
    speedS.value = String(S.speed);
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
  const barL = document.getElementById('stkc-bar-l');
  if (barL) ui.mountButton(barL);
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
      ensure(a.name, a.ticker, S.stepTf || a.tf, S.E).then(() => { seedPaper(); save(); ui.render(); });
    }
  };
  try { ws.on('state:changed', () => setTimeout(onChange, 0)); } catch (e) {}
  try { ws.on('layout:changed', () => setTimeout(onChange, 0)); } catch (e) {}
  // resume a saved session after reload
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) {}
  if (saved && Number.isFinite(saved.E)) {
    S.speed = SPEEDS.includes(saved.speed) ? saved.speed : 1;
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
    get state(){ return { on: S.on, E: S.E, speed: S.speed, stepTf: S.stepTf, playing: S.playing, undo: S.undo.length, busy: S.busy, active: S.active }; },
    start, exit, stepForward, stepBack, play, pause: () => { stop(); ui.render(); }, startAtDate, startRandom, startFirst, selectMode,
    setSpeed: (s) => { S.speed = s; save(); ui.render(); },
    setStepTf: async (t) => { S.stepTf = t; bufs.clear(); await reloadAll(); save(); ui.render(); },
    buffers: () => [...bufs.entries()].map(([k, b]) => ({ k, n: b.bars.length, end: b.end })),
    subs: () => [...subs].map((s) => ({ name: s.name, ticker: s.ticker, tf: s.tf }))
  };
}
