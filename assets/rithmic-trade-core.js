// TradeZoro — Rithmic ORDER ENTRY core (ES module, runtime-neutral: browser + node tests)
// ADMIN-ONLY, Rithmic Test / Rithmic Paper Trading ONLY (CoS 2026-11-09, Owner GO). No live orders: Rithmic has not
// enabled order routing for our app yet, and the Owner rule is no real broker orders for members.
// Loaded only by assets/rithmic-trade.js, which is only imported for admins (assets/rithmic-config.js
// mountRithmicTradingIfAdmin). Members never download this file.
//
// This file does NOT touch the read-only modules: assets/rithmic-proto.js keeps no order templates and
// assets/rithmic-orders.js keeps its own allow-list. Order entry has its OWN codec + schema + allow-list here.
//
// SAFETY LAYERS (each has a test in tools/tests/rithmic-trade.test.mjs):
//   1. TRADE_ALLOWED_TEMPLATES: send() refuses any other template id before anything is written.
//   2. checkTarget(): the system must be exactly 'Rithmic Test' or 'Rithmic Paper Trading' AND be in the list the
//      gateway itself returned (RequestRithmicSystemInfo), on the Rithmic Test gateway (or, for Paper Trading only,
//      a Rithmic production host). Checked before connect, frozen at login, and checked AGAIN inside send() for
//      every order template, against the socket's own url. ResponseLogin carries no system name, so the frozen
//      name we sent is what we re-check.
//   3. Live trading: liveTradingAllowed() needs RITHMIC_LIVE_TRADING (rithmic-config.js, false) AND the admin-only
//      server flag config/rithmicTrading.live === true (not set; no rule exists, so the read is denied). Even
//      with both, checkTarget() has no live path: it refuses every non-paper target ("not built").
//   4. Order guards: whole contracts 1..min(admin max, 5); connected + reconciled; prices received < 5 s ago
//      (local receive time); price on the tick and within LIMITS.bandTicks of the market; known instrument and
//      a contract confirmed by Rithmic (or typed by the admin); account from this login's account list;
//      5 actions / 10 s; one new order in flight at a time. Cancel / cancel-all / exit position (risk reducing)
//      skip the price and rate checks but never the target check.
//   5. No retries: a request that times out is shown as "unknown" and is never re-sent. Every disconnect locks
//      trading; reconnect rebuilds orders + positions from Rithmic (show orders + PnL snapshot) before unlocking.
//   6. Every action is logged (time, account, action, result; never credentials) to console + an in-memory log.
// CREDENTIALS: in a private field for the logins only; never logged, stored or returned.

export const TRADE_ALLOWED_TEMPLATES = Object.freeze([10, 12, 16, 18, 100, 113, 300, 302, 308, 310, 312, 314, 316, 320, 330, 336, 346, 3504, 400, 402]);
// Templates that can change an account (named for tests and logs).
export const ORDER_TEMPLATES = Object.freeze([312, 314, 316, 330, 346, 3504]);
// Templates that only read. The target guard runs on EVERY allowed template NOT in this list (fail closed: a template
// added to the allow-list later is guarded unless someone also calls it read-only here, and a test checks the sets).
export const READ_ONLY_TEMPLATES = Object.freeze([12, 16, 18, 100, 113, 300, 302, 308, 310, 320, 336, 400, 402]);
// Kill switch for order entry: false = send() throws on every guarded template (login and reads still work).
export const ORDER_ENTRY_ON = true;
export const PAPER_SYSTEMS = Object.freeze(['Rithmic Test', 'Rithmic Paper Trading']);
export const TEST_GATEWAY = 'wss://rituz00100.rithmic.com:443';
// Rithmic Paper Trading is served by the production hosts, which also serve live systems. OFF until the fcm_id / ib_id /
// trade route of a real Paper Trading login have been recorded and pinned (go-live checklist). Until then: Rithmic Test only.
export const ALLOW_PAPER_ON_PRODUCTION_HOSTS = false;
// matched against normUrl() output (scheme://host:port)
const PROD_HOST_RE = /^wss:\/\/rprotocol(-[a-z0-9]+)?\.rithmic\.com:443$/;
const LOCAL_RE = /^wss?:\/\/(127\.0\.0\.1|localhost):\d+$/;
export const LIMITS = Object.freeze({ hardMaxQty: 5, defaultMaxQty: 1, staleMs: 5000, rateN: 5, rateMs: 10000, bandTicks: 400, timeoutMs: 15000 });
// Futures we allow: exchange + tick size (contract specs, CME Group). Anything else is refused.
export const INSTRUMENTS = Object.freeze({
  ES: { ex: 'CME', tick: 0.25 }, MES: { ex: 'CME', tick: 0.25 }, NQ: { ex: 'CME', tick: 0.25 }, MNQ: { ex: 'CME', tick: 0.25 },
  RTY: { ex: 'CME', tick: 0.1 }, M2K: { ex: 'CME', tick: 0.1 }, YM: { ex: 'CBOT', tick: 1 }, MYM: { ex: 'CBOT', tick: 1 },
  GC: { ex: 'COMEX', tick: 0.1 }, MGC: { ex: 'COMEX', tick: 0.1 }, CL: { ex: 'NYMEX', tick: 0.01 }, MCL: { ex: 'NYMEX', tick: 0.01 }
});
export const T = { LOGIN: 10, LOGIN_R: 11, LOGOUT: 12, LOGOUT_R: 13, SYSTEM_INFO: 16, SYSTEM_INFO_R: 17, HEARTBEAT: 18, HEARTBEAT_R: 19, REJECT: 75, FORCED_LOGOUT: 77,
  MD_UPDATE: 100, MD_UPDATE_R: 101, FRONT_MONTH: 113, FRONT_MONTH_R: 114, LAST_TRADE: 150, BBO: 151,
  LOGIN_INFO: 300, LOGIN_INFO_R: 301, ACCOUNT_LIST: 302, ACCOUNT_LIST_R: 303, ORDER_UPDATES: 308, ORDER_UPDATES_R: 309, TRADE_ROUTES: 310, TRADE_ROUTES_R: 311,
  NEW_ORDER: 312, NEW_ORDER_R: 313, MODIFY_ORDER: 314, MODIFY_ORDER_R: 315, CANCEL_ORDER: 316, CANCEL_ORDER_R: 317, SHOW_ORDERS: 320, SHOW_ORDERS_R: 321,
  BRACKET_ORDER: 330, BRACKET_ORDER_R: 331, BRACKET_UPDATES_SUB: 336, BRACKET_UPDATES_SUB_R: 337, CANCEL_ALL: 346, CANCEL_ALL_R: 347,
  RITHMIC_ORDER_NOTIFY: 351, EXCHANGE_ORDER_NOTIFY: 352, BRACKET_UPDATE: 353, EXIT_POSITION: 3504, EXIT_POSITION_R: 3505,
  PNL_UPDATES: 400, PNL_UPDATES_R: 401, PNL_SNAPSHOT: 402, PNL_SNAPSHOT_R: 403, PNL_INSTRUMENT: 450, PNL_ACCOUNT: 451 };
export const INFRA = { TICKER_PLANT: 1, ORDER_PLANT: 2, PNL_PLANT: 4 };
// enums from the kit's .proto files
export const SIDE = { buy: 1, sell: 2 };
export const PRICE_TYPE = { limit: 1, market: 2, stop_limit: 3, stop: 4 };
const DURATION_DAY = 1, MANUAL = 1, USER_TYPE_TRADER = 3;
export const BRACKET_TYPE = { stop: 1, target: 2, both: 3 };

