// TradeZoro — Charts: ORDER FLOW with the book (L2). Six indicators, the L2 twins of the trade-only (L1) order-flow tools (Owner order 2026-11-03):
//   stk_l2f_delta  Delta (L2)            pane: trade delta + book delta per bar (stacked), "pulled vs added" readout
//   stk_l2f_cvd    Cumulative Delta (L2) pane: running total of both, candles or line, session reset
//   stk_l2f_fp     Footprint (L2)        overlay: traded volume per price (thin bars) + the resting size at bar close beside it
//   stk_l2f_big    Big Trades (L2)       overlay: big orders tagged W (hit a resting wall) / C (consumed) / P (book pulled)
//   stk_l2f_stop   Stop Runs (L2)        overlay: a sweep counts only if resting liquidity on that side was pulled / consumed through >= N levels
//   stk_l2f_vp     Volume Profile (L2)   overlay: session average resting size per price next to the traded profile (view: Volume / Delta / Both)
//   stk_l2f_sw     Swing VWAP + Profile (L2) overlay: per swing leg an anchored VWAP + volume profile with POC / VAH / VAL (assets/chart-swing-vwap*.js)
//   stk_l2f_dp     Delta Profile (L2)    overlay: delta per price over the last N minutes, a picked range, or the session (maths: chart-delta-profile-data.js)
// Imbalance Zones = Book Imbalance (L2), Absorption = Absorption & Iceberg Tracker (L2): not repeated here.
// DATA, nothing fetched twice: the book is the heatmap's own BookFeed (chart-orderflow.js acquireBookFeed 'tsl2|ROOT' / Binance; its /ts-book-history
// backfill and /ts-live frames), the trades are the L1 tools' own stores (chart-ts-trades.js tsOpen for futures; chart-footprint-crypto.js for Binance)
// and the hub's footprint minutes (chart-futures-l2.js TickFeed). A "level" here is one book row as the recorder stores it (a few ticks wide, rule in ts-hub.js).
// Same gate as the other L2 tools (futures: l2Visible(); crypto: Pro). No data = a plain note, never made-up numbers. Education only. Not financial advice.
import { registerFeed } from './chart-feeds.js?v=957';
import { isFree } from './chart-pro-gate.js?v=957';
import { rtOnChange } from './rt-access.js?v=957';
import { l2Badge, l2Root, L2_TICK, L2_TYPES, l2Source, rootState } from './chart-futures-l2.js?v=957';
import { cryptoFeed, isCrypto } from './chart-footprint-crypto.js?v=957';
import { tsOpen } from './chart-ts-trades.js?v=957';
import { aggregateMins } from './chart-ts-data.js?v=957';
import { aggregate, clipTo, profile as tradedProfile } from './chart-footprint-data.js?v=957';
import * as BT from './chart-bigtrades.js?v=957';
import { sweepEvents } from './chart-of-pro-data.js?v=957';
import { sweepBars } from './chart-of-pro.js?v=957';
import { sessionStart, nyOffsetMs, fmtK, clamp, num } from './chart-book-pack-data.js?v=957';
import { swingModel, swingLayer } from './chart-swing-vwap.js?v=957';
import { DeltaAcc, windowOf, rebucket, rowTicks, fromProfile } from './chart-delta-profile-data.js?v=957';

export const L2F_TYPES = ['stk_l2f_delta', 'stk_l2f_cvd', 'stk_l2f_fp', 'stk_l2f_big', 'stk_l2f_stop', 'stk_l2f_vp', 'stk_l2f_lad', 'stk_l2f_dp', 'stk_l2f_sw'];
const UP = '#03c988', DN = '#f23645', CYAN = '#00adb5', AMBER = '#f5b301', VIOLET = '#9b7bff';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const NOT_YET = 'Needs L2 (full order book). It is part of Pro.';
const NEED = 'These tools work on NQ, ES, YM, RTY, CL, GC futures (and micros) and crypto.';
const MIN_COVER = 90000;             // Delta Profile: a window whose first trade minute is later than this after its start says so
const MIN_GAP = 200;                 // redraw at most 5 a second
const GAP_MAX = 5 * 60000;           // two book samples further apart than this are not one "change" (the recorder's archive is one sample per few minutes)
const ROW_STEPS = [1, 2, 4, 5, 8, 10, 16, 20, 25, 40, 50, 80, 100, 200, 400];
const light = () => { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } };
const defaults = (schema) => Object.fromEntries(schema.map((i) => [i.key, i.defval]));
const hhmm = (ms) => { try { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); } catch (e) { return ''; } };
const sgn = (v) => (v >= 0 ? '+' : '-') + fmtK(Math.abs(v));
function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
function idxOf(bars, t) {   // last bar with time <= t, or -1
  let lo = 0, hi = bars.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
function lastLE(arr, t) {   // index of the last item with .ts <= t, or -1
  let lo = 0, hi = arr.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].ts <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}

// ---------------------------------------------------------------------------------------- book samples: sums and rows
// A sample = { ts, mid, step, i0, v: Float32Array } one value per row of `step`, bids +, asks - (decodeBookHistory / BookFeed.pushCoarse).
const sums = new WeakMap();
function topSums(s, N) {   // resting size in the N rows nearest the touch on each side
  let m = sums.get(s); if (!m) { m = new Map(); sums.set(s, m); }
  let r = m.get(N); if (r) return r;
  const v = s.v, n = v.length; let bt = -1, at = -1, bid = 0, ask = 0;
  for (let k = n - 1; k >= 0; k--) if (v[k] > 0) { bt = k; break; }
  for (let k = 0; k < n; k++) if (v[k] < 0) { at = k; break; }
  if (bt >= 0) for (let k = bt; k > bt - N && k >= 0; k--) if (v[k] > 0) bid += v[k];
  if (at >= 0) for (let k = at; k < at + N && k < n; k++) if (v[k] < 0) ask -= v[k];
  r = { bid, ask }; m.set(N, r); return r;
}
const avgs = new WeakMap();
function avgSize(s) { let a = avgs.get(s); if (a == null) { let t = 0, c = 0; for (let k = 0; k < s.v.length; k++) if (s.v[k]) { t += Math.abs(s.v[k]); c++; } a = c ? t / c : 0; avgs.set(s, a); } return a; }
// resting size on one side in the rows r0..r1 (row index at the sample's own step)
function restRows(s, side, r0, r1) {
  let t = 0;
  for (let r = r0; r <= r1; r++) { const k = r - s.i0; if (k < 0 || k >= s.v.length) continue; const q = s.v[k]; if (side > 0 ? q > 0 : q < 0) t += Math.abs(q); }
  return t;
}

