// GEX audit round 3 (2026-10-13): Cboe primary chain, gamma walls, zero gamma, session straddle band.
// Pure node + python3 (the feeder's compact mode), no network (fetch is stubbed):  node tools/tests/gex-cboe-test.mjs
// Fixtures: tools/tests/fixtures/gex/cboe-{QQQ,SPX}-20261013.json, real Cboe chains saved 13 Oct
// 2026 ~17:49 UTC (chain time 13:34 ET), 2026-10-13 and 2026-10-14 expiries only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { buildLevels, parseOptions, profile, levels, straddleRange, etEpoch, snapshotAllowed } from '../../functions/api/gex/_engine.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const load = (f) => JSON.parse(fs.readFileSync(new URL('./fixtures/gex/' + f, import.meta.url)));
const FIX = { QQQ: load('cboe-QQQ-20261013.json'), SPX: load('cboe-SPX-20261013.json') };

// ---- independent hand calculation of the zero-gamma flip (Black-Scholes gamma, calendar time to 16:00 ET) ----
function handFlip(chain, nowSec) {
  const OCC = /^([A-Z^]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
  const spot = chain.current_price;
  const rows = [];
  for (const o of chain.options) {
    const m = OCC.exec(o.option);
    if (!m || m[2] + m[3] + m[4] !== '261013' || !(o.iv > 0)) continue;
    rows.push({ k: +m[6] / 1000, call: m[5] === 'C', oi: o.open_interest, iv: o.iv });
  }
  const T = Math.max(900, etEpoch('2026-10-13T16:00:00') - nowSec) / (365 * 86400);
  const net = (S) => {
    let t = 0;
    for (const r of rows) {
      const v = r.iv * Math.sqrt(T);
      const d1 = (Math.log(S / r.k) + (0.045 + 0.5 * r.iv * r.iv) * T) / v;
      if (Math.abs(d1) > 12) continue;
      const g = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI) / (S * v);
      t += (r.call ? 1 : -1) * g * r.oi * 100 * S * S * 0.01;
    }
    return t;
  };
  let best = null;
  const N = 2000, lo = spot * 0.9, hi = spot * 1.1;
  let px = lo, pv = net(lo);
  for (let i = 1; i <= N; i++) {
    const x = lo + (hi - lo) * i / N, v = net(x);
    if (pv * v < 0) { const z = px + (x - px) * Math.abs(pv) / (Math.abs(pv) + Math.abs(v)); if (best == null || Math.abs(z - spot) < Math.abs(best - spot)) best = z; }
    px = x; pv = v;
  }
  return best;
}

for (const name of ['QQQ', 'SPX']) {
  const chain = FIX[name].data;
  const now = etEpoch(chain.last_trade_time) + 60;
  const { spot, contracts } = parseOptions(chain, 0, now);
  ok(contracts.length > 100 && contracts.every((c) => c.exp.toISOString().slice(0, 10) === '2026-10-13'), name + ' dte=0: only the 2026-10-13 expiry (' + contracts.length + ' contracts)');
  const c1 = parseOptions(chain, 1, now).contracts;
  ok(c1.length > 100 && c1.every((c) => c.exp.toISOString().slice(0, 10) === '2026-10-14'), name + ' dte=1: only the 2026-10-14 expiry');
  const p = profile(spot, contracts);
  const lv = levels(spot, p.gex, contracts, p, now);
  // gamma walls by brute force
  const near = (k) => Math.abs(k - spot) / spot < 0.06;
  const cw = [...p.callGex].filter(([k, g]) => k >= spot && near(k) && g > 0).sort((a, b) => b[1] - a[1])[0][0];
  const pw = [...p.putGex].filter(([k, g]) => k <= spot && near(k) && g < 0).sort((a, b) => a[1] - b[1])[0][0];
  ok(lv.wall_source === 'gamma' && lv.call_wall === cw && lv.put_wall === pw, name + ' gamma walls: call ' + lv.call_wall + ', put ' + lv.put_wall + ' (spot ' + spot + ')');
  // zero gamma: near spot, and equal to the hand calculation
  const zg = lv.zero_gamma, hand = handFlip(chain, now);
  ok(zg != null && Math.abs(zg / spot - 1) < 0.005, name + ' zero gamma ' + zg.toFixed(2) + ' within 0.5% of spot (' + ((zg / spot - 1) * 100).toFixed(2) + '%)');
  ok(Math.abs(zg - hand) < spot * 0.0002, name + ' zero gamma = hand calculation ' + hand.toFixed(2));
  // straddle band, by hand from the fixture quotes
  const em = straddleRange(spot, contracts, now);
  const atm = [...new Set(contracts.map((c) => c.strike))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))[0];
  const q = (cp) => contracts.find((c) => c.strike === atm && c.cp === cp);
  const straddle = (q('C').bid + q('C').ask) / 2 + (q('P').bid + q('P').ask) / 2;
  const sigma = straddle * Math.sqrt(Math.PI / 2);
  ok(em.method === 'atm_straddle' && em.atm_strike === atm && Math.abs(em.sigma - sigma) < 1e-9, name + ' straddle: ATM ' + atm + ' mid ' + straddle.toFixed(3) + ' -> sigma ' + sigma.toFixed(3) + ' (' + (sigma / spot * 100).toFixed(3) + '%)');
}

