// Connection chip + popover browser test (Owner order 15 Nov 2026, assets/chart-latency.js).
//   node tools/tests/chart-dev-server.mjs 8031 &      (serves /api/ping from functions/api/ping.js)
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/chart-latency-browser.js <shotsDir>
// Checks: chip shows "<n> ms" after load, popover opens on click (desktop: also on hover) with the Site & API row and a
// row for the chart's symbol, Performance mode persists, a hidden tab sends no pings, phone = bottom sheet, no console errors.
// Shots: 1440 dark + light (popover open), 390 + 412 (sheet open), chip close-up.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };

async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile || process.env.HIDPI ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.removeItem('stk.perfMode'); if (t) localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
  // count pings and let the test pretend the tab is hidden
  await ctx.addInitScript(() => {
    window.__pings = 0; window.__fakeHidden = false;
    const f = window.fetch; window.fetch = function (u) { if (String(u).indexOf('/api/ping') >= 0) window.__pings++; return f.apply(this, arguments); };
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get() { return window.__fakeHidden; } });
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return window.__fakeHidden ? 'hidden' : 'visible'; } });
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net|[a-z0-9.-]*hyperliquid\.xyz)/, (r) => r.abort());   // Hyperliquid stays reachable: real candles + trade times for the market row (Binance answers 451 from the test server)
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|Failed to load resource|Ping received|Unexpected response code/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('hyperliquid:BTC'); ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.active.symbol === 'hyperliquid:BTC') break; } });
  await p.waitForSelector('.stklat-chip', { state: 'attached', timeout: 20000 });
  await sleep(6000);   // a few pings + trades land
  return { ctx, p, errors };
}

(async () => {
  const b = await launch();
  try {
    // ---------------------------------------------------------------- desktop dark
    let { ctx, p, errors } = await open(b, { w: 1440, h: 900, theme: 'dark' });
    const chipTxt = await p.$eval('.stklat-chip .stklat-v', (e) => e.textContent);
    check(/^\d+ ms$/.test(chipTxt), 'chip shows ms after load', chipTxt);
    const inBar = await p.evaluate(() => !!document.querySelector('.vela-widget-bottombar .stklat-chip'));
    check(inBar, 'chip sits in the chart bottom bar');
    const q = await p.$eval('.stklat-chip', (e) => e.dataset.q);
    check(q === 'good', 'local ping is green', q);
    await p.hover('.stklat-chip'); await sleep(600);
    check(await p.evaluate(() => window.__stkLatency.isOpen), 'hover opens the popover (desktop)');
    await p.mouse.move(400, 400); await sleep(700);
    check(!(await p.evaluate(() => window.__stkLatency.isOpen)), 'leaving closes a hover-opened popover');
    await p.click('.stklat-chip'); await sleep(1500);
    const rows = await p.$$eval('.stklat-row .stklat-name', (n) => n.map((x) => x.textContent));
    check(rows[0] === 'Site & API' && rows.some((r) => /BTC · Hyperliquid/.test(r)), 'rows: site + chart symbol', rows);
    const age = await p.evaluate(() => [...document.querySelectorAll('.stklat-row')].map((r) => r.innerText).join(' '));
    check(/Last tick [0-9.]+ s ago/.test(age), 'market row shows a real last-update age', age);
    const vals = await p.$$eval('.stklat-row', (n) => n.map((x) => x.innerText.replace(/\s+/g, ' ')));
    console.log('  rows: ' + JSON.stringify(vals));
    const inView = await p.evaluate(() => { const r = document.getElementById('stklat-pop').getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
    check(inView, 'popover fully on screen');
    await p.screenshot({ path: OUT + '/lat-1440-dark.png' });
    const pb = await (await p.$('#stklat-pop')).boundingBox(), cb = await (await p.$('.stklat-chip')).boundingBox();
    await p.screenshot({ path: OUT + '/lat-pop-1440-dark-zoom.png', clip: { x: pb.x - 8, y: pb.y - 8, width: pb.width + 16, height: cb.y + cb.height + 8 - pb.y + 8 } });
    // performance mode persists + class on <html>
    await p.click('.stklat-perf'); await sleep(200);
    const perf = await p.evaluate(() => [localStorage.getItem('stk.perfMode'), document.documentElement.classList.contains('stk-perf')]);
    check(perf[0] === '1' && perf[1], 'performance mode saved + applied', perf);
    await p.click('.stklat-perf'); await sleep(200);
    check(await p.evaluate(() => localStorage.getItem('stk.perfMode') === null), 'performance mode off again');
    // reconnect
    await p.click('.stklat-re'); await sleep(2500);
    check(/\d+ ms/.test(await p.$eval('.stklat-chip .stklat-v', (e) => e.textContent)), 'chip still measuring after Reconnect');
    // escape closes
    await p.keyboard.press('Escape'); await sleep(400);
    check(!(await p.evaluate(() => window.__stkLatency.isOpen)), 'Escape closes');
    // hidden tab: no pings
    await p.evaluate(() => { window.__fakeHidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(500); const n0 = await p.evaluate(() => window.__pings); await sleep(11000); const n1 = await p.evaluate(() => window.__pings);
    check(n1 === n0, 'hidden tab sends no pings', { n0, n1 });
    await p.evaluate(() => { window.__fakeHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(800);
    check((await p.evaluate(() => window.__pings)) > n1, 'pings resume when visible');
    check(!errors.length, 'no console errors (1440 dark)', errors);
    await ctx.close();

    // ---------------------------------------------------------------- desktop light
    ({ ctx, p, errors } = await open(b, { w: 1440, h: 900, theme: 'light' }));
    await p.click('.stklat-chip'); await sleep(1500);
    await p.screenshot({ path: OUT + '/lat-1440-light.png' });
    check(!errors.length, 'no console errors (1440 light)', errors);
    await ctx.close();

    // ---------------------------------------------------------------- phones
    for (const w of [390, 412]) {
      ({ ctx, p, errors } = await open(b, { w, h: w === 390 ? 844 : 915, mobile: true, theme: 'dark' }));
      const chip = await p.$('.stklat-chip'); const cbx = chip && await chip.boundingBox();
      check(!!cbx && cbx.height <= 26 && cbx.x + cbx.width <= w, 'phone ' + w + ': chip small and on screen', cbx);
      const ow = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      check(ow, 'phone ' + w + ': no horizontal overflow');
      await p.screenshot({ path: OUT + '/lat-' + w + '-closed.png' });
      await p.tap('.stklat-chip'); await sleep(1200);
      const sheet = await p.evaluate(() => { const r = document.getElementById('stklat-pop').getBoundingClientRect(); return { l: r.left, r: r.right, b: Math.round(r.bottom), w: innerWidth, h: innerHeight }; });
      check(sheet.l === 0 && sheet.r === sheet.w && Math.abs(sheet.b - sheet.h) <= 1, 'phone ' + w + ': bottom sheet', sheet);
      await p.screenshot({ path: OUT + '/lat-' + w + '-sheet.png' });
      await p.tap('.stklat-x'); await sleep(500);
      check(!(await p.evaluate(() => window.__stkLatency.isOpen)), 'phone ' + w + ': × closes');
      check(!errors.length, 'no console errors (' + w + ')', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
