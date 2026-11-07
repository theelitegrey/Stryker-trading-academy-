// TradeZoro — Charts: formula symbols, data layer + symbol search (ES module). Roadmap: Formula charts.
// Depends on: assets/chart-formula-core.js (parser + bar maths), the workspace feed (ws.feed), and Vela's
// SymbolPicker class (the same one the header search and the watchlist "+" use).
//
//   createFormulaProvider(getFeed, normalize) -> a Vela DataProvider named "formula", registered in vela-chart.js next
//       to binance / futures / fx / idx. A symbol is "formula:ES1!-NQ1!*0.25". getBars loads every leg through its OWN
//       provider (so replay, connected accounts and interval building keep working), aligns on time and combines O/H/L/C.
//   mountFormula(ws, { SymbolPicker, normalize }) -> patches SymbolPicker so typing an expression in any symbol search
//       offers one "formula" row, or says what is wrong (bad syntax, unknown symbol, too many symbols).
//
// LIVE: only if EVERY leg streams (crypto venues, the streamed futures roots, connected accounts): the formula subscribes
// to each leg and re-emits the candle whenever a leg moves. Otherwise it re-reads the newest legs every POLL_MS and pushes
// the tail, so the chart refreshes on each new bar. Volume is 0 (blank). Education only. Not financial advice.

import { parseFormula, combineBars, canonicalSymbol, bodyOf, isFormulaSymbol, PREFIX, MAX_CHARS } from './chart-formula-core.js?v=908';

const POLL_MS = 20000, TAIL = 4;
const STREAM_PROVIDERS = ['binance', 'coinbase', 'hyperliquid', 'byo', 'bybit', 'okx', 'bitget', 'kraken'];
const STREAM_FUT_ROOTS = ['NQ', 'MNQ', 'ES', 'MES', 'RTY', 'YM', 'MYM', 'GC', 'MGC', 'SI', 'SIL', 'CL', 'MCL'];   // = INSIGHTSENTRY_ROOTS in chart-futures-provider.js
export const streams = (r) => STREAM_PROVIDERS.includes(r.provider) || (r.provider === 'futures' && STREAM_FUT_ROOTS.includes(String(r.ticker).toUpperCase().replace(/1!$/, '')));

const unknownMsg = (s) => '"' + s.replace(/^[A-Z0-9_]+:/, '') + '" is not on our data feeds. Pick the symbol from the search list first (for example ES1!, BTCUSDT, SPY).';

// Resolve each symbol of a parsed formula to { provider, ticker, instance }. Throws Error(message) for an unknown one.
export function resolveLegs(symbols, feed, normalize) {
  return symbols.map((s) => {
    let r = null;
    try { const n = normalize && normalize(s, feed); if (n) r = feed.resolveSymbol(n); } catch (e) {}
    if (!r) { try { r = feed.resolveSymbol(s); } catch (e) {} }   // e.g. a stock from a connected account
    const inst = r && feed.providerInstance(r.provider);
    if (!r || !inst) throw new Error(unknownMsg(s));
    return { sym: s, provider: r.provider, ticker: r.ticker, instance: inst };
  });
}

const decimalsFor = (p) => { const a = Math.abs(p); return !Number.isFinite(a) || a === 0 ? 2 : a >= 10 ? 2 : a >= 1 ? 3 : a >= 0.1 ? 4 : 6; };

