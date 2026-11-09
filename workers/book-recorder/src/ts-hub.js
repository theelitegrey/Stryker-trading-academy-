// ONE Tick-stream socket for the whole site (futures Level 2: NQ, ES). Owner order 2026-11-02, "tickstream level 2 data pack".
//
// Same pattern as src/is-hub.js: the hub lives in the single BookRecorder Durable Object, holds the ONE upstream
// socket and fans out to browser sockets. Plan "realtime-l2" allows 3 connections per account (a 4th gets close code
// 4029 too_many_connections; a dead socket keeps its slot up to 45 s). Budget: 1 = this hub (production), 1 = the
// relay / testing server, 1 spare. A viewer reconnect never touches Tick-stream.
//
// LICENCE GATE: Tick-stream's Redistribution licence is not confirmed, so the route in index.js lets ONLY admins in
// (env TS_ACCESS = 'admin', default). 'pro' lets active Pro members in. Nothing here decides who may watch.
//
// Upstream (docs: tick-stream.xyz/docs/streaming, /level2): wss://stream.tick-stream.xyz/v1/stream?key=KEY, send
// {op:'subscribe', channel:'book'|'ticks', symbols:[..]}. book = FULL snapshot (400 levels a side, <= ~7/s per
// symbol): {type:'book', symbol, bids:[[px,sz]..], asks, imbalance:-1..1, ts:unix_s}. tick = {type:'tick', symbol,
// price, size, side:'buy'|'sell', ts}. Server {type:'ping'} every 15 s: answer {op:'pong'} or it closes after 45 s.
// The key goes only into the upstream URL; it is never logged, stored or sent to a client.
//
// Browser protocol (WebSocket to /ts-live, token as subprotocol "tz-auth"): client sends {op:'sub', symbol:'NQ',
// levels:20|60|150}. The hub sends, at most MIN_GAP_MS (250 ms = 4/s) apart per client:
//   {type:'snap', symbol, ts, bids:[[px,sz]..N], asks, imb (vendor), imb10 (ours), seq}
//   {type:'coarse', symbol, ts, mid, bb, ba, step, i0, v:[..]}      once a second: the whole book bucketed (heatmap column)
//   {type:'ticks', symbol, t:[[px, sz, 1|-1, ts_ms], ..]}           batched trades since the last frame
//   {event:'status', state:'live'|'reconnecting'|'idle', ageMs}, {event:'ping', up, state}, {event:'hub_full'}
//
// Recorded (SQLite table tsmin, one row per symbol per minute, 48 h default): the book bucketed every 5 s with the
// crypto recorder's own bucketer (bucket.js, BKR1 codec), the imbalance pair every 5 s, and a 1-minute footprint from
// ticks (price -> buy / sell volume). CME hours only (Sun 18:00 - Fri 17:00 ET, daily break 17:00-18:00 ET) unless a
// viewer is watching.
import { bucketSnapshot, encodeSamples, decodeSamples, nearNiceStep } from './bucket.js';
import { TradeBook, tradeStore } from './ts-trades.js';
import { tsTier } from './ts-access.js';
import { wsTokenOf } from './rt-auth.js';
import { delayCut, tickN } from './tick-engine.js';   // TICK ENGINE block (src/tick-engine.js): every trade stored, one candle source, seq replay   // TS-TRADES block: big-trade candidates + per-minute delta (src/ts-trades.js)

export const TS_WS = 'wss://stream.tick-stream.xyz/v1/stream';
// Owner 2026-11-02: all eight, each with its OWN book (MNQ / MES are separate books, not mapped to NQ / ES). One socket, unlimited symbols on realtime-l2.
export const TS_SYMBOLS = ['NQ', 'ES', 'MNQ', 'MES', 'YM', 'RTY', 'CL', 'GC'];
// Quote-only symbols (Owner 2026-11-02): indices send {price = the level, size 0}, ETFs the last price. ticks channel only, no book.
export const TS_QUOTES = ['SPX', 'NDX', 'VIX', 'RUT', 'QQQ', 'SPY', 'IWM', 'DIA'];
// TRADES-ONLY roots (Owner order 2026-11-03): the roots we used to stream live elsewhere and the hub had no book for. Ticks channel only, on the
// SAME upstream socket: no book, no footprint recording, no trade store (cost / storage). Each micro has its OWN trades (not its mini's).
// Candles and quotes only. NG was tried and dropped: the feed accepted it but sent no trades in three 60 s probes (CME open), so it stays on delayed bars. tools/tests/ts-live-source.test.mjs checks this list equals HUB_TRADES in assets/live-source.js.
export const TS_TRADES = ['SI', 'SIL', 'ZB', 'ZN', '6E', 'HG', 'MHG', 'MGC', 'MCL', 'MYM', 'M2K'];
export const LEVELS = [20, 60, 150];
export const COARSE_RANGE = 0.02;         // +-2% of the mid (was 0.4%): NQ ~ +-570 pts; unused rows are trimmed, so a sample only holds what the 400-level book spans
// Row step for the heatmap rows: the nice step at or below 0.01% of the price. NQ 28.7k -> 2.5, ES 7.6k -> 0.5.
export const TICK_SIZE = { NQ: 0.25, ES: 0.25, MNQ: 0.25, MES: 0.25, YM: 1, RTY: 0.1, CL: 0.01, GC: 0.1 };
// Never finer than the contract tick (CL 60.00 -> 0.005 would leave every other row empty), and always a whole number of
// ticks (GC 4000 -> 0.25 would split 0.1 ticks across rows). Without `sym` it is the old rule (NQ / ES unchanged).
// true when a stored sample was cut at the old +-0.4% band: its rows reach that band's edge on a side, so a +-2% rewrite would be wider
export function narrowBook(buf) {
  const list = decodeSamples(buf instanceof ArrayBuffer ? buf : new Uint8Array(buf).buffer);
  if (!list || !list.length) return false;
  const s = list[0], lo = s.i0 * s.step, hi = (s.i0 + s.v.length) * s.step, e = s.mid * 0.004, tol = 2 * s.step;
  return Math.abs(s.mid - lo - e) <= tol || Math.abs(hi - s.mid - e) <= tol;   // an edge sits on the old +-0.4% line
}
export const coarseRule = (mid, sym) => {
  const tk = TICK_SIZE[sym];
  let step = nearNiceStep(Math.max(mid * 0.0001, tk || 0));
  if (tk) step = Math.round(Math.max(1, Math.floor(step / tk + 1e-6)) * tk * 1e6) / 1e6;
  return { step, range: COARSE_RANGE };
};

