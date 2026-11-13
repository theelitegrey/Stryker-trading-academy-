// Regression: Sessions Volume Profile must draw + follow the CURRENT session on a live futures chart.
// Stub: synthetic 1m NQ bars up to now + a mock /ts-live socket sending ticks. Checks the newest
// session shows profile pixels and that its profile changes when live ticks move price.
//   python3 -m http.server 8093 (in the repo)
//   STRYKER_TEST_BASE=http://127.0.0.1:8093 NODE_PATH=<repo>/node_modules \
//     flock /tmp/stryker-chrome.lock node tools/tests/chart-svp-live-browser.js <shotsDir> [tag]
const { launch, BASE } = require('./lib.js');
const stub = require('./richstub.js');
const OUT = process.argv[2] || '/tmp/svp', TAG = process.argv[3] || '';
require('fs').mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
(async () => {
  const b = await launch();
  try {
    for (const z of [{ w: 1440, h: 900, theme: 'dark', tag: '1440-dark' }, { w: 1440, h: 900, theme: 'day', tag: '1440-light' }, { w: 390, h: 800, theme: 'dark', tag: '390-dark', mobile: true }]) {
      const nowMin = Math.floor(Date.now() / 60000);
      let px = 20000, seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const bars = [];
      for (let m = nowMin - 36 * 60; m < nowMin; m++) { const o = px; px += (rnd() - 0.5) * 6; const hi = Math.max(o, px) + rnd() * 2, lo = Math.min(o, px) - rnd() * 2; bars.push([m * 60, o, hi, lo, px, 50 + Math.floor(rnd() * 400)]); }
      const last = px;
      const ctx = await b.newContext({ viewport: { width: z.w, height: z.h }, deviceScaleFactor: 1, isMobile: !!z.mobile, hasTouch: !!z.mobile });
      await ctx.addInitScript(stub);
      await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t); localStorage.removeItem('stryker.vela.session'); } catch (e) {} window.__stkL2Test = { base: 'http://127.0.0.1:9', trades: true }; }, z.theme);
      await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
      await ctx.route(/\/api\/chart\/rt/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"admin":true}' }));
      await ctx.route(/\/api\/chart\/bars\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars, rt: true }) }));
      let bump = 0;
      await ctx.routeWebSocket(/\/ts-live/, (ws) => {
        ws.send(JSON.stringify({ event: 'status', state: 'live' }));
        const tick = () => { ws.send(JSON.stringify({ type: 'ticks', symbol: 'NQ', t: [[last + bump, 5, 1, Date.now()]] })); ws.send(JSON.stringify({ event: 'ping', state: 'live' })); setTimeout(tick, 250); };
        tick();
      });
      const p = await ctx.newPage(); const errors = [];
      p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(BASE + '/charts.html?symbol=' + encodeURIComponent('futures:NQ1!') + '&tf=1', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
      await p.evaluate(async () => { window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true }; for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.active.chart.orchestrator.rawBars.length > 100) return; } catch (e) {} } });
      await p.evaluate(async () => { const c = window.STRYKER_VELA.active; c.setTimeframe('1'); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 400)); if (c.timeframe === '1' && c.inner.orchestrator.rawBars.length > 100) break; } });
      await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator('stk_svp'));   // default inputs, like the member
      await sleep(2000);
      const probe = () => p.evaluate(() => {
        let n = 0, sig = 0;
        for (const cv of document.querySelectorAll('#vela-chart canvas')) {
          const g = cv.getContext('2d'); if (!g) continue;
          let d; try { d = g.getImageData(0, 0, cv.width, cv.height).data; } catch (e) { continue; }
          for (let i = 0; i < d.length; i += 4) { const R = d[i], G = d[i + 1], B = d[i + 2], A = d[i + 3];
            if (A > 40 && B - R > 25 && B > G + 8 && B > 90) { n++; sig = (sig * 31 + i) % 1000003; } }
        }
        return { n, sig };
      });
      const a = await probe();
      await p.screenshot({ path: `${OUT}/${TAG}${z.tag}.png` });
      bump = 60; await sleep(2500);
      const c = await probe();
      await p.screenshot({ path: `${OUT}/${TAG}${z.tag}-after-ticks.png` });
      check(a.n > (z.mobile ? 30 : 150), z.tag + ' SVP draws the current session', a);
      check(c.sig !== a.sig, z.tag + ' newest-session profile changes when live ticks move price', { a, c });
      check(!errors.length, z.tag + ' no page errors', errors.slice(0, 2));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'all ok'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