// ---------------------------------------------------------------------------------------- one hub per symbol (shared by the six indicators)
const hubs = new Map();
let H = null;
class Hub {
  constructor(spec, firstT) {
    this.spec = spec; this.kind = spec.kind; this.refs = 0; this.ls = new Set(); this.v = 0; this.memo = {};
    const poke = () => this.poke();
    if (spec.kind === 'futures') {
      this.book = H.acquireBookFeed('tsl2', spec.root, poke, l2Source(spec.root));   // the heatmap's own feed object (same key): history + live, one fetch
      this.ts = tsOpen(spec.root, firstT, poke);                                       // the L1 tools' 48 h trade store
    } else {
      this.book = H.acquireBookFeed(spec.venue || 'binance', spec.ticker, poke);
      this.cfRoot = (spec.venue || 'binance') + ':' + spec.ticker;
    }
    this.feed = this.book.feed;
  }
  poke() { this.v++; this.ls.forEach((f) => { try { f(); } catch (e) {} }); }
  release() { this.book.release(); if (this.ts) this.ts.release(); }
  cf() { return this.kind === 'crypto' ? cryptoFeed(this.cfRoot) : null; }   // touching it keeps the stream alive
  tick() { return this.kind === 'futures' ? this.spec.tick : (this.cf().tick || 0); }
  samples() { return this.feed.allHistory(); }
  sampleAt(t, maxAge = GAP_MAX) { const a = this.samples(), i = lastLE(a, t); return i >= 0 && t - a[i].ts <= maxAge ? a[i] : null; }
  tver() { return this.kind === 'futures' ? this.ts.s.v : this.cf().v; }
  fver() { return this.kind === 'futures' ? this.footFeed().v : this.cf().v; }
  footFeed() { return rootState(this.spec.root).trades; }
  // 1-minute rows { t, buy, sell, hi, lo } of trades (futures: 48 h from the L1 store; crypto: the stream's backfill)
  minutes() {
    const key = this.tver(); if (this.memo.mk === key) return this.memo.m;
    let m;
    if (this.kind === 'futures') m = this.ts.mins();
    else { const f = this.cf(); m = f.bars().filter((b) => b.t >= f.coverFrom).map((b) => ({ t: b.t, buy: (b.vol + b.delta) / 2, sell: (b.vol - b.delta) / 2, hi: b.dmax, lo: b.dmin })); }
    this.memo.mk = key; this.memo.m = m; return m;
  }
  tradeBars(tf) { const k = this.tver() + '|' + tf; if (this.memo.tk !== k) { this.memo.tk = k; this.memo.tb = new Map(aggregateMins(this.minutes(), tf).map((b) => [b.t, b])); } return this.memo.tb; }
  // per-price minutes (footprint): futures from the hub's TickFeed (3 h), crypto from the stream
  footBars() {
    const f = this.kind === 'futures' ? this.footFeed() : this.cf();
    if (!f) return { bars: [], tick: 0 };
    return { bars: f.bars().filter((b) => b.t >= f.coverFrom), tick: f.tick || 0, from: f.coverFrom };
  }
  footAgg(tf) {
    const k = this.fver() + '|' + tf; if (this.memo.fk === k) return this.memo.fa;
    const fb = this.footBars(), map = new Map(aggregate(fb.bars, tf).map((b) => [b.t, b]));
    this.memo.fk = k; this.memo.fa = { map, tick: fb.tick, from: fb.from }; return this.memo.fa;
  }
  prints() {   // [ms, tick idx, size, side 1 buy] for Big Trades
    const k = this.tver(); if (this.memo.pk === k) return this.memo.p;
    let p, floor = 0;
    if (this.kind === 'futures') { const s = this.ts.s; p = s.trades.map((x) => [x[0], Math.round(x[1] / s.tick), x[2], x[3] > 0 ? 1 : 0]); floor = s.floor; }
    else { p = []; for (const b of this.cf().bars()) for (const x of b.bigs || []) p.push(x); }
    this.memo.pk = k; this.memo.p = p; this.memo.floor = floor; return p;
  }
  // book delta per chart bar: change of resting bid size minus change of resting ask size over the bar (top N rows); pulled / added = size taken away / put in
  bookSeries(N, bars, tf) {
    const a = this.samples(), key = a.length + '|' + (a.length ? a[a.length - 1].ts : 0) + '|' + N + '|' + tf + '|' + bars.length + '|' + (bars.length ? bars[0].time : 0);
    if (this.memo.bk === key) return this.memo.bs;
    const n = bars.length, bd = new Array(n).fill(null), pulled = new Array(n).fill(0), added = new Array(n).fill(0), end = n ? bars[n - 1].time + tf : 0;
    let prev = null, prevTs = 0;
    for (const s of a) {
      const cur = topSums(s, N);
      if (prev && s.ts - prevTs > 0 && s.ts - prevTs <= GAP_MAX && s.ts < end) {
        const i = idxOf(bars, s.ts);
        if (i >= 0) {
          const db = cur.bid - prev.bid, da = cur.ask - prev.ask;
          bd[i] = (bd[i] || 0) + db - da; added[i] += Math.max(db, 0) + Math.max(da, 0); pulled[i] += Math.max(-db, 0) + Math.max(-da, 0);
        }
      }
      prev = cur; prevTs = s.ts;
    }
    this.memo.bk = key; this.memo.bs = { bd, pulled, added }; return this.memo.bs;
  }
  // average resting size per row over the session so far (time weighted), rows of the newest sample's step
  restProfile(ss) {
    const a = this.samples(), last = a[a.length - 1];
    if (!last) return null;
    const key = ss + '|' + a.length + '|' + Math.floor(last.ts / 5000);
    if (this.memo.rk === key) return this.memo.rp;
    const S = last.step, bid = new Map(), ask = new Map(); let W = 0, first = 0;
    for (let j = lastLE(a, ss - 1) + 1; j < a.length; j++) {
      const s = a[j], w = Math.min(j + 1 < a.length ? a[j + 1].ts - s.ts : 5000, GAP_MAX);
      if (Math.abs(s.step - S) > 1e-9 * S || !(w > 0)) continue;
      if (!first) first = s.ts;
      W += w;
      for (let k = 0; k < s.v.length; k++) { const q = s.v[k]; if (q) { const m = q > 0 ? bid : ask, r = s.i0 + k; m.set(r, (m.get(r) || 0) + Math.abs(q) * w); } }
    }
    const out = W > 0 ? { S, W, first, bid: new Map([...bid].map(([r, q]) => [r, q / W])), ask: new Map([...ask].map(([r, q]) => [r, q / W])) } : null;
    this.memo.rk = key; this.memo.rp = out; return out;
  }
}
function acquireHub(spec, firstT, listener) {
  let h = hubs.get(spec.key);
  if (!h) { h = new Hub(spec, firstT); hubs.set(spec.key, h); }
  h.refs++; h.ls.add(listener);
  return { h, release() { h.ls.delete(listener); if (--h.refs <= 0) { h.release(); hubs.delete(spec.key); } } };
}
function specOf(ctx) {
  const sym = String(ctx.symbol || ''), m = /^([a-z0-9]+):(.+)$/i.exec(sym), prov = m ? m[1].toLowerCase() : '', tk = m ? m[2] : sym;
  let p2 = prov, t2 = tk; try { const r = ctx.data.resolve(ctx.symbol); if (r && r.provider) { p2 = String(r.provider).toLowerCase(); t2 = r.ticker || tk; } } catch (e) {}
  if (p2 === 'futures' || (p2 !== 'binance' && /1!$/.test(t2))) { const root = l2Root(t2); return root ? { kind: 'futures', root, key: 'f|' + root, tick: L2_TICK[root] || 0.25 } : null; }
  if (prov === 'binance') { const t = tk.toUpperCase().replace(/\.P$/, ''); return { kind: 'crypto', ticker: t, key: 'c|' + t }; }
  if (prov && isCrypto(prov + ':' + tk)) { const t = tk.toUpperCase(); return { kind: 'crypto', venue: prov, ticker: t, key: 'c|' + prov + '|' + t }; }   // other venues (orderflow-venues.js)
  return null;
}

// ---------------------------------------------------------------------------------------- settings
const LADDER = ['stk_l2f_lad'];   // price-axis ladder: a price-pane overlay; Delta (L2) and CVD (L2) add it when they start (a sub-pane layer cannot draw on the price scale)
const ladders = [];
const LAD_SCHEMA = [
  { key: 'ladder', title: 'Show the ladder', type: 'bool', defval: true, tooltip: 'One bar per price: traded delta (green buy / red sell), and a thin second bar for the book: size added minus pulled at that price.' },
  { key: 'ladWidth', title: 'Ladder width (% of the chart)', type: 'int', defval: 16, min: 5, max: 40, step: 1 },
  { key: 'ladRange', title: 'Ladder range', type: 'string', defval: 'visible', options: ['visible', 'session'] }];
