// TradeZoro book recorder: the order-book bucketing rule, kept identical to the Charts client
// (assets/chart-orderflow.js: nearNiceStep, niceStep, bookStoreRule, bucketBook). The parity
// test (workers/book-recorder/test/parity.test.mjs) runs both on the same Binance snapshot and
// requires byte-identical rows, so change both together or the test fails.
//
// One sample = the book summed into price rows of `step` over +-range of the mid:
// { ts, mid, bb, ba, step, i0, v } where v is a Float32Array, row k = price bucket i0 + k
// ([ (i0+k)*step, (i0+k+1)*step )), value = summed size, + bids / - asks. The mid's own row is
// left empty, bids only sit below it and asks above; leading / trailing empty rows are trimmed.

export const BOOK_AUTO_ROW = 0.0005;   // auto row = the nice step at or below 0.05% of the price
export const BOOK_RANGE = 0.02;        // +-2% of the mid (the client's "Book range %" default)
export const BOOK_ROWS_SIDE_MAX = 400;

// The largest nice step (1 / 2 / 2.5 / 5 x 10^n) at or below raw: BTC at $84k, 0.05% = $42 -> $25.
export function nearNiceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  let best = p;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p <= raw * 1.0001) best = m * p;
  return best;
}
export function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
// Storage step for a fresh feed with no manual bucket (what every new Charts tab uses).
export function storeRule(mid, range = BOOK_RANGE) {
  let step = nearNiceStep(mid * BOOK_AUTO_ROW);
  const floor = mid * range / BOOK_ROWS_SIDE_MAX;
  if (step < floor) step = niceStep(floor);
  return { step, range };
}
export function bookMid(bestBid, bestAsk) {
  return bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : (bestBid || bestAsk || 0);
}
const rowOf = (p, step) => Math.floor(p / step + 1e-9);
// Binance /depth JSON ({ bids: [[price, qty], ...] best first, asks: same }) -> one sample.
// Prices go through a Map exactly like the client's book (a repeated price keeps its LAST size,
// at its FIRST position), so even a malformed snapshot buckets identically on both sides.
export function bucketSnapshot(d, ts) {
  const toMap = (rows) => { const m = new Map(); for (const r of rows || []) { const p = Number(r[0]), q = Number(r[1]); if (Number.isFinite(p) && Number.isFinite(q) && q > 0) m.set(p, q); } return m; };
  const bids = toMap(d && d.bids), asks = toMap(d && d.asks);
  let bb = null, ba = null;
  bids.forEach((q, p) => { if (bb == null || p > bb) bb = p; });
  asks.forEach((q, p) => { if (ba == null || p < ba) ba = p; });
  const mid = bookMid(bb, ba);
  if (!(mid > 0)) return null;
  const { step, range } = storeRule(mid);
  const mi = rowOf(mid, step), lo = rowOf(mid * (1 - range), step), hi = rowOf(mid * (1 + range), step);
  const v = new Float32Array(hi - lo + 1);
  bids.forEach((q, p) => { const i = rowOf(p, step); if (i < mi && i >= lo) v[i - lo] += q; });
  asks.forEach((q, p) => { const i = rowOf(p, step); if (i > mi && i <= hi) v[i - lo] -= q; });
  let a = 0, b = v.length - 1;
  while (a <= b && v[a] === 0) a++;
  while (b >= a && v[b] === 0) b--;
  return { ts, mid, bb, ba, step, i0: lo + a, v: a > b ? new Float32Array(0) : v.slice(a, b + 1) };
}

// Wire format (little-endian), shared with the client's decoder (chart-orderflow.js decodeBookHistory):
//   'BKR1' | u32 count | per sample: f64 ts, f64 mid, f64 bb, f64 ba, f64 step, i32 i0, u32 n, n x f32
export const SAMPLE_HEAD = 48;
export function encodeSamples(list) {
  let size = 8;
  for (const s of list) size += SAMPLE_HEAD + s.v.length * 4;
  const buf = new ArrayBuffer(size), dv = new DataView(buf);
  dv.setUint8(0, 66); dv.setUint8(1, 75); dv.setUint8(2, 82); dv.setUint8(3, 49); // BKR1
  dv.setUint32(4, list.length, true);
  let o = 8;
  for (const s of list) {
    dv.setFloat64(o, s.ts, true); dv.setFloat64(o + 8, s.mid, true); dv.setFloat64(o + 16, s.bb || 0, true);
    dv.setFloat64(o + 24, s.ba || 0, true); dv.setFloat64(o + 32, s.step, true); dv.setInt32(o + 40, s.i0, true);
    dv.setUint32(o + 44, s.v.length, true); o += SAMPLE_HEAD;
    for (let k = 0; k < s.v.length; k++, o += 4) dv.setFloat32(o, s.v[k], true);
  }
  return buf;
}
export function decodeSamples(buf) {
  const dv = new DataView(buf), out = [];
  if (buf.byteLength < 8 || dv.getUint32(0, false) !== 0x424B5231) return null;
  const n = dv.getUint32(4, true);
  let o = 8;
  for (let k = 0; k < n; k++) {
    if (o + SAMPLE_HEAD > buf.byteLength) return null;
    const len = dv.getUint32(o + 44, true);
    const s = { ts: dv.getFloat64(o, true), mid: dv.getFloat64(o + 8, true), bb: dv.getFloat64(o + 16, true) || null, ba: dv.getFloat64(o + 24, true) || null,
      step: dv.getFloat64(o + 32, true), i0: dv.getInt32(o + 40, true), v: new Float32Array(len) };
    o += SAMPLE_HEAD;
    if (o + len * 4 > buf.byteLength) return null;
    for (let j = 0; j < len; j++, o += 4) s.v[j] = dv.getFloat32(o, true);
    out.push(s);
  }
  return out;
}
