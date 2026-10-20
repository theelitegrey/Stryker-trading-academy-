// Shared InsightSentry connection (functions/api/chart/_is-hub.js).  node tools/tests/is-hub.test.mjs
import assert from 'node:assert/strict';
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const socks = [];
globalThis.WebSocket = class { constructor(u) { this.url = u; this.sent = []; socks.push(this); setTimeout(() => this.onopen && this.onopen(), 1); } send(x) { this.sent.push(JSON.parse(x)); } close() { this.closed = true; this.onclose && this.onclose(); } _m(o) { this.onmessage({ data: JSON.stringify(o) }); } };
const { hubSubscribe, hubStats, _hubResetForTests } = await import('../../functions/api/chart/_is-hub.js');
const row = (t, c) => ({ time: t, open: c, high: c, low: c, close: c, volume: 1 });
const leg = (code, bt, bi) => ({ code, bar_type: bt, bar_interval: bi, dp: 1000 });
const mk = () => { const got = []; return { got, onMessage: (m) => got.push(m) }; };

// 1) many consumers, one socket; both legs in one subscription message
const a = mk(), b = mk(), c = mk(), d = mk();
const h1 = hubSubscribe({ key: 'k', url: 'wss://x', leg: leg('CME:NQ1!', 'minute', 1), replay: 200, ...a });
const h2 = hubSubscribe({ key: 'k', url: 'wss://x', leg: leg('CME:NQ1!', 'minute', 1), replay: 200, ...b });
const h3 = hubSubscribe({ key: 'k', url: 'wss://x', leg: leg('CME:NQ1!', 'minute', 5), replay: 200, ...c });
const h4 = hubSubscribe({ key: 'k', url: 'wss://x', leg: leg('CME:ES1!', 'minute', 1), replay: 200, ...d });
await sleep(400);
assert.equal(socks.length, 1); ok('4 consumers on 3 legs share ONE upstream socket');
assert.equal(socks[0].sent.length, 1); const subs0 = socks[0].sent[0].subscriptions; assert.ok(subs0.length >= 3 && subs0.length <= 10); assert.ok(subs0.some((x) => x.code === 'CME:NQ1!' && x.bar_interval === 15)); ok('one subscription message carrying the 3 legs + warm timeframes (' + subs0.length + ' legs, no per-client messages)');

// 2) routing by code + bar_type
socks[0]._m({ event: 'subscription_status', status: 'active' });
socks[0]._m({ code: 'CME:NQ1!', bar_type: '1m', series: [row(60, 1), row(120, 2)] });
socks[0]._m({ code: 'CME:NQ1!', bar_type: '5m', series: [row(300, 9)] });
socks[0]._m({ code: 'CME:ES1!', bar_type: '1m', series: [row(60, 7)] });
assert.equal(a.got.length, 1); assert.equal(b.got.length, 1); assert.equal(c.got.length, 1); assert.equal(d.got.length, 1);
assert.equal(c.got[0].series[0].close, 9); assert.equal(d.got[0].series[0].close, 7); ok('messages routed to the right leg only (code + bar_type)');

// 3) late joiner gets the cached history; then live rows
socks[0]._m({ code: 'CME:NQ1!', bar_type: '1m', series: [row(120, 3)] });
const e = mk(); hubSubscribe({ key: 'k', url: 'wss://x', leg: leg('CME:NQ1!', 'minute', 1), replay: 200, ...e });
await sleep(20);
assert.equal(e.got[0].series.length, 2); assert.equal(e.got[0].series[1].close, 3); ok('late consumer is replayed the cached rows (newest value of each bar)');
assert.equal(socks[0].sent.length, 1); ok('joining an existing leg sends NO new subscription message');
socks[0]._m({ code: 'CME:NQ1!', bar_type: '1m', series: [row(120, 4)] });
assert.equal(e.got.length, 2); assert.equal(a.got.length, 3); ok('live updates fan out to everyone');

// 3b) a timeframe that is already warm needs no message
const w = mk(); hubSubscribe({ key: 'k', url: 'wss://x', leg: leg('CME:NQ1!', 'minute', 15), replay: 200, ...w });
await sleep(300); assert.equal(socks[0].sent.length, 1); ok('a warm timeframe (15m) joins with no new subscription message');
// 4) new leg while open: debounced single replacement with ALL legs
const f = mk(); hubSubscribe({ key: 'k', url: 'wss://x', leg: leg('CME:NQ1!', 'minute', 7), replay: 200, ...f });
await sleep(400);
assert.equal(socks[0].sent.length, 2); assert.ok(socks[0].sent[1].subscriptions.length > subs0.length && socks[0].sent[1].subscriptions.some((x) => x.bar_interval === 7)); ok('new leg => ONE replacement message containing the full set');

// 5) close one consumer: others unaffected, socket stays
h1.close(); socks[0]._m({ code: 'CME:NQ1!', bar_type: '1m', series: [row(180, 5)] });
assert.equal(b.got.at(-1).series[0].close, 5); assert.equal(socks.length, 1); ok('closing a consumer leaves the socket and the others alone');

// 6) upstream drop -> reconnect with backoff, history refilled
socks[0].close(); assert.ok(socks.length === 1);
await sleep(1500);
assert.equal(socks.length, 2); ok('upstream closed => new socket after backoff (' + socks.length + ' sockets)');
await sleep(50); assert.ok(socks[1].sent[0].subscriptions.length > subs0.length); ok('new socket re-subscribes every leg');
socks[1]._m({ code: 'CME:ES1!', bar_type: '1m', series: [row(60, 7), row(120, 8)] });
assert.equal(d.got.at(-1).series.length, 2); ok('after reconnect the history is passed through again (gap refilled)');

// 7) key mismatch / leg cap -> null (caller goes direct)
assert.equal(hubSubscribe({ key: 'other', url: 'wss://x', leg: leg('A', 'minute', 1), onMessage() {} }), null); ok('different key => null (direct fallback)');
_hubResetForTests();
let nulls = 0; for (let i = 0; i < 40; i++) if (!hubSubscribe({ key: 'k', url: 'wss://x', leg: leg('S' + i, 'minute', 1), onMessage() {} })) nulls++;
assert.ok(nulls >= 1); ok('leg cap: extra legs return null (' + nulls + ' of 40)');
_hubResetForTests();
console.log(n + ' passed'); process.exit(0);
