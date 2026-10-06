// Stryker Trading Academy — Rithmic R|Protocol browser client (ES module)
// Depends on: assets/rithmic-proto.js (hand-rolled protobuf codec + template ids).
// Imported by assets/rithmic-provider.js and assets/rithmic-ui.js; never loaded unless the
// `rithmicEnabled` flag is on for the member (assets/rithmic-config.js).
//
// The member's browser opens WebSockets straight to Rithmic's gateway: one TICKER_PLANT
// session (live trades + best bid/offer, front-month lookup) and one HISTORY_PLANT session
// (time-bar replay). Nothing goes through Stryker's servers.
//
// CREDENTIALS: the username and password are held in this object's private fields, in
// memory only, for as long as the member stays connected (they are needed to log back in
// after a dropped connection). They are never logged, never put in an event, never written
// to localStorage / sessionStorage / IndexedDB / Firestore, and are wiped by disconnect().
//
// Message flow (R|Protocol):
//   1. listSystems(): open, RequestRithmicSystemInfo (16) -> ResponseRithmicSystemInfo (17), close.
//   2. per plant: open, RequestLogin (10, infra_type, app_name, app_version, system_name)
//      -> ResponseLogin (11; rp_code[0] === '0' is success, heartbeat_interval in seconds).
//   3. RequestHeartbeat (18) at the server's interval while the socket is otherwise idle.
//   4. ticker: RequestFrontMonthContract (113 -> 114), RequestMarketDataUpdate (100 -> 101),
//      then a stream of LastTrade (150) and BestBidOffer (151).
//   5. history: RequestTimeBarReplay (202) -> many ResponseTimeBarReplay (203) bars, then a
//      final 203 carrying rp_code (end of the answer).
//   6. RequestLogout (12) before closing. ForcedLogout (77) from Rithmic ends the session
//      without reconnecting.

import { T, INFRA, UPDATE_BITS, MD_REQUEST, BAR_TYPE, DIRECTION, TIME_ORDER, encode, decode } from './rithmic-proto.js?v=442';

const REPLAY_PAGE_MAX = 10000;       // bars per RequestTimeBarReplay answer (Rithmic caps a page)
const RECONNECT_STEPS = [1000, 2000, 5000, 10000, 20000, 30000];
const REQUEST_TIMEOUT = 20000;

let seq = 0;
const nextId = () => 'stk' + (++seq).toString(36) + Date.now().toString(36).slice(-4);

function rpOk(msg) { return !msg.rp_code || !msg.rp_code.length || msg.rp_code[0] === '0'; }
function rpText(msg) {
  const c = msg.rp_code || [];
  return c.length > 1 ? c.slice(1).join(' ') : (c[0] ? 'code ' + c[0] : 'rejected');
}

// Open one socket, resolve when it is open (binary frames as ArrayBuffer).
function openSocket(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
    ws.binaryType = 'arraybuffer';
    const t = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('Rithmic did not answer in time')); }, timeoutMs);
    ws.onopen = () => { clearTimeout(t); resolve(ws); };
    ws.onerror = () => { clearTimeout(t); reject(new Error('Could not reach Rithmic')); };
  });
}

// System names offered by a gateway (no login needed).
export async function listSystems(gateway) {
  const ws = await openSocket(gateway);
  try {
    return await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('No system list from Rithmic')), REQUEST_TIMEOUT);
      ws.onmessage = (e) => {
        const m = decode(e.data);
        if (m.template_id !== T.SYSTEM_INFO_R) return;
        clearTimeout(t);
        if (!rpOk(m)) reject(new Error(rpText(m))); else resolve((m.system_name || []).slice());
      };
      ws.onclose = () => { clearTimeout(t); reject(new Error('Rithmic closed the connection')); };
      ws.send(encode({ template_id: T.SYSTEM_INFO, user_msg: ['systems'] }));
    });
  } finally {
    ws.onclose = null;
    try { ws.close(1000); } catch (e) {}
  }
}