export function createFormulaProvider(getFeed, normalize) {
  const parsed = (ticker) => { const r = parseFormula(bodyOf(ticker)); if (!r.ok) throw new Error(r.message); return r; };
  const legsOf = (r) => resolveLegs(r.symbols, getFeed(), normalize);
  const load = async (legs, tf, range) => {
    const series = {};
    await Promise.all(legs.map(async (l) => { series[l.sym] = (await l.instance.getBars(l.ticker, tf, range)) || []; }));
    return series;
  };

  async function getBars(ticker, tf, range = {}) {
    const r = parsed(ticker), legs = legsOf(r);
    let bars = combineBars(r.ast, r.symbols, await load(legs, tf, range));
    if (range.to != null) bars = bars.filter((b) => b.time <= range.to);
    if (range.from != null) bars = bars.filter((b) => b.time >= range.from);
    if (range.limit != null && bars.length > range.limit) bars = bars.slice(-range.limit);
    return bars;
  }

  function subscribe(ticker, tf, onBar, opts) {
    let r, legs;
    try { r = parsed(ticker); legs = legsOf(r); } catch (e) { return () => {}; }
    let dead = false; const offs = [];
    const push = (bars) => { if (!dead) for (const b of bars) { try { onBar(b); } catch (e) {} } };
    if (legs.every((l) => streams(l) && typeof l.instance.subscribe === 'function')) {
      const last = {};   // sym -> its newest few bars, kept current by that leg's stream
      const seed = load(legs, tf, { limit: TAIL }).then((s) => { for (const k of Object.keys(s)) last[k] = s[k].slice(-TAIL); });
      for (const l of legs) {
        offs.push(l.instance.subscribe(l.ticker, tf, (b) => seed.then(() => {
          const a = last[l.sym] || (last[l.sym] = []);
          const i = a.findIndex((x) => x.time === b.time);
          if (i >= 0) a[i] = b; else { a.push(b); a.sort((x, y) => x.time - y.time); if (a.length > TAIL) a.shift(); }
          push(combineBars(r.ast, r.symbols, last).filter((x) => x.time >= b.time));   // only the candle that moved
        }), opts));
      }
    } else {
      let lastKey = '';
      const tick = async () => {
        if (dead || (typeof document !== 'undefined' && document.hidden)) return;
        try {
          const bars = combineBars(r.ast, r.symbols, await load(legs, tf, { limit: TAIL })).slice(-2);
          const key = bars.map((b) => [b.time, b.open, b.high, b.low, b.close].join(':')).join('|');
          if (key !== lastKey) { lastKey = key; push(bars); }
        } catch (e) { /* next round */ }
      };
      const h = setInterval(tick, POLL_MS);
      offs.push(() => clearInterval(h));
    }
    return () => { dead = true; offs.forEach((f) => { try { f && f(); } catch (e) {} }); };
  }

  async function symbolInfo(ticker) {
    const r = parsed(ticker);
    let dec = 2;
    try { const b = await getBars(ticker, 'D', { limit: 3 }); if (b.length) dec = decimalsFor(b[b.length - 1].close); } catch (e) {}
    return {
      ticker: r.text, tickerid: PREFIX + r.text, root: r.text, description: 'Formula: ' + r.text, type: 'formula', prefix: 'formula',
      exchange: 'FORMULA', currency: '', mintick: Math.pow(10, -dec), pricescale: Math.pow(10, dec), minmove: 1, timezone: 'America/New_York',
      session: '24x7', session_extended: '24x7', pointvalue: 1
    };
  }

  return {
    info() { return { name: 'formula', displayName: 'Formula', requiresApiKey: false, capabilities: { enumerate: false, stream: true, symbolInfo: true } }; },
    async listSymbols() { return []; },
    getSymbolInfo: symbolInfo,
    async getCalendar() { return []; },
    resolveSymbolIcon() { return undefined; },
    getBars, subscribe,
    isLive: (ticker) => legsOf(parsed(ticker)).every((l) => streams(l) && typeof l.instance.subscribe === 'function')
  };
}

// ----------------------------------------------------------------------------- symbol search
export function mountFormula(ws, o) {
  // the widget build's class and the workspace's own header search (may be a different copy of the class)
  const protos = [o && o.SymbolPicker && o.SymbolPicker.prototype, ws.symbolPicker && Object.getPrototypeOf(ws.symbolPicker)].filter((x, i, a) => x && a.indexOf(x) === i);
  protos.forEach(patch);
  function patch(SP) {
  if (SP.__stkFormula || typeof SP.computeRows !== 'function') return;
  SP.__stkFormula = true;
  const baseRows = SP.computeRows, baseRefresh = SP.refresh;
  // An operator, a bracket or the "formula:" prefix makes it a formula, unless the whole text is already a symbol we know
  // (EUR/USD, BTC-USD): those keep their normal search.
  const isFormulaText = (v) => {
    if (!/[+*/()-]/.test(v) && !/^FORMULA:/i.test(v)) return false;
    try { if (o.normalize && o.normalize(v, ws.feed)) return false; if (ws.feed.resolveSymbol(v)) return false; } catch (e) {}
    return true;
  };
  // { row } | { msg } | null (not a formula)
  const answer = (self) => {
    const v = String(self.input.value || '').trim();
    if (!v || !isFormulaText(v)) return null;
    const r = parseFormula(bodyOf(v));
    if (!r.ok) return { msg: r.message };
    try { resolveLegs(r.symbols, ws.feed, o.normalize); } catch (e) { return { msg: e.message }; }
    return { row: { ticker: r.text, description: 'Formula chart · candles computed from ' + r.symbols.join(', '), type: 'formula', prefix: 'formula', provider: 'formula' } };
  };
  SP.computeRows = function () {
    const a = answer(this); this.__fMsg = a && a.msg || '';
    return a ? (a.row ? [a.row] : []) : baseRows.call(this);
  };
  SP.refresh = function () {
    baseRefresh.call(this);
    if (this.__fMsg) {
      const d = this.list.ownerDocument.createElement('div');
      d.className = 'vela-sp-empty'; d.setAttribute('role', 'alert'); d.textContent = this.__fMsg;
      this.list.replaceChildren(d);
    }
  };
  }
}

export { canonicalSymbol, isFormulaSymbol, MAX_CHARS };
