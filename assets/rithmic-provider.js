// Stryker Trading Academy — Charts "futures" provider with a Rithmic source (ES module)
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
// When Rithmic is not connected (never connected, reconnecting, logged out), every call is
// served by the normal provider: an automatic fallback. assets/rithmic-ui.js reloads the
// chart cells when the source flips, so the visible bars always match the chip.

import { BAR_TYPE } from './rithmic-client.js?v=439';

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

export class RithmicFuturesProvider {
  // client: RithmicClient; fallback: the normal FuturesProvider; cfg: RITHMIC_CONFIG.
  constructor(client, fallback, cfg, hooks = {}) {
    this.client = client;
    this.fallback = fallback;
    this.cfg = cfg || {};
    this.hooks = hooks;
    this.forming = new Map(); // `${root}|${tf}` -> newest bar served (the forming candle)
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
    try {
      const bars = await this.rithmicBars(root, tf, range);
      if (this.hooks.onSource) this.hooks.onSource('rithmic', root);
      return bars;
    } catch (e) {
      if (this.hooks.onError) this.hooks.onError(e, root);
      return this.fallback.getBars(ticker, timeframe, range);
    }
  }

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
    if (bars.length && range.to == null) this.forming.set(root + '|' + tf, { ...bars[bars.length - 1] });
    return bars;
  }

  subscribe(ticker, timeframe, onBar, opts) {
    const root = rootOf(ticker), tf = normTf(timeframe);
    if (!this.live || !root || !tf) return this.fallback.subscribe(ticker, timeframe, onBar, opts);
    let stopped = false;
    let unsub = null;
    const key = root + '|' + tf;
    const secs = TF[tf][2] * 1000;
    const intraday = TF[tf][0] === BAR_TYPE.MINUTE_BAR;
    (async () => {
      try {
        if (!this.forming.has(key)) await this.rithmicBars(root, tf, { limit: 2 });
        const sym = await this.client.frontMonth(root, EXCHANGE[root]);
        if (stopped) return;
        unsub = this.client.subscribeMarket(sym, EXCHANGE[root], (ev) => {
          if (ev.kind !== 'trade' || !(ev.price > 0)) return;
          let bar = this.forming.get(key);
          if (!bar) return;
          if (intraday && ev.time >= bar.time + secs) {
            // Roll to a new candle, aligned to the last history bar (session-aligned like Rithmic's).
            const t = bar.time + Math.floor((ev.time - bar.time) / secs) * secs;
            bar = { time: t, open: ev.price, high: ev.price, low: ev.price, close: ev.price, volume: 0 };
          } else if (ev.time < bar.time && !ev.snapshot) {
            return; // a late print for an older candle
          }
          bar.close = ev.price;
          if (ev.price > bar.high) bar.high = ev.price;
          if (ev.price < bar.low) bar.low = ev.price;
          if (!ev.snapshot) bar.volume = (bar.volume || 0) + (ev.size || 0);
          this.forming.set(key, bar);
          onBar({ ...bar });
        });
        if (stopped && unsub) unsub();
      } catch (e) {
        if (this.hooks.onError) this.hooks.onError(e, root);
      }
    })();
    return () => { stopped = true; if (unsub) unsub(); };
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