// One logged-in R|Protocol session (a "plant").
class Plant {
  constructor(owner, infra) {
    this.owner = owner;
    this.infra = infra;
    this.ws = null;
    this.hbTimer = null;
    this.hbSecs = 30;
    this.lastSend = 0;
    this.pending = new Map(); // user_msg id -> { tid, resolve, reject, rows, timer, onRow }
    this.closing = false;
  }

  async open(creds) {
    const ws = await openSocket(this.owner.cfg.gateway);
    this.ws = ws;
    this.closing = false;
    ws.onmessage = (e) => this.onFrame(e.data);
    ws.onclose = () => this.onClose();
    const res = await this.request({
      template_id: T.LOGIN,
      template_version: this.owner.cfg.templateVersion || '5.55',
      user: creds.user,
      password: creds.password,
      app_name: this.owner.cfg.appName,
      app_version: String(this.owner.cfg.appVersion || '0'),
      system_name: creds.systemName,
      infra_type: this.infra,
      os_platform: 'browser'
    }, T.LOGIN_R);
    if (res.heartbeat_interval > 0) this.hbSecs = res.heartbeat_interval;
    this.send({ template_id: T.HEARTBEAT });
    this.startHeartbeat();
    return res;
  }

  startHeartbeat() {
    clearInterval(this.hbTimer);
    // Rithmic expects a heartbeat whenever the client has sent nothing for the interval.
    const every = Math.max(1, this.hbSecs) * 1000;
    this.hbTimer = setInterval(() => {
      if (Date.now() - this.lastSend >= every * 0.8) this.send({ template_id: T.HEARTBEAT });
    }, Math.max(500, every / 3));
  }

  send(msg) {
    if (!this.ws || this.ws.readyState !== 1) throw new Error('Not connected to Rithmic');
    this.ws.send(encode(msg));
    this.lastSend = Date.now();
  }

