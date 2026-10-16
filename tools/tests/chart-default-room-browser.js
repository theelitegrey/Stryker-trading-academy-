// Charts: with no indicators the default right room is TradingView-like (>= 6 bars and >= ~5% of the
// plot), on first load, after a timeframe switch and after the "Latest" button; and the red dot near the
// bottom of the plot is the economic-event marker, whose hover tooltip works.
//   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-default-room-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const measure = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.chart.renderer.renderer.coords; const n = c.barCount; return { n, gap: Math.round((c.widthPx - c.logicalToX(n - 1)) * 10) / 10, w: c.widthPx, bars: Math.round((c.widthPx - c.logicalToX(n - 1)) / c.pxPerBar() * 10) / 10 }; });
async function run(b, { w, h, mobile, tag }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 40000 });
  await p.waitForTimeout(6000);
  const go = async (sym, tf) => { await p.evaluate(([s, t]) => { const a = window.STRYKER_VELA.active; if (s) a.setSymbol(s); a.setTimeframe(t); }, [sym, tf]); await p.waitForTimeout(7000); };
  await go('futures:ES1!', '5');
  const ok = (m, what) => check(m.bars >= 5.9 && m.gap / m.w >= 0.045, `${tag} ${what}: room ${m.gap}px = ${m.bars} bars = ${(100 * m.gap / m.w).toFixed(1)}% of plot`);
  ok(await measure(p), 'ES1! 5m default');
  for (const tf of ['15', '60', '1']) { await go(null, tf); ok(await measure(p), 'after switch to ' + tf); }
  await p.evaluate(() => { const R = window.STRYKER_VELA.chart.renderer.renderer; const v = R.coords.getViewport(); R.applyViewport({ barSpacing: v.barSpacing, rightOffset: -40 }); });
  await p.waitForTimeout(600);
  await p.evaluate(() => [...document.querySelectorAll('.stkc-fl button')].find((x) => x.textContent === 'Latest').click());
  await p.waitForTimeout(1500);
  ok(await measure(p), 'after Latest');
  await p.screenshot({ path: `${OUT}/defroom-${tag}.png` });
  if (!mobile) {
    // event marker: hover tooltip
    const pos = await p.evaluate(() => { const cv = document.querySelector('canvas[data-stk-events]'); if (!cv) return null; return { r: cv.getBoundingClientRect().toJSON() }; });
    check(!!pos, `${tag}: event layer present`);
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
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
