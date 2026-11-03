// Auto Chart Patterns maths (assets/chart-patterns-data.js) on synthetic price series: one per pattern, plus noise that must give nothing.
//   node tools/tests/chart-patterns.test.mjs
import assert from 'node:assert/strict';
const D = await import('../../assets/chart-patterns-data.js');
let n = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? '' : ' ' + JSON.stringify(x))); n++; console.log('PASS ' + m); };
let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// piecewise-linear close path through [bar, price] points; every bar gets a small wick; a flat lead-in and tail of `tail` bars
function series(pts, o = {}) {
  const wick = o.wick == null ? 0.25 : o.wick, out = [];
  let prev = pts[0][1];
  for (let i = 0; i <= pts[pts.length - 1][0]; i++) {
    let k = 0; while (k < pts.length - 2 && pts[k + 1][0] < i) k++;
    const [a, pa] = pts[k], [b, pb] = pts[k + 1], v = pa + (pb - pa) * Math.min(1, Math.max(0, (i - a) / (b - a)));
    out.push({ time: 1e9 + i * 60, open: prev, high: Math.max(prev, v) + wick, low: Math.min(prev, v) - wick, close: v });
    prev = v;
  }
  out.push({ time: 1e9 + out.length * 60, open: prev, high: prev + wick, low: prev - wick, close: prev });   // the still-moving last bar
  return out;
}
const run = (bars, strength = 4) => new D.PatternEngine({ strength }).update(bars);
const has = (e, id, state) => [...e.done, ...e.open].some((x) => x.id === id && (!state || x.state === state));
const names = (e) => [...e.done, ...e.open].map((x) => x.id + ':' + x.state).join(',');

// double top: up, top 120, dip 100, top 120.5, break 100
let e = run(series([[0, 100], [10, 100], [30, 120], [45, 100], [60, 120.5], [75, 100], [85, 90], [95, 90]]));
ok(has(e, 'dtop', 'done'), 'double top completes on the close below the neckline', names(e));
const dt = e.done.find((x) => x.id === 'dtop');
ok(Math.abs(dt.target - (dt.level - dt.H)) < 1e-9 && dt.target < dt.level, 'double top measured move = neckline minus pattern height', [dt.level, dt.target]);
// forming: the second top is in but price has not broken
e = run(series([[0, 100], [10, 100], [30, 120], [45, 100], [60, 120.5], [66, 112], [70, 112]]));
ok(has(e, 'dtop', 'forming') && !has(e, 'dtop', 'done'), 'double top is "forming" before the break', names(e));
// double bottom
e = run(series([[0, 100], [10, 100], [30, 80], [45, 100], [60, 79.5], [75, 100], [85, 110], [95, 110]]));
ok(has(e, 'dbot', 'done'), 'double bottom completes', names(e));
// head and shoulders: neckline 100, shoulders 112, head 130
e = run(series([[0, 100], [8, 100], [20, 112], [32, 100], [48, 130], [64, 100], [76, 112], [88, 99], [100, 85], [108, 85]]));
ok(has(e, 'hs', 'done'), 'head and shoulders completes below the neckline', names(e));
const h = e.done.find((x) => x.id === 'hs');
ok(h && h.target < h.level && Math.abs(h.level - h.target - h.H) < 1e-9, 'H&S target = neckline minus head height', h && [h.level, h.target, h.H]);
e = run(series([[0, 100], [8, 100], [20, 88], [32, 100], [48, 70], [64, 100], [76, 88], [88, 101], [100, 115], [108, 115]]));
ok(has(e, 'ihs', 'done'), 'inverse head and shoulders completes above the neckline', names(e));
// ascending triangle: flat top 120, rising lows
e = run(series([[0, 100], [6, 100], [14, 120], [24, 102], [34, 120], [42, 110], [52, 120], [58, 116.5], [66, 120], [72, 125], [80, 135], [88, 135]]));
ok(has(e, 'atri', 'done') && e.done.find((x) => x.id === 'atri').dir === 1, 'ascending triangle breaks up', names(e));
// descending triangle: flat bottom 100, falling highs
e = run(series([[0, 120], [6, 120], [14, 100], [24, 118], [34, 100], [42, 110], [52, 100], [58, 103.5], [66, 100], [72, 95], [80, 85], [88, 85]]));
ok(has(e, 'dtri', 'done') && e.done.find((x) => x.id === 'dtri').dir === -1, 'descending triangle breaks down', names(e));
// symmetrical triangle
e = run(series([[0, 110], [6, 110], [14, 130], [24, 94], [34, 126], [44, 99], [52, 122], [58, 104], [64, 118], [70, 122], [78, 132], [86, 132]]));
ok(has(e, 'stri', 'done'), 'symmetrical triangle completes', names(e));
// rising wedge: both lines up, converging; breaks down
e = run(series([[0, 100], [6, 100], [14, 112], [22, 106], [32, 124], [40, 117], [50, 134], [56, 129], [64, 138], [70, 130], [76, 120], [84, 105], [92, 105]]));
ok(has(e, 'rwedge', 'done') && e.done.find((x) => x.id === 'rwedge').dir === -1, 'rising wedge breaks down', names(e));
// falling wedge: both lines down, converging; breaks up
e = run(series([[0, 140], [6, 140], [14, 128], [22, 134], [32, 116], [40, 123], [50, 106], [56, 111], [64, 102], [70, 108], [76, 120], [84, 135], [92, 135]]));
ok(has(e, 'fwedge', 'done') && e.done.find((x) => x.id === 'fwedge').dir === 1, 'falling wedge breaks up', names(e));
// bull flag: sharp pole 100 -> 140 in 8 bars, then a drifting-down channel, then up through the top
e = run(series([[0, 100], [10, 100], [18, 140], [27, 131], [36, 138], [45, 128], [54, 135], [63, 125], [68, 131], [74, 145], [82, 150], [90, 150]]));
ok(has(e, 'bflag', 'done'), 'bull flag completes up through the flag', names(e));
const bf = e.done.find((x) => x.id === 'bflag');
ok(bf && Math.abs(bf.target - bf.level - 40) < 1.5, 'bull flag target = breakout plus the pole', bf && [bf.level, bf.target]);
// bear flag
e = run(series([[0, 140], [10, 140], [18, 100], [27, 109], [36, 102], [45, 112], [54, 105], [63, 115], [68, 109], [74, 95], [82, 90], [90, 90]]));
ok(has(e, 'rflag', 'done'), 'bear flag completes down through the flag', names(e));
// channel: parallel, rising, long
e = run(series([[0, 100], [6, 100], [16, 112], [26, 104], [36, 120], [46, 112], [56, 128], [66, 120], [76, 136], [86, 128], [92, 150], [100, 150]]));
ok(has(e, 'chan', 'done') || has(e, 'chan', 'forming'), 'channel found', names(e));