const ROWS = { key: 'rows', title: 'Book rows each side of price (top N levels)', type: 'int', defval: 10, min: 1, max: 40, step: 1, tooltip: 'Counts the N book rows nearest the best bid and the best ask. A row is one recorded price step.' };
const SCHEMA = {
  stk_l2f_delta: [ROWS,
    { key: 'tradeUp', title: 'Trade delta: buying', type: 'color', defval: UP }, { key: 'tradeDn', title: 'Trade delta: selling', type: 'color', defval: DN },
    { key: 'bookUp', title: 'Book delta: bid side added', type: 'color', defval: CYAN }, { key: 'bookDn', title: 'Book delta: ask side added', type: 'color', defval: AMBER }],
  stk_l2f_cvd: [ROWS,
    { key: 'style', title: 'Show as', type: 'string', defval: 'candles', options: ['candles', 'line'] },
    { key: 'reset', title: 'Reset', type: 'string', defval: 'session', options: ['session', 'day', 'none'], tooltip: 'session = the CME day (18:00 New York); crypto = the UTC day.' },
    { key: 'showTrade', title: 'Also show trade-only delta (dashed)', type: 'bool', defval: true },
    { key: 'upColor', title: 'Up', type: 'color', defval: UP }, { key: 'downColor', title: 'Down', type: 'color', defval: DN }],
  stk_l2f_fp: [
    { key: 'rowTicks', title: 'Row size (ticks, 0 = auto)', type: 'int', defval: 0, min: 0, max: 400, step: 1 },
    { key: 'mult', title: 'Highlight resting size above (x average)', type: 'float', defval: 3, min: 1.5, max: 20, step: 0.5 },
    { key: 'numbers', title: 'Show traded numbers', type: 'bool', defval: true },
    { key: 'buyColor', title: 'Buyers', type: 'color', defval: UP }, { key: 'sellColor', title: 'Sellers', type: 'color', defval: DN },
    { key: 'bidColor', title: 'Resting bids', type: 'color', defval: CYAN }, { key: 'askColor', title: 'Resting asks', type: 'color', defval: AMBER }],
  stk_l2f_big: BT.schema().filter((x) => !['absorption', 'sweep', 'extend'].includes(x.key)).concat([
    { group: 'Plot', key: 'tags', title: 'Show W / C / P tags', type: 'bool', defval: true, tooltip: 'W = the order hit a resting wall that held. C = the resting size was consumed. P = the resting size was pulled.' }]),
  stk_l2f_stop: [
    { key: 'len', title: 'Swing length (bars)', type: 'int', defval: 5, min: 2, max: 50, step: 1 },
    { key: 'levels', title: 'Liquidity pulled / consumed through at least (levels)', type: 'int', defval: 3, min: 1, max: 20, step: 1 },
    { key: 'volMult', title: 'Volume spike (x average)', type: 'float', defval: 1.5, min: 1, max: 10, step: 0.1 },
    { key: 'showAll', title: 'Also show sweeps the book did not confirm (hollow)', type: 'bool', defval: false },
    { key: 'upColor', title: 'Lows swept (bullish)', type: 'color', defval: UP }, { key: 'downColor', title: 'Highs swept (bearish)', type: 'color', defval: DN }],
  stk_l2f_lad: LAD_SCHEMA.slice(1),
  stk_l2f_dp: [
    { key: 'range', title: 'Range', type: 'string', defval: 'Rolling time', options: ['Rolling time', 'Fixed range', 'Session'], tooltip: 'Rolling time = the last N minutes, updating as trades arrive. Fixed range = from the start bar to the end bar you pick (picker row "Delta Profile (L2): click two bars"). Session = since the CME day opened (18:00 New York).' },
    { key: 'minutes', title: 'Minutes (window / reset interval)', type: 'string', defval: '15', options: ['5', '15', '30', '60', 'Custom'] },
    { key: 'windowMode', title: 'Window mode (Rolling time only)', type: 'string', defval: 'Rolling', options: ['Rolling', 'Reset every interval'], tooltip: 'Rolling = always the last N minutes. Reset every interval = the profile fills from the start of each N-minute block (clock boundaries in the exchange time zone: New York for futures, UTC for crypto), then clears and starts fresh at the next block.' },
    { key: 'prevPoc', title: 'Reset mode: keep the previous block\'s POC as a faint line', type: 'bool', defval: false },
    { key: 'customMins', title: 'Custom minutes', type: 'int', defval: 20, min: 1, max: 360, step: 1 },
    { key: 'rangeStart', title: 'Fixed range: start (bar time)', type: 'time', defval: 0 },
    { key: 'rangeEnd', title: 'Fixed range: end (bar time, empty = now)', type: 'time', defval: 0 },
    { key: 'widthPct', title: 'Width (% of the chart)', type: 'int', defval: 18, min: 8, max: 40, step: 1 },
    { key: 'showVol', title: 'Show volume behind the bars (grey)', type: 'bool', defval: false },
    { key: 'posColor', title: 'Buying (right of zero)', type: 'color', defval: UP }, { key: 'negColor', title: 'Selling (left of zero)', type: 'color', defval: DN }],
  stk_l2f_sw: [
    { key: 'len', title: 'Swing length (bars each side)', type: 'int', defval: 10, min: 2, max: 50, step: 1, tooltip: 'A swing high / low is confirmed only when this many bars on each side are lower / higher, so a drawn leg never repaints.' },
    { key: 'legs', title: 'Legs to show (newest first)', type: 'int', defval: 6, min: 1, max: 30, step: 1 },
    { key: 'vwap', title: 'Anchored VWAP', type: 'bool', defval: true },
    { key: 'bands', title: 'VWAP bands (±1 / ±2 SD)', type: 'bool', defval: false },
    { key: 'profile', title: 'Volume profile', type: 'bool', defval: true },
    { key: 'pshow', title: 'Profile shows', type: 'string', defval: 'Volume', options: ['Volume', 'Volume + Delta'], tooltip: 'Volume + Delta: delta bars (green buying, red selling) on the left of the swing\'s anchor line, volume bars on the right. Older swings without exact trade data show volume only.' },
    { key: 'rows', title: 'Rows (0 = auto, else 10 to 200)', type: 'int', defval: 0, min: 0, max: 200, step: 1, tooltip: 'Fixed number of price rows in each swing\'s profile. POC, VAH and VAL follow the rows. Overrides the row size below.' },
    { key: 'rowTicks', title: 'Row size (ticks, 0 = auto)', type: 'int', defval: 0, min: 0, max: 400, step: 1 },
    { key: 'widthPct', title: 'Profile width (% of the leg)', type: 'int', defval: 40, min: 10, max: 100, step: 5 },
    { key: 'anchor', title: 'Profile edge', type: 'string', defval: 'Left', options: ['Left', 'Right'] },
    { key: 'va', title: 'Value area (%)', type: 'int', defval: 70, min: 10, max: 100, step: 1 },
    { key: 'delta', title: 'Delta colouring (buy / sell per row)', type: 'bool', defval: false },
    { key: 'extend', title: 'Extend POC until touched', type: 'bool', defval: false },
    { key: 'labels', title: 'Show POC / VAH / VAL prices', type: 'bool', defval: true },
    { key: 'buyColor', title: 'Buy / up leg', type: 'color', defval: UP }, { key: 'sellColor', title: 'Sell / down leg', type: 'color', defval: DN },
    { key: 'pocColor', title: 'POC', type: 'color', defval: AMBER }, { key: 'vaColor', title: 'VAH / VAL', type: 'color', defval: CYAN }, { key: 'vwapColor', title: 'VWAP', type: 'color', defval: VIOLET }],
  stk_l2f_vp: [
    { key: 'view', title: 'View', type: 'string', defval: 'Volume', options: ['Volume', 'Delta', 'Both'], tooltip: 'Delta = traded buy minus sell at each price (green right of the centre line, red left).' },
    { key: 'widthPct', title: 'Width of each profile (% of the chart)', type: 'int', defval: 14, min: 5, max: 30, step: 1 },
    { key: 'tradedColor', title: 'Traded', type: 'color', defval: CYAN },
    { key: 'bidColor', title: 'Resting bids', type: 'color', defval: UP }, { key: 'askColor', title: 'Resting asks', type: 'color', defval: DN }]
};
const TITLES = {
  stk_l2f_delta: ['Delta (L2)', 'Delta L2', 'new', false],
  stk_l2f_cvd: ['Cumulative Delta (L2)', 'CVD L2', 'new', false],
  stk_l2f_fp: ['Footprint (L2)', 'Footprint L2', 'price', true],
  stk_l2f_big: ['Big Trades (L2)', 'Big Trades L2', 'price', true],
  stk_l2f_stop: ['Stop Runs (L2)', 'Stop Runs L2', 'price', true],
  stk_l2f_vp: ['Volume Profile (L2)', 'Volume Profile L2', 'price', true],
  stk_l2f_lad: ['Delta Ladder (L2)', 'Delta Ladder L2', 'price', true],
  stk_l2f_dp: ['Delta Profile (L2)', 'Delta Profile L2', 'price', true],
  stk_l2f_sw: ['Swing VWAP + Profile (L2)', 'Swing VWAP L2', 'price', true]
};
const LAYERS = ['stk_l2f_fp', 'stk_l2f_big', 'stk_l2f_stop', 'stk_l2f_vp', 'stk_l2f_dp', 'stk_l2f_sw'];

