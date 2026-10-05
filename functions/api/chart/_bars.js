// Chart bars for the Charts page futures provider (assets/chart-futures-provider.js).
// Used by functions/api/chart/bars/[sym].js. Pure module, no Pages context.
//
// Source: Yahoo Finance v8 chart, continuous front month (=F). Not a live feed.
// Bars are served in FIXED, epoch-aligned PAGES per timeframe, so every request
// for the same page hits the same edge-cache entry: closed pages never change
// and cache for a day, only the page holding "now" refreshes.
//
// CPU budget (after the 2026-10 Cloudflare 1102 incident on the GEX API): one
// upstream fetch per page, a single linear pass over at most ~1,500 rows, no
// Intl/Date formatting per row (the New York offset is computed arithmetically).

export const FETCH_TIMEOUT_MS = 4500;

// Allow-list. root -> [yahoo, description, exchange prefix, market, tick, point value]
export const SYMBOLS = {
  NQ:  ['NQ=F',  'Nasdaq-100 E-mini futures',        'CME',   'index',  0.25,       20],
  MNQ: ['MNQ=F', 'Micro Nasdaq-100 E-mini futures',  'CME',   'index',  0.25,       2],
  ES:  ['ES=F',  'S&P 500 E-mini futures',           'CME',   'index',  0.25,       50],
  MES: ['MES=F', 'Micro S&P 500 E-mini futures',     'CME',   'index',  0.25,       5],
  YM:  ['YM=F',  'Dow Jones E-mini futures ($5)',    'CBOT',  'index',  1,          5],
  MYM: ['MYM=F', 'Micro Dow Jones E-mini futures',   'CBOT',  'index',  1,          0.5],
  RTY: ['RTY=F', 'Russell 2000 E-mini futures',      'CME',   'index',  0.1,        50],
  M2K: ['M2K=F', 'Micro Russell 2000 E-mini futures','CME',   'index',  0.1,        5],
  GC:  ['GC=F',  'Gold futures',                     'COMEX', 'metals', 0.1,        100],
  MGC: ['MGC=F', 'Micro Gold futures',               'COMEX', 'metals', 0.1,        10],
  SI:  ['SI=F',  'Silver futures',                   'COMEX', 'metals', 0.005,      5000],
  CL:  ['CL=F',  'Crude Oil WTI futures',            'NYMEX', 'energy', 0.01,       1000],
  MCL: ['MCL=F', 'Micro WTI Crude Oil futures',      'NYMEX', 'energy', 0.01,       100],
  NG:  ['NG=F',  'Natural Gas futures',              'NYMEX', 'energy', 0.001,      10000],
  ZN:  ['ZN=F',  '10-Year T-Note futures',           'CBOT',  'rates',  0.015625,   1000],
  ZB:  ['ZB=F',  'U.S. Treasury Bond futures',       'CBOT',  'rates',  0.03125,    1000],
  '6E':['6E=F',  'Euro FX futures',                  'CME',   'fx',     0.00005,    125000]
};

const H = 3600, D = 86400;
// tf -> { yahoo interval, step seconds (0 = calendar), page seconds, depth seconds, agg hours }
// depth = how far back Yahoo serves this interval; a page wholly older returns [] without a fetch.
export const TIMEFRAMES = {
  '1':   { iv: '1m',  step: 60,     page: 8 * H,    depth: 29 * D },
  '5':   { iv: '5m',  step: 300,    page: 2 * D,    depth: 59 * D },
  '15':  { iv: '15m', step: 900,    page: 5 * D,    depth: 59 * D },
  '30':  { iv: '30m', step: 1800,   page: 10 * D,   depth: 59 * D },
  '60':  { iv: '60m', step: 3600,   page: 20 * D,   depth: 729 * D },
  '120': { iv: '60m', step: 7200,   page: 40 * D,   depth: 729 * D, agg: 2 },
  '240': { iv: '60m', step: 14400,  page: 60 * D,   depth: 729 * D, agg: 4 },
  'D':   { iv: '1d',  step: 0, span: D,      page: 730 * D,  depth: 40 * 365 * D },
  'W':   { iv: '1wk', step: 0, span: 7 * D,  page: 0,        depth: 40 * 365 * D },
  'M':   { iv: '1mo', step: 0, span: 28 * D, page: 0,        depth: 40 * 365 * D }
};

const TF_ALIASES = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '60m': '60', '2h': '120', '4h': '240',
  '4H': '240', '1d': 'D', '1D': 'D', 'd': 'D', '1w': 'W', '1W': 'W', 'w': 'W', '1M': 'M', '1mo': 'M' };
export function normTf(tf) { tf = String(tf || ''); return TIMEFRAMES[tf] ? tf : (TF_ALIASES[tf] || null); }
export function normSym(s) {
  s = String(s || '').toUpperCase().replace(/1!$/, '');
  return Object.prototype.hasOwnProperty.call(SYMBOLS, s) ? s : null;
}

// Page index holding epoch second t. W/M serve everything in page 0.
export function pageOf(tf, t) { const p = TIMEFRAMES[tf].page; return p ? Math.floor(t / p) : 0; }
export function pageBounds(tf, page) {
  const p = TIMEFRAMES[tf].page;
  return p ? [page * p, (page + 1) * p] : [0, 0];
}

