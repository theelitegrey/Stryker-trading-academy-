// Maths of the Heatmap panel: stepper sizes and bounds, source tabs. node tools/tests/heatmap-panel.test.mjs
import assert from 'node:assert/strict';
import { stepOf, stepVal, sourcesFor, optNote } from '../../assets/chart-heatmap-panel.js';
assert.equal(stepOf(0), 1);
assert.equal(stepOf(1000), 50);   // ~20 steps across the range, rounded to 1/2/5
assert.equal(stepOf(100), 5);
assert.equal(stepVal(0, -1, 1000), 0, 'never below 0');
assert.equal(stepVal(0, 1, 1000), 50);
assert.equal(stepVal(990, 1, 1000), 1000, 'never above the max');
assert.equal(stepVal(1000, 1, 1000), 1000);
// Source tabs with the REAL chart symbol strings + what the chart's resolver returns for them (probed on charts.html 2026-11-11).
const SUP = new Set(['stk_depth_heat', 'stk_liq', 'stk_gexheat']);
const FUT = (t) => ({ provider: 'futures', ticker: t });
for (const [sym, r] of [['NQ1!', FUT('NQ1!')], ['CME:NQ1!', FUT('NQ1!')], ['futures:NQ1!', FUT('NQ1!')], ['ES1!', FUT('ES1!')], ['COMEX:GC1!', FUT('GC1!')], ['NYMEX:CL1!', FUT('CL1!')],
  ['YM1!', FUT('YM1!')], ['RTY1!', FUT('RTY1!')], ['MNQ1!', FUT('MNQ1!')], ['MES1!', FUT('MES1!')], ['MGC1!', FUT('MGC1!')], ['MCL1!', FUT('MCL1!')]]) {
  const i = sourcesFor(sym, SUP, true, r);
  assert.ok(i.fut && i.src.book.ok, sym + ': Order book enabled');
  assert.ok(!i.src.liq.ok, sym + ': no Liquidations');
}
assert.ok(!sourcesFor('SI1!', SUP, false, FUT('SI1!')).src.book.ok, 'silver has no L2 book');
assert.ok(!sourcesFor('SPY', SUP, true, { provider: 'idx', ticker: 'SPY' }).src.book.ok, 'SPY: no book');
assert.ok(sourcesFor('binance:BTCUSDT', SUP, false, { provider: 'binance', ticker: 'BTCUSDT' }).src.liq.ok, 'BTC: liquidations');
assert.ok(sourcesFor('futures:NQ1!', SUP, true).src.book.ok, 'no resolver: the prefix still works');
// Options note: only when nothing is in view
assert.equal(optNote({ cols: 40, text: 'GEX heatmap · NQ (from QQQ) 0DTE · updated 11 h ago' }), '');
assert.equal(optNote({ cols: 0, text: 'GEX heatmap · NQ (from QQQ) 0DTE · updated 11 h ago' }), 'Options data updates during US market hours; last update 11 h ago. Scroll back to that session to see the heatmap.');
assert.match(optNote({ cols: 0, text: 'GEX heatmap · SPX 0DTE · live' }), /GEX live/);
assert.equal(optNote({ cols: 0, text: 'Loading GEX heatmap…' }), '');
assert.ok(!/delayed|behind|real-time/i.test(optNote({ cols: 0, text: 'x · updated 3 min ago' })));
console.log('heatmap-panel maths + sources ok');
