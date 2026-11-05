// TICK ENGINE tests (src/tick-codec.js, src/tick-engine.js, the hub's tsub/tt stream). node workers/book-recorder/test/tick-engine.test.mjs
// Proves: pack/unpack is lossless; bars of every timeframe equal a brute-force reference built straight from the trades; 2h/4h/D
// buckets match the old source's rules; the record start (rec) and stitch boundary; gap fill (spans, paging, no double count,
// archive-empty minutes keep live data, budget/429 pause); the 10-minute cut (computed server side, exact minute); seq replay on
// reconnect with no duplicates and no gaps; resync for another epoch / too old; hub wiring (stream + heartbeat, key never sent).
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { packTicks, unpackTicks, secsOf, packSecs, unpackSecs, tfSpec, bucketOf, aggregate, foldTick } from '../src/tick-codec.js';
import { TickEngine, teStore, delayCut, teOpts, TE_SYMBOLS } from '../src/tick-engine.js';
import { TSHub, TS_TRADES, TS_SYMBOLS } from '../src/ts-hub.js';
import { aggregateHours } from '../../../functions/api/chart/_bars.js';

let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const MIN = 60000;
const sqlStore = () => { const db = new DatabaseSync(':memory:'); let writes = 0; const sql = { exec(q, ...a) { const st = db.prepare(q); const sel = /^\s*SELECT|RETURNING/i.test(q); if (!/^\s*(SELECT|CREATE)/i.test(q)) writes++; const rows = sel ? st.all(...a.map((x) => (x instanceof Uint8Array ? Buffer.from(x) : x))) : (st.run(...a.map((x) => (x instanceof Uint8Array ? Buffer.from(x) : x))), []); return { toArray: () => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Uint8Array ? new Uint8Array(v) : v]))) }; } }; const st = teStore(sql); st.writes = () => writes; st.db = db; return st; };
// deterministic pseudo-random
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
// trades over [t0, t1) ms: bursts like the open (many per second) and quiet stretches, NQ tick grid
function genTrades(t0, t1, px0 = 28400) {
  const out = []; let t = t0, p = px0 / 0.25;
  while (t < t1) { const burst = rnd() < 0.2; t += burst ? Math.floor(rnd() * 3) : Math.floor(rnd() * 900); if (t >= t1) break; p += Math.round((rnd() - 0.5) * 4); out.push([t, p * 0.25, 1 + Math.floor(rnd() * (rnd() < 0.05 ? 40 : 3)), rnd() < 0.5 ? 1 : -1]); }
  return out;
}
// reference: bars straight from the trades
function refBars(trades, sp) { const out = []; for (const x of trades) foldTick(out, x, sp); return out; }

// ---- codec
{
  const t0 = Date.UTC(2026, 10, 4, 14, 30);
  const tr = genTrades(t0, t0 + MIN);
  const buf = packTicks('NQ', t0, tr);
  assert.deepEqual(unpackTicks(buf, t0), tr, 'ticks round trip');
  const secs = secsOf(tr);
  assert.deepEqual(unpackSecs(packSecs('NQ', t0, secs), t0), secs, 'secs round trip');
  // off-grid prices and other units survive too
  const odd = [[t0 + 5, 1.08765, 2, 1], [t0 + 5, 1.0877, 1, -1], [t0 + 59999, 1.08755, 7, -1]];
  assert.deepEqual(unpackTicks(packTicks('6E', t0, odd), t0), odd, '6E grid');
  const off = [[t0, 100.123456, 1, 1], [t0 + 1, 99.5, 3, -1]];
  assert.deepEqual(unpackTicks(packTicks('NQ', t0, off), t0), off, 'off-grid price kept exactly');
  assert.deepEqual(unpackTicks(packTicks('NQ', t0, []), t0), []);
  const bpt = buf.length / tr.length;
  assert.ok(bpt < 6, 'compact: ' + bpt.toFixed(2) + ' B/trade');
  ok('codec: ticks + 1 s rows round trip exactly (' + bpt.toFixed(2) + ' bytes a trade on a busy NQ minute)');
}

