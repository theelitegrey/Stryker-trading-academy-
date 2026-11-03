// Order-book pack maths (assets/chart-book-pack-data.js) on a deterministic fixture book in the hub's own frame shape.
//   node tools/tests/chart-book-pack.test.mjs
import assert from 'node:assert/strict';
const D = await import('../../assets/chart-book-pack-data.js');
let n = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? '' : ' ' + JSON.stringify(x))); n++; console.log('PASS ' + m); };
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const TICK = 0.25;
// hub snapshot: { bids: [[price, size]..] best first, asks: [..] }
const snap = (mid, f) => {
  const bid = Math.floor(mid / TICK) * TICK, ask = bid + TICK, bids = [], asks = [];
  for (let j = 0; j < 60; j++) { bids.push([bid - j * TICK, f(-j - 1)]); asks.push([ask + j * TICK, f(j + 1)]); }
  return { bids, asks };
};
const flat = (q) => () => q;
const A = snap(21000, flat(10)), bA = D.bookFromLists(A.bids, A.asks, TICK);
ok(bA && bA.ba === bA.bb + 1, 'book from lists: best bid / ask one tick apart');
ok(D.bookFromLists([[10, 5]], [[9, 5]], 1) === null, 'a crossed book is rejected');
ok(D.bookFromLists([], [[9, 5]], 1) === null, 'an empty side is rejected');
// balance
const bal = D.balance(bA, 20);
ok(bal.bid === 200 && bal.ask === 200, 'balance: 20 ticks x 10 each side', bal);
const B2 = snap(21000, (k) => (k < 0 ? 10 : 30)), b2 = D.bookFromLists(B2.bids, B2.asks, TICK);
ok(D.balance(b2, 5).ask - D.balance(b2, 5).bid === 100, 'balance: heavier asks give a negative difference');
// changes: count adds / removes / resizes inside N
const C1 = snap(21000, flat(10)), C2 = snap(21000, (k) => (k === 3 || k === -4 ? 11 : k === 7 ? 0 : 10));
const c1 = D.bookFromLists(C1.bids, C1.asks, TICK), c2 = D.bookFromLists(C2.bids, C2.asks, TICK);
ok(D.changes(c1, c2, 20) === 3, 'changes: resize + resize + remove = 3', D.changes(c1, c2, 20));
ok(D.changes(c1, c1, 20) === 0, 'changes: identical books = 0');
ok(D.changes(c1, c2, 3) === 1, 'changes: only the resize at k=3 is inside 3 ticks... (k=-4 is out)', D.changes(c1, c2, 3));
// spread: size clustered at the touch is tighter than size far away
const tight = D.bookFromLists(...(() => { const s = snap(21000, (k) => (Math.abs(k) <= 2 ? 100 : 1)); return [s.bids, s.asks, TICK]; })());
const wide = D.bookFromLists(...(() => { const s = snap(21000, (k) => (Math.abs(k) >= 15 ? 100 : 1)); return [s.bids, s.asks, TICK]; })());
ok(D.spread(tight, 20) < D.spread(wide, 20), 'spread: clustered < spread out', [D.spread(tight, 20), D.spread(wide, 20)]);
ok(D.spread({ bb: 1, ba: 2, bid: new Map(), ask: new Map() }, 20) === null, 'spread: an empty book has no value');
// crypto maps bucket
const cb = D.bookFromMaps(new Map([[99.97, 4], [99.9, 2]]), new Map([[100.03, 5], [100.2, 1]]), 0.1, 50);
ok(cb && cb.bb === 999 && cb.ba === 1001, 'crypto buckets: bid floors, ask ceils', [cb && cb.bb, cb && cb.ba]);
// ema / percentiles / band
const e = D.ema([1, 1, 1, null, 1], 3); ok(e.every((x) => x === 1), 'ema of a flat series is flat, gaps carry');
const ps = D.percentiles(Array.from({ length: 101 }, (_, i) => i), [25, 75]); ok(ps[0] === 25 && ps[1] === 75, 'percentiles', ps);
ok(D.band(1, 10, 20) === 0 && D.band(15, 10, 20) === 1 && D.band(25, 10, 20) === 2 && D.band(5, null, null) === 1, 'band: calm / normal / fast, middle without a baseline');
// log histogram: top 0.5 %
const h = new D.LogHist(); for (let i = 0; i < 10000; i++) h.add(1 + Math.floor(rnd() * 100)); for (let i = 0; i < 80; i++) h.add(5000);
const thr = h.top(0.5); ok(thr > 100 && thr <= 5000, 'top 0.5 %: the giant levels clear it, ordinary ones do not', thr);
// sessions
const ny = Date.UTC(2026, 10, 3, 15, 0);   // 10:00 NY (EST, UTC-5) on 3 Nov
ok(D.sessionStart(ny, 'futures') === Date.UTC(2026, 10, 2, 23, 0), 'futures session starts 18:00 New York the day before', new Date(D.sessionStart(ny, 'futures')).toISOString());
ok(D.sessionStart(ny, 'crypto') === Date.UTC(2026, 10, 3), 'crypto session = the UTC day');
// perBar + cumulate
const bars = [0, 1, 2, 3].map((i) => ({ time: Date.UTC(2026, 10, 3, 15, i) }));
const s = new D.Series(); for (let i = 0; i < 240; i++) s.push(bars[0].time + i * 1000, i < 60 ? 2 : 4);
const pb = D.perBar(s, bars, 60000, 'mean'); ok(pb[0] === 2 && pb[1] === 4 && pb[3] === 4, 'perBar means per chart bar', pb);
const cum = D.cumulate(bars, [{ t: bars[1].time + 5, d: 1 }, { t: bars[1].time + 9, d: 1 }, { t: bars[3].time, d: -1 }], 'futures'); ok(cum.join() === '0,2,2,1', 'cumulate: buy up, sell down', cum);
const cumNew = D.cumulate([{ time: Date.UTC(2026, 10, 3, 22, 59) }, { time: Date.UTC(2026, 10, 3, 23, 1) }], [{ t: Date.UTC(2026, 10, 3, 22, 59), d: 1 }], 'futures'); ok(cumNew.join() === '1,0', 'cumulate resets at the session start', cumNew);

