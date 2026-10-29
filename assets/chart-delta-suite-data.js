// TradeZoro — Charts: DELTA SUITE maths (pure, no DOM). Owner order 2026-10-22: "Add and push live all
// variations and one can choose from them."
// Depends on: assets/chart-footprint-data.js (profile, rows, poc, imbalances, stacked, cvdCandles).
// Used by assets/chart-delta-suite.js (the "Delta" indicator) and tools/tests/delta-suite.test.mjs.
//
// Every number here comes from REAL order flow: 1-minute footprint bars where each trade is tagged
// buyer- or seller-initiated (futures: the book-recorder Worker; crypto: Binance aggTrades). Nothing
// is estimated from candles. Bars: { t, lo, hi, o, c (tick idx), buy[], sell[] (index 0 = lo), vol,
// delta, dmax, dmin, trades }.

import { profile, rows, poc, imbalances, stacked, cvdCandles } from './chart-footprint-data.js?v=714';

// The 14 styles, in picker order. Value = the label shown in the Style dropdown.
export const STYLES = [
  'H1 Session delta profile',
  'H2 Split bid/ask profile',
  'H3 Volume profile + delta',
  'H4 Visible range vs last 30 min',
  'H5 Delta profile per time block',
  'H6 Delta ladder',
  'V1 Delta bars',
  'V2 CVD + divergence',
  'V3 Delta numbers',
  'V4 Delta-coloured candles + absorption',
  'V5 Footprint-lite',
  'V6 Big delta bubbles',
  'V7 Session delta box',
  'V8 Delta heat strip + CVD'
];
export const PANE_STYLES = ['V1 Delta bars', 'V2 CVD + divergence'];   // drawn in their own pane
export const styleId = (s) => (/^([HV]\d)/.exec(String(s || '')) || [])[1] || 'H1';

// Delta by price row over a list of bars: { r0, m, n, buy, sell, delta, poc, val, vah, total } in
// row units (row k covers ticks [(r0 + k) * m, (r0 + k + 1) * m)). null when no bars.
export function deltaProfile(bars, m, va = 70) {
  const p = profile(bars, m, va);
  if (!p) return null;
  const delta = new Float64Array(p.n);
  let dmax = 0, vmax = 0, kb = -1, ks = -1;
  for (let k = 0; k < p.n; k++) {
    const d = p.buy[k] - p.sell[k];
    delta[k] = d;
    if (Math.abs(d) > dmax) dmax = Math.abs(d);
    const v = p.buy[k] + p.sell[k];
    if (v > vmax) vmax = v;
    if (d > 0 && (kb < 0 || d > delta[kb])) kb = k;
    if (d < 0 && (ks < 0 || d < delta[ks])) ks = k;
  }
  let net = 0;
  for (let k = 0; k < p.n; k++) net += delta[k];
  return Object.assign(p, { delta, dmax, vmax, net, topBuy: kb < 0 ? null : p.r0 + kb, topSell: ks < 0 ? null : p.r0 + ks });
}

// Time blocks for H5: groups of bars by block length (minutes), aligned to the clock.
export function timeBlocks(bars, blockMin) {
  const ms = Math.max(1, blockMin) * 60000, out = [];
  let cur = null;
  for (const b of bars) {
    const k = Math.floor(b.t / ms) * ms;
    if (!cur || cur.t !== k) { cur = { t: k, bars: [] }; out.push(cur); }
    cur.bars.push(b);
  }
  return out;
}

// Swing pivots (k bars each side) of an array of numbers. kind 'hi' | 'lo'.
export function pivots(vals, k, kind) {
  const out = [];
  for (let i = k; i < vals.length - k; i++) {
    let ok = true;
    for (let j = i - k; j <= i + k && ok; j++) {
      if (j === i) continue;
      if (kind === 'hi' ? vals[j] > vals[i] : vals[j] < vals[i]) ok = false;
    }
    if (ok && (!out.length || i - out[out.length - 1] > 1)) out.push(i);
  }
  return out;
}

// Price-vs-CVD divergences between swing pivots. highs/lows = price per bar, cvdHi/cvdLo = the CVD
// candle's high/low per bar (same index). bear: pivot B is a higher price high than pivot A (and the
// highest point between them) while CVD's high at B is lower than at A. bull: the mirror at lows.
// Returns the best non-overlapping ones (score = CVD gap), newest last.
export function divergences(highs, lows, cvdHi, cvdLo, { k = 3, minGap = 10, maxGap = 75, max = 4 } = {}) {
  const res = [];
  const ph = pivots(highs, k, 'hi');
  for (let x = 0; x < ph.length; x++) for (let y = x + 1; y < ph.length; y++) {
    const a = ph[x], b = ph[y];
    if (b - a > maxGap) break;
    if (b - a < minGap) continue;
    let mx = -Infinity; for (let i = a; i < b; i++) mx = Math.max(mx, highs[i]);
    if (highs[b] > highs[a] && mx <= highs[b] && cvdHi[b] < cvdHi[a]) res.push({ kind: 'bear', a, b, pa: highs[a], pb: highs[b], ca: cvdHi[a], cb: cvdHi[b], score: cvdHi[a] - cvdHi[b] });
  }
  const pl = pivots(lows, k, 'lo');
  for (let x = 0; x < pl.length; x++) for (let y = x + 1; y < pl.length; y++) {
    const a = pl[x], b = pl[y];
    if (b - a > maxGap) break;
    if (b - a < minGap) continue;
    let mn = Infinity; for (let i = a; i < b; i++) mn = Math.min(mn, lows[i]);
    if (lows[b] < lows[a] && mn >= lows[b] && cvdLo[b] > cvdLo[a]) res.push({ kind: 'bull', a, b, pa: lows[a], pb: lows[b], ca: cvdLo[a], cb: cvdLo[b], score: cvdLo[b] - cvdLo[a] });
  }
  const out = [];
  for (const d of res.sort((p, q) => q.score - p.score)) {
    if (out.every((o) => d.b <= o.a || d.a >= o.b)) out.push(d);
    if (out.length >= max) break;
  }
  return out.sort((p, q) => p.b - q.b);
}