// ---- timeframes vs references
{
  assert.deepEqual(tfSpec('5S'), { k: 's', n: 5, ms: 5000 }); assert.equal(tfSpec('300'), null); assert.equal(tfSpec('180'), null); assert.equal(tfSpec('W'), null); assert.equal(tfSpec('60S'), null);
  // 4h buckets = _bars.js aggregateHours (18:00 ET anchor), across the DST change (2026-11-01)
  const hrs = []; for (let t = Date.UTC(2026, 9, 29, 0) / 1000; t < Date.UTC(2026, 10, 4, 0) / 1000; t += 3600) hrs.push([t, 1, 2, 0, 1, 1]);
  for (const n of [2, 4]) {
    const ref = aggregateHours(hrs, n).map((r) => r[0] * 1000);
    const ours = [...new Set(hrs.map((r) => bucketOf(r[0] * 1000, tfSpec(String(n * 60)))))];
    assert.deepEqual(ours, ref, n + 'h buckets = aggregateHours');
  }
  // D: session from 18:00 ET labelled NY midnight of the trading date (old daily bar labels: 2026-11-05T05:00Z)
  const D = tfSpec('D');
  assert.equal(new Date(bucketOf(Date.UTC(2026, 10, 4, 23, 0), D)).toISOString(), '2026-11-05T05:00:00.000Z', 'Wed 18:00 ET -> Thursday');
  assert.equal(new Date(bucketOf(Date.UTC(2026, 10, 4, 21, 59), D)).toISOString(), '2026-11-04T05:00:00.000Z', 'Wed 16:59 ET -> Wednesday');
  assert.equal(new Date(bucketOf(Date.UTC(2026, 9, 29, 22, 30), D)).toISOString(), '2026-10-30T04:00:00.000Z', 'EDT: Thu 18:30 ET -> Friday');
  assert.equal(new Date(bucketOf(Date.UTC(2026, 10, 1, 23, 0), D)).toISOString(), '2026-11-02T05:00:00.000Z', 'Sunday open -> Monday');
  ok('timeframes: 2h / 4h = the old aggregateHours buckets over a DST change; D = 18:00 ET session, old labels');
}

// ---- engine: live record, then every timeframe equals the reference
const T = Date.UTC(2026, 10, 4, 14, 0);   // Wed 09:00 ET
function liveEngine(o = {}) {
  let now = T - 5000; const st = sqlStore();
  const te = new TickEngine(st, Object.assign({ SYMBOLS: ['NQ', 'ES'], now: () => now, open: () => true }, o));
  return { te, st, set: (t) => { now = t; }, get now() { return now; } };
}
{
  const E = liveEngine(); const { te } = E;
  te.up(T - 5000);
  const tr = genTrades(T, T + 130 * MIN);
  let k = 0;
  for (let t = T; t <= T + 131 * MIN; t += 250) { E.set(t); while (k < tr.length && tr[k][0] <= t) { const x = tr[k++]; te.add('NQ', x[1], x[2], x[3], Math.floor(x[0] / 1000), x[0]); } te.tick(t); }
  E.set(T + 131 * MIN);
  for (const tf of ['1S', '5S', '15S', '1', '5', '15', '60', '120', '240', 'D']) {
    const sp = tfSpec(tf), r = te.bars('NQ', tf, T, T + 131 * MIN);
    const ref = refBars(tr, sp).filter((b) => b[0] >= r.rec);
    const got = sp.k === 's' ? r.b.filter((b) => b[0] >= T + 125 * MIN) : r.b, want = sp.k === 's' ? ref.filter((b) => b[0] >= T + 125 * MIN) : ref;   // seconds: last 6 h read limit; compare the tail
    assert.ok(got.length >= (sp.k === 'D' ? 0 : sp.ms >= 7200000 ? 1 : 2), tf + ' has bars');
    assert.deepEqual(got, want, tf + ' bars = reference');
    for (let i = 1; i < r.b.length; i++) assert.ok(r.b[i][0] > r.b[i - 1][0], 'ascending ' + tf);
  }
  // rec = first whole minute after the socket came up (T); the D / 4h bucket that started before rec is not served
  assert.equal(te.rec.get('NQ') * MIN, T, 'rec = the first whole live minute');
  ok('engine: 130 min of live NQ trades -> 1S 5S 15S 1 5 15 60 120 240 D bars all equal a brute-force reference');

  // the forming minute is in memory and in the bars; q = newest seq included
  const r = te.bars('NQ', '1', T, T + 200 * MIN);
  assert.equal(r.q, te.S.get('NQ').seq, 'q = last seq');
  assert.equal(r.e, te.epoch);
  ok('engine: the forming minute is served from memory, q = seq of the newest trade in the bars');

  // rows written: 3 per symbol-minute (+ span updates), never per trade
  const w = E.st.writes();
  assert.ok(w <= 131 * 4 + 20, 'rows written ' + w + ' for ' + tr.length + ' trades');
  ok('engine: ' + tr.length + ' trades over 131 min = ' + w + ' rows written (3 per symbol-minute + one span update a minute)');
}

