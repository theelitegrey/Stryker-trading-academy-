// STOCKS ENGINE tests (src/stock-engine.js + the quote leg of src/is-hub.js). node workers/book-recorder/test/stock-engine.test.mjs
// Proves: timeframe specs; budget (day cap, per-minute cap, concurrency, day roll); the store round trip (packed Float64); one provider call
// per (symbol, tf) shared by every reader, re-used until its TTL, served stale over budget; spend=false never calls the provider; the
// delayed lane cuts at now-10 min with no live tail; the quote tail moves the forming 1m / 5m / D bar; scroll-back by `to`; refused
// non-stock types; the hub carries quotes on the SAME socket, 10 per unit, behind the series legs, and never sends the key anywhere else.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { StockEngine, StockBudget, Tail, skStore, skSpec, mergeTail, rowsOf, pack, f64, lowerIdx, ttlFor, infoOf, searchRows, codeOk, skCut, SK_HOT } from '../src/stock-engine.js';
import { ISHub } from '../src/is-hub.js';
import { delayCut } from '../src/tick-engine.js';

let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const MIN = 60000;
const sqlOf = () => { const db = new DatabaseSync(':memory:'); return { exec(q, ...a) { const st = db.prepare(q); const sel = /^\s*SELECT/i.test(q); const args = a.map((x) => (x instanceof Uint8Array ? Buffer.from(x) : x)); const rows = sel ? st.all(...args) : (st.run(...args), []); return { toArray: () => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Uint8Array ? new Uint8Array(v) : v]))) }; } }; };

// ---- specs
assert.deepEqual([skSpec('5S').bt, skSpec('1').bt, skSpec('240').n, skSpec('D').bt, skSpec('1W').bt, skSpec('M').bt], ['second', 'minute', 240, 'day', 'week', 'month']);
assert.equal(skSpec('100T'), null); assert.equal(skSpec('0'), null); assert.equal(skSpec('60S'), null); assert.equal(skSpec('1441'), null);
assert.ok(codeOk('NASDAQ:AAPL') && codeOk('NYSE:BRK.B') && codeOk('NSE:RELIANCE') && codeOk('XETR:SAP') && !codeOk('AAPL') && !codeOk('NASDAQ:AAPL;x') && !codeOk('a:b'));
ok('timeframe specs (seconds, minutes, D/W/M; no tick bars) and code validation');

// ---- budget
{
  let t = Date.UTC(2026, 10, 5, 23, 59, 0); const B = new StockBudget({ dayMax: 5, minMax: 3, conc: 2, now: () => t });
  assert.ok(B.take() && B.take()); assert.equal(B.take(), false, 'conc 2'); B.done(); B.done();
  assert.ok(B.take()); B.done(); assert.equal(B.take(), false, '3 a minute'); t += 61000;   // next UTC day too
  assert.ok(B.take()); B.done(); assert.equal(B.stats().used, 1, 'day rolled'); assert.equal(B.stats().day, '2026-11-06');
  for (let i = 0; i < 2; i++) { assert.ok(B.take()); B.done(); }
  t += 61000; for (let i = 0; i < 2; i++) { assert.ok(B.take()); B.done(); }
  assert.equal(B.take(), false, 'day cap 5'); assert.ok(B.refused >= 3);
  ok('budget: per-day cap, per-minute cap, concurrency, UTC day roll');
}
{
  let used = 114999; const B = new StockBudget({ dayMax: 100, minMax: 100, conc: 9, monthUsed: () => used });
  assert.equal(B.stats().monthStop, 115000, 'default month stop 115,000');
  assert.ok(B.can() && B.take()); B.done();
  used = 115000; assert.equal(B.can(), false); assert.equal(B.take(), false, 'stops at the month counter'); assert.equal(B.stats().monthStopped, true);
  used = 300; assert.ok(B.take(), 'new period (counter reset): polling resumes'); B.done();
  assert.ok(new StockBudget({ monthUsed: () => null }).take(), 'unknown counter: no month stop');
  ok('budget: month stop at the shared REST counter (default 115,000), resumes after the reset');
}
{
  // engine over the month stop: a stored series is served stale, no provider call
  let calls = 0; const s = new Map();
  const st = { get: (c, t) => s.get(c + '|' + t) || null, put: (c, t, at, f) => s.set(c + '|' + t, { at, f }), info: () => ({ at: Date.now(), j: { type: 'STOCK', timezone: 'America/New_York' } }), putInfo() {}, count: () => s.size, prune() {} };
  st.put('NASDAQ:AAPL', '5', Date.now() - 86400000, pack([[Date.now() - 86400000, 1, 1, 1, 1, 1]]));
  const E = new StockEngine(st, { key: 'K', fetch: async () => { calls++; return new Response('{}'); }, monthUsed: () => 116000 });
  const r = await E.bars('NASDAQ:AAPL', '5', {});
  assert.equal(calls, 0, 'no provider call over the month stop'); assert.equal(r.stale, true); assert.equal(r.b.length, 1);
  ok('engine: over the month stop serves stored bars (stale), zero provider calls');
}

