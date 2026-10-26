// CPU profile of one cold phone load (390, 4x CPU, Fast 4G) up to the first candles: self time by
// script URL + a timeline of the page's key moments. Fixture server only.
//   CHART_BASE=http://127.0.0.1:8261 node tools/tests/chart-phone-speed-profile.js
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8261';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600', '--enable-unsafe-swiftshader', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE cdn.jsdelivr.net'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
  await require('./chart-phone-speed-init.js').speedInit(ctx);
  await ctx.addInitScript(() => {
    window.__tl = [];
    const mark = (n) => window.__tl.push([n, Math.round(performance.now())]);
    document.addEventListener('DOMContentLoaded', () => mark('DOMContentLoaded'));
    const iv = setInterval(() => {
      const sh = document.querySelector('.dash-shell');
      if (sh && !sh.classList.contains('gate-pending') && !window.__g) { window.__g = 1; mark('gate cleared'); }
      if (window.STRYKER_VELA && !window.__w) { window.__w = 1; mark('workspace built'); }
      try { if (!window.__c && window.STRYKER_VELA.cells().some((c) => c.chart.orchestrator.rawBars.length)) { window.__c = 1; mark('bars in chart'); } } catch (e) {}
      if (window.__stkHeavyReady && !window.__h) { window.__h = 1; mark('heavy ready'); clearInterval(iv); }
    }, 20);
    for (const ev of ['stk:first-candles']) window.addEventListener(ev, () => mark(ev));
  });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const reqs = [];
  let t0 = null;
  cdp.on('Network.requestWillBeSent', (e) => { if (t0 == null) t0 = e.timestamp; if (/\/api\//.test(e.request.url)) reqs.push([Math.round((e.timestamp - t0) * 1000), e.request.url.replace(/^https?:\/\/[^/]+/, '')]); });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await cdp.send('Profiler.start');
  await p.goto(BASE + '/charts.html' + (process.env.Q || ''), { waitUntil: 'commit' });
  await p.waitForFunction(() => window.__c, null, { timeout: 90000, polling: 200 });
  const { profile } = await cdp.send('Profiler.stop');
  await p.waitForFunction(() => window.__h, null, { timeout: 60000, polling: 200 }).catch(() => {});
  const tl = await p.evaluate(() => window.__tl.concat(performance.getEntriesByType('mark').map((m) => [m.name, Math.round(m.startTime)]), performance.getEntriesByType('resource').filter((e) => /workspace\.js|chunk-XIRSR|chunk-4WAH|vela-chart\.js|style\.css|firebase-firestore/.test(e.name)).map((e) => ['loaded ' + e.name.split('/').pop().split('?')[0], Math.round(e.responseEnd)])).sort((a, b) => a[1] - b[1]));
  await b.close();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas; const sm = profile.samples;
  for (let i = 0; i < sm.length; i++) {
    const n = byId.get(sm[i]); const cf = n.callFrame;
    const k = cf.url ? cf.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] : '(' + cf.functionName + ')';
    self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000);
  }
  // per function (self), with the call parent, for the hot window
  const parent = new Map(); for (const n of profile.nodes) for (const c of (n.children || [])) parent.set(c, n.id);
  const fself = new Map(); let ts = profile.startTime;
  const T0 = profile.startTime;
  for (let i = 0; i < sm.length; i++) {
    ts += dt[i] || 0;
    const ms = (ts - T0) / 1000;
    if (ms < (Number(process.env.W0) || 0) || ms > (Number(process.env.W1) || 1e9)) continue;
    let n = byId.get(sm[i]); const cf = n.callFrame;
    if (!cf.url) continue;
    // walk up to the first frame in OUR code (assets/*.js not vendor) for attribution
    let o = n, own = null; while (o) { const u = o.callFrame.url || ''; if (/\/assets\/(?!vendor)[^/]+\.js/.test(u)) { own = o; break; } o = byId.get(parent.get(o.id)); }
    const k = (cf.functionName || '(anon)') + ' ' + cf.url.split('/').pop().split('?')[0] + ':' + cf.lineNumber + '  <= ' + (own ? (own.callFrame.functionName || '(anon)') + ' ' + own.callFrame.url.split('/').pop().split('?')[0] + ':' + own.callFrame.lineNumber : '-');
    fself.set(k, (fself.get(k) || 0) + (dt[i] || 0) / 1000);
  }
  console.log('hot functions (self ms) [profile window ' + (process.env.W0 || 0) + '-' + (process.env.W1 || 'end') + ' ms]:');
  [...fself.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, v]) => console.log('  ' + String(Math.round(v)).padStart(6) + '  ' + k));
  const own = new Map();
  for (const [k, v] of fself) { const o = k.split('<= ')[1]; own.set(o, (own.get(o) || 0) + v); }
  console.log('by our caller:'); [...own.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log('  ' + String(Math.round(v)).padStart(6) + '  ' + k));
  console.log('timeline (ms since nav):'); tl.forEach((x) => console.log('  ' + String(x[1]).padStart(6) + '  ' + x[0]));
  console.log('self time by script up to first candles (ms, throttled):');
  [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log('  ' + String(Math.round(v)).padStart(6) + '  ' + k));
  console.log('api requests (ms since nav):'); reqs.slice(0, 70).forEach((r) => console.log('  ' + r[0] + '  ' + r[1]));
})().catch((e) => { console.error(e); process.exit(1); });
