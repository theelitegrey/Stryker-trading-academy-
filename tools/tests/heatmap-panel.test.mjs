// Maths of the Heatmap panel: stepper sizes and bounds, source tabs. node tools/tests/heatmap-panel.test.mjs
import assert from 'node:assert/strict';
import { stepOf, stepVal } from '../../assets/chart-heatmap-panel.js';
assert.equal(stepOf(0), 1);
assert.equal(stepOf(1000), 50);   // ~20 steps across the range, rounded to 1/2/5
assert.equal(stepOf(100), 5);
assert.equal(stepVal(0, -1, 1000), 0, 'never below 0');
assert.equal(stepVal(0, 1, 1000), 50);
assert.equal(stepVal(990, 1, 1000), 1000, 'never above the max');
assert.equal(stepVal(1000, 1, 1000), 1000);
console.log('heatmap-panel maths ok');