  // Single-answer request (the answer echoes our user_msg id).
  request(msg, replyTid) {
    return new Promise((resolve, reject) => {
      const id = nextId();
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Rithmic timed out')); }, REQUEST_TIMEOUT);
      this.pending.set(id, { tid: replyTid, resolve, reject, timer, multi: false });
      try { this.send({ ...msg, user_msg: [id] }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }

  // Multi-row request (time-bar replay): rows until the closing message with rp_code.
  stream(msg, replyTid) {
    return new Promise((resolve, reject) => {
      const id = nextId();
      const rows = [];
      const arm = () => setTimeout(() => { this.pending.delete(id); reject(new Error('Rithmic history timed out')); }, REQUEST_TIMEOUT);
      const p = { tid: replyTid, resolve, reject, timer: arm(), multi: true, rows, arm };
      this.pending.set(id, p);
      try { this.send({ ...msg, user_msg: [id] }); } catch (e) { clearTimeout(p.timer); this.pending.delete(id); reject(e); }
    });
  }

  onFrame(data) {
    let m;
    try { m = decode(data); } catch (e) { return; }
    const tid = m.template_id;
    if (tid === T.HEARTBEAT_R) return;
    if (tid === T.LAST_TRADE || tid === T.BBO) { this.owner._onMarket(m); return; }
    if (tid === T.FORCED_LOGOUT) { this.owner._onForcedLogout(); return; }
    // Rithmic echoes user_msg, which carries our request id. Fallback: the oldest pending
    // request waiting for this template (in case a gateway does not echo it).
    let id = m.user_msg && m.user_msg[0];
    if (!id || !this.pending.has(id)) {
      id = null;
      for (const [k, q] of this.pending) { if (q.tid === tid || tid === T.REJECT) { id = k; break; } }
    }
    const p = id && this.pending.get(id);
    if (!p) return;
    if (tid === T.REJECT) {
      clearTimeout(p.timer); this.pending.delete(id); p.reject(new Error('Rithmic rejected the request: ' + rpText(m))); return;
    }
    if (tid !== p.tid) return;
    if (!p.multi) {
      clearTimeout(p.timer); this.pending.delete(id);
      if (rpOk(m)) p.resolve(m); else p.reject(new Error(rpText(m)));
      return;
    }
    // Replay: data rows carry no rp_code; the last message carries rp_code (['0'] = done).
    const hasRp = (m.rp_code && m.rp_code.length) || false;
    if (!hasRp) { p.rows.push(m); clearTimeout(p.timer); p.timer = p.arm(); return; }
    clearTimeout(p.timer); this.pending.delete(id);
    if (m.rp_code[0] === '0' || m.rp_code[0] === '7') p.resolve(p.rows); // 7 = no data
    else p.reject(new Error(rpText(m)));
  }

  failPending(err) {
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(err); this.pending.delete(id); }
  }

  onClose() {
    clearInterval(this.hbTimer);
    this.ws = null;
    this.failPending(new Error('Connection to Rithmic closed'));
    if (!this.closing) this.owner._onPlantDropped(this);
  }

  async close(logout) {
    this.closing = true;
    clearInterval(this.hbTimer);
    const ws = this.ws;
    if (!ws) return;
    if (logout && ws.readyState === 1) {
      try { await Promise.race([this.request({ template_id: T.LOGOUT }, T.LOGOUT_R), new Promise((r) => setTimeout(r, 1500))]); } catch (e) {}
    }
    try { ws.close(1000); } catch (e) {}
    this.ws = null;
    this.failPending(new Error('Disconnected'));
  }
}

// Calendar fallback for the front-month contract, used when RequestFrontMonthContract has no
// answer (Rithmic Test answered rp_code ["7","no data"] for every root on 2026-10-05, and
// async_rithmic notes the same during maintenance windows). Rithmic's symbol format is
// ROOT + month code + ONE year digit (NQZ6, ESZ6: confirmed by replay on Rithmic Test).
// Roll dates are approximate (the usual volume roll a few days before expiry), and this only
// matters when Rithmic itself can't say.
const MONTH_CODES = 'FGHJKMNQUVXZ';
const CYCLES = {
  quarterly: [3, 6, 9, 12],          // equity index, 6E, treasuries
  gold: [2, 4, 6, 8, 10, 12],        // GC, MGC
  silver: [3, 5, 7, 9, 12],          // SI
  monthly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
};
const ROOT_RULE = {
  NQ: 'index', MNQ: 'index', ES: 'index', MES: 'index', YM: 'index', MYM: 'index', RTY: 'index', M2K: 'index',
  '6E': 'index', ZN: 'bond', ZB: 'bond', GC: 'metal', MGC: 'metal', SI: 'metal', CL: 'crude', MCL: 'crude', NG: 'gas'
};
function thirdFriday(y, m) { // m 1-12, UTC day number
  const dow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((5 - dow + 7) % 7) + 14;
}
export function guessFrontMonth(root, nowMs = Date.now()) {
  const rule = ROOT_RULE[root];
  if (!rule) return null;
  const d = new Date(nowMs);
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const cycle = root === 'SI' ? CYCLES.silver : rule === 'metal' ? CYCLES.gold
    : (rule === 'crude' || rule === 'gas') ? CYCLES.monthly : CYCLES.quarterly;
  // First month that is still "front" today.
  let minM = m, minY = y;
  if (rule === 'index' && cycle.includes(m) && day >= thirdFriday(y, m) - 8) minM++;      // rolls ~8 days before expiry
  else if (rule === 'bond' || rule === 'metal') { minM++; if (day >= 24) minM++; }        // rolls before first notice day
  else if (rule === 'crude') { minM++; if (day >= 15) minM++; }                             // expires ~20th of prior month
  else if (rule === 'gas') { minM++; if (day >= 22) minM++; }                               // expires ~3 days before month start
  while (minM > 12) { minM -= 12; minY++; }
  for (let i = 0; i < 24; i++) {
    const mm = ((minM - 1 + i) % 12) + 1;
    const yy = minY + Math.floor((minM - 1 + i) / 12);
    if (cycle.includes(mm)) return root + MONTH_CODES[mm - 1] + String(yy % 10);
  }
  return null;
}

// state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'
export class RithmicClient {
  #creds = null;

  constructor(cfg) {
    this.cfg = cfg;
    this.state = 'idle';
    this.systemName = '';
    this.ticker = null;
    this.history = null;
    this.listeners = new Set();
    this.marketSubs = new Map(); // `${symbol}|${exchange}` -> Set<fn>
    this.frontCache = new Map(); // `${root}|${exchange}` -> { at, symbol }
    this.retry = 0;
    this.retryTimer = null;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, detail) {
    for (const fn of [...this.listeners]) { try { fn({ type, state: this.state, ...(detail || {}) }); } catch (e) {} }
  }
  setState(s, detail) { this.state = s; this.emit('state', detail); }
  get connected() { return this.state === 'connected'; }

  async connect({ user, password, systemName }) {
    if (!user || !password || !systemName) throw new Error('Enter your Rithmic username, password and system');
    await this.disconnect(true);
    this.#creds = { user: String(user), password: String(password), systemName: String(systemName) };
    this.systemName = this.#creds.systemName;
    this.setState('connecting');
    try {
      await this.#login();
    } catch (e) {
      this.#creds = null;
      await this.#closePlants(false);
      this.setState('error', { message: e && e.message ? e.message : 'Login failed' });
      throw e;
    }
    this.retry = 0;
    this.setState('connected');
  }

  async #login() {
    const t = new Plant(this, INFRA.TICKER_PLANT);
    const h = new Plant(this, INFRA.HISTORY_PLANT);
    this.ticker = t; this.history = h;
    await t.open(this.#creds);
    await h.open(this.#creds);
    // Re-attach live subscriptions (after a reconnect).
    for (const key of this.marketSubs.keys()) {
      const [symbol, exchange] = key.split('|');
      this.#mdRequest(symbol, exchange, MD_REQUEST.SUBSCRIBE).catch(() => {});
    }
  }

  async #closePlants(logout) {
    const ps = [this.ticker, this.history].filter(Boolean);
    this.ticker = null; this.history = null;
    await Promise.all(ps.map((p) => p.close(logout)));
  }

  async disconnect(silent) {
    clearTimeout(this.retryTimer); this.retryTimer = null;
    const had = !!(this.ticker || this.history);
    await this.#closePlants(true);
    this.#creds = null;
    this.frontCache.clear();
    if (had || !silent) this.setState('idle');
  }

  _onForcedLogout() {
    this.#creds = null;
    this.#closePlants(false).then(() => this.setState('error', { message: 'Rithmic ended the session (logged in elsewhere?)' }));
  }

  _onPlantDropped() {
    if (!this.#creds || this.state === 'reconnecting' || this.state === 'connecting') return;
    this.#closePlants(false);
    this.setState('reconnecting');
    this.#scheduleReconnect();
  }

  #scheduleReconnect() {
    clearTimeout(this.retryTimer);
    const wait = RECONNECT_STEPS[Math.min(this.retry, RECONNECT_STEPS.length - 1)];
    this.retry++;
    this.retryTimer = setTimeout(async () => {
      if (!this.#creds) return;
      try {
        await this.#login();
        this.retry = 0;
        this.setState('connected', { reconnected: true });
      } catch (e) {
        await this.#closePlants(false);
        if (this.#creds) this.#scheduleReconnect();
      }
    }, wait);
  }

  // ---- ticker plant -------------------------------------------------------------------
  async frontMonth(root, exchange) {
    const key = root + '|' + exchange;
    const hit = this.frontCache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.symbol;
    if (!this.ticker) throw new Error('Not connected to Rithmic');
    let sym = null;
    try {
      const r = await this.ticker.request({ template_id: T.FRONT_MONTH, symbol: root, exchange, need_updates: false }, T.FRONT_MONTH_R);
      sym = r.trading_symbol || null;
    } catch (e) { /* rp_code 7 "no data": use the calendar below */ }
    if (!sym || sym === root) sym = guessFrontMonth(root);
    if (!sym) throw new Error('No front-month contract for ' + root);
    this.frontCache.set(key, { at: Date.now(), symbol: sym });
    return sym;
  }

  #mdRequest(symbol, exchange, request) {
    if (!this.ticker) return Promise.reject(new Error('Not connected to Rithmic'));
    return this.ticker.request({ template_id: T.MD_UPDATE, symbol, exchange, request,
      update_bits: UPDATE_BITS.LAST_TRADE | UPDATE_BITS.BBO }, T.MD_UPDATE_R);
  }

  // fn receives { kind: 'trade', price, size, time, side } or { kind: 'bbo', bid, ask, time } (time = epoch ms).
  // side = the aggressor from LastTrade field 112003 (TransactionType BUY = 1, SELL = 2): 'buy' | 'sell' | null.
  subscribeMarket(symbol, exchange, fn) {
    const key = symbol + '|' + exchange;
    let set = this.marketSubs.get(key);
    if (!set) {
      set = new Set();
      this.marketSubs.set(key, set);
      if (this.connected) this.#mdRequest(symbol, exchange, MD_REQUEST.SUBSCRIBE).catch((e) => this.emit('warn', { message: e.message }));
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size) return;
      this.marketSubs.delete(key);
      if (this.connected) this.#mdRequest(symbol, exchange, MD_REQUEST.UNSUBSCRIBE).catch(() => {});
    };
  }

  _onMarket(m) {
    const set = this.marketSubs.get(m.symbol + '|' + m.exchange);
    if (!set || !set.size) return;
    const secs = m.source_ssboe || m.ssboe;
    const us = m.source_ssboe ? (m.source_usecs || 0) : (m.usecs || 0);
    const time = secs ? secs * 1000 + Math.floor(us / 1000) : Date.now();
    let ev = null;
    if (m.template_id === T.LAST_TRADE && m.trade_price != null && !m.is_snapshot) {
      ev = { kind: 'trade', price: m.trade_price, size: m.trade_size || 0, time,
        side: m.aggressor === 1 ? 'buy' : m.aggressor === 2 ? 'sell' : null };
    } else if (m.template_id === T.LAST_TRADE && m.trade_price != null) {
      ev = { kind: 'trade', price: m.trade_price, size: 0, time, snapshot: true };
    } else if (m.template_id === T.BBO) {
      ev = { kind: 'bbo', bid: m.bid_price, ask: m.ask_price, time };
    }
    if (ev) for (const fn of [...set]) { try { fn(ev); } catch (e) {} }
  }

  // ---- history plant ------------------------------------------------------------------
  // Bars between startSec and endSec (epoch seconds), newest `maxCount` when direction LAST.
  // Returns raw ResponseTimeBarReplay rows sorted by marker.
  async timeBars(symbol, exchange, { barType = BAR_TYPE.MINUTE_BAR, period = 1, startSec, endSec, maxCount = 2000 }) {
    if (!this.history) throw new Error('Not connected to Rithmic');
    const rows = await this.history.stream({
      template_id: T.TIME_BAR_REPLAY, symbol, exchange, bar_type: barType, bar_type_period: period,
      start_index: Math.floor(startSec), finish_index: Math.floor(endSec),
      user_max_count: Math.min(REPLAY_PAGE_MAX, Math.max(1, Math.floor(maxCount))),
      direction: DIRECTION.LAST, time_order: TIME_ORDER.FORWARDS
    }, T.TIME_BAR_REPLAY_R);
    rows.sort((a, b) => (a.marker || 0) - (b.marker || 0));
    return rows;
  }
}

export { BAR_TYPE };