// ---- codec (own copy of the hand-rolled protobuf in rithmic-proto.js, with the order-entry schema) ------------------
// Field numbers from the R|Protocol API 0.90.0.0 kit .proto files.
const C = { template_id: [154467, 'i32'], user_msg: [132760, 'str*'], rp_code: [132766, 'str*'], rq_handler_rp_code: [132764, 'str*'] };
const SX = { symbol: [110100, 'str'], exchange: [110101, 'str'] };
const AC = { fcm_id: [154013, 'str'], ib_id: [154014, 'str'], account_id: [154008, 'str'] };
const ORD = { quantity_64: [159017, 'u64'], price: [110306, 'dbl'], trigger_price: [149247, 'dbl'], transaction_type: [112003, 'i32'], duration: [112005, 'i32'],
  price_type: [112008, 'i32'], trade_route: [112016, 'str'], manual_or_auto: [154710, 'i32'], user_tag: [154119, 'str'], window_name: [154629, 'str'] };
const NOTE = { ...C, ...AC, ...SX, ...ORD, notify_type: [153625, 'i32'], is_snapshot: [110121, 'bool'], status: [110303, 'str'], basket_id: [110300, 'str'],
  original_basket_id: [154497, 'str'], linked_basket_ids: [110358, 'str'], bracket_type: [157087, 'i32'], avg_fill_price: [110322, 'dbl'],
  total_fill_size_64: [159019, 'u64'], total_unfilled_size_64: [159020, 'u64'], text: [120008, 'str'], report_text: [120028, 'str'], completion_reason: [149273, 'str'],
  ssboe: [150100, 'i32'], usecs: [150101, 'i32'] };
export const TRADE_SCHEMA = {
  [T.LOGIN]: { ...C, template_version: [153634, 'str'], user: [131003, 'str'], password: [130004, 'str'], app_name: [130002, 'str'], app_version: [131803, 'str'],
    system_name: [153628, 'str'], infra_type: [153621, 'i32'], os_platform: [144020, 'str'] },
  [T.LOGIN_R]: { ...C, template_version: [153634, 'str'], fcm_id: [154013, 'str'], ib_id: [154014, 'str'], unique_user_id: [153428, 'str'], heartbeat_interval: [153633, 'dbl'] },
  [T.LOGOUT]: { ...C }, [T.LOGOUT_R]: { ...C }, [T.SYSTEM_INFO]: { ...C }, [T.SYSTEM_INFO_R]: { ...C, system_name: [153628, 'str*'] },
  [T.HEARTBEAT]: { ...C }, [T.HEARTBEAT_R]: { ...C }, [T.REJECT]: { ...C }, [T.FORCED_LOGOUT]: { ...C },
  [T.MD_UPDATE]: { ...C, ...SX, request: [100000, 'i32'], update_bits: [154211, 'u32'] }, [T.MD_UPDATE_R]: { ...C },
  [T.FRONT_MONTH]: { ...C, ...SX, need_updates: [154352, 'bool'] },
  [T.FRONT_MONTH_R]: { ...C, ...SX, is_front_month_symbol: [149166, 'bool'], symbol_name: [100003, 'str'], trading_symbol: [157095, 'str'], trading_exchange: [157096, 'str'] },
  [T.LAST_TRADE]: { template_id: [154467, 'i32'], ...SX, is_snapshot: [110121, 'bool'], trade_price: [100006, 'dbl'], trade_size: [100178, 'i32'], ssboe: [150100, 'i32'], usecs: [150101, 'i32'] },
  [T.BBO]: { template_id: [154467, 'i32'], ...SX, is_snapshot: [110121, 'bool'], bid_price: [100022, 'dbl'], bid_size: [100030, 'i32'], ask_price: [100025, 'dbl'], ask_size: [100031, 'i32'], ssboe: [150100, 'i32'] },
  [T.LOGIN_INFO]: { ...C }, [T.LOGIN_INFO_R]: { ...C, fcm_id: [154013, 'str'], ib_id: [154014, 'str'], user_type: [154036, 'i32'] },
  [T.ACCOUNT_LIST]: { ...C, fcm_id: [154013, 'str'], ib_id: [154014, 'str'], user_type: [154036, 'i32'] },
  [T.ACCOUNT_LIST_R]: { ...C, ...AC, account_name: [154002, 'str'], account_currency: [154383, 'str'] },
  [T.ORDER_UPDATES]: { ...C, ...AC }, [T.ORDER_UPDATES_R]: { ...C },
  [T.TRADE_ROUTES]: { ...C, subscribe_for_updates: [154352, 'bool'] },
  [T.TRADE_ROUTES_R]: { ...C, fcm_id: [154013, 'str'], ib_id: [154014, 'str'], exchange: [110101, 'str'], trade_route: [112016, 'str'], status: [131407, 'str'], is_default: [154689, 'bool'] },
  [T.NEW_ORDER]: { ...C, ...AC, ...SX, ...ORD },
  [T.NEW_ORDER_R]: { ...C, user_tag: [154119, 'str'], basket_id: [110300, 'str'], ssboe: [150100, 'i32'] },
  [T.MODIFY_ORDER]: { ...C, ...AC, ...SX, basket_id: [110300, 'str'], quantity_64: ORD.quantity_64, price: ORD.price, trigger_price: ORD.trigger_price, price_type: ORD.price_type, manual_or_auto: ORD.manual_or_auto, window_name: ORD.window_name },
  [T.MODIFY_ORDER_R]: { ...C, basket_id: [110300, 'str'] },
  [T.CANCEL_ORDER]: { ...C, ...AC, basket_id: [110300, 'str'], manual_or_auto: ORD.manual_or_auto, window_name: ORD.window_name },
  [T.CANCEL_ORDER_R]: { ...C, basket_id: [110300, 'str'] },
  [T.SHOW_ORDERS]: { ...C, ...AC }, [T.SHOW_ORDERS_R]: { ...C },
  [T.BRACKET_ORDER]: { ...C, ...AC, ...SX, ...ORD, user_type: [154036, 'i32'], bracket_type: [157087, 'i32'], target_quantity_64: [159025, 'u64*'], stop_quantity_64: [159026, 'u64*'],
    stop_ticks: [154458, 'i32*'], target_ticks: [154456, 'i32*'] },
  [T.BRACKET_ORDER_R]: { ...C, user_tag: [154119, 'str'], basket_id: [110300, 'str'] },
  [T.BRACKET_UPDATES_SUB]: { ...C, ...AC }, [T.BRACKET_UPDATES_SUB_R]: { ...C },
  [T.CANCEL_ALL]: { ...C, ...AC, user_type: [154036, 'i32'], manual_or_auto: ORD.manual_or_auto }, [T.CANCEL_ALL_R]: { ...C },
  [T.EXIT_POSITION]: { ...C, ...AC, ...SX, manual_or_auto: ORD.manual_or_auto, window_name: ORD.window_name }, [T.EXIT_POSITION_R]: { ...C, ...SX },
  [T.RITHMIC_ORDER_NOTIFY]: NOTE,
  [T.EXCHANGE_ORDER_NOTIFY]: { ...NOTE, report_type: [120001, 'str'], fill_price: [110307, 'dbl'], fill_size_64: [159024, 'u64'], fill_time: [110309, 'str'], fill_id: [110311, 'str'] },
  [T.BRACKET_UPDATE]: { template_id: [154467, 'i32'], ...AC, basket_id: [110300, 'str'], stop_ticks: [154458, 'i32'], stop_quantity: [154459, 'i32'], target_ticks: [154456, 'i32'], target_quantity: [154457, 'i32'] },
  [T.PNL_UPDATES]: { ...C, ...AC, request: [100000, 'i32'] }, [T.PNL_UPDATES_R]: { ...C },
  [T.PNL_SNAPSHOT]: { ...C, ...AC }, [T.PNL_SNAPSHOT_R]: { ...C },
  [T.PNL_INSTRUMENT]: { template_id: [154467, 'i32'], is_snapshot: [110121, 'bool'], ...AC, ...SX, net_quantity: [156967, 'i32'], avg_open_fill_price: [154434, 'dbl'],
    open_position_pnl: [156961, 'str'], open_position_quantity: [156962, 'i32'], day_pnl: [157956, 'dbl'], day_closed_pnl: [157955, 'dbl'] },
  [T.PNL_ACCOUNT]: { template_id: [154467, 'i32'], is_snapshot: [110121, 'bool'], ...AC, account_balance: [156970, 'str'], open_position_pnl: [156961, 'str'],
    day_pnl: [157956, 'str'], day_closed_pnl: [157955, 'str'], net_quantity: [156967, 'i32'] }
};

