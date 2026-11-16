// Days menu on a daily chart (long list): measure rows + shoot, dark/light, 1440/390.
const { launch } = require('./lib.js'); const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8041', OUT = process.argv[2] || '/tmp';
(async () => {
  const b = await launch();
  for (const [w, h, mob, sch] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [390, 844, true, 'dark'], [390, 844, true, 'light']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, colorScheme: sch });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((s) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (s === 'light') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, sch);
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_VELA && window.__stkHistoryPager, null, { timeout: 60000 });
    await p.evaluate(() => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id); if (c.symbol !== 'futures:NQ1!') c.setSymbol('futures:NQ1!'); c.setTimeframe('D'); });
    await p.waitForTimeout(6000);
    const shown = await p.evaluate(() => document.getElementById('stkc-settings-btn').getBoundingClientRect().width > 0);
    if (!shown) await p.click('#stkc-more-btn');
    await p.click('#stkc-settings-btn');
    await p.waitForSelector('.vela-dialog--settings .stk-sd-extra', { timeout: 8000, state: 'attached' }); await p.waitForTimeout(400);
    if (await p.$('.vela-dialog--settings .vela-sd-burger') && !(await p.isVisible('.vela-dialog--settings .vela-sd-tab'))) { await p.click('.vela-dialog--settings .vela-sd-burger'); await p.waitForTimeout(300); }
    await p.evaluate(() => [...document.querySelectorAll('.vela-dialog--settings .vela-sd-tab')].find((x) => x.textContent === 'Symbol').click()); await p.waitForTimeout(400);
    await p.evaluate(() => { const l = [...document.querySelectorAll('.vela-dialog--settings .vela-field-label')].find((x) => /Days of history/.test(x.textContent)); const t = l.closest('.vela-field-row').querySelector('.vela-select-trigger'); t.scrollIntoView({ block: 'center' }); t.click(); });
    await p.waitForTimeout(500);
    const m = await p.evaluate(() => { const it = [...document.querySelectorAll('.vela-select-item')].filter((x) => /^(Auto|\d+ days?|Max \()/.test(x.textContent) && x.getBoundingClientRect().width > 0); const r = it.map((x) => x.getBoundingClientRect()); const t = [...document.querySelectorAll('.vela-select-trigger')].find((x) => /Auto|days/.test(x.textContent) && x.getBoundingClientRect().width > 0); return { n: it.length, labels: it.map((x) => x.textContent).slice(-4), h: [...new Set(r.map((q) => Math.round(q.height)))], left: [...new Set(r.map((q) => Math.round(q.left)))], textPadL: it[0] && getComputedStyle(it[0]).paddingLeft, textPadR: it[0] && getComputedStyle(it[0]).paddingRight, cy: it.slice(0, 5).map((x) => { const q = x.getBoundingClientRect(), c = x.firstElementChild ? x.firstElementChild.getBoundingClientRect() : q; return Math.round(((q.top + q.height / 2) - (c.top + c.height / 2)) * 10) / 10; }) }; });
    console.log(w + '-' + sch, JSON.stringify(m));
    await p.screenshot({ path: `${OUT}/longhist-menu-${w}-${sch}.png` });
    await ctx.close();
  }
  await b.close();
})();
