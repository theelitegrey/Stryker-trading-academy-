// TradeZoro — Charts: ORDER-BOOK PACK (Owner order 2026-11-03). Six indicators in the "Order Flow" group, all built from data we already
// record: the futures L2 hub snapshots + trades (assets/chart-futures-l2.js) and the crypto exchange books + trades (assets/book-panel-sources.js).
//   stk_bk_speed   Book Speed (L2)                 sub-pane: how many resting levels change per second, calm / normal / fast from the session's own percentiles
//   stk_bk_bal     Liquidity Balance (L2)          sub-pane: resting bid and ask size within N ticks of price + their difference + the change since the session start
//   stk_bk_refill  Refill Detector (L2)            markers: a level hit by aggressive trades gets its size back within a few seconds
//   stk_bk_regime  Volatility Regime (L2)          bottom strip + legend: Tight / Normal / Wide from how spread the resting size is around price
//   stk_bk_large   Large Resting Orders (L2)       the single biggest levels now (top 0.5 % of the session), with size + how long they have sat there
//   stk_bk_track   Absorption & Iceberg Tracker (L1+L2)  sub-pane: cumulative absorption / iceberg hints / stop runs, buy side up, sell side down
//   stk_bk_walls   Wall Events (L2)                markers ON the heatmap walls: eaten (filled square), held / refilled (hollow square + H), pulled (grey x).
//                  Owner 2026-11-04: "big orders show on the heatmap but Big Trades does not": Big Trades marks single aggressive bursts, a wall is
//                  usually filled by many small orders or pulled. Its own indicator (not a Big Trades option) because it needs the BOOK: Big Trades
//                  is trade-only and also runs without L2. Walls = the Large Resting Orders size (same session histogram) or the heatmap's colour filter.
// Same gate as the other L2 tools (futures: l2Visible(); crypto books: Pro). No data = a plain note, never made-up numbers.
// Redraws are throttled to 5 a second, nothing runs while the tab is hidden. Maths: assets/chart-book-pack-data.js. Education only. Not financial advice.
import { registerFeed } from './chart-feeds.js?v=889';
import { isFree } from './chart-pro-gate.js?v=889';
import { l2Visible, l2Badge, l2Root, L2_TICK, L2_TYPES, acquire, rootState, TickFeed, bookHistory } from './chart-futures-l2.js?v=889';
import { decodeBookHistory } from './chart-orderflow.js?v=889';
import * as C from './book-panel-core.js?v=889';
import { openSource } from './book-panel-sources.js?v=889';
import { absorptionEvents, sweepEvents } from './chart-of-pro-data.js?v=889';
import { sweepBars } from './chart-of-pro.js?v=889';
import { icebergEvents } from './chart-liquidity-data.js?v=889';
import * as D from './chart-book-pack-data.js?v=889';
import { hfLive } from './chart-heat-filter.js?v=889';
import { STYLES as BM_STYLES } from './chart-bookmap.js?v=889';

export const BK_TYPES = ['stk_bk_speed', 'stk_bk_bal', 'stk_bk_refill', 'stk_bk_regime', 'stk_bk_large', 'stk_bk_track', 'stk_bk_walls'];
const UP = '#03c988', DN = '#f23645', CYAN = '#00adb5', AMBER = '#f5b301', VIOLET = '#9b7bff', GREY = '#8a90a0';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const CRYPTO = ['binance', 'coinbase', 'hyperliquid', 'binanceus', 'bybit', 'okx', 'bitget', 'kraken'];
const NOT_YET = 'Needs L2 (full order book). It is part of Pro.';
const NEED = 'Order-book tools work on NQ, ES, YM, RTY, CL, GC futures (and micros) and crypto.';
const MIN_GAP = 200;   // redraw at most 5 a second
const { clamp, num } = D;
const minHist = () => (typeof window !== 'undefined' && window.__stkBookPackMin) || 800;   // level sizes seen this session before the top-% size means anything (~20 s of a 20-level book)
const defaults = (schema) => Object.fromEntries(schema.map((i) => [i.key, i.defval]));
const light = () => { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } };
function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
const hhmm = (ms) => { try { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); } catch (e) { return ''; } };

// ---------------------------------------------------------------------------------------- one view of the book per N ticks
class DepthView {
  constructor(N) { this.N = N; this.speed = new D.Series(); this.bid = new D.Series(); this.ask = new D.Series(); this.sd = new D.Series(); this.prev = null; this.hist = null; this.hv = 0; this.sec = 0; this.chg = 0; this.cur = { bid: 0, ask: 0, sd: null }; }
  // live series with the recorder history in front (history = this.hist[name], built by Store.rebuildHist), rebuilt once per change
  all(name) {
    const live = this[name], h = this.hist && this.hist[name];
    if (!h || !h.t.length) return live;
    const key = live.t.length + ':' + (live.t.length ? live.t[0] : 0) + ':' + this.hv;
    this.memoAll = this.memoAll || {};
    const m = this.memoAll[name];
    if (m && m.key === key) return m.s;
    const cut = live.t.length ? live.t[0] : Infinity, out = new D.Series(1e9);
    for (let i = 0; i < h.t.length && h.t[i] < cut; i++) { out.t.push(h.t[i]); out.v.push(h.v[i]); }
    for (let i = 0; i < live.t.length; i++) { out.t.push(live.t[i]); out.v.push(live.v[i]); }
    this.memoAll[name] = { key, s: out };
    return out;
  }
  update(ts, bk) {
    const sec = Math.floor(ts / 1000);
    if (this.sec && sec !== this.sec) {   // the second is over: store it (a quiet second stores 0 changes)
      const t = this.sec * 1000;
      this.speed.push(t, this.chg); this.bid.push(t, this.cur.bid); this.ask.push(t, this.cur.ask); if (this.cur.sd != null) this.sd.push(t, this.cur.sd);
      this.chg = 0;
    }
    this.sec = sec;
    if (this.prev) this.chg += D.changes(this.prev, bk, this.N);
    this.prev = bk;
    const b = D.balance(bk, this.N); this.cur = { bid: b.bid, ask: b.ask, sd: D.spread(bk, this.N) };
  }
}

