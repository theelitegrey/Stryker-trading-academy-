// TradeZoro — Charts "futures" provider with a Rithmic source (ES module)
// Depends on: assets/rithmic-client.js (RithmicClient, BAR_TYPE). Wraps the existing
// assets/chart-futures-provider.js FuturesProvider (passed in, not imported).
// Created by assets/rithmic-ui.js; only ever loaded when the Rithmic flag is on.
//
// Same provider NAME ("futures") and the same symbol ids (NQ1!, ES1!, GC1! ...) as the normal
// Yahoo-backed provider, so saved layouts, templates, drawings and Pine indicators keep
// working unchanged. While the member's Rithmic connection is up, bars come from Rithmic:
//   - history: HISTORY_PLANT time-bar replay of the FRONT-MONTH contract (resolved with
//     RequestFrontMonthContract). NOTE: that is the current contract only, not a
//     back-adjusted continuous series, so old history ends where that contract's starts.
//   - live: TICKER_PLANT last-trade stream; the forming candle is built from the ticks here.
//   - no polling: one snapshot + updates per contract/timeframe ("live series" below).
// When Rithmic is not connected (never connected, reconnecting, logged out), every call is
// served by the normal provider: an automatic fallback. assets/rithmic-ui.js reloads the
// chart cells when the source flips, so the visible bars always match the chip.

import { BAR_TYPE } from './rithmic-client.js?v=730';

// Rithmic exchange codes for our roots.
export const EXCHANGE = {
  NQ: 'CME', MNQ: 'CME', ES: 'CME', MES: 'CME', RTY: 'CME', M2K: 'CME', '6E': 'CME',
  YM: 'CBOT', MYM: 'CBOT', ZN: 'CBOT', ZB: 'CBOT',
  GC: 'COMEX', MGC: 'COMEX', SI: 'COMEX',
  CL: 'NYMEX', MCL: 'NYMEX', NG: 'NYMEX'
};

const MIN = 60, DAY = 86400;
const TF = {
  '1': [BAR_TYPE.MINUTE_BAR, 1, MIN], '5': [BAR_TYPE.MINUTE_BAR, 5, 5 * MIN], '15': [BAR_TYPE.MINUTE_BAR, 15, 15 * MIN],
  '30': [BAR_TYPE.MINUTE_BAR, 30, 30 * MIN], '60': [BAR_TYPE.MINUTE_BAR, 60, 60 * MIN],
  '120': [BAR_TYPE.MINUTE_BAR, 120, 120 * MIN], '240': [BAR_TYPE.MINUTE_BAR, 240, 240 * MIN],
  D: [BAR_TYPE.DAILY_BAR, 1, DAY], W: [BAR_TYPE.WEEKLY_BAR, 1, 7 * DAY], M: [BAR_TYPE.DAILY_BAR, 1, 31 * DAY]
};
const TF_NORMALIZE = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '60m': '60', '2h': '120', '4h': '240', '4H': '240',
  '1d': 'D', '1D': 'D', d: 'D', '1w': 'W', '1W': 'W', w: 'W', '1M': 'M', '1mo': 'M' };

export function normTf(tf) { tf = String(tf || ''); return TF[tf] ? tf : (TF_NORMALIZE[tf] || null); }
export function rootOf(ticker) {
  const r = String(ticker || '').trim().toUpperCase().replace(/^[A-Z]+:/, '').replace(/1!$/, '');
  return Object.prototype.hasOwnProperty.call(EXCHANGE, r) ? r : null;
}

// One replay row -> Vela bar ({ time: open, epoch ms }).
export function rowToBar(row, tf, markerIsBarEnd) {
  const [type, , secs] = TF[tf];
  let open = row.marker || 0;
  // marker = the bar's END time for closed bars, but the newest (forming) bar carries its
  // last-update time instead (Rithmic Test 2026-10-05: a 15m ES replay at 17:15 UTC ended
  // with marker 17:14). Aligning to the period gives the right open time for both.
  if (type === BAR_TYPE.MINUTE_BAR) open = Math.floor((markerIsBarEnd ? open - 1 : open) / secs) * secs;
  else open = Math.floor(open / DAY) * DAY; // daily/weekly: the trading date
  return { time: open * 1000, open: row.open_price, high: row.high_price, low: row.low_price, close: row.close_price, volume: row.volume || 0 };
}

