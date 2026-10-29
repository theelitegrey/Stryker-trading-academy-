// ZoroTide: options money flow (calls vs puts) samples (Owner order 2026-10-29).
//
// The GEX feeder (gex-feeder/gex_feeder.py + tide.py) already downloads the Cboe chains once a minute.
// For SPX / SPY / QQQ it turns the change in each contract's volume since the previous sample into a
// premium estimate (new volume x price x 100) and a bought / sold split from where the last trade sat
// in the bid-ask spread, and POSTs ONE small row per symbol per sample (gzip JSON) to /tide-snap.
// Estimated from options volume and quotes. The method is stated in gex-feeder/tide.py.
//
// Sample (one row): { u, day, t, s, cn, pn, cp, pp, cv, pv }
//   t   Cboe chain time (epoch s)           s   spot
//   cn  net call premium this sample ($): calls bought - calls sold
//   pn  net put premium this sample ($):  puts bought - puts sold
//   cp / pp  gross call / put premium this sample ($)       cv / pv  new call / put contracts
// The site adds the samples up since 9:30 ET (running totals).
//
// Storage: table tide (u, t) -> compact JSON; 30 days kept, trimmed on ingest at most once an hour (this
// Worker has no cron or alarm by design). ~100 bytes a row, ~390 rows a day per symbol: ~1.2 MB for 30 days
// x 3 symbols.
export const TIDE_SYMBOLS = ['SPX', 'SPY', 'QQQ'];
export const TIDE_KEEP_DAYS = 30;
export const TIDE_MAX_BODY = 16 * 1024;
export const TIDE_MAX_DAYS = 6;       // one /tide reply covers at most 6 sessions
const MAX_SAMPLES = 6;

async function gunzipJson(buf) {
  const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
  const text = await ds.text();
  if (text.length > 256 * 1024) throw new Error('too big unpacked');
  return JSON.parse(text);
}
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const int = (x) => Number.isInteger(x);

// Returns { snaps } when every sample is valid, else { error }.
export async function validateTide(buf, nowMs) {
  if (!buf || buf.byteLength < 20 || buf.byteLength > TIDE_MAX_BODY) return { error: 'bad size' };
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return { error: 'not gzip' };
  let d;
  try { d = await gunzipJson(buf); } catch (e) { return { error: 'bad gzip/json' }; }
  if (!d || d.v !== 1 || !Array.isArray(d.snaps) || !d.snaps.length || d.snaps.length > MAX_SAMPLES) return { error: 'bad header' };
  const now = nowMs / 1000, seen = new Set();
  for (const s of d.snaps) {
    if (!s || !TIDE_SYMBOLS.includes(s.u)) return { error: 'bad u' };
    if (seen.has(s.u)) return { error: 'duplicate' };
    seen.add(s.u);
    if (!int(s.t) || s.t > now + 60 || now - s.t > 86400) return { error: 'bad t ' + s.u };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.day))) return { error: 'bad day ' + s.u };
    if (!(fin(s.s) && s.s > 0)) return { error: 'bad spot ' + s.u };
    if (![s.cn, s.pn, s.cp, s.pp].every(int)) return { error: 'bad premium ' + s.u };
    if (!(s.cp >= 0 && s.pp >= 0 && Math.abs(s.cn) <= s.cp && Math.abs(s.pn) <= s.pp)) return { error: 'premium order ' + s.u };
    if (!(int(s.cv) && int(s.pv) && s.cv >= 0 && s.pv >= 0)) return { error: 'bad volume ' + s.u };
    // one sample is a minute of trading: a single sample above $50B means a broken diff, not a market
    if (s.cp > 5e10 || s.pp > 5e10) return { error: 'premium too big ' + s.u };
  }
  return { snaps: d.snaps.map((s) => ({ u: s.u, day: s.day, t: s.t, s: s.s, cn: s.cn, pn: s.pn, cp: s.cp, pp: s.pp, cv: s.cv, pv: s.pv })) };
}

// Rows of ONE symbol (sorted by t) -> { u, days: [{ day, t[], s[], cn[], pn[], cp[], pp[], cv[], pv[] }] } (newest day first)
export function packTide(u, rows) {
  const byDay = new Map();
  for (const r of rows) {
    let d = byDay.get(r.day);
    if (!d) { d = { day: r.day, t: [], s: [], cn: [], pn: [], cp: [], pp: [], cv: [], pv: [] }; byDay.set(r.day, d); }
    d.t.push(r.t); d.s.push(r.s); d.cn.push(r.cn); d.pn.push(r.pn); d.cp.push(r.cp); d.pp.push(r.pp); d.cv.push(r.cv); d.pv.push(r.pv);
  }
  return { v: 1, u, keepDays: TIDE_KEEP_DAYS, days: [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)) };
}
