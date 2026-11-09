// Bitget + Kraken parsers against recorded fixtures.  node tools/tests/exchanges-d.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
const fx = (n) => JSON.parse(fs.readFileSync(new URL('./fixtures/' + n + '.json', import.meta.url)));
const BG = await import('../../assets/vendor/vela-0.6.17-s4/providers/bitget.js');
const KR = await import('../../assets/vendor/vela-0.6.17-s4/providers/kraken.js');
globalThis.window = {};
const OFB = await import('../../assets/orderflow-venue-bitget.js');
const OFK = await import('../../assets/orderflow-venue-kraken.js');
const V = await import('../../assets/orderflow-venues.js?v=937');
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };

// ---- Bitget
const sc = fx('bitget-spot-candles').data.map(BG.rowToOHLCV);
assert.equal(sc.length, 3); assert.ok(sc[0].time < sc[1].time && sc[0].open > 0 && sc[0].high >= sc[0].low && sc[0].volume > 0); ok('bitget kline row -> OHLCV (oldest first, numbers)');
assert.equal(fx('bitget-perp-candles').data.map(BG.rowToOHLCV)[0].volume > 0, true); ok('bitget perp kline row (7 columns) parses');
assert.deepEqual(BG.parseTicker('btcusdt.p'), { sym: 'BTCUSDT', perp: true }); assert.deepEqual(BG.parseTicker('ETHUSDT'), { sym: 'ETHUSDT', perp: false }); ok('bitget ticker: .P = USDT perpetual');
const spot = BG.parseSpotSymbols(fx('bitget-spot-symbols')), perp = BG.parsePerpSymbols(fx('bitget-perp-contracts'));
assert.ok(spot.find((s) => s.ticker === 'BTCUSDT' && s.type === 'crypto' && s.tick > 0)); assert.ok(perp.find((s) => s.ticker === 'BTCUSDT.P' && s.type === 'futures' && /Perpetual/.test(s.description) && s.tick > 0)); ok('bitget symbol lists: spot BTCUSDT, perp BTCUSDT.P with tick size');
const bws = fx('bitget-ws');
const cu = bws.find((m) => m.arg.channel === 'candle1m' && m.action === 'update');
assert.equal(BG.wsCandles(cu).length, 1); const cs = bws.find((m) => m.arg.channel === 'candle1m' && m.action === 'snapshot'); assert.ok(BG.wsCandles(cs).length <= 2); ok('bitget ws candle: update = 1 bar, snapshot = newest 2 only');
const bk = bws.find((m) => m.arg.channel === 'books' && m.action === 'snapshot'), bu = bws.find((m) => m.arg.channel === 'books' && m.action === 'update');
const pb = OFB.parseBooks(bk); assert.ok(pb.snapshot && pb.bids.length && pb.asks.length && typeof pb.bids[0][0] === 'number'); assert.equal(OFB.parseBooks(bu).snapshot, false); ok('bitget book snapshot vs diff -> numeric [price,size] rows');
assert.deepEqual(OFB.parseBooks({ arg: { channel: 'books' }, action: 'update', data: [{ bids: [['10', '0']], asks: [] }] }).bids, [[10, 0]]); ok('bitget book diff keeps size 0 (= remove level)');
const tr = OFB.parseTrades(bws.find((m) => m.arg.channel === 'trade' && m.action === 'update'));
assert.ok(tr.length && tr.every((x) => (x.side === 1 || x.side === -1) && x.p > 0 && x.s > 0 && x.t > 1e12)); ok('bitget trades: aggressor side +1/-1');
assert.deepEqual(OFB.parseTrades({ arg: { channel: 'trade' }, data: [{ ts: '1', price: '2', size: '3', side: 'sell' }, { ts: '1', price: '2', size: '3', side: 'buy' }] }).map((x) => x.side), [-1, 1]); ok('bitget sell = -1 (seller aggressor), buy = +1');
assert.deepEqual(OFB.pairInfo('BTCUSDT.P'), { sym: 'BTCUSDT', perp: true }); ok('bitget order-flow pair info');
assert.ok(typeof V.getVenue('bitget').bookStream === 'function' && typeof V.getVenue('bitget').tradeStream === 'function' && typeof V.getVenue('bitget').tick === 'function'); ok('bitget venue registered (bookStream, tradeStream, tick)');

