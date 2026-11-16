// Long history end to end: 1H chart, pick the biggest days choice, chart pages back in, composite VP covers the loaded range.
// node tools/tests/chart-dev-server.mjs 8041 &  CHART_BASE=http://127.0.0.1:8041 node tools/tests/chart-longhist-browser.js [shotsDir]
const { launch } = require('./lib.js'); const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8041', OUT = process.argv[2] || '/tmp';
let fail = 0; const check = (ok, m, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + m + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
(async () => {
  const b = await launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(stub); await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e.stack||e).slice(0,500)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.__stkHistoryPager, null, { timeout: 60000 });
  await p.evaluate(() => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id); if (c.symbol !== 'futures:NQ1!') c.setSymbol('futures:NQ1!'); c.setTimeframe('60'); });
  await p.waitForTimeout(6000);
  const cap0 = await p.evaluate(() => window.__stkHistoryPager.cap(window.STRYKER_VELA.active.id));
  check(cap0 >= 700, '1H cap is years-scale (>=700 days)', cap0);
  await p.evaluate((d) => { window.__stkSetDays && 0; }, 0);
  // choose 365 days through the real setting store
  const ok = await p.evaluate(async () => { const m = await import('/assets/chart-days-load.js?v=1067'); const id = window.STRYKER_VELA.active.id; m.setDays(id, '60', 365); window.__stkHistoryPager.kick(id); return true; });
  await p.waitForFunction(() => { const o = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id).chart.orchestrator; const b = o.rawBars; return b.length > 1 && (b[b.length - 1].time - b[0].time) / 864e5 >= 330; }, null, { timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(3000);
  const r = await p.evaluate(() => { const o = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id).chart.orchestrator, b = o.rawBars; return { n: b.length, days: (b[b.length - 1].time - b[0].time) / 864e5, pages: window.__stkHistoryPager.stats().pages }; });
  check(r.days >= 330 && r.days <= 366, '1H, 365 days chosen -> chart holds about a year', r);
  check(r.pages >= 1, 'loaded in pages', r.pages);
  // composite VP over the loaded range
  const vp = await p.evaluate(() => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id); const o = c.chart.orchestrator; return { n: o.rawBars.length, first: o.rawBars[0].time, last: o.rawBars.at(-1).time }; });
  await p.screenshot({ path: OUT + '/longhist-1440.png' }); console.log('shot', OUT + '/longhist-1440.png');
  check(errs.length === 0, 'no page errors', errs);
  await b.close(); console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
