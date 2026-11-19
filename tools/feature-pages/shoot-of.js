// Screenshots for /features/orderflow (FEATA redesign, 19 Nov 2026): the REAL ZoroCharts page (charts.html) with the Order
// Flow tools on a REAL recorded BTCUSDT session (tools/tests/fixtures/liquidity: 50 minutes of every trade with its side, plus
// the order book every second), opened by tools/tests/liqmap-lib.js (no network, clock pinned to the end of the recording).
// Futures order flow now runs on the L2 feed, which has no offline recording, so the crypto session shows the same tools.
// Output: PNGs (2x) in <outDir>, cropped to webp by tools/feature-pages/crop.py. Every image is labelled "Sample data".
//   node tools/tests/chart-dev-server.mjs 8093 &
//   tools/chrome-slot.sh env CHART_BASE=http://127.0.0.1:8093 node --max-old-space-size=768 tools/feature-pages/shoot-of.js <outDir> [scene...]
process.env.CHART_BASE = process.env.CHART_BASE || 'http://127.0.0.1:8093';
const fs = require('fs'), path = require('path');
const { launch } = require('../tests/lib.js');
const { open, R, T_END, MIN, sleep } = require('../tests/liqmap-lib.js');
const OUT = process.argv[2] || '/tmp/ofshots', ONLY = process.argv.slice(3);
fs.mkdirSync(OUT, { recursive: true });
const T0 = R.samples[0].ts;

const add = (p, t, inputs) => p.evaluate(([t, i]) => !!window.STRYKER_VELA.chart.addNativeIndicator(t, i ? { inputs: i } : undefined), [t, inputs || null]);
const clear = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.chart; c.indicators().filter((h) => h.nativeType !== 'volume').forEach((h) => { try { c.removeIndicator ? c.removeIndicator(h.id) : h.remove(); } catch (e) {} }); });
const range = (p, a, z) => p.evaluate(([a, z]) => window.STRYKER_VELA.chart.setVisibleRange({ from: a, to: z }), [a, z]);
// exchange names and timing words never appear in a marketing image (brief 19 Nov): hide the legend's venue + feed-state text
const scrub = (p) => p.evaluate(() => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const hit = [];
  while (w.nextNode()) hit.push(w.currentNode);
  hit.forEach((n) => { const t = n.nodeValue;
    if (/^\s*(Real-time|Live|Delayed)\s*$/i.test(t) || /min delayed/i.test(t)) { n.parentElement.style.visibility = 'hidden'; return; }
    const v = t.replace(/\s*·\s*BINANCE/gi, '').replace(/BINANCE\s*·?\s*/gi, ''); if (v !== t) n.nodeValue = v; });
});
async function shot(p, n) {
  await scrub(p);
  await p.mouse.move(2, 2).catch(() => {}); await sleep(800);
  await p.addStyleTag({ content: '.tzc,.toast,#cookie-notice{display:none!important}' }).catch(() => {});
  await p.screenshot({ path: path.join(OUT, n + '.png') });
  console.log('SHOT', n, await p.evaluate(() => window.STRYKER_VELA.chart.indicators().map((h) => h.nativeType).join(',')));
}
const scenes = {
  async btc(b) {
    const { ctx, p, errors } = await open(b, { w: 1440, h: 900, v09: true });
    await add(p, 'stk_footprint'); await range(p, T_END - 7 * MIN, T_END + MIN); await sleep(3500); await shot(p, 'footprint');
    await clear(p); await add(p, 'stk_of_big', { intensity: 'Very low', showSize: true }); await add(p, 'stk_of_vp'); await range(p, T_END - 30 * MIN, T_END + 3 * MIN); await sleep(3000); await shot(p, 'bigtrades-vp');
    await clear(p); await add(p, 'stk_of_abs', { volMult: 1, densMult: 1, minDeltaPct: 3 }); await add(p, 'stk_of_cvd'); await sleep(3000); await shot(p, 'abs-cvd');
    await clear(p); await add(p, 'stk_of_imb', { ratio: 200, stack: 2 }); await add(p, 'stk_of_delta'); await sleep(3000); await shot(p, 'imb-delta');
    await clear(p); await add(p, 'stk_of_sweep'); await add(p, 'stk_of_evr'); await sleep(3000); await shot(p, 'sweep-evr');
    await clear(p); await add(p, 'stk_crypto_dom', { historyMinutes: 120 }); await sleep(1500);
    await p.evaluate((s) => window.__stkFlow.domDebugLoad(s), R.samples);
    await p.waitForFunction(() => { const d = window.__stkFlow.domDebug(); return d && d.columns > 50; }, null, { timeout: 30000 }).catch(() => {});
    await range(p, T0, T_END + 8 * MIN); await sleep(3000); await shot(p, 'dom-heatmap');
    await add(p, 'stk_of_big', { intensity: 'Very low' }); await sleep(2500); await shot(p, 'dom-bubbles');
    console.log('errors', errors.slice(0, 3));
    await ctx.close();
  },
};

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const nc = b.newContext.bind(b);
  b.newContext = (o) => nc(Object.assign({}, o, { deviceScaleFactor: 2 }));   // 2x captures for the 1x/2x webp pair
  try { for (const [n, fn] of Object.entries(scenes)) if (!ONLY.length || ONLY.includes(n)) await fn(b); }
  finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
