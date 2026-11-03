// Menus stay open (Owner 2026-11-03: "menus keep sliding back when I open"). Touch emulation at 390x844 on
// charts.html with the fixture hub ticking 10x/s (NQ1!): tap each menu, wait 3 s, assert it is still open;
// scroll inside the ⋯ sheet, assert open + scroll kept; opening ⋯ then the bell leaves only one open.
//   node tools/tests/chart-dev-server.mjs 8011 &   CHART_BASE=http://127.0.0.1:8011 node tools/tests/menus-stay-open-browser.js
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8011';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
// fixture hub: one fake /ts-live socket with book snaps + ticks (same as book-panel-browser)
const fx = fs.readFileSync(__dirname + '/book-panel-browser.js', 'utf8');
const fixtures = new Function('return ' + fx.slice(fx.indexOf('function fixtures()'), fx.indexOf('async function open(')).trim())();

// [label, tap selector, "is open" test run in the page]
const vis = (e) => !!e && e.offsetWidth > 0 && e.offsetHeight > 40 && getComputedStyle(e).visibility !== 'hidden';
const MENUS = [
  ['hamburger', '#stkcps-menu', () => document.body.classList.contains('sidebar-locked')],
  ['symbol search', '.vela-mb-symbol', () => [...document.querySelectorAll('[role=dialog]')].some((e) => e.offsetWidth > 0)],
  ['timeframe', '.vela-mb-tf', () => { const e = document.querySelector('.stk-iv-menu'); return !!e && e.offsetWidth > 0; }],
  ['indicators', '.vela-mb-indicator', () => { const e = document.querySelector('.stkiw-card'); return !!e && e.offsetWidth > 0; }],
  ['drawing tools', '.vela-mb-drawings', () => [...document.querySelectorAll('[role=dialog]')].some((e) => e.offsetWidth > 0)],
  ['session clock', '.mclock-pill', () => { const e = document.querySelector('.mclock-pop'); return !!e && e.offsetWidth > 0; }],
  ['symbol info', '.stkin-phonebtn', () => !!document.querySelector('.stkin') && document.querySelector('.stkin').offsetWidth > 0],
  ['more sheet', '#stkc-more-btn', () => { const e = document.getElementById('stkc-more-pop'); return !!e && !e.hidden && e.offsetHeight > 100; }],
  ['notifications', '#notif-bell-btn', () => getComputedStyle(document.getElementById('notif-panel')).display !== 'none']
];
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: +process.env.W || 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(stub); await ctx.addInitScript(fixtures);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await p.evaluate(() => { const w = window.STRYKER_VELA; w.active.setSymbol('NQ1!'); w.active.setTimeframe('1'); });
  await sleep(3000);
  const open = (i) => p.evaluate(`(${MENUS[i][2]})()`);
  const shut = async () => { await p.evaluate(() => { document.querySelectorAll('.vela-dialog-close').forEach((e) => e.click()); }); await p.keyboard.press('Escape'); await p.touchscreen.tap(200, 430); await sleep(400); };
  for (let i = 0; i < MENUS.length; i++) {
    const [name, sel] = MENUS[i];
    const c = await p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.y >= 0 && r.y < 80 ? [r.x + r.width / 2, r.y + r.height / 2] : null; }, sel);
    if (!c) { console.log('SKIP ' + name + ': not on the bar at this width (it lives in the ⋯ sheet)'); continue; }
    await p.touchscreen.tap(c[0], c[1]); await sleep(600);
    const a = await open(i); await sleep(3000); const z = await open(i);
    check(a && z, name + ': open at 0.6 s (' + a + ') and still open at 3.6 s (' + z + ')');
    if (name === 'more sheet') {
      const s = await p.evaluate(() => { const e = document.getElementById('stkc-more-pop'); e.scrollTop = 300; return e.scrollTop; });
      await sleep(2500);
      const s2 = await p.evaluate(() => { const e = document.getElementById('stkc-more-pop'); return [e.hidden, e.scrollTop]; });
      check(s > 0 && !s2[0] && s2[1] === s, 'more sheet: scrolled to ' + s + ', 2.5 s later hidden=' + s2[0] + ' scrollTop=' + s2[1]);
      await p.screenshot({ path: (process.env.SHOTS || '/tmp') + '/menus-more-' + (process.env.W || 390) + '.png' });
      const bc = await p.evaluate(() => { const r = document.getElementById('notif-bell-btn').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
      await p.touchscreen.tap(bc[0], bc[1]); await sleep(500);
      const both = await p.evaluate(() => [!document.getElementById('stkc-more-pop').hidden, getComputedStyle(document.getElementById('notif-panel')).display !== 'none']);
      check(!(both[0] && both[1]) && both[1], 'bell after ⋯: only one menu open (more=' + both[0] + ', bell=' + both[1] + ')');
      await sleep(1500);
    }
    await shut();
  }
  // opening ⋯ while the bell is open closes the bell
  await p.evaluate(() => { document.getElementById('notif-panel').style.display = 'block'; });
  const mc = await p.evaluate(() => { const r = document.getElementById('stkc-more-btn').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await p.touchscreen.tap(mc[0], mc[1]); await sleep(500);
  const two = await p.evaluate(() => [!document.getElementById('stkc-more-pop').hidden, getComputedStyle(document.getElementById('notif-panel')).display !== 'none']);
  check(two[0] && !two[1], '⋯ after bell: only one menu open (more=' + two[0] + ', bell=' + two[1] + ')');
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
