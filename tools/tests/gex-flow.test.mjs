// Options volume by strike (functions/api/gex/_flow.js) on REAL compact Cboe chains we stored
// (book-recorder /gex-chain part=near, SPX + QQQ + SPY, session 2026-10-23, fixtures/gex/flow-*.json.gz).
//   node tools/tests/gex-flow.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
const F = await import('../../functions/api/gex/_flow.js');
let n = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); n++; console.log('PASS ' + m); };
const load = (u) => JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/gex/flow-' + u + '-near.json.gz', import.meta.url))).toString());

for (const u of ['SPX', 'QQQ', 'SPY']) {
  const d = load(u), out = F.flowFromChain(d);
  ok(out && out.spot === d.spot && out.chain_day === d.chain_time.slice(0, 10) && out.expiries.length === Object.keys(d.expiries).length, u + ': ' + out.expiries.length + ' expiries, spot ' + out.spot + ', session ' + out.chain_day);
  // totals per expiry = the raw rows summed (every strike, not just the band)
  for (const e of out.expiries) {
    const rows = d.expiries[e.x];
    const c = rows.filter((r) => r[1] === 'C').reduce((s, r) => s + r[6], 0), p = rows.filter((r) => r[1] === 'P').reduce((s, r) => s + r[6], 0);
    assert.equal(e.calls, c); assert.equal(e.puts, p);
    assert.equal(e.pc, c > 0 ? Math.round(p / c * 100) / 100 : null);
    // banded rows: each strike's volume equals the raw row, and only strikes within +-5%
    for (const [k, cv, pv, coi, poi] of e.rows) {
      assert.ok(Math.abs(k - d.spot) / d.spot <= 0.05);
      const rc = rows.find((r) => r[0] === k && r[1] === 'C'), rp = rows.find((r) => r[0] === k && r[1] === 'P');
      assert.equal(cv, rc ? rc[6] : 0); assert.equal(pv, rp ? rp[6] : 0);
      assert.equal(coi, rc ? rc[2] : 0); assert.equal(poi, rp ? rp[2] : 0);
    }
    assert.ok(e.rows.every((r, i) => i === 0 || r[0] > e.rows[i - 1][0]), 'strikes ascending');
  }
  ok(true, u + ': per-expiry call / put totals and every strike row re-summed from the raw chain');
  const allC = out.expiries.reduce((s, e) => s + e.calls, 0);
  ok(out.all.calls === allC && out.all.rows.length >= out.expiries[0].rows.length, u + ': all expiries = the sum (' + allC + ' calls, P/C ' + out.all.pc + ')');
  const t = F.topStrikes(out.expiries[0].rows, 3);
  const maxC = Math.max(...out.expiries[0].rows.map((r) => r[1]));
  ok(t.calls.length === 3 && t.calls[0][1] === maxC && t.calls[0][1] >= t.calls[1][1], u + ': top call strike ' + t.calls[0][0] + ' (' + t.calls[0][1] + ')');
  const ns = F.nearSpot(out.all.rows, out.spot, 10);
  ok(ns.length <= 20 && ns.some((r) => r[0] >= out.spot) && ns.some((r) => r[0] < out.spot), u + ': ' + ns.length + ' strikes around spot');
}
ok(F.flowFromChain(null) === null && F.flowFromChain({ spot: 0, expiries: {} }) === null, 'bad input -> null');
// an expiry before the chain's own session is dropped; dte counts from the session
const syn = F.flowFromChain({ spot: 100, chain_time: '2026-10-23T16:00:00', expiries: { '2026-10-22': [[100, 'C', 1, 0, 0, 0, 9, 0]], '2026-10-26': [[100, 'C', 5, 0, 0, 0, 7, 0], [100, 'P', 6, 0, 0, 0, 14, 0], [200, 'P', 1, 0, 0, 0, 3, 0]] } });
ok(syn.expiries.length === 1 && syn.expiries[0].dte === 3 && syn.expiries[0].puts === 17 && syn.expiries[0].rows.length === 1 && syn.expiries[0].pc === 2.43, 'synthetic: stale expiry dropped, dte 3, far strike counted in the total but not the rows', syn.expiries);
console.log('\n' + n + ' checks passed');