// ---------------------------------------------------------------------------------------- the indicator
// Overlay tools state themselves in a one-line plate drawn by their own layer, stacked down the top right (a chart table would pile up on top of the others).
const ovLive = [];
function plateLine(g, a, owner, W) {
  let txt = owner.text; if (!txt) return;
  const slot = ovLive.filter((x) => x.on).indexOf(owner); if (slot < 0) return;
  const phone = a.coords.width < 520;
  g.save(); g.font = '600 ' + (phone ? 9 : 10) + 'px ' + MONO; g.textAlign = 'right'; g.textBaseline = 'middle';
  const room = phone ? a.coords.width * 0.46 : a.coords.width - 70; while (txt.length > 8 && g.measureText(txt).width + 10 > room) txt = txt.slice(0, -2).replace(/[ ·]+$/, '') + '…';   // phone: never wider than the chart minus the price scale
  const tw = g.measureText(txt).width + 10, y = a.bounds.top + 10 + slot * 17, x = a.coords.width - 6;
  g.fillStyle = plate(); g.fillRect(x - tw, y - 7, tw, 14); g.fillStyle = light() ? '#0e7490' : '#4fd1d9'; g.fillText(txt, x - 5, y); g.restore();
}
class L2Flow {
  constructor(type) { this.type = type; this.inputs = defaults(SCHEMA[type]); this.tm = 0; this.last = 0; this.u = null; this.spec = null; this.on = false; this.off = false; this.memo = {}; this.onAny = () => this.later(); this.onTier = () => { this.memo = {}; this.later(); }; }
  start(ctx, inputs) { this.ctx = ctx; if (LAYERS.includes(this.type)) ovLive.push(this); if (LADDER.includes(this.type)) ladders.push(this); this.inputs = Object.assign(defaults(SCHEMA[this.type]), inputs); this.on = true; this.onVis = () => { if (!document.hidden) this.later(); }; document.addEventListener('visibilitychange', this.onVis); window.addEventListener('stryker:l2tier', this.onTier); this.offRt = rtOnChange(this.onTier); if (this.type === 'stk_l2f_dp') this.clock = setInterval(() => this.later(), 15000); this.render(); }
  later() { if (this.tm || this.off || document.hidden) return; this.tm = setTimeout(() => { this.tm = 0; this.render(); }, Math.max(0, MIN_GAP - (Date.now() - this.last))); }
  onBars() { this.later(); }
  onViewport() { if (LAYERS.includes(this.type)) this.push(); else if (LADDER.includes(this.type)) this.pushLadder(); }
  // Delta / CVD (L2) bring the ladder with them once, unless one is already on the chart (a saved layout, or the member removed it)
  addLadder() {
    try { const c = this.ctx.chart || window.STRYKER_VELA.chart; if (this.ladAdded || !c || (c.indicators() || []).some((h) => h.nativeType === 'stk_l2f_lad')) { this.ladAdded = true; return this.push({ off: true }); } this.ladAdded = true; setTimeout(() => { try { c.addNativeIndicator('stk_l2f_lad', {}); window.STRYKER_VELA.context().stateChanged(); } catch (e) {} }, 0); } catch (e) {}
    this.push({ off: true });
  }
  pushLadder() { this.push(this.hub && this.inputs.ladder !== false ? { hub: this.hub, v: this.hub.v + ':' + this.hub.fver() + ':' + this.inputs.ladWidth + this.inputs.ladRange } : { off: true }); }
  setInputs(i) { this.inputs = Object.assign(defaults(SCHEMA[this.type]), i); this.memo = {}; this.render(); }
  suspend() { this.on = false; clearTimeout(this.tm); this.tm = 0; this.push(); }
  resume() { this.on = true; this.render(); }
  stop() { const k = ovLive.indexOf(this); if (k >= 0) ovLive.splice(k, 1); const kl = ladders.indexOf(this); if (kl >= 0) ladders.splice(kl, 1); this.off = true; this.on = false; clearTimeout(this.tm); clearInterval(this.clock); document.removeEventListener('visibilitychange', this.onVis); window.removeEventListener('stryker:l2tier', this.onTier); if (this.offRt) this.offRt(); this.unbind(); this.push(); }
  unbind() { this.hub = null; if (this.u) { this.u.release(); this.u = null; this.spec = null; } }
  push(extra) { try { this.ctx.pushData(Object.assign({ owner: this, on: this.on && !this.off, type: this.type }, extra || {})); } catch (e) {} }
  ov(...lines) { this.text = this.base = lines.filter(Boolean).join(' · '); this.ctx.emit({ tables: [] }); }
  say(txt) {
    this.text = ''; this.ctx.setStatus('idle');
    this.ctx.emit({ series: [], tables: [H.message(this.type + '-msg', txt, H.pageIsDay(), 'top_right')] });
    this.push({ off: true });
  }
  legend(lines, color) {
    const day = light();
    return { id: this.type + '-leg', paneId: '', position: 'top_right', columns: 1, rows: lines.length, bgColor: day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.88)', frameWidth: 0, borderWidth: 0,
      cells: lines.map((t, i) => [{ text: t, textColor: i === 0 && color ? color : (day ? '#334155' : '#a3a9b6'), hAlign: 'right', vAlign: 'center', textSize: 'small', fontFamily: 'monospace', bold: i === 0, italic: false }]), merges: [] };
  }
  render() {
    this.last = Date.now();
    if (!this.ctx || this.off) return;
    try { this.draw(); } catch (e) { console.warn('TradeZoro: ' + this.type, e); window.__l2fErr = String(e && e.stack || e).slice(0, 400); }
  }
  draw() {
    const ctx = this.ctx, spec = specOf(ctx);
    if (!spec) { this.unbind(); return this.say(NEED); }
    if (spec.kind === 'futures' ? !l2Badge() : isFree()) { this.unbind(); return this.say(NOT_YET); }
    const bars = ctx.bars();
    if (!bars.length) { ctx.setStatus('loading'); return; }
    if (!this.spec || this.spec.key !== spec.key) { this.unbind(); this.u = acquireHub(spec, bars[0].time, this.onAny); this.spec = spec; }
    const hub = this.u.h, tf = bars.length > 1 ? bars[bars.length - 1].time - bars[bars.length - 2].time : 60000;
    if (tf < 60000 || tf > 4 * 3600000) return this.say('Works on 1-minute to 4-hour charts.');
    hub.feed.needRemote(bars[0].time);          // book history back to the left edge of the chart (the heatmap's own loader, one request in flight)
    if (hub.ts) hub.ts.need(Math.min(bars[0].time, Date.now() - BT.REF_MS));   // trade history back to the left edge, and at least Big Trades' 24 h reference
    const samples = hub.samples(), first = samples.length ? samples[0].ts : 0;
    const since = first && first > bars[0].time + 120000 ? 'Book history from ' + hhmm(first) : '';
    const t = this.type;
    ctx.setStatus(samples.length ? 'live' : 'loading');
    if (t === 'stk_l2f_lad') { this.hub = hub; this.ov('Delta Ladder (L2)'); return this.pushLadder(); }
    if (t === 'stk_l2f_dp') return this.drawDp(hub, bars, tf);
    if (t === 'stk_l2f_sw') return this.drawSw(hub, bars, tf);
    if (t === 'stk_l2f_delta') return this.drawDelta(hub, bars, tf, since);
    if (t === 'stk_l2f_cvd') return this.drawCvd(hub, bars, tf, since);
    if (t === 'stk_l2f_fp') return this.drawFp(hub, bars, tf, since);
    if (t === 'stk_l2f_big') return this.drawBig(hub, bars, tf, since);
    if (t === 'stk_l2f_stop') return this.drawStop(hub, bars, tf, since);
    return this.drawVp(hub, bars, tf, since);
  }
  // per bar: trade delta, book delta
  deltas(hub, bars, tf) {
    const N = clamp(Math.round(num(this.inputs.rows, 10)), 1, 40), agg = hub.tradeBars(tf), bk = hub.bookSeries(N, bars, tf);
    const T = bars.map((b) => { const x = agg.get(b.time); return x ? x.delta : null; });
    return { T, B: bk.bd, bk, N };
  }
  noteLine(hub, since, T) {
    if (since) return since;
    return T.some((x) => x != null) || hub.samples().length ? 'order book + trades' : 'Loading order-book and trade history…';
  }
  drawDelta(hub, bars, tf, since) {
    const I = this.inputs, { T, B, bk } = this.deltas(hub, bars, tf), mk = (f) => bars.map((b, i) => (T[i] == null && B[i] == null ? { time: b.time, value: null } : f(T[i] || 0, B[i] || 0)));
    const pts = (fn) => mk((t, b) => fn(t, b));
    const topPos = pts((t, b) => ({ time: 0, value: Math.max(t, 0) + Math.max(b, 0), color: rgba(I.bookUp, 0.85) })), topNeg = pts((t, b) => ({ time: 0, value: Math.min(t, 0) + Math.min(b, 0), color: rgba(I.bookDn, 0.85) }));
    const tr = pts((t) => ({ time: 0, value: t, color: rgba(t >= 0 ? I.tradeUp : I.tradeDn, 0.95) }));
    const fix = (a) => a.map((p, i) => Object.assign(p, { time: bars[i].time }));
    const hist = (id, title, a) => ({ id, title, paneId: '', kind: 'histogram', points: fix(a), style: { color: I.tradeUp, width: 1, lineStyle: 'solid', base: 0 } });
    const li = B.length - 1;
    let lastI = li; while (lastI > 0 && T[lastI] == null && B[lastI] == null) lastI--;
    const sumP = bk.pulled.reduce((x, y) => x + y, 0), sumA = bk.added.reduce((x, y) => x + y, 0);
    this.ctx.emit({
      series: [hist('l2f-bpos', 'Book delta (bid side added)', topPos), hist('l2f-bneg', 'Book delta (ask side added)', topNeg), hist('l2f-trade', 'Trade delta', tr)],
      priceLines: [{ id: 'l2f-d0', paneId: '', price: 0, color: light() ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.3)', lineStyle: 'dashed', width: 1, title: '' }],
      tables: [this.legend(['Delta (L2) trade ' + (T[lastI] == null ? 'n/a' : sgn(T[lastI])) + ' · book ' + (B[lastI] == null ? 'n/a' : sgn(B[lastI])),
        'Bar: pulled ' + fmtK(bk.pulled[lastI] || 0) + ' · added ' + fmtK(bk.added[lastI] || 0), 'Shown: pulled ' + fmtK(sumP) + ' · added ' + fmtK(sumA), this.noteLine(hub, since, T)], B[lastI] >= 0 ? I.bookUp : I.bookDn)]
    });
    this.stat(bars, (i) => T[i] != null || B[i] != null);
    this.addLadder();
  }
  drawCvd(hub, bars, tf, since) {
    const I = this.inputs, { T, B } = this.deltas(hub, bars, tf), kind = hub.kind, ss = (t) => (I.reset === 'none' ? 0 : I.reset === 'day' ? Math.floor(t / 86400000) : sessionStart(t, kind));
    let acc = 0, accT = 0, key = null; const cs = [], ls = [], ts = [];
    bars.forEach((b, i) => {
      if (T[i] == null && B[i] == null) { ls.push(null); ts.push(null); cs.push({ open: acc, high: acc, low: acc, close: acc }); return; }   // candles are one per chart bar, no time field (the chart reads them by position, like chart-footprint.js)
      const k = ss(b.time); if (k !== key) { key = k; acc = 0; accT = 0; }
      const o = acc; acc += (T[i] || 0) + (B[i] || 0); accT += T[i] || 0;
      cs.push({ open: o, high: Math.max(o, acc), low: Math.min(o, acc), close: acc }); ls.push(acc); ts.push(accT);
    });
    const series = [];
    if (I.style === 'line') series.push(H.line('l2f-cvd', 'CVD (L2)', bars, ls, I.upColor, 2));
    else if (cs.length >= 20) series.push({ id: 'l2f-cvd', title: 'CVD (L2)', paneId: '', kind: 'candle', bars: cs, style: { up: I.upColor, down: I.downColor } });
    if (I.showTrade !== false) series.push(H.line('l2f-cvdt', 'CVD trade only', bars, ts, light() ? '#64748b' : '#8a90a0', 1, 'dashed'));
    const now = ls.length ? [...ls].reverse().find((x) => x != null) : null;
    this.ctx.emit({ series, tables: [this.legend(['CVD (L2) ' + (now == null ? '…' : sgn(now)) + ' · reset ' + I.reset, this.noteLine(hub, since, T)], I.upColor)] });
    this.stat(bars, (i) => ls[i] != null);
    this.addLadder();
  }
  stat(bars, has) { let n = 0; for (let i = 0; i < bars.length; i++) if (has(i)) n++; (window.__stkL2Flow || (window.__stkL2Flow = {}))[this.type] = Object.assign((window.__stkL2Flow || {})[this.type] || {}, { n, bars: bars.length }); }
  drawFp(hub, bars, tf, since) {
    const fa = hub.footAgg(tf);
    this.ov('Footprint (L2): traded | resting at close', fa.from && fa.from > bars[0].time ? 'traded from ' + hhmm(fa.from) : '');
    this.stat(bars, (i) => fa.map.has(bars[i].time));
    this.push({ hub, v: hub.v + ':' + hub.fver() });
  }
  drawBig(hub, bars, tf, since) {
    const I = this.inputs, key = hub.tver() + '|' + bars.length + '|' + bars[0].time + '|' + JSON.stringify(I) + '|' + hub.samples().length;
    if (this.memo.bk !== key) {
      const tick = hub.tick(), raw = hub.prints(), sel = tick && raw.length ? BT.select(raw, I, { floor: hub.memo.floor || 0, bars, tfMs: tf, tick }) : { list: [], thr: 0, all: 0 };
      const cnt = { W: 0, C: 0, P: 0, none: 0 };
      for (const p of sel.list) { p.kind = classify(hub, p, tick); cnt[p.kind || 'none']++; }
      this.memo.bk = key; this.memo.sel = sel; this.memo.cnt = cnt; this.memo.tick = tick;
    }
    const { sel, cnt } = this.memo;
    this.ov('Big Trades (L2) ' + sel.list.length, 'W wall ' + cnt.W, 'C consumed ' + cnt.C, 'P pulled ' + cnt.P, cnt.none ? cnt.none + ' no book' : '');
    this.stat(bars, (i) => sel.list.some((p) => idxOf(bars, p.ms) === i));
    window.__stkL2Flow.stk_l2f_big.prints = sel.list.length; window.__stkL2Flow.stk_l2f_big.tagged = sel.list.length - cnt.none;
    this.push({ sel, tick: this.memo.tick });
  }
  drawStop(hub, bars, tf, since) {
    const I = this.inputs, key = bars.length + '|' + bars[0].time + '|' + bars[bars.length - 1].close + '|' + I.len + '|' + I.volMult + '|' + I.levels + '|' + hub.samples().length;
    if (this.memo.sk !== key) {
      const tick = hub.tick() || 0.25, raw = bars.length > 12 ? sweepEvents(sweepBars(bars, null).slice(0, -1), { len: clamp(Math.round(num(I.len, 5)), 2, 50), volMult: num(I.volMult, 1.5) }) : [];
      const ev = raw.map((e) => Object.assign({}, e, stopRun(hub, bars[e.i], e, tf, clamp(Math.round(num(I.levels, 3)), 1, 20))));
      this.memo.sk = key; this.memo.ev = ev;
    }
    const ev = this.memo.ev, ok = ev.filter((e) => e.ok).length, unk = ev.filter((e) => e.known === false).length;
    this.ov('Stop Runs (L2) ' + ok + ' of ' + ev.length + ' sweeps confirmed (' + I.levels + '+ levels)', unk ? unk + ' no book' : '');
    this.stat(bars, (i) => ev.some((e) => e.i === i));
    window.__stkL2Flow.stk_l2f_stop.sweeps = ev.length; window.__stkL2Flow.stk_l2f_stop.confirmed = ok;
    this.push({ ev });
  }
  // Delta Profile (L2): the window's per-tick table is kept by a DeltaAcc (incremental); the layer groups it into rows at draw time.
  drawDp(hub, bars, tf) {
    const I = this.inputs, mode = I.range === 'Fixed range' ? 'fixed' : I.range === 'Session' ? 'session' : I.windowMode === 'Reset every interval' ? 'block' : 'rolling', now = Date.now();
    const mins = I.minutes === 'Custom' ? clamp(Math.round(num(I.customMins, 20)), 1, 360) : (Number(I.minutes) || 15);
    const label = mode === 'fixed' ? 'range' : mode === 'session' ? 'session' : mode === 'block' ? mins + 'm block' : mins + 'm';
    if (mode === 'fixed' && !(num(I.rangeStart, 0) > 0)) { this.ov('Delta Profile (L2): no range yet'); this.push({ off: true }); return this.say('Pick a range: Indicators > "Delta Profile (L2): click two bars", or set start and end in the settings.'); }
    const w = windowOf(mode, { now, mins, start: num(I.rangeStart, 0), end: num(I.rangeEnd, 0), sessionStart: sessionStart(bars[bars.length - 1].time, hub.kind), offset: hub.kind === 'crypto' ? 0 : nyOffsetMs(now) });
    const acc = this.acc || (this.acc = new DeltaAcc()), fb = hub.footBars();
    acc.update(fb.bars, w.from, w.to);
    let prevPoc = null;
    if (mode === 'block' && I.prevPoc === true) {   // POC (most traded tick) of the block that just ended, from its own table
      const pa = this.pacc || (this.pacc = new DeltaAcc()); pa.update(fb.bars, w.prevFrom, w.prevTo);
      let bv = 0; for (const [k, e] of pa.tab) if (e[0] + e[1] > bv) { bv = e[0] + e[1]; prevPoc = k; }
    }
    const from = acc.first(), part = acc.cur.size && from > w.from + MIN_COVER ? ' (trades from ' + hhmm(from) + ')' : '';
    this.ov('Delta Profile ' + label, acc.cur.size ? part.trim() : 'waiting for trades…');
    this.stat(bars, () => false); const st = window.__stkL2Flow.stk_l2f_dp; st.net = acc.net; st.ticks = acc.tab.size; st.minutes = acc.cur.size; st.touched = acc.touched; st.mode = mode; st.from = w.from; st.to = w.to; st.prevPoc = prevPoc;
    this.push({ hub, acc, prevPoc, v: hub.v + ':' + hub.fver() + ':' + acc.net + ':' + acc.cur.size + ':' + w.from + ':' + prevPoc });
  }
  // Swing VWAP + Profile (L2): frozen legs are cached; only the legs touching the newest pivot / bar are recomputed.
  drawSw(hub, bars, tf) {
    const I = this.inputs, fb = hub.footBars(), tick = hub.tick() || 0.25, cache = this.swCache || (this.swCache = new Map());
    const M = swingModel(bars, tf, I, fb, tick, cache), open = M.legs[M.legs.length - 1], ap = M.legs.filter((l) => l.approx).length;
    this.ov('Swing VWAP + Profile (L2) ' + M.legs.length + ' legs' + (ap ? ' · ' + ap + ' approx' : ''), !fb.bars.length ? 'waiting for trades…' : fb.from && fb.from > bars[0].time ? 'trades from ' + hhmm(fb.from) : '');
    this.stat(bars, () => false);
    Object.assign(window.__stkL2Flow.stk_l2f_sw, { legs: M.legs.length, pivots: M.pivots, computed: M.computed, approxLegs: ap, deltaDone: M.legs.filter((l) => !l.open && l.P && l.P.maxAbsDelta > 0).length, legBad: M.legs.filter((l) => { if (!l.P) return false; let hi = -Infinity, lo = Infinity; for (let i = l.a; i <= l.b; i++) { hi = Math.max(hi, bars[i].high); lo = Math.min(lo, bars[i].low); } const sl = l.m * tick; return [l.poc, l.vah, l.val].some((v) => v > hi + sl || v < lo - sl) || l.val > l.poc || l.poc > l.vah; }).length, openRows: open && open.P ? open.P.n : 0, openM: open && open.m, openDelta: open && open.P ? open.P.maxAbsDelta : 0, openDir: open ? open.dir : 0, openPoc: open && open.poc, openVah: open && open.vah, openVal: open && open.val, openVwap: open && open.vwap[open.vwap.length - 1], openA: open && open.a, openB: open && open.b });
    this.push({ model: M, v: hub.v + ':' + hub.fver() + ':' + bars.length + ':' + bars[bars.length - 1].close + ':' + bars[bars.length - 1].high + ':' + bars[bars.length - 1].low });
  }
  drawVp(hub, bars, tf, since) {
    const ss = sessionStart(bars[bars.length - 1].time, hub.kind), rp = hub.restProfile(ss);
    this.ov('Volume Profile (L2)', rp ? 'resting avg since ' + hhmm(Math.max(ss, rp.first)) : 'loading book history…');
    let rows = 0; if (rp) rows = new Set([...rp.bid.keys(), ...rp.ask.keys()]).size;
    this.stat(bars, () => false); window.__stkL2Flow.stk_l2f_vp.n = rows;
    this.push({ hub, ss, v: hub.v + ':' + hub.fver() });
  }
}

