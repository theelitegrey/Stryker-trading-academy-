// Footprint auto text size + stats-table row toggles (pure parts). node tools/tests/fp-autotext.test.mjs
import assert from 'node:assert/strict';
import { autoFont, tableRowsFor } from '../../assets/chart-footprint.js';
const cfg = { autoMin: 8, autoMax: 14 };
assert.equal(autoFont(cfg, 0, 100), 8); assert.equal(autoFont(cfg, 100, 100), 14); assert.equal(autoFont(cfg, 500, 100), 14);   // limits hold
assert.equal(autoFont(cfg, 25, 100), 11); assert.ok(autoFont(cfg, 10, 100) < autoFont(cfg, 60, 100));                          // grows with volume
assert.equal(autoFont(cfg, 5, 0), 14); assert.equal(autoFont({ autoMin: 14, autoMax: 8 }, 100, 100), 14);                     // no volume reference / swapped limits
const names = (h, ph) => tableRowsFor([{ trades: 1 }], ph, h).map((r) => r[0]).join();
assert.equal(names(undefined, false), 'vol,delta,dpct,buy,sell,trd');   // default = all rows, as before
assert.equal(names([], false), 'vol,delta,dpct,buy,sell,trd');
assert.equal(names(['buy', 'sell'], false), 'vol,delta,dpct,trd');
assert.equal(names(['buy', 'sell'], true), 'vol,delta');
console.log('ALL PASS');
