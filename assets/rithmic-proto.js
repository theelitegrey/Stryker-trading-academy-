// TradeZoro — minimal R|Protocol (Rithmic) protobuf codec (ES module)
// Depends on: nothing. Imported by assets/rithmic-client.js (browser) and
// tools/tests/rithmic-mock.mjs (Node test mock), so it must stay runtime-neutral.
//
// R|Protocol is protobuf-over-WebSocket: every binary frame is ONE serialized message,
// no length prefix, and every message carries `template_id` (field 154467) so the
// receiver can pick the schema. This file hand-rolls the tiny subset of protobuf we
// need (varint, double, string, bool, repeated scalars) instead of loading protobufjs.
//
// Field numbers below were taken from the public .proto definitions shipped in the
// MIT-licensed async_rithmic project (github.com/rundef/async_rithmic, v1.6.6,
// Copyright (c) 2024 Mickael Burguet), read field-by-field from its compiled
// descriptors. Only READ-ONLY messages are listed: the Charts data feed, plus (Journal import,
// 2026-10-30) login info, account list, order history, today's orders and the PnL snapshot.
// No order-entry message (new / modify / cancel / bracket / OCO / exit / link) is defined here on
// purpose: encode() throws for a template that is not in SCHEMA, so an order cannot be built.

export const T = {
  LOGIN: 10, LOGIN_R: 11, LOGOUT: 12, LOGOUT_R: 13,
  SYSTEM_INFO: 16, SYSTEM_INFO_R: 17, HEARTBEAT: 18, HEARTBEAT_R: 19,
  REJECT: 75, FORCED_LOGOUT: 77,
  MD_UPDATE: 100, MD_UPDATE_R: 101,
  FRONT_MONTH: 113, FRONT_MONTH_R: 114,
  LAST_TRADE: 150, BBO: 151, ORDER_BOOK: 156,
  TIME_BAR_REPLAY: 202, TIME_BAR_REPLAY_R: 203,
  // Order plant, read only (Journal import)
  LOGIN_INFO: 300, LOGIN_INFO_R: 301, ACCOUNT_LIST: 302, ACCOUNT_LIST_R: 303,
  OH_DATES: 318, OH_DATES_R: 319, SHOW_ORDERS: 320, SHOW_ORDERS_R: 321,
  OH_SUMMARY: 324, OH_SUMMARY_R: 325, OH_DETAIL: 326, OH_DETAIL_R: 327,
  RITHMIC_ORDER_NOTIFY: 351, EXCHANGE_ORDER_NOTIFY: 352,
  // PnL plant, read only
  PNL_SNAPSHOT: 402, PNL_SNAPSHOT_R: 403, PNL_INSTRUMENT: 450, PNL_ACCOUNT: 451
};
// ExchangeOrderNotification.notify_type / transaction_type (enum values from the kit's .proto)
export const NOTIFY = { STATUS: 1, MODIFY: 2, CANCEL: 3, TRIGGER: 4, FILL: 5, REJECT: 6, NOT_MODIFIED: 7, NOT_CANCELLED: 8, GENERIC: 9 };
export const TX_TYPE = { BUY: 1, SELL: 2, SELL_SHORT: 3 };

export const INFRA = { TICKER_PLANT: 1, ORDER_PLANT: 2, HISTORY_PLANT: 3, PNL_PLANT: 4, REPOSITORY_PLANT: 5 };
export const UPDATE_BITS = { LAST_TRADE: 1, BBO: 2, ORDER_BOOK: 4 };
// OrderBook.update_type: 1 clear, 2 no book, 3 snapshot image, 4 begin, 5 middle, 6 end, 7 solo
export const BOOK_UPDATE = { CLEAR: 1, NO_BOOK: 2, SNAPSHOT: 3, BEGIN: 4, MIDDLE: 5, END: 6, SOLO: 7 };
export const MD_REQUEST = { SUBSCRIBE: 1, UNSUBSCRIBE: 2 };
export const BAR_TYPE = { SECOND_BAR: 1, MINUTE_BAR: 2, DAILY_BAR: 3, WEEKLY_BAR: 4 };
export const DIRECTION = { FIRST: 1, LAST: 2 };
export const TIME_ORDER = { FORWARDS: 1, BACKWARDS: 2 };

