// TradeZoro — GEX "fast" core (pure functions, no DOM/network) — ES module, used by the Pages Function
// functions/api/gex/ladder.js and tests/gex-fast.test.mjs.
// Owner/CoS order 2026-10-16 (InsightSentry add-on): the server feeder (gex_fast.py) pulls the InsightSentry chain
// every ~15 s per underlying and stores, per strike and side, goi = gamma x open interest x 100 x 0.01 (gamma = our
// Black-Scholes gamma at the build spot, the SAME formula and inputs as functions/api/gex/_engine.js). The net GEX
// of a strike at ANY spot S is then (callGoi - putGoi) x S^2 with each side's gamma re-estimated at S from its
// implied vol and the time to expiry. That is exactly what a server rebuild at S would compute with the same chain.
// Education only. Not financial advice.
const SQ2PI = Math.sqrt(2 * Math.PI);
// identical to bsGamma() in functions/api/gex/_engine.js (r = 4.5 %, q = 0)
export function bsGamma(S, K, T, sigma, r = 0.045, q = 0.0) {
  if (S <= 0 || K <= 0 || T <= 0 || sigma <= 0) return 0;
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / v;
  if (!Number.isFinite(d1) || Math.abs(d1) > 12) return 0;
  const nd1 = Math.exp(-0.5 * d1 * d1) / SQ2PI;
  return Math.exp(-q * T) * nd1 / (S * v);
}
// goi (gamma x OI x 100 x 0.01) at spot s1 from the stored OI weight w = OI x 100 x 0.01 (block v2): gamma is recomputed
// exactly with the engine's bsGamma at s1 from the strike's IV and T. No IV -> 0, like the engine.
export function goiAt(w, K, s0, s1, T, iv) {
  if (!(w > 0) || !(iv > 0)) return 0;
  return w * bsGamma(s1, K, T, iv);
}
// One fast block { v:2, s0 (build spot), T, k:[strikes], c:[call OI x 100 x 0.01], p:[put ...], ci:[call iv], pi:[put iv] } -> [{ strike, gex }]
// (strikes high to low) at spot s.
export function gexAtSpot(blk, s) {
  const out = [];
  for (let i = 0; i < blk.k.length; i++) {
    const K = blk.k[i];
    const c = goiAt(blk.c[i], K, blk.s0, s, blk.T, blk.ci[i]), p = goiAt(blk.p[i], K, blk.s0, s, blk.T, blk.pi[i]);
    out.push({ strike: K, gex: (c - p) * s * s });
  }
  return out.sort((a, b) => b.strike - a.strike);
}
// Net GEX the way the server reports it (strikes within 6 % of spot) and the ladder rows (within 4 %).
export function netNear(rows, s) { let t = 0; for (const r of rows) if (Math.abs(r.strike - s) / s < 0.06) t += r.gex; return t; }
export function ladderNear(rows, s) { return rows.filter((r) => Math.abs(r.strike - s) / s < 0.04); }

// Flip / walls from a fast block at spot s: the same rules as the engine (gammaFlip: 80-step scan of 0.90-1.10 x spot,
// linear + bisection root nearest spot; gammaWalls: biggest call goi at/above spot and biggest put goi at/below spot, within 6 %).
function netAll(blk, s) {
  let t = 0;
  for (let i = 0; i < blk.k.length; i++) t += (goiAt(blk.c[i], blk.k[i], blk.s0, s, blk.T, blk.ci[i]) - goiAt(blk.p[i], blk.k[i], blk.s0, s, blk.T, blk.pi[i])) * s * s;
  return t;
}
export function flipAt(blk, spot, steps = 80) {
  const lo = spot * 0.9, hi = spot * 1.1, xs = [], ys = [];
  for (let i = 0; i < steps; i++) { const x = lo + (hi - lo) * i / (steps - 1); xs.push(x); ys.push(netAll(blk, x)); }
  const crosses = [];
  for (let i = 1; i < xs.length; i++) {
    let a = xs[i - 1], b = xs[i], fa = ys[i - 1], fb = ys[i];
    if (fa === 0) crosses.push(a);
    else if (fa * fb < 0) {
      let m = a;
      for (let j = 0; j < 28; j++) {
        m = a + (b - a) * Math.abs(fa) / (Math.abs(fa) + Math.abs(fb));
        const fm = netAll(blk, m);
        if (fm === 0) break;
        if (fa * fm < 0) { b = m; fb = fm; } else { a = m; fa = fm; }
        if (Math.abs(b - a) < spot * 1e-6) break;
      }
      crosses.push(m);
    }
  }
  return crosses.length ? crosses.reduce((a, b) => (Math.abs(a - spot) < Math.abs(b - spot) ? a : b)) : null;
}
export function wallsAt(blk, s, band = 0.06) {
  let cw = null, cv = 0, pw = null, pv = 0;
  for (let i = 0; i < blk.k.length; i++) {
    const K = blk.k[i];
    if (Math.abs(K - s) / s >= band) continue;
    const c = goiAt(blk.c[i], K, blk.s0, s, blk.T, blk.ci[i]) * s * s, p = goiAt(blk.p[i], K, blk.s0, s, blk.T, blk.pi[i]) * s * s;
    if (K >= s && c > cv) { cv = c; cw = K; }
    if (K <= s && p > pv) { pv = p; pw = K; }
  }
  return { call_wall: cw, put_wall: pw };
}