const DEF = {
  SYMBOLS: TS_SYMBOLS, TRADES: TS_TRADES, QUOTES: TS_QUOTES, RECORD: true, MODE: 'direct', MAX_CLIENTS: 40, KEEP_H: 48, MIN_GAP_MS: 250, FLUSH_MS: 250, COARSE_MS: 1000,
  SAMPLE_MS: 5000, BACK_MIN_MS: 2000, BACK_MAX_MS: 60000, STABLE_MS: 30000, DEAD_SLOT_MS: 50000, AUTH_PAUSE_MS: 300000,
  SILENT_MS: 50000, NODATA_MS: 120000, IDLE_MS: 60000, TOKEN_MS: 55 * 60000, RING: 3000, BARS_MIN: 20, FILL_MAX_MIN: 60, FILL_BUDGET_MS: 25000, FILL_SPAN_H: 6, FILL_STEP: 5, FILL_LAG_MS: 2 * 60000, FILL_PAUSE_MS: 60000, REST: 'https://api.tick-stream.xyz/v1', TICKS_PER_FRAME: 200, PRUNE_MS: 3600000, RECHECK_MS: 60000, TRADES_RESERVE: 5
};
export function tsOpts(env) {
  const n = (v, d, lo, hi) => { const x = Math.floor(Number(v)); return Number.isFinite(x) && x >= lo && x <= hi ? x : d; };
  const syms = String((env && env.TS_SYMBOLS) || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => TICK_SIZE[s]);
  return {
    SYMBOLS: syms.length ? syms : TS_SYMBOLS, RECORD: !env || env.TS_RECORD !== '0', MODE: env && env.TS_MODE === 'relay' ? 'relay' : 'direct',
    KEEP_H: n(env && env.TS_KEEP_HOURS, 48, 24, 72), MAX_CLIENTS: n(env && env.TS_MAX_CLIENTS, 40, 1, 200)
  };
}

// CME equity-index futures hours in New York time.
const nyf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function cmeOpen(ms) {
  const p = {};
  for (const x of nyf.formatToParts(new Date(ms))) p[x.type] = x.value;
  const m = (+p.hour) * 60 + (+p.minute);
  if (p.weekday === 'Sat') return false;
  if (p.weekday === 'Sun') return m >= 1080;
  if (p.weekday === 'Fri') return m < 1020;
  return !(m >= 1020 && m < 1080);
}

// Our own imbalance over the 10 best levels, depth-weighted: level i (1 = best) weighs (11 - i) / 10, so the touch counts
// most. (B - A) / (B + A) in [-1, 1], positive = bid heavy. 0 on an empty book.
export function imbalance10(bids, asks) {
  let b = 0, a = 0;
  for (let i = 0; i < 10; i++) { const w = (10 - i) / 10; if (bids[i]) b += w * bids[i][1]; if (asks[i]) a += w * asks[i][1]; }
  return b + a > 0 ? Math.round(((b - a) / (b + a)) * 1000) / 1000 : 0;
}
const goodLevels = (x) => Array.isArray(x) && x.length <= 2000 && x.every((r) => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]));
// Best first on both sides and never crossed. Everything downstream reads bids[0] / asks[0] as the touch and buckets around their mid
// (bucketSnapshot keeps bids only below the mid row, asks only above it), so ONE stray level through the book (an ask far below the
// bids, or a bid far above the asks) moved the mid and dropped the WHOLE other side from the heatmap column, the recording and the
// depth bars (Owner 2026-11-09: no liquidity below the price). A crossing level is removed from the side where it crosses fewer levels
// of the other side (the stray one). A locked book (best bid == best ask) is kept. Returns the input arrays untouched when already clean.
export function cleanBook(bids, asks) {
  let sorted = true, maxB = -Infinity, minA = Infinity;
  for (let i = 0; i < bids.length; i++) { if (i && bids[i][0] >= bids[i - 1][0]) sorted = false; if (bids[i][0] > maxB) maxB = bids[i][0]; }
  for (let i = 0; i < asks.length; i++) { if (i && asks[i][0] <= asks[i - 1][0]) sorted = false; if (asks[i][0] < minA) minA = asks[i][0]; }
  if (sorted && !(maxB > minA)) return { bids, asks, cut: 0 };
  const B = bids.slice().sort((x, y) => y[0] - x[0]), A = asks.slice().sort((x, y) => x[0] - y[0]);
  let b = 0, a = 0;
  while (b < B.length && a < A.length && B[b][0] > A[a][0]) {
    let na = 0, nb = 0;
    for (let k = a; k < A.length && A[k][0] < B[b][0]; k++) na++;
    for (let k = b; k < B.length && B[k][0] > A[a][0]; k++) nb++;
    if (na <= nb) a++; else b++;
  }
  return { bids: b ? B.slice(b) : B, asks: a ? A.slice(a) : A, cut: a + b };
}

export class TSHub {
  // store = { putMin(sym, t, book: ArrayBuffer, imbJson, fpJson), prune(minuteIdx), range(sym, t0, t1) -> [{ t, book, imb, fp }] }
  constructor(store, key, opts = {}) {
    this.store = store; this.key = key; this.o = Object.assign({}, DEF, opts);
    this.WS = opts.WebSocket || globalThis.WebSocket; this.clock = opts.now || (() => Date.now());
    this.ws = null; this.state = 'idle'; this.clients = new Set(); this.latest = new Map(); this.quotes = new Map(); this.rings = new Map(); this.bars1m = new Map(); this.seq = 0;
    this.acc = new Map(); this.nextSample = new Map(); this.timers = {}; this.retryN = 0; this.openedAt = 0; this.lastMsgAt = 0; this.lastDataAt = 0;
    this.nextAt = 0; this.pauseUntil = 0; this.lastError = ''; this.minWait = 0; this.noViewerSince = 0; this.lastPrune = 0;
    this.n = { connects: 0, frames: 0, ticks: 0, snaps: 0, coarse: 0, rows: 0, drops: 0, refused: 0, throttled: 0, uncrossed: 0, thin: 0 };
    this.lastState = '';
    this.te = opts.te || null;   // TICK ENGINE
    this.tb = new TradeBook(store.tb || null, { KEEP_H: this.o.KEEP_H, now: this.clock, fetch: this.o.fetch, REST: this.o.REST });   // TS-TRADES
  }

