// Charts watchlist browser suite (guest / localStorage path). Local dev server:
//   node tools/tests/chart-dev-server.mjs 8043 &  node tools/tests/chart-watchlist-browser.js http://127.0.0.1:8043 <outdir>
const { launch } = require('./lib.js');
const BASE = process.argv[2] || 'http://127.0.0.1:8043';
const OUT = (process.argv[3] || '/tmp') + '/';
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 300)); };
const rows = (p) => p.$$eval('.stkw-row', (a) => a.map((r) => r.dataset.sym));
const secs = (p) => p.$$eval('.stkw-sec', (a) => a.map((r) => r.textContent.trim()));

async function page(b, w, h, theme, mobile) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript((th) => { try { localStorage.setItem('stryker_install_prompt_dismissed', '1'); if (th === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => { p.errs.push(e.message); console.log('pageerror', e.message.slice(0, 160)); });
  p.on('dialog', (d) => d.accept());
  await p.goto(BASE + '/charts.html', { waitUntil: 'load' });
  await p.waitForFunction(() => window.STRYKER_WATCHLIST && window.STRYKER_VELA, null, { timeout: 40000 });
  await p.waitForTimeout(2500);
  return { ctx, p };
}
const waitPrices = (p) => p.waitForFunction(() => [...document.querySelectorAll('.stkw-row .stkw-last')].filter((x) => /\d/.test(x.textContent)).length >= 8, null, { timeout: 30000 }).then(() => true).catch(() => false);

(async () => {
  const b = await launch();
  try {
    // ---------- 1440 dark
    const { ctx, p } = await page(b, 1440, 900, 'dark');
    await p.click('.stkw-railbtn');
    t('prices for all 8 default rows', await waitPrices(p));
    t('default rows', JSON.stringify(await rows(p)) === JSON.stringify(['futures:NQ1!', 'futures:ES1!', 'futures:YM1!', 'futures:RTY1!', 'futures:GC1!', 'futures:CL1!', 'binance:BTCUSDT', 'binance:ETHUSDT']), await rows(p));
    t('sections', JSON.stringify(await secs(p)) === '["FUTURES","CRYPTO"]', await secs(p));
    const geo = await p.evaluate(() => ({ chart: document.getElementById('vela-chart').getBoundingClientRect().right, panel: document.querySelector('.stkw').getBoundingClientRect(), dirs: [...document.querySelectorAll('.stkw-chgp')].map((x) => [x.dataset.dir, getComputedStyle(x).color]) }));
    t('panel 340 wide, chart ends at its edge (no overlap)', Math.round(geo.panel.width) === 340 && Math.abs(geo.chart - geo.panel.left) < 1, geo);
    t('chg colours', geo.dirs.every(([d, c]) => !d || (d === 'up' && c === 'rgb(8, 153, 129)') || (d === 'dn' && c === 'rgb(242, 54, 69)')), geo.dirs);
    const dots = await p.$$eval('.stkw-dd', (a) => a.map((x) => x.dataset.s));
    t('data dots present', dots.length === 8 && dots.every(Boolean), dots);
    const txt = await p.textContent('.stkw');
    t('no vendor names, no trade words', !/vela|luxalgo/i.test(txt) && !/\b(buy|sell|order|trade)\b/i.test(txt), txt.slice(0, 80));
    await p.screenshot({ path: OUT + 'wl-1440-dark.png' });
    // click loads into active cell
    await p.click('.stkw-row[data-sym="futures:GC1!"]');
    await p.waitForTimeout(800);
    t('click loads symbol', await p.evaluate(() => window.STRYKER_VELA.active.symbol) === 'futures:GC1!');
    t('active row outlined', await p.$eval('.stkw-row[data-sym="futures:GC1!"]', (r) => r.classList.contains('act') && getComputedStyle(r).borderTopColor !== 'rgba(0, 0, 0, 0)'));
    // 2x2: last-clicked cell
    await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('4'));
    await p.waitForTimeout(2500);
    const cells = await p.evaluate(() => window.STRYKER_VELA.context().cells.map((c) => c.id));
    await p.evaluate((id) => window.STRYKER_VELA.setActiveCell(id), cells[3]);
    await p.waitForTimeout(300);
    await p.click('.stkw-row[data-sym="binance:ETHUSDT"]');
    await p.waitForTimeout(1200);
    const after = await p.evaluate(() => window.STRYKER_VELA.context().cells.map((c) => c.symbol));
    t('2x2: only the active (4th) cell changes', after[3] === 'binance:ETHUSDT' && after.slice(0, 3).every((s) => s !== 'binance:ETHUSDT'), after);
    await p.screenshot({ path: OUT + 'wl-1440-2x2.png' });
    await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('1'));
    await p.waitForTimeout(1500);
    // add via "+" search
    await p.click('.stkw-row[data-sym="futures:CL1!"]');
    await p.click('.stkw-hd button[aria-label="Add symbol"]');
    const inp = p.locator('.vela-sp-input:visible').first();
    await inp.waitFor({ timeout: 8000 });
    await inp.fill('SI1!');
    await p.waitForTimeout(800);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(800);
    let r = await rows(p);
    t('+ adds SI1! after the selected row (CL1!)', r[r.indexOf('futures:CL1!') + 1] === 'futures:SI1!', r);
    // add section + drag reorder
    await p.evaluate(() => window.STRYKER_WATCHLIST.addSection('metals', 5));
    await p.waitForTimeout(200);
    t('section added', (await secs(p)).includes('METALS'), await secs(p));
    const src = await p.$('.stkw-row[data-sym="futures:SI1!"]'), dst = await p.$('.stkw-sec:nth-of-type(1)');
    await p.dragAndDrop('.stkw-row[data-sym="futures:SI1!"]', '.stkw-row[data-sym="futures:GC1!"]', { targetPosition: { x: 20, y: 30 } });
    await p.waitForTimeout(400);
    r = await p.evaluate(() => window.STRYKER_WATCHLIST.current.items);
    t('drag moves SI1! under GC1! (into METALS)', r.indexOf('futures:SI1!') === r.indexOf('futures:GC1!') + 1 && r.indexOf('###METALS') < r.indexOf('futures:GC1!'), r);
    void src; void dst;
    // collapse section
    await p.click('.stkw-sec:has-text("CRYPTO")');
    await p.waitForTimeout(200);
    t('collapse hides crypto rows', !(await rows(p)).includes('binance:BTCUSDT'));
    await p.click('.stkw-sec:has-text("CRYPTO")');
    // delete key
    await p.click('.stkw-row[data-sym="futures:YM1!"]');
    await p.keyboard.press('Delete');
    await p.waitForTimeout(300);
    t('Delete key removes the row', !(await rows(p)).includes('futures:YM1!'));
    // right-click menu
    await p.click('.stkw-row[data-sym="futures:RTY1!"]', { button: 'right' });
    await p.waitForTimeout(200);
    const ctxItems = await p.$$eval('.stkw-ctx:not([hidden]) .stkw-mil', (a) => a.map((x) => x.textContent));
    t('row context menu', JSON.stringify(ctxItems) === JSON.stringify(['Add alert on RTY1!…', 'Add section above', 'Remove from list']), ctxItems);
    await p.screenshot({ path: OUT + 'wl-1440-ctx.png' });
    await p.click('.stkw-ctx .stkw-mi:has-text("Add alert on")');
    await p.waitForTimeout(500);
    const al = await p.evaluate(() => { const f = document.querySelector('#stk-al .stk-al-form'); return f && !document.getElementById('stk-al').hidden ? { sym: f.symbol.value, price: f.price.value } : null; });
    t('Add alert opens the alerts dialog prefilled', al && al.sym === 'futures:RTY1!' && +al.price > 0, al);
    await p.keyboard.press('Escape');
    // columns menu
    await p.click('.stkw-hd button[aria-label="Columns and display"]');
    await p.waitForTimeout(200);
    const colItems = await p.$$eval('.stkw-menu:not([hidden]) label', (a) => a.map((x) => x.textContent.trim()));
    t('columns menu items', JSON.stringify(colItems) === JSON.stringify(['Table view', 'Last', 'Change', 'Change %', 'Volume', 'Extended Hours', 'Logo', 'Symbol', 'Name']), colItems);
    await p.click('.stkw-menu:not([hidden]) label:has-text("Volume")');
    await p.click('.stkw-menu:not([hidden]) label:has-text("Extended Hours")');
    await p.click('.stkw-menu:not([hidden]) label >> text=/^\s*Name\s*$/');
    await p.waitForTimeout(3500);
    await p.screenshot({ path: OUT + 'wl-1440-columns.png' });
    const hdr = await p.$$eval('.stkw-th span', (a) => a.map((x) => x.textContent));
    t('Volume + Ext columns shown', hdr.includes('Vol') && hdr.includes('Ext'), hdr);
    t('Name display', /Nasdaq|Bitcoin|BTC/.test(await p.textContent('.stkw-body')));
    await p.keyboard.press('Escape');
    // list menu
    await p.click('.stkw-title');
    await p.waitForTimeout(200);
    const lm = await p.$$eval('.stkw-menu:not([hidden]) .stkw-mil, .stkw-menu:not([hidden]) .stkw-swrow span', (a) => a.map((x) => x.textContent));
    t('list menu items', ['Share list', 'Add alert on the list…', 'Make a copy…', 'Rename', 'Add section', 'Clear list', 'Create new list…', 'Upload list…', 'Open list…'].every((x) => lm.includes(x)), lm);
    await p.screenshot({ path: OUT + 'wl-1440-listmenu.png' });
    await p.keyboard.press('Escape');
    // persistence
    const before = await p.evaluate(() => JSON.stringify(window.STRYKER_WATCHLIST.current.items));
    await p.waitForTimeout(1200);
    await p.reload({ waitUntil: 'load' });
    await p.waitForFunction(() => window.STRYKER_WATCHLIST && window.STRYKER_WATCHLIST.current, null, { timeout: 40000 });
    await p.waitForTimeout(1500);
    const st = await p.evaluate(() => ({ items: JSON.stringify(window.STRYKER_WATCHLIST.current.items), open: window.STRYKER_WATCHLIST.open, view: window.STRYKER_WATCHLIST.current.view }));
    t('reload keeps items, open state, columns', st.items === before && st.open && st.view.vol && st.view.disp === 'name', st);
    t('no page errors (1440)', p.errs.length === 0, p.errs);
    await ctx.close();

    // ---------- 1440 day
    const D = await page(b, 1440, 900, 'day');
    if (!(await D.p.evaluate(() => window.STRYKER_WATCHLIST.open))) await D.p.click('.stkw-railbtn');
    await waitPrices(D.p);
    await D.p.screenshot({ path: OUT + 'wl-1440-day.png' });
    t('day theme panel light', await D.p.$eval('.stkw', (e) => getComputedStyle(e).backgroundColor) !== 'rgb(0, 0, 0)');
    await D.ctx.close();

    // ---------- 390 phone
    const M = await page(b, 390, 844, 'dark', true);
    t('phone: rail hidden, Watchlist button shown', await M.p.evaluate(() => getComputedStyle(document.querySelector('.stkw-rail')).display === 'none' && getComputedStyle(document.querySelector('.stkw-phonebtn')).display !== 'none'));
    await M.p.click('.stkw-phonebtn');
    await waitPrices(M.p);
    const sheet = await M.p.$eval('.stkw', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, l: r.left, pos: getComputedStyle(e).position }; });
    t('phone: full-screen sheet', sheet.w === 390 && sheet.l === 0 && sheet.pos === 'fixed', sheet);
    t('phone: no horizontal overflow', await M.p.evaluate(() => document.documentElement.scrollWidth <= 390));
    await M.p.screenshot({ path: OUT + 'wl-390-dark.png' });
    await M.p.tap('.stkw-row[data-sym="futures:ES1!"]');
    await M.p.waitForTimeout(800);
    t('phone: tap loads + closes sheet', await M.p.evaluate(() => window.STRYKER_VELA.active.symbol === 'futures:ES1!' && !window.STRYKER_WATCHLIST.open));
    await M.p.screenshot({ path: OUT + 'wl-390-after-tap.png' });
    t('no page errors (390)', M.p.errs.length === 0, M.p.errs);
    await M.ctx.close();
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