// kinds: i32 (int32/enum, varint), u32, u64 (varint), dbl (fixed64 double), str, bool.
// A trailing '*' marks a repeated field.
const COMMON = { template_id: [154467, 'i32'], user_msg: [132760, 'str*'], rp_code: [132766, 'str*'] };
const SYMEX = { symbol: [110100, 'str'], exchange: [110101, 'str'] };

const ACCT = { fcm_id: [154013, 'str'], ib_id: [154014, 'str'], account_id: [154008, 'str'] };
// Fields shared by ExchangeOrderNotification (352) and RithmicOrderNotification (351). Sizes use the 64-bit
// fields (the int32 ones are deprecated); fill_size shares its field number with the deprecated int32.
const ORDER_NOTE = { ...ACCT, ...SYMEX, notify_type: [153625, 'i32'], is_snapshot: [110121, 'bool'], status: [110303, 'str'],
  basket_id: [110300, 'str'], exchange_order_id: [149238, 'str'], instrument_type: [110116, 'str'], trade_route: [112016, 'str'],
  commission_fill_rate: [156969, 'str'], quantity: [112004, 'i32'], quantity_64: [159017, 'u64'], price: [110306, 'dbl'],
  transaction_type: [112003, 'i32'], price_type: [112008, 'i32'], avg_fill_price: [110322, 'dbl'],
  total_fill_size: [154111, 'i32'], total_fill_size_64: [159019, 'u64'], total_unfilled_size: [154112, 'i32'], total_unfilled_size_64: [159020, 'u64'],
  currency: [154382, 'str'], text: [120008, 'str'], report_text: [120028, 'str'], completion_reason: [149273, 'str'],
  ssboe: [150100, 'i32'], usecs: [150101, 'i32'] };

