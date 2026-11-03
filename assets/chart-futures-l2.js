// TradeZoro — Charts: futures Level 2 (NQ, ES) from the Tick-stream book + ticks. Owner order 2026-11-02.
// Depends on: assets/rt-access.js (admin check + ID token), chart-orderflow.js (hands in its helpers as H, so the Crypto
// DOM Heatmap renderer, styles and history merge are REUSED, not copied), the book-recorder Worker's /ts-live hub.
//
// LICENCE GATE: Tick-stream's Redistribution licence is not confirmed, so everything here is ADMIN ONLY. The Worker refuses
// every other token (TS_ACCESS=admin); this file also hides the indicators, the badge and the ladder. To open it to Pro
// members later: set TS_ACCESS=pro on the Worker AND L2_MEMBERS=true below (two lines, one release). No public copy.
//
// Browser -> /ts-live (the Worker's ONE upstream socket fans out; this page never talks to Tick-stream). One browser socket
// per symbol, shared by every indicator and the ladder on that symbol, closed after 30 s in a hidden tab.
//   snap   top N levels a side (20 / 60 / 150) + vendor imbalance + ours, <= 4/s      -> depth bars, DOM ladder, imbalance
//   coarse the whole book bucketed (the recorder's rule) once a second               -> heatmap column
//   ticks  trades since the last frame                                               -> walls pulled / consumed, ladder volume
// History: GET /ts-book-history (BKR1, 48 h kept, 6 h a read) backfills the heatmap, /ts-aux the imbalance + 1-min footprint.
// Wording: "updated Xs ago" only. Education only. Not financial advice.
import { registerFeed, setPanel, setStats } from './chart-feeds.js?v=802';
import { isRealtimeAdmin, rtToken, rtEnsureFresh, rtReady, rtHeaders, rtOnChange } from './rt-access.js?v=802';

export const L2_MEMBERS = false;          // licence flag: true only after the Owner confirms Tick-stream's Redistribution licence
// Books we subscribe to (own book each). Micros we do not subscribe to show their mini's book (l2Note says so).
export const L2_BOOKS = ['NQ', 'ES', 'MNQ', 'MES', 'YM', 'RTY', 'CL', 'GC'];
// Quote-only symbols (indices send size 0 = the level, ETFs the last price): ticks channel only, no book, no footprint, no volume.
// Same gate as the futures hub (l2Visible). A chart on one of these gets its current candle from the live value.
export const L2_QUOTES = ['SPX', 'NDX', 'VIX', 'RUT', 'QQQ', 'SPY', 'IWM', 'DIA'];
export const isQuoteSym = (s) => L2_QUOTES.includes(String(s || '').toUpperCase());
export const L2_ROOTS = { NQ: 'NQ', MNQ: 'MNQ', ES: 'ES', MES: 'MES', YM: 'YM', MYM: 'YM', RTY: 'RTY', M2K: 'RTY', CL: 'CL', MCL: 'CL', GC: 'GC', MGC: 'GC' };
export const L2_TICK = { NQ: 0.25, MNQ: 0.25, ES: 0.25, MES: 0.25, YM: 1, RTY: 0.1, CL: 0.01, GC: 0.1 };   // = TICK_SIZE in the Worker's ts-hub.js
const TICK = 0.25;
const tickOf = (root) => L2_TICK[root] || TICK;
const LEVELS = [20, 60, 150];
const KEEP_MS = 48 * 3600000;
const READ_MS = 6 * 3600000;
const isLocal = () => { try { return /^(127\.0\.0\.1|localhost)$/.test(location.hostname); } catch (e) { return false; } };
const testOn = () => isLocal() && typeof window !== 'undefined' && window.__stkL2Test;
export function l2Visible() { return !!(L2_MEMBERS || isRealtimeAdmin() || testOn()); }
const symOf = (ticker) => String(ticker || '').toUpperCase().replace(/\d?!$/, '').replace(/^[A-Z_]+:/, '');
export const l2Root = (ticker) => L2_ROOTS[symOf(ticker)] || null;
// "showing YM book" for a micro that has no book of its own, else ''
export const l2Note = (ticker) => { const s = symOf(ticker), r = L2_ROOTS[s]; return r && r !== s ? 'Showing the ' + r + ' book' : ''; };
const baseUrl = (H) => (testOn() && window.__stkL2Test.base) || (H && H.recorderUrl && H.recorderUrl()) || '';   // localhost test flag wins
const wsBase = (b) => String(b).replace(/^http/i, 'ws');
let HOOK = null;   // H from chart-orderflow (recorderUrl)

// ---------------------------------------------------------------------------------------- shared state per root
const roots = new Map();
export function rootState(root) {
  let r = roots.get(root);
  if (!r) { r = { root, snap: null, imb: [], conn: null, trades: null, status: 'idle', lastFrame: 0, listeners: new Set(), seeded: false }; roots.set(root, r); }
  return r;
}
const tell = (r) => r.listeners.forEach((f) => { try { f(); } catch (e) {} });

