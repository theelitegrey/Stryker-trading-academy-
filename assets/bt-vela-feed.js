// TradeZoro — Backtest data feed for the Vela chart (ES module, no DOM, no network)
//
// A Vela DataProvider named "bt" that serves ONE backtest session: the bars of the session's
// Series (assets/replay-engine.js) up to the replay cursor and nothing after it. The cursor and
// the bars stay owned by replay.js / replay-engine.js; this file only reads them.
//
// NO LOOK-AHEAD: getBars() slices the resampled series at the cursor (complete candles + the
// forming candle that Series.view() builds from base bars <= cursor). Bars after the cursor are
// never handed to Vela, so every indicator, Pine script and drawing anchor only sees the past.
//
// Education only. Not financial advice.

// Vela timeframe ("1", "5", "60", "D") -> replay-engine timeframe ("1m", "5m", "1h", "1D")
const TF_TO_RE = { '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '120': '2h', '240': '4h', 'D': '1D', '1D': '1D', 'W': '1W', '1W': '1W' };
export const velaTf = (re) => ({ '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '1D': 'D', '1W': 'W' }[re] || '15');
export const reTf = (v) => TF_TO_RE[String(v)] || null;

const toVela = (b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v || 0 });

// ctx: { series, getCursor(), spec } (spec = replay.js RP.spec: symbol, tick, decimals, pointValue, label)
export function createBtFeed(ctx) {
  const subs = new Set();   // { tf, onBar }

  // Bars visible at the cursor for a Vela timeframe: [complete..., forming]
  function visible(tf) {
    const re = reTf(tf);
    if (!re || !ctx.series.availableTimeframes().includes(re)) return [];
    const cur = ctx.getCursor();
    const v = ctx.series.view(re, cur);
    const out = new Array(v.n);
    for (let i = 0; i < v.n - 1; i++) out[i] = toVela(v.bars[i]);
    out[v.n - 1] = toVela(v.last);
    return out;
  }

  async function getBars(ticker, tf, range = {}) {
    let bars = visible(tf);
    if (range.to != null) bars = bars.filter((b) => b.time <= range.to);
    if (range.from != null) bars = bars.filter((b) => b.time >= range.from);
    if (range.limit != null && bars.length > range.limit) bars = bars.slice(-range.limit);
    return bars;
  }

  // Called after every cursor change: pushes every candle that is new or still forming since the last push
  // (a +10 step can cross several candles), oldest first.
  function push() {
    for (const s of subs) {
      const bars = visible(s.tf); if (!bars.length) continue;
      let i = bars.length - 1;
      const from = s.sentT != null ? s.sentT : bars[bars.length - 1].time;
      while (i > 0 && bars[i - 1].time >= from) i--;
      for (; i < bars.length; i++) { try { s.onBar(bars[i]); } catch (e) { /* chart gone */ } }
      s.sentT = bars[bars.length - 1].time;
    }
  }
  // Forget what was sent (after a reload of the chart).
  function resetSent() { for (const s of subs) s.sentT = null; }

  const provider = {
    info() {
      return { name: 'bt', displayName: 'Backtest', requiresApiKey: false, supportedTimeframes: ['1', '3', '5', '15', '30', '60', '120', '240', 'D', 'W'], capabilities: { enumerate: true, stream: false, symbolInfo: true } };
    },
    async listSymbols() { return [symbolRow()]; },
    async getSymbolInfo(ticker) { return symbolInfo(); },
    async getCalendar() { return []; },
    resolveSymbolIcon() { return undefined; },
    getBars,
    subscribe(ticker, tf, onBar) { const s = { tf, onBar, sentT: null }; subs.add(s); return () => subs.delete(s); }
  };
  function decimalsOf(t) { const s = String(t); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
  function symbolRow() {
    const sp = ctx.spec || {};
    return { ticker: 'SESSION', description: sp.label || sp.symbol || 'Backtest', type: 'futures', prefix: 'BT', market: 'futures', exchange: 'BT', mintick: sp.tick || 0.01, pointvalue: sp.pointValue || 1 };
  }
  function symbolInfo() {
    const sp = ctx.spec || {}; const tick = sp.tick || 0.01; const dec = decimalsOf(tick);
    return Object.assign(symbolRow(), {
      tickerid: 'BT:SESSION', root: sp.symbol || 'SESSION', currency: 'USD',
      pricescale: Math.round(Math.pow(10, dec)), minmove: Math.round(tick * Math.pow(10, dec)),
      timezone: 'America/New_York', session: '24x7', session_extended: '24x7'
    });
  }
  return { provider, push, resetSent, visible, subs };
}
