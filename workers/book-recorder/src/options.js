// Options analytics (workers/book-recorder/opt-feeder/opt_feeder.py -> /opt-ingest -> DO).
// Owner-approved 2026-10-14 (InsightSentry options analytics). The feeder on our server pulls the
// InsightSentry option chains, computes the expected moves, ATM IV term structure, 25-delta skew,
// IV rank (from VIX / VXN) and put/call ratios, and POSTs one small gzip JSON. This Worker only
// validates and stores it: the latest blob per underlying (table opt) and one row per underlying
// per New York day (table optday: the day's last ATM IV / skew / P/C, kept 3 years) so an IV rank on
// our own ATM IV can take over once a year of it exists.
// GET /opt-analytics?u=SPX -> the latest blob + `hist` [[day, atm30, skew30, pcVol, ivxNow], ...]
// (oldest first, last 400 days). Public market data; CORS our two sites; edge-cached 60 s.
export const OPT_SYMBOLS = ['SPX', 'QQQ', 'SPY'];
export const OPT_MAX_BODY = 64 * 1024;
export const OPT_KEEP_DAYS = 3 * 366;
const FRESH_S = 15 * 60;
const EM_KEYS = ['0DTE', '1DTE', 'Weekly', 'Monthly'];

const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const finOrNull = (x) => x === null || x === undefined || fin(x);

async function gunzipJson(buf) {
  const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
  const text = await ds.text();
  if (text.length > 512 * 1024) throw new Error('too big unpacked');
  return JSON.parse(text);
}

// One analytics item -> '' when valid, else the reason.
export function validateOptItem(a, nowSec) {
  if (!a || typeof a !== 'object') return 'bad item';
  if (!OPT_SYMBOLS.includes(a.u)) return 'symbol not served';
  if (!fin(a.spot) || !(a.spot > 0)) return a.u + ': bad spot';
  if (!fin(a.t) || a.t > nowSec + 60 || nowSec - a.t > FRESH_S) return a.u + ': stale or future t';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.day || ''))) return a.u + ': bad day';
  if (!Array.isArray(a.em) || a.em.length > 4) return a.u + ': bad em';
  for (const r of a.em) {
    if (!r || !EM_KEYS.includes(r.k) || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.x || ''))) return a.u + ': bad em row';
    if (!fin(r.em) || !(r.em > 0) || r.em > a.spot * 0.5) return a.u + ': em out of range';
    if (!fin(r.lo) || !fin(r.hi) || !(r.lo < a.spot && a.spot < r.hi)) return a.u + ': em range';
    if (r.fut && (!fin(r.fut.c) || !fin(r.fut.lo) || !fin(r.fut.hi) || !(r.fut.lo < r.fut.hi))) return a.u + ': em fut';
  }
  if (!Array.isArray(a.term) || a.term.length > 120) return a.u + ': bad term';
  for (const r of a.term) {
    if (!Array.isArray(r) || r.length !== 5 || !/^\d{4}-\d{2}-\d{2}$/.test(String(r[0])) || !fin(r[1])) return a.u + ': bad term row';
    for (let i = 2; i < 5; i++) if (!finOrNull(r[i]) || (fin(r[i]) && (r[i] < 0 || r[i] > 5))) return a.u + ': term iv out of range';
  }
  if (!finOrNull(a.atm30) || !finOrNull(a.skew30)) return a.u + ': bad 30d';
  if (a.ivx && (!finOrNull(a.ivx.rank) || !finOrNull(a.ivx.pct) || !finOrNull(a.ivx.now))) return a.u + ': bad ivx';
  if (a.pc && (!finOrNull(a.pc.vol) || !finOrNull(a.pc.oi))) return a.u + ': bad pc';
  return '';
}

// Body -> { items } or { error }.
export async function validateOpt(buf, nowMs) {
  if (!buf || buf.byteLength < 20 || buf.byteLength > OPT_MAX_BODY) return { error: 'bad size' };
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return { error: 'not gzip' };
  let d;
  try { d = await gunzipJson(buf); } catch (e) { return { error: 'bad gzip/json' }; }
  if (!d || d.v !== 1 || !Array.isArray(d.items) || !d.items.length || d.items.length > OPT_SYMBOLS.length) return { error: 'bad header' };
  const seen = new Set();
  for (const a of d.items) {
    const bad = validateOptItem(a, nowMs / 1000);
    if (bad) return { error: bad };
    if (seen.has(a.u)) return { error: 'duplicate ' + a.u };
    seen.add(a.u);
  }
  return { items: d.items };
}

// The per-day summary row for one item.
export function dayRow(a) {
  return [a.day, a.atm30 ?? null, a.skew30 ?? null, (a.pc && a.pc.vol) ?? null, (a.ivx && a.ivx.now) ?? null];
}
