// TradeZoro — Charts futures data provider (ES module)
// Depends on: /api/chart/bars/:sym (functions/api/chart/bars/[sym].js + functions/api/chart/_bars.js).
// Imported by assets/vela-chart.js and registered with Vela as the "futures" provider, and
// (FxProvider, same paging code) as the "fx" provider for spot forex pairs.
//
// Implements Vela's DataProvider port (@luxalgo/vela 0.6.17, dist/DataProvider-*.d.ts):
//   getBars, listSymbols, getSymbolInfo, getCalendar, resolveSymbolIcon, subscribe, info.
// Data: continuous front-month futures bars from Yahoo Finance via our own edge-cached
// endpoint. The InsightSentry roots stream through /api/chart/stream (streamSubscribe, which
// reconnects after a close); everything else polls: subscribe() re-reads the newest page every
// POLL_MS (paused while the tab is hidden) so the forming bar moves, nothing more.
//
// The API serves bars in fixed epoch-aligned PAGES per timeframe (identical URLs -> shared
// edge cache). PAGE_SECS / DEPTH_SECS below mirror TIMEFRAMES in functions/api/chart/_bars.js:
// keep the two in step.

import { rtReady, rtHeadersReady, rtToken, isRealtimeAdmin } from './rt-access.js?v=600';

const API = '/api/chart/bars/';
const STREAM_API = '/api/chart/stream/';
// Bridge failure backoff. functions/api/chart/stream/[sym].js accepts the socket (101) BEFORE it
// reaches InsightSentry, so a down or rejecting upstream looks like open -> close 1011 a moment
// later. A socket only counts as healthy once its first 'bar' arrives (or it stayed open 30 s);
// open-then-close without a bar is a failure: retry after 5 s doubling to a 3 min cap and poll
// REST meanwhile. The state is shared per root|tf, so a re-subscription (chart-live-resume.js on
// return to the tab or a quiet feed) waits out the same backoff instead of starting over.
// 10 min of a failing bridge = 8 attempts (was 352: every retry 1 s after the 'open').
const STREAM_HEALTHY_MS = 30000;
const STREAM_FAIL_BASE_MS = 5000, STREAM_FAIL_MAX_MS = 90000; // was a 3 min cap (2026-10-14: recover sooner, still <= ~10 tries / 10 min)
// TICKS (Owner 2026-10-14: "if we are getting tick data, why are the candles not moving fast?"): the
// bridge is asked for ticks=1 on minute/hour timeframes, so the forming candle follows every trade
// (coalesced server-side to <= 10 updates/s) instead of InsightSentry's ~1 Hz series updates. If a
// ticks=1 socket fails before its first bar, this page falls back to the plain series socket at once
// (no backoff) and stays on it.
let ticksOff = false;
const TICK_TFS = ['1', '5', '15', '30', '60', '120', '240'];
const streamFails = new Map(); // root|tf -> { n: failures in a row, nextAt: no attempt before }
const POLL_MS = 20000;
// FROZEN CANDLES 2026-10-16 (Owner: "countdown is working but not candles"): the bridge accepts the
// socket (101) BEFORE it reaches InsightSentry, which rejects extra connections while several are
// open (timeframe/symbol switches stack them, bars requests open their own): open -> close 1011
// within ~100 ms. That used to count as a hard failure (shared 5-90 s backoff, REST poll ~10 min
// behind, so no live candle for minutes). Now an early close is TRANSIENT: up to QUICK_RETRY_MAX
// retries 0.5-2 s apart (jittered) while the REST poll covers (every FALLBACK_POLL_MS), the shared
// backoff only starts once those are used up, and any bar from the bridge resets every counter.
// At most MAX_BRIDGE_SOCKETS bridge sockets are open per page.
const QUICK_RETRY_MAX = 5, QUICK_RETRY_MIN_MS = 500, QUICK_RETRY_SPAN_MS = 1500;
const FALLBACK_POLL_MS = 8000;
const MAX_BRIDGE_SOCKETS = 8;
let bridgeSockets = 0;
const CONCURRENCY = 4;
export const INSIGHTSENTRY_ROOTS = ['NQ', 'MNQ', 'ES', 'MES', 'RTY', 'YM', 'MYM', 'GC', 'MGC', 'SI', 'SIL', 'CL', 'MCL'];
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

