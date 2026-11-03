// Data source sheet browser test. CHART_BASE=http://127.0.0.1:8044 node tools/tests/byo-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8044';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 200))); };
async function open(b, w, h, mobile, theme) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const reqs = []; ctx.on('request', (r) => reqs.push(r.url()));
  const p = await ctx.newPage(); const logs = [];
  p.on('console', (m) => logs.push(m.text()));
  p.on('pageerror', (e) => logs.push('PAGEERR ' + e));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && document.querySelector('#byo-btn'), null, { timeout: 45000 });
  await p.waitForTimeout(800);
  return { ctx, p, logs, reqs };
}
(async () => {
  const b = await launch();
  for (const [w, h, mobile, theme, tag] of [[1440, 900, false, 'dark', 'd1440'], [390, 844, true, 'dark', 'd390'], [1440, 900, false, 'day', 'l1440'], [390, 844, true, 'day', 'l390']]) {
    const { ctx, p, logs, reqs } = await open(b, w, h, mobile, theme);
    const t = tag + ': ';
    await p.evaluate(() => document.querySelector('#byo-btn').click());
    await p.waitForSelector('.byo-row', { timeout: 5000 });
    const rows = await p.$$eval('.byo-row', (r) => r.map((x) => x.dataset.src));
    check(rows.length >= 6 && rows.includes('alpaca') && rows.includes('oanda'), t + 'sheet lists sources', rows);
    await p.screenshot({ path: `${OUT}/byo-sheet-${tag}.png` });
    if (tag === 'd1440') {
      await p.click('.byo-chip[data-f="forex"]');
      const fx = await p.$$eval('.byo-row', (r) => r.map((x) => x.dataset.src));
      check(fx.includes('oanda') && !fx.includes('alpaca'), t + 'Forex chip filters', fx);
      await p.click('.byo-chip[data-f="all"]');
      const dead = await p.$$eval('.byo-row', (r) => r.filter((x) => { const bt = x.querySelector('button'); return !bt || (bt.disabled && !/soon/i.test(x.textContent)); }).length);
      check(dead === 0, t + 'no dead buttons');
      await p.click('.byo-row[data-src="alpaca"] button');
      await p.waitForSelector('.byo-in');
      await p.screenshot({ path: `${OUT}/byo-form-${tag}.png` });
      await p.click('.byo-go');
      check((await p.$$eval('.byo-in[aria-invalid="true"]', (e) => e.length)) >= 1, t + 'empty form is rejected');
      check(!reqs.some((u) => /alpaca/.test(u)), t + 'no broker request for an empty form');
      const ins = await p.$$('.byo-in');
      await ins[0].fill('PKFAKEKEY123'); await ins[1].fill('FAKESECRETVALUE456');
      await p.screenshot({ path: `${OUT}/byo-form-filled-${tag}.png` });
      check(!logs.join('\n').includes('FAKESECRETVALUE456'), t + 'secret not in console');
    }
    check(!logs.some((l) => /PAGEERR/.test(l)), t + 'no page errors', logs.filter((l) => /PAGEERR/.test(l)));
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
