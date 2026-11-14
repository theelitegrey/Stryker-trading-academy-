// TradeZoro — DOM Signals: pure logic for the Signals and ±Size columns and the one-line summary (no DOM, no sockets).
// Unit-tested in tools/tests/dom-signals-core.test.mjs. Runs in batches (>= 250 ms), never per tick.
// Reuses what already exists: WallTracker (Pulled / Eaten / Absorb) and RefillTracker (Refill) from chart-book-pack-data.js,
// bigThreshold (Big) from book-panel-core.js. Two small live rules are new because the existing ones cannot run on a live ladder:
//   Iceberg: icebergEvents (chart-liquidity-data.js) needs finished footprint minutes and 20 one-second samples per minute, so it lags by a minute.
//   Sweep:   sweepEvents (chart-of-pro-data.js) is a bar rule (swing highs / lows); the ladder needs a tape burst through levels.
// Nothing here predicts anything. Resting size added below vs above price is not a signal to trade. Education only. Not financial advice.
import { WallTracker, RefillTracker } from './chart-book-pack-data.js?v=987';
import { bigThreshold } from './book-panel-core.js?v=987';

// letter, word, what it means (the legend shows these)
export const TAGS = {
  I: ['Iceberg', 'Traded at this price far more than was ever shown resting there.'],
  R: ['Refill', 'Resting size keeps coming back after it was hit.'],
  A: ['Absorb', 'Heavy aggressive volume ran into this level and price held.'],
  S: ['Sweep', 'One aggressive burst went through 3 or more levels. Each level it took is marked.'],
  B: ['Big', 'A trade in the top size bucket printed here.'],
  P: ['Pulled', 'A large resting order was removed without trading.'],
  E: ['Eaten', 'A large resting order was fully traded through.']
};
export const WINDOWS = [10000, 30000, 60000, 300000];
export const FADES = [10000, 20000, 40000];
const NEAR = 20, KEEP_MS = 305000, SNAP_MS = 2000;

const rd = (m) => { let n = 0; m.forEach((q) => { if (q > 0) n++; }); return n; };

// merged book ({ bids:[[price,size]], asks }) -> tick-index book the trackers read
export function toBook(m, step) {
  const bid = new Map(), ask = new Map(); let bb = -Infinity, ba = Infinity;
  for (const [p, q] of m.bids) { const i = Math.round(p / step); bid.set(i, q); if (i > bb) bb = i; }
  for (const [p, q] of m.asks) { const i = Math.round(p / step); ask.set(i, q); if (i < ba) ba = i; }
  return bb > -Infinity && ba < Infinity && bb < ba ? { bb, ba, bid, ask } : null;
}
// size of a "large" resting order: the top bucket of the sizes on show (at least 3x their median). null = too few levels to say.
export function wallThreshold(b) {
  if (rd(b.bid) + rd(b.ask) < 10) return Infinity;
  const a = []; b.bid.forEach((q) => { if (q > 0) a.push(q); }); b.ask.forEach((q) => { if (q > 0) a.push(q); });
  a.sort((x, y) => x - y);
  return Math.max(a[Math.floor(a.length * 0.9)], a[Math.floor(a.length / 2)] * 3);
}
// Support building / Resistance building / Balanced from resting size added below (b) and above (o) price.
export function verdict(b, o, resting) {
  const tol = Math.max(0.1 * (Math.abs(b) + Math.abs(o)), 0.02 * (resting || 0));
  const d = b - o;
  return d > tol ? 'Support building' : d < -tol ? 'Resistance building' : 'Balanced';
}

