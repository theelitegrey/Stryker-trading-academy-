// Alerts cap 1000 + "Show more" list. Guest (localStorage) path.
//   node tools/tests/chart-dev-server.mjs 8043 &  node tools/tests/chart-alerts-limit-browser.js http://127.0.0.1:8043 <outdir>
const { launch } = require('./lib.js');
const BASE = process.argv[2] || 'http://127.0.0.1:8043';
const OUT = (process.argv[3] || '/tmp') + '/';
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 300)); };
(async () => {
  const b = await launch();
  try {
    for (const [w, h, th] of [[1440, 900, 'dark'], [1440, 900, 'day'], [390, 844, 'dark'], [390, 844, 'day']]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
      await ctx.addInitScript(([th]) => {
        try { localStorage.setItem('stryker_install_prompt_dismissed', '1'); if (th === 'day') localStorage.setItem('stryker_theme', 'day');
          localStorage.setItem('stryker_chart_alerts_guest', JSON.stringify(Array.from({ length: 999 }, (_, i) => ({ id: 'l' + i, symbol: 'futures:NQ1!', cond: 'crossing', price: 1000 + i, message: '', freq: 'once', active: true })))); } catch (e) {}
      }, [th]);
      const p = await ctx.newPage(); const errs = [];
      p.on('pageerror', (e) => { if (!/firestore|CORS/i.test(e.message)) errs.push(e.message); });
      await p.goto(BASE + '/charts.html', { waitUntil: 'load' });
      await p.waitForFunction(() => window.__stkAlerts && window.__stkAlerts.alerts.length >= 999, null, { timeout: 40000 });
      const tag = w + '-' + th;
      await p.evaluate(() => window.__stkAlerts.open());
      await p.waitForSelector('.stk-al-count');
      t(tag + ' counter says of 1000', /^999 of 1000 alerts/.test(await p.textContent('.stk-al-count')), await p.textContent('.stk-al-count'));
      t(tag + ' only 100 rows rendered', (await p.$$eval('.stk-al-row', (a) => a.length)) === 100);
      await p.click('.stk-al-list > .stk-al-new2');
      t(tag + ' show more adds 100', (await p.$$eval('.stk-al-row', (a) => a.length)) === 200);
      await p.screenshot({ path: `${OUT}alerts-${tag}.png` });
      const r = await p.evaluate(async () => { await window.__stkAlerts.add({ symbol: 'futures:NQ1!', cond: 'crossing', price: 5, freq: 'once' }); let full = false; try { await window.__stkAlerts.add({ symbol: 'futures:NQ1!', cond: 'crossing', price: 6, freq: 'once' }); } catch (e) { full = !!e.full; } return { n: window.__stkAlerts.alerts.length, full }; });
      t(tag + ' 1000th ok, 1001st refused', r.n === 1000 && r.full, r);
      t(tag + ' no errors', errs.length === 0, errs.slice(0, 2));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
