// Charts page-load profile: JS requests (count, raw bytes, wire bytes), first chart time, heap, long tasks.
//   CHART_BASE=https://tradezoro.com node tools/tests/chart-load-profile.js [--w 390] [--grid 8] [--json out]
// Run under flock /tmp/stryker-chrome.lock.
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'https://tradezoro.com';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const W = +arg('--w', 1440), H = W < 600 ? 844 : 900, GRID = arg('--grid', null), OUT = arg('--json', null);
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  const ctx = await b.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript(require('./richstub.js'));
  await ctx.route(/www\.gstatic\.com\/firebasejs|firestore\.googleapis|identitytoolkit|securetoken/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
    window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch (e) {} });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable'); await cdp.send('Performance.enable');
  const js = new Map(); const errs = [];
  cdp.on('Network.responseReceived', (e) => { if (/javascript/.test(e.response.mimeType || '') || /\.js(\?|$)/.test(e.response.url)) js.set(e.requestId, { url: e.response.url.replace(BASE, ''), wire: 0 }); });
  cdp.on('Network.loadingFinished', (e) => { const r = js.get(e.requestId); if (r) r.wire = e.encodedDataLength; });
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  const t0 = Date.now();
  await p.goto(BASE + '/charts', { waitUntil: 'domcontentloaded' });
  let first = null;
  for (let i = 0; i < 400; i++) { const ok = await p.evaluate(() => { const w = window.STRYKER_VELA; try { return !!(w && w.cells().length && w.cells().every((c) => c.chart.orchestrator.rawBars.length > 0)); } catch (e) { return false; } }).catch(() => false); if (ok) { first = Date.now() - t0; break; } await p.waitForTimeout(100); }
  let gridMs = null; const tg = Date.now(); if (GRID) { await p.click('#stkc-layout-btn'); await p.click('.stkg-ic[data-layout="' + GRID + '"]'); for (let i = 0; i < 60; i++) { await p.waitForTimeout(250); if (await p.evaluate(() => window.STRYKER_VELA.cells().every((c) => { try { return c.chart.orchestrator.rawBars.length > 0; } catch (e) { return false; } })).catch(() => false)) break; } gridMs = Date.now() - tg; }
  await p.waitForTimeout(4000);
  const raw = await p.evaluate(() => performance.getEntriesByType('resource').filter((r) => /\.js(\?|$)/.test(r.name)).map((r) => [r.name, r.decodedBodySize, r.encodedBodySize, r.startTime | 0, r.responseEnd | 0]));
  const m = await cdp.send('Performance.getMetrics'); const g = (n) => (m.metrics.find((x) => x.name === n) || {}).value;
  const lt = await p.evaluate(() => window.__lt);
  const tot = raw.reduce((a, r) => [a[0] + r[1], a[1] + r[2]], [0, 0]);
  const out = { W, GRID, firstChartMs: first, gridMs, frameMs: await p.evaluate(() => new Promise((res) => { let n = 0, t = performance.now(), a = []; const f = (x) => { a.push(x - t); t = x; if (++n < 60) requestAnimationFrame(f); else res(Math.round(a.slice(5).sort((x, y) => x - y)[Math.floor(a.length / 2)])); }; requestAnimationFrame(f); })), jsFiles: raw.length, jsRawKB: Math.round(tot[0] / 1024), jsWireKB: Math.round(tot[1] / 1024), heapMB: Math.round(g('JSHeapUsedSize') / 1048576), jsTaskSec: +(g('ScriptDuration')).toFixed(2), longTasks: lt.length, longTaskMs: Math.round(lt.reduce((a, d) => a + d, 0)), errs, top: raw.sort((a, b) => b[1] - a[1]).slice(0, 12).map((r) => [r[0].replace(BASE, ''), Math.round(r[1] / 1024), Math.round(r[2] / 1024), r[3], r[4]]) };
  console.log(JSON.stringify(out, null, 1)); if (OUT) require('fs').writeFileSync(OUT, JSON.stringify(out, null, 1));
  await b.close();
})();