// ---------------------------------------------------------------------------------------- one store per symbol (shared by every indicator on it)
const stores = new Map();
class Store {
  constructor(spec) {
    this.spec = spec; this.key = spec.key; this.kind = spec.kind === 'futures' ? 'futures' : 'crypto'; this.refs = 0; this.ls = new Set();
    this.tick = spec.kind === 'futures' ? (L2_TICK[spec.root] || 0.25) : 0; this.status = 'loading'; this.note = '';
    this.last = null; this.since = 0; this.v = 0; this.views = new Map(); this.refills = new Map(); this.larges = new Map(); this.walls = new Map(); this.hist = new D.LogHist(); this.sess = 0;
    this.samples = []; this.secT = 0; this.minT = 0; this.absEv = []; this.iceEv = []; this.iceFrom = 0; this.pending = []; this.tf = null; this.lastCrypto = 0; this.stopFn = null; this.h = null;
    this.remote = []; this.hFrom = Infinity; this.hBusy = false; this.hFailAt = 0; this.hDone = false; this.hv = 0; this.born = Date.now(); this.hAt = 0;
    this.onVis = () => { if (!document.hidden) this.poke(); };
    document.addEventListener('visibilitychange', this.onVis);
    this.start();
  }
  start() {
    const s = this.spec;
    if (this.kind === 'futures') {
      this.h = acquire(s.root, (m) => this.frame(m), 20);   // the hub's 20-level snapshot is enough for every pack tool (N <= 20 ticks)
    } else {
      this.stopFn = openSource(s.prov, s.pair, {
        book: (b) => this.cryptoBook(b),
        trades: (l, back) => this.cryptoTrades(l, back),
        status: (st, note) => { this.status = st; this.note = note || ''; this.poke(); }
      });
    }
  }
  stop() { document.removeEventListener('visibilitychange', this.onVis); if (this.h) { this.h.release(); this.h = null; } if (this.stopFn) { try { this.stopFn(); } catch (e) {} this.stopFn = null; } }
  poke() { this.ls.forEach((f) => { try { f(); } catch (e) {} }); }
  feed() { return this.kind === 'futures' ? rootState(this.spec.root).trades : this.tf; }
  refill(o) { const k = [o.refillPct, o.withinSec, o.hitPct].join('|'); let r = this.refills.get(k); if (!r) { r = new D.RefillTracker(o); this.refills.set(k, r); r.since = Date.now(); } return r; }
  wall(o) { const k = [o.eatPct, o.holdPct, o.pullPct, o.nearTicks, o.rejectTicks].join('|'); let w = this.walls.get(k); if (!w) { w = { tr: new D.WallTracker(o), thr: null, pct: 0.5, min: 0, since: Date.now() }; this.walls.set(k, w); } return w; }
  wallThr(w) { return w.min > 0 ? w.min : this.hist.n >= minHist() ? this.hist.top(w.pct) : null; }
  large(pct) { let l = this.larges.get(pct); if (!l) { l = { pct, tr: new D.LargeTracker(), thr: null }; this.larges.set(pct, l); } return l; }

  // ---- recorder backfill (futures): the SAME /ts-book-history read the heatmap uses (bookHistory shares it), 6 h a read, leftwards
  need(fromMs) {
    if (this.kind !== 'futures' || this.hBusy || this.hDone) return;
    const now = Date.now();
    if (this.hFailAt && now - this.hFailAt < 60000) return;
    const target = Math.floor(Math.max(fromMs, now - 24 * 3600000) / 60000) * 60000;
    if (!(target < this.hFrom - 60000)) { this.hDone = true; return; }
    const to = Number.isFinite(this.hFrom) ? this.hFrom : Math.ceil(now / 60000) * 60000, from = Math.max(target, to - 6 * 3600000);
    this.hBusy = true; if (!this.hAt) this.hAt = now;
    // never hang: a read that has not answered in 12 s counts as failed (retried after 60 s); the note never sits on "Loading"
    Promise.race([bookHistory(this.spec.root, from, to), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000))]).then((r) => {
      const got = decodeBookHistory(r.buf); if (!got) throw new Error('bad body');
      const seen = new Set(this.remote.map((x) => x.ts));
      this.remote = this.remote.concat(got.filter((x) => !seen.has(x.ts))).sort((a, b) => a.ts - b.ts);
      this.hFailAt = 0; this.rebuildHist();
      if (r.left > 0 && (this.tries = (this.tries || 0) + 1) < 60) setTimeout(() => { this.hBusy = false; this.need(fromMs); }, 1100);
      else { this.hFrom = from; this.tries = 0; this.hBusy = false; if (from <= target) this.hDone = true; this.poke(); }
    }).catch(() => { this.hFailAt = Date.now(); this.tries = 0; this.hBusy = false; });
  }
  // first time the book is known: recorder history, else the first live frame
  knownFrom() { return this.remote.length ? Math.min(this.remote[0].ts, this.since || Infinity) : this.since; }
  rebuildHist() {
    const R = this.remote, tick = this.tick;
    this.views.forEach((v) => {
      const h = { speed: new D.Series(1e9), bid: new D.Series(1e9), ask: new D.Series(1e9), sd: new D.Series(1e9) };
      for (let k = 0; k < R.length; k++) {
        const a = R[k], nx = k + 1 < R.length ? R[k + 1].ts : a.ts + 60000, end = Math.min(nx, a.ts + 5 * 60000);
        const w = D.coarseWindow(a, v.N, tick), pw = k && R[k - 1].step === a.step ? D.coarseWindow(R[k - 1], v.N, tick) : null;
        const sp = pw ? D.coarseChanges(pw, w, tick) / Math.max(1, (a.ts - R[k - 1].ts) / 1000) : null;
        for (let t = a.ts; t < end; t += 30000) {
          h.bid.push(t, w.bid); h.ask.push(t, w.ask); if (w.sd != null) h.sd.push(t, w.sd); if (sp != null) h.speed.push(t, sp);
        }
      }
      v.hist = h; v.hv++; v.memoAll = null;
    });
    this.hv++; this.poke();
  }
  view(N) { let v = this.views.get(N); if (!v) { v = new DepthView(N); this.views.set(N, v); if (this.remote.length) this.rebuildHist(); } return v; }

  // ---- futures hub frames
  frame(m) {
    const r = rootState(this.spec.root);
    if (!m) { this.status = r.status === 'live' ? 'live' : r.status === 'error' ? 'error' : 'loading'; this.poke(); return; }
    if (document.hidden) return;
    if (m.type === 'snap') { const bk = D.bookFromLists(m.bids, m.asks, this.tick); if (bk) { this.status = 'live'; this.onBook(bk); } }
    else if (m.type === 'ticks' && m.t && m.t.length) {
      const rows = m.t.map((x) => ({ idx: Math.round(x[0] / this.tick), size: x[1], side: x[2] > 0 ? 1 : -1 }));
      this.refills.forEach((t) => t.onTrades(Date.now(), rows)); this.walls.forEach((w) => w.tr.onTrades(Date.now(), rows));
    }
  }
  // ---- crypto
  cryptoBook(b) {
    if (document.hidden) return;
    const now = Date.now(); if (now - this.lastCrypto < 250) return; this.lastCrypto = now;
    if (!this.tick) {
      let bp = 0, ap = Infinity; b.bids.forEach((q, p) => { if (p > bp) bp = p; }); b.asks.forEach((q, p) => { if (p < ap) ap = p; });
      if (!(bp > 0) || !(ap < Infinity)) return;
      this.tick = C.autoStep((bp + ap) / 2); this.tf = new TickFeed('NQ'); this.tf.tick = this.tick;
      const p = this.pending; this.pending = []; for (const x of p) this.cryptoTrades(x.l, x.back);
    }
    const bk = D.bookFromMaps(b.bids, b.asks, this.tick); if (bk) { this.status = 'live'; this.onBook(bk); }
  }
  cryptoTrades(list, back) {
    if (!this.tick) { this.pending.push({ l: list, back }); if (this.pending.length > 50) this.pending.shift(); return; }
    this.tf.add(list.map((x) => [x.p, x.s, x.side, x.t]), !!back);
    if (!back && !document.hidden) { const rows = list.map((x) => ({ idx: x.side > 0 ? Math.ceil(x.p / this.tick - 1e-9) : Math.floor(x.p / this.tick + 1e-9), size: x.s, side: x.side > 0 ? 1 : -1 })); this.refills.forEach((t) => t.onTrades(Date.now(), rows)); this.walls.forEach((w) => w.tr.onTrades(Date.now(), rows)); }
  }

  // ---- one book update
  onBook(bk) {
    const ts = Date.now();
    if (!this.since) this.since = ts;
    this.last = bk; this.lastTs = ts;
    this.views.forEach((v) => v.update(ts, bk));
    this.refills.forEach((t) => t.onBook(ts, bk));
    this.larges.forEach((l) => l.tr.update(ts, bk, l.thr));
    this.walls.forEach((w) => w.tr.onBook(ts, bk, w.thr));
    const sec = Math.floor(ts / 1000);
    if (sec !== this.secT) { this.secT = sec; this.perSecond(ts, bk); }
    this.v++; this.poke();
  }
  perSecond(ts, bk) {
    const ss = D.sessionStart(ts, this.kind);
    if (ss !== this.sess) { this.sess = ss; this.hist.reset(); }
    for (let i = bk.bb, k = 0; k < 20; i--, k++) this.hist.add(bk.bid.get(i));
    for (let i = bk.ba, k = 0; k < 20; i++, k++) this.hist.add(bk.ask.get(i));
    this.larges.forEach((l) => { l.thr = this.hist.n >= minHist() ? this.hist.top(l.pct) : null; });
    this.walls.forEach((w) => { w.thr = this.wallThr(w); });
    // 1 s sample for the iceberg hint (bids +, asks -): the same row shape icebergEvents reads
    let lo = bk.bb, hi = bk.ba;
    bk.bid.forEach((q, i) => { if (i < lo) lo = i; }); bk.ask.forEach((q, i) => { if (i > hi) hi = i; });
    const v = new Float32Array(hi - lo + 1);
    bk.bid.forEach((q, i) => { v[i - lo] = q; }); bk.ask.forEach((q, i) => { v[i - lo] = -q; });
    this.samples.push({ ts, step: this.tick, i0: lo, v });
    while (this.samples.length && this.samples[0].ts < ts - 12 * 60000) this.samples.shift();
    if (Math.floor(ts / 1000) % 10 === 0 || !this.absAt) this.refreshAbs(Math.floor(ts / 60000) * 60000);
    const m = Math.floor(ts / 60000) * 60000;
    if (m !== this.minT) { const first = !this.minT; this.minT = m; if (!first) this.minuteClosed(m); else this.iceFrom = m; }
  }
  // the minute before `m` is closed: absorption (whole session, from the footprint minutes) and iceberg hints (new minute only)
  refreshAbs(m) {
    const tf = this.feed(); if (!tf) return;
    this.absAt = Date.now();
    try { this.absEv = D.absorptionList(absorptionEvents, tf.bars().filter((b) => b.t < m)); } catch (e) { /* a bad minute never breaks the chart */ }
  }
  minuteClosed(m) {
    const tf = this.feed(); if (!tf) return;
    try {
      const bars = tf.bars().filter((b) => b.t < m);
      const from = m - 10 * 60000;
      const mins = bars.filter((b) => b.t >= from && b.t >= tf.coverFrom), samples = this.samples.filter((s) => s.ts >= from);
      if (mins.length && samples.length) for (const e of icebergEvents(samples, mins, { step: this.tick, tick: this.tick })) if (e.t >= this.iceFrom && e.t < m) this.iceEv.push({ t: e.t + 30000, d: e.side });
      if (this.iceEv.length > 5000) this.iceEv.splice(0, this.iceEv.length - 5000);
    } catch (e) { /* a bad minute never breaks the chart */ }
    this.iceFrom = m;
  }
}
function acquireStore(spec, listener) {
  let s = stores.get(spec.key);
  if (!s) { s = new Store(spec); stores.set(spec.key, s); }
  s.refs++; s.ls.add(listener);
  return { s, release() { s.ls.delete(listener); if (--s.refs <= 0) { s.stop(); stores.delete(spec.key); } } };
}
function specOf(ctx) {
  const sym = String(ctx.symbol || ''), m = /^([a-z0-9]+):(.+)$/i.exec(sym), prov = m ? m[1].toLowerCase() : '', tk = m ? m[2] : sym;
  let p2 = prov, t2 = tk; try { const r = ctx.data.resolve(ctx.symbol); if (r && r.provider) { p2 = String(r.provider).toLowerCase(); t2 = r.ticker || tk; } } catch (e) {}   // same lookup as the chart's own market test
  if (p2 === 'futures' || (!CRYPTO.includes(p2) && /1!$/.test(t2))) { const root = l2Root(t2); return root ? { kind: 'futures', root, key: 'f|' + root } : null; }
  if (CRYPTO.includes(prov)) { const pair = C.pairOf(tk); return { kind: 'crypto', prov, pair, key: 'c|' + prov + '|' + pair.base + pair.quote + pair.perp }; }
  return null;
}

