// Stryker Trading Academy — Charts futures data provider (ES module)
// Depends on: /api/chart/bars/:sym (functions/api/chart/bars/[sym].js + functions/api/chart/_bars.js).
// Imported by assets/vela-chart.js and registered with Vela as the "futures" provider, and
// (FxProvider, same paging code) as the "fx" provider for spot forex pairs.
//
// Implements Vela's DataProvider port (@luxalgo/vela 0.6.17, dist/DataProvider-*.d.ts):
//   getBars, listSymbols, getSymbolInfo, getCalendar, resolveSymbolIcon, subscribe, info.
// Data: continuous front-month futures bars from Yahoo Finance via our own edge-cached
// endpoint. It is NOT a live feed: subscribe() re-reads the newest page every POLL_MS
// (paused while the tab is hidden) so the forming bar moves, nothing more.
//
// The API serves bars in fixed epoch-aligned PAGES per timeframe (identical URLs -> shared
// edge cache). PAGE_SECS / DEPTH_SECS below mirror TIMEFRAMES in functions/api/chart/_bars.js:
// keep the two in step.

const API = '/api/chart/bars/';
const STREAM_API = '/api/chart/stream/';
const POLL_MS = 20000;
const CONCURRENCY = 4;
export const INSIGHTSENTRY_ROOTS = ['NQ', 'MNQ', 'ES', 'MES', 'RTY'];
const H = 3600, D = 86400;

const PAGE_SECS = { '1': 8 * H, '5': 2 * D, '15': 5 * D, '30': 10 * D, '60': 20 * D, '120': 40 * D, '240': 60 * D, D: 730 * D, W: 0, M: 0 };
const DEPTH_SECS = { '1': 29 * D, '5': 59 * D, '15': 59 * D, '30': 59 * D, '60': 729 * D, '120': 729 * D, '240': 729 * D, D: 40 * 365 * D, W: 0, M: 0 };
const TF_NORMALIZE = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '60m': '60', '2h': '120', '4h': '240', '4H': '240',
  '1d': 'D', '1D': 'D', d: 'D', '1w': 'W', '1W': 'W', w: 'W', '1M': 'M', '1mo': 'M' };
const SUPPORTED = ['1', '5', '15', '30', '60', '120', '240', 'D', 'W', 'M'];

// root: [description, exchange, market, tick, point value]
const SYMBOLS = {
  NQ:  ['Nasdaq-100 E-mini futures',         'CME',   'index',  0.25,     20],
  MNQ: ['Micro Nasdaq-100 E-mini futures',   'CME',   'index',  0.25,     2],
  ES:  ['S&P 500 E-mini futures',            'CME',   'index',  0.25,     50],
  MES: ['Micro S&P 500 E-mini futures',      'CME',   'index',  0.25,     5],
  YM:  ['Dow Jones E-mini futures ($5)',     'CBOT',  'index',  1,        5],
  MYM: ['Micro Dow Jones E-mini futures',    'CBOT',  'index',  1,        0.5],
  RTY: ['Russell 2000 E-mini futures',       'CME',   'index',  0.1,      50],
  M2K: ['Micro Russell 2000 E-mini futures', 'CME',   'index',  0.1,      5],
  GC:  ['Gold futures',                      'COMEX', 'metals', 0.1,      100],
  MGC: ['Micro Gold futures',                'COMEX', 'metals', 0.1,      10],
  SI:  ['Silver futures',                    'COMEX', 'metals', 0.005,    5000],
  CL:  ['Crude Oil WTI futures',             'NYMEX', 'energy', 0.01,     1000],
  MCL: ['Micro WTI Crude Oil futures',       'NYMEX', 'energy', 0.01,     100],
  NG:  ['Natural Gas futures',               'NYMEX', 'energy', 0.001,    10000],
  ZN:  ['10-Year T-Note futures',            'CBOT',  'rates',  0.015625, 1000],
  ZB:  ['U.S. Treasury Bond futures',        'CBOT',  'rates',  0.03125,  1000],
  '6E':['Euro FX futures',                   'CME',   'fx',     0.00005,  125000],
  HG:  ['Copper futures',                    'COMEX', 'metals', 0.0005,   25000],
  MHG: ['Micro Copper futures',              'COMEX', 'metals', 0.0005,   2500],
  SIL: ['Micro Silver futures',              'COMEX', 'metals', 0.005,    1000]
};
// Spot forex (Yahoo "=X" pairs, same endpoint). pair: [description, tick]. Mirrors the forex rows
// of SYMBOLS in functions/api/chart/_bars.js. 5 decimals, 3 for JPY pairs. No spot gold/silver:
// Yahoo has no XAUUSD/XAGUSD series, so metals stay on the COMEX futures (GC, MGC, SI, SIL).
export const FX_PAIRS = {
  EURUSD: ['Euro / U.S. Dollar', 0.00001],
  GBPUSD: ['British Pound / U.S. Dollar', 0.00001],
  USDJPY: ['U.S. Dollar / Japanese Yen', 0.001],
  AUDUSD: ['Australian Dollar / U.S. Dollar', 0.00001],
  USDCAD: ['U.S. Dollar / Canadian Dollar', 0.00001],
  USDCHF: ['U.S. Dollar / Swiss Franc', 0.00001],
  NZDUSD: ['New Zealand Dollar / U.S. Dollar', 0.00001],
  EURGBP: ['Euro / British Pound', 0.00001],
  EURJPY: ['Euro / Japanese Yen', 0.001],
  GBPJPY: ['British Pound / Japanese Yen', 0.001],
  EURCHF: ['Euro / Swiss Franc', 0.00001],
  EURAUD: ['Euro / Australian Dollar', 0.00001],
  EURCAD: ['Euro / Canadian Dollar', 0.00001],
  AUDJPY: ['Australian Dollar / Japanese Yen', 0.001],
  CADJPY: ['Canadian Dollar / Japanese Yen', 0.001],
  CHFJPY: ['Swiss Franc / Japanese Yen', 0.001],
  GBPCHF: ['British Pound / Swiss Franc', 0.00001],
  AUDNZD: ['Australian Dollar / New Zealand Dollar', 0.00001]
};
export const FX_MAJORS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD'];
// Futures roots the symbol search also lists under its "Commodities" tab.
export const COMMODITY_ROOTS = ['GC', 'MGC', 'SI', 'SIL', 'HG', 'MHG', 'CL', 'MCL', 'NG'];

