// Charts: a timeframe / symbol switch keeps the right margin (gap between the newest bar and the
// price axis) and the zoom (bar spacing), TradingView-style. Needs network (Yahoo + Binance) and
// tools/tests/chart-dev-server.mjs.
//   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-tf-switch-offset-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

const measure = (p) => p.evaluate(() => {
  const ws = window.STRYKER_VELA; const R = ws.chart.renderer.renderer; const c = R.coords; const vp = c.getViewport();
  const n = c.barCount; const gap = c.widthPx - c.logicalToX(n - 1);
  const vis = Math.round(c.widthPx / c.pxPerBar());
  return { sym: ws.chart.market.symbol, tf: ws.chart.market.timeframe, n, gap: Math.round(gap * 10) / 10, ro: Math.round(vp.rightOffset * 100) / 100, bs: Math.round(vp.barSpacing * 100) / 100, vis, w: c.widthPx };
});
const settle = (p, sym, tf) => p.evaluate(async ([sym, tf]) => {
  const ws = window.STRYKER_VELA; const chart = ws.chart;
  if (sym) ws.active.setSymbol(sym); if (tf) ws.active.setTimeframe(tf);
  for (let i = 0; i < 50; i++) { await new Promise((r) => setTimeout(r, 400)); if ((!sym || chart.market.symbol === sym) && (!tf || chart.market.timeframe === tf) && chart.orchestrator.historyState !== 'backfill' && chart.orchestrator.rawBars.length) break; }
  await new Promise((r) => setTimeout(r, 3500)); // late tail / stream / prefetch / lazy modules
}, [sym, tf]);

async function run(b, { w, h, mobile, tag }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', 'day'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance|stream\.binance|data-api\.binance|fapi\.binance)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 40000 });
  await p.waitForTimeout(5000);
  for (const sym of ['futures:NQ1!', 'BINANCE:BTCUSDT']) {
    await settle(p, sym, '1');
    const base = await measure(p);
    console.log(tag, sym, 'first', JSON.stringify(base));
    check(base.gap > 4, `${tag} ${sym} first load: gap ${base.gap}px > 0`);
    for (const tf of ['5', '15', '60', 'D', '1']) {
      await settle(p, sym, tf);
      const m = await measure(p);
      console.log(tag, sym, tf, JSON.stringify(m));
      check(m.gap > 4, `${tag} ${sym} ${tf}: gap ${m.gap}px > 0`);
      check(Math.abs(m.gap - base.gap) <= 2, `${tag} ${sym} ${tf}: gap ${m.gap} == ${base.gap}`);
      check(Math.abs(m.bs - base.bs) <= 0.05, `${tag} ${sym} ${tf}: bar spacing ${m.bs} == ${base.bs}`);
      check(Math.abs(m.vis - base.vis) <= 2, `${tag} ${sym} ${tf}: visible bars ${m.vis} ~ ${base.vis}`);
      if (tf === '15' || tf === 'D') await p.screenshot({ path: `${OUT}/tfoffset-${tag}-${sym.replace(/\W/g, '')}-${tf}.png` });
    }
    // an indicator's wider right margin (TZ Fractal asks for 24 bars) must also survive switches
    await p.evaluate(async () => { const src = await (await fetch('/assets/pine/tz-fractal-model.pine')).text(); await window.STRYKER_PINE.addSource('tz-fractal-model', src, { engine: 'next', builtin: true, rightOffset: 24 }); });
    await settle(p, sym, '1');
    const wide = await measure(p);
    check(wide.ro === 24, `${tag} ${sym} indicator margin applied (ro ${wide.ro})`);
    for (const tf of ['5', '60', '1']) {
      await settle(p, sym, tf);
      const m = await measure(p);
      check(m.ro === 24 && Math.abs(m.gap - wide.gap) <= 2 && Math.abs(m.bs - wide.bs) <= 0.05, `${tag} ${sym} ${tf} with indicator: ro ${m.ro} gap ${m.gap} (was ${wide.gap})`);
    }
    await p.evaluate(() => { window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.chart).forEach((h) => { try { h.remove(); } catch (e) {} }); });
    await p.waitForTimeout(500);
    await p.evaluate(() => { const R = window.STRYKER_VELA.chart.renderer.renderer; const v = R.coords.getViewport(); R.applyViewport({ barSpacing: v.barSpacing, rightOffset: 6 }); });
    // scrolled back in history, then switch: must re-anchor to the latest bar at the default offset
    await p.evaluate(() => { const R = window.STRYKER_VELA.chart.renderer.renderer; const v = R.coords.getViewport(); R.applyViewport({ barSpacing: v.barSpacing, rightOffset: -60 }); });
    await settle(p, sym, '5');
    const s = await measure(p);
    check(s.gap > 4 && Math.abs(s.gap - base.gap) <= 2, `${tag} ${sym} scrolled-back then 5m: re-anchored gap ${s.gap} ~ ${base.gap}`);
    await settle(p, sym, '1');
  }
  check(errors.length === 0, `${tag}: no page errors ${errors.slice(0, 2).join(' | ')}`);
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    await run(b, { w: 1440, h: 800, tag: 'desk' });
    await run(b, { w: 390, h: 844, mobile: true, tag: 'phone' });
  } finally { await b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