// ---------------------------------------------------------------------------------------- tick feed (footprint minutes)
// Same minute-bar shape as chart-footprint-crypto.js bars(): { t, lo, hi, buy[], sell[] } in tick-index rows, so
// tradedAt / vanishKind / icebergEvents (chart-liquidity-data.js) work on it unchanged.
class TickFeed {
  constructor(root) { this.mins = new Map(); this.tick = tickOf(root); this.coverFrom = Infinity; this.v = 0; this.sorted = null; this.sortedV = -1; this.ring = []; }
  add(list, backfill) {
    for (const x of list) {
      const price = x[0], size = x[1], side = x[2], T = x[3];
      if (!(price > 0) || !(size > 0)) continue;
      const t = Math.floor(T / 60000) * 60000;
      let m = this.mins.get(t);
      if (!m) { m = { b: new Map(), s: new Map(), dirty: true, bar: null }; this.mins.set(t, m); }
      const i = Math.floor(price / this.tick + 1e-9);
      const mp = side > 0 ? m.b : m.s;
      mp.set(i, (mp.get(i) || 0) + size); m.dirty = true;
      if (!backfill) { this.ring.push([T, price, size, side]); if (this.coverFrom === Infinity) this.coverFrom = t + 60000; }
    }
    if (this.ring.length > 30000) this.ring.splice(0, this.ring.length - 30000);
    if (this.mins.size > 400) { const ks = [...this.mins.keys()].sort((a, b) => a - b); for (let k = 0; k < ks.length - 360; k++) this.mins.delete(ks[k]); }
    this.v++;
  }
  // one minute from /ts-aux { t (minute index), lv: [[price, buy, sell]..] }
  seed(fp) {
    for (const r of fp) {
      const T = r.t * 60000;
      if (this.mins.has(T)) continue;
      const m = { b: new Map(), s: new Map(), dirty: true, bar: null };
      for (const [p, b, s] of r.lv || []) { const i = Math.floor(p / this.tick + 1e-9); if (b) m.b.set(i, b); if (s) m.s.set(i, s); }
      this.mins.set(T, m);
      if (T < this.coverFrom) this.coverFrom = T;
    }
    this.v++;
  }
  bars() {
    if (this.sortedV === this.v && this.sorted) return this.sorted;
    const out = [];
    for (const k of [...this.mins.keys()].sort((a, b) => a - b)) {
      const m = this.mins.get(k);
      if (m.dirty || !m.bar) {
        let lo = Infinity, hi = -Infinity;
        m.b.forEach((v, i) => { if (i < lo) lo = i; if (i > hi) hi = i; }); m.s.forEach((v, i) => { if (i < lo) lo = i; if (i > hi) hi = i; });
        if (hi >= lo) {
          const n = hi - lo + 1, buy = new Float64Array(n), sell = new Float64Array(n);
          m.b.forEach((v, i) => { buy[i - lo] = v; }); m.s.forEach((v, i) => { sell[i - lo] = v; });
          m.bar = { t: k, lo, hi, buy, sell };
        } else m.bar = null;
        m.dirty = false;
      }
      if (m.bar) out.push(m.bar);
    }
    this.sorted = out; this.sortedV = this.v;
    return out;
  }
  // volume at a price over the last `ms`: { buy, sell } (the DOM ladder's "last trades" column)
  atPrice(ms) {
    const cut = Date.now() - ms, o = new Map();
    for (let k = this.ring.length - 1; k >= 0; k--) {
      const r = this.ring[k];
      if (r[0] < cut) break;
      const key = Math.round(r[1] / this.tick);
      let e = o.get(key); if (!e) { e = { buy: 0, sell: 0 }; o.set(key, e); }
      if (r[3] > 0) e.buy += r[2]; else e.sell += r[2];
    }
    return o;
  }
}