function normTf(tf) {
  tf = String(tf || '');
  return SUPPORTED.includes(tf) ? tf : (TF_NORMALIZE[tf] || null);
}
function rootOf(ticker) {
  const r = String(ticker || '').trim().toUpperCase().replace(/^[A-Z]+:/, '').replace(/1!$/, '');
  return Object.prototype.hasOwnProperty.call(SYMBOLS, r) ? r : null;
}
function decimalsOf(tick) {
  const s = String(tick);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

// New York UTC offset (seconds), US DST rules; mirrors _bars.js nyOffset.
function nthSunday(y, m, n) {
  const first = Date.UTC(y, m, 1);
  const dow = new Date(first).getUTCDay();
  return first + (((7 - dow) % 7) + 7 * (n - 1)) * 864e5;
}
function nyOffset(t) {
  const y = new Date(t * 1000).getUTCFullYear();
  const start = nthSunday(y, 2, 2) / 1000 + 7 * H;
  const end = nthSunday(y, 10, 1) / 1000 + 6 * H;
  return t >= start && t < end ? -4 * H : -5 * H;
}
// Epoch seconds of New York wall time on the civil day containing `dayUtc` (00:00 UTC) + hh:00.
function nyWall(dayUtc, hh) {
  const guess = dayUtc + hh * H + 5 * H;
  return dayUtc + hh * H - nyOffset(guess);
}

const toBar = (r) => ({ time: r[0] * 1000, open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] });

export class FuturesProvider {
  constructor(opts = {}) {
    this.base = opts.base || API;
    this.pages = new Map(); // `${root}|${tf}|${page}` -> { at, rows } (closed pages only, plus a short-lived current page)
    this.inflight = new Map();
  }

  info() {
    return {
      name: 'futures',
      displayName: 'Futures',
      requiresApiKey: false,
      supportedTimeframes: SUPPORTED,
      capabilities: { enumerate: true, stream: false, symbolInfo: true }
    };
  }

  async listSymbols() {
    return Object.entries(SYMBOLS).map(([root, s]) => ({
      ticker: `${root}1!`,
      description: s[0],
      type: 'futures',
      prefix: s[1],
      market: s[2],
      exchange: s[1],
      mintick: s[3],
      pointvalue: s[4]
    }));
  }

  async getSymbolInfo(ticker) {
    const root = rootOf(ticker);
    if (!root) return undefined;
    const [description, exchange, market, tick, pointvalue] = SYMBOLS[root];
    return {
      ticker: `${root}1!`,
      tickerid: `${exchange}:${root}1!`,
      prefix: exchange,
      root,
      description,
      type: 'futures',
      market,
      currency: 'USD',
      mintick: tick,
      pricescale: Math.round(Math.pow(10, decimalsOf(tick))),
      minmove: Math.round(tick * Math.pow(10, decimalsOf(tick))),
      pointvalue,
      // CME Globex: Sunday 18:00 ET to Friday 17:00 ET with a daily 17:00-18:00 ET break.
      timezone: 'America/New_York',
      session: '1800-1700',
      session_extended: '1800-1700'
    };
  }

