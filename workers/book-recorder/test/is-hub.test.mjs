// ONE InsightSentry socket for the site (src/is-hub.js, 2026-10-22 P0). node workers/book-recorder/test/is-hub.test.mjs
// Fake InsightSentry socket + fake storage, small timers. Proves: many clients = 1 upstream socket + 1 subscription
// message; a client reconnect storm (the stall watchdog) adds NO upstream request; a known leg is served from cache;
// subscribe dedupe; backoff 5 s .. 2 min with jitter (scaled); throttle keeps the socket; own hard budget.
import assert from 'node:assert/strict';
import { ISHub, parseLegs, IS_LIMIT } from '../src/is-hub.js';

let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let socks = [];
class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.l = {}; socks.push(this); setTimeout(() => this.emit('open', {}), 2); }
  addEventListener(e, f) { (this.l[e] = this.l[e] || []).push(f); }
  emit(e, ev) { for (const f of this.l[e] || []) f(ev); }
  send(m) { this.sent.push(JSON.parse(m)); }
  close() { if (this.closed) return; this.closed = true; setTimeout(() => this.emit('close', {}), 1); }
  msg(o) { this.emit('message', { data: JSON.stringify(o) }); }
}
const store = () => { const m = new Map(); return { get: async (k) => m.get(k), put: (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); } }; };
const client = () => { const c = { got: [], closed: false, send(s) { c.got.push(JSON.parse(s)); }, close() { c.closed = true; } }; return c; };
const NQ1 = { code: 'CME_MINI:NQ1!', bar_type: 'minute', bar_interval: 1 }, NQT = { code: 'CME_MINI:NQ1!', bar_type: 'tick', bar_interval: 1 };
const fast = { BACK_MIN_MS: 50, BACK_MAX_MS: 400, SEND_GAP_MS: 20, BRAKE_GAP_MS: 60, PENDING_MS: 30, PING_MS: 20, LEG_IDLE_MS: 200, STABLE_MS: 100 };

// legs parser: only code|type|interval, at most 2
assert.deepEqual(parseLegs('CME_MINI:NQ1!|minute|1;CME_MINI:NQ1!|tick|1'), [NQ1, NQT]);
assert.equal(parseLegs('x|minute|1'), null); assert.equal(parseLegs('CME_MINI:NQ1!|year|1'), null); assert.equal(parseLegs(''), null);
assert.equal(parseLegs('A:B|minute|1;A:B|minute|5;A:B|minute|15'), null);
ok('parseLegs validates and caps at 2 legs');

{
  socks = [];
  const hub = new ISHub(store(), 'k', Object.assign({ WebSocket: FakeWS }, fast));
  await hub.loadLog();
  const cs = [];
  for (let i = 0; i < 10; i++) { const c = client(); cs.push([c, hub.attach([NQ1, NQT], c)]); }
  await sleep(30);
  assert.equal(socks.length, 1, '10 clients -> 1 upstream socket');
  assert.equal(socks[0].sent.length, 1, '1 subscription message');
  assert.equal(socks[0].sent[0].subscriptions.length, 2);
  ok('10 viewers on NQ 1m+ticks = 1 upstream socket, 1 subscription message');
  socks[0].msg({ code: 'CME_MINI:NQ1!', bar_type: '1m', series: [{ time: 60, open: 1, high: 2, low: 0, close: 1, volume: 3 }, { time: 120, open: 1, high: 2, low: 0, close: 2, volume: 3 }] });
  for (const [c] of cs) assert.ok(c.got.some((m) => Array.isArray(m.series) && m.series.length === 2));
  ok('series fanned out to every viewer');

  // RECONNECT STORM: every viewer drops and re-attaches 20 times (the client stall watchdog). No upstream cost.
  for (let r = 0; r < 20; r++) for (const pair of cs) { pair[1].close(); const c = client(); pair[0] = c; pair[1] = hub.attach([NQ1, NQT], c); }
  await sleep(60);
  assert.equal(socks.length, 1); assert.equal(socks[0].sent.length, 1);
  assert.equal(hub.stats().window3h, 2, 'window = 1 connect + 1 message');
  ok('200 client reconnects -> 0 extra upstream connects, 0 extra subscription messages (window stays 2)');
  const c0 = cs[0][0];
  assert.ok(c0.got.some((m) => Array.isArray(m.series) && m.series.length === 2), 'a re-attached viewer gets the cached rows at once');
  ok('re-attached viewer primed from the cache (no upstream message)');

  // NEW leg = exactly one replacement message with the full set; same leg again = none
  const c5 = client(); hub.attach([{ code: 'CME_MINI:NQ1!', bar_type: 'minute', bar_interval: 5 }], c5);
  await sleep(80);
  socks[0].msg({ event: 'subscription_status', status: 'active' });
  const c6 = client(); hub.attach([{ code: 'CME_MINI:NQ1!', bar_type: 'minute', bar_interval: 5 }], c6);
  await sleep(80);
  assert.equal(socks[0].sent.length, 2); assert.equal(socks[0].sent[1].subscriptions.length, 3);
  ok('new timeframe = 1 replacement message (full set of 3); the same leg again = no message (dedupe)');

  // throttle message: socket kept, no reconnect
  socks[0].msg({ error: 'reconnect_throttled', message: 'resume in 3.0 seconds', action: 'wait_and_retry' });
  await sleep(30);
  assert.equal(socks.length, 1); assert.ok(!socks[0].closed); assert.equal(hub.stats().throttled, 1);
  ok('reconnect_throttled / wait_and_retry keeps the socket (no new connect)');

  // stats shape for the health endpoint
  const st = hub.stats();
  assert.equal(st.limit3h, IS_LIMIT); assert.equal(st.upstreamSockets, 1); assert.equal(st.connects.h3, 1); assert.equal(st.messages.h3, 2);
  assert.equal(st.perMin.length, 15); assert.ok(!JSON.stringify(st).includes('"k"'));
  ok('stats(): window3h ' + st.window3h + ', connects/messages per minute, no key');
  hub.shutdown();
}

