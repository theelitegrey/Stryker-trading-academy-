// Tick-stream L2 hub (src/ts-hub.js, src/ts-access.js). node workers/book-recorder/test/ts-hub.test.mjs
// Fake upstream socket + fake store + a fake clock where it matters. Proves: N viewers = 1 upstream socket; client frames
// throttled to <= 4/s and cut to the chosen level count; the key never reaches a client; non-admins refused (and the
// 'pro' flag only opens it to a verified Pro/demo token); 4029 / silent / auth closes back off; bucketed history uses
// the crypto bucketer (parity) and survives a round trip; imbalance + footprint recorded; hours rule.
import assert from 'node:assert/strict';
import { TSHub, tsOpts, cmeOpen, imbalance10, coarseRule, LEVELS, TICK_SIZE, TS_SYMBOLS } from '../src/ts-hub.js';
import { bucketSnapshot, decodeSamples, encodeSamples } from '../src/bucket.js';
import { tsAllowed, tsAccess } from '../src/ts-access.js';

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
  const cs = []; for (let i = 0; i < 10; i++) { const c = client(); cs.push(c); assert.ok(hub.attach(c, 'NQ', 60)); }
  await sleep(30);
  assert.equal(socks.length, 1, '10 viewers = 1 upstream socket');
  assert.match(socks[0].url, /^wss:\/\/stream\.tick-stream\.xyz\/v1\/stream\?key=SECRETKEY$/);
  assert.deepEqual(socks[0].sent.map((m) => m.channel).sort(), ['book', 'ticks']);
  assert.deepEqual(socks[0].sent[0].symbols, ['NQ', 'ES', 'MNQ', 'MES', 'YM', 'RTY', 'CL', 'GC']);
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
  socks = []; const { hub } = mk({ RECORD: false }); const c = client(); const h = hub.attach(c, 'NQ', 20);
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
  socks = []; const { hub } = mk({ RECORD: false, MIN_GAP_MS: 250, FLUSH_MS: 20 }); const c = client(); hub.attach(c, 'NQ', 20);
  await sleep(20);
  const t0 = Date.now(); let k = 0;
  while (Date.now() - t0 < 1100) { socks[0].msg(book(28000 + (k++ % 5))); await sleep(14); }
  const snaps = c.got.filter((m) => m.type === 'snap').length;
  assert.ok(k > 60, 'sent ' + k); assert.ok(snaps <= 5 && snaps >= 3, 'snaps in 1.1 s: ' + snaps);
  hub.shutdown(); ok('~70 upstream frames in 1.1 s -> ' + snaps + ' client frames (<= 4/s)');
}

// ---- 1-minute candles for a late viewer: bars frame first, ticks continue after it with no overlap
{
  socks = []; const { hub } = mk({ RECORD: false }); const a = client(); hub.attach(a, 'NQ', 20); await sleep(20);
  const up = socks[0]; up.msg({ type: 'book', symbol: 'NQ', ...book(100) });
  for (let i = 0; i < 5; i++) up.msg({ type: 'tick', symbol: 'NQ', price: 100 + i, size: 2, side: 'buy', ts: 1 });
  await sleep(30);
  const late = client(); hub.attach(late, 'NQ', 20); await sleep(40);
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
  assert.ok(hub.attach(client(), 'NQ')); assert.ok(hub.attach(client(), 'NQ')); assert.equal(hub.attach(client(), 'NQ'), null); assert.equal(hub.stats().refused, 1);
  hub.shutdown(); ok('viewer cap refuses the extra socket');
}

// ---- connects only for viewers or recording hours
{
  socks = []; const closedHub = mk({ RECORD: true, now: clockAt(SAT) }).hub;
  closedHub.poke(); await sleep(30); assert.equal(socks.length, 0, 'weekend, nobody watching: no socket');
  const c = client(); const h = closedHub.attach(c, 'NQ'); await sleep(30); assert.equal(socks.length, 1, 'a viewer wakes it');
  h.close(); await sleep(200); assert.equal(closedHub.ws, null, 'last viewer gone (weekend): socket closed after IDLE_MS');
  closedHub.shutdown();
  socks = []; const openHub = mk({ RECORD: true }).hub; openHub.poke(); await sleep(30);
  assert.equal(socks.length, 1, 'CME open, recording on: up with no viewer');
  openHub.shutdown();
  socks = []; const off = mk({ RECORD: false }).hub; off.poke(); await sleep(30); assert.equal(socks.length, 0, 'recording off, no viewer: down');
  off.shutdown();
  const noKey = new TSHub(memStore(), '', { WebSocket: FakeWS, now: clockAt(OPEN) }); noKey.attach(client(), 'NQ'); await sleep(20); assert.equal(socks.length, 0, 'no key: no socket');
  noKey.shutdown();
  ok('socket only while watched or in CME hours; none without a key');
}