const te = new TextEncoder(), td = new TextDecoder();
function pushVarint(out, n) {
  if (n < 0) { let b = BigInt.asUintN(64, BigInt(Math.trunc(n))); while (b >= 0x80n) { out.push(Number(b & 0x7fn) | 0x80); b >>= 7n; } out.push(Number(b)); return; }
  n = Math.trunc(n); while (n >= 0x80) { out.push((n % 0x80) | 0x80); n = Math.floor(n / 0x80); } out.push(n);
}
export function tEncode(msg) {
  const schema = TRADE_SCHEMA[msg.template_id];
  if (!schema) throw new Error('rithmic-trade: unknown template ' + msg.template_id);
  const out = [];
  for (const name of Object.keys(msg)) {
    const spec = schema[name], v = msg[name];
    if (!spec || v == null) continue;
    const [field, kr] = spec, rep = kr.endsWith('*'), kind = rep ? kr.slice(0, -1) : kr;
    for (const x of rep ? (Array.isArray(v) ? v : [v]) : [v]) {
      if (kind === 'str') { const b = te.encode(String(x)); pushVarint(out, field * 8 + 2); pushVarint(out, b.length); for (const c of b) out.push(c); }
      else if (kind === 'dbl') { pushVarint(out, field * 8 + 1); const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, Number(x), true); for (let i = 0; i < 8; i++) out.push(dv.getUint8(i)); }
      else if (kind === 'bool') { pushVarint(out, field * 8); out.push(x ? 1 : 0); }
      else { pushVarint(out, field * 8); pushVarint(out, Number(x)); }
    }
  }
  return new Uint8Array(out);
}
function readVarint(buf, st) {
  let lo = 0, mul = 1, b, big = null, sh = 0n;
  do {
    if (st.i >= buf.length) throw new Error('rithmic-trade: truncated varint');
    b = buf[st.i++];
    if (big === null && mul < 2 ** 49) { lo += (b & 0x7f) * mul; mul *= 128; }
    else { if (big === null) { big = BigInt(lo); sh = BigInt(Math.round(Math.log2(mul))); } big += BigInt(b & 0x7f) << sh; sh += 7n; }
  } while (b & 0x80);
  return big === null ? lo : big;
}
const i32 = (v) => Number(BigInt.asIntN(32, typeof v === 'bigint' ? v : BigInt(v)));
export function tDecode(input) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input), st = { i: 0 }, raw = [];
  while (st.i < buf.length) {
    const k = Number(readVarint(buf, st)), field = Math.floor(k / 8), wire = k % 8;
    let v;
    if (wire === 0) v = readVarint(buf, st);
    else if (wire === 1) { v = buf.subarray(st.i, st.i + 8); st.i += 8; }
    else if (wire === 2) { const len = Number(readVarint(buf, st)); v = buf.subarray(st.i, st.i + len); st.i += len; }
    else if (wire === 5) { v = buf.subarray(st.i, st.i + 4); st.i += 4; }
    else throw new Error('rithmic-trade: wire type ' + wire);
    if (st.i > buf.length) throw new Error('rithmic-trade: truncated field ' + field);
    raw.push([field, wire, v]);
  }
  const tr = raw.find((r) => r[0] === 154467), template_id = tr ? i32(tr[2]) : 0;
  const schema = TRADE_SCHEMA[template_id] || C, by = {};
  for (const n of Object.keys(schema)) by[schema[n][0]] = [n, schema[n][1]];
  const msg = { template_id };
  for (const [field, wire, v] of raw) {
    const m = by[field]; if (!m || field === 154467) continue;
    const [name, kr] = m, rep = kr.endsWith('*'), kind = rep ? kr.slice(0, -1) : kr;
    if (rep && wire === 2 && kind !== 'str') {   // packed repeated numbers
      const arr = msg[name] = msg[name] || [];
      if (kind === 'dbl') { const dv = new DataView(v.buffer, v.byteOffset, v.length); for (let o = 0; o + 8 <= v.length; o += 8) arr.push(dv.getFloat64(o, true)); }
      else { const s2 = { i: 0 }; while (s2.i < v.length) { const n = readVarint(v, s2); arr.push(kind === 'i32' ? i32(n) : Number(n)); } }
      continue;
    }
    let x;
    if (kind === 'str') x = wire === 2 ? td.decode(v) : '';
    else if (kind === 'dbl') x = wire === 1 ? new DataView(v.buffer, v.byteOffset, 8).getFloat64(0, true) : 0;
    else if (kind === 'bool') x = Number(v) !== 0;
    else if (kind === 'i32') x = i32(v);
    else x = Number(v);
    if (rep) (msg[name] = msg[name] || []).push(x); else msg[name] = x;
  }
  return msg;
}