// ---------------------------------------------------------------------------------------- Big Trades: what did the book do around the print?
// W = the resting size at the levels the order hit is still >= half there afterwards (a wall that held); C = it fell and about as much traded
// as vanished (consumed); P = it fell by clearly more than traded (pulled). Needs a book sample just before and just after, else no tag.
function classify(hub, p, tick) {
  const before = hub.sampleAt(p.ms);
  if (!before) return '';
  const aa = hub.samples(), j = lastLE(aa, p.last + 300) + 1, after = aa[j];
  if (!after || after.ts - p.last > 150000 || Math.abs(after.step - before.step) > 1e-9 * before.step) return '';
  const S = before.step, r0 = Math.floor(p.lo * tick / S + 1e-9), r1 = Math.floor(p.hi * tick / S + 1e-9), side = p.side ? -1 : 1;   // a buy hits the asks
  const b = restRows(before, side, r0, r1), a = restRows(after, side, r0, r1);
  if (!(b > 0)) return '';
  if (a >= 0.5 * b) return 'W';
  return b - a <= 1.25 * p.size ? 'C' : 'P';
}
// Stop Runs: of the book rows between the bar's open (or the swept level) and its extreme, on the side that was run, how many lost half their size at some point in the bar?
function stopRun(hub, bar, e, tf, need) {
  const tick = hub.tick(), before = hub.sampleAt(bar.time);
  if (!tick || !before) return { known: false, ok: false, got: 0 };
  const S = before.step, side = e.side === 1 ? -1 : 1, lo = e.side === 1 ? Math.min(e.level, bar.open) : e.extreme, hi = e.side === 1 ? e.extreme : Math.max(e.level, bar.open);
  const r0 = Math.floor(lo / S + 1e-9), r1 = Math.floor(hi / S + 1e-9);
  const a = hub.samples(), min = new Map();
  for (let r = r0; r <= r1; r++) { const q = restRows(before, side, r, r); if (q > 0) min.set(r, q); }
  const orig = new Map(min);
  for (let j = lastLE(a, bar.time) + 1; j < a.length && a[j].ts < bar.time + tf; j++) {
    const s = a[j]; if (Math.abs(s.step - S) > 1e-9 * S) continue;
    for (const [r, q] of min) { const x = restRows(s, side, r, r); if (x < q) min.set(r, x); }
  }
  let got = 0; for (const [r, q0] of orig) if (min.get(r) <= 0.5 * q0) got++;
  return { known: true, ok: got >= need, got };
}