// ---- reconnect / 4029 / silent / auth backoff
{
  socks = []; const { hub } = mk({ RECORD: false }); hub.attach(client(), 'NQ'); await sleep(20);
  const t = Date.now(); socks[0].die(4029);
  await sleep(150); assert.equal(socks.length, 1, '4029: nothing during the dead-slot wait (' + hub.stats().nextRetryInMs + ' ms left)');
  assert.ok(hub.stats().nextRetryInMs > 0);
  await sleep(300); assert.equal(socks.length, 2, 'then one new socket'); assert.ok(Date.now() - t >= 270 * 1);
  hub.shutdown(); ok('4029 waits out the 45-50 s dead slot (scaled) before one retry');
}
{
  socks = []; const { hub } = mk({ RECORD: false }); hub.attach(client(), 'NQ'); await sleep(20);
  const gaps = []; let last = Date.now();
  for (let i = 0; i < 5; i++) { const before = socks.length; socks.at(-1).die(1006); const t = Date.now(); while (socks.length === before && Date.now() - t < 1500) await sleep(5); gaps.push(Date.now() - last); last = Date.now(); assert.equal(socks.length, before + 1); }
  assert.ok(gaps[3] > gaps[0] && gaps[4] >= 150, 'exponential: ' + gaps.join(','));
  assert.ok(gaps.every((g) => g < 500));
  hub.shutdown(); ok('plain drops reconnect with exponential backoff: ' + gaps.join(' / ') + ' ms');
}
{
  socks = []; const { hub } = mk({ RECORD: false, AUTH_PAUSE_MS: 5000 }); hub.attach(client(), 'NQ'); await sleep(20);
  socks[0].msg({ type: 'error', error: { code: 'plan_required' } }); socks[0].die(1008); await sleep(400);
  assert.equal(socks.length, 1, 'an auth refusal pauses retries'); hub.shutdown(); ok('auth / plan refusal = long pause, no retry storm');
}
{
  socks = []; const { hub } = mk({ RECORD: false }); const c = client(); hub.attach(c, 'NQ'); await sleep(20);
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
  socks = []; const { hub } = mk({ MODE: 'relay', RECORD: false }); const c = client(); hub.attach(c, 'NQ', 20); await sleep(20);
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
    if (/students\//.test(url)) return Response.json({ fields: { plan: { stringValue: 'free' } } });
    if (/plans/.test(url)) return Response.json({ documents: [{ name: 'p/pro', fields: { rank: { integerValue: '1' } } }] });
    return new Response('{}', { status: 404 });
  };
  const rt = await import('../src/rt-auth.js'); rt._resetForTests();
  assert.equal(await tsAllowed({}, tok('adm1'), { fetchImpl }), true, 'admin in');
  assert.equal(await tsAllowed({}, tok('mem1'), { fetchImpl }), false, 'member refused');
  assert.equal(await tsAllowed({ TS_ACCESS: 'pro' }, tok('mem1'), { fetchImpl }), false, 'free member refused even with the pro flag');
  assert.equal(await tsAllowed({ TS_ACCESS: 'pro' }, tok('adm1'), { fetchImpl }), true, 'admin still in with the pro flag');
  ok('verified admin in; verified non-admin refused; free member refused even when the flag says pro');
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
  socks = []; const { hub } = mk({ RECORD: false }); const c = client(); hub.attach(c, 'CL', 20); await sleep(30);
  socks[0].msg(Object.assign(lv(60.5, 0.01), { symbol: 'CL' })); socks[0].msg(Object.assign(lv(4012.3, 0.1), { symbol: 'GC' })); socks[0].msg(Object.assign(lv(28001, 0.25), { symbol: 'MNQ' }));
  await sleep(60);
  const cl = hub.coarseOf('CL', hub.clock()), gc = hub.coarseOf('GC', hub.clock()), mnq = hub.coarseOf('MNQ', hub.clock());
  assert.equal(cl.step, 0.01); assert.equal(gc.step, 0.2); assert.equal(mnq.step, 2.5); assert.equal(hub.coarseOf('NQ', hub.clock()), null, 'MNQ frames never feed NQ');
  assert.ok(Math.abs(cl.mid - 60.5) < 0.01 && Math.abs(gc.mid - 4012.3) < 0.1);
  hub.shutdown(); ok('8 symbols: tick sizes, whole-tick bucket rows (CL 0.01, GC 0.2, YM 2, RTY 0.2), MNQ own book');
}
console.log(n + ' checks passed'); process.exit(0);