// ---------------------------------------------------------------------------------------- browser socket (one per root)
class Conn {
  constructor(root) {
    this.root = root; this.refs = 0; this.levels = 60; this.ws = null; this.retryN = 0; this.tm = 0; this.closeTm = 0; this.stopped = false; this.dog = 0;
    this.openedAt = 0; this.want = new Map();
    this.onVis = () => { if (document.hidden) { clearTimeout(this.closeTm); this.closeTm = setTimeout(() => this.park(), 30000); } else { clearTimeout(this.closeTm); if (!this.ws && !this.stopped) this.connect(); } };
    document.addEventListener('visibilitychange', this.onVis);
    this.connect();
  }
  setLevels(id, n) { this.want.set(id, n); const m = Math.max(...this.want.values(), 20); const l = LEVELS.find((x) => x >= m) || 150; if (l !== this.levels) { this.levels = l; this.send({ op: 'sub', symbol: this.root, levels: l }); } }
  send(o) { try { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); } catch (e) {} }
  park() { if (this.ws) { try { this.ws.close(1000); } catch (e) {} this.ws = null; } const r = rootState(this.root); r.status = 'idle'; tell(r); }
  async connect() {
    if (this.stopped || this.ws) return;
    const r = rootState(this.root);
    const base = baseUrl(HOOK);
    if (!base) { r.status = 'error'; tell(r); return; }
    r.status = 'reconnecting'; tell(r);
    let token = '';
    if (!testOn()) {
      await rtReady(); try { await rtEnsureFresh(120); } catch (e) {} token = rtToken() || '';
      if (!token) { r.status = 'error'; r.err = 'sign in'; tell(r); return; }
    }
    if (this.stopped || this.ws) return;
    let ws;
    try { ws = new WebSocket(wsBase(base) + '/ts-live?symbol=' + this.root + '&levels=' + this.levels, token ? ['tz-auth', token] : undefined); } catch (e) { this.later(); return; }
    this.ws = ws;
    ws.onopen = () => { this.openedAt = Date.now(); this.send({ op: 'sub', symbol: this.root, levels: this.levels }); this.arm(); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } this.arm(); this.frame(m); };
    ws.onclose = (e) => {
      if (this.ws !== ws) return; this.ws = null; clearTimeout(this.dog);
      r.status = 'reconnecting'; tell(r);
      if (Date.now() - this.openedAt > 30000) this.retryN = 0;
      if (!this.stopped && !document.hidden) this.later(e && e.code === 4401 ? 200 : 0);
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }
  arm() { clearTimeout(this.dog); this.dog = setTimeout(() => { if (this.ws) { try { this.ws.close(); } catch (e) {} } }, 20000); }
  later(ms) { clearTimeout(this.tm); const w = ms || Math.min(30000, 1500 * Math.pow(2, Math.min(this.retryN++, 5))) * (0.8 + Math.random() * 0.4); this.tm = setTimeout(() => this.connect(), w); }
  frame(m) {
    const r = rootState(this.root);
    if (m.event === 'status') { r.status = m.state === 'live' ? 'live' : 'reconnecting'; tell(r); return; }
    if (m.event === 'hub_full') { r.status = 'error'; r.err = 'busy'; tell(r); return; }
    if (m.event) return;
    r.lastFrame = Date.now();
    if (m.type === 'snap') {
      r.nSnap = (r.nSnap || 0) + 1; r.snap = m; r.status = 'live';
      const last = r.imb[r.imb.length - 1], now = Date.now();
      if (!last || now - last[0] >= 1000) { r.imb.push([now, m.imb, m.imb10]); if (r.imb.length > 21600) r.imb.splice(0, r.imb.length - 21600); }
    } else if (m.type === 'coarse') r.coarse = m;
    else if (m.type === 'ticks') { r.nTick = (r.nTick || 0) + (m.t ? m.t.length : 0); if (!r.trades) r.trades = new TickFeed(r.root); r.trades.add(m.t || [], false); }
    r.listeners.forEach((f) => { try { f(m); } catch (e) {} });
  }
  close() { this.stopped = true; clearTimeout(this.tm); clearTimeout(this.dog); clearTimeout(this.closeTm); document.removeEventListener('visibilitychange', this.onVis); if (this.ws) { try { this.ws.close(1000); } catch (e) {} this.ws = null; } }
}
let idSeq = 0;
// subscribe to one root: fn(frame) per frame, fn() on state changes. -> { r, release(), levels(n) }
export function acquire(root, fn, levels) {
  const r = rootState(root), id = ++idSeq;
  if (!r.trades) r.trades = new TickFeed(r.root);
  r.listeners.add(fn);
  if (!r.conn) r.conn = new Conn(root);
  r.conn.refs++; r.conn.setLevels(id, levels || 60);
  seedHistory(r);
  return {
    r, levels(n) { r.conn && r.conn.setLevels(id, n); },
    release() {
      r.listeners.delete(fn);
      if (!r.conn) return;
      r.conn.want.delete(id);
      if (--r.conn.refs > 0) return;
      const c = r.conn;
      c.closeTm2 = setTimeout(() => { if (c.refs <= 0) { c.close(); if (r.conn === c) r.conn = null; r.status = 'idle'; } }, 10000);
    }
  };
}
async function authFetch(url) {
  const h = testOn() ? {} : (await rtReady(), rtHeaders());
  return fetch(url, { headers: h, credentials: 'omit' });
}
// imbalance + footprint minutes recorded by the hub (last 3 h), once per page
function seedHistory(r) {
  if (r.seeded || isQuoteSym(r.root)) return; r.seeded = true;
  const base = baseUrl(HOOK); if (!base) return;
  const to = Date.now(), from = to - 3 * 3600000;
  authFetch(base + '/ts-aux?symbol=' + r.root + '&from=' + from + '&to=' + to).then((x) => (x.ok ? x.json() : null)).then((j) => {
    if (!j) return;
    const first = r.imb.length ? r.imb[0][0] : Infinity;
    const old = (j.imb || []).map((x) => [x[0] * 1000, x[1], x[2]]).filter((x) => x[0] < first - 500);
    r.imb = old.concat(r.imb);
    const cur = Math.floor(Date.now() / 60000);
    if (r.trades) r.trades.seed((j.fp || []).filter((x) => x.t < cur));
    tell(r);
  }).catch(() => {});
}

// ---------------------------------------------------------------------------------------- candles from the hub's ticks
// The chart's own futures bars can run 10 min behind (CME delay lane). While Live L2 is connected for NQ/ES the hub's
// ticks build the current and recent candles: the hub sends its last 20 min of 1m candles when we subscribe ({type:'bars'}),
// then trade ticks. They are folded into the chart's timeframe and handed to the provider's onBar. Bars the delayed lane
// delivers later are older than ours and are dropped by the chart. Only while Live L2 is up and the real-time lane is not.
// Higher timeframes only emit a bucket the 20 min buffer fully covers (no half-built candle). shortcut: 1-60 min charts,
// the front-month NQ/ES book vs the continuous series can differ by the roll basis, upgrade if a roll week shows a jump.
const MIN_TFS = { '1': 1, '5': 5, '15': 15, '30': 30, '60': 60 };
export function l2Fed(root) { try { return !!(window.__stkL2Live && window.__stkL2Live.has(root)); } catch (e) { return false; } }
export function l2Candles(root, timeframe, onBar, realtimeConfirmed) {
  const tf = MIN_TFS[String(timeframe)];
  if (!tf || !l2Visible() || typeof document === 'undefined') return () => {};
  const mins = new Map();   // minute ms -> [o,h,l,c,v]
  let firstMin = Infinity, fed = false;
  const live = window.__stkL2Live || (window.__stkL2Live = new Set());
  const setFed = (v) => { if (v === fed) return; fed = v; if (v) live.add(root); else live.delete(root); try { window.dispatchEvent(new Event('stryker:l2live')); } catch (e) {} };
  const emit = (touched) => {
    const bk = new Set();
    touched.forEach((t) => bk.add(Math.floor(t / (tf * 60000)) * tf * 60000));
    [...bk].sort((x, y) => x - y).forEach((b) => {
      if (b < firstMin && tf > 1) return;   // not fully covered
      let o, h = -Infinity, l = Infinity, c, v = 0, n = 0;
      for (let t = b; t < b + tf * 60000; t += 60000) {
        const m = mins.get(t); if (!m) continue;
        if (n++ === 0) o = m[0];
        h = Math.max(h, m[1]); l = Math.min(l, m[2]); c = m[3]; v += m[4];
      }
      if (n) onBar({ time: b, open: o, high: h, low: l, close: c, volume: v });
    });
  };
  const fn = (m) => {
    const r = rootState(root);
    const on = r.status === 'live' && l2Visible() && !(realtimeConfirmed && realtimeConfirmed());
    if (!m) { if (!on) setFed(false); return; }
    if (!on) return;
    const touched = [];
    if (m.type === 'bars') {
      for (const b of m.b || []) { mins.set(b[0], [b[1], b[2], b[3], b[4], b[5]]); touched.push(b[0]); if (b[0] < firstMin) firstMin = b[0]; }
    } else if (m.type === 'quote' && m.symbol === root && m.p > 0) {
      // the level only: open/high/low/close move, volume stays 0
      const t = Math.floor((m.ts || Date.now()) / 60000) * 60000, e = mins.get(t);
      if (!e) { if (firstMin === Infinity) return; mins.set(t, [m.p, m.p, m.p, m.p, 0]); }
      else { if (m.p > e[1]) e[1] = m.p; if (m.p < e[2]) e[2] = m.p; e[3] = m.p; }
      touched.push(t);
    } else if (m.type === 'ticks') {
      for (const x of m.t || []) {
        const t = Math.floor(x[3] / 60000) * 60000, e = mins.get(t);
        if (!e) { if (firstMin === Infinity) continue; mins.set(t, [x[0], x[0], x[0], x[0], x[1]]); }
        else { if (x[0] > e[1]) e[1] = x[0]; if (x[0] < e[2]) e[2] = x[0]; e[3] = x[0]; e[4] += x[1]; }
        touched.push(t);
      }
    }
    if (touched.length) { setFed(true); emit(touched); }
  };
  const h = acquire(root, fn, 20);
  return () => { h.release(); setFed(false); };
}