// ---- compact chain (server feeder) -> API: parity with the full chain, CPU budget ----
// The feeder (workers/book-recorder/gex-feeder/gex_feeder.py) compacts the SAME fixture file; the
// API must get the same levels from it as from the full chain, cheaply.
const { compactToContracts, compactFresh, ownGamma } = await import('../../functions/api/gex/_engine.js');
const FEEDER = fileURLToPath(new URL('../../workers/book-recorder/gex-feeder/gex_feeder.py', import.meta.url));
const COMPACT = {};
for (const name of ['QQQ', 'SPX']) {
  const f = fileURLToPath(new URL('./fixtures/gex/cboe-' + name + '-20261013.json', import.meta.url));
  const t0 = etEpoch(FIX[name].data.last_trade_time) + 60;
  COMPACT[name] = JSON.parse(execFileSync('python3', [FEEDER, '--compact', f, String(t0)], { maxBuffer: 64 << 20 }));
  const near = COMPACT[name].near;
  const gz = gzipSync(JSON.stringify(near)).length, gzT = gzipSync(JSON.stringify(COMPACT[name].term)).length;
  ok(gz < 200 * 1024 && gzT < 200 * 1024, name + ' compact chain gzip: near ' + gz + ' B, term ' + gzT + ' B (< 200 KB)');
  for (const dte of [0, 1]) {
    const full = parseOptions(FIX[name].data, dte, t0), cmp = compactToContracts(near, dte, t0);
    const L = (x) => { const c = ownGamma(x.contracts, x.spot, t0), p = profile(x.spot, c); return levels(x.spot, p.gex, c, p, t0); };
    const a = L(full), b = L(cmp);
    ok(a.call_wall === b.call_wall && a.put_wall === b.put_wall && Math.abs(a.zero_gamma - b.zero_gamma) < full.spot * 1e-5,
      name + ' dte=' + dte + ' parity full vs compact: walls ' + b.call_wall + '/' + b.put_wall + ', ZG ' + a.zero_gamma.toFixed(3) + ' vs ' + b.zero_gamma.toFixed(3) + ' (' + full.contracts.length + ' vs ' + cmp.contracts.length + ' contracts)');
  }
  // CPU: decode + select + own gamma + walls + zero-gamma sweep + straddle on the compact chain
  const raw = gzipSync(JSON.stringify(near));
  const run = () => { const d = JSON.parse(gunzipSync(raw).toString()); const x = compactToContracts(d, 0, t0); const c = ownGamma(x.contracts, x.spot, t0); const p = profile(x.spot, c); levels(x.spot, p.gex, c, p, t0); straddleRange(x.spot, c, t0); };
  run(); run();
  const ms = [];
  for (let i = 0; i < 7; i++) { const s0 = performance.now(); run(); ms.push(performance.now() - s0); }
  ms.sort((x, y) => x - y);
  ok(ms[3] < 30, name + ' API compute on the compact chain: median ' + ms[3].toFixed(1) + ' ms (< 30 ms)');
}
ok(compactFresh({ fetched_at: etEpoch('2026-10-13T13:00:00') }, etEpoch('2026-10-13T13:29:00')) && !compactFresh({ fetched_at: etEpoch('2026-10-13T13:00:00') }, etEpoch('2026-10-13T13:31:00')), 'in session: a compact chain older than 30 min is stale');
ok(compactFresh({ fetched_at: etEpoch('2026-10-09T16:31:00') }, etEpoch('2026-10-11T12:00:00')), 'weekend: the post-close chain stays usable');

