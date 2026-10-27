// Structure walls (2026-10-27 walls redo). Pure node:  node tools/tests/gex-walls.test.mjs
// Fixture: the real compact Cboe QQQ chain (term + near) of 2026-10-27 13:19 ET.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { buildLevels, compactToContracts, ownGamma, profile, gammaWalls, structureLevels, zeroDteWalls } from '../../functions/api/gex/_engine.js';
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const rd = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/gex/' + f, import.meta.url))));
const term = rd('walls-QQQ-term-20261027.json.gz'), near = rd('walls-QQQ-near-20261027.json.gz');
const now = term.fetched_at;
const opts = (extra) => Object.assign({ now, compact: (nm, d) => (d <= 1 ? near : term), compactTerm: term, hybrid: false }, extra || {});

const d0 = await buildLevels('QQQ', 0, {}, opts());
const d30 = await buildLevels('QQQ', 30, {}, opts());
const d1 = await buildLevels('QQQ', 1, {}, opts());
ok(d0.wall_method === 'structure_1_30d' && d0.wall_source === 'gamma', 'structure method used, wall_source stays gamma');
ok(d0.call_wall === d30.call_wall && d0.put_wall === d30.put_wall && d0.zero_gamma === d30.zero_gamma && d0.call_wall === d1.call_wall, 'walls + zero gamma are the same for dte 0, 1 and 30 (the chart and the page agree)');
ok(d0.call_wall >= d0.spot && d0.put_wall <= d0.spot, 'call wall at/above spot, put wall at/below spot (' + d0.put_wall + ' / ' + d0.call_wall + ', spot ' + d0.spot + ')');
ok(d0.call_wall - d0.spot > 3, 'main call wall is not hugging spot (' + (d0.call_wall - d0.spot).toFixed(2) + ' away)');
ok(d0.walls_0dte && d0.walls_0dte.dte === 0 && d0.walls_0dte.call != null && d0.walls_0dte.put != null, 'separate 0DTE pair present: ' + JSON.stringify(d0.walls_0dte));
ok(d0.walls_0dte.call - d0.spot <= 1.5, '0DTE call wall sits at price (' + d0.walls_0dte.call + ')');
ok(d30.walls_0dte && d30.walls_0dte.expiry === d0.walls_0dte.expiry, '0DTE pair also exists on a 30-day request');
ok(d0.wall_basis.days[0] === 1 && d0.wall_basis.days[1] === 30 && d0.wall_basis.expiries[0] > d0.walls_0dte.expiry, 'wall_basis: expiries start after today');
const pr = d0.profile;
ok(pr && pr.k.length === pr.g.length && pr.k.length > 20 && pr.k.every((k) => Math.abs(k - d0.spot) / d0.spot <= 0.0501), 'profile: strikes within 5% of spot (' + pr.k.length + ' strikes)');
ok(pr.g.some((g) => g > 0) && pr.g.some((g) => g < 0), 'profile has positive and negative bars');
ok(JSON.stringify(d0).length < 30000, 'response size ' + JSON.stringify(d0).length + ' bytes');
ok(['call_wall', 'put_wall', 'zero_gamma', 'wall_source', 'net_gex', 'regime', 'ladder'].every((k) => k in d0), 'existing fields kept');

// walls do not move with time of day on the same open interest (spot unchanged)
const late = await buildLevels('QQQ', 0, {}, opts({ now: now + 3 * 3600, compactTerm: Object.assign({}, term, { fetched_at: now + 3 * 3600 }), compact: (nm, d) => Object.assign({}, d <= 1 ? near : term, { fetched_at: now + 3 * 3600 }) }));
ok(late.call_wall === d0.call_wall && late.put_wall === d0.put_wall, 'same chain 3 h later: walls unchanged (' + late.put_wall + ' / ' + late.call_wall + ')');
ok(late.walls_0dte.call != null, 'late: 0DTE pair still computed');

// fallback: no term chain -> old selected-expiry walls, labelled
const fb = await buildLevels('QQQ', 0, {}, opts({ compactTerm: null }));
ok(fb.wall_method === 'selected_expiry' && fb.wall_note && fb.profile === null, 'term chain missing -> selected_expiry fallback with a note');
ok(fb.call_wall != null && fb.put_wall != null, 'fallback still has walls');

// pure helpers
const { spot, contracts } = compactToContracts(term, 30, now);
const cs = ownGamma(contracts, spot, now);
const st = structureLevels(spot, cs, now, null);
const p1 = profile(spot, cs.filter((c) => c.dte >= 1));
const [c1, w1] = gammaWalls(spot, p1.callGex, p1.putGex);
ok(st.callWall === c1 && st.putWall === w1, 'structureLevels = gammaWalls over expiries 1-30 days');
ok(structureLevels(spot, cs.filter((c) => c.dte === 0), now, null) === null, 'only 0DTE rows -> null (falls back)');
ok(zeroDteWalls(spot, []) === null, 'zeroDteWalls on nothing -> null');
console.log(n + ' checks, ALL PASS');
