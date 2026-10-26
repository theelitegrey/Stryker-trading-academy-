// Charts load speed on a phone (Owner "optimize for phone", 2026-10-26): cold + warm load, measured.
//   Fixture (no live data):  node tools/tests/chart-speed-server.mjs 8261 &   (Pages-like: brotli + _headers)
//                            CHART_BASE=http://127.0.0.1:8261 node tools/tests/chart-phone-speed.js [--desktop] [--out f.json]
//   Live (max 3 cold loads per job, signed out):  CHART_BASE=https://tradezoro.com node tools/tests/chart-phone-speed.js
// Run Chrome only as: systemd-run --user --scope -p MemoryMax=1000M flock /tmp/stryker-chrome.lock node ...
// Phone = 390x844, Android UA, CPU 4x slowdown, Fast 4G (9 Mbps down / 1.5 Mbps up / 60 ms RTT).
// --desktop = 1440x900, no throttling.
// Numbers: FCP; CANDLES = first time a chart cell holds bars AND its candle canvas has painted pixels;
// INTERACTIVE = toolbar, ⋯ menu, watchlist/heavy modules all mounted; long tasks > 50 ms up to then;
// bytes from CDP (encoded = on the wire, decoded = after decompression) split by type, cache hits counted.
const fs = require('fs');
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8261';
const LIVE = !/127\.0\.0\.1|localhost/.test(BASE);
const DESK = process.argv.includes('--desktop');
const OUT = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? process.argv[i + 1] : null; })();
const ENG = process.env.SPEED_ENG || '';   // '' = default (0.9), '0.6' = ?vela=0.6
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBE = () => {
  window.__sp = { lt: [], candles: null, inter: null };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__sp.lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  const painted = () => {
    try {
      const ws = window.STRYKER_VELA; if (!ws) return false;
      const cells = ws.cells ? ws.cells() : [];
      if (!cells.some((c) => c.chart && c.chart.orchestrator && c.chart.orchestrator.rawBars.length > 0)) return false;
      // a non-blank canvas inside the chart host (WebGL or 2D): rawBars alone is "data in", not "on screen"
      const cvs = [...document.querySelectorAll('#vela-chart canvas')].filter((c) => c.width > 50 && c.height > 50);
      return cvs.length > 0;
    } catch (e) { return false; }
  };
  const tick = () => {
    const sp = window.__sp;
    if (!sp.candles && (painted() || window.__stkFirstCandles)) {
      // two frames later the frame holding the bars has been presented
      requestAnimationFrame(() => requestAnimationFrame(() => { if (!sp.candles) sp.candles = Math.round(performance.now()); }));
    }
    if (!sp.inter && sp.candles && window.__stkHeavyReady && window.__stkOneBar && window.STRYKER_CHART_UI && document.getElementById('stkc-more-btn')) sp.inter = Math.round(performance.now());
    if (!sp.inter) setTimeout(tick, 16);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick); else tick();
  setTimeout(tick, 0);
};