// ---------------------------------------------------------------------------------------- settings
const BAND_COLORS = [{ key: 'calmColor', title: 'Calm', type: 'color', defval: CYAN }, { key: 'normalColor', title: 'Normal', type: 'color', defval: GREY }, { key: 'fastColor', title: 'Fast', type: 'color', defval: AMBER }];
const SCHEMA = {
  stk_bk_speed: [
    { key: 'ticks', title: 'Depth (ticks each side of price)', type: 'int', defval: 20, min: 3, max: 20, step: 1, tooltip: 'Counts level changes this close to price.' },
    { key: 'smooth', title: 'Smoothing (bars)', type: 'int', defval: 3, min: 1, max: 30, step: 1 },
    { key: 'calmPct', title: 'Calm at or below (session percentile)', type: 'int', defval: 25, min: 5, max: 45, step: 1 },
    { key: 'fastPct', title: 'Fast at or above (session percentile)', type: 'int', defval: 75, min: 55, max: 95, step: 1 }
  ].concat(BAND_COLORS),
  stk_bk_bal: [
    { key: 'ticks', title: 'Depth (ticks each side of price)', type: 'int', defval: 20, min: 3, max: 20, step: 1 },
    { key: 'bidColor', title: 'Bid size', type: 'color', defval: UP },
    { key: 'askColor', title: 'Ask size', type: 'color', defval: DN },
    { key: 'showLines', title: 'Show the two size lines', type: 'bool', defval: true }
  ],
  stk_bk_refill: [
    { key: 'refillPct', title: 'Refilled to at least (% of the size before the hit)', type: 'int', defval: 70, min: 10, max: 200, step: 5 },
    { key: 'withinSec', title: 'Within (seconds)', type: 'float', defval: 3, min: 0.5, max: 30, step: 0.5 },
    { key: 'hitPct', title: 'Level hit by at least (% of its size)', type: 'int', defval: 30, min: 5, max: 100, step: 5 },
    { key: 'labels', title: 'Show the R label', type: 'bool', defval: true },
    { key: 'bidColor', title: 'Bid refilled (supports up)', type: 'color', defval: UP },
    { key: 'askColor', title: 'Ask refilled (supports down)', type: 'color', defval: DN }
  ],
  stk_bk_regime: [
    { key: 'ticks', title: 'Depth (ticks each side of price)', type: 'int', defval: 20, min: 3, max: 20, step: 1 },
    { key: 'tightPct', title: 'Tight at or below (session percentile)', type: 'int', defval: 25, min: 5, max: 45, step: 1 },
    { key: 'widePct', title: 'Wide at or above (session percentile)', type: 'int', defval: 75, min: 55, max: 95, step: 1 },
    { key: 'tightColor', title: 'Tight', type: 'color', defval: CYAN }, { key: 'normalColor', title: 'Normal', type: 'color', defval: GREY }, { key: 'wideColor', title: 'Wide', type: 'color', defval: AMBER }
  ],
  stk_bk_large: [
    { key: 'topPct', title: 'Top % of the session\'s level sizes', type: 'float', defval: 0.5, min: 0.1, max: 5, step: 0.1 },
    { key: 'maxShown', title: 'Show at most', type: 'int', defval: 6, min: 1, max: 20, step: 1 },
    { key: 'bidColor', title: 'Bid', type: 'color', defval: UP }, { key: 'askColor', title: 'Ask', type: 'color', defval: DN }
  ],
  stk_bk_track: [
    { key: 'showAbs', title: 'Absorption', type: 'bool', defval: true },
    { key: 'showIce', title: 'Iceberg hints', type: 'bool', defval: true },
    { key: 'showSweep', title: 'Stop runs / sweeps', type: 'bool', defval: true },
    { key: 'absColor', title: 'Absorption', type: 'color', defval: CYAN },
    { key: 'iceColor', title: 'Iceberg hints', type: 'color', defval: AMBER },
    { key: 'sweepColor', title: 'Stop runs', type: 'color', defval: VIOLET }
  ],
  stk_bk_walls: [
    { group: 'Walls', key: 'wallFrom', title: 'A wall is', type: 'string', defval: 'Heatmap colour filter', options: ['Heatmap colour filter', 'Top % of sizes', 'Min size'], tooltip: 'Heatmap colour filter: follows the heatmap\'s "Show from colour" (All = the top % below).' },
    { group: 'Walls', key: 'topPct', title: 'Top % of the session\'s level sizes', type: 'float', defval: 0.5, min: 0.1, max: 10, step: 0.1, when: { key: 'wallFrom', anyOf: ['Heatmap colour filter', 'Top % of sizes'] }, tooltip: 'The same rule as Large Resting Orders (L2).' },
    { group: 'Walls', key: 'minSize', title: 'Min size (contracts / coins)', type: 'float', defval: 200, min: 1, max: 1000000, step: 1, when: { key: 'wallFrom', anyOf: ['Min size'] } },
    { group: 'Eaten', key: 'showEaten', title: 'Wall eaten (filled square)', type: 'bool', defval: true },
    { group: 'Eaten', key: 'eatPct', title: 'Traded at the wall at least (% of its size)', type: 'int', defval: 50, min: 10, max: 200, step: 5 },
    { group: 'Held', key: 'showHeld', title: 'Wall held / refilled (hollow square + H)', type: 'bool', defval: true },
    { group: 'Held', key: 'holdPct', title: 'Traded into it at least (% of its size)', type: 'int', defval: 50, min: 10, max: 500, step: 5 },
    { group: 'Held', key: 'rejectTicks', title: 'Price turned away by (ticks)', type: 'int', defval: 4, min: 1, max: 40, step: 1 },
    { group: 'Pulled', key: 'showPulled', title: 'Wall pulled (grey x)', type: 'bool', defval: true, tooltip: 'Gone with little trading at its price while price was near: a possible spoof.' },
    { group: 'Pulled', key: 'pullPct', title: 'Traded less than (% of its size)', type: 'int', defval: 10, min: 0, max: 50, step: 1 },
    { group: 'Pulled', key: 'nearTicks', title: 'While price was within (ticks)', type: 'int', defval: 8, min: 1, max: 19, step: 1 },
    { group: 'Plot', key: 'buyColor', title: 'Buyers (ask wall)', type: 'color', defval: UP },
    { group: 'Plot', key: 'sellColor', title: 'Sellers (bid wall)', type: 'color', defval: DN },
    { group: 'Plot', key: 'pulledColor', title: 'Pulled', type: 'color', defval: GREY }
  ]
};
const TITLES = {
  stk_bk_speed: ['Book Speed (L2)', 'Book Speed', 'new', false, 'L2'],
  stk_bk_bal: ['Liquidity Balance (L2)', 'Liquidity Balance', 'new', false, 'L2'],
  stk_bk_refill: ['Refill Detector (L2)', 'Refill Detector', 'price', true, 'L2'],
  stk_bk_regime: ['Volatility Regime (L2)', 'Volatility Regime', 'price', true, 'L2'],
  stk_bk_large: ['Large Resting Orders (L2)', 'Large Resting Orders', 'price', true, 'L2'],
  stk_bk_track: ['Absorption & Iceberg Tracker (L1+L2)', 'Abs & Iceberg Tracker', 'new', false, 'L2'],
  stk_bk_walls: ['Wall Events (L2)', 'Wall Events', 'price', true, 'L2']
};

