// GEX walls over time (assets/chart-gex-walls-core.js + applySteps / anchorShift in assets/chart-gex-levels.js).
// Pure node, no browser, no network:  node tools/tests/chart-gex-walls.test.mjs
// Fixtures: tools/tests/fixtures/gex/hist-QQQ-2026-10-2{1,2,3}.json are REAL /gex-history replies
// (QQQ 0DTE, book-recorder, saved 2026-10-26), so the expected numbers come from recorded sessions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { holdWalls, basisSeries, stepSegments, stepsFor, previousWall, changes, lastSessionBasis, HOLD_BAND } from '../../assets/chart-gex-walls-core.js';
import { applySteps, wallModel, livePoint, anchorShift, anchorTime, buildLevels } from '../../assets/chart-gex-levels.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const unpack = (p) => p.t.map((t, i) => {
  const row = p.g[i], i0 = row[0], k = [], g = [];
  for (let j = 1; j < row.length; j++) if (row[j] !== null) { k.push(p.k[i0 + j - 1]); g.push(row[j]); }
  return { t, day: p.day[i], x: p.x[i], s: p.s[i], cw: p.cw[i], pw: p.pw[i], zg: p.zg[i], k, g };
});
const load = (d) => unpack(JSON.parse(fs.readFileSync(new URL('./fixtures/gex/hist-QQQ-2026-10-' + d + '.json', import.meta.url))));
const et = (t) => new Date(t * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' });
const D21 = load('21'), D22 = load('22'), D23 = load('23');

// 1. the raw engine walls flicker; the held walls do not
for (const [name, rows] of [['10-21', D21], ['10-22', D22], ['10-23', D23]]) {
  const h = holdWalls(rows);
  const rc = changes(rows.map((r) => r.cw)) + changes(rows.map((r) => r.pw)), hc = changes(h.map((r) => r.cw)) + changes(h.map((r) => r.pw));
  ok(hc * 3 <= rc, name + ': wall changes ' + rc + ' raw -> ' + hc + ' held');
}
// 2. 2026-10-23: the call wall held at 710 all morning (raw flicker 710/706 14:08-14:14 does not move it)
{
  const h = holdWalls(D23);
  const at = (hhmm) => h.find((p) => et(p.t) >= hhmm);
  ok(at('10:53').cw === 710, '10-23 10:53 (RTH high, MNQ 29,325.75): held call wall = 710');
  ok(['13:44', '13:56', '14:04', '14:08', '14:14'].every((x) => at(x).cw === 710), '10-23 13:44-14:14: raw call wall flickers 710/706, held stays 710');
  ok(at('15:00').pw === 705 && at('15:14').pw === 705, '10-23 15:00-15:14: raw put wall flickers 705/704, held stays 705');
}
// 3. 2026-10-21: price trades UP INTO the 725 call wall (11:32-12:54); the raw wall jumps to 730/726
//    whenever spot ticks above 725, the held wall stays 725 while price is within the band
{
  const h = holdWalls(D21);
  const testing = h.filter((p) => et(p.t) >= '11:30' && et(p.t) <= '12:40');
  ok(testing.some((p) => p.rawCw !== 725), '10-21 11:30-12:40: the raw call wall leaves 725 (' + [...new Set(testing.map((p) => p.rawCw))].join('/') + ')');
  ok(testing.every((p) => p.cw === 725), '10-21 11:30-12:40: price testing 725 (spot 724.9-726.0): held call wall stays 725');
  const after = h.find((p) => et(p.t) >= '12:56');
  ok(after.cw === 730 && after.s > 725 * (1 + HOLD_BAND), '10-21 12:56: spot ' + after.s + ' clearly above 725 + band, wall moves to 730');
}
// 4. a new session starts from its own raw wall
{
  const h = holdWalls(D22.concat(D23));
  const first23 = h.find((p) => p.day === '2026-10-23');
  ok(first23.cw === D23[0].cw && first23.pw === D23[0].pw, 'new session starts from its own raw walls');
}
// 5. step segments: merge equal values, break at a session change, last one runs to the edge
{
  const segs = stepSegments([{ t: 0, v: 1, key: 'a' }, { t: 120, v: 1, key: 'a' }, { t: 240, v: 2, key: 'a' }, { t: 9000, v: 2, key: 'b' }]);
  ok(segs.length === 3 && segs[0].t1 === 240 && segs[1].t1 === 360 && segs[2].t1 == null, 'stepSegments: merge, session break (tail 120 s), open last segment');
}
// 6. futures steps: per-snapshot basis from the chart's bars; no bars -> the segment is left out
{
  const pts = holdWalls(D23);
  const k = 41.35;
  const closeAt = (t) => { const r = D23.find((x) => x.t === t); return r ? r.s * k + 190 : null; };   // synthetic MNQ = k x QQQ + 190
  const basis = basisSeries(D23, closeAt, k);
  const st = stepsFor(pts, 'cw', basis, k, null);
  ok(Math.abs(st[0].p - (710 * k + 190)) < 0.02, 'futures step at 710 x k + basis (' + st[0].p + ')');
  ok(stepsFor(pts, 'cw', basisSeries(D23, () => null, k), k, null).length === 0, 'no chart bars -> no futures step drawn (never a guessed basis)');
  ok(Math.abs(lastSessionBasis(pts, basis) - 190) < 0.01, 'last-session basis = 190');
}
// 7. the faded previous wall
{
  const h = holdWalls(D23);
  const pw = previousWall(h, 'cw');
  ok(pw && pw.strike === 710 && et(pw.until) === '14:24', '10-23: prev CW = 710 until 14:24 (' + (pw && et(pw.until)) + ')');
}
// 8. applySteps on an index chart (QQQ): last segment = API level, older ones = history; no lookahead in replay
{
  const live = { t: D23[D23.length - 1].t + 1, day: '2026-10-23', x: '2026-10-26', s: 704.88, cw: 710, pw: 695, zg: 725.9 };
  const M = wallModel(D23, live, null, null);
  const data = { call_wall: 710, put_wall: 695, zero_gamma: 725.9, expected: {}, spot: 704.88, market: { state: 'cash_closed' } };
  const src = { api: 'QQQ', fut: null, label: 'QQQ', pro: true };
  const lv = applySteps(buildLevels(data, src, {}), M, src, (v) => v, {});
  const cw = lv.lines.find((l) => l.id === 'call');
  ok(cw.steps.length >= 3 && cw.steps[cw.steps.length - 1].b == null && cw.price === 710, 'QQQ call wall: ' + cw.steps.length + ' steps, last runs to the edge at 710');
  ok(!lv.lines.some((l) => l.id === 'prev_cw'), 'after the close the live chain is the next expiry: a new session, no prev CW yet');
  const lvIn = applySteps(buildLevels(data, src, {}), wallModel(D23, null, null, null), src, (v) => v, {});
  const pv = lvIn.lines.find((l) => l.id === 'prev_cw');
  ok(pv && pv.price === 710 && pv.faint && pv.label === 'prev CW', 'in session: faded prev CW line at 710');
  const cut = D23.filter((r) => et(r.t) <= '12:00');
  const R = applySteps(buildLevels(data, src, {}), wallModel(cut, null, null, null), src, (v) => v, {});
  ok(R.lines.find((l) => l.id === 'call').steps.every((s) => s.a <= cut[cut.length - 1].t), 'replay at 12:00: no step starts after the replay clock');
  ok(!applySteps(buildLevels(data, src, { prevWall: false }), wallModel(D23, null, null, null), src, (v) => v, { prevWall: false }).lines.some((l) => l.id === 'prev_cw'), 'prev wall off -> no prev line');
}
// 9. livePoint: open = options time; shut = just after the chain time
{
  const lp = livePoint({ spot: 1, call_wall: 2, put_wall: 0.5, zero_gamma: 1, expiry: 'x', market: { state: 'cash_closed', chain_ts: 1000 } }, () => 'd');
  ok(lp.t === 1001, 'livePoint off-hours = chain time + 1');
  ok(livePoint({ spot: 1, market: { state: 'open', options_ts: 5000 } }, () => 'd').t === 5000, 'livePoint open = options time');
}
// 10. off-hours anchor: chain time, not the current futures quote
{
  const QQQ = JSON.parse(fs.readFileSync(new URL('./fixtures/gex/QQQ-0.json', import.meta.url)));
  const F = QQQ.futures.NQ, T = 1792785599;
  const d = Object.assign({}, QQQ, { market: Object.assign({}, QQQ.market, { state: 'cash_closed', chain_ts: T }) });
  ok(anchorTime(d) === T, 'cash_closed: anchor time = chain time');
  const bars = [[T - 179, 1, 1, 1, F.futures_price - 210, 1], [T - 119, 1, 1, 1, F.futures_price - 200, 1], [T + 600, 1, 1, 1, F.futures_price, 1]];
  ok(anchorShift(d, 'NQ', bars) === -200, 'cash_closed: shift = futures at the chain time - API futures (-200)');
  ok(anchorShift(Object.assign({}, d, { market: { state: 'cash_closed' } }), 'NQ', bars) === null, 'cash_closed without chain_ts -> null (API conversion kept)');
}
console.log(n + ' checks, ALL PASS');
