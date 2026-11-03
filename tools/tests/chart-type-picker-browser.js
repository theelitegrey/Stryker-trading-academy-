// Picker sheet: opens from the style button, 3 columns on phone, pick, long-press favourite, Pro lock for Free.
//   CHART_BASE=http://127.0.0.1:8033 node tools/tests/chart-type-picker-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8033', OUT = process.argv[2] || '/tmp/ct';
let fail = 0; const check = (ok, m, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + m + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 200))); };
(async () => {
  const b = await launch();
  for (const z of [{ w: 390, h: 800, mobile: true, tag: '390' }, { w: 1440, h: 900, tag: '1440' }]) for (const theme of ['dark', 'day']) {
    if (theme === 'day' && z.mobile) continue;
    const ctx = await b.newContext({ viewport: { width: z.w, height: z.h }, deviceScaleFactor: z.mobile ? 2 : 1, isMobile: !!z.mobile, hasTouch: !!z.mobile });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_cookie_ok', '1'); localStorage.removeItem('stryker_ctype_favs'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|WebSocket|Failed to load resource|blocked by CORS/.test(m.text())) errs.push(m.text()); });
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STK_CT_OPEN, null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(3500);
    const tag = theme + '-' + z.tag;
    const openIt = async () => { if (z.mobile) { const more = await p.$('.stkc-ob-more-btn'); const vis = more && await more.isVisible(); if (vis) { await more.tap(); await p.waitForTimeout(400); } const st = p.locator('.vela-widget-style').first(); if (await st.isVisible()) await st.tap(); else await p.evaluate(() => window.STK_CT_OPEN()); } else await p.click('.vela-widget-style'); await p.waitForTimeout(500); };
    await openIt();
    const info = await p.evaluate(() => { const g = document.querySelector('.stk-ct-g'); if (!g) return null; const cs = getComputedStyle(g).gridTemplateColumns.split(' ').length; const items = [...g.querySelectorAll('.stk-ct-b')].map((x) => x.dataset.type); const r = document.querySelector('.stk-ct').getBoundingClientRect(); return { cols: cs, n: items.length, items, w: Math.round(r.width), h: Math.round(r.height), ovf: document.documentElement.scrollWidth > innerWidth }; });
    check(info && info.n === 21 && info.cols === (z.mobile ? 3 : 4) && !info.ovf, tag + ' sheet opens: 21 types, ' + (z.mobile ? 3 : 4) + ' columns', info && { cols: info.cols, n: info.n, w: info.w, h: info.h });
    await p.screenshot({ path: `${OUT}/picker-${tag}.png` });
    // long press on Renko -> favourite, sheet stays open
    const btn = await p.$('.stk-ct-b[data-type="stk_renko"]'); await btn.scrollIntoViewIfNeeded(); const bb = await btn.boundingBox();
    await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up(); await p.waitForTimeout(200);
    const fav = await p.evaluate(() => ({ ls: localStorage.getItem('stryker_ctype_favs'), open: !!document.querySelector('.stk-ct-ov'), bar: [...document.querySelectorAll('#stk-ct-favs button')].map((x) => x.dataset.type) }));
    check(fav.open && /stk_renko/.test(fav.ls || '') && (z.mobile || fav.bar.includes('stk_renko')), tag + ' long-press adds Renko to favourites + top bar', fav);
    // pick Kagi
    await p.click('.stk-ct-b[data-type="stk_kagi"]'); await p.waitForTimeout(1200);
    const st = await p.evaluate(() => ({ s: window.STRYKER_VELA.active.priceStyle, open: !!document.querySelector('.stk-ct-ov') }));
    check(st.s === 'stk_kagi' && !st.open, tag + ' tap picks Kagi and closes', st);
    // top-bar favourite switches
    if (!z.mobile) { await p.evaluate(() => document.querySelector('#stk-ct-favs button[data-type="stk_renko"]').click()); await p.waitForTimeout(1000);
    check(await p.evaluate(() => window.STRYKER_VELA.active.priceStyle) === 'stk_renko', tag + ' favourite button switches to Renko'); }
    await p.screenshot({ path: `${OUT}/favbar-${tag}.png` });
    // Free member: Pro types lock
    await p.evaluate(() => { window.__stkChartTestFree = true; });
    await openIt();
    await p.click('.stk-ct-b[data-type="stk_tpoc"]'); await p.waitForTimeout(500);
    const pro = await p.evaluate(() => ({ s: window.STRYKER_VELA.active.priceStyle, sheet: !!document.querySelector('.stk-ct-ov') }));
    check(pro.s !== 'stk_tpoc' && pro.sheet, tag + ' Free member: TPO stays locked', pro);
    check(errs.length === 0, tag + ' no console errors', errs.slice(0, 3));
    await ctx.close();
  }
  await b.close(); console.log(fail ? fail + ' FAILED' : 'all ok'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