  // ---- when must the upstream socket be up?
  wantUp(now = this.clock()) {
    if (this.o.MODE !== 'direct' || !this.key) return false;
    if (this.clients.size) return true;
    return this.o.RECORD && cmeOpen(now);
  }
  // wanted by anyone, in either mode (the relay asks /ts-ingest through this)
  wanted(now = this.clock()) { return this.clients.size > 0 || (this.o.RECORD && cmeOpen(now)); }
  // Called on every request the Durable Object gets (the feeders keep it awake; no alarms here, ingest clears them).
  poke() { this.startTimer(); this.maintain(); }
  startTimer() { if (!this.timers.tick) this.timers.tick = setInterval(() => this.tick(), this.o.FLUSH_MS); }
  maintain() {
    const now = this.clock();
    if (this.wantUp(now)) { this.noViewerSince = 0; if (!this.ws && !this.timers.retry && now >= this.pauseUntil) this.connect(); return; }
    if (!this.ws) return;
    if (!this.noViewerSince) this.noViewerSince = now;
    if (now - this.noViewerSince >= this.o.IDLE_MS) { this.close('idle'); }
  }

  // ---- upstream
  connect() {
    if (this.ws || this.timers.retry || !this.key || typeof this.WS !== 'function') return;
    let ws;
    try { ws = new this.WS(TS_WS + '?key=' + encodeURIComponent(this.key)); } catch (e) { this.lastError = 'connect failed'; this.retryLater(); return; }
    this.ws = ws; this.openedAt = 0; this.setState('connecting'); this.n.connects++; this.minWait = 0;
    const on = (ev, fn) => { if (ws.addEventListener) ws.addEventListener(ev, fn); else ws['on' + ev] = fn; };
    on('open', () => {
      if (this.ws !== ws) return;
      this.openedAt = this.lastMsgAt = this.clock();
      for (const channel of ['book', 'ticks']) { try { ws.send(JSON.stringify({ op: 'subscribe', channel, symbols: channel === 'ticks' ? this.o.SYMBOLS.concat(this.o.TRADES, this.o.QUOTES) : this.o.SYMBOLS })); } catch (e) {} }
      this.setState('open');
    });
    on('message', (ev) => { if (this.ws === ws) this.onRaw(ev && ev.data); });
    on('error', () => { try { ws.close(); } catch (e) {} });
    on('close', (ev) => {
      if (this.ws !== ws) return;
      this.ws = null; if (this.te) this.te.down();
      const code = ev && ev.code;
      this.lastError = 'closed ' + (code || '?');
      // 4029 = over the connection cap (a dead socket holds its slot up to 45 s): wait it out. Auth codes: long pause.
      let minWait = this.minWait;
      if (code === 4029) minWait = Math.max(minWait, this.o.DEAD_SLOT_MS);
      if (code === 4001 || code === 4003 || code === 1008 || code === 4401) { minWait = this.o.AUTH_PAUSE_MS; this.pauseUntil = this.clock() + minWait; }
      this.setState('idle');
      if (this.wantUp()) this.retryLater(minWait);
    });
  }
  close(why) {
    const ws = this.ws; this.ws = null; this.lastError = why || ''; this.setState('idle'); if (this.te) this.te.down();
    try { if (ws) ws.close(1000, 'bye'); } catch (e) {}
  }
  drop(why, minWait = 0) { this.n.drops++; this.minWait = minWait; const ws = this.ws; this.ws = null; if (this.te) this.te.down(); this.lastError = why; this.setState('idle'); try { if (ws) ws.close(); } catch (e) {} if (this.wantUp()) this.retryLater(minWait); }
  retryLater(minWait = 0) {
    if (this.timers.retry) return;
    if (this.openedAt && this.clock() - this.openedAt > this.o.STABLE_MS) this.retryN = 0;
    this.retryN++;
    const base = Math.min(this.o.BACK_MAX_MS, this.o.BACK_MIN_MS * Math.pow(2, Math.min(this.retryN - 1, 10)));
    const wait = Math.max(minWait, base * (0.75 + Math.random() * 0.5));
    this.nextAt = this.clock() + wait;
    this.timers.retry = setTimeout(() => { this.timers.retry = null; if (this.wantUp()) this.connect(); }, wait);
  }
  setState(s) { this.state = s; this.announce(); }
  // 'live' for the clients = socket open and data seen in the last 10 s (or, in relay mode, relay frames that recent)
  liveState(now = this.clock()) {
    if (this.o.MODE === 'relay') return this.lastDataAt && now - this.lastDataAt < 10000 ? 'live' : 'reconnecting';
    if (this.state === 'open') return this.lastDataAt >= this.openedAt && this.lastDataAt && now - this.lastDataAt < 10000 ? 'live' : (cmeOpen(now) ? 'reconnecting' : 'idle');
    return this.state === 'connecting' || this.timers.retry ? 'reconnecting' : 'idle';
  }
  announce() {
    const s = this.liveState();
    if (s === this.lastState) return;
    this.lastState = s;
    this.broadcast({ event: 'status', state: s, ageMs: this.lastDataAt ? this.clock() - this.lastDataAt : -1 });
  }
  broadcast(o) { const s = JSON.stringify(o); for (const c of this.clients) this.send(c, s); }
  send(c, s) { try { c.sock.send(s); } catch (e) { c.errors++; } }