function toMonths(bars) {
  const out = [];
  for (const b of bars) {
    const d = new Date(b.time);
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, b.high); last.low = Math.min(last.low, b.low);
      last.close = b.close; last.volume += b.volume || 0;
    } else out.push({ time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 });
  }
  return out;
}

// ---- live series: one snapshot + updates (Rithmic conformance, no polling) ------------------
// Rithmic's implementation check (2026-10-13) wants the app to "subscribe for updates and retrieve a
// single snapshot to which the updates are applied", never to poll. Several parts of Charts ask the
// provider for the LATEST bars again and again: the watchlist (daily bars every 25 s), paper trading
// for symbols off the chart, built intervals (3m, 2D ...), the tab-resume back-fill
// (chart-live-resume.js) and Vela's own gap heal. With Rithmic each of those would be a new
// RequestTimeBarReplay. So per contract + timeframe we keep ONE series in memory:
//   - filled by ONE time-bar replay (the snapshot), the first time the series is needed;
//   - kept current by the ticker plant's LastTrade updates (one RequestMarketDataUpdate per contract);
//   - every later "latest bars" read is answered from memory; no request reaches Rithmic.
// A replay is sent again only when: the chart wants MORE history than the series holds (first deep
// load, scroll-back pages carry `to` and are always one replay per page), or the connection dropped
// (then only the GAP since the newest bar is replayed), or a daily/weekly/monthly series crossed into
// a new trading day (again only the gap). A series nobody has used for SERIES_IDLE_MS is released
// (its subscription is dropped by the client when no chart needs the contract).
const SERIES_IDLE_MS = 3 * 60 * 1000;
// A snapshot that failed (timeout / reject) or came back EMPTY is not retried by the repeating
// readers for this long (in practice: until the member reconnects): they get the standard data. Without this a
// silent history plant would be asked again on every watchlist / paper / resume read, i.e. polled.
// A scroll-back page (`to`) or the member reconnecting clears it.
const FAIL_BACKOFF_MS = 30 * 60 * 1000;
const MAX_SERIES_BARS = 12000;
const PAGE_CACHE_MAX = 60;       // scroll-back pages kept per connection (older history never changes)
const pageCaches = new WeakMap(); // client -> Map(key -> bars)
const stores = new WeakMap(); // client -> Map(key -> series): shared by every provider instance
// Futures trading date: CME sessions open 22:00/23:00 UTC for the next date.
const tradingDay = (ms = Date.now()) => Math.floor((ms + 2 * 3600 * 1000) / (DAY * 1000));

function mergeBars(old, add) {
  if (!old || !old.length) return add.slice();
  if (!add.length) return old;
  const first = add[0].time;
  const out = old.filter((b) => b.time < first);
  for (const b of add) out.push(b);
  return out.length > MAX_SERIES_BARS ? out.slice(-MAX_SERIES_BARS) : out;
}

export class RithmicFuturesProvider {
  // client: RithmicClient; fallback: the normal FuturesProvider; cfg: RITHMIC_CONFIG.
  constructor(client, fallback, cfg, hooks = {}) {
    this.client = client;
    this.fallback = fallback;
    this.cfg = cfg || {};
    this.hooks = hooks;
    let st = stores.get(client);
    if (!st) {
      st = new Map();
      stores.set(client, st);
      // Connection left 'connected' (drop, logout, error): every series has a gap from here on.
      if (client && client.on) client.on((ev) => {
        if (ev.type !== 'state') return;
        if (ev.state === 'idle' || ev.state === 'error') pageCaches.delete(client);
        if (ev.state === 'connected') { for (const h of st.values()) h.failedAt = 0; return; }
        for (const h of st.values()) {
          if (h.bars && h.bars.length && h.gapFrom == null) h.gapFrom = h.bars[h.bars.length - 1].time;
          if (ev.state === 'idle' || ev.state === 'error') { h.bars = null; h.gapFrom = null; if (h.unsubFeed) { h.unsubFeed(); h.unsubFeed = null; } h.feedPending = null; }
        }
      });
    }
    this.series = st;
  }

  get live() { return !!(this.client && this.client.connected); }