// ---- buildLevels end to end, offline (compact chain injected), snapshot held for the session ----
let fixSpot = null, fixNow = null;
const compactFor = (name) => {
  const d = structuredClone(COMPACT[name].near);
  if (fixNow) d.fetched_at = fixNow;
  if (fixSpot != null) { d.spot += fixSpot; for (const rows of Object.values(d.expiries)) for (const r of rows) { r[4] *= 1.5; r[5] *= 1.5; } }
  return d;
};
globalThis.fetch = async () => new Response('{}', { status: 404 });
const noIS = async () => { throw new Error('no key'); };
const mem = new Map();
const store = { get: async (k) => mem.get(k), put: async (k, v) => { mem.set(k, structuredClone(v)); } };
const t = etEpoch(FIX.QQQ.data.last_trade_time) + 60;
fixNow = t;
const a = await buildLevels('QQQ', 0, {}, { emStore: store, now: t, compact: compactFor, insightQuotes: noIS });
ok(a.source === 'cboe' && a.wall_source === 'gamma' && a.sources.chain === 'cboe', 'buildLevels: compact Cboe chain, gamma walls');
ok(a.expected_info.method === 'atm_straddle' && a.expected_info.held === true && a.expected_info.phase === 'session' && mem.size === 1, 'in session: snapshot stored (' + [...mem.keys()][0] + ')');
const s1 = a.expected_info.sigma;
ok(Math.abs(a.expected['68%'][1] - a.expected['68%'][0] - 2 * s1) < 1e-3 && Math.abs(a.expected["80%"][1] - a.expected_info.center - 1.2816 * s1) < 1e-2, '68% = ±1 sigma, 80% = ±1.2816 sigma around the snapshot price');
fixSpot = 5; fixNow = t + 3600;   // later the same day: price and option quotes move
const b = await buildLevels('QQQ', 0, {}, { emStore: store, now: t + 3600, compact: compactFor, insightQuotes: noIS });
ok(b.spot === a.spot + 5 && JSON.stringify(b.expected) === JSON.stringify(a.expected) && b.expected_info.held, 'one hour later, new spot ' + b.spot + ': bands held at the snapshot (' + a.expected['68%'].map((x) => x.toFixed(2)).join(' - ') + ')');
mem.clear(); fixSpot = null; fixNow = etEpoch('2026-10-13T09:00:00');
const pre = await buildLevels('QQQ', 0, {}, { emStore: store, now: fixNow, compact: (n) => Object.assign(compactFor(n), { chain_time: '2026-10-12T16:14:00' }), insightQuotes: noIS });
ok(pre.expected_info.phase === 'pre-open' && !pre.expected_info.held && mem.size === 0, 'before 09:30 ET: computed live, marked pre-open, nothing stored');
ok(!snapshotAllowed(etEpoch('2026-10-12T16:14:00'), etEpoch('2026-10-13T09:40:00')), 'just after the open, a prior-session chain may not be snapshotted');
ok(snapshotAllowed(etEpoch('2026-10-13T09:31:00'), etEpoch('2026-10-13T09:46:00')), 'the first chain printed after 09:30 ET may be snapshotted');
// Fallbacks: compact chain stale / missing -> InsightSentry path (no key here, so its error surfaces
// and the API serves its last good copy); with InsightSentry available the source says so.
fixNow = t - 45 * 60;
await assert.rejects(() => buildLevels('QQQ', 0, {}, { now: t, compact: compactFor }), /InsightSentry options not configured/);
ok(true, 'compact chain 45 min old in session: falls back to the InsightSentry path');
await assert.rejects(() => buildLevels('QQQ', 0, {}, { now: t, compact: async () => null }), /InsightSentry options not configured/);
ok(true, 'compact chain missing: falls back to the InsightSentry path');
fixNow = t;
console.log(n + ' checks, ALL PASS');