// ---------------------------------------------------------------------------------------- canvas layers
function frame(canvas, a) {
  const g = canvas && canvas.getContext('2d');
  if (!g) return null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  const d = a.data;
  if (!d || !d.owner || !d.owner.on || d.off || !a.bars || !a.bars.length) return null;
  const dpr = a.coords.dpr || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.save(); g.beginPath(); g.rect(0, a.bounds.top, a.coords.width, a.bounds.height); g.clip();
  return g;
}
const Yp = (a, p) => a.coords.priceToY(p, a.scale, a.bounds);
const plate = () => (light() ? 'rgba(255,255,255,0.9)' : 'rgba(11,11,13,0.85)');
const ink = () => (light() ? '#0f172a' : '#f4f4f6');
function tfOf(bars) { return bars.length > 1 ? bars[bars.length - 1].time - bars[bars.length - 2].time : 60000; }
function rowsOfSample(s, R) {   // resting size per row of R price units: Map row -> { bid, ask }
  const out = new Map();
  for (let k = 0; k < s.v.length; k++) {
    const q = s.v[k]; if (!q) continue;
    const lowP = (s.i0 + k) * s.step, per = s.step > R * 1.0001 ? Math.round(s.step / R) : 1, r0 = per > 1 ? Math.floor(lowP / R + 1e-9) : Math.floor((lowP + s.step / 2) / R + 1e-9);
    for (let j = 0; j < per; j++) { const e = out.get(r0 + j) || { bid: 0, ask: 0 }; if (q > 0) e.bid += q / per; else e.ask -= q / per; out.set(r0 + j, e); }
  }
  return out;
}
function fpLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a); if (!g) return;
      try {
        a.data.owner.text = a.data.owner.base;
        const d = a.data, I = d.owner.inputs, hub = d.hub, co = a.coords, phone = co.width < 520, tf = tfOf(a.bars);
        if (!hub) return;   // a viewport push before the first data push carries no hub
        const fa = hub.footAgg(tf), tick = fa.tick;
        if (!tick) return;
        const ppb = co.pxPerBar(), vr = co.visibleLogicalRange(), i0 = clamp(Math.floor(vr.from), 0, a.bars.length - 1), i1 = clamp(Math.ceil(vr.to), 0, a.bars.length - 1);
        const top = a.bounds.top, bot = top + a.bounds.height;
        if (ppb < (phone ? 28 : 34)) { g.font = '600 11px ' + MONO; g.textAlign = 'center'; d.owner.text = 'Footprint (L2): zoom in to see it'; return; }
        const newest = hub.samples()[hub.samples().length - 1], S = newest ? newest.step : tick;
        const tickPx = Math.abs(Yp(a, tick) - Yp(a, 0)), minPx = phone ? 16 : 12;
        let m = I.rowTicks > 0 ? I.rowTicks : ROW_STEPS.find((s) => tickPx * s >= minPx) || 400;
        m = Math.max(m, Math.round(S / tick));               // a row is never finer than the book's own rows
        const R = m * tick, mult = num(I.mult, 3), now = Date.now();
        const colW = Math.min(ppb * 0.92, 150), restW = colW * 0.3, trW = colW - restW - 2, fs = phone ? 9 : 10;
        g.font = '600 ' + fs + 'px ' + MONO; g.textBaseline = 'middle';
        let hot = 0;
        for (let i = i0; i <= i1; i++) {
          const b = a.bars[i], bar = fa.map.get(b.time), x = co.logicalToX(i), left = x - colW / 2;
          const s = hub.sampleAt(Math.min(b.time + tf, now) - 1, 6 * 60000), rest = s && s.ts >= b.time - 6 * 60000 ? rowsOfSample(s, R) : null, avg = s ? avgSize(s) : 0;
          const tr = new Map();
          if (bar) for (let j = 0; j < bar.buy.length; j++) { const r = Math.floor((bar.lo + j) * tick / R + 1e-9), e = tr.get(r) || { buy: 0, sell: 0 }; e.buy += bar.buy[j]; e.sell += bar.sell[j]; tr.set(r, e); }
          let mx = 1; tr.forEach((e) => { mx = Math.max(mx, e.buy + e.sell); });
          const keys = new Set([...tr.keys(), ...(rest ? rest.keys() : [])]);
          for (const r of keys) {
            const yT = Yp(a, (r + 1) * R), yB = Yp(a, r * R), y = Math.min(yT, yB), h = Math.max(1, Math.abs(yB - yT) - (Math.abs(yB - yT) > 4 ? 1 : 0));
            if (y > bot || y + h < top) continue;
            const e = rest && rest.get(r);
            if (e) {   // resting size at bar close, thin bar growing from the left edge of the candle column
              const q = Math.max(e.bid, e.ask), isBid = e.bid >= e.ask, big = avg > 0 && q >= mult * avg, col = isBid ? I.bidColor : I.askColor;
              const len = Math.max(1, Math.min(1, q / (avg * mult * 1.5 || 1)) * restW);
              g.fillStyle = rgba(col, big ? 0.95 : 0.5); g.fillRect(left, y, len, h);
              if (big) { g.strokeStyle = col; g.lineWidth = 1.5; g.strokeRect(left + 0.5, y + 0.5, Math.max(restW - 1, len - 1), h - 1); hot++; }
            }
            const t = tr.get(r);
            if (t) {
              const tot = t.buy + t.sell, w = Math.max(1, trW * tot / mx), x0 = left + restW + 2, wb = w * t.buy / tot;
              g.fillStyle = rgba(I.sellColor, 0.8); g.fillRect(x0, y, w - wb, h);
              g.fillStyle = rgba(I.buyColor, 0.8); g.fillRect(x0 + w - wb, y, wb, h);
              if (I.numbers !== false && h >= 11 && trW >= 40) { g.fillStyle = ink(); g.textAlign = 'left'; g.fillText(Math.round(t.sell) + 'x' + Math.round(t.buy), x0 + 2, y + h / 2); }
            }
          }
        }
        window.__stkL2Flow.stk_l2f_fp.hot = hot;
      } finally { try { plateLine(g, a, a.data.owner); } catch (e) {} g.restore(); }
    },
    destroy() { canvas = null; }
  };
}
function bigLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a); if (!g) return;
      try {
        const d = a.data, I = Object.assign({}, BT.DEFAULTS, d.owner.inputs), sel = d.sel, tick = d.tick, co = a.coords, phone = co.width < 520;
        if (!sel || !tick) return;
        const top = a.bounds.top, bot = top + a.bounds.height, vr = co.visibleLogicalRange(), t0 = a.bars[Math.max(0, Math.floor(vr.from))].time, t1 = a.bars[Math.min(a.bars.length - 1, Math.ceil(vr.to))].time + 86400000;
        const pos = new Map(), vis = sel.list.filter((p) => p.ms >= t0 && p.ms <= t1);
        const kept = BT.cap(vis, phone ? 10 : 14, (p) => { const i = idxOf(a.bars, p.ms); if (i < 0) return null; pos.set(p, i); return co.logicalToX(i); });
        const placed = [], items = [], col = { W: AMBER, C: VIOLET, P: CYAN };
        for (const p of kept.sort((x, y) => y.impact - x.impact)) {
          const x = co.logicalToX(pos.get(p)), y = Yp(a, p.vwap * tick); if (y < top - 30 || y > bot + 30) continue;
          const r = BT.radius(p.impact, phone);
          if (placed.some((q) => BT.lens(r, q.r, Math.hypot(x - q.x, y - q.y)) > 0.5 * Math.PI * Math.min(r, q.r) ** 2)) continue;
          placed.push({ x, y, r }); items.push({ p, x, y, r });
        }
        g.textAlign = 'center'; g.textBaseline = 'middle';
        for (const { p, x, y, r } of items.slice().reverse()) {
          const c = p.side ? I.buyColor : I.sellColor;
          g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = rgba(c, I.minOpacity); g.fill(); g.lineWidth = 1; g.strokeStyle = c; g.stroke();
          if (I.tags !== false && p.kind) {
            g.beginPath(); g.arc(x, y, r + 2.5, 0, Math.PI * 2); g.lineWidth = 2; g.strokeStyle = col[p.kind]; g.stroke();
            g.font = '700 ' + clamp(Math.round(r), 8, 12) + 'px ' + MONO; g.fillStyle = light() ? '#0f172a' : '#fff'; g.fillText(p.kind, x, y + 0.5);
          }
          if (I.showSize) { g.font = '600 ' + (phone ? 10 : 11) + 'px ' + MONO; g.fillStyle = ink(); g.fillText(BT.compact(p.size), x + r + 12, y); }
        }
      } finally { try { plateLine(g, a, a.data.owner); } catch (e) {} g.restore(); }
    },
    destroy() { canvas = null; }
  };
}
function stopLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a); if (!g) return;
      try {
        const d = a.data, I = d.owner.inputs, co = a.coords, phone = co.width < 520, top = a.bounds.top, bot = top + a.bounds.height, vr = co.visibleLogicalRange();
        const i0 = Math.floor(vr.from) - 1, i1 = Math.ceil(vr.to) + 1;
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 ' + (phone ? 9 : 10) + 'px ' + MONO;
        for (const e of d.ev || []) {
          if (e.i < i0 || e.i > i1 || (!e.ok && !I.showAll)) continue;
          const x = co.logicalToX(e.i), y = Yp(a, e.extreme), up = e.side === 1, c = up ? I.downColor : I.upColor, r = e.ok ? 7 : 5, ty = up ? y - r - 4 : y + r + 4;
          if (y < top - 10 || y > bot + 10) continue;
          g.beginPath();
          if (up) { g.moveTo(x, ty + r); g.lineTo(x + r, ty - r * 0.7); g.lineTo(x - r, ty - r * 0.7); } else { g.moveTo(x, ty - r); g.lineTo(x + r, ty + r * 0.7); g.lineTo(x - r, ty + r * 0.7); }
          g.closePath();
          if (e.ok) { g.fillStyle = c; g.fill(); g.strokeStyle = light() ? '#fff' : '#0b0b0d'; g.lineWidth = 1; g.stroke(); const ly = up ? ty - r - 7 : ty + r + 7; g.fillStyle = c; g.fillText(e.got + ' lv', x, ly); }
          else { g.strokeStyle = rgba(c, 0.8); g.lineWidth = 1.2; g.stroke(); }
        }
      } finally { try { plateLine(g, a, a.data.owner); } catch (e) {} g.restore(); }
    },
    destroy() { canvas = null; }
  };
}
function vpLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a); if (!g) return;
      try {
        const d = a.data, I = d.owner.inputs, hub = d.hub, co = a.coords, phone = co.width < 520, top = a.bounds.top, bot = top + a.bounds.height, W = co.width;
        if (!hub) return;
        const rp = hub.restProfile(d.ss); if (!rp) return;
        const lad = ladders.find((x) => x.on && !x.off && x.inputs.ladder !== false);   // the delta ladder owns the right edge: the profile sits left of it, never under it
        const ladW = lad ? W * num(lad.inputs.ladWidth, 16) / 100 * (phone ? 0.8 : 1) + 4 : 0;
        const S = rp.S, tick = hub.tick(), maxW = Math.max(24, W * num(I.widthPct, 14) / 100 * (phone ? (lad ? 0.6 : 1.2) : 1));
        // traded profile of the same session, rows of the book's own step
        const fa = hub.footBars(), vr = co.visibleLogicalRange(), lastT = a.bars[clamp(Math.ceil(vr.to), 0, a.bars.length - 1)].time;
        const tb = tick ? fa.bars.filter((b) => b.t >= d.ss && b.t <= lastT) : [], tp = tb.length ? tradedProfile(tb, Math.max(1, Math.round(S / tick))) : null;
        let rmax = 0; rp.bid.forEach((q) => { rmax = Math.max(rmax, q); }); rp.ask.forEach((q) => { rmax = Math.max(rmax, q); });
        let tmax = 0; if (tp) for (let k = 0; k < tp.n; k++) tmax = Math.max(tmax, tp.buy[k] + tp.sell[k]);
        const xT = W - 2 - ladW, xR = xT - (tp ? maxW + 3 : 0);
        const rowH = (r) => { const yT = Yp(a, (r + 1) * S), yB = Yp(a, r * S); return [Math.min(yT, yB), Math.max(1, Math.abs(yB - yT) - (Math.abs(yB - yT) > 4 ? 1 : 0))]; };
        const rows = new Set([...rp.bid.keys(), ...rp.ask.keys()]);
        for (const r of rows) {
          const [y, h] = rowH(r); if (y > bot || y + h < top) continue;
          const b = rp.bid.get(r) || 0, k = rp.ask.get(r) || 0, q = Math.max(b, k), w = Math.max(1, maxW * q / rmax);
          g.fillStyle = rgba(b >= k ? I.bidColor : I.askColor, 0.55); g.fillRect(xR - w, y, w, h);
        }
        const view = I.view === 'Delta' || I.view === 'Both' ? I.view : 'Volume';
        if (tp && view !== 'Volume') {   // Delta / Both: the traded column becomes delta rows (Both keeps the volume in grey behind)
          const P = fromProfile(tp), half = maxW / 2;
          deltaRows(g, a, P, { x0: xT - half, half, pos: UP, neg: DN, showVol: view === 'Both', tick, phone });
          let net = 0; for (let k = 0; k < tp.n; k++) net += tp.buy[k] - tp.sell[k];
          deltaChips(g, a, P, net, { pos: UP, neg: DN, tick, phone }, xT, top + 10 + ovLive.filter((x) => x.on).length * 17 + 8);
        }
        if (tp && view === 'Volume') for (let k = 0; k < tp.n; k++) {
          const v = tp.buy[k] + tp.sell[k]; if (!v) continue;
          const r = tp.r0 + k, [y, h] = rowH(r); if (y > bot || y + h < top) continue;
          const w = Math.max(1, maxW * v / tmax), isP = r === tp.poc;
          g.fillStyle = rgba(I.tradedColor, isP ? 0.95 : 0.55); g.fillRect(xT - w, y, w, h);
        }
        g.font = '700 10px ' + MONO; g.textAlign = 'right'; g.textBaseline = 'middle';
        let up = 0; const lab = (txt, xr) => { const tw = g.measureText(txt).width + 8; g.fillStyle = plate(); g.fillRect(xr - tw, bot - 22 - up, tw, 14); g.fillStyle = ink(); g.fillText(txt, xr - 4, bot - 15 - up); };
        if (tp) { lab('Traded', xT); const need = g.measureText('Traded').width + 8 + g.measureText('Resting').width + 12; if (xT - xR >= need) lab('Resting', xR); else { up = 16; lab('Resting', xR); } } else lab('Resting', xR);   // too close side by side: Resting goes one line up   // Traded sits at xT, Resting at xR: labels short enough not to meet
        window.__stkL2Flow.stk_l2f_vp.traded = tp ? tp.n : 0;
      } finally { try { plateLine(g, a, a.data.owner); } catch (e) {} g.restore(); }
    },
    destroy() { canvas = null; }
  };
}

