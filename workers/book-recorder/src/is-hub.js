// ONE InsightSentry realtime socket for the whole site (2026-10-22 P0, Owner "chart froze").
//
// WHY: InsightSentry emailed the Owner at 17:47 UTC: "Realtime requests slowed ... Current window: 141 requests
// (limit: 120). IP 162.159.122.116" (a Cloudflare egress IP = our Pages Functions). Every admin chart socket
// (/api/chart/stream) opened its OWN upstream socket + subscription message, every client stall-watchdog reopen
// (10 s NQ/ES) opened another, and admin /api/chart/bars requests opened per-request sockets for the tail
// (RTY, 2h/4h, recorder-tail failures). Once IS started delaying us, the delays caused stalls, the stalls caused
// reconnects, and the reconnects counted against the same window: a reconnect storm. The 2026-10-20 attempt at a
// shared socket per Worker ISOLATE failed for the same reason (Pages runs many isolates, each opened its own).
//
// NOW: the hub runs inside the book-recorder's single Durable Object instance (BookRecorder, idFromName('main')), so
// there is exactly one upstream socket for every viewer on every edge. Pages /api/chart/stream connects HERE (through
// the Worker's /is-live route, admin token re-verified), never to InsightSentry. A client reconnect only touches the DO.
// Key: Worker secret INSIGHTSENTRY_WEBSOCKET_API_KEY (set by .github/workflows/deploy-book-recorder.yml from the repo
// secret of the same name; never logged, never sent anywhere but InsightSentry).
//
// InsightSentry rules this follows (insightsentry.com/docs/ws):
//  - <= 120 subscription messages / 3 h; frequent reconnects are throttled the same way -> every connect and
//    every subscription message is logged (persisted in DO storage, survives eviction) and exposed by stats().
//  - a subscription message REPLACES the set: the full set of legs is sent, only when a leg is NEW (dedupe), at
//    most one message per SEND_GAP_MS (60 s once the 3 h window passes BRAKE_AT), and never while one is pending.
//  - 5 subscriptions per socket (subscription_limit_exceeded at 6, measured 2026-10-14): MAX_LEGS = 5; an idle leg
//    is evicted for a new one, a 6th ACTIVE leg is refused (the client then polls REST).
//  - reconnect: exponential backoff with jitter, 5 s doubling to 2 min; the counter only resets after the socket
//    has stayed up STABLE_MS; reconnect_throttled / wait_and_retry keep the socket (the request resumes itself).
//
// Client protocol (WebSocket from the Pages Function): GET /is-live?legs=CODE|bar_type|interval;... -> messages:
//   raw InsightSentry series messages for the client's legs ({code, bar_type, series}), {event:'ping', up, state}
//   every 5 s (up = ms since the last upstream message), {event:'hub_down'} / {event:'hub_rejected'} /
//   {event:'hub_full'}. A new client first gets the leg's cached rows (no upstream message needed).

export const IS_WS = 'wss://realtime.insightsentry.com/live';
export const IS_LIMIT = 120;                 // per 3 h window (InsightSentry docs + the 2026-10-22 email)
const WINDOW_MS = 3 * 3600e3;
const DEF = {
  MAX_LEGS: 5, LEG_IDLE_MS: 180000, SEND_GAP_MS: 10000, BRAKE_AT: 60, BRAKE_GAP_MS: 60000, HARD_AT: 100,
  BACK_MIN_MS: 5000, BACK_MAX_MS: 120000, STABLE_MS: 60000, PING_MS: 5000, PENDING_MS: 8000,
  STALE_MS: 180000, STALE_MAX_MS: 1800000, ROW_CAP: 1200, REPLAY: 300
};
const UNIT = { m: 'minute', min: 'minute', minute: 'minute', h: 'hour', hour: 'hour', s: 'second', sec: 'second', second: 'second', t: 'tick', tick: 'tick', d: 'day', day: 'day' };
const DP = { minute: 1000, hour: 500, second: 300, tick: 1 };