// ---- HYBRID (Cboe chain + OI, InsightSentry live spot + sane IV, our own Black-Scholes gamma) ----
{
  const { mergeHybrid, insightQuoteMap, saneIv } = await import('../../functions/api/gex/_engine.js');
  fixNow = etEpoch(FIX.QQQ.data.last_trade_time) + 900;
  const OCC = /^([A-Z^]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
  // An InsightSentry-shaped quotes payload built from the fixture: live spot +3, IVs from the
  // fixture, plus three bad rows that must be rejected (iv 0, iv 2.4, one-sided quote).
  const isPayload = (name, move) => {
    const c = FIX[name].data, rows = [];
    for (const o of c.options) {
      const m = OCC.exec(o.option); if (!m || m[2] + m[3] + m[4] !== '261013') continue;
      rows.push({ code: 'OPRA:' + o.option, type: m[5] === 'C' ? 'CALL' : 'PUT', strike_price: +m[6] / 1000, expiration: 20261013, implied_volatility: o.iv, bid_price: o.bid, ask_price: o.ask, gamma: 999 });
    }
    return { last_price: c.current_price + move, last_update: (etEpoch(c.last_trade_time) + 840) * 1000, data: rows };
  };
  const tq = etEpoch(FIX.QQQ.data.last_trade_time) + 900;
  ok(!saneIv({ iv: 0, bid: 1, ask: 1.1 }) && !saneIv({ iv: 2.4, bid: 1, ask: 1.1 }) && !saneIv({ iv: 0.2, bid: 0, ask: 1 }) && saneIv({ iv: 0.2, bid: 1, ask: 1.1 }), 'sane-IV rule: 0 < iv < 1.5 and a two-sided quote');
  const live = insightQuoteMap(isPayload('QQQ', 0), '2026-10-13');
  const base = compactToContracts(compactFor('QQQ'), 0, tq).contracts;
  const first = base[Math.floor(base.length / 2)].cp + '|' + base[Math.floor(base.length / 2)].strike;
  live.byKey.set(first, { iv: 2.4, bid: 1, ask: 1.1 });
  const mg = mergeHybrid(base, live);
  const expUsed = base.filter((c) => saneIv(live.byKey.get(c.cp + '|' + c.strike))).length;
  ok(expUsed > 50 && mg.used === expUsed && mg.contracts.filter((c) => c.ivSrc === 'cboe').length === base.length - expUsed && mg.contracts.find((c) => c.cp + '|' + c.strike === first).ivSrc === 'cboe', 'merge: an insane InsightSentry IV keeps Cboe IV for that contract (' + mg.used + '/' + base.length + ' live)');
  for (const name of ['QQQ', 'SPX']) {
    const move = name === 'QQQ' ? 3 : 20;
    const h = await buildLevels(name, 0, {}, { now: tq, compact: compactFor, insightQuotes: async (n, e) => insightQuoteMap(isPayload(name, move), e) });
    const spot0 = FIX[name].data.current_price;
    ok(h.source === 'cboe' && h.sources.chain === 'cboe' && h.sources.iv === 'insightsentry' && h.sources.spot === 'insightsentry' && h.sources.gamma === 'black_scholes', name + ' hybrid sources ' + JSON.stringify(h.sources));
    ok(h.spot === spot0 + move && h.compare.cboe_only.spot === spot0, name + ' hybrid uses the live spot ' + h.spot + ' (Cboe ' + spot0 + ')');
    ok(h.wall_source === 'gamma' && Math.abs(h.zero_gamma / h.spot - 1) < 0.005, name + ' hybrid: gamma walls ' + h.call_wall + '/' + h.put_wall + ', ZG ' + h.zero_gamma.toFixed(2) + ' within 0.5% of live spot; Cboe-only ' + JSON.stringify(h.compare.cboe_only));
  }
  // vendor gamma is ignored: same levels when the InsightSentry gamma field is garbage (999 above)
  const h2 = await buildLevels('QQQ', 0, {}, { now: tq, compact: compactFor, insightQuotes: async (n, e) => insightQuoteMap(isPayload('QQQ', 0), e) });
  const c2 = await buildLevels('QQQ', 0, {}, { now: tq, compact: compactFor, hybrid: false });
  ok(h2.zero_gamma.toFixed(6) === c2.zero_gamma.toFixed(6) && h2.call_wall === c2.call_wall, 'same spot + same IV: hybrid = Cboe-only exactly (vendor gamma 999 ignored)');
  // InsightSentry down -> pure Cboe
  const d = await buildLevels('QQQ', 0, {}, { now: tq, compact: compactFor, insightQuotes: async () => { throw new Error('down'); } });
  ok(d.sources.iv === 'cboe' && d.sources.spot === 'cboe' && d.compare === null && d.spot === FIX.QQQ.data.current_price, 'InsightSentry down: pure Cboe');
  console.log(n + ' checks incl. hybrid, ALL PASS');
}
