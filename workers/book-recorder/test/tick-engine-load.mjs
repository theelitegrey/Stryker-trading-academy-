// TICK ENGINE load test (not part of node --test: it runs 6 x 60 s). node --expose-gc workers/book-recorder/test/tick-engine-load.mjs [secs]
// Drives the REAL hub + engine code (src/ts-hub.js + src/tick-engine.js + teStore on node:sqlite) with a synthetic NQ/ES trade stream
// at 1,000 / 3,000 / 6,000 trades/s for 60 s, with 50 and 150 client sockets subscribed to NQ + ES by seq (tsub). Every 3 s ~5% of
// the clients drop for 1-3 s and reconnect with since=<last seq>, so replays run all the time. Each client checks that the seqs it
// gets are contiguous (dropped = seq holes, dupes = seq repeats). Delay = client receive - trade receive time (the stamp the hub
// stores). CPU = process CPU spent inside hub.feed + hub.tick (client-side parsing subtracted) per second of wall clock: one Durable
// Object is one thread, so this must stay well under 1000 ms/s.
import { DatabaseSync } from 'node:sqlite';
import { TSHub } from '../src/ts-hub.js';
import { TickEngine, teStore } from '../src/tick-engine.js';

const SECS = Number(process.argv[2]) || 60;
const RATES = (process.env.RATES || '1000,3000,6000').split(',').map(Number), CLIENTS = (process.env.CLIENTS || '50,150').split(',').map(Number);
const sqlStore = () => { const db = new DatabaseSync(':memory:'); let writes = 0; const B = (x) => (x instanceof Uint8Array ? Buffer.from(x) : x); const sql = { exec(q, ...a) { const st = db.prepare(q); if (!/^\s*(SELECT|CREATE)/i.test(q)) writes++; const rows = /^\s*SELECT|RETURNING/i.test(q) ? st.all(...a.map(B)) : (st.run(...a.map(B)), []); return { toArray: () => rows }; } }; const s = teStore(sql); s.writes = () => writes; return s; };
const memTs = { putMin() {}, prune() {}, range() { return []; }, tb: null };
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null);