// refill: an ask of 100 is hit by buyers (down to 20), refills to 90 within 2 s -> one event on the ask side (supports a move down)
const rt = new D.RefillTracker({ refillPct: 70, withinSec: 3 });
const mk = (askQ) => { const sn = snap(21000, (k) => (k === 1 ? askQ : 10)); return D.bookFromLists(sn.bids, sn.asks, TICK); };
const idx = mk(100).ba;
let t = 1e6; rt.onBook(t, mk(100));
rt.onTrades(t += 100, [{ idx, size: 80, side: 1 }]); rt.onBook(t += 50, mk(20));
rt.onBook(t += 1000, mk(90));
ok(rt.events.length === 1 && rt.events[0].side === -1 && rt.events[0].idx === idx, 'refill: ask hit then restored = 1 event, ask side', rt.events);
// not enough refill
const r2 = new D.RefillTracker({ refillPct: 70, withinSec: 3 }); t = 2e6; r2.onBook(t, mk(100)); r2.onTrades(t += 100, [{ idx, size: 80, side: 1 }]); r2.onBook(t += 50, mk(20)); r2.onBook(t += 1000, mk(50));
ok(r2.events.length === 0, 'refill: only 50 % back = no event');
// too slow
const r3 = new D.RefillTracker({ refillPct: 70, withinSec: 3 }); t = 3e6; r3.onBook(t, mk(100)); r3.onTrades(t += 100, [{ idx, size: 80, side: 1 }]); r3.onBook(t += 50, mk(20)); r3.onBook(t += 5000, mk(95));
ok(r3.events.length === 0, 'refill: restored after 5 s = no event (3 s window)');
// never hit hard: a 10 % dip is not a hit
const r4 = new D.RefillTracker(); t = 4e6; r4.onBook(t, mk(100)); r4.onTrades(t += 100, [{ idx, size: 5, side: 1 }]); r4.onBook(t += 50, mk(90)); r4.onBook(t += 500, mk(100));
ok(r4.events.length === 0, 'refill: a 10 % dip is not a hit');
// bid side: sellers hit a bid, it comes back -> supports the move up
const bidI = mk(100).bb, mkB = (q) => { const sn = snap(21000, (k) => (k === -1 ? q : 10)); return D.bookFromLists(sn.bids, sn.asks, TICK); };
const r5 = new D.RefillTracker(); t = 5e6; r5.onBook(t, mkB(100)); r5.onTrades(t += 100, [{ idx: bidI, size: 80, side: -1 }]); r5.onBook(t += 50, mkB(10)); r5.onBook(t += 800, mkB(100));
ok(r5.events.length === 1 && r5.events[0].side === 1, 'refill: bid hit then restored = bid side (supports up)', r5.events);

// large tracker: a level at 20x enters, stays, is pulled and fades
const lt = new D.LargeTracker(); const big = (q) => { const sn = snap(21000, (k) => (k === 5 ? q : 10)); return D.bookFromLists(sn.bids, sn.asks, TICK); };
t = 6e6; lt.update(t, big(500), 200); ok(lt.live.size === 1, 'large: one level above the threshold');
lt.update(t += 5000, big(300), 200); ok(lt.live.size === 1 && [...lt.live.values()][0].since === 6e6, 'large: still there, since keeps the first time');
lt.update(t += 1000, big(10), 200); ok(lt.live.size === 0 && lt.gone.length === 1, 'large: pulled -> moves to fading');
lt.update(t += 4000, big(10), 200); ok(lt.gone.length === 0, 'large: faded out after 3 s');
ok(D.fmtDur(75000) === '1m 15s' && D.fmtDur(4500000) === '1h 15m' && D.fmtDur(9000) === '9s', 'duration text');
// absorption list on minute bars (the real absorptionEvents rule): 20 quiet bars, then one heavy narrow bar with net selling that closes up
const P = await import('../../assets/chart-of-pro-data.js');
const mb = (t, buy, sell, lo = 0) => ({ t, lo, hi: lo + buy.length - 1, o: lo, c: lo, buy, sell, vol: buy.reduce((a, b) => a + b, 0) + sell.reduce((a, b) => a + b, 0), delta: buy.reduce((a, b) => a + b, 0) - sell.reduce((a, b) => a + b, 0) });
const quiet = Array.from({ length: 25 }, (_, i) => mb(i * 60000, [5, 5, 5, 5, 5], [5, 5, 5, 5, 5], 10));
quiet.push(mb(25 * 60000, [10, 10], [200, 10], 12)); quiet[25].c = 14; quiet[25].o = 12;
const ab = D.absorptionList(P.absorptionEvents, quiet);
ok(ab.length === 1 && ab[0].d === 1 && ab[0].t === 25 * 60000, 'absorption list: sellers absorbed = +1 (buy side up)', ab);
console.log('chart-book-pack: ' + n + ' checks passed');
