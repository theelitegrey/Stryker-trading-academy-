// Book · DOM · Trades panel logic.  node tools/tests/book-panel-core.test.mjs
import assert from 'node:assert/strict';
import * as C from '../../assets/book-panel-core.js';
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const bk = (b, a) => ({ bids: new Map(b), asks: new Map(a) });

// book merge: sizes added up per bucket; bids floor, asks ceil (never crossed)
const A = bk([[100.4, 1], [99.9, 2]], [[100.6, 3], [101.2, 1]]), B = bk([[100.1, 4], [99.2, 1]], [[100.9, 2]]);
const m = C.mergeBooks([A, B], 1, 10);
assert.deepEqual(m.bids, [[100, 5], [99, 3]]); ok('bids merge: floor to bucket, sizes added (100.4 + 100.1 -> 100: 5; 99.9 + 99.2 -> 99: 3)');
assert.deepEqual(m.asks, [[101, 5], [102, 1]]); ok('asks merge: ceil to bucket, sizes added (100.6 + 100.9 -> 101: 5)');
assert.ok(m.bids[0][0] < m.asks[0][0]); ok('merged touch never crosses');
assert.deepEqual(C.mergeBooks([A, null], 1, 1).bids, [[100, 1]]); ok('null (unlisted) exchange skipped; maxLevels cuts');
assert.deepEqual(C.mergeBooks([bk([[1.1, 0]], [])], 1).bids, []); ok('zero size ignored');

// book tab: running totals + spread bps
const bm = C.bookModel(C.mergeBooks([bk([[99, 2], [98, 3]], [[101, 1], [102, 4]])], 1), 5);
assert.deepEqual(bm.bids.map((x) => x.t), [2, 5]); assert.deepEqual(bm.asks.map((x) => x.t), [5, 1]);  // asks far -> near
assert.equal(bm.spread, 2); assert.equal(Math.round(bm.bps), 200); assert.equal(bm.maxT, 5); ok('book model: totals accumulate from the touch, spread 2 = 200 bps at mid 100');
assert.equal(C.bookModel({ bids: [], asks: [[1, 1]] }, 5), null); ok('one-sided book -> null');

// bought / sold / delta per price
const S = new C.TradeStore();
S.add([{ t: 1000, p: 100.1, s: 2, side: 1 }, { t: 2000, p: 100.4, s: 1, side: -1 }, { t: 3000, p: 100.2, s: 5, side: 1 }, { t: 500, p: 99.8, s: 7, side: -1 }]);
assert.deepEqual(S.ring.map((x) => x.t), [500, 1000, 2000, 3000]); ok('trades kept sorted by time even when delivered late');
const at = S.atPrice(0, 0.5, 3000);   // step 0.5: 100.1 -> 100; 100.4 -> 100.5; 100.2 -> 100; 99.8 -> 100
assert.deepEqual(at.get(200), { buy: 7, sell: 7 }); assert.deepEqual(at.get(201), { buy: 0, sell: 1 }); ok('per-price buy / sell by bucket');
const win = S.atPrice(1500, 0.5, 3000); assert.deepEqual(win.get(200), { buy: 5, sell: 0 }); assert.equal(win.get(201).sell, 1); ok('window 1.5 s only counts the last 1.5 s');
const lm = C.ladderModel({ bids: [[100, 5], [99, 3]], asks: [[101, 4], [102, 1]] }, new Map([[100, { buy: 2, sell: 6 }]]), 1, 20);
const r100 = lm.rows.find((x) => x.price === 100);
assert.equal(r100.delta, -4); assert.equal(r100.isBid, true); assert.equal(lm.rows.find((x) => x.price === 101).isAsk, true); assert.deepEqual(lm.rows.map((x) => x.price), [102, 101, 100, 99]); ok('ladder: delta = bought - sold per row, touch flags, high -> low');
assert.deepEqual(S.split(2400, 3000), { buy: 7, sell: 1, pct: (7 / 8) * 100 }); ok('buy / sell split for the last window');

// click -> paper order mapping
assert.deepEqual(C.clickToOrder('bid', 99, 100, 101), { side: 'buy', type: 'limit', price: 99 }); ok('bid cell below the ask -> BUY limit at that price');
assert.deepEqual(C.clickToOrder('ask', 102, 100, 101), { side: 'sell', type: 'limit', price: 102 }); ok('ask cell above the bid -> SELL limit at that price');
assert.deepEqual(C.clickToOrder('bid', 101, 100, 101), { side: 'buy', type: 'market' }); ok('bid cell at the ask (through the touch) -> BUY market');
assert.deepEqual(C.clickToOrder('ask', 100, 100, 101), { side: 'sell', type: 'market' }); ok('ask cell at the bid -> SELL market');
assert.equal(C.clickToOrder('price', 100, 100, 101), null); assert.equal(C.clickToOrder('bid', NaN, 100, 101), null); ok('price column / bad price -> no order');

// pairs + steps + drawings
assert.deepEqual(C.pairOf('BTCUSDT'), { base: 'BTC', quote: 'USDT', perp: false }); assert.equal(C.pairOf('ETHUSDT.P').perp, true); assert.equal(C.pairOf('binance:SOLUSDC').quote, 'USDC'); ok('pairOf');
assert.equal(C.autoStep(85000), 1); assert.equal(C.autoStep(3500), 0.05); ok('autoStep');
assert.deepEqual(C.zoneDrawing(10, 20, 1, 2).opts.anchors, [{ time: 1, price: 20 }, { time: 2, price: 10 }]); assert.equal(C.levelDrawing(5, 9).type, 'hline'); ok('level / zone anchors (zone corners ordered high, low)');
assert.equal(C.fmtPrice(85000.5, 0.5), '85,000.5'); assert.equal(C.fmtSize(12345), '12.3k'); assert.equal(C.fmtDelta(-3), '−3.00'); ok('formatting');
console.log(n + ' checks passed');

assert.deepEqual(C.pairOf('OKX:BTC-USDT-SWAP'), { base: 'BTC', quote: 'USDT', perp: true }); assert.deepEqual(C.pairOf('okx:ETH-USDT'), { base: 'ETH', quote: 'USDT', perp: false }); console.log('PASS OKX swap ticker -> perp pair');