// New York UTC offset in seconds (-14400 EDT / -18000 EST), US rules since 2007. No Intl.
function nthSunday(y, m, n) { // m 0-based; returns UTC day-start ms of the nth Sunday
  const first = Date.UTC(y, m, 1); const dow = new Date(first).getUTCDay();
  return first + (((7 - dow) % 7) + 7 * (n - 1)) * 864e5;
}
export function nyOffset(t) {
  const y = new Date(t * 1000).getUTCFullYear();
  const start = nthSunday(y, 2, 2) / 1000 + 7 * H; // 02:00 EST = 07:00 UTC
  const end = nthSunday(y, 10, 1) / 1000 + 6 * H;  // 02:00 EDT = 06:00 UTC
  return t >= start && t < end ? -4 * H : -5 * H;
}

// CME Globex weekly schedule (Sun 18:00 ET - Fri 17:00 ET, daily break 17:00-18:00 ET).
export function globexOpen(t) {
  const local = t + nyOffset(t);
  const dow = (Math.floor(local / D) + 4) % 7; // 1970-01-01 was a Thursday
  const min = Math.floor((local % D) / 60);
  if (dow === 6) return false;
  if (dow === 0) return min >= 18 * 60;
  if (dow === 5) return min < 17 * 60;
  return !(min >= 17 * 60 && min < 18 * 60);
}

// Price rounding to the instrument's tick precision (Yahoo returns float32 noise like 89.760002).
function decimalsOf(tick) { const s = String(tick); return s.includes('.') ? Math.min(s.split('.')[1].length, 6) : 0; }
function rounder(dec) { const f = Math.pow(10, dec); return (n) => Math.round(n * f) / f; }

// Yahoo chart JSON -> compact rows [t, o, h, l, c, v] (t epoch seconds, ascending, de-duplicated).
// Yahoo appends a trailing "latest tick" point stamped with the current second; it is folded into
// the bar it belongs to rather than shown as an extra candle.
export function parseYahoo(data, tf, dec = 6) {
  const cfg = TIMEFRAMES[tf];
  const r6 = rounder(dec);
  const r = data?.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  const ts = r?.timestamp || [];
  const out = [];
  if (!q) return out;
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    let t = ts[i];
    const v = Math.round(q.volume?.[i] || 0);
    const base = cfg.agg ? 3600 : cfg.step;
    if (base) t = Math.floor(t / base) * base;
    const prev = out[out.length - 1];
    const span = base || cfg.span;
    if (prev && t < prev[0] + span) {
      if (h > prev[2]) prev[2] = r6(h);
      if (l < prev[3]) prev[3] = r6(l);
      prev[4] = r6(c); prev[5] += v;
      continue;
    }
    out.push([t, r6(o), r6(h), r6(l), r6(c), v]);
  }
  return cfg.agg ? aggregateHours(out, cfg.agg) : out;
}

// N-hour bars aligned to the 18:00 ET Globex open (4h: 18, 22, 02, 06, 10, 14 ET).
export function aggregateHours(rows, n) {
  const out = [];
  const size = n * H;
  for (const r of rows) {
    const off = nyOffset(r[0]);
    const shift = off + 6 * H; // 18:00 ET -> a multiple of `size` in shifted time (n divides 24)
    const key = Math.floor((r[0] + shift) / size) * size - shift;
    const prev = out[out.length - 1];
    if (prev && prev[0] === key) {
      if (r[2] > prev[2]) prev[2] = r[2];
      if (r[3] < prev[3]) prev[3] = r[3];
      prev[4] = r[4]; prev[5] += r[5];
    } else out.push([key, r[1], r[2], r[3], r[4], r[5]]);
  }
  return out;
}

export function yahooUrl(sym, tf, page, now) {
  const cfg = TIMEFRAMES[tf];
  const yh = SYMBOLS[sym][0];
  let p1, p2;
  if (cfg.page) { [p1, p2] = pageBounds(tf, page); p2 = Math.min(p2, now + 60); }
  else { p1 = 0; p2 = now + 60; }
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yh)}?period1=${p1}&period2=${p2}&interval=${cfg.iv}`;
}

export class OutOfRange extends Error {}

// One upstream page. Throws OutOfRange for a page Yahoo cannot serve (empty is a valid answer),
// any other error for an upstream failure (caller falls back to last-good).
export async function fetchPage(sym, tf, page, now = Math.floor(Date.now() / 1000), fetchImpl = fetch) {
  const cfg = TIMEFRAMES[tf];
  if (cfg.page) {
    const [p1, p2] = pageBounds(tf, page);
    if (p1 > now) throw new OutOfRange('future page');
    if (p2 < now - cfg.depth) throw new OutOfRange('older than source depth');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(yahooUrl(sym, tf, page, now), {
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 StrykerCharts/1.0', 'accept': 'application/json' }
    });
    // 422 = "data not available for startTime/endTime" (outside Yahoo's window), 404 = no data.
    if (res.status === 422 || res.status === 404) throw new OutOfRange(`upstream ${res.status}`);
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const rows = parseYahoo(await res.json(), tf, decimalsOf(SYMBOLS[sym][4]));
    if (!cfg.page) return rows;
    const [p1, p2] = pageBounds(tf, page);
    return rows.filter((r) => r[0] >= p1 && r[0] < p2);
  } finally {
    clearTimeout(timer);
  }
}

// Cache lifetime (seconds) for a page: the page holding "now" refreshes quickly while Globex
// is open; closed pages are effectively immutable.
export function ttlFor(tf, page, now) {
  const cfg = TIMEFRAMES[tf];
  const end = cfg.page ? pageBounds(tf, page)[1] : Infinity;
  const current = end > now - 2 * H; // still may change (late prints, the forming bar)
  if (!current) return 86400;
  if (!globexOpen(now)) return 300;
  if (cfg.step && cfg.step <= 900) return 15;
  return cfg.page ? 30 : 60;
}
