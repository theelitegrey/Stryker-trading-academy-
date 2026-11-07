// Order book replay helpers.  node tools/tests/book-replay.test.mjs
import assert from 'node:assert/strict';
import * as R from '../../assets/book-replay.js';
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };

const S = (ts, extra) => Object.assign({ ts, mid: 100, bb: 99.9, ba: 100.1, step: 1, i0: 98, v: Float32Array.from([3, 2, -4, -1]) }, extra || {});
const list = [S(1000), S(6000), S(11000)];

// sampleAt: newest at or before t, never one after it (no lookahead), none when stale
assert.equal(R.sampleAt(list, 5999).ts, 1000); ok('sampleAt: t between samples -> the earlier one');
assert.equal(R.sampleAt(list, 6000).ts, 6000); ok('sampleAt: exact time -> that sample');
assert.equal(R.sampleAt(list, 999), null); ok('sampleAt: before the first sample -> null');
assert.equal(R.sampleAt(list, 99999).ts, 11000); ok('sampleAt: after the last, no max age -> the last');
assert.equal(R.sampleAt(list, 11000 + 600001, 600000), null); ok('sampleAt: newest older than max age -> null (gap, not a stale book)');
assert.equal(R.sampleAt([], 5), null); assert.equal(R.sampleAt(list, 0), null); ok('sampleAt: empty list / no clock -> null');
const big = Array.from({ length: 10000 }, (_, k) => S(k * 5000));
for (const t of [1, 4999, 5000, 12345678, 49995000]) assert.equal(R.sampleAt(big, t).ts, Math.floor(t / 5000) * 5000);
ok('sampleAt: binary search == floor on 10k samples');

// sampleBook: rows -> maps; touch rows keyed at the exact best bid / ask; sizes positive
const b = R.sampleBook(S(1000));
assert.deepEqual([...b.bids.entries()], [[98.5, 3], [99.9, 2]]); ok('sampleBook: bid rows at row centre, touch row at the best bid');
assert.deepEqual([...b.asks.entries()], [[100.1, 4], [101.5, 1]]); ok('sampleBook: ask rows, touch row at the best ask, sizes made positive');
assert.equal(b.bestBid, 99.9); assert.equal(b.bestAsk, 100.1); assert.equal(b.ts, 1000); ok('sampleBook: best bid / ask / time kept');
const nb = R.sampleBook(S(1, { bb: null, ba: null }));
assert.equal(nb.bestBid, 99.5); assert.equal(nb.bestAsk, 100.5); ok('sampleBook: no recorded touch -> best = nearest row centre');
assert.equal(R.sampleBook(null).bids.size, 0); ok('sampleBook: null -> empty book');

// nextChunk: aligned windows, newest first, skip done, stop when covered
const H = 3600000, done = new Set();
assert.equal(R.nextChunk(done, 10 * H + 5, 12 * H + 7, H), 12 * H); ok('nextChunk: newest window first (aligned)');
done.add(12 * H); assert.equal(R.nextChunk(done, 10 * H + 5, 12 * H + 7, H), 11 * H);
done.add(11 * H); assert.equal(R.nextChunk(done, 10 * H + 5, 12 * H + 7, H), 10 * H);
done.add(10 * H); assert.equal(R.nextChunk(done, 10 * H + 5, 12 * H + 7, H), null); ok('nextChunk: walks left, null when covered');
assert.equal(R.nextChunk(new Set(), 5 * H, 6 * H, H), 5 * H); ok('nextChunk: an exact window boundary does not ask the next window');
assert.equal(R.nextChunk(new Set(), 6 * H, 6 * H, H), null); ok('nextChunk: empty range -> null');

// Replay One market mapping
assert.deepEqual(R.specMarket({ id: 'NQ=F', src: 'yahoo' }), { provider: 'futures', ticker: 'NQ' });
assert.deepEqual(R.specMarket({ id: 'BTCUSDT', src: 'binance' }), { provider: 'binance', ticker: 'BTCUSDT' });
assert.equal(R.specMarket({ id: 'EURUSD=X', src: 'yahoo' }), null); assert.equal(R.specMarket({ id: 'mine', src: 'csv' }), null);
ok('specMarket: futures =F -> futures root, Binance pair -> binance, forex / CSV -> none');
globalThis.window = { __stkBt: { spec: { id: 'NQ=F', src: 'yahoo' }, clock: () => 1234 } };
const mk = R.btBook({ provider: 'bt', ticker: 'SESSION', root: 'SESSION', futures: false });
assert.equal(mk.provider, 'futures'); assert.equal(mk.ticker, 'NQ'); assert.equal(mk.futures, true);
assert.deepEqual(R.btBook({ provider: 'binance', ticker: 'X' }), { provider: 'binance', ticker: 'X' });
assert.equal(R.replayClock(), 1234); ok('btBook: bt:SESSION -> the session market; others unchanged; Replay One clock');
window.__stkReplay = { on: true, now: () => 99 }; assert.equal(R.replayClock(), 99); window.__stkReplay.on = false; window.__stkBt = null;
assert.equal(R.replayClock(), 0); ok('replayClock: Charts bar replay first; nothing on -> 0');

// replayGap: the honest message, null when there is a book to draw
const NOW = 100 * 86400000, F = (o) => Object.assign({ custom: {}, provider: 'tsl2', ticker: 'NQ', remote: [], remoteState: 'ok', rpCovered: true }, o);
assert.equal(R.replayGap(F({ custom: null, provider: 'coinbase', ticker: 'BTC-USD' }), NOW, NOW), 'No recorded order book for this market in replay.');
assert.equal(R.replayGap(F({ custom: null, provider: 'binance', ticker: 'BTCUSDT.P' }), NOW, NOW), 'No recorded order book for this market in replay.');
assert.equal(R.replayGap(F(), NOW - 31 * 86400000, NOW), 'The order book is recorded for the last 30 days only.');
assert.equal(R.replayGap(F({ remoteState: 'failed' }), NOW - 3600000, NOW), 'Recorded order book unavailable.');
assert.equal(R.replayGap(F({ rpCovered: false }), NOW - 3600000, NOW), 'Loading the recorded order book…');
assert.equal(R.replayGap(F({ custom: null, provider: 'binance', ticker: 'BTCUSDT' }), NOW - 3600000, NOW), null);
ok('replayGap: unrecorded market, older than 30 d, failed, loading, else null');

console.log(n + ' passed');
