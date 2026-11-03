// Live-from-the-hub checks (Owner 2026-11-03). node tools/tests/ts-live-source.test.mjs
//  1. the root lists in assets/live-source.js equal the hub's (ts-hub.js TS_SYMBOLS + TS_TRADES + TS_QUOTES)
//  2. the browser's candle built from the hub's frames (bars back-fill + trade ticks) equals the RECORDER's minute (hub bars1m + footprint accumulator) for 1m,
//     and a 5m / 2h candle folds the same minutes (2h anchored to 18:00 New York like the REST bars)
//  3. a hub root + a trades-only root + an index never ask for /api/chart/stream (provider + intervals source scan), and LIVE_SOURCE 'is' keeps the old path in the code
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TSHub, TS_SYMBOLS, TS_TRADES, TS_QUOTES } from '../../workers/book-recorder/src/ts-hub.js';
const L = await import('../../assets/live-source.js');
assert.deepEqual(L.HUB_BOOKS, TS_SYMBOLS); assert.deepEqual(L.HUB_TRADES, TS_TRADES); assert.deepEqual(L.HUB_QUOTES, TS_QUOTES);
assert.equal(L.LIVE_SOURCE, 'hub');
console.log('PASS root lists equal the hub');

// ---- browser shims; the "network" is the hub itself
let hub, FEED = null;
globalThis.window = { __stkL2Test: { base: 'http://127.0.0.1:9' }, dispatchEvent() {}, addEventListener() {} };
globalThis.Event = class { constructor(t) { this.type = t; } };
globalThis.location = { hostname: 'localhost', host: 'localhost' };
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {}, getElementById() { return null; }, createElement() { return { style: {}, classList: { add() {}, toggle() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; } }; }, head: { appendChild() {} }, body: { appendChild() {} } };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
const wsUrls = [];
globalThis.WebSocket = class {
  constructor(url) { wsUrls.push(String(url)); this.readyState = 1; globalThis.__ws = this; this.url = url; setTimeout(() => { this.onopen && this.onopen(); this.h = hub.attach({ send: (s) => { this.onmessage && this.onmessage({ data: s }); }, close() {} }, new URL(url).searchParams.get('symbol'), 20, FEED); }, 1); }
  send(s) { try { this.h && this.h.onMessage(s); } catch (e) {} }
  close() { if (this.h) this.h.close(); }
};
class FakeUp { constructor() { this.l = {}; globalThis.__up = this; setTimeout(() => this.emit('open', {}), 1); } addEventListener(e, f) { (this.l[e] = this.l[e] || []).push(f); } emit(e, ev) { for (const f of this.l[e] || []) f(ev); } send() {} close() {} msg(o) { this.emit('message', { data: JSON.stringify(o) }); } }
const store = { rows: new Map(), putMin(sym, t, b, i, f) { this.rows.set(sym + t, { t, f }); }, prune() {}, range() { return []; } };
// 2026-11-03 15:00:30 UTC = 10:00:30 ET (EST), a Tuesday: CME open, mid-minute
let clock = Date.UTC(2026, 10, 3, 14, 56, 30);   // the clock only moves forward
hub = new TSHub(store, 'KEY', { WebSocket: FakeUp, now: () => clock, FLUSH_MS: 5, MIN_GAP_MS: 30, RECORD: true, SILENT_MS: 1e12, NODATA_MS: 1e12 });
hub.connect(); await new Promise((r) => setTimeout(r, 10));
const up = globalThis.__up;
const m = await import('../../assets/chart-futures-l2.js');
const send = (sym, px, sz, side) => { clock += 500; up.msg({ type: 'tick', symbol: sym, price: px, size: sz, side }); };
// history in the hub: the previous 3 minutes (so a 5m candle has earlier minutes to fold)
for (const [dm, px] of [[-3, 100], [-2, 101], [-1, 102]]) { clock = Date.UTC(2026, 10, 3, 15, 0, 30) + dm * 60000; send('NQ', px, 2, 'buy'); send('NQ', px + 0.5, 1, 'sell'); }
clock = Date.UTC(2026, 10, 3, 15, 0, 30);
const got = { 1: [], 5: [], 120: [] }, stops = [];
FEED = 'book';
const seed = () => Promise.resolve([]);
stops.push(m.l2Candles('NQ', '1', (b) => got[1].push(b), null, null));
stops.push(m.l2Candles('NQ', '5', (b) => got[5].push(b), null, seed));
stops.push(m.l2Candles('NQ', '120', (b) => got[120].push(b), null, seed));
await new Promise((r) => setTimeout(r, 40));
// live trades in the forming minute (all via the hub; the clients get them in `ticks` frames)
const t0 = clock;
const prints = [[28000.25, 2, 'buy'], [28001, 3, 'sell'], [27999.5, 1, 'sell'], [28002.25, 4, 'buy'], [28001.75, 2, 'buy']];
for (const [p, s, side] of prints) { send('NQ', p, s, side); await new Promise((r) => setTimeout(r, 40)); }
await new Promise((r) => setTimeout(r, 120));
const minute = Math.floor(clock / 60000) * 60000;
const last = got[1].at(-1);
assert.ok(last && last.time === minute, 'a 1m candle for the forming minute arrived');
// the recorder's minute for this symbol: footprint accumulator (o/h/l/c + per-price volume) and the hub's own 1m candle
const a = hub.acc.get('NQ'), bar = hub.bars1m.get('NQ').at(-1);
const vol = [...a.lv.values()].reduce((x, r) => x + r[1] + r[2], 0);
assert.deepEqual([last.open, last.high, last.low, last.close, last.volume], [a.o, a.h, a.l, a.c, vol], '1m candle = recorder minute (o h l c volume)');
assert.deepEqual([last.open, last.high, last.low, last.close, last.volume], [bar[1], bar[2], bar[3], bar[4], bar[5]], '1m candle = hub 1m candle');
assert.equal(last.volume, prints.reduce((x, p) => x + p[1], 0) + 0, 'volume = sum of the prints');
const c5 = got[5].at(-1), b5 = Math.floor(minute / 300000) * 300000;
assert.ok(c5 && c5.time === b5 && c5.close === last.close && c5.high >= last.high && c5.low <= last.low, '5m candle folds the same minutes and ends on the same close');
const c120 = got[120].at(-1);
// 2h anchored 18:00 ET: 15:00 UTC Nov 3 = 10:00 ET -> bucket 10:00-12:00 ET = 15:00-17:00 UTC, so it starts at 15:00 UTC sharp
assert.ok(c120 && c120.time === Date.UTC(2026, 10, 3, 15, 0), '2h candle starts on the 18:00 ET anchored boundary (' + (c120 && new Date(c120.time).toISOString()) + ')');
assert.equal(m.bucketStart(Date.UTC(2026, 10, 3, 23, 0), 240), Date.UTC(2026, 10, 3, 23, 0), '4h anchor: 18:00 ET = 23:00 UTC in November (EST)');
assert.equal(m.bucketStart(Date.UTC(2026, 6, 3, 22, 30), 240), Date.UTC(2026, 6, 3, 22, 0), '4h anchor in summer (EDT): 18:00 ET = 22:00 UTC');
console.log('PASS browser candle (1m / 5m / 2h) equals the recorder minute');