// the same pattern must not appear twice for the same bars
const same = e.done.concat(e.open).filter((x, i, a) => a.findIndex((y) => y.id === x.id && y.start === x.start && y.end === x.end) !== i);
ok(same.length === 0, 'no duplicate shapes');

// noise around a level (no structure at all): nothing may be reported
const mk = (sd) => { seed = sd; const noise = [];
for (let i = 0; i < 5001; i++) { const c = 100 + (rnd() - 0.5) * 2, o = 100 + (rnd() - 0.5) * 2; noise.push({ time: 1e9 + i * 60, open: o, high: Math.max(o, c) + rnd() * 0.5, low: Math.min(o, c) - rnd() * 0.5, close: c }); }
return noise; };
const noise = mk(3);
for (const sd of [8, 21, 99]) { const x = run(mk(sd), 5); ok(x.done.length + x.open.length === 0, 'flat noise, seed ' + sd + ': zero patterns', names(x)); }
e = run(noise, 5);
ok(e.done.length + e.open.length === 0, 'flat noise (5,000 bars): zero patterns', names(e));
e = run(noise, 3);
ok(e.done.length + e.open.length === 0, 'flat noise at strength 3: zero patterns', names(e));

// speed + bounds on 5,000 random-walk bars; incremental update does not redo old bars
seed = 5;
const rw = []; let px = 1000;
for (let i = 0; i < 5001; i++) { const o = px; px += (rnd() - 0.5) * 6; rw.push({ time: 1e9 + i * 60, open: o, high: Math.max(o, px) + rnd() * 2, low: Math.min(o, px) - rnd() * 2, close: px }); }
const t0 = performance.now(); e = run(rw, 5); const ms = performance.now() - t0;
ok(ms < 400, 'random walk, 5,000 bars: full pass ' + ms.toFixed(0) + ' ms (limit 400)');
ok(e.piv.length <= e.o.maxPivots && e.open.length <= e.o.maxOpen && e.done.length <= e.o.maxDone, 'pivots / waiting / completed shapes stay bounded', [e.piv.length, e.open.length, e.done.length]);
console.log('INFO random walk: ' + e.done.length + ' completed, ' + e.open.length + ' forming in 5,000 bars');
const before = e.steps; rw.push({ time: 1e9 + rw.length * 60, open: px, high: px + 1, low: px - 1, close: px }); e.update(rw);
ok(e.steps - before === 1, 'one new bar = one step of work', e.steps - before);
const bigger = D.PatternEngine; const e2 = new bigger({ strength: 5 }); e2.update(rw.slice(0, 2000)); const s2 = e2.steps; e2.update(rw.slice(0, 2400));
ok(e2.steps - s2 === 400, 'a growing series only processes the new bars', e2.steps - s2);
// a different history (symbol change) resets
e2.update(noise.slice(0, 300));
ok(e2.cur === 299, 'changed history restarts the engine', e2.cur);
// view filters
e = run(series([[0, 100], [10, 100], [30, 120], [45, 100], [60, 120.5], [75, 100], [85, 90], [95, 90]]));
ok(e.view({ dtop: false }, true, 20).done.length === 0 && e.view(null, true, 20).done.length >= 1, 'pattern switches filter the view');
console.log('\n' + n + ' passed');
