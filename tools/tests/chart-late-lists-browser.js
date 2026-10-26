// Crypto symbol lists (assets/vela-chart.js lateLists): not fetched before the first candles, fetched
// after them at idle, and at once when the member taps before that; symbol search lists crypto rows.
// Fixture server (chart-speed-server.mjs); exchanges are unreachable here, so only the REQUEST
// timing is checked plus that the picker opens and lists the futures rows.
//   CHART_BASE=http://127.0.0.1:8261 node tools/tests/chart-late-lists-browser.js
const { launch } = require('./lib.js');
const { speedInit } = require('./chart-phone-speed-init.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8261';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE cdn.jsdelivr.net'] });
  for (const eng of ['0.9', '0.6']) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await speedInit(ctx);
    await ctx.addInitScript(() => {
      window.__lists = [];
      const of = window.fetch;
      window.fetch = function (u) { const s = String(u && u.url || u); if (/exchangeInfo|hyperliquid|coinbase\.com\/products/.test(s)) window.__lists.push([Math.round(performance.now()), s.slice(0, 60), !!window.__stkFirstCandles]); return of.apply(this, arguments); };
    });
    const p = await ctx.newPage();
    await p.goto(BASE + '/charts.html?vela=' + eng, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkFirstCandles, null, { timeout: 60000 });
    await sleep(6000);
    const r = await p.evaluate(() => ({ lists: window.__lists, fc: performance.getEntriesByName('stk:first-candles').map((m) => Math.round(m.startTime)) }));
    check(r.lists.length >= 3, eng + ': crypto lists requested after the first candles', r);
    check(r.lists.every((x) => x[2]), eng + ': none requested before the first candles', r.lists);
    // symbol search opens and lists futures rows
    const sb = await p.$('.vela-topbar [data-id="symbol"], .vela-symbol-btn, [aria-label*="ymbol" i]');
    if (sb) await sb.click(); else await p.evaluate(() => window.STRYKER_VELA.symbolPicker.open());
    await sleep(1200);
    const rows = await p.evaluate(() => [...document.querySelectorAll('.vela-sp-row')].filter((e) => e.getClientRects().length).length);
    check(rows > 0, eng + ': typing opens symbol search with rows', rows);
    await ctx.close();
    // a tap before the first candles releases them at once
    const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await speedInit(ctx2);
    await ctx2.addInitScript(() => {
      window.__lists = [];
      const of = window.fetch;
      window.fetch = function (u) { const s = String(u && u.url || u); if (/exchangeInfo|hyperliquid|coinbase\.com\/products/.test(s)) window.__lists.push([Math.round(performance.now()), !!window.__stkFirstCandles]); return of.apply(this, arguments); };
      addEventListener('DOMContentLoaded', () => { setTimeout(() => window.dispatchEvent(new PointerEvent('pointerdown')), 50); });
    });
    const p2 = await ctx2.newPage();
    await p2.goto(BASE + '/charts.html?vela=' + eng, { waitUntil: 'domcontentloaded' });
    await p2.waitForFunction(() => window.__stkFirstCandles, null, { timeout: 60000 });
    await sleep(500);
    const l2 = await p2.evaluate(() => window.__lists);
    check(l2.length >= 3 && l2.some((x) => !x[1]), eng + ': an early tap fetches the lists without waiting for the candles', l2);
    await ctx2.close();
  }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
