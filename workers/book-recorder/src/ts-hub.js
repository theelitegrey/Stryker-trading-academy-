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

export const TS_WS = 'wss://stream.tick-stream.xyz/v1/stream';
export const TS_SYMBOLS = ['NQ', 'ES'];   // MNQ / MES are separate books (different bid/ask), not worth the 2x frames
export const LEVELS = [20, 60, 150];
export const COARSE_RANGE = 0.004;        // +-0.4% of the mid: NQ ~ +-115 pts, ES ~ +-30 pts (the 400-level book spans less)
// Row step for the heatmap rows: the nice step at or below 0.01% of the price. NQ 28.7k -> 2.5, ES 7.6k -> 0.5.
export const coarseRule = (mid) => ({ step: nearNiceStep(mid * 0.0001), range: COARSE_RANGE });
export const TICK_SIZE = { NQ: 0.25, ES: 0.25 };

const DEF = {
  SYMBOLS: TS_SYMBOLS, RECORD: true, MODE: 'direct', MAX_CLIENTS: 40, KEEP_H: 48, MIN_GAP_MS: 250, FLUSH_MS: 250, COARSE_MS: 1000,
  SAMPLE_MS: 5000, BACK_MIN_MS: 2000, BACK_MAX_MS: 60000, STABLE_MS: 30000, DEAD_SLOT_MS: 50000, AUTH_PAUSE_MS: 300000,
  SILENT_MS: 50000, NODATA_MS: 120000, IDLE_MS: 60000, TOKEN_MS: 55 * 60000, RING: 3000, TICKS_PER_FRAME: 200, PRUNE_MS: 3600000
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

export class TSHub {
  // store = { putMin(sym, t, book: ArrayBuffer, imbJson, fpJson), prune(minuteIdx), range(sym, t0, t1) -> [{ t, book, imb, fp }] }
  constructor(store, key, opts = {}) {
    this.store = store; this.key = key; this.o = Object.assign({}, DEF, opts);
    this.WS = opts.WebSocket || globalThis.WebSocket; this.clock = opts.now || (() => Date.now());
    this.ws = null; this.state = 'idle'; this.clients = new Set(); this.latest = new Map(); this.rings = new Map(); this.seq = 0;
    this.acc = new Map(); this.nextSample = new Map(); this.timers = {}; this.retryN = 0; this.openedAt = 0; this.lastMsgAt = 0; this.lastDataAt = 0;
    this.nextAt = 0; this.pauseUntil = 0; this.lastError = ''; this.minWait = 0; this.noViewerSince = 0; this.lastPrune = 0;
    this.n = { connects: 0, frames: 0, ticks: 0, snaps: 0, coarse: 0, rows: 0, drops: 0, refused: 0, throttled: 0 };
    this.lastState = '';
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
      for (const channel of ['book', 'ticks']) { try { ws.send(JSON.stringify({ op: 'subscribe', channel, symbols: this.o.SYMBOLS })); } catch (e) {} }
      this.setState('open');
    });
    on('message', (ev) => { if (this.ws === ws) this.onRaw(ev && ev.data); });
    on('error', () => { try { ws.close(); } catch (e) {} });
    on('close', (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
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
    const ws = this.ws; this.ws = null; this.lastError = why || ''; this.setState('idle');
    try { if (ws) ws.close(1000, 'bye'); } catch (e) {}
  }
  drop(why, minWait = 0) { this.n.drops++; this.minWait = minWait; const ws = this.ws; this.ws = null; this.lastError = why; this.setState('idle'); try { if (ws) ws.close(); } catch (e) {} if (this.wantUp()) this.retryLater(minWait); }
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
      if (!this.o.SYMBOLS.includes(m.symbol)) continue;
      if (m.type === 'book') this.onBook(m, now);
      else if (m.type === 'tick') this.onTick(m, now);
    }
  }
  onBook(m, now) {
    if (!goodLevels(m.bids) || !goodLevels(m.asks)) return;
    this.n.frames++; this.lastDataAt = now;
    const prev = this.latest.get(m.symbol);
    this.latest.set(m.symbol, { bids: m.bids, asks: m.asks, imb: Number.isFinite(m.imbalance) ? m.imbalance : 0, ts: m.ts, at: now, ver: (prev ? prev.ver : 0) + 1, imb10: null, coarse: null, coarseAt: 0 });
    this.announce();
  }
  onTick(m, now) {
    if (!(m.price > 0) || !(m.size > 0)) return;
    const side = m.side === 'buy' ? 1 : m.side === 'sell' ? -1 : 0;
    if (!side) return;
    this.n.ticks++; this.lastDataAt = now;
    const ring = this.rings.get(m.symbol) || []; this.rings.set(m.symbol, ring);
    ring.push([++this.seq, m.price, m.size, side, now]);
    if (ring.length > this.o.RING) ring.splice(0, ring.length - this.o.RING);
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
      const s = bucketSnapshot({ bids: L.bids, asks: L.asks }, Math.floor(now / 1000) * 1000, coarseRule(mid));
      const a = this.accFor(sym, now);
      if (s && s.v.length) a.samples.push(s);
      a.imb.push([Math.floor(now / 1000), L.imb, this.imb10Of(L)]);
    }
    if (now - this.lastPrune > this.o.PRUNE_MS) { this.lastPrune = now; try { this.store.prune(Math.floor((now - this.o.KEEP_H * 3600000) / 60000)); } catch (e) {} }
  }
  imb10Of(L) { if (L.imb10 == null) L.imb10 = imbalance10(L.bids, L.asks); return L.imb10; }
  coarseOf(sym, now) {
    const L = this.latest.get(sym);
    if (!L) return null;
    if (L.coarse && now - L.coarseAt < this.o.COARSE_MS - 50) return L.coarse;
    const mid = L.bids.length && L.asks.length ? (L.bids[0][0] + L.asks[0][0]) / 2 : 0;
    const s = mid > 0 ? bucketSnapshot({ bids: L.bids, asks: L.asks }, now, coarseRule(mid)) : null;
    L.coarse = s ? { type: 'coarse', symbol: sym, ts: now, mid: s.mid, bb: s.bb, ba: s.ba, step: s.step, i0: s.i0, v: Array.from(s.v) } : null;
    L.coarseAt = now;
    return L.coarse;
  }

  // ---- clients
  // sock = { send(str), close(code, reason) }. -> handle { close(), onMessage(str) } or null (full)
  attach(sock, sym, levels) {
    if (this.clients.size >= this.o.MAX_CLIENTS) { this.n.refused++; return null; }
    const c = { sock, sym: null, levels: 60, errors: 0, sentVer: -1, lastSend: 0, lastCoarse: 0, lastSeq: this.seq, lastPing: 0, bornAt: this.clock() };
    this.clients.add(c);
    this.setSub(c, sym, levels);
    this.startTimer();
    this.send(c, JSON.stringify({ event: 'hub_attached', state: this.liveState(), symbols: this.o.SYMBOLS }));
    this.maintain();
    return {
      close: () => { this.clients.delete(c); },
      onMessage: (s) => {
        let m; try { m = JSON.parse(s); } catch (e) { return; }
        if (m && m.op === 'sub') this.setSub(c, m.symbol, m.levels);
      }
    };
  }
  setSub(c, sym, levels) {
    const s = String(sym || '').toUpperCase();
    if (this.o.SYMBOLS.includes(s) && s !== c.sym) { c.sym = s; c.sentVer = -1; c.lastCoarse = 0; c.lastSeq = this.seq; }
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
    this.announce();
    for (const c of [...this.clients]) {
      if (c.errors > 5) { this.clients.delete(c); continue; }
      if (c.bornAt && now - c.bornAt >= this.o.TOKEN_MS) { try { c.sock.close(4401, 'token'); } catch (e) {} this.clients.delete(c); continue; }   // the browser reconnects with a fresh token
      if (!c.sym) continue;
      if (now - c.lastPing >= 5000) { c.lastPing = now; this.send(c, JSON.stringify({ event: 'ping', up: this.lastDataAt ? now - this.lastDataAt : -1, state: this.liveState(now) })); }
      if (now - c.lastSend < this.o.MIN_GAP_MS - 20) { this.n.throttled++; continue; }
      const L = this.latest.get(c.sym);
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
      cmeOpen: cmeOpen(now), recording: this.o.RECORD, clients: this.clients.size, symbols: this.o.SYMBOLS, upstreamSockets: this.ws ? 1 : 0,
      lastDataAgoMs: this.lastDataAt ? now - this.lastDataAt : null, retryN: this.retryN, nextRetryInMs: this.timers.retry ? Math.max(0, this.nextAt - now) : 0,
      lastError: this.lastError, keepHours: this.o.KEEP_H, ...this.n
    };
  }
  shutdown() { for (const k of Object.keys(this.timers)) if (this.timers[k]) { clearTimeout(this.timers[k]); clearInterval(this.timers[k]); this.timers[k] = null; } try { if (this.ws) this.ws.close(); } catch (e) {} this.ws = null; }

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
    putMin(sym, t, book, imb, fp) { sql.exec('INSERT OR REPLACE INTO tsmin (sym, t, book, imb, fp) VALUES (?, ?, ?, ?, ?)', sym, t, book, imb, fp); },
    prune(t) { sql.exec('DELETE FROM tsmin WHERE t < ?', t); },
    range(sym, t0, t1) { return sql.exec('SELECT t, book, imb, fp FROM tsmin WHERE sym = ? AND t >= ? AND t <= ? ORDER BY t', sym, t0, t1).toArray(); }
  };
}
const SOCK_LIMIT = 256;
export async function tsHubFetch(hub, env, u, req) {
  if (!hub.key && hub.o.MODE === 'direct') hub.key = env.TICKSTREAM_API_KEY || '';
  hub.poke();
  if (u.pathname === '/ts-stats') return Response.json(hub.stats());
  if (u.pathname === '/ts-ingest') {
    if (hub.o.MODE !== 'relay') return new Response('relay mode is off', { status: 409 });
    let b; try { b = await req.json(); } catch (e) { return new Response('bad json', { status: 400 }); }
    hub.feed(Array.isArray(b && b.frames) ? b.frames.slice(0, 200) : []);
    return Response.json({ want: hub.wanted(), clients: hub.clients.size });
  }
  if (u.pathname === '/ts-book-history' || u.pathname === '/ts-aux') {
    const sym = String(u.searchParams.get('symbol') || '').toUpperCase();
    if (!hub.o.SYMBOLS.includes(sym)) return new Response('symbol not recorded', { status: 404 });
    const now = Date.now(), to = Math.min(now + 60000, Number(u.searchParams.get('to')) || now), from = Math.max(to - hub.o.KEEP_H * 3600000, Number(u.searchParams.get('from')) || to - 3600000);
    if (u.pathname === '/ts-aux') return Response.json(hub.aux(sym, from, to));
    return new Response(hub.bookHistory(sym, from, to), { headers: { 'content-type': 'application/octet-stream' } });
  }
  if (req.headers.get('upgrade') !== 'websocket') return new Response('websocket required', { status: 426 });
  if (hub.o.MODE === 'direct' && !hub.key) return new Response('feed not configured', { status: 503 });
  const pair = new WebSocketPair(), client = pair[0], server = pair[1];
  server.accept();
  const sock = { send: (s) => server.send(s), close: (c, r) => { try { server.close(c, r); } catch (e) {} } };
  const h = hub.attach(sock, u.searchParams.get('symbol'), u.searchParams.get('levels'));
  const proto = String(req.headers.get('sec-websocket-protocol') || '').includes('tz-auth') ? { 'sec-websocket-protocol': 'tz-auth' } : {};
  if (!h) { server.send(JSON.stringify({ event: 'hub_full' })); server.close(1013, 'hub full'); return new Response(null, { status: 101, webSocket: client, headers: proto }); }
  server.addEventListener('message', (ev) => { if (typeof ev.data === 'string' && ev.data.length <= SOCK_LIMIT) h.onMessage(ev.data); });
  server.addEventListener('close', () => h.close());
  server.addEventListener('error', () => h.close());
  return new Response(null, { status: 101, webSocket: client, headers: proto });
}
