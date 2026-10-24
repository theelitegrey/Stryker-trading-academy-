// TradeZoro — Charts: LIVE order flow for admins from the trade stream they already receive (ES module).
// CoS GO 2026-10-24 ("deep data speed" a1). Pure store + aggregation, no DOM, no network.
// Depends on: nothing. Fed by assets/chart-futures-provider.js (the admin /api/chart/stream socket asks for
// `of=1`; the bridge, functions/api/chart/stream/[sym].js, then sends {event:'trades', tr:[[t, price, vol,
// side], ...]} every ~250 ms: every InsightSentry print with its buy/sell tag). Read by
// assets/chart-footprint.js minuteBars(), which lays these minutes over the recorder's /orderflow bars.
//
// WHY: the recorder's footprint reaches the screen 10-30 s late (feeder POST every 10 s + 15 s edge cache +
// 5 s client poll). The same prints already flow to the admin chart for the candle, so the forming minute's
// footprint / delta / CVD / big trades are built here, about every 250 ms.
//
// The maths is the feeder's (workers/book-recorder/of-feeder/ofcodec.py Aggregator + Bar), so a minute built
// here equals the recorder's minute built from the same prints (tools/tests/chart-live-of.test.mjs checks
// it against the Python codec on a real NQ fixture). Bars have the shape decodeOrderflow() makes.
// Which minute wins: assets/chart-footprint.js keeps whichever copy (live or recorder) holds MORE prints,
// so a minute the browser only saw part of (it connected mid-minute, a socket gap, upstream conflation)
// falls back to the recorder's copy as soon as that is more complete.
//
// FLAG (ships dark): LIVE_OF_DEFAULT = false. Per-browser override for tests: localStorage
// 'stk_live_of' = '1' (on) / '0' (off). Real time stays admin only: the server sends trades only on the
// admin stream. Roots: NQ and ES only (the recorder's fast symbols, same front contract as the stream).
// Education only. Not financial advice.

export const LIVE_OF_DEFAULT = false;
export const LIVE_OF_ROOTS = ['NQ', 'ES'];
const TICK = { NQ: 0.25, ES: 0.25 };
const KEEP_MIN = 30;           // live minutes kept (the recorder has them final long before)
const DEF_THR = { NQ: 19, ES: 76 };

export function liveOfOn() {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem('stk_live_of') : null;
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (e) {}
  return LIVE_OF_DEFAULT;
}
export const liveOfRoot = (root) => LIVE_OF_ROOTS.includes(String(root || '').toUpperCase());

// One minute, as ofcodec.Bar: price index -> [buy, sell], open/close, running delta extremes, prints.
class LiveBar {
  constructor(m) { this.m = m; this.o = null; this.c = null; this.lv = new Map(); this.d = 0; this.dmax = 0; this.dmin = 0; this.trades = 0; this.bigs = []; this.out = null; }
  add(p, v, side) {
    if (this.o == null) this.o = p;
    this.c = p;
    this.trades++;
    let r = this.lv.get(p);
    if (!r) { r = [0, 0]; this.lv.set(p, r); }
    if (side === 1) { r[0] += v; this.d += v; } else if (side === 0) { r[1] += v; this.d -= v; }
    if (this.d > this.dmax) this.dmax = this.d;
    if (this.d < this.dmin) this.dmin = this.d;
    this.out = null;
  }
  // -> the decodeOrderflow() bar shape (memoised until the next print)
  view() {
    if (this.out) return this.out;
    let lo = Infinity, hi = -Infinity;
    for (const p of this.lv.keys()) { if (p < lo) lo = p; if (p > hi) hi = p; }
    const n = hi - lo + 1, buy = new Int32Array(n), sell = new Int32Array(n);
    let vol = 0, delta = 0;
    for (const [p, r] of this.lv) { buy[p - lo] = r[0]; sell[p - lo] = r[1]; vol += r[0] + r[1]; delta += r[0] - r[1]; }
    const bigs = this.bigs.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    this.out = { t: this.m * 60000, lo, hi, o: this.o, c: this.c, buy, sell, vol, delta, dmax: this.dmax, dmin: this.dmin,
      trades: this.trades, bigs, mins: 1, live: true };
    return this.out;
  }
}