export const SCHEMA = {
  [T.SYSTEM_INFO]: { ...COMMON },
  [T.SYSTEM_INFO_R]: { ...COMMON, system_name: [153628, 'str*'], has_aggregated_quotes: [153649, 'bool*'] },
  [T.LOGIN]: { ...COMMON, template_version: [153634, 'str'], user: [131003, 'str'], password: [130004, 'str'],
    app_name: [130002, 'str'], app_version: [131803, 'str'], system_name: [153628, 'str'], infra_type: [153621, 'i32'],
    mac_addr: [144108, 'str*'], os_version: [144021, 'str'], os_platform: [144020, 'str'], aggregated_quotes: [153644, 'bool'] },
  [T.LOGIN_R]: { ...COMMON, template_version: [153634, 'str'], fcm_id: [154013, 'str'], ib_id: [154014, 'str'],
    country_code: [154712, 'str'], state_code: [154713, 'str'], unique_user_id: [153428, 'str'], heartbeat_interval: [153633, 'dbl'] },
  [T.LOGOUT]: { ...COMMON },
  [T.LOGOUT_R]: { ...COMMON },
  [T.HEARTBEAT]: { ...COMMON, ssboe: [150100, 'i32'], usecs: [150101, 'i32'] },
  [T.HEARTBEAT_R]: { ...COMMON, ssboe: [150100, 'i32'], usecs: [150101, 'i32'] },
  [T.REJECT]: { ...COMMON },
  [T.FORCED_LOGOUT]: { ...COMMON },
  [T.MD_UPDATE]: { ...COMMON, ...SYMEX, request: [100000, 'i32'], update_bits: [154211, 'u32'] },
  [T.MD_UPDATE_R]: { ...COMMON },
  [T.FRONT_MONTH]: { ...COMMON, ...SYMEX, need_updates: [154352, 'bool'] },
  [T.FRONT_MONTH_R]: { ...COMMON, ...SYMEX, is_front_month_symbol: [149166, 'bool'], symbol_name: [100003, 'str'],
    trading_symbol: [157095, 'str'], trading_exchange: [157096, 'str'] },
  [T.LAST_TRADE]: { template_id: [154467, 'i32'], ...SYMEX, presence_bits: [149138, 'u32'], clear_bits: [154571, 'u32'],
    is_snapshot: [110121, 'bool'], trade_price: [100006, 'dbl'], trade_size: [100178, 'i32'], aggressor: [112003, 'i32'],
    net_change: [100011, 'dbl'], volume: [100032, 'u64'], vwap: [101379, 'dbl'], trade_time: [100379, 'str'],
    ssboe: [150100, 'i32'], usecs: [150101, 'i32'], source_ssboe: [150400, 'i32'], source_usecs: [150401, 'i32'] },
  [T.BBO]: { template_id: [154467, 'i32'], ...SYMEX, presence_bits: [149138, 'u32'], clear_bits: [154571, 'u32'],
    is_snapshot: [110121, 'bool'], bid_price: [100022, 'dbl'], bid_size: [100030, 'i32'], ask_price: [100025, 'dbl'],
    ask_size: [100031, 'i32'], ssboe: [150100, 'i32'], usecs: [150101, 'i32'] },
  // Order book (market depth, template 156): parallel price / size arrays per side; the deprecated int32 size
  // fields are not used, only the 64-bit ones. Packed or unpacked repeated numbers both decode (see decode()).
  [T.ORDER_BOOK]: { template_id: [154467, 'i32'], ...SYMEX, presence_bits: [149138, 'u32'], update_type: [157608, 'i32'],
    bid_price: [154282, 'dbl*'], bid_size: [159004, 'u64*'], ask_price: [154284, 'dbl*'], ask_size: [159006, 'u64*'],
    ssboe: [150100, 'i32'], usecs: [150101, 'i32'] },
  [T.TIME_BAR_REPLAY]: { ...COMMON, ...SYMEX, bar_type: [119200, 'i32'], bar_type_period: [119112, 'i32'],
    start_index: [153002, 'i32'], finish_index: [153003, 'i32'], user_max_count: [154020, 'i32'],
    direction: [149253, 'i32'], time_order: [149307, 'i32'], resume_bars: [153642, 'bool'] },
  [T.TIME_BAR_REPLAY_R]: { ...COMMON, request_key: [132758, 'str'], rq_handler_rp_code: [132764, 'str*'], ...SYMEX,
    type: [119200, 'i32'], period: [119112, 'str'], marker: [119100, 'i32'], num_trades: [119109, 'u64'],
    volume: [119110, 'u64'], bid_volume: [119117, 'u64'], ask_volume: [119118, 'u64'], open_price: [100019, 'dbl'],
    close_price: [100021, 'dbl'], high_price: [100012, 'dbl'], low_price: [100013, 'dbl'] },
  // ---- order plant, read only (no order entry template exists in this file) ----
  [T.LOGIN_INFO]: { ...COMMON },
  [T.LOGIN_INFO_R]: { ...COMMON, fcm_id: [154013, 'str'], ib_id: [154014, 'str'], user_type: [154036, 'i32'], op_max_session_count: [140012, 'i32'] },
  [T.ACCOUNT_LIST]: { ...COMMON, fcm_id: [154013, 'str'], ib_id: [154014, 'str'], user_type: [154036, 'i32'] },
  [T.ACCOUNT_LIST_R]: { ...COMMON, rq_handler_rp_code: [132764, 'str*'], ...ACCT, account_name: [154002, 'str'], account_currency: [154383, 'str'] },
  [T.OH_DATES]: { ...COMMON },
  [T.OH_DATES_R]: { ...COMMON, rq_handler_rp_code: [132764, 'str*'], date: [110615, 'str*'] },
  [T.SHOW_ORDERS]: { ...COMMON, ...ACCT },
  [T.SHOW_ORDERS_R]: { ...COMMON },
  [T.OH_SUMMARY]: { ...COMMON, ...ACCT, date: [110615, 'str'] },
  [T.OH_SUMMARY_R]: { ...COMMON },
  [T.OH_DETAIL]: { ...COMMON, ...ACCT, basket_id: [110300, 'str'], date: [110615, 'str'] },
  [T.OH_DETAIL_R]: { ...COMMON },
  [T.RITHMIC_ORDER_NOTIFY]: { template_id: [154467, 'i32'], ...ORDER_NOTE },
  [T.EXCHANGE_ORDER_NOTIFY]: { template_id: [154467, 'i32'], ...ORDER_NOTE, report_type: [120001, 'str'],
    fill_price: [110307, 'dbl'], fill_size: [110308, 'i32'], fill_size_64: [159024, 'u64'], fill_time: [110309, 'str'], fill_date: [110310, 'str'],
    fill_id: [110311, 'str'], source_ssboe: [150400, 'i32'], source_usecs: [150401, 'i32'] },
  // ---- PnL plant, read only ----
  [T.PNL_SNAPSHOT]: { ...COMMON, ...ACCT },
  [T.PNL_SNAPSHOT_R]: { ...COMMON },
  [T.PNL_INSTRUMENT]: { template_id: [154467, 'i32'], is_snapshot: [110121, 'bool'], ...ACCT, ...SYMEX, fill_buy_qty: [154041, 'i32'], fill_sell_qty: [154042, 'i32'],
    day_pnl: [157956, 'dbl'], day_closed_pnl: [157955, 'dbl'], closed_position_pnl: [156963, 'str'], closed_position_quantity: [156964, 'i32'], net_quantity: [156967, 'i32'] },
  [T.PNL_ACCOUNT]: { template_id: [154467, 'i32'], is_snapshot: [110121, 'bool'], ...ACCT, fill_buy_qty: [154041, 'i32'], fill_sell_qty: [154042, 'i32'],
    day_pnl: [157956, 'str'], day_closed_pnl: [157955, 'str'], closed_position_pnl: [156963, 'str'], closed_position_quantity: [156964, 'i32'],
    rms_account_commission: [157113, 'str'], account_balance: [156970, 'str'] }
};