// Quantile of |delta| over bars (q in 0..1).
export function absDeltaQuantile(bars, q) {
  const a = bars.map((b) => Math.abs(b.delta)).sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.floor(a.length * q))];
}
export function meanAbsDelta(bars) {
  if (!bars.length) return 0;
  let s = 0; for (const b of bars) s += Math.abs(b.delta);
  return s / bars.length;
}
export function meanVol(bars) {
  if (!bars.length) return 0;
  let s = 0; for (const b of bars) s += b.vol;
  return s / bars.length;
}

// V4: absorption = the candle closed AGAINST its delta by at least `minAbs` (red candle with net
// buying: buyers absorbed; green candle with net selling: sellers absorbed). side: 1 = buyers were
// absorbed (mark at the low), 0 = sellers were absorbed (mark at the high), null = none.
export function absorption(bar, minAbs) {
  if (!bar) return null;
  if (bar.c < bar.o && bar.delta >= minAbs && bar.delta > 0) return 1;
  if (bar.c > bar.o && bar.delta <= -minAbs && bar.delta < 0) return 0;
  return null;
}

// V6: bars whose |delta| >= mult x the mean |delta| of `ref` bars. Returns [{ i, delta, pocTick }].
export function bigDeltas(bars, mult, ref) {
  const thr = mult * meanAbsDelta(ref || bars);
  const out = [];
  if (!(thr > 0)) return { thr, hits: out };
  bars.forEach((b, i) => {
    if (Math.abs(b.delta) < thr) return;
    const rs = rows(b, 1), k = poc(rs);
    out.push({ i, delta: b.delta, pocTick: k >= 0 ? rs[k].p : b.c });
  });
  return { thr, hits: out };
}

// V7: the session panel. bars = the session's bars so far (oldest first), lastN = bars in the
// "last N minutes" window. Delta at the high/low = the delta of the bar that made the session
// high/low. buyPct = buy volume / all volume.
export function sessionStats(bars, lastMs) {
  if (!bars.length) return null;
  let delta = 0, buy = 0, vol = 0, ih = 0, il = 0;
  const end = bars[bars.length - 1].t;
  let last = 0;
  bars.forEach((b, i) => {
    delta += b.delta; vol += b.vol;
    for (let j = 0; j < b.buy.length; j++) buy += b.buy[j];
    if (Math.max(b.hi, b.o, b.c) > Math.max(bars[ih].hi, bars[ih].o, bars[ih].c)) ih = i;
    if (Math.min(b.lo, b.o, b.c) < Math.min(bars[il].lo, bars[il].o, bars[il].c)) il = i;
    if (b.t > end - lastMs) last += b.delta;
  });
  return { delta, last, buyPct: vol ? buy / vol * 100 : 50, vol, hiBar: ih, loBar: il, dHigh: bars[ih].delta, dLow: bars[il].delta };
}

// V5: the key rows of one bar (row size m ticks): POC, top, bottom, imbalance rows, then the
// biggest rows, at most `max`. Returns { rs, poc, imb, stk, keys: [row idx] }.
export function keyRows(bar, m, { ratio = 3, minVol = 1, max = 5, stackLen = 3 } = {}) {
  const rs = rows(bar, m);
  if (!rs.length) return { rs, poc: -1, imb: { buy: [], sell: [] }, stk: [], keys: [] };
  const k = poc(rs), imb = imbalances(rs, ratio, minVol), stk = stacked(imb, stackLen);
  const vol = (i) => rs[i].buy + rs[i].sell;
  const cand = [k, rs.length - 1, 0];
  const ib = []; for (let i = 0; i < rs.length; i++) if (imb.buy[i] || imb.sell[i]) ib.push(i);
  ib.sort((a, b) => vol(b) - vol(a));
  const all = rs.map((_, i) => i).sort((a, b) => vol(b) - vol(a));
  const keys = [];
  for (const i of cand.concat(ib, all)) { if (!keys.includes(i)) keys.push(i); if (keys.length >= max) break; }
  return { rs, poc: k, imb, stk, keys };
}

// CVD per bar (close), reset by key(t) when given (session), else running.
export function cvdLine(bars, keyOf) {
  let acc = 0, key = null;
  return bars.map((b) => {
    if (keyOf) { const k = keyOf(b.t); if (k !== key) { key = k; acc = 0; } }
    acc += b.delta;
    return acc;
  });
}
export { cvdCandles };

// Short number for labels: -872, 1.4K, -1.8K (reference style); crypto volumes keep decimals.
export function fmtK(v) {
  const a = Math.abs(v), s = v < 0 ? '\u2212' : '';
  if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(1) + 'K';
  if (a >= 100 || Number.isInteger(v)) return s + Math.round(a);
  return a === 0 ? '0' : s + (+a.toFixed(a >= 10 ? 1 : 2));
}
export const fmtSigned = (v) => (v > 0 ? '+' : '') + fmtK(v);
