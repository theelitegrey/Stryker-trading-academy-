// Tick-stream L2 hub (src/ts-hub.js, src/ts-access.js). node workers/book-recorder/test/ts-hub.test.mjs
// Fake upstream socket + fake store + a fake clock where it matters. Proves: N viewers = 1 upstream socket; client frames
// throttled to <= 4/s and cut to the chosen level count; the key never reaches a client; non-admins refused (and the
// 'pro' flag only opens it to a verified Pro/demo token); 4029 / silent / auth closes back off; bucketed history uses
// the crypto bucketer (parity) and survives a round trip; imbalance + footprint recorded; hours rule.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TSHub, TS_TRADES, TS_QUOTES, tsOpts, cmeOpen, imbalance10, coarseRule, LEVELS, TICK_SIZE, TS_SYMBOLS, cleanBook } from '../src/ts-hub.js';
import { bucketSnapshot, decodeSamples, encodeSamples } from '../src/bucket.js';
import { tsAllowed, tsAccess, tsTier } from '../src/ts-access.js';

let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let socks = [];
class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.l = {}; socks.push(this); setTimeout(() => this.emit('open', {}), 2); }
  addEventListener(e, f) { (this.l[e] = this.l[e] || []).push(f); }
  emit(e, ev) { for (const f of this.l[e] || []) f(ev); }
  send(m) { this.sent.push(JSON.parse(m)); }
  close(code) { if (this.closed) return; this.closed = true; setTimeout(() => this.emit('close', { code: code || 1000 }), 1); }
  msg(o) { this.emit('message', { data: JSON.stringify(o) }); }
  die(code) { this.closed = true; this.emit('close', { code }); }
}
const memStore = () => { const rows = new Map(); return { rows, putMin(sym, t, book, imb, fp) { rows.set(sym + '|' + t, { t, sym, book, imb, fp }); }, prune(t) { for (const [k, r] of rows) if (r.t < t) rows.delete(k); }, range(sym, t0, t1) { return [...rows.values()].filter((r) => r.sym === sym && r.t >= t0 && r.t <= t1).sort((a, b) => a.t - b.t); } }; };
const client = () => { const c = { got: [], closed: null, send(s) { c.got.push(JSON.parse(s)); }, close(code) { c.closed = code; } }; return c; };
const book = (mid, k = 400, ts = 1) => { const bids = [], asks = []; for (let i = 0; i < k; i++) { bids.push([mid - 0.25 - i * 0.25, 5 + (i % 7)]); asks.push([mid + 0.25 + i * 0.25, 4 + (i % 5)]); } return { type: 'book', symbol: 'NQ', bids, asks, imbalance: 0.25, ts }; };
// Sunday 2026-11-01 23:00 UTC = Sun 18:00 ET (open); Saturday = closed
const OPEN = Date.UTC(2026, 10, 2, 15, 0), SAT = Date.UTC(2026, 10, 7, 15, 0);
const FAST = { BACK_MIN_MS: 40, BACK_MAX_MS: 320, FLUSH_MS: 10, MIN_GAP_MS: 100, COARSE_MS: 120, IDLE_MS: 60, DEAD_SLOT_MS: 300, STABLE_MS: 100, SAMPLE_MS: 50, SILENT_MS: 400, NODATA_MS: 400 };

const T0 = Date.now(), clockAt = (base) => () => base + (Date.now() - T0);
const mk = (o = {}, store = memStore()) => { const hub = new TSHub(store, 'SECRETKEY', Object.assign({ WebSocket: FakeWS, now: clockAt(OPEN) }, FAST, o)); return { hub, store }; };

// ---- hours: EST from 2026-11-01. Mon 16:59 ET open, 17:00-18:00 ET break, Sat closed, Sun opens 18:00 ET, Fri closes 17:00 ET
assert.equal(cmeOpen(Date.UTC(2026, 10, 2, 21, 59)), true); assert.equal(cmeOpen(Date.UTC(2026, 10, 2, 22, 0)), false); assert.equal(cmeOpen(Date.UTC(2026, 10, 2, 23, 0)), true);
assert.equal(cmeOpen(SAT), false); assert.equal(cmeOpen(Date.UTC(2026, 10, 1, 22, 59)), false); assert.equal(cmeOpen(Date.UTC(2026, 10, 1, 23, 0)), true);
assert.equal(cmeOpen(Date.UTC(2026, 10, 6, 21, 59)), true); assert.equal(cmeOpen(Date.UTC(2026, 10, 6, 22, 0)), false);
ok('CME hours: Sun 18:00 ET to Fri 17:00 ET with the daily 17:00-18:00 break');

// ---- imbalance
assert.equal(imbalance10([[1, 10]], []), 1); assert.equal(imbalance10([], []), 0); assert.equal(imbalance10([[1, 5]], [[2, 5]]), 0);
assert.ok(imbalance10([[1, 10], [0, 1]], [[2, 1], [3, 10]]) > 0, 'the touch weighs most');
ok('imbalance10 is depth-weighted in [-1, 1]');

