// Stryker Trading Academy — minimal R|Protocol (Rithmic) protobuf codec (ES module)
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
// descriptors. Only the messages the Charts data feed needs are listed; no order,
// account or PnL messages are defined here on purpose (the feature is read-only).

export const T = {
  LOGIN: 10, LOGIN_R: 11, LOGOUT: 12, LOGOUT_R: 13,
  SYSTEM_INFO: 16, SYSTEM_INFO_R: 17, HEARTBEAT: 18, HEARTBEAT_R: 19,
  REJECT: 75, FORCED_LOGOUT: 77,
  MD_UPDATE: 100, MD_UPDATE_R: 101,
  FRONT_MONTH: 113, FRONT_MONTH_R: 114,
  LAST_TRADE: 150, BBO: 151,
  TIME_BAR_REPLAY: 202, TIME_BAR_REPLAY_R: 203
};

export const INFRA = { TICKER_PLANT: 1, ORDER_PLANT: 2, HISTORY_PLANT: 3, PNL_PLANT: 4, REPOSITORY_PLANT: 5 };
export const UPDATE_BITS = { LAST_TRADE: 1, BBO: 2 };
export const MD_REQUEST = { SUBSCRIBE: 1, UNSUBSCRIBE: 2 };
export const BAR_TYPE = { SECOND_BAR: 1, MINUTE_BAR: 2, DAILY_BAR: 3, WEEKLY_BAR: 4 };
export const DIRECTION = { FIRST: 1, LAST: 2 };
export const TIME_ORDER = { FORWARDS: 1, BACKWARDS: 2 };

// kinds: i32 (int32/enum, varint), u32, u64 (varint), dbl (fixed64 double), str, bool.
// A trailing '*' marks a repeated field.
const COMMON = { template_id: [154467, 'i32'], user_msg: [132760, 'str*'], rp_code: [132766, 'str*'] };
const SYMEX = { symbol: [110100, 'str'], exchange: [110101, 'str'] };

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
  [T.TIME_BAR_REPLAY]: { ...COMMON, ...SYMEX, bar_type: [119200, 'i32'], bar_type_period: [119112, 'i32'],
    start_index: [153002, 'i32'], finish_index: [153003, 'i32'], user_max_count: [154020, 'i32'],
    direction: [149253, 'i32'], time_order: [149307, 'i32'], resume_bars: [153642, 'bool'] },
  [T.TIME_BAR_REPLAY_R]: { ...COMMON, request_key: [132758, 'str'], rq_handler_rp_code: [132764, 'str*'], ...SYMEX,
    type: [119200, 'i32'], period: [119112, 'str'], marker: [119100, 'i32'], num_trades: [119109, 'u64'],
    volume: [119110, 'u64'], bid_volume: [119117, 'u64'], ask_volume: [119118, 'u64'], open_price: [100019, 'dbl'],
    close_price: [100021, 'dbl'], high_price: [100012, 'dbl'], low_price: [100013, 'dbl'] }
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
