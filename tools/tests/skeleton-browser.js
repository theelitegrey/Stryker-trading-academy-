// Skeleton loading test. Holds Firestore reads (and the screener's data fetch) open, asserts a skeleton shows
// with aria-busy where the container is marked, then releases and asserts it is gone and aria-busy cleared.
//   flock /tmp/stryker-chrome.lock node tools/tests/skeleton-browser.js [shotsDir]
const R = require('./bt-rig.js');
const PW = (process.env.SHOT_ONLY || '').split(',').filter(Boolean);
const fs = require('fs');
const OUT = process.argv[2]; if (OUT) fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

// every Firestore get()/onSnapshot waits for window.__release()
const hold = () => {
  let rel; window.__held = new Promise((r) => { rel = r; }); window.__release = () => rel();
  const prox = (o) => new Proxy(o, {
    get(t, k) {
      const v = t[k];
      if (k === 'get' && typeof v === 'function') return (...a) => window.__held.then(() => v.apply(t, a));
      if (typeof v === 'function') return (...a) => { const r = v.apply(t, a); return r && typeof r === 'object' && !r.then ? prox(r) : r; };
      return v;
    }
  });
  const wait = setInterval(() => { if (window.__stubDb && !window.__stubDb.__p) { window.__stubDb.__p = 1; const c = window.__stubDb.collection, d = window.__stubDb.doc; window.__stubDb.collection = (p) => (/^students/.test(p) ? c(p) : prox(c(p))); window.__stubDb.doc = (p) => (/^students/.test(p) ? d(p) : prox(d(p))); clearInterval(wait); } }, 0);
};

// CHART_BASE = chart-fixture-server (tools/tests/chart-fixture-server.mjs <port> <bars.json>) so Charts paints real bars.
const FX = process.env.CHART_BASE || '';
const PAGES = [
  { name: 'dashboard', url: '/dashboard-user.html', sel: '.skel-gate.sg-dashboard' },
  { name: 'journal', url: '/trade-journal.html', sel: '.skel-gate.sg-journal', inner: '#jh-list .skel-wrap', busy: '#jh-list' },
  { name: 'screener', url: '/scanner.html', sel: '.skel-gate.sg-screener', inner: '#scn-root .skel-wrap', busy: '#scn-root', route: /book-recorder/ },
  { name: 'gex', url: '/gex.html', sel: '.skel-gate.sg-gex' },
  { name: 'charts', url: '/charts.html', sel: '.skel-gate.sg-charts', fx: true },
];
const seen = (s) => [...document.querySelectorAll(s)].some((e) => getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().height > 0 && e.offsetParent !== null);

(async () => {
  const srv = await R.serve(); const b = await R.launch();
  const sizes = [['390', 'phone', 'dark'], ['390', 'phone', 'light'], ['1440', 'desktop', 'dark']];
  for (const [w, dev, theme] of sizes) {
    for (const pg of PAGES) {
            if (PW.length && !PW.includes(pg.name)) continue;
      const base = pg.fx && FX ? FX : srv.base;
      const { ctx, p, errors } = await R.page(b, { base }, dev, `(${hold})(); try{localStorage.setItem('stryker_theme','${theme === 'light' ? 'day' : 'night'}')}catch(e){}`);
      let rel;
      if (pg.route) { const held = new Promise((r) => { rel = r; }); await p.route(pg.route, async (r) => { await held; r.abort().catch(() => {}); }); }
      await p.goto(base + pg.url, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(900);
      const tag = `${pg.name} ${w} ${theme}`;
      check(await p.evaluate(seen, pg.sel), `${tag}: page skeleton (${pg.sel}) visible while loading`);
      if (OUT) await p.screenshot({ path: `${OUT}/${pg.name}-${w}-${theme}-loading.png` });
      if (pg.name === 'journal') { await p.evaluate(() => window.__release && window.__release()); await p.waitForTimeout(1500); if (OUT) await p.screenshot({ path: `${OUT}/${pg.name}-${w}-${theme}-loaded.png` }); await p.evaluate(() => document.querySelector('[data-tab="history"]').click()); await p.waitForTimeout(1200); }
      await p.evaluate(() => window.__release && window.__release()); if (rel) rel();
      if (pg.fx) {
        // default symbol is a Binance crypto feed (blocked offline); switch to the fixture-served NQ so real bars paint
        await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 40000 }).catch(() => {});
        await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol('NQ1!'); c.setTimeframe('15'); }).catch(() => {});
        await p.waitForFunction(() => { try { return window.STRYKER_VELA.chart.orchestrator.rawBars.length > 50; } catch (e) { return false; } }, null, { timeout: 30000 }).catch(() => {});
      }
      await p.waitForTimeout(pg.fx ? 3000 : 2500);
      check(!(await p.evaluate(seen, pg.sel)), `${tag}: page skeleton gone after data`);
      if (pg.fx) check(await p.evaluate(() => !document.getElementById('stkchart-skel')), `${tag}: chart overlay skeleton gone after first bars`);
      if (pg.busy) {
        const st = await p.evaluate((s) => ({ busy: document.querySelector(s.busy).hasAttribute('aria-busy'), skel: !!document.querySelector(s.inner) }), pg);
        check(!st.busy && !st.skel, `${tag}: inner skeleton gone + aria-busy cleared (busy=${st.busy} skel=${st.skel})`);
      }
      if (OUT && pg.name !== 'journal') await p.screenshot({ path: `${OUT}/${pg.name}-${w}-${theme}-loaded.png` });
      check(!errors.some((e) => /skel/i.test(e)), `${tag}: no skeleton JS errors`);
      await ctx.close();
    }
  }
  await b.close(); srv.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
