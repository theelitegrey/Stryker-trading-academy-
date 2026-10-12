// Node unit tests for assets/bar-replay-core.js (Charts bar replay, Owner order 2026-10-12).
//   node tools/tests/bar-replay-core.test.js
// Replay clock, the forming candle rebuilt from the update interval, no lookahead (an SMA and an
// EMA computed on what reveal() serves equal those computed on the truncated series and do not
// change when the FUTURE bars change), ranged reveals, daily bar ends, and replay paper fills
// (segments -> PaperEngine.onSegment: gap fills at the open, SL first when both are touched).
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', '..', 'assets', 'bar-replay-core.js'));
const PE = require(path.join(__dirname, '..', '..', 'assets', 'paper-engine.js'));

let n = 0, fail = 0;
function t(name, fn) { n++; try { fn(); console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n   ' + (e && e.stack || e)); } }

const MIN = 60000, T0 = Date.parse('2026-10-05T13:30:00Z');
// deterministic 1m series: 600 bars, price walks
function series1m(count, seed) {
  const out = []; let p = 20000, s = seed || 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < count; i++) {
    const o = p, c = p + (rnd() - 0.5) * 20;
    out.push({ time: T0 + i * MIN, open: o, high: Math.max(o, c) + rnd() * 5, low: Math.min(o, c) - rnd() * 5, close: c, volume: 1 + Math.floor(rnd() * 100) });
    p = c;
  }
  return out;
}
function agg(bars, ms) {
  const out = [];
  for (const b of bars) {
    const t0 = Math.floor(b.time / ms) * ms, l = out[out.length - 1];
    if (!l || l.time !== t0) out.push({ time: t0, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
    else { l.high = Math.max(l.high, b.high); l.low = Math.min(l.low, b.low); l.close = b.close; l.volume += b.volume; }
  }
  return out;
}
const sma = (xs, n) => xs.map((_, i) => (i < n - 1 ? null : xs.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
const ema = (xs, n) => { const k = 2 / (n + 1); let e = null; return xs.map((x) => (e = e == null ? x : x * k + e * (1 - k))); };

const m1 = series1m(600);
const m5 = agg(m1, 5 * MIN);

t('tfMs / tfLabel', () => {
  assert.strictEqual(C.tfMs('5'), 5 * MIN);
  assert.strictEqual(C.tfMs('60'), 60 * MIN);
  assert.strictEqual(C.tfMs('D'), C.DAY);
  assert.strictEqual(C.tfMs('1S'), null);
  assert.strictEqual(C.tfLabel('60'), '1h');
  assert.strictEqual(C.tfLabel('5'), '5m');
});

t('reveal hides every bar opened at or after the clock (no step series)', () => {
  const E = m5[40].time + 5 * MIN;           // bar 40 just closed
  const out = C.reveal(m5, 5 * MIN, null, 0, E);
  assert.strictEqual(out.length, 41);
  assert.ok(out.every((b) => b.time + 5 * MIN <= E));
  assert.deepStrictEqual(out[40], m5[40]);
  assert.notStrictEqual(out[40], m5[40], 'copies, never the buffer objects');
});

t('forming 5m candle built only from complete 1m bars', () => {
  const E = m5[40].time + 3 * MIN;           // 3 of 5 minutes of bar 40 are done
  const out = C.reveal(m5, 5 * MIN, m1, MIN, E);
  assert.strictEqual(out.length, 41);
  const f = out[40], parts = m1.filter((b) => b.time >= m5[40].time && b.time + MIN <= E);
  assert.strictEqual(parts.length, 3);
  assert.strictEqual(f.time, m5[40].time);
  assert.strictEqual(f.open, parts[0].open);
  assert.strictEqual(f.close, parts[2].close);
  assert.strictEqual(f.high, Math.max(...parts.map((p) => p.high)));
  assert.strictEqual(f.low, Math.min(...parts.map((p) => p.low)));
  assert.strictEqual(f.volume, parts.reduce((a, p) => a + p.volume, 0));
  assert.notStrictEqual(f.close, m5[40].close);
});

t('step forward walks the 1m clock and the forming bar grows to the full bar', () => {
  let E = m5[40].time;
  const seen = [];
  for (let i = 0; i < 5; i++) { E = C.nextE(m1, MIN, E); seen.push(E); }
  assert.deepStrictEqual(seen, [1, 2, 3, 4, 5].map((k) => m5[40].time + k * MIN));
  const out = C.reveal(m5, 5 * MIN, m1, MIN, E);
  assert.deepStrictEqual(out[out.length - 1], m5[40]);
});

t('nextE skips gaps (night / weekend)', () => {
  const gap = m1.slice(0, 10).concat(m1.slice(10).map((b) => Object.assign({}, b, { time: b.time + 2 * C.DAY })));
  const E = gap[9].time + MIN;
  assert.strictEqual(C.nextE(gap, MIN, E), gap[10].time + MIN);
  assert.strictEqual(C.nextE(gap, MIN, gap[gap.length - 1].time + MIN), null);
});

t('NO LOOKAHEAD: indicators on revealed bars == indicators on the truncated series, for every clock', () => {
  for (let k = 30; k < 300; k += 7) {
    const E = m1[k].time + MIN;              // a 1m step boundary (often mid 5m bar)
    const out = C.reveal(m5, 5 * MIN, m1, MIN, E);
    const truncated = agg(m1.slice(0, k + 1), 5 * MIN);   // what existed at E
    assert.deepStrictEqual(out.map((b) => b.close), truncated.map((b) => b.close), 'closes at k=' + k);
    assert.deepStrictEqual(sma(out.map((b) => b.close), 9), sma(truncated.map((b) => b.close), 9));
    assert.deepStrictEqual(ema(out.map((b) => b.close), 21), ema(truncated.map((b) => b.close), 21));
  }
});

t('NO LOOKAHEAD: changing the future never changes what is revealed', () => {
  const E = m1[200].time + MIN;
  const a = C.reveal(m5, 5 * MIN, m1, MIN, E);
  const fut1 = m1.map((b, i) => (i > 200 ? Object.assign({}, b, { close: b.close + 999, high: b.high + 999 }) : b));
  const b = C.reveal(agg(fut1, 5 * MIN), 5 * MIN, fut1, MIN, E);
  assert.deepStrictEqual(a, b);
});

t('ranged reveal (from / to / limit) respects the clock', () => {
  const E = m5[100].time + 5 * MIN;
  const r1 = C.reveal(m5, 5 * MIN, null, 0, E, { limit: 20 });
  assert.strictEqual(r1.length, 20);
  assert.strictEqual(r1[19].time, m5[100].time);
  const r2 = C.reveal(m5, 5 * MIN, null, 0, E, { from: m5[90].time, to: m5[110].time });
  assert.strictEqual(r2[0].time, m5[90].time);
  assert.strictEqual(r2[r2.length - 1].time, m5[100].time);
});

t('daily bars end at the next bar open (a session never reveals early)', () => {
  const D = C.DAY;
  const days = [0, 1, 2, 5, 6].map((d, i) => ({ time: T0 + d * D, open: i, high: i, low: i, close: i, volume: 1 }));
  // Friday bar (index 2) ends Monday open (index 3), not 24h later
  assert.strictEqual(C.endAt(days, 2, D), days[3].time);
  const E = days[2].time + D + 1000;         // Saturday: Friday bar not complete yet by our rule
  assert.strictEqual(C.reveal(days, D, null, 0, E).length, 2);
  assert.strictEqual(C.reveal(days, D, null, 0, days[3].time).length, 3);
});

t('merge keeps order, dedupes, newer wins', () => {
  const a = m1.slice(0, 5), b = [Object.assign({}, m1[4], { close: 1 }), m1[5]];
  const m = C.merge(a, b);
  assert.strictEqual(m.length, 6);
  assert.strictEqual(m[4].close, 1);
  assert.deepStrictEqual(C.merge(m1.slice(3, 6), m1.slice(0, 2)).map((x) => x.time), [0, 1, 3, 4, 5].map((i) => m1[i].time));
});

t('segments: one per step bar completed between two clocks', () => {
  const E0 = m1[10].time + MIN, E1 = m1[13].time + MIN;
  const s = C.segments(m1, MIN, E0, E1);
  assert.deepStrictEqual(s.map((x) => x.t), [11, 12, 13].map((i) => m1[i].time));
  assert.deepStrictEqual(s[0], { t: m1[11].time, o: m1[11].open, h: m1[11].high, l: m1[11].low, c: m1[11].close });
  assert.strictEqual(C.segments(m1, MIN, E1, E1).length, 0);
});

// ---- replay paper fills: the replay clock drives a separate PaperAccount ----
function replayAcct(E) {
  return PE.PaperAccount.fresh(100000, { now: () => E.v, isOpen: () => true, tickOf: () => 0.25 });
}
const bar = (t, o, h, l, c) => ({ time: t, open: o, high: h, low: l, close: c, volume: 1 });

t('replay paper: market order fills at the revealed price, bracket TP fills on a later revealed bar', () => {
  const E = { v: T0 + MIN };
  const steps = [bar(T0, 100, 101, 99, 100), bar(T0 + MIN, 100, 102, 99.5, 101), bar(T0 + 2 * MIN, 101, 106, 100.5, 105)];
  const a = replayAcct(E);
  a.setLast('futures:NQ1!', 100);
  const r = a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1, tp: 104, sl: 98 });
  assert.ok(r.events && r.events[0].type === 'open' && r.events[0].price === 100, JSON.stringify(r));
  assert.strictEqual(r.events[0].position.openedAt, T0 + MIN, 'opened at the replay clock');
  let ev = [];
  for (const s of C.segments(steps, MIN, E.v, T0 + 3 * MIN)) { E.v = s.t + MIN; ev = ev.concat(a.onSegment('futures:NQ1!', s)); }
  const tp = ev.find((e) => e.type === 'tp');
  assert.ok(tp, 'TP event: ' + JSON.stringify(ev));
  assert.strictEqual(Object.keys(a.state.positions).length, 0);
  assert.strictEqual(tp.trade.exit, 104);
  assert.strictEqual(tp.trade.exitAt, T0 + 2 * MIN, 'exit stamped with the revealed bar time');
});

t('replay paper: gap through the stop fills at the open; SL first when one bar touches both', () => {
  const E = { v: T0 };
  const a = replayAcct(E);
  a.setLast('futures:NQ1!', 100);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1, tp: 110, sl: 95 });
  const ev = a.onSegment('futures:NQ1!', { t: T0 + MIN, o: 93, h: 94, l: 92, c: 93 });   // gap below SL
  const sl = ev.find((e) => e.type === 'sl');
  assert.ok(sl, 'an SL exit ' + JSON.stringify(ev));
  assert.strictEqual(sl.trade.exit, 93);
  const b = replayAcct(E);
  b.setLast('futures:NQ1!', 100);
  b.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1, tp: 103, sl: 97 });
  const ev2 = b.onSegment('futures:NQ1!', { t: T0 + MIN, o: 100, h: 104, l: 96, c: 100 });            // both touched
  const sl2 = ev2.find((e) => e.type === 'sl');
  assert.ok(sl2 && !ev2.some((e) => e.type === 'tp'), JSON.stringify(ev2));
  assert.strictEqual(sl2.trade.exit, 97);
});

t('replay paper: trade times are the replay clock, not the wall clock', () => {
  const E = { v: Date.parse('2026-06-01T15:00:00Z') };
  const a = replayAcct(E);
  a.setLast('futures:NQ1!', 100);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 });
  E.v += 5 * MIN;
  a.onSegment('futures:NQ1!', { t: E.v - MIN, o: 101, h: 101, l: 101, c: 101 });
  a.closePosition ? a.closePosition('futures:NQ1!') : a.close('futures:NQ1!');
  const h = a.state.history[a.state.history.length - 1];
  const times = [h.openedAt, h.closedAt, h.entryTime, h.exitTime, h.at].filter(Number.isFinite);
  assert.ok(times.length, JSON.stringify(h));
  assert.ok(times.every((x) => x < Date.parse('2026-07-01')), 'replay times: ' + JSON.stringify(times));
});

console.log('\n' + (n - fail) + '/' + n + ' passed');
process.exit(fail ? 1 : 0);
