// TradeZoro — Charts: ORDER FLOW PRO maths (pure, no DOM). Owner order 2026-10-23: order-flow tools
// on the chart from the data we already record (Big Trades, Absorption, Imbalance Zones, swing /
// session profile + naked POC, Market Profile (TPO), Effort vs Result).
// Depends on: assets/chart-footprint-data.js (rows, imbalances, stacked, profile).
// Used by assets/chart-of-pro.js, assets/chart-footprint.js (Big Trades, Volume Profile) and
// tools/tests/chart-of-pro.test.mjs.
//
// Order-flow bars: { t, lo, hi, o, c (tick idx), buy[], sell[] (index 0 = lo), vol, delta, bigs:
// [[ms, priceIdx, size, side 1 buy / 0 sell]] } (futures: the book-recorder Worker; crypto: Binance
// aggTrades). Chart bars: { time, open, high, low, close, volume } in price units.
// Nothing here predicts anything. Education only. Not financial advice.

import { rows, imbalances, stacked, profile } from './chart-footprint-data.js?v=758';

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// ---------------------------------------------------------------- Big Trades
// The big prints of a list of bars, optionally merged into clusters: prints on the same side, within
// `ticks` of the cluster's first price and `windowMs` of its last print (one order split into several
// fills, or an order refilled at the same price). size = the sum, price = size-weighted, rounded to a
// tick. Returns [{ ms, pi, size, side, n }] sorted by time.
export function bigPrints(bars, { cluster = true, windowMs = 1000, ticks = 1 } = {}) {
  const all = [];
  for (const b of bars) for (const x of b.bigs || []) all.push(x);
  all.sort((p, q) => p[0] - q[0]);
  if (!cluster) return all.map(([ms, pi, size, side]) => ({ ms, pi, size, side, n: 1 }));
  const out = [], open = [];
  for (const [ms, pi, size, side] of all) {
    let c = null;
    for (let k = open.length - 1; k >= 0; k--) {
      const o = open[k];
      if (ms - o.last > windowMs) { open.splice(k, 1); continue; }
      if (o.side === side && Math.abs(pi - o.p0) <= ticks) { c = o; break; }
    }
    if (c) { c.size += size; c.pv += pi * size; c.n++; c.last = ms; c.pi = Math.round(c.pv / c.size); continue; }
    c = { ms, pi, size, side, n: 1, p0: pi, pv: pi * size, last: ms };
    out.push(c); open.push(c);
  }
  return out.map(({ ms, pi, size, side, n }) => ({ ms, pi, size, side, n }));
}
// The size a print must reach: the auto threshold (the recorder's 99.5th percentile per symbol, or
// the crypto feed's) x the multiplier, and never below the optional minimum in contracts.
export function bigThreshold(auto, mult, minSize) {
  const a = auto > 0 ? auto * (mult > 0 ? mult : 1) : 0;
  return Math.max(a, minSize > 0 ? minSize : 0) || 1;
}

// ---------------------------------------------------------------- Absorption
// A bar where heavy aggressive volume met a price and price did not move. Against the previous
// `lookback` bars: volume >= volMult x their average, AND volume per tick of range >= densMult x their
// average (a lot traded for the distance covered), AND |delta| >= minDeltaPct % of the bar's volume,
// AND the close went AGAINST the delta (net buying, yet it closed at or below the open: passive sellers
// absorbed the buyers; mirror for net selling). Run on 1-minute bars by default (the chart maps each
// event to the bar holding it), so a 5-minute chart shows the same events as a 1-minute one.
// side 1 = buyers absorbed (the level sits above: resistance), 0 = sellers absorbed (support).
// level = the price (tick idx) where the absorbed side traded the most inside the bar.
export function absorptionEvents(bars, { lookback = 30, volMult = 1.2, densMult = 1.3, minDeltaPct = 8 } = {}) {
  const out = [];
  let sv = 0, sd = 0;
  const dens = (x) => x.vol / (x.hi - x.lo + 1);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], n = Math.min(i, lookback);
    if (i > lookback) { sv -= bars[i - lookback - 1].vol; sd -= dens(bars[i - lookback - 1]); }
    const ok = n >= Math.min(10, lookback) && b.vol > 0 && sv > 0;
    const av = sv / n, ad = sd / n;
    sv += b.vol; sd += dens(b);
    if (!ok || b.vol < volMult * av || dens(b) < densMult * ad) continue;
    if (Math.abs(b.delta) * 100 < minDeltaPct * b.vol) continue;
    const side = b.delta > 0 && b.c <= b.o ? 1 : b.delta < 0 && b.c >= b.o ? 0 : null;
    if (side == null) continue;
    const arr = side ? b.buy : b.sell;
    let k = 0;
    for (let j = 1; j < arr.length; j++) if (arr[j] > arr[k]) k = j;
    out.push({ i, t: b.t, side, level: b.lo + k, vol: b.vol, delta: b.delta, volX: b.vol / av, densX: dens(b) / ad });
  }
  return out;
}
// The bar index where each level was broken: the first later bar that CLOSED beyond it by more than
// `buf` ticks (buyers absorbed: a close above; sellers absorbed: a close below). -1 = still holding.
export function levelBreaks(events, bars, buf = 0) {
  return events.map((e) => {
    for (let j = e.i + 1; j < bars.length; j++) {
      if (e.side === 1 ? bars[j].c > e.level + buf : bars[j].c < e.level - buf) return j;
    }
    return -1;
  });
}

