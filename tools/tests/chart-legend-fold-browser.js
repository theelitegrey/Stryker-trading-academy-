// Indicator legend folded by default + one-click box first (Owner 2026-11-17).
//   node tools/tests/chart-dev-server.mjs 8061
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8061 node tools/tests/chart-legend-fold-browser.js [shotsDir]
// Checks at 1440 dark + light, 412 and 390: the legend starts as one "Indicators (N)" toggle; the
// paper one-click box sits under the symbol line and the legend starts >= 8 px below it (folded and
// unfolded); unfold/fold is remembered across a reload; one-click off -> the legend moves up.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061', OUT = process.argv[2] || '/tmp/legend-fold';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (ok, m, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + m + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 500))); };
const IND = ['stk_gex', 'stk_l2f_delta', 'stk_l2f_big', 'stk_svp', 'stk_of_cvd'];   // + Volume = 6

// Geometry of the top-left stack in cell 0.
const geo = (p) => p.evaluate(() => {
  const host = window.STRYKER_VELA.context().cells[0].chart.orchestrator.renderer.inputsUI;
  const R = (e) => { if (!e || !e.isConnected) return null; const r = e.getBoundingClientRect(); return r.height ? { l: Math.round(r.left * 10) / 10, t: Math.round(r.top * 10) / 10, b: Math.round(r.bottom * 10) / 10, h: Math.round(r.height * 10) / 10, cy: Math.round((r.top + r.bottom) * 5) / 10 } : null; };
  const f = host.foldToggle, cell = f && f.closest('.vela-cell') || document;
  const rows = [...host.rows.values()].filter((r) => r.paneId === 'price').map((r) => R(r.el)).filter(Boolean);
  const oc = document.querySelector('.stkpt-1c'), sl = cell.querySelector('.vela-statusline');
  const kids = f ? [...f.children].map((k) => R(k)) : [];
  return { fold: R(f), foldText: f ? f.textContent : null, expanded: f ? f.getAttribute('aria-expanded') : null, rows, oc: R(oc), sl: R(sl), kids, store: localStorage.getItem('stk_legend_open_v1'), n: host.rows.size };
});
const legendTop = (g) => Math.min(...[g.fold && g.fold.t].concat(g.rows.map((r) => r.t)).filter((x) => x != null));