async function oneLoad(ctx, label, shot) {
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  if (!DESK) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  const req = new Map();
  cdp.on('Network.requestWillBeSent', (e) => { if (!req.has(e.requestId)) req.set(e.requestId, { url: e.request.url, t0: e.timestamp, type: e.type || '', enc: 0, dec: 0, cached: false, status: 0 }); });
  cdp.on('Network.responseReceived', (e) => { const r = req.get(e.requestId); if (r) { r.type = e.type || r.type; r.status = e.response.status; r.mime = e.response.mimeType; if (e.response.fromDiskCache || e.response.fromServiceWorker || e.response.fromPrefetchCache) r.cached = true; } });
  cdp.on('Network.requestServedFromCache', (e) => { const r = req.get(e.requestId); if (r) r.cached = true; });
  cdp.on('Network.dataReceived', (e) => { const r = req.get(e.requestId); if (r) r.dec += e.dataLength; });
  cdp.on('Network.loadingFinished', (e) => { const r = req.get(e.requestId); if (r) { r.enc = e.encodedDataLength; r.t1 = e.timestamp; } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  const url = BASE + (LIVE ? '/charts' : '/charts.html') + (ENG ? '?vela=' + ENG : '');
  const navT = Date.now();
  await p.goto(url, { waitUntil: 'commit', timeout: 90000 });
  let navTs = null; for (const r of req.values()) { if (r.type === 'Document') { navTs = r.t0; break; } }
  try { await p.waitForFunction(() => window.__sp && window.__sp.inter, null, { timeout: 90000, polling: 250 }); } catch (e) { errs.push('timeout waiting interactive'); }
  await sleep(DESK ? 1500 : 3000);
  const m = await p.evaluate(() => {
    const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime;
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const sp = window.__sp;
    const upTo = sp.inter || performance.now();
    const lt = sp.lt.filter((x) => x[0] < upTo);
    const res = performance.getEntriesByType('resource').map((e) => [e.name, Math.round(e.responseEnd)]);
    const marks = performance.getEntriesByType('mark').map((x) => [x.name, Math.round(x.startTime)]);
    return { fcp: Math.round(fcp || 0), dcl: Math.round(nav.domContentLoadedEventEnd || 0), candles: sp.candles, inter: sp.inter, lt: lt.length, ltSum: lt.reduce((a, x) => a + x[1], 0), ltMax: Math.max(0, ...lt.map((x) => x[1])), lt50: lt.slice().sort((a, b) => b[1] - a[1]).slice(0, 6), res, marks, cached: window.__stkCandleCache || null };
  });
  if (shot) { try { await p.screenshot({ path: shot }); } catch (e) {} }
  // CDP bytes
  const rows = [...req.values()].filter((r) => !/^data:|^blob:/.test(r.url));
  const kind = (r) => { const u = r.url.split('?')[0]; if (/\.css$/.test(u) || r.type === 'Stylesheet') return 'css'; if (/\.m?js$/.test(u) || r.type === 'Script') return 'js'; if (r.type === 'Font' || /\.woff2?$/.test(u)) return 'font'; if (r.type === 'Image' || /\.(png|webp|jpe?g|svg|gif|ico)$/.test(u)) return 'img'; if (r.type === 'Document') return 'html'; if (/\/api\//.test(u) || r.type === 'Fetch' || r.type === 'XHR') return 'data'; return 'other'; };
  const by = {};
  for (const r of rows) { const k = kind(r); by[k] = by[k] || { n: 0, cache: 0, enc: 0, dec: 0 }; by[k].n++; if (r.cached) by[k].cache++; by[k].enc += r.cached ? 0 : r.enc; by[k].dec += r.dec; }
  const candleAt = m.candles || 1e9;
  const resEnd = new Map(m.res.map(([u, t]) => [u, t]));
  const big = rows.filter((r) => kind(r) === 'js' || kind(r) === 'css' || kind(r) === 'font' || kind(r) === 'img').sort((a, b) => b.dec - a.dec).slice(0, 14)
    .map((r) => ({ f: r.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0], dec: r.dec, enc: r.cached ? 0 : r.enc, beforeCandle: (resEnd.get(r.url) || 0) < candleAt }));
  const preCandle = rows.filter((r) => (kind(r) === 'js' || kind(r) === 'css') && (resEnd.get(r.url) || 1e9) < candleAt);
  const pre = { n: preCandle.length, dec: preCandle.reduce((a, r) => a + r.dec, 0), files: preCandle.map((r) => r.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]) };
  await p.close();
  return Object.assign({ label, requests: rows.length, by, big, pre, errs }, m, { res: undefined });
}

(async () => {
  // Fixture runs: NO Playwright route() (it switches the HTTP cache off, so a "warm" load would be cold).
  // Every host except the local server and jsDelivr (pinets) is unresolvable; Firebase is the richstub.
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600', '--enable-unsafe-swiftshader'];
  if (!LIVE) args.push('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE cdn.jsdelivr.net');
  const b = await launch({ args });
  const ctx = await b.newContext(DESK ? { viewport: { width: 1440, height: 900 } } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
  if (!LIVE) await require('./chart-phone-speed-init.js').speedInit(ctx);
  await ctx.addInitScript(PROBE);
  const tag = (process.env.SPEED_TAG || 'run') + (DESK ? '-1440' : '-390');
  const shotDir = process.env.SPEED_SHOTS;
  const cold = await oneLoad(ctx, 'cold', shotDir && shotDir + '/' + tag + '-cold.png');
  const warm = await oneLoad(ctx, 'warm', shotDir && shotDir + '/' + tag + '-warm.png');
  await b.close();
  const fmt = (x) => (x == null ? '-' : (x / 1000).toFixed(2) + ' s');
  for (const r of [cold, warm]) {
    console.log(`\n== ${DESK ? 'desktop 1440' : 'phone 390 throttled'} ${r.label} (${BASE}${ENG ? ' vela ' + ENG : ''})`);
    console.log(`FCP ${fmt(r.fcp)}  DCL ${fmt(r.dcl)}  CANDLES ${fmt(r.candles)}  INTERACTIVE ${fmt(r.inter)}  requests ${r.requests}`);
    console.log(`long tasks to interactive: ${r.lt} (sum ${r.ltSum} ms, max ${r.ltMax} ms) top ${JSON.stringify(r.lt50)}`);
    for (const [k, v] of Object.entries(r.by)) console.log(`  ${k.padEnd(5)} n=${String(v.n).padStart(3)} fromCache=${String(v.cache).padStart(3)} wire=${Math.round(v.enc / 1024)} KB decoded=${Math.round(v.dec / 1024)} KB`);
    console.log(`  JS/CSS finished before first candle: ${r.pre.n} files, ${Math.round(r.pre.dec / 1024)} KB decoded`);
    if (r.label === 'cold') r.big.forEach((x) => console.log(`   ${String(Math.round(x.dec / 1024)).padStart(5)} KB (${String(Math.round(x.enc / 1024)).padStart(4)} KB wire) ${x.beforeCandle ? 'PRE ' : '    '} ${x.f}`));
    if (r.marks.length) console.log('  marks', JSON.stringify(r.marks));
    if (r.errs.length) console.log('  errors', r.errs.slice(0, 5));
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ base: BASE, desk: DESK, eng: ENG, cold, warm }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