// ---------------------------------------------------------------- Imbalance zones
// Stacked diagonal imbalances (>= `stack` rows in a row, ratio x, rows of m ticks) as zones. A zone
// starts at its bar and extends right until price trades THROUGH it (a buy zone: a later bar trades
// below its low; a sell zone: above its high); fill = that bar's index, -1 while open.
// zone = { i, t, side (1 buy / 0 sell), lo, hi (tick idx, inclusive), rows, vol, fill }.
export function imbalanceZones(bars, { m = 1, ratio = 3, stack = 3, minVol = 1 } = {}) {
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const rs = rows(bars[i], m);
    if (rs.length < stack) continue;
    const st = stacked(imbalances(rs, ratio, minVol), stack);
    for (const s of st) {
      let vol = 0;
      for (let k = s.k0; k <= s.k1; k++) vol += s.side ? rs[k].buy : rs[k].sell;
      out.push({ i, t: bars[i].t, side: s.side, lo: rs[s.k0].p, hi: rs[s.k1].p + m - 1, rows: s.k1 - s.k0 + 1, vol, fill: -1 });
    }
  }
  for (const z of out) {
    for (let j = z.i + 1; j < bars.length; j++) {
      if (z.side === 1 ? bars[j].lo < z.lo : bars[j].hi > z.hi) { z.fill = j; break; }
    }
  }
  return out;
}

// ---------------------------------------------------------------- swing / session profiles
// Swing pivots of a bar series: a high (low) that no bar within `len` bars on either side exceeds.
// Returned alternating (hi, lo, hi ...): of two same-kind pivots in a row the more extreme is kept.
export function swingPivots(highs, lows, len) {
  const piv = [];
  const n = highs.length;
  for (let i = len; i < n - len; i++) {
    let isH = true, isL = true;
    for (let j = i - len; j <= i + len && (isH || isL); j++) {
      if (j === i) continue;
      if (highs[j] > highs[i] || (highs[j] === highs[i] && j < i)) isH = false;
      if (lows[j] < lows[i] || (lows[j] === lows[i] && j < i)) isL = false;
    }
    if (isH) piv.push({ i, kind: 'hi', p: highs[i] });
    if (isL) piv.push({ i, kind: 'lo', p: lows[i] });
  }
  const out = [];
  for (const p of piv) {
    const last = out[out.length - 1];
    if (last && last.kind === p.kind) {
      if (p.kind === 'hi' ? p.p > last.p : p.p < last.p) out[out.length - 1] = p;
    } else out.push(p);
  }
  return out;
}
// Index ranges [i0, i1] (inclusive) between consecutive pivots, then the last pivot to the end
// (the developing swing). Bars before the first pivot are one more segment.
export function swingSegments(highs, lows, len) {
  const pv = swingPivots(highs, lows, len), n = highs.length, out = [];
  if (!n) return out;
  let a = 0;
  for (const p of pv) { if (p.i > a) { out.push({ i0: a, i1: p.i - 1 }); a = p.i; } }
  out.push({ i0: a, i1: n - 1, open: true });
  return out;
}
// Naked POC: a finished segment's POC row (rows of m ticks) that no LATER bar has traded since.
// segs = [{ i1, poc (row idx) }]; bars = { lo, hi } in tick idx. Returns the index of the bar that
// revisited each POC, or -1 = still naked.
export function pocRevisits(segs, bars, m) {
  return segs.map((s) => {
    const lo = s.poc * m, hi = lo + m - 1;
    for (let j = s.i1 + 1; j < bars.length; j++) if (bars[j].lo <= hi && bars[j].hi >= lo) return j;
    return -1;
  });
}
export { profile };