export const legId = (s) => s.code + '|' + s.bar_type + '|' + s.bar_interval;
// "CME_MINI:NQ1!|minute|1;CME_MINI:NQ1!|tick|1" -> [{code, bar_type, bar_interval}] (null = invalid)
export function parseLegs(q) {
  const out = [];
  for (const part of String(q || '').split(';').filter(Boolean)) {
    const [code, bt, iv] = part.split('|');
    const n = Number(iv);
    if (!/^[A-Z_]{2,16}:[A-Z0-9!]{1,12}$/.test(code || '') || !DP[bt] || !Number.isInteger(n) || n < 1 || n > 100000) return null;
    out.push({ code, bar_type: bt, bar_interval: n });
  }
  return out.length && out.length <= 2 ? out : null;
}

export class ISHub {
  constructor(storage, key, opts = {}) {
    this.storage = storage; this.key = key; this.o = Object.assign({}, DEF, opts);
    this.WS = opts.WebSocket || globalThis.WebSocket;
    this.ws = null; this.state = 'idle'; this.legs = new Map(); this.clients = new Set();
    this.lastSent = new Set(); this.dirty = false; this.pendingAt = 0; this.lastSendAt = 0;
    this.retryN = 0; this.nextAt = 0; this.openedAt = 0; this.lastMsgAt = 0; this.staleN = 0;
    this.timers = {}; this.log = null; this.stats0 = { throttled: 0, errors: 0, evicted: 0, refused: 0, attaches: 0 };
    this.lastError = '';
  }

  // ---- request log (connects 'c', subscription messages 'm'), persisted so an evicted DO keeps its count
  async loadLog() {
    if (this.log) return;
    let l = null;
    try { l = this.storage && (await this.storage.get('isLog')); } catch (e) {}
    if (!this.log) this.log = Array.isArray(l) ? l : [];
  }
  note(kind) {
    if (!this.log) this.log = [];
    const now = Date.now();
    this.log.push([now, kind]);
    while (this.log.length && now - this.log[0][0] > WINDOW_MS) this.log.shift();
    try { if (this.storage) this.storage.put('isLog', this.log); } catch (e) {}
  }
  // HARD BUDGET: at HARD_AT requests in the 3 h window nothing new goes upstream (no connect, no new subscription
  // message) until the oldest entries age out. Charts then run on the REST tail (recorder) instead of pushing IS
  // past its limit. Returns ms to wait (0 = within budget).
  budgetWait() {
    const log = this.log || [], now = Date.now();
    const live = log.filter((e) => now - e[0] <= WINDOW_MS);
    if (live.length < this.o.HARD_AT) return 0;
    return Math.max(1000, live[live.length - this.o.HARD_AT][0] + WINDOW_MS - now + 1000);
  }
  windowCount(ms = WINDOW_MS) { const now = Date.now(); return (this.log || []).filter((e) => now - e[0] <= ms).length; }
  stats() {
    const now = Date.now(), log = (this.log || []).filter((e) => now - e[0] <= WINDOW_MS);
    const c = (ms, k) => log.filter((e) => now - e[0] <= ms && e[1] === k).length;
    const perMin = [];
    for (let i = 14; i >= 0; i--) {
      const a = Math.floor(now / 60000) * 60000 - i * 60000;
      perMin.push({ t: a / 1000, c: log.filter((e) => e[0] >= a && e[0] < a + 60000 && e[1] === 'c').length, m: log.filter((e) => e[0] >= a && e[0] < a + 60000 && e[1] === 'm').length });
    }
    return {
      v: 1, at: Math.floor(now / 1000), state: this.state, upstreamSockets: this.ws ? 1 : 0,
      window3h: log.length, limit3h: IS_LIMIT, brake: log.length >= this.o.BRAKE_AT,
      connects: { m1: c(60000, 'c'), m15: c(900000, 'c'), h3: c(WINDOW_MS, 'c') },
      messages: { m1: c(60000, 'm'), m15: c(900000, 'm'), h3: c(WINDOW_MS, 'm') },
      perMin, legs: [...this.legs.values()].map((l) => ({ id: legId(l.spec), clients: l.clients.size, rows: l.rows.size })),
      clients: this.clients.size, lastMsgAgoMs: this.lastMsgAt ? now - this.lastMsgAt : null,
      retryN: this.retryN, nextRetryInMs: this.timers.retry ? Math.max(0, this.nextAt - now) : 0,
      lastError: this.lastError, ...this.stats0
    };
  }

