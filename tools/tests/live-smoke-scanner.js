// Live smoke: strykertrading.com/scanner at 1440 and 390 (real recorder data). Needs a signed-out
// look only: the access gate may redirect, so we report where we landed.
//   flock /tmp/stryker-chrome.lock node tools/tests/live-smoke-scanner.js <outDir>
const { launch } = require('./lib.js');
const OUT = process.argv[2] || '/tmp';
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=512'] });
  let fail = 0;
  for (const [w, h] of [[1440, 1000], [390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500 });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto('https://strykertrading.com/scanner', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => errs.push('goto ' + e.message));
    await p.waitForSelector('.scn-table', { timeout: 25000 }).catch(() => {});
    await p.waitForTimeout(800);
    const r = await p.evaluate(() => ({ url: location.pathname, rows: document.querySelectorAll('.scn-table tbody tr').length, ago: (document.getElementById('scn-ago') || {}).textContent, tabs: document.querySelectorAll('.scn-tab').length }));
    console.log(w, JSON.stringify(r), errs.join('|').slice(0, 200));
    if (!r.rows || errs.length) fail++;
    await p.screenshot({ path: OUT + '/live-scanner-' + w + '.png' });
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED' : 'OK');
  process.exit(fail ? 1 : 0);
})();
