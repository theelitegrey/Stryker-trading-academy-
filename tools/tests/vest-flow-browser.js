// Vest order flow on captured data: footprint cells paint (aggressor from the qty sign), the DOM and the book heatmap draw,
// the Book panel fills from Vest. Shots into <shotsDir>.
//   CHART_BASE=http://127.0.0.1:8648 flock /tmp/stryker-chrome.lock node tools/tests/vest-flow-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/vest-shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
const pick = (p, type) => p.evaluate((t) => { const c = window.STRYKER_VELA.active, rows = c.libraryRows(), i = rows.findIndex((r) => r.native && r.nativeType === t); if (i < 0) return false; c.addFromLibrary(i); return true; }, type);
const paint = (p) => p.evaluate(() => { let best = 0; for (const c of document.querySelectorAll('#vela-chart canvas')) { if (!c.width || !c.height) continue; let d; try { d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; } catch (e) { continue; } let n = 0; for (let i = 3; i < d.length; i += 64) if (d[i] > 0) n++; best = Math.max(best, n); } return best; });
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const [sym, w, h, mobile, light, tag] of [['vest:BTC-PERP', 1440, 900, false, false, 'btc-1440-dark'], ['vest:BTC-PERP', 390, 844, true, false, 'btc-390-dark'], ['vest:BTC-PERP', 1440, 900, false, true, 'btc-1440-light'], ['vest:AMD-USD-PERP', 1440, 900, false, false, 'amd-1440-dark'], ['vest:AMD-USD-PERP', 390, 844, true, false, 'amd-390-dark'], ['vest:AMD-USD-PERP', 1440, 900, false, true, 'amd-1440-light']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((lt) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (lt) localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, light);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|ws-beta-prod\.hz\.vestmarkets\.com)/, (r) => r.abort());
    await require('./vest-mock.js').install(ctx);
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 45000 });
    await sleep(2500);
    await p.evaluate((s) => { window.dispatchEvent(new Event('pointerdown')); const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1'); }, sym);
    await sleep(5000);
    check(await pick(p, 'stk_crypto_dom'), tag + ' DOM indicator found');
    check(await pick(p, 'stk_depth_heat'), tag + ' heatmap indicator found');
    check(await pick(p, 'stk_footprint'), tag + ' footprint picked');
    await sleep(6000);
    const n = await paint(p);
    check(n > 1000, tag + ' chart layers paint', n);
    const fp = await p.evaluate(() => { const o = window.__stkOrderflow, f = o && o.crypto ? o.crypto() : null; return f ? JSON.stringify(f).slice(0, 120) : ''; });
    check(fp.length > 0, tag + ' footprint feed has data', fp);
    check((await p.evaluate(() => document.documentElement.getAttribute('data-theme') === 'light')) === light, tag + ' theme applied');
    await p.screenshot({ path: OUT + '/F-' + tag + '.png' });
    check(errs.length === 0, tag + ' no page errors', errs);
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
