// Order flow (footprint) store: 1-minute bars built from InsightSentry tick trades by the server
// feeder (of-feeder/of_feeder.py, codec of-feeder/ofcodec.py). Owner-approved 2026-10-14.
//
// Record (one symbol, one minute, prices as tick indexes):
//   uv t (minute since epoch) | sv lo | uv n | uv o-lo | uv c-lo | n x (uv buy, uv sell)
//   | sv dmax | sv dmin | uv trades | uv nb | nb x (uv ms, uv p-lo, uv size*2+side)
//   | uv np | np x (uv sec, uv o-lo, uv h-lo, uv l-lo, uv c-lo, uv volume)   1-second path
// Payload: 'OF1\n' | uv hlen | header JSON | uv count | count x (uv len | record)
//
// Storage (Durable Object SQLite): closed bars only, one row per (sym, t), 90 days. The bar that is
// still open lives in the DO's memory (replaced on every feeder POST, ~every 30 s), so the live tail
// costs no SQLite writes: ~1 row written per symbol per minute (6 symbols ~8,640 rows/day).
export const OF_SYMBOLS = ['NQ', 'ES', 'YM', 'GC', 'SI', 'CL'];
export const OF_TICK = { NQ: 0.25, ES: 0.25, YM: 1, GC: 0.1, SI: 0.005, CL: 0.01 };
export const OF_KEEP_DAYS = 90;
export const OF_MAX_BODY = 256 * 1024;      // gzip body per POST
export const OF_MAX_RAW = 2 * 1024 * 1024;  // unpacked
const MAX_RECS = 1500;
const MAX_ROWS = 4000;                      // price rows in one minute (NQ's widest minute: ~200)
const MAGIC = [0x4f, 0x46, 0x31, 0x0a];     // 'OF1\n'