  onRaw(data) {
    let m;
    try { m = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)); } catch (e) { return; }
    this.lastMsgAt = this.clock();
    this.feed([m]);
  }
  // One entry for upstream frames AND for the relay (/ts-ingest): array of frames in the upstream shapes.
  feed(frames) {
    const now = this.clock();
    for (const m of frames) {
      if (!m || typeof m !== 'object') continue;
      if (m.type === 'ping') { try { if (this.ws) this.ws.send('{"op":"pong"}'); } catch (e) {} continue; }
      if (m.type === 'welcome') continue;
      if (m.type === 'error' || m.error) {
        const t = JSON.stringify(m).toLowerCase();
        this.lastError = 'upstream error';
        if (/too_many|4029/.test(t)) { this.minWait = this.o.DEAD_SLOT_MS; }
        else if (/unauthor|invalid|forbidden|no_subscription|plan_required/.test(t)) { this.minWait = this.o.AUTH_PAUSE_MS; this.pauseUntil = now + this.minWait; }
        continue;
      }
      if (m.type === 'tick' && this.o.QUOTES.includes(m.symbol)) { this.onQuote(m, now); continue; }
      if (m.type === 'tick' && this.o.TRADES.includes(m.symbol)) { this.onTick(m, now, true); continue; }
      if (!this.o.SYMBOLS.includes(m.symbol)) continue;
      if (m.type === 'book') this.onBook(m, now);
      else if (m.type === 'tick') this.onTick(m, now);
    }
  }
  onBook(m, now) {
    if (!goodLevels(m.bids) || !goodLevels(m.asks)) return;
    this.n.frames++; this.lastDataAt = now;
    const k = cleanBook(m.bids, m.asks);
    if (k.cut) this.n.uncrossed++;
    if (Math.min(k.bids.length, k.asks.length) < 20) this.n.thin++;   // diagnostic only (/ts-health): a side with < 20 levels; NQ/ES send 400 a side
    const prev = this.latest.get(m.symbol);
    this.latest.set(m.symbol, { bids: k.bids, asks: k.asks, imb: Number.isFinite(m.imbalance) ? m.imbalance : 0, ts: m.ts, at: now, ver: (prev ? prev.ver : 0) + 1, imb10: null, coarse: null, coarseAt: 0 });
    this.announce();
  }
  // Quote-only: keep the latest value and a 1-minute OHLC (volume stays 0: index ticks have size 0). No ring, no recording.
  onQuote(m, now) {
    if (!(m.price > 0)) return;
    this.lastDataAt = now;
    const q = this.quotes.get(m.symbol), p = Number(m.price);
    this.quotes.set(m.symbol, { p, at: now, ver: (q ? q.ver : 0) + 1 });
    const bm = Math.floor(now / 60000) * 60000, bl = this.bars1m.get(m.symbol) || []; this.bars1m.set(m.symbol, bl);
    let bb = bl[bl.length - 1];
    if (!bb || bb[0] !== bm) { bb = [bm, p, p, p, p, 0]; bl.push(bb); if (bl.length > this.o.BARS_MIN) bl.splice(0, bl.length - this.o.BARS_MIN); }
    if (p > bb[2]) bb[2] = p; if (p < bb[3]) bb[3] = p; bb[4] = p;
  }
  // { SPX: [price, ts_ms], .. } for /ts-quotes; values older than 10 min are left out
  quoteMap(now = this.clock()) { const o = {}; for (const [s, q] of this.quotes) if (now - q.at < 600000) o[s] = [q.p, q.at]; return o; }
  // light = trades-only root: the 1m candle + the ring for the browsers, nothing recorded
  onTick(m, now, light = false) {
    if (!(m.price > 0) || !(m.size > 0)) return;
    const side = m.side === 'buy' ? 1 : m.side === 'sell' ? -1 : 0;
    if (!side) return;
    this.n.ticks++; this.lastDataAt = now;
    if (this.te) { if (this.state === 'open' && !this.te.upAt) this.te.up(this.openedAt + 2000); this.te.add(m.symbol, m.price, m.size, side, m.ts, now); }   // TICK ENGINE: every trade, live span from the socket's open
    // 1-minute candles of the last BARS_MIN minutes: a viewer's chart is back-filled from these on subscribe (candles the
    // 10-minute-delayed lane has not delivered yet), then continues from the tick frames.
    const bm = Math.floor(now / 60000) * 60000, bl = this.bars1m.get(m.symbol) || []; this.bars1m.set(m.symbol, bl);
    let bb = bl[bl.length - 1];
    if (!bb || bb[0] !== bm) { bb = [bm, m.price, m.price, m.price, m.price, 0]; bl.push(bb); if (bl.length > this.o.BARS_MIN) bl.splice(0, bl.length - this.o.BARS_MIN); }
    if (m.price > bb[2]) bb[2] = m.price; if (m.price < bb[3]) bb[3] = m.price; bb[4] = m.price; bb[5] += m.size;
    const ring = this.rings.get(m.symbol) || []; this.rings.set(m.symbol, ring);
    if (!light && this.o.RECORD) this.tb.add(m.symbol, m.price, m.size, side, now);   // TS-TRADES
    ring.push([++this.seq, m.price, m.size, side, now]);
    if (ring.length > this.o.RING) ring.splice(0, ring.length - this.o.RING);
    if (light) return;
    const a = this.accFor(m.symbol, now), key = String(m.price);
    let lv = a.lv.get(key);
    if (!lv) { lv = [m.price, 0, 0]; a.lv.set(key, lv); }
    if (side > 0) lv[1] += m.size; else lv[2] += m.size;
    if (a.o == null) a.o = m.price;
    a.h = a.h == null ? m.price : Math.max(a.h, m.price); a.l = a.l == null ? m.price : Math.min(a.l, m.price); a.c = m.price;
  }

  // ---- per-minute accumulator (book samples + imbalance + footprint)
  accFor(sym, now) {
    const t = Math.floor(now / 60000);
    let a = this.acc.get(sym);
    if (a && a.t !== t) { this.finalize(sym, a); a = null; }
    if (!a) { a = { t, samples: [], imb: [], lv: new Map(), o: null, h: null, l: null, c: null }; this.acc.set(sym, a); }
    return a;
  }
  finalize(sym, a) {
    if (!a.samples.length && !a.lv.size) return;
    const fp = a.lv.size ? JSON.stringify({ o: a.o, h: a.h, l: a.l, c: a.c, lv: [...a.lv.values()].sort((x, y) => x[0] - y[0]) }) : null;
    try { this.store.putMin(sym, a.t, a.samples.length ? encodeSamples(a.samples) : null, a.imb.length ? JSON.stringify(a.imb) : null, fp); this.n.rows++; } catch (e) { this.lastError = 'store failed'; }
  }
  record(now) {
    if (!this.o.RECORD) return;
    for (const sym of this.o.SYMBOLS) {
      const L = this.latest.get(sym);
      if (!L || now - L.at > 10000) continue;
      if (now < (this.nextSample.get(sym) || 0)) continue;
      this.nextSample.set(sym, Math.floor(now / this.o.SAMPLE_MS) * this.o.SAMPLE_MS + this.o.SAMPLE_MS);
      const mid = L.bids.length && L.asks.length ? (L.bids[0][0] + L.asks[0][0]) / 2 : 0;
      if (!(mid > 0)) continue;
      const s = bucketSnapshot({ bids: L.bids, asks: L.asks }, Math.floor(now / 1000) * 1000, coarseRule(mid, sym));
      const a = this.accFor(sym, now);
      if (s && s.v.length) a.samples.push(s);
      a.imb.push([Math.floor(now / 1000), L.imb, this.imb10Of(L)]);
    }
    if (now - this.lastPrune > this.o.PRUNE_MS) { this.lastPrune = now; try { this.store.prune(Math.floor((now - this.o.KEEP_H * 3600000) / 60000)); } catch (e) {} this.tb.prune(now); }
  }
  imb10Of(L) { if (L.imb10 == null) L.imb10 = imbalance10(L.bids, L.asks); return L.imb10; }
  coarseOf(sym, now) {
    const L = this.latest.get(sym);
    if (!L) return null;
    if (L.coarse && now - L.coarseAt < this.o.COARSE_MS - 50) return L.coarse;
    const mid = L.bids.length && L.asks.length ? (L.bids[0][0] + L.asks[0][0]) / 2 : 0;
    const s = mid > 0 ? bucketSnapshot({ bids: L.bids, asks: L.asks }, now, coarseRule(mid, sym)) : null;
    L.coarse = s ? { type: 'coarse', symbol: sym, ts: now, mid: s.mid, bb: s.bb, ba: s.ba, step: s.step, i0: s.i0, v: Array.from(s.v) } : null;
    L.coarseAt = now;
    return L.coarse;
  }

  // ---- clients
  // sock = { send(str), close(code, reason) }. -> handle { close(), onMessage(str) } or null (full)
  // tier: 'book' (trades + L2 book) or 'trades' (candles / trades / quotes only, never the book). Anything but 'book' = 'trades' (fails closed). who = { tok, env, exp } lets the hub re-check access every minute (advisor review 2026-11-03).
  attach(sock, sym, levels, tier, who) {
    // the last TRADES_RESERVE slots are for book-tier viewers, so a flood of trades-tier sockets cannot lock them out
    if (this.clients.size >= this.o.MAX_CLIENTS || (tier !== 'book' && this.clients.size >= this.o.MAX_CLIENTS - this.o.TRADES_RESERVE)) { this.n.refused++; return null; }
    const c = { sock, te: new Map(), book: tier === 'book', who: who || null, nextCheck: this.clock() + this.o.RECHECK_MS, sym: null, levels: 60, errors: 0, sentVer: -1, lastSend: 0, lastCoarse: 0, lastSeq: this.seq, lastPing: 0, bornAt: this.clock() };
    this.clients.add(c);
    this.setSub(c, sym, levels);
    this.startTimer();
    this.send(c, JSON.stringify({ event: 'hub_attached', state: this.liveState(), tier: c.book ? 'book' : 'trades', symbols: this.o.SYMBOLS.concat(this.o.QUOTES), trades: this.o.TRADES, te: this.te ? { e: this.te.epoch, syms: [...this.te.syms] } : null }));
    this.maintain();
    return {
      close: () => { this.clients.delete(c); },
      onMessage: (s) => {
        let m; try { m = JSON.parse(s); } catch (e) { return; }
        if (m && m.op === 'sub') this.setSub(c, m.symbol, m.levels);
        else if (m && (m.op === 'tsub' || m.op === 'tunsub')) this.teSub(c, m);
      }
    };
  }
  // Access can end while a socket is open (add-on cancelled, switched off, TS_ACCESS flipped): ask the gate again every RECHECK_MS. No answer
  // (outage) keeps the current tier; a definite 'no' closes the socket with 4003, a lower tier downgrades it in place.
  recheck(c, now) {
    c.nextCheck = now + this.o.RECHECK_MS;
    const f = this.o.tierOf; if (!f) return;
    Promise.resolve(f(c.who.env, c.who.tok)).then((t) => {
      if (!this.clients.has(c)) return;
      if (!t) { try { c.sock.close(4003, 'access ended'); } catch (e) {} this.clients.delete(c); this.n.revoked = (this.n.revoked || 0) + 1; }
      else { const was = c.book; c.book = t === 'book'; if (was !== c.book) this.send(c, JSON.stringify({ event: 'hub_attached', state: this.liveState(), tier: c.book ? 'book' : 'trades', symbols: this.o.SYMBOLS.concat(this.o.QUOTES), trades: this.o.TRADES })); }   // tell the page, or its lock chip goes stale
    }).catch(() => {});
  }
  // TICK ENGINE: {op:'tsub', symbol, since, e} streams every trade of symbol with seq > since as {type:'tt', symbol, e, q, t:[[px, size, side, ts_ms]..]}
  // (q = seq of t[0]; seqs are contiguous). since from another epoch or older than the replay window: {type:'resync', symbol, e}, and the
  // stream continues from now (the page re-reads its bars, then sends tsub with the new seq). No since = from now. {op:'tunsub', symbol} stops.
  teSub(c, m) {
    const te = this.te, sym = String(m.symbol || '').toUpperCase();
    if (!te || !te.has(sym)) return;
    const now = this.clock();   // at most 60 tsub / tunsub a minute per socket (a resubscribe loop would replay over and over)
    if (!c.teWin || now - c.teWin > 60000) { c.teWin = now; c.teOps = 0; }
    if (++c.teOps > 60) return;
    if (m.op === 'tunsub') { c.te.delete(sym); return; }
    if (!c.te.has(sym) && c.te.size >= 24) return;
    const cur = te.S.get(sym) ? te.S.get(sym).seq : 0, since = Number(m.since);
    let seq = cur;
    if (m.since != null && Number.isInteger(since) && since >= 0) {
      if (Number(m.e) === te.epoch && since <= cur) seq = since;
      else this.send(c, JSON.stringify({ type: 'resync', symbol: sym, e: te.epoch }));
    }
    c.te.set(sym, seq);
  }
  // fc = this flush's frame cache: sockets at the same seq (nearly all of them, live) share ONE encoded frame (load test: test/tick-engine-load.mjs)
  teFlush(c, fc = new Map()) {
    const te = this.te; let sent = false, budget = 4000;   // replay budget per socket per flush (250 ms), all symbols together
    for (const [sym, seq] of c.te) {
      if (budget <= 0) break;
      const key = sym + '|' + seq + '|' + budget;
      let f = fc.get(key);
      if (!f) {
        const r = te.since(sym, seq, budget);
        f = r === 'resync' ? { resync: true, s: JSON.stringify({ type: 'resync', symbol: sym, e: te.epoch }) } : r.t.length ? { q: r.q, n: r.t.length, s: JSON.stringify({ type: 'tt', symbol: sym, e: te.epoch, q: r.q, t: r.t }) } : { n: 0 };
        fc.set(key, f);
      }
      if (f.resync) { const cur = te.S.get(sym) ? te.S.get(sym).seq : 0; c.te.set(sym, cur); this.send(c, f.s); continue; }
      if (!f.n) continue;
      this.send(c, f.s); c.te.set(sym, f.q + f.n - 1); sent = true; budget -= f.n;
    }
    return sent;
  }
  setSub(c, sym, levels) {
    const s = String(sym || '').toUpperCase();
    if ((this.o.SYMBOLS.includes(s) || this.o.TRADES.includes(s) || this.o.QUOTES.includes(s)) && s !== c.sym) {
      c.sym = s; c.sentVer = -1; c.lastCoarse = 0; c.lastSeq = this.seq;
      const bl = this.bars1m.get(s);
      if (bl && bl.length) this.send(c, JSON.stringify({ type: 'bars', symbol: s, b: bl }));   // [[t_ms,o,h,l,c,vol]..] 1m, newest last
    }
    const l = Number(levels);
    if (LEVELS.includes(l)) c.levels = l;
    c.sentVer = -1;
  }

  tick() {
    const now = this.clock();
    this.maintain();
    // watchdogs
    if (this.ws && this.state === 'open') {
      if (now - this.lastMsgAt > this.o.SILENT_MS) this.drop('silent');
      else if (cmeOpen(now) && now - Math.max(this.lastDataAt, this.openedAt) > this.o.NODATA_MS) this.drop('no data');
    }
    this.record(now);
    this.tb.flush(now);   // TS-TRADES
    if (this.te) this.te.tick(now);   // TICK ENGINE: close minutes, live span, gap fill, prune
    this.announce();
    const fc = new Map();   // TICK ENGINE: shared frames for this flush
    for (const c of [...this.clients]) {
      if (c.errors > 5) { this.clients.delete(c); continue; }
      if (c.who && now >= c.nextCheck) this.recheck(c, now);
      if (c.bornAt && now - c.bornAt >= Math.min(this.o.TOKEN_MS, c.who && c.who.exp ? c.who.exp * 1000 - c.bornAt : Infinity)) { try { c.sock.close(4401, 'token'); } catch (e) {} this.clients.delete(c); continue; }   // the browser reconnects with a fresh token
      if (now - c.lastPing >= 5000) { c.lastPing = now; this.send(c, JSON.stringify({ event: 'ping', up: this.lastDataAt ? now - this.lastDataAt : -1, state: this.liveState(now) })); }   // every socket, the tick-engine one too (its heartbeat)
      if (this.te && c.te.size) this.teFlush(c, fc);
      if (!c.sym) continue;
      if (now - c.lastSend < this.o.MIN_GAP_MS - 20) { this.n.throttled++; continue; }
      if (this.o.QUOTES.includes(c.sym)) {   // quote-only symbol: one small frame per change, <= 4/s
        const q = this.quotes.get(c.sym);
        if (q && q.ver !== c.sentVer) { this.send(c, JSON.stringify({ type: 'quote', symbol: c.sym, p: q.p, ts: q.at })); c.sentVer = q.ver; c.lastSend = now; }
        continue;
      }
      const L = c.book ? this.latest.get(c.sym) : null;   // trades tier: never a snap or a coarse (heatmap) frame
      let sent = false;
      if (L && L.ver !== c.sentVer) {
        const k = c.levels;
        this.send(c, JSON.stringify({ type: 'snap', symbol: c.sym, ts: now, bids: L.bids.slice(0, k), asks: L.asks.slice(0, k), imb: L.imb, imb10: this.imb10Of(L), seq: L.ver }));
        c.sentVer = L.ver; this.n.snaps++; sent = true;
      }
      if (L && now - c.lastCoarse >= this.o.COARSE_MS) {
        const cs = this.coarseOf(c.sym, now);
        if (cs) { this.send(c, JSON.stringify(cs)); c.lastCoarse = now; this.n.coarse++; sent = true; }
      }
      const ring = this.rings.get(c.sym);
      if (ring && ring.length && ring[ring.length - 1][0] > c.lastSeq) {
        const t = [];
        for (const r of ring) if (r[0] > c.lastSeq && t.length < this.o.TICKS_PER_FRAME) { t.push([r[1], r[2], r[3], r[4]]); c.lastSeq = r[0]; }
        this.send(c, JSON.stringify({ type: 'ticks', symbol: c.sym, t })); sent = true;
      }
      if (sent) c.lastSend = now;
    }
    if (!this.clients.size && !this.ws && !this.timers.retry && !this.wantUp(now) && this.timers.tick) {   // fully idle: write the open minutes, stop the timer
      for (const [sym, a] of this.acc) this.finalize(sym, a);
      this.acc.clear(); clearInterval(this.timers.tick); this.timers.tick = null;
    }
  }

  stats() {
    const now = this.clock();
    return {
      v: 1, at: Math.floor(now / 1000), mode: this.o.MODE, configured: !!this.key || this.o.MODE === 'relay', state: this.state, live: this.liveState(now),
      cmeOpen: cmeOpen(now), recording: this.o.RECORD, clients: this.clients.size, symbols: this.o.SYMBOLS, trades: this.o.TRADES, quotes: this.o.QUOTES, bookClients: [...this.clients].filter((c) => c.book).length, upstreamSockets: this.ws ? 1 : 0,
      lastDataAgoMs: this.lastDataAt ? now - this.lastDataAt : null, retryN: this.retryN, nextRetryInMs: this.timers.retry ? Math.max(0, this.nextAt - now) : 0,
      lastError: this.lastError, keepHours: this.o.KEEP_H, tsBig: this.tb.n.big, tsFilledMin: this.tb.n.filledMin, teClients: [...this.clients].filter((c) => c.te && c.te.size).length, ...this.n
    };
  }
  shutdown() { if (this.te) this.te.down(); for (const k of Object.keys(this.timers)) if (this.timers[k]) { clearTimeout(this.timers[k]); clearInterval(this.timers[k]); this.timers[k] = null; } try { if (this.ws) this.ws.close(); } catch (e) {} this.ws = null; }

  // ---- history reads (the Worker has already checked access)
  // Book samples between from..to (ms), BKR1 bytes for the client's decodeBookHistory. At most 6 h.
  bookHistory(sym, from, to) {
    const t1 = Math.floor(to / 60000), t0 = Math.max(Math.floor(from / 60000), t1 - 360);
    const out = [];
    for (const r of this.store.range(sym, t0, t1)) {
      if (!r.book) continue;
      const list = decodeSamples(r.book instanceof ArrayBuffer ? r.book : new Uint8Array(r.book).buffer);
      if (list) for (const s of list) if (s.ts >= from && s.ts <= to) out.push(s);
    }
    // the open minute is still in memory
    const a = this.acc.get(sym);
    if (a) for (const s of a.samples) if (s.ts >= from && s.ts <= to) out.push(s);
    return encodeSamples(out);
  }
  // REST backfill of the recorder's gaps (Owner 2026-11-03: the heatmap must fill the visible screen). Plan realtime-l2 has 5 y of
  // /history/book. For each minute in [from, to] (<= FILL_SPAN_H) that has NO row in tsmin, ask the archive for ONE full snapshot at
  // that minute (a 2 s window, limit 900 rows = one 400+400 snapshot), bucket it with the SAME rule as the live recorder, and store it
  // as that minute's row. A minute with nothing in the archive (market closed) gets an empty row so it is asked once only. Serial, one
  // run at a time, at most FILL_MAX_MIN minutes / FILL_BUDGET_MS per call; the caller repeats while `left` > 0. Newest first (closest to
  // what the recorder already has). Minutes newer than FILL_LAG_MS are left to the live recorder. Returns { filled, left }.
  async backfill(sym, from, to) {
    const o = this.o, doFetch = o.fetch || ((u, i) => fetch(u, i));
    if (!this.key || !o.SYMBOLS.includes(sym)) return { filled: 0, left: 0 };
    const nowMin = Math.floor(this.clock() / 60000), t1 = Math.min(Math.floor(to / 60000), nowMin - Math.ceil(o.FILL_LAG_MS / 60000));
    const t0 = Math.max(Math.floor(from / 60000), t1 - o.FILL_SPAN_H * 60, nowMin - o.KEEP_H * 60);
    if (!(t1 > t0)) return { filled: 0, left: 0 };
    // minutes stored by the archive backfill BEFORE the +-2% range (build <= 790) hold a +-0.4% ribbon: drop them from `have` so they are
    // fetched once more at the wide range (an archive row has no imb / fp, so nothing else is lost). Recorder rows (imb / fp / 12 samples a minute)
    // are never replaced; they age out with KEEP_H.
    const have = new Set();
    for (const r of this.store.range(sym, t0, t1)) { if (r.book && !r.imb && !r.fp && narrowBook(r.book)) continue; have.add(r.t); }
    const a = this.acc.get(sym); if (a) have.add(a.t);
    const missing = []; for (let t = t1; t >= t0; t--) if (!have.has(t)) missing.push(t);
    if (!missing.length) return { filled: 0, left: 0 };
    if (this.filling || this.clock() < (this.fillPause || 0)) return { filled: 0, left: missing.length };
    this.filling = true;
    const start = this.clock(); let filled = 0;
    try {
      // one snapshot stands for FILL_STEP minutes (the client stretches a column to the next sample, at most FILL_STEP min)
      const groups = new Map();
      for (const t of missing) { const g = Math.floor(t / o.FILL_STEP); (groups.get(g) || groups.set(g, []).get(g)).push(t); }
      for (const [, mins] of groups) {
        if (filled >= o.FILL_MAX_MIN || this.clock() - start > o.FILL_BUDGET_MS) break;
        mins.sort((x, y) => x - y);
        const t = mins[0];
        let r;
        try { r = await doFetch(o.REST + '/history/book?symbol=' + sym + '&start=' + t * 60 + '&end=' + (t * 60 + 2) + '&limit=900', { headers: { authorization: 'Bearer ' + this.key } }); }
        catch (e) { this.fillPause = this.clock() + o.FILL_PAUSE_MS; this.lastError = 'fill fetch'; break; }
        if (r.status === 429 || r.status >= 500) { this.fillPause = this.clock() + o.FILL_PAUSE_MS; this.lastError = 'fill http ' + r.status; break; }
        if (r.status === 401 || r.status === 403) { this.fillPause = this.clock() + o.AUTH_PAUSE_MS; this.lastError = 'fill auth'; break; }
        let j = null; try { j = await r.json(); } catch (e) {}
        const rows = (j && Array.isArray(j.book) ? j.book : []);
        let first = null; const bids = [], asks = [];
        for (const x of rows) {
          if (first == null) first = x.ts; if (x.ts !== first) break;
          if (x.flag) { bids.length = 0; asks.length = 0; break; }   // the old incremental tape (before mid-June 2026) is not a snapshot: skip
          (x.side === 'bid' ? bids : asks).push([Number(x.price), Number(x.size)]);
        }
        let book = null;
        if (bids.length && asks.length) {
          const k = cleanBook(bids, asks);   // sorted, uncrossed
          const mid = k.bids.length && k.asks.length ? (k.bids[0][0] + k.asks[0][0]) / 2 : 0;
          const smp = mid > 0 ? bucketSnapshot({ bids: k.bids, asks: k.asks }, Math.floor(first / 1000), coarseRule(mid, sym)) : null;
          if (smp && smp.v.length) book = encodeSamples([smp]);
        }
        try { for (const m of mins) this.store.putMin(sym, m, m === t ? book : null, null, null); } catch (e) { this.lastError = 'store failed'; break; }
        filled += mins.length; if (book) this.n.filled = (this.n.filled || 0) + 1;
      }
    } finally { this.filling = false; }
    return { filled, left: Math.max(0, missing.length - filled) };
  }
  // { imb: [[t_s, vendor, ours]..], fp: [{ t, o, h, l, c, lv }..] } between from..to (ms), at most 6 h
  aux(sym, from, to) {
    const t1 = Math.floor(to / 60000), t0 = Math.max(Math.floor(from / 60000), t1 - 360);
    const imb = [], fp = [];
    const take = (t, i, f) => { if (i) for (const x of JSON.parse(i)) if (x[0] * 1000 >= from && x[0] * 1000 <= to) imb.push(x); if (f) fp.push(Object.assign({ t }, JSON.parse(f))); };
    for (const r of this.store.range(sym, t0, t1)) take(r.t, r.imb, r.fp);
    const a = this.acc.get(sym);
    if (a) { for (const x of a.imb) if (x[0] * 1000 >= from && x[0] * 1000 <= to) imb.push(x); if (a.lv.size) fp.push({ t: a.t, o: a.o, h: a.h, l: a.l, c: a.c, lv: [...a.lv.values()].sort((x, y) => x[0] - y[0]) }); }
    return { imb, fp };
  }
}

