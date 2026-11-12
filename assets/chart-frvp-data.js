// TradeZoro — Fixed Range Volume Profile extras: pure maths, no DOM (used by assets/chart-frvp.js; tests: tools/tests/frvp-data.test.mjs).
// deltaRows: buy minus sell volume per profile row, from 1-minute order-flow bars ({ t, lo, buy[], sell[] }, slot j = price (lo + j) * tick),
// the same bars the footprint reads. anchoredVwap: VWAP from the first bar, with the running volume-weighted standard deviation.
// Education only. Not financial advice.

// rows: n rows of rowH from `min`. Only minutes with from <= t < to count. Prices more than half a row outside the profile are skipped (not clamped in).
export function deltaRows(mins, tick, min, rowH, n, from, to) {
  const d = new Float64Array(n);
  let first = Infinity, last = -Infinity, used = 0;
  if (!(tick > 0) || !(rowH > 0) || !n) return { d, first: 0, last: 0, used };
  for (const b of mins) {
    if (b.t < from || b.t >= to) continue;
    let any = false;
    for (let j = 0; j < b.buy.length; j++) {
      if (!b.buy[j] && !b.sell[j]) continue;
      const r = ((b.lo + j) * tick - min) / rowH;
      if (r < -0.5 || r > n + 0.5) continue;           // outside the profile (bars and prints can differ by a tick or two)
      const k = Math.floor(r + 1e-9);
      d[k < 0 ? 0 : k >= n ? n - 1 : k] += b.buy[j] - b.sell[j];
      any = true;
    }
    if (any) { if (b.t < first) first = b.t; if (b.t > last) last = b.t; used++; }
  }
  return { d, first: used ? first : 0, last: used ? last : 0, used };
}

// bars: { time, high, low, close, volume } ascending. Returns per bar { time, vwap, sd } (null before any volume), or null when no bar has volume.
export function anchoredVwap(bars) {
  if (!bars.some((b) => b.volume > 0)) return null;
  let w = 0, pv = 0, p2v = 0;
  const out = [];
  for (const b of bars) {
    const v = b.volume > 0 ? b.volume : 0, tp = (b.high + b.low + b.close) / 3;
    w += v; pv += tp * v; p2v += tp * tp * v;
    if (!(w > 0)) continue;
    const m = pv / w;
    out.push({ time: b.time, vwap: m, sd: Math.sqrt(Math.max(0, p2v / w - m * m)) });
  }
  return out;
}