  // ---- clients
  // client = { send(str), close(code, reason) }; returns a handle with close() or null (no room for the legs)
  attach(specs, client) {
    this.stats0.attaches++;
    const ids = [];
    for (const s of specs) {
      const id = legId(s);
      if (!this.legs.has(id)) {
        if (this.legs.size >= this.o.MAX_LEGS) {
          let victim = null;
          for (const [i, l] of this.legs) if (!l.clients.size && (!victim || l.idleSince < this.legs.get(victim).idleSince)) victim = i;
          // 2026-10-29 P0 (Owner: "candles not moving only timer"): five busy legs (NQ tick + NQ 1m/5m/30m + MNQ 5m) left
          // no room for MNQ 1m, so the Owner's chart got hub_full for hours. A SERIES leg may now take the slot of a busy
          // TICK leg (the per-trade extra; its clients keep their series bars and just lose the tick fold). A tick leg
          // never evicts anything. Among tick legs the one with the fewest viewers goes.
          if (!victim && s.bar_type !== 'tick') {
            for (const [i, l] of this.legs) if (l.spec.bar_type === 'tick' && (!victim || l.clients.size < this.legs.get(victim).clients.size)) victim = i;
            if (victim) this.stats0.preempted = (this.stats0.preempted || 0) + 1;
          }
          if (!victim) { this.stats0.refused++; for (const i of ids) this.release(i, null); return null; }
          this.legs.delete(victim);   // still in the upstream set until the next message; harmless
        }
        this.legs.set(id, { spec: { code: s.code, bar_type: s.bar_type, bar_interval: s.bar_interval }, clients: new Set(), rows: new Map(), meta: null, idleSince: Date.now(), noCache: s.bar_type === 'tick' });
      }
      ids.push(id);
    }
    const c = { client, ids, primed: new Set(), errors: 0 };
    this.clients.add(c);
    for (const id of ids) {
      const L = this.legs.get(id);
      L.clients.add(c);
      if (!L.noCache && L.rows.size && L.meta) {   // cached rows first: no upstream message for a known leg
        const rows = [...L.rows.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
        this.give(c, L, L.meta, rows, id);
      }
    }
    if (ids.some((id) => !this.lastSent.has(id))) this.dirty = true;
    this.startPing();
    if (!this.ws && !this.timers.retry) this.connect();
    else this.trySend();
    return { close: () => { if (!this.clients.delete(c)) return; for (const id of ids) this.release(id, c); } };
  }
  release(id, c) {
    const L = this.legs.get(id);
    if (!L) return;
    if (c) L.clients.delete(c);
    if (!L.clients.size) { L.idleSince = Date.now(); this.schedulePrune(); }
  }
  give(c, L, meta, rows, id) {
    let out = rows;
    if (!L.noCache) {
      if (!c.primed.has(id)) out = rows.slice(-this.o.REPLAY);
      else if (rows.length > 2) out = rows.slice(-2);
    }
    c.primed.add(id);
    try { c.client.send(JSON.stringify(Object.assign({}, meta, { series: out }))); } catch (e) { c.errors++; }
  }
  broadcast(obj) { const s = JSON.stringify(obj); for (const c of this.clients) { try { c.client.send(s); } catch (e) { c.errors++; } } }
  startPing() {
    if (this.timers.ping) return;
    const tick = () => {
      this.timers.ping = null;
      if (!this.clients.size) return;
      for (const c of [...this.clients]) if (c.errors > 5) { this.clients.delete(c); for (const id of c.ids) this.release(id, c); }
      this.broadcast({ event: 'ping', up: this.lastMsgAt ? Date.now() - this.lastMsgAt : -1, state: this.state });
      this.timers.ping = setTimeout(tick, this.o.PING_MS);
    };
    this.timers.ping = setTimeout(tick, this.o.PING_MS);
  }

  // ---- upstream
  active() {
    const now = Date.now(), out = [];
    for (const [id, l] of this.legs) if (l.clients.size || now - l.idleSince < this.o.LEG_IDLE_MS) out.push([id, l]);
    return out;
  }
  connect() {
    if (this.ws || !this.key || typeof this.WS !== 'function') return;
    if (!this.clients.size) return;
    const bw = this.budgetWait();
    if (bw) { this.state = 'paused'; this.lastError = 'own budget: ' + this.windowCount() + '/3h'; this.broadcast({ event: 'hub_paused', ms: bw }); this.nextAt = Date.now() + bw; this.timers.retry = setTimeout(() => { this.timers.retry = null; if (this.clients.size) this.connect(); }, bw); return; }
    let ws;
    this.note('c');
    try { ws = new this.WS(IS_WS); } catch (e) { this.lastError = 'connect: ' + String(e && e.message || e).slice(0, 60); this.retryLater(); return; }
    this.ws = ws; this.state = 'connecting'; this.lastSent = new Set(); this.pendingAt = 0;
    const on = (ev, fn) => { if (ws.addEventListener) ws.addEventListener(ev, fn); else ws['on' + ev] = fn; };
    on('open', () => { if (this.ws !== ws) return; this.state = 'open'; this.openedAt = this.lastMsgAt = Date.now(); this.dirty = true; this.trySend(true); });
    on('message', (ev) => { if (this.ws === ws) this.onUpstream(ev); });
    on('error', () => { try { ws.close(); } catch (e) {} });
    on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null; this.state = 'idle'; this.pendingAt = 0;
      for (const c of this.clients) c.primed.clear();
      this.broadcast({ event: 'hub_down' });
      if (this.clients.size) this.retryLater();
    });
    this.startWatch();
  }
  drop(why, minWait = 0) {
    const ws = this.ws; this.ws = null; this.state = 'idle'; this.pendingAt = 0;
    this.lastError = why;
    try { if (ws) ws.close(); } catch (e) {}
    for (const c of this.clients) c.primed.clear();
    this.broadcast({ event: 'hub_down' });
    if (this.clients.size) this.retryLater(minWait);
  }
  backoff(minWait = 0) {
    this.retryN++;
    const base = Math.min(this.o.BACK_MAX_MS, this.o.BACK_MIN_MS * Math.pow(2, Math.min(this.retryN - 1, 10)));
    let wait = Math.max(minWait, base * (0.75 + Math.random() * 0.5));
    if (this.windowCount() >= this.o.BRAKE_AT) wait = Math.max(wait, this.o.BRAKE_GAP_MS);
    return Math.min(Math.max(wait, this.o.BACK_MIN_MS), Math.max(this.o.BACK_MAX_MS, minWait));
  }
  retryLater(minWait = 0) {
    if (this.timers.retry) return;
    const wait = this.backoff(minWait);
    this.nextAt = Date.now() + wait;
    this.timers.retry = setTimeout(() => { this.timers.retry = null; if (this.clients.size) this.connect(); }, wait);
  }
  trySend(initial = false) {
    if (this.timers.send) return;
    if (!this.dirty || this.state !== 'open' || !this.ws) return;
    const act = this.active();
    if (!act.length) { this.dirty = false; return; }
    if (!initial && act.every(([id]) => this.lastSent.has(id))) { this.dirty = false; return; }   // dedupe: nothing new
    const now = Date.now();
    if (!initial && this.budgetWait()) {   // over our own budget: no new legs upstream; their clients poll REST
      for (const [id, l] of act) if (!this.lastSent.has(id)) for (const c of l.clients) { try { c.client.send(JSON.stringify({ event: 'hub_full' })); } catch (e) {} }
      this.dirty = false; return;
    }
    const gap = this.windowCount() >= this.o.BRAKE_AT ? this.o.BRAKE_GAP_MS : this.o.SEND_GAP_MS;
    let wait = 0;
    if (!initial && this.lastSendAt && now - this.lastSendAt < gap) wait = gap - (now - this.lastSendAt);
    if (this.pendingAt && now - this.pendingAt < this.o.PENDING_MS) wait = Math.max(wait, this.o.PENDING_MS - (now - this.pendingAt));
    this.timers.send = setTimeout(() => {
      this.timers.send = null;
      if (!this.dirty || this.state !== 'open' || !this.ws) return;
      const a = this.active().slice(0, this.o.MAX_LEGS);
      if (!a.length) { this.dirty = false; return; }
      const subs = a.map(([, l]) => ({ code: l.spec.code, type: 'series', bar_type: l.spec.bar_type, bar_interval: l.spec.bar_interval, dp: DP[l.spec.bar_type], '24h': true }));
      this.dirty = false; this.pendingAt = this.lastSendAt = Date.now();
      this.lastSent = new Set(a.map(([id]) => id));
      this.note('m');
      try { this.ws.send(JSON.stringify({ api_key: this.key, slow_consumer_policy: 'adaptive', subscriptions: subs })); } catch (e) { this.drop('send failed'); }
    }, Math.max(wait, initial ? 0 : 150));
  }
  match(msg) {
    const legs = [...this.legs.entries()];
    const byCode = msg.code == null ? legs : legs.filter(([, l]) => l.spec.code === msg.code);
    if (byCode.length === 1) return byCode[0];
    const m = /^(\d+)\s*([a-z]+)$/.exec(String(msg.bar_type || '').toLowerCase());
    if (m) { const u = UNIT[m[2]], n = Number(m[1]); const hit = byCode.find(([, l]) => l.spec.bar_type === u && Number(l.spec.bar_interval) === n); if (hit) return hit; }
    return null;
  }
  onUpstream(ev) {
    let msg;
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)); } catch (e) { return; }
    const now = Date.now();
    this.lastMsgAt = now; this.staleN = 0;
    if (this.openedAt && now - this.openedAt > this.o.STABLE_MS) this.retryN = 0;   // reset only after a stable window
    const rows = msg && (Array.isArray(msg.series) ? msg.series : Array.isArray(msg.data) ? msg.data : Array.isArray(msg.bars) ? msg.bars : null);
    if (!rows) return this.onEvent(msg || {});
    const hit = this.match(msg);
    if (!hit) { this.stats0.unmatched = (this.stats0.unmatched || 0) + 1; return; }
    const [id, L] = hit;
    const clean = [];
    for (const x of rows) {
      if (!x || typeof x !== 'object') continue;
      clean.push(x);
      if (!L.noCache) { const t = Number(x.time ?? x.t ?? x.timestamp ?? x.bar_time ?? x.start); if (Number.isFinite(t)) L.rows.set(t, x); }
    }
    if (!L.noCache && L.rows.size > this.o.ROW_CAP) { const ks = [...L.rows.keys()].sort((a, b) => a - b); for (let i = 0; i < ks.length - this.o.ROW_CAP; i++) L.rows.delete(ks[i]); }
    L.meta = Object.assign({}, msg); delete L.meta.series; delete L.meta.data; delete L.meta.bars;
    for (const c of L.clients) this.give(c, L, msg, clean, id);
  }
  onEvent(msg) {
    const ev = String(msg.event || ''), err = String(msg.error || ''), action = String(msg.action || '');
    const text = (ev + ' ' + err + ' ' + String(msg.message || '')).toLowerCase();
    if (ev === 'subscription_status') { this.pendingAt = 0; this.trySend(); return; }
    if (ev === 'connection_status') return;
    if (ev === 'delivery_status') { this.broadcast(msg); return; }
    if (!err && !/error|reject|evict/.test(ev)) return;
    this.stats0.errors++;
    this.lastError = (err || ev).slice(0, 60) + (action ? ' / ' + action.slice(0, 40) : '');
    if (/throttl/.test(text) || action === 'wait_and_retry') { this.stats0.throttled++; return; }   // keep the socket: it resumes itself
    this.pendingAt = 0;
    if (ev === 'connection_evicted' || /evicted/.test(text)) { this.stats0.evicted++; return this.drop('evicted', 30000); }
    if (/max_connection/.test(text)) return this.drop('max_connection_reached', 60000);
    if (/invalid|unauthori[sz]ed|expired|subscription_expired|websocket_access_required/.test(text)) { this.broadcast({ event: 'hub_rejected' }); return this.drop('rejected', 300000); }
    if (/subscription_limit/.test(text)) { this.broadcast({ event: 'hub_full' }); return; }
    if (action === 'reconnect' || action === 'reconnect_after_fixing_consumer') return this.drop(err || 'reconnect asked', 0);
    if (action === 'retry_request') { this.dirty = true; this.lastSent = new Set(); const t = this.backoff(); this.retryN = Math.max(0, this.retryN - 1); setTimeout(() => this.trySend(), t); }
  }
  // No message at all for STALE_MS (doubling to STALE_MAX_MS while it stays quiet: a closed market) -> new socket.
  startWatch() {
    if (this.timers.watch) return;
    const tick = () => {
      this.timers.watch = null;
      if (!this.clients.size && !this.ws) return;
      const limit = Math.min(this.o.STALE_MAX_MS, this.o.STALE_MS * Math.pow(2, this.staleN));
      if (this.state === 'open' && Date.now() - this.lastMsgAt > limit) { this.staleN++; this.lastMsgAt = Date.now(); this.drop('stale'); }
      this.timers.watch = setTimeout(tick, 15000);
    };
    this.timers.watch = setTimeout(tick, 15000);
  }
  schedulePrune() {
    if (this.timers.prune) return;
    this.timers.prune = setTimeout(() => {
      this.timers.prune = null;
      const now = Date.now();
      for (const [id, l] of this.legs) if (!l.clients.size && now - l.idleSince >= this.o.LEG_IDLE_MS) this.legs.delete(id);
      if (!this.legs.size && !this.clients.size) {
        const ws = this.ws; this.ws = null; this.state = 'idle';
        try { if (ws) ws.close(); } catch (e) {}
        for (const k of ['watch', 'retry', 'send']) if (this.timers[k]) { clearTimeout(this.timers[k]); this.timers[k] = null; }
      } else if ([...this.legs.values()].some((l) => !l.clients.size)) this.schedulePrune();
    }, this.o.LEG_IDLE_MS + 1000);
  }
  shutdown() { for (const k of Object.keys(this.timers)) if (this.timers[k]) clearTimeout(this.timers[k]); try { if (this.ws) this.ws.close(); } catch (e) {} this.ws = null; }
}

