// TradeZoro — Charts: ORDER-BOOK PACK maths (pure, no DOM; unit-tested in tools/tests/chart-book-pack.test.mjs).
// Six indicators read the SAME recorded feed (the futures L2 hub snapshots + trades, or a crypto exchange book + trades):
//   Book Speed, Liquidity Balance, Refill Detector, Volatility Regime, Large Resting Orders, Absorption & Iceberg Tracker.
// A "book" here is { bb, ba, bid: Map(tick idx -> size), ask: Map(tick idx -> size) } (bb / ba = best bid / ask, in tick units).
// Nothing here predicts anything. Education only. Not financial advice.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ---------------------------------------------------------------- book
// Build a book from sorted-or-not [price, size] lists (futures hub snapshot) at tick size `tick`.
export function bookFromLists(bids, asks, tick) {
  const bid = new Map(), ask = new Map();
  let bb = -Infinity, ba = Infinity;
  for (const [p, q] of bids || []) { if (!(q > 0)) continue; const i = Math.round(p / tick); bid.set(i, (bid.get(i) || 0) + q); if (i > bb) bb = i; }
  for (const [p, q] of asks || []) { if (!(q > 0)) continue; const i = Math.round(p / tick); ask.set(i, (ask.get(i) || 0) + q); if (i < ba) ba = i; }
  return bb > -Infinity && ba < Infinity && bb < ba ? { bb, ba, bid, ask } : null;
}
// Crypto: Maps of price -> size, bucketed to `tick` (bids floor, asks ceil: a bid never crosses an ask), at most `range` ticks each side.
export function bookFromMaps(bids, asks, tick, range = 150) {
  let bp = 0, ap = Infinity;
  bids.forEach((q, p) => { if (q > 0 && p > bp) bp = p; });
  asks.forEach((q, p) => { if (q > 0 && p < ap) ap = p; });
  if (!(bp > 0) || !(ap < Infinity)) return null;
  const bb = Math.floor(bp / tick + 1e-9), ba = Math.max(bb + 1, Math.ceil(ap / tick - 1e-9));
  const bid = new Map(), ask = new Map();
  bids.forEach((q, p) => { if (!(q > 0)) return; const i = Math.floor(p / tick + 1e-9); if (i <= bb && i > bb - range) bid.set(i, (bid.get(i) || 0) + q); });
  asks.forEach((q, p) => { if (!(q > 0)) return; const i = Math.ceil(p / tick - 1e-9); if (i >= ba && i < ba + range) ask.set(i, (ask.get(i) || 0) + q); });
  return { bb, ba, bid, ask };
}

// ---------------------------------------------------------------- per-update measures (N ticks each side of the touch)
export function balance(b, N) {
  let bid = 0, ask = 0;
  for (let i = b.bb; i > b.bb - N; i--) bid += b.bid.get(i) || 0;
  for (let i = b.ba; i < b.ba + N; i++) ask += b.ask.get(i) || 0;
  return { bid, ask };
}
// Count of resting levels whose size changed (add, remove or resize) between two books, inside the window both books share.
export function changes(prev, cur, N) {
  let n = 0;
  const bLo = Math.max(prev.bb, cur.bb) - N + 1, bHi = Math.min(prev.bb, cur.bb);
  for (let i = bLo; i <= bHi; i++) if ((prev.bid.get(i) || 0) !== (cur.bid.get(i) || 0)) n++;
  const aLo = Math.max(prev.ba, cur.ba), aHi = Math.min(prev.ba, cur.ba) + N - 1;
  for (let i = aLo; i <= aHi; i++) if ((prev.ask.get(i) || 0) !== (cur.ask.get(i) || 0)) n++;
  return n;
}
// Size-weighted spread of the resting liquidity around the mid: sqrt(sum(size * d^2) / sum(size)), d in ticks. Small = clustered at the touch.
export function spread(b, N) {
  const mid = (b.bb + b.ba) / 2;
  let w = 0, s = 0;
  for (let i = b.bb; i > b.bb - N; i--) { const q = b.bid.get(i) || 0; if (q) { w += q; s += q * (i - mid) * (i - mid); } }
  for (let i = b.ba; i < b.ba + N; i++) { const q = b.ask.get(i) || 0; if (q) { w += q; s += q * (i - mid) * (i - mid); } }
  return w > 0 ? Math.sqrt(s / w) : null;
}

