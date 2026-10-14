// Live smoke: production /gex panel at 1440 + 390 (stub login, real recorder data).
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const OUT = process.argv[2] || '/tmp';
const URLP = process.argv[3] || 'https://strykertrading.com/gex';
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  let fail = 0;
  for (const [w, h] of [[1440, 1000], [390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' });
    await ctx.addInitScript(stub);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(URLP, { waitUntil: 'domcontentloaded', timeout: 45000 });
    try { await p.waitForFunction(() => document.querySelector('#gex-options .gexo-table, #gex-options .gexo-empty, #gex-options .plan-lock'), null, { timeout: 30000 }); } catch (e) {}
    await p.waitForTimeout(1500);
    const s = await p.evaluate(() => { const h = document.getElementById('gex-options'); return h ? { rows: h.querySelectorAll('.gexo-table tbody tr').length, ago: (h.querySelector('.gexo-ago') || {}).textContent, svgs: h.querySelectorAll('.gexo-svg').length, txt: h.innerText.slice(0, 160) } : null; });
    console.log(w, JSON.stringify(s), 'errors:', errs.length);
    if (!s || !s.rows) fail++;
    // the stub login cannot pass production's access gate: reveal the shell for the screenshot only
    await p.evaluate(() => { document.querySelectorAll('.gate-pending').forEach((e) => e.classList.remove('gate-pending')); document.querySelectorAll('.access-gate-overlay, .paywall-overlay').forEach((e) => e.remove()); document.getElementById('gex-options').scrollIntoView(); });
    await p.waitForTimeout(500);
    try { await p.locator('#gex-options').screenshot({ path: OUT + '/live-gex-options-' + w + '.png', timeout: 15000 }); } catch (e) { console.log('shot failed', String(e).slice(0, 120)); }
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAIL' : 'OK');
})();
