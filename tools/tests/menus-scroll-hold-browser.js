// Scroll does not snap back (Owner 2026-11-03: "when I scroll up, it automatically scrolls down again").
// Touch at 390x700 on charts.html, fixture hub ticking (NQ1!). For each scrolling phone menu (⋯ sheet, timeframe,
// indicators, symbol search, drawings): finger-scroll down, then up, while firing window resize (Android's address
// bar shows/hides as you scroll) and live ticks; assert scrollTop stays where the finger left it for 2 s.
//   node tools/tests/chart-dev-server.mjs 8011 &   CHART_BASE=http://127.0.0.1:8011 node tools/tests/menus-scroll-hold-browser.js
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8011';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const fx = fs.readFileSync(__dirname + '/book-panel-browser.js', 'utf8');
const fixtures = new Function('return ' + fx.slice(fx.indexOf('function fixtures()'), fx.indexOf('async function open(')).trim())();
// [label, tap selector, scroller selector]
const MENUS = [
  ['more sheet', '#stkc-more-btn', '#stkc-more-pop'],
  ['timeframe', '.vela-mb-tf', '.stk-iv-menu'],
  ['indicators', '.vela-mb-indicator', '.stkiw-list'],
  ['symbol search', '.vela-mb-symbol', '#vela-sp-list, .vela-sp-list'],
  ['drawing tools', '.vela-mb-drawings', '#vela-drawer-body, .vela-drawer-body']
];
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(stub); await ctx.addInitScript(fixtures);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await p.evaluate(() => { const w = window.STRYKER_VELA; w.active.setSymbol('NQ1!'); w.active.setTimeframe('1'); });
  await sleep(3000);
  const cdp = await ctx.newCDPSession(p);
  const swipe = async (x, y1, y2) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y1 }] });
    for (let i = 1; i <= 10; i++) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y1 + (y2 - y1) * i / 10 }] }); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  for (const [label, tapSel, scSel] of MENUS) {
    const t = await p.$(tapSel);
    if (!t || !(await t.isVisible())) { console.log('SKIP ' + label + ' (no button at 390)'); continue; }
    await t.tap(); await sleep(900);
    const box = await p.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.offsetHeight > 60 && x.scrollHeight > x.clientHeight + 30); if (!e) return null; const r = e.getBoundingClientRect(); window.__sc = e; return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height }; }, scSel);
    if (!box) { console.log('SKIP ' + label + ' (not scrollable at this height)'); await p.keyboard.press('Escape'); await p.mouse.click(5, 690); await sleep(300); continue; }
    const d = Math.min(140, box.h / 3);
    // the address bar: a resize every 150 ms while the finger moves, as Chrome Android does
    const rz = setInterval(() => p.evaluate(() => window.dispatchEvent(new Event('resize'))).catch(() => {}), 150);
    await swipe(box.x, box.y + d, box.y - d); await sleep(500);
    const down = await p.evaluate(() => window.__sc.scrollTop);
    await swipe(box.x, box.y - d * 0.7, box.y + d * 0.3); await sleep(300);
    const up = await p.evaluate(() => window.__sc.scrollTop);
    await sleep(2000);
    clearInterval(rz);
    const later = await p.evaluate(() => window.__sc.scrollTop);
    check(down > 0, `${label}: finger scroll down moved it (${down})`);
    check(up < down, `${label}: finger scroll up moved it back up (${down} -> ${up})`);
    check(Math.abs(later - up) <= 4, `${label}: stays where the finger left it for 2 s with ticks + resizes (${up} -> ${later})`);
    await p.keyboard.press('Escape'); await p.mouse.click(5, 690); await sleep(400);
  }
  await b.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
