// Delta / Vanna / Charm Exposure (assets/chart-greek-exposure.js) and the GEX+ panel (assets/gex-greeks.js): pure helpers,
// on the real feeder profiles in tools/tests/fixtures/greeks (Cboe QQQ / SPX chains of 2026-11-06, built by zoro_feeder.analyse).
//   node tools/tests/greek-exposure.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

globalThis.window = globalThis.window || {};
globalThis.localStorage = { getItem: () => null };
const G = await import('../../assets/chart-greek-exposure.js');
const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = (n) => JSON.parse(readFileSync(join(HERE, 'fixtures', 'greeks', n), 'utf8'));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };

const q0 = FIX('profile-QQQ-0.json'), q1 = FIX('profile-QQQ-1.json'), qa = FIX('profile-QQQ-all.json'), s0 = FIX('profile-SPX-0.json');
ok(q0.cols.join() === 'k,gex,dex,vanna,charm,cvol,pvol,coi,poi,gexv', 'fixture: feeder columns incl. gexv');
ok(G.etDay(q0.t) === '2026-11-06' && q0.expiry[0] === '2026-11-06', 'etDay: chain time in New York');
// QQQ had a same-day expiry on Friday 2026-11-06; the SPX file is built after the SPX 0DTE close, so its first expiry is Monday's
ok(G.modeFor(G.EXP_0, q0).x === '0' && G.modeFor(G.EXP_NEXT, q0).x === '1', 'modeFor: QQQ 0DTE day -> 0DTE = mode 0, next = mode 1');
ok(G.modeFor(G.EXP_0, s0).none && G.modeFor(G.EXP_NEXT, s0).x === '0', 'modeFor: no same-day expiry -> 0DTE says so, next = mode 0');
ok(G.modeFor(G.EXP_ALL, null).x === 'all' && G.modeFor(G.EXP_0, null).wait, 'modeFor: all needs nothing; 0DTE waits for the 0 profile');
for (const [t, col] of [[G.DEX_TYPE, 'dex'], [G.VEX_TYPE, 'vanna'], [G.CEX_TYPE, 'charm']]) {
  const rows = G.columnOf(qa, G.KINDS[t].col);
  ok(G.KINDS[t].col === col && rows.length === qa.rows.length && rows.every((r) => typeof r.v === 'number'), G.KINDS[t].name + ': one value per strike');
  const top = G.topLevels(rows, 3, qa.spot);
  const mx = Math.max(...rows.map((r) => Math.abs(r.v)));
  ok(top.length === 3 && Math.abs(top[0].v) === mx && Math.abs(top[0].v) >= Math.abs(top[1].v) && Math.abs(top[1].v) >= Math.abs(top[2].v), G.KINDS[t].name + ': top 3 by size, largest first (' + top.map((r) => r.k).join(', ') + ')');
}
ok(G.columnOf({ cols: ['k', 'gex'], rows: [[1, 2]] }, 'dex').length === 0 && G.columnOf(null, 'dex').length === 0, 'columnOf: missing column -> nothing (teaser rows)');
ok(G.topLevels([{ k: 99, v: 5 }, { k: 101, v: -5 }, { k: 120, v: 0 }], 3, 100.5).map((r) => r.k).join() === '101,99', 'topLevels: ties nearest spot first, zeros dropped');
ok(G.money(-1234) === '-$1.2B' && G.money(56.4) === '+$56.4M' && G.money(0.04) === '+$40K' && G.money(250) === '+$250M', 'money: B / M / K');
// the 0DTE totals are a part of all expiries (QQQ: today's expiry is in the all set)
ok(qa.expiry.includes(q0.expiry[0]) && Math.abs(qa.tot.gex) > 0 && Math.abs(q0.tot.charm) > 0 && q1.expiry[0] === '2026-11-09', 'fixture: 0DTE in all; next expiry = Monday');
// feeder totals over all strikes vs the +-6 % band rows: same sign for the big DEX number
ok(Math.sign(qa.tot.dex) === Math.sign(G.columnOf(qa, 'dex').reduce((a, r) => a + r.v, 0)), 'totals: feeder total and band sum agree in sign');

// GEX+ panel (classic script): run it with a stub document, read window.__gexGreeks
const ctx = { window: {}, document: { readyState: 'loading', addEventListener() {} }, Intl, Date, Math, Promise, setInterval() {}, String, Number, Object, isFinite };
vm.runInNewContext(readFileSync(join(HERE, '..', '..', 'assets', 'gex-greeks.js'), 'utf8'), ctx);
const P = ctx.window.__gexGreeks;
ok(P.money(-1234) === G.money(-1234) && P.money(0.04) === G.money(0.04), 'page money() = chart money()');
ok(P.modeFor('0dte', q0) === '0' && P.modeFor('next', q0) === '1' && P.modeFor('0dte', s0).none && P.modeFor('next', s0) === '0' && P.modeFor('all', null) === 'all', 'page modeFor() = chart modeFor()');

// wording rules: no "live" / "real-time" / "delayed" in either file
for (const f of ['chart-greek-exposure.js', 'gex-greeks.js']) {
  const src = readFileSync(join(HERE, '..', '..', 'assets', f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  ok(!/\b(live|real-time|realtime|delayed)\b/i.test(src.replace(/Not financial advice|aria-live/g, '')), f + ': no live / real-time / delayed wording');
}
console.log(n + ' passed');