// a trades-only root: own trades, candle moves, no book frames
const seen = [];
const mgc = m.l2Candles('MGC', '1', (b) => seen.push(b), null, null);
FEED = 'trades';
await new Promise((r) => setTimeout(r, 40));
send('MGC', 4100.1, 3, 'buy'); await new Promise((r) => setTimeout(r, 40)); send('MGC', 4100.4, 1, 'sell'); await new Promise((r) => setTimeout(r, 120));
assert.ok(seen.length && seen.at(-1).close === 4100.4 && seen.at(-1).high === 4100.4 && seen.at(-1).volume >= 1, 'MGC candle moves from its own trades');
assert.equal(hub.latest.has('MGC'), false); assert.equal(hub.acc.has('MGC'), false, 'trades-only root: no book, nothing recorded');
console.log('PASS trades-only root candle');
stops.forEach((s) => s()); mgc(); hub.shutdown();

// ---- nothing opens /api/chart/stream on the hub path
assert.ok(wsUrls.length && wsUrls.every((u) => /\/ts-live\?/.test(u)), 'only /ts-live sockets: ' + wsUrls.join(' '));
const prov = fs.readFileSync('assets/chart-futures-provider.js', 'utf8'), inter = fs.readFileSync('assets/chart-intervals.js', 'utf8');
assert.match(prov, /if \(hubLive\(\) && root && tf && hubCovers\(root\)[^\n]*return this\.hubSubscribe/, 'subscribe() routes hub roots to hubSubscribe before the bridge');
assert.match(inter, /function futuresStreamSubscribe\(ticker, tf, onBar\) \{\n  if \(onHub\(ticker\)\)/);
assert.match(inter, /function futuresStreamBars\(ticker, tf, range = \{\}\) \{\n  if \(onHub\(ticker\)\) return Promise\.resolve\(\[\]\)/);
const hubFn = prov.slice(prov.indexOf('hubSubscribe(ticker, timeframe, onBar, root, tf) {'), prov.indexOf('// admin-only futures L2 candles'));
assert.ok(!/STREAM_API|streamSubscribe|chart\/stream/.test(hubFn), 'hubSubscribe never touches the bridge');
console.log('PASS no /api/chart/stream on the hub path (scan + socket URLs)');
process.exit(0);
