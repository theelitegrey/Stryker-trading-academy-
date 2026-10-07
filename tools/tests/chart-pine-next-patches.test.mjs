// Unit test for assets/chart-pine-next-patches.js (the O(n) ta.pivothigh/pivotlow).
// Needs a local pinets 0.11.0 (not a repo dependency):
//   PINETS=/path/to/node_modules/pinets node tools/tests/chart-pine-next-patches.test.mjs
// Runs the same scripts with and without the patch and requires identical plots, then
// times a 3,000-bar pivot-heavy script both ways.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PINETS = process.env.PINETS;
if (!PINETS) { console.log('SKIP: set PINETS=<path to node_modules/pinets>'); process.exit(0); }
const pt = await import(pathToFileURL(path.join(PINETS, 'dist', 'pinets.min.es.js')).href);
const patches = await import(pathToFileURL(path.join(here, '..', '..', 'assets', 'chart-pine-next-patches.js')).href);

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

function bars(n, seed){
  let x = seed, p = 100;
  const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  return Array.from({ length: n }, (_, i) => {
    const o = p; p += (rnd() - 0.5) * 2; const c = Math.round(p * 4) / 4;
    const h = Math.max(o, c) + Math.round(rnd() * 4) / 4, l = Math.min(o, c) - Math.round(rnd() * 4) / 4;
    return { openTime: 1.7e12 + i * 3e5, closeTime: 1.7e12 + (i + 1) * 3e5, open: o, high: h, low: l, close: c, volume: 100 };
  });
}
const SRC = `//@version=6
indicator("piv", overlay=true)
len = input.int(3, "len")
ph = ta.pivothigh(high, len, len)
pl = ta.pivotlow(low, 5, 2)
ph2 = ta.pivothigh(2, 4)
pl2 = ta.pivotlow(close, 1, 1)
f(int n) =>
    ta.pivothigh(high, n, n)
plot(ph, "ph")
plot(pl, "pl")
plot(ph2, "ph2")
plot(pl2, "pl2")
plot(f(2), "fn")
`;
async function run(b, src){
  const r = await new pt.PineTS(b, 'X', '5').run(src);
  const out = {};
  for (const k of Object.keys(r.plots || {})) if (!k.startsWith('__')) out[k] = r.plots[k].data.map((d) => d.value);
  return out;
}
const same = (a, b) => JSON.stringify(a, (k, v) => (typeof v === 'number' && Number.isNaN(v) ? 'NaN' : v)) === JSON.stringify(b, (k, v) => (typeof v === 'number' && Number.isNaN(v) ? 'NaN' : v));

const b1 = bars(800, 7), b2 = bars(800, 99);
// flat stretches (equal highs) exercise the >= / <= edges
b2.forEach((x, i) => { if (i % 13 < 4) { x.high = 101; x.low = 99; } });
const before = [await run(b1, SRC), await run(b2, SRC)];
const tSlow = performance.now(); const slowBig = await run(bars(3000, 3), SRC); const slowMs = performance.now() - tSlow;

check(patches.install(pt.Context) === true, 'install() hooks Context.prototype.bindContextObject');
check(patches.install(pt.Context) === false, 'install() is idempotent');
const after = [await run(b1, SRC), await run(b2, SRC)];
const tFast = performance.now(); const fastBig = await run(bars(3000, 3), SRC); const fastMs = performance.now() - tFast;

const nonNa = (o) => Object.values(o).reduce((s, a) => s + a.filter((v) => typeof v === 'number' && !Number.isNaN(v)).length, 0);
check(nonNa(before[0]) > 50 && nonNa(before[1]) > 50, 'fixtures produce pivots (' + nonNa(before[0]) + ', ' + nonNa(before[1]) + ')');
check(same(before[0], after[0]), 'random walk: patched plots identical to pinets');
check(same(before[1], after[1]), 'flat stretches (ties): patched plots identical to pinets');
check(same(slowBig, fastBig), '3,000 bars: identical');
console.log('INFO 3,000 bars: pinets ' + slowMs.toFixed(0) + ' ms, patched ' + fastMs.toFixed(0) + ' ms');
check(fastMs < slowMs, 'patched is faster');
// direct unit cases
const P = patches.pivotAt;
check(P([1, 2, 5, 2, 1], 4, 2, 2, true) === 5, 'pivotAt: clear high');
check(P([1, 5, 5, 2, 1], 4, 2, 2, true) === 5, 'pivotAt: equal LEFT neighbour still a pivot (only a strictly higher one fails, as pinets)');
check(P([1, 2, 5, 5, 1], 4, 2, 2, true) !== 5, 'pivotAt: equal right neighbour fails (>=)');
check(P([5, 4, 1, 4, 5], 4, 2, 2, false) === 1, 'pivotAt: clear low');
check(Number.isNaN(P([1, 2, 5], 2, 2, 2, true)), 'pivotAt: not enough bars');
process.exit(fails ? 1 : 0);