// ---- the 10-minute cut
{
  const E = liveEngine(); const { te } = E; te.up(T - 5000);
  const tr = genTrades(T, T + 40 * MIN);
  for (const x of tr) { E.set(x[0]); te.add('NQ', x[1], x[2], x[3], Math.floor(x[0] / 1000), x[0]); te.tick(x[0]); }
  const now = T + 40 * MIN - 17000; E.set(now);
  const cut = delayCut(now);
  assert.equal(cut, Math.floor((now - 600000) / MIN) * MIN, 'cut = whole minute 10 min ago');
  for (const tf of ['1S', '1', '5', '60']) {
    const r = te.bars('NQ', tf, T, now + MIN, cut);
    assert.ok(r.b.every((b) => b[0] < cut), tf + ': no bar at/after the cut');
    assert.equal(r.q, null, 'no seq on the delayed lane');
    assert.equal(r.cut, true);
    const sp = tfSpec(tf), ref = refBars(tr.filter((x) => x[0] < cut), sp).filter((b) => b[0] >= r.rec);
    if (sp.k !== 's') { assert.ok(r.b.length, tf + ' delayed has bars'); assert.deepEqual(r.b, ref, tf + ' delayed = the same data cut at now-10 min'); }
  }
  const tk = te.ticks('NQ', cut - 5 * MIN, now, cut);
  assert.ok(tk.length && tk.every((x) => x[0] < cut), 'ticks cut too');
  ok('cut: the delayed lane is the same bars cut at the whole minute 10 min ago (1S 1 5 60, ticks too), no seq');
}

// ---- seq replay: reconnect with since, no dupes / no gaps; resync when too old or another epoch
{
  const E = liveEngine({ REPLAY_MIN: 3 }); const { te } = E; te.up(T - 5000);
  const tr = genTrades(T, T + 6 * MIN);
  const all = [];
  for (const x of tr) { E.set(x[0]); te.add('NQ', x[1], x[2], x[3], Math.floor(x[0] / 1000), x[0]); te.tick(x[0]); }
  // a "browser" reading everything from seq 0 in chunks, as the socket would
  const s = te.S.get('NQ');
  const oldest = s.recent[0].seq0;
  let since = oldest - 1;
  for (;;) { const r = te.since('NQ', since, 97); assert.notEqual(r, 'resync'); if (!r.t.length) break; assert.equal(r.q, since + 1, 'contiguous'); all.push(...r.t); since = r.q + r.t.length - 1; }
  const want = tr.slice(oldest - 1).map((x) => [x[1], x[2], x[3], x[0]]);
  assert.deepEqual(all, want, 'replay = every trade after since, once, in order');
  assert.equal(te.since('NQ', oldest - 2, 10), 'resync', 'older than the ring = resync');
  assert.deepEqual(te.since('NQ', s.seq, 10).t, [], 'up to date = nothing');
  ok('replay: since=<seq> returns every later trade exactly once, contiguous, across closed + open minutes; too old = resync');

  // bars snapshot + stream join: snapshot q, then everything > q folded = the reference, at any cut point
  for (const cutAt of [T + 2 * MIN + 1234, T + 4 * MIN + 59990, T + 5 * MIN + 1]) {
    const E2 = liveEngine({ REPLAY_MIN: 10 }); const te2 = E2.te; te2.up(T - 5000);
    let k = 0; for (; k < tr.length && tr[k][0] <= cutAt; k++) { const x = tr[k]; E2.set(x[0]); te2.add('NQ', x[1], x[2], x[3], Math.floor(x[0] / 1000), x[0]); te2.tick(x[0]); }
    E2.set(cutAt);
    const snap = te2.bars('NQ', '1', T, cutAt + MIN), bars = snap.b.map((b) => b.slice());
    for (; k < tr.length; k++) { const x = tr[k]; E2.set(x[0]); te2.add('NQ', x[1], x[2], x[3], Math.floor(x[0] / 1000), x[0]); te2.tick(x[0]); }
    const r = te2.since('NQ', snap.q, 1e6);
    for (const y of r.t) foldTick(bars, [y[3], y[0], y[1], y[2]], tfSpec('1'));
    assert.deepEqual(bars, refBars(tr, tfSpec('1')), 'snapshot + stream at ' + (cutAt - T));
  }
  ok('join: bars snapshot (q) + streamed trades with seq > q = the reference, at three cut points (no gap, no double count)');
}

