// TradeZoro — Swing VWAP + Profile (L2): legs between confirmed swing pivots, each with an anchored VWAP and a volume profile (POC / VAH / VAL).
// Pure maths, no DOM. Education only. Not financial advice.
//
// LEGS. swingPivots() (chart-of-pro-data.js) gives confirmed pivots (a pivot needs `len` bars on each side, so it never appears and then
// vanishes) alternating high / low. Leg k runs from pivot k to pivot k+1; the open leg runs from the last pivot to the last bar.
// Frozen legs: a leg is `final` once another pivot follows its end pivot. The one leg that ends at the LAST pivot is not final yet: if price
// makes a more extreme pivot of the same kind before an opposite one confirms, swingPivots() moves that pivot (the swing is extended).
// Every older leg never changes when bars arrive.
//
// PROFILE. A leg's table is tick -> [buy, sell, approx]. Minutes that the trade feed covers (1-minute footprint bars, aggressor side per price)
// are exact: buy / sell. Chart bars before the feed's first minute fall back to the bar volume spread evenly over the bar's low..high
// ticks (approx, no side). `approx` > 0 anywhere marks the leg "approx". Nothing is made up: no feed and no volume = no profile.
import { swingPivots } from './chart-of-pro-data.js?v=953';

const EPS = 1e-9;

// -> { pivots, legs: [{ k, dir: 1 up | -1 down, a, b, open, final }] } a, b = bar indexes (inclusive). Oldest first.
export function buildLegs(highs, lows, len) {
  const n = highs.length, pivots = n > 2 * len ? swingPivots(highs, lows, len) : [], legs = [];
  for (let k = 0; k < pivots.length; k++) {
    const p = pivots[k], q = pivots[k + 1];
    if (q) legs.push({ k, dir: p.kind === 'lo' ? 1 : -1, a: p.i, b: q.i, open: false, final: k + 2 < pivots.length });
    else if (n - 1 > p.i) legs.push({ k, dir: p.kind === 'lo' ? 1 : -1, a: p.i, b: n - 1, open: true, final: false });
  }
  return { pivots, legs };
}

// Anchored VWAP over bars a..b (inclusive) with price = (high + low + close) / 3 weighted by bar volume.
// -> { vwap[], sd[] } one value per bar (null while the volume so far is 0). sd = volume-weighted standard deviation of the price.
export function legVwap(bars, a, b) {
  const vwap = [], sd = [];
  let sv = 0, spv = 0, spp = 0;
  for (let i = a; i <= b; i++) {
    const x = bars[i], v = x.volume > 0 ? x.volume : 0, p = (x.high + x.low + x.close) / 3;
    sv += v; spv += p * v; spp += p * p * v;
    if (sv > 0) { const m = spv / sv; vwap.push(m); sd.push(Math.sqrt(Math.max(0, spp / sv - m * m))); } else { vwap.push(null); sd.push(null); }
  }
  return { vwap, sd };
}

// The leg's per-tick table. fb = { bars: 1-minute footprint bars sorted by t ({ t, lo, buy[], sell[] }), from: first covered ms }, tick = price per tick idx.
// Chart bar i is exact when its whole span starts at/after fb.from, else approximated from its volume.
export function legTab(bars, a, b, tf, fb, tick) {
  const tab = new Map(), from = fb && fb.from > 0 ? fb.from : Infinity, fbars = fb && fb.bars ? fb.bars : [];
  let approxBars = 0, exactBars = 0;
  const slot = (k) => { let e = tab.get(k); if (!e) { e = [0, 0, 0]; tab.set(k, e); } return e; };
  for (let i = a; i <= b; i++) {
    const x = bars[i], t0 = x.time, t1 = t0 + tf;
    if (t0 >= from) {
      exactBars++;
      let lo = 0, hi = fbars.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (fbars[m].t < t0) lo = m + 1; else hi = m; }
      for (let j = lo; j < fbars.length && fbars[j].t < t1; j++) {
        const m = fbars[j];
        for (let q = 0; q < m.buy.length; q++) { if (!m.buy[q] && !m.sell[q]) continue; const e = slot(m.lo + q); e[0] += m.buy[q]; e[1] += m.sell[q]; }
      }
    } else if (x.volume > 0 && tick > 0) {
      approxBars++;
      const k0 = Math.round(x.low / tick), k1 = Math.max(k0, Math.round(x.high / tick)), per = x.volume / (k1 - k0 + 1);
      for (let k = k0; k <= k1; k++) slot(k)[2] += per;
    }
  }
  return { tab, approxBars, exactBars, approx: approxBars > 0 };
}