// ---------------------------------------------------------------- Market Profile (TPO)
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const tpoLetter = (k) => LETTERS[k % LETTERS.length];
// One session's TPO profile from its chart bars ({ time, high, low } price units), periods of
// periodMs from the session's first bar, rows of `row` price units. A row gets a TPO for a period when
// any bar of that period traded through it. POC = the row with the most TPOs (ties: nearest the
// middle); value area = va % of all TPOs grown from the POC toward the larger neighbour; IB = the
// range of the first `ibPeriods` periods. Returns null for no bars.
export function tpoProfile(bars, { periodMs = 1800000, row, va = 70, ibPeriods = 2 } = {}) {
  if (!bars.length || !(row > 0)) return null;
  const t0 = bars[0].time, eps = 1e-9;
  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { lo = Math.min(lo, b.low); hi = Math.max(hi, b.high); }
  const r0 = Math.floor(lo / row + eps), n = Math.floor(hi / row + eps) - r0 + 1;
  const cols = Array.from({ length: n }, () => []);
  let ibHi = -Infinity, ibLo = Infinity, periods = 0;
  for (const b of bars) {
    const p = Math.floor((b.time - t0) / periodMs);
    periods = Math.max(periods, p + 1);
    if (p < ibPeriods) { ibHi = Math.max(ibHi, b.high); ibLo = Math.min(ibLo, b.low); }
    const a = Math.floor(b.low / row + eps) - r0, z = Math.floor(b.high / row + eps) - r0;
    for (let k = a; k <= z; k++) { const c = cols[k]; if (c[c.length - 1] !== p) c.push(p); }
  }
  const counts = cols.map((c) => c.length);
  let total = 0, pk = 0;
  const mid = (n - 1) / 2;
  for (let k = 0; k < n; k++) { total += counts[k]; if (counts[k] > counts[pk] || (counts[k] === counts[pk] && Math.abs(k - mid) < Math.abs(pk - mid))) pk = k; }
  let a = pk, z = pk, acc = counts[pk];
  const need = total * va / 100;
  while (acc < need && (a > 0 || z < n - 1)) {
    const up = z < n - 1 ? counts[z + 1] : -1, dn = a > 0 ? counts[a - 1] : -1;
    if (up >= dn) { z++; acc += up; } else { a--; acc += dn; }
  }
  const singles = [];
  for (let k = 0; k < n; k++) if (counts[k] === 1 && k > 0 && k < n - 1) singles.push(k);
  return { r0, n, row, cols, counts, total, periods, poc: pk, val: a, vah: z, ibHi, ibLo, singles, open: bars[0].open, close: bars[bars.length - 1].close };
}
// A row size for a session: a "nice" multiple of the tick giving about `target` rows over its range.
const NICE = [1, 2, 2.5, 4, 5, 10, 20, 25, 40, 50, 100, 200, 250, 400, 500, 1000, 2000, 2500, 5000, 10000];
export function autoRow(rangePrice, tick, target = 36) {
  if (!(rangePrice > 0) || !(tick > 0)) return tick || 1;
  const raw = rangePrice / target / tick;
  for (const s of NICE) if (s >= raw) return s * tick;
  return NICE[NICE.length - 1] * tick;
}

// ---------------------------------------------------------------- Effort vs Result
// Per bar: effort = volume / the average volume of the previous `lookback` bars; result = range /
// their average range. flag 1 = HIGH EFFORT, LOW RESULT (effort >= minEffort and effort / result >=
// ratio: a lot traded, price barely moved); flag 2 = LOW EFFORT, HIGH RESULT (result >= minEffort and
// result / effort >= ratio: price moved on little volume). items = [{ vol, range }].
// Returns [{ e, r, flag }] (null e / r until there are 5 bars of history).
export function effortResult(items, { lookback = 20, minEffort = 1.5, ratio = 2 } = {}) {
  const out = [];
  let sv = 0, sr = 0;
  for (let i = 0; i < items.length; i++) {
    const n = Math.min(i, lookback);
    if (i > lookback) { sv -= items[i - lookback - 1].vol; sr -= items[i - lookback - 1].range; }
    if (n < Math.min(5, lookback) || !(sv > 0) || !(sr > 0)) out.push({ e: null, r: null, flag: 0 });
    else {
      const e = items[i].vol / (sv / n), r = items[i].range / (sr / n);
      out.push({ e, r, flag: e >= minEffort && e >= ratio * r ? 1 : r >= minEffort && r >= ratio * e ? 2 : 0 });
    }
    sv += items[i].vol; sr += items[i].range;
  }
  return out;
}