// ---- Kraken
const ko = KR.restToBars(fx('kraken-ohlc'));
assert.equal(ko.length, 3); assert.ok(ko[0].time % 60000 === 0 && ko[0].time > 1e12 && ko[0].volume > 0 && ko[0].high >= ko[0].low); ok('kraken OHLC rows (seconds) -> OHLCV in ms, volume = column 6 (not vwap)');
assert.deepEqual(KR.restToBars({ error: ['EQuery:Unknown asset pair'], result: {} }), []); ok('kraken REST error -> no bars');
const pairs = KR.parsePairs(fx('kraken-assetpairs'));
assert.ok(pairs.find((p) => p.ticker === 'XBTUSD' && p.ws === 'BTC/USD' && p.tick > 0 && p.type === 'crypto')); ok('kraken pairs: XBTUSD <-> BTC/USD, tick size');
const kws = fx('kraken-ws');
const ou = kws.find((m) => m.channel === 'ohlc' && m.type === 'update'); const wb = KR.wsToBars(ou);
assert.ok(wb.length >= 1 && wb[0].time > 1e12 && wb[0].time % 60000 === 0 && wb[0].open > 0); assert.ok(KR.wsToBars(kws.find((m) => m.channel === 'ohlc' && m.type === 'snapshot')).length <= 2); ok('kraken ws ohlc -> bars (interval_begin as time); snapshot = newest 2');
const kb = OFK.parseSpotBook(kws.find((m) => m.channel === 'book' && m.type === 'snapshot'));
assert.ok(kb.snapshot && kb.bids.length && kb.asks.length && kb.bids[0][0] > 0); assert.equal(OFK.parseSpotBook(kws.find((m) => m.channel === 'book' && m.type === 'update')).snapshot, false); ok('kraken spot book snapshot / update');
assert.deepEqual(OFK.parseSpotBook({ channel: 'book', type: 'update', data: [{ bids: [{ price: 5, qty: 0 }], asks: [] }] }).bids, [[5, 0]]); ok('kraken book diff qty 0 = remove level');
const kt = OFK.parseSpotTrades(kws.find((m) => m.channel === 'trade'));
assert.ok(kt.length && kt.every((x) => (x.side === 1 || x.side === -1) && x.t > 1e12)); assert.deepEqual(OFK.parseSpotTrades({ channel: 'trade', data: [{ side: 'sell', price: 1, qty: 1, timestamp: '2026-01-01T00:00:00Z' }] })[0].side, -1); ok('kraken spot trade side (taker) -> +1/-1');
const fws = fx('kraken-fut-ws');
const fs0 = OFK.parseFutBook(fws.find((m) => m.feed === 'book_snapshot')); assert.ok(fs0.snapshot && fs0.bids.length);
const fd = OFK.parseFutBook(fws.find((m) => m.feed === 'book')); assert.equal(fd.snapshot, false); assert.equal(fd.bids.length + fd.asks.length, 1); ok('kraken futures book snapshot + one-level diff');
const ft = OFK.parseFutTrades(fws.find((m) => m.feed === 'trade_snapshot')); assert.ok(ft.length && ft.every((x) => x.side === 1 || x.side === -1)); assert.equal(OFK.parseFutTrades(fws.find((m) => m.feed === 'trade' && m.uid)).length, 1); ok('kraken futures trades snapshot + live');
assert.equal(OFK.pairInfo('XBTUSD.P').fut, 'PF_XBTUSD'); assert.equal(OFK.pairInfo('XBTUSD').ws, 'BTC/USD'); assert.equal(OFK.pairInfo({ base: 'ETH', quote: 'USD', perp: true }).fut, 'PF_ETHUSD'); ok('kraken pair mapping (XBT <-> BTC, PF_ perp)');
assert.ok(V.getVenue('kraken')); ok('kraken venue registered');
console.log(n + ' passed');
