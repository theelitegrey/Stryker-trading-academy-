// Main-thread trace of one cold phone load (390, 4x CPU, Fast 4G) up to the first candles: time by
// trace event (script evaluation per URL, style/layout, parse, compile, GC). Fixture server only.
//   CHART_BASE=http://127.0.0.1:8261 node tools/tests/chart-phone-speed-trace.js
const { launch } = require('./lib.js');
const { speedInit } = require('./chart-phone-speed-init.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8261';
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600', '--enable-unsafe-swiftshader', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE cdn.jsdelivr.net'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
  await speedInit(ctx);
  await ctx.addInitScript(() => {
    const iv = setInterval(() => {
      try { if (window.STRYKER_VELA.cells().some((c) => c.chart.orchestrator.rawBars.length)) { window.__c = Math.round(performance.now()); clearInterval(iv); } } catch (e) {}
    }, 20);
  });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const events = [];
  cdp.on('Tracing.dataCollected', (d) => { for (const e of d.value) events.push(e); });
  await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['devtools.timeline', 'v8', 'disabled-by-default-devtools.timeline'], recordMode: 'recordContinuously' }, transferMode: 'ReportEvents' });
  await p.goto(BASE + '/charts.html' + (process.env.Q || ''), { waitUntil: 'commit' });
  await p.waitForFunction(() => window.__c, null, { timeout: 90000, polling: 200 });
  const candleAt = await p.evaluate(() => window.__c);
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end');
  await done;
  await b.close();
  // main renderer thread = the one with most RunTask time
  const nav = events.find((e) => e.name === 'navigationStart' || e.name === 'NavigationStart' || (e.name === 'TracingStartedInBrowser'));
  const byTid = new Map();
  for (const e of events) if (e.ph === 'X' && e.name === 'RunTask') byTid.set(e.pid + ':' + e.tid, (byTid.get(e.pid + ':' + e.tid) || 0) + e.dur);
  const main = [...byTid.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const ev = events.filter((e) => e.pid + ':' + e.tid === main && e.ph === 'X');
  const t0 = Math.min(...ev.map((e) => e.ts));
  const cut = t0 + candleAt * 1000 + 2e6;
  const tot = new Map(); const scripts = new Map();
  const TOP = ['EvaluateScript', 'v8.compile', 'v8.compileModule', 'v8.evaluateModule', 'FunctionCall', 'ParseHTML', 'ParseAuthorStyleSheet', 'UpdateLayoutTree', 'Layout', 'Paint', 'MajorGC', 'MinorGC', 'V8.GC_SCAVENGER', 'TimerFire', 'FireAnimationFrame', 'XHRReadyStateChange', 'v8.parseOnBackground', 'PrePaint', 'Layerize', 'RunMicrotasks', 'EventDispatch', 'ResourceReceivedData', 'CompileScript', 'ScheduleStyleRecalculation', 'HitTest'];
  for (const e of ev) {
    if (e.ts > cut) continue;
    if (TOP.includes(e.name)) tot.set(e.name, (tot.get(e.name) || 0) + e.dur);
    const u = (e.args && e.args.data && (e.args.data.url || e.args.data.fileName)) || (e.args && e.args.fileName) || '';
    if (u && /EvaluateScript|v8.evaluateModule|v8.compile|FunctionCall|v8.compileModule/.test(e.name)) {
      const k = e.name.replace(/^v8\./, '') + ' ' + String(u).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      scripts.set(k, (scripts.get(k) || 0) + e.dur);
    }
  }
  console.log('first candles at', candleAt, 'ms (throttled); main thread time to then + 2 s, ms:');
  [...tot.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + String(Math.round(v / 1000)).padStart(6) + '  ' + k));
  console.log('per script (inclusive, ms):');
  [...scripts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log('  ' + String(Math.round(v / 1000)).padStart(6) + '  ' + k));
  // long tasks with what they contained
  const tasks = ev.filter((e) => e.name === 'RunTask' && e.dur > 150e3 && e.ts < cut).sort((a, b) => a.ts - b.ts);
  console.log('long tasks > 150 ms:');
  for (const t of tasks) {
    const inner = ev.filter((e) => e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e !== t && e.dur > 40e3 && e.name !== 'RunTask');
    const desc = inner.slice(0, 4).map((e) => e.name + ' ' + String((e.args && e.args.data && (e.args.data.url || e.args.data.functionName)) || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(-40) + ' ' + Math.round(e.dur / 1000)).join(' | ');
    console.log('  @' + Math.round((t.ts - t0) / 1000) + ' ' + Math.round(t.dur / 1000) + ' ms: ' + desc);
  }
})().catch((e) => { console.error(e); process.exit(1); });
