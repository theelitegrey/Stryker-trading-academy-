// Tick-to-repaint latency on ZoroCharts (homepage hero speed wording, Owner 2026-11-01).
// Opens the local /charts build on BTCUSDT (Binance spot, the tick-boosted provider), lets the REAL public Binance
// aggTrade stream run for SECS seconds, and for every trade message records:
//   t0 = performance.now() when the message reaches the page (a listener added before the provider's onmessage)
//   t1 = the first draw call on the main chart canvas after t0 (the repaint that carries that trade)
// Reports count, median, p90, max of t1 - t0 in ms. This measures in-browser handling + repaint only, never the
// exchange's or the network's delivery time. Firebase is stubbed; only 127.0.0.1, jsdelivr and Binance are allowed.
//   node tools/tests/static-proxy.mjs . 8041 &  CHART_BASE=https://127.0.0.1:8041 SECS=30 node tools/tests/chart-tick-latency.js
const { launch } = require('./lib.js'); const stubSrc = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'https://127.0.0.1:8041'; const SECS = Number(process.env.SECS || 30);
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(stubSrc);
  await ctx.addInitScript(() => {
    const f = window.firebase; f.apps = [{}]; const a = f.auth(); a.onIdTokenChanged = (cb) => { setTimeout(() => cb(a.currentUser), 30); return () => {}; };
    localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
    const L = window.__lat = { pending: [], out: [], msgs: 0 };
    const OW = window.WebSocket;
    window.WebSocket = function (url, p) {
      const s = p ? new OW(url, p) : new OW(url);
      if (/@aggTrade/.test(String(url))) s.addEventListener('message', () => { L.msgs++; L.pending.push(performance.now()); });
      return s;
    };
    window.WebSocket.prototype = OW.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    const mark = function () { const c = this.canvas; if (L.pending.length && c && c.width > 600 && c.height > 300) { const t = performance.now(); L.pending.forEach((t0) => L.out.push(t - t0)); L.pending = []; } };
    for (const m of ['fillRect', 'drawImage', 'stroke', 'fill']) { const o = CanvasRenderingContext2D.prototype[m]; CanvasRenderingContext2D.prototype[m] = function (...a) { mark.call(this); return o.apply(this, a); }; }
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance\.com|data-api\.binance\.vision|stream\.binance\.com)/, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'commit' });
  await p.waitForFunction(() => window.__stkFirstCandles, null, { timeout: 60000 });
  const sym = await p.evaluate(() => { try { return String(window.STRYKER_VELA.context().cells[0].symbol); } catch (e) { return '?'; } });
  await p.waitForTimeout(3000);
  await p.evaluate(() => { window.__lat.out = []; window.__lat.msgs = 0; });
  await p.waitForTimeout(SECS * 1000);
  const r = await p.evaluate(() => window.__lat);
  const a = r.out.slice().sort((x, y) => x - y), q = (k) => a.length ? a[Math.min(a.length - 1, Math.floor(k * a.length))].toFixed(1) : 'n/a';
  console.log(JSON.stringify({ symbol: sym, secs: SECS, tradeMsgs: r.msgs, measured: a.length, medianMs: q(0.5), p90Ms: q(0.9), maxMs: a.length ? a[a.length - 1].toFixed(1) : 'n/a' }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