// Prices are snapped to the contract's tick (NQ 0.25): the server rounds to 2 decimals, which let
// 30120.97 through. Applied to every bar that reaches the chart (history, stream, poll, tail rows).
function snapTick(p, tick) {
  if (!(tick > 0) || !Number.isFinite(p)) return p;
  return Number((Math.round(p / tick) * tick).toFixed(Math.min(8, decimalsOf(tick) + 1)));
}
function tickOfKey(key) {
  return SYMBOLS[key] ? SYMBOLS[key][3] : 0;   // futures only; forex keeps its own precision
}
const toBar = (r, tick) => ({ time: r[0] * 1000, open: snapTick(r[1], tick), high: snapTick(r[2], tick), low: snapTick(r[3], tick), close: snapTick(r[4], tick), volume: r[5] });

// SPEED (Owner order 2026-10-14, "switching symbols ... need to be under 1 sec"): the page memo is
// shared by EVERY provider instance on the page (each chart cell, the grid, prefetch), so a page
// loaded once is never fetched again by another cell, and switching back to a symbol seen before
// paints from memory. LRU-capped at PAGE_CACHE_MAX pages (~1-3 KB of rows each).
// Stale-while-revalidate for the page holding "now": up to swrMs old, the cached rows are answered
// at once and a refresh runs behind them. swrMs is one bar of the timeframe (60 s on 1m, 5 min on
// 5m and up): within that the chart can at most miss the forming bar and one new bar, which the
// stream bridge (it replays the recent bars on connect) or the poll (it re-reads the last 2 bars)
// fills straight away. The poll itself always reads fresh (range.fresh).
const PAGE_CACHE_MAX = 600;
const SHARED_PAGES = new Map();    // `${base}|${root}|${tf}|${page}` -> { at, rows }
const SHARED_INFLIGHT = new Map();
const swrMsFor = (tf) => (tf === '1' ? 60000 : 300000);
function cachePut(key, rows) {
  SHARED_PAGES.delete(key);
  SHARED_PAGES.set(key, { at: Date.now(), rows });
  if (SHARED_PAGES.size > PAGE_CACHE_MAX) {
    let drop = SHARED_PAGES.size - PAGE_CACHE_MAX + 50;
    for (const k of SHARED_PAGES.keys()) { if (drop-- <= 0) break; SHARED_PAGES.delete(k); }
  }
}

