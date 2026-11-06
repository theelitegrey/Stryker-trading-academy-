// Bybit parsers against recorded-shape fixtures. node tools/tests/bybit-unit.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const F = JSON.parse(readFileSync(new URL('./fixtures/bybit/samples.json', import.meta.url)));
globalThis.WebSocket = class {};
const P = await import('../../assets/vendor/vela-0.6.17-s3/providers/bybit.js');
const O = await import('../../assets/orderflow-venue-bybit.js');

// klines: REST rows are newest first; rowToBar keeps numbers
const bars = F.kline.result.list.map(P.rowToBar).reverse();
assert.deepEqual(bars[1], { time: 1730000900000, open: 68100.5, high: 68200, low: 68050, close: 68150.1, volume: 12.345 });
assert.ok(bars[0].time < bars[1].time);
assert.deepEqual(P.wsKlineToBar(F.wsKline.data[0]), { time: 1730000900000, open: 68100.5, high: 68200, low: 68050, close: 68160, volume: 13.1 });
// symbols: only Trading USDT linear perpetuals, ".P" suffix
const syms = P.parseInstruments(F.instruments.result.list, 'linear');
assert.deepEqual(syms, [{ ticker: 'BTCUSDT.P', description: 'BTC / USDT Perpetual', type: 'futures' }]);
assert.equal(P.parseInstruments(F.instruments.result.list, 'spot').length, 3);
assert.deepEqual(P.parseTicker('btcusdt.p'), { symbol: 'BTCUSDT', category: 'linear' });
assert.deepEqual(P.parseTicker('ETHUSDT'), { symbol: 'ETHUSDT', category: 'spot' });
// aggregate
const agg = P.aggregate([{ time: 0, open: 1, high: 3, low: 1, close: 2, volume: 1 }, { time: 6e4, open: 2, high: 5, low: 2, close: 4, volume: 2 }], 12e4);
assert.deepEqual(agg, [{ time: 0, open: 1, high: 5, low: 1, close: 4, volume: 3 }]);
// order-flow adapter parsers (book snapshot/diff, trade aggressor side)
if (O) {
  const s = O.parseBook(F.bookSnapshot), d = O.parseBook(F.bookDelta);
  assert.equal(s.type, 'snapshot'); assert.deepEqual(s.bids[0], [68000, 1.5]);
  assert.equal(d.type, 'delta'); assert.deepEqual(d.bids[0], [68000, 0]);
  assert.deepEqual(O.parseTrades(F.trades).map((t) => t.side), [1, -1]);
  assert.equal(O.parseTrades(F.trades)[0].p, 68000.1);
}
console.log('bybit-unit ok');
// Book panel source: snapshot replaces, delta patches, size 0 deletes; trade side
const S = await import('../../assets/book-panel-sources.js');
const bk = { bids: new Map(), asks: new Map() };
S.bybitBook(bk, F.bookSnapshot); S.bybitBook(bk, F.bookDelta);
assert.deepEqual([...bk.bids], [[67999.9, 2], [67999.8, 4]]);
assert.equal(bk.asks.get(68000.1), 0.7);
assert.deepEqual(F.trades.data.map((x) => S.bybitTrade(x).side), [1, -1]);
console.log('bybit book-panel ok');
