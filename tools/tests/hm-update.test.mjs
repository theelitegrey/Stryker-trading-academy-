// Member GK 14 Nov: "still the heatmap and big trades indicator are not updated even after refreshing the chart" (NQ1! 1m, market closed).
//   node tools/tests/hm-update.test.mjs
// 1. Big Trades (L2/L1) trade store: while CME is closed the hub never says 'live', so the store never read its history and Big Trades
//    showed 0 marks after every refresh. Now a closed market reads the recorded prints over HTTP at once; when the market opens the
//    store reads only the gap (fillGap) and keeps what it holds. A connecting (not closed) market still waits for 'live'.
// 2. Depth Heatmap gap note: the recorder had no NQ book after 13 Nov 08:27 UTC while trades ran to the close. With every read in and
//    no sample in the 15 min before the last bar, the indicator says so with the last recorded time; '' when the book is there or reads are out.
import assert from 'node:assert/strict';
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
globalThis.Event = globalThis.Event || class { constructor(t) { this.type = t; } };
globalThis.document = globalThis.document || { hidden: false, addEventListener() {}, removeEventListener() {}, documentElement: { getAttribute() { return ''; } } };
globalThis.location = { hostname: '127.0.0.1', host: '127.0.0.1' };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.WebSocket = class { constructor() { this.readyState = 0; } send() {} close() {} };   // never opens: the hub stays not-live
window.__stkL2Test = { base: 'http://rec' };
let n = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? '' : ' ' + JSON.stringify(x))); n++; console.log('PASS ' + m); };
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const now = Date.now(), H = 3600000;
const reqs = [];
globalThis.fetch = async (url) => {
  const u = new URL(url); reqs.push(u.pathname + ' ' + u.searchParams.get('sym') + ' ' + u.searchParams.get('from') + ' ' + u.searchParams.get('to'));
  if (u.pathname !== '/ts-trades') return { ok: true, status: 200, json: async () => ({ fp: [], imb: [] }), arrayBuffer: async () => new ArrayBuffer(8), headers: { get: () => '0' } };
  const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to')), trades = [];
  for (let t = Math.ceil(from / 600000) * 600000; t <= to; t += 600000) if (t < now - 13 * H) trades.push([t, 28000, 150, 1]);   // recorded prints stop at the close, 13 h ago
  return { ok: true, status: 200, json: async () => ({ at: now, floor: 5, left: 0, trades, delta: [] }) };
};
// the same module instance chart-ts-trades.js imports (its ?v= query), so the root state is shared
import fs from 'node:fs';
const V = JSON.parse(fs.readFileSync(new URL('../../assets/version.json', import.meta.url), 'utf8')).build;
const L2 = await import('../../assets/chart-futures-l2.js?v=' + V);
const TS = await import('../../assets/chart-ts-trades.js');

// ---- 1a. closed market: history is read without a 'live' status
const r = L2.rootState('NQ'); r.status = 'reconnecting'; r.closed = true;   // the hub's 'idle' (CME closed) = reconnecting + closed
ok(L2.l2Closed('NQ'), 'the hub says idle: l2Closed');
let pokes = 0;
const h = TS.tsOpen('NQ', now - 30 * H, () => pokes++);
await settle(60);
ok(reqs.some((x) => x.startsWith('/ts-trades NQ')), 'closed market: /ts-trades is read at once (was: never, until CME opens)', reqs);
ok(h.s.started && !h.s.loading && h.s.trades.length > 10, 'the store holds the recorded prints', { started: h.s.started, loading: h.s.loading, n: h.s.trades.length });
ok(h.s.loadedFrom <= now - 30 * H + 60000, 'history reaches back to the chart\'s first bar (30 h)', (now - h.s.loadedFrom) / H);
ok(pokes > 0, 'the indicator was told (repaint)');
// ---- 1b. the market opens: only the gap is read; the held prints stay
const before = h.s.trades.length, nReq = reqs.length;
r.status = 'live'; r.closed = false; r.listeners.forEach((f) => f(null));
await settle(60);
const after = reqs.slice(nReq).filter((x) => x.startsWith('/ts-trades'));
ok(after.length === 1 && Number(after[0].split(' ')[2]) >= now - 2 * H, 'open: one gap read from the last history point (fillGap), not a full reload', after);
ok(h.s.trades.length === before && !h.s.loading, 'the prints already held are kept', [before, h.s.trades.length]);
h.release();
// ---- 1c. not closed (session open, socket still connecting): wait for 'live' as before
const r2 = L2.rootState('ES'); r2.status = 'reconnecting'; r2.closed = false;
const cmeOpen = (await import('../../assets/chart-futures-provider.js?v=' + V)).cmeOpenNow();
if (cmeOpen) {
  const k = reqs.length, h2 = TS.tsOpen('ES', now - 6 * H, () => {}); await settle(40);
  ok(!reqs.slice(k).some((x) => x.startsWith('/ts-trades ES')) && !h2.s.started, 'session open + socket connecting: no read until live (unchanged)');
  h2.release();
} else console.log('SKIP 1c: the CME clock says closed right now, so l2Closed is true for any not-live root (covered by 1a)');

// ---- 2. Depth Heatmap: book gap note
const D = await import('../../assets/chart-depth-heatmap.js');
const M = 60000, end = Date.UTC(2026, 10, 13, 21, 59), last = Date.UTC(2026, 10, 13, 8, 27);
const hist = []; for (let t = last - 60 * M; t <= last; t += 5000) hist.push({ ts: t });
const done = { busy: false, state: 'ok', from: end - 30 * H };
const note = D.bookGapNote(hist, end, done);
ok(/No order book recorded since 11-13 08:27 \(data feed gap\)/.test(note), 'GK case: feed gap named with the last recorded time', note);
ok(/^No order book since /.test(D.bookGapNote(hist, end, done, { phone: true })), 'phone: short text');
ok(D.bookGapNote(hist, end, done, { fmt: () => 'Fri 13:57' }) === 'No order book recorded since Fri 13:57 (data feed gap)', 'time in the chart\'s own zone (formatter)');
ok(D.bookGapNote(hist, last + 5 * M, done) === '', 'book within 15 min of the last bar: no note');
ok(D.bookGapNote(hist, end, { busy: true, state: 'ok', from: end - 30 * H }) === '', 'a read still out: no note yet');
ok(D.bookGapNote(hist, end, { busy: false, state: 'none', from: Infinity }) === '', 'nothing read yet: no note');
ok(D.bookGapNote(hist, end, { busy: false, state: 'ok', from: end - 5 * M }) === '', 'history does not reach 15 min back yet: no note');
ok(/for these bars/.test(D.bookGapNote([], end, done)), 'no sample at all: says none recorded');
ok(D.bookGapNote(hist, 0, done) === '', 'no bars: no note');
console.log(n + ' passed');
process.exit(0);