export class FuturesProvider {
  constructor(opts = {}) {
    this.base = opts.base || API;
    this.pages = SHARED_PAGES; // shared memo, see above
    this.inflight = SHARED_INFLIGHT;
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

  async fetchPage(root, tf, page, current, swrMs = 0) {
    const key = `${this.base}|${root}|${tf}|${page}`;
    const hit = this.pages.get(key);
    // Closed pages never change; the current page is re-read after 10 s at most, or answered from
    // memory up to swrMs old while a refresh runs (stale-while-revalidate, see SHARED_PAGES).
    if (hit) {
      const age = Date.now() - hit.at;
      if (page !== current || age < 10000) { cachePut(key, hit.rows); return hit.rows; }
      if (swrMs && age < swrMs) { this.loadPage(key, root, tf, page).catch(() => {}); return hit.rows; }
    }
    return this.loadPage(key, root, tf, page);
  }

  loadPage(key, root, tf, page) {
    let p = this.inflight.get(key);
    if (!p) {
      p = (async () => {
        const res = await fetch(`${this.base}${encodeURIComponent(root)}?tf=${tf}&page=${page}`, { headers: Object.assign({ accept: 'application/json' }, await rtHeadersReady()) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const rows = Array.isArray(body.bars) ? body.bars : [];
        cachePut(key, rows);
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
    const swrMs = range.fresh ? 0 : swrMsFor(tf);

    let rows = [];
    if (!PAGE_SECS[tf]) {
      rows = await this.fetchPage(root, tf, 0, 0, swrMs);
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
        const got = await Promise.all(batch.map((p) => this.fetchPage(root, tf, p, current, swrMs)));
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
      bars.push(toBar(r, tickOfKey(root)));
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
      // Real-time is admin only (Owner 2026-10-16): the server refuses the socket for anyone else, so
      // non-admins never open it and poll the (10 min delayed) bars instead.
      let stopped = false, stop = null;
      rtReady().then(() => {
        if (stopped) return;
        stop = isRealtimeAdmin() ? this.streamSubscribe(root, ticker, timeframe, tf, onBar) : this.pollSubscribe(ticker, timeframe, onBar);
      });
      return () => { stopped = true; if (stop) stop(); };
    }
    return this.pollSubscribe(ticker, timeframe, onBar);
  }

  // The stream bridge, kept alive. Build 509 and earlier switched to REST polling for good on the
  // FIRST close of this socket (a phone tab in the background, the bridge recycling, a network
  // change). REST pages run ~10 min behind the stream, so every polled bar was older than the
  // chart's newest streamed bar and Vela dropped it as out of order: the candles froze until a
  // reload (Owner bug 2026-10-12). Now a socket that has worked is RE-OPENED with backoff
  // (1 s doubling to 30 s; while the tab is hidden it waits for the tab to come back). Polling is
  // the answer while the bridge fails (never opens, or opens and closes before a bar: see
  // STREAM_FAIL_* above, backed off to 3 min), and stops again at the first streamed bar. On connect the bridge replays the recent bars, which fills the gap.
  // assets/chart-live-resume.js (via chart-intervals.js wrapProvider) additionally re-opens the
  // whole subscription on return to the tab and when the feed goes quiet.
  streamSubscribe(root, ticker, timeframe, tf, onBar) {
    let stopped = false;
    let pollStop = null;
    let everOpened = false;
    let ws = null;
    let openTimer = null, retryTimer = null, healthyTimer = null;
    let retry = 0;
    let withTicks = false, noTicks = false, quick = 0;
    const fkey = root + '|' + tf;
    const fs = streamFails.get(fkey) || { n: 0, nextAt: 0 };
    streamFails.set(fkey, fs);
    const startPoll = () => { if (!stopped && !pollStop) pollStop = this.pollSubscribe(ticker, timeframe, onBar, FALLBACK_POLL_MS); };
    const jitter = () => QUICK_RETRY_MIN_MS + Math.random() * QUICK_RETRY_SPAN_MS;
    const stopPoll = () => { if (pollStop) { const p = pollStop; pollStop = null; p(); } };
    const onVis = () => { if (!stopped && !document.hidden && !ws && !retryTimer) connect(); };
    // wait: after a healthy socket closes, 1 s doubling to 30 s; after a failure, the shared backoff
    const schedule = (wait) => {
      if (stopped || retryTimer) return;
      if (typeof document !== 'undefined' && document.hidden) return; // onVis reconnects
      retryTimer = setTimeout(() => { retryTimer = null; connect(); }, wait);
    };
    const failed = () => {
      fs.n++;
      fs.nextAt = Date.now() + Math.min(STREAM_FAIL_MAX_MS, STREAM_FAIL_BASE_MS * Math.pow(2, fs.n - 1));
      startPoll();
      schedule(fs.nextAt - Date.now());
    };
    const healthy = () => {
      if (healthyTimer) { clearTimeout(healthyTimer); healthyTimer = null; }
      fs.n = 0; fs.nextAt = 0; retry = 0; quick = 0;
      stopPoll();
    };
    function connect() {
      if (stopped || ws) return;
      // still inside a failure backoff (set only after QUICK_RETRY_MAX early closes): poll and wait it out
      if (Date.now() < fs.nextAt) { startPoll(); schedule(fs.nextAt - Date.now()); return; }
      if (bridgeSockets >= MAX_BRIDGE_SOCKETS) { startPoll(); schedule(jitter()); return; }
      let sock;
      try {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        withTicks = !ticksOff && !noTicks && TICK_TFS.includes(tf);
        sock = new WebSocket(`${proto}//${location.host}${STREAM_API}${encodeURIComponent(root)}?tf=${encodeURIComponent(tf)}${withTicks ? '&ticks=1' : ''}`, rtToken() ? ['tz-auth', rtToken()] : undefined);
      } catch (e) { failed(); return; }
      ws = sock;
      bridgeSockets++;
      sock.addEventListener('close', () => { bridgeSockets = Math.max(0, bridgeSockets - 1); });
      let opened = false, gotBar = false;
      if (openTimer) clearTimeout(openTimer);
      // No open within 5 s: show polled bars meanwhile (the old behaviour for a missing bridge).
      openTimer = setTimeout(() => { openTimer = null; if (!opened && !everOpened) startPoll(); }, 5000);
      // 'open' only means the bridge accepted; it has not reached the upstream yet.
      sock.onopen = () => {
        if (ws !== sock) return;
        opened = everOpened = true;
        if (openTimer) { clearTimeout(openTimer); openTimer = null; }
        if (healthyTimer) clearTimeout(healthyTimer);
        healthyTimer = setTimeout(() => { healthyTimer = null; if (ws === sock && !gotBar) { gotBar = true; healthy(); } }, STREAM_HEALTHY_MS);
      };
      sock.onmessage = (ev) => {
        if (stopped || ws !== sock) return;
        try {
          const msg = JSON.parse(ev.data);
          if (msg && msg.event === 'bar' && Array.isArray(msg.bar)) {
            if (!gotBar) { gotBar = true; healthy(); }
            onBar(toBar(msg.bar, tickOfKey(root)));
          }
        } catch (e) {}
      };
      sock.onerror = () => { try { sock.close(); } catch (e) {} };
      sock.onclose = () => {
        if (ws !== sock) return;
        ws = null;
        if (healthyTimer) { clearTimeout(healthyTimer); healthyTimer = null; }
        if (stopped) return;
        // never delivered a bar (refused, or accepted then closed 1011): a failure, backed off
        if (!gotBar) {
          if (withTicks) { noTicks = true; startPoll(); schedule(250); return; } // retry at once without the tick leg (this subscription only)
          if (quick < QUICK_RETRY_MAX) { quick++; startPoll(); schedule(jitter()); return; }
          failed(); return;
        }
        schedule(Math.min(30000, 1000 * Math.pow(2, retry++)));  // a working stream dropped
      };
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    // a NEW subscription (timeframe/symbol switch, tab return) always gets its quick attempts, even
    // if an earlier one for this key ended in the shared backoff
    fs.nextAt = 0;
    connect();
    return () => {
      stopped = true;
      if (openTimer) clearTimeout(openTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (healthyTimer) clearTimeout(healthyTimer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
      stopPoll();
      const s = ws; ws = null;
      try { if (s) s.close(); } catch (e) {}
    };
  }

  // Forming-bar refresh by polling (fallback path). Pauses while the tab is hidden.
  pollSubscribe(ticker, timeframe, onBar, pollMs = POLL_MS) {
    let stopped = false;
    let timer = null;
    const tick = async () => {
      timer = null;
      if (stopped) return;
      if (typeof document !== 'undefined' && document.hidden) return; // resumed by visibilitychange
      try {
        const bars = await this.getBars(ticker, timeframe, { limit: 2, fresh: true });
        if (!stopped) for (const b of bars) onBar(b);
      } catch (e) { /* next poll retries */ }
      if (!stopped) timer = setTimeout(tick, pollMs);
    };
    const onVis = () => {
      if (stopped || document.hidden || timer) return;
      timer = setTimeout(tick, 0);
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    timer = setTimeout(tick, Math.min(pollMs, 3000));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }
}
FuturesProvider.INSIGHTSENTRY_ROOTS = INSIGHTSENTRY_ROOTS;

// Warm the shared page memo for a symbol the member is likely to open next (a hovered watchlist or
// symbol-search row, the Owner's contracts at idle). Same pages and URLs the chart itself reads, so
// the edge cache is shared too. Futures roots and forex pairs only (crypto venues answer in ~0.3 s
// on their own). Never throws; at most one prefetch per symbol|tf every 20 s.
const prefetched = new Map();
export function prefetchBars(sym, tf) {
  try {
    const ticker = String(sym || '').replace(/^[a-z_]+:/i, '');
    const t = normTf(tf) || '15';
    const P = rootOf(ticker) ? FuturesProvider : (pairOf(ticker) ? FxProvider : null);
    if (!P) return Promise.resolve(false);
    const k = ticker.toUpperCase() + '|' + t;
    if (Date.now() - (prefetched.get(k) || 0) < 20000) return Promise.resolve(false);
    prefetched.set(k, Date.now());
    return new P().getBars(ticker, t, {}).then(() => true, () => false);
  } catch (e) { return Promise.resolve(false); }
}

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
