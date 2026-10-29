// Rapid symbol/timeframe switching must never leave the chart empty, frozen or on the wrong market.
//   node tools/tests/static-proxy.mjs . 8041 (TLS_KEY/TLS_CERT) ; CHART_BASE=https://127.0.0.1:8041 node tools/tests/chart-burst-browser.js [shotsDir]
const { launch } = require('./lib.js'); const stubSrc = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'https://127.0.0.1:8041'; const OUT = process.argv[2] || '/tmp';
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600'] });
  let fail = 0; const check = (ok, m) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + m); };
  for (const mode of ['rapid-api', 'real-clicks']) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    await ctx.addInitScript(stubSrc);
    await ctx.addInitScript(() => { const f = window.firebase; f.apps = [{}]; const a = f.auth(); a.onIdTokenChanged = (cb) => { setTimeout(() => cb(a.currentUser), 30); return () => {}; }; localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
    await p.goto(BASE + '/charts.html', { waitUntil: 'commit' });
    await p.waitForFunction(() => window.__stkFirstCandles, null, { timeout: 60000 });
    await p.waitForTimeout(2500);
    const seq = [['5', null], [null, 'futures:ES1!'], ['1', null], [null, 'futures:GC1!'], ['15', null], [null, 'futures:NQ1!'], ['1', null], ['5', null], [null, 'futures:ES1!'], ['60', null], ['1', 'futures:NQ1!']];
    if (mode === 'rapid-api') {
      await p.evaluate(async (seq) => { const ws = window.STRYKER_VELA; for (const [tf, sym] of seq) { if (tf) ws.active.setTimeframe(tf); if (sym) ws.active.setSymbol(sym); await new Promise((r) => setTimeout(r, 60)); } }, seq);
    } else {
      for (const t of ['1m', '5m', '15m', '1h', '1m', '5m', '1m', '15m', '5m', '1m', '1h', '1m']) { await p.click(`button:has-text("${t}")`).catch(() => {}); await p.waitForTimeout(120); }
    }
    const want = mode === 'rapid-api' ? { tf: '1', sym: 'NQ' } : { tf: '1', sym: 'NQ' };
    const t0 = Date.now(); let st = null;
    while (Date.now() - t0 < 12000) {
      st = await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0]; const rb = c.chart.orchestrator.rawBars; const n = rb.length; const gap = n > 2 ? Math.round((rb[n - 1].time - rb[n - 2].time) / 1000) : 0; return { tf: String(c.timeframe), sym: String(c.symbol), n, gap, last: n ? rb[n - 1].time : 0, close: n ? rb[n - 1].close : 0 }; });
      if (st.n > 0 && st.tf === want.tf && st.sym.includes(want.sym)) break; await p.waitForTimeout(200);
    }
    console.log(mode, JSON.stringify(st), 'settled in', Date.now() - t0, 'ms');
    check(st && st.n > 0, mode + ': candles present after burst');
    check(st && st.tf === want.tf && st.sym.includes(want.sym), mode + ': chart on the last requested market (' + st.sym + ' ' + st.tf + ')');
    check(st && st.gap === 60, mode + ': candle spacing matches 1m (gap ' + (st && st.gap) + ' s)');
    const px = await p.evaluate(() => { const c = document.querySelector('#vela-chart canvas'); return !!c; });
    check(px, mode + ': chart canvas mounted');
    // then it must still take a normal switch
    const t1 = Date.now(); await p.evaluate(() => window.STRYKER_VELA.active.setTimeframe('5'));
    await p.waitForFunction(() => { const c = window.STRYKER_VELA.context().cells[0]; const rb = c.chart.orchestrator.rawBars; return String(c.timeframe) === '5' && rb.length > 2 && Math.round((rb[rb.length - 1].time - rb[rb.length - 2].time) / 1000) === 300; }, null, { timeout: 8000 }).then(() => check(true, mode + ': follow-up 5m switch painted in ' + (Date.now() - t1) + ' ms')).catch(() => check(false, mode + ': follow-up 5m switch never painted'));
    check(errs.length === 0, mode + ': no page errors ' + (errs[0] || ''));
    await p.screenshot({ path: OUT + '/burst-' + mode + '.png' });
    await ctx.close();
  }
  await b.close(); process.exit(fail ? 1 : 0);
})();
