// Watchlist colour flags + 9-16 chart layouts (guest path). Usage:
//   node tools/tests/chart-dev-server.mjs 8043 &  node tools/tests/chart-flags-browser.js http://127.0.0.1:8043 <outdir>
const { launch } = require('./lib.js');
const BASE = process.argv[2] || 'http://127.0.0.1:8043';
const OUT = (process.argv[3] || '/tmp') + '/';
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 300)); };
async function page(b, w, h, theme) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1, isMobile: w < 500, hasTouch: w < 500 });
  await ctx.addInitScript((th) => { try { localStorage.setItem('stryker_install_prompt_dismissed', '1'); if (th === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', () => {});
  p.on('pageerror', (e) => { if (!/firestore|CORS/i.test(e.message)) p.errs.push(e.message); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'load' });
  await p.waitForFunction(() => window.STRYKER_WATCHLIST && window.STRYKER_VELA, null, { timeout: 40000 });
  await p.waitForTimeout(2500);
  return { ctx, p };
}
(async () => {
  const b = await launch();
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) for (const th of ['dark', 'day']) {
      const { ctx, p } = await page(b, w, h, th); const tag = `${w}-${th}`;
      if (w < 500) await p.evaluate(() => window.STRYKER_WATCHLIST.setOpen(true)); else await p.click('.stkw-railbtn');
      await p.waitForSelector('.stkw-row');
      // click flag -> red, saved; second click clears
      await p.click('.stkw-row[data-sym="futures:NQ1!"] .stkw-flag');
      t(tag + ' click sets red', await p.$eval('.stkw-row[data-sym="futures:NQ1!"] .stkw-flag', (e) => e.dataset.f) === 'red');
      // right-click opens palette -> pick blue
      await p.click('.stkw-row[data-sym="futures:ES1!"] .stkw-flag', { button: 'right' });
      await p.click('.stkw-ctx .stkw-fsw[data-f="blue"]');
      await p.click('.stkw-row[data-sym="futures:GC1!"] .stkw-flag', { button: 'right' });
      await p.click('.stkw-ctx .stkw-fsw[data-f="pink"]');
      t(tag + ' palette sets blue', await p.$eval('.stkw-row[data-sym="futures:ES1!"] .stkw-flag', (e) => e.dataset.f) === 'blue');
      await p.screenshot({ path: `${OUT}flags-${tag}.png` });
      // filter blue
      await p.click('.stkw-flagfilter');
      await p.screenshot({ path: `${OUT}flags-menu-${tag}.png` });
      await p.click('.stkw-menu:not([hidden]) .stkw-mi:has(.stkw-fdot[data-f="blue"])');
      t(tag + ' blue filter shows 1 row', (await p.$$eval('.stkw-row', (a) => a.map((r) => r.dataset.sym))).join() === 'futures:ES1!');
      await p.screenshot({ path: `${OUT}flags-filter-${tag}.png` });
      await p.click('.stkw-flagfilter'); await p.click('.stkw-menu:not([hidden]) .stkw-mi:has-text("Flagged")');
      t(tag + ' Flagged shows 3', (await p.$$eval('.stkw-row', (a) => a.length)) === 3);
      // saved with the list
      await p.waitForTimeout(1000);
      const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('stryker_watchlists_guest'))[0].view.flags);
      t(tag + ' saved to storage', saved['futures:NQ1!'] === 'red' && saved['futures:ES1!'] === 'blue' && saved['futures:GC1!'] === 'pink', saved);
      await p.reload({ waitUntil: 'load' });
      await p.waitForFunction(() => window.STRYKER_WATCHLIST, null, { timeout: 40000 });
      await p.waitForTimeout(2000);
      await p.evaluate(() => window.STRYKER_WATCHLIST.setOpen(true));
      await p.waitForSelector('.stkw-row');
      t(tag + ' flag survives reload', await p.$eval('.stkw-row[data-sym="futures:NQ1!"] .stkw-flag', (e) => e.dataset.f) === 'red');
      await p.click('.stkw-row[data-sym="futures:NQ1!"] .stkw-flag');
      t(tag + ' click clears', await p.$eval('.stkw-row[data-sym="futures:NQ1!"] .stkw-flag', (e) => e.dataset.f) === '');
      t(tag + ' no page errors', p.errs.length === 0, p.errs.slice(0, 2));
      if (w === 390) {   // long-press
        const bx = await p.$eval('.stkw-row[data-sym="futures:YM1!"] .stkw-flag', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
        const cdp = await ctx.newCDPSession(p);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bx[0], y: bx[1] }] });
        await p.waitForTimeout(1000);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        t(tag + ' long-press opens palette', await p.$eval('.stkw-ctx', (e) => !e.hidden && !!e.querySelector('.stkw-fsw')));
        await p.screenshot({ path: `${OUT}flags-longpress-${tag}.png` });
      }
      await ctx.close();
    }
    // 16 charts at 1440
    const { ctx, p } = await page(b, 1440, 900, 'dark');
    const errs = [];
    p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::|status of|Failed to load resource|firestore|CORS|WebSocket/i.test(m.text())) errs.push(m.text()); });
    for (const id of ['9', '10', '12', '14', '16']) {
      await p.click('#stkc-layout-btn'); await p.click(`.stkg-ic[data-layout="${id}"]`);
      await p.waitForTimeout(2500);
      const r = await p.evaluate(() => ({ n: window.STRYKER_VELA.cells().length, id: window.STRYKER_VELA.layout.id, minW: Math.min(...window.STRYKER_VELA.cells().map((c) => c.host.getBoundingClientRect().width)) }));
      t('1440 layout ' + id, r.n === +id && r.id === id && r.minW > 80, r);
    }
    await p.click('#stkc-layout-btn');
    t('slow-computer note above 8', await p.$eval('.stkg-note:not([hidden])', (e) => e.textContent) === 'Lots of charts can slow older computers.');
    await p.screenshot({ path: `${OUT}grid16-picker-1440.png` });
    await p.keyboard.press('Escape');
    t('16 charts: no page errors', p.errs.length === 0 && errs.length === 0, p.errs.concat(errs).slice(0, 3));
    await p.screenshot({ path: `${OUT}grid16-1440.png` });
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