// ---------------------------------------------------------------------------------------- feed options for BookFeed
// What chart-orderflow's BookFeed needs from a custom source (see its constructor).
export function l2Source(root) {
  const tk = tickOf(root);
  const rule = (mid) => { const st = nearNice(Math.max(mid * 0.0001, tk)); return { step: Math.round(Math.max(1, Math.floor(st / tk + 1e-6)) * tk * 1e6) / 1e6, range: 0.02 }; };   // identical to the Worker's coarseRule (ts-hub.js)
  return {
    base: 'contracts', keepMs: KEEP_MS, rule,
    trades: () => rootState(root).trades || (rootState(root).trades = new TickFeed(root)),
    remote: async (from, to) => {
      const base = baseUrl(HOOK);
      let x = await authFetch(base + '/ts-book-history?symbol=' + root + '&from=' + from + '&to=' + to);
      // the Worker rate limit is 60 reads / min / IP: back off 6 s once instead of failing the whole backfill for 5 min
      if (x.status === 429) { await new Promise((r) => setTimeout(r, 6000)); x = await authFetch(base + '/ts-book-history?symbol=' + root + '&from=' + from + '&to=' + to); }
      if (!x.ok) throw new Error('HTTP ' + x.status);
      return { buf: await x.arrayBuffer(), held: 0, left: Number(x.headers.get('x-ts-fill-left')) || 0 };
    },
    open(onBook, onStatus, onCoarse) {
      const book = { bids: new Map(), asks: new Map(), bestBid: null, bestAsk: null, ts: 0 };
      let lastCoarseAt = 0;
      const fn = (m) => {
        const r = rootState(root);
        if (!m) { onStatus(r.status === 'live' ? 'live' : r.status === 'error' ? 'error' : 'reconnecting', r.err); return; }
        if (m.type === 'snap') {
          book.bestBid = m.bids[0] ? m.bids[0][0] : null; book.bestAsk = m.asks[0] ? m.asks[0][0] : null; book.ts = Date.now();
          if (!lastCoarseAt) { fill(book, m); }   // until the first whole-book column arrives, draw what the snapshot has
          onBook(book);
          onStatus('live');
        } else if (m.type === 'coarse') {
          lastCoarseAt = Date.now();
          // the whole book at the row step: rebuild the maps from the rows (row centre) so depth bars span the same +-0.4% as the heatmap
          book.bids.clear(); book.asks.clear();
          for (let k = 0; k < m.v.length; k++) { const v = m.v[k]; if (!v) continue; const p = (m.i0 + k + 0.5) * m.step; if (v > 0) book.bids.set(p, v); else book.asks.set(p, -v); }
          onCoarse(m); onBook(book);
        }
      };
      const h = acquire(root, fn, 60);
      return Object.assign(() => h.release(), { tick() {}, age() {} });
    }
  };
}
function fill(book, m) { book.bids.clear(); book.asks.clear(); for (const [p, q] of m.bids) book.bids.set(p, q); for (const [p, q] of m.asks) book.asks.set(p, q); }
function nearNice(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  let best = p;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p <= raw * 1.0001) best = m * p;
  return best;
}

// ---------------------------------------------------------------------------------------- feed badges (L1 · L2 · L3, assets/chart-feeds.js)
// The old "Live L2" pill is now the L2 chip. badgeUse stays as a no-op so the attach() code paths (shared with the DOM-ladder fix) need no edit.
export function badgeUse() {}
const rateMem = new Map();
// -> { status, ageMs, bookRate, tradeRate } for the chart's root (rates = changes per second since the last call, smoothed)
function feedStats(sym, now) {
  const m = /^futures:(.+)$/i.exec(sym || ''), root = m && l2Root(m[1]), r = root && roots.get(root);
  if (!r || !r.conn) return null;
  const k = rateMem.get(root) || { t: now, b: r.nSnap || 0, x: r.nTick || 0, bookRate: null, tradeRate: null };
  const dt = (now - k.t) / 1000;
  if (dt >= 0.9) { const f = (a, b) => (a == null ? b : a * 0.5 + b * 0.5); k.bookRate = f(k.bookRate, ((r.nSnap || 0) - k.b) / dt); k.tradeRate = f(k.tradeRate, ((r.nTick || 0) - k.x) / dt); k.t = now; k.b = r.nSnap || 0; k.x = r.nTick || 0; }
  rateMem.set(root, k);
  return { status: r.status === 'live' ? 'live' : 'wait', ageMs: r.lastFrame ? now - r.lastFrame : 0, bookRate: k.bookRate, tradeRate: k.tradeRate };
}
export function registerL2Feeds() {
  registerFeed('stk_fut_dom', { needs: 'L2', title: 'Order book heatmap (L2)', mkt: 'futures' });
  registerFeed('stk_fut_walls', { needs: 'L2', title: 'Liquidity Walls (L2)', mkt: 'futures' });
  registerFeed('stk_fut_imb', { needs: 'L2', title: 'Book Imbalance (L2)', mkt: 'futures' });
  registerFeed('stk_crypto_dom', { needs: 'L2', title: 'Order book heatmap (L2)', mkt: 'crypto' });
  registerFeed('stk_liqmap', { needs: 'L2', title: 'Liquidity Map (L2)' });
  setStats('futures', feedStats);
  if (typeof window !== 'undefined') window.STRYKER_L2_OK = l2Visible;
}

