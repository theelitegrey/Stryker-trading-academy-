// Zscript data bindings (assets/zs/data/*): ops, frame builders, plan gate, no-lookahead, hub with fake chart stores.
// node tools/tests/zs-data.test.mjs
import assert from 'node:assert/strict';
import { evalData, FUNCTIONS, htfIndexAt } from '../../assets/zs/data/ops.js';
import * as ST from '../../assets/zs/data/stores.js';
import * as GATE from '../../assets/zs/data/gate.js';
import { getHub, resetHubForTests, marketOf } from '../../assets/zs/data/hub.js';
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };

// ---- ops ---------------------------------------------------------------------------------------------------------------
{
  const f = { book: { bb: [[100, 5], [99.75, 7], [99.5, 1]], ba: [[100.25, 4], [100.5, 20]], heat: { step: 0.25, i0: 398, v: [3, -2, 0] } },
    flow: { buy: 30, sell: 10, n: 12, cvd: 55, top: [9, 5, 2], fp: [[100, 4, 6], [100.25, 1, 9], [100.5, 5, 0]], poc: 100.25, vah: 100.5, val: 100 },
    gex: { call: 21000, put: 20000, flip: 20500, zu: 20600, zl: 20400, net: -3.5, lv: [20500, 21000] },
    opt: { nodes: [20500, 21000], ranges: { '0DTE': [20300, 20700], Weekly: [20000, 21000] }, ivrank: 42, pc: 0.9, maxpain: 20500, zone: 'cushion' } };
  const E = (name, ...a) => evalData(name, f, a);
  assert.equal(E('book.bid', 1), 100); assert.equal(E('book.bid', 2), 99.75); assert.equal(E('book.bid', 4), null); assert.equal(E('book.bid', 0), null);
  assert.equal(E('book.ask', 1), 100.25); assert.equal(E('book.bidsize', 2), 7); assert.equal(E('book.asksize', 9), null);
  assert.equal(E('book.depth', 'bid', 2), 12); assert.equal(E('book.depth', 'ask', 10), 24); assert.equal(E('book.depth', 'x', 2), null);
  assert.ok(Math.abs(E('book.imbalance', 2) - (12 - 24) / 36) < 1e-12);
  assert.equal(E('book.wall', 'ask', 10), 100.5); assert.equal(E('book.wall', 'bid', 50), null);
  assert.equal(E('book.heat', 99.5), 3); assert.equal(E('book.heat', 99.75), 2); assert.equal(E('book.heat', 50), null);
  assert.equal(E('flow.buyvol'), 30); assert.equal(E('flow.sellvol'), 10); assert.equal(E('flow.delta'), 20); assert.equal(E('flow.cvd'), 55); assert.equal(E('flow.trades'), 12);
  assert.equal(E('flow.bigtrades', 5), 2); assert.equal(E('flow.bigtrades', 100), 0);
  assert.equal(E('flow.footprint', 100.25), 8); assert.equal(E('flow.footprint', 100.25, 'buy'), 9); assert.equal(E('flow.footprint', 100.25, 'total'), 10); assert.equal(E('flow.footprint', 105), null);
  assert.equal(E('flow.poc'), 100.25); assert.equal(E('flow.vah'), 100.5); assert.equal(E('flow.val'), 100);
  assert.equal(E('gex.callwall'), 21000); assert.equal(E('gex.putwall'), 20000); assert.equal(E('gex.flip'), 20500); assert.equal(E('gex.zero_upper'), 20600); assert.equal(E('gex.zero_lower'), 20400);
  assert.equal(E('gex.net'), -3.5); assert.equal(E('gex.level', 2), 21000); assert.equal(E('gex.level', 3), null);
  assert.equal(E('opt.node', 1), 20500); assert.deepEqual(E('opt.range', '0dte'), [20300, 20700]); assert.deepEqual(E('opt.range', 'weekly'), [20000, 21000]); assert.equal(E('opt.range', 'monthly'), null);
  assert.equal(E('opt.ivrank'), 42); assert.equal(E('opt.pc'), 0.9); assert.equal(E('opt.maxpain'), 20500); assert.equal(E('opt.zone'), 'cushion');
  assert.equal(evalData('book.bid', {}, [1]), null, 'no book in the frame = na'); assert.equal(evalData('gex.flip', null, []), null);
  assert.equal(Object.keys(FUNCTIONS).length, 8 + 10 + 7 + 6);
  for (const k of Object.keys(FUNCTIONS)) assert.doesNotThrow(() => evalData(k, f, [1, 1]), k);
  ok('every book/flow/gex/opt call: values, na, edge cases (' + Object.keys(FUNCTIONS).length + ' functions)');
}

