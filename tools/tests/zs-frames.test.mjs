// Zscript: data hub frames (S3 shape) -> engine data (SPEC 11.3) -> script values.
//   node tools/tests/zs-frames.test.mjs
import { t, done, makeBars, assert, comp, run, Session } from './zs-helpers.mjs';
import { framesToData, liveData, rowsToBars } from '../../assets/zs/frames.js';

// same shape as S3's tools/fixtures/zs/zs-frames.sample.json (made-up round numbers, not market data)
const F1 = { book: { ts: 119000, mid: 100.125, bb: [[100, 5], [99.75, 7]], ba: [[100.25, 4], [100.5, 20]], heat: null },
  flow: { buy: 30, sell: 10, n: 12, cvd: 20, top: [9, 5, 2], fp: [[100, 4, 6], [100.25, 1, 9]], poc: 100.25, vah: 100.25, val: 100 },
  gex: { call: 110, put: 90, flip: 100, zu: 105, zl: 95, net: -3.5, lv: [100, 110], ts: 100 },
  opt: { nodes: [100, 110], ranges: { '0DTE': [98, 102], Weekly: [95, 105] }, ivrank: 42, pc: 0.9, maxpain: 100, zone: 'cushion', ts: 100 } };
const B = makeBars(2, 1, 60000, 0);
const frames = [[0, null], [60000, F1]];
const data = framesToData(frames, B.time);
const ALL = { book: true, flow: true, gex: true, opt: true };
const at1 = (body) => { const r = run(comp(body).program, { bars: B, timeframe: '1', allowed: ALL, data, symbol: { mintick: 0.25 } }); assert.ok(r.ok, r.error && r.error.message); return r.plots.map((p) => p.values[1]); };
const at0 = (body) => run(comp(body).program, { bars: B, timeframe: '1', allowed: ALL, data, symbol: { mintick: 0.25 } }).plots.map((p) => p.values[0]);

t('frames: namespaces present', () => assert.deepEqual(Object.keys(data).sort(), ['book', 'flow', 'gex', 'opt']));
t('frames: null frame -> na on that bar', () => assert.ok(at0('plot(book.bid())\nplot(flow.delta)\nplot(gex.flip)').every(Number.isNaN)));
t('frames: book levels (0 = best)', () => assert.deepEqual(at1('plot(book.bid())\nplot(book.ask())\nplot(book.bid(1))\nplot(book.asksize(1))'), [100, 100.25, 99.75, 20]));
t('frames: book.depth / imbalance', () => { const [d, im] = at1('plot(book.depth(book.side_ask, 2))\nplot(book.imbalance(2))'); assert.equal(d, 24); assert.ok(Math.abs(im - (12 - 24) / 36) < 1e-12); });
t('frames: book.wall', () => assert.deepEqual(at1('plot(book.wall(book.side_ask, 10))'), [100.5]));
t('frames: flow vars', () => assert.deepEqual(at1('plot(flow.buyvol)\nplot(flow.sellvol)\nplot(flow.delta)\nplot(flow.trades)\nplot(flow.cvd)'), [30, 10, 20, 12, 20]));
t('frames: flow poc/vah/val from hub', () => assert.deepEqual(at1('plot(flow.poc)\nplot(flow.vah)\nplot(flow.val)'), [100.25, 100.25, 100]));
t('frames: flow.footprint buy/sell/both', () => assert.deepEqual(at1('plot(flow.footprint(100))\nplot(flow.footprint(100, flow.side_buy))\nplot(flow.footprint(100.25, flow.side_sell))'), [10, 6, 1]));
t('frames: flow.bigtrades from top sizes', () => assert.deepEqual(at1('plot(flow.bigtrades(5))\nplot(flow.bigtrades_vol(5))'), [2, 14]));
t('frames: gex', () => assert.deepEqual(at1('plot(gex.callwall)\nplot(gex.putwall)\nplot(gex.flip)\nplot(gex.zero_upper)\nplot(gex.zero_lower)\nplot(gex.net)\nplot(gex.level(1))'), [110, 90, 100, 105, 95, -3.5, 110]));
t('frames: gex.updated seconds -> ms', () => assert.deepEqual(at1('plot(gex.updated)'), [100000]));
t('frames: opt', () => assert.deepEqual(at1('plot(opt.node(0))\nplot(opt.ivrank)\nplot(opt.pc)\nplot(opt.maxpain)'), [100, 42, 0.9, 100]));
t('frames: opt.range day / week', () => assert.deepEqual(at1('[a, b] = opt.range("day")\n[c, d] = opt.range("week")\nplot(a)\nplot(b)\nplot(c)\nplot(d)'), [98, 102, 95, 105]));
t('frames: opt.range missing kind na', () => assert.ok(Number.isNaN(at1('[a, b] = opt.range("month")\nplot(a)')[0])));
t('frames: opt.zone', () => { const r = run(comp('if barstate.islast\n    label.new(0, 0, opt.zone)\nplot(close)').program, { bars: B, timeframe: '1', allowed: ALL, data }); assert.equal(r.labels[0].text, 'cushion'); });
t('frames: heat grid read', () => {
  const f = JSON.parse(JSON.stringify(F1)); f.book.heat = { step: 0.25, i0: 396, v: [1, 2, 3, -4] };
  const d = framesToData([[60000, f]], B.time);
  const r = run(comp('plot(book.heat(99.75))\nplot(book.heat(200))').program, { bars: B, timeframe: '1', allowed: ALL, data: d });
  assert.deepEqual([r.plots[0].values[1], Number.isNaN(r.plots[1].values[1])], [4, true]);
});
t('frames: Map input', () => assert.deepEqual(Object.keys(framesToData(new Map(frames), B.time)).sort(), ['book', 'flow', 'gex', 'opt']));
t('frames: garbage is ignored', () => { const d = framesToData([[60000, { book: { bb: 'x', ba: [[1]] }, gex: 5, flow: { fp: 'no', top: [1, 'a'] }, opt: { ranges: { __proto__: { polluted: 1 } } } }], 'junk', [1]], B.time); const r = run(comp('plot(book.bid() + gex.flip + flow.footprint(1) + opt.node(0))').program, { bars: B, allowed: ALL, data: d }); assert.equal(r.ok, true); assert.equal(({}).polluted, undefined); });
t('frames: no data -> nothing', () => assert.deepEqual(framesToData([], B.time), {}));
t('frames: liveData shape', () => { const d = liveData(F1); assert.equal(d.flow.buyvol, 30); assert.equal(d.book.bids[0][0], 100); assert.equal(d.gex.flip, 100); });
t('frames: live update via liveData', () => {
  const p = comp('plot(flow.delta)\nplot(gex.flip)').program;
  const s = new Session(p, { timeframe: '1', allowed: ALL, data: framesToData([[0, F1]], [0]) });
  s.run({ time: [0], open: [1], high: [1], low: [1], close: [1], volume: [1] });
  const f2 = JSON.parse(JSON.stringify(F1)); f2.flow.buy = 50; f2.gex.flip = 101;
  const o = s.update({ time: 60000, open: 1, high: 1, low: 1, close: 1, volume: 1, data: liveData(f2) });
  assert.deepEqual([o.plots[0].values[1], o.plots[1].values[1]], [40, 101]);
});
t('frames: rowsToBars', () => { const b = rowsToBars([[0, 1, 2, 0.5, 1.5, 10], ['x'], [60000, 2, 3, 1, 2, 5]]); assert.deepEqual(b.time, [0, 60000]); assert.deepEqual(b.close, [1.5, 2]); });

done('zs-frames');
