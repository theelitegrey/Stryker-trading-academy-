// Admin-only "Hide replay markings" (Owner 2026-10-16). flock /tmp/stryker-chrome.lock node tools/tests/chart-replay-hide-browser.js [shotsDir]
// Reuses the harness of chart-bar-replay-browser.js by loading it as text would be heavy; this one is lean:
// charts.html with the shared stub, bars endpoint mocked, admin stubbed via StrykerPineLibrary.isAdmin.
const http = require('http'), fs = require('fs'), path = require('path');
const { launch, ROOT } = require('./lib.js');
const stub = require('./richstub.js');
const OUT = process.argv[2] || '/tmp';
const MIN = 60000; let fail = 0;
const check = (ok, m) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp' };
function serve() { return new Promise((res) => { const s = http.createServer((q, r) => { const u = new URL(q.url, 'http://x'); let p = path.join(ROOT, decodeURIComponent(u.pathname)); if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html'); if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html'; if (!fs.existsSync(p)) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }); s.listen(0, '127.0.0.1', () => res(s)); }); }
const m1 = (i) => { const o = 21000 + 20 * Math.sin(i / 37), c = 21000 + 20 * Math.sin((i + 1) / 37); return [o, Math.max(o, c) + 2, Math.min(o, c) - 2, c]; };
async function run(b, BASE, admin, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((admin) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
    if (admin) { const iv = setInterval(() => { if (window.StrykerPineLibrary) { window.StrykerPineLibrary.isAdmin = () => Promise.resolve(true); clearInterval(iv); } }, 20); } }, admin);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/\/api\/chart\/bars\//, (route) => {
    const u = new URL(route.request().url()); const tf = u.searchParams.get('tf') || '1';
    const step = ({ '1': 1, '5': 5, '15': 15, '60': 60, D: 1440 }[tf] || 1) * MIN; const now = Date.now(); const bars = [];
    for (let t = Math.floor((now - 2 * 86400000) / step) * step; t < now; t += step) { const [o, hh, l, c] = m1(Math.floor(t / MIN)); bars.push([t / 1000, o, hh, l, c, 100]); }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf, page: 0, bars }) });
  });
  await ctx.routeWebSocket(/\/api\/chart\/stream\//, (ws) => { ws.send(JSON.stringify({ event: 'connected' })); });
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkBarReplay && window.__stkSettings, null, { timeout: 40000 }).catch(async (e) => { console.log(await p.evaluate(() => JSON.stringify({ h: !!window.__stkHeavyReady, v: !!window.STRYKER_VELA, c: !!(window.STRYKER_VELA && window.STRYKER_VELA.chart), r: !!window.__stkBarReplay, s: !!window.__stkSettings }))); throw e; });
  await sleep(2500);
  return { ctx, p, errors };
}
const vis = (p) => p.evaluate(() => { const v = (s) => [...document.querySelectorAll(s)].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; }); return { bar: v('.stkr-bar'), badge: v('.stkr-badge'), dd: v('.stkc-dd[data-s="replay"]'), dot: v('#stkr-rhdot') }; });
(async () => {
  const srv = await serve(); const BASE = 'http://127.0.0.1:' + srv.address().port;
  const b = await launch({ args: ['--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  try {
    // non-admin: no option
    { const { ctx, p } = await run(b, BASE, false, 1440, 900);
      await p.evaluate(() => window.STRYKER_VELA.chart.renderer.openSettings());
      await p.waitForSelector('.vela-dialog--settings'); await sleep(800);
      const t = await p.evaluate(() => document.querySelector('.vela-dialog--settings').textContent);
      check(!/Hide replay markings/.test(t), 'non-admin: option not in settings');
      check(await p.evaluate(() => window.__stkIsAdmin !== true), 'non-admin flag false');
      await ctx.close(); }
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const { ctx, p, errors } = await run(b, BASE, true, w, h);
      check(await p.evaluate(() => window.__stkIsAdmin === true), w + ': admin flag set via isAdmin()');
      await p.evaluate(() => window.STRYKER_VELA.chart.renderer.openSettings());
      await p.waitForSelector('.vela-dialog--settings'); await sleep(500);
      // go to the Canvas tab
      await p.evaluate(() => { const t = [...document.querySelectorAll('.vela-sd-tab')].find((x) => x.textContent === 'Canvas'); t && t.click(); });
      await sleep(400);
      const has = await p.evaluate(() => /Hide replay markings \(admin\)/.test(document.querySelector('.vela-dialog--settings').textContent));
      check(has, w + ': admin sees the option');
      await p.evaluate(() => window.STRYKER_VELA.chart.renderer.closeDialogs());
      await p.evaluate(() => window.__stkBarReplay.startRandom());
      await p.waitForFunction(() => window.__stkBarReplay.state.on, null, { timeout: 20000 }); await sleep(1500);
      let v = await vis(p);
      check(v.bar && v.dd, w + ': replay on, markings visible ' + JSON.stringify(v));
      await p.screenshot({ path: path.join(OUT, `rh-${w}-markings.png`) });
      await p.evaluate(() => window.__stkSettings.setReplayHide(true)); await sleep(500);
      v = await vis(p);
      check(!v.bar && !v.badge && !v.dd && v.dot, w + ': hidden ON, no markings, corner dot there ' + JSON.stringify(v));
      check(await p.evaluate(() => document.documentElement.hasAttribute('data-stk-rh')), w + ': attr set');
      await p.screenshot({ path: path.join(OUT, `rh-${w}-hidden.png`) });
      if (w > 500) {
        const E0 = await p.evaluate(() => window.__stkBarReplay.state.E);
        await p.keyboard.press('Shift+ArrowRight'); await sleep(1200);
        const E1 = await p.evaluate(() => window.__stkBarReplay.state.E);
        check(E1 > E0, 'Shift+Right steps while hidden');
        await p.keyboard.press('Space'); await sleep(600);
        check(await p.evaluate(() => window.__stkBarReplay.state.playing), 'Space plays while hidden');
        await p.keyboard.press('Space'); await sleep(400);
        check(!(await p.evaluate(() => window.__stkBarReplay.state.playing)), 'Space pauses');
        await p.keyboard.press('Shift+ArrowLeft'); await sleep(1200);
        check(await p.evaluate(() => window.__stkBarReplay.state.E) <= E1, 'Shift+Left steps back');
        await p.keyboard.press('Shift+H'); await sleep(400);
        v = await vis(p); check(v.bar && v.badge && v.dd && !v.dot, 'Shift+H brings markings back ' + JSON.stringify(v));
        await p.screenshot({ path: path.join(OUT, `rh-${w}-shiftH-back.png`) });
        await p.keyboard.press('Shift+H'); await sleep(400);
        v = await vis(p); check(!v.bar && !v.badge, 'Shift+H hides again');
        await p.keyboard.press('Shift+X'); await sleep(1500);
        check(!(await p.evaluate(() => window.__stkBarReplay.state.on)), 'Shift+X exits replay while hidden');
        check(await p.evaluate(() => !document.documentElement.hasAttribute('data-stk-rh')), 'live chart: no hide attr after exit');
        check(await p.evaluate(() => localStorage.getItem('stryker_replay_hide') === '1'), 'setting persisted locally');
      } else {
        await p.click('#stkr-rhdot'); await sleep(500);
        v = await vis(p); check(v.bar && !v.dot, '390: corner dot brings markings back ' + JSON.stringify(v));
        await p.screenshot({ path: path.join(OUT, `rh-${w}-dot-back.png`) });
      }
      check(errors.length === 0, w + ': no page errors ' + errors.slice(0, 2).join(' | '));
      await ctx.close();
    }
  } finally { await b.close(); srv.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
