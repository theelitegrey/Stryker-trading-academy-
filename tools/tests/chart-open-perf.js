// Chart open speed: navigation -> first candles painted, request list before that, long tasks, JS heap.
//   TLS_KEY=k.pem TLS_CERT=c.pem node tools/tests/static-proxy.mjs ROOT PORT   (HTTP/2, self-signed; /api proxied to the live site)
//   CHART_BASE=https://127.0.0.1:PORT node tools/tests/chart-open-perf.js [--plan Starter|Elite] [--w 1440] [--tf 1] [--vela 0.6] [--throttle] [--runs 3] [--list]
const { launch } = require('./lib.js');
const stubSrc = require('./richstub.js');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = process.env.CHART_BASE || 'https://127.0.0.1:8041';
const plan = arg('plan', 'Elite'), w = +arg('w', 1440), tf = arg('tf', '1'), vela = arg('vela', ''), thr = process.argv.includes('--throttle');
const runs = +arg('runs', 3);
const stub = stubSrc.replace("plan: 'Elite', role: 'elite',\n          emailVerified", "plan: '" + plan + "', role: '" + plan.toLowerCase() + "',\n          emailVerified");
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600'] });
  const res = [];
  for (let r = 0; r < runs; r++) {
    const mobile = w < 700;
    const ctx = await b.newContext({ viewport: { width: w, height: mobile ? 800 : 900 }, isMobile: mobile, hasTouch: mobile, ignoreHTTPSErrors: true });
    await ctx.addInitScript(stub);
    // the stub has no firebase app / onIdTokenChanged: add them so rt-access.js behaves as for a real signed-in member
    await ctx.addInitScript(() => { const f = window.firebase; if (!f) return; f.apps = [{}]; const a = f.auth(); a.onIdTokenChanged = (cb) => { setTimeout(() => cb(a.currentUser), 30); return () => {}; }; });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
      window.__lt = [];
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
      window.__fc = 0;
      const t = setInterval(() => { try { const c = window.STRYKER_VELA.context().cells[0].chart; if (c.orchestrator.rawBars.length > 0 && !window.__fc) { window.__fc = performance.now(); clearInterval(t); } } catch (e) {} }, 20);
    });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (rt) => rt.abort());
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Network.enable');
    if (thr) { await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 165, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 }); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
    if (process.argv.includes('--prof')) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start'); }
    await p.goto(BASE + '/charts.html?tf=' + tf + (vela ? '&vela=' + vela : ''), { waitUntil: 'commit' });
    await p.waitForFunction(() => window.__fc > 0, null, { timeout: 90000, polling: 50 }).catch(() => {});
    const info = await p.evaluate(() => {
      const marks = {}; performance.getEntriesByType('mark').forEach((m) => { if (/^stk:/.test(m.name)) marks[m.name] = Math.round(m.startTime); });
      const fc = Math.round(window.__fc);
      const before = performance.getEntriesByType('resource').filter((e) => e.responseEnd <= fc);
      return { fc, marks, nreqBefore: before.length, kbBefore: Math.round(before.reduce((a, e) => a + (e.encodedBodySize || 0), 0) / 1024),
        listBefore: before.map((e) => e.name.replace(location.origin, '').split('?')[0] + ' ' + Math.round(e.startTime) + '-' + Math.round(e.responseEnd)),
        lt: window.__lt.filter((x) => x[0] < fc).length, ltMs: window.__lt.filter((x) => x[0] < fc).reduce((a, x) => a + x[1], 0),
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
    });
    if (process.argv.includes('--prof')) { const { profile } = await cdp.send('Profiler.stop'); const dt = profile.timeDeltas; const self = {}; const byId = {}; profile.nodes.forEach((n) => { byId[n.id] = n; }); profile.samples.forEach((id, i) => { const n = byId[id]; const k = (n.callFrame.url.split('/').pop().split('?')[0] || '(native)') + ':' + n.callFrame.functionName + ':' + n.callFrame.lineNumber; self[k] = (self[k] || 0) + dt[i] / 1000; }); const tot = {}; Object.entries(self).forEach(([k, v]) => { const f = k.split(':')[0]; tot[f] = (tot[f] || 0) + v; }); console.log('BYFILE ' + JSON.stringify(Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => k + ' ' + Math.round(v)))); console.log('TOPFN ' + JSON.stringify(Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => k + ' ' + Math.round(v)))); }
    res.push(info);
    await ctx.close();
  }
  await b.close();
  const med = (k) => res.map((x) => x[k]).sort((a, c) => a - c)[Math.floor(res.length / 2)];
  console.log(JSON.stringify({ plan, w, tf, vela, thr, base: BASE, medianFirstCandlesMs: med('fc'), nreqBefore: med('nreqBefore'), kbBefore: med('kbBefore'), longTasksBefore: med('lt'), longTaskMsBefore: med('ltMs'), heapMB: med('heapMB'), runs: res.map((x) => x.fc) }));
  if (process.argv.includes('--list')) console.log(res[res.length - 1].listBefore.join('\n') + '\n' + JSON.stringify(res[res.length - 1].marks));
})();