// ---------------------------------------------------------------- series + percentiles
export class Series {
  constructor(cap = 43200) { this.t = []; this.v = []; this.cap = cap; }
  push(t, v) {
    this.t.push(t); this.v.push(v);
    if (this.t.length > this.cap * 1.1) { const k = this.t.length - this.cap; this.t.splice(0, k); this.v.splice(0, k); }
  }
  // first index with t >= ms
  from(ms) { let lo = 0, hi = this.t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (this.t[m] < ms) lo = m + 1; else hi = m; } return lo; }
  get last() { return this.v.length ? this.v[this.v.length - 1] : null; }
}
export function ema(values, seconds) {
  const a = 2 / (Math.max(1, seconds) + 1), out = new Array(values.length);
  let e = null;
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (v == null) { out[i] = e; continue; } e = e == null ? v : e + a * (v - e); out[i] = e; }
  return out;
}
// p in 0..100 over at most ~2000 evenly spaced values (cheap enough to run every few seconds)
export function percentiles(values, ps) {
  const n = values.length;
  if (!n) return ps.map(() => null);
  const step = Math.max(1, Math.floor(n / 2000)), a = [];
  for (let i = 0; i < n; i += step) if (values[i] != null) a.push(values[i]);
  if (!a.length) return ps.map(() => null);
  a.sort((x, y) => x - y);
  return ps.map((p) => a[clamp(Math.floor((a.length - 1) * p / 100 + 1e-9), 0, a.length - 1)]);
}
// 0 low / 1 middle / 2 high against the two cut points (null cuts = middle: no baseline yet)
export const band = (v, lo, hi) => (v == null || lo == null || hi == null ? 1 : v <= lo ? 0 : v >= hi ? 2 : 1);

// Log-binned histogram of level sizes (8 bins per doubling): quantile without keeping every size.
export class LogHist {
  constructor() { this.c = new Float64Array(1024); this.n = 0; }
  bin(v) { return clamp(Math.floor(Math.log2(v) * 8) + 400, 0, 1023); }
  add(v) { if (!(v > 0)) return; this.c[this.bin(v)]++; this.n++; }
  // size at the top `pct` percent (pct 0.5 = the 99.5th percentile); lower edge of the bin (a level in that bin counts)
  top(pct) {
    if (!this.n) return null;
    let want = this.n * pct / 100, acc = 0;
    for (let b = 1023; b >= 0; b--) { acc += this.c[b]; if (acc >= want) return Math.pow(2, (b - 400) / 8); }
    return null;
  }
  reset() { this.c.fill(0); this.n = 0; }
}

// ---------------------------------------------------------------- sessions
const nyOff = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' }) : null;
const offMemo = new Map();   // hour -> offset: formatToParts is slow, a chart calls this once per bar
export function nyOffsetMs(ms) {
  const hr = Math.floor(ms / 3600000);
  let o = offMemo.get(hr);
  if (o === undefined) { o = nyOffsetRaw(hr * 3600000); if (offMemo.size > 4000) offMemo.clear(); offMemo.set(hr, o); }
  return o;
}
function nyOffsetRaw(ms) {
  const z = nyOff ? (nyOff.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName') || {}).value || 'GMT-05:00' : 'GMT-05:00';
  const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(z);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) * 60000 : -18000000;
}
// Start (ms) of the session that holds `ms`: the CME day (18:00 New York) for futures, the UTC day for crypto.
export function sessionStart(ms, kind) {
  if (kind === 'crypto') return Math.floor(ms / 86400000) * 86400000;
  const off = nyOffsetMs(ms), local = ms + off, d = 86400000;
  return Math.floor((local - 18 * 3600000) / d) * d + 18 * 3600000 - off;
}

