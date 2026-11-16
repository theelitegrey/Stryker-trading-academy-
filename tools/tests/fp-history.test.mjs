// Footprint history paging (member Harry 2026-11-12, "Footprint not loading, I want historical data"): fpNeed(root, t) must read the hub's
// /ts-aux in 6 h windows back to t (never past 48 h), seed those minutes into the TickFeed, never overwrite minutes it already holds, and
// say busy / failed through fpState().  node tools/tests/fp-history.test.mjs
import assert from 'node:assert/strict';
globalThis.window = globalThis.window || {}; globalThis.document = globalThis.document || { addEventListener() {}, hidden: false, documentElement: { getAttribute() { return ''; } } };
globalThis.location = { hostname: '127.0.0.1' };
window.__stkL2Test = { base: 'http://rec' };
const L2 = await import('../../assets/chart-futures-l2.js');
let n = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? '' : ' ' + JSON.stringify(x))); n++; console.log('PASS ' + m); };
const H = 3600000, now = Date.now(), M = (t) => Math.floor(t / 60000);
const reqs = []; let fail = false;
globalThis.fetch = async (url) => {   // the Worker's /ts-aux: one footprint minute per 10 min in [from, to]
  const u = new URL(url); reqs.push([Number(u.searchParams.get('from')), Number(u.searchParams.get('to'))]);
  if (fail) return { ok: false, status: 500 };
  const fp = []; for (let t = M(Number(u.searchParams.get('from'))); t <= M(Number(u.searchParams.get('to'))); t++) if (t % 10 === 0) fp.push({ t, lv: [[28000, 9, 1]] });
  return { ok: true, status: 200, json: async () => ({ fp, imb: [] }) };
};
const settle = () => new Promise((r) => setTimeout(r, 20));
const r = L2.rootState('NQ'); r.trades = new L2.TickFeed('NQ');
// the page-open seed: the last 3 h, plus one live minute that must survive the history read
const seedFrom = now - 3 * H, mark = M(now - 4 * H) - (M(now - 4 * H) % 10);
r.trades.seed([{ t: M(seedFrom) + 10 - (M(seedFrom) % 10), lv: [[28000, 1, 1]] }]); r.fpFrom = seedFrom;
ok(r.trades.coverFrom > now - 3.1 * H, 'before: footprint starts at the page-open seed (the bug)');
r.trades.mins.set(mark * 60000, { b: new Map([[112000, 777]]), s: new Map(), dirty: true, bar: null });   // a minute already held inside the window history will read
L2.fpNeed('NQ', now - 20 * H); await settle();
ok(reqs.length === 3 && reqs.every(([f, t]) => t - f <= 6 * H), '3 reads of <= 6 h cover 3 h -> 20 h back', reqs.map(([f, t]) => [(now - f) / H, (now - t) / H]));
ok(reqs[0][1] === seedFrom && reqs[1][1] === reqs[0][0] && reqs[2][0] === now - 20 * H, 'newest first, contiguous, ends at the wanted time');
ok(r.trades.coverFrom <= now - 19.8 * H, 'after: footprint minutes reach 20 h back', (now - r.trades.coverFrom) / H);
ok(r.trades.mins.size > 100, 'the 3000-minute cap keeps the history (no 360-minute trim)', r.trades.mins.size);
ok(r.trades.mins.get(mark * 60000).b.get(112000) === 777, 'a minute already held is not replaced by history');
ok(!L2.fpState('NQ').busy && !L2.fpState('NQ').failed, 'state: done');
L2.fpNeed('NQ', now - 19 * H); await settle();
ok(reqs.length === 3, 'already covered: no new read');
L2.fpNeed('NQ', now - 100 * H); await settle();
ok(reqs.length === 8 && Math.min(...reqs.map((x) => x[0])) >= now - 48 * H - 1000, 'asks never go past the hub\'s 48 h', reqs.length);
// a failing read: flagged, and no hammering inside 30 s
const r2 = L2.rootState('ES'); r2.trades = new L2.TickFeed('ES'); r2.fpFrom = now - 3 * H; fail = true;
L2.fpNeed('ES', now - 10 * H); await settle();
const k = reqs.length; L2.fpNeed('ES', now - 10 * H); await settle();
ok(L2.fpState('ES').failed && reqs.length === k, 'a failed read is flagged and not retried at once');
console.log(n + ' passed');