{
  // BACKOFF: upstream keeps dying -> waits grow (min .. max, jittered), never a tight loop
  socks = [];
  const hub = new ISHub(store(), 'k', Object.assign({ WebSocket: FakeWS }, fast, { BRAKE_AT: 1000, HARD_AT: 1000 }));
  await hub.loadLog();
  hub.attach([NQ1], client());
  const waits = [];
  for (let i = 0; i < 6; i++) waits.push(hub.backoff());
  hub.retryN = 0;
  assert.ok(waits.every((w) => w >= 50 && w <= 400), 'within [min, max]: ' + waits.map(Math.round));
  assert.ok(waits[3] > waits[0], 'grows');
  ok('backoff grows from min to max with jitter: ' + waits.map(Math.round).join(', ') + ' ms (prod: 5 s .. 120 s)');
  const t0 = Date.now();
  await sleep(10);
  for (let i = 0; i < 4; i++) { const s = socks[socks.length - 1]; s.close(); await sleep(450); }
  const secs = (Date.now() - t0) / 1000;
  assert.ok(socks.length <= 6, socks.length + ' sockets in ' + secs.toFixed(1) + ' s');
  ok('4 upstream drops -> ' + socks.length + ' connects in ' + secs.toFixed(1) + ' s (backed off, not a loop)');
  hub.shutdown();
}

{
  // REAL constants: first wait >= 5 s, cap 2 min
  const hub = new ISHub(store(), 'k', { WebSocket: FakeWS });
  const w = []; for (let i = 0; i < 12; i++) w.push(hub.backoff());
  assert.ok(w.every((x) => x >= 5000 && x <= 120000)); assert.ok(w[11] >= 90000);
  ok('production backoff: ' + Math.round(w[0] / 1000) + ' s first, ' + Math.round(w[11] / 1000) + ' s after 12 failures (cap 120 s)');
}

{
  // OWN BUDGET: at HARD_AT the hub stops connecting until entries age out; the log survives a DO restart
  socks = [];
  const st = store();
  const now = Date.now();
  await st.put('isLog', Array.from({ length: 100 }, (_, i) => [now - 1000 * i, 'm']));
  const hub = new ISHub(st, 'k', Object.assign({ WebSocket: FakeWS }, fast, { HARD_AT: 100 }));
  await hub.loadLog();
  const c = client(); hub.attach([NQ1], c);
  await sleep(30);
  assert.equal(socks.length, 0); assert.equal(hub.state, 'paused');
  assert.ok(c.got.some((m) => m.event === 'hub_paused'));
  assert.ok(hub.stats().window3h === 100 && hub.stats().nextRetryInMs > 3 * 3600e3 - 200000);
  ok('100 requests already in the window (persisted log) -> no connect, viewers told hub_paused');
  hub.shutdown();
}

{
  // BRAKE: past BRAKE_AT the gap between subscription messages widens
  socks = [];
  const hub = new ISHub(store(), 'k', Object.assign({ WebSocket: FakeWS }, fast, { BRAKE_AT: 1, BRAKE_GAP_MS: 300 }));
  await hub.loadLog();
  hub.attach([NQ1], client());
  await sleep(30);
  socks[0].msg({ event: 'subscription_status', status: 'active' });
  hub.attach([{ code: 'CME_MINI:ES1!', bar_type: 'minute', bar_interval: 1 }], client());
  await sleep(120);
  assert.equal(socks[0].sent.length, 1, 'held back by the brake');
  await sleep(300);
  assert.equal(socks[0].sent.length, 2);
  ok('brake: over BRAKE_AT the next subscription message waits BRAKE_GAP_MS');
  hub.shutdown();
}

{
  // leg cap (5 per socket): idle legs make room, 6 ACTIVE legs -> refused
  socks = [];
  const hub = new ISHub(store(), 'k', Object.assign({ WebSocket: FakeWS }, fast));
  await hub.loadLog();
  const hs = [];
  for (const iv of [1, 5, 15, 30, 60]) hs.push(hub.attach([{ code: 'CME_MINI:NQ1!', bar_type: 'minute', bar_interval: iv }], client()));
  assert.equal(hub.attach([{ code: 'CME_MINI:ES1!', bar_type: 'minute', bar_interval: 1 }], client()), null);
  hs[0].close();
  assert.ok(hub.attach([{ code: 'CME_MINI:ES1!', bar_type: 'minute', bar_interval: 1 }], client()));
  assert.equal(hub.legs.size, 5);
  ok('at most 5 legs on the socket; an idle leg is replaced, a 6th active leg is refused');
  hub.shutdown();
}

{
  // last viewer gone -> upstream closed after the idle window (no socket held for nobody)
  socks = [];
  const hub = new ISHub(store(), 'k', Object.assign({ WebSocket: FakeWS }, fast));
  await hub.loadLog();
  const h = hub.attach([NQ1], client());
  await sleep(20);
  h.close();
  await sleep(1400);
  assert.ok(socks[0].closed); assert.equal(hub.ws, null);
  ok('no viewers for LEG_IDLE_MS -> upstream socket closed');
  hub.shutdown();
}

console.log(`\n${n} checks passed`);
process.exit(0);
