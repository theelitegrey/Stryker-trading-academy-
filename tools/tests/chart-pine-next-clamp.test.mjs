// Unit test for clampRange() in assets/chart-pine-next.js (request.security warm-up limit).
//   node tools/tests/chart-pine-next-clamp.test.mjs
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { clampRange } = await import(pathToFileURL(path.join(here, '..', '..', 'assets', 'chart-pine-next.js')).href);
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const M = 6e4, first = 1.79e12;
const bars = Array.from({ length: 5000 }, (_, i) => ({ openTime: first + i * M }));
const span = 4999 * M;
const r1 = clampRange({ from: first - 33 * 864e5, to: first + span }, '1', bars);
check(r1.from === first - Math.max(span / 4, 300 * M), '1m chart, 33-day ask: clamped to a quarter of the chart span before the first bar');
check(r1.to === first + span, 'end of the range untouched');
const r2 = clampRange({ from: first - 60 * M, to: first + span }, '1', bars);
check(r2.from === first - 60 * M, 'short warm-up untouched');
const r3 = clampRange({ from: first - 365 * 864e5, to: first + span }, '60', bars);
check(r3.from === first - 300 * 36e5, '1h request: keeps 300 hourly bars of warm-up');
const r4 = clampRange({ from: first - 3e10, to: 1 }, 'D', []);
check(r4.from === first - 3e10, 'no chart bars: untouched');
check(clampRange(null, '1', bars) === null, 'no range: untouched');
process.exit(fails ? 1 : 0);
