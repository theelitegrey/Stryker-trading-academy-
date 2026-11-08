// GEX-FAST2 (2026-11-08): the "GEX updated X min ago" label ages the OPTIONS inputs, not the futures quote.
//   node tools/tests/gex-age.test.mjs
// Real fixtures: tools/tests/fixtures/gex/{SPX,QQQ}-0.json (saved API replies; futures 5-min bar ~10 min old, options ~1-15 min).
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.window = globalThis.window || {};
const { dataTime, agoText } = await import('../../assets/chart-gex-levels.js');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
for (const f of ['SPX-0', 'QQQ-0']) {
  const d = JSON.parse(fs.readFileSync(new URL('./fixtures/gex/' + f + '.json', import.meta.url)));
  const m = d.market;
  ok(m.data_ts === Object.values(d.futures).map((x) => x.futures_ts).sort((a, b) => b - a)[0], f + ': data_ts is the futures quote time (' + Math.round((d.fetched_at - m.data_ts) / 60) + ' min before the build)');
  ok(dataTime(d) === m.options_ts, f + ': the GEX label uses options_ts');
}
const now = 1794000000;
const d = { fetched_at: now, market: { state: 'open', data_ts: now - 600, options_ts: now - 30 } };
ok(agoText(dataTime(d), now * 1000) === 'GEX live', 'options 30 s old + futures 10 min old -> "GEX updated just now" (was "10 min ago")');
ok(dataTime({ fetched_at: now, market: { data_ts: now - 60 } }) === now - 60, 'no options_ts -> data_ts');
ok(dataTime({ fetched_at: now }) === now, 'no market block -> fetched_at');
ok(!/live|real-time|delayed|behind/i.test(agoText(now - 300, now * 1000)), 'wording: ' + agoText(now - 300, now * 1000));
console.log('gex-age.test: ' + n + ' checks passed');
