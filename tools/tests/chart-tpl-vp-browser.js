// Browser test: the Volume profile (Monthly / Weekly / Daily) and GEX templates apply the right indicators, symbol, timeframe and inputs.
// Opens the gallery directly (not through the Templates menu). Same harness as chart-tpl-browser.js.
//   node tools/tests/chart-fixture-server.mjs 8261 any.json ; CHART_BASE=http://127.0.0.1:8261 flock /tmp/stryker-chrome.lock node tools/tests/chart-tpl-vp-browser.js <outDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const { newCtx, openPage, sleep } = require('./phone-layouts-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8261', OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
const IDS = ['vp-monthly', 'vp-weekly', 'vp-daily', 'gex-flow'];
(async () => {
  const b = await launch();
  try {
    for (const z of [{ w: 1440, h: 900, tag: '1440-dark', th: 'dark' }, { w: 1440, h: 900, tag: '1440-light', th: 'light' }, { w: 390, h: 844, tag: '390-dark', th: 'dark', mobile: true }]) {
      const ctx = await newCtx(b, { w: z.w, h: z.h, mobile: z.mobile });
      await ctx.addInitScript((th) => { try { localStorage.setItem('stryker_theme', th === 'light' ? 'day' : 'night'); } catch (e) {} if (th === 'light' && document.documentElement) document.documentElement.setAttribute('data-theme', 'light'); }, z.th);
      const { p, errors } = await openPage(ctx, BASE, true);
      await p.evaluate(() => { window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true }; });
      await p.evaluate(async () => { const m = await import('/assets/chart-tpl-gallery.js'); m.openGallery({ ws: window.STRYKER_VELA, Pine: { clearAllPine() {} }, toast() {} }); }); await sleep(800);
      const cards = await p.$$eval('.stkt-card', (a) => a.map((x) => x.dataset.tpl));
      t(z.tag + ': gallery lists the four new templates', IDS.every((i) => cards.includes(i)), cards);
      if (z.tag === '1440-dark') await p.screenshot({ path: OUT + '/tpl-gallery-1440-dark.png' });
      await p.keyboard.press('Escape'); await sleep(200);
      if (z.mobile) { await p.evaluate(async () => { const m = await import('/assets/chart-tpl-gallery.js'); m.openGallery({ ws: window.STRYKER_VELA, Pine: { clearAllPine() {} }, toast() {} }); }); await sleep(600); await p.evaluate(() => document.querySelector('.stkt-card[data-tpl="vp-daily"]').scrollIntoView()); await sleep(300); await p.screenshot({ path: OUT + '/tpl-gallery-390-dark.png' }); t('390: no horizontal scroll', (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0); await p.keyboard.press('Escape'); }
      for (const id of IDS) {
        await p.evaluate(async () => { const m = await import('/assets/chart-tpl-gallery.js'); m.openGallery({ ws: window.STRYKER_VELA, Pine: { clearAllPine() {} }, toast() {} }); }); await sleep(400);
        await p.click('.stkt-card[data-tpl="' + id + '"] .stkc-sbtn'); await sleep(4500);
        const got = await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0]; return { sym: c.symbol, tf: c.timeframe, ind: c.chart.indicators().map((h) => [h.nativeType, h.inputValues ? h.inputValues() : {}]) }; });
        const want = await p.evaluate(async (id) => { const m = await import('/assets/chart-tpl-gallery.js'); const T = m.TEMPLATES.find((x) => x.id === id); return { ind: T.ind.map((x) => x[0]), tf: T.tf, sym: T.symbol }; }, id);
        t(z.tag + ' ' + id + ': indicators', JSON.stringify(got.ind.map((x) => x[0]).sort()) === JSON.stringify(want.ind.slice().sort()), { got: got.ind.map((x) => x[0]), want: want.ind });
        t(z.tag + ' ' + id + ': symbol + timeframe', String(got.tf) === want.tf && got.sym === want.sym, got);
        if (id === 'vp-daily') { const s = got.ind.find((x) => x[0] === 'stk_svp'); t(z.tag + ' vp-daily: SVP delta bars on', s && s[1].showDelta === true, s); }
        if (id === 'vp-weekly') { const a = got.ind.find((x) => x[0] === 'stk_avwap'); const d = new Date(a && a[1].anchor); t(z.tag + ' vp-weekly: VWAP anchored to a Monday 00:00 UTC in the past', a && d.getUTCDay() === 1 && d.getUTCHours() === 0 && a[1].anchor <= Date.now(), a); }
        // (the monthly anchor is checked in chart-tpl-data.test.mjs: the engine only reports the anchor back while the loaded test bars reach it)
        await p.screenshot({ path: OUT + '/tpl-' + id + '-' + z.tag + '.png' });
      }
      t(z.tag + ': no page errors', errors.length === 0, errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