// Delta rows: zero line at x0, buying to the right, selling to the left, `half` px at the largest |delta|. Optional grey volume behind (from the zero line, both sides).
function deltaRows(g, a, P, o) {
  const top = a.bounds.top, bot = top + a.bounds.height, tick = o.tick, mt = P.m * tick, scale = P.absMax || 1;
  const rowPx = Math.abs(Yp(a, mt) - Yp(a, 0));
  if (o.showVol && P.volMax) {
    g.fillStyle = light() ? 'rgba(100,116,139,0.22)' : 'rgba(148,163,184,0.2)';
    for (let k = 0; k < P.n; k++) { if (!P.vol[k]) continue; const yT = Yp(a, (P.r0 + k + 1) * mt), yB = Yp(a, (P.r0 + k) * mt), y = Math.min(yT, yB), h = Math.max(1, Math.abs(yB - yT) - (rowPx > 4 ? 1 : 0)); if (y > bot || y + h < top) continue; const w = o.half * P.vol[k] / P.volMax; g.fillRect(o.x0 - w, y, 2 * w, h); }
  }
  for (let k = 0; k < P.n; k++) {
    const d = P.delta[k]; if (!d) continue;
    const yT = Yp(a, (P.r0 + k + 1) * mt), yB = Yp(a, (P.r0 + k) * mt), y = Math.min(yT, yB), h = Math.max(1, Math.abs(yB - yT) - (rowPx > 4 ? 1 : 0));
    if (y > bot || y + h < top) continue;
    const w = Math.max(1, o.half * Math.abs(d) / scale);
    g.fillStyle = rgba(d > 0 ? o.pos : o.neg, 0.78); if (d > 0) g.fillRect(o.x0, y, w, h); else g.fillRect(o.x0 - w, y, w, h);
  }
  g.strokeStyle = light() ? 'rgba(15,23,42,0.45)' : 'rgba(255,255,255,0.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(o.x0) + 0.5, top); g.lineTo(Math.round(o.x0) + 0.5, bot); g.stroke();
  // the two largest rows get an outline; the chips below say which price and how much
  for (const [m, c] of [[P.maxPos, o.pos], [P.maxNeg, o.neg]]) {
    if (!m) continue; const yT = Yp(a, (P.r0 + m.k + 1) * mt), yB = Yp(a, (P.r0 + m.k) * mt), y = Math.min(yT, yB), h = Math.max(2, Math.abs(yB - yT)), w = Math.max(1, o.half * Math.abs(m.v) / scale);
    g.strokeStyle = c; g.lineWidth = 1.5; g.strokeRect((m.v > 0 ? o.x0 : o.x0 - w) + 0.5, y + 0.5, w, h - 1);
  }
}
const pFmt = (p) => String(+p.toFixed(2));
// chips (right edge xr, first line y) : net, max buying row, max selling row. Right aligned at the profile edge: never over the price scale or the legend plates.
function deltaChips(g, a, P, net, o, xr, y0) {
  const mt = P.m * o.tick, rows = [['Net ' + sgn(net), net >= 0 ? o.pos : o.neg]];
  if (P.maxPos) rows.push(['Max buy ' + sgn(P.maxPos.v) + ' @ ' + pFmt((P.r0 + P.maxPos.k) * mt), o.pos]);
  if (P.maxNeg) rows.push(['Max sell ' + sgn(P.maxNeg.v) + ' @ ' + pFmt((P.r0 + P.maxNeg.k) * mt), o.neg]);
  g.font = '700 ' + (o.phone ? 9 : 10) + 'px ' + MONO; g.textAlign = 'right'; g.textBaseline = 'middle';
  rows.forEach(([t, c], i) => {
    const tw = g.measureText(t).width + 12, y = y0 + i * 16, x = Math.max(tw + 4, xr);
    g.fillStyle = plate(); g.fillRect(x - tw, y - 7, tw, 14); g.fillStyle = c; g.fillRect(x - tw, y - 7, 2, 14); g.fillStyle = ink(); g.fillText(t, x - 4, y);
  });
}
function dpLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a); if (!g) return;
      try {
        const d = a.data, I = d.owner.inputs, hub = d.hub, acc = d.acc, co = a.coords, phone = co.width < 520, W = co.width;
        if (!hub || !acc) return;
        const tick = hub.tick(); if (!tick || !acc.tab.size) return;
        const lad = ladders.find((x) => x.on && !x.off && x.inputs.ladder !== false), ladW = lad ? W * num(lad.inputs.ladWidth, 16) / 100 * (phone ? 0.8 : 1) + 4 : 0;
        const total = Math.max(60, W * num(I.widthPct, 18) / 100 * (phone ? 1.5 : 1)), half = total / 2, xr = W - 2 - ladW, x0 = xr - half;
        let lo = Infinity, hi = -Infinity; for (const k of acc.tab.keys()) { if (k < lo) lo = k; if (k > hi) hi = k; }
        const tickPx = Math.abs(Yp(a, tick) - Yp(a, 0)), m = rowTicks(hi - lo + 1, tickPx, phone ? 8 : 7, phone ? 40 : 70, ROW_STEPS);   // capped: at most 40 / 70 rows
        const P = rebucket(acc.tab, m); if (!P) return;
        const o = { x0, half, pos: I.posColor, neg: I.negColor, showVol: I.showVol === true, tick, phone };
        if (d.prevPoc != null) {   // previous block's POC: faint line across the chart at its price
          const y = Math.round(Yp(a, (d.prevPoc + 0.5) * tick)) + 0.5;
          g.save(); g.strokeStyle = rgba(AMBER, 0.45); g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.restore();
          g.font = '600 10px ' + MONO; g.textAlign = 'right'; g.fillStyle = rgba(AMBER, 0.85); g.fillText('Prev POC ' + pFmt(d.prevPoc * tick), x0 - half - 8, y - 3);
        }
        deltaRows(g, a, P, o);
        const slot = ovLive.filter((x) => x.on).length;
        deltaChips(g, a, P, acc.net, o, xr, a.bounds.top + 10 + slot * 17 + 8);
        Object.assign(window.__stkL2Flow.stk_l2f_dp, { rows: P.n, m, draws: (window.__stkL2Flow.stk_l2f_dp.draws || 0) + 1, maxPos: P.maxPos && P.maxPos.v, maxNeg: P.maxNeg && P.maxNeg.v });
      } finally { try { plateLine(g, a, a.data.owner); } catch (e) {} g.restore(); }
    },
    destroy() { canvas = null; }
  };
}