// ---------------------------------------------------------------- Stop-run / sweep
// A bar that pokes beyond a recent swing high (low) on a volume spike and CLOSES back inside: the
// stops resting above the high (below the low) were run, and price did not hold out there.
// bars = [{ high, low, close, vol }] (vol = real traded volume where order flow exists, else the
// feed's). Swing = a high (low) that no bar within `len` bars on either side exceeds (ties go to the
// earlier bar); it becomes usable only once confirmed, i.e. from bar p + len + 1, and stays usable for
// `maxAge` bars. Bar i SWEEPS a usable swing high H when high[i] > H, close[i] < H and vol[i] >=
// volMult x the average volume of the previous `lookback` bars (needs >= 5 of them). Every usable swing
// high that bar i trades above is consumed (swept, or broken by a close beyond, or a poke without the
// volume): a level is only run once. The event keeps the HIGHEST swept level (the furthest run).
// Mirror for lows. Returns [{ i, side: 1 = highs swept (buy stops above) | 0 = lows swept, level, p
// (pivot bar), extreme (the wick), volX, n (levels swept) }] in bar order.
export function sweepEvents(bars, { len = 5, lookback = 20, volMult = 1.5, maxAge = 300 } = {}) {
  const n = bars.length, out = [];
  if (n < 2 * len + 2) return out;
  const isHi = (p) => { for (let j = p - len; j <= p + len; j++) { if (j === p || j < 0 || j >= n) continue; if (bars[j].high > bars[p].high || (bars[j].high === bars[p].high && j < p)) return false; } return true; };
  const isLo = (p) => { for (let j = p - len; j <= p + len; j++) { if (j === p || j < 0 || j >= n) continue; if (bars[j].low < bars[p].low || (bars[j].low === bars[p].low && j < p)) return false; } return true; };
  let his = [], los = [], sv = 0;
  for (let i = 0; i < n; i++) {
    const p = i - len - 1;   // confirmed by bar i - 1
    if (p >= len) { if (isHi(p)) his.push({ p, price: bars[p].high }); if (isLo(p)) los.push({ p, price: bars[p].low }); }
    his = his.filter((h) => i - h.p <= maxAge); los = los.filter((l) => i - l.p <= maxAge);
    const m = Math.min(i, lookback);
    if (i > lookback) sv -= bars[i - lookback - 1].vol || 0;
    const avg = m ? sv / m : 0, b = bars[i], v = b.vol || 0;
    const spike = m >= Math.min(5, lookback) && avg > 0 && v >= volMult * avg;
    const took = his.filter((h) => b.high > h.price), keepH = his.filter((h) => b.high <= h.price);
    if (took.length) {
      const back = took.filter((h) => b.close < h.price);
      if (spike && back.length) { const top = back.reduce((x, y) => (y.price > x.price ? y : x)); out.push({ i, side: 1, level: top.price, p: top.p, extreme: b.high, volX: v / avg, n: back.length }); }
      his = keepH;
    }
    const tookL = los.filter((l) => b.low < l.price), keepL = los.filter((l) => b.low >= l.price);
    if (tookL.length) {
      const back = tookL.filter((l) => b.close > l.price);
      if (spike && back.length) { const bot = back.reduce((x, y) => (y.price < x.price ? y : x)); out.push({ i, side: 0, level: bot.price, p: bot.p, extreme: b.low, volX: v / avg, n: back.length }); }
      los = keepL;
    }
    sv += v;
  }
  return out;
}

// ---------------------------------------------------------------- New York sessions
const nyF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const nyC = new Map();
// { day: 'YYYY-MM-DD' (NY), min: minutes after NY midnight } for an epoch-ms time.
export function nyClock(ms) {
  const h = Math.floor(ms / 3600000);
  let base = nyC.get(h);
  if (!base) {
    const p = {};
    nyF.formatToParts(new Date(h * 3600000)).forEach((x) => { p[x.type] = x.value; });
    base = { day: p.year + '-' + p.month + '-' + p.day, min: +p.hour * 60 + +p.minute };
    if (nyC.size > 20000) nyC.clear();
    nyC.set(h, base);
  }
  return { day: base.day, min: base.min + Math.floor((ms % 3600000) / 60000) };
}
// RTH (09:30-16:00 New York) session key, or null outside it.
export function rthKey(ms) {
  const c = nyClock(ms);
  return c.min >= 570 && c.min < 960 ? c.day : null;
}
