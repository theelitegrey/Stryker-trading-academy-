// Guard (17 Nov GPU/RAM report): the chart's per-tick text updates (inside .vela-cell, tab title, credit line, latency chip) must not
// wake the page-wide MutationObserver helpers (disclaimer, settings, venue logos, draggable, attribution clean) -> no rAF from them.
//   node tools/tests/chart-dev-server.mjs 8071 &   CHART_BASE=http://127.0.0.1:8071 flock /tmp/stryker-chrome.lock node tools/tests/chart-idle-mutation-browser.js
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const bm = require('./binance-mock.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8071';
(async () => {
  const b = await launch({ args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.__helperRaf = 0;
    window.requestAnimationFrame = (cb) => { if (/chart-community-disclaimer|chart-settings|venue-logos|chart-draggable/.test(new Error().stack.split('\n').slice(2, 3).join())) { window.__helperRaf++; (window.__hs = window.__hs || {})[new Error().stack.split('\n')[2].trim()] = 1; } return raf(cb); }; });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)(?!(api\.binance\.com|data-api\.binance\.vision|fapi\.binance\.com|stream\.binance))/, (r) => r.abort());
  await bm.install(ctx);
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_VELA.chart.orchestrator.rawBars.length > 0, null, { timeout: 60000 });
  await p.waitForTimeout(4000);
  const r = await p.evaluate(async () => {
    const cell = document.querySelector('.vela-cell'), s = document.createElement('span'); cell.appendChild(s); await new Promise((r) => setTimeout(r, 300));
    const base = window.__helperRaf;
    for (let i = 0; i < 40; i++) { s.textContent = 'tick ' + i; s.appendChild(document.createElement('b')); await new Promise((r) => setTimeout(r, 20)); }
    const quiet = window.__helperRaf - base;
    const d = document.createElement('div'); d.className = 'stkiw-list'; document.body.appendChild(d); await new Promise((r) => setTimeout(r, 100));
    const woke = window.__helperRaf - base - quiet; d.remove(); s.remove(); await new Promise((r) => setTimeout(r, 50));
    return { quiet, woke, hs: window.__hs };
  });
  console.log((r.quiet === 0 ? 'PASS' : 'FAIL') + ' in-chart tick updates wake no helper observer', r.quiet, JSON.stringify(r.hs));
  console.log((r.woke > 0 ? 'PASS' : 'FAIL') + ' a new dialog list still wakes them', r.woke);
  await b.close(); process.exit(r.quiet === 0 && r.woke > 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