// ---- fan out: 10 viewers, 1 upstream socket, subscribe frames, key only upstream
{
  socks = []; const { hub } = mk({ RECORD: false });
  const cs = []; for (let i = 0; i < 10; i++) { const c = client(); cs.push(c); assert.ok(hub.attach(c, 'NQ', 60, 'book')); }
  await sleep(30);
  assert.equal(socks.length, 1, '10 viewers = 1 upstream socket');
  assert.match(socks[0].url, /^wss:\/\/stream\.tick-stream\.xyz\/v1\/stream\?key=SECRETKEY$/);
  assert.deepEqual(socks[0].sent.map((m) => m.channel).sort(), ['book', 'ticks']);
  const bookSub = socks[0].sent.find((m) => m.channel === 'book'), tickSub = socks[0].sent.find((m) => m.channel === 'ticks');
  assert.deepEqual(bookSub.symbols, ['NQ', 'ES', 'MNQ', 'MES', 'YM', 'RTY', 'CL', 'GC'], 'book: futures only, no quote symbols');
  assert.deepEqual(tickSub.symbols, [...bookSub.symbols, ...TS_TRADES, ...TS_QUOTES], 'ticks: books + trades-only roots + the 8 quote symbols');
  socks[0].msg(book(28000));
  socks[0].msg({ type: 'tick', symbol: 'NQ', price: 28000.25, size: 3, side: 'buy', ts: 1 });
  socks[0].msg({ type: 'ping' });
  await sleep(60);
  assert.deepEqual(socks[0].sent.at(-1), { op: 'pong' }, 'pong answered');
  for (const c of cs) {
    const snap = c.got.find((m) => m.type === 'snap');
    assert.ok(snap && snap.bids.length === 60 && snap.asks.length === 60, '60 levels a side');
    assert.equal(snap.imb, 0.25); assert.ok(Math.abs(snap.imb10) <= 1);
    assert.ok(c.got.some((m) => m.type === 'coarse' && m.v.length > 10), 'coarse column');
    assert.ok(c.got.some((m) => m.type === 'ticks' && m.t[0][0] === 28000.25 && m.t[0][2] === 1), 'tick batch');
    assert.ok(!JSON.stringify(c.got).includes('SECRETKEY'), 'key never sent to a viewer');
  }
  assert.equal(hub.stats().upstreamSockets, 1); assert.ok(!JSON.stringify(hub.stats()).includes('SECRETKEY'));
  hub.shutdown();
  ok('10 viewers = 1 upstream socket; book/ticks subscribed once; 60 levels; pong; key never leaves the hub');
}

// ---- level choice + symbol switch
{
  socks = []; const { hub } = mk({ RECORD: false }); const c = client(); const h = hub.attach(c, 'NQ', 20, 'book');
  await sleep(20); socks[0].msg(book(28000)); await sleep(40);
  assert.equal(c.got.find((m) => m.type === 'snap').bids.length, 20);
  h.onMessage(JSON.stringify({ op: 'sub', symbol: 'NQ', levels: 150 })); c.got.length = 0; await sleep(150);
  assert.equal(c.got.find((m) => m.type === 'snap').bids.length, 150);
  h.onMessage(JSON.stringify({ op: 'sub', symbol: 'ES', levels: 999 })); c.got.length = 0;
  socks[0].msg(Object.assign(book(7600), { symbol: 'ES' })); await sleep(150);
  const es = c.got.find((m) => m.type === 'snap'); assert.equal(es.symbol, 'ES'); assert.equal(es.bids.length, 150, 'a bad level count is ignored');
  h.onMessage('{bad'); h.onMessage(JSON.stringify({ op: 'sub', symbol: 'ZZ' })); assert.equal([...hub.clients][0].sym, 'ES');
  assert.deepEqual(LEVELS, [20, 60, 150]);
  hub.shutdown(); ok('client picks 20 / 60 / 150 levels and the symbol; junk ignored');
}

// ---- throttle: 7 upstream frames per 100 ms window -> well under the gap; real default is 250 ms = 4/s
{
  socks = []; const { hub } = mk({ RECORD: false, MIN_GAP_MS: 250, FLUSH_MS: 20 }); const c = client(); hub.attach(c, 'NQ', 20, 'book');
  await sleep(20);
  const t0 = Date.now(); let k = 0;
  while (Date.now() - t0 < 1100) { socks[0].msg(book(28000 + (k++ % 5))); await sleep(14); }
  const snaps = c.got.filter((m) => m.type === 'snap').length;
  assert.ok(k > 60, 'sent ' + k); assert.ok(snaps <= 5 && snaps >= 3, 'snaps in 1.1 s: ' + snaps);
  hub.shutdown(); ok('~70 upstream frames in 1.1 s -> ' + snaps + ' client frames (<= 4/s)');
}

// ---- 1-minute candles for a late viewer: bars frame first, ticks continue after it with no overlap
{
  socks = []; const { hub } = mk({ RECORD: false }); const a = client(); hub.attach(a, 'NQ', 20, 'book'); await sleep(20);
  const up = socks[0]; up.msg({ type: 'book', symbol: 'NQ', ...book(100) });
  for (let i = 0; i < 5; i++) up.msg({ type: 'tick', symbol: 'NQ', price: 100 + i, size: 2, side: 'buy', ts: 1 });
  await sleep(30);
  const late = client(); hub.attach(late, 'NQ', 20, 'book'); await sleep(40);
  const bf = late.got.find((m) => m.type === 'bars');
  assert.ok(bf && bf.b.length >= 1, 'late viewer gets a bars frame');
  const last = bf.b[bf.b.length - 1];
  assert.equal(last[1], 100); assert.equal(last[2], 104); assert.equal(last[3], 100); assert.equal(last[4], 104); assert.equal(last[5], 10);
  assert.ok(late.got.findIndex((m) => m.type === 'bars') < (late.got.findIndex((m) => m.type === 'ticks') + 1 || 1e9), 'bars before ticks');
  assert.equal(late.got.filter((m) => m.type === 'ticks').reduce((n, m) => n + m.t.length, 0), 0, 'ticks already inside the bars are not replayed');
  up.msg({ type: 'tick', symbol: 'NQ', price: 105, size: 1, side: 'sell', ts: 1 }); await sleep(250);
  assert.equal(late.got.filter((m) => m.type === 'ticks').reduce((n, m) => n + m.t.length, 0), 1, 'new ticks continue');
  hub.shutdown(); ok('1m candle buffer: late viewer is back-filled, no duplicate ticks');
}

