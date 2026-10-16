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
  await ctx.route(/^https?:\/\/[^/]*(doubleclick|google-analytics|googletagmanager)\./, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 40000 });
  await p.waitForTimeout(5000);
  for (const sym of (process.env.SYMS ? process.env.SYMS.split(',') : ['futures:NQ1!', 'BINANCE:BTCUSDT'])) {
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
    // The Owner's indicator set: Liquidity Master, HTF PO3 Lens, SMT Divergence Pro. HTF PO3 draws its HTF
    // candle stacks to the right of the last bar, so the gap must stay >= the room it needs (pixels).
    await p.evaluate(async (inds) => {
      for (const f of inds) {
        const src = await (await fetch('/assets/pine/' + f + '.pine')).text();
        await window.STRYKER_PINE.addSource(f, src, { engine: 'next', builtin: true });
      }
    }, process.env.IND ? process.env.IND.split(',') : ['htf-po3-lens-stryker']);
    await settle(p, sym, '1');
    await p.waitForTimeout(4000);
    const need = await p.evaluate(() => { const h = window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.chart).find((x) => /HTF PO3/.test(window.STRYKER_PINE.titleOf(x))); const v = h.inputValues(); const step = v.cdlW * 2 + v.cdlGap + 1; let x = v.offsetB; [1, 2, 3, 4, 5].forEach((i) => { if (v['on' + i]) x += v.nCdl * step + v.tfGap; }); return x; });
    const wide = await measure(p);
    const needPx = need * wide.bs * (wide.w / (wide.vis * wide.bs));
    console.log(tag, sym, 'indicators', JSON.stringify(wide), 'needBars', need, 'needPx', Math.round(needPx));
    check(wide.gap >= needPx, `${tag} ${sym} with indicators: gap ${wide.gap}px >= HTF PO3 room ${Math.round(needPx)}px`);
    check(wide.gap / wide.w >= 0.2, `${tag} ${sym} with indicators: right room ${(100 * wide.gap / wide.w).toFixed(0)}% of plot`);
    await p.screenshot({ path: `${OUT}/tfoffset-ind-${tag}-${sym.replace(/\W/g, '')}-1.png` });
    for (const tf of ['5', '15', '60', '1']) {
      await settle(p, sym, tf);
      await p.waitForTimeout(5000); // indicators recompute and may set the margin late
      const m = await measure(p);
      check(m.gap >= needPx && Math.abs(m.gap - wide.gap) <= 3 && Math.abs(m.bs - wide.bs) <= 0.05, `${tag} ${sym} ${tf} with indicators: gap ${m.gap}px (was ${wide.gap}, need ${Math.round(needPx)}) bs ${m.bs}`);
      if (tf === '15') await p.screenshot({ path: `${OUT}/tfoffset-ind-${tag}-${sym.replace(/\W/g, '')}-15.png` });
    }
    await p.evaluate(() => { const R = window.STRYKER_VELA.chart.renderer.renderer; const v = R.coords.getViewport(); R.applyViewport({ barSpacing: v.barSpacing, rightOffset: -60 }); });
    await settle(p, sym, '5');
    await p.waitForTimeout(5000);
    const sb = await measure(p);
    check(sb.gap >= needPx && Math.abs(sb.gap - wide.gap) <= 3, `${tag} ${sym} scrolled back + indicators, then 5m: gap ${sb.gap}px (need ${Math.round(needPx)})`);
    await p.evaluate(() => { window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.chart).forEach((h) => { try { h.remove(); } catch (e) {} }); });
    await p.waitForTimeout(800);
    await p.evaluate(() => { const R = window.STRYKER_VELA.chart.renderer.renderer; const v = R.coords.getViewport(); R.applyViewport({ barSpacing: v.barSpacing, rightOffset: 6 }); });
    // scrolled back in history, then switch: must re-anchor to the latest bar at the default offset
    await p.evaluate(() => { const R = window.STRYKER_VELA.chart.renderer.renderer; const v = R.coords.getViewport(); R.applyViewport({ barSpacing: v.barSpacing, rightOffset: -60 }); });
    await settle(p, sym, '60');
    const s = await measure(p);
    check(s.gap > 4 && Math.abs(s.gap - base.gap) <= 2, `${tag} ${sym} scrolled-back then 1h: re-anchored gap ${s.gap} ~ ${base.gap}`);
    await settle(p, sym, '1');
  }
  check(errors.length === 0, `${tag}: no page errors ${errors.slice(0, 2).join(' | ')}`);
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    if (!process.env.ONLY || process.env.ONLY === 'desk') await run(b, { w: 1440, h: 900, tag: 'desk' });
    if (!process.env.ONLY || process.env.ONLY === 'phone') await run(b, { w: 390, h: 844, mobile: true, tag: 'phone' });
  } finally { await b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
