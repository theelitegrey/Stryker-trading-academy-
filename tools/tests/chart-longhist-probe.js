// Probe: max "days of history" per timeframe per symbol on the real chart.  CHART_BASE=http://127.0.0.1:8041 node tools/tests/chart-longhist-probe.js
const { launch } = require('./lib.js'); const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
(async () => {
  const b = await launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(stub);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.__stkHistoryPager, null, { timeout: 60000 });
  for (const sym of (process.env.SYMS || 'futures:NQ1!,futures:GC1!').split(',')) {
    await p.evaluate((s) => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id); if (c.symbol !== s) c.setSymbol(s); }, sym);
    const row = {};
    for (const tf of ['1', '5', '15', '30', '60', '240', 'D', 'W']) {
      await p.evaluate((tf) => window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id).setTimeframe(tf), tf);
      await p.waitForTimeout(1500);
      row[tf] = await p.evaluate(() => window.__stkHistoryPager.cap(window.STRYKER_VELA.active.id));
    }
    console.log(sym, JSON.stringify(row));
  }
  await b.close();
})();
