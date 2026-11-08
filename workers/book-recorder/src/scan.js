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
// Dark pool prints (dp-feeder/dp_feeder.py, 2026-11-07): one part per stock / ETF, dp_<ticker lower>. Same list as the feeder's STOCKS.
export const DP_SYMS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'NFLX', 'AMD', 'JPM', 'V', 'WMT', 'XOM', 'LLY',
  'BAC', 'DIS', 'COST', 'INTC', 'PLTR', 'BA', 'COIN', 'MSTR', 'SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'TQQQ'];
export const DP_COLS = ['t', 'p', 's', 'c'];
export const DP_COLS2 = ['t', 'p', 's', 'c', 'd'];
const DP_MAX_ROWS = 20000;
export const SCAN_PARTS = ['presets', 'stock', 'etf', 'crypto', 'fut', 'syminfo', 'ms_nq', 'ms_es', 'ms_spx', 'ms_ym', 'ms_rty', 'ms_gc', 'ms_cl'].concat(DP_SYMS.map((s) => 'dp_' + s.toLowerCase()));
export const SCAN_MAX_BODY = 900 * 1024;   // screener v2: more columns per market table (was 512 KB)
export const SCAN_COLS = ['s', 'n', 'c', 'chg', 'vol', 'rvol', 'gap', 'rsi', 'hi52', 'lo52', 'cap', 'pe', 'sec', 'perfW', 'perfYtd'];   // presets + v1 tables
// Screener v2 (2026-11-03): the market tables carry the slow fields too (industry, beta, dividend yield, next earnings, ATR,
// month / quarter / year performance, average volume, SMA / EMA 20 / 50 / 200). Text cells: s n sec ind; the rest numbers.
export const SCAN_COLS_V2 = SCAN_COLS.concat(['ind', 'beta', 'dy', 'earn', 'atr', 'perfM', 'perfQ', 'perfY', 'av', 'sma20', 'sma50', 'sma200', 'ema20', 'ema50', 'ema200']);
// Screener columns (2026-11-03). A table (stock / etf / crypto / fut) starts with its base columns and may add any of these; the page
// reads them by name, so an older feeder (base only) keeps working. 'presets' keeps the exact base list.
export const SCAN_EXTRA = ['perfM', 'perf3m', 'perfY', 'avgv', 'atr', 'beta', 'dy', 'ind', 'exch', 'earn', 'adx', 'mfi', 'macd', 's20', 's50', 's200', 'e20', 'e50', 'e200'];
export const FUT_COLS = ['s', 'n', 'c', 'chg', 'vol'];
export const FUT_EXTRA = ['open', 'hi', 'lo', 'pc', 'gap', 'rvol', 'avgv', 'rsi', 'hi52', 'lo52', 'perfW', 'perfM', 'perf3m', 'perfY', 'perfYtd', 'atr', 'adx', 's20', 's50', 's200', 'e20', 'e50', 'e200', 'grp', 'exch'];
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
  'ibh', 'ibl', 'ibd', 'ibt', 'ibx', 'ibu', 'ibw', 'ibxu', 'ibxd', 'thi', 'tlo', 'bhi', 'blo',
  'pdo', 'c5c', 'c15c', 'c60c', 'mo', 'mt', 'rr1', 'rr2', 'rr3', 'rr4', 'rr5', 'rr6', 'rr7', 'rr8', 'rr9', 'rr10', 'rr11', 'rr12', 'rr13',
  'lo', 'lc5', 'lc15', 'lc60', 'le', 'ao', 'ac5', 'ac15', 'ac60', 'ae'];
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

// Dark pool part: { v, t, sym, code, min, days:[YYYY-MM-DD], cols: DP_COLS, rows: [[t ms, price, shares, conditions]] } sorted by t,
// or v2 { ..., cols: DP_COLS2, rows: [[t, p, s, c, side]], dv: {date: [volume, vwap]} }. Pure.
export function validateDarkPool(part, d) {
  if ('dp_' + String(d.sym || '').toLowerCase() !== part) return 'bad sym';
  // v1 [t,p,s,c]; v2 (DP-DETAIL) adds d = estimated side ('b'/'s'/'u'/'l'/'') and dv = {date: [day volume, day VWAP]}
  const v2 = Array.isArray(d.cols) && d.cols.join() === DP_COLS2.join();
  if (!v2 && (!Array.isArray(d.cols) || d.cols.join() !== DP_COLS.join())) return 'bad cols';
  if (v2 && (d.dv == null || typeof d.dv !== 'object' || Array.isArray(d.dv) || Object.keys(d.dv).length > 10
    || !Object.entries(d.dv).every(([k, e]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && Array.isArray(e) && e.length === 2 && fin(e[0]) && fin(e[1]) && e[0] >= 0 && e[1] >= 0))) return 'bad dv';
  if (!fin(d.min) || d.min < 1e5 || !Array.isArray(d.days) || d.days.length > 10 || !d.days.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) return 'bad header';
  if (!Array.isArray(d.rows) || d.rows.length > DP_MAX_ROWS) return 'bad rows';
  let last = 0;
  for (const r of d.rows) {
    if (!Array.isArray(r) || r.length !== (v2 ? 5 : 4) || !fin(r[0]) || !fin(r[1]) || !fin(r[2]) || r[1] <= 0 || r[2] <= 0 || typeof r[3] !== 'string' || r[3].length > 8) return 'bad row';
    if (v2 && !['b', 's', 'u', 'l', ''].includes(r[4])) return 'bad row';
    if (r[0] < last || r[0] < 1.5e12 || r[0] > 4.1e12) return 'bad time';
    last = r[0];
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
  if (!d || typeof d !== 'object' || (d.v !== 1 && !(d.v === 2 && part !== 'presets'))) return 'bad header';
  if (!fin(d.t) || d.t > nowSec + 60 || nowSec - d.t > (part === 'syminfo' || part.startsWith('ms_') || part.startsWith('dp_') ? 3600 : FRESH_S)) return 'stale or future t';
  if (part === 'syminfo') return validateSymInfo(d);
  if (part.startsWith('dp_')) return validateDarkPool(part, d);
  if (part.startsWith('ms_')) return validateMarketStats(part, d);
  const cols = part !== 'presets' && d.v === 2 ? SCAN_COLS_V2 : SCAN_COLS;
  if (!Array.isArray(d.cols) || d.cols.join() !== cols.join()) return 'bad cols';
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
  for (const c of cols) {
    const col = d.d[c];
    if (!Array.isArray(col) || col.length !== d.n) return 'bad column ' + c;
  }
  if (!d.d.s.every((x) => typeof x === 'string' && x.length <= 40)) return 'bad symbols';
  for (const c of cols) if (!d.d[c].every(cellOk)) return 'bad cells ' + c;
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
