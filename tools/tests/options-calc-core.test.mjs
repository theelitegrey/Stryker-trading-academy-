// Options P&L maths (assets/options-calc-core.js). node tools/tests/options-calc-core.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../../assets/options-calc-core.js');
let n = 0; const ok = (m) => { n++; console.log('PASS', m); }; const near = (a, b, e, m) => assert.ok(Math.abs(a - b) <= e, m + ': ' + a + ' vs ' + b);
near(C.ncdf(0), 0.5, 1e-7, 'ncdf(0)'); near(C.ncdf(1.96), 0.975, 1e-4, 'ncdf(1.96)'); ok('normal cdf');
{ const c = C.price('C', 100, 100, 1, 0.2), p = C.price('P', 100, 100, 1, 0.2); near(c, 10.1861, 0.001, 'ATM call 1y (independent erf calc)'); near(c - p, 100 - 100 * Math.exp(-C.R), 1e-6, 'put-call parity'); ok('price + put-call parity'); }
{ near(C.price('C', 110, 100, 0, 0.2), 10, 0, 'intrinsic'); near(C.price('P', 110, 100, 0.5, 0), 0, 0, 'zero vol put'); ok('expiry / zero vol = intrinsic'); }
{ const d = 1e-3, g = C.greeks('C', 100, 105, 0.25, 0.3), up = C.price('C', 100 + d, 105, 0.25, 0.3), dn = C.price('C', 100 - d, 105, 0.25, 0.3);
  near(g.delta, (up - dn) / (2 * d), 1e-5, 'delta'); near(g.gamma, (up + dn - 2 * C.price('C', 100, 105, 0.25, 0.3)) / (d * d), 1e-3, 'gamma');
  near(g.vega, (C.price('C', 100, 105, 0.25, 0.31) - C.price('C', 100, 105, 0.25, 0.29)) / 2, 1e-4, 'vega per point');
  near(g.theta, (C.price('C', 100, 105, 0.25 - 1 / 365, 0.3) - C.price('C', 100, 105, 0.25, 0.3)), 5e-4, 'theta per day'); ok('greeks match finite differences');
  const p = C.greeks('P', 100, 105, 0.25, 0.3); near(p.delta, g.delta - 1, 1e-9, 'put delta'); ok('put delta = call delta - 1'); }
const leg = (side, type, K, days, px, iv = 0.25, qty = 1) => ({ side, type, K, days, px, iv, qty });
{ const a = C.analyse([leg(1, 'C', 100, 30, 3)], 100);   // long call
  near(a.maxLoss, -300, 1e-6, 'long call max loss'); assert.equal(a.maxProfit, Infinity); assert.equal(a.breakEvens.length, 1); near(a.breakEvens[0], 103, 0.05, 'long call BE'); ok('long call'); }
{ const a = C.analyse([leg(1, 'P', 100, 30, 2)], 100); near(a.maxLoss, -200, 1e-6, 'long put loss'); near(a.maxProfit, 9800, 1, 'long put profit'); near(a.breakEvens[0], 98, 0.05, 'put BE'); ok('long put'); }
{ const a = C.analyse([leg(1, 'C', 100, 30, 4), leg(-1, 'C', 110, 30, 1)], 100); near(a.maxProfit, 700, 1, 'bull call max'); near(a.maxLoss, -300, 1, 'bull call loss'); near(a.breakEvens[0], 103, 0.05, 'bull BE'); ok('bull call spread'); }
{ const a = C.analyse([leg(1, 'C', 100, 30, 3), leg(1, 'P', 100, 30, 3)], 100); assert.equal(a.breakEvens.length, 2); near(a.breakEvens[0], 94, 0.05, 'straddle lo'); near(a.breakEvens[1], 106, 0.05, 'straddle hi'); near(a.maxLoss, -600, 1e-6, 'straddle loss'); ok('straddle two break-evens'); }
{ const L = [leg(1, 'P', 90, 30, 0.5), leg(-1, 'P', 95, 30, 1.5), leg(-1, 'C', 105, 30, 1.5), leg(1, 'C', 110, 30, 0.5)];
  const a = C.analyse(L, 100); near(a.maxProfit, 200, 1, 'condor credit'); near(a.maxLoss, -300, 1, 'condor wing loss'); assert.equal(a.breakEvens.length, 2); assert.ok(a.pop > 0.3 && a.pop < 0.9, 'pop ' + a.pop); ok('iron condor'); }
{ const a = C.analyse([leg(-1, 'C', 100, 30, 3)], 100); assert.equal(a.maxLoss, -Infinity); near(a.maxProfit, 300, 1e-6, 'short call'); ok('short call unlimited loss'); }
{ const a = C.analyse([leg(1, 'S', 0, 30, 100), leg(-1, 'C', 105, 30, 2)], 100); near(a.maxProfit, 700, 1, 'covered call max'); assert.ok(a.maxLoss < -9000, 'covered call loss'); ok('covered call'); }
{ // probability of profit of a long ATM call is below 50 % (needs to beat the premium) and a 1-sigma short strangle is above 50 %
  const a = C.analyse([leg(1, 'C', 100, 30, 3)], 100); assert.ok(a.pop > 0.3 && a.pop < 0.5, 'long call pop ' + a.pop);
  near(C.probBetween(100, 0, Infinity, 0.5, 0.3), 1, 1e-9, 'prob sums to 1'); ok('probability of profit'); }
{ // calendar: today's curve is not the expiry curve; at the near expiry the short leg is intrinsic only
  const L = [leg(-1, 'C', 100, 10, 2), leg(1, 'C', 100, 40, 3.5)]; const a = C.analyse(L, 100); assert.ok(a.maxProfit > 0 && a.maxLoss < 0); assert.equal(a.days, 10);
  assert.notEqual(Math.round(C.pnl(L, 100, 0, 1)), Math.round(C.pnl(L, 100, 10, 1))); ok('calendar'); }
{ // IV multiplier changes long-dated value; date slider t moves value toward expiry
  const L = [leg(1, 'C', 100, 30, 3)]; assert.ok(C.pnl(L, 100, 0, 1.5) > C.pnl(L, 100, 0, 1)); assert.ok(C.pnl(L, 100, 15, 1) < C.pnl(L, 100, 0, 1)); ok('IV slider and date slider direction'); }
{ const S = C.surfaceIV({ m: [0.9, 1, 1.1], days: [10, 40], z: [[0.3, 0.2, 0.25], [0.28, 0.22, 0.24]] });
  near(S(100, 100, 10), 0.2, 1e-9, 'ATM near'); near(S(100, 100, 25), 0.21, 1e-9, 'ATM mid-term'); near(S(95, 100, 10), 0.25, 1e-9, 'interp strike'); near(S(50, 100, 10), 0.3, 1e-9, 'clamped'); ok('IV surface lookup'); }
{ const P = C.presetLegs('iron-condor', 7400, [{ days: 0 }, { days: 3 }, { days: 30 }, { days: 70 }]); assert.equal(P.length, 4); assert.ok(P[0].K < P[1].K && P[1].K < P[2].K && P[2].K < P[3].K);
  for (const [id] of C.PRESETS) assert.ok(C.presetLegs(id, 100, [{ days: 5 }, { days: 30 }, { days: 70 }]).length >= 1, id); ok('presets'); }
{ const t = C.termRows([['2026-11-06', 0.19, 0.3, 0.35, 0.28]]); near(t[0].rr, -7, 1e-9, 'RR'); near(t[0].atm, 30, 1e-9, 'atm'); ok('term rows + risk reversal'); }
console.log(n + ' groups passed');
