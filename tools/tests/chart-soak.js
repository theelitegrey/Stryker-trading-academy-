// Charts memory soak: 8-chart grid + live ticks + an order-flow indicator, sampled for N minutes.
//   CHART_BASE=https://tradezoro.com node tools/tests/chart-soak.js [--min 10] [--json out.json]
// Run under flock /tmp/stryker-chrome.lock. Samples JS heap (after a forced GC), DOM nodes, listeners,
// canvas count every 30 s. PASS = heap growth after the first 2 minutes stays under 25 MB.
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'https://tradezoro.com';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const MIN = +arg('--min', 10), OUT = arg('--json', null);
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(require('./richstub.js'));
  await ctx.route(/www\.gstatic\.com\/firebasejs|firestore\.googleapis|identitytoolkit|securetoken/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable'); await cdp.send('HeapProfiler.enable');
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await p.goto(BASE + '/charts', { waitUntil: 'domcontentloaded' });
  const ready = () => p.evaluate(() => { try { return window.STRYKER_VELA.cells().every((c) => c.chart.orchestrator.rawBars.length > 0); } catch (e) { return false; } }).catch(() => false);
  for (let i = 0; i < 200 && !(await ready()); i++) await p.waitForTimeout(100);
  await p.click('#stkc-layout-btn'); await p.click('.stkg-ic[data-layout="8"]');
  for (let i = 0; i < 120; i++) { await p.waitForTimeout(250); if (await ready()) break; }
  // an order-flow indicator on the active chart (Session Volume Profile; works from the chart bars)
  const ind = await p.evaluate(async () => {
    for (let i = 0; i < 80 && !window.__stkHeavyReady; i++) await new Promise((r) => setTimeout(r, 250));
    const out = [];
    try { const cells = window.STRYKER_VELA.context().cells; cells.slice(0, 4).forEach((c, i) => { const t = ['stk_svp', 'stk_of_cvd', 'stk_gex', 'stk_of_delta'][i]; try { out.push(t + ':' + !!c.chart.addNativeIndicator(t)); } catch (e) { out.push(t + ':ERR ' + e.message); } }); window.STRYKER_VELA.context().stateChanged(); } catch (e) { out.push('err ' + e.message); }
    return out.join(' ');
  });
  console.log('indicator add:', ind);
  // synthetic every-tick candles: one onBar per animation frame per cell (what the tick feed does), random walk on the last bar
  const ticks = await p.evaluate(() => {
    window.__soakTicks = 0;
    const step = () => {
      try {
        window.STRYKER_VELA.cells().forEach((c) => {
          const o = c.chart.orchestrator; const lb = o.rawBars[o.rawBars.length - 1]; if (!lb) return;
          const px = lb.close + (Math.random() - 0.5) * lb.close * 0.0002;
          o.onBar({ time: lb.time, open: lb.open, high: Math.max(lb.high, px), low: Math.min(lb.low, px), close: px, volume: (lb.volume || 0) + 1 });
          window.__soakTicks++;
        });
      } catch (e) { window.__soakErr = String(e).slice(0, 120); }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step); return 'on';
  });
  console.log('synthetic ticks:', ticks);
  const rows = []; const t0 = Date.now();
  const sample = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const m = await cdp.send('Performance.getMetrics'); const g = (n) => (m.metrics.find((x) => x.name === n) || {}).value;
    const extra = await p.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, ticks: window.__soakTicks, tickErr: window.__soakErr || null }));
    rows.push({ t: Math.round((Date.now() - t0) / 1000), heapMB: +(g('JSHeapUsedSize') / 1048576).toFixed(1), nodes: g('Nodes'), listeners: g('JSEventListeners'), docs: g('Documents'), canvases: extra.canvases, ticks: extra.ticks, tickErr: extra.tickErr });
    console.log(JSON.stringify(rows[rows.length - 1]));
  };
  await sample();
  while (Date.now() - t0 < MIN * 60000) { await p.waitForTimeout(30000); await sample(); }
  const base = rows.find((r) => r.t >= 120) || rows[0], last = rows[rows.length - 1];
  const res = { min: MIN, rows, growthMB: +(last.heapMB - base.heapMB).toFixed(1), nodeGrowth: last.nodes - base.nodes, listenerGrowth: last.listeners - base.listeners, errs, pass: last.heapMB - base.heapMB < 25 };
  console.log('RESULT', JSON.stringify({ growthMB: res.growthMB, nodeGrowth: res.nodeGrowth, listenerGrowth: res.listenerGrowth, errs: errs.length, pass: res.pass }));
  if (OUT) require('fs').writeFileSync(OUT, JSON.stringify(res, null, 1));
  await b.close();
})();
