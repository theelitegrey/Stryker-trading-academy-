// TradeZoro — Charts: Vest data provider (ES module). Provider id "vest", chart symbols "vest:BTC-PERP", "vest:AMD-USD-PERP".
// Same provider port as the other feeds (info, listSymbols, getSymbolInfo, getCalendar, resolveSymbolIcon, getBars, subscribe),
// wrapped by the same intervals / resume / replay wrappers in assets/vela-chart.js and given tick-speed candles by
// assets/chart-tick-boost.js boostVenue(.., 'vest') from the venue's trade stream (assets/orderflow-venue-vest.js).
// History: Vest's candle feed gives only the newest ~500 candles per interval (it ignores start / end), so the chart shows
// that many and no more; nothing is invented to fill the rest. Intervals Vest does not serve (45m, 3h, 1M ...) are built
// from a smaller one it does serve. Live candle: the feed is re-read every 3 s; trades make it move on every print.
// Data only: no orders, no account. Education only. Not financial advice.
import { getJson, loadSymbols, parseKlines, NATIVE, tfMs, aggregate, monthOf } from './vest-core.js?v=938';

const SUPPORTED = ['1', '3', '5', '15', '30', '45', '60', '120', '180', '240', '360', '480', '720', 'D', 'W', 'M'];
const NORM = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '45m': '45', '1h': '60', '2h': '120', '3h': '180', '4h': '240', '6h': '360', '8h': '480', '12h': '720', '1d': 'D', '1w': 'W', '1mo': 'M', '1D': 'D', '1W': 'W', D: 'D', W: 'W', M: 'M' };
const normTf = (tf) => NORM[tf] || NORM[String(tf).toLowerCase()] || String(tf);
const NATIVE_MIN = Object.keys(NATIVE).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => b - a);
const POLL_MS = 3000;
const clean = (t) => String(t || '').replace(/^[a-z]+:/i, '');

// Usual names for the index / commodity perps, added to the search text only (the symbols keep their Vest names):
// typing NQ or "nasdaq" finds NDX-USD-PERP, ES or "s&p" finds SPX-USD-PERP, and so on.
// (names such as "nasdaq", "s&p", "gold" already match the symbol's own description; the root is what is missing).
export const ALIASES = { 'NDX-USD-PERP': 'NQ', 'SPX-USD-PERP': 'ES', 'RTY-USD-PERP': 'RTY', 'GC-PERP': 'GC', 'CL-PERP': 'CL', 'SI-PERP': 'SI', 'HG-PERP': 'HG', 'NG-PERP': 'NG', 'PL-PERP': 'PL', 'BZ-PERP': 'BZ' };
export const withAliases = (list) => list.map((s) => (ALIASES[s.ticker] && !s.description.includes(' \u00b7 ' + ALIASES[s.ticker]) ? { ...s, description: s.description + ' \u00b7 ' + ALIASES[s.ticker] } : s));

export class VestProvider {
  info() { return { name: 'vest', displayName: 'Vest', requiresApiKey: false, supportedTimeframes: SUPPORTED, capabilities: { enumerate: true, stream: true, symbolInfo: true } }; }

  async sym(ticker) {
    const want = clean(ticker).toUpperCase();
    const list = await loadSymbols();
    return list.find((s) => s.ticker.toUpperCase() === want) || null;
  }
  async listSymbols() { return withAliases(await loadSymbols()); }
  async getSymbolInfo(ticker) {
    const s = await this.sym(ticker).catch(() => null);
    if (!s) return undefined;
    return {
      ticker: s.ticker, tickerid: 'VEST:' + s.ticker, prefix: 'VEST', description: s.description, type: s.type, market: s.type, exchange: 'Vest',
      basecurrency: s.base, currency: 'USD', mintick: s.mintick, pricescale: s.pricescale, minmove: 1, pointvalue: 1, timezone: 'Etc/UTC', session: '24x7',
    };
  }
  async getCalendar() { return []; }
  resolveSymbolIcon() { return undefined; }

  // [{time,open,high,low,close,volume}] oldest first
  async fetchInterval(symbol, interval) {
    return parseKlines(await getJson('klines?symbol=' + encodeURIComponent(symbol) + '&interval=' + interval));
  }
  async build(symbol, tf) {
    if (tf === 'M') {
      const d = await this.fetchInterval(symbol, NATIVE.D);
      const m = aggregate(d, monthOf);
      if (d.length && m.length && new Date(d[0].time).getUTCDate() !== 1) m.shift();   // the first month starts before the history: its candle would be partial
      return m;
    }
    if (NATIVE[tf]) return this.fetchInterval(symbol, NATIVE[tf]);
    const mins = parseInt(tf, 10);
    const sub = NATIVE_MIN.find((n) => n < mins && mins % n === 0);
    if (!(mins > 0) || !sub) return [];
    const step = mins * 6e4;
    return aggregate(await this.fetchInterval(symbol, NATIVE[sub]), (t) => Math.floor(t / step) * step);
  }
  async getBars(ticker, timeframe, range = {}) {
    try {
      const s = await this.sym(ticker);
      if (!s) return [];
      let bars = await this.build(s.ticker, normTf(timeframe));
      if (range.from != null) bars = bars.filter((b) => b.time >= range.from);
      if (range.to != null) bars = bars.filter((b) => b.time <= range.to);
      return range.limit != null && bars.length > range.limit ? bars.slice(-range.limit) : bars;
    } catch (e) {
      console.warn('[vest] bars failed', ticker, timeframe, e && e.message);
      return [];
    }
  }
  subscribe(ticker, timeframe, onBar) {
    let stopped = false, tm = 0;
    const poll = async () => {
      if (stopped) return;
      if (!document.hidden) { const b = await this.getBars(ticker, timeframe, { limit: 2 }); if (!stopped) b.forEach((x) => onBar(x)); }
      if (!stopped) tm = setTimeout(poll, POLL_MS);
    };
    tm = setTimeout(poll, POLL_MS);
    return () => { stopped = true; clearTimeout(tm); };
  }
}
export { tfMs };
