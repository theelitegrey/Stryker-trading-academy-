// Delta Profile (L2) maths (assets/chart-delta-profile-data.js): side, rolling-window eviction, fixed-range bounds, incremental == rebuild.
//   node tools/tests/delta-profile.test.mjs
import assert from 'node:assert/strict';
globalThis.window = globalThis.window || {}; globalThis.document = globalThis.document || { addEventListener() {}, hidden: false };
const L2 = await import('../../assets/chart-futures-l2.js');
const { DeltaAcc, windowOf, rebucket, rowTicks, fromProfile, MIN } = await import('../../assets/chart-delta-profile-data.js');
let n = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? '' : ' ' + JSON.stringify(x))); n++; console.log('PASS ' + m); };
const T0 = Math.floor(Date.now() / MIN) * MIN - 90 * MIN, TICK = 0.25;
let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const ticks = [];   // hub frame shape [price, size, 1 buy | -1 sell, ts]
for (let i = 0; i < 9000; i++) ticks.push([Math.round((28650 + Math.sin(i / 400) * 15 + (rnd() - 0.5) * 6) / TICK) * TICK, 1 + Math.floor(rnd() * 9), rnd() < 0.5 ? 1 : -1, T0 + Math.floor(i * 88 * MIN / 9000)]);
const feed = new L2.TickFeed('NQ'); feed.add(ticks, false);
const bars = feed.bars();
const ref = (from, to) => { const m = new Map(); for (const [p, sz, sd, ts] of ticks) { const t = Math.floor(ts / MIN) * MIN; if (t < from || t >= to) continue; const k = Math.floor(p / TICK + 1e-9), e = m.get(k) || [0, 0]; e[sd > 0 ? 0 : 1] += sz; m.set(k, e); } return m; };
const same = (acc, from, to, msg) => {
  const r = ref(from, to); assert.equal(acc.tab.size, r.size, msg + ' row count');
  let net = 0; for (const [k, e] of r) { const a = acc.tab.get(k); assert.ok(a && a[0] === e[0] && a[1] === e[1], msg + ' row ' + k); net += e[0] - e[1]; }
  assert.equal(acc.net, net, msg + ' net'); ok(true, msg, { rows: r.size, net });
};
// side: buy adds to delta, sell subtracts
{ const f = new L2.TickFeed('NQ'); f.add([[100, 5, 1, T0], [100, 3, -1, T0 + 10], [100.25, 2, -1, T0 + 20]], false);
  const a = new DeltaAcc().update(f.bars(), T0, T0 + MIN), P = rebucket(a.tab, 1);
  ok(a.net === 0 && P.delta.length === 2 && P.delta[0] === 2 && P.delta[1] === -2, 'side: buy 5 - sell 3 = +2 at 100, sell 2 = -2 at 100.25', Array.from(P.delta));
  ok(P.maxPos.v === 2 && P.maxNeg.v === -2 && P.absMax === 2, 'max positive / max negative rows'); }
// rolling: windowOf bounds and eviction
const now = T0 + 88 * MIN, w15 = windowOf('rolling', { now, mins: 15 });
ok(w15.to - w15.from === 15 * MIN && w15.to === Math.floor(now / MIN) * MIN + MIN, 'rolling 15: last 15 minutes incl. the one in progress');
const acc = new DeltaAcc().update(bars, w15.from, w15.to); same(acc, w15.from, w15.to, 'rolling 15 equals an independent count');
// slide the window one minute at a time: eviction + incremental == full rebuild, touching only the changed minutes
for (let s = 1; s <= 30; s++) { const w = windowOf('rolling', { now: now - 30 * MIN + s * MIN, mins: 15 }); acc.update(bars, w.from, w.to); if (s % 10 === 0) same(acc, w.from, w.to, 'slid ' + s + ' min'); if (s > 1) ok(acc.touched <= 3, 'slide touches <= 3 minutes (not a rebuild)', acc.touched); }
ok(acc.cur.size === 15 || acc.cur.size === 14, 'window holds 15 minutes', acc.cur.size);
// a tick arriving in the newest minute updates only that minute
{ const f2 = new L2.TickFeed('NQ'); f2.add(ticks.slice(0, 4000), false); const b1 = f2.bars(), last = b1[b1.length - 1], a = new DeltaAcc().update(b1, last.t - 10 * MIN, last.t + MIN), before = a.net;
  f2.add([[28650, 7, 1, last.t + 100]], false); a.update(f2.bars(), last.t - 10 * MIN, last.t + MIN);
  ok(a.touched === 2 && a.net === before + 7, 'one new tick: one minute re-added, net +7', [a.touched, a.net - before]);
  const full = new DeltaAcc().update(f2.bars(), last.t - 10 * MIN, last.t + MIN); ok(full.net === a.net && full.tab.size === a.tab.size, 'incremental == full rebuild after a tick'); }
// fixed range: both end minutes included, order of start/end does not matter, nothing outside
const s = bars[20].t + 5000, e = bars[40].t + 59000, wf = windowOf('fixed', { start: s, end: e, now });
ok(wf.from === bars[20].t && wf.to === bars[40].t + MIN, 'fixed range: start minute and end minute both included');
ok(windowOf('fixed', { start: e, end: s, now }).from === wf.from, 'fixed range: start/end swapped gives the same span');
const af = new DeltaAcc().update(bars, wf.from, wf.to); same(af, wf.from, wf.to, 'fixed range equals an independent count');
ok(af.cur.size === 21 && af.first() === bars[20].t, 'fixed range holds 21 minutes');
ok(windowOf('fixed', { start: s, end: 0, now }).to === Math.floor(now / MIN) * MIN + MIN, 'fixed range with no end runs to now');
const empty = new DeltaAcc().update(bars, bars[bars.length - 1].t + 5 * MIN, bars[bars.length - 1].t + 9 * MIN); ok(empty.tab.size === 0 && empty.net === 0 && rebucket(empty.tab, 1) === null, 'window with no trades is empty (no made-up rows)');
// session
ok(windowOf('session', { now, sessionStart: now - 3 * 3600000 }).from === Math.floor((now - 3 * 3600000) / MIN) * MIN, 'session window starts at the session start');
// rebucket: rows of m ticks keep totals; row cap
for (const m of [1, 4, 10]) { const P = rebucket(af.tab, m); let d = 0, v = 0; P.delta.forEach((x) => { d += x; }); P.vol.forEach((x) => { v += x; }); ok(d === af.net && v === af.vol, 'rows of ' + m + ' ticks keep net and volume', [d, v]); }
ok(rowTicks(400, 3, 7, 70, [1, 2, 4, 5, 8, 10, 16, 20, 25, 40]) === 8 && rowTicks(5000, 30, 7, 70, [1, 2, 4, 5, 8, 10, 16, 20, 25, 40, 50, 80, 100]) === 80, 'rowTicks: tall enough and at most 70 rows');
const fp = fromProfile({ r0: 3, n: 2, m: 1, buy: [5, 1], sell: [1, 4] }); ok(fp.delta[0] === 4 && fp.delta[1] === -3 && fp.maxNeg.k === 1, 'fromProfile (Volume Profile Delta view)');
console.log('all ' + n + ' passed');
