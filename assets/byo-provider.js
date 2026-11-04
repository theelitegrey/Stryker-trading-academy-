// TradeZoro — "Connect your own data": chart providers (ES module). DATA ONLY.
// Depends on: assets/byo-core.js (route, adapters). Plugs into the same provider port as the other feeds
// (info, listSymbols, getSymbolInfo, getCalendar, getBars, subscribe) and goes through the same wrappers in
// assets/vela-chart.js (Iv.wrapFactory -> chart-live-resume.js: reconnect on return, back-fill, stall watchdog).
//  - withByo(Base, kind): wraps the delayed forex ("fx") / index+ETF ("idx") provider. While a connected source covers
//    the symbol, history and the live candle come from the member's own account; otherwise the base provider answers.
//  - ByoProvider: provider "byo" for stocks the member's own account serves (prefix "byo:", e.g. byo:AAPL).
import { route } from './byo-core.js?v=866';

const POPULAR = [['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'NVIDIA'], ['TSLA', 'Tesla'], ['AMZN', 'Amazon'], ['GOOGL', 'Alphabet'], ['META', 'Meta Platforms'], ['AMD', 'Advanced Micro Devices'],
  ['NFLX', 'Netflix'], ['SPY', 'SPDR S&P 500 ETF'], ['QQQ', 'Invesco QQQ'], ['IWM', 'iShares Russell 2000 ETF'], ['DIA', 'SPDR Dow Jones ETF']];
const SUPPORTED = ['1', '5', '15', '30', '60', '120', '240', 'D', 'W', 'M'];

function liveSub(r, ticker, timeframe, onBar) {
  let stopped = false, off = null;
  r.ad.getBars(r.rec.creds, ticker, timeframe, { limit: 1 }).catch(() => []).then((bs) => {
    if (stopped) return;
    off = r.ad.subscribe(r.rec.hub, ticker, timeframe, bs[bs.length - 1] || null, onBar);
  });
  return () => { stopped = true; if (off) off(); };
}

export function withByo(Base, kind) {
  return class extends Base {
    async getBars(ticker, timeframe, range = {}) {
      const r = route(kind, ticker);
      if (r) { try { const b = await r.ad.getBars(r.rec.creds, ticker, timeframe, range); if (b.length) return b; } catch (e) { /* falls back to the standard feed */ } }
      return super.getBars(ticker, timeframe, range);
    }
    subscribe(ticker, timeframe, onBar) {
      const r = route(kind, ticker);
      return r ? liveSub(r, ticker, timeframe, onBar) : super.subscribe(ticker, timeframe, onBar);
    }
  };
}

export class ByoProvider {
  info() {
    return { name: 'byo', displayName: 'Your data', requiresApiKey: false, supportedTimeframes: SUPPORTED, capabilities: { enumerate: true, stream: true, symbolInfo: true } };
  }
  async listSymbols() {
    if (!route('byo', 'AAPL')) return [];
    return POPULAR.map(([t, d]) => ({ ticker: t, description: d, type: 'stock', prefix: 'BYO', market: 'equity', exchange: 'US', mintick: 0.01, pointvalue: 1 }));
  }
  async getSymbolInfo(ticker) {
    const r = route('byo', ticker);
    if (!r) return undefined;
    const t = r.ad.symbolOf(ticker);
    if (r.ad.info) return r.ad.info(t, r.rec.creds);
    if (r.id === 'ironbeam') return { ticker: t, tickerid: 'BYO:' + t, prefix: 'BYO', description: t.split(':')[1], type: 'futures', market: 'futures', currency: 'USD', mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1, timezone: 'America/Chicago', session: '1700-1600' };
    const known = POPULAR.find((p) => p[0] === t);
    return { ticker: t, tickerid: 'BYO:' + t, prefix: 'BYO', description: known ? known[1] : t, type: 'stock', market: 'equity', currency: 'USD', mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1,
      timezone: 'America/New_York', session: '0930-1600', session_extended: '0400-2000' };
  }
  async getCalendar() { return []; }
  resolveSymbolIcon() { return undefined; }
  async getBars(ticker, timeframe, range = {}) {
    const r = route('byo', ticker);
    return r ? r.ad.getBars(r.rec.creds, ticker, timeframe, range) : [];
  }
  subscribe(ticker, timeframe, onBar) {
    const r = route('byo', ticker);
    return r ? liveSub(r, ticker, timeframe, onBar) : () => {};
  }
}
