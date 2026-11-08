// Browser test: ready-made chart templates (assets/chart-tpl-gallery.js). Recorded NQ candles, no network.
//   node tools/tests/chart-fixture-server.mjs 8261 any.json   (any.json = {})
//   CHART_BASE=http://127.0.0.1:8261 flock -w 3600 /tmp/stryker-chrome.lock node tools/tests/chart-tpl-browser.js <outDir> [thumbs]
// With "thumbs" it also writes assets/images/chart-templates/<id>.webp (chart area, real render of the fixture bars).
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const { newCtx, openPage, sleep } = require('./phone-layouts-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8261';
const OUT = process.argv[2] || '/tmp';
const THUMBS = process.argv[3] === 'thumbs';
const ONLY_GALLERY = process.argv[3] === 'gallery';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

async function session(b, { w, h, mobile, theme, free }) {
  const ctx = await newCtx(b, { w, h, mobile });
  await ctx.addInitScript(([th, free]) => {
    try { localStorage.setItem('stryker_theme', th === 'light' ? 'day' : 'night'); } catch (e) {}
    if (th === 'light') document.documentElement.setAttribute('data-theme', 'light');
    if (free) window.__stkChartTestFree = true;
  }, [theme || 'dark', !!free]);
  return ctx;
}
const openTpl = async (p) => {
  for (let k = 0; k < 4; k++) {
    await p.evaluate(() => { const b = document.getElementById('stkc-tpl-btn'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); });
    await sleep(600);
    if (await p.isVisible('.stkt-browse')) return;
    await p.evaluate(() => { const b = document.getElementById('stkc-tpl-btn'); if (b.getAttribute('aria-expanded') === 'true') b.click(); });   // stale state: close and retry
    await sleep(300);
  }
  throw new Error('Templates menu did not open');
};
const types = (p) => p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.indicators().map((h) => h.nativeType));
const cellInfo = (p) => p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.context().cells[0]; return { sym: c.symbol, tf: c.timeframe }; });

(async () => {
  const { TEMPLATES } = await import(path.resolve(__dirname, '../../assets/chart-tpl-gallery.js?x=1').replace(/\?.*/, '')).catch(() => ({}));
  const b = await launch();
  try {
    // ---- 1440 dark, Pro/unknown plan: gallery + apply every template
    const A = await session(b, { w: 1440, h: 900 });
    const { p, errors } = await openPage(A, BASE, true);
    await openTpl(p);
    t('Templates menu has the Browse row', (await p.$$('.stkt-browse')).length >= 1, (await p.$$('.stkt-browse')).length);
    await p.click('.stkt-browse'); await sleep(800);
    const cards = await p.$$eval('.stkt-card', (a) => a.map((x) => x.dataset.tpl));
    t('gallery lists 14 templates', cards.length === 14, cards.length);
    await p.screenshot({ path: OUT + '/gallery-1440-dark.png' });
    const expect = await p.evaluate(() => null);
    await p.keyboard.press('Escape'); await sleep(300);
    const want0 = await p.evaluate(async () => { const m = await import('/assets/chart-tpl-gallery.js?v=913'); const o = {}; m.TEMPLATES.forEach((x) => { o[x.id] = { sym: x.symbol || null }; }); return o; });
    for (const id of (ONLY_GALLERY ? [] : cards)) {
      await p.evaluate(async () => { const m = await import('/assets/chart-tpl-gallery.js?v=913'); m.openGallery({ ws: window.STRYKER_VELA, Pine: { clearAllPine() {} }, toast() {} }); });
      await sleep(400);
      if (THUMBS && !want0[id].sym) await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol('futures:NQ1!'); }).then(() => sleep(2500));
      await p.click('.stkt-card[data-tpl="' + id + '"] .stkc-sbtn'); await sleep(id === 'swing-stocks' ? 3500 : 2500);
      const ty = await types(p), ci = await cellInfo(p);
      const want = await p.evaluate(async (id) => { const m = await import('/assets/chart-tpl-gallery.js?v=913'); const T = m.TEMPLATES.find((x) => x.id === id); return { ind: T.ind.map((x) => x[0]), tf: T.tf, sym: T.symbol || null }; }, id);
      t(id + ': indicators applied', JSON.stringify(ty.slice().sort()) === JSON.stringify(want.ind.slice().sort()), { got: ty, want: want.ind });
      t(id + ': timeframe/symbol', String(ci.tf) === want.tf && (!want.sym || ci.sym === want.sym), { ci, want });
      if (THUMBS) {
        await p.evaluate(() => { document.querySelectorAll('.stk-toast,.stk-toasts').forEach((x) => x.remove()); });
        await sleep(300);
        const box = await p.evaluate(() => { const r = document.querySelector('.stkc-grid, #stkc-stage, .vela-root, .stkc-wrap'); const el = document.querySelector('.vela-cell, canvas'); const q = (document.querySelector('.stkc-layout') || el).getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; });
        fs.mkdirSync(path.join(__dirname, '../../assets/images/chart-templates'), { recursive: true });
        await p.screenshot({ path: path.join(OUT, id + '.png'), clip: { x: box.x, y: box.y, width: Math.min(box.w, 1000), height: Math.min(box.h, 625) } });
      }
    }
    t('no page errors', errors.length === 0, errors);
    await A.close();

    // ---- Free member: Pro tools skipped + upgrade prompt
    const F = await session(b, { w: 390, h: 844, mobile: true, free: true });
    const fp = await openPage(F, BASE, true);
    await fp.p.evaluate(() => { window.__upg = 0; window.openPlanUpgradeModal = () => { window.__upg++; }; });
    await fp.p.evaluate(async () => { const m = await import('/assets/chart-tpl-gallery.js?v=913'); const T = m.TEMPLATES.find((x) => x.id === 'scalp-nq'); const C = window.STRYKER_VELA; m.applyTemplate(T, { ws: C, Pine: { clearAllPine() {} }, toast() {} }); });
    await sleep(1500);
    t('Free: order-flow tools not added, upgrade prompt shown', (await types(fp.p)).length === 0 && (await fp.p.evaluate(() => window.__upg)) >= 1, await types(fp.p));
    await fp.p.evaluate(async () => { const m = await import('/assets/chart-tpl-gallery.js?v=913'); m.openGallery({ ws: window.STRYKER_VELA, Pine: { clearAllPine() {} }, toast() {} }); }); await sleep(800);
    await fp.p.screenshot({ path: OUT + '/gallery-390-dark.png' });
    t('390: no horizontal scroll', (await fp.p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    await F.close();

    // ---- 1440 light
    const L = await session(b, { w: 1440, h: 900, theme: 'light' });
    const lp = await openPage(L, BASE, true);
    await lp.p.evaluate(async () => { const m = await import('/assets/chart-tpl-gallery.js?v=913'); m.openGallery({ ws: window.STRYKER_VELA, Pine: { clearAllPine() {} }, toast() {} }); }); await sleep(800);
    await lp.p.screenshot({ path: OUT + '/gallery-1440-light.png' });
    await L.close();
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
