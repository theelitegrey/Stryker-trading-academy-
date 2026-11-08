// Metric alerts, client pure logic (assets/chart-metric-alerts.js: buildMetric, underlying, coinOf, titleOf) and parity with the
// engine's accepted shapes (workers/alert-engine/metric_alerts.py METRICS / LEVELS, firestore.rules metricAlerts).
//   node tools/tests/metric-alerts.test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.window = { location: { hostname: 'x' } };
globalThis.location = window.location;
const M = await import(path.join(ROOT, 'assets', 'chart-metric-alerts.js'));
let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' ' + JSON.stringify(a));

ok(M.underlying('futures:ES1!') === 'SPX' && M.underlying('NQ') === 'QQQ' && M.underlying('IDX:SPX') === 'SPX' && M.underlying('nvda') === 'NVDA', 'futures map to their options underlying');
ok(M.coinOf('okx:BTC-USDT-SWAP') === 'BTC' && M.coinOf('hyperliquid:ETH') === 'ETH' && M.coinOf('BINANCE:SOLUSDT') === 'SOL', 'coin from any crypto symbol');
let b = M.buildMetric({ metric: 'gex_cross', symbol: 'ES1!', level: 'em_low', cdir: 'down', freq: 'every' });
eq(b, { col: 'metricAlerts', doc: { metric: 'gex_cross', symbol: 'SPX', p: { level: 'em_low', dir: 'down', range: 's' }, message: '', freq: 'every', active: true } }, 'gex cross doc');
b = M.buildMetric({ metric: 'funding', symbol: 'BTC', venue: 'hl', dir: 'below', value: -0.01 });
eq(b.doc.p, { venue: 'hl', dir: 'below', value: -0.01 }, 'funding below a negative rate');
b = M.buildMetric({ metric: 'oi_change', symbol: 'ETH', venue: 'okx', odir: 'sideways', value: 3, mins: 7 });
eq(b.doc.p, { venue: 'okx', dir: 'either', value: 3, mins: 15 }, 'bad OI dir / minutes fall back to safe defaults');
b = M.buildMetric({ metric: 'gex_regime', symbol: 'QQQ' });
eq(b, { col: 'zoroAlerts', doc: { type: 'zone_change', symbol: 'QQQ', p: {}, message: '', freq: 'once', active: true } }, 'regime goes to zoroAlerts zone_change');
b = M.buildMetric({ metric: 'pc_ratio', symbol: 'SPY', dir: 'above', value: 1.3 });
ok(b.col === 'zoroAlerts' && b.doc.type === 'pc_extreme' && b.doc.p.value === 1.3, 'put/call goes to zoroAlerts pc_extreme');
for (const [v, why] of [[{ metric: 'nope', symbol: 'SPX' }, 'unknown metric'], [{ metric: 'gex_cross', symbol: 'SPX', level: 'x' }, 'unknown level'],
  [{ metric: 'iv_rank', symbol: 'SPX', value: 101 }, 'IV rank > 100'], [{ metric: 'pc_ratio', symbol: 'SPX', value: 0 }, 'put/call 0'],
  [{ metric: 'funding', symbol: 'BTC', venue: 'okx', value: 6 }, 'funding 6%'], [{ metric: 'funding', symbol: 'BTC', venue: 'binance', value: 0.1 }, 'unknown exchange'],
  [{ metric: 'oi_change', symbol: 'BTC', venue: 'okx', value: 0 }, 'OI change 0'], [{ metric: 'funding', symbol: 'B T C', venue: 'okx', value: 0.1 }, 'bad coin'],
  [{ metric: 'iv_rank', symbol: 'SPX', value: NaN }, 'no value']]) ok(!!M.buildMetric(v).error, 'refused: ' + why);
ok(M.buildMetric({ metric: 'funding', symbol: 'BTC', venue: 'okx', value: 0.1, message: 'x'.repeat(200) }).doc.message.length === 140, 'message capped at 140');
ok(M.titleOf({ metric: 'gex_cross', symbol: 'SPX', p: { level: 'gamma_flip', dir: 'any' } }) === 'SPX crosses its Flip Line (zero gamma)', 'title gex');
ok(M.titleOf({ metric: 'funding', symbol: 'BTC', p: { venue: 'okx', dir: 'above', value: 0.01 } }) === 'BTC funding on OKX above 0.01%', 'title funding');
ok(M.titleOf({ metric: 'oi_change', symbol: 'ETH', p: { venue: 'hl', dir: 'either', value: 2, mins: 60 } }) === 'ETH open interest on Hyperliquid moves 2% in 60 min', 'title OI');
ok(M.MAX_METRIC === 20, 'cap 20');

// parity with the engine + rules
const py = fs.readFileSync(path.join(ROOT, 'workers', 'alert-engine', 'metric_alerts.py'), 'utf8');
const pyMetrics = (/METRICS = \(([^)]*)\)/.exec(py) || [])[1] || '';
const clientServer = M.METRICS.filter((m) => !m.z).map((m) => m.v);
ok(clientServer.every((m) => pyMetrics.includes("'" + m + "'")) && (pyMetrics.match(/'/g) || []).length / 2 === clientServer.length, 'client metricAlerts metrics == engine METRICS');
ok(M.LEVELS.every(([l]) => new RegExp("['\"]" + l + "['\"]").test(py)), 'every client level is known to the engine');
const rules = fs.readFileSync(path.join(ROOT, 'functions-src', 'firestore.rules'), 'utf8');
const blk = rules.slice(rules.indexOf('match /metricAlerts/{aid}'), rules.indexOf('match /metricAlerts/{aid}') + 1500);
ok(clientServer.every((m) => blk.includes("'" + m + "'")), 'rules allow every metric the client writes');
const zt = rules.slice(rules.indexOf('match /zoroAlerts/{aid}'), rules.indexOf('match /zoroAlerts/{aid}') + 900);
ok(M.METRICS.filter((m) => m.z).every((m) => zt.includes("'" + m.z + "'")), 'rules allow every zoroAlerts type the picker writes');
console.log(fail ? fail + ' FAILED' : 'ALL PASS');
process.exit(fail ? 1 : 0);
