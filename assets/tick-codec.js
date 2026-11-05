// TICK ENGINE codec + bar maths (Owner order 2026-11-05, "tick engine"). Pure module, no I/O.
// IDENTICAL COPY in assets/tick-codec.js (tools/tests/tick-engine-client.test.mjs keeps the two byte-equal), so the
// Worker and the browser bucket every bar the same way.
//
// One minute of one symbol is stored as two blobs:
//   ticks  'T' 1 | f64 unit | zz base | u n | n x (u dms, zz dpx, u size*2+buy)      every trade, ms within the minute
//   secs   'S' 1 | f64 unit | zz base | u n | n x (u dsec, zz o, u h-o, u o-l, u c-l, u vol, u buyVol)
// Prices are integer multiples of `unit` (the contract tick; 1e-8 when a price is off the tick grid), deltas are
// zig-zag varints. Measured 2026-11-05 on NQ/MNQ: ~3.5 bytes a trade.
// Bars everywhere are [t_ms, open, high, low, close, volume, buyVolume].

export const TK_UNIT = { NQ: 0.25, ES: 0.25, MNQ: 0.25, MES: 0.25, YM: 1, RTY: 0.1, CL: 0.01, GC: 0.1, SI: 0.005, SIL: 0.005, ZB: 0.03125, ZN: 0.015625, '6E': 0.00005, HG: 0.0005, MHG: 0.0005, MGC: 0.1, MCL: 0.01, MYM: 1, M2K: 0.1 };

class W {
  constructor() { this.b = new Uint8Array(256); this.n = 0; }
  need(k) { if (this.n + k > this.b.length) { const nb = new Uint8Array(Math.max(this.b.length * 2, this.n + k)); nb.set(this.b); this.b = nb; } }
  u(v) { this.need(10); v = Math.max(0, Math.round(v)); while (v >= 128) { this.b[this.n++] = (v % 128) | 128; v = Math.floor(v / 128); } this.b[this.n++] = v; }
  z(v) { v = Math.round(v); this.u(v >= 0 ? v * 2 : -v * 2 - 1); }
  f64(x) { this.need(8); new DataView(this.b.buffer).setFloat64(this.n, x, true); this.n += 8; }
  out() { return this.b.slice(0, this.n); }
}
class R {
  constructor(buf) { this.b = buf instanceof Uint8Array ? buf : new Uint8Array(buf); this.i = 0; }
  u() { let v = 0, m = 1, x; do { x = this.b[this.i++]; if (x === undefined) throw new Error('short'); v += (x & 127) * m; m *= 128; } while (x & 128); return v; }
  z() { const v = this.u(); return v % 2 ? -(v + 1) / 2 : v / 2; }
  f64() { const x = new DataView(this.b.buffer, this.b.byteOffset).getFloat64(this.i, true); this.i += 8; return x; }
}
const onGrid = (p, u) => Math.abs(p / u - Math.round(p / u)) < 1e-6;
function unitOf(sym, prices) {
  const u = TK_UNIT[sym];
  return u && prices.every((p) => onGrid(p, u)) ? u : 1e-8;
}
const fix = (x, u) => Number((x * u).toFixed(u < 1e-6 ? 8 : Math.max(0, Math.ceil(-Math.log10(u)) + 2)));

// ticks = [[ts_ms, price, size, side 1|-1], ..] sorted by ts, all inside [t0, t0 + 60 s)
export function packTicks(sym, t0, ticks) {
  const w = new W(), u = unitOf(sym, ticks.map((x) => x[1]));
  w.b[0] = 84; w.b[1] = 1; w.n = 2; w.f64(u);
  const base = ticks.length ? Math.round(ticks[0][1] / u) : 0;
  w.z(base); w.u(ticks.length);
  let pt = t0, pp = base;
  for (const [ts, px, sz, side] of ticks) { const t = Math.max(pt, ts), p = Math.round(px / u); w.u(t - pt); w.z(p - pp); w.u(Math.round(sz) * 2 + (side > 0 ? 1 : 0)); pt = t; pp = p; }
  return w.out();
}
export function unpackTicks(buf, t0) {
  const r = new R(buf);
  if (r.b[0] !== 84 || r.b[1] !== 1) throw new Error('not a tick blob');
  r.i = 2; const u = r.f64(); let p = r.z(); const n = r.u(), out = new Array(n); let t = t0;
  for (let k = 0; k < n; k++) { t += r.u(); p += r.z(); const s = r.u(); out[k] = [t, fix(p, u), Math.floor(s / 2), s % 2 ? 1 : -1]; }
  return out;
}
// one minute's trades -> 1-second rows [[t_ms, o, h, l, c, v, buy], ..]
export function secsOf(ticks) {
  const out = []; let cur = null;
  for (const [ts, px, sz, side] of ticks) {
    const s = Math.floor(ts / 1000) * 1000;
    if (!cur || cur[0] !== s) { cur = [s, px, px, px, px, 0, 0]; out.push(cur); }
    if (px > cur[2]) cur[2] = px; if (px < cur[3]) cur[3] = px; cur[4] = px; cur[5] += sz; if (side > 0) cur[6] += sz;
  }
  return out;
}
export function packSecs(sym, t0, secs) {
  const w = new W(), u = unitOf(sym, secs.flatMap((x) => [x[1], x[2], x[3], x[4]]));
  w.b[0] = 83; w.b[1] = 1; w.n = 2; w.f64(u);
  const base = secs.length ? Math.round(secs[0][1] / u) : 0;
  w.z(base); w.u(secs.length);
  let ps = -1, pp = base;
  for (const [t, o, h, l, c, v, b] of secs) {
    const s = Math.floor((t - t0) / 1000), O = Math.round(o / u), H = Math.round(h / u), L = Math.round(l / u), C = Math.round(c / u);
    w.u(s - ps - 1); w.z(O - pp); w.u(H - O); w.u(O - L); w.u(C - L); w.u(v); w.u(b); ps = s; pp = O;
  }
  return w.out();
}
export function unpackSecs(buf, t0) {
  const r = new R(buf);
  if (r.b[0] !== 83 || r.b[1] !== 1) throw new Error('not a secs blob');
  r.i = 2; const u = r.f64(); let p = r.z(); const n = r.u(), out = new Array(n); let s = -1;
  for (let k = 0; k < n; k++) {
    s += r.u() + 1; p += r.z(); const H = p + r.u(), L = p - r.u(), C = L + r.u(), v = r.u(), b = r.u();
    out[k] = [t0 + s * 1000, fix(p, u), fix(H, u), fix(L, u), fix(C, u), v, b];
  }
  return out;
}