// The chart mounts the pane from the FIRST emit and later emits only update the series it already has, so every emit
// of Book Speed (including the 'Connecting...' one before the first frame) must carry this same series.
const speedSeries = (points, color) => ({ id: 'bk-speed', title: 'Book speed (x usual pace)', paneId: '', kind: 'histogram', points, style: { color, width: 1, lineStyle: 'solid', base: 0 } });
const balSeries = (bars, diff, bid, ask, I) => {
  const series = [{ id: 'bk-diff', title: 'Bid - ask', paneId: '', kind: 'histogram', points: bars.map((x, i) => (diff[i] == null ? { time: x.time, value: null } : { time: x.time, value: Math.round(diff[i]), color: rgba(diff[i] >= 0 ? I.bidColor : I.askColor, 0.55) })), style: { color: I.bidColor, width: 1, lineStyle: 'solid', base: 0 } }];
  if (I.showLines !== false) series.push(H.line('bk-bid', 'Resting bid size', bars, bid, I.bidColor, 2), H.line('bk-ask', 'Resting ask size', bars, ask, I.askColor, 2));
  return series;
};
// ---------------------------------------------------------------------------------------- the indicator
let H = null;
class BkNative {
  constructor(type) { this.type = type; this.inputs = defaults(SCHEMA[type]); this.tm = 0; this.last = 0; this.h = null; this.spec = null; this.on = false; this.off = false; this.onAny = () => this.later(); this.ms = 0; this.n = 0; this.memo = {}; }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = Object.assign(defaults(SCHEMA[this.type]), inputs); this.on = true; this.onVis = () => { if (!document.hidden) this.later(); }; document.addEventListener('visibilitychange', this.onVis); this.onTier = () => this.later(); window.addEventListener('stryker:l2tier', this.onTier); this.render(); }
  // at most 5 redraws a second; none while the tab is hidden
  later() {
    if (this.tm || this.off || document.hidden) return;
    this.tm = setTimeout(() => { this.tm = 0; this.render(); }, Math.max(0, MIN_GAP - (Date.now() - this.last)));
  }
  onBars() { this.later(); }
  onViewport() { if (this.type === 'stk_bk_refill' || this.type === 'stk_bk_large' || this.type === 'stk_bk_walls') this.push(); }
  setInputs(i) { this.inputs = Object.assign(defaults(SCHEMA[this.type]), i); this.memo = {}; this.render(); }
  suspend() { this.on = false; clearTimeout(this.tm); this.tm = 0; this.push(); }
  resume() { this.on = true; this.render(); }
  stop() { this.off = true; this.on = false; clearTimeout(this.tm); clearTimeout(this.ltm); document.removeEventListener('visibilitychange', this.onVis); if (this.onTier) window.removeEventListener('stryker:l2tier', this.onTier); this.unbind(); this.push(); }
  unbind() { if (this.h) { this.h.release(); this.h = null; this.spec = null; } }
  bind(spec) { if (this.spec && this.spec.key === spec.key && this.h) return; this.unbind(); this.h = acquireStore(spec, this.onAny); this.spec = spec; }
  push(extra) { try { this.ctx.pushData(Object.assign({ owner: this, on: this.on && !this.off, type: this.type }, extra || {})); } catch (e) {} }
  say(txt, series) {
    const id = this.type;
    this.ctx.setStatus('idle');
    this.ctx.emit({ series: series || [], tables: [H.message(id + '-msg', txt, H.pageIsDay(), 'top_right')] });
    this.push({ off: true });
  }
  gate() {
    const spec = specOf(this.ctx);
    if (!spec) return { msg: NEED };
    if (spec.kind === 'futures' ? !l2Badge() : isFree()) return { msg: NOT_YET };
    return { spec };
  }
  legend(lines, color) {
    const day = light();
    return { id: this.type + '-leg', paneId: '', position: 'top_right', columns: 1, rows: lines.length, bgColor: day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.88)', frameWidth: 0, borderWidth: 0,
      cells: lines.map((t, i) => [{ text: t, textColor: i === 0 && color ? color : (day ? '#334155' : '#a3a9b6'), hAlign: 'right', vAlign: 'center', textSize: 'small', fontFamily: 'monospace', bold: i === 0, italic: false }]), merges: [] };
  }
  render() {
    this.last = Date.now();
    if (!this.ctx || this.off) return;
    const t0 = performance.now(); this.emitMs = 0;
    if (!this.emitWrapped) { this.emitWrapped = true; const me = this; for (const k of ['emit', 'setStatus', 'pushData']) { const f = this.ctx[k].bind(this.ctx); this.ctx[k] = (x) => { const a = performance.now(); try { return f(x); } finally { me.emitMs += performance.now() - a; } }; } }
    // our own work only: the chart library's emit / pushData (its layout + paint) is timed apart
    try { this.draw(); } finally { this.ms += performance.now() - t0 - this.emitMs; this.n++; (window.__stkBookPack || (window.__stkBookPack = {}))[this.type] = { renders: this.n, avgMs: this.ms / this.n }; }
  }
  draw() {
    const g = this.gate();
    if (g.msg) { this.unbind(); return this.say(g.msg); }
    this.bind(g.spec);
    const s = this.h.s, I = this.inputs, ctx = this.ctx, bars = ctx.bars(), t = this.type;
    if (s.kind === 'futures' && bars.length) s.need(bars[0].time);
    if (!s.last && !s.remote.length) { ctx.setStatus('loading'); ctx.emit({ series: t === 'stk_bk_speed' ? [speedSeries(bars.map((x) => ({ time: x.time, value: null })), I.normalColor)] : t === 'stk_bk_bal' ? balSeries(bars, bars.map(() => null), bars.map(() => null), bars.map(() => null), I) : [], tables: [H.message(t + '-msg', s.status === 'unlisted' || s.status === 'error' ? (s.note || 'Order book unavailable.') : 'Connecting to the order book…', H.pageIsDay(), 'top_right')] }); this.push({ off: true }); return; }
    ctx.setStatus('live');
    const tf = bars.length > 1 ? bars[bars.length - 1].time - bars[bars.length - 2].time : 60000;
    const kind = s.kind, ss = D.sessionStart(Date.now(), kind);
    // honest note only once the recorder read is settled and truly holds nothing earlier than the first bar shown (member's local time)
    const kf = s.knownFrom(), first = bars.length ? bars[0].time : 0;
    // "Loading" at most ~10 s from the first read (or from the store's birth if no read could start yet); then the honest result
    const loading = s.kind === 'futures' && !(s.hDone || s.hFailAt) && Date.now() - (s.hAt || s.born || 0) < 10000;
    const since = loading ? 'Loading book history…' : s.kind === 'futures' && !s.remote.length && (s.hDone || s.hFailAt || s.hAt) ? 'No earlier book history' : (kf > Math.max(ss, first) + 300000 ? 'No book history before ' + hhmm(kf) : '');
    if (loading && !this.ltm) this.ltm = setTimeout(() => { this.ltm = 0; this.later(); }, 2500);   // re-check so the 10 s cap shows even with no new frames
    if (t === 'stk_bk_speed') return this.drawSpeed(s, I, bars, tf, ss, since);
    if (t === 'stk_bk_bal') return this.drawBal(s, I, bars, tf, ss, since);
    if (t === 'stk_bk_regime') return this.drawRegime(s, I, bars, tf, since);
    if (t === 'stk_bk_refill') return this.drawRefill(s, I, since);
    if (t === 'stk_bk_large') return this.drawLarge(s, I);
    if (t === 'stk_bk_walls') return this.drawWalls(s, I);
    return this.drawTrack(s, I, bars, kind, since);
  }
  // values per bar -> { cuts, band[] } against the bars' own session history (needs >= 8 values)
  // history and live are different measures (recorded snapshots vs every update), so each gets its own percentiles
  bands(vals, bars, lo, hi, cut) {
    const ss = D.sessionStart(bars.length ? bars[bars.length - 1].time : Date.now(), this.spec.kind === 'futures' ? 'futures' : 'crypto');
    const seg = (a, b) => { const sv = []; for (let i = 0; i < bars.length; i++) if (bars[i].time >= Math.max(ss, a) && bars[i].time < b && vals[i] != null) sv.push(vals[i]); return sv.length >= 8 ? D.percentiles(sv, [lo, hi]) : [null, null]; };
    const c = cut || 0, h = c ? seg(0, c) : [null, null], l = seg(c, Infinity);
    return { band: vals.map((v, i) => { const p = c && bars[i].time < c ? h : l; return D.band(v, p[0], p[1]); }) };
  }
  drawSpeed(s, I, bars, tf, ss, since) {
    const v = s.view(clamp(Math.round(num(I.ticks, 20)), 3, 20));
    // history (recorder snapshots) and live (every update) are different measures, so each sample is divided by the median of its own segment first: one scale, bars read as "x the usual pace"
    const all = v.all('speed'), cut = s.since || 0, med = (lo, hi) => { const sv = []; for (let i = 0; i < all.t.length; i++) if (all.t[i] >= lo && all.t[i] < hi && all.v[i] > 0) sv.push(all.v[i]); const m = sv.length >= 5 ? D.percentiles(sv, [50])[0] : null; return m > 0 ? m : null; };
    const mh = med(0, cut || Infinity), ml = cut ? med(cut, Infinity) : null, rs = new D.Series(1e9);
    for (let i = 0; i < all.t.length; i++) { const m = cut && all.t[i] >= cut ? ml : mh; if (m) rs.push(all.t[i], all.v[i] / m); }
    const raw = D.perBar(rs, bars, tf, 'mean'), sm = D.ema(raw, clamp(Math.round(num(I.smooth, 3)), 1, 30));
    const b = this.bands(sm, bars, num(I.calmPct, 25), num(I.fastPct, 75)), cols = [I.calmColor, I.normalColor, I.fastColor], names = ['Calm', 'Normal', 'Fast'];
    const pts = bars.map((x, i) => (sm[i] == null ? { time: x.time, value: null } : { time: x.time, value: Math.round(sm[i] * 100) / 100, color: cols[b.band[i]] }));
    let li = sm.length - 1; while (li >= 0 && sm[li] == null) li--;
    const now = li >= 0 ? sm[li] : null, bi = li >= 0 ? b.band[li] : 1;
    this.ctx.emit({ series: [speedSeries(pts, I.normalColor)],
      priceLines: [{ id: 'bk-speed-0', paneId: '', price: 0, color: light() ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.3)', lineStyle: 'dashed', width: 1, title: '' }],
      tables: [this.legend(['Book Speed ' + (now == null ? '…' : now.toFixed(1) + '× · ' + names[bi]), since || 'times the usual pace'], cols[bi])] });
    this.push({ off: true });
  }
  drawBal(s, I, bars, tf, ss, since) {
    const v = s.view(clamp(Math.round(num(I.ticks, 20)), 3, 20));
    const vb = v.all('bid'), va = v.all('ask'), bid = D.perBar(vb, bars, tf, 'last'), ask = D.perBar(va, bars, tf, 'last');
    const diff = bid.map((x, i) => (x == null || ask[i] == null ? null : x - ask[i]));
    const series = balSeries(bars, diff, bid, ask, I);
    const j = vb.from(ss), lb = vb.last, la = va.last;
    const pct = (a, b) => (a > 0 && b != null ? (b / a - 1) * 100 : null), sg = (x) => (x == null ? 'n/a' : (x >= 0 ? '+' : '') + x.toFixed(0) + '%');
    const hasStart = j < vb.t.length && vb.t[j] - ss < 120000;
    const l2 = hasStart ? 'Since session start: bid ' + sg(pct(vb.v[j], lb)) + ' · ask ' + sg(pct(va.v[j], la)) : (since || 'Since session start: n/a');
    const cb = lb == null ? 0 : lb, ca = la == null ? 0 : la;
    this.ctx.emit({ series, priceLines: [{ id: 'bk-bal-0', paneId: '', price: 0, color: '#787b86', lineStyle: 'dashed', width: 1, title: '' }], tables: [this.legend(['Bid ' + D.fmtK(cb) + ' · Ask ' + D.fmtK(ca) + ' · Δ ' + (cb - ca >= 0 ? '+' : '') + D.fmtK(cb - ca), l2], cb >= ca ? I.bidColor : I.askColor)] });
    this.push({ off: true });
  }
  drawRegime(s, I, bars, tf, since) {
    const v = s.view(clamp(Math.round(num(I.ticks, 20)), 3, 20));
    const sdv = v.all('sd'), raw = D.perBar(sdv, bars, tf, 'mean'), sm = D.ema(raw, 3);
    const b = this.bands(sm, bars, num(I.tightPct, 25), num(I.widePct, 75), s.since), cols = [I.tightColor, I.normalColor, I.wideColor], names = ['Tight', 'Normal', 'Wide'];
    let li = sm.length - 1; while (li >= 0 && sm[li] == null) li--;
    const bi = li >= 0 ? b.band[li] : 1;
    this.ctx.emit({ tables: [this.legend(['Regime ' + (li >= 0 ? names[bi] : '…'), since || (sdv.last != null ? 'spread ' + sdv.last.toFixed(1) + ' ticks' : '')], cols[bi])] });
    this.push({ strip: bars.map((x, i) => (sm[i] == null ? -1 : b.band[i])), cols, nbars: bars.length, firstT: bars.length ? bars[0].time : 0 });
  }
  drawRefill(s, I, since) {
    const tr = s.refill(I);
    this.tracker = tr; this.store = s;
    const n = tr.events.length;
    this.ctx.emit({ tables: [this.legend(['Refills ' + n, 'since ' + hhmm(tr.since) + (since ? '' : '')])] });
    this.push({ tracker: tr, tick: s.tick, v: s.v });
  }
  drawLarge(s, I) {
    const pct = clamp(num(I.topPct, 0.5), 0.1, 5), l = s.large(pct);
    this.large = l; this.store = s;
    const learning = l.thr == null;
    this.ctx.emit({ tables: [this.legend([learning ? 'Learning this session\'s sizes…' : 'Large ≥ ' + D.fmtK(l.thr), 'top ' + pct + '% of levels'])] });
    this.push({ large: l, tick: s.tick, v: s.v });
  }
  // the futures heatmap's "Show from colour" step on this book (chart-heat-filter.js hfLive), as a top % of sizes; null = no step set
  heatPct() {
    const h = this.spec && this.spec.kind === 'futures' ? hfLive.get(this.spec.root) : null; if (!h) return null;
    const S = BM_STYLES[h.look === 'midnight' ? 'bookmap' : h.look] || BM_STYLES.bookmap;   // shortcut: Classic's Deep ramp has no rank table, the Midnight one stands in
    return D.topPctForStep(S.anchors, h.p);
  }
  drawWalls(s, I) {
    const w = s.wall({ eatPct: num(I.eatPct, 50), holdPct: num(I.holdPct, 50), pullPct: num(I.pullPct, 10), nearTicks: num(I.nearTicks, 8), rejectTicks: num(I.rejectTicks, 4) });
    const mode = I.wallFrom || 'Heatmap colour filter', hp = mode === 'Heatmap colour filter' ? this.heatPct() : null;
    w.min = mode === 'Min size' ? Math.max(1, num(I.minSize, 200)) : 0; w.pct = hp != null ? hp : clamp(num(I.topPct, 0.5), 0.05, 10);
    if (w.thr == null || w.min) w.thr = s.wallThr(w);
    this.walls = w; this.store = s;
    const n = w.tr.n, row = [];
    if (I.showEaten !== false) row.push('Eaten ' + n.E); if (I.showHeld !== false) row.push('Held ' + n.H); if (I.showPulled !== false) row.push('Pulled ' + n.P);
    // phones: one short line, so the box stays clear of the symbol legend on the left (seen at 390)
    const phone = window.innerWidth < 520, sub = w.thr == null ? 'Learning this session\'s sizes…' : 'walls ≥ ' + D.fmtK(w.thr) + (hp != null ? ' (heatmap filter)' : '') + ' · since ' + hhmm(w.since);
    const lines = phone ? [(w.thr == null ? 'Learning sizes… · ' : '') + 'E ' + n.E + ' · H ' + n.H + ' · P ' + n.P] : [row.join(' · ') || 'Nothing selected', sub];
    window.__stkWallSub = sub;
    window.__stkWallLegend = lines;   // test hook
    this.ctx.emit({ tables: [this.legend(lines)] });
    this.push({ walls: w, tick: s.tick, v: s.v });
  }
  drawTrack(s, I, bars, kind, since) {
    const series = [], row = [];
    if (!s.absAt || Date.now() - s.absAt > 10000) s.refreshAbs(Math.floor(Date.now() / 60000) * 60000);   // footprint minutes come from /ts-aux, also before the first live frame
    if (I.showAbs !== false) { const a = D.cumulate(bars, s.absEv, kind); series.push(H.line('bk-abs', 'Absorption', bars, a, I.absColor, 2)); row.push('Abs ' + (a.length ? a[a.length - 1] : 0)); }
    if (I.showIce !== false) { const a = D.cumulate(bars, s.iceEv, kind); series.push(H.line('bk-ice', 'Iceberg hints', bars, a, I.iceColor, 2)); row.push('Ice ' + (a.length ? a[a.length - 1] : 0)); }
    if (I.showSweep !== false && bars.length > 12) {
      const key = bars.length + '|' + bars[0].time + '|' + bars[bars.length - 1].time + '|' + bars[bars.length - 2].close;
      if (this.memo.swKey !== key) { this.memo.swKey = key; this.memo.sw = sweepEvents(sweepBars(bars, null).slice(0, -1)).map((e) => ({ t: bars[e.i].time, d: e.side === 0 ? 1 : -1 })); }
      const a = D.cumulate(bars, this.memo.sw, kind); series.push(H.line('bk-swp', 'Stop runs', bars, a, I.sweepColor, 2)); row.push('Runs ' + (a.length ? a[a.length - 1] : 0));
    }
    this.ctx.emit({ series, tables: [this.legend([row.join(' · ') || 'Nothing selected', since || 'buy side up · sell side down'])], priceLines: [{ id: 'bk-track-0', paneId: '', price: 0, color: '#787b86', lineStyle: 'dotted', width: 1 }] });
    this.push({ off: true });
  }
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

function refillLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a); if (!g) return;
      try {
        const o = a.data.owner, I = o.inputs, tr = a.data.tracker, tick = a.data.tick, co = a.coords, phone = co.width < 520;
        if (!tr || !tick) return;
        const vr = co.visibleLogicalRange(), i0 = Math.floor(vr.from) - 1, i1 = Math.ceil(vr.to) + 1, top = a.bounds.top, bot = top + a.bounds.height, r = phone ? 4.5 : 5.5;
        g.font = '700 ' + (phone ? 8 : 9) + 'px ' + MONO; g.textAlign = 'center'; g.textBaseline = 'middle';
        let drawn = 0;
        for (let k = tr.events.length - 1; k >= 0 && drawn < 120; k--) {
          const e = tr.events[k], i = D.idxOf(a.bars, e.t);
          if (i < i0 || i > i1) continue;
          const x = co.logicalToX(i), y = Yp(a, e.idx * tick);
          if (y < top - 10 || y > bot + 10) continue;
          const col = e.side > 0 ? (I.bidColor || UP) : (I.askColor || DN), up = e.side > 0, ty = up ? y + r + 3 : y - r - 3;
          g.fillStyle = col; g.strokeStyle = light() ? '#ffffff' : '#0b0b0d'; g.lineWidth = 1;
          g.beginPath();
          if (up) { g.moveTo(x, ty - r); g.lineTo(x + r, ty + r * 0.7); g.lineTo(x - r, ty + r * 0.7); } else { g.moveTo(x, ty + r); g.lineTo(x + r, ty - r * 0.7); g.lineTo(x - r, ty - r * 0.7); }
          g.closePath(); g.fill(); g.stroke();
          if (I.labels !== false) { const ly = up ? ty + r + 7 : ty - r - 7; g.fillStyle = col; g.fillText('R', x, ly); }
          drawn++;
        }
      } finally { g.restore(); }
    },
    destroy() { canvas = null; }
  };
}
function largeLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a); if (!g) return;
      try {
        const o = a.data.owner, I = o.inputs, L = a.data.large, tick = a.data.tick, co = a.coords, phone = co.width < 520;
        if (!L || !tick || !(L.thr > 0)) return;
        const now = Date.now(), top = a.bounds.top, bot = top + a.bounds.height, maxW = phone ? 36 : 64, right = co.width - (phone ? 46 : 62);
        const rows = [];
        L.tr.live.forEach((e) => rows.push({ e, al: 1 }));
        for (const e of L.tr.gone) rows.push({ e, al: Math.max(0, 1 - (now - e.goneAt) / 3000) * 0.6 });
        rows.sort((x, y) => y.e.size - x.e.size);
        const shown = rows.slice(0, clamp(Math.round(num(I.maxShown, 6)), 1, 20));
        g.font = '600 ' + (phone ? 9 : 10) + 'px ' + MONO; g.textBaseline = 'middle'; g.textAlign = 'right';
        const hpx = Math.max(4, Math.abs(Yp(a, tick) - Yp(a, 0)) || 4);
        for (const { e, al } of shown) {
          const y = Yp(a, e.idx * tick);
          if (y < top - 6 || y > bot + 6 || al <= 0) continue;
          const col = e.side > 0 ? (I.bidColor || UP) : (I.askColor || DN), w = Math.max(10, Math.min(1, e.size / (L.thr * 3)) * maxW);
          g.globalAlpha = al;
          g.fillStyle = rgba(col, 0.85); g.fillRect(co.width - w - 1, y - Math.min(hpx, 7) / 2, w, Math.min(hpx, 7));
          const txt = D.fmtK(e.size) + ' · ' + D.fmtDur((e.goneAt || now) - e.since);
          const tw = g.measureText(txt).width + 8;
          g.fillStyle = plate(); g.fillRect(co.width - w - 4 - tw, y - 7, tw, 14);
          g.fillStyle = col; g.fillText(txt, co.width - w - 8, y);
        }
        g.globalAlpha = 1;
      } finally { g.restore(); }
    },
    destroy() { canvas = null; }
  };
}
// Wall Events: markers at the wall's price, at the time the event was decided. Square side grows with the volume traded into the wall.
const wallHits = new WeakMap();
let wallTip = null, wallTipOn = false;
const wallCanvases = new Set();
function wallTipMove(e) {
  let best = null, bd = 1e9;
  for (const c of wallCanvases) {
    const h = wallHits.get(c); if (!h || !c.isConnected) continue;
    const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) continue;
    for (const m of h) { const d = Math.max(Math.abs(m.x - x), Math.abs(m.y - y)); if (d <= m.r + 4 && d < bd) { bd = d; best = m; } }
  }
  if (!best) { if (wallTip) wallTip.hidden = true; return; }
  if (!wallTip) { wallTip = document.createElement('div'); wallTip.className = 'stk-bigtip'; wallTip.setAttribute('role', 'tooltip'); wallTip.style.cssText = 'position:fixed;z-index:60;min-width:170px;max-width:250px;padding:10px 12px;border-radius:12px;font:12px/1.5 system-ui,sans-serif;pointer-events:none;background:rgba(17,17,20,.96);color:#f5f5f5;border:1px solid rgba(255,255,255,.14);box-shadow:0 6px 20px rgba(0,0,0,.4)'; document.body.appendChild(wallTip); }
  const ev = best.e, wall = (ev.side > 0 ? 'Bid' : 'Ask') + ' wall ' + D.fmtK(ev.peak) + ' @ ' + (ev.idx * best.tick).toFixed(2);
  const head = ev.kind === 'E' ? (ev.side > 0 ? 'Sellers ate a bid wall' : 'Buyers ate an ask wall') : ev.kind === 'H' ? (ev.side > 0 ? 'Bid wall held (sellers absorbed)' : 'Ask wall held (buyers absorbed)') : 'Wall pulled (possible spoof)';
  const rows = [head, wall, 'Traded at the wall ' + D.fmtK(ev.traded) + ' (' + Math.round(ev.traded / Math.max(1e-9, ev.peak) * 100) + '%)' + (ev.left != null ? ' · still ' + D.fmtK(ev.left) : ''), 'Wall stood ' + D.fmtDur(ev.t - ev.since) + ' · ' + hhmm(ev.t)];
  wallTip.replaceChildren(...rows.map((t, i) => { const d = document.createElement('div'); d.textContent = t; if (i === 0) d.style.cssText = 'font-weight:700;margin-bottom:2px;color:' + best.col; else if (i === 3) d.style.opacity = '.7'; return d; }));
  wallTip.hidden = false; wallTip.style.left = clamp(e.clientX + 12, 4, innerWidth - 260) + 'px'; wallTip.style.top = clamp(e.clientY + 12, 4, innerHeight - 120) + 'px';
}
function wallLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; wallCanvases.add(c); window.__stkWallCanvas = c; if (!wallTipOn) { wallTipOn = true; document.addEventListener('pointermove', wallTipMove, true); document.addEventListener('pointerdown', wallTipMove, true); } },
    render(a) {
      const g = frame(canvas, a); if (!g) { if (canvas) wallHits.set(canvas, []); return; }
      const shown = [];
      try {
        const o = a.data.owner, I = o.inputs, W = a.data.walls, tick = a.data.tick, co = a.coords, phone = co.width < 520;
        if (!W || !tick) return;
        const top = a.bounds.top, bot = top + a.bounds.height, ref = W.thr > 0 ? W.thr : 1, rMax = phone ? 9 : 12, day = light();
        const t0 = a.bars[0].time, xOf = (t) => { if (co.timeToX && t >= t0) { const x = co.timeToX(t); if (x != null && Number.isFinite(x)) return x; } const i = D.idxOf(a.bars, t); return i < 0 ? null : co.logicalToX(i); };
        const on = { E: I.showEaten !== false, H: I.showHeld !== false, P: I.showPulled !== false };
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 ' + (phone ? 8 : 9) + 'px ' + MONO;
        const ev = W.tr.events;
        for (let k = ev.length - 1; k >= 0 && shown.length < 300; k--) {
          const e = ev[k]; if (!on[e.kind]) continue;
          const x = xOf(e.t); if (x == null || x < -20 || x > co.width + 20) continue;
          const y = Yp(a, e.idx * tick); if (y < top - 14 || y > bot + 14) continue;
          const col = e.kind === 'P' ? (I.pulledColor || GREY) : e.side > 0 ? (I.sellColor || DN) : (I.buyColor || UP);   // bid wall = hit by sellers
          if (e.kind === 'P') {
            const r = phone ? 3.5 : 4; g.strokeStyle = col; g.lineWidth = 1.75;
            g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke();
            shown.push({ x, y, r, e, col, tick }); continue;
          }
          const r = clamp(3 + 3 * Math.log2(1 + e.traded / ref), 3.5, rMax);
          if (e.kind === 'E') {
            g.fillStyle = rgba(col, 0.85); g.fillRect(x - r, y - r, 2 * r, 2 * r);
            g.strokeStyle = day ? '#ffffff' : '#0b0b0d'; g.lineWidth = 1; g.strokeRect(x - r - 0.5, y - r - 0.5, 2 * r + 1, 2 * r + 1);
          } else {
            const rr = Math.max(r, phone ? 6 : 7);
            g.fillStyle = plate(); g.fillRect(x - rr, y - rr, 2 * rr, 2 * rr);
            g.strokeStyle = col; g.lineWidth = 1.75; g.strokeRect(x - rr, y - rr, 2 * rr, 2 * rr);
            g.fillStyle = col; g.fillText('H', x, y + 0.5);
          }
          shown.push({ x, y, r: Math.max(r, 6), e, col, tick });
        }
      } finally { g.restore(); wallHits.set(canvas, shown); if (typeof window !== 'undefined') window.__stkWallShown = shown.map((m) => ({ x: m.x, y: m.y, kind: m.e.kind, price: m.e.idx * m.tick, t: m.e.t })); }
    },
    destroy() { if (canvas) wallCanvases.delete(canvas); canvas = null; }
  };
}
function regimeLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a); if (!g) return;
      try {
        const d = a.data, co = a.coords, n = a.bars.length;
        if (!d.strip || d.nbars !== n || a.bars[0].time !== d.firstT) return;
        const vr = co.visibleLogicalRange(), i0 = Math.max(0, Math.floor(vr.from)), i1 = Math.min(n - 1, Math.ceil(vr.to)), ppb = co.pxPerBar(), h = 4, y = a.bounds.top + a.bounds.height - h - 1;
        for (let i = i0; i <= i1; i++) {
          const k = d.strip[i]; if (k < 0) continue;
          g.fillStyle = rgba(d.cols[k], 0.9);
          g.fillRect(co.logicalToX(i) - ppb / 2, y, Math.max(1, ppb), h);
        }
      } finally { g.restore(); }
    },
    destroy() { canvas = null; }
  };
}

// ---------------------------------------------------------------------------------------- install
export function installBookPack(Core, hooks, reg) {
  if (H) return;
  H = hooks;
  Core.registerRendererLayer({ id: 'stk_bk_refill', placement: 'above-data', create: refillLayer });
  Core.registerRendererLayer({ id: 'stk_bk_large', placement: 'above-data', create: largeLayer });
  Core.registerRendererLayer({ id: 'stk_bk_regime', placement: 'above-data', create: regimeLayer });
  Core.registerRendererLayer({ id: 'stk_bk_walls', placement: 'above-data', create: wallLayer });
  for (const type of BK_TYPES) {
    const [title, short, pane, overlay, needs] = TITLES[type];
    if (!L2_TYPES.includes(type)) L2_TYPES.push(type);
    registerFeed(type, { needs, title });
    reg(Core, { type, title, shortTitle: short, paneHint: pane, overlay, reactsToViewport: type === 'stk_bk_refill' || type === 'stk_bk_large' || type === 'stk_bk_walls', inputsSchema: () => SCHEMA[type], create: () => new BkNative(type) });
  }
}
// test hooks (read-only)
if (typeof window !== 'undefined') window.__stkBookPackStores = stores;
