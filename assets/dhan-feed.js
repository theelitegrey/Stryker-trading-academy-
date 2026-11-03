// TradeZoro — Dhan live market feed decoder (ES module, no dependencies). DATA ONLY.
// Layouts follow the official DhanHQ-py marketfeed.py (dhanhq 2.3.0) and docs dhanhq.co/docs/v2/live-market-feed. All numbers are little endian.
// Header (8 bytes): code u8 | length u16 | exchange segment u8 | security id u32. Codes: 2 ticker, 3 depth, 4 quote, 5 OI, 6 previous close, 7 status, 8 full, 50 disconnect.
// tools/tests/dhan.test.mjs checks every packet below against the output of the official Python decoder (fixtures/dhan/packets.json).
export const SEG = { 0: 'IDX_I', 1: 'NSE_EQ', 2: 'NSE_FNO', 3: 'NSE_CURRENCY', 4: 'BSE_EQ', 5: 'MCX_COMM', 7: 'BSE_CURRENCY', 8: 'BSE_FNO' };
export const SEG_CODE = Object.fromEntries(Object.entries(SEG).map(([k, v]) => [v, +k]));
export const DISCONNECT = { 805: 'Dhan allows no more live connections', 806: 'Your Dhan account has no Data plan', 807: 'Your Dhan token has expired', 808: 'That Dhan Client ID is not valid', 809: 'Dhan did not accept this sign-in' };
const f32 = (v, o) => Math.round(v.getFloat32(o, true) * 1e4) / 1e4;   // floats are 32-bit; rounding drops the binary noise (24500.25, not 24500.25000...)
const LEN = { 2: 16, 3: 112, 4: 50, 5: 12, 6: 16, 7: 8, 8: 162, 50: 10 };
function depth(v, o) {   // five levels of 20 bytes: bid qty u32, ask qty u32, bid orders u16, ask orders u16, bid price f32, ask price f32
  const out = [];
  for (let i = 0; i < 5; i++, o += 20) out.push({ bidQty: v.getUint32(o, true), askQty: v.getUint32(o + 4, true), bidOrders: v.getUint16(o + 8, true), askOrders: v.getUint16(o + 10, true), bidPrice: f32(v, o + 12), askPrice: f32(v, o + 16) });
  return out;
}
// One packet (ArrayBuffer / Uint8Array) -> object, or null for anything unknown or too short. Never throws.
export function decodePacket(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!u.length) return null;
  const code = u[0], need = LEN[code];
  if (!need || u.length < need) return null;
  const v = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (code === 50) return { type: 'disconnect', code: v.getUint16(8, true), message: DISCONNECT[v.getUint16(8, true)] || 'Dhan closed the feed' };
  if (code === 7) return { type: 'status' };
  const h = { seg: u[3], segment: SEG[u[3]] || String(u[3]), id: v.getUint32(4, true) };
  if (code === 2) return { type: 'ticker', ...h, ltp: f32(v, 8), ltt: v.getUint32(12, true) };
  if (code === 6) return { type: 'prevClose', ...h, prevClose: f32(v, 8), prevOI: v.getUint32(12, true) };
  if (code === 5) return { type: 'oi', ...h, oi: v.getUint32(8, true) };
  if (code === 3) return { type: 'depth', ...h, ltp: f32(v, 8), depth: depth(v, 12) };
  const q = { ...h, ltp: f32(v, 8), ltq: v.getUint16(12, true), ltt: v.getUint32(14, true), avgPrice: f32(v, 18), volume: v.getUint32(22, true), sellQty: v.getUint32(26, true), buyQty: v.getUint32(30, true) };
  if (code === 4) return { type: 'quote', ...q, open: f32(v, 34), close: f32(v, 38), high: f32(v, 42), low: f32(v, 46) };
  return { type: 'full', ...q, oi: v.getUint32(34, true), oiHigh: v.getUint32(38, true), oiLow: v.getUint32(42, true), open: f32(v, 46), close: f32(v, 50), high: f32(v, 54), low: f32(v, 58), depth: depth(v, 62) };
}
// One WebSocket message -> list of packets. Dhan sends one packet per message, but if several are joined they are split by their known sizes. Unknown bytes stop the walk.
export function decodeFrame(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf), out = [];
  for (let o = 0; o < u.length;) { const n = LEN[u[o]]; if (!n || o + n > u.length) break; const p = decodePacket(u.subarray(o, o + n)); if (p) out.push(p); o += n; }
  return out;
}
