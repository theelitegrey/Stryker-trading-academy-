// Which canvas calls cost what during a cold phone load (fixture server): wraps the 2D context
// prototype + getContext and sums wall time per method until the first candles.
const { launch } = require('./lib.js');
const { speedInit } = require('./chart-phone-speed-init.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8261';
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600', '--enable-unsafe-swiftshader', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE cdn.jsdelivr.net'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
  await speedInit(ctx);
  await ctx.addInitScript(() => {
    const T = window.__ct = {}; let on = true;
    const P = CanvasRenderingContext2D.prototype;
    for (const k of ['clearRect', 'setTransform', 'fillRect', 'fillText', 'measureText', 'stroke', 'fill', 'save', 'restore', 'drawImage', 'clip', 'rect', 'beginPath']) {
      const f = P[k]; if (typeof f !== 'function') continue;
      P[k] = function () { if (!on) return f.apply(this, arguments); const t = performance.now(); try { return f.apply(this, arguments); } finally { const d = performance.now() - t; const e = T[k] || (T[k] = [0, 0]); e[0]++; e[1] += d; } };
    }
    const gc = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () { const t = performance.now(); try { return gc.apply(this, arguments); } finally { const d = performance.now() - t; const k = 'getContext ' + arguments[0]; const e = T[k] || (T[k] = [0, 0]); e[0]++; e[1] += d; } };
    const iv = setInterval(() => { try { if (window.STRYKER_VELA.cells().some((c) => c.chart.orchestrator.rawBars.length)) { window.__c = Math.round(performance.now()); on = false; clearInterval(iv); } } catch (e) {} }, 20);
  });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.goto(BASE + '/charts.html' + (process.env.Q || ''), { waitUntil: 'commit' });
  await p.waitForFunction(() => window.__c, null, { timeout: 90000, polling: 200 });
  const r = await p.evaluate(() => ({ c: window.__c, t: window.__ct, n: document.querySelectorAll('#vela-chart canvas').length, sz: [...document.querySelectorAll('#vela-chart canvas')].slice(0, 3).map((c) => c.width + 'x' + c.height) }));
  await b.close();
  console.log('candles at', r.c, 'ms; canvases', r.n, r.sz);
  Object.entries(r.t).sort((a, b) => b[1][1] - a[1][1]).forEach(([k, v]) => console.log('  ' + k.padEnd(22) + ' calls ' + String(v[0]).padStart(6) + '  ms ' + Math.round(v[1])));
})().catch((e) => { console.error(e); process.exit(1); });
