// TradeZoro — Charts: Tick-stream trade DATA (pure, no DOM). Used by assets/chart-ts-trades.js (the "Big Trades / Delta / Cumulative
// Delta (Tick-stream)" indicators) and tools/tests/feed-compare.mjs. Feed: the book-recorder Worker's GET /ts-trades (admin only):
//   { sym, at, floor, trades: [[ts_ms, price, size, side 1|-1]..], delta: [[minute_ms, buy, sell, runHigh, runLow]..] }
// Education only. Not financial advice.
import { bigPrints } from './chart-of-pro-data.js?v=895';

// Tick-stream sends one tick per FILL (an order that lifts 20 lots at one price = 20 ticks of 1); InsightSentry has one print per order and price.
// mergeFills() makes the Tick-stream side comparable: consecutive fills of the same side and price with the SAME time stamp (REST rows carry
// microseconds: pass t in microseconds and gap 0) form one print. Live frames only have receive ms: gap 1. ticks: [[t, price, size, side]..] sorted.
export const MERGE_MS = 1;
export function mergeFills(ticks, gap = 0) {
  const out = []; let o = null;
  for (const t of ticks) {
    if (o && o[3] === t[3] && o[1] === t[1] && t[0] - o.last <= gap) { o[2] += t[2]; o.last = t[0]; continue; }
    o = [t[0], t[1], t[2], t[3]]; o.last = t[0]; out.push(o);
  }
  return out;
}
// Tick-stream minutes -> bars of tfMs in the SAME shape as the order-flow bars (t, buy, sell, vol, delta, dmax, dmin), so cvdCandles()
// and the delta pane work unchanged. dmax / dmin are the running-delta extremes inside the bar (relative to its open).
export function aggregateMins(mins, tfMs) {
  const out = []; let cur = null;
  for (const m of mins) {
    const t = Math.floor(m.t / tfMs) * tfMs, d = m.buy - m.sell;
    if (!cur || cur.t !== t) { cur = { t, buy: m.buy, sell: m.sell, vol: m.buy + m.sell, delta: d, dmax: m.hi, dmin: m.lo, trades: 0, bigs: [], mins: 1 }; out.push(cur); continue; }
    cur.dmax = Math.max(cur.dmax, cur.delta + m.hi); cur.dmin = Math.min(cur.dmin, cur.delta + m.lo);
    cur.buy += m.buy; cur.sell += m.sell; cur.vol += m.buy + m.sell; cur.delta += d; cur.mins++;
  }
  return out;
}
const pct = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]; };
export function corr(x, y) {
  const n = x.length; if (n < 3) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
// Match prints: same side, same price, |dt| <= 2 s, size within 10%. a / b = [[ms, priceIdx, size, side 1|0]..]. Each TS print matches once, nearest in time.
export function matchPrints(isP, tsP, { dtMs = 2000, tol = 0.1 } = {}) {
  const used = new Set(), lags = [];
  const byKey = new Map();
  tsP.forEach((p, i) => { const k = p[1] + '|' + p[3]; (byKey.get(k) || byKey.set(k, []).get(k)).push(i); });
  for (const p of isP) {
    const c = byKey.get(p[1] + '|' + p[3]); if (!c) continue;
    let best = -1, bd = Infinity;
    for (const i of c) { if (used.has(i)) continue; const q = tsP[i], d = Math.abs(q[0] - p[0]); if (d <= dtMs && Math.abs(q[2] - p[2]) <= tol * Math.max(p[2], q[2]) && d < bd) { bd = d; best = i; } }
    if (best >= 0) { used.add(best); lags.push(tsP[best][0] - p[0]); }
  }
  return lags;
}
// IS bars (decodeOrderflow shape, 1 min) vs Tick-stream over [from, to) ms. thr = the size a print must reach (both sides use the same).
// isBars: [{ t, vol, delta, buy: Int32Array, sell: Int32Array, bigs: [[ms, priceIdx, size, side 1|0]] }]; tsMins: [{ t, buy, sell }]; tsTrades: [[ms, price, size, side 1|-1]]
export function compareFeeds({ isBars, tsMins, tsTrades, thr, tick, from, to }) {
  const ib = isBars.filter((b) => b.t >= from && b.t < to), tm = tsMins.filter((m) => m.t >= from && m.t < to);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const isP = [], tsP = [];
  for (const b of ib) for (const x of b.bigs || []) if (x[2] >= thr && x[0] >= from && x[0] < to) isP.push(x);
  for (const t of tsTrades) if (t[2] >= thr && t[0] >= from && t[0] < to) tsP.push([t[0], Math.round(t[1] / tick), t[2], t[3] > 0 ? 1 : 0]);
  isP.sort((a, b) => a[0] - b[0]); tsP.sort((a, b) => a[0] - b[0]);
  const lags = matchPrints(isP, tsP);
  const isBuy = sum(ib.map((b) => sum(b.buy))), isSell = sum(ib.map((b) => sum(b.sell)));
  const tsBuy = sum(tm.map((m) => m.buy)), tsSell = sum(tm.map((m) => m.sell));
  const tmap = new Map(tm.map((m) => [m.t, m.buy - m.sell])), xs = [], ys = [];
  for (const b of ib) if (tmap.has(b.t)) { xs.push(b.delta); ys.push(tmap.get(b.t)); }
  return {
    is: { prints: isP.length, bubbles: bigPrints([{ bigs: isP }], { cluster: true }).length, vol: isBuy + isSell, buy: isBuy, sell: isSell, delta: isBuy - isSell },
    ts: { prints: tsP.length, bubbles: bigPrints([{ bigs: tsP }], { cluster: true }).length, vol: tsBuy + tsSell, buy: tsBuy, sell: tsSell, delta: tsBuy - tsSell },
    matched: lags.length, matchedPct: isP.length ? Math.round(1000 * lags.length / isP.length) / 10 : null,
    lagP50: pct(lags, 0.5), lagP90: pct(lags, 0.9), corr: corr(xs, ys), minutes: xs.length
  };
}
