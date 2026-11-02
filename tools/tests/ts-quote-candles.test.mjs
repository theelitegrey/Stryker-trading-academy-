// l2Candles on a quote-only symbol (SPX): candles move from 'quote' frames, volume stays 0, nothing flows when the gate is shut.
//   node tools/tests/ts-quote-candles.test.mjs
import assert from 'node:assert/strict';
const listeners = [];
globalThis.window = { __stkL2Test: { base: 'http://127.0.0.1:9' }, dispatchEvent() {}, addEventListener() {} };
globalThis.Event = class { constructor(t) { this.type = t; } };
globalThis.location = { hostname: 'localhost', host: 'localhost' };
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {}, getElementById() { return null; }, createElement() { return { style: {}, classList: { add() {}, toggle() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; } }; }, head: { appendChild() {} }, body: { appendChild() {} } };
globalThis.WebSocket = class { constructor() { globalThis.__ws = this; setTimeout(() => this.onopen && this.onopen(), 1); } send() {} close() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
const m = await import('../../assets/chart-futures-l2.js');
assert.ok(m.isQuoteSym('spx') && m.isQuoteSym('DIA') && !m.isQuoteSym('NQ'));
const bars = []; m.l2Candles('SPX', '1', (b) => bars.push(b), () => false);
await new Promise((r) => setTimeout(r, 30));
const send = (o) => globalThis.__ws.onmessage({ data: JSON.stringify(o) });
const t0 = Math.floor(Date.now() / 60000) * 60000;
send({ event: 'status', state: 'live' });
send({ type: 'bars', symbol: 'SPX', b: [[t0, 6000, 6001, 5999, 6000.5, 0]] });
send({ type: 'quote', symbol: 'SPX', p: 6003.25, ts: t0 + 5000 });
send({ type: 'quote', symbol: 'SPX', p: 5998, ts: t0 + 9000 });
send({ type: 'quote', symbol: 'QQQ', p: 1, ts: t0 + 9000 });   // other symbol: ignored
const b = bars.at(-1);
assert.deepEqual([b.time, b.open, b.high, b.low, b.close, b.volume], [t0, 6000, 6003.25, 5998, 5998, 0], 'current candle follows the level, volume 0');
assert.equal(m.l2Fed('SPX'), true, 'chart counts as fed (delayed pill hidden)');
console.log('PASS quote candles: OHLC from the level, zero volume, other symbols ignored, pill suppressed');
process.exit(0);
