// TradeZoro — Charts: order-flow DATA (decode + re-aggregation + maths). Pure, no DOM.
// Depends on: nothing. Used by assets/chart-footprint.js (footprint chart type + the Order Flow
// indicators) and by the unit tests (workers/book-recorder/test/orderflow.test.mjs).
//
// Source: the book-recorder Worker's GET /orderflow (workers/book-recorder/src/orderflow.js),
// 1-minute bars built on our server from InsightSentry tick trades (of-feeder/ofcodec.py).
// Each bar: volume at every traded price split into buy (aggressor lifted the ask) and sell
// (aggressor hit the bid), running delta high/low, print count, and the big trades (one
// aggressive order >= the symbol's size threshold) with their time, price, size and side.
//
// The chart re-aggregates the 1-minute bars to its own timeframe (aggregate()) and to coarser
// price rows (rows()). No-lookahead (bar replay): every function takes the bars it is given;
// the caller clips them to the replay time with clipTo() first, which also trims the bar holding
// the replay clock to the minutes already complete and drops big trades after the clock.
//
// Education only. Not financial advice.

export function readUv(b, i) {
  let n = 0, s = 1, x;
  do { x = b[i++]; n += (x & 0x7f) * s; s *= 128; } while (x >= 0x80);
  return [n, i];
}
function readSv(b, i) { const r = readUv(b, i); r[0] = r[0] % 2 ? -(r[0] + 1) / 2 : r[0] / 2; return r; }

// One /orderflow payload -> { header, bars }. bar = { t (ms, minute open), lo, hi (tick idx),
// o, c (tick idx), buy: Int32Array, sell: Int32Array (index 0 = lo), vol, delta, dmax, dmin,
// trades, bigs: [[ms, priceIdx, size, side 1 buy / 0 sell]] }.
export function decodeOrderflow(u8) {
  if (u8[0] !== 0x4f || u8[1] !== 0x46 || u8[2] !== 0x31 || u8[3] !== 0x0a) throw new Error('not an order-flow payload');
  let i = 4, hl, cnt;
  [hl, i] = readUv(u8, i);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(i, i + hl)));
  i += hl;
  [cnt, i] = readUv(u8, i);
  const bars = new Array(cnt);
  for (let k = 0; k < cnt; k++) {
    let len, t, lo, n, o, c, x;
    [len, i] = readUv(u8, i);
    const end = i + len;
    [t, i] = readUv(u8, i); [lo, i] = readSv(u8, i); [n, i] = readUv(u8, i); [o, i] = readUv(u8, i); [c, i] = readUv(u8, i);
    const buy = new Int32Array(n), sell = new Int32Array(n);
    let vol = 0, delta = 0;
    for (let j = 0; j < n; j++) { [x, i] = readUv(u8, i); buy[j] = x; [x, i] = readUv(u8, i); sell[j] = x; vol += buy[j] + sell[j]; delta += buy[j] - sell[j]; }
    let dmax, dmin, trades, nb;
    [dmax, i] = readSv(u8, i); [dmin, i] = readSv(u8, i); [trades, i] = readUv(u8, i); [nb, i] = readUv(u8, i);
    const bigs = [];
    for (let j = 0; j < nb; j++) { let ms, po, sz; [ms, i] = readUv(u8, i); [po, i] = readUv(u8, i); [sz, i] = readUv(u8, i); bigs.push([t * 60000 + ms, lo + po, Math.floor(sz / 2), sz % 2]); }
    // (a 1-second price path follows, used by tick replay via /ticks1s; skipped here)
    i = end;
    // hi = the highest row with volume (rows with no sided volume can still be the open/close)
    bars[k] = { t: t * 60000, lo, hi: lo + n - 1, o: lo + o, c: lo + c, buy, sell, vol, delta, dmax, dmin, trades, bigs, mins: 1 };
  }
  return { header, bars };
}

// gzip'd body (x-of-gzip: 1) -> Uint8Array. DecompressionStream in browsers; node in tests.
export async function gunzipBody(buf) {
  const s = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
  return new Uint8Array(await s.arrayBuffer());
}

