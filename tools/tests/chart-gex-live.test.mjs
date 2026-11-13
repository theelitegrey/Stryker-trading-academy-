// Live overnight levels + HOD/LOD maths of the GEX Levels indicator. Pure node:  node tools/tests/chart-gex-live.test.mjs
import assert from 'node:assert/strict';
import { runningHiLo, liveOvernight, dayHiLo, buildLevels } from '../../assets/chart-gex-levels.js';
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
// bar at New York wall time (EST = UTC-5 in November, EDT = UTC-4 in July)
const et = (md, h, m, off = 5) => Date.UTC(2026, +md.split('-')[0] - 1, +md.split('-')[1], h + off, m);
const bar = (t, hi, lo) => ({ time: t, open: lo, high: hi, low: lo, close: hi });
// Wed 11 Nov RTH, then Wed evening, Thu overnight
const bars = [bar(et('11-11', 10, 0), 120, 100), bar(et('11-11', 15, 55), 110, 105),
  bar(et('11-11', 16, 0), 108, 104), bar(et('11-11', 18, 0), 109, 103), bar(et('11-11', 23, 0), 112, 101), bar(et('11-12', 3, 0), 111, 107)];
let r = liveOvernight(bars, '5');
ok(r && r.hi === 112 && r.lo === 101 && r.n === 4, 'overnight at 03:00 = since 16:00 yesterday, RTH bars excluded');
ok(liveOvernight(bars.slice(0, 2), '5') === null, 'last bar 15:55 = not overnight: API fixed levels are used');
ok(liveOvernight(bars.concat(bar(et('11-12', 9, 30), 130, 90)), '5') === null, '09:30 bar = overnight closed');
r = liveOvernight(bars.concat(bar(et('11-12', 9, 25), 113, 99)), '5');
ok(r.hi === 113 && r.lo === 99, 'new high/low arriving moves the running level (09:25 bar)');
// day roll: new overnight session starts at 16:00 and forgets the previous one
r = liveOvernight(bars.concat(bar(et('11-12', 16, 5), 200, 190)), '5');
ok(r.hi === 200 && r.lo === 190 && r.n === 1, 'day roll: 16:05 starts a fresh session');
// trading day (18:00 start)
r = dayHiLo(bars, '5');
ok(r.hi === 112 && r.lo === 101 && r.n === 3, 'HOD/LOD at Thu 03:00 = since Wed 18:00');
r = dayHiLo(bars.slice(0, 4), '5');
ok(r.n === 1 && r.hi === 109 && r.lo === 103, 'HOD/LOD one bar after 18:00');
ok(dayHiLo(bars.slice(0, 3), '5').n === 3 - 0 && dayHiLo(bars.slice(0, 3), '5').hi === 120, 'before 18:00 the day started yesterday 18:00 (all bars so far)');
r = dayHiLo(bars.concat(bar(et('11-12', 17, 59), 300, 50), bar(et('11-12', 18, 0), 150, 140)), '5');
ok(r.hi === 150 && r.lo === 140 && r.n === 1, 'day roll at 18:00 sharp');
// summer time
const s = [bar(et('07-14', 17, 0, 4), 10, 9), bar(et('07-15', 2, 0, 4), 12, 8), bar(et('07-15', 9, 29, 4), 11, 7)];
r = liveOvernight(s, '1');
ok(r.hi === 12 && r.lo === 7 && r.n === 3, 'EDT (summer) handled');
// weekend gap: Fri 16:59 -> Sun 18:00 are different sessions
ok(runningHiLo([bar(et('11-13', 16, 59), 5, 4), bar(et('11-15', 18, 0), 9, 8)], 18 * 60).n === 1, 'weekend gap: Sunday open starts a new day');
ok(liveOvernight(bars, '1D') === null && dayHiLo(bars, 'W') === null, 'daily+ charts: off');
ok(runningHiLo([], 960) === null, 'no bars');
// buildLevels: default unchanged, live replaces ONH/ONL with (live) labels, HOD/LOD added only when on
const data = { spot: 100, futures: { ES: { ratio: 1, basis: 0, levels: {} } }, session: { ES: { overnight_high: 50, overnight_low: 40, prior_vah: 1 } } };
const src = { fut: 'ES', api: 'SPX' };
const run = { on: { hi: 112, lo: 101 }, day: { hi: 120, lo: 99 } };
const ids = (o) => buildLevels(data, src, o, 0, { run }).lines.map((l) => l.id + ':' + l.label + ':' + l.price).join(' ');
ok(/onh:ONH:50 /.test(ids({}) + ' ') && !/hod|live/.test(ids({})), 'default: fixed ONH/ONL from API, no HOD/LOD');
ok(/onh:ONH \(live\):112/.test(ids({ liveOvernight: true })) && /onl:ONL \(live\):101/.test(ids({ liveOvernight: true })), 'live on: ONH (live)/ONL (live)');
ok(/onh:ONH:50/.test(buildLevels(data, src, { liveOvernight: true }, 0, { run: { on: null, day: null } }).lines.map((l) => l.id + ':' + l.label + ':' + l.price).join(' ')), 'session closed (no live): back to fixed levels');
ok(/hod:HOD:120/.test(ids({ showHod: true })) && !/lod/.test(ids({ showHod: true })) && /lod:LOD:99/.test(ids({ showLod: true })), 'HOD / LOD toggles are separate');
ok(!/hod|live/.test(buildLevels(data, { api: 'SPX' }, { liveOvernight: true, showHod: true }, 0, { run }).lines.map((l) => l.id + l.label).join(' ')), 'non-futures source: unchanged');
console.log(n + ' passed');