export function readUv(b, i) {
  let n = 0, s = 1, x;
  do {
    if (i >= b.length) throw new Error('truncated');
    x = b[i++];
    n += (x & 0x7f) * s;
    s *= 128;
  } while (x >= 0x80);
  return [n, i];
}
export function readSv(b, i) {
  const [n, j] = readUv(b, i);
  return [n % 2 ? -(n + 1) / 2 : n / 2, j];
}
export function writeUv(n, out) {
  while (n >= 0x80) { out.push((n % 128) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
}

// Full decode of one record (validation + tests). Returns null when it is malformed.
export function decodeRecord(b) {
  try {
    let i = 0, t, lo, n, o, c, x, y;
    [t, i] = readUv(b, i); [lo, i] = readSv(b, i); [n, i] = readUv(b, i);
    if (!n || n > MAX_ROWS) return null;
    [o, i] = readUv(b, i); [c, i] = readUv(b, i);
    if (o >= n || c >= n) return null;
    const buy = new Array(n), sell = new Array(n);
    for (let k = 0; k < n; k++) { [x, i] = readUv(b, i); [y, i] = readUv(b, i); buy[k] = x; sell[k] = y; }
    let dmax, dmin, trades, nb;
    [dmax, i] = readSv(b, i); [dmin, i] = readSv(b, i); [trades, i] = readUv(b, i); [nb, i] = readUv(b, i);
    if (nb > 500) return null;
    const bigs = [];
    for (let k = 0; k < nb; k++) {
      let ms, po, sz;
      [ms, i] = readUv(b, i); [po, i] = readUv(b, i); [sz, i] = readUv(b, i);
      if (ms >= 60000 || po >= n) return null;
      bigs.push([ms, lo + po, Math.floor(sz / 2), sz % 2]);
    }
    let np;
    const ps = i;
    [np, i] = readUv(b, i);
    if (np > 60) return null;
    const secs = [];
    let prevSec = -1;
    for (let k = 0; k < np; k++) {
      const r = [];
      for (let q = 0; q < 6; q++) { [x, i] = readUv(b, i); r.push(x); }
      if (r[0] > 59 || r[0] <= prevSec || r[1] >= n || r[2] >= n || r[3] >= n || r[4] >= n || r[3] > r[2]) return null;
      prevSec = r[0];
      secs.push([r[0], lo + r[1], lo + r[2], lo + r[3], lo + r[4], r[5]]);
    }
    if (i !== b.length) return null;
    return { t, lo, n, o: lo + o, c: lo + c, buy, sell, dmax, dmin, trades, bigs, secs, ps };
  } catch (e) { return null; }
}

// Payload -> { header, recs: [Uint8Array] } or { error }.
export function splitPayload(u8) {
  try {
    for (let k = 0; k < 4; k++) if (u8[k] !== MAGIC[k]) return { error: 'bad magic' };
    let i = 4, hl, cnt;
    [hl, i] = readUv(u8, i);
    if (hl > 4096) return { error: 'bad header' };
    const header = JSON.parse(new TextDecoder().decode(u8.subarray(i, i + hl)));
    i += hl;
    [cnt, i] = readUv(u8, i);
    if (cnt > MAX_RECS) return { error: 'too many bars' };
    const recs = [];
    for (let k = 0; k < cnt; k++) {
      let len;
      [len, i] = readUv(u8, i);
      if (i + len > u8.length) return { error: 'truncated' };
      recs.push(u8.subarray(i, i + len));
      i += len;
    }
    if (i !== u8.length) return { error: 'trailing bytes' };
    return { header, recs };
  } catch (e) { return { error: 'bad payload' }; }
}

export function buildPayload(header, recs) {
  const h = new TextEncoder().encode(JSON.stringify(header));
  const pre = [...MAGIC];
  writeUv(h.length, pre);
  const parts = [Uint8Array.from(pre), h];
  const cnt = []; writeUv(recs.length, cnt); parts.push(Uint8Array.from(cnt));
  for (const r of recs) { const l = []; writeUv(r.length, l); parts.push(Uint8Array.from(l), r); }
  let size = 0; for (const p of parts) size += p.length;
  const out = new Uint8Array(size);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function gunzip(buf) {
  const s = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
  const out = new Uint8Array(await s.arrayBuffer());
  if (out.length > OF_MAX_RAW) throw new Error('too big unpacked');
  return out;
}

// Validates one feeder POST. Returns { header, bars: [{ t, rec }] } or { error }.
// Bars: inside the last OF_KEEP_DAYS days, not in the future, price rows near the symbol's band
// (lo > 0), sane volumes.
export async function validateOfIngest(sym, buf, nowMs) {
  if (!OF_SYMBOLS.includes(sym)) return { error: 'symbol not recorded' };
  if (!buf || buf.byteLength < 10 || buf.byteLength > OF_MAX_BODY) return { error: 'bad size' };
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return { error: 'not gzip' };
  let u8;
  try { u8 = await gunzip(buf); } catch (e) { return { error: 'bad gzip' }; }
  const p = splitPayload(u8);
  if (p.error) return p;
  const h = p.header;
  if (!h || h.v !== 1 || h.sym !== sym || h.tick !== OF_TICK[sym]) return { error: 'bad header' };
  const nowMin = Math.floor(nowMs / 60000), oldest = nowMin - OF_KEEP_DAYS * 1440;
  const bars = [];
  let prev = -1;
  for (const rec of p.recs) {
    const r = decodeRecord(rec);
    if (!r) return { error: 'bad bar' };
    if (r.t > nowMin || r.t < oldest) return { error: 'bar time out of range' };
    if (r.t <= prev) return { error: 'bars not in time order' };
    if (r.lo <= 0) return { error: 'bad price' };
    prev = r.t;
    // stored apart: the footprint part (with an empty path, np = 0) and the 1-second path, so
    // /orderflow does not carry the path (~2/3 of the bytes) and /ticks1s joins them back
    const fp = new Uint8Array(r.ps + 1); fp.set(rec.subarray(0, r.ps));
    bars.push({ t: r.t, rec, fp, path: rec.slice(r.ps) });
  }
  if (!bars.length) return { error: 'no bars' };
  return { header: h, bars };
}

// The range a GET /orderflow request is served for, in minutes since the epoch.
//   day=YYYY-MM-DD   one UTC day (the client's unit: cacheable, a past day never changes)
//   from=&to=        seconds or ms; from rounded DOWN to the hour, to UP to the minute; <= 4 days
// `final` = the range ended over 3 minutes ago (no open bar in it): cached 1 h at the edge (backfill + the daily rebuild rewrite closed bars).
export function ofRange(q, nowMs) {
  const nowMin = Math.floor(nowMs / 60000);
  let from, to;
  const day = q.get('day');
  if (day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const d0 = Date.parse(day + 'T00:00:00Z');
    if (!Number.isFinite(d0)) return null;
    from = d0 / 60000; to = from + 1439;
  } else {
    let f = Number(q.get('from')) || 0, t = Number(q.get('to')) || nowMs / 1000;
    if (t > 1e11) t /= 1000;
    if (f > 1e11) f /= 1000;
    if (!f) f = t - 86400;
    to = Math.ceil(t / 60);
    from = Math.floor(f / 3600) * 60;
    if (to - from > 4 * 1440) from = to - 4 * 1440;
  }
  to = Math.min(to, nowMin);
  from = Math.max(from, nowMin - OF_KEEP_DAYS * 1440);
  if (!(to >= from)) return null;
  return { from, to, final: to < nowMin - 3 };
}

// GET /ticks1s range (website-developer's tick-by-tick replay): from/to in seconds (or ms),
// at most one day; from rounded DOWN to the hour, to UP to the minute, never past now.
export function ticksRange(q, nowMs) {
  const nowMin = Math.floor(nowMs / 60000);
  let t = Number(q.get('to')) || nowMs / 1000, f = Number(q.get('from')) || 0;
  if (t > 1e11) t /= 1000;
  if (f > 1e11) f /= 1000;
  if (!f) f = t - 86400;
  let to = Math.min(Math.ceil(t / 60), nowMin), from = Math.floor(f / 3600) * 60;
  if (to - from > 1440) from = to - 1440;
  from = Math.max(from, nowMin - OF_KEEP_DAYS * 1440);
  if (!(to >= from)) return null;
  return { from, to, final: to < nowMin - 3 };
}

// Records -> the /ticks1s JSON: { sym, tick, prices: 'real', m: [[minuteSec, [[sec, o, h, l, c, v], ...]], ...] }.
const roundTo = (x, tick) => { const d = String(tick).includes('.') ? String(tick).split('.')[1].length : 0; return Number((x * tick).toFixed(d)); };
export function joinPath(fp, path) {
  const out = new Uint8Array(fp.length - 1 + path.length);
  out.set(fp.subarray(0, fp.length - 1)); out.set(path, fp.length - 1);
  return out;
}
export function ticksJson(sym, recs) {
  const tick = OF_TICK[sym], m = [];
  for (const rec of recs) {
    const r = decodeRecord(rec);
    if (!r || !r.secs.length) continue;
    m.push([r.t * 60, r.secs.map((s) => [s[0], roundTo(s[1], tick), roundTo(s[2], tick), roundTo(s[3], tick), roundTo(s[4], tick), s[5]])]);
  }
  return { v: 1, sym, tick, prices: 'real', m };
}