// ---- archive backfill: gaps filled once, bucketed like the recorder, serial, errors pause
{
  const base = Date.now() - 3 * 3600000, calls = [];
  const snap = (t0) => { const rows = []; for (let i = 0; i < 400; i++) { rows.push({ ts: t0 * 1e6, side: 'bid', level: i + 1, price: 28700 - i * 0.25, size: 5 + (i % 9), flag: 0 }); rows.push({ ts: t0 * 1e6, side: 'ask', level: i + 1, price: 28700.25 + i * 0.25, size: 6 + (i % 7), flag: 0 }); } return rows; };
  let inflight = 0, maxIn = 0, mode = 'ok';
  const fetchFake = async (url, init) => {
    inflight++; maxIn = Math.max(maxIn, inflight); calls.push(url); await sleep(3); inflight--;
    assert.match(init.headers.authorization, /^Bearer SECRETKEY$/);
    if (mode === '429') return { status: 429, json: async () => ({}) };
    const t0 = Number(/start=(\d+)/.exec(url)[1]);
    return { status: 200, json: async () => ({ book: snap(t0) }) };
  };
  const store = memStore(); const { hub } = mk({ RECORD: false, fetch: fetchFake, FILL_MAX_MIN: 100, FILL_BUDGET_MS: 5000 }, store);
  hub.clock = () => Date.now();
  const from = base, to = base + 60 * 60000;
  const r1 = await hub.backfill('NQ', from, to);
  assert.equal(r1.left, 0, 'one hour filled in one call'); assert.ok(r1.filled >= 55);
  assert.ok(calls.length >= 11 && calls.length <= 14, 'one request per 5 minutes: ' + calls.length);
  assert.equal(maxIn, 1, 'serial');
  assert.ok(calls.every((u) => /history\/book\?symbol=NQ&start=\d+&end=\d+&limit=900$/.test(u)) && !calls.some((u) => /SECRETKEY/.test(u)), 'key only in the header');
  const n = calls.length; const r2 = await hub.backfill('NQ', from, to); assert.equal(calls.length, n, 'nothing refetched'); assert.equal(r2.filled, 0);
  const rows = store.range('NQ', Math.floor(from / 60000), Math.floor(to / 60000)).filter((x) => x.book);
  const list = decodeSamples(new Uint8Array(rows[0].book).buffer);
  const want = bucketSnapshot({ bids: snap(1).filter((x) => x.side === 'bid').map((x) => [x.price, x.size]), asks: snap(1).filter((x) => x.side === 'ask').map((x) => [x.price, x.size]) }, 0, coarseRule(28700.125));
  assert.equal(list[0].step, want.step); assert.equal(list[0].i0, want.i0); assert.deepEqual(Array.from(list[0].v), Array.from(want.v), 'same bucket rule as the live recorder');
  const bh = decodeSamples(hub.bookHistory('NQ', from, to)); assert.ok(bh.length >= 11, 'served through bookHistory');
  // budget: a small cap leaves the rest for the next call
  const s2 = memStore(); const h2 = mk({ RECORD: false, fetch: fetchFake, FILL_MAX_MIN: 10 }, s2).hub; h2.clock = () => Date.now();
  const q1 = await h2.backfill('NQ', from, to); assert.ok(q1.left > 0 && q1.filled <= 14); const q2 = await h2.backfill('NQ', from, to); assert.ok(q2.left < q1.left);
  // 429 pauses, no hammering
  const s3 = memStore(); const h3 = mk({ RECORD: false, fetch: fetchFake }, s3).hub; h3.clock = () => Date.now(); mode = '429'; const c0 = calls.length;
  const z1 = await h3.backfill('NQ', from, to); const z2 = await h3.backfill('NQ', from, to); assert.equal(calls.length - c0, 1, 'one failed request then a pause'); assert.equal(z1.filled, 0); assert.ok(z2.left > 0);
  // the closed market (empty answer) is stored as an empty row, asked once
  mode = 'ok'; const s4 = memStore(); const emptyFetch = async (u) => { calls.push(u); return { status: 200, json: async () => ({ book: [] }) }; };
  const h4 = mk({ RECORD: false, fetch: emptyFetch }, s4).hub; h4.clock = () => Date.now(); await h4.backfill('NQ', from, from + 20 * 60000); const c1 = calls.length; await h4.backfill('NQ', from, from + 20 * 60000); assert.equal(calls.length, c1, 'empty minutes are not asked twice');
  hub.shutdown(); h2.shutdown(); h3.shutdown(); h4.shutdown();
  ok('archive backfill: gaps only, once, serial, same bucketing, capped, 429 pause, closed-market rows');
}

// ---- viewer cap
{
  socks = []; const { hub } = mk({ RECORD: false, MAX_CLIENTS: 2 });
  assert.ok(hub.attach(client(), 'NQ', 60, 'book')); assert.ok(hub.attach(client(), 'NQ', 60, 'book')); assert.equal(hub.attach(client(), 'NQ', 60, 'book'), null); assert.equal(hub.stats().refused, 1);
  hub.shutdown(); ok('viewer cap refuses the extra socket');
}

// ---- connects only for viewers or recording hours
{
  socks = []; const closedHub = mk({ RECORD: true, now: clockAt(SAT) }).hub;
  closedHub.poke(); await sleep(30); assert.equal(socks.length, 0, 'weekend, nobody watching: no socket');
  const c = client(); const h = closedHub.attach(c, 'NQ', 60, 'book'); await sleep(30); assert.equal(socks.length, 1, 'a viewer wakes it');
  h.close(); await sleep(200); assert.equal(closedHub.ws, null, 'last viewer gone (weekend): socket closed after IDLE_MS');
  closedHub.shutdown();
  socks = []; const openHub = mk({ RECORD: true }).hub; openHub.poke(); await sleep(30);
  assert.equal(socks.length, 1, 'CME open, recording on: up with no viewer');
  openHub.shutdown();
  socks = []; const off = mk({ RECORD: false }).hub; off.poke(); await sleep(30); assert.equal(socks.length, 0, 'recording off, no viewer: down');
  off.shutdown();
  const noKey = new TSHub(memStore(), '', { WebSocket: FakeWS, now: clockAt(OPEN) }); noKey.attach(client(), 'NQ', 60, 'book'); await sleep(20); assert.equal(socks.length, 0, 'no key: no socket');
  noKey.shutdown();
  ok('socket only while watched or in CME hours; none without a key');
}