// ---- rows, pack, store
{
  const j = { series_keys: ['time', 'open', 'high', 'low', 'close', 'volume'], series: [[60, 1, 2, 0.5, 1.5, 10], [60, 9, 9, 9, 9, 9], [120, 1.5, 3, 1, 2, 5], [180, 0, 0, 0, 0, 0]] };
  const r = rowsOf(j); assert.deepEqual(r, [[60000, 1, 2, 0.5, 1.5, 10], [120000, 1.5, 3, 1, 2, 5]], 'abbr rows, dup time and zero close dropped');
  assert.deepEqual(rowsOf({ series: [{ time: 60, open: 1, high: 1, low: 1, close: 1, volume: 2 }] }), [[60000, 1, 1, 1, 1, 2]]);
  const st = skStore(sqlOf()); st.put('NASDAQ:AAPL', '1', 5, pack(r));
  const g = st.get('NASDAQ:AAPL', '1'); assert.equal(g.at, 5); assert.deepEqual(Array.from(g.f), r.flat()); assert.equal(lowerIdx(g.f, 61000), 1); assert.equal(st.count(), 1);
  ok('provider rows (object + abbr) -> bars; Float64 store round trip; binary search');
}

// ---- fake provider
const NOW0 = Date.UTC(2026, 10, 5, 15, 0, 30);   // Thu 10:00:30 ET
function provider(o = {}) {
  const calls = [];
  const series = (bt, n, end) => { const out = []; const ms = bt === 'second' ? n * 1000 : bt === 'minute' ? n * MIN : 86400000; const last = Math.floor(end / ms) * ms; for (let i = 0; i < (o.N || 600); i++) { const t = last - (o.N || 600 - 1 - i) * ms + i * ms - (o.N ? 0 : 0); out.push([t / 1000, 100 + i, 101 + i, 99 + i, 100.5 + i, 10]); } return out; };
  const f = async (url, init) => {
    url = String(url); calls.push(url);
    assert.equal(init.headers.authorization, 'Bearer K', 'key only in the provider request header');
    if (o.fail) return new Response('x', { status: 500 });
    if (/\/session/.test(url)) return Response.json({ type: /NOTSTOCK/.test(url) ? 'FUTURES' : 'STOCK', description: 'Apple Inc.', currency_code: 'USD', timezone: 'America/New_York', tick_size: '0.0001 1 0.01', price_scale: 100, start_hour: '0400', end_hour: '2000', details: [{ session: '0930-1600', description: 'Regular Trading Hours' }] });
    if (/\/search/.test(url)) return Response.json({ symbols: [{ code: 'NASDAQ:AAPL', name: 'AAPL', type: 'STOCK', exchange: 'NASDAQ', country: 'US', currency_code: 'USD', description: 'Apple Inc.' }, { code: 'CME:AAPL1!', type: 'FUTURES' }] });
    const m = /bar_type=(\w+)&bar_interval=(\d+)/.exec(url);
    const ms = m[1] === 'second' ? +m[2] * 1000 : m[1] === 'minute' ? +m[2] * MIN : 86400000, end = o.now(), last = Math.floor(end / ms) * ms, N = 600;
    const rows = []; for (let i = 0; i < N; i++) { const t = last - (N - 1 - i) * ms; rows.push([t / 1000, 100, 101, 99, 100 + i / 100, 10]); }
    return Response.json({ series_keys: ['time', 'open', 'high', 'low', 'close', 'volume'], series: rows });
  };
  return { f, calls };
}
{
  let t = NOW0; const P = provider({ now: () => t }); let noted = 0;
  const E = new StockEngine(skStore(sqlOf()), { key: 'K', fetch: P.f, now: () => t, note: (k) => { noted += k; } });
  const [a, b] = await Promise.all([E.bars('NASDAQ:AAPL', '1', { limit: 200 }), E.bars('NASDAQ:AAPL', '1', { limit: 200 })]);
  assert.equal(P.calls.filter((u) => /series/.test(u)).length, 1, 'two readers at once = one series call');
  assert.equal(P.calls.filter((u) => /session/.test(u)).length, 1, 'one session call');
  assert.equal(a.b.length, 200); assert.deepEqual(a.b, b.b); assert.equal(a.info.timezone, 'America/New_York'); assert.equal(a.info.session, '0930-1600'); assert.equal(a.info.mintick, 0.0001);
  assert.equal(noted, 2, 'every provider call is counted');
  t += 30000; await E.bars('NASDAQ:AAPL', '1'); assert.equal(P.calls.length, 2, 'inside the TTL: no call');
  t += 2 * MIN; const st = await E.bars('NASDAQ:AAPL', '1'); assert.equal(P.calls.length, 3, 'past the TTL (no live quotes, 1m = 60 s): re-fetched'); assert.equal(st.stale, false);
  // scroll back: an older page from the same stored series, no call
  const older = await E.bars('NASDAQ:AAPL', '1', { to: a.b[0][0], limit: 100 });
  assert.equal(older.b.length, 100); assert.ok(older.b[older.b.length - 1][0] < a.b[0][0]); assert.equal(P.calls.length, 3, 'scroll-back is served from the store');
  // a fresh engine on the same store (Durable Object restart) serves stale data when over budget, without a call
  ok('one call per (symbol, tf) shared by readers; TTL; scroll-back from the store; calls counted');
  // delayed lane: whole bars before now-10 min only
  const cut = skCut('delayed', t), d = await E.bars('NASDAQ:AAPL', '1', { cut });
  assert.equal(cut, delayCut(t)); assert.ok(d.b.length && d.b.every((x) => x[0] + MIN <= cut), 'nothing newer than the cut');
  assert.equal(skCut('live', t), Infinity);
  ok('delayed lane: cut at the whole minute 10 min ago (server clock)');
  // refused types
  assert.deepEqual(await E.bars('CME:NOTSTOCK', '1'), { refused: true });
  assert.equal(await E.bars('NASDAQ:AAPL', '100T'), null);
  const sr = await E.search('aapl'); assert.equal(sr.length, 1, 'search keeps stock-like types only'); assert.equal(sr[0].type, 'stock');
  const calls = P.calls.length; await E.search('AAPL'); assert.equal(P.calls.length, calls, 'search memoised');
  ok('non-stock types refused, no tick bars, search filtered + memoised');
}
// spend=false: never a provider call
{
  let t = NOW0; const P = provider({ now: () => t });
  const E = new StockEngine(skStore(sqlOf()), { key: 'K', fetch: P.f, now: () => t });
  await assert.rejects(E.bars('NASDAQ:AAPL', '5', { spend: false }), (e) => e.signin);
  await assert.rejects(E.search('aapl', false), (e) => e.signin);
  assert.equal(P.calls.length, 0, 'signed out: no call');
  await E.bars('NASDAQ:AAPL', '5'); const c = P.calls.length; t += 3600000;
  const r = await E.bars('NASDAQ:AAPL', '5', { spend: false }); assert.equal(P.calls.length, c, 'stale + signed out: store only'); assert.equal(r.stale, true);
  assert.equal(E.want.has('NASDAQ:AAPL'), true); E.want.clear(); await E.bars('NASDAQ:AAPL', '5', { spend: false }); assert.equal(E.want.size, 0, 'a signed-out read does not start a quote stream');
  ok('spend=false (not signed in): store only, never a provider call, never a quote stream');
}
// over budget: stale copy, no call; provider down: stale copy
{
  let t = NOW0; const P = provider({ now: () => t });
  const E = new StockEngine(skStore(sqlOf()), { key: 'K', fetch: P.f, now: () => t, DAY_MAX: 2 });
  await E.bars('NASDAQ:AAPL', '15'); assert.equal(P.calls.length, 2);
  t += 3600000; const r = await E.bars('NASDAQ:AAPL', '15'); assert.equal(P.calls.length, 2, 'day cap hit: no call'); assert.equal(r.stale, true); assert.ok(r.b.length > 0);
  await assert.rejects(E.bars('NASDAQ:MSFT', '15'), (e) => e.budget, 'nothing stored + over budget = budget error (429 to the page)');
  assert.ok(E.stats().budget.refused >= 1);
  ok('over the stocks budget: stored data served stale, never a provider call');
}
// TTLs
assert.equal(ttlFor(skSpec('1'), false, false), MIN); assert.equal(ttlFor(skSpec('1'), true, false), 30 * MIN); assert.equal(ttlFor(skSpec('D'), false, true), 6 * 3600000); assert.equal(ttlFor(skSpec('5S'), false, false), MIN);
ok('cadence: 1m re-fetch 60 s without quotes / 30 min with quotes; closed market 30 min-6 h');

