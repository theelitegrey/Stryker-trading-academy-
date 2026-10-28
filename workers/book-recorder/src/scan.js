// Market scanner (workers/book-recorder/scan-feeder/scan_feeder.py -> /scan-ingest -> DO -> /scan).
// Owner-approved 2026-10-14 (InsightSentry market scanner). The feeder on our server makes 4
// InsightSentry screener calls every few minutes and POSTs four gzip JSON parts:
//   presets  (~15 KB) every preset list with its rows (what every visitor loads)
//   stock / etf / crypto  (~50-200 KB each) the full table of that market, column-major, for the
//            Pro custom filters (filtering runs in the browser on this cached copy)
// The DO validates (gunzip + parse is too much for the free plan's 10 ms Worker CPU) and stores the
// gzip bytes as they came; GET /scan?part= serves them as-is (x-scan-gzip: 1; the page un-gzips with
// DecompressionStream, as /orderflow does), edge-cached 60 s, so InsightSentry is never called per
// visitor. Plan gating (custom filters = Pro) is the site's.
export const SCAN_PARTS = ['presets', 'stock', 'etf', 'crypto', 'syminfo', 'ms_nq', 'ms_es', 'ms_spx'];
export const SCAN_MAX_BODY = 512 * 1024;
export const SCAN_COLS = ['s', 'n', 'c', 'chg', 'vol', 'rvol', 'gap', 'rsi', 'hi52', 'lo52', 'cap', 'pe', 'sec', 'perfW', 'perfYtd'];
const FRESH_S = 15 * 60;
const MAX_ROWS = 20000;
const PRESET_RE = /^[a-z0-9]{2,20}$/;

const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const cellOk = (v) => v === null || fin(v) || (typeof v === 'string' && v.length <= 80);

async function gunzipText(buf, max) {
  const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
  const text = await ds.text();
  if (text.length > max) throw new Error('too big unpacked');
  return text;
}

// Market Stats part (ms-feeder/ms_feeder.py): one row per RTH session, { v, t, sym, tf, cols, rows }. Pure.
export const MS_COLS = ['d', 'dow', 'o', 'h', 'l', 'c', 'pdh', 'pdl', 'pdc', 'gf', 'o15h', 'o15l', 'o15d', 'o15t', 'o15x', 'o30h', 'o30l', 'o30d', 'o30t', 'o30x',
  'ibh', 'ibl', 'ibd', 'ibt', 'ibx', 'ibu', 'ibw', 'ibxu', 'ibxd', 'thi', 'tlo', 'bhi', 'blo'];
export function validateMarketStats(part, d) {
  if (part.slice(3).toUpperCase() !== d.sym) return 'bad sym';
  if (!Array.isArray(d.cols) || d.cols.join() !== MS_COLS.join()) return 'bad cols';
  if (!Array.isArray(d.rows) || d.rows.length < 1 || d.rows.length > 1000) return 'bad rows';
  for (const r of d.rows) {
    if (!Array.isArray(r) || r.length !== MS_COLS.length || !r.every((v) => v === null || fin(v))) return 'bad row';
    if (!(r[0] > 20000101 && r[0] < 21000101)) return 'bad date';
  }
  return '';
}

// Symbol info part (info-feeder): { v, t, syms: { KEY: { kind: 'fut'|'stock', code, ... } } }. Pure.
export function validateSymInfo(d) {
  const ks = Object.keys(d.syms || {});
  if (ks.length < 1 || ks.length > 200) return 'bad syms';
  for (const k of ks) {
    const e = d.syms[k];
    if (!/^[A-Z0-9]{1,12}$/.test(k) || !e || !['fut', 'stock'].includes(e.kind) || typeof e.code !== 'string' || e.code.length > 40) return 'bad sym ' + k;
    if (JSON.stringify(e).length > 4000) return 'sym too big ' + k;
  }
  return '';
}

// Parsed part -> '' when valid, else the reason. Pure.
export function validateScanPart(part, d, nowSec) {
  if (!SCAN_PARTS.includes(part)) return 'bad part';
  if (!d || typeof d !== 'object' || d.v !== 1) return 'bad header';
  if (!fin(d.t) || d.t > nowSec + 60 || nowSec - d.t > (part === 'syminfo' || part.startsWith('ms_') ? 3600 : FRESH_S)) return 'stale or future t';
  if (part === 'syminfo') return validateSymInfo(d);
  if (part.startsWith('ms_')) return validateMarketStats(part, d);
  if (!Array.isArray(d.cols) || d.cols.join() !== SCAN_COLS.join()) return 'bad cols';
  if (part === 'presets') {
    const ks = Object.keys(d.presets || {});
    if (!ks.length || ks.length > 40) return 'bad presets';
    for (const k of ks) {
      const p = d.presets[k];
      if (!PRESET_RE.test(k) || !p || typeof p.title !== 'string' || p.title.length > 60 || !['stock', 'etf', 'crypto'].includes(p.kind)) return 'bad preset ' + k;
      if (!Array.isArray(p.rows) || p.rows.length > 200) return 'bad rows ' + k;
      for (const r of p.rows) {
        if (!Array.isArray(r) || r.length !== SCAN_COLS.length || typeof r[0] !== 'string' || !r.every(cellOk)) return 'bad row ' + k;
      }
    }
    return '';
  }
  if (!fin(d.n) || d.n < 1 || d.n > MAX_ROWS || !d.d || typeof d.d !== 'object') return 'bad table';
  for (const c of SCAN_COLS) {
    const col = d.d[c];
    if (!Array.isArray(col) || col.length !== d.n) return 'bad column ' + c;
  }
  if (!d.d.s.every((x) => typeof x === 'string' && x.length <= 40)) return 'bad symbols';
  for (const c of SCAN_COLS) if (!d.d[c].every(cellOk)) return 'bad cells ' + c;
  return '';
}

// Body -> { t } or { error }.
export async function validateScan(part, buf, nowMs) {
  if (!SCAN_PARTS.includes(part)) return { error: 'bad part' };
  if (!buf || buf.byteLength < 20 || buf.byteLength > SCAN_MAX_BODY) return { error: 'bad size' };
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return { error: 'not gzip' };
  let d;
  try { d = JSON.parse(await gunzipText(buf, 8 * 1024 * 1024)); } catch (e) { return { error: 'bad gzip/json' }; }
  const bad = validateScanPart(part, d, nowMs / 1000);
  return bad ? { error: bad } : { t: d.t };
}
