// Delta bars (L2): minutes the trade store lacks come from the footprint feed. node tools/tests/delta-l2-fallback.test.mjs
import assert from 'node:assert/strict';
globalThis.window = globalThis.window || {}; globalThis.document = globalThis.document || { addEventListener() {}, hidden: false, documentElement: { getAttribute() {} } };
const { mergeMinutes } = await import('../../assets/chart-l2-flow.js');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };
const fp = [{ t: 60000, vol: 10, delta: 4, dmax: 5, dmin: -1 }, { t: 120000, vol: 6, delta: -2, dmax: 1, dmin: -3 }, { t: 180000, vol: 0, delta: 0, dmax: 0, dmin: 0 }];
const empty = mergeMinutes([], fp);
ok(empty.length === 2 && empty[0].buy === 7 && empty[0].sell === 3 && empty[1].buy === 2 && empty[1].sell === 4, 'empty trade store: minutes come from the footprint feed');
const ts = [{ t: 60000, buy: 1, sell: 1, hi: 1, lo: 0 }];
const m = mergeMinutes(ts, fp);
ok(m.length === 2 && m[0] === ts[0] && m[1].t === 120000, 'trade store wins where it has the minute; gaps are filled, sorted');
ok(mergeMinutes(ts, []) === ts && mergeMinutes([], null).length === 0, 'nothing to add: unchanged');
const rr = mergeMinutes(ts, fp, [{ t: 60000, buy: 9, sell: 9, hi: 0, lo: 0 }, { t: 240000, buy: 5, sell: 1, hi: 4, lo: 0 }]);
ok(rr.length === 3 && rr[0] === ts[0] && rr[1].t === 120000 && rr[2].t === 240000, 'recorder rows fill what is still missing, never override');
console.log(n + ' passed');
