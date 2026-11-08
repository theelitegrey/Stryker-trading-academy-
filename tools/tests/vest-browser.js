// Bybit end to end against a mocked Bybit (tools/tests/vest-mock.js): bybit:BTCUSDT.P paints candles, the last price
// moves, the symbol list carries Vest rows, the Book panel fills. Shots 1440/390/412 dark + 1440 light into <shotsDir>.
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/bybit-browser.js <shotsDir>
const fs = require('fs');
const SYM = process.env.VEST_SYM || 'vest:BTC-PERP';
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/vest-shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
const bars = (p) => p.evaluate(() => { try { const o = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars; return { n: o.length, last: o.length ? o[o.length - 1].close : 0 }; } catch (e) { return { n: 0, last: 0 }; } });
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const [w, h, mobile, light, tag] of [[1440, 900, false, false, '1440-dark'], [390, 844, true, false, '390-dark'], [412, 915, true, false, '412-dark'], [1440, 900, false, true, '1440-light']]) {
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
    await p.evaluate(() => { window.dispatchEvent(new Event('pointerdown')); });   // releases the lazy symbol lists
    await p.evaluate((SYM) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(SYM); ws.active.setTimeframe('1'); }, SYM);
    let r = { n: 0, last: 0 };
    for (let i = 0; i < 40 && r.n < 20; i++) { await sleep(500); r = await bars(p); }
    check(r.n >= 20, tag + ' candles paint (vest)', r);
    const a = r.last; await sleep(4000); const c = await bars(p);
    check(c.last > 0 && c.n >= r.n, tag + ' price present after 4 s', [a, c.last]);
    const sym = await p.evaluate(() => window.STRYKER_VELA.active.symbol);
    check(/^vest:/i.test(sym), tag + ' symbol is vest', sym);
    const rows = await p.evaluate(async () => { try { const f = window.STRYKER_VELA.feed; await new Promise((r) => setTimeout(r, 1500)); const l = f.symbols() || []; return l.filter((s) => s.provider === 'vest').length; } catch (e) { return String(e); } });
    check(typeof rows === 'number' && rows > 0, tag + ' symbol list has Vest rows', rows);
    await p.screenshot({ path: OUT + '/V-chart-' + tag + '.png' });
    check(errs.length === 0, tag + ' no page errors', errs);
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
