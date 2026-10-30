// TradeZoro — Rithmic READ-ONLY order history session (ES module, runtime-neutral)
// Depends on: assets/rithmic-proto.js. Used by the browser (assets/rithmic-journal-ui.js) and by the
// scheduled auto sync (functions-src/rithmic/, a byte-identical copy; tools/tests keeps them in step).
//
// WHAT THIS IS: the Journal's "Import from Rithmic". It logs in to the ORDER_PLANT (and, for a
// cross-check, the PNL_PLANT), lists the member's accounts, lists the days Rithmic has order history for,
// and reads the orders and fills of the chosen days. DATA ONLY.
//
// OWNER RULE: this code NEVER places, modifies or cancels an order. Three layers keep that true:
//   1. rithmic-proto.js defines no order-entry template, so encode() throws for one.
//   2. ALLOWED_TEMPLATES below is the only list of templates this session may send; send() throws for
//      anything else (new / modify / cancel / bracket / OCO / exit position / link / agreement ...).
//   3. tools/tests/rithmic-orders.test.mjs fails if an order-entry id is allowed, and checks every frame
//      the session puts on the wire against the list.
//
// CREDENTIALS: held in this object's private field for the login only, never logged, never returned.

import { T, INFRA, NOTIFY, TX_TYPE, encode, decode } from './rithmic-proto.js?v=765';

// The ONLY templates this feature may send.
//   10 login, 12 logout, 16 system info, 18 heartbeat,
//   300 login info, 302 account list, 318 order-history dates, 320 show orders (today),
//   324 order-history summary, 326 order-history detail, 402 PnL snapshot.
export const ALLOWED_TEMPLATES = Object.freeze([10, 12, 16, 18, 300, 302, 318, 320, 324, 326, 402]);
// Everything that can change an account. Listed so the test (and a reader) can see what is refused.
export const FORBIDDEN_ORDER_TEMPLATES = Object.freeze({
  312: 'RequestNewOrder', 314: 'RequestModifyOrder', 316: 'RequestCancelOrder', 330: 'RequestBracketOrder',
  332: 'RequestUpdateTargetBracketLevel', 334: 'RequestUpdateStopBracketLevel', 346: 'RequestCancelAllOrders',
  3504: 'RequestExitPosition', 3500: 'RequestOCOOrder', 3502: 'RequestLinkOrders', 3508: 'RequestModifyOrderReferenceData',
  308: 'RequestSubscribeForOrderUpdates', 336: 'RequestSubscribeToBracketUpdates', 400: 'RequestPnLPositionUpdates'
});
export function isAllowedTemplate(id) { return ALLOWED_TEMPLATES.includes(Number(id)); }

const REQUEST_TIMEOUT = 20000;
let seq = 0;
const nextId = () => 'stko' + (++seq).toString(36) + Date.now().toString(36).slice(-4);
const rpOk = (m) => !m.rp_code || !m.rp_code.length || m.rp_code[0] === '0';
const rpText = (m) => { const c = m.rp_code || []; return c.length > 1 ? c.slice(1).join(' ') : (c[0] ? 'code ' + c[0] : 'rejected'); };

// Order-plant errors for the member. "Permission" answers on a history request mean our app name is not
// cleared for order history yet (Rithmic must enable it), so say that instead of a login-style message.
export const MSG_HISTORY_NOT_ENABLED = "Order history isn't enabled for this app yet.";
export function explainHistoryError(err) {
  const raw = String((err && err.message) || err || '');
  const code = err && err.rpCode;
  if (/permission|not allowed|not authori[sz]ed|unauthori[sz]ed|not enabled|disabled|forbidden|access denied|not permitted|entitle|not registered/i.test(raw) || code === '13') {
    return { kind: 'permission', message: MSG_HISTORY_NOT_ENABLED, raw: raw.slice(0, 300) };
  }
  if (/closed|not connected|disconnected|did not answer|timed out|could not reach/i.test(raw)) {
    return { kind: 'network', message: "Lost the connection to Rithmic. Try again.", raw: raw.slice(0, 300) };
  }
  return { kind: 'unknown', message: 'Rithmic said: "' + (raw || 'request refused') + '".', raw: raw.slice(0, 300) };
}

