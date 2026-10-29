// Connect shortcut chip on the chart: shown/hidden cases, 7-day dismiss, opens the sheet. 390 + 1440, Vela 0.9 + 0.6.
//   node tools/tests/chart-dev-server.mjs 8031 ; node tools/tests/rithmic-mock.mjs 8765
//   node tools/tests/rithmic-chip-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const MOCK = process.env.RITHMIC_MOCK || 'ws://127.0.0.1:8765';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, m) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vis = (p) => p.evaluate(() => { const c = document.getElementById('stkrb-chipgo'); return !!c && !c.hidden && c.offsetWidth > 0; });
(async () => {
  const b = await launch();
  try {
    for (const cfg of [{ n: 'phone', w: 390, h: 800, mobile: true }, { n: 'desk', w: 1440, h: 900, mobile: false }]) {
      for (const vela of ['', '?vela=0.6']) {
        const tag = cfg.n + (vela ? '-v06' : '-v09');
        const ctx = await b.newContext({ viewport: { width: cfg.w, height: cfg.h }, isMobile: cfg.mobile, hasTouch: cfg.mobile });
        await ctx.addInitScript(stub);
        await ctx.addInitScript((g) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_rithmic_dev', JSON.stringify({ gateway: g })); } catch (e) {} }, MOCK);
        await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
        const p = await ctx.newPage();
        await p.goto(BASE + '/charts.html' + vela, { waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => window.__stkHeavyReady && document.getElementById('stkrb-chipgo'), null, { timeout: 60000 });
        await sleep(2500);
        const sym = await p.evaluate(() => window.STRYKER_VELA && window.STRYKER_VELA.active && window.STRYKER_VELA.active.symbol);
        check(await vis(p), tag + ' chip shown: signed in, not connected, futures (' + sym + ')');
        const geo = await p.evaluate(() => { const c = document.getElementById('stkrb-chipgo').getBoundingClientRect(); const bar = document.getElementById('stkc-bar').getBoundingClientRect(); const bs = [...document.querySelectorAll('.stkc-bar button, .stkc-bar .stkc-btn, .vela-mobilebar button')].filter((x) => x.offsetWidth > 0).map((x) => x.getBoundingClientRect()); const hit = bs.filter((r) => !(c.right <= r.left || c.left >= r.right || c.bottom <= r.top || c.top >= r.bottom)).length; return { top: c.top, right: c.right, left: c.left, w: window.innerWidth, barBottom: bar.bottom, hit }; });
        check(geo.hit === 0 && geo.top >= geo.barBottom - 1 && geo.left >= 0 && geo.right <= geo.w, tag + ' chip covers no toolbar button, inside viewport ' + JSON.stringify(geo));
        await p.screenshot({ path: `${OUT}/t5-${tag}-chip.png` });
        // opens sheet
        if (cfg.mobile) await p.locator('#stkrb-chipgo-b').tap(); else await p.locator('#stkrb-chipgo-b').click();
        check(await p.waitForFunction(() => !document.getElementById('stkrb-pop').hidden, null, { timeout: 5000 }).then(() => true, () => false), tag + ' chip opens the sheet');
        check(!(await vis(p)), tag + ' chip hidden while sheet open');
        await p.evaluate(() => { document.querySelector('.stkrb-fullx') && document.querySelector('.stkrb-fullx').click(); if (!document.getElementById('stkrb-pop').hidden) document.getElementById('stkrb-btn').click(); });
        await sleep(300);
        check(await p.waitForFunction(() => { const c = document.getElementById('stkrb-chipgo'); return c && !c.hidden; }, null, { timeout: 5000 }).then(() => true, () => false), tag + ' chip back after sheet closes');
        // non-futures symbol
        const swapped = await p.evaluate(async () => { const ws = window.STRYKER_VELA; if (!ws) return 'nows'; try { await ws.active.chart.setMarket({ symbol: 'binance:BTCUSDT' }); return 'ok'; } catch (e) { return String(e); } });
        await sleep(2600);
        const sym2 = await p.evaluate(() => window.STRYKER_VELA.active.symbol);
        if (swapped === 'ok' && !/1!|futures:/i.test(sym2)) check(!(await vis(p)), tag + ' chip hidden on non-futures (' + sym2 + ')');
        else console.log('SKIP non-futures swap (' + swapped + ' ' + sym2 + ')');
        await p.evaluate(() => window.STRYKER_VELA.active.chart.setMarket({ symbol: 'NQ1!' }).catch(() => {}));
        await sleep(2600);
        // dismiss 7 days
        if (await vis(p)) { if (cfg.mobile) await p.locator('#stkrb-chipgo-x').tap(); else await p.locator('#stkrb-chipgo-x').click(); }
        check(!(await vis(p)), tag + ' x hides the chip');
        const until = await p.evaluate(() => Number(localStorage.getItem('stryker_rithmic_chip_hide_until')));
        const days = (until - Date.now()) / 864e5;
        check(days > 6.99 && days <= 7.01, tag + ' dismissed for 7 days (' + days.toFixed(3) + ')');
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => window.__stkHeavyReady && document.getElementById('stkrb-chipgo'), null, { timeout: 60000 });
        await sleep(2500);
        check(!(await vis(p)), tag + ' stays hidden after reload');
        await p.evaluate(() => localStorage.setItem('stryker_rithmic_chip_hide_until', String(Date.now() - 1000)));
        await sleep(2300);
        check(await vis(p), tag + ' returns once the 7 days are over');
        await ctx.close();
      }
    }
    // signed-out: no member -> rithmic never loads; chip must not exist
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await sleep(6000);
    check(await p.evaluate(() => { const c = document.getElementById('stkrb-chipgo'); return !c || c.hidden || c.offsetWidth === 0; }), 'signed-out visitor: no chip');
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
