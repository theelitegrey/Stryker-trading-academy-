// TradeZoro — Vest perpetuals: shared helpers (ES module, no deps). Pure parsers + the public-data fetch.
// Vest's public REST answers only to its own web app's origin (CORS), so the browser reads it through our
// same-origin pass-through /api/vest/* (functions/api/vest/[[path]].js: public data only, no keys).
// The public WebSocket has no origin check, so order book and trades go browser-direct (assets/orderflow-venue-vest.js).
// Symbols are Vest's own: "BTC-PERP", "AMD-USD-PERP", "NDX-USD-PERP". Chart symbol = "vest:" + that.
// Education only. Not financial advice.

export const REST = '/api/vest/';
export const WS_URL = 'wss://ws-beta-prod.hz.vestmarkets.com/ws?version=1.0&xwebsocketserver=restserver0';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

// What the picker tab is: Vest files stocks, ETFs, index and commodity futures all as "stock".
export function typeOf(s) {
  if (s.asset === 'crypto') return 'crypto';
  if (s.asset === 'forex') return 'forex';
  const name = String(s.displayName || '');
  if (/^(CL|NG|GC|SI|HG|PL|BZ)-PERP$/.test(s.symbol)) return 'commodity';
  if (/Futures/i.test(name)) return 'futures';
  if (/\bETF\b|\bTrust\b|\bShares\b/i.test(name)) return 'etf';
  return 'stock';
}

// exchangeInfo -> [{ ticker, description, type, prefix, exchange, base, quote, mintick, pricescale, halted, ticks, sizeDecimals }]
export function parseSymbols(j) {
  const list = (j && Array.isArray(j.symbols) ? j.symbols : []).map((s) => {
    const ticks = (s.tickSizes || []).map(num).filter((t) => t > 0);
    const dec = Number.isFinite(num(s.priceDecimals)) ? num(s.priceDecimals) : 2;
    const mintick = ticks.length ? Math.min(...ticks) : Math.pow(10, -dec);
    const halted = s.tradingStatus !== 'TRADING';
    const name = String(s.displayName || s.symbol);
    return {
      ticker: s.symbol, description: name + (halted ? ' (halted)' : ''), type: typeOf(s), prefix: 'VEST', exchange: 'Vest',
      base: s.base, quote: s.quote || 'USDC', mintick, pricescale: Math.round(1 / mintick), halted,
      ticks: ticks.map(String).length ? (s.tickSizes || []).slice() : [], sizeDecimals: num(s.sizeDecimals) || 0,
    };
  });
  return list.filter((x) => x.ticker);
}

// klines (newest first, [openTime, o, h, l, c, vol, closeTime, quoteVol, trades]) -> bars, oldest first
export function parseKlines(j) {
  const rows = j && Array.isArray(j.data) ? j.data : [];
  const by = new Map();
  for (const k of rows) {
    const b = { time: Number(k[0]), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]), volume: num(k[5]) || 0 };
    if (Number.isFinite(b.time) && b.open > 0 && b.high > 0 && b.low > 0 && b.close > 0) by.set(b.time, b);
  }
  return [...by.values()].sort((a, b) => a.time - b.time);
}

// REST /trades rows or one WebSocket trade -> { id, t, p, s, side } (qty sign = the aggressor: + buyer, - seller)
export function tradeOf(x) {
  const p = num(x && x.price), q = num(x && x.qty), t = Number(x && x.time);
  if (!(p > 0) || !Number.isFinite(q) || q === 0 || !Number.isFinite(t)) return null;
  return { id: String(x.id), t, p, s: Math.abs(q), side: q > 0 ? 1 : -1 };
}
export function parseTrades(rows) {
  return (Array.isArray(rows) ? rows : []).map(tradeOf).filter(Boolean).sort((a, b) => a.t - b.t);
}
// a "<SYMBOL>@trades" message -> [trade]; data may be one trade or a list
export function parseWsTrades(msg) {
  if (!msg || !/@trades$/.test(String(msg.channel || '')) || !msg.data) return [];
  return (Array.isArray(msg.data) ? msg.data : [msg.data]).map(tradeOf).filter(Boolean);
}
// a "<SYMBOL>@depth[_tick]" message (or REST /depth) -> { bids, asks } as [price, size] numbers; sizes 0 dropped
const rows = (a) => (Array.isArray(a) ? a : []).map((r) => [num(r[0]), num(r[1])]).filter((r) => r[0] > 0 && r[1] > 0);
export function parseDepth(d) {
  const x = d && d.data ? d.data : d;
  return { bids: rows(x && x.bids), asks: rows(x && x.asks) };
}

// Which symbols of the list lie at which price steps: finest, middle, coarsest (each is a real tickSizes entry).
export function pickTicks(ticks) {
  const t = Array.isArray(ticks) ? ticks : [];
  if (!t.length) return [];
  return [...new Set([t[0], t[Math.floor((t.length - 1) / 2)], t[t.length - 1]])];
}

// ---- fetch (cached) ---------------------------------------------------------------------------------------------
export async function getJson(path) {
  const r = await fetch(REST + path);
  if (!r.ok) throw new Error('Vest HTTP ' + r.status);
  return r.json();
}
let listing = null;
export function loadSymbols() {
  if (!listing) listing = getJson('exchangeInfo').then(parseSymbols).catch((e) => { listing = null; throw e; });
  return listing;
}
// chart ticker or book-panel pair -> Vest's own symbol (case-insensitive: the chart upper-cases tickers, Vest has "kPEPE-PERP")
export function symbolFor(list, pair) {
  let want;
  if (pair && typeof pair === 'object') {
    const b = String(pair.base || '').toUpperCase();
    const c = [b + '-PERP', b + '-USD-PERP'];
    return (list.find((s) => c.includes(s.ticker.toUpperCase())) || {}).ticker || '';
  }
  want = String(pair || '').replace(/^[a-z]+:/i, '').toUpperCase();
  return (list.find((s) => s.ticker.toUpperCase() === want) || {}).ticker || '';
}

// ---- timeframes -------------------------------------------------------------------------------------------------
// minutes (or D / W) -> Vest interval. Others are built from a smaller one in vest-provider.js.
export const NATIVE = { 1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 360: '6h', 480: '8h', 720: '12h', D: '1d', W: '1w' };
export const TF_MS = { D: 864e5, W: 6048e5 };
export const tfMs = (tf) => TF_MS[tf] || (parseInt(tf, 10) > 0 ? parseInt(tf, 10) * 6e4 : 36e5);

export function aggregate(bars, bucketOf) {
  const out = new Map();
  for (const b of bars) {
    const k = bucketOf(b.time), c = out.get(k);
    if (!c) out.set(k, { time: k, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 });
    else { c.high = Math.max(c.high, b.high); c.low = Math.min(c.low, b.low); c.close = b.close; c.volume += b.volume || 0; }
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}
export const monthOf = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
