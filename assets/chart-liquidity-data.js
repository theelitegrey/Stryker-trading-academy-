// TradeZoro — Charts: liquidity heatmap maths (pure, no DOM). Owner order 2026-10-24 ("features like deepcharts",
// batch 2). Used by the Crypto DOM Heatmap layer (assets/chart-orderflow.js) and tools/tests/chart-liquidity.test.mjs.
//
// Inputs we already have, nothing new is fetched:
//   - book samples: { ts, mid, step, i0, v: Float32Array (bids +, asks -), fs, fi0, fv (fine layer, newest 30 min) }
//     from the page's own recording (1 a second) and the book recorder (1 a minute);
//   - trades: 1-minute footprint bars from Binance aggTrades (assets/chart-footprint-crypto.js):
//     { t, lo (tick idx), buy[], sell[] } with buy = aggressive buyers (they lift ASKS), sell = aggressive sellers
//     (they hit BIDS).
// Nothing here predicts anything. Education only. Not financial advice.

// ---------------------------------------------------------------- colour scale (dark, Deepcharts-like)
// near-black -> deep teal -> teal -> cyan -> yellow -> orange -> red -> near-white for the very largest.
export const DEEP_RAMP = [[10, 14, 18], [8, 46, 56], [0, 96, 108], [0, 160, 170], [72, 214, 206], [238, 222, 64], [255, 150, 20], [244, 54, 36], [255, 226, 214]];
export function deepColor(v) {
  v = Math.min(1, Math.max(0, v));
  const x = v * (DEEP_RAMP.length - 1), i = Math.min(DEEP_RAMP.length - 2, Math.floor(x)), f = x - i;
  return DEEP_RAMP[i].map((c, k) => Math.round(c + (DEEP_RAMP[i + 1][k] - c) * f));
}

// ---------------------------------------------------------------- traded volume at a price band
// Volume traded by the side that consumes a wall: an ASK wall (side -1) is eaten by aggressive buyers, a BID wall
// (side 1) by aggressive sellers. Price band [pLo, pHi) in price units; minutes overlapping [t0, t1] (ms).
// Returns null when the trades do not cover the window (coverFrom = first fully covered minute).
export function tradedAt(mins, tick, pLo, pHi, t0, t1, side, coverFrom = -Infinity) {
  const m0 = Math.floor(t0 / 60000) * 60000;
  if (m0 < coverFrom) return null;
  let v = 0;
  const kLo = Math.ceil(pLo / tick - 1e-9), kHi = Math.ceil(pHi / tick - 1e-9) - 1;
  for (const b of mins) {
    if (b.t < m0 || b.t > t1) continue;
    const arr = side > 0 ? b.sell : b.buy;
    for (let k = Math.max(kLo, b.lo); k <= Math.min(kHi, b.lo + arr.length - 1); k++) v += arr[k - b.lo];
  }
  return v;   // no bars in a covered window = nothing traded there
}

// ---------------------------------------------------------------- pulled vs filled
// A big resting level that vanished: its size at the first sample after it was last seen fell below `goneFrac` of
// its last size. FILLED = trades printed into it at that price (>= fillFrac of its last size, by the side that
// consumes it) between when it was last seen and when it was gone (+ the minute that holds it); PULLED = it
// disappeared with less than that traded there. null = the trades do not cover the window (no claim either way).
export function vanishKind(last, traded, { fillFrac = 0.3 } = {}) {
  if (traded == null || !(last > 0)) return null;
  return traded >= fillFrac * last ? 'filled' : 'pulled';
}

// ---------------------------------------------------------------- iceberg hint
// The fine book rows (or the coarse rows when there is no fine layer) of one sample at price step `step`:
// Map(row idx -> value) (bids +, asks -).
function rowsOf(s, step) {
  const out = new Map();
  const useFine = s.fv && s.fs > 0 && s.fs <= step * 1.0001;
  const ss = useFine ? s.fs : s.step, i0 = useFine ? s.fi0 : s.i0, v = useFine ? s.fv : s.v;
  if (!(ss <= step * 1.0001)) return null;
  for (let k = 0; k < v.length; k++) {
    if (!v[k]) continue;
    const i = Math.floor(((i0 + k) * ss + ss * 0.5) / step);
    out.set(i, (out.get(i) || 0) + v[k]);
  }
  return out;
}
// Per minute and price row of `step`: the volume that traded into one side at that row, against the size that was
// VISIBLE there during the minute. An iceberg hint = the row kept trading big while its visible size stayed small
// and kept coming back:
//   traded >= ratio x the row's median visible size, traded >= minTraded (and in the top `topPct` of all traded
//   rows that minute set), the row held resting size on that side in >= presence of the minute's samples (it was
//   refilled, it did not just vanish), and the minute has >= minSamples book samples (a 1-a-minute recorder
//   sample cannot see a refill, so only the page's own 1-second recording qualifies).
// samples sorted by ts; mins = footprint minute bars. Returns [{ t (minute ms), side (1 bid / -1 ask), i (row),
// price (row low), traded, visible (median), ratio, samples }].
export function icebergEvents(samples, mins, { step, tick, ratio = 4, minTraded = 0, presence = 0.8, minSamples = 20, topPct = 0.02 } = {}) {
  if (!(step > 0) || !(tick > 0) || !samples.length || !mins.length) return [];
  const byMin = new Map();
  for (const s of samples) { const m = Math.floor(s.ts / 60000) * 60000; let a = byMin.get(m); if (!a) { a = []; byMin.set(m, a); } a.push(s); }
  const cand = [];
  const allTraded = [];
  for (const b of mins) {
    const ss = byMin.get(b.t);
    if (!ss || ss.length < minSamples) continue;
    // traded per row of `step`, per consuming side
    const tr = new Map();   // key row*2 + (bid ? 1 : 0) -> volume
    for (let k = 0; k < b.buy.length; k++) {
      const p = (b.lo + k) * tick, i = Math.floor(p / step + 1e-9);
      if (b.buy[k]) { const key = i * 2; tr.set(key, (tr.get(key) || 0) + b.buy[k]); }
      if (b.sell[k]) { const key = i * 2 + 1; tr.set(key, (tr.get(key) || 0) + b.sell[k]); }
    }
    tr.forEach((v) => allTraded.push(v));
    const rs = ss.map((s) => rowsOf(s, step)).filter(Boolean);
    if (rs.length < minSamples) continue;
    tr.forEach((v, key) => {
      const i = Math.floor(key / 2), bid = key % 2 === 1;
      const vis = [];
      for (const r of rs) { const x = r.get(i) || 0; if (bid ? x > 0 : x < 0) vis.push(Math.abs(x)); }
      if (vis.length < presence * rs.length) return;
      vis.sort((a, c) => a - c);
      const med = vis[Math.floor(vis.length / 2)];
      if (!(med > 0) || v < ratio * med || v < minTraded) return;
      cand.push({ t: b.t, side: bid ? 1 : -1, i, price: i * step, traded: v, visible: med, ratio: v / med, samples: rs.length });
    });
  }
  if (!cand.length) return cand;
  allTraded.sort((a, c) => a - c);
  const cut = allTraded[Math.min(allTraded.length - 1, Math.floor(allTraded.length * (1 - topPct)))];
  return cand.filter((c) => c.traded >= cut).sort((a, c) => a.t - c.t || a.i - c.i);
}