  info() {
    const base = this.fallback.info();
    return { ...base, capabilities: { ...base.capabilities, stream: true } };
  }
  listSymbols() { return this.fallback.listSymbols(); }
  getSymbolInfo(t) { return this.fallback.getSymbolInfo(t); }
  getCalendar(t, r) { return this.fallback.getCalendar(t, r); }
  resolveSymbolIcon(s) { return this.fallback.resolveSymbolIcon(s); }

  async getBars(ticker, timeframe, range = {}) {
    const root = rootOf(ticker), tf = normTf(timeframe);
    if (!this.live || !root || !tf) {
      if (root && this.hooks.onFallback) this.hooks.onFallback(root);
      return this.fallback.getBars(ticker, timeframe, range);
    }
    if (this.client.skipLoads && this.client.skipLoads.has(String(timeframe)) && range.to == null) return [];
    try {
      const bars = range.to != null ? await this.rithmicBars(root, tf, range) : await this.latestBars(root, tf, range);
      if (this.hooks.onSource) this.hooks.onSource('rithmic', root);
      return bars;
    } catch (e) {
      if (this.hooks.onError) this.hooks.onError(e, root);
      return this.fallback.getBars(ticker, timeframe, range);
    }
  }

  holder(root, tf) {
    const key = root + '|' + tf;
    let h = this.series.get(key);
    if (!h) {
      h = { key, root, tf, failedAt: 0, bars: null, complete: false, day: 0, gapFrom: null, listeners: new Set(), unsubFeed: null, feedPending: null, inflight: null, lastUse: 0, idleTm: null };
      this.series.set(key, h);
    }
    h.lastUse = Date.now();
    this.armIdle(h);
    return h;
  }

  armIdle(h) {
    clearTimeout(h.idleTm);
    h.idleTm = setTimeout(() => {
      h.idleTm = null;
      if (h.listeners.size) return;               // a chart still shows it: re-armed on next use
      if (Date.now() - h.lastUse < SERIES_IDLE_MS) { this.armIdle(h); return; }
      if (h.unsubFeed) { h.unsubFeed(); h.unsubFeed = null; }
      this.series.delete(h.key);
    }, SERIES_IDLE_MS);
  }

  // Bars the series can answer from memory, or null.
  fromMemory(h, range) {
    if (!h.bars || !h.bars.length || h.gapFrom != null || !h.unsubFeed) return null;
    let out;
    if (range.from != null) {
      if (!(h.bars[0].time <= range.from) && !h.complete) return null;
      out = h.bars.filter((b) => b.time >= range.from);
    } else {
      const want = range.limit != null ? range.limit : 500;
      if (h.bars.length < want && !h.complete) return null;
      out = h.bars.slice(-want);
    }
    if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
    return out.map((b) => ({ ...b }));
  }

  // Latest bars (no `to`): memory first; otherwise ONE replay (snapshot, or just the gap).
  async latestBars(root, tf, range) {
    const h = this.holder(root, tf);
    if (h.inflight) { try { await h.inflight; } catch (e) {} }
    const nonIntraday = TF[tf][0] !== BAR_TYPE.MINUTE_BAR;
    if (h.bars && h.bars.length && nonIntraday && h.day !== tradingDay() && h.gapFrom == null) h.gapFrom = h.bars[h.bars.length - 1].time;
    let hit = this.fromMemory(h, range);
    if (hit) return hit;
    if (h.failedAt && Date.now() - h.failedAt < FAIL_BACKOFF_MS) throw new Error('Rithmic history unavailable for ' + root + ' (retry later)');
    const run = (async () => {
      if (h.bars && h.bars.length && h.gapFrom != null) {
        // Reconnected (or a new trading day): replay only from the newest bar we hold.
        let gap;
        try { gap = await this.rithmicBars(root, tf, { from: h.gapFrom }); } catch (e) { h.failedAt = Date.now(); throw e; }
        h.bars = mergeBars(h.bars, gap);
        h.gapFrom = null;
      }
      if (!this.fromMemoryShape(h, range)) {
        const want = range.from != null ? null : (range.limit != null ? range.limit : 500);
        let bars;
        try { bars = await this.rithmicBars(root, tf, range); } catch (e) { h.failedAt = Date.now(); throw e; }
        if (!bars.length && !(h.bars && h.bars.length)) { h.failedAt = Date.now(); throw new Error('Rithmic returned no history for ' + root); }
        h.failedAt = 0;
        h.complete = want != null ? bars.length < want : true;
        h.bars = mergeBars(h.bars && h.bars.length && bars.length && h.bars[0].time < bars[0].time ? h.bars : null, bars);
        h.gapFrom = null;
      }
      h.day = tradingDay();
      await this.ensureFeed(h);
    })();
    h.inflight = run;
    try { await run; } finally { if (h.inflight === run) h.inflight = null; }
    hit = this.fromMemory(h, range);
    return hit || (h.bars || []).map((b) => ({ ...b }));
  }