// ---- gates ---------------------------------------------------------------------------------------------------------------
// scheme://host:port with the default port spelled out, so 'wss://h:443' and a socket's 'wss://h/' compare equal.
export function normUrl(u) {
  try { const x = new URL(String(u || '').trim()); if (!/^wss?:$/.test(x.protocol) || x.username || x.password || x.search || x.hash || (x.pathname && x.pathname !== '/')) return '!' + u;
    return x.protocol + '//' + x.hostname.toLowerCase() + ':' + (x.port || (x.protocol === 'wss:' ? '443' : '80')); } catch (e) { return '!' + u; }
}
// Is this (gateway, system) a paper / test target we may trade on? `systems` = what the gateway itself listed.
// `allowMock` = the localhost-only dev switch (assets/rithmic-config.js devOverride), never true on the live site.
export function checkTarget({ gateway, system, systems, live = false, allowMock = false } = {}) {
  const no = (why) => ({ ok: false, why });
  const g = normUrl(gateway);
  // live never opens a target: there is no live path. It only changes the message.
  const off = (why) => no(live ? 'Live trading is not built yet. ' + why : why);
  if (typeof system !== 'string' || !PAPER_SYSTEMS.includes(system)) return off('Trading is limited to Rithmic Test and Rithmic Paper Trading (got "' + String(system).slice(0, 40) + '").');
  if (!Array.isArray(systems) || !systems.includes(system)) return off('This gateway did not list "' + system + '".');
  if (g === normUrl(TEST_GATEWAY)) return { ok: true };
  // the local mock: only on a 127.0.0.1 / localhost page (or node tests), only to a 127.0.0.1 / localhost socket
  const localPage = typeof location === 'undefined' || /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  if (allowMock && localPage && LOCAL_RE.test(g)) return { ok: true };
  if (ALLOW_PAPER_ON_PRODUCTION_HOSTS && PROD_HOST_RE.test(g) && system === 'Rithmic Paper Trading') return { ok: true };
  return off('Trading is refused on this gateway for "' + system + '".');
}
// Double gate for live trading. Both must be true; the server flag is only read when the constant is on.
export async function liveTradingAllowed({ constFlag, readServerFlag } = {}) {
  if (constFlag !== true) return false;
  try { return (await readServerFlag()) === true; } catch (e) { return false; }
}
export const clampMaxQty = (v) => { const n = Math.floor(Number(v)); return n >= 1 ? Math.min(n, LIMITS.hardMaxQty) : LIMITS.defaultMaxQty; };
export const roundTick = (p, tick) => Math.round(Math.round(p / tick) * tick * 1e8) / 1e8;
const onTick = (p, tick) => Math.abs(p / tick - Math.round(p / tick)) < 1e-6;
export function rootOfSymbol(s) {
  const r = String(s || '').trim().toUpperCase().replace(/^[A-Z]+:/, '').replace(/1!$/, '').replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '');
  return Object.prototype.hasOwnProperty.call(INSTRUMENTS, r) ? r : null;
}
export const contractOk = (root, c) => new RegExp('^' + root + '[FGHJKMNQUVXZ]\\d{1,2}$').test(String(c || ''));
// Order status from a 351: 'working' | 'done' | 'unknown'. Unknown text is never treated as done.
export function statusKind(m) {
  const s = String(m.status || '').toLowerCase().trim();
  if (/^(complete|completed|filled|cancelled|canceled|rejected)$/.test(s)) return 'done';
  if (/^(open|partial|pending|open pending|modify pending|cancel pending|trigger pending|working|received)/.test(s)) return 'working';
  return 'unknown';
}
const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));
const rpOk = (m) => !m.rp_code || !m.rp_code.length || m.rp_code[0] === '0';
const rpText = (m) => { const c = m.rp_code || []; return c.length > 1 ? c.slice(1).join(' ') : (c[0] ? 'code ' + c[0] : 'rejected'); };
let seq = 0;
const nextId = () => 'stkt' + (++seq).toString(36) + Date.now().toString(36).slice(-4);
export const newTag = () => 'stkrt' + (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function openSocket(WS, url, ms = 15000) {
  return new Promise((resolve, reject) => {
    let ws; try { ws = new WS(url); } catch (e) { reject(e); return; }
    ws.binaryType = 'arraybuffer';
    const t = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('Rithmic did not answer in time')); }, ms);
    ws.onopen = () => { clearTimeout(t); resolve(ws); };
    ws.onerror = () => { clearTimeout(t); reject(new Error('Could not reach Rithmic')); };
  });
}
export async function listSystemsT(WS, gateway) {
  const ws = await openSocket(WS, gateway);
  try {
    return await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('No system list from Rithmic')), 15000);
      ws.onmessage = (e) => { const m = tDecode(e.data); if (m.template_id !== T.SYSTEM_INFO_R) return; clearTimeout(t); rpOk(m) ? resolve((m.system_name || []).slice()) : reject(new Error(rpText(m))); };
      ws.onclose = () => { clearTimeout(t); reject(new Error('Rithmic closed the connection')); };
      ws.send(tEncode({ template_id: T.SYSTEM_INFO, user_msg: ['systems'] }));
    });
  } finally { ws.onclose = null; try { ws.close(1000); } catch (e) {} }
}

// ---- one plant -----------------------------------------------------------------------------------------------------------
// exported for the node tests; every guard lives inside send(), so a caller holding a plant still cannot skip them
export class TPlant {
  constructor(sess, infra) { this.s = sess; this.infra = infra; this.ws = null; this.pending = new Map(); this.hb = null; this.lastSend = 0; }
  async open(creds) {
    const ws = await openSocket(this.s.WS, this.s.target.gateway);
    this.ws = ws;
    ws.onmessage = (e) => this.onFrame(e.data);
    ws.onclose = () => this.onClose();
    const r = await this.request({ template_id: T.LOGIN, template_version: this.s.templateVersion, user: creds.user, password: creds.password,
      app_name: this.s.appName, app_version: this.s.appVersion, system_name: this.s.target.system, infra_type: this.infra, os_platform: 'browser' }, T.LOGIN_R);
    const every = Math.max(1, r.final.heartbeat_interval || 30) * 1000;
    this.hb = setInterval(() => { if (Date.now() - this.lastSend >= every * 0.8) { try { this.send({ template_id: T.HEARTBEAT }); } catch (e) {} } }, Math.max(500, every / 3));
    return r.final;
  }
  // Every frame goes through here. Allow-list first, then (order templates) the target guard on this socket.
  send(msg) {
    const id = Number(msg && msg.template_id);
    if (!TRADE_ALLOWED_TEMPLATES.includes(id)) throw new Error('Blocked: template ' + id + ' is not allowed');
    if (id === T.LOGIN) this.s.assertLoginFrame(this, msg);   // the login frame picks the system: it must be the checked one
    else if (!READ_ONLY_TEMPLATES.includes(id)) {
      if (!ORDER_ENTRY_ON) throw new Error('Blocked: order entry is switched off');
      this.s.assertOrderTarget(this);
      this.s.assertOrderFields(id, msg);
    }
    if (!this.ws || this.ws.readyState !== 1) throw new Error('Not connected to Rithmic');
    this.ws.send(tEncode({ ...msg, template_id: id }));
    this.lastSend = Date.now();
    this.s.sent.push(id);
  }
  // Request -> rows until the closing message with rp_code. `collect` = notification ids that belong to the answer.
  request(msg, finalTid, collect = []) {
    return new Promise((resolve, reject) => {
      const id = nextId();
      const p = { tid: finalTid, collect, rows: [], resolve, reject, timer: 0 };
      p.timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error('Rithmic did not answer in time'), { timeout: true })); }, this.s.timeoutMs);
      this.pending.set(id, p);
      try { this.send({ ...msg, user_msg: [id] }); } catch (e) { clearTimeout(p.timer); this.pending.delete(id); reject(e); }
    });
  }
  onFrame(data) {
    let m; try { m = tDecode(data); } catch (e) { return; }
    const tid = m.template_id;
    if (tid === T.HEARTBEAT_R) return;
    if (tid === T.FORCED_LOGOUT) { this.s.lost('Rithmic closed this trading session (logged in elsewhere).'); return; }
    const id = m.user_msg && m.user_msg[0], p = id && this.pending.get(id);
    if (p) {
      if (tid === T.REJECT) { clearTimeout(p.timer); this.pending.delete(id); p.reject(Object.assign(new Error(rpText(m)), { rpCode: m.rp_code && m.rp_code[0] })); return; }
      if (p.collect.includes(tid)) { p.rows.push(m); }
      else if (tid === p.tid) {
        if (m.rp_code && m.rp_code.length) {
          clearTimeout(p.timer); this.pending.delete(id);
          if (m.rp_code[0] === '0' || m.rp_code[0] === '7') p.resolve({ rows: p.rows, final: m, noData: m.rp_code[0] === '7' });
          else p.reject(Object.assign(new Error(rpText(m)), { rpCode: m.rp_code[0] }));
        } else p.rows.push(m);
        return;
      }
    }
    this.s.onPush(m, this.infra);
  }
  onClose() {
    clearInterval(this.hb); this.ws = null;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('Connection to Rithmic closed')); }
    this.pending.clear();
    if (!this.closing) this.s.lost('Connection to Rithmic closed.');
  }
  async close() {
    this.closing = true; clearInterval(this.hb);
    const ws = this.ws; if (!ws) return;
    if (ws.readyState === 1) { try { await Promise.race([this.request({ template_id: T.LOGOUT }, T.LOGOUT_R), new Promise((r) => setTimeout(r, 1200))]); } catch (e) {} }
    ws.onclose = null; try { ws.close(1000); } catch (e) {}
    this.ws = null;
  }
}

