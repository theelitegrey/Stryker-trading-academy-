// Fast GEX: per-strike gamma x OI re-priced at a new spot == the server engine's full recompute at that spot.
//   node tools/tests/gex-fast.test.mjs      (needs python3 for the feeder round trip)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gexAtSpot, netNear, ladderNear, goiAt, bsGamma } from '../../assets/gex-fast-core.js';
import { ownGamma, profile, bsGamma as engGamma } from '../../functions/api/gex/_engine.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), m + ' (' + a.toExponential(4) + ' vs ' + b.toExponential(4) + ')');

ok(bsGamma(712, 710, 0.0008, 0.2) === engGamma(712, 710, 0.0008, 0.2), 'client bsGamma is bit-identical to the engine bsGamma');

// synthetic QQQ-like 0DTE chain
const now = Date.UTC(2026, 9, 16, 17, 30) / 1000;          // 13:30 ET
const exp = new Date('2026-10-16T00:00:00Z');
const s0 = 712.0;
const contracts = [];
for (let K = 680; K <= 745; K++) for (const cp of ['C', 'P']) {
  const iv = 0.16 + 0.0009 * Math.abs(K - s0) + (cp === 'P' ? 0.01 : 0);
  contracts.push({ strike: K, cp, exp, dte: 0, oi: Math.round(500 + 40000 * Math.exp(-Math.pow((K - s0) / 7, 2))) * (cp === 'C' ? 1 : 1.3), iv, bid: 1, ask: 1.1, delta: 0 });
}
const T = ownGamma(contracts, s0, now)[0].T;
// what the feeder stores at build spot s0
const blk = { s0, T, k: [], c: [], p: [], ci: [], pi: [] };
const g0 = ownGamma(contracts, s0, now);
for (let K = 680; K <= 745; K++) {
  const c = g0.find((x) => x.strike === K && x.cp === 'C'), p = g0.find((x) => x.strike === K && x.cp === 'P');
  blk.k.push(K); blk.c.push(c.gamma * c.oi * 100 * 0.01); blk.p.push(p.gamma * p.oi * 100 * 0.01); blk.ci.push(c.iv); blk.pi.push(p.iv);
}
// at the build spot: exact
const rows0 = gexAtSpot(blk, s0), srv0 = profile(s0, g0).gex;
ok(rows0.every((r) => Math.abs(r.gex - srv0.get(r.strike)) <= 1e-6 * Math.max(1, Math.abs(srv0.get(r.strike)))), 'at the build spot every strike equals the server profile()');
// a moved spot: compare to a FULL server recompute at the new spot (same chain, same IVs)
for (const s1 of [712.3, 711.4, 713.9, 709.5]) {
  const g1 = ownGamma(contracts, s1, now), srv = profile(s1, g1).gex, rows = gexAtSpot(blk, s1);
  let worst = 0;
  for (const r of rows) { const e = srv.get(r.strike); worst = Math.max(worst, Math.abs(r.gex - e) / Math.max(1e6, Math.abs(e))); }
  ok(worst < 1e-9, 'strike-by-strike match at spot ' + s1 + ' (worst relative diff ' + worst.toExponential(1) + ')');
  const netSrv = [...srv.keys()].filter((k) => Math.abs(k - s1) / s1 < 0.06).reduce((t, k) => t + srv.get(k), 0);
  near(netNear(rows, s1), netSrv, 1e-9, 'net GEX at ' + s1 + ' equals the server net');
  ok(ladderNear(rows, s1).length === [...srv.keys()].filter((k) => Math.abs(k - s1) / s1 < 0.04).length, 'ladder strike count (4 % band) equals the server at ' + s1);
}
// spot^2 only scaling (no IV) is a degraded mode; with IV missing goiAt keeps goi
ok(goiAt(5, 700, 712, 713, 0.001, 0) === 5, 'no IV: gamma held');
ok(goiAt(0, 700, 712, 713, 0.001, 0.2) === 0, 'zero goi stays zero');

// feeder round trip: python reduce_chain on tiny synthetic IS + Cboe inputs, then the same numbers from node
const dir = mkdtempSync(join(tmpdir(), 'gexfast-'));
const isd = { last_price: 712.0, data: [], last_update: 1 }, cb = { spot: 712.4, expiries: { '2026-10-16': [], '2026-10-19': [] } };
for (let K = 690; K <= 735; K++) for (const cp of ['C', 'P']) {
  isd.data.push({ expiration: 20261016, type: cp === 'C' ? 'CALL' : 'PUT', strike_price: K, implied_volatility: 0.2, bid_price: 1, ask_price: 1.2 });
  cb.expiries['2026-10-16'].push([K, cp, 1000 + K, 0.19, 1, 1.2, 10, 0.5]);
}
writeFileSync(join(dir, 'is.json'), JSON.stringify(isd)); writeFileSync(join(dir, 'cb.json'), JSON.stringify(cb));
const py = fileURLToPath(new URL('../../workers/book-recorder/gex-feeder/gex_fast.py', import.meta.url));
const out = JSON.parse(execFileSync('python3', [py, '--reduce', join(dir, 'is.json'), join(dir, 'cb.json'), 'QQQ', '0', String(now)]));
ok(out && out.k.length === 46 && out.x === '2026-10-16' && out.hy === true, 'python reduce_chain: 46 strikes, 0DTE expiry, hybrid on');
const mine = ownGamma(cb.expiries['2026-10-16'].map(([K, cp, oi]) => ({ strike: K, cp, oi, iv: 0.2, exp, dte: 0 })), 712.0, now);
let worstPy = 0;
out.k.forEach((K, i) => { const c = mine.find((x) => x.strike === K && x.cp === 'C'); const e = c.gamma * c.oi * 100 * 0.01; worstPy = Math.max(worstPy, Math.abs(out.c[i] - e) / e); });
ok(worstPy < 1e-5, 'python feeder goi equals the engine gamma x OI x 100 x 0.01 (worst rel diff ' + worstPy.toExponential(1) + ', 6 significant digits)');
console.log('gex-fast.test: ' + n + ' checks passed');