// book size added minus pulled at each price row over [t0, t1]: Map row -> net (rows of R price units, R >= the book step)
function bookNet(hub, t0, t1, R) {
  const a = hub.samples(), last = a[a.length - 1]; if (!last) return new Map();
  const key = t0 + '|' + Math.floor(t1 / 5000) + '|' + R + '|' + a.length;
  if (hub.memo.bnk === key) return hub.memo.bn;
  const out = new Map(); let prev = null;
  for (let j = lastLE(a, t0 - 1) + 1; j < a.length && a[j].ts <= t1; j++) {
    const s = a[j];
    if (prev && s.ts - prev.ts <= GAP_MAX && Math.abs(s.step - prev.step) < 1e-9 * s.step && Math.abs(s.step - R) < 1e-9 + R * 0.999999) {
      const lo = Math.min(s.i0, prev.i0), hi = Math.max(s.i0 + s.v.length, prev.i0 + prev.v.length);
      for (let r = lo; r < hi; r++) { const q = s.v[r - s.i0] || 0, o = prev.v[r - prev.i0] || 0, d = Math.abs(q) - Math.abs(o); if (d) out.set(r, (out.get(r) || 0) + d); }
    }
    prev = s;
  }
  hub.memo.bnk = key; hub.memo.bn = out; return out;
}
function ladderLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a); if (!g) return;
      try {
        const d = a.data, o = d.owner, I = o.inputs, hub = d.hub; if (!hub || I.ladder === false || ladders.find((x) => x.on && !x.off) !== o) return;
        const co = a.coords, phone = co.width < 520, top = a.bounds.top, bot = top + a.bounds.height, W = co.width, tick = hub.tick(); if (!tick) return;
        const vr = co.visibleLogicalRange(), n = a.bars.length, iA = clamp(Math.floor(vr.from), 0, n - 1), iB = clamp(Math.ceil(vr.to), 0, n - 1), tf = tfOf(a.bars);
        const tEnd = a.bars[iB].time + tf, tStart = I.ladRange === 'session' ? sessionStart(a.bars[iB].time, hub.kind) : a.bars[iA].time;
        const fb = hub.footBars(), bars = fb.bars.filter((b) => b.t >= tStart && b.t < tEnd);
        const newest = hub.samples()[hub.samples().length - 1], S = newest ? newest.step : tick;
        const tickPx = Math.abs(Yp(a, tick) - Yp(a, 0)), visTicks = a.bounds.height / (tickPx || 1); let m = ROW_STEPS.find((x) => visTicks / x <= 40 && tickPx * x >= 9) || ROW_STEPS.find((x) => tickPx * x >= 9) || 400;   // about 25-40 rows over the visible price range
        m = Math.max(m, Math.round(S / tick)); const R = m * tick;
        const tp = bars.length ? tradedProfile(bars, m) : null, bn = newest ? bookNet(hub, tStart, tEnd, S === R ? S : R) : new Map();
        const net = new Map(); bn.forEach((v, r) => { const k = Math.floor(((r + 0.5) * S) / R + 1e-9); net.set(k, (net.get(k) || 0) + v); });
        let dmax = 1, bmax = 1; const dl = new Map();
        if (tp) for (let k = 0; k < tp.n; k++) { const v = tp.buy[k] - tp.sell[k]; if (v) { dl.set(tp.r0 + k, v); dmax = Math.max(dmax, Math.abs(v)); } }
        net.forEach((v) => { bmax = Math.max(bmax, Math.abs(v)); });
        const span = W * num(I.ladWidth, 16) / 100 * (phone ? 0.8 : 1), x = W - 1;
        const rowPx = Math.abs(Yp(a, R) - Yp(a, 0)), showNum = rowPx >= 11, fs = clamp(Math.floor(rowPx * 0.7), 8, phone ? 10 : 11);
        g.textBaseline = 'middle';
        g.fillStyle = light() ? 'rgba(241,245,249,0.55)' : 'rgba(11,11,13,0.45)'; g.fillRect(x - span, top, span + 1, bot - top);   // strip: labels read on it, candles stay visible beside it
        const rows = new Set([...dl.keys(), ...net.keys()]);
        for (const r of rows) {
          const yT = Yp(a, (r + 1) * R), yB = Yp(a, r * R), y = Math.min(yT, yB), h = Math.max(1, Math.abs(yB - yT) - (rowPx > 4 ? 1 : 0));
          if (y > bot || y + h < top) continue;
          const dv = dl.get(r), bv = net.get(r);
          if (dv) {
            const len = Math.max(1, span * Math.abs(dv) / dmax);
            g.fillStyle = rgba(dv > 0 ? UP : DN, 0.62); g.fillRect(x - len, y, len, h);
            if (showNum) { g.font = '600 ' + fs + 'px ' + MONO; const tx = fmtK(dv); if (g.measureText(tx).width + 6 <= span) { g.textAlign = 'right'; g.fillStyle = ink(); g.fillText(tx, x - 3, y + h / 2); } }   // inside the strip, at the axis edge: never over candles
          }
          if (bv) {   // L2 part: thin bar along the lower edge of the row, cyan = book added, amber = pulled
            const len = Math.max(1, span * 0.9 * Math.abs(bv) / bmax), th = Math.max(2, Math.round(h * 0.3));
            g.fillStyle = bv > 0 ? CYAN : AMBER; g.fillRect(x - len, y + h - th, len, th);
          }
        }
        o.ladInfo = { rows: rows.size, m, trade: dl.size, book: net.size };
        window.__stkL2Flow.ladder = Object.assign({ draws: 0 }, window.__stkL2Flow.ladder, o.ladInfo, { draws: ((window.__stkL2Flow.ladder || {}).draws || 0) + 1 });
      } finally { g.restore(); }
    },
    destroy() { canvas = null; }
  };
}

// ---------------------------------------------------------------------------------------- install
// The Volume footprint chart style (chart-footprint.js) with Data = L2: the hub's per-price trade minutes (TickFeed, 3 h) in the same
// shape flowFor() returns, so the classic stk_fp drawing runs on them unchanged. `own` is the engine's holder { u, spec, k, out }.
export function fpDrop(own) { if (own.u) { own.u.release(); own.u = null; own.spec = null; own.k = ''; } }
export function fpFlow(own, ctx, bars, tfMs, E, onChange) {
  const spec = specOf(ctx);
  if (!spec || spec.kind !== 'futures') { fpDrop(own); return null; }   // crypto: the caller keeps the trades feed
  if (!l2Badge()) { fpDrop(own); return { map: new Map(), tick: 0, note: NOT_YET, locked: true }; }
  if (!bars.length) return { map: new Map(), tick: spec.tick, note: '' };
  if (!own.u || own.spec.key !== spec.key) { fpDrop(own); own.u = acquireHub(spec, bars[0].time, onChange); own.spec = spec; }
  const hub = own.u.h, fb = hub.footBars(), key = hub.fver() + '|' + tfMs + '|' + (E == null ? '' : Math.floor(E / 60000));
  if (own.k !== key) {
    const clipped = clipTo(fb.bars, E), agg = aggregate(clipped, tfMs);
    own.k = key;
    own.out = { map: new Map(agg.map((b) => [b.t, b])), list: agg, mins: clipped, tick: fb.tick || spec.tick, thr: 0, free: false,
      note: !agg.length ? 'Loading order flow…' : fb.from && fb.from > bars[0].time ? 'Footprint (L2) from ' + hhmm(fb.from) : '' };
  }
  return own.out;
}
export const fpVersion = (own) => (own.u ? own.u.h.fver() : 0);

export function installL2Flow(Core, hooks, reg) {
  if (H) return;
  H = hooks;
  window.__stkL2Flow = window.__stkL2Flow || {};
  Core.registerRendererLayer({ id: 'stk_l2f_fp', placement: 'above-data', create: fpLayer });
  Core.registerRendererLayer({ id: 'stk_l2f_big', placement: 'above-data', create: bigLayer });
  Core.registerRendererLayer({ id: 'stk_l2f_stop', placement: 'above-data', create: stopLayer });
  Core.registerRendererLayer({ id: 'stk_l2f_vp', placement: 'above-data', create: vpLayer });
  Core.registerRendererLayer({ id: 'stk_l2f_dp', placement: 'above-data', create: dpLayer });
  Core.registerRendererLayer({ id: 'stk_l2f_sw', placement: 'above-data', create: () => swingLayer({ frame, Yp, plate, ink, light, rgba, MONO, plateLine, ovCount: () => ovLive.filter((x) => x.on).length, fmtP: pFmt }) });
  for (const id of LADDER) Core.registerRendererLayer({ id, placement: 'above-data', create: ladderLayer });
  for (const type of L2F_TYPES) {
    const [title, short, pane, overlay] = TITLES[type];
    if (!L2_TYPES.includes(type)) L2_TYPES.push(type);
    registerFeed(type, { needs: 'L2', title });
    reg(Core, { type, title, shortTitle: short, paneHint: pane, overlay, reactsToViewport: LAYERS.includes(type) || LADDER.includes(type), inputsSchema: () => SCHEMA[type], create: () => new L2Flow(type) });
  }
}
if (typeof window !== 'undefined') window.__stkL2FlowHubs = hubs;