// ---- request handling inside the BookRecorder Durable Object (src/index.js routes /is-live and /is-stats here).
// The hub lives in the SAME single DO instance as the recorder (idFromName('main')), which the feeders keep awake
// anyway: no second always-on Durable Object (free-tier duration), no new binding or migration.
export async function isHubFetch(hub, env, u, req) {
  await hub.loadLog();
  if (!hub.key) hub.key = env.INSIGHTSENTRY_WEBSOCKET_API_KEY || '';
  if (u.pathname === '/is-stats') return Response.json(Object.assign(hub.stats(), { configured: !!hub.key }));
  if (req.headers.get('upgrade') !== 'websocket') return new Response('websocket required', { status: 426 });
  const legs = parseLegs(u.searchParams.get('legs'));
  if (!legs) return new Response('bad legs', { status: 400 });
  if (!hub.key) return new Response('feed not configured', { status: 503 });
  const pair = new WebSocketPair(), client = pair[0], server = pair[1];
  server.accept();
  let closed = false;
  const sock = { send: (s) => { if (!closed) server.send(s); }, close: (c, r) => { try { server.close(c, r); } catch (e) {} } };
  // both legs, else the series leg alone (no tick leg), else refused: the browser polls the REST tail
  const h = hub.attach(legs, sock) || (legs.length > 1 ? hub.attach([legs[0]], sock) : null);
  if (!h) { server.send(JSON.stringify({ event: 'hub_full' })); server.close(1013, 'hub full'); return new Response(null, { status: 101, webSocket: client }); }
  server.send(JSON.stringify({ event: 'hub_attached', state: hub.state }));
  const end = () => { if (closed) return; closed = true; try { h.close(); } catch (e) {} };
  server.addEventListener('close', end);
  server.addEventListener('error', end);
  return new Response(null, { status: 101, webSocket: client });
}
