// node tools/tests/tpo-singles-fill.test.mjs: TPO single prints "Extend until filled" (roadmap tpo-single-prints). Sample data.
import assert from 'node:assert/strict';
import { tpoProfile, tpoSingleRuns, firstTouch, firstFill } from '../../assets/chart-of-pro-data.js';
import { TPO_EXTRA_INPUTS, TPO_EXTRA_ROWS, SINGLE_EXT } from '../../assets/chart-tpo-extras.js';
const M = 60000, b = (i, lo, hi) => ({ time: i * 30 * M, low: lo, high: hi, open: lo, close: hi });
// Sample data: period A trades 100-102, B jumps 102-110 alone (single prints 103-108), C/D sit at 108-112.
const ses = [b(0, 100, 102), b(1, 100, 102), b(2, 102, 110), b(3, 108, 112), b(4, 108, 112)];
const p = tpoProfile(ses, { periodMs: 30 * M, row: 1, va: 70 });
const runs = tpoSingleRuns(p);
assert.equal(runs.length, 1); assert.ok(runs[0].lo >= 102 && runs[0].hi <= 109, JSON.stringify(runs[0]));
const { lo, hi } = runs[0];
// After the session: bar 0 dips into the top of the zone, bar 1 goes most of the way, bar 2 trades through the rest.
const after = [b(5, hi - 0.5, 111), b(6, lo + 1, 109), b(7, lo - 1, 105)];
const all = ses.concat(after);
assert.equal(firstTouch(all, ses.length, lo, hi), ses.length);        // touched at once
assert.equal(firstFill(all, ses.length, lo, hi), ses.length + 2);     // filled only when the low reaches lo
assert.equal(firstFill(all, ses.length, lo - 5, hi), -1);             // never filled: runs to the right edge
assert.equal(firstFill([], 0, 1, 2), -1);
// option: default 'touch' so saved charts do not change
const inp = TPO_EXTRA_INPUTS.find((x) => x.key === 'singlesExt'), row = TPO_EXTRA_ROWS.find((x) => x.key === 'singlesExt');
assert.equal(inp.defval, 'touch'); assert.equal(row.defval, 'touch'); assert.deepEqual(SINGLE_EXT, ['touch', 'filled', 'off']);
assert.equal(TPO_EXTRA_INPUTS.find((x) => x.key === 'singles').defval, false);
console.log('PASS tpo-singles-fill');
