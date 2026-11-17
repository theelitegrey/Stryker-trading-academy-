// Idle cost of an untouched chart: rAF callbacks/s, timers, canvases, composited-layer-ish counts, heap.
//   CHART_BASE=http://127.0.0.1:8071 node tools/tests/chart-idle-cost-probe.js [seconds]  (run under flock /tmp/stryker-chrome.lock)
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const bm = require('./binance-mock.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8071';
const SECS = Number(process.argv[2] || 8);
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => {
    const W = window; W.__raf = { n: 0, by: {} }; W.__tm = { iv: 0, ivLive: new Set() };
    const raf = W.requestAnimationFrame.bind(W);
    W.requestAnimationFrame = (cb) => { const k = (new Error().stack || '').split('\n')[2] || ''; return raf((t) => { W.__raf.by[k] = (W.__raf.by[k] || 0) + 1; W.__raf.n++; cb(t); }); };
    const si = W.setInterval.bind(W), ci = W.clearInterval.bind(W);
    W.setInterval = (f, ms, ...a) => { const id = si(f, ms, ...a); W.__tm.ivLive.add(id); return id; };
    W.clearInterval = (id) => { W.__tm.ivLive.delete(id); return ci(id); };
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)(?!(api\.binance\.com|data-api\.binance\.vision|fapi\.binance\.com|stream\.binance))/, (r) => r.abort());
  await bm.install(ctx);
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_VELA.chart.orchestrator.rawBars.length > 0, null, { timeout: 60000 });
  await p.waitForTimeout(5000);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable');
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const r0 = await p.evaluate(() => window.__raf.n);
  await p.waitForTimeout(SECS * 1000);
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const r1 = await p.evaluate(() => window.__raf.n);
  console.log(JSON.stringify(Object.entries(await p.evaluate(() => window.__raf.by)).sort((a, b) => b[1] - a[1]).slice(0, 6), null, 1));
  const st = await p.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    canvasPx: [...document.querySelectorAll('canvas')].reduce((a, c) => a + c.width * c.height, 0),
    dom: document.getElementsByTagName('*').length,
    liveIntervals: window.__tm.ivLive.size,
    layered: [...document.querySelectorAll('*')].filter((e) => { const s = getComputedStyle(e); return s.willChange !== 'auto' || /translateZ|matrix3d/.test(s.transform) || s.backdropFilter !== 'none'; }).length,
  }));
  const d = (k) => m1[k] - m0[k];
  console.log(JSON.stringify({ secs: SECS, rafPerSec: +((r1 - r0) / SECS).toFixed(1), cpuPct: +(100 * (d('TaskDuration')) / SECS).toFixed(1), scriptPct: +(100 * d('ScriptDuration') / SECS).toFixed(1), layoutPerSec: +(d('LayoutCount') / SECS).toFixed(1), recalcStylePerSec: +(d('RecalcStyleCount') / SECS).toFixed(1), heapMB: +(m1.JSHeapUsedSize / 1048576).toFixed(1), listeners: m1.JSEventListeners, nodes: m1.Nodes, ...st }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
