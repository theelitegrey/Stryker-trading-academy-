// Pure parts of assets/chart-symbol-info.js.  node tools/tests/chart-symbol-info.test.mjs
import assert from 'node:assert/strict';
import { rootOf, daysUntil, inDays, fmtHours, fmtYmd, factsOf, agoText } from '../../assets/chart-symbol-info.js';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };
ok(rootOf('futures:NQ1!').key === 'NQ' && !rootOf('futures:NQ1!').micro, 'NQ1! -> NQ');
ok(rootOf('futures:MNQ1!').key === 'NQ' && rootOf('futures:MNQ1!').micro === 'Micro of NQ', 'MNQ1! -> NQ micro');
ok(rootOf('CME_MINI:ESZ2026').key === 'ES', 'ESZ2026 -> ES');
ok(rootOf('binance:BTCUSDT').key === '', 'crypto -> no info');
ok(rootOf('futures:MCL1!').key === 'CL', 'MCL -> CL');
const now = Date.UTC(2026, 9, 14, 15, 0);
ok(daysUntil('20261218', now) === 65, 'days until 18 Dec = 65 (' + daysUntil('20261218', now) + ')');
ok(daysUntil('20261014', now) === 0 && inDays(0) === 'today' && inDays(1) === 'in 1 day' && inDays(5) === 'in 5 days', 'inDays wording');
ok(fmtHours('1700-1600') === '17:00 - 16:00' && fmtYmd('20261218') === '18 Dec 2026', 'hour and date formats');
const e = { name: 'E-mini Nasdaq-100 Futures', ex: 'CME', cur: 'USD', tick: 0.25, pv: 20, contract: 'NQZ2026', under: 'NASDAQ:NDX', ath: 30975.5,
  roll: [{ c: 'NQZ2026', d: '20261218' }, { c: 'NQH2027', d: '20270319' }], session: { hours: '1700-1600', desc: 'Electronic Trading Hours', tz: 'America/Chicago', early: [{ d: '20261224', end: '1215' }], hol: ['20261225'] } };
const f = factsOf(e, 'NQ', '', now);
ok(f.specs.some((r) => r[0] === 'Tick value' && r[1] === '$5'), 'tick value 0.25 x 20 = $5');
ok(f.roll[0][1] === '18 Dec 2026 (in 65 days)', 'expiry line: ' + f.roll[0][1]);
ok(/in 57 days/.test(f.roll[1][1]), 'typical roll 8 days earlier: ' + f.roll[1][1]);
ok(f.roll[2][1] === 'NQH2027, 19 Mar 2027', 'next contract');
ok(f.session[0][1] === '17:00 - 16:00 America/Chicago'.replace('America/', '').replace(' ', ' ') + '' || /17:00 - 16:00 Chicago time/.test(f.session[0][1]), 'session hours: ' + f.session[0][1]);
ok(f.session.some((r) => r[0] === 'Early close' && /24 Dec 2026, 12:15/.test(r[1])), 'early close');
const g = factsOf({ name: 'Gold', roll: [{ c: 'GCZ2026', d: '20261229' }] }, 'GC', 'Micro of GC', now);
ok(g.roll.length === 2 && g.specs.some((r) => r[1] === 'Micro of GC'), 'non-index: no typical-roll line, micro note');
ok(!/live|real-time|delayed/i.test(JSON.stringify(f)) && agoText(Date.now() / 1000 - 7200, Date.now()) === 'Updated 2 h ago', 'wording');
console.log(n + ' passed');
