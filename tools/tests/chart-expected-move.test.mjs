// Pure parts of assets/chart-expected-move.js.  node tools/tests/chart-expected-move.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.window = globalThis.window || {};
const M = await import('../../assets/chart-expected-move.js');
const SPX = JSON.parse(fs.readFileSync(new URL('./fixtures/opt-analytics-SPX.json', import.meta.url)));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };

ok(M.emSource('futures:ES1!').u === 'SPX' && M.emSource('futures:ES1!').fut === 'ES', 'ES -> SPX / ES');
ok(M.emSource('futures:MNQ1!').u === 'QQQ' && M.emSource('futures:MNQ1!').pro, 'MNQ -> QQQ, Pro');
ok(M.emSource('futures:GC1!') === null, 'GC -> none');
ok(M.emSource('binance:BTCUSDT') === null, 'BTC -> none');
ok(M.emSource('SPY').u === 'SPY' && M.emSource('SPY').fut === null, 'SPY spot');

const src = M.emSource('futures:ES1!');
let r = M.buildRanges(SPX, src, { expiry: '0DTE' });
const e0 = SPX.em.find((x) => x.k === '0DTE');
ok(r.ranges.length === 1 && r.ranges[0].lo === e0.fut.lo && r.ranges[0].hi === e0.fut.hi, 'ES 0DTE uses the futures range');
r = M.buildRanges(SPX, M.emSource('SPX'), { expiry: '1DTE' });
ok(r.ranges[0].lo === SPX.em.find((x) => x.k === '1DTE').lo, 'SPX 1DTE uses the index range');
r = M.buildRanges(SPX, src, { showAll: true });
ok(r.ranges.length === new Set(SPX.em.map((x) => x.x)).size, 'show all: one range per distinct expiry');
ok(r.ranges.some((x) => x.k === 'Weekly / Monthly'), 'Weekly + Monthly same day merged');
ok(M.buildRanges({ em: [] }, src, {}).err, 'no data -> err');
ok(/No Monthly/.test(M.buildRanges({ em: [e0] }, src, { expiry: 'Monthly' }).err), 'missing expiry -> err text');
ok(M.buildRanges({ em: [Object.assign({}, e0, { fut: { root: 'NQ', lo: 1, hi: 2, em: 1, c: 1 } })] }, src, {}).err, 'wrong futures root -> not drawn');
ok(M.agoText(1000, 1000 * 1000 + 7 * 60000) === 'updated 7 min ago', 'agoText minutes');
ok(!/live|real-time|delayed|behind/i.test(M.agoText(1, 5e12)), 'agoText never uses banned words');
console.log(n + ' passed');
