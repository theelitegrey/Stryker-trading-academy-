// US earnings: the "US earnings" tab on the economic calendar + the "E" marker on a stock chart.
// The daily file is answered from a fixture. Usage:
//   node tools/tests/chart-dev-server.mjs 8043 &  node tools/tests/earnings-browser.js http://127.0.0.1:8043 <outdir>
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.argv[2] || 'http://127.0.0.1:8043';
const OUT = (process.argv[3] || '/tmp') + '/';
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : JSON.stringify(x).slice(0, 300)); };
const ny = (d) => new Date(Date.now() + d * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const FILE = { generatedAt: Date.now(), source: 'Nasdaq public earnings calendar', items: [
  [ny(1), 'AAPL', 'Apple Inc.', 'amc', 1.98, 'Sep/2026'], [ny(1), 'MCD', "McDonald's Corporation", 'bmo', 3.22, 'Sep/2026'],
  [ny(2), 'NVDA', 'NVIDIA Corporation', 'amc', null, 'Oct/2026'], [ny(-2), 'KO', 'Coca-Cola Co', 'bmo', 0.77, 'Sep/2026'] ] };
const route = (ctx) => ctx.route(/raw\.githubusercontent\.com\/.*earnings\.json/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(FILE) }));
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, th] of [[1440, 900, 'dark'], [1440, 900, 'day'], [390, 844, 'dark'], [390, 844, 'day']]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
      await ctx.addInitScript((th) => { try { if (th === 'day') localStorage.setItem('stryker_theme', 'day'); localStorage.setItem('stryker_install_prompt_dismissed', '1'); } catch (e) {} }, th);
      await route(ctx);
      const p = await ctx.newPage(); const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(BASE + '/economic-calendar.html', { waitUntil: 'load' });
      await p.waitForSelector('.ec-tab[data-tab="useps"]', { timeout: 20000 });
      await p.click('.ec-tab[data-tab="useps"]');
      await p.waitForSelector('.ec-row.is-earnings');
      const tag = w + '-' + th;
      const rows = await p.$$eval('.ec-row.is-earnings .ec-tick', (a) => a.map((x) => x.textContent));
      t(tag + ' tab lists upcoming (not past) rows', rows.join() === 'MCD,AAPL,NVDA', rows);
      t(tag + ' before-open sorts first, EPS shown', (await p.$$eval('.ec-row.is-earnings', (a) => a[0].textContent)).includes('Before open') && (await p.textContent('#ec-days')).includes('1.98'));
      t(tag + ' labelled updated daily, not live', /Updated daily/.test(await p.textContent('#ec-days')) && !/\blive\b/i.test(await p.textContent('#ec-days')));
      await p.fill('#ec-q', 'nvd');
      t(tag + ' search', (await p.$$eval('.ec-row.is-earnings', (a) => a.length)) === 1);
      await p.fill('#ec-q', '');
      await p.click('[data-crange="past"]');
      t(tag + ' past week', (await p.$$eval('.ec-row.is-earnings .ec-tick', (a) => a.map((x) => x.textContent))).join() === 'KO');
      await p.click('[data-crange="ahead"]');
      await p.screenshot({ path: `${OUT}earnings-tab-${tag}.png` });
      t(tag + ' no horizontal overflow', await p.evaluate((w) => document.documentElement.scrollWidth <= w + 1, w));
      t(tag + ' no errors', errs.length === 0, errs);
      await ctx.close();
    }
    // chart marker
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(stub);
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => { if (!/firestore|CORS/i.test(e.message)) errs.push(e.message); });
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.__stkNewsMarkers, null, { timeout: 60000 });
    await p.waitForTimeout(2500);
    await p.evaluate(() => window.STRYKER_VELA.active.setSymbol('idx:SPY'));
    await p.waitForFunction(() => { const c = window.STRYKER_VELA.context().cells[0].chart; let bs = []; try { bs = c.bars(); } catch (e) {} return bs.length > 50; }, null, { timeout: 40000 }).catch(() => {});
    const last = await p.evaluate(() => { let bs = []; try { bs = window.STRYKER_VELA.context().cells[0].chart.bars(); } catch (e) {} if (!bs.length) bs = [{ time: Date.now() - 60000 }, { time: Date.now() }]; return { sym: window.STRYKER_VELA.active.symbol, n: bs.length, t: bs[bs.length - 1].time, tf: bs[bs.length - 1].time - bs[bs.length - 2].time }; });
    console.log('chart', JSON.stringify(last));
    const day = new Date(last.t).toISOString().slice(0, 10);
    await p.evaluate((day) => { window.__stkNewsMarkers._setEarnings({ items: [[day, 'SPY', 'Test Co', 'bmo', 1.23, 'Sep/2026'], [day, 'AAPL', 'Other', 'amc', 9, '']] }); const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_earn', {}); }, day);
    await p.waitForTimeout(2500);
    const hit = await p.evaluate(() => { const o = []; for (const cv of document.querySelectorAll('canvas[data-stk-nm]')) for (const b of window.__stkNewsMarkers.hits(cv) || []) if (b.kind === 'earn') o.push({ x: b.x, y: b.y, d: b.data }); return o; });
    t('chart: one E marker for the ticker only', hit.length === 1 && hit[0].d.e === 1.23, hit);
    await p.screenshot({ path: `${OUT}earnings-chart-1440.png` });
    if (hit.length) {
      const rect = await p.evaluate(() => document.querySelector('canvas[data-stk-nm]').getBoundingClientRect().toJSON());
      await p.mouse.move(rect.left + hit[0].x, rect.top + hit[0].y); await p.waitForTimeout(400);
      t('chart: hover shows EPS estimate + updated daily', /EPS estimate 1.23/.test(await p.textContent('.stk-nm-tip')) && /Updated daily/.test(await p.textContent('.stk-nm-tip')));
      await p.screenshot({ path: `${OUT}earnings-chart-hover-1440.png` });
    }
    await p.evaluate(() => window.STRYKER_VELA.active.setSymbol('futures:NQ1!')); await p.waitForTimeout(3000);
    t('chart: no marker on a futures symbol', (await p.evaluate(() => { let n = 0; for (const cv of document.querySelectorAll('canvas[data-stk-nm]')) n += (window.__stkNewsMarkers.hits(cv) || []).filter((b) => b.kind === 'earn').length; return n; })) === 0);
    t('chart: no errors', errs.length === 0, errs);
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