// ---- timeframes. spec: { k: 's', n } seconds, { k: 'm', n } minutes, { k: 'D' } the CME session day.
// '1S'..'59S', '1'..'240' (minutes), 'D'. W / M are not built here (the old source keeps them).
export function tfSpec(tf) {
  const s = String(tf || '').trim();
  let m = /^(\d+)S$/i.exec(s);
  if (m) { const n = +m[1]; return n >= 1 && n <= 59 ? { k: 's', n, ms: n * 1000 } : null; }
  if (/^(D|1D)$/i.test(s)) return { k: 'D', ms: 86400000 };
  m = /^(\d+)$/.exec(s);
  if (m) { const n = +m[1]; return n >= 1 && n <= 240 && (n < 120 || n === 120 || n === 240) ? { k: 'm', n, ms: n * 60000 } : null; }
  return null;
}
// New York offset in ms at an instant (DST aware, from Intl; -4 h or -5 h)
const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' });
const offMemo = new Map();
export function nyOff(ms) {
  const h = Math.floor(ms / 3600000);
  let v = offMemo.get(h);
  if (v === undefined) {
    const z = (nyFmt.formatToParts(new Date(h * 3600000)).find((p) => p.type === 'timeZoneName') || {}).value || 'GMT-05:00';
    const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(z);
    v = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 3600000 + Number(m[3] || 0) * 60000) : -18000000;
    if (offMemo.size > 20000) offMemo.clear();
    offMemo.set(h, v);
  }
  return v;
}
// Bucket start (ms). Seconds and minutes below 2 h: epoch aligned (= chart-intervals.js / functions/api/chart/_bars.js).
// 2 h / 4 h: anchored to the 18:00 New York Globex open (= _bars.js aggregateHours, chart-futures-l2.js bucketStart).
// D: the session that opens 18:00 New York, labelled with New York midnight of its trading date (= the old daily bars).
export function bucketOf(ms, sp) {
  if (sp.k === 's' || (sp.k === 'm' && sp.n < 120)) return Math.floor(ms / sp.ms) * sp.ms;
  const off = nyOff(ms), shift = off + 6 * 3600000;
  if (sp.k === 'm') return Math.floor((ms + shift) / sp.ms) * sp.ms - shift;
  const day = Math.floor((ms + shift) / 86400000) * 86400000;   // New York midnight of the trading date, in "NY local" epoch
  return day - nyOff(day - off);
}
// Start (ms) of the CME session holding ms: the latest 18:00 New York at or before it. N-TICK BARS are counted from here (the
// anchor), so the same trades give the same bars on every read and every reload, and a session's first trade opens a new bar.
export function sessionOpen(ms) {
  const off = nyOff(ms), loc = ms + off, day = Math.floor(loc / 86400000) * 86400000, six = day + 18 * 3600000;
  const s = (loc >= six ? six : six - 86400000) - off;
  return s > ms ? s - 3600000 : s;   // shortcut: on a DST change day the offset at 18:00 differs from ms's by 1 h; never after ms
}
// fold rows ([t, o, h, l, c, v, b], ascending, finer than sp) into sp bars
export function aggregate(rows, sp) {
  const out = []; let cur = null;
  for (const r of rows) {
    const b = bucketOf(r[0], sp);
    if (!cur || cur[0] !== b) { cur = [b, r[1], r[2], r[3], r[4], r[5], r[6]]; out.push(cur); continue; }
    if (r[2] > cur[2]) cur[2] = r[2]; if (r[3] < cur[3]) cur[3] = r[3]; cur[4] = r[4]; cur[5] += r[5]; cur[6] += r[6];
  }
  return out;
}
// fold one live trade into a bar list (ascending): returns the touched bar
export function foldTick(bars, tick, sp) {
  const [ts, px, sz, side] = tick, b = bucketOf(ts, sp), last = bars[bars.length - 1];
  if (last && last[0] === b) { if (px > last[2]) last[2] = px; if (px < last[3]) last[3] = px; last[4] = px; last[5] += sz; if (side > 0) last[6] += sz; return last; }
  if (last && b < last[0]) return null;   // older than the forming bar (never happens with seq-ordered trades)
  const nb = [b, px, px, px, px, sz, side > 0 ? sz : 0]; bars.push(nb); return nb;
}