  // Would the series cover `range` (ignoring the feed state)?
  fromMemoryShape(h, range) {
    if (!h.bars || !h.bars.length) return false;
    if (range.from != null) return h.bars[0].time <= range.from || h.complete;
    const want = range.limit != null ? range.limit : 500;
    return h.bars.length >= want || h.complete;
  }

  // One LastTrade subscription per series (the client keeps one RequestMarketDataUpdate per contract).
  ensureFeed(h) {
    if (h.unsubFeed) return Promise.resolve();
    if (h.feedPending) return h.feedPending;
    const ex = EXCHANGE[h.root];
    h.feedPending = (async () => {
      const sym = await this.client.frontMonth(h.root, ex);
      if (h.unsubFeed || this.series.get(h.key) !== h) return;
      h.unsubFeed = this.client.subscribeMarket(sym, ex, (ev) => this.applyTrade(h, ev));
    })().finally(() => { h.feedPending = null; });
    return h.feedPending;
  }

  // A LastTrade update applied to the series' forming candle (or rolling a new one).
  applyTrade(h, ev) {
    if (ev.kind !== 'trade' || !(ev.price > 0) || !h.bars || !h.bars.length) return;
    const [type, , secsS] = TF[h.tf];
    const secs = secsS * 1000;
    const intraday = type === BAR_TYPE.MINUTE_BAR;
    let bar = h.bars[h.bars.length - 1];
    if (intraday && ev.time >= bar.time + secs) {
      // Roll to a new candle, aligned to the last history bar (session-aligned like Rithmic's).
      const t = bar.time + Math.floor((ev.time - bar.time) / secs) * secs;
      bar = { time: t, open: ev.price, high: ev.price, low: ev.price, close: ev.price, volume: 0 };
      h.bars.push(bar);
      if (h.bars.length > MAX_SERIES_BARS) h.bars.shift();
    } else if (ev.time < bar.time && !ev.snapshot) {
      return; // a late print for an older candle
    }
    bar.close = ev.price;
    if (ev.price > bar.high) bar.high = ev.price;
    if (ev.price < bar.low) bar.low = ev.price;
    if (!ev.snapshot) bar.volume = (bar.volume || 0) + (ev.size || 0);
    if (h.listeners.size) { const out = { ...bar }; for (const fn of [...h.listeners]) { try { fn({ ...out }); } catch (e) {} } }
  }

  // One time-bar replay. `to` set = a scroll-back page; otherwise the newest bars.
  async rithmicBars(root, tf, range) {
    const ex = EXCHANGE[root];
    const sym = await this.client.frontMonth(root, ex);
    const [type, period, secs] = TF[tf];
    const nowS = Math.floor(Date.now() / 1000);
    const endS = range.to != null ? Math.min(nowS, Math.floor(range.to / 1000)) + secs : nowS + secs;
    const limit = range.limit != null ? range.limit : (range.from != null ? 10000 : 500);
    const want = tf === 'M' ? limit * 23 : limit;
    // Futures trade ~23h x 5d: a window ~1.6x the bar span covers weekends and holidays.
    const startS = range.from != null ? Math.floor(range.from / 1000) : endS - Math.ceil(want * secs * (type === BAR_TYPE.MINUTE_BAR ? 1.6 : 1.5)) - 4 * DAY;
    // Scroll-back pages (`to`) are history that never changes: one request per page, then cached.
    let pcache = null, pkey = null;
    if (range.to != null) {
      pcache = pageCaches.get(this.client) || new Map();
      pageCaches.set(this.client, pcache);
      pkey = [sym, tf, startS, endS, limit].join('|');
      const hit = pcache.get(pkey);
      if (hit) { pcache.delete(pkey); pcache.set(pkey, hit); return hit.map((b) => ({ ...b })); }
    }
    const rows = await this.client.timeBars(sym, ex, { barType: type, period, startSec: startS, endSec: endS, maxCount: Math.min(10000, want + 2) });
    let bars = [];
    let last = -1;
    for (const r of rows) {
      const b = rowToBar(r, tf, this.cfg.markerIsBarEnd !== false);
      if (!(b.time > last) || !(b.open > 0)) continue;
      bars.push(b); last = b.time;
    }
    if (tf === 'M') bars = toMonths(bars);
    if (range.limit != null && bars.length > range.limit) bars = bars.slice(-range.limit);
    if (pcache && bars.length) {
      pcache.set(pkey, bars.map((b) => ({ ...b })));
      if (pcache.size > PAGE_CACHE_MAX) pcache.delete(pcache.keys().next().value);
    }
    return bars;
  }