// ---- flow aggregation ---------------------------------------------------------------------------------------------------
{
  const items = [{ t: 0, rows: [[100, 2, 3], [101, 1, 0]], n: 3, top: [5, 1] }, { t: 60000, rows: [[100, 0, 4]], n: 1, top: [4] }, { t: 120000, rows: [[101, 6, 1]], n: 2, top: [6] }];
  const m5 = ST.aggregateFlow(items, 300000);
  assert.equal(m5.size, 1); const b = m5.get(0);
  assert.equal(b.buy, 8); assert.equal(b.sell, 9); assert.equal(b.n, 6); assert.equal(b.cvd, -1); assert.deepEqual(b.top, [6, 5, 4, 1]);
  assert.equal(b.poc, 100); assert.deepEqual(b.fp.map((r) => r[0]), [100, 101]);
  const m1 = ST.aggregateFlow(items, 60000);
  assert.equal(m1.size, 3); assert.equal(m1.get(0).cvd, 0 + 0 * 1 + (3 + 0 - 2 - 1)); assert.equal(m1.get(60000).cvd, 4); assert.equal(m1.get(120000).cvd, -1);
  const noTop = ST.aggregateFlow([{ t: 0, rows: [[1, 1, 1]], n: 2, top: null }], 60000).get(0); assert.equal(noTop.top, null, 'no print sizes known = na, not 0');
  const va = ST.valueArea([[1, 1, 0], [2, 5, 5], [3, 2, 0], [4, 1, 1]], 0.7); assert.deepEqual([va.poc, va.val, va.vah], [2, 2, 3]);
  const wide = ST.aggregateFlow([{ t: 0, rows: Array.from({ length: 500 }, (_, i) => [i, 1, i]), n: 1 }], 60000).get(0);
  assert.ok(wide.fp.length <= ST.CAPS.fpRows && wide.fp[0][0] < wide.fp[1][0]); ok('flow: bars, cvd, value area, row cap');
}

// ---- book + no lookahead ------------------------------------------------------------------------------------------------
{
  const mk = (ts, mid) => ({ ts, mid, step: 0.25, i0: Math.floor(mid / 0.25) - 4, v: Float32Array.from([1, 2, 3, 4, -4, -3, -2, -1]) });
  const S = [mk(1000, 100), mk(2000, 101), mk(9000, 150)];
  const f = ST.bookFrameAt(S, 2500, 60000); assert.equal(f.ts, 2000, 'newest sample AT or before'); assert.ok(f.bb[0][0] < f.ba[0][0]);
  assert.equal(ST.bookFrameAt(S, 500, 60000), null, 'before the first sample = na');
  assert.equal(ST.bookFrameAt(S, 2000 + 700000, 600000), null, 'too old = na');
  assert.equal(ST.bookFrameAt(S, 8999, 60000).ts, 2000, 'a sample from the future is never used');
  assert.equal(f.bb.length, 4); assert.equal(f.ba.length, 4); assert.equal(f.bb[0][1], 4);
  const live = ST.bookFrameLive({ bids: new Map([[100, 3], [99.5, 2]]), asks: new Map([[100.5, 4]]) }, S[2], 99999); assert.deepEqual(live.bb[0], [100, 3]); assert.equal(live.mid, 100.25);
  ok('book: levels, as-of lookup, staleness, live');
}