async function open(b, w, h, mobile, theme) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { window.__stkL2Test = { base: 'http://127.0.0.1:9', trades: true };
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_community_disclaimer_ack_v1', JSON.stringify({ _anon: 1, u1: 1 })); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await load(p);
  return { ctx, p, errors };
}
async function load(p, reload) {
  if (reload) await p.reload({ waitUntil: 'domcontentloaded' }); else await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.__stkPaper && window.__stkPaper.account, null, { timeout: 60000 });
  await sleep(1500);
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [412, 915, true, 'dark'], [390, 844, true, 'dark']]) {
      const tag = w + '-' + theme;
      const { ctx, p, errors } = await open(b, w, h, mobile, theme);
      await p.evaluate(async (ind) => {
        const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:MNQ1!'); ws.active.setTimeframe('5');
        await new Promise((r) => setTimeout(r, 4000));
        window.__stkPaper.setEnabled(true); window.__stkPaper.account.settings.oneClick = true;
        const ch = ws.context().cells[0].chart;
        for (const t of ind) if (!ch.indicators().some((x) => x.nativeType === t)) ch.addNativeIndicator(t, { inputs: {} });
        ws.context().stateChanged(); window.__stkPaper.pushLines(true);
      }, IND);
      await sleep(5000);
      let g = await geo(p);
      check(g.n >= 6 && g.foldText === 'Indicators (' + g.n + ')' && g.expanded === 'false', tag + ': folded by default, one toggle row', { n: g.n, t: g.foldText, e: g.expanded });
      check(g.rows.length === 0, tag + ': no indicator rows showing while folded', g.rows.length);
      check(!!g.oc && !!g.sl && g.oc.t >= g.sl.b, tag + ': one-click box right under the symbol line', { oc: g.oc, sl: g.sl });
      check(!!g.oc && legendTop(g) >= g.oc.b + 8 - 0.5, tag + ': folded legend top >= one-click bottom + 8', { legend: legendTop(g), oc: g.oc && g.oc.b });
      const cys = g.kids.map((k) => k && k.cy);
      check(g.fold && cys.every((c) => Math.abs(c - g.fold.cy) <= 1), tag + ': toggle icon + label share one centre (±1)', { fold: g.fold, cys });
      console.log('MEASURE ' + tag + ' folded ' + JSON.stringify({ sl: g.sl, oc: g.oc, fold: g.fold, gap: g.fold && g.oc ? Math.round((g.fold.t - g.oc.b) * 10) / 10 : null, kids: g.kids }));
      await p.screenshot({ path: OUT + '/fold-' + tag + '-collapsed.png', clip: { x: 0, y: 0, width: Math.min(w, 520), height: 320 } });

      await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.orchestrator.renderer.inputsUI.foldToggle.click());
      await sleep(2600);   // the one-click pass (2 s) re-measures
      g = await geo(p);
      check(g.expanded === 'true' && g.rows.length >= 5 && g.store === '1', tag + ': click unfolds every row, choice stored', { e: g.expanded, rows: g.rows.length, s: g.store });
      check(!!g.oc && legendTop(g) >= g.oc.b + 8 - 0.5, tag + ': unfolded legend top >= one-click bottom + 8', { legend: legendTop(g), oc: g.oc && g.oc.b });
      console.log('MEASURE ' + tag + ' unfolded ' + JSON.stringify({ oc: g.oc, firstRow: g.rows[0], gap: g.oc ? Math.round((legendTop(g) - g.oc.b) * 10) / 10 : null, fold: g.fold }));
      await p.screenshot({ path: OUT + '/fold-' + tag + '-expanded.png', clip: { x: 0, y: 0, width: Math.min(w, 520), height: Math.min(h, 420) } });

      if (theme === 'dark') {
        await p.evaluate(() => window.STRYKER_VELA.context().stateChanged()); await sleep(3000);
        await load(p, true);
        await p.waitForFunction(() => { try { return !!window.STRYKER_VELA.context().cells[0].chart.orchestrator.renderer.inputsUI.foldToggle; } catch (e) { return false; } }, null, { timeout: 30000 }).catch(() => {});
        await sleep(3000);
        g = await geo(p);
        check(g.expanded === 'true' && g.rows.length >= 5, tag + ': unfolded state kept after reload', { e: g.expanded, rows: g.rows.length });
        await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.orchestrator.renderer.inputsUI.foldToggle.click());
        await sleep(600);
        g = await geo(p);
        check(g.expanded === 'false' && g.rows.length === 0 && g.store === '0', tag + ': click again folds, choice stored', { e: g.expanded, s: g.store });
        // one-click off -> the legend moves up under the symbol line
        await sleep(2500);
        const before = legendTop(await geo(p));
        await p.evaluate(() => { window.__stkPaper.account.settings.oneClick = false; window.__stkPaper.pushLines(true); });
        await sleep(800);
        g = await geo(p);
        check(!g.oc && legendTop(g) < before - 20 && legendTop(g) >= g.sl.b + 8 - 0.5, tag + ': one-click off -> legend moves up under the symbol line', { before, after: legendTop(g), sl: g.sl && g.sl.b });
        await p.screenshot({ path: OUT + '/fold-' + tag + '-oneclick-off.png', clip: { x: 0, y: 0, width: Math.min(w, 520), height: 240 } });
        await p.evaluate(() => { window.__stkPaper.account.settings.oneClick = true; window.__stkPaper.pushLines(true); });
      }
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      check(sw <= w, tag + ': no sideways overflow', sw);
      check(errors.length === 0, tag + ': no page errors', errors.slice(0, 3));
      await ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