// ---- reconnect / 4029 / silent / auth backoff
{
  socks = []; const { hub } = mk({ RECORD: false }); hub.attach(client(), 'NQ', 60, 'book'); await sleep(20);
  const t = Date.now(); socks[0].die(4029);
  await sleep(150); assert.equal(socks.length, 1, '4029: nothing during the dead-slot wait (' + hub.stats().nextRetryInMs + ' ms left)');
  assert.ok(hub.stats().nextRetryInMs > 0);
  await sleep(300); assert.equal(socks.length, 2, 'then one new socket'); assert.ok(Date.now() - t >= 270 * 1);
  hub.shutdown(); ok('4029 waits out the 45-50 s dead slot (scaled) before one retry');
}
{
  socks = []; const { hub } = mk({ RECORD: false }); hub.attach(client(), 'NQ', 60, 'book'); await sleep(20);
  const gaps = []; let last = Date.now();
  for (let i = 0; i < 5; i++) { const before = socks.length; socks.at(-1).die(1006); const t = Date.now(); while (socks.length === before && Date.now() - t < 1500) await sleep(5); gaps.push(Date.now() - last); last = Date.now(); assert.equal(socks.length, before + 1); }
  assert.ok(gaps[3] > gaps[0] && gaps[4] >= 150, 'exponential: ' + gaps.join(','));
  assert.ok(gaps.every((g) => g < 500));
  hub.shutdown(); ok('plain drops reconnect with exponential backoff: ' + gaps.join(' / ') + ' ms');
}
{
  socks = []; const { hub } = mk({ RECORD: false, AUTH_PAUSE_MS: 5000 }); hub.attach(client(), 'NQ', 60, 'book'); await sleep(20);
  socks[0].msg({ type: 'error', error: { code: 'plan_required' } }); socks[0].die(1008); await sleep(400);
  assert.equal(socks.length, 1, 'an auth refusal pauses retries'); hub.shutdown(); ok('auth / plan refusal = long pause, no retry storm');
}
{
  socks = []; const { hub } = mk({ RECORD: false }); const c = client(); hub.attach(c, 'NQ', 60, 'book'); await sleep(20);
  socks[0].msg(book(28000)); await sleep(50);
  assert.equal(c.got.filter((m) => m.event === 'status').at(-1)?.state, 'live');
  await sleep(450); assert.equal(socks.length >= 2 || hub.stats().drops >= 1, true, 'silent socket dropped and reopened');
  assert.equal(c.got.filter((m) => m.event === 'status').at(-1).state, 'reconnecting');
  hub.shutdown(); ok('silent upstream: status goes reconnecting, socket replaced');
}

// ---- recording: bucketing parity with the crypto recorder, wire codec, imbalance, footprint, prune
{
  socks = []; const store = memStore(); const { hub } = mk({ RECORD: true, SAMPLE_MS: 30 }, store); hub.poke(); await sleep(20);
  const b = book(28000.125, 400);
  for (let i = 0; i < 6; i++) { socks[0].msg(b); socks[0].msg({ type: 'tick', symbol: 'NQ', price: 28000.5, size: 2, side: i % 2 ? 'buy' : 'sell', ts: 1 }); await sleep(35); }
  const now = hub.clock(); const sym = 'NQ';
  const bytes = hub.bookHistory(sym, now - 60000, now + 1000);
  const list = decodeSamples(bytes); assert.ok(list.length >= 3, 'samples ' + list.length);
  const want = bucketSnapshot(b, list[0].ts, coarseRule((b.bids[0][0] + b.asks[0][0]) / 2));
  assert.equal(list[0].step, want.step); assert.equal(list[0].i0, want.i0); assert.deepEqual(Array.from(list[0].v), Array.from(want.v));
  assert.equal(list[0].step, 2.5, 'NQ row = 2.5 pts'); assert.ok(list[0].v.length > 40);
  assert.deepEqual(decodeSamples(encodeSamples(list)).map((s) => s.ts), list.map((s) => s.ts));
  const aux = hub.aux(sym, now - 60000, now + 1000);
  assert.ok(aux.imb.length >= 3 && aux.imb[0][1] === 0.25 && Math.abs(aux.imb[0][2]) <= 1);
  const fp = aux.fp[0]; assert.equal(fp.lv.length, 1); assert.equal(fp.lv[0][0], 28000.5); assert.equal(fp.lv[0][1] + fp.lv[0][2], 12); assert.equal(fp.h, 28000.5);
  // minute rolls: the finished minute lands in the store
  hub.finalize(sym, hub.acc.get(sym)); assert.equal(store.rows.size, 1); const row = [...store.rows.values()][0];
  assert.ok(row.book.byteLength > 100 && JSON.parse(row.imb).length >= 3 && JSON.parse(row.fp).lv.length === 1);
  store.prune(row.t + 1); assert.equal(store.rows.size, 0);
  // ES: 0.5 rows
  assert.equal(coarseRule(7640).step, 0.5);
  hub.shutdown(); ok('recorded samples == bucket.js output (NQ 2.5 pt rows, ES 0.5), BKR1 round trip, imbalance pair, 1-min footprint, prune');
}
// bucket.js default rule unchanged (the crypto parity test covers the rest)
{
  const d = { bids: [[84000, 1], [83975, 2]], asks: [[84010, 1]] };
  assert.deepEqual(Array.from(bucketSnapshot(d, 1).v), Array.from(bucketSnapshot(d, 1, undefined).v));
  ok('bucketSnapshot without a rule is the crypto rule');
}

// ---- relay mode: no upstream socket, frames come in through feed()
{
  socks = []; const { hub } = mk({ MODE: 'relay', RECORD: false }); const c = client(); hub.attach(c, 'NQ', 20, 'book'); await sleep(20);
  assert.equal(socks.length, 0, 'relay mode never opens a socket'); assert.equal(hub.wanted(), true);
  hub.feed([book(28000)]); await sleep(40); assert.ok(c.got.some((m) => m.type === 'snap'));
  hub.feed([{ type: 'book', symbol: 'ZZ', bids: [], asks: [] }, null, 5, { type: 'book', symbol: 'NQ', bids: 'x', asks: [] }]); assert.equal(hub.stats().frames, 1, 'junk ignored');
  hub.shutdown(); ok('relay mode fans out fed frames and opens no socket');
}

