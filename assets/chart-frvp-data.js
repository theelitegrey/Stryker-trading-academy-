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

// ---------------------------------------------------------------- the profile itself (estimated from the span's candles)
// Why this exists: the drawing used to put a candle's WHOLE volume on just four rows (its open, high, low and close). With a few
// rows that is fine, but with 300 rows most rows stayed empty, the profile became a handful of spikes, and the value area (grown
// one row at a time from the POC) jumped across the gaps, so the same range gave a very different VAH / VAL for 24, 100 or 300 rows.
// Now each candle's volume is spread over every row its low..high range touches, in proportion to the overlap, so the shape of the
// profile (and the value area) stays put when only the row count changes. Same candles in, same { profile, developing* } out.
// bars: { time, open, high, low, close, volume }.
export function growValueArea(rows, poc, frac) {
  const n = rows.length, t = (k) => rows[k].up + rows[k].down;
  let total = 0;
  for (let k = 0; k < n; k++) total += t(k);
  const target = total * Math.min(1, Math.max(0, frac));
  let from = poc, to = poc, acc = t(poc);
  // standard value-area walk: weigh the next TWO rows above against the next TWO below and take the heavier pair
  // (a single row when only one is left on that side); ties go to the side that is currently shorter.
  while (acc < target && (from > 0 || to < n - 1)) {
    const nUp = Math.min(2, n - 1 - to), nDn = Math.min(2, from);
    let up = 0, dn = 0;
    for (let i = 1; i <= nUp; i++) up += t(to + i);
    for (let i = 1; i <= nDn; i++) dn += t(from - i);
    const goUp = nUp > 0 && (nDn === 0 || up > dn || (up === dn && to - poc <= poc - from));
    if (goUp) { to += nUp; acc += up; } else { from -= nDn; acc += dn; }
  }
  return { vaFrom: from, vaTo: to };
}
function addBar(rows, min, rowH, bar) {
  const v = bar.volume;
  if (!(v > 0)) return;
  const n = rows.length, side = bar.close >= bar.open ? 'up' : 'down';
  const lo = Math.min(bar.low, bar.high), hi = Math.max(bar.low, bar.high);
  if (!(hi > lo)) { const k = Math.min(n - 1, Math.max(0, Math.floor((lo - min) / rowH + 1e-9))); rows[k][side] += v; return; }
  const k0 = Math.max(0, Math.floor((lo - min) / rowH + 1e-9)), k1 = Math.min(n - 1, Math.floor((hi - min) / rowH - 1e-9));
  const span = hi - lo;
  for (let k = k0; k <= k1; k++) {
    const a = Math.max(lo, min + k * rowH), b = Math.min(hi, min + (k + 1) * rowH);
    if (b > a) rows[k][side] += v * (b - a) / span;
  }
}
function pocOf(rows) {
  let m = 0, poc = 0;
  for (let k = 0; k < rows.length; k++) { const t = rows[k].up + rows[k].down; if (t > m) { m = t; poc = k; } }
  return m > 0 ? { poc, maxTotal: m } : null;
}
export function buildProfile(bars, rowCount, frac, wantDeveloping) {
  let min = Infinity, max = -Infinity;
  for (const b of bars) { if (!(b.volume > 0)) continue; if (b.low < min) min = b.low; if (b.high > max) max = b.high; }
  if (!Number.isFinite(min)) return null;
  const n = max > min ? Math.max(1, Math.round(rowCount)) : 1, rowH = max > min ? (max - min) / n : 1;
  const mk = () => Array.from({ length: n }, (_, k) => ({ price: min + k * rowH, up: 0, down: 0 }));
  const rows = mk();
  for (const b of bars) addBar(rows, min, rowH, b);
  const pi = pocOf(rows);
  if (!pi) return null;
  const { vaFrom, vaTo } = growValueArea(rows, pi.poc, frac);
  const profile = { rows, rowH, min, maxTotal: pi.maxTotal, poc: pi.poc, vaFrom, vaTo };
  const out = { profile, developingPoc: [], developingVaHigh: [], developingVaLow: [] };
  if (!wantDeveloping) return out;
  const dr = mk();
  for (const b of bars) {
    addBar(dr, min, rowH, b);
    const p = pocOf(dr); if (!p) continue;
    const va = growValueArea(dr, p.poc, frac);
    out.developingPoc.push({ time: b.time, price: dr[p.poc].price + rowH / 2 });
    out.developingVaHigh.push({ time: b.time, price: dr[va.vaTo].price + rowH });
    out.developingVaLow.push({ time: b.time, price: dr[va.vaFrom].price });
  }
  return out;
}
