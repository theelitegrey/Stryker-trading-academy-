// Screenshots of the Indicators picker ("Add to chart" window, assets/chart-indicator-window.js) for the
// design check: 1440 dark, 1440 light, 412 and 390 (list + detail sheet).
//   node tools/tests/chart-dev-server.mjs 8066
//   CHART_BASE=http://127.0.0.1:8066 tools/chrome-slot.sh node tools/tests/chart-indpicker-shots.js <outDir> [prefix]
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8066';
const OUT = process.argv[2] || '/tmp/indpicker-shots';
const PRE = process.argv[3] || 'after';
fs.mkdirSync(OUT, { recursive: true });

async function shot(b, w, h, theme, extra) {
  const mob = w < 500;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
  p.on('console', (m) => { if (m.type() === 'error' && /indicator|stkiw/i.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.StrykerIndicatorWindow, null, { timeout: 90000 });
  await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await p.waitForTimeout(2500);
  const errs = await p.evaluate(() => (window.__iwErr || []).slice(0, 5)); if (errs.length) console.log('page errors', errs);
  const tag = PRE + '-' + w + '-' + theme;
  await p.screenshot({ path: OUT + '/' + tag + '.png' });
  if (extra) await extra(p, tag);
  await ctx.close();
}

(async () => {
  const b = await launch();
  try {
    await shot(b, 1440, 900, 'dark', async (p, tag) => {
      const s = await p.$('.stkiw-search');
      if (s) { await s.fill('gamma'); await p.waitForTimeout(800); await p.screenshot({ path: OUT + '/' + tag + '-search.png' }); }
    });
    await shot(b, 1440, 900, 'light', async (p, tag) => {
      await p.click('.stkiw-tab[data-k="community"]'); await p.waitForTimeout(600); await p.screenshot({ path: OUT + '/' + tag + '-community.png' });
    });
    await shot(b, 412, 915, 'dark');
    await shot(b, 390, 844, 'dark', async (p, tag) => {
      await p.click('.stkiw-row .stkiw-name'); await p.waitForTimeout(700);
      await p.screenshot({ path: OUT + '/' + tag + '-sheet.png' });
    });
    await shot(b, 390, 844, 'light');
  } finally { await b.close(); }
  console.log('shots in ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