// Merge 1-minute bars into bars of `tfMs` (aligned to the epoch like the chart's bars; daily and
// above are not supported: order flow works up to 4 h). Input sorted by t; output sorted.
export function aggregate(bars, tfMs) {
  if (tfMs <= 60000) return bars;
  const out = [];
  let cur = null, run = 0;
  for (const b of bars) {
    const bt = Math.floor(b.t / tfMs) * tfMs;
    if (!cur || cur.t !== bt) {
      if (cur) out.push(cur);
      cur = { t: bt, lo: b.lo, hi: b.hi, o: b.o, c: b.c, buy: b.buy.slice(), sell: b.sell.slice(), vol: b.vol, delta: b.delta,
        dmax: b.dmax, dmin: b.dmin, trades: b.trades, bigs: b.bigs.slice(), mins: 1 };
      run = b.delta;
      continue;
    }
    // running delta high/low across the merged minutes: offset this minute's extremes by the delta so far
    const dmax = run + b.dmax, dmin = run + b.dmin;
    if (dmax > cur.dmax) cur.dmax = dmax;
    if (dmin < cur.dmin) cur.dmin = dmin;
    run += b.delta;
    const lo = Math.min(cur.lo, b.lo), hi = Math.max(cur.hi, b.hi);
    if (lo !== cur.lo || hi !== cur.hi) {
      const nb = new cur.buy.constructor(hi - lo + 1), ns = new cur.sell.constructor(hi - lo + 1);   // Int32 (futures) or Float64 (crypto)
      nb.set(cur.buy, cur.lo - lo); ns.set(cur.sell, cur.lo - lo);
      cur.buy = nb; cur.sell = ns; cur.lo = lo; cur.hi = hi;
    }
    const off = b.lo - cur.lo;
    for (let j = 0; j < b.buy.length; j++) { cur.buy[off + j] += b.buy[j]; cur.sell[off + j] += b.sell[j]; }
    cur.c = b.c; cur.vol += b.vol; cur.delta += b.delta; cur.trades += b.trades; cur.mins++;
    for (const x of b.bigs) cur.bigs.push(x);
  }
  if (cur) out.push(cur);
  return out;
}

// No lookahead: only the 1-minute bars that are complete at replay time E (ms). A minute bar
// [t, t+60s) is complete when t + 60s <= E. Re-aggregating the result then gives the forming
// higher-timeframe bar built from complete minutes only, as the replay's candles are.
export function clipTo(bars, E) {
  if (E == null) return bars;
  let hi = bars.length;
  while (hi > 0 && bars[hi - 1].t + 60000 > E) hi--;
  return hi === bars.length ? bars : bars.slice(0, hi);
}

// Price rows of `m` ticks for one bar: [{ p (row low, tick idx), buy, sell }] from low to high.
// Rows are aligned to multiples of m so neighbouring bars line up.
export function rows(bar, m) {
  const out = [];
  if (m <= 1) {
    for (let j = 0; j < bar.buy.length; j++) out.push({ p: bar.lo + j, buy: bar.buy[j], sell: bar.sell[j] });
    return out;
  }
  let cur = null;
  for (let j = 0; j < bar.buy.length; j++) {
    const p = bar.lo + j, r = Math.floor(p / m) * m;
    if (!cur || cur.p !== r) { cur = { p: r, buy: 0, sell: 0 }; out.push(cur); }
    cur.buy += bar.buy[j]; cur.sell += bar.sell[j];
  }
  return out;
}

// POC: the row with the most volume (ties: the one nearest the bar's middle, then the lower).
export function poc(rs) {
  let best = -1, bi = -1;
  const mid = rs.length ? (rs[0].p + rs[rs.length - 1].p) / 2 : 0;
  for (let k = 0; k < rs.length; k++) {
    const v = rs[k].buy + rs[k].sell;
    if (v > best || (v === best && Math.abs(rs[k].p - mid) < Math.abs(rs[bi].p - mid))) { best = v; bi = k; }
  }
  return bi;
}

// Diagonal imbalances (the ATAS / TradingView definition): a BUY imbalance at row k when the buy
// volume there >= ratio x the sell volume one row LOWER; a SELL imbalance at row k when the sell
// volume there >= ratio x the buy volume one row HIGHER. A zero on the other side counts when the
// volume is at least `minVol`. Returns { buy: Uint8Array, sell: Uint8Array } flags per row.
export function imbalances(rs, ratio, minVol = 1) {
  const n = rs.length, buy = new Uint8Array(n), sell = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const r = rs[k];
    if (k > 0 && r.buy >= minVol && r.buy >= ratio * rs[k - 1].sell) buy[k] = 1;
    if (k < n - 1 && r.sell >= minVol && r.sell >= ratio * rs[k + 1].buy) sell[k] = 1;
  }
  return { buy, sell };
}

