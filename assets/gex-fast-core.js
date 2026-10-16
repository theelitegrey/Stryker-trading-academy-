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
// goi at spot s1 given goi at build spot s0 (gamma re-estimated; 0 stays 0)
export function goiAt(goi, K, s0, s1, T, iv) {
  if (!(goi > 0)) return 0;
  if (!(iv > 0) || s0 === s1) return goi;
  const g0 = bsGamma(s0, K, T, iv);
  return g0 > 0 ? goi * bsGamma(s1, K, T, iv) / g0 : goi;
}
// One fast block { s0 (build spot), T, k:[strikes], c:[call goi], p:[put goi], ci:[call iv], pi:[put iv] } -> [{ strike, gex }]
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