// ---- tail + merge
{
  const T = new Tail();
  const t0 = Date.UTC(2026, 10, 5, 15, 1, 0);
  T.add({ code: 'X', last_price: 10, volume: 1000, lp_time: t0 / 1000 + 1 }, t0 + 1000);
  T.add({ volume: 1005, last_price: 10.5, lp_time: t0 / 1000 + 2 }, t0 + 2000);
  T.add({ bid: 10.4 }, t0 + 2500);   // bid only: no bar change
  T.add({ last_price: 9.8, volume: 1010, lp_time: t0 / 1000 + 65 }, t0 + 65000);
  assert.deepEqual(T.m, [[t0, 10, 10.5, 10, 10.5, 5], [t0 + MIN, 9.8, 9.8, 9.8, 9.8, 5]]);
  assert.equal(T.s.length, 3);
  const bars = [[t0 - 2 * MIN, 1, 1, 1, 1, 1], [t0 - MIN, 2, 2, 2, 2, 2], [t0, 10, 10.2, 9.9, 10.1, 50]];
  const m1 = mergeTail(bars, t0 + 30000, skSpec('1'), T);
  assert.deepEqual(m1.slice(-2), [[t0, 10, 10.5, 9.9, 10.5, 50], [t0 + MIN, 9.8, 9.8, 9.8, 9.8, 5]], 'the fetched minute takes the tail high / close (volume not re-added); later minutes are appended');
  const stale = Object.assign(new Tail(), { s: T.s, m: T.m, q: T.q, at: t0 + 10000 });
  assert.deepEqual(mergeTail(bars, t0 + 30000, skSpec('1'), stale).slice(-2)[0], [t0, 10, 10.5, 9.9, 10.1, 50], 'a tail older than the fetch never pulls the close back');
  assert.equal(bars.length, 3, 'stored bars untouched');
  const b5 = [[t0 - 5 * MIN, 1, 1, 1, 1, 1], [t0, 10, 10.2, 9.9, 10.1, 50]];
  const m5 = mergeTail(b5, t0 + 30000, skSpec('5'), T);
  assert.deepEqual(m5[m5.length - 1], [t0, 10, 10.5, 9.8, 9.8, 55], '5m: the tail folds into the forming 5-minute bar');
  const dd = [[Date.UTC(2026, 10, 5, 5), 9, 11, 9, 10, 100]];
  T.add({ high_price: 12, low_price: 8.5, volume: 2e6, last_price: 9.9, lp_time: t0 / 1000 + 70 }, t0 + 70000);
  assert.deepEqual(mergeTail(dd, t0, skSpec('D'), T)[0], [dd[0][0], 9, 12, 8.5, 9.9, 2e6], 'D: the quote day high / low / last / volume');
  ok('quote tail: 1 s + 1 m bars from sparse quotes; merged onto 1m / 5m / D without touching the store');
}