// ---- encoding ------------------------------------------------------------------------
const enc = new TextEncoder();
const dec = new TextDecoder();

function pushVarint(out, n) {
  // n: non-negative integer up to 2^53, or a negative int32 (encoded as 10-byte two's complement).
  if (n < 0) {
    let big = BigInt.asUintN(64, BigInt(Math.trunc(n)));
    while (big >= 0x80n) { out.push(Number(big & 0x7fn) | 0x80); big >>= 7n; }
    out.push(Number(big));
    return;
  }
  n = Math.trunc(n);
  while (n >= 0x80) { out.push((n % 0x80) | 0x80); n = Math.floor(n / 0x80); }
  out.push(n);
}
const pushKey = (out, field, wire) => pushVarint(out, field * 8 + wire);

export function encode(msg) {
  const schema = SCHEMA[msg.template_id];
  if (!schema) throw new Error('rithmic-proto: unknown template ' + msg.template_id);
  const out = [];
  for (const name of Object.keys(msg)) {
    const spec = schema[name];
    const v = msg[name];
    if (!spec || v == null) continue;
    const [field, kindRaw] = spec;
    const rep = kindRaw.endsWith('*');
    const kind = rep ? kindRaw.slice(0, -1) : kindRaw;
    for (const x of rep ? (Array.isArray(v) ? v : [v]) : [v]) {
      if (kind === 'str') {
        const b = enc.encode(String(x));
        pushKey(out, field, 2); pushVarint(out, b.length);
        for (let i = 0; i < b.length; i++) out.push(b[i]);
      } else if (kind === 'dbl') {
        pushKey(out, field, 1);
        const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, Number(x), true);
        for (let i = 0; i < 8; i++) out.push(dv.getUint8(i));
      } else if (kind === 'bool') {
        pushKey(out, field, 0); out.push(x ? 1 : 0);
      } else {
        pushKey(out, field, 0); pushVarint(out, Number(x));
      }
    }
  }
  return new Uint8Array(out);
}