export class SignalEngine {
  constructor({ fadeMs = 20000, winMs = 30000, gapMs = 250 } = {}) { this.fadeMs = fadeMs; this.winMs = winMs; this.gapMs = Math.max(250, gapMs); this.reset(); }
  reset() {
    this.wall = new WallTracker(); this.refill = new RefillTracker();
    this.tags = new Map();        // idx -> { tag, side, t }
    this.snaps = []; this.oldCache = null; this.ice = new Map(); this.rt = [];
    this.last = -Infinity; this.lastTrade = -Infinity; this.lastSnap = -Infinity; this.nWall = 0;
    this.added = new Map(); this.sum = null; this.span = 0;
  }
  setTag(idx, tag, side, ts) { this.tags.set(idx, { tag, side, t: ts }); }
  // newest tag still inside the fade time, with how strong it still is (1 -> 0), or null
  tagAt(idx, now) {
    const e = this.tags.get(idx); if (!e) return null;
    const a = 1 - (now - e.t) / this.fadeMs;
    return a > 0 ? { tag: e.tag, side: e.side, a } : null;
  }
  // m = merged book, step = price step, ring = trades sorted by time ({ t, p, s, side }). Returns false when it skipped (inside the batch gap).
  update(ts, m, step, ring) {
    if (ts - this.last < this.gapMs) return false;
    const b = m && step > 0 ? toBook(m, step) : null; if (!b) return false;
    this.last = ts;
    // shortcut: a print that arrives later than a newer one (exchange clocks) is missed here; fine for 20 s tags.
    // new trades since the last batch (the ring is sorted by time)
    if (this.lastTrade === -Infinity) this.lastTrade = ts;   // history before the first batch is not a signal
    const tr = []; let k = ring.length;
    while (k > 0 && ring[k - 1].t > this.lastTrade) k--;
    for (; k < ring.length; k++) { const x = ring[k]; tr.push({ t: x.t, idx: Math.round(x.p / step), size: x.s, side: x.side > 0 ? 1 : -1 }); }
    if (tr.length) this.lastTrade = tr[tr.length - 1].t;
    const prev = this.prevBook; this.prevBook = b;
    const recent = []; for (let i = ring.length - 1; i >= 0 && recent.length < 300; i--) recent.push(ring[i]);
    const bt = bigThreshold(recent);
    const thr = wallThreshold(b);

    // Big: a print in the top size bucket
    if (bt < Infinity) for (const x of tr) if (x.size >= bt) this.setTag(x.idx, 'B', x.side, ts);
    // Sweep: same-side prints within 1 s that touch >= 3 levels in a tight run and add up to a top-bucket size
    if (tr.length) {
      for (const x of tr) this.rt.push(x);
      const t1 = this.rt[this.rt.length - 1].t; this.rt = this.rt.filter((x) => t1 - x.t <= 1000);
      if (bt < Infinity) for (const sd of [1, -1]) {
        if (!tr.some((x) => x.side === sd)) continue;
        const ks = new Set(); let tot = 0, lo = Infinity, hi = -Infinity, mono = true, lastI = null;
        for (const x of this.rt) if (x.side === sd) { ks.add(x.idx); tot += x.size; if (x.idx < lo) lo = x.idx; if (x.idx > hi) hi = x.idx; if (lastI != null && (x.idx - lastI) * sd < 0) mono = false; lastI = x.idx; }
        // one burst = price only walked one way (up for buyers, down for sellers), through >= 3 levels, with at least two top-bucket prints' worth of size
        if (mono && ks.size >= 3 && tot >= 2 * bt && hi - lo + 1 <= 2 * ks.size) for (const i of ks) this.setTag(i, 'S', sd, ts);
      }
    }
    // Refill
    const nr = this.refill.events.length;
    this.refill.onTrades(ts, tr); this.refill.onBook(ts, b);
    for (let i = nr; i < this.refill.events.length; i++) { const e = this.refill.events[i]; this.setTag(e.idx, 'R', e.side, ts); }
    // Iceberg: per level and aggressor side over a 30 s run, traded >= 4x the biggest size ever shown, the level resting in >= 80% of batches
    for (const x of tr) {
      const key = x.side + '|' + x.idx, mp = x.side > 0 ? 'ask' : 'bid';
      let r = this.ice.get(key);
      if (!r) { r = { t0: ts, traded: 0, vis: 0, n: 0, pres: 0, mp, idx: x.idx, sd: x.side > 0 ? -1 : 1, hit: ts }; this.ice.set(key, r); }
      r.traded += x.size; r.hit = ts;
      r.vis = Math.max(r.vis, b[mp].get(x.idx) || 0, prev ? prev[mp].get(x.idx) || 0 : 0);
    }
    for (const [key, r] of this.ice) {
      if (ts - r.hit > 10000 || ts - r.t0 > 30000) { this.ice.delete(key); continue; }
      r.n++; if ((b[r.mp].get(r.idx) || 0) > 0) r.pres++;
      if (r.n >= 3 && r.vis > 0 && r.pres >= 0.8 * r.n && bt < Infinity && r.traded >= 4 * r.vis && r.traded >= bt) { this.setTag(r.idx, 'I', r.sd, ts); this.ice.delete(key); }
    }
    // Absorb / Pulled / Eaten from the wall tracker
    const w = this.wall; w.onTrades(ts, tr); w.onBook(ts, b, thr);
    const total = w.n.E + w.n.H + w.n.P, fresh = Math.min(w.events.length, total - this.nWall); this.nWall = total;
    for (let i = w.events.length - fresh; i < w.events.length; i++) { const e = w.events[i]; this.setTag(e.idx, e.kind === 'H' ? 'A' : e.kind, e.side, ts); }
    for (const [i, e] of this.tags) if (ts - e.t >= this.fadeMs) this.tags.delete(i);

    this.size(ts, b);
    return true;
  }
  // net resting size added / pulled per level and the summary
  size(ts, b) {
    const cur = new Map(); b.bid.forEach((q, i) => { if (q > 0) cur.set(i, q); }); b.ask.forEach((q, i) => { if (q > 0) cur.set(i, -q); });
    if (ts - this.lastSnap >= SNAP_MS || !this.snaps.length) {
      const k = new Int32Array(cur.size), v = new Float32Array(cur.size); let n = 0;
      cur.forEach((q, i) => { k[n] = i; v[n++] = q; });
      this.snaps.push({ t: ts, k, v }); this.lastSnap = ts;
      while (this.snaps.length > 1 && ts - this.snaps[0].t > KEEP_MS) this.snaps.shift();
    }
    const res = this.diff(ts, b, cur, this.winMs);
    this.added = res.d; this.span = res.span;
    let resting = 0; for (let i = b.bb; i > b.bb - NEAR; i--) resting += b.bid.get(i) || 0; for (let i = b.ba; i < b.ba + NEAR; i++) resting += b.ask.get(i) || 0;
    const s = (win) => {
      const r = this.diff(ts, b, cur, win);
      let bs = 0, os = 0;
      r.d.forEach((d, i) => { if (i <= b.bb && i > b.bb - NEAR && r.side.get(i) > 0) bs += d; else if (i >= b.ba && i < b.ba + NEAR && r.side.get(i) < 0) os += d; });
      return { win, bids: bs, offers: os, span: r.span, ready: r.span >= 5000, partial: r.span < win * 0.8, text: verdict(bs, os, resting) };
    };
    this.sum = { s30: s(30000), s300: s(300000) };
  }
  // cur - the book `win` ago, per level, on the level's own side. span = how much history there really is (ms).
  diff(ts, b, cur, win) {
    const cut = ts - win; let old = this.snaps[0];
    for (let i = this.snaps.length - 1; i >= 0; i--) if (this.snaps[i].t <= cut) { old = this.snaps[i]; break; }
    if (!this.oldCache || this.oldCache.t !== old.t) { const mp = new Map(); for (let i = 0; i < old.k.length; i++) mp.set(old.k[i], old.v[i]); this.oldCache = { t: old.t, m: mp }; }
    const om = this.oldCache.m, d = new Map(), side = new Map();
    cur.forEach((q, i) => { const o = om.get(i) || 0; d.set(i, Math.abs(q) - (o * q > 0 ? Math.abs(o) : 0)); side.set(i, Math.sign(q)); });
    om.forEach((o, i) => { if (!cur.has(i)) { d.set(i, -Math.abs(o)); side.set(i, Math.sign(o)); } });
    return { d, side, span: ts - old.t };
  }
}