function openSocket(WS, url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WS(url); } catch (e) { reject(e); return; }
    ws.binaryType = 'arraybuffer';
    const t = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('Rithmic did not answer in time')); }, timeoutMs);
    ws.onopen = () => { clearTimeout(t); resolve(ws); };
    ws.onerror = () => { clearTimeout(t); reject(new Error('Could not reach Rithmic')); };
  });
}

// One logged-in plant session that only ever sends ALLOWED_TEMPLATES.
export class ReadOnlyPlant {
  #creds = null;
  constructor({ infra, gateway, appName, appVersion, templateVersion = '5.55', WebSocketImpl, onSend } = {}) {
    this.infra = infra;
    this.gateway = gateway;
    this.appName = appName;
    this.appVersion = String(appVersion || '0');
    this.templateVersion = templateVersion;
    this.WS = WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    this.onSend = onSend || null;
    this.ws = null;
    this.hbTimer = null;
    this.hbSecs = 30;
    this.lastSend = 0;
    this.active = null;       // the one request in flight: { id, tid, rows, final, resolve, reject, timer, collect }
    this.loginAt = 0;
    this.uniqueUserId = '';
    this.sent = [];           // template ids sent (tests)
    this.forced = false;
  }

  send(msg) {
    const id = Number(msg && msg.template_id);
    if (!isAllowedTemplate(id)) throw new Error('Blocked: template ' + id + ' is not allowed (read-only feature)');
    if (!this.ws || this.ws.readyState !== 1) throw new Error('Not connected to Rithmic');
    this.ws.send(encode(msg));
    this.lastSend = Date.now();
    this.sent.push(id);
    if (this.onSend) { try { this.onSend(id, this.infra); } catch (e) {} }
  }

  async login({ user, password, systemName }) {
    if (!this.WS) throw new Error('No WebSocket available');
    this.#creds = null;
    const ws = await openSocket(this.WS, this.gateway);
    this.ws = ws;
    ws.onmessage = (e) => this.#onFrame(e.data);
    ws.onclose = () => this.#onClose();
    const res = await this.request({
      template_id: T.LOGIN, template_version: this.templateVersion, user, password,
      app_name: this.appName, app_version: this.appVersion, system_name: systemName, infra_type: this.infra, os_platform: 'browser'
    }, T.LOGIN_R);
    this.uniqueUserId = res.unique_user_id || '';
    this.loginAt = Date.now();
    if (res.heartbeat_interval > 0) this.hbSecs = res.heartbeat_interval;
    const every = Math.max(1, this.hbSecs) * 1000;
    this.hbTimer = setInterval(() => { if (Date.now() - this.lastSend >= every * 0.8) { try { this.send({ template_id: T.HEARTBEAT }); } catch (e) {} } }, Math.max(500, every / 3));
    return res;
  }

  // Send a request and gather every row until the closing message (the one with rp_code).
  // `collect` = template ids whose messages are rows of this answer (e.g. the order notifications).
  request(msg, finalTid, collect = []) {
    return new Promise((resolve, reject) => {
      if (this.active) { reject(new Error('Rithmic request already in flight')); return; }
      const id = nextId();
      const a = { id, tid: finalTid, collect, rows: [], final: null, resolve, reject, timer: 0 };
      const arm = () => setTimeout(() => { if (this.active === a) this.active = null; reject(new Error('Rithmic timed out')); }, REQUEST_TIMEOUT);
      a.arm = arm; a.timer = arm();
      this.active = a;
      try { this.send({ ...msg, user_msg: [id] }); } catch (e) { clearTimeout(a.timer); this.active = null; reject(e); }
    });
  }