// ---- decoding ------------------------------------------------------------------------
function readVarint(buf, st) {
  let lo = 0, mul = 1, b;
  let big = null, shift = 0n;
  do {
    if (st.i >= buf.length) throw new Error('rithmic-proto: truncated varint');
    b = buf[st.i++];
    if (big === null && mul < 2 ** 49) { lo += (b & 0x7f) * mul; mul *= 128; }
    else {
      if (big === null) { big = BigInt(lo); shift = BigInt(Math.round(Math.log2(mul))); }
      big += BigInt(b & 0x7f) << shift; shift += 7n;
    }
  } while (b & 0x80);
  return big === null ? lo : big;
}
const toInt32 = (v) => {
  const big = typeof v === 'bigint' ? v : BigInt(v);
  return Number(BigInt.asIntN(32, big));
};

export function decode(input) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const st = { i: 0 };
  const raw = [];
  while (st.i < buf.length) {
    const key = readVarint(buf, st);
    const k = typeof key === 'bigint' ? Number(key) : key;
    const field = Math.floor(k / 8), wire = k % 8;
    let v;
    if (wire === 0) v = readVarint(buf, st);
    else if (wire === 1) { v = buf.subarray(st.i, st.i + 8); st.i += 8; }
    else if (wire === 2) { const len = Number(readVarint(buf, st)); v = buf.subarray(st.i, st.i + len); st.i += len; }
    else if (wire === 5) { v = buf.subarray(st.i, st.i + 4); st.i += 4; }
    else throw new Error('rithmic-proto: unsupported wire type ' + wire);
    if (st.i > buf.length) throw new Error('rithmic-proto: truncated field ' + field);
    raw.push([field, wire, v]);
  }
  const tidRaw = raw.find((r) => r[0] === 154467);
  const template_id = tidRaw ? toInt32(tidRaw[2]) : 0;
  const schema = SCHEMA[template_id] || COMMON;
  const byField = {};
  for (const name of Object.keys(schema)) byField[schema[name][0]] = [name, schema[name][1]];
  const msg = { template_id };
  for (const [field, wire, v] of raw) {
    const m = byField[field];
    if (!m || field === 154467) continue;
    const [name, kindRaw] = m;
    const rep = kindRaw.endsWith('*');
    const kind = rep ? kindRaw.slice(0, -1) : kindRaw;
    if (rep && wire === 2 && (kind === 'dbl' || kind === 'u64' || kind === 'u32' || kind === 'i32')) {   // packed repeated numbers
      const arr = msg[name] = msg[name] || [];
      if (kind === 'dbl') { const dv = new DataView(v.buffer, v.byteOffset, v.length); for (let o = 0; o + 8 <= v.length; o += 8) arr.push(dv.getFloat64(o, true)); }
      else { const st2 = { i: 0 }; while (st2.i < v.length) { const n = readVarint(v, st2); arr.push(kind === 'i32' ? toInt32(n) : (typeof n === 'bigint' ? Number(n) : n)); } }
      continue;
    }
    let x;
    if (kind === 'str') x = wire === 2 ? dec.decode(v) : '';
    else if (kind === 'dbl') x = wire === 1 ? new DataView(v.buffer, v.byteOffset, 8).getFloat64(0, true) : 0;
    else if (kind === 'bool') x = Number(v) !== 0;
    else if (kind === 'i32') x = toInt32(v);
    else x = typeof v === 'bigint' ? Number(v) : v; // u32 / u64 (u64 above 2^53 loses precision: fine for volumes)
    if (rep) (msg[name] = msg[name] || []).push(x);
    else msg[name] = x;
  }
  return msg;
}
