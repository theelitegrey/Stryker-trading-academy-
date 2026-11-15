// Legend symbol text click opens the symbol search for THAT pane (assets/vela-chart.js).
//   node tools/tests/chart-dev-server.mjs 8046 &   CHART_BASE=http://127.0.0.1:8046 node tools/tests/chart-symclick-browser.js
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8046';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x))); };
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const mobile of [false, true]) {
    const ctx = await b.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
    await ctx.addInitScript(stub);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_CHART_UI && window.STRYKER_CHART_UI.grid, null, { timeout: 40000 });
    await p.waitForTimeout(2500);
    const tag = mobile ? '390 ' : '1440 ';
    if (!mobile) { await p.evaluate(() => window.STRYKER_VELA.setLayout('2h')); await p.waitForTimeout(2500); }
    const n = await p.evaluate(() => window.STRYKER_VELA.cells().length);
    const idx = n - 1;   // the NON-active pane on desktop
    const sel = '.vela-statusline .vela-sl-symbol';
    const loc = p.locator(sel).nth(idx);
    await loc.waitFor({ timeout: 15000 });
    check(await loc.evaluate((e) => getComputedStyle(e).cursor === 'pointer'), tag + 'pointer cursor');
    if (mobile) await loc.tap(); else await loc.click();
    await p.waitForSelector('.vela-sp-row', { timeout: 8000 }).catch(() => {});
    check(await p.evaluate(() => document.querySelectorAll('.vela-sp-row').length > 0), tag + 'search opens');
    const row = p.locator('.vela-sp-row[data-ticker^="ES"]').first();
    await row.waitFor({ timeout: 8000 });
    await row.click();
    await p.waitForTimeout(2500);
    const r = await p.evaluate((i) => ({ syms: window.STRYKER_VELA.cells().map((c) => String(c.symbol || '')), txt: [...document.querySelectorAll('.vela-sl-symbol')].map((e) => e.textContent) }), idx);
    check(/ES1!/.test(r.syms[idx]), tag + 'clicked pane symbol is ES', r);
    if (n > 1) check(!/ES1!/.test(r.syms[0]), tag + 'other pane unchanged', r.syms);
    await ctx.close();
  }
  await b.close();
  process.exit(fail ? 1 : 0);
})();