// ---- gex / opt frames ----------------------------------------------------------------------------------------------------
{
  const snap = { t: 1000, s: 5000, cw: 5100, pw: 4900, zg: 5010, em: [5000, 40], k: [4900, 5000, 5100, 5200], g: [-3, -1, 2, 4] };
  const g = ST.gexFrameFromSnap(snap, (v) => v);
  assert.equal(g.call, 5100); assert.equal(g.put, 4900); assert.equal(g.flip, 5010); assert.equal(g.net, 2); assert.ok(g.zu > 5000 && g.zu < 5100, 'sign change between 5000 and 5100: ' + g.zu); assert.equal(g.zl, null);
  assert.deepEqual(g.lv, [5200, 4900, 5100, 5000]);
  const conv = ST.futConv(5000, 20000, 4); assert.equal(conv(5000), 20000); assert.equal(conv(5100), 20400);
  assert.equal(ST.futConv(5000, null, 4)(5000), null, 'no chart bar at the time = na');
  const o = ST.optFrameFromSnap(snap, (v) => v); assert.deepEqual(o.ranges['0DTE'], [4960, 5040]); assert.equal(o.zone, 'swing'); assert.equal(o.ivrank, null); assert.equal(o.pc, null);
  const sum = { t: 5, spot: 5000, flip: 4990, nodes: [{ k: 5100, g: 9 }], ranges: [{ k: '0DTE', lo: 4950, hi: 5050 }, { k: '0DTE', lo: 1, hi: 2 }], iv: { rank: 33 } };
  const o2 = ST.optFrameFromSummary(sum, (v) => v * 2, 5050, 0.8); assert.deepEqual(o2.ranges['0DTE'], [9900, 10100]); assert.equal(o2.maxpain, 10100); assert.equal(o2.pc, 0.8); assert.equal(o2.ivrank, 33);
  const lst = [{ t: 10 }, { t: 20 }, { t: 30 }]; assert.equal(ST.lastAtOrBefore(lst, 25, 't').t, 20); assert.equal(ST.lastAtOrBefore(lst, 5, 't'), null); assert.equal(ST.lastAtOrBefore(lst, 100, 't', 50), null);
  ok('gex/opt frames: levels, zero crossings, futures conversion, ranges');
}

// ---- request.security alignment (no lookahead) ---------------------------------------------------------------------------
{
  const H = 3600000, htf = [0, 1, 2, 3].map((i) => ({ t: i * H })); // 1h bars open at 0,1,2,3 h
  assert.equal(htfIndexAt(htf, H, 1 * H), 0, 'the 00:00 bar is closed at 01:00 and can be read by the 01:00 bar close');
  assert.equal(htfIndexAt(htf, H, 1.5 * H), 0, 'half way through bar 1: still bar 0');
  assert.equal(htfIndexAt(htf, H, 0.5 * H), -1, 'first hour: nothing closed yet');
  assert.equal(htfIndexAt(htf, H, 1.5 * H, true), 1, 'live bar may read the forming HTF bar');
  assert.equal(htfIndexAt(htf, H, 9 * H), 3);
  ok('request.security: closed HTF bars only; live bar reads the forming one');
}

// ---- gate -----------------------------------------------------------------------------------------------------------------
{
  const free = GATE.decide(true, true, {}); assert.ok(['book', 'flow', 'gex', 'opt'].every((k) => free[k].state === 'locked'));
  const open = GATE.decide(false, true, {}); assert.ok(Object.values(open).every((s) => s.state === 'ok'), 'owner flips ZS_DATA_FOLLOWS_PLAN=false: Free gets data');
  const pro = GATE.decide(true, false, { gex: 'No GEX for this symbol.' }); assert.equal(pro.book.state, 'ok'); assert.equal(pro.gex.state, 'na');
  assert.equal(GATE.NS_KIND.book, 'of'); assert.equal(GATE.NS_KIND.opt, 'gex');
  const seen = new Set(), a = GATE.noticeOnce(seen, 'gex', free.gex); assert.equal(a.upgrade, 'gex'); assert.equal(GATE.noticeOnce(seen, 'gex', free.gex), null, 'one notice only');
  assert.equal(GATE.noticeOnce(seen, 'book', pro.book), null);
  for (const t of Object.values(GATE.LOCKED_TEXT)) assert.ok(!/live|real-time|delayed|behind/i.test(t));
  ok('gate: Free locked, Pro open, owner switch, one-time notices, copy rules');
}