// ---------------------------------------------------------------------------------------- indicators
export const L2_TYPES = ['stk_fut_dom', 'stk_fut_imb'];
const NEED = 'Futures DOM works on NQ, MNQ, ES, MES, YM, RTY, CL and GC charts (MYM, M2K, MCL, MGC show their mini\'s book).';
const NOT_YET = 'Needs L2 (full order book). Your plan includes L1.';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const BOOK_WALLS = 'Walls (persist 30 s+, pulled / consumed tags)';

// inputs saved before the style choice existed have no `look`: they get the default (Bookmap)
const fcfg = (i, walls) => Object.assign({ look: walls ? 'Classic' : 'Bookmap' }, i || {});
export function installFuturesL2(Core, H, reg) {
  HOOK = H;
  registerL2Feeds();
  // 1) Futures DOM Heatmap (L2): the Crypto DOM renderer on the futures book. Default view = Deep; walls = top 3 each side.
  const schema = H.DOM_SCHEMA.map((x) => {
    if (x.key === 'bucketUsd') return Object.assign({}, x, { title: 'Price bucket (points, 0 = auto)' });
    if (x.key === 'bookRangePct') return null;   // fixed +-0.4% by the Worker's recording rule
    if (x.key === 'historyMinutes') return Object.assign({}, x, { defval: 360, max: 2880, title: 'History window (minutes, recorder keeps 48 h)', tooltip: 'Recorded server-side every 5 s; older than a page load comes from the recorder.' });
    if (x.key === 'wallMinSec') return Object.assign({}, x, { defval: 30, title: 'Wall min lifetime (seconds)' });
    if (x.key === 'wallTopPct') return Object.assign({}, x, { defval: 3 });
    return x;
  }).filter(Boolean);
  // style table (assets/chart-bookmap.js STYLES): 'Bookmap' (default) = dark field, heatmap only; 'Classic' = the earlier look with walls and tags
  schema.unshift({ key: 'look', title: 'Style', type: 'string', defval: 'Bookmap', options: ['Bookmap', 'Classic'] });
  schema.splice(1, 0, { key: 'contrast', title: 'Contrast (Bookmap)', type: 'float', defval: 1, min: 0.5, max: 2.5, step: 0.1 }, { key: 'showDepthBars', title: 'Show depth bars (Bookmap)', type: 'bool', defval: true }, { key: 'showSizes', title: 'Show sizes (numbers on the depth bars)', type: 'bool', defval: true });
  schema.push({ key: 'l2Levels', title: 'Depth levels per side (ladder + bars)', type: 'string', defval: '60', options: ['20', '60', '150'] });
  schema.push({ key: 'l2Walls', title: 'Pulled / consumed tags in every view', type: 'bool', defval: true });
  const Dom = class FutDomNative extends H.CryptoDomNative {
    attach() {
      if (!this.ctx) return;
      const mk = H.marketOf(this.ctx), root = mk.futures ? l2Root(mk.ticker) : null;
      if (!l2Visible()) { this.detach(); this.block = NOT_YET; this.render(); return; }
      const want = root ? 'tsl2|' + root : '';
      if (this.h && this.h.feed.key === want) { this.render(); return; }
      this.detach();
      this.block = root ? '' : NEED;
      if (root) { this.h = H.acquireBookFeed('tsl2', root, () => this.later(), l2Source(root)); this.root = root; this.lv = this.h.feed.key; badgeUse(true); this.badged = true; }
      this.render();
    }
    wantNow() {}
    detach() { if (this.badged) { badgeUse(false); this.badged = false; } super.detach(); }
    note() {
      if (this.block) return this.block;
      const f = this.h && this.h.feed;
      const st = rootState(this.root);
      if (!f || f.status === 'loading') return 'Connecting to the futures order book…';
      if (f.status === 'error') return st.err === 'busy' ? 'Order book is busy. Retrying…' : 'Order book unavailable.';
      if (st.status !== 'live') return 'Reconnecting to the order book…';
      const cfg = H.domConfig(fcfg(this.inputs, this.walls));
      if ((cfg.heat || cfg.walls || cfg.bm) && f.history.length < 15 && f.remote.length < 2) return 'Building order book history…';
      try { return l2Note(H.marketOf(this.ctx).ticker); } catch (e) { return ''; }
    }
    setInputs(i) { this.inputs = i; if (this.h) this.h.feed.l2Levels = Number(i.l2Levels) || 60; const st = this.root && rootState(this.root); if (st && st.conn) st.conn.setLevels('dom' + this.root, Number(i.l2Levels) || 60); this.render(); }
    render() {
      if (!this.ctx || this.hidden) return;
      const msg = this.note() === NOT_YET ? '' : this.note();
      const f = this.h && this.h.feed;
      this.ctx.setStatus(!f || this.block ? 'idle' : f.status === 'live' ? 'live' : f.status === 'error' ? 'idle' : 'loading');
      this.ctx.emit({ tables: msg ? [H.message('stk_dom-msg', msg, H.pageIsDay(), 'top_right')] : [] });
      // Walls-only view with "pulled / consumed" on shows the tags too (domConfig reads l2Walls)
      this.ctx.pushData(f && !this.block ? { feed: f.key, v: f.version, cfg: H.domConfig(fcfg(this.inputs, this.walls)) } : { off: true });
    }
  };
  Core.registerRendererLayer({ id: 'stk_fut_dom', placement: 'below-data', create: H.cryptoDomLayer });
  // 3) Liquidity Walls: the same engine, "Walls only" by default: big resting levels that persisted >= 30 s, faded when pulled; the end of
  // a wall is tagged PULLED (gone before trades reached it) or CONSUMED (traded through, from the tick feed).
  const wallSchema = schema.filter((x) => x.key !== 'contrast' && x.key !== 'showDepthBars' && x.key !== 'showSizes').map((x) => (x.key === 'style' ? Object.assign({}, x, { defval: x.options[4] }) : x.key === 'look' ? Object.assign({}, x, { defval: 'Classic' }) : x));
  Core.registerRendererLayer({ id: 'stk_fut_walls', placement: 'below-data', create: H.cryptoDomLayer });
  reg(Core, { type: 'stk_fut_walls', title: 'Liquidity Walls (L2)', shortTitle: 'Liquidity Walls', paneHint: 'price', overlay: true,
    inputsSchema: () => wallSchema, create: () => { const d = new Dom(); d.walls = true; return d; } });
  reg(Core, { type: 'stk_fut_dom', title: 'Futures DOM Heatmap (L2)', shortTitle: 'Futures DOM (L2)', paneHint: 'price', overlay: true,
    inputsSchema: () => schema, create: () => new Dom() });
  // 2) Book Imbalance pane: vendor top-of-book imbalance + ours (10 levels, depth-weighted), both -1..+1
  const IMB = [
    { key: 'vendorColor', title: 'Top-of-book imbalance colour', type: 'color', defval: '#03c988' },
    { key: 'oursColor', title: '10-level depth-weighted colour', type: 'color', defval: '#00adb5' },
    { key: 'showOurs', title: 'Show the 10-level depth-weighted line', type: 'bool', defval: true },
    { key: 'smooth', title: 'Smoothing (seconds, 0 = none)', type: 'int', defval: 0, min: 0, max: 60, step: 1 }
  ];
  const Imb = class FutImbNative {
    constructor() { this.inputs = {}; this.tm = 0; this.h = null; this.root = ''; this.block = ''; }
    start(ctx, inputs) { this.ctx = ctx; this.inputs = inputs; this.attach(); }
    attach() {
      const mk = H.marketOf(this.ctx), root = mk.futures ? l2Root(mk.ticker) : null;
      if (!l2Visible()) { this.block = NOT_YET; this.compute(); return; }
      if (!root) { this.block = NEED; this.compute(); return; }
      if (this.root === root && this.h) return;
      this.detach(); this.block = ''; this.root = root;
      this.h = acquire(root, () => this.later(), 20); badgeUse(true);
      this.compute();
    }
    detach() { if (this.h) { this.h.release(); this.h = null; badgeUse(false); } clearTimeout(this.tm); this.tm = 0; }
    later() { if (!this.tm && !this.hidden) this.tm = setTimeout(() => { this.tm = 0; this.compute(); }, 500); }
    onBars() { this.later(); }
    onViewport() {}
    setInputs(i) { this.inputs = i; this.compute(); }
    suspend() { this.hidden = true; clearTimeout(this.tm); this.tm = 0; }
    resume() { this.hidden = false; this.attach(); this.compute(); }
    stop() { this.detach(); }
    compute() {
      if (!this.ctx) return;
      const bars = this.ctx.bars(), inp = this.inputs || {};
      const vendor = new Array(bars.length).fill(null), ours = new Array(bars.length).fill(null);
      const r = this.root ? rootState(this.root) : null, h = r ? r.imb : [];
      if (h.length && bars.length) {
        const sm = clamp(Math.round(num(inp.smooth, 0)), 0, 60) * 1000;
        const avg = (k, a, b) => { let s = 0, n = 0; for (let j = a; j < b; j++) { s += h[j][k]; n++; } return n ? s / n : null; };
        let j = 0;
        for (let i = 0; i < bars.length; i++) {
          const t1 = i + 1 < bars.length ? bars[i + 1].time : Infinity;   // the last bar takes the newest reading
          let a = j; while (j < h.length && h[j][0] < t1) j++;
          // last reading inside the bar (or smoothed over the trailing window); none before the first reading
          if (j > 0 && h[j - 1][0] >= bars[i].time - 60000 * 3) {
            const b = j; const from = sm ? (() => { let q = b - 1; while (q > 0 && h[b - 1][0] - h[q - 1][0] < sm) q--; return q; })() : b - 1;
            vendor[i] = round3(avg(1, from, b)); ours[i] = round3(avg(2, from, b));
          }
        }
      }
      const mk = (id, title, vals, color) => H.line(id, title, bars, vals, color, 2);
      const series = [mk('stk_fut_imb-v', 'Top-of-book imbalance', vendor, inp.vendorColor || '#03c988')];
      if (inp.showOurs !== false) series.push(mk('stk_fut_imb-o', '10-level depth-weighted', ours, inp.oursColor || '#00adb5'));
      const note = this.block && this.block !== NOT_YET ? [H.message('stk_fut_imb-msg', this.block, H.pageIsDay(), 'top_right')] : [];
      this.ctx.setStatus(this.block ? 'idle' : r && r.status === 'live' ? 'live' : 'loading');
      this.ctx.emit({ series: this.block ? [] : series, tables: note, priceLines: [{ id: 'stk_fut_imb-0', paneId: '', price: 0, color: '#787b86', lineStyle: 'dotted', width: 1 }] });
    }
  };
  reg(Core, { type: 'stk_fut_imb', title: 'Book Imbalance (L2)', shortTitle: 'Book Imbalance', paneHint: 'new', overlay: false,
    inputsSchema: () => IMB, create: () => new Imb() });
}
const round3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

