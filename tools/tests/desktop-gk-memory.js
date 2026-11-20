// Member GK (Discord 1572203424009953341, 20 Nov): the Windows app uses more memory than the browser for the same
// template. Runs the same two-chart layout as tools/tests/chart-gk-layout-probe.js inside Electron (desktop/test/mem-main.js:
// the app's window settings) and in plain Chromium, and prints renderer / GPU memory for both.
//   TE_ALLSYM=1 python3 tools/tests/tick-engine-hub.py 8191 &  node tools/tests/chart-dev-server.mjs 8190 &
//   CHART_BASE=http://127.0.0.1:8190 HUB=http://127.0.0.1:8191 xvfb-run -a node tools/tests/desktop-gk-memory.js [electron-binary]
// Needs desktop/node_modules (npm ci in desktop/). Linux + Xvfb renders in software, so GPU numbers are indicative only.
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright-core');
const { setup, canvases } = require('./chart-gk-layout-probe.js');
const { procRss } = require('./phone-mem-lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8190', HUB = process.env.HUB || 'http://127.0.0.1:8191';
const ROOT = path.join(__dirname, '..', '..');
const BIN = process.argv[2] || path.join(ROOT, 'desktop', 'node_modules', 'electron', 'dist', 'electron');
const V = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'version.json'), 'utf8')).build;

(async () => {
  const app = await electron.launch({ executablePath: BIN, args: ['--no-sandbox', '--user-data-dir=' + fs.mkdtempSync(path.join(require('os').tmpdir(), 'tz-mem-')), path.join(ROOT, 'desktop', 'test', 'mem-main.js')],
    env: Object.assign({}, process.env, { TZ_URL: 'about:blank' }), timeout: 60000 });
  try {
    const p = await app.firstWindow();
    const ctx = p.context();
    await ctx.addInitScript(stub);
    await ctx.addInitScript(([h]) => { window.__STK_BOOK_RECORDER = h; try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', 'night'); } catch (e) {} }, [HUB]);
    await ctx.addInitScript(() => {
      const all = window.__cvAll = [], ce = Document.prototype.createElement;
      Document.prototype.createElement = function (t) { const el = ce.apply(this, arguments); if (String(t).toLowerCase() === 'canvas') all.push(new WeakRef(el)); return el; };
      const P = CanvasRenderingContext2D.prototype;
      for (const k of ['fill', 'stroke', 'fillRect', 'fillText', 'drawImage', 'putImageData', 'clearRect']) { const f = P[k]; P[k] = function () { if (this.canvas) this.canvas.__px = 1; return f.apply(this, arguments); }; }
    });
    const { fixturePage } = require('./phone-mem-lib.js');
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
    await ctx.route(/\/api\/chart\/bars\/[A-Z0-9%!]+\?tf=(1|5|15)(&|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: fixturePage(r.request().url()) }));
    await p.goto(BASE + '/charts.html?engine=1', { waitUntil: 'domcontentloaded' });
    await p.evaluate(async (v) => { (await import('/assets/rt-access.js?v=' + v))._rtSetForTests(true, 'test-token'); }, V);
    await setup(p);
    const pid = await app.evaluate(() => process.pid);
    const rss = procRss(pid), cv = await canvases(p);
    const res = { app: 'electron', rssMB: { renderer: Math.round(rss.renderer / 1024), gpu: Math.round(rss.gpu / 1024) },
      heapMB: await p.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576)), canvasMB: Math.round(cv.reduce((a, x) => a + x.mb, 0)),
      vis: await p.evaluate(() => document.visibilityState) };
    console.log(JSON.stringify(res));
    // the app hidden in the tray (close button) / minimised: what the page still does
    const cost = () => p.evaluate(async () => {
      let raf = 0, paints = 0; const R0 = window.requestAnimationFrame;
      window.requestAnimationFrame = function (f) { return R0.call(window, function (t) { raf++; return f(t); }); };
      const cells = window.STRYKER_VELA.context().cells.map((c) => c.chart.renderer.renderer || c.chart.renderer);
      const pd = cells.map((R) => { const f = R.paintData; R.paintData = function () { paints++; return f.apply(this, arguments); }; return f; });
      await new Promise((r) => setTimeout(r, 8000));
      window.requestAnimationFrame = R0; cells.forEach((R, i) => { R.paintData = pd[i]; });
      return { vis: document.visibilityState, rafPerS: Math.round(raf / 8), paintsPerS: Math.round(paints / 8 * 10) / 10 };
    });
    res.shown = await cost();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    await p.waitForTimeout(1500);
    res.hidden = await cost();
    const r2 = procRss(pid); res.hiddenRssMB = { renderer: Math.round(r2.renderer / 1024), gpu: Math.round(r2.gpu / 1024) };
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    await p.waitForTimeout(1500);
    res.reshown = await cost();
    console.log(JSON.stringify(res));
    const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) process.exitCode = 1; };
    if (process.env.TZ_SHOWN !== '0') {
      check(res.shown.paintsPerS > 0, 'shown: charts paint (' + res.shown.paintsPerS + '/s)');
      check(res.hidden.paintsPerS === 0, 'hidden in the tray: no chart paints (' + res.hidden.paintsPerS + '/s)');
      check(res.reshown.paintsPerS > 0, 'shown again: charts paint again (' + res.reshown.paintsPerS + '/s)');
      const fresh = await p.evaluate(() => window.STRYKER_VELA.context().cells.every((c) => (c.chart.renderer.renderer || c.chart.renderer).paintedData));
      check(fresh, 'both charts painted after the window came back');
    }
    if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(res, null, 1));
  } finally { await app.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