// ---------------------------------------------------------------- bars
// mean (or last) of the 1 s samples of a Series inside each chart bar [time, next time); null where there are none
export function perBar(s, bars, tfMs, mode) {
  const out = new Array(bars.length).fill(null);
  if (!s.t.length || !bars.length) return out;
  let j = s.from(bars[0].time);
  for (let i = 0; i < bars.length; i++) {
    const t0 = bars[i].time, t1 = i + 1 < bars.length ? bars[i + 1].time : t0 + tfMs;
    while (j < s.t.length && s.t[j] < t0) j++;
    let sum = 0, n = 0, last = null;
    while (j < s.t.length && s.t[j] < t1) { sum += s.v[j]; n++; last = s.v[j]; j++; }
    if (n) out[i] = mode === 'last' ? last : sum / n;
  }
  return out;
}
// last chart bar with time <= t
export function idxOf(bars, t) {
  let lo = 0, hi = bars.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
// Running total of events [{ t, d: +1 | -1 }] per chart bar, reset at every session start.
export function cumulate(bars, events, kind) {
  const delta = new Array(bars.length).fill(0);
  for (const e of events) { const i = idxOf(bars, e.t); if (i >= 0) delta[i] += e.d; }
  const out = new Array(bars.length);
  let run = 0, key = null;
  for (let i = 0; i < bars.length; i++) {
    const k = sessionStart(bars[i].time, kind);
    if (k !== key) { key = k; run = 0; }
    run += delta[i]; out[i] = run;
  }
  return out;
}

// ---------------------------------------------------------------- refill detector
// A level is HIT when aggressive trades print at its price (buyers lift an ask, sellers hit a bid), it LOSES at least hitPct of the
// size it had, and then gets that size back: >= refillPct of the size before the hit, within withinSec of the last hit print.
// side of the event = the RESTING side that refilled: +1 bid (supports the move up), -1 ask (supports the move down).
export class RefillTracker {
  constructor({ refillPct = 70, withinSec = 3, hitPct = 30 } = {}) {
    this.refill = clamp(refillPct, 1, 100) / 100; this.ms = clamp(withinSec, 0.5, 60) * 1000; this.hit = clamp(hitPct, 1, 100) / 100;
    this.cur = null; this.prev = null; this.pend = new Map(); this.cool = new Map(); this.events = [];
  }
  // list of { p (tick idx of the resting level), size, side: +1 buyer aggressor | -1 seller aggressor }
  onTrades(ts, list) {
    const b = this.cur; if (!b) return;
    for (const x of list) {
      const key = (x.side > 0 ? 'A' : 'B') + x.idx;
      const m = x.side > 0 ? 'ask' : 'bid';
      const size = Math.max(b[m].get(x.idx) || 0, this.prev ? this.prev[m].get(x.idx) || 0 : 0);
      let p = this.pend.get(key);
      if (!p) { if (!(size > 0) || (this.cool.get(key) || 0) > ts) continue; p = { t0: ts, S0: size, min: size, dep: false, side: x.side > 0 ? -1 : 1, idx: x.idx, m, traded: 0 }; this.pend.set(key, p); }
      p.traded += x.size; p.last = ts;
    }
  }
  onBook(ts, b) {
    this.prev = this.cur; this.cur = b;
    for (const [key, p] of this.pend) {
      if (ts > p.last + this.ms) { this.pend.delete(key); continue; }   // too slow: the window runs from the last hit print
      const size = b[p.m].get(p.idx) || 0;
      if (size < p.min) p.min = size;
      if (p.min <= (1 - this.hit) * p.S0) p.dep = true;
      if (p.dep && size > p.min && size >= this.refill * p.S0) {
        this.events.push({ t: ts, idx: p.idx, side: p.side, before: p.S0, low: p.min, after: size, traded: p.traded, ms: ts - p.t0 });
        if (this.events.length > 600) this.events.splice(0, this.events.length - 600);
        this.pend.delete(key); this.cool.set(key, ts + 3000);
      }
    }
    if (this.cool.size > 200) for (const [k, v] of this.cool) if (v < ts) this.cool.delete(k);
  }
}

// ---------------------------------------------------------------- large resting orders
// Levels at or above `thr` (the session's top-pct size). A level stays "live" while it holds at least half of thr; its `since` is when
// it first got there. A level that falls away goes to `gone` and fades out over fadeMs.
export class LargeTracker {
  constructor() { this.live = new Map(); this.gone = []; }
  update(ts, b, thr, fadeMs = 3000) {
    const now = new Set();
    if (thr > 0) {
      const scan = (m, side) => m.forEach((q, i) => {
        if (q < thr && !(this.live.has(side + i) && q >= thr * 0.5)) return;
        const k = side + i; now.add(k);
        const e = this.live.get(k);
        if (e) { e.size = q; e.seen = ts; } else this.live.set(k, { side, idx: i, size: q, since: ts, seen: ts });
      });
      scan(b.bid, 1); scan(b.ask, -1);
    }
    for (const [k, e] of this.live) if (!now.has(k)) { this.live.delete(k); this.gone.push(Object.assign({}, e, { goneAt: ts })); }
    this.gone = this.gone.filter((e) => ts - e.goneAt < fadeMs).slice(-30);
  }
}

export const fmtDur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm ' + (s % 60 ? String(s % 60).padStart(2, '0') + 's' : '') : Math.floor(s / 3600) + 'h ' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + 'm'; };
export function fmtK(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return Math.round(v / 1e3) + 'K';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return Number.isInteger(v) || a >= 100 ? String(Math.round(v)) : String(+v.toFixed(2));
}
