// TradeZoro — Book · DOM · Trades panel: pure logic (no DOM, no sockets), unit-tested in tools/tests/book-panel-core.test.mjs.
// Book merge across exchanges, bought / sold / delta per price, trade store, click -> paper order mapping, draw helpers.
// Education only. Not financial advice.

export const nearNice = (raw) => {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  let best = p;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p <= raw * 1.0001) best = m * p;
  return best;
};
const r8 = (v) => Math.round(v * 1e8) / 1e8;

// Default price step for a crypto pair: about 0.2 bp of the price (BTC 85,000 -> 1, ETH 3,500 -> 0.5).
export const autoStep = (mid) => r8(nearNice(mid * 0.00002));
export const GROUPS = [1, 2, 5, 10, 50];

// Pair of a chart ticker: "BTCUSDT", "BTCUSDT.P", "BTC-USD", "BTC" -> { base, quote, perp }.
export function pairOf(ticker) {
  let t = String(ticker || '').toUpperCase().replace(/^[A-Z_]+:/, ''), perp = false;
  if (/\.P$/.test(t)) { perp = true; t = t.slice(0, -2); }
  if (/-PERP$/.test(t)) { perp = true; t = t.slice(0, -5); }
  if (/-SWAP$/.test(t)) { perp = true; t = t.slice(0, -5); }
  let m = /^([A-Z0-9]+)[-/_]([A-Z]+)$/.exec(t);
  if (m) return { base: m[1], quote: m[2], perp };
  m = /^(.+?)(USDT|USDC|BUSD|USD)$/.exec(t);
  if (m && m[1]) return { base: m[1], quote: m[2], perp };
  return { base: t, quote: 'USDT', perp };
}

// ---- book ----------------------------------------------------------------------------------------------------------
// A book = { bids: Map(price -> size), asks: Map(price -> size) }. Merge = sizes added up per price bucket
// (bids floor, asks ceil, so rounding never makes a bid cross an ask). Returns sorted arrays, best first.
export function bucketSide(map, step, isBid, into) {
  const out = into || new Map();
  map.forEach((q, p) => {
    if (!(q > 0)) return;
    const k = isBid ? Math.floor(p / step + 1e-9) : Math.ceil(p / step - 1e-9);
    out.set(k, (out.get(k) || 0) + q);
  });
  return out;
}
export function mergeBooks(books, step, maxLevels) {
  const b = new Map(), a = new Map();
  for (const bk of books) { if (!bk) continue; bucketSide(bk.bids, step, true, b); bucketSide(bk.asks, step, false, a); }
  const n = maxLevels || 1e9;
  const bids = [...b.entries()].sort((x, y) => y[0] - x[0]).slice(0, n).map(([k, q]) => [r8(k * step), q]);
  const asks = [...a.entries()].sort((x, y) => x[0] - y[0]).slice(0, n).map(([k, q]) => [r8(k * step), q]);
  return { bids, asks };
}
// Book tab model: asks (far -> near), spread row, bids (near -> far), each with a running total and a depth fraction.
export function bookModel(m, levels) {
  const bids = m.bids.slice(0, levels), asks = m.asks.slice(0, levels);
  if (!bids.length || !asks.length) return null;
  let t = 0; const bt = bids.map(([p, q]) => ({ p, q, t: (t += q) }));
  t = 0; const at = asks.map(([p, q]) => ({ p, q, t: (t += q) }));
  const maxT = Math.max(bt[bt.length - 1].t, at[at.length - 1].t, 1);
  const bb = bids[0][0], ba = asks[0][0], mid = (bb + ba) / 2, spread = ba - bb;
  return { asks: at.reverse(), bids: bt, bb, ba, mid, spread, bps: mid > 0 ? (spread / mid) * 1e4 : 0, crossed: spread < 0, maxT };
}

// ---- trades --------------------------------------------------------------------------------------------------------
// trade = { t (ms), p, s (size), side: 1 buyer-aggressor / -1 seller-aggressor, ex }
export class TradeStore {
  constructor(cap) { this.cap = cap || 60000; this.ring = []; this.v = 0; }
  add(list) {
    for (const x of list) {
      if (!(x.p > 0) || !(x.s > 0)) continue;
      const r = this.ring; let i = r.length;
      while (i > 0 && r[i - 1].t > x.t) i--;       // exchanges deliver slightly out of order: keep it sorted by time
      if (i === r.length) r.push(x); else r.splice(i, 0, x);
    }
    if (this.ring.length > this.cap) this.ring.splice(0, this.ring.length - this.cap);
    this.v++;
  }
  // bought / sold / delta per price bucket over the last `ms` (0 = whole session). Map(key -> { buy, sell }), price = key * step
  atPrice(ms, step, now) {
    const cut = ms ? (now == null ? Date.now() : now) - ms : -Infinity, o = new Map();
    for (let k = this.ring.length - 1; k >= 0; k--) {
      const x = this.ring[k];
      if (x.t < cut) break;
      const key = Math.round(x.p / step);
      let e = o.get(key); if (!e) { e = { buy: 0, sell: 0 }; o.set(key, e); }
      if (x.side > 0) e.buy += x.s; else e.sell += x.s;
    }
    return o;
  }
  // newest first; minSize in base units (or quote units when .notional); before = freeze time for Pause
  recent(n, minSize, before) {
    const out = [];
    for (let k = this.ring.length - 1; k >= 0 && out.length < n; k--) {
      const x = this.ring[k];
      if (before && x.t > before) continue;
      if (!minSize || x.s * (this.notional ? x.p : 1) >= minSize) out.push(x);
    }
    return out;
  }
  // buy / sell volume in the last `ms`
  split(ms, now) {
    const cut = (now == null ? Date.now() : now) - ms; let b = 0, s = 0;
    for (let k = this.ring.length - 1; k >= 0; k--) { const x = this.ring[k]; if (x.t < cut) break; if (x.side > 0) b += x.s; else s += x.s; }
    return { buy: b, sell: s, pct: b + s > 0 ? (b / (b + s)) * 100 : 50 };
  }
}
// size at or above which a print counts as big: 95th percentile of the last 300 sizes (and at least 3x their median)
export function bigThreshold(list) {
  if (list.length < 20) return Infinity;
  const s = list.slice(0, 300).map((x) => x.s).sort((a, b) => a - b);
  return Math.max(s[Math.floor(s.length * 0.95)], s[Math.floor(s.length / 2)] * 3);
}

