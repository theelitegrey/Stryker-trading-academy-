// TICK ENGINE client tests. node tools/tests/tick-engine-client.test.mjs
// assets/tick-codec.js = workers/book-recorder/src/tick-codec.js byte for byte; TE_ROOTS = TE_SYMBOLS; the feed core (assets/tick-feed-core.js,
// the socket owner in the SharedWorker / leader tab): one socket for many charts, de-dup by seq, a late chart gets the ring after ITS q,
// a hole or a new epoch = resync, reconnect asks since=<last seq> and the joined charts see every trade once, 4401 = fresh token at once,
// the socket closes only LINGER_MS after the last chart left; the chart fold (snapshot + stream) = bars of the whole tape.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { TickFeedCore } = await import(ROOT + '/assets/tick-feed-core.js');
const { foldTick, tfSpec } = await import(ROOT + '/assets/tick-codec.js');
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };

assert.equal(fs.readFileSync(ROOT + '/assets/tick-codec.js', 'utf8'), fs.readFileSync(ROOT + '/workers/book-recorder/src/tick-codec.js', 'utf8'));
const roots = (f, name) => JSON.parse(new RegExp('export const ' + name + ' = (\\[[^\\]]*\\])').exec(fs.readFileSync(ROOT + f, 'utf8'))[1].replace(/'/g, '"'));
assert.deepEqual(roots('/assets/chart-tick-engine.js', 'TE_ROOTS'), roots('/workers/book-recorder/src/tick-engine.js', 'TE_SYMBOLS'));
const te = fs.readFileSync(ROOT + '/assets/chart-tick-engine.js', 'utf8') + fs.readFileSync(ROOT + '/assets/tick-feed.js', 'utf8');
assert.ok(!/tick-?stream|insight/i.test(te.replace(/\/\/.*$/gm, '')), 'no vendor name in client code');
ok('codec copy is byte-equal; TE_ROOTS = TE_SYMBOLS; no vendor name in the client code');

// ---- fake clock + socket
let now = 1e12; const timers = [];
const T = (f, ms) => { const h = { at: now + (ms || 0), f }; timers.push(h); return h; };
const CT = (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); };
const run = (ms) => { const end = now + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const h = timers[0]; if (!h || h.at > end) break; timers.shift(); now = h.at; h.f(); } now = end; };
const socks = [];
const live = (ms) => { for (let t = 0; t < ms; t += 5000) { for (const w of socks) if (!w.dead && w.onmessage) w.push({ event: 'ping' }); run(Math.min(5000, ms - t)); } };   // the hub's 5 s heartbeat
class WS { constructor(url, proto) { this.url = url; this.proto = proto; this.sent = []; socks.push(this); T(() => { if (!this.dead) this.onopen(); }, 5); } send(m) { this.sent.push(JSON.parse(m)); } close(code) { this.dead = true; T(() => this.onclose({ code: code || 1000 }), 1); } push(o) { this.onmessage({ data: JSON.stringify(o) }); } drop(code) { this.dead = true; this.onclose({ code }); } }
let tok = 'tokA';
const mk = () => new TickFeedCore({ WebSocket: WS, now: () => now, setTimeout: T, clearTimeout: CT, url: () => 'wss://x/ts-live', token: () => tok, needToken: () => { tok = 'tokB'; } });
// a server: per symbol a tape with seqs; serves since from a ring of everything
const tape = []; for (let i = 1; i <= 400; i++) tape.push([28000 + (i % 13) * 0.25, 1 + (i % 3), i % 2 ? 1 : -1, 1e12 + i * 37]);
const frames = (from, to, step) => { const out = []; for (let q = from; q <= to; q += step) out.push({ type: 'tt', symbol: 'NQ', e: 7, q, t: tape.slice(q - 1, Math.min(to, q + step - 1)) }); return out; };

