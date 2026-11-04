// Unit test: shared heatmap filter (assets/chart-heat-filter.js). node tools/tests/heat-filter.test.mjs
import assert from 'assert';
import { hfConfig, hfSize, hfCut, hfOptions, hfSchema, HF_TABLES } from '../../assets/chart-heat-filter.js';
assert.deepEqual(hfOptions('midnight'), ['All', 'Blue and above', 'Cyan and above', 'Green and above', 'Yellow and above', 'Orange and above', 'Red only']);
const off = hfConfig({}, 'midnight');
assert.equal(off.on, false); assert.equal(off.key, ''); assert.ok(hfSize(off, 0.001) && hfSize(off, 1e9));       // default = nothing hidden
const y = hfConfig({ hfStep_midnight: 'Yellow and above' }, 'midnight');
assert.equal(y.p, 0.74); assert.ok(y.on); assert.equal(hfConfig({ hfStep_midnight: 'Red only' }, 'midnight').p, 0.93);
assert.equal(hfConfig({ hfStep_midnight: 'bogus' }, 'midnight').p, 0);
const mm = hfConfig({ hfMin: 50, hfMax: 500 });
assert.ok(!hfSize(mm, 49.9) && hfSize(mm, 50) && hfSize(mm, 500) && !hfSize(mm, 500.1));                   // min and max
assert.equal(hfConfig({ hfMin: -5, hfMax: 'x', hfTop: 2.9 }).min, 0); assert.equal(hfConfig({ hfTop: 2.9 }).top, 2);
const sc = new Float64Array(16), col = [5, -40, 0, 30, -40, 10];
assert.equal(hfCut(2, col, col.length, sc), 40);                    // top 2 = the two 40s (ties stay)
assert.equal(hfCut(3, col, col.length, sc), 30);
assert.equal(hfCut(9, col, col.length, sc), 0);                     // N >= levels: nothing hidden
for (const t of Object.keys(HF_TABLES)) { const p = HF_TABLES[t].map((s) => s[1]); assert.deepEqual(p, [...p].sort((a, b) => a - b)); }   // steps ascend
const sch = hfSchema('contracts', [{ table: 'midnight', when: { key: 'look', anyOf: ['Midnight'] } }]);
assert.ok(sch.every((x) => x.group === 'Filter') && sch.length === 4 && sch[1].title.includes('contracts'));
console.log('heat-filter unit OK');
