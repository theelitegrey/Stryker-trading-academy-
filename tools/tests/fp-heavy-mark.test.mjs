// node tools/tests/fp-heavy-mark.test.mjs: heavy BUY / SELL colours + optional marker (roadmap of-buy-sell-heavy). Sample data.
import assert from 'node:assert/strict';
const FD = await import('../../assets/chart-footprint-data.js');
// dot sits inside the cell, on the buy (right) or sell (left) edge
const b = FD.heavyDot(true, 100, 140, 10, 12), s = FD.heavyDot(false, 100, 140, 10, 12);
assert.ok(b.cx + b.r <= 140 && b.cx > 120 && b.cy === 16, JSON.stringify(b));
assert.ok(s.cx - s.r >= 100 && s.cx < 120 && s.cy === 16, JSON.stringify(s));
assert.equal(FD.heavyDot(true, 0, 40, 0, 3), null);    // row too short
assert.equal(FD.heavyDot(true, 0, 10, 0, 12), null);   // cell too narrow
// settings: heavy off and marker off by default; own buy / sell colours kept
globalThis.window = globalThis.window || {};
const F = await import('../../assets/chart-footprint.js');
{
  const d = F.fpConfig({});
  assert.equal(d.heavy, null); assert.equal(d.heavyMark, false);
  const on = F.fpConfig({ fpHeavy: 'avg', fpHeavyMark: true, fpHeavyBuyColor: '#112233', fpHeavySellColor: '#445566' });
  assert.equal(on.heavyMark, true); assert.equal(on.heavyBuyC, '#112233'); assert.equal(on.heavySellC, '#445566');
  assert.equal(F.fpConfig({ fpHeavy: 'avg', fpHeavyBuyColor: 'red' }).heavyBuyC, '#38bdf8');   // bad colour -> default
}
console.log('PASS fp-heavy-mark');
