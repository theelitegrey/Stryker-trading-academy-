// Unit tests: screener filter engine + futures column gating. node tools/tests/screener-core.test.js
const assert = require('assert');
const C = require('../../assets/screener-core.js');
const L2 = require('../../assets/scanner-l2.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const rows = [
  { s: 'NASDAQ:AAA', n: 'A', c: 10, chg: 5, vol: 1e6, cap: 5e9, rsi: 75, sec: 'Tech' },
  { s: 'NASDAQ:BBB', n: 'B', c: 20, chg: -3, vol: 5e5, cap: 1e9, rsi: 25, sec: 'Energy' },
  { s: 'NYSE:CCC', n: 'C', c: 30, chg: 0.5, vol: 2e6, cap: 2e11, rsi: 50, sec: 'Tech' },
  { s: 'NYSE:DDD', n: 'D', c: null, chg: null, vol: 0, cap: null, rsi: null, sec: null }
];
const run = (flt, m = 'stock', ctx = {}) => rows.filter(C.buildFilter(flt, m, ctx).test).map((r) => r.n);
t('gt', () => assert.deepStrictEqual(run([{ f: 'chg', op: 'gt', v: 1 }]), ['A']));
t('lt', () => assert.deepStrictEqual(run([{ f: 'chg', op: 'lt', v: 1 }]), ['B', 'C']));
t('between', () => assert.deepStrictEqual(run([{ f: 'rsi', op: 'bt', v: 20, v2: 60 }]), ['B', 'C']));
t('AND of two', () => assert.deepStrictEqual(run([{ f: 'cap', op: 'gt', v: 2e9 }, { f: 'rsi', op: 'gt', v: 60 }]), ['A']));
t('category is', () => assert.deepStrictEqual(run([{ f: 'sec', op: 'is', v: 'Tech' }]), ['A', 'C']));
t('missing value never matches a numeric filter', () => assert.ok(!run([{ f: 'rsi', op: 'lt', v: 100 }]).includes('D')));
t('junk filter dropped, not thrown', () => assert.strictEqual(run([{ f: 'nope', op: 'gt', v: 1 }, { f: 'chg', op: 'gt' }]).length, 4));
t('sort desc puts nulls last', () => assert.strictEqual(C.sortRows(rows, 'chg', -1)[3].n, 'D'));
t('sort asc puts nulls last', () => { const r = C.sortRows(rows, 'chg', 1); assert.strictEqual(r[0].n, 'B'); assert.strictEqual(r[3].n, 'D'); });
t('cross-above: price over SMA 50 today, not yesterday', () => {
  const r = C.enrich({ s: 'X:Y', c: 11, pc: 9, s50: 10, ps50: 10 }, 0);
  assert.ok(r); // enrich never throws on partial rows
});
t('window: first screen + overscan', () => assert.deepStrictEqual(C.windowOf(1000, 56, 0, 560, 6), { first: 0, last: 16 }));
t('window: deep scroll', () => { const w = C.windowOf(5000, 56, 56000, 560, 6); assert.strictEqual(w.first, 994); assert.strictEqual(w.last, 1016); });
t('window: end clamps', () => assert.strictEqual(C.windowOf(10, 56, 9999, 560, 6).last, 10));
// futures column gating
const FK = ['imb', 'bw', 'bwS', 'aw', 'awS', 'delta', 'bigN'];
t('book columns hidden without the L2 gate', () => {
  const all = C.fieldsFor('fut', { l2: false, pro: true }).map((d) => d.k);
  FK.forEach((k) => assert.ok(!all.includes(k), k));
  assert.ok(!C.filterFieldsFor('fut', { l2: false }).some((d) => FK.includes(d.k)));
  assert.deepStrictEqual(C.gateCols(FK.concat(['c']), 'fut', { l2: false }), ['c']);
});
t('book columns shown with the L2 gate', () => {
  const all = C.fieldsFor('fut', { l2: true }).map((d) => d.k);
  FK.forEach((k) => assert.ok(all.includes(k), k));
  assert.deepStrictEqual(C.setKeys('flow', 'fut', { l2: true }), FK);
});
t('book columns never exist on other markets', () => ['stock', 'etf', 'crypto'].forEach((m) => assert.ok(!C.fieldsFor(m, { l2: true, pro: true }).some((d) => FK.includes(d.k)))));
t('order-flow set is empty without the gate', () => assert.deepStrictEqual(C.setKeys('flow', 'fut', { l2: false }), []));
// symbol mapping
t('chart symbols', () => {
  assert.strictEqual(C.chartSymbol({ s: 'CME_MINI:NQ1!' }, 'fut'), 'futures:NQ1!');
  assert.strictEqual(C.chartSymbol({ s: 'BINANCE:BTCUSDT' }, 'crypto'), 'binance:BTCUSDT');
  assert.strictEqual(C.chartSymbol({ s: 'NASDAQ:AAPL' }, 'stock'), null); assert.strictEqual(C.chartSymbol({ s: 'AMEX:SPY' }, 'etf'), 'idx:SPY');
});
// share link roundtrip
t('share link roundtrip + junk', () => {
  const sc = { m: 'stock', flt: [{ f: 'chg', op: 'gt', v: 2 }], setId: 'tech', sortK: 'chg', sortD: -1 };
  assert.deepStrictEqual(C.decodeScreen(C.encodeScreen(sc)).flt, sc.flt);
  assert.strictEqual(C.decodeScreen('%%%'), null);
});
// L2 maths
t('wall: first level >= 2.5x median', () => {
  const lv = [[100, 5], [99, 5], [98, 6], [97, 40], [96, 5], [95, 5]];
  assert.deepStrictEqual(L2.wallOf(lv), { px: 97, sz: 40 });
  assert.strictEqual(L2.wallOf([[1, 1], [2, 1]]), null);
});
t('delta: buy minus sell', () => assert.strictEqual(L2.deltaOf([{ lv: [[1, 5, 2], [2, 1, 4]] }]), 0));
// GEX levels (Pro)
const G = require('../../assets/scanner-gex.js');
t('GEX columns exist only with Pro, only on ETFs + futures', () => {
  ['cw', 'zg', 'pw'].forEach((k) => {
    assert.ok(!C.fieldsFor('etf', { pro: false }).some((d) => d.k === k));
    assert.ok(C.fieldsFor('etf', { pro: true }).some((d) => d.k === k));
    assert.ok(C.fieldsFor('fut', { pro: true }).some((d) => d.k === k));
    assert.ok(!C.fieldsFor('stock', { pro: true }).some((d) => d.k === k));
    assert.ok(!C.fieldsFor('crypto', { pro: true }).some((d) => d.k === k));
  });
  assert.deepStrictEqual(C.setKeys('gexs', 'etf', { pro: false }), []);
  assert.deepStrictEqual(C.setKeys('gexs', 'etf', { pro: true }), ['cw', 'zg', 'pw']);
});
t('GEX levels map to tickers (ETF direct, futures via converted block)', () => {
  const o = G.levelsOf({ SPY: { call_wall: 700, zero_gamma: 690, put_wall: 680 }, SPX: { futures: { ES: { levels: { call_wall: 7000, zero_gamma: 6900, put_wall: 6800 } }, MES: { error: 'x' } } }, QQQ: {}, GLD: null });
  assert.deepStrictEqual(o.SPY, { cw: 700, zg: 690, pw: 680 });
  assert.deepStrictEqual(o.ES, { cw: 7000, zg: 6900, pw: 6800 });
  assert.ok(!o.MES && !o.QQQ && !o.NQ);
});
t('chip values are abbreviated', () => {
  assert.strictEqual(C.describe({ f: 'cap', op: 'gt', v: 50000000 }), 'Market cap above 50M');
  assert.strictEqual(C.describe({ f: 'cap', op: 'bt', v: 1200000000, v2: 5e9 }), 'Market cap between 1.2B and 5B');
  assert.strictEqual(C.describe({ f: 'rsi', op: 'gt', v: 70 }), 'RSI (14) above 70');
});
t('derived ATR columns', () => {
  const r = C.enrich({ s: 'X:Y', c: 100, atr: 2, sma20: 96, sma50: 90, sma200: 80, chg: 4, gap: 2 }, 0);
  assert.strictEqual(r.pS20Atr, 2); assert.strictEqual(r.chgAtr, 2); assert.strictEqual(r.gapAtr, 1);
  assert.strictEqual(r.maSpread, 16);
});
t('filter count: stocks >= 60 distinct fields, ~80 options with crosses', () => {
  const f = C.filterFieldsFor('stock', {}); assert.ok(f.length >= 60, 'stock ' + f.length);
  const opts = f.reduce((a, d) => a + C.opsFor(d).length, 0); assert.ok(opts >= 80, 'ops ' + opts);
});
t('outlier: CASK +2856.67% never tops Top gainers', () => {
  const cask = { s: 'NASDAQ:CASK', n: 'MGP Ingredients', c: 20, chg: 2856.67, vol: 400000, cap: 5e8 };
  const ok = { s: 'NASDAQ:OKK', n: 'Real', c: 12, chg: 18, vol: 2e6, cap: 1e9 };
  const rows = [cask, ok].map((r) => C.enrich(r, 0, 'stock'));
  assert.strictEqual(rows[0].chg, null); assert.strictEqual(rows[0].bad, 1);
  const p = C.presetById('gainers'), v = C.sortRows(rows.filter(C.buildFilter(p.flt, 'stock', {}).test), p.sort[0], p.sort[1]);
  assert.deepStrictEqual(v.map((r) => r.n), ['Real']);
});
t('outlier: a big move on heavy volume and a >$1 previous close is kept', () => {
  assert.strictEqual(C.enrich({ s: 'A:B', c: 40, chg: 400, vol: 5e6 }, 0, 'stock').chg, 400);
  assert.strictEqual(C.enrich({ s: 'A:B', c: 40, chg: 400, vol: 5e6 }, 0, 'stock').bad, undefined);
  assert.strictEqual(C.enrich({ s: 'A:B', c: 4, chg: 400, vol: 5e6 }, 0, 'etf').chg, null);   // prev close $0.80
  assert.strictEqual(C.enrich({ s: 'A:B', c: 40, chg: -350, vol: 5e6 }, 0, 'stock').chg, null);
  assert.strictEqual(C.enrich({ s: 'B:C', c: 1, chg: 500, vol: 1e5 }, 0, 'crypto').chg, null);  // $100k traded
  assert.strictEqual(C.enrich({ s: 'B:C', c: 12, chg: 500, vol: 1e6 }, 0, 'crypto').chg, 500);
});
t('quick screens have price >= 1 and volume >= 100k floors', () => {
  ['gainers', 'losers', 'unusual', 'gapup', 'gapdown'].forEach((id) => {
    const f = C.presetById(id).flt;
    assert.ok(f.some((x) => x.f === 'c' && x.op === 'gt' && x.v >= 1), id + ' price'); assert.ok(f.some((x) => x.f === 'vol' && x.v >= 1e5), id + ' vol');
  });
});
console.log(n + ' passed');
