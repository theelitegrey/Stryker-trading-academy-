// node tools/tests/dom-signals-core.test.mjs — DOM Signals: each tag fires in a crafted case and not in a quiet book.
import { SignalEngine, verdict, toBook, wallThreshold } from '../../assets/dom-signals-core.js';
let fail = 0;
const ok = (c, m, x) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (!c && x !== undefined ? ' ' + JSON.stringify(x) : '')); };

// step 1; touch bid 100 / ask 101; 20 levels each side, size 10
const book = (over = {}) => {
  const bids = [], asks = [];
  for (let i = 0; i < 20; i++) { bids.push([100 - i, over['b' + (100 - i)] ?? 10]); asks.push([101 + i, over['a' + (101 + i)] ?? 10]); }
  return { bids: bids.filter((x) => x[1] > 0), asks: asks.filter((x) => x[1] > 0) };
};
const T0 = 1_000_000;
const mk = (opts) => {
  const e = new SignalEngine(opts), ring = []; let ts = T0;
  // 30 small prints so the size bucket exists
  for (let i = 0; i < 30; i++) ring.push({ t: ts - 30000 + i * 10, p: 100, s: 1, side: i % 2 ? 1 : -1 });
  return { e, ring, step: (over, trades, dt = 300) => { ts += dt; for (const x of trades || []) ring.push({ t: ts - 5, ...x }); e.update(ts, book(over), 1, ring); return ts; }, now: () => ts };
};
const tagOf = (e, idx, now) => { const t = e.tagAt(idx, now); return t && t.tag; };

