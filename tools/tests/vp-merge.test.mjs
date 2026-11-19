// node tools/tests/vp-merge.test.mjs: "Merge nearby profiles" for Session Volume Profile + Market Profile (TPO). Roadmap vp-combine-near.
// Sample data only.
import assert from 'node:assert/strict';
globalThis.window = globalThis.window || { addEventListener() {}, location: { search: '' } };
const { vaOverlap, mergeGroups, mergeOpts, MERGE_INPUTS } = await import('../../assets/chart-vp-merge.js');

// overlap = share of the smaller value area covered
assert.equal(vaOverlap([0, 10], [5, 15]), 0.5);
assert.equal(vaOverlap([0, 10], [2, 4]), 1);
assert.equal(vaOverlap([0, 10], [11, 20]), 0);
assert.equal(vaOverlap(null, [0, 1]), 0);
// overlap mode: 0-1 overlap 50 %, 1-2 none, 2-3 80 %
const VA = [[0, 10], [5, 15], [20, 30], [22, 32]];
assert.deepEqual(mergeGroups(4, { mode: 'overlap', pct: 50 }, (k) => VA[k]), [[0, 1], [2, 3]]);
assert.deepEqual(mergeGroups(4, { mode: 'overlap', pct: 60 }, (k) => VA[k]), [[0], [1], [2, 3]]);
assert.deepEqual(mergeGroups(4, { mode: 'off' }, (k) => VA[k]), [[0], [1], [2], [3]]);
// count mode: the newest block is full, the oldest takes the remainder
assert.deepEqual(mergeGroups(5, { mode: 'count', count: 2 }, () => null), [[0], [1, 2], [3, 4]]);
assert.deepEqual(mergeGroups(3, { mode: 'count', count: 5 }, () => null), [[0, 1, 2]]);
// default off, so saved charts do not change
assert.deepEqual(mergeOpts({}), { mode: 'off', pct: 50, count: 2 });
assert.equal(MERGE_INPUTS[0].defval, 'off');

// SVP: merged profile has its own POC / VAH / VAL built from both sessions' bars
const { mergeSvp, volumeProfile } = await import('../../assets/chart-orderflow.js');
const bar = (t, lo, hi, v) => ({ time: t, low: lo, high: hi, open: lo, close: hi, volume: v });
const A = [bar(1, 100, 104, 50), bar(2, 101, 103, 80)], B = [bar(3, 102, 106, 60), bar(4, 103, 105, 90)], C = [bar(5, 200, 204, 40)];
const ses = [A, B, C].map((span, k) => ({ key: 'k' + k, i0: k * 2, i1: k * 2 + span.length - 1, t0: span[0].time, t1: span[span.length - 1].time, prof: volumeProfile(span, 1, 0.7), span }));
const cfg = { merge: { mode: 'overlap', pct: 30, count: 2 }, va: 0.7, futures: true, tick: 0.25, rows: 40 };
const out = mergeSvp(ses, cfg, {});
assert.equal(out.length, 2); assert.equal(out[0].merged, 2); assert.equal(out[1], ses[2]);
const both = volumeProfile(A.concat(B), 1, 0.7);
assert.equal(out[0].prof.poc, both.poc); assert.equal(out[0].prof.vah, both.vah); assert.equal(out[0].prof.val, both.val);
assert.equal(out[0].t0, 1); assert.equal(out[0].t1, 4);
assert.equal(mergeSvp(ses, { merge: { mode: 'off' } }, {}), ses);   // off: the same list, untouched

// TPO: sessions grouped by count
const { mergeTpoSessions } = await import('../../assets/chart-of-pro.js');
const tb = Array.from({ length: 6 }, (_, i) => ({ time: i * 1800000, low: 100 + i, high: 104 + i, open: 100, close: 101 }));
const list = [{ k: 'a', i0: 0, i1: 1 }, { k: 'b', i0: 2, i1: 3 }, { k: 'c', i0: 4, i1: 5 }];
const tm = mergeTpoSessions(list, tb, { mergeMode: 'count', mergeCount: 2, period: 30, va: 70 }, 0.25);
assert.deepEqual(tm.map((s) => [s.i0, s.i1, s.merged || 1]), [[0, 1, 1], [2, 5, 2]]);
assert.equal(mergeTpoSessions(list, tb, {}, 0.25), list);
const to = mergeTpoSessions(list, tb, { mergeMode: 'overlap', mergePct: 10, period: 30, va: 70 }, 0.25);
assert.equal(to.length, 1); assert.equal(to[0].merged, 3);
console.log('PASS vp-merge');
