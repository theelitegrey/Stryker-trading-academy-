// node tools/tests/tpo-pin.test.mjs: Market Profile (TPO) "Always visible" (roadmap vp-always-visible). Sample data.
import assert from 'node:assert/strict';
globalThis.window = globalThis.window || {};
const { tpoPins } = await import('../../assets/chart-of-pro.js');
const W = 1000, xs = (s) => [s.a, s.b];
const L1 = { a: -600, b: -300 }, R1 = { a: 1200, b: 1500 };
// next session starts far right: the left one is pinned at the left edge, width capped to the steady TPO width
let m = tpoPins([L1, { a: 400, b: 700 }, R1], xs, W, false);
assert.deepEqual(m.get(L1), [8, 140]); assert.deepEqual(m.get(R1), [W - 4 - 300, W - 4]);
// next session already sits at the left edge: no left pin (it would cover that session)
m = tpoPins([L1, { a: 20, b: 700 }], xs, W, false);
assert.ok(!m.has(L1));
// all on screen: nothing pinned
assert.equal(tpoPins([{ a: 10, b: 200 }], xs, W, false).size, 0);
console.log('PASS tpo-pin');