  #onFrame(data) {
    let m;
    try { m = decode(data); } catch (e) { return; }
    const tid = m.template_id;
    if (tid === T.HEARTBEAT_R) return;
    if (tid === T.FORCED_LOGOUT) { this.forced = true; const a = this.active; this.active = null; if (a) { clearTimeout(a.timer); a.reject(Object.assign(new Error('This login was opened in another app, so Rithmic closed this session.'), { forced: true })); } return; }
    const a = this.active;
    if (!a) return;
    if (tid === T.REJECT) { clearTimeout(a.timer); this.active = null; a.reject(Object.assign(new Error(rpText(m)), { rpCode: m.rp_code && m.rp_code[0], rpRaw: (m.rp_code || []).join(' | ') })); return; }
    if (a.collect.includes(tid)) { a.rows.push(m); clearTimeout(a.timer); a.timer = a.arm(); return; }
    if (tid !== a.tid) return;
    const hasRp = !!(m.rp_code && m.rp_code.length);
    if (!hasRp) { a.rows.push(m); clearTimeout(a.timer); a.timer = a.arm(); return; }   // data row of the answer
    clearTimeout(a.timer); this.active = null;
    const code = m.rp_code[0];
    if (code === '0') { a.final = m; a.resolve({ rows: a.rows, final: m }); }
    else if (code === '7') { a.final = m; a.resolve({ rows: a.rows, final: m, noData: true }); }   // 7 = no data
    else a.reject(Object.assign(new Error(rpText(m)), { rpCode: code, rpRaw: (m.rp_code || []).join(' | ') }));
  }

  #onClose() {
    clearInterval(this.hbTimer);
    this.ws = null;
    const a = this.active; this.active = null;
    if (a) { clearTimeout(a.timer); a.reject(new Error('Connection to Rithmic closed')); }
  }

  async close() {
    clearInterval(this.hbTimer);
    const ws = this.ws;
    if (!ws) return;
    if (ws.readyState === 1) {
      try { await Promise.race([this.request({ template_id: T.LOGOUT }, T.LOGOUT_R), new Promise((r) => setTimeout(r, 1500))]); } catch (e) {}
    }
    ws.onclose = null;
    try { ws.close(1000); } catch (e) {}
    this.ws = null;
    this.active = null;
  }
}

// ---- helpers over the raw rows ---------------------------------------------------------------------------
const tradeDateCT = (nowMs) => {
  // CME trade date: the Chicago calendar date, rolled to the next day from 17:00 CT (Globex reopens).
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  let d = Date.UTC(+p.year, +p.month - 1, +p.day);
  if (+p.hour >= 17) d += 86400000;
  const u = new Date(d);
  return u.getUTCFullYear() + String(u.getUTCMonth() + 1).padStart(2, '0') + String(u.getUTCDate()).padStart(2, '0');
};
export { tradeDateCT };

const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));
const sizeOf = (m) => num(m.fill_size_64) || num(m.fill_size) || 0;

// One order-plant login + the read-only requests. `ids` (fcm_id / ib_id) come from login info.
export class RithmicOrderHistory {
  #login = null;   // kept in memory for this run only: the PnL plant needs its own login. Never exposed.
  constructor(opts) {
    this.opts = opts;
    this.order = null;
    this.ids = { fcm_id: '', ib_id: '' };
    this.sent = [];
  }