// ---- the trading session -------------------------------------------------------------------------------------------------
export class TradeSession {
  #creds = null;
  #issued = new WeakSet();   // only tickets made by prepare()/prepareModify() of THIS session can be sent
  #max = 1;
  #unknown = false;   // an order/modify got no answer: new orders stay blocked for this session
  get unknownOrder() { return this.#unknown; }
  get maxQty() { return this.#max; }
  set maxQty(v) { this.#max = clampMaxQty(v); }   // clamps to the hard cap on every write
  constructor({ gateway, appName, appVersion, templateVersion = '5.55', WebSocketImpl, allowMock = false, maxQty = 1, now, onEvent, logSink } = {}) {
    this.gateway = String(gateway || '');
    this.appName = appName; this.appVersion = String(appVersion || '0'); this.templateVersion = templateVersion;
    this.WS = WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    this.allowMock = !!allowMock;
    this.maxQty = clampMaxQty(maxQty);
    this.now = now || (() => Date.now());
    this.onEvent = onEvent || (() => {});
    this.logSink = logSink || ((e) => { try { console.info('[TradeZoro Rithmic trade]', e.action, e.account || '', e.result, e.detail || ''); } catch (x) {} });
    this.timeoutMs = LIMITS.timeoutMs;
    this.state = 'idle';            // idle | connecting | syncing | ready | disconnected
    this.target = null;             // frozen { gateway, system } after the target check
    this.order = null; this.pnl = null; this.ticker = null;
    this.ids = { fcm_id: '', ib_id: '' };
    this.accounts = []; this.routes = {};
    this.orders = new Map();        // basket_id -> order
    this.positions = new Map();     // account|symbol -> { account, symbol, exchange, net, avg, openPnl }
    this.acctPnl = new Map();       // account -> { balance, openPnl, dayPnl }
    this.fills = [];
    this.quotes = new Map();        // symbol -> { bid, ask, last, at } (at = local receive time)
    this.contracts = new Map();     // root -> contract confirmed by Rithmic
    this.bracket = new Map();       // parent basket -> { tp, sl }
    this.log = [];
    this.sent = [];
    this.actions = [];              // timestamps of rate-limited actions
    this.inflight = false;
    this.message = '';
  }
  emit(type, d) { try { this.onEvent({ type, ...(d || {}) }); } catch (e) {} }
  record(action, account, result, detail) {
    const e = { t: new Date(this.now()).toISOString(), action, account: account || '', result, detail: detail ? String(detail).slice(0, 200) : '' };
    this.log.unshift(e); if (this.log.length > 300) this.log.length = 300;
    this.logSink(e); this.emit('log', { entry: e });
    return e;
  }
  get ready() { return this.state === 'ready' && !!(this.order && this.order.ws && this.order.ws.readyState === 1); }

  // Re-checked inside send() for every order template: frozen target, still paper, and the socket is really where we think.
  assertOrderTarget(plant) {
    if (!this.target) throw new Error('Blocked: no checked trading target');
    if (plant !== this.order) throw new Error('Blocked: orders only go to the order plant');
    const url = plant.ws && plant.ws.url;
    if (!url || normUrl(url) !== normUrl(this.target.gateway)) throw new Error('Blocked: socket is not on the checked gateway');
    const c = checkTarget({ gateway: this.target.gateway, system: this.target.system, systems: this.target.systems, allowMock: this.allowMock });
    if (!c.ok) throw new Error('Blocked: ' + c.why);
  }

  assertLoginFrame(plant, msg) {
    if (!this.target || msg.system_name !== this.target.system) throw new Error('Blocked: login frame is not for the checked system');
    if (!plant.ws || normUrl(plant.ws.url) !== normUrl(this.target.gateway)) throw new Error('Blocked: socket is not on the checked gateway');
    const c = checkTarget({ gateway: this.target.gateway, system: this.target.system, systems: this.target.systems, allowMock: this.allowMock });
    if (!c.ok) throw new Error('Blocked: ' + c.why);
  }
  // Cheap invariants re-checked on the wire for every guarded frame, whoever built it.
  assertOrderFields(id, msg) {
    if (msg.account_id != null || [312, 314, 316, 330, 346, 3504].includes(id)) {
      if (!this.accounts.some((a) => a.id === msg.account_id)) throw new Error('Blocked: account is not on this login');
    }
    if (msg.quantity_64 != null && !(Number.isInteger(msg.quantity_64) && msg.quantity_64 >= 1 && msg.quantity_64 <= Math.min(this.maxQty, LIMITS.hardMaxQty))) throw new Error('Blocked: quantity over the cap');
    if ((id === T.NEW_ORDER || id === T.BRACKET_ORDER) && msg.quantity_64 == null) throw new Error('Blocked: no quantity');
    if (msg.trade_route != null && !Object.values(this.routes || {}).includes(msg.trade_route)) throw new Error('Blocked: trade route is not on this login');
    for (const k of ['target_quantity_64', 'stop_quantity_64']) if (msg[k] && msg[k].some((v) => v !== msg.quantity_64)) throw new Error('Blocked: bracket size differs from the order');
    for (const k of ['target_ticks', 'stop_ticks']) if (msg[k] && msg[k].some((v) => !(Number.isInteger(v) && v >= 1 && v <= LIMITS.bandTicks))) throw new Error('Blocked: bracket ticks out of range');
  }

  async connect({ user, password, systemName }) {
    if (!this.WS) throw new Error('No WebSocket available');
    if (!user || !password || !systemName) throw new Error('Enter the username, password and system');
    // gate 1: cheap check of the name before any socket
    const gw = this.gateway;   // read once: the system list and the plants must come from the same gateway
    const pre = checkTarget({ gateway: gw, system: systemName, systems: [systemName], allowMock: this.allowMock });
    if (!pre.ok) { this.record('connect', '', 'refused', pre.why); throw new Error(pre.why); }
    this.state = 'connecting'; this.emit('state');
    const systems = await listSystemsT(this.WS, gw);
    const c = checkTarget({ gateway: gw, system: systemName, systems, allowMock: this.allowMock });
    if (!c.ok) { this.state = 'idle'; this.emit('state'); this.record('connect', '', 'refused', c.why); throw new Error(c.why); }
    this.target = Object.freeze({ gateway: gw, system: systemName, systems: Object.freeze(systems.slice()) });
    this.#creds = { user: String(user), password: String(password) };
    try {
      this.order = new TPlant(this, INFRA.ORDER_PLANT);
      const lr = await this.order.open(this.#creds);
      this.pnl = new TPlant(this, INFRA.PNL_PLANT); await this.pnl.open(this.#creds);
      this.ticker = new TPlant(this, INFRA.TICKER_PLANT); await this.ticker.open(this.#creds);
      this.record('login', '', 'ok', this.target.system + ' (' + (lr.unique_user_id ? 'session ' + String(lr.unique_user_id).slice(0, 8) : 'session') + ')');
      await this.sync();
    } catch (e) {
      this.record('login', '', 'failed', e.message);
      await this.close(true);
      throw e;
    } finally { this.#creds = null; }   // the plants are logged in; the password is not kept
  }

  // Rebuild the truth from Rithmic before any order can go out (also the reconcile step).
  async sync() {
    this.state = 'syncing'; this.emit('state');
    const info = await this.order.request({ template_id: T.LOGIN_INFO }, T.LOGIN_INFO_R);
    this.ids = { fcm_id: info.final.fcm_id || '', ib_id: info.final.ib_id || '' };
    const al = await this.order.request({ template_id: T.ACCOUNT_LIST, ...this.ids, user_type: USER_TYPE_TRADER }, T.ACCOUNT_LIST_R);
    const seen = new Set();
    this.accounts = al.rows.filter((x) => x.account_id && !seen.has(x.account_id) && seen.add(x.account_id))
      .map((x) => Object.freeze({ id: x.account_id, name: x.account_name || x.account_id, currency: x.account_currency || 'USD', fcm_id: x.fcm_id || this.ids.fcm_id, ib_id: x.ib_id || this.ids.ib_id }));
    if (!this.accounts.length) throw new Error('No accounts on this login');
    const tr = await this.order.request({ template_id: T.TRADE_ROUTES, subscribe_for_updates: false }, T.TRADE_ROUTES_R);
    this.routes = {};
    for (const r of tr.rows) if (r.exchange && r.trade_route && (r.is_default || !this.routes[r.exchange])) this.routes[r.exchange] = r.trade_route;
    this.orders.clear(); this.positions.clear(); this.acctPnl.clear();
    for (const a of this.accounts) {
      const base = { fcm_id: a.fcm_id, ib_id: a.ib_id, account_id: a.id };
      await this.order.request({ template_id: T.ORDER_UPDATES, ...base }, T.ORDER_UPDATES_R);
      await this.order.request({ template_id: T.BRACKET_UPDATES_SUB, ...base }, T.BRACKET_UPDATES_SUB_R);
      const so = await this.order.request({ template_id: T.SHOW_ORDERS, ...base }, T.SHOW_ORDERS_R, [T.RITHMIC_ORDER_NOTIFY, T.EXCHANGE_ORDER_NOTIFY]);
      for (const m of so.rows) this.onPush(m, INFRA.ORDER_PLANT);
      const sn = await this.pnl.request({ template_id: T.PNL_SNAPSHOT, ...base }, T.PNL_SNAPSHOT_R, [T.PNL_INSTRUMENT, T.PNL_ACCOUNT]);
      for (const m of sn.rows) this.onPush(m, INFRA.PNL_PLANT);
      await this.pnl.request({ template_id: T.PNL_UPDATES, ...base, request: 1 }, T.PNL_UPDATES_R);
    }
    this.state = 'ready'; this.message = '';
    this.record('sync', '', 'ok', this.accounts.length + ' account(s), ' + [...this.orders.values()].filter((o) => o.kind !== 'done').length + ' working order(s)');
    this.emit('state');
  }

  lost(why) {
    if (this.state === 'idle') return;
    if (this.state !== 'disconnected') this.record('disconnect', '', 'locked', why);
    this.state = 'disconnected'; this.message = why;
    for (const o of this.orders.values()) if (o.pendingAck) { o.pendingAck = false; o.kind = 'unknown'; }
    this.emit('state');
  }
  async close(quiet) {
    const ps = [this.order, this.pnl, this.ticker].filter(Boolean);
    this.state = 'idle';
    this.order = this.pnl = this.ticker = null;
    await Promise.all(ps.map((p) => p.close()));
    this.target = null;
    if (!quiet) this.record('logout', '', 'ok');
    this.emit('state');
  }

  // ---- market data for the stale-price guard (this login's own ticker plant) ----
  async resolveContract(root) {
    if (this.contracts.has(root)) return this.contracts.get(root);
    const ins = INSTRUMENTS[root]; if (!ins || !this.ticker) return null;
    try {
      const r = await this.ticker.request({ template_id: T.FRONT_MONTH, symbol: root, exchange: ins.ex, need_updates: false }, T.FRONT_MONTH_R);
      const c = r.final.trading_symbol || r.final.symbol_name || '';
      if (!r.noData && contractOk(root, c)) { this.contracts.set(root, c); return c; }
    } catch (e) {}
    return null;
  }
  async watch(symbol, exchange) {
    if (!this.ticker || this.quotes.has(symbol)) return;
    this.quotes.set(symbol, { bid: null, ask: null, last: null, at: 0 });
    try { await this.ticker.request({ template_id: T.MD_UPDATE, symbol, exchange, request: 1, update_bits: 3 }, T.MD_UPDATE_R); }
    catch (e) { this.quotes.delete(symbol); throw e; }
  }
  quote(symbol) { return this.quotes.get(symbol) || null; }
  fresh(symbol) { const q = this.quotes.get(symbol); return !!(q && q.at && this.now() - q.at <= LIMITS.staleMs && (q.bid != null || q.last != null)); }

  // ---- notifications ----
  onPush(m, infra) {
    const tid = m.template_id;
    if (tid === T.LAST_TRADE || tid === T.BBO) {
      const q = this.quotes.get(m.symbol); if (!q) return;
      if (tid === T.LAST_TRADE && m.trade_price != null) q.last = m.trade_price;
      if (tid === T.BBO) { if (m.bid_price != null) q.bid = m.bid_price; if (m.ask_price != null) q.ask = m.ask_price; }
      q.at = this.now();
      this.emit('quote', { symbol: m.symbol });
      return;
    }
    if (tid === T.RITHMIC_ORDER_NOTIFY && m.basket_id) {
      const o = this.orders.get(m.basket_id) || { basket: m.basket_id };
      const kind = statusKind(m);
      Object.assign(o, { account: m.account_id || o.account, symbol: m.symbol || o.symbol, exchange: m.exchange || o.exchange,
        side: m.transaction_type === 1 ? 'buy' : m.transaction_type === 2 ? 'sell' : o.side,
        type: ({ 1: 'limit', 2: 'market', 3: 'stop_limit', 4: 'stop' })[m.price_type] || o.type,
        qty: num(m.quantity_64) ?? o.qty, price: num(m.price) ?? o.price, trigger: num(m.trigger_price) ?? o.trigger,
        filled: num(m.total_fill_size_64) ?? o.filled ?? 0, avgFill: num(m.avg_fill_price) ?? o.avgFill,
        status: m.status || o.status || '', reason: m.completion_reason || m.text || o.reason || '', kind,
        parent: m.original_basket_id && m.original_basket_id !== m.basket_id ? m.original_basket_id : o.parent, tag: m.user_tag || o.tag, pendingAck: false });
      if (o.parent) o.role = o.type === 'limit' ? 'tp' : 'sl';
      this.orders.set(m.basket_id, o);
      this.emit('orders');
      return;
    }
    if (tid === T.EXCHANGE_ORDER_NOTIFY && m.notify_type === 5) {
      this.fills.unshift({ basket: m.basket_id, account: m.account_id, symbol: m.symbol, side: m.transaction_type === 1 ? 'buy' : 'sell', qty: num(m.fill_size_64), price: num(m.fill_price), id: m.fill_id, at: this.now() });
      if (this.fills.length > 50) this.fills.length = 50;
      this.record('fill', m.account_id, 'filled', (m.transaction_type === 1 ? 'Buy ' : 'Sell ') + num(m.fill_size_64) + ' ' + m.symbol + ' @ ' + num(m.fill_price));
      this.emit('fills');
      return;
    }
    if (tid === T.BRACKET_UPDATE && m.basket_id) { this.bracket.set(m.basket_id, { tp: num(m.target_ticks), sl: num(m.stop_ticks) }); this.emit('orders'); return; }
    if (tid === T.PNL_INSTRUMENT && m.account_id && m.symbol) {
      this.positions.set(m.account_id + '|' + m.symbol, { account: m.account_id, symbol: m.symbol, exchange: m.exchange, net: num(m.net_quantity) || 0, avg: num(m.avg_open_fill_price), openPnl: num(m.open_position_pnl) });
      this.emit('position'); return;
    }
    if (tid === T.PNL_ACCOUNT && m.account_id) {
      const a = this.acctPnl.get(m.account_id) || {};
      this.acctPnl.set(m.account_id, { balance: num(m.account_balance) ?? a.balance ?? null, openPnl: num(m.open_position_pnl) ?? a.openPnl ?? null, dayPnl: num(m.day_pnl) ?? a.dayPnl ?? null });
      this.emit('account'); return;
    }
  }
  working(account) { return [...this.orders.values()].filter((o) => (!account || o.account === account) && o.kind !== 'done'); }
  position(account, symbol) { return this.positions.get(account + '|' + symbol) || null; }
  hasExposure(account) { return this.working(account).length > 0 || [...this.positions.values()].some((p) => p.account === account && p.net !== 0); }

  // ---- guards ----
  #acct(id) { const a = this.accounts.find((x) => x.id === id); if (!a) throw new Error('Unknown account'); return a; }
  #issue(o) { const t = Object.freeze(o); this.#issued.add(t); return t; }
  #noUnknown() { if (this.unknownOrder) throw new Error('An earlier order got no answer, so its status is unknown. Log in again to reconcile with Rithmic before new orders.'); }
  #needReady() { if (!this.ready) throw new Error(this.state === 'disconnected' ? 'Disconnected: trading is locked until you reconnect.' : 'Not connected'); }
  #rate() {
    const t = this.now(); this.actions = this.actions.filter((x) => t - x < LIMITS.rateMs);
    if (this.actions.length >= LIMITS.rateN) throw new Error('Too many orders: wait a few seconds.');
    this.actions.push(t);
  }
  #priceCheck(symbol, ins, px, label) {
    if (!this.fresh(symbol)) throw new Error('Prices are stale (no update in the last ' + LIMITS.staleMs / 1000 + ' s). Order blocked.');
    if (px == null) return;
    if (!(px > 0) || !onTick(px, ins.tick)) throw new Error(label + ' must be on the ' + ins.tick + ' tick.');
    const q = this.quote(symbol), ref = q.last ?? (q.bid != null && q.ask != null ? (q.bid + q.ask) / 2 : q.bid ?? q.ask);
    if (Math.abs(px - ref) > LIMITS.bandTicks * ins.tick) throw new Error(label + ' is too far from the market (more than ' + LIMITS.bandTicks + ' ticks).');
  }

  // Build + check a new order. Returns a FROZEN ticket: the confirm sheet shows it and submit() sends exactly it.
  prepare({ account, root, contract, side, type, qty, price, trigger, tpTicks, slTicks }) {
    this.#needReady(); this.#noUnknown();
    const a = this.#acct(account);
    const ins = INSTRUMENTS[root]; if (!ins) throw new Error('This instrument is not enabled for trading.');
    const symbol = contract || this.contracts.get(root);
    if (!contractOk(root, symbol)) throw new Error('Contract not confirmed: enter it (for example ' + root + 'Z6).');
    if (!(side in SIDE)) throw new Error('Pick buy or sell');
    if (!['market', 'limit', 'stop'].includes(type)) throw new Error('Order type must be market, limit or stop');
    const q = Number(qty);
    if (!Number.isInteger(q) || q < 1) throw new Error('Quantity must be a whole number of contracts');
    if (q > this.maxQty) throw new Error('Max ' + this.maxQty + ' contract' + (this.maxQty > 1 ? 's' : '') + ' per order (admin setting, hard cap ' + LIMITS.hardMaxQty + ').');
    const px = type === 'limit' ? Number(price) : null, tg = type === 'stop' ? Number(trigger) : null;
    this.#priceCheck(symbol, ins, type === 'limit' ? px : type === 'stop' ? tg : null, type === 'limit' ? 'Limit price' : 'Stop price');
    if (type === 'stop') {
      const qt = this.quote(symbol), ref = qt.last ?? (side === 'buy' ? qt.ask : qt.bid);
      if (side === 'buy' ? !(tg > ref) : !(tg < ref)) throw new Error(side === 'buy' ? 'A buy stop must be above the market.' : 'A sell stop must be below the market.');
    }
    const tp = tpTicks ? Number(tpTicks) : 0, sl = slTicks ? Number(slTicks) : 0;
    for (const [v, n] of [[tp, 'Take profit'], [sl, 'Stop loss']]) if (v && (!Number.isInteger(v) || v < 1 || v > LIMITS.bandTicks)) throw new Error(n + ' must be 1 to ' + LIMITS.bandTicks + ' ticks');
    const route = this.routes[ins.ex];
    if (!route) throw new Error('No trade route for ' + ins.ex + ' on this login.');
    const msg = { template_id: (tp || sl) ? T.BRACKET_ORDER : T.NEW_ORDER, fcm_id: a.fcm_id, ib_id: a.ib_id, account_id: a.id, symbol, exchange: ins.ex,
      quantity_64: q, transaction_type: SIDE[side], duration: DURATION_DAY, price_type: PRICE_TYPE[type], trade_route: route, manual_or_auto: MANUAL, user_tag: newTag(), window_name: 'TradeZoro' };
    if (px != null) msg.price = px;
    if (tg != null) msg.trigger_price = tg;
    if (tp || sl) Object.assign(msg, { user_type: USER_TYPE_TRADER, bracket_type: tp && sl ? BRACKET_TYPE.both : tp ? BRACKET_TYPE.target : BRACKET_TYPE.stop,
      ...(tp ? { target_quantity_64: [q], target_ticks: [tp] } : {}), ...(sl ? { stop_quantity_64: [q], stop_ticks: [sl] } : {}) });
    return this.#issue({ kind: 'new', account: a.id, root, symbol, side, type, qty: q, price: px, trigger: tg, tpTicks: tp || null, slTicks: sl || null, msg: Object.freeze(msg) });
  }
  // Send a prepared ticket. Guards run again (prices can go stale while the confirm sheet is open).
  async submit(tk) {
    if (!tk || tk.kind !== 'new' || !this.#issued.has(tk)) throw new Error('Not a prepared order');
    const label = (tk.side === 'buy' ? 'Buy ' : 'Sell ') + tk.qty + ' ' + tk.symbol + ' ' + tk.type + (tk.price != null ? ' @ ' + tk.price : tk.trigger != null ? ' stop ' + tk.trigger : '') + (tk.msg.template_id === T.BRACKET_ORDER ? ' +bracket TP ' + (tk.tpTicks || '-') + ' / SL ' + (tk.slTicks || '-') + ' ticks' : '');
    try {
      this.#needReady(); this.#noUnknown();
      if (this.inflight) throw new Error('An order is already being sent');
      this.#priceCheck(tk.symbol, INSTRUMENTS[tk.root], tk.price ?? tk.trigger, tk.price != null ? 'Limit price' : 'Stop price');
      this.#rate();
    } catch (e) { this.record('new order', tk.account, 'blocked', label + ': ' + e.message); throw e; }
    this.inflight = true;
    try {
      const r = await this.order.request(tk.msg, tk.msg.template_id + 1);
      const basket = r.final.basket_id || (r.rows[0] && r.rows[0].basket_id) || '';
      if (basket && !this.orders.has(basket)) this.orders.set(basket, { basket, account: tk.account, symbol: tk.symbol, side: tk.side, type: tk.type, qty: tk.qty, price: tk.price, trigger: tk.trigger, filled: 0, kind: 'working', status: 'sent', tag: tk.msg.user_tag });
      this.record('new order', tk.account, 'accepted', label + (basket ? ' (order ' + basket + ')' : ''));
      this.emit('orders');
      return { basket };
    } catch (e) {
      // A timeout is UNKNOWN, never retried: the order may be live on Rithmic. Reconnect / Rithmic's notifications tell the truth.
      if (e.timeout) this.#unknown = true;   // blocks new orders until a fresh login reconciles (risk-reducing actions still go)
      this.record('new order', tk.account, e.timeout ? 'unknown (no answer, not re-sent)' : 'rejected', label + ': ' + e.message);
      throw e;
    } finally { this.inflight = false; }
  }
  prepareModify(basket, { price, trigger }) {
    this.#needReady(); this.#noUnknown();
    const o = this.orders.get(basket);
    if (!o || o.kind === 'done') throw new Error('That order is no longer working.');
    if (o.type === 'market') throw new Error('Market orders cannot be moved');
    const root = rootOfSymbol(o.symbol), ins = INSTRUMENTS[root]; if (!ins) throw new Error('Unknown instrument');
    const a = this.#acct(o.account);
    const msg = { template_id: T.MODIFY_ORDER, fcm_id: a.fcm_id, ib_id: a.ib_id, account_id: a.id, basket_id: basket, symbol: o.symbol, exchange: o.exchange || ins.ex,
      quantity_64: Math.max(1, (o.qty || 1) - (o.filled || 0)), price_type: PRICE_TYPE[o.type] || PRICE_TYPE.limit, manual_or_auto: MANUAL, window_name: 'TradeZoro' };
    if (o.type === 'limit') msg.price = roundTick(Number(price), ins.tick); else msg.trigger_price = roundTick(Number(trigger ?? price), ins.tick);
    this.#priceCheck(o.symbol, ins, msg.price ?? msg.trigger_price, o.type === 'limit' ? 'Limit price' : 'Stop price');
    return this.#issue({ kind: 'modify', account: a.id, basket, root, symbol: o.symbol, from: o.type === 'limit' ? o.price : o.trigger, to: msg.price ?? msg.trigger_price, order: { ...o }, msg: Object.freeze(msg) });
  }
  async submitModify(tk) {
    if (!tk || tk.kind !== 'modify' || !this.#issued.has(tk)) throw new Error('Not a prepared modify');
    const label = 'order ' + tk.basket + ' ' + tk.from + ' -> ' + tk.to;
    try {
      this.#needReady();
      const o = this.orders.get(tk.basket); if (!o || o.kind === 'done') throw new Error('That order is no longer working.');
      this.#priceCheck(tk.symbol, INSTRUMENTS[tk.root], tk.to, 'Price');
      this.#rate();
    } catch (e) { this.record('modify', tk.account, 'blocked', label + ': ' + e.message); throw e; }
    try { await this.order.request(tk.msg, T.MODIFY_ORDER_R); this.record('modify', tk.account, 'accepted', label); }
    catch (e) { if (e.timeout) this.#unknown = true; this.record('modify', tk.account, e.timeout ? 'unknown (not re-sent)' : 'rejected', label + ': ' + e.message); throw e; }
  }
  async cancel(basket) {
    const o = this.orders.get(basket);
    try { this.#needReady(); if (!o) throw new Error('Unknown order'); } catch (e) { this.record('cancel', o && o.account, 'blocked', basket + ': ' + e.message); throw e; }
    const a = this.#acct(o.account);
    try { await this.order.request({ template_id: T.CANCEL_ORDER, fcm_id: a.fcm_id, ib_id: a.ib_id, account_id: a.id, basket_id: basket, manual_or_auto: MANUAL, window_name: 'TradeZoro' }, T.CANCEL_ORDER_R); this.record('cancel', a.id, 'accepted', 'order ' + basket); }
    catch (e) { this.record('cancel', a.id, 'rejected', basket + ': ' + e.message); throw e; }
  }
  async cancelAll(account) {
    let a; try { this.#needReady(); a = this.#acct(account); } catch (e) { this.record('cancel all', account, 'blocked', e.message); throw e; }
    try { await this.order.request({ template_id: T.CANCEL_ALL, fcm_id: a.fcm_id, ib_id: a.ib_id, account_id: a.id, user_type: USER_TYPE_TRADER, manual_or_auto: MANUAL }, T.CANCEL_ALL_R); this.record('cancel all', a.id, 'accepted'); }
    catch (e) { this.record('cancel all', a.id, 'rejected', e.message); throw e; }
  }
  // Exit position: Rithmic sends the closing order(s). No symbol = every position on the account.
  async exitPosition(account, symbol, exchange) {
    let a; try { this.#needReady(); a = this.#acct(account); } catch (e) { this.record('exit position', account, 'blocked', e.message); throw e; }
    const msg = { template_id: T.EXIT_POSITION, fcm_id: a.fcm_id, ib_id: a.ib_id, account_id: a.id, manual_or_auto: MANUAL, window_name: 'TradeZoro' };
    if (symbol && exchange) Object.assign(msg, { symbol, exchange });
    try { await this.order.request(msg, T.EXIT_POSITION_R); this.record('exit position', a.id, 'accepted', symbol || 'all'); }
    catch (e) { this.record('exit position', a.id, 'rejected', e.message); throw e; }
  }
  // Kill switch: cancel every working order FIRST (so nothing re-opens the position), then exit every position.
  // Skips the price / rate / in-flight checks; never the connection or target checks.
  async flatten(account) {
    this.record('flatten', account, 'start');
    const errs = [];
    try { await this.cancelAll(account); } catch (e) { errs.push('cancel all: ' + e.message); }
    try { await this.exitPosition(account); } catch (e) { errs.push('exit: ' + e.message); }
    this.record('flatten', account, errs.length ? 'partial' : 'sent', errs.join('; '));
    if (errs.length) throw new Error(errs.join('; '));
  }
}