// Stacked imbalances: runs of >= `len` consecutive rows with the same imbalance side.
// Returns [{ side: 1 buy / 0 sell, k0, k1 (row indexes, inclusive) }].
export function stacked(flags, len = 3) {
  const out = [];
  for (const [side, f] of [[1, flags.buy], [0, flags.sell]]) {
    let s = -1;
    for (let k = 0; k <= f.length; k++) {
      if (k < f.length && f[k]) { if (s < 0) s = k; }
      else if (s >= 0) { if (k - s >= len) out.push({ side, k0: s, k1: k - 1 }); s = -1; }
    }
  }
  return out;
}

// Unfinished auction: the bar's extreme row traded on BOTH sides (buyers at the high met sellers,
// sellers at the low met buyers): the auction did not end on one side, so price often revisits it.
export function unfinished(rs) {
  if (!rs.length) return { high: false, low: false };
  const h = rs[rs.length - 1], l = rs[0];
  return { high: h.buy > 0 && h.sell > 0, low: l.buy > 0 && l.sell > 0 };
}

// Cumulative delta per bar as OHLC candles: open = CVD before the bar, close = after, high / low
// from the bar's running delta extremes. reset: 'none' | 'session' (CME day, 18:00 New York) |
// 'day' (UTC day). sessionOf(ms) -> key, supplied by the caller (it knows the time zone).
export function cvdCandles(bars, reset, sessionOf) {
  let acc = 0, key = null;
  return bars.map((b) => {
    if (reset !== 'none') {
      const k = reset === 'session' && sessionOf ? sessionOf(b.t) : Math.floor(b.t / 86400000);
      if (k !== key) { key = k; acc = 0; }
    }
    const o = acc, c = acc + b.delta;
    acc = c;
    return { t: b.t, o, h: o + b.dmax, l: o + b.dmin, c };
  });
}

// Volume profile from trades over a list of bars: rows of `m` ticks with the real buy / sell split,
// POC and the value area (va %, default 70) grown from the POC toward the larger neighbour (same
// rule as assets/chart-orderflow.js volumeProfile and the GEX engine).
export function profile(bars, m, va = 70) {
  if (!bars.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { if (b.lo < lo) lo = b.lo; if (b.hi > hi) hi = b.hi; }
  const r0 = Math.floor(lo / m), n = Math.floor(hi / m) - r0 + 1;
  const buy = new Float64Array(n), sell = new Float64Array(n);
  for (const b of bars) for (let j = 0; j < b.buy.length; j++) { const k = Math.floor((b.lo + j) / m) - r0; buy[k] += b.buy[j]; sell[k] += b.sell[j]; }
  let total = 0, pk = 0, pv = -1;
  for (let k = 0; k < n; k++) { const v = buy[k] + sell[k]; total += v; if (v > pv) { pv = v; pk = k; } }
  let a = pk, z = pk, acc = pv;
  const need = total * va / 100;
  while (acc < need && (a > 0 || z < n - 1)) {
    const up = z < n - 1 ? buy[z + 1] + sell[z + 1] : -1, dn = a > 0 ? buy[a - 1] + sell[a - 1] : -1;
    if (up >= dn) { z++; acc += up; } else { a--; acc += dn; }
  }
  return { r0, m, n, buy, sell, total, poc: r0 + pk, val: r0 + a, vah: r0 + z };
}

// VWAP from trades with standard-deviation bands, per bar (cumulative from the reset). Uses every
// price row's volume, not the bar's typical price. Returns [{ t, vwap, sd }] in PRICE units.
export function vwapSeries(bars, tick, reset, sessionOf) {
  let pv = 0, p2v = 0, v = 0, key = null;
  return bars.map((b) => {
    const k = reset === 'session' && sessionOf ? sessionOf(b.t) : Math.floor(b.t / 86400000);
    if (reset !== 'none' && k !== key) { key = k; pv = 0; p2v = 0; v = 0; }
    for (let j = 0; j < b.buy.length; j++) {
      const q = b.buy[j] + b.sell[j];
      if (!q) continue;
      const p = (b.lo + j) * tick;
      pv += p * q; p2v += p * p * q; v += q;
    }
    if (!v) return { t: b.t, vwap: null, sd: null };
    const w = pv / v;
    return { t: b.t, vwap: w, sd: Math.sqrt(Math.max(0, p2v / v - w * w)) };
  });
}