  #plant(infra) {
    const o = this.opts;
    return new ReadOnlyPlant({ infra, gateway: o.gateway, appName: o.appName, appVersion: o.appVersion, templateVersion: o.templateVersion, WebSocketImpl: o.WebSocketImpl,
      onSend: (id) => { this.sent.push(id); if (o.onSend) o.onSend(id, infra); } });
  }

  // Login to the order plant and read who we are (fcm / ib ids). Throws the login error as Rithmic gave it.
  async connect({ user, password, systemName }) {
    const p = this.#plant(INFRA.ORDER_PLANT);
    this.order = p;
    try {
      await p.login({ user, password, systemName });
    } catch (e) { await p.close(); this.order = null; throw e; }
    this.#login = { user, password, systemName };
    const info = await p.request({ template_id: T.LOGIN_INFO }, T.LOGIN_INFO_R);
    const f = info.final;
    this.ids = { fcm_id: f.fcm_id || '', ib_id: f.ib_id || '' };
    this.maxOrderSessions = f.op_max_session_count || 0;
    return { sessionId: p.uniqueUserId };
  }

  async accounts() {
    const r = await this.order.request({ template_id: T.ACCOUNT_LIST, ...this.ids }, T.ACCOUNT_LIST_R);
    const rows = r.rows.concat(r.final && r.final.account_id ? [r.final] : []);
    const seen = new Set();
    return rows.filter((x) => x.account_id && !seen.has(x.account_id) && seen.add(x.account_id))
      .map((x) => ({ id: x.account_id, name: x.account_name || x.account_id, currency: x.account_currency || 'USD', fcm_id: x.fcm_id || this.ids.fcm_id, ib_id: x.ib_id || this.ids.ib_id }));
  }

  // Days Rithmic has order history for (YYYYMMDD, oldest first).
  async historyDates() {
    const r = await this.order.request({ template_id: T.OH_DATES }, T.OH_DATES_R);
    const all = [];
    for (const m of r.rows.concat(r.final ? [r.final] : [])) for (const d of (m.date || [])) if (/^\d{8}$/.test(d)) all.push(d);
    return [...new Set(all)].sort();
  }

  // Orders and fills for one account on one trade date. Summary gives each order, Detail gives its fills.
  // Returns raw 352 notifications. Today uses RequestShowOrders (Rithmic keeps today's orders there).
  async dayNotes(account, date, { today = false } = {}) {
    const base = { fcm_id: account.fcm_id || this.ids.fcm_id, ib_id: account.ib_id || this.ids.ib_id, account_id: account.id };
    let sum;
    if (today) sum = await this.order.request({ template_id: T.SHOW_ORDERS, ...base }, T.SHOW_ORDERS_R, [T.EXCHANGE_ORDER_NOTIFY, T.RITHMIC_ORDER_NOTIFY]);
    else sum = await this.order.request({ template_id: T.OH_SUMMARY, ...base, date }, T.OH_SUMMARY_R, [T.EXCHANGE_ORDER_NOTIFY, T.RITHMIC_ORDER_NOTIFY]);
    const orders = sum.rows.filter((m) => m.basket_id);
    const out = orders.slice();
    // fills: one Detail per order that traded
    const traded = [...new Set(orders.filter((m) => (num(m.total_fill_size_64) || num(m.total_fill_size) || 0) > 0).map((m) => m.basket_id))];
    for (const basket of traded) {
      const d = await this.order.request({ template_id: T.OH_DETAIL, ...base, basket_id: basket, date }, T.OH_DETAIL_R, [T.EXCHANGE_ORDER_NOTIFY, T.RITHMIC_ORDER_NOTIFY]);
      for (const m of d.rows) out.push(m);
    }
    return out;
  }

  // Account P&L snapshot (closed P&L for the day) for the cross-check. Own plant login, then logout.
  async pnlSnapshot(account) {
    if (!this.#login) return null;
    const p = this.#plant(INFRA.PNL_PLANT);
    try {
      await p.login(this.#login);
      const base = { fcm_id: account.fcm_id || this.ids.fcm_id, ib_id: account.ib_id || this.ids.ib_id, account_id: account.id };
      const r = await p.request({ template_id: T.PNL_SNAPSHOT, ...base }, T.PNL_SNAPSHOT_R, [T.PNL_ACCOUNT, T.PNL_INSTRUMENT]);
      const acct = r.rows.filter((m) => m.template_id === T.PNL_ACCOUNT).pop();
      if (!acct) return null;
      return { dayClosedPnl: num(acct.day_closed_pnl), closedPnl: num(acct.closed_position_pnl), commission: num(acct.rms_account_commission), dayPnl: num(acct.day_pnl) };
    } catch (e) {
      return { error: e && e.message ? e.message : 'PnL snapshot failed' };
    } finally { await p.close(); }
  }

  async close() {
    this.#login = null;
    const p = this.order; this.order = null;
    if (p) await p.close();
  }
}

export { NOTIFY, TX_TYPE, sizeOf };