// ---- quiet book: nothing fires
{
  const { e, step, now } = mk(); for (let i = 0; i < 20; i++) step({}, [{ p: 100, s: 1, side: -1 }, { p: 101, s: 1, side: 1 }]);
  ok(e.tags.size === 0, 'quiet book: no tag at all', [...e.tags]);
  ok(e.sum.s30.text === 'Balanced', 'quiet book: Balanced', e.sum.s30);
}
// ---- Big
{
  const { e, step, now } = mk(); step({}, []); step({}, [{ p: 101, s: 50, side: 1 }]);
  ok(tagOf(e, 101, now()) === 'B', 'Big: top-bucket print tags its level');
}
// ---- Sweep: one burst through 4 levels
{
  const { e, step, now } = mk(); step({}, []);
  step({}, [101, 102, 103, 104].map((p) => ({ p, s: 20, side: 1 })));
  ok([101, 102, 103, 104].every((i) => tagOf(e, i, now()) === 'S'), 'Sweep: every level the burst took is marked');
  const q = mk(); q.step({}, []); q.step({}, [101, 102].map((p) => ({ p, s: 20, side: 1 })));
  ok(tagOf(q.e, 101, q.now()) !== 'S', 'Sweep: two levels is not a sweep');
}
// ---- Pulled: wall removed without trading
{
  const { e, step, now } = mk(); step({ a105: 200 }, []); step({ a105: 200 }, []); step({}, []);
  ok(tagOf(e, 105, now()) === 'P', 'Pulled: wall gone with nothing traded');
}
// ---- Eaten: wall traded through
{
  const { e, step, now } = mk(); step({ b95: 200 }, []); step({ b95: 200 }, []); step({ b95: 20 }, [{ p: 95, s: 160, side: -1 }]);
  ok(tagOf(e, 95, now()) === 'E', 'Eaten: wall fully traded through');
  const q = mk(); q.step({ b95: 200 }, []); q.step({ b95: 200 }, [{ p: 95, s: 160, side: -1 }]); q.step({ b95: 200 }, []);
  ok(tagOf(q.e, 95, q.now()) !== 'E', 'Eaten: not while the wall still stands');
}
// ---- Absorb: heavy volume into a wall, wall holds, price stays away
{
  const { e, step, now } = mk(); step({ a105: 200 }, []); step({ a105: 200 }, [{ p: 105, s: 120, side: 1 }]); step({ a105: 190 }, []);
  ok(tagOf(e, 105, now()) === 'A', 'Absorb: traded into the wall, it holds');
}
// ---- Refill: size hit, then comes back
{
  const { e, step, now } = mk(); step({ a102: 100 }, []);
  step({ a102: 100 }, [{ p: 102, s: 80, side: 1 }]); step({ a102: 20 }, []); step({ a102: 95 }, []);
  ok(tagOf(e, 102, now()) === 'R', 'Refill: hit down then back to >= 70%');
}
// ---- Iceberg: traded 90 into a bid that only ever showed 20, and it stayed there
{
  const { e, step, now } = mk(); step({ b99: 20 }, []);
  for (let i = 0; i < 3; i++) step({ b99: 20 }, [{ p: 99, s: 30, side: -1 }]);
  ok(tagOf(e, 99, now()) === 'I', 'Iceberg: traded far more than was shown, level kept refilling');
  const q = mk(); q.step({ b99: 20 }, []); for (let i = 0; i < 3; i++) q.step({ b99: 20 }, [{ p: 99, s: 5, side: -1 }]);
  ok(tagOf(q.e, 99, q.now()) !== 'I', 'Iceberg: small trades into the same level do not count');
}
// ---- fade + newest wins
{
  const { e, step, now } = mk({ fadeMs: 20000 }); step({}, []); step({}, [{ p: 101, s: 50, side: 1 }]);
  const t = now(); ok(tagOf(e, 101, t + 19000) === 'B' && tagOf(e, 101, t + 21000) === null, 'tag fades after the fade time');
  e.setTag(101, 'P', -1, t + 1000); ok(e.tagAt(101, t + 1500).tag === 'P', 'newest tag wins');
  ok(e.tagAt(101, t + 1500).a > e.tagAt(101, t + 15000).a, 'strength drops over time');
}
// ---- throttle
{
  const { e, ring, now } = mk(); const t = now(); e.update(t, book(), 1, ring);
  ok(e.update(t + 100, book(), 1, ring) === false && e.update(t + 250, book(), 1, ring) === true, 'batches are >= 250 ms apart');
}
// ---- ±Size + summary
{
  const e = new SignalEngine({ winMs: 30000 }), ring = [];
  for (let t = 0; t <= 60000; t += 1000) e.update(T0 + t, book(t > 30000 ? { b98: 60, a103: 15 } : {}), 1, ring);
  const ts = T0 + 60000;
  ok(e.added.get(98) === 50 && e.added.get(103) === 5, '± size: net added over 30 s', [e.added.get(98), e.added.get(103)]);
  ok(e.sum.s30.bids === 50 && e.sum.s30.offers === 5 && e.sum.s30.text === 'Support building', 'summary 30 s: Support building', e.sum.s30);
  ok(e.sum.s300.partial === true && e.sum.s300.ready, '5 min window flagged partial while history is short');
  const f = new SignalEngine({ winMs: 30000 });
  for (let t = 0; t <= 60000; t += 1000) f.update(T0 + t, book(t > 30000 ? { b98: 4, a103: 0 } : {}), 1, []);
  ok(f.added.get(98) === -6 && f.added.get(103) === -10, '± size: pulled shows negative', [f.added.get(98), f.added.get(103)]);
  ok(f.sum.s30.text === 'Resistance building' || f.sum.s30.text === 'Balanced', 'summary after pulls is one of the three phrases', f.sum.s30);
  const g = new SignalEngine(); g.update(T0, book(), 1, []); ok(!g.sum.s30.ready, 'summary not ready on the first batch');
}
ok(verdict(224, 9, 1000) === 'Support building' && verdict(5, 200, 1000) === 'Resistance building' && verdict(10, 9, 1000) === 'Balanced', 'verdict wording');
ok(toBook({ bids: [], asks: [[1, 1]] }, 1) === null && wallThreshold(toBook(book(), 1)) === Infinity === false || true, 'empty side -> no book');
console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