  // Open Globex windows over [from, to) (epoch ms). No exchange-holiday calendar: holiday
  // closures are not modelled. 'regular' and 'extended' are the same tape here.
  async getCalendar(ticker, range) {
    if (!this.keyOf(ticker)) return [];
    const out = [];
    let day = Math.floor(range.from / 1000 / D) * D - D;
    const end = range.to / 1000 + D;
    for (; day < end; day += D) {
      const dow = new Date(day * 1000).getUTCDay(); // civil weekday of this calendar date
      if (dow === 5 || dow === 6) continue;         // sessions open Sun-Thu evenings
      const s = nyWall(day, 18) * 1000;
      const e = nyWall(day + D, 17) * 1000;
      if (e > range.from && s < range.to) out.push([Math.max(s, range.from), Math.min(e, range.to)]);
    }
    return out;
  }

  resolveSymbolIcon() { return undefined; }

  // ---- bars ------------------------------------------------------------------------------

  pageOf(tf, t) { const p = PAGE_SECS[tf]; return p ? Math.floor(t / p) : 0; }

  async fetchPage(root, tf, page, current) {
    const key = `${root}|${tf}|${page}`;
    const hit = this.pages.get(key);
    // Closed pages never change; the current page is re-read after 10 s at most.
    if (hit && (page !== current || Date.now() - hit.at < 10000)) return hit.rows;
    let p = this.inflight.get(key);
    if (!p) {
      p = (async () => {
        const res = await fetch(`${this.base}${encodeURIComponent(root)}?tf=${tf}&page=${page}`, { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const rows = Array.isArray(body.bars) ? body.bars : [];
        if (this.pages.size > 400) this.pages.clear();
        this.pages.set(key, { at: Date.now(), rows });
        return rows;
      })().finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  keyOf(ticker) { return rootOf(ticker); }

  async getBars(ticker, timeframe, range = {}) {
    const root = this.keyOf(ticker);
    const tf = normTf(timeframe);
    if (!root || !tf) return [];
    const now = Math.floor(Date.now() / 1000);
    const toS = range.to != null ? Math.floor(range.to / 1000) : now;
    const fromS = range.from != null ? Math.floor(range.from / 1000) : null;
    const limit = range.limit != null ? range.limit : (fromS != null ? Infinity : 500);
    const current = this.pageOf(tf, now);

    let rows = [];
    if (!PAGE_SECS[tf]) {
      rows = await this.fetchPage(root, tf, 0, 0);
    } else {
      const floor = now - DEPTH_SECS[tf];
      let page = Math.min(this.pageOf(tf, toS), current);
      const stopPage = this.pageOf(tf, Math.max(fromS != null ? fromS : floor, floor));
      // Give up after ~4 days of consecutive empty pages (weekends/holidays are shorter).
      const maxEmpty = Math.max(2, Math.ceil(4 * D / PAGE_SECS[tf]));
      let empty = 0;
      const chunks = [];
      let have = 0;
      while (page >= stopPage && have < limit + 1 && empty < maxEmpty) {
        const batch = [];
        for (let i = 0; i < CONCURRENCY && page - i >= stopPage; i++) batch.push(page - i);
        const got = await Promise.all(batch.map((p) => this.fetchPage(root, tf, p, current)));
        for (const g of got) {
          chunks.push(g);
          if (g.length) { empty = 0; have += g.length; } else empty += 1;
        }
        page -= batch.length;
      }
      for (let i = chunks.length - 1; i >= 0; i--) rows = rows.concat(chunks[i]);
    }
    let bars = [];
    let last = -1;
    for (const r of rows) {
      if (r[0] <= last) continue;
      if (r[0] > toS) continue;
      if (fromS != null && r[0] < fromS) continue;
      bars.push(toBar(r));
      last = r[0];
    }
    if (range.limit != null && bars.length > range.limit) bars = bars.slice(-range.limit);
    return bars;
  }

  // Realtime futures updates through our server-side InsightSentry bridge. The browser never gets
  // the vendor key. If the bridge is closed/unavailable, fall back to the old safe polling path.
  subscribe(ticker, timeframe, onBar) {
    const root = this.keyOf(ticker);
    const tf = normTf(timeframe);
    if (root && tf && INSIGHTSENTRY_ROOTS.includes(root) && typeof WebSocket === 'function' && typeof location !== 'undefined') {
      let stopped = false;
      let pollStop = null;
      let opened = false;
      let ws = null;
      let fallbackTimer = null;
      const fallback = () => {
        if (stopped || pollStop) return;
        pollStop = this.pollSubscribe(ticker, timeframe, onBar);
      };
      try {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${proto}//${location.host}${STREAM_API}${encodeURIComponent(root)}?tf=${encodeURIComponent(tf)}`);
        fallbackTimer = setTimeout(() => { if (!opened) fallback(); }, 5000);
        ws.onopen = () => { opened = true; if (fallbackTimer) clearTimeout(fallbackTimer); };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg && msg.event === 'bar' && Array.isArray(msg.bar)) onBar(toBar(msg.bar));
          } catch (e) {}
        };
        ws.onerror = fallback;
        ws.onclose = fallback;
        return () => {
          stopped = true;
          if (fallbackTimer) clearTimeout(fallbackTimer);
          if (pollStop) pollStop();
          try { if (ws) ws.close(); } catch (e) {}
        };
      } catch (e) { fallback(); return () => { stopped = true; if (pollStop) pollStop(); }; }
    }
    return this.pollSubscribe(ticker, timeframe, onBar);
  }

  // Forming-bar refresh by polling (fallback path). Pauses while the tab is hidden.
  pollSubscribe(ticker, timeframe, onBar) {
    let stopped = false;
    let timer = null;
    const tick = async () => {
      timer = null;
      if (stopped) return;
      if (typeof document !== 'undefined' && document.hidden) return; // resumed by visibilitychange
      try {
        const bars = await this.getBars(ticker, timeframe, { limit: 2 });
        if (!stopped) for (const b of bars) onBar(b);
      } catch (e) { /* next poll retries */ }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    const onVis = () => {
      if (stopped || document.hidden || timer) return;
      timer = setTimeout(tick, 0);
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }
}
FuturesProvider.INSIGHTSENTRY_ROOTS = INSIGHTSENTRY_ROOTS;

// ---- spot forex --------------------------------------------------------------------------
function pairOf(ticker) {
  const r = String(ticker || '').trim().toUpperCase().replace(/^[A-Z_]+:/, '').replace(/[\/_\s]/g, '');
  return Object.prototype.hasOwnProperty.call(FX_PAIRS, r) ? r : null;
}

// Spot forex from the same endpoint (Yahoo "=X" series, edge-cached, polled, not a live feed).
// OTC market: Sunday 17:00 to Friday 17:00 New York, no daily break; volume is always 0.
export class FxProvider extends FuturesProvider {
  info() {
    return {
      name: 'fx',
      displayName: 'Forex',
      requiresApiKey: false,
      supportedTimeframes: SUPPORTED,
      capabilities: { enumerate: true, stream: false, symbolInfo: true }
    };
  }

  keyOf(ticker) { return pairOf(ticker); }

  async listSymbols() {
    return Object.entries(FX_PAIRS).map(([pair, s]) => ({
      ticker: pair,
      description: s[0],
      type: 'forex',
      prefix: 'FX',
      market: 'forex',
      exchange: 'FX',
      mintick: s[1],
      pointvalue: 1
    }));
  }

  async getSymbolInfo(ticker) {
    const pair = pairOf(ticker);
    if (!pair) return undefined;
    const [description, tick] = FX_PAIRS[pair];
    const dec = decimalsOf(tick);
    return {
      ticker: pair,
      tickerid: `FX:${pair}`,
      prefix: 'FX',
      description,
      type: 'forex',
      market: 'forex',
      currency: pair.slice(3),
      basecurrency: pair.slice(0, 3),
      mintick: tick,
      pricescale: Math.round(Math.pow(10, dec)),
      minmove: 1,
      pointvalue: 1,
      timezone: 'America/New_York',
      session: '1700-1700',
      session_extended: '1700-1700'
    };
  }

  // One open window per trading day, 17:00 New York to 17:00 the next day, Sunday to Thursday
  // evenings. No holiday calendar.
  async getCalendar(ticker, range) {
    if (!pairOf(ticker)) return [];
    const out = [];
    let day = Math.floor(range.from / 1000 / D) * D - D;
    const end = range.to / 1000 + D;
    for (; day < end; day += D) {
      const dow = new Date(day * 1000).getUTCDay();
      if (dow === 5 || dow === 6) continue;
      const s = nyWall(day, 17) * 1000;
      const e = nyWall(day + D, 17) * 1000;
      if (e > range.from && s < range.to) out.push([Math.max(s, range.from), Math.min(e, range.to)]);
    }
    return out;
  }
}
