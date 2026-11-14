// Browser test: paper hotkeys. node tools/tests/chart-dev-server.mjs 8057 &  node tools/tests/paper-hotkeys-browser.js http://127.0.0.1:8057 <outdir>
const { launch } = require('./lib.js');
// Runner contract: CHART_BASE=http://127.0.0.1:PORT node paper-hotkeys-browser.js <shotsDir>  (also accepts <url> <dir>)
const args = process.argv.slice(2), urlArg = args.find((a) => /^https?:/.test(a)), dirArg = args.find((a) => !/^https?:/.test(a));
const BASE = process.env.CHART_BASE || urlArg || 'http://127.0.0.1:8057', OUT = (dirArg || '/tmp') + '/';
require('fs').mkdirSync(OUT, { recursive: true });
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok || x === undefined ? '' : JSON.stringify(x).slice(0, 300)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(b, vp, mobile, theme) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((th) => { try { localStorage.setItem('stryker_install_prompt_dismissed', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); localStorage.setItem('stryker_theme', th); } catch (e) {} }, theme);
  const p = await ctx.newPage(); const errs = [];

  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.goto(BASE + '/charts.html', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.__stkPaper && window.__stkPaper.account, null, { timeout: 60000 });
  await p.evaluate((th) => { document.documentElement.dataset.theme = th; window.STRYKER_CHART_UI.applySaved({ state: { version: 1, layout: '1', charts: [{ id: 'a', symbol: 'CME_MINI:NQ1!', timeframe: '1' }] } }); }, theme);
  await p.waitForFunction(() => window.STRYKER_VELA.active && window.STRYKER_VELA.active.symbol === 'CME_MINI:NQ1!', null, { timeout: 20000 });
  await p.evaluate(() => { window.StrykerMarketHours.futuresStatus = () => ({ open: true }); /* test must pass on weekends too */ window.__stkPaper.setEnabled(true); window.__stkPaper.account.setLast('CME_MINI:NQ1!', 21000); });
  return { ctx, p, errs };
}
async function openTab(p, phone) {
  if (!(await p.isVisible('#stkc-settings-btn'))) { await (phone ? p.tap('#stkc-more-btn') : p.click('#stkc-more-btn')); await sleep(600); }
  await (phone ? p.tap('#stkc-settings-btn') : p.click('#stkc-settings-btn'));
  await p.waitForSelector('.vela-dialog--settings .vela-sd-rail', { state: 'attached', timeout: 10000 }); await sleep(300);
  if (phone && await p.isVisible('.vela-dialog--settings .vela-sd-burger')) { await p.click('.vela-dialog--settings .vela-sd-burger'); await sleep(300); }
  await p.locator('.vela-dialog--settings .vela-sd-tab', { hasText: /^\s*Paper trading\s*$/ }).first().click();
  await p.waitForSelector('.stkpt-hk', { timeout: 5000 }); await sleep(250);
}
const rec = async (p, id, combo) => { await p.click(`.stkpt-hk-r[data-id=${id}] .stkpt-hk-k`); await p.keyboard.press(combo); await sleep(80); };
const st = (p) => p.evaluate(() => { const a = window.__stkPaper.account; return { pos: JSON.parse(JSON.stringify(a.state.positions)), orders: a.state.orders.length, hk: a.settings.hotkeys, q: a.qtyFor('CME_MINI:NQ1!') }; });
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    // ---- functional, desktop dark
    let { ctx, p, errs } = await open(b, { width: 1440, height: 900 }, false, 'dark');
    let s = await st(p);
    t('defaults: no hotkeys, nothing changes on key press', Object.keys(s.hk).length === 0);
    await p.keyboard.press('b'); await sleep(200); s = await st(p);
    t('unassigned key does nothing', Object.keys(s.pos).length === 0);
    await openTab(p, false);
    t('hotkeys card lists every action', (await p.locator('.stkpt-hk-r').count()) >= 18);
    await p.screenshot({ path: OUT + 'hk-1440-dark-empty.png' });
    await rec(p, 'buyMarket', 'Shift+B'); await rec(p, 'sellMarket', 'Shift+S'); await rec(p, 'qty5', 'Alt+5');
    await rec(p, 'closeHalf', 'Shift+H'); // reserved by chart (bar replay hide)
    t('chart-reserved key refused with message', /already used by the chart/.test(await p.textContent('.stkpt-hk-msg')));
    await p.keyboard.press('Escape'); await sleep(100);
    await rec(p, 'closeHalf', 'Shift+K'); await rec(p, 'cancelAll', 'Shift+C'); await rec(p, 'closePos', 'Shift+X'); await p.keyboard.press('Escape'); await sleep(100);
    await rec(p, 'reversePos', 'Shift+B'); // conflict: moves from buyMarket
    t('conflict message names the old action', /moved here from .Buy at market./.test(await p.textContent('.stkpt-hk-msg')), await p.textContent('.stkpt-hk-msg'));
    await rec(p, 'buyMarket', 'Shift+Y');
    s = await st(p);
    t('keys saved in the paper account settings', s.hk.sellMarket === 'Shift+S' && s.hk.reversePos === 'Shift+B' && s.hk.buyMarket === 'Shift+Y' && s.hk.qty5 === 'Alt+5', s.hk);
    await rec(p, 'closePos', 'Shift+Z'); // (Shift+X above was refused: chart key)
    await p.screenshot({ path: OUT + 'hk-1440-dark-set.png' });
    await p.click('.vela-dialog--settings [aria-label="Close"], .vela-dialog--settings .vela-sd-close').catch(() => {}); await sleep(300);
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await p.keyboard.press('Shift+Y'); await sleep(400); s = await st(p);
    t('buy hotkey opens a long position', Object.values(s.pos).length === 1 && Object.values(s.pos)[0].side === 'buy', s.pos);
    await p.keyboard.press('Alt+5'); await sleep(200); s = await st(p); t('quantity hotkey sets 5', s.q === 5, s.q);
    await p.keyboard.press('Shift+Y'); await sleep(400); s = await st(p);
    t('second buy adds (qty 6)', Object.values(s.pos)[0].qty === 6, s.pos);
    await p.keyboard.press('Shift+K'); await sleep(400); s = await st(p);
    t('close-half leaves 3', Object.values(s.pos)[0] && Object.values(s.pos)[0].qty === 3, s.pos);
    await p.evaluate(() => window.__stkPaper.account.placeOrder({ symbol: 'CME_MINI:NQ1!', side: 'buy', type: 'limit', qty: 1, price: 20900 }));
    t('working order exists', (await st(p)).orders === 1);
    await p.keyboard.press('Shift+C'); await sleep(300); t('cancel-all hotkey clears orders', (await st(p)).orders === 0);
    // typing guard: key inside the ticket quantity box
    await p.evaluate(() => window.__stkPaper.openTicket()); await p.waitForSelector('#stkpt-tk:not([hidden])'); await p.focus('#stkpt-tk input[name=qty]');
    await p.keyboard.press('Shift+Z'); await sleep(200); s = await st(p); t('ignored while typing in a box', Object.values(s.pos)[0] && Object.values(s.pos)[0].qty === 3, s.pos);
    await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await p.keyboard.press('Shift+Z'); await sleep(400); s = await st(p); t('close hotkey flattens', Object.keys(s.pos).length === 0, s.pos);
    // persistence + reset
    await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.__stkPaper && window.__stkPaper.account && window.__stkPaper.enabled, null, { timeout: 60000 });
    s = await st(p); t('hotkeys survive a reload', s.hk.sellMarket === 'Shift+S', s.hk);
    await p.evaluate(() => window.__stkPaper.setEnabled(false)); await p.keyboard.press('Shift+S'); await sleep(200);
    t('hotkeys do nothing when paper trading is off', Object.keys((await st(p)).pos).length === 0); await p.evaluate(() => window.__stkPaper.setEnabled(true));
    await openTab(p, false); await p.click('.stkpt-hk-reset'); await sleep(200); s = await st(p);
    t('reset to defaults clears all', Object.keys(s.hk).length === 0, s.hk);
    t('desktop: no page errors', errs.length === 0, errs); await ctx.close();
    // ---- light
    ({ ctx, p, errs } = await open(b, { width: 1440, height: 900 }, false, 'light'));
    await openTab(p, false); await rec(p, 'buyMarket', 'Shift+B'); await rec(p, 'cancelAll', 'Shift+B');
    await p.screenshot({ path: OUT + 'hk-1440-light.png' }); await ctx.close();
    // ---- phone
    ({ ctx, p, errs } = await open(b, { width: 390, height: 844 }, true, 'dark'));
    await openTab(p, true); await p.screenshot({ path: OUT + 'hk-390-dark.png' });
    const ov = await p.evaluate(() => { const c = document.querySelector('.stkpt-hk'); return { sw: c.scrollWidth, cw: c.clientWidth }; });
    t('390: no horizontal overflow in the card', ov.sw <= ov.cw + 1, ov);
    await p.locator('.stkpt-hk-r[data-id=sellMarket]').scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + 'hk-390-dark-2.png' });
    t('390: no page errors', errs.length === 0, errs); await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
