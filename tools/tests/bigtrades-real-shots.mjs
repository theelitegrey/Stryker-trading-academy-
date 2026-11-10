// Real-feed screenshots of Big Trades (L2) on NQ1! 1m (live site, demo account, dark) at 1440 and 390, with the plate count vs marks in view.
//   flock /tmp/stryker-chrome.lock node tools/tests/bigtrades-real-shots.mjs <outdir>
import fs from 'node:fs';
import dns from 'node:dns/promises';
import { createRequire } from 'node:module';
import { login, BASE } from '../demo-account/lib/browser.mjs';
const { chromium } = createRequire('/root/projects/stryker-trading-academy/package.json')('playwright-core');
const OUT = process.argv[2] || '.'; fs.mkdirSync(OUT, { recursive: true });
const G = ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com', 'www.googleapis.com', 'firebaseinstallations.googleapis.com'];
const rules = (await Promise.all(G.map(async (h) => { try { return 'MAP ' + h + ' ' + (await dns.resolve4(h))[0]; } catch (e) { return ''; } }))).filter(Boolean).join(', ');   // this server's IPv6 gets 403 from Google sign-in
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768', '--host-resolver-rules=' + rules] });
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark', deviceScaleFactor: w < 500 ? 2 : 1, isMobile: w < 500, hasTouch: w < 500 });
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_theme', 'night'); } catch (e) {} });
  // LOCAL=1: the Big Trades files come from this worktree (same ?v= as the live page for the sibling imports)
  if (process.env.LOCAL) await ctx.route(/\/assets\/(chart-bigtrades|chart-l2-flow|chart-ts-trades)\.js/, async (r) => {
    const u = new URL(r.request().url()), f = u.pathname.split('/').pop(), v = u.searchParams.get('v');
    r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(new URL('../../assets/' + f, import.meta.url), 'utf8').replace(/\?v=\d+/g, '?v=' + v) });
  });
  const page = await ctx.newPage();
  try {
    await login(page);
    await page.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 90000 });
    await page.evaluate(() => { try { window.STRYKER_CHART_UI.setLayout('1'); } catch (e) {} const c = window.STRYKER_VELA.cells()[0]; c.setSymbol('futures:NQ1!'); c.setTimeframe('1'); });
    await page.waitForTimeout(8000);
    await page.evaluate(() => { const c = window.STRYKER_VELA.cells()[0]; if (!(c.chart.indicators() || []).some((x) => x.nativeType === 'stk_l2f_big')) c.chart.addNativeIndicator('stk_l2f_big', {}); });
    await page.waitForTimeout(15000);
    await page.evaluate(() => { for (let k = 0; k < 20; k++) { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); if (!e || e.tagName === 'CANVAS') break; let t = e; while (t.parentElement && t.parentElement !== document.body) t = t.parentElement; if (t.querySelector && t.querySelector('canvas')) break; t.style.display = 'none'; } });   // agreement / country modal (not part of this bug)
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => {
      const c = window.STRYKER_VELA.cells()[0]; let r = c.chart.renderer; r = r && r.extLayers ? r : r && r.renderer;
      const l = r.extLayers.find((x) => x.def.id === 'stk_l2f_big'), d = r.scene.nativeData.get(l.channel) || {}, bars = c.chart.orchestrator.rawBars;
      const vr = r.coords.visibleLogicalRange(), t0 = bars[Math.max(0, Math.floor(vr.from))].time, list = (d.sel || { list: [] }).list;
      return { plate: d.owner && d.owner.text, total: list.length, inView: list.filter((p) => p.ms >= t0).length, viewFromUtc: new Date(t0).toISOString().slice(11, 16), thr: d.sel && d.sel.thr };
    });
    console.log(w, JSON.stringify(st));
    await page.screenshot({ path: OUT + '/' + (process.env.LOCAL ? 'after' : 'before') + '-' + w + '-dark.png' });
  } catch (e) { console.log(w, 'ERR', String(e.message).slice(0, 200)); }
  await ctx.close();
}
await b.close();
