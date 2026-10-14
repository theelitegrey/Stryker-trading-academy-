// Pure helpers of the Charts news + calendar job: symbol mapping (chart-news.js), news bucketing
// with the replay cut-off, event picking (no actual after the cut), the warning chip
// (chart-news-markers.js) and the calendar page time-zone formatting (econ-calendar-is.js).
//   node tools/tests/chart-news-unit.mjs
globalThis.window = globalThis.window || {};
const { newsSymOf, agoLabel } = await import('../../assets/chart-news.js');
const M = await import('../../assets/chart-news-markers.js');
let fail = 0, n = 0;
const eq = (a, b, msg) => { n++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fail++; console.log('FAIL ' + msg + ' got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); } };

// symbol -> feed
const cases = { 'futures:NQ1!': 'NQ', 'MNQ1!': 'NQ', 'futures:MES1!': 'ES', 'ES1!': 'ES', 'MYM1!': 'YM', 'GC1!': 'GC', 'MGC1!': 'GC', 'SIL1!': 'SI', 'SI1!': 'SI', 'MCL1!': 'CL', 'CL1!': 'CL',
  'binance:BTCUSDT': 'BTC', 'coinbase:BTC-USD': 'BTC', 'hyperliquid:ETH': 'ETH', 'ETHUSDT.P': 'ETH', 'NQZ26': 'NQ', 'fx:EURUSD': '', 'ZN1!': '', 'SPY': 'ES', '': '' };
for (const [k, v] of Object.entries(cases)) eq(newsSymOf(k), v, 'newsSymOf ' + k);
eq(agoLabel(1000, 1000 * 1000 + 30000), 'now', 'ago now');
eq(agoLabel(1000, (1000 + 600) * 1000), '10m', 'ago 10m');
eq(agoLabel(1000, (1000 + 7200) * 1000), '2h', 'ago 2h');

// bucketing + replay cut-off
const T0 = 1_792_000_000;
const items = [{ t: T0 + 10, h: 'a' }, { t: T0 + 50, h: 'b' }, { t: T0 + 400, h: 'c' }, { t: T0 + 2000, h: 'future' }];
const tf = 300000;
let b = M.bucketNews(items, tf, 0);
eq(b.length, 3, 'buckets live');
eq(b[0].items.map((x) => x.h), ['b', 'a'], 'bucket newest first');
b = M.bucketNews(items, tf, (T0 + 400) * 1000);
eq(b.flatMap((x) => x.items.map((y) => y.h)).includes('future'), false, 'replay: no headline after the clock');
eq(b.length, 2, 'replay: buckets up to the clock');
eq(M.bucketNews(items, tf, (T0 + 399) * 1000).flatMap((x) => x.items).length, 2, 'replay: cut is inclusive to the second');

// events
const E = (t, i, c, ti, extra) => Object.assign({ t, i, c, ti }, extra || {});
const rows = [E(1000, 'high', 'US', 'Core CPI MoM', { a: 0.4, f: 0.3, p: 0.2, u: '%' }), E(2000, 'medium', 'US', 'Retail Sales MoM'), E(3000, 'high', 'EU', 'ECB Interest Rate Decision'),
  E(4000, 'high', 'US', 'Fed Interest Rate Decision'), E(5000, 'low', 'US', 'Redbook'), E(6000, 'high', 'US', 'Non Farm Payrolls', { a: 250 })];
let ev = M.pickEvents(rows, { level: 'High', countries: 'US' });
eq(ev.map((e) => e.n), ['Core CPI', 'FOMC', 'NFP'], 'high US events + short names');
eq(M.pickEvents(rows, { level: 'High + medium', countries: 'US' }).length, 4, 'high + medium');
eq(M.pickEvents(rows, { level: 'High', countries: 'US + EU, UK, JP, CN' }).map((e) => e.n), ['Core CPI', 'EU ECB Interest Rate Decision', 'FOMC', 'NFP'], 'more countries');
ev = M.pickEvents(rows, { level: 'High', countries: 'US', cutMs: 5000 });
eq(ev.find((e) => e.n === 'NFP').a, undefined, 'replay: no actual after the clock');
eq(ev.find((e) => e.n === 'Core CPI').a, 0.4, 'replay: actual kept before the clock');
// warning chip
const evs = M.pickEvents(rows, { level: 'High', countries: 'US' }).map((e) => Object.assign(e, { t: e.t * 60000 }));
eq(M.nextWarning(evs, 1000 * 60000 - 12 * 60000, 30), { t: 1000 * 60000, text: 'Core CPI in 12 min' }, 'warning chip 12 min');
eq(M.nextWarning(evs, 1000 * 60000 - 45 * 60000, 30), null, 'no chip beyond the window');
eq(M.nextWarning(evs, 1000 * 60000 - 90 * 60000, 120).text, 'Core CPI in 1 h 30 min', 'chip hours');
eq(M.nextWarning(evs, 1000 * 60000, 30), null, 'no chip at/after the release');
eq(M.nextWarning([{ t: 600000, n: 'CPI' }, { t: 600000, n: 'Core CPI' }], 0, 30).text, 'CPI + Core CPI in 10 min', 'chip merges same-time events');

// calendar page time zones
try {
  const C = await import('../../assets/econ-calendar-is.js');
  const t = Date.UTC(2026, 9, 14, 12, 30);
  eq(C.fmtTime(t, 'ist'), '18:00', 'IST time');
  eq(C.fmtTime(t, 'ny'), '08:30', 'NY time (EDT)');
  eq(C.fmtTime(Date.UTC(2026, 11, 14, 13, 30), 'ny'), '08:30', 'NY time (EST)');
  eq(C.dayKey(Date.UTC(2026, 9, 14, 20, 0), 'ist'), '2026-10-15', 'IST day rolls over');
  eq(C.dayKey(Date.UTC(2026, 9, 14, 2, 0), 'ny'), '2026-10-13', 'NY day before');
  eq(C.countdown(3 * 3600000 + 5 * 60000 + 9000), '3h 05m 09s', 'countdown');
  eq(C.countdown(2 * 86400000 + 3600000), '2d 1h', 'countdown days');
} catch (e) { if (!/Cannot find module|ERR_MODULE_NOT_FOUND/.test(String(e))) { fail++; console.log('FAIL calendar module', e); } else console.log('(calendar page module not built yet)'); }

console.log(fail ? fail + ' FAILED of ' + n : n + ' checks passed');
process.exit(fail ? 1 : 0);
