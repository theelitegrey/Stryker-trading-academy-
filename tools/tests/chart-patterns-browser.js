// Auto Chart Patterns (assets/chart-patterns.js) browser test on REAL chart bars (the dev server's /api/chart/bars, live upstream).
//   node tools/tests/chart-dev-server.mjs 8022 &   CHART_BASE=http://127.0.0.1:8022 node tools/tests/chart-patterns-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const SYM = process.env.SYM || 'futures:ES1!', TF = process.env.TF || '15';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, theme, tag] of [[1440, 900, false, 'dark', '1440-dark'], [1440, 900, false, 'light', '1440-light'], [390, 844, true, 'dark', '390-dark'], [390, 844, true, 'light', '390-light']]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
      await ctx.addInitScript(stub);
      await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
      const p = await ctx.newPage(); const errors = [];
      p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|Failed to load resource|Unexpected re|\/api\/chart\/stream/.test(m.text())) errors.push(m.text()); });
      p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
      await sleep(2000);
      const n = await p.evaluate(async ([s, tf]) => {
        const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe(tf);
        for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); if (ws.chart.market.symbol === s && ws.chart.orchestrator.rawBars.length > 100) break; }
        return ws.chart.orchestrator.rawBars.length;
      }, [SYM, TF]);
      check(n > 100, tag + ': real bars loaded (' + n + ')', n);
      await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_patterns', { inputs: { targets: true, pivot: 3 } }); window.STRYKER_VELA.context().stateChanged(); });
      await sleep(2500);
      const r = await p.evaluate(() => ({ perf: (window.__stkPatterns || {}).perf, ind: (window.STRYKER_VELA.context().cells[0].chart.indicators() || []).map((h) => h.nativeType) }));
      check(r.ind.includes('stk_patterns'), tag + ': indicator added', r.ind);
      check(r.perf && r.perf.passes >= 1 && r.perf.avgMs < 150, tag + ': pass time ' + (r.perf ? r.perf.avgMs.toFixed(1) : '?') + ' ms avg', r.perf);
      check(errors.length === 0, tag + ': no console errors', errors);
      await p.screenshot({ path: OUT + '/patterns-' + tag + '.png' });
      if (mobile) {   // the phone shows ~60 bars: pan back to where patterns are and shoot again
        for (let k = 0; k < 3; k++) { await p.mouse.move(60, 400); await p.mouse.down(); await p.mouse.move(360, 400, { steps: 8 }); await p.mouse.up(); await sleep(300); }
        await sleep(800); await p.screenshot({ path: OUT + '/patterns-' + tag + '-panned.png' });
      }
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
})();
