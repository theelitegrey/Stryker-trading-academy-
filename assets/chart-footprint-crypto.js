// TradeZoro — Charts: crypto order flow (Binance aggTrades -> 1-minute footprint bars).
// Depends on: nothing (pure fetch + WebSocket). Used by assets/chart-footprint.js, which feeds the
// bars below into the SAME footprint chart type / Delta / CVD code the futures recorder uses.
//
// Data (public, no key): REST /aggTrades backfill (newest page first, then older pages in parallel
// batches by fromId; aggregate ids are consecutive so the pages are known in advance) + the live
// aggTrade WebSocket. `m` (buyer is the maker) = the SELLER hit the bid. Spot falls back to
// data-api.binance.vision / data-stream.binance.vision. Perp tickers end in .P (fapi / fstream).
// Output bars have the shape decodeOrderflow() makes (tick-index rows, buy/sell arrays), with
// Float64 volumes (base-asset units, e.g. BTC).
// Education only. Not financial advice.

const HIST_MS = 3 * 3600 * 1000;      // backfill target: the last 3 hours
const KEEP_MS = 8 * 3600 * 1000;      // minutes kept in memory
const MAX_PAGES = 100;                // x 1000 trades: hard cap on the backfill (about 14 MB at most)
const CONC = 10;                      // parallel page requests
const IDLE_MS = 60000;                // no chart asked for this feed for a minute: close it
const PREFIX = 'binance:';

export const isCrypto = (root) => typeof root === 'string' && root.startsWith(PREFIX);

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

const feeds = new Map();
let sweepTm = 0;
function sweep() {
  const now = Date.now();
  feeds.forEach((f, k) => { if (now - f.touched > IDLE_MS) { f.stop(); feeds.delete(k); } });
  if (!feeds.size) { clearInterval(sweepTm); sweepTm = 0; }
}
// The feed for one symbol (root 'binance:BTCUSDT' or 'binance:BTCUSDT.P'); starts it on first use.
export function cryptoFeed(root, onChange) {
  let f = feeds.get(root);
  if (!f) { f = new CryptoFeed(root, onChange); feeds.set(root, f); f.start(); }
  f.onChange = onChange || f.onChange;
  f.touched = Date.now();
  if (!sweepTm) sweepTm = setInterval(sweep, 15000);
  return f;
}
export const cryptoFeeds = () => feeds;