async function run(rate, nClients) {
  const st = sqlStore(), te = new TickEngine(st, { SYMBOLS: ['NQ', 'ES'] });
  const hub = new TSHub(memTs, '', { MAX_CLIENTS: 400, TRADES_RESERVE: 0, te });
  te.up(Date.now() - 1000);
  let hubMs = 0, parseMs = 0;
  const feed = hub.feed.bind(hub), tick = hub.tick.bind(hub);
  hub.feed = (f) => { const a = cpu(); feed(f); hubMs += cpu() - a; };
  hub.tick = () => { const a = cpu(); tick(); hubMs += cpu() - a; };
  const delays = [], rdel = [], tot = { frames: 0, bytes: 0, maxBytes: 0, trades: 0, dropped: 0, dupes: 0, resync: 0, reconnects: 0, sends: 0 };
  const every = Math.max(1, Math.round(nClients * rate * SECS / 1e6)); let k = 0;   // ~1e6 delay samples a run, so the test's own memory stays flat
  const mkClient = (id) => {
    const c = { id, last: { NQ: 0, ES: 0 }, h: null, off: 0 };
    c.sock = { send(s) {
      const a = cpu(), now = Date.now(); tot.sends++;
      if (s.startsWith('{"type":"tt"')) {
        tot.frames++; tot.bytes += s.length; if (s.length > tot.maxBytes) tot.maxBytes = s.length;
        const m = JSON.parse(s), L = c.last[m.symbol];
        if (m.q > L + 1) tot.dropped += m.q - L - 1; else if (m.q <= L) tot.dupes += L - m.q + 1;
        c.last[m.symbol] = m.q + m.t.length - 1; tot.trades += m.t.length;
        for (const x of m.t) if (++k % every === 0) (now - c.joinAt < 1500 ? rdel : delays).push(now - x[3]);   // replay frames right after a rejoin are counted apart
      } else if (s.includes('"resync"')) tot.resync++;
      parseMs += cpu() - a;
    }, close() {} };
    return c;
  };
  const join = (c, replay) => { c.joinAt = replay ? Date.now() : 0; c.h = hub.attach(c.sock, null, 60, 'trades', null); for (const s of ['NQ', 'ES']) c.h.onMessage(JSON.stringify(replay ? { op: 'tsub', symbol: s, since: c.last[s], e: te.epoch } : { op: 'tsub', symbol: s })); };
  const cs = []; for (let i = 0; i < nClients; i++) { const c = mkClient(i); cs.push(c); join(c, false); }
  // the first frame each client gets sets its base seq (tsub with no since = from now)
  for (const c of cs) for (const s of ['NQ', 'ES']) c.last[s] = te.S.get(s) ? te.S.get(s).seq : 0;
  let px = { NQ: 21000, ES: 6000 }, gen = 0, behind = 0, maxHeap = 0;
  const t0 = Date.now(), cpu0 = cpu(), per = rate / 100;
  let carry = 0;
  const prod = setInterval(() => {   // 10 ms slices; a slice that runs late emits the trades it owes (late trades counted)
    const now = Date.now(), due = Math.floor(((now - t0) / 1000) * rate) - gen;
    if (due > per * 3) behind += due - per;
    const frames = [];
    for (let k = 0; k < due; k++) {
      const s = (gen + k) % 3 === 0 ? 'ES' : 'NQ'; px[s] += (Math.random() < 0.5 ? -0.25 : 0.25);
      frames.push(JSON.stringify({ type: 'tick', symbol: s, price: px[s], size: 1 + (k % 4), side: k % 2 ? 'buy' : 'sell', ts: now / 1000 }));
    }
    gen += due; carry++;
    if (frames.length) { const a = cpu(); const objs = frames.map((f) => JSON.parse(f)); hubMs += cpu() - a; hub.feed(objs); }   // the upstream JSON parse is part of the hub's cost
  }, 10);
  const recon = setInterval(() => {   // ~5% of the clients drop and come back 1-3 s later with since=<last seq>
    for (const c of cs) if (!c.off && Math.random() < 0.05) {
      c.off = 1; c.h.close(); tot.reconnects++;
      setTimeout(() => { c.off = 0; join(c, true); }, 1000 + Math.random() * 2000);
    }
  }, 3000);
  const memT = setInterval(() => { const h = process.memoryUsage().heapUsed; if (h > maxHeap) maxHeap = h; }, 500);
  await new Promise((r) => setTimeout(r, SECS * 1000));
  clearInterval(prod); clearInterval(recon); clearInterval(memT);
  await new Promise((r) => setTimeout(r, 1500));   // drain
  const wall = (Date.now() - t0) / 1000;
  let retained = null; if (global.gc) { global.gc(); retained = Math.round(process.memoryUsage().heapUsed / 1048576); }   // engine + hub still alive, client sockets and samples aside
  for (const c of cs) if (c.h) c.h.close();
  clearInterval(hub.timers.tick); hub.timers.tick = null;
  delays.sort((a, b) => a - b); rdel.sort((a, b) => a - b);
  return {
    rate, clients: nClients, secs: Math.round(wall), generated: gen, stored: te.n.trades, late: te.n.late, producerBehind: behind,
    hubCpuMsPerS: Math.round((hubMs - parseMs) / wall), procCpuMsPerS: Math.round((cpu() - cpu0) / wall), clientParseMsPerS: Math.round(parseMs / wall),
    heapMB: Math.round(maxHeap / 1048576), retainedMB: retained, framesPerS: Math.round(tot.frames / wall), avgFrameB: Math.round(tot.bytes / Math.max(1, tot.frames)), maxFrameB: tot.maxBytes,
    outMBps: +(tot.bytes / wall / 1048576).toFixed(1), delivered: tot.trades, dropped: tot.dropped, dupes: tot.dupes, resync: tot.resync, reconnects: tot.reconnects,
    p50: pct(delays, 0.5), p95: pct(delays, 0.95), p99: pct(delays, 0.99), max: delays.length ? delays[delays.length - 1] : null, replayP50: pct(rdel, 0.5), replayP99: pct(rdel, 0.99), sqlWrites: st.writes(), minutesWritten: te.n.minutes
  };
}

const out = [];
for (const rate of RATES) for (const n of CLIENTS) {
  const r = await run(rate, n); out.push(r); console.log(JSON.stringify(r));
  if (global.gc) global.gc(); await new Promise((x) => setTimeout(x, 1000));
}
console.log('\nrate/s clients | hub CPU ms/s | heap peak/after-gc MB | frames/s avg B max B MB/s | dropped dupes resync reconn late | delay p50 p95 p99 max ms');
for (const r of out) console.log([r.rate, r.clients, '|', r.hubCpuMsPerS, '|', r.heapMB + '/' + r.retainedMB, '|', r.framesPerS, r.avgFrameB, r.maxFrameB, r.outMBps, '|', r.dropped, r.dupes, r.resync, r.reconnects, r.late, '|', r.p50, r.p95, r.p99, r.max, '|', r.replayP50, r.replayP99].join(' '));
