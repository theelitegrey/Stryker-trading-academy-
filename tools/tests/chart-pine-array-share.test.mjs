// Unit test for shareArrayMethods (assets/chart-pine-next-patches.js): Pine arrays share one set of method closures
// per context instead of 43 fresh ones each (member GK, 20 Nov, high RAM). Same plots as plain pinets, fewer closures.
//   PINETS=/path/to/node_modules/pinets node tools/tests/chart-pine-array-share.test.mjs
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.PINETS) { console.log('SKIP: set PINETS=<path to node_modules/pinets>'); process.exit(0); }
const pt = await import(pathToFileURL(path.join(process.env.PINETS, 'dist', 'pinets.min.es.js')).href);
const patches = await import(pathToFileURL(path.join(here, '..', '..', 'assets', 'chart-pine-next-patches.js')).href);
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

const bars = Array.from({ length: 1500 }, (_, i) => { const c = 100 + Math.sin(i / 17) * 5 + Math.sin(i / 3.1); return { openTime: 1.7e12 + i * 6e4, closeTime: 1.7e12 + (i + 1) * 6e4, open: c - 0.3, high: c + 1, low: c - 1, close: c, volume: 100 + (i % 7) }; });
// arrays made every bar, copied, sliced, sorted, pushed/shifted, stats: the shapes the TradeZoro scripts use
const SRC = `//@version=6
indicator("arr", overlay=true)
var hist = array.new_float(0)
hist.push(close)
if hist.size() > 50
    hist.shift()
w = array.new_float(0)
for i = 0 to 9
    w.push(high[i] - low[i])
c = w.copy()
c.sort(order.descending)
s = hist.slice(0, math.min(10, hist.size()))
plot(w.avg(), "avg")
plot(c.get(0), "top")
plot(hist.stdev(), "sd")
plot(s.max() - s.min(), "rng")
plot(array.from(open, close).sum(), "sum")
plot(hist.percentrank(hist.size() - 1), "pr")
`;
const run = async () => { const r = await new pt.PineTS(bars, 'X', '1').run(SRC); const o = {}; for (const k of Object.keys(r.plots)) if (!k.startsWith('__')) o[k] = r.plots[k].data.map((d) => d.value); return o; };
const J = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' && Number.isNaN(v) ? 'NaN' : v));

const before = await run();
patches.install(pt.Context);
const after = await run();
check(Object.keys(before).length === 6 && before.avg.filter((v) => !Number.isNaN(v)).length > 1000, 'fixture plots something');
check(J(before) === J(after), 'plots identical with shared array methods');

// closures really shared: two arrays of one context hold the same function objects
const ctx = new pt.Context({ marketData: bars.slice(0, 5), source: 'X', tickerId: 'X', timeframe: '1' });
const a = ctx.pine.array.new_float(3, 1), b = ctx.pine.array.new_float(2, 2);
await Promise.resolve();
check(a._sum === b._sum && a._push === b._push, 'two arrays of one context share their method closures');
check(a.sum() === 3 && b.sum() === 4, 'shared methods act on their own array (3, 4)');
const c2 = a.copy(); c2.push(5); await Promise.resolve();
check(a.size() === 3 && c2.size() === 4 && c2._push === a._push, 'copy is independent, shares methods');
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