{
  const core = mk(); const A = [], B = [];
  const la = core.join('NQ', 7, 100, (f) => A.push(f));
  run(10);
  assert.equal(socks.length, 1); const ws = socks[0];
  assert.deepEqual(ws.proto, ['tz-auth', 'tokA']);
  assert.deepEqual(ws.sent[0], { op: 'tsub', symbol: 'NQ', since: 100, e: 7 }, 'asks for everything after the snapshot');
  for (const f of frames(101, 200, 10)) ws.push(f);
  ws.push(frames(150, 160, 11)[0]);   // a duplicate frame
  // a second chart joins late with an older snapshot (q 120): the ring serves 121.. at once
  const lb = core.join('NQ', 7, 120, (f) => B.push(f));
  run(1);
  assert.equal(socks.length, 1, 'one socket for both charts');
  const seqs = (L) => { const out = []; for (const f of L) if (f.type === 'tt') f.t.forEach((x, k) => out.push(f.q + k)); return out; };
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  assert.deepEqual(seqs(A), range(101, 200), 'A: every trade once, in order');
  assert.deepEqual(seqs(B), range(121, 200), 'B: from its own q');
  // drop: reconnect with backoff, since = last seq; the server replays overlapping frames, nobody sees a dupe
  ws.drop(1006); run(3000);
  assert.equal(socks.length, 2); const ws2 = socks[1];
  assert.deepEqual(ws2.sent[0], { op: 'tsub', symbol: 'NQ', since: 200, e: 7 });
  for (const f of frames(190, 300, 25)) ws2.push(f);
  assert.deepEqual(seqs(A), range(101, 300)); assert.deepEqual(seqs(B), range(121, 300));
  ok('core: one socket for two charts; tsub since=<snapshot q>; dupes dropped; a late chart gets the ring after its own q; a drop reconnects with since=<last seq>, no dupes, no gaps');

  // a hole (seq jump) = resync for both, never drawn over
  ws2.push(frames(305, 310, 10)[0]); run(1);
  assert.equal(A[A.length - 1].type, 'resync'); assert.equal(B[B.length - 1].type, 'resync');
  assert.deepEqual(seqs(A), range(101, 300), 'nothing after the hole');
  ok('core: a seq hole = resync to every chart of the symbol (they re-read the bars), nothing drawn over the hole');

  // charts re-join after the resync; then both leave: the socket stays LINGER_MS, then closes
  la(); lb();
  const A2 = []; const la2 = core.join('NQ', 7, 310, (f) => A2.push(f)); run(1);
  assert.deepEqual(ws2.sent[ws2.sent.length - 1], { op: 'tsub', symbol: 'NQ', since: 310, e: 7 });
  la2(); live(19000); assert.ok(!ws2.dead, 'still open within the linger');
  const la3 = core.join('NQ', 7, 310, () => {}); live(5000); assert.ok(!ws2.dead, 'a reload inside the linger keeps the socket');
  la3(); live(21000); assert.ok(ws2.dead, 'closed after the last chart left + linger');
  ok('core: the socket stays while any chart is joined (a reload / timeframe switch inside 20 s keeps it), closes 20 s after the last left');
}
{
  socks.length = 0; tok = 'tokA';
  const core = mk(); core.join('NQ', 7, 0, () => {}); run(10);
  socks[0].drop(4401); run(200);
  assert.equal(socks.length, 2, 'reconnected at once'); assert.deepEqual(socks[1].proto, ['tz-auth', 'tokB'], 'with a fresh token');
  // silent socket (no ping 15 s) = killed and reopened
  socks[1].onopen = socks[1].onopen; run(20000);
  assert.ok(socks[1].dead && socks.length === 3, 'silent socket replaced');
  // another epoch = resync
  const R = []; core.join('ES', 7, 5, (f) => R.push(f)); run(10);
  socks[2].push({ type: 'tt', symbol: 'ES', e: 8, q: 1, t: [[1, 1, 1, 1]] });
  assert.equal(R[R.length - 1].type, 'resync');
  ok('core: close 4401 = reconnect at once with a fresh token; 15 s silence = socket replaced; another epoch = resync');
}
// ---- the chart fold: snapshot bars (last 3) + every streamed trade after q = bars of the whole tape, any timeframe
{
  for (const tf of ['1S', '5S', '1', '5']) {
    const sp = tfSpec(tf); const all = []; const ts = (i) => 1793800000000 + i * 913;
    const trades = tape.map((x, i) => [ts(i), x[0], x[1], x[2]]);
    for (const x of trades) foldTick(all, x, sp);
    for (const cut of [37, 200, 399]) {
      const snap = []; for (const x of trades.slice(0, cut)) foldTick(snap, x, sp);
      const bars = snap.slice(-3).map((b) => b.slice());
      for (const x of trades.slice(cut)) foldTick(bars, x, sp);
      assert.deepEqual(bars, all.slice(-bars.length), tf + ' cut ' + cut);
    }
  }
  ok('chart fold: the snapshot\'s last bars + every trade after its seq = the bars of the whole tape (1S 5S 1 5, three cut points)');
}
console.log('\n' + n + ' passed');
