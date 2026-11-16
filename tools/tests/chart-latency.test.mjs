// Unit test: assets/chart-latency-core.js (connection chip numbers) + the Performance mode coalescing in
// assets/chart-live-resume.js.   node tools/tests/chart-latency.test.mjs
import assert from 'node:assert/strict';
import * as L from '../../assets/chart-latency-core.js';

// quality bands: green < 80, amber < 200, red above, none = no data
assert.equal(L.quality(null).q, 'none');
assert.equal(L.quality(30).q, 'good'); assert.equal(L.quality(79).q, 'good');
assert.equal(L.quality(80).q, 'fair'); assert.equal(L.quality(199).q, 'fair');
assert.equal(L.quality(200).q, 'poor');
assert.equal(L.quality(300, true).q, 'good'); assert.equal(L.quality(1000, true).q, 'fair'); assert.equal(L.quality(1300, true).q, 'poor');
assert.equal(L.fmtMs(null), '—'); assert.equal(L.fmtMs(41.6), '42 ms');
assert.equal(L.fmtAge(null), '—'); assert.equal(L.fmtAge(300), '0.3 s ago'); assert.equal(L.fmtAge(90000), '90 s ago');
assert.equal(L.coloCity('bom'), 'Mumbai'); assert.equal(L.coloCity('ZZZ'), 'ZZZ'); assert.equal(L.coloCity(''), '');
assert.equal(L.feedKey('Binance', 'binance:BTCUSDT'), 'binance:btcusdt');

// site: no pings -> nulls; pings -> cur/avg/jitter; two failures -> down
L._reset();
let s = L.siteStats();
assert.equal(s.cur, null); assert.equal(s.avg, null); assert.equal(s.jitter, null);
const t = Date.now();
L.notePing(t - 100, t - 60, t - 80);     // rtt 40, server at the midpoint -> offset 0
L.notePing(t - 50, t, t - 25);           // rtt 50
s = L.siteStats();
assert.equal(s.cur, 50); assert.equal(s.avg, 45); assert.equal(s.jitter, 10); assert.equal(s.down, false);
assert.ok(Math.abs(L.clockOffset()) < 1);
L.notePingFail(); L.notePingFail();
s = L.siteStats(); assert.equal(s.down, true); assert.equal(s.cur, null);

// feed delay: hidden until the clock offset is known, then corrected by it
L._reset();
L.noteExch('binance:btcusdt', Date.now() - 120);
assert.equal(L.feedStats('binance:btcusdt').delay.cur, null, 'no offset yet -> no delay shown');
const n = Date.now();
L.notePing(n - 20, n, n - 10 + 1000);    // edge clock is 1000 ms ahead of this browser
L._reset();
L.notePing(n - 20, n, n - 10 + 1000);
L.noteExch('binance:btcusdt', Date.now() + 1000 - 150);   // exchange stamped 150 ms ago (edge clock)
const d = L.feedStats('binance:btcusdt').delay.cur;
assert.ok(d >= 148 && d <= 160, 'delay corrected by offset: ' + d);
assert.equal(L.feedStats('binance:btcusdt').age, null, 'a heartbeat/exchange time alone is not a "last update"');
L.noteBar('binance:btcusdt');
assert.ok(L.feedStats('binance:btcusdt').age < 50);
assert.equal(L.feedStats('nope:x').age, null);

// Performance mode: forming-candle updates coalesced to <= 4/s, the last state always delivered, new candles pass at once
globalThis.window = new EventTarget();
globalThis.localStorage = { getItem: (k) => (k === 'stk.perfMode' ? '1' : null) };
const { liveSubscribe } = await import('../../assets/chart-live-resume.js');
const got = [];
let push = null;
const stop = liveSubscribe((cb) => { push = cb; return () => {}; }, async () => [], '1', (b) => got.push(b));
push({ time: 60000, close: 1 });
for (let i = 2; i <= 20; i++) push({ time: 60000, close: i });
assert.equal(got.length, 1, 'first bar passes, its updates inside 250 ms are held: ' + got.length);
push({ time: 120000, close: 21 });                       // new candle: flushes the held update, then goes through
assert.deepEqual(got.slice(-2).map((b) => b.close), [20, 21]);
push({ time: 120000, close: 22 });
await new Promise((r) => setTimeout(r, 300));
assert.equal(got[got.length - 1].close, 22, 'held update delivered after the wait');
stop();
console.log('chart-latency.test: all passed');