// Group the table into rows of m ticks and find POC and the value area.
// -> { r0, n, m, buy[], sell[], app[], vol[], poc (row k), vaLo, vaHi (row k), total, maxVol, maxAbsDelta } | null.
// Row k covers ticks (r0 + k) * m .. +m - 1; its price (centre) is rowPrice().
export function buildProfile(tab, m, vaPct) {
  m = Math.max(1, Math.round(m));
  let lo = Infinity, hi = -Infinity;
  for (const k of tab.keys()) { const r = Math.floor(k / m + EPS); if (r < lo) lo = r; if (r > hi) hi = r; }
  if (hi < lo) return null;
  const n = hi - lo + 1, buy = new Float64Array(n), sell = new Float64Array(n), app = new Float64Array(n), vol = new Float64Array(n);
  for (const [k, e] of tab) { const i = Math.floor(k / m + EPS) - lo; buy[i] += e[0]; sell[i] += e[1]; app[i] += e[2]; }
  let total = 0, poc = 0, maxVol = 0, maxAbsDelta = 0;
  for (let i = 0; i < n; i++) {
    vol[i] = buy[i] + sell[i] + app[i]; total += vol[i];
    if (vol[i] > maxVol) { maxVol = vol[i]; poc = i; }   // first row of equal volume wins (lowest price)
    maxAbsDelta = Math.max(maxAbsDelta, Math.abs(buy[i] - sell[i]));
  }
  if (!(total > 0)) return null;
  // value area: from the POC, add the side with more volume two rows at a time (the usual exchange method) until vaPct of the total is inside
  const want = total * Math.min(100, Math.max(1, vaPct)) / 100;
  let vaLo = poc, vaHi = poc, got = vol[poc];
  while (got < want - EPS && (vaLo > 0 || vaHi < n - 1)) {
    const up = (vaHi + 1 < n ? vol[vaHi + 1] : 0) + (vaHi + 2 < n ? vol[vaHi + 2] : 0), dn = (vaLo - 1 >= 0 ? vol[vaLo - 1] : 0) + (vaLo - 2 >= 0 ? vol[vaLo - 2] : 0);
    const goUp = vaHi < n - 1 && (vaLo === 0 || up >= dn);
    if (goUp) { const c = Math.min(2, n - 1 - vaHi); for (let j = 1; j <= c; j++) got += vol[vaHi + j]; vaHi += c; }
    else { const c = Math.min(2, vaLo); for (let j = 1; j <= c; j++) got += vol[vaLo - j]; vaLo -= c; }
  }
  return { r0: lo, n, m, buy, sell, app, vol, poc, vaLo, vaHi, total, maxVol, maxAbsDelta };
}

// price of the centre of row k (a row of m ticks holds ticks r*m .. r*m + m - 1, each priced idx * tick)
export const rowPrice = (P, k, tick) => ((P.r0 + k) * P.m + (P.m - 1) / 2) * tick;

// Naked POC: index of the first bar AFTER the leg (from index `from`) whose range touches `price`, or -1 while untouched.
export function touchedAt(bars, from, price) {
  for (let j = from; j < bars.length; j++) if (bars[j].low <= price && bars[j].high >= price) return j;
  return -1;
}

// Row size in ticks for the screen: the smallest step that is at least minPx tall and keeps <= maxRows rows over the leg's tick span.
export function autoRowTicks(spanTicks, tickPx, minPx, maxRows, steps) {
  for (const s of steps) if (tickPx * s >= minPx && spanTicks / s <= maxRows) return s;
  return steps[steps.length - 1];
}
