// Regression: every custom canvas-layer indicator must draw nothing while hidden, redraw when shown.
//   node tools/tests/chart-dev-server.mjs 8041 &   CHART_BASE=http://127.0.0.1:8041 node tools/tests/chart-layer-hide-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8041';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
// [type, inputs]; every type here owns a renderer layer whose channel id is the type
const TYPES = (process.env.ONLY ? process.env.ONLY.split(',') : ['stk_vbubble', 'stk_footprint', 'stk_of_big', 'stk_of_vp', 'stk_svp', 'stk_vheatmap', 'stk_of_tpo', 'stk_of_sweep', 'stk_of_evr', 'stk_estcvd']);
async function open(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.setItem('stryker_theme', 'night'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(2000);
  return { ctx, p, errors };
}
// painted pixels of the indicator's own layer canvas (0 when absent / 0x0)
const ink = (p, type) => p.evaluate((t) => {
  const ch = window.STRYKER_VELA.context().cells[0].chart; const r = ch.renderer && ch.renderer.extLayers ? ch.renderer : ch.renderer.renderer;
  let best = 0, seen = 0;
  for (const l of r.extLayers) { if (l.channel !== t || !l.canvas.width) continue; seen++; const d = l.canvas.getContext('2d').getImageData(0, 0, l.canvas.width, l.canvas.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; best = Math.max(best, n); }
  return best;
}, type);
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, tag] of [[1440, 900, false, '1440'], [390, 844, true, '390']]) {
      const { ctx, p, errors } = await open(b, { w, h, mobile });
      await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('5'); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); if (ws.chart.orchestrator.rawBars.length > 50) break; } });
      for (const t of TYPES) {
        const hs = await p.evaluate((t) => { const c = window.STRYKER_VELA.context().cells[0].chart; try { c.addNativeIndicator(t, { inputs: t === 'stk_vbubble' ? { threshold: 1.01, lookback: 5 } : {} }); } catch (e) { return 'ERR ' + e; } window.STRYKER_VELA.context().stateChanged(); return 'ok'; }, t);
        await sleep(2500);
        const before = await ink(p, t);
        // types with no data in the plain fixture (they need a trade/book feed; covered in chart-l2-flow-browser.js) are skipped, but the three that must draw here may not be
        if (hs !== 'ok' || before === 0) { const must = ['stk_vbubble', 'stk_vheatmap', 'stk_of_tpo'].includes(t); if (must) check(false, `${tag} ${t}: draws when shown (px ${before}) ${hs}`); else console.log(`SKIP ${tag} ${t}: no data in fixture`); continue; }
        const set = (v) => p.evaluate(([t, v]) => { const c = window.STRYKER_VELA.context().cells[0].chart; const h = (c.indicators() || []).find((x) => x.nativeType === t); h.setVisible(v); }, [t, v]);
        await set(false); await sleep(1200);
        const hid = await ink(p, t);
        if (t === 'stk_vbubble') await p.screenshot({ path: `${OUT}/${tag}-hidden.png` });
        await set(true); await sleep(1200);
        const back = await ink(p, t);
        if (t === 'stk_vbubble') await p.screenshot({ path: `${OUT}/${tag}-shown.png` });
        check(hid === 0, `${tag} ${t}: hidden leaves no pixels (shown ${before}, hidden ${hid})`, hid);
        check(back > 0, `${tag} ${t}: shown again draws (${back})`, back);
        await p.evaluate((t) => { const c = window.STRYKER_VELA.context().cells[0].chart; const h = (c.indicators() || []).find((x) => x.nativeType === t); h.remove && h.remove(); }, t);
        await sleep(300);
      }
      check(errors.length === 0, tag + ': no page errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