class CryptoFeed {
  constructor(root, onChange) {
    this.root = root; this.onChange = onChange || (() => {});
    const t = root.slice(PREFIX.length);
    this.perp = /\.P$/i.test(t);
    this.sym = t.replace(/\.P$/i, '').toUpperCase();
    this.rest = this.perp ? ['https://fapi.binance.com/fapi/v1'] : ['https://api.binance.com/api/v3', 'https://data-api.binance.vision/api/v3'];
    this.ws = this.perp ? ['wss://fstream.binance.com/ws/'] : ['wss://stream.binance.com:9443/ws/', 'wss://data-stream.binance.vision/ws/'];
    this.conc = this.perp ? 3 : CONC; this.maxPages = this.perp ? 36 : MAX_PAGES;   // futures aggTrades weigh 20 on Binance (limit 2400/min): go lighter
    this.mins = new Map();          // minute ms -> { trades: [[id, price, size, side]], dirty, bar }
    this.ids = new Set();           // ids seen (dedupe across backfill / live / catch-up)
    this.status = 'loading'; this.err = '';
    this.tick = 0; this.coverFrom = Infinity; this.v = 0;
    this.lastId = -1; this.stopped = false; this.ws_ = null; this.retry = 0; this.tm = 0; this.bumpTm = 0;
    this.buf = []; this.backfilled = false; this.sorted = null; this.sortedV = -1;
  }
  stop() { this.stopped = true; clearTimeout(this.tm); clearTimeout(this.bumpTm); try { if (this.ws_) this.ws_.close(); } catch (e) {} }
  bump() { this.v++; if (!this.bumpTm) this.bumpTm = setTimeout(() => { this.bumpTm = 0; try { this.onChange(); } catch (e) {} }, 200); }
  async get(qs) {
    let err;
    for (const b of this.rest) {
      try { const r = await fetch(b + '/aggTrades?symbol=' + this.sym + qs); if (r.ok) return await r.json(); err = new Error('HTTP ' + r.status); }
      catch (e) { err = e; }
    }
    throw err;
  }
  add(list) {
    for (const t of list) {
      const id = t.a, price = +t.p, size = +t.q;
      if (this.ids.has(id) || !(price > 0) || !(size > 0)) continue;
      this.ids.add(id);
      if (id > this.lastId) this.lastId = id;
      if (!this.tick) this.tick = niceStep(price * 1.2e-5);   // BTC ~ 81k -> $1 rows; zoom merges them to $5-$10
      const mt = Math.floor(t.T / 60000) * 60000;
      let m = this.mins.get(mt);
      if (!m) { m = { trades: [], dirty: true, bar: null }; this.mins.set(mt, m); }
      m.trades.push([id, price, size, t.m ? 0 : 1]); m.dirty = true;
    }
  }
  trim() {
    const lim = Date.now() - KEEP_MS;
    for (const k of this.mins.keys()) if (k < lim) this.mins.delete(k);
    if (this.ids.size > 400000) this.ids = new Set([...this.ids].slice(-200000));
  }
  start() {
    const open = (i) => {
      if (this.stopped) return;
      let w;
      try { w = new WebSocket(this.ws[i % this.ws.length] + this.sym.toLowerCase() + '@aggTrade'); } catch (e) { this.retryWs(); return; }
      this.ws_ = w;
      w.onmessage = (e) => {
        try {
          const t = JSON.parse(e.data);
          if (!t || t.a == null) return;
          if (!this.backfilled) this.buf.push(t); else { this.add([t]); this.bump(); }
        } catch (x) {}
      };
      w.onopen = () => { const re = this.retry > 0; this.retry = 0; if (re && this.backfilled) this.catchUp(); };
      w.onclose = () => { if (this.stopped) return; this.retryWs(); };
    };
    this.openWs = open;
    open(0);
    this.backfill();
  }
  retryWs() {
    if (this.stopped) return;
    this.retry++;
    if (this.backfilled && this.status === 'live') { this.status = 'reconnecting'; this.bump(); }
    this.tm = setTimeout(() => this.openWs(this.retry), Math.min(15000, 1000 * Math.pow(2, this.retry)));
  }
  // after a socket drop: fill the gap since the last id seen
  async catchUp() {
    try {
      let from = this.lastId + 1, n = 0;
      while (n++ < 12 && !this.stopped) {
        const page = await this.get('&limit=1000&fromId=' + from);
        if (!page.length) break;
        this.add(page); from = page[page.length - 1].a + 1;
        if (page.length < 1000) break;
      }
      if (this.status !== 'live') { this.status = 'live'; this.err = ''; }
      this.bump();
    } catch (e) {}
  }
  async backfill() {
    try {
      this.status = 'loading'; this.err = '';
      const first = await this.get('&limit=1000');
      if (this.stopped) return;
      this.add(first);
      let oldestId = first.length ? first[0].a : 0, oldestT = first.length ? first[0].T : Date.now(), pages = 1;
      const target = Date.now() - HIST_MS;
      this.coverFrom = Math.ceil(oldestT / 60000) * 60000;
      this.bump();
      while (oldestT > target && oldestId > 0 && pages < this.maxPages && !this.stopped) {
        const froms = [];
        for (let k = 1; k <= this.conc; k++) { const f = Math.max(0, oldestId - 1000 * k); if (!froms.includes(f)) froms.push(f); }
        let res;
        try { res = await Promise.all(froms.slice(0, this.conc).map((f) => this.get('&limit=1000&fromId=' + f))); }
        catch (e) { if (this.stopped) return; break; }   // rate limited part-way (429): keep the hours already loaded, no error
        if (this.stopped) return;
        let minT = oldestT;
        res.forEach((pg, k) => { const hi = froms[k] + 1000; this.add(pg.filter((t) => t.a < hi && t.a < oldestId)); if (pg.length && pg[0].T < minT) minT = pg[0].T; });
        pages += froms.length;
        oldestId = Math.max(0, oldestId - 1000 * this.conc);
        oldestT = minT;
        this.coverFrom = Math.ceil(oldestT / 60000) * 60000;
        this.bump();
        if (froms[froms.length - 1] === 0) break;
      }
      this.coverFrom = Math.ceil(oldestT / 60000) * 60000;
      this.add(this.buf); this.buf.length = 0;
      this.backfilled = true;
      this.status = 'live'; this.err = '';
      this.trim(); this.bump();
    } catch (e) {
      // keep whatever arrived, keep the stream going, and try the backfill again soon
      this.add(this.buf); this.buf.length = 0;
      this.backfilled = true;
      this.status = 'error';
      this.err = 'Binance trade data is temporarily unavailable. Retrying…';
      this.bump();
      this.tm = setTimeout(() => { if (!this.stopped) { this.backfilled = false; this.ids.size || (this.coverFrom = Infinity); this.backfill(); } }, 15000);
    }
  }
  // 1-minute bars in decodeOrderflow() shape, oldest first; rebuilt only for minutes that changed.
  bars() {
    if (this.sortedV === this.v && this.sorted) return this.sorted;
    const tick = this.tick || 1, out = [];
    const keys = [...this.mins.keys()].sort((a, b) => a - b);
    for (const k of keys) {
      const m = this.mins.get(k);
      if (m.dirty || !m.bar) { m.bar = buildBar(k, m.trades, tick); m.dirty = false; }
      out.push(m.bar);
    }
    this.sorted = out; this.sortedV = this.v;
    return out;
  }
}

function buildBar(t, trades, tick) {
  trades.sort((a, b) => a[0] - b[0]);
  let lo = Infinity, hi = -Infinity;
  const idx = trades.map((x) => { const i = Math.floor(x[1] / tick + 1e-9); if (i < lo) lo = i; if (i > hi) hi = i; return i; });
  const n = hi - lo + 1, buy = new Float64Array(n), sell = new Float64Array(n);
  let run = 0, dmax = 0, dmin = 0, vol = 0;
  for (let j = 0; j < trades.length; j++) {
    const x = trades[j], k = idx[j] - lo;
    if (x[3]) { buy[k] += x[2]; run += x[2]; } else { sell[k] += x[2]; run -= x[2]; }
    vol += x[2];
    if (run > dmax) dmax = run; if (run < dmin) dmin = run;
  }
  return { t, lo, hi, o: idx[0], c: idx[idx.length - 1], buy, sell, vol, delta: run, dmax, dmin, trades: trades.length, bigs: [], mins: 1 };
}
