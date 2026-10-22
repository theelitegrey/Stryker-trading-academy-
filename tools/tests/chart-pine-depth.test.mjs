// Pine history depth (assets/chart-history-pager.js pineDepthBars), Node unit test.
//   node tools/tests/chart-pine-depth.test.mjs
// With a Pine script on the chart the pager loads >= 2 days of bars (cap 5000) so session /
// previous-day levels (Liquidity Master Asia/London/NY, PDH/PDL) exist like on TradingView.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { pineDepthBars } = await import(pathToFileURL(path.join(root, 'assets', 'chart-history-pager.js')).href);
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
check(pineDepthBars('1') === 2880, '1m: 2 days = 2880 bars (' + pineDepthBars('1') + ')');
check(pineDepthBars('5') === 576, '5m: 576 bars');
check(pineDepthBars('15') === 192, '15m: 192 bars (below the 500 first load: nothing extra)');
check(pineDepthBars('D') === 0 && pineDepthBars('W') === 0, 'daily / weekly: no extra load');
check(pineDepthBars('1') <= 5000, 'capped at 5000');
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
