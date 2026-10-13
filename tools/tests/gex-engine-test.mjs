// GEX engine unit tests on a fixture chain (functions/api/gex/_engine.js).
// Pure node, no browser, no network:  node tools/tests/gex-engine-test.mjs
// Fixture: tools/tests/fixtures/gex/chain-qqq-0dte.json, a trimmed copy of the real Cboe QQQ
// 0DTE chain of 2026-10-13 (strikes 714-772, the contracts the API used), plus synthetic rows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { atmIv, ivRange, profile, levels, gammaWalls, activityWalls } from '../../functions/api/gex/_engine.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const FIX = JSON.parse(fs.readFileSync(new URL('./fixtures/gex/chain-qqq-0dte.json', import.meta.url)));
const spot = FIX.spot;
const rows = FIX.contracts;

// ---- IV30 (InsightSentry path) ----
// The old rule (median IV of every contract in the expiry) is dominated by far-OTM wings.
const oldMedian = (() => { const v = rows.map((r) => r.iv).filter((x) => x > 0).sort((a, b) => a - b); return v[v.length >> 1] * 100; })();
const iv = atmIv(rows, spot);
ok(oldMedian > 40, 'fixture: old median-of-all-contracts IV is inflated (' + oldMedian.toFixed(1) + '%)');
ok(iv > 8 && iv < 25, 'atmIv on the 0DTE chain = ' + iv + '% (ATM band, not the wings)');
// ATM = calls + puts on the 2 strikes each side of spot within 2%
const atm = rows.filter((r) => [Math.floor(spot) - 1, Math.floor(spot), Math.ceil(spot), Math.ceil(spot) + 1].includes(r.strike) && r.iv > 0).map((r) => r.iv * 100).sort((a, b) => a - b);
const m = atm.length >> 1, want = atm.length % 2 ? atm[m] : (atm[m - 1] + atm[m]) / 2;
ok(Math.abs(iv - want) < 0.01, 'atmIv = median of the 4 nearest strikes\' calls+puts (' + want.toFixed(3) + ')');
// zero / bad IVs and far strikes are ignored; percent input (>3) is accepted as is
ok(atmIv(rows.map((r) => (Math.abs(r.strike - spot) > 10 ? Object.assign({}, r, { iv: 5 }) : r)), spot) === iv, 'far-OTM IVs do not move atmIv');
ok(atmIv(rows.map((r) => Object.assign({}, r, { iv: r.iv * 100 })), spot) === iv, 'IV given in percent gives the same answer');
ok(atmIv([], spot) === 0 && atmIv(rows.map((r) => Object.assign({}, r, { iv: 0 })), spot) === 0, 'no usable IV -> 0');
// multi-expiry: the expiry nearest 30 days is used
const two = rows.map((r) => Object.assign({}, r, { dte: 0, iv: 0.5 })).concat(rows.map((r) => Object.assign({}, r, { dte: 28, iv: 0.2 })));
ok(atmIv(two, spot) === 20, 'expiry nearest 30 days wins (28 DTE at 20%, not 0 DTE at 50%)');

// ---- expected move ----
const e = ivRange(spot, iv);
const s = iv / 100 * Math.sqrt(1 / 252);
ok(Math.abs(e['68%'][1] - spot * (1 + s)) < 1e-9 && Math.abs(e['80%'][0] - spot * (1 - 1.282 * s)) < 1e-9, 'ivRange: spot x (1 ± iv x sqrt(1/252)), 80% = 1.282 sigma');
const pct = (e['68%'][1] / spot - 1) * 100;
ok(pct > 0.5 && pct < 1.6, 'QQQ 68% move with the fixed IV = ±' + pct.toFixed(2) + '% (was ±' + (oldMedian / 100 * Math.sqrt(1 / 252) * 100).toFixed(2) + '% with the inflated IV)');

// ---- profile sign convention ----
const p = profile(spot, rows);
ok(p.gex.get(740) < 0 && Math.abs(p.gex.get(740)) === Math.max(...[...p.gex.values()].map(Math.abs)), '740 is the largest |net GEX| strike and is negative (put-heavy)');

// ---- walls: gamma-based (Owner decision 2026-10-13) ----
const brute = (side, above) => {
  let best = null;
  for (const [k, g] of side) {
    if (above ? k < spot : k > spot) continue;
    if (Math.abs(k - spot) / spot >= 0.06) continue;
    if (best == null || (above ? g > side.get(best) : g < side.get(best))) best = k;
  }
  return best;
};
const lv = levels(spot, p.gex, rows, p);
ok(lv.wall_source === 'gamma', 'wall_source = gamma (' + lv.wall_source + ')');
ok(lv.call_wall === brute(p.callGex, true) && lv.call_wall >= spot, 'call wall ' + lv.call_wall + ' = largest positive call GEX at/above spot (' + (p.callGex.get(lv.call_wall) / 1e6).toFixed(0) + 'M)');
ok(lv.put_wall === brute(p.putGex, false) && lv.put_wall <= spot, 'put wall ' + lv.put_wall + ' = largest negative put GEX at/below spot (' + (p.putGex.get(lv.put_wall) / 1e6).toFixed(0) + 'M)');
ok(lv.put_wall === 740, 'put wall on the 740 strike, the biggest put gamma in the fixture (the old activity rule picked ' + activityWalls(spot, rows, null)[1] + ')');
ok([...p.callGex.values()].every((g) => g > 0) && [...p.putGex.values()].every((g) => g < 0), 'callGex all positive, putGex all negative');
// per-strike sides add up to net GEX
ok([...p.gex.keys()].every((k) => Math.abs((p.callGex.get(k) || 0) + (p.putGex.get(k) || 0) - p.gex.get(k)) < 1e-3 * Math.max(1, Math.abs(p.gex.get(k)))), 'callGex + putGex = net GEX per strike');
// strikes outside the 6% band never win, however large
const far = rows.concat([{ strike: Math.round(spot * 1.2), cp: 'C', dte: 0, oi: 1e7, vol: 0, gamma: 0.05, delta: 0.1, iv: 0.2 }, { strike: Math.round(spot * 0.8), cp: 'P', dte: 0, oi: 1e7, vol: 0, gamma: 0.05, delta: -0.1, iv: 0.2 }]);
const pf = profile(spot, far);
const [fc, fp] = gammaWalls(spot, pf.callGex, pf.putGex);
ok(fc === lv.call_wall && fp === lv.put_wall, 'huge strikes outside the band are ignored');
// fallback: no gamma data -> activity walls, labelled
const noG = rows.map((r) => Object.assign({}, r, { gamma: 0 }));
const pn = profile(spot, noG);
const ln = levels(spot, pn.gex, noG, pn);
const [ac, ap] = activityWalls(spot, noG, ln.zero_gamma);
ok(ln.wall_source === 'activity_fallback' && ln.call_wall === ac && ln.put_wall === ap, 'no gamma -> activity walls, wall_source activity_fallback (' + ln.call_wall + ' / ' + ln.put_wall + ')');
// one side missing: mixed label
const noPutG = rows.map((r) => (r.cp === 'P' ? Object.assign({}, r, { gamma: 0 }) : r));
const pm = profile(spot, noPutG);
const lm = levels(spot, pm.gex, noPutG, pm);
ok(lm.call_wall === lv.call_wall && lm.wall_source === 'call:gamma,put:activity_fallback', 'only put gamma missing -> ' + lm.wall_source);
console.log(n + ' checks, ALL PASS');