// ---- DOM ladder ----------------------------------------------------------------------------------------------------
// One row per price bucket from top to bottom (high -> low), from the merged book (levels per side) plus the trade map.
// centre = key of the touch; rows run from the highest ask level to the lowest bid level shown, plus any traded price in range.
export function ladderModel(m, trades, step, levels) {
  if (!m || !m.bids.length || !m.asks.length) return null;
  const k = (p) => Math.round(p / step);
  const bb = k(m.bids[0][0]), ba = k(m.asks[0][0]);
  const bid = new Map(), ask = new Map();
  let lo = bb, hi = ba;
  for (let i = 0; i < Math.min(levels, m.bids.length); i++) { const key = k(m.bids[i][0]); bid.set(key, m.bids[i][1]); if (key < lo) lo = key; }
  for (let i = 0; i < Math.min(levels, m.asks.length); i++) { const key = k(m.asks[i][0]); ask.set(key, m.asks[i][1]); if (key > hi) hi = key; }
  const rows = []; let maxQ = 1, maxT = 1;
  for (let key = hi; key >= lo; key--) {
    const b = key <= bb ? bid.get(key) || 0 : 0, a = key >= ba ? ask.get(key) || 0 : 0, t = trades && trades.get(key);
    const buy = t ? t.buy : 0, sell = t ? t.sell : 0;
    if (b > maxQ) maxQ = b; if (a > maxQ) maxQ = a;
    if (buy > maxT) maxT = buy; if (sell > maxT) maxT = sell;
    rows.push({ key, price: r8(key * step), bid: b, ask: a, buy, sell, delta: buy - sell, isBid: key === bb, isAsk: key === ba });
  }
  return { rows, maxQ, maxT, bb: bb * step, ba: ba * step, spread: (ba - bb) * step, touchIndex: hi - ba + 0.5 };
}

// ---- paper order from a DOM click -----------------------------------------------------------------------------------
// Bid-side cell = BUY, ask-side cell = SELL. Limit by default; at or through the opposite touch = market.
//   buy  at price >= best ask -> market buy, else limit buy at price
//   sell at price <= best bid -> market sell, else limit sell at price
export function clickToOrder(cell, price, bestBid, bestAsk) {
  if (cell !== 'bid' && cell !== 'ask') return null;
  if (!(price > 0)) return null;
  if (cell === 'bid') return price >= bestAsk ? { side: 'buy', type: 'market' } : { side: 'buy', type: 'limit', price };
  return price <= bestBid ? { side: 'sell', type: 'market' } : { side: 'sell', type: 'limit', price };
}
// which cell a click on a row means: left half of the row = bid side, right half = ask side (the price column itself is neutral)
export function cellOfClick(col) { return col === 'bid' ? 'bid' : col === 'ask' ? 'ask' : null; }

// ---- drawings --------------------------------------------------------------------------------------------------------
// Anchors for the chart's drawing tools (hline = one anchor, box = two corners). t0 / t1 = bar times in the chart's unit.
export function levelDrawing(price, t) { return { type: 'hline', opts: { paneId: 'price', anchors: [{ time: t, price }] } }; }
export function zoneDrawing(p1, p2, tFrom, tTo) {
  const hi = Math.max(p1, p2), lo = Math.min(p1, p2);
  return { type: 'box', opts: { paneId: 'price', anchors: [{ time: tFrom, price: hi }, { time: tTo, price: lo }] } };
}

// ---- formatting --------------------------------------------------------------------------------------------------
export const fmtSize = (q) => {
  if (!(q > 0)) return '';
  if (q >= 1e6) return (q / 1e6).toFixed(2) + 'M';
  if (q >= 1e4) return (q / 1e3).toFixed(1) + 'k';
  if (q >= 100) return String(Math.round(q));
  if (q >= 10) return q.toFixed(1);
  if (q >= 1) return q.toFixed(2);
  return q.toFixed(q >= 0.01 ? 3 : 4);
};
export const fmtDelta = (d) => (d === 0 ? '' : (d > 0 ? '+' : '−') + fmtSize(Math.abs(d)));
export const decimalsOf = (step) => { const s = String(r8(step)); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
export const fmtPrice = (p, step) => p.toLocaleString('en-US', { minimumFractionDigits: decimalsOf(step), maximumFractionDigits: decimalsOf(step) });
export const fmtTime = (t) => { const d = new Date(t), z = (n) => (n < 10 ? '0' : '') + n; return z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds()); };