// ---- gap fill from the archive
function fakeArchive(trades, o = {}) {
  const calls = [];
  const f = async (url) => {
    const u = new URL(url); calls.push(u.search);
    if (o.fail && o.fail(calls.length)) return { status: o.code || 429, json: async () => ({}) };
    const s = +u.searchParams.get('start'), e = +u.searchParams.get('end'), lim = +u.searchParams.get('limit');
    const rows = trades.filter((x) => x.ts >= s * 1e6 && x.ts < e * 1e6);
    return { status: 200, json: async () => ({ ticks: rows.slice(0, lim), truncated: rows.length > lim }) };
  };
  f.calls = calls; return f;
}
{
  const now = T + 3 * 3600000;
  const tr = genTrades(T, T + 2 * 3600000);
  const arch = tr.map((x, i) => ({ ts: x[0] * 1000 + (i % 1000), price: x[1], size: x[2], side: x[3] > 0 ? 'buy' : 'sell' }));
  // a minute with nothing in the archive: live data stays
  const hole = Math.floor((T + 30 * MIN) / MIN);
  const archH = arch.filter((x) => Math.floor(x.ts / 6e7) !== hole);
  const f = fakeArchive(archH);
  let clock = now; const st = sqlStore();
  const te = new TickEngine(st, { SYMBOLS: ['NQ'], now: () => clock, open: (ms) => ms >= T && ms < T + 2 * 3600000, key: 'K', fetch: f, KEEP_H: 4, PAGE_LIMIT: 500, FILL_BUDGET_MS: 1e9 });
  // live data existed for the hole minute (a partial live minute, src 2)
  const liveHole = tr.filter((x) => Math.floor(x[0] / MIN) === hole);
  te.writeMinute('NQ', hole, liveHole, 2);
  const r = await te.fill();
  assert.equal(r.filled, 120, 'every market minute filled');
  assert.ok(f.calls.length > 12, 'paged (limit 500): ' + f.calls.length + ' requests');
  assert.deepEqual(te.missing('NQ', Math.floor(T / MIN) - 60, Math.floor(T / MIN) + 120), [], 'no holes left in market hours');
  const b = te.bars('NQ', '1', T, T + 2 * 3600000).b;
  assert.deepEqual(b, refBars(tr, tfSpec('1')), 'filled 1m bars = reference (the hole minute kept its live data)');
  assert.equal(te.rec.get('NQ') <= Math.floor(T / MIN), true, 'rec reaches back over the filled range');
  const ticks = te.ticks('NQ', T + 10 * MIN, T + 20 * MIN);
  assert.equal(ticks.length, tr.filter((x) => x[0] >= T + 10 * MIN && x[0] < T + 20 * MIN).length, 'ticks read: no duplicates at page edges');
  // the cut inside a 240 / 120 / 60 / 1S bar: the bar holds only trades before the cut
  const cutX = T + 77 * MIN;
  for (const tf of ['240', '120', '60', '1S']) {   // D: the record here starts mid-session (no whole D bar); same code path as 240
    const r2 = te.bars('NQ', tf, T - 86400000, T + 3 * 3600000, cutX), sp = tfSpec(tf);
    const ref2 = refBars(tr.filter((x) => x[0] < cutX), sp).filter((x) => x[0] >= r2.rec);
    assert.ok(r2.b.length, tf + ' has bars at the cut');
    assert.deepEqual(sp.k === 's' ? r2.b.slice(-50) : r2.b, sp.k === 's' ? ref2.slice(-50) : ref2, tf + ' bar at the cut holds only earlier trades');
  }
  const again = await te.fill();
  assert.equal(again.filled, 0, 'a filled span is never asked again');
  ok('fill: 120 market minutes back-filled serially in paged windows (no tie lost at a page edge), no holes, = reference, asked once');

  // 429 pauses the filler; it resumes after the pause
  const f2 = fakeArchive(arch, { fail: (k) => k === 2 });
  let c2 = now; const te2 = new TickEngine(sqlStore(), { SYMBOLS: ['NQ'], now: () => c2, open: (ms) => ms >= T && ms < T + 2 * 3600000, key: 'K', fetch: f2, KEEP_H: 4, FILL_BUDGET_MS: 1e9 });
  const r2 = await te2.fill();
  assert.ok(r2.filled < 120 && te2.fillPause > c2, 'paused on 429');
  assert.deepEqual((await te2.fill()).filled, 0, 'still paused');
  c2 += 61000; await te2.fill();
  assert.deepEqual(te2.missing('NQ', Math.floor(T / MIN), Math.floor(T / MIN) + 120), [], 'resumed and finished');
  ok('fill: HTTP 429 pauses the filler for FILL_PAUSE_MS, then it finishes the rest');

  // a live span covers the minutes: nothing is fetched
  const f3 = fakeArchive(arch);
  let c3 = T - 2000; const te3 = new TickEngine(sqlStore(), { SYMBOLS: ['NQ'], now: () => c3, open: (ms) => ms >= T && ms < T + 2 * 3600000, key: '', fetch: f3, KEEP_H: 4 });
  te3.up(T - 2000);
  for (const x of tr) { c3 = x[0]; te3.add('NQ', x[1], x[2], x[3], Math.floor(x[0] / 1000), x[0]); te3.tick(c3); }
  c3 = now; te3.tick(c3); te3.o.key = 'K'; te3.o.FILL_BUDGET_MS = 1e9;
  await te3.fill();
  assert.equal(f3.calls.length, 0, 'live span = no archive request');
  // the socket drops for 5 minutes: exactly those minutes (+ the partial ones) are fetched
  ok('fill: minutes inside a live span are never fetched');
}
{
  const tr = genTrades(T, T + 60 * MIN);
  const arch = tr.map((x) => ({ ts: x[0] * 1000, price: x[1], size: x[2], side: x[3] > 0 ? 'buy' : 'sell' }));
  const f = fakeArchive(arch);
  let c = T - 2000; const te = new TickEngine(sqlStore(), { SYMBOLS: ['NQ'], now: () => c, open: () => true, fetch: f, KEEP_H: 4, FILL_BUDGET_MS: 1e9, FILL_LAG_MS: 0 });
  te.up(T - 2000);
  const downA = T + 20 * MIN + 30000, downB = T + 25 * MIN + 10000;
  for (const x of tr) {
    c = x[0];
    if (x[0] >= downA && !te._down) { te.down(); te._down = true; }
    if (x[0] >= downB && te._down === true) { te.up(c); te._down = 2; }
    if (x[0] >= downA && x[0] < downB) { te.tick(c); continue; }   // the socket was down: these trades never arrived
    te.add('NQ', x[1], x[2], x[3], Math.floor(x[0] / 1000), x[0]); te.tick(c);
  }
  c = T + 61 * MIN; te.tick(c);
  const miss = te.missing('NQ', Math.floor(T / MIN), Math.floor(T / MIN) + 60).sort((a, b) => a - b).map((t) => t - Math.floor(T / MIN));
  assert.deepEqual(miss, [20, 21, 22, 23, 24, 25], 'the drop + the partial minutes on both sides, nothing else');
  te.o.key = 'K'; await te.fill();
  assert.deepEqual(te.bars('NQ', '1', T, T + 60 * MIN).b, refBars(tr, tfSpec('1')), 'after the fill the record equals the full tape');
  ok('fill: a 5-min socket drop leaves exactly minutes 20-25 missing; the filler restores them = the full tape');
}

