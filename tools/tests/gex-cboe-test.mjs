// GEX audit round 3 (2026-10-13): Cboe primary chain, gamma walls, zero gamma, session straddle band.
// Pure node, no network (fetch is stubbed):  node tools/tests/gex-cboe-test.mjs
// Fixtures: tools/tests/fixtures/gex/cboe-{QQQ,SPX}-20261013.json, real Cboe chains saved 13 Oct
// 2026 ~17:49 UTC (chain time 13:34 ET), 2026-10-13 and 2026-10-14 expiries only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

// ---- buildLevels end to end, offline: Cboe primary, snapshot held for the session ----
let fixSpot = null;
globalThis.fetch = async (url) => {
  const u = String(url);
  const m = /delayed_quotes\/options\/(_SPX|QQQ)\.json/.exec(u);
  if (m) {
    const d = structuredClone(FIX[m[1] === '_SPX' ? 'SPX' : 'QQQ']);
    if (fixSpot != null) { d.data.current_price += fixSpot; d.data.options.forEach((o) => { o.bid *= 1.5; o.ask *= 1.5; }); }
    return new Response(JSON.stringify(d), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};
const mem = new Map();
const store = { get: async (k) => mem.get(k), put: async (k, v) => { mem.set(k, structuredClone(v)); } };
const t = etEpoch(FIX.QQQ.data.last_trade_time) + 60;
const a = await buildLevels('QQQ', 0, {}, { emStore: store, now: t });
ok(a.source === 'cboe' && a.wall_source === 'gamma', 'buildLevels: source cboe, gamma walls');
ok(a.expected_info.method === 'atm_straddle' && a.expected_info.held === true && a.expected_info.phase === 'session' && mem.size === 1, 'in session: snapshot stored (' + [...mem.keys()][0] + ')');
const s1 = a.expected_info.sigma;
ok(Math.abs(a.expected['68%'][1] - a.expected['68%'][0] - 2 * s1) < 1e-3 && Math.abs(a.expected["80%"][1] - a.expected_info.center - 1.2816 * s1) < 1e-2, '68% = ±1 sigma, 80% = ±1.2816 sigma around the snapshot price');
fixSpot = 5;   // later the same day: price and option quotes move
const b = await buildLevels('QQQ', 0, {}, { emStore: store, now: t + 3600 });
ok(b.spot === a.spot + 5 && JSON.stringify(b.expected) === JSON.stringify(a.expected) && b.expected_info.held, 'one hour later, new spot ' + b.spot + ': bands held at the snapshot (' + a.expected['68%'].map((x) => x.toFixed(2)).join(' - ') + ')');
// pre-open: the prior session's chain at 09:00 ET -> live, not stored, marked pre-open
mem.clear(); fixSpot = null;
const pre = await buildLevels('QQQ', 0, {}, { emStore: store, now: etEpoch('2026-10-13T09:00:00') });
ok(pre.expected_info.phase === 'pre-open' && !pre.expected_info.held && mem.size === 0, 'before 09:30 ET: computed live, marked pre-open, nothing stored');
ok(!snapshotAllowed(etEpoch('2026-10-12T16:14:00'), etEpoch('2026-10-13T09:40:00')), 'just after the open, a prior-session chain may not be snapshotted');
ok(snapshotAllowed(etEpoch('2026-10-13T09:31:00'), etEpoch('2026-10-13T09:46:00')), 'the first chain printed after 09:30 ET may be snapshotted');
// Cboe down -> InsightSentry fallback attempted; with no key configured the Cboe error surfaces
globalThis.fetch = async () => new Response('x', { status: 503 });
await assert.rejects(() => buildLevels('QQQ', 0, {}, { now: t }), /fetch 503/);
ok(true, 'Cboe down and no fallback key: the Cboe error is raised (the API then serves its last good copy)');
console.log(n + ' checks, ALL PASS');