// ---------------------------------------------------------------------------------------- DOM ladder panel
// Right-bar panel (phones: a bottom sheet). Rows: price, bid size, ask size, traded volume at the price (last 5 min: buy / sell),
// auto-centred on the touch. Display only: it never places an order.
const SVG_LADDER = '<path d="M4 5h16M4 10h10M4 15h13M4 20h7"/>';
const SVG_X = '<path d="M6 6l12 12M18 6L6 18"/>';
const svg = (d, s) => '<svg width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const fmtP = (p) => p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQ = (q) => (q >= 10000 ? (q / 1000).toFixed(1) + 'k' : String(Math.round(q)));
// Pure: the ladder rows for one snapshot. rows = N price rows centred on the touch, asks above, bids below.
export function ladderRows(snap, atPrice, count, tick) {
  const TICK = tick || 0.25;
  if (!snap || !snap.bids || !snap.bids.length || !snap.asks || !snap.asks.length) return null;
  const bid = new Map(), ask = new Map();
  for (const [p, q] of snap.bids) bid.set(Math.round(p / TICK), q);
  for (const [p, q] of snap.asks) ask.set(Math.round(p / TICK), q);
  const bb = Math.round(snap.bids[0][0] / TICK), ba = Math.round(snap.asks[0][0] / TICK);
  const half = Math.floor(count / 2), mid = Math.round((bb + ba) / 2);
  const out = []; let maxQ = 1;
  for (let k = mid + half; k >= mid - half; k--) {
    const b = k <= bb ? bid.get(k) || 0 : 0, a = k >= ba ? ask.get(k) || 0 : 0, t = atPrice && atPrice.get(k);
    if (b > maxQ) maxQ = b; if (a > maxQ) maxQ = a;
    out.push({ k, price: k * TICK, bid: b, ask: a, buy: t ? t.buy : 0, sell: t ? t.sell : 0, isBid: k === bb, isAsk: k === ba });
  }
  return { rows: out, maxQ, spread: (ba - bb) * TICK, bb: bb * TICK, ba: ba * TICK };
}
export function mountL2Ladder(ws, opts) {
  opts = opts || {};
  if (!ws || document.getElementById('stkl2')) return null;
  const host = document.querySelector('.stkchart-panel.stkw-host') || document.querySelector('.stkchart-panel');
  if (!host) return null;
  const isPhone = () => window.innerWidth <= 700;
  let open = false, h = null, root = '', raf = 0, rows = 0;
  const railBtn = el('button', 'stkw-railbtn stkl2-railbtn', svg(SVG_LADDER)); railBtn.type = 'button'; railBtn.title = 'DOM ladder (L2)'; railBtn.setAttribute('aria-label', 'DOM ladder'); railBtn.setAttribute('aria-pressed', 'false'); railBtn.hidden = true;
  const phoneBtn = el('button', 'stkc-btn stkl2-phonebtn', svg(SVG_LADDER, 16) + '<span class="stkc-btn-l">DOM</span>'); phoneBtn.type = 'button'; phoneBtn.setAttribute('aria-label', 'DOM ladder'); phoneBtn.hidden = true;
  const panel = el('aside', 'stkl2', ''); panel.id = 'stkl2'; panel.hidden = true; panel.setAttribute('aria-label', 'DOM ladder');
  const grab = el('div', 'stkl2-grab'); grab.setAttribute('aria-hidden', 'true');
  const head = el('div', 'stkl2-hd', '<span class="stkl2-title">DOM <b class="stkl2-sym"></b></span><span class="stkl2-sp"></span>');
  const seg = el('div', 'stkl2-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Levels');
  for (const n of LEVELS) { const b = el('button', 'stkl2-lv', String(n)); b.type = 'button'; b.dataset.n = n; seg.appendChild(b); }
  const closeBtn = el('button', 'stkl2-close', svg(SVG_X)); closeBtn.type = 'button'; closeBtn.setAttribute('aria-label', 'Close DOM ladder');
  head.insertBefore(seg, head.querySelector('.stkl2-sp').nextSibling); head.appendChild(closeBtn);
  const cols = el('div', 'stkl2-cols', '<span>Bid</span><span>Price</span><span>Ask</span><span>Traded 5m</span>');
  const list = el('div', 'stkl2-list'); list.setAttribute('role', 'table');
  const foot = el('p', 'stkl2-foot', 'Resting size per price from the futures order book. Education only. Not financial advice.');
  const stat = el('div', 'stkl2-stat', '');
  panel.append(grab, head, stat, cols, list, foot); host.appendChild(panel);
  const barR = document.querySelector('#stkc-bar .stkc-bar-r'); if (barR) barR.insertBefore(phoneBtn, barR.firstChild);
  let levels = 60;
  // Same resolution as the indicator (marketOf): data.resolve() of the active cell, then any prefix / 1! / contract month.
  const activeRoot = () => {
    try {
      const sym = String(ws.active.symbol || ''); let prov = '', t = sym;
      try { const r = ws.cell(ws.active.id).data.resolve(sym); if (r) { prov = r.provider; t = r.ticker; } } catch (e) {}
      if (prov && !/^(futures|rith|rithmic)/i.test(prov)) return null;
      return l2Root(t) || l2Root(String(t).toUpperCase().replace(/^[A-Z_]+:/, '').replace(/[FGHJKMNQUVXZ]\d{1,4}$/, ''));
    } catch (e) { return null; }
  };
  function paint() {
    raf = 0;
    if (!open) return;
    const r = root ? rootState(root) : null;
    panel.querySelector('.stkl2-sym').textContent = root || '';
    if (!root) { list.innerHTML = '<div class="stkl2-empty">Open an NQ, ES, YM, RTY, CL or GC chart (or a micro) to see its order book.</div>'; stat.textContent = ''; return; }
    const age = r && r.lastFrame ? Date.now() - r.lastFrame : -1;
    stat.className = 'stkl2-stat' + (r && r.status === 'live' ? ' is-live' : ' is-wait');
    stat.innerHTML = '<i class="stkl2-dot" aria-hidden="true"></i><span>' + (r && r.status === 'live' ? 'Live L2' : 'Reconnecting…') + '</span><em>' + (r && r.status === 'live' && age > 5000 ? 'updated ' + ago(age) + ' ago' : '') + '</em><u>' + (r && r.snap ? (() => { const n = Math.round((r.snap.asks[0][0] - r.snap.bids[0][0]) / TICK); return 'Spread ' + n + (n === 1 ? ' tick' : ' ticks'); })() : '') + '</u>';
    const m = ladderRows(r && r.snap, r && r.trades && r.trades.atPrice(300000), rows, tickOf(root));
    if (!m) { list.innerHTML = '<div class="stkl2-empty">Waiting for the order book…</div>'; return; }
    if (list.children.length !== m.rows.length || list.firstChild.classList.contains('stkl2-empty')) {
      list.innerHTML = m.rows.map(() => '<div class="stkl2-row" role="row"><span class="stkl2-b"><i></i><b></b></span><span class="stkl2-p"></span><span class="stkl2-a"><i></i><b></b></span><span class="stkl2-t"><u></u><s></s></span></div>').join('');
    }
    for (let i = 0; i < m.rows.length; i++) {
      const x = m.rows[i], n = list.children[i];
      n.className = 'stkl2-row' + (x.isBid ? ' is-bid' : '') + (x.isAsk ? ' is-ask' : '') + (x.k % 4 === 0 ? ' is-pt' : '');
      const bi = n.children[0], pi = n.children[1], ai = n.children[2], ti = n.children[3];
      bi.firstChild.style.width = (x.bid ? Math.max(2, (x.bid / m.maxQ) * 100) : 0) + '%'; bi.lastChild.textContent = x.bid ? fmtQ(x.bid) : '';
      ai.firstChild.style.width = (x.ask ? Math.max(2, (x.ask / m.maxQ) * 100) : 0) + '%'; ai.lastChild.textContent = x.ask ? fmtQ(x.ask) : '';
      pi.textContent = fmtP(x.price);
      ti.firstChild.textContent = x.buy ? fmtQ(x.buy) : ''; ti.lastChild.textContent = x.sell ? fmtQ(x.sell) : '';
    }
    // auto-centred: the touch is the middle row of the list at every refresh
  }
  const later = () => { if (open && !raf) raf = requestAnimationFrame(paint); };
  function size() { const hgt = list.clientHeight || 400, rh = isPhone() ? 28 : 22; rows = clamp((Math.floor(hgt / rh) | 1), 11, 61); }
  function attach() {
    const want = activeRoot();
    if (want === root && (h || !want)) return;
    if (h) { h.release(); h = null; badgeUse(false); }
    root = want || '';
    if (root) { h = acquire(root, later, levels); badgeUse(true); }
    later();
  }
  function setLevels(n) { levels = n; seg.querySelectorAll('.stkl2-lv').forEach((b) => { b.classList.toggle('on', Number(b.dataset.n) === n); b.setAttribute('aria-pressed', String(Number(b.dataset.n) === n)); }); if (h) h.levels(n); }
  function setOpen(v) {
    open = !!v; setPanel('dom_ladder', open && l2Visible(), { needs: 'L2', title: 'DOM ladder', mkt: 'futures' }); panel.hidden = !open; host.classList.toggle('stkl2-open', open);
    document.documentElement.classList.toggle('stkl2-sheet', open && isPhone());
    railBtn.setAttribute('aria-pressed', String(open)); railBtn.classList.toggle('on', open); phoneBtn.classList.toggle('on', open);
    if (open) { try { const g = window.__stkGexLadder; if (g && g.isOpen) g.close(); } catch (e) {} attach(); requestAnimationFrame(() => { size(); paint(); }); }
    else if (h) { h.release(); h = null; root = ''; badgeUse(false); }
    requestAnimationFrame(() => { try { window.dispatchEvent(new Event('resize')); } catch (e) {} });
  }
  function placeRail() {
    const rail = document.querySelector('.stkw-rail'); if (!rail) return false;
    if (railBtn.parentNode !== rail) { const after = rail.querySelector('.stkgl-railbtn') || rail.querySelector('.stkw-railbtn'); rail.insertBefore(railBtn, after ? after.nextSibling : rail.firstChild); }
    return true;
  }
  if (!placeRail()) { const mo = new MutationObserver(() => { if (placeRail()) mo.disconnect(); }); mo.observe(host, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 30000); }
  const show = () => { const ok = l2Visible(); railBtn.hidden = phoneBtn.hidden = !ok; if (!ok && open) setOpen(false); };
  rtReady().then(show); try { rtOnChange(show); } catch (e) {} show();
  railBtn.addEventListener('click', () => setOpen(!open));
  phoneBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  closeBtn.addEventListener('click', () => setOpen(false));
  seg.addEventListener('click', (e) => { const b = e.target.closest('.stkl2-lv'); if (b) setLevels(Number(b.dataset.n)); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && isPhone()) setOpen(false); });
  window.addEventListener('resize', () => { document.documentElement.classList.toggle('stkl2-sheet', open && isPhone()); if (open) { size(); later(); } }, { passive: true });
  try { ws.on('state:changed', () => { if (open) { attach(); later(); } }); } catch (e) {}
  const tick = setInterval(() => { if (open) later(); }, 1000);
  window.addEventListener('pagehide', () => clearInterval(tick));
  setLevels(60);
  const api = { open: () => setOpen(true), close: () => setOpen(false), get isOpen() { return open; }, setLevels, _paint: paint };
  window.__stkL2Ladder = api;
  return api;
}