// ---- record start and the stitch boundary
{
  let c = T + 3 * MIN; const te = new TickEngine(sqlStore(), { SYMBOLS: ['NQ'], now: () => c, open: () => true, KEEP_H: 1 });
  te.up(T + 10000);   // up mid-minute: minute T is partial, the record starts at T+1 min
  te.liveSpan(c); te.refreshRec(c);
  assert.equal(te.rec.get('NQ') * MIN, T + MIN, 'rec = the first whole live minute');
  const r = te.bars('NQ', '5', T - 3600000, c);
  assert.equal(r.rec, T + 5 * MIN, '5m: the first WHOLE bucket of the record (stitch at a bar-close boundary)');
  assert.equal(te.bars('NQ', 'D', T - 86400000 * 3, c).rec > T, true, 'D: the next session');
  ok('record start: rec = first whole minute seen live; bars report the first whole bucket (the page stitches the old source before it)');
}

// ---- hub wiring: the engine sees every trade, tsub streams tt frames with seq, heartbeat, resync on a foreign epoch
{
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const socks = [];
  class FakeWS { constructor(url) { this.url = url; this.sent = []; this.l = {}; socks.push(this); setTimeout(() => this.emit('open', {}), 2); } addEventListener(e, f) { (this.l[e] = this.l[e] || []).push(f); } emit(e, ev) { for (const f of this.l[e] || []) f(ev); } send(m) { this.sent.push(m); } close() { this.closed = true; setTimeout(() => this.emit('close', { code: 1000 }), 1); } msg(o) { this.emit('message', { data: JSON.stringify(o) }); } }
  const memTs = { putMin() {}, prune() {}, range() { return []; }, tb: null };
  const te = new TickEngine(sqlStore(), { SYMBOLS: TE_SYMBOLS });
  const hub = new TSHub(memTs, 'SECRETKEY', { WebSocket: FakeWS, RECORD: false, FLUSH_MS: 10, MIN_GAP_MS: 20, te });
  const got = []; const c = { send: (s) => got.push(JSON.parse(s)), close() {} };
  const h = hub.attach(c, null, 60, 'trades');
  await sleep(20);
  assert.ok(got[0].event === 'hub_attached' && got[0].te && got[0].te.e === te.epoch, 'hub_attached carries the epoch');
  h.onMessage(JSON.stringify({ op: 'tsub', symbol: 'NQ' }));
  h.onMessage(JSON.stringify({ op: 'tsub', symbol: 'SI' }));
  const now = Date.now();
  for (let i = 0; i < 50; i++) socks[0].msg({ type: 'tick', symbol: i % 2 ? 'NQ' : 'SI', price: 28000 + i * 0.25, size: 1 + i, side: i % 3 ? 'buy' : 'sell', ts: Math.floor(now / 1000) });
  await sleep(60);
  const tt = got.filter((m) => m.type === 'tt');
  const nq = tt.filter((m) => m.symbol === 'NQ'), si = tt.filter((m) => m.symbol === 'SI');
  assert.equal(nq.reduce((a, m) => a + m.t.length, 0), 25); assert.equal(si.reduce((a, m) => a + m.t.length, 0), 25);
  let q = 1; for (const m of nq) { assert.equal(m.q, q); q += m.t.length; }
  assert.ok(!JSON.stringify(got).includes('SECRETKEY'), 'key never reaches a client');
  // reconnect: a new socket with since = the 10th NQ trade gets 11..25 only
  const got2 = []; const h2 = hub.attach({ send: (s) => got2.push(JSON.parse(s)), close() {} }, null, 60, 'trades');
  h2.onMessage(JSON.stringify({ op: 'tsub', symbol: 'NQ', since: 10, e: te.epoch }));
  await sleep(40);
  const re = got2.filter((m) => m.type === 'tt');
  assert.equal(re[0].q, 11); assert.equal(re.reduce((a, m) => a + m.t.length, 0), 15, 'replayed 11..25');
  // foreign epoch: resync
  const got3 = []; const h3 = hub.attach({ send: (s) => got3.push(JSON.parse(s)), close() {} }, null, 60, 'trades');
  h3.onMessage(JSON.stringify({ op: 'tsub', symbol: 'NQ', since: 10, e: 123 }));
  await sleep(30);
  assert.ok(got3.some((m) => m.type === 'resync' && m.symbol === 'NQ'), 'resync');
  assert.ok(!got3.some((m) => m.type === 'tt'), 'nothing replayed across epochs');
  // heartbeat on a socket with no book subscription
  hub.clients.forEach((x) => { x.lastPing = 0; }); await sleep(30);
  assert.ok(got.some((m) => m.event === 'ping'), 'heartbeat without sub');
  hub.shutdown();
  assert.equal(te.upAt, 0, 'engine told the socket is down');
  ok('hub: every trade reaches the engine; tsub streams contiguous seq frames per symbol; since replays the missing ones; another epoch = resync; heartbeat; key never sent');
}

// ---- options
{
  const o = teOpts({ TE_KEEP_HOURS: '72', TE_SYMBOLS: 'NQ,ES' });
  assert.equal(o.KEEP_H, 72); assert.deepEqual(o.SYMBOLS, ['NQ', 'ES']); assert.equal(teOpts({ TE_RECORD: '0' }).ON, false);
  assert.equal(teOpts({ TE_KEEP_HOURS: '5' }).KEEP_H, 48, 'out of range -> default');
  for (const s of TE_SYMBOLS) assert.ok(TS_SYMBOLS.includes(s) || TS_TRADES.includes(s), s + ' is streamed by the hub');
  ok('options: TE_KEEP_HOURS / TE_SYMBOLS / TE_RECORD; every engine symbol is on the hub socket');
}
console.log('\n' + n + ' passed');