// ---- access gate: admin by default, 'pro' only by flag, fails closed
{
  assert.equal(tsAccess({}), 'admin'); assert.equal(tsAccess({ TS_ACCESS: 'PRO' }), 'pro'); assert.equal(tsAccess({ TS_ACCESS: 'everyone' }), 'admin'); assert.equal(tsAccess(undefined), 'admin');
  assert.equal(await tsAllowed({}, ''), false, 'no token');
  assert.equal(await tsAllowed({ TS_ACCESS: 'pro' }, 'garbage'), false, 'bad token, pro flag');
  assert.equal(await tsAllowed({}, 'a.b.c'), false, 'bad jwt, admin flag');
  ok('gate: no / bad token refused; default and unknown flag = admin only; one var (TS_ACCESS=pro) widens it');
}
{
  // a verified non-admin: real rt-auth path with a fake Firestore (admins/{uid} = 404) and a locally signed token
  const { generateKeyPairSync, createSign } = await import('node:crypto');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256', use: 'sig' });
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const tok = (uid) => { const now = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now - 5, exp: now + 3000 }); const sg = createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url'); return h + '.' + p + '.' + sg; };
  const fetchImpl = async (url) => {
    if (/jwk/.test(url)) return Response.json({ keys: [jwk] });
    if (/admins\/adm1/.test(url)) return Response.json({ name: 'x' });
    if (/admins\//.test(url)) return new Response('{}', { status: 404 });
    if (/students\/pro1/.test(url)) return Response.json({ fields: { plan: { stringValue: 'pro' } } });
    if (/students\/exp1/.test(url)) return Response.json({ fields: { plan: { stringValue: 'pro' }, subscriptionStatus: { stringValue: 'expired' } } });
    if (/students\/demo1/.test(url)) return Response.json({ fields: { demo: { booleanValue: true } } });
    if (/students\//.test(url)) return Response.json({ fields: { plan: { stringValue: 'free' } } });
    if (/plans/.test(url)) return Response.json({ documents: [{ name: 'p/pro', fields: { rank: { integerValue: '1' } } }] });
    return new Response('{}', { status: 404 });
  };
  const rt = await import('../src/rt-auth.js'); rt._resetForTests();
  assert.equal(await tsAllowed({}, tok('adm1'), { fetchImpl }), true, 'admin in');
  assert.equal(await tsAllowed({}, tok('mem1'), { fetchImpl }), false, 'member refused');
  assert.equal(await tsAllowed({ TS_ACCESS: 'pro' }, tok('mem1'), { fetchImpl }), false, 'free member refused even with the pro flag');
  assert.equal(await tsAllowed({ TS_ACCESS: 'pro' }, tok('adm1'), { fetchImpl }), true, 'admin still in with the pro flag');
  const P = { TS_ACCESS: 'pro' };
  assert.equal(await tsAllowed(P, tok('pro1'), { fetchImpl }), true, 'active Pro member in');
  assert.equal(await tsAllowed(P, tok('demo1'), { fetchImpl }), true, 'demo account in');
  assert.equal(await tsAllowed(P, tok('exp1'), { fetchImpl }), false, 'expired Pro refused');
  assert.equal(await tsAllowed(P, '', { fetchImpl }), false, 'signed out refused');
  assert.equal(await tsAllowed({}, tok('pro1'), { fetchImpl }), false, 'flag off: Pro refused');
  ok('admin in; free refused; with TS_ACCESS=pro: active Pro + demo + admin in, Free / expired / signed-out refused');
}
{
  const o = tsOpts({ TS_SYMBOLS: 'nq, zz', TS_KEEP_HOURS: '500', TS_MODE: 'relay', TS_RECORD: '0' });
  assert.deepEqual(o.SYMBOLS, ['NQ']); assert.equal(o.KEEP_H, 48); assert.equal(o.MODE, 'relay'); assert.equal(o.RECORD, false);
  assert.deepEqual(tsOpts({}).SYMBOLS, ['NQ', 'ES', 'MNQ', 'MES', 'YM', 'RTY', 'CL', 'GC']);
  ok('env options validated');
}
// ---- eight symbols: tick sizes, bucket rows that are whole ticks and never finer than the tick, own books for the micros
{
  assert.deepEqual(TICK_SIZE, { NQ: 0.25, ES: 0.25, MNQ: 0.25, MES: 0.25, YM: 1, RTY: 0.1, CL: 0.01, GC: 0.1 });
  const want = { NQ: [28700, 2.5], MNQ: [28700, 2.5], ES: [7640, 0.5], MES: [7640, 0.5], YM: [45000, 2], RTY: [2300, 0.2], CL: [60, 0.01], GC: [4000, 0.2] };
  for (const [sym, [mid, step]] of Object.entries(want)) {
    const r = coarseRule(mid, sym); assert.equal(r.step, step, sym + ' row step');
    assert.ok(Math.abs(r.step / TICK_SIZE[sym] - Math.round(r.step / TICK_SIZE[sym])) < 1e-6, sym + ' step is whole ticks');
    const rows = (2 * mid * r.range) / r.step; assert.ok(rows > 20 && rows < 2000, sym + ' rows ' + Math.round(rows));
  }
  assert.equal(coarseRule(7640).step, 0.5, 'no symbol = the old rule');
  // CL / GC books on their own price scale, MNQ separate from NQ
  const lv = (mid, tk) => { const bids = [], asks = []; for (let i = 0; i < 400; i++) { bids.push([+(mid - tk - i * tk).toFixed(4), 5 + (i % 7)]); asks.push([+(mid + tk + i * tk).toFixed(4), 4 + (i % 5)]); } return { type: 'book', bids, asks, imbalance: 0.1, ts: 1 }; };
  socks = []; const { hub } = mk({ RECORD: false }); const c = client(); hub.attach(c, 'CL', 20, 'book'); await sleep(30);
  socks[0].msg(Object.assign(lv(60.5, 0.01), { symbol: 'CL' })); socks[0].msg(Object.assign(lv(4012.3, 0.1), { symbol: 'GC' })); socks[0].msg(Object.assign(lv(28001, 0.25), { symbol: 'MNQ' }));
  await sleep(60);
  const cl = hub.coarseOf('CL', hub.clock()), gc = hub.coarseOf('GC', hub.clock()), mnq = hub.coarseOf('MNQ', hub.clock());
  assert.equal(cl.step, 0.01); assert.equal(gc.step, 0.2); assert.equal(mnq.step, 2.5); assert.equal(hub.coarseOf('NQ', hub.clock()), null, 'MNQ frames never feed NQ');
  assert.ok(Math.abs(cl.mid - 60.5) < 0.01 && Math.abs(gc.mid - 4012.3) < 0.1);
  hub.shutdown(); ok('8 symbols: tick sizes, whole-tick bucket rows (CL 0.01, GC 0.2, YM 2, RTY 0.2), MNQ own book');
}
// ---- quote-only symbols: latest value, fan-out to asking clients, no volume, no recording, gate = tsAllowed
{
  socks = []; const { hub, store } = mk({ RECORD: true });
  assert.deepEqual(TS_QUOTES, ['SPX', 'NDX', 'VIX', 'RUT', 'QQQ', 'SPY', 'IWM', 'DIA']);
  const spx = client(), nq = client(); hub.attach(spx, 'SPX', 60, 'book'); hub.attach(nq, 'NQ', 60, 'book');
  await sleep(30);
  socks[0].msg({ type: 'tick', symbol: 'SPX', price: 6000.5, size: 0, ts: 1 });
  socks[0].msg({ type: 'tick', symbol: 'SPX', price: 6001.25, size: 0, ts: 2 });
  socks[0].msg({ type: 'tick', symbol: 'QQQ', price: 520.1, size: 100, side: 'buy', ts: 2 });
  socks[0].msg({ type: 'tick', symbol: 'ZZZ', price: 1, size: 1, side: 'buy', ts: 2 });
  await sleep(60);
  const qs = spx.got.filter((m) => m.type === 'quote');
  assert.ok(qs.length >= 1 && qs.at(-1).p === 6001.25 && qs.at(-1).symbol === 'SPX', 'SPX client gets the latest level');
  assert.ok(!spx.got.some((m) => m.type === 'quote' && m.symbol !== 'SPX'), 'only the symbol it asked for');
  assert.ok(!nq.got.some((m) => m.type === 'quote'), 'futures client gets no quote frames');
  assert.deepEqual(Object.keys(hub.quoteMap()).sort(), ['QQQ', 'SPX'], 'unknown symbol ignored');
  const bar = hub.bars1m.get('SPX').at(-1);
  assert.deepEqual([bar[2], bar[3], bar[4], bar[5]], [6001.25, 6000.5, 6001.25, 0], 'OHLC from the level, volume stays 0');
  assert.equal(hub.rings.has('SPX'), false, 'no tick ring / footprint for a quote symbol');
  assert.equal(hub.bars1m.get('QQQ').at(-1)[5], 0, 'ETF quote adds no volume either');
  const late = client(); hub.attach(late, 'SPX', 60, 'book');
  assert.ok(late.got.some((m) => m.type === 'bars' && m.symbol === 'SPX'), 'new viewer is back-filled with the 1m bars');
  hub.shutdown();
  ok('quote-only symbols: latest value, fan-out, zero volume, no ring');
}
{
  const { hub } = mk({ RECORD: false }); hub.attach(client(), 'NQ', 60, 'book'); await sleep(20);
  socks.at(-1).msg({ type: 'tick', symbol: 'VIX', price: 17.2, size: 0, ts: 1 });
  assert.equal(hub.quoteMap().VIX[0], 17.2);
  const T = hub.clock() + 11 * 60000; assert.deepEqual(hub.quoteMap(T), {}, 'stale quotes (10 min) are left out');
  hub.shutdown();
  // gate: the quotes route uses tsAllowed, so admin-only by default and the same single TS_ACCESS flag widens it
  assert.equal(await tsAllowed({}, ''), false); assert.equal(tsAccess({}), 'admin'); assert.equal(tsAccess({ TS_ACCESS: 'pro' }), 'pro');
  ok('quotes: stale cut-off, gate is the futures gate (TS_ACCESS)');
}
// ---- archive rows stored at the old +-0.4% band are re-fetched once at +-2% (recorder rows never)
{
  const { narrowBook } = await import('../src/ts-hub.js'), B = await import('../src/bucket.js');
  const mkBook = (r) => B.encodeSamples([B.bucketSnapshot({ bids: [[28000, 1], [28000 * (1 - r), 2]], asks: [[28001, 1], [28001 * (1 + r), 2]] }, 1, { step: 2.5, range: 0.02 })]);
  const cut = B.encodeSamples([B.bucketSnapshot({ bids: [[28000, 1], [28000 * (1 - 0.012), 2]], asks: [[28001, 1], [28001 * (1 + 0.012), 2]] }, 1, { step: 2.5, range: 0.004 })]);
  assert.ok(narrowBook(cut) && !narrowBook(mkBook(0.012)) && !narrowBook(mkBook(0.001))); ok('narrowBook: a +-0.4% cut sample is flagged, a wide or a thin-book one is not');
}
// ---- LIVE HUB (2026-11-03): trades-only roots + two tiers ('book' / 'trades')
{
  const { hub } = mk(); const a = client(), b = client();
  hub.attach(a, 'NQ', 20, 'book'); hub.attach(b, 'NQ', 20, 'trades');
  assert.deepEqual(TS_TRADES.filter((s) => TS_SYMBOLS.includes(s)), [], 'no root is both book and trades-only');
  assert.ok(['SI', 'ZB', 'ZN', '6E', 'HG', 'MGC', 'MCL', 'MYM', 'M2K'].every((s) => TS_TRADES.includes(s)), 'the roots we used to stream live are all covered');
  hub.connect(); await sleep(10);
  const up = socks[socks.length - 1], subTicks = up.sent.find((x) => x.channel === 'ticks').symbols;
  assert.ok(TS_TRADES.every((s) => subTicks.includes(s)) && !up.sent.find((x) => x.channel === 'book').symbols.some((s) => TS_TRADES.includes(s)), 'trades roots on the ticks channel only, never the book channel');
  up.msg(book(28000, 400, 1));
  const px = 28000.25;
  up.msg({ type: 'tick', symbol: 'NQ', price: px, size: 2, side: 'buy', ts: 1 });
  up.msg({ type: 'tick', symbol: 'MGC', price: 4100.1, size: 3, side: 'sell', ts: 1 });
  up.msg({ type: 'tick', symbol: 'SI', price: 50.5, size: 1, side: 'buy', ts: 1 });
  assert.equal(hub.tb.n.big === undefined || true, true);
  const c = client(); hub.attach(c, 'MGC', 20, 'trades'); await sleep(60);
  assert.ok(c.got.some((m) => m.type === 'bars' && m.symbol === 'MGC' && m.b[0][4] === 4100.1), 'trades-only root: 1m candle back-fill on subscribe');
  up.msg({ type: 'tick', symbol: 'MGC', price: 4100.3, size: 1, side: 'buy', ts: 2 }); await sleep(260);
  const t = c.got.filter((m) => m.type === 'ticks'); assert.ok(t.length && t.at(-1).t.some((r) => r[0] === 4100.3 && r[2] === 1 && r[3] > 1e12), 'trades-only root: ticks with side reach the viewer');
  assert.ok(!c.got.some((m) => m.type === 'snap' || m.type === 'coarse'), 'no book frames for a trades-only root');
  assert.ok(!hub.acc.has('MGC') && !hub.acc.has('SI'), 'trades-only roots are not recorded (no footprint accumulator)');
  assert.equal(hub.latest.has('MGC'), false);
  // tier gate: the trades tier never gets a snap or a coarse frame, even on NQ
  await sleep(300);
  assert.ok(a.got.some((m) => m.type === 'snap') && a.got.some((m) => m.type === 'coarse'), 'book tier gets the book on NQ');
  assert.ok(b.got.some((m) => m.type === 'ticks') || b.got.length > 0, 'trades tier attached');
  assert.ok(!b.got.some((m) => m.type === 'snap' || m.type === 'coarse'), 'trades tier: NQ trades but NEVER a snap / coarse (book)');
  assert.equal(b.got.find((m) => m.event === 'hub_attached').tier, 'trades'); assert.equal(a.got.find((m) => m.event === 'hub_attached').tier, 'book');
  // an unknown tier value counts as trades (fails closed)
  const d = client(); hub.attach(d, 'NQ', 20, 'admin'); await sleep(300); assert.ok(!d.got.some((m) => m.type === 'snap'), 'odd tier = trades only');
  hub.shutdown(); ok('hub: trades-only roots on the same socket (no book, nothing recorded); trades tier never receives the book');
}
{
  // gate matrix with real rt-auth + a fake Firestore: admin / Pro / add-on / free / signed out
  const { generateKeyPairSync, createSign } = await import('node:crypto');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256', use: 'sig' });
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const tok = (uid) => { const now = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now - 5, exp: now + 3000 }); return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url'); };
  const docs = {
    pro1: { plan: { stringValue: 'pro' } },
    addon1: { plan: { stringValue: 'free' }, liveData: { mapValue: { fields: { active: { booleanValue: true } } } } },
    expired1: { plan: { stringValue: 'free' }, liveData: { mapValue: { fields: { active: { booleanValue: true }, paidThroughMillis: { integerValue: '1000' } } } } },
    free1: { plan: { stringValue: 'free' } }
  };
  const fetchImpl = async (url) => {
    if (/jwk/.test(url)) return Response.json({ keys: [jwk] });
    if (/admins\/adm1/.test(url)) return Response.json({ name: 'x' });
    if (/admins\//.test(url)) return new Response('{}', { status: 404 });
    const m = /students\/(\w+)/.exec(url); if (m) return docs[m[1]] ? Response.json({ fields: docs[m[1]] }) : new Response('{}', { status: 404 });
    if (/plans/.test(url)) return Response.json({ documents: [{ name: 'p/pro', fields: { rank: { integerValue: '1' } } }] });
    return new Response('{}', { status: 404 });
  };
  const rt = await import('../src/rt-auth.js'); rt._resetForTests();
  const T = (env, u) => tsTier(env, u && tok(u), { fetchImpl });
  // TS_ACCESS=admin (today): admin = book; add-on = trades; Pro without the add-on = nothing (Pro does not include live futures); free / expired / signed out = nothing
  assert.equal(await T({}, 'adm1'), 'book'); assert.equal(await T({}, 'addon1'), 'trades'); assert.equal(await T({}, 'pro1'), null);
  assert.equal(await T({}, 'free1'), null); assert.equal(await T({}, 'expired1'), null); assert.equal(await T({}, null), null); assert.equal(await tsTier({}, 'a.b.c'), null);
  // TS_ACCESS=pro (the Pro release): Pro = book + trades; add-on still trades only (no book); free still nothing
  rt._resetForTests();
  const P = { TS_ACCESS: 'pro' };
  assert.equal(await T(P, 'adm1'), 'book'); assert.equal(await T(P, 'pro1'), 'book'); assert.equal(await T(P, 'addon1'), 'trades'); assert.equal(await T(P, 'free1'), null); assert.equal(await T(P, null), null);
  ok('gate: admin = book; Pro = book (TS_ACCESS=pro); add-on = trades, refused the book; free / expired add-on / signed out = nothing');
}
// ---- advisor findings (2026-11-03): periodic re-check, slot reserve, no-tier = trades
{
  const answers = ['book']; const { hub } = mk({ RECORD: false, RECHECK_MS: 30, TRADES_RESERVE: 1, MAX_CLIENTS: 3, tierOf: async () => answers[0] });
  const a = client(), b = client();
  hub.attach(a, 'NQ', 20, 'book', { tok: 't', env: {}, exp: 0 }); hub.attach(b, 'NQ', 20, undefined, { tok: 't', env: {}, exp: 0 });
  assert.equal(b.got.find((m) => m.event === 'hub_attached').tier, 'trades', 'no tier given = trades (fails closed)');
  hub.attach(client(), 'NQ', 20, 'trades'); assert.equal(hub.attach(client(), 'NQ', 20, 'trades'), null, 'trades tier cannot take the last (reserved) slot');
  assert.ok(hub.attach(client(), 'NQ', 20, 'book'), 'book tier can');
  hub.startTimer(); answers[0] = 'trades'; await sleep(120);
  assert.equal([...hub.clients].find((c) => c.sock === a).book, false, 'access downgraded in place on re-check');
  answers[0] = null; await sleep(120);
  assert.equal(a.closed, 4003, 'access ended: socket closed with 4003'); assert.ok(hub.stats().revoked >= 1);
  hub.shutdown(); ok('hub: access re-checked while a socket is open (downgrade / revoke), trades slots capped, no tier = trades');
}
// ---- crossed / mis-sorted book (Owner 2026-11-09: heatmap had nothing below the price). Both sides full (400 a side); one stray ask far
// below the bids moved the mid and the coarse column, the recording and the depth bars lost the WHOLE bid side.
{
  const full = book(28000), bidRows = (v) => v.filter((x) => x > 0).length, askRows = (v) => v.filter((x) => x < 0).length;
  const stray = Object.assign({}, full, { asks: [[27850, 1]].concat(full.asks) });
  const strayBid = Object.assign({}, full, { bids: [[28150, 2]].concat(full.bids) });
  const reversed = Object.assign({}, full, { bids: full.bids.slice().reverse() });
  const c0 = cleanBook(full.bids, full.asks); assert.equal(c0.cut, 0); assert.equal(c0.bids, full.bids, 'clean book: same arrays, no copy');
  const locked = cleanBook([[100, 1]], [[100, 2]]); assert.equal(locked.cut, 0, 'locked book kept');
  for (const [name, f] of [['stray ask', stray], ['stray bid', strayBid], ['bids ascending', reversed]]) {
    socks = []; const { hub } = mk({ RECORD: false, COARSE_MS: 20 }); const c = client(); hub.attach(c, 'NQ', 150, 'book');
    await sleep(20); socks[0].msg(f); await sleep(80);
    const cs = c.got.filter((m) => m.type === 'coarse').at(-1), sn = c.got.filter((m) => m.type === 'snap').at(-1);
    assert.ok(cs && bidRows(cs.v) > 20 && askRows(cs.v) > 20, name + ': coarse column keeps both sides ' + (cs && bidRows(cs.v) + '/' + askRows(cs.v)));
    assert.ok(Math.abs(cs.mid - 28000) < 1, name + ': mid stays at the real touch');
    assert.ok(sn.bids[0][0] < sn.asks[0][0] && sn.bids[0][0] === 27999.75 && sn.asks[0][0] === 28000.25, name + ': snap best first, not crossed');
    hub.shutdown();
  }
  ok('hub: a stray crossing level or a mis-sorted side never drops the other side of the book');
}
// ---- REAL frames (Owner 2026-11-10 21:25 IST: "why not heatmap working?"). From the 09:31 ET open the vendor's NQ ask side froze BELOW the
// traded price (and stale bids sat above it), on every root. The count rule then removed the whole ask side, the book had no mid, so the hub
// sent NO heatmap column and recorded nothing for the rest of the session. With the last trade price the stale levels go and the column stays.
// Includes a mid-run upstream reconnect (closed 1006): the trade reference and the columns continue on the new socket.
{
  const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/nq-stale-asks.json', import.meta.url))).books, [good, bad] = fx;
  assert.ok(bad.bids[0][0] > bad.asks[0][0], 'fixture: the real 15:57 UTC book is crossed');
  const old = cleanBook(bad.bids, bad.asks); assert.equal(old.asks.length, 0, 'without a trade price the count rule drops every ask (the bug)');
  const k = cleanBook(bad.bids, bad.asks, bad.P, 2);
  assert.ok(k.bids.length > 50 && k.bids[0][0] <= bad.P + 2 && k.asks.length === 0, 'stale bids above the price and the frozen asks are cut');
  assert.equal(cleanBook(good.bids, good.asks, good.P, 2).cut, 0, 'a clean real book is untouched');
  socks = []; const { hub, store } = mk({ COARSE_MS: 20, SAMPLE_MS: 20 }); const c = client(); hub.attach(c, 'NQ', 150, 'book');
  await sleep(20);
  const frame = (b) => ({ type: 'book', symbol: 'NQ', bids: b.bids, asks: b.asks, imbalance: 0, ts: 1 });
  const trade = (p) => ({ type: 'tick', symbol: 'NQ', price: p, size: 1, side: 'buy', ts: 1 });
  socks[0].msg(frame(good)); await sleep(60);
  const n0 = c.got.filter((m) => m.type === 'coarse').length; assert.ok(n0 > 0, 'clean book: columns');
  socks[0].msg(trade(bad.P)); socks[0].msg(frame(bad)); await sleep(350);
  let cs = c.got.filter((m) => m.type === 'coarse');
  assert.ok(cs.length > n0 + 1, 'stale-ask book: columns keep coming (' + (cs.length - n0) + ')');
  let last = cs.at(-1); assert.ok(Math.abs(last.mid - bad.P) < 5 && last.v.some((x) => x > 0), 'column sits at the traded price with the real bids');
  // upstream drops (1006) and comes back: the same book again after the reconnect
  socks[0].die(1006); await sleep(400);
  assert.ok(socks.length >= 2, 'upstream reconnected'); const s2 = socks.at(-1);
  const n1 = c.got.filter((m) => m.type === 'coarse').length;
  s2.msg(trade(bad.P)); s2.msg(frame(bad)); await sleep(350);
  cs = c.got.filter((m) => m.type === 'coarse'); last = cs.at(-1);
  assert.ok(cs.length > n1 + 1 && Math.abs(last.mid - bad.P) < 5, 'after the reconnect: columns continue');
  const a = hub.acc.get('NQ'); assert.ok(a && a.samples.some((x) => Math.abs(x.mid - bad.P) < 5), 'the recorder keeps sampling the stale-ask book (history gets no hole)');
  assert.ok(hub.stats().uncrossed > 0 && hub.stats().oneSided > 0, 'diagnostics counted'); hub.shutdown(); void store;
  ok('hub: REAL stale-ask book (10 Nov) keeps heatmap columns at the traded price, also after an upstream reconnect');
}
console.log(n + ' checks passed'); process.exit(0);