// ---- engine + hub: quotes ride the SAME socket, behind series legs, 10 per unit
{
  const socks = [];
  class FakeWS { constructor(u) { this.url = u; this.sent = []; this.l = {}; socks.push(this); setTimeout(() => this.emit('open', {}), 2); } addEventListener(e, f) { (this.l[e] = this.l[e] || []).push(f); } emit(e, ev) { for (const f of this.l[e] || []) f(ev); } send(m) { this.sent.push(JSON.parse(m)); } close() { this.closed = true; setTimeout(() => this.emit('close', {}), 1); } msg(o) { this.emit('message', { data: JSON.stringify(o) }); } }
  const store = () => { const m = new Map(); return { get: async (k) => m.get(k), put: (k, v) => { m.set(k, v); } }; };
  const hub = new ISHub(store(), 'K', { WebSocket: FakeWS, MAX_LEGS: 5, SEND_GAP_MS: 10, PENDING_MS: 10, QUOTE_GAP_MS: 30, QUOTE_TICK_MS: 20, LEG_IDLE_MS: 100 });
  let t = Date.UTC(2026, 10, 5, 3, 0, 0);   // US closed: no HOT list
  const P = provider({ now: () => t });
  const E = new StockEngine(skStore(sqlOf()), { key: 'K', fetch: P.f, now: () => t, hub });
  await E.bars('NASDAQ:AAPL', '1');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(socks.length, 1, 'one socket'); const sub = socks[0].sent[0];
  assert.deepEqual(sub.subscriptions, [{ code: 'NASDAQ:AAPL', type: 'quote' }]); assert.equal(sub.api_key, 'K');
  socks[0].msg({ event: 'subscription_status', status: 'active' });
  socks[0].msg({ event: 'quote_update', code: 'NASDAQ:AAPL', last_price: 123.4, volume: 10, lp_time: t / 1000 });
  assert.equal(E.tails.get('NASDAQ:AAPL').q.last_price, 123.4); assert.ok(E.isLive('NASDAQ:AAPL'));
  // a futures series leg attaches: it goes first, quotes keep the units it leaves
  const c = { got: [], send(s) { c.got.push(JSON.parse(s)); }, close() {} };
  hub.attach([{ code: 'CME_MINI:NQ1!', bar_type: 'minute', bar_interval: 1 }], c);
  await new Promise((r) => setTimeout(r, 400));
  const last = socks[0].sent[socks[0].sent.length - 1].subscriptions;
  assert.equal(last[0].type, 'series'); assert.ok(last.some((s) => s.type === 'quote' && s.code === 'NASDAQ:AAPL'));
  assert.equal(socks.length, 1, 'still one socket');
  // 60 wanted codes, 4 free units -> 40 quotes
  for (let i = 0; i < 60; i++) E.want.set('NYSE:S' + i, t - i);
  assert.equal(hub.quoteWant().length, 40, '4 free units x 10 quotes');
  // US hours: the HOT list joins after the on-demand codes
  t = Date.UTC(2026, 10, 5, 15, 0, 0); E.want.clear(); E.want.set('XETR:SAP', t);
  const w = E.quoteCodes(t); assert.equal(w[0], 'XETR:SAP'); assert.equal(w.length, 1 + SK_HOT.length);
  // idle: dropped after WANT_IDLE_MS
  t += 3 * 3600000; assert.equal(E.quoteCodes(Date.UTC(2026, 10, 6, 3)).length, 0);
  // a bad code is dropped from the set, the rest stays
  socks[0].msg({ error: 'invalid_symbol', code: 'NYSE:BAD', message: 'Invalid symbol code' });
  assert.ok(hub.badCodes.has('NYSE:BAD')); assert.equal(socks[0].closed, undefined);
  hub.shutdown();
  ok('quotes ride the ONE hub socket behind the series legs, 10 per free unit, HOT list in US hours, idle codes dropped');
}
// info parsing / search rows
{
  const i = infoOf('NSE:RELIANCE', { type: 'STOCK', description: 'Reliance', currency_code: 'INR', timezone: 'Asia/Kolkata', tick_size: '0.01 250 0.05', price_scale: 10, start_hour: '0900', end_hour: '1600', details: [{ session: '0915-1530#20260803/0915-1515', description: 'Regular Trading Hours' }], api_key: 'leak?' });
  assert.equal(i.session, '0915-1530'); assert.equal(i.timezone, 'Asia/Kolkata'); assert.equal(i.mintick, 0.01); assert.equal(JSON.stringify(i).includes('leak'), false);
  assert.equal(searchRows({ symbols: [{ code: 'AMEX:SPY', type: 'FUND', exchange: 'AMEX' }] })[0].type, 'etf');
  ok('session -> info (regular hours, timezone, tick; no passthrough), FUND -> etf');
}
console.log('\n' + n + ' checks passed');