// ---- hub with fake chart stores -----------------------------------------------------------------------------------------
const MIN = 60000;
function fakeDeps({ free = false, replay = null, now = 9 * MIN + 30000, futures = true, zoro = true } = {}) {
  const rel = { book: 0, flow: 0 }, acq = { book: 0, flow: 0 };
  const samples = [
    { ts: 1 * MIN, mid: 100, step: 0.25, i0: 396, v: Float32Array.from([5, 6, -7, -8]) },
    { ts: 5 * MIN, mid: 101, step: 0.25, i0: 400, v: Float32Array.from([9, 9, -9, -9]) },
    { ts: 8 * MIN, mid: 103, step: 0.25, i0: 408, v: Float32Array.from([2, 2, -2, -2]) },
  ];
  const feed = { allHistory: () => samples, book: { bids: new Map([[102.75, 11]]), asks: new Map([[103, 12]]) } };
  const tf = { ring: [[3 * MIN + 5, 100, 7, 1]], tick: 0.25, coverFrom: 0, bars: () => [{ t: 3 * MIN, lo: 400, hi: 401, o: 400, c: 401, buy: Float64Array.from([3, 1]), sell: Float64Array.from([1, 0]), trades: 5 }] };
  const M = {
    pg: { tier: () => Promise.resolve({}), isFree: () => free },
    vn: { getVenue: (id) => (id === 'bybit' ? {} : null) },
    l2: { l2Root: (s) => ({ NQ: 'NQ' }[s] || null), isQuoteSym: () => false, l2Source: () => ({}), acquire: () => { acq.flow++; return { release: () => { rel.flow++; } }; }, rootState: () => ({ trades: tf }) },
    of: { acquireBookFeed: () => { acq.book++; return { feed, release: () => { rel.book++; } }; }, acquireTradeFeed: () => ({ feed: { order: [], bars: new Map(), coverFrom: 0 }, release() {} }) },
    gx: { gexSource: (s) => (/NQ/.test(s) ? { api: 'QQQ', fut: 'NQ', pro: true } : null), gexCached: () => null, gexFetch: () => Promise.resolve(null), gexAnchor: () => null, snapAt: (rows, ts) => ST.lastAtOrBefore(rows, ts, 't'), convOf: () => (v) => v },
    zd: { zoroOn: () => zoro, zoroSource: (s) => (/NQ/.test(s) ? { u: 'QQQ', fut: 'NQ', zoro: true } : null), histApi: (u, core) => core, closeAt: () => 20000, zoFetch: () => Promise.resolve(null), zoCached: () => null, zsum: () => null, convFor: () => (v) => v },
  };
  const rows = [{ t: 3 * 60, s: 400, cw: 410, pw: 390, zg: 399, em: [400, 4], k: [390, 400, 410], g: [-1, 1, 2] }, { t: 9 * 60, s: 410, cw: 420, pw: 395, zg: 404, em: [410, 4], k: [395, 410, 420], g: [-2, 1, 2] }];
  const heat = { history: () => Promise.resolve(rows) };
  let fake = true;
  return { M, rel, acq, deps: { load: () => Promise.resolve(M), now: () => now, replay: () => replay, heat: () => heat, follows: true } };
}
globalThis.document = { visibilityState: 'visible' }; globalThis.localStorage = { getItem: () => JSON.stringify({ NQ: 50 }) };
const bars = (k) => Array.from({ length: k }, (_, i) => ({ time: i * MIN, open: 1, high: 2, low: 0, close: 1.5, volume: 1 }));
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function run(opts, uses, tfm, nbars) {
  resetHubForTests();
  const fd = fakeDeps(opts), msgs = [];
  const hub = getHub(fd.deps);
  const s = hub.open({ sessionId: 7, symbol: 'futures:NQ1!', provider: 'futures', timeframe: String(tfm), uses, post: (m) => msgs.push(m) });
  await tick(); s.setBars(bars(nbars)); await tick(50);
  return { fd, msgs, s, hub };
}
{
  const r = await run({}, ['book', 'flow'], 1, 10);
  const init = r.msgs.find((m) => m.kind === 'zs.data.init'); assert.deepEqual(init.status, { book: 'ok', flow: 'ok', gex: 'unused', opt: 'unused' });
  assert.equal(r.fd.acq.book, 1); assert.equal(r.fd.acq.flow, 1);
  const fr = r.msgs.filter((m) => m.kind === 'zs.data.frames').flatMap((m) => m.frames), by = new Map(fr);
  assert.equal(by.get(0), null, 'before any sample: no book (na)');
  assert.equal(by.get(1 * MIN).book.mid, 100); assert.equal(by.get(4 * MIN).book.ts, 1 * MIN, 'bar 4 (closes 5:00) must not see the 5:00 sample...'.slice(0, 0) || 1 * MIN);
  assert.equal(by.get(5 * MIN).book.ts, 5 * MIN, 'bar 5 closes at 6:00: sees the 5:00 sample');
  assert.equal(by.get(4 * MIN).book.ts, 1 * MIN, 'bar 4 closes 5:00 - 1 ms: the 5:00 sample is NOT visible (no lookahead)');
  assert.equal(by.get(3 * MIN).flow.buy, 4); assert.equal(by.get(3 * MIN).flow.sell, 1); assert.equal(by.get(3 * MIN).flow.top[0], 7);
  assert.equal(by.get(2 * MIN).flow, undefined, 'no trades stored for that minute = na');
  assert.ok(fr.every(([t, f]) => !f || !f.gex), 'unused namespaces are never sent');
  const live = by.get(9 * MIN); assert.equal(live.book.bb[0][0], 102.75, 'the forming bar reads the live book');
  r.s.close(); assert.equal(r.fd.rel.book, 1); assert.equal(r.fd.rel.flow, 1); ok('hub: on-demand acquire, per-bar frames, no lookahead, release on close');
}
{
  const r = await run({ free: true }, ['book', 'gex'], 1, 5);
  const notes = r.msgs.filter((m) => m.kind === 'zs.data.notice'); assert.equal(notes.length, 2); assert.ok(notes.every((m) => m.state === 'locked' && m.upgrade));
  assert.equal(r.fd.acq.book, 0, 'a Free member never subscribes'); assert.ok(!r.msgs.some((m) => m.kind === 'zs.data.frames' && m.frames.some((f) => f[1])), 'no data frames at all');
  await run({ free: true }, ['book'], 1, 3); // second session, same hub reset: just must not throw
  ok('hub: Free member gets na + one notice, no subscription');
}
{
  resetHubForTests(); const fd = fakeDeps({ free: true }); fd.deps.follows = false;
  const hub = getHub(fd.deps), msgs = []; hub.open({ sessionId: 1, symbol: 'futures:NQ1!', provider: 'futures', timeframe: '1', uses: ['book'], post: (m) => msgs.push(m) });
  await tick(); assert.equal(fd.acq.book, 1); ok('ZS_DATA_FOLLOWS_PLAN=false opens the data for Free');
}
{
  const r = await run({ replay: 4 * MIN + 10000 }, ['book', 'gex', 'opt'], 1, 10);
  const by = new Map(r.msgs.filter((m) => m.kind === 'zs.data.frames').flatMap((m) => m.frames));
  assert.equal(by.get(6 * MIN), null, 'replay: bars after the replay clock get nothing');
  assert.equal(by.get(2 * MIN).book.ts, 1 * MIN); assert.equal(by.get(4 * MIN).book.ts, 1 * MIN, 'replay clock 4:10: the 5:00 sample is the future');
  assert.equal(by.get(4 * MIN).gex.call, 410 * 50 / 400 * 0 + 50 * 410 + (20000 - 50 * 400) , 'gex at 3:00 snapshot, converted with the chart close');
  assert.equal(by.get(2 * MIN).gex, undefined, 'before the first snapshot = na'); ok('replay: frames come from history at the replay clock only');
}
{
  resetHubForTests(); const fd = fakeDeps({ futures: false }); const hub = getHub(fd.deps), msgs = [];
  hub.open({ sessionId: 2, symbol: 'binance:BTCUSDT', provider: 'binance', timeframe: '30', uses: ['book', 'flow', 'gex', 'opt'], post: (m) => msgs.push(m) }); await tick();
  const st = msgs.find((m) => m.kind === 'zs.data.init').status; assert.equal(st.book, 'ok'); assert.equal(st.flow, 'na'); assert.equal(st.gex, 'na'); assert.equal(st.opt, 'na');
  const why = msgs.filter((m) => m.kind === 'zs.data.notice').map((m) => m.text).join(' '); assert.match(why, /1m to 15m/); assert.match(why, /GEX data is available for/); ok('crypto 30m: book ok, flow/gex/opt na with a reason');
}
{
  resetHubForTests(); const fd = fakeDeps(); const hub = getHub(fd.deps), msgs = [];
  const calls = []; const s = hub.open({ sessionId: 3, symbol: 'futures:NQ1!', provider: 'futures', timeframe: '1', uses: [], post: (m) => msgs.push(m), fetchSeries: async (sym, tf, rg) => { calls.push([sym, tf]); return [{ time: 0, open: 1, high: 2, low: 0, close: 1, volume: 1 }, { time: 3600000, open: 1, high: 2, low: 0, close: 2, volume: 1 }]; } });
  await tick(); await s.security({ reqId: 9, sym: 'futures:ES1!', tf: '60', from: 0, to: 7200000 }); await tick();
  const res = msgs.find((m) => m.kind === 'zs.sec.res'); assert.equal(res.reqId, 9); assert.equal(res.bars.length, 2); assert.deepEqual(res.bars[1], [3600000, 1, 2, 0, 2, 1]); assert.equal(res.tfMs, 3600000);
  await s.security({ reqId: 10, sym: 'futures:ES1!', tf: '60', from: 0, to: 7200000 }); assert.equal(calls.length, 1, 'same ask served from the cache'); ok('request.security: fetch via chart provider, cached');
}
{
  resetHubForTests(); const fd = fakeDeps({ replay: 1800000 }); const hub = getHub(fd.deps), msgs = [];
  const s = hub.open({ sessionId: 4, symbol: 'futures:NQ1!', provider: 'futures', timeframe: '1', uses: [], post: (m) => msgs.push(m), fetchSeries: async () => [{ time: 0, open: 1, high: 1, low: 1, close: 1 }, { time: 3600000, open: 1, high: 1, low: 1, close: 9 }] });
  await tick(); await s.security({ reqId: 1, sym: 'x', tf: '60', from: 0 }); const r = msgs.find((m) => m.kind === 'zs.sec.res'); assert.equal(r.bars.length, 1, 'replay: bars opened after the replay clock are dropped'); ok('request.security: replay cap');
}
{
  const m = marketOf('futures:NQ1!', ''); assert.equal(m.root, 'NQ'); assert.equal(m.futures, true); assert.equal(marketOf('bybit:BTCUSDT').provider, 'bybit'); ok('marketOf');
}
{
  const fx = JSON.parse((await import('node:fs')).readFileSync(new URL('../fixtures/zs/zs-frames.sample.json', import.meta.url), 'utf8'));
  const f = fx.frames[1][1]; assert.equal(evalData('book.ask', f, [2]), 100.5); assert.deepEqual(evalData('opt.range', f, ['weekly']), [95, 105]); assert.equal(evalData('gex.flip', fx.frames[0][1], []), null); ok('fixture frames');
}
console.log('\n' + n + ' groups passed');
process.exit(0);