// ---- Durable Object glue (src/index.js routes /ts-* here)
export function tsStore(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS tsmin (sym TEXT NOT NULL, t INTEGER NOT NULL, book BLOB, imb TEXT, fp TEXT, PRIMARY KEY (sym, t)) WITHOUT ROWID');
  return {
    tb: tradeStore(sql),   // TS-TRADES
    putMin(sym, t, book, imb, fp) { sql.exec('INSERT OR REPLACE INTO tsmin (sym, t, book, imb, fp) VALUES (?, ?, ?, ?, ?)', sym, t, book, imb, fp); },
    prune(t) { sql.exec('DELETE FROM tsmin WHERE t < ?', t); },
    range(sym, t0, t1) { return sql.exec('SELECT t, book, imb, fp FROM tsmin WHERE sym = ? AND t >= ? AND t <= ? ORDER BY t', sym, t0, t1).toArray(); }
  };
}
const SOCK_LIMIT = 256;
// JWT exp (epoch s) of a token the Worker already verified; 0 when unreadable (then only TOKEN_MS applies)
const tokExp = (t) => { try { return JSON.parse(atob(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp || 0; } catch (e) { return 0; } };
export async function tsHubFetch(hub, env, u, req) {
  if (!hub.key && hub.o.MODE === 'direct') hub.key = env.TICKSTREAM_API_KEY || '';
  hub.poke();
  if (u.pathname === '/ts-stats') return Response.json(hub.stats());
  // TICK ENGINE reads. lane = 'live' only when the Worker verified a live tier (index.js sets it; a client never reaches this URL).
  // Anything else is the delayed lane: the cut is computed HERE from the clock, never taken from the request.
  if (u.pathname === '/te-stats') return Response.json(hub.te ? hub.te.stats() : { off: true });
  if (u.pathname === '/te-bars' || u.pathname === '/te-ticks') {
    if (!hub.te) return new Response('engine off', { status: 404 });
    const sym = String(u.searchParams.get('sym') || '').toUpperCase(), now = Date.now();
    const cut = u.searchParams.get('lane') === 'live' ? Infinity : delayCut(now);
    const to = Math.min(Number(u.searchParams.get('to')) || now + 60000, now + 60000), from = Number(u.searchParams.get('from')) || to - 6 * 3600000;
    if (!hub.te.has(sym) || !(from < to)) return new Response('bad request', { status: 400 });
    if (u.pathname === '/te-ticks') { const t = hub.te.ticks(sym, from, to, cut); return Response.json({ sym, e: hub.te.epoch, cut: cut === Infinity ? null : cut, t }); }
    const tf = String(u.searchParams.get('tf') || ''), n = tickN(tf), limit = Math.min(5000, Math.max(1, Number(u.searchParams.get('limit')) || 500));
    // ON-DEMAND HISTORY: seconds / tick reads older than the record are fetched from the archive first (live lane only: an anonymous
    // read never spends archive calls). `more` = minutes still missing after this read's budget; the chart asks again (paging by `to`).
    let more = 0;
    if (cut === Infinity && (n || /^\d+S$/i.test(tf))) { try { more = (await hub.te.ensureFor(sym, tf, from, to, limit, cut)).left; } catch (e) { more = 1; } }
    if (n) { const r = hub.te.tickBars(sym, n, to, limit, cut); return Response.json(Object.assign({ sym, tf, at: now, more }, r, { cut: cut === Infinity ? null : cut })); }
    const r = hub.te.bars(sym, tf, from, to, cut);
    if (r) r.more = more;
    if (!r) return new Response('bad timeframe', { status: 400 });
    return Response.json(Object.assign({ sym, tf: u.searchParams.get('tf'), at: now }, r, { cut: cut === Infinity ? null : cut }));
  }
  if (u.pathname === '/ts-quotes') return Response.json({ q: hub.quoteMap(), live: hub.liveState() });
  if (u.pathname === '/ts-ingest') {
    if (hub.o.MODE !== 'relay') return new Response('relay mode is off', { status: 409 });
    let b; try { b = await req.json(); } catch (e) { return new Response('bad json', { status: 400 }); }
    hub.feed(Array.isArray(b && b.frames) ? b.frames.slice(0, 200) : []);
    return Response.json({ want: hub.wanted(), clients: hub.clients.size });
  }
  // TS-TRADES block: GET /ts-trades?sym=&from=&to=[&fill=0] -> { sym, floor, trades: [[ts_ms, price, size, side 1|-1]..], delta: [[t_ms, buy, sell, runHi, runLo]..] }. Same gate as /ts-book-history (index.js), at most 6 h a read.
  if (u.pathname === '/ts-trades') {
    const sym = String(u.searchParams.get('sym') || u.searchParams.get('symbol') || '').toUpperCase();
    if (!hub.o.SYMBOLS.includes(sym)) return new Response('symbol not recorded', { status: 404 });
    const now = Date.now(), to = Math.min(now + 60000, Number(u.searchParams.get('to')) || now), from = Math.max(to - 6 * 3600000, Number(u.searchParams.get('from')) || to - 3600000);
    let left = 0;
    if (u.searchParams.get('fill') !== '0') { try { left = (await hub.tb.backfill(sym, from, to, hub.key)).left; } catch (e) { hub.lastError = 'trade fill failed'; } }
    const r = hub.tb.read(sym, from, to);
    return new Response(JSON.stringify({ sym, at: Date.now(), floor: hub.tb.floor[sym], left, trades: r.trades, delta: r.delta }), { headers: { 'content-type': 'application/json', 'x-ts-fill-left': String(left) } });
  }
  // END TS-TRADES block
  if (u.pathname === '/ts-book-history' || u.pathname === '/ts-aux') {
    const sym = String(u.searchParams.get('symbol') || '').toUpperCase();
    if (!hub.o.SYMBOLS.includes(sym)) return new Response('symbol not recorded', { status: 404 });
    const now = Date.now(), to = Math.min(now + 60000, Number(u.searchParams.get('to')) || now), from = Math.max(to - hub.o.KEEP_H * 3600000, Number(u.searchParams.get('from')) || to - 3600000);
    if (u.pathname === '/ts-aux') return Response.json(hub.aux(sym, from, to));
    if (!hub.key && hub.o.MODE === 'direct') hub.key = env.TICKSTREAM_API_KEY || '';
    // fill the recorder's gaps from the archive first (bounded per call); the client repeats while x-ts-fill-left > 0
    let left = 0; if (u.searchParams.get('fill') !== '0') { try { left = (await hub.backfill(sym, from, to)).left; } catch (e) { hub.lastError = 'fill failed'; } }
    return new Response(hub.bookHistory(sym, from, to), { headers: { 'content-type': 'application/octet-stream', 'x-ts-fill-left': String(left) } });
  }
  if (req.headers.get('upgrade') !== 'websocket') return new Response('websocket required', { status: 426 });
  if (hub.o.MODE === 'direct' && !hub.key) return new Response('feed not configured', { status: 503 });
  const pair = new WebSocketPair(), client = pair[0], server = pair[1];
  server.accept();
  const sock = { send: (s) => server.send(s), close: (c, r) => { try { server.close(c, r); } catch (e) {} } };
  if (!hub.o.tierOf) hub.o.tierOf = tsTier;
  const tok = wsTokenOf(req), who = { tok, env, exp: tokExp(tok) };
  const h = hub.attach(sock, u.searchParams.get('symbol'), u.searchParams.get('levels'), u.searchParams.get('tier') === 'book' ? 'book' : 'trades', who);
  const proto = String(req.headers.get('sec-websocket-protocol') || '').includes('tz-auth') ? { 'sec-websocket-protocol': 'tz-auth' } : {};
  if (!h) { server.send(JSON.stringify({ event: 'hub_full' })); server.close(1013, 'hub full'); return new Response(null, { status: 101, webSocket: client, headers: proto }); }
  server.addEventListener('message', (ev) => { if (typeof ev.data === 'string' && ev.data.length <= SOCK_LIMIT) h.onMessage(ev.data); });
  server.addEventListener('close', () => h.close());
  server.addEventListener('error', () => h.close());
  return new Response(null, { status: 101, webSocket: client, headers: proto });
}
