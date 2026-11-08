// Browser test + shots: Free vs Pro table (pricing.html), "In plain English" block (indicators/*.html),
// and the explainer "i" button in the ZoroCharts Indicators window.
//   CHART_BASE=http://127.0.0.1:8261 flock -w 3600 /tmp/stryker-chrome.lock node tools/tests/chart-tpl-pages-browser.js <outDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const { newCtx, openPage, sleep } = require('./phone-layouts-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8261';
const OUT = process.argv[2] || '/tmp'; fs.mkdirSync(OUT, { recursive: true });
let fail = 0; const t = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 200))); };
(async () => {
  const b = await launch();
  try {
    for (const [tag, w, h, theme, mobile] of [['390-dark', 390, 844, 'dark', true], ['1440-dark', 1440, 900, 'dark'], ['1440-light', 1440, 900, 'light']]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: !!mobile, hasTouch: !!mobile });
      await ctx.addInitScript((th) => { try { localStorage.setItem('stryker_theme', th === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      const p = await ctx.newPage();
      await p.goto(BASE + '/pricing.html', { waitUntil: 'domcontentloaded' }); await sleep(2500);
      const pf = await p.$('.pf'); t(tag + ' pricing: Free vs Pro table present', !!pf);
      const txt = await p.$eval('.pf', (e) => e.innerText);
      t(tag + ' pricing: no price in the table', !/[$₹€£]\s?\d|\d\s?\/\s?(mo|month|year)/i.test(txt));
      t(tag + ' pricing: no horizontal scroll', (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
      await pf.scrollIntoViewIfNeeded(); await sleep(400);
      await p.screenshot({ path: OUT + '/pricing-' + tag + '.png' });
      await p.goto(BASE + '/indicators/gex-levels.html', { waitUntil: 'domcontentloaded' }); await sleep(1200);
      const pl = await p.$('.ixp-plain'); t(tag + ' indicator page: plain-English block', !!pl);
      if (pl) { await pl.scrollIntoViewIfNeeded(); await sleep(300); await p.screenshot({ path: OUT + '/indicator-' + tag + '.png' }); }
      await ctx.close();
    }
    // in-chart explainer button
    const ctx = await newCtx(b, { w: 1440, h: 900 });
    const { p, errors } = await openPage(ctx, BASE, true);
    await p.evaluate(() => window.STRYKER_VELA && document.querySelector('[aria-label*="ndicators"], #stkc-ind-btn, [title*="ndicators"]').click());
    await p.waitForSelector('.stkiw-row', { timeout: 15000 }); await sleep(1500);
    const n = await p.$$eval('.stkiw-explain:not([hidden])', (a) => a.length);
    t('indicators window: explainer buttons shown', n >= 10, n);
    const btn = await p.$('.stkiw-row[data-key="b:stk_gex"] .stkiw-explain');
    if (btn) { await btn.click({ force: true }); await sleep(400); t('explainer opens', !!(await p.$('.stkiw-ex'))); await p.screenshot({ path: OUT + '/chart-explainer-1440-dark.png' }); }
    else t('GEX row has explainer button', false);
    t('no page errors', errors.length === 0, errors);
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
