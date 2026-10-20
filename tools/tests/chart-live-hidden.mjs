// LIVE hidden-tab check: NQ chart on tradezoro.com as the demo/admin account; the page is really FROZEN by Chrome
// (CDP Page.setWebLifecycleState) for N minutes, then made active; reports how long until the newest bar is current.
//   node tools/tests/chart-live-hidden.mjs <minutes[,minutes...]> <outdir>
import fs from 'node:fs';
import { launch, login, BASE } from '../demo-account/lib/browser.mjs';
const LIST = String(process.argv[2] || '1,5').split(',').map(Number), OUT = process.argv[3] || '.';
const { b, ctx, page } = await launch(1440, 900);
const res = [];
try {
  await login(page);
  await page.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
  await page.evaluate(() => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); });
  await page.waitForTimeout(8000);
  const cdp = await ctx.newCDPSession(page);
  const st = () => page.evaluate(() => { const r = window.STRYKER_VELA.chart.orchestrator.rawBars, l = r[r.length - 1]; return { t: l.time, dot: (document.querySelector('.stkc-dd-t') || {}).textContent, left: window.tzRtState && window.tzRtState().tokenSecsLeft }; });
  for (const m of LIST) {
    const other = await ctx.newPage(); await other.goto('about:blank');
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    await new Promise((r) => setTimeout(r, m * 60000));
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    const t0 = Date.now(); let caught = null, s;
    while (Date.now() - t0 < 60000) {
      try { s = await st(); } catch (e) { await new Promise((r) => setTimeout(r, 250)); continue; }
      if (Date.now() / 1000 - s.t / 1000 < 75) { caught = (Date.now() - t0) / 1000; break; }
      await new Promise((r) => setTimeout(r, 250));
    }
    res.push({ awayMin: m, caughtUpS: caught, dot: s && s.dot, tokenSecsLeft: s && s.left });
    console.log(JSON.stringify(res[res.length - 1]));
    await other.close();
  }
  await page.screenshot({ path: OUT + '/hidden-live-1440.png' });
} finally { await b.close(); fs.writeFileSync(OUT + '/hidden-result.json', JSON.stringify(res, null, 1)); }