// Per root: minutes, the newest print time (dedupe), the pending big-trade group, coverage start.
export class LiveFlow {
  constructor(root, thr, keepMin = KEEP_MIN) {
    this.keepMin = keepMin; this.root = root; this.tick = TICK[root] || 0.25; this.thr = thr || DEF_THR[root] || 20;
    this.bars = new Map(); this.lastT = 0; this.g = null; this.v = 0; this.since = 0; this.prints = 0; this.dupes = 0; this.at = 0;
  }
  flushGroup() {
    const g = this.g; this.g = null;
    if (!g || !(this.thr && g[2] >= this.thr)) return;
    const b = this.bars.get(g[4]);
    // [ms absolute, price idx, size, side] like decodeOrderflow (which adds the minute back)
    if (b) { b.bigs.push([g[0], g[3], g[2], g[1]]); b.out = null; }
  }
  // rows: [[t (s, us precision), price, volume, side 1 buy / 0 sell / -1 none], ...] in time order
  add(rows) {
    let n = 0;
    for (const x of rows || []) {
      const t = Number(x[0]), price = Number(x[1]), v = Math.round(Number(x[2]));
      if (!(t > 0) || !Number.isFinite(price) || !(v > 0)) continue;
      if (t <= this.lastT) { this.dupes++; continue; }
      this.lastT = t;
      if (!this.since) this.since = t;
      const side = x[3] === 1 ? 1 : x[3] === 0 ? 0 : -1;
      const m = Math.floor(t / 60), p = Math.round(price / this.tick);
      let b = this.bars.get(m);
      if (!b) { b = new LiveBar(m); this.bars.set(m, b); }
      b.add(p, v, side);
      n++;
      if (side < 0) continue;
      const ms = Math.floor(t * 1000);
      const g = this.g;
      if (g && g[0] === ms && g[1] === side) g[2] += v;
      else { this.flushGroup(); this.g = [ms, side, v, p, m]; }
    }
    if (n) {
      this.prints += n; this.v++; this.at = Date.now();
      const cut = Math.floor(this.lastT / 60) - this.keepMin;
      for (const m of this.bars.keys()) if (m < cut) this.bars.delete(m);
    }
    return n;
  }
  // The live minutes as decodeOrderflow bars, ascending. The minute holding `since` was seen only in part.
  list() { return [...this.bars.keys()].sort((a, b) => a - b).map((m) => Object.assign(this.bars.get(m).view(), { partial: m === Math.floor(this.since / 60) })); }
}

// ---- page-wide store (one per root) + listeners (chart-footprint.js bumps its version on change)
const flows = new Map();
const subs = new Set();
let notifyTm = 0;
export function liveFlow(root) { return flows.get(root) || null; }
export function onLiveFlow(fn) { subs.add(fn); return () => subs.delete(fn); }
export function pushLiveTrades(root, rows, thr) {
  root = String(root || '').toUpperCase();
  if (!liveOfRoot(root) || !Array.isArray(rows) || !rows.length) return 0;
  let f = flows.get(root);
  if (!f) { f = new LiveFlow(root, thr); flows.set(root, f); }
  const n = f.add(rows);
  if (n && !notifyTm) notifyTm = setTimeout(() => { notifyTm = 0; subs.forEach((fn) => { try { fn(); } catch (e) {} }); }, 50);
  return n;
}
export function setLiveThr(root, thr) { const f = flows.get(root); if (f && thr > 0) f.thr = thr; }
// A new socket (reconnect) leaves a hole: the minute it starts in is partial again.
export function liveGap(root) { const f = flows.get(String(root || '').toUpperCase()); if (f) { f.flushGroup(); f.since = 0; } }

// Overlay: recorder minutes + live minutes -> one list (ascending). Per minute the copy with MORE prints wins.
export function overlayLive(recBars, live, fromMs, toMs) {
  if (!live || !live.length) return recBars;
  const byT = new Map();
  for (const b of recBars) byT.set(b.t, b);
  let changed = false;
  for (const b of live) {
    if (b.partial || b.t < fromMs - 60000 || b.t > toMs) continue;   // a minute seen only in part never replaces
    const r = byT.get(b.t);
    if (!r || b.trades > r.trades) { byT.set(b.t, b); changed = true; }
  }
  if (!changed) return recBars;
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

// Sunday check: per closed minute, live prints vs the recorder's prints (a shortfall = prints the stream
// dropped or conflated). window.tzLiveOfStats() in assets/chart-footprint.js calls this.
export function compareMinutes(root, recBars) {
  const f = flows.get(root);
  if (!f) return { root, on: liveOfOn(), live: 0 };
  const rec = new Map(recBars.map((b) => [b.t, b]));
  const nowMin = Math.floor(Date.now() / 60000), sinceMin = Math.floor(f.since / 60);
  const rows = [];
  for (const b of f.list()) {
    const m = b.t / 60000;
    if (m <= sinceMin || m >= nowMin - 1) continue;          // partial first minute, forming / just-closed
    const r = rec.get(b.t);
    if (!r) continue;
    rows.push({ t: new Date(b.t).toISOString().slice(11, 16), live: b.trades, rec: r.trades, liveVol: b.vol, recVol: r.vol, liveDelta: b.delta, recDelta: r.delta });
  }
  const sum = (k) => rows.reduce((a, x) => a + x[k], 0);
  return { root, on: liveOfOn(), minutes: rows.length, livePrints: sum('live'), recPrints: sum('rec'), coverPct: rows.length ? Math.round(1000 * sum('live') / Math.max(1, sum('rec'))) / 10 : null,
    exact: rows.filter((x) => x.live === x.rec && x.liveVol === x.recVol && x.liveDelta === x.recDelta).length, dupes: f.dupes, rows: rows.slice(-30) };
}

// InsightSentry delivery_status events (adaptive conflation: mode, max Hz, dropped updates), kept for the check.
const deliveries = [];
export function noteLiveDelivery(root, msg) {
  deliveries.push({ at: new Date().toISOString().slice(11, 19), root, mode: msg.mode, hz: msg.hz, dropped: msg.dropped });
  if (deliveries.length > 50) deliveries.shift();
}
export const liveDeliveries = () => deliveries.slice();