  subscribe(ticker, timeframe, onBar, opts) {
    const root = rootOf(ticker), tf = normTf(timeframe);
    if (!this.live || !root || !tf) return this.fallback.subscribe(ticker, timeframe, onBar, opts);
    let stopped = false, fbUnsub = null;
    const h = this.holder(root, tf);
    h.listeners.add(onBar);
    (async () => {
      try {
        // Normally the chart's getBars already took the snapshot; this is the rare cold start.
        if (!h.bars) await this.latestBars(root, tf, { limit: 2 });
        else await this.ensureFeed(h);
      } catch (e) {
        if (stopped) return;
        if (this.hooks.onError) this.hooks.onError(e, root);
        // No Rithmic history for this chart (it shows the standard data): its candles keep coming
        // from the standard feed, while the ONE Rithmic market-data subscription stays open (quotes,
        // order-flow trades). Nothing is re-requested from Rithmic.
        try { fbUnsub = this.fallback.subscribe(ticker, timeframe, onBar, opts); } catch (x) {}
        this.ensureFeed(h).catch(() => {});
      }
    })();
    return () => {
      if (stopped) return;
      stopped = true;
      if (fbUnsub) { try { fbUnsub(); } catch (e) {} }
      h.listeners.delete(onBar);
      h.lastUse = Date.now();
      this.armIdle(h);
    };
  }
}

// Real-trade source for the order-flow tools (assets/chart-orderflow.js registerTradeSource):
// every LastTrade of the front-month contract with its aggressor side (BUY 1 / SELL 2). There is
// no tick-history replay here, so the footprint builds from the moment the chart subscribes; the
// first, partly seen candle is skipped. Trades without an aggressor side are ignored.
export function rithmicTradeSource(client) {
  return (ticker, onTrade, onStatus) => {
    const root = rootOf(ticker);
    if (!root) { onStatus('error', 'This symbol has no Rithmic contract.'); return () => {}; }
    let stopped = false, unsub = null;
    onStatus('waiting');
    (async () => {
      try {
        const sym = await client.frontMonth(root, EXCHANGE[root]);
        if (stopped) return;
        unsub = client.subscribeMarket(sym, EXCHANGE[root], (ev) => {
          if (ev.kind !== 'trade' || ev.snapshot || !ev.side || !(ev.size > 0)) return;
          onTrade([{ time: ev.time, price: ev.price, size: ev.size, side: ev.side }], false);
        });
        if (stopped && unsub) unsub();
      } catch (e) { onStatus('error', 'Could not subscribe to Rithmic trades.'); }
    })();
    return () => { stopped = true; if (unsub) unsub(); };
  };
}

// Order-book source for the Liquidity Map (assets/chart-orderflow.js, window.__stkBookSources.futures): the member's own
// depth of the front-month contract, kept in THIS browser only (nothing is stored or relayed). onEv gets the client's
// { kind: 'book' | 'nobook' } events; onStatus('waiting' | 'error', text). Data only.
export function rithmicBookSource(client) {
  return (ticker, onEv, onStatus) => {
    const root = rootOf(ticker);
    if (!root) { onStatus('error', 'This symbol has no Rithmic contract.'); return () => {}; }
    let stopped = false, unsub = null;
    onStatus('waiting');
    (async () => {
      try {
        const sym = await client.frontMonth(root, EXCHANGE[root]);
        if (stopped) return;
        unsub = client.subscribeBook(sym, EXCHANGE[root], onEv);
        if (stopped && unsub) unsub();
      } catch (e) { onStatus('error', 'Could not subscribe to the Rithmic order book.'); }
    })();
    return () => { stopped = true; if (unsub) unsub(); };
  };
}
