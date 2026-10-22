// Pine drawing audit (TradingView look): adds one Pine indicator at a time on the local FIXTURE
// server (tools/tests/chart-fixture-server.mjs, no live data) and screenshots it.
//   CHART_BASE=http://127.0.0.1:8097 IDS=volume-bubbles-quantalgo TFS=1,15 OUT=<dir> W=1440 node tools/tests/chart-pine-tv-style-browser.js
// IDS: built-in ids from chart-pine-builtins.js (default: all). TFS: chart intervals. ZOOM=<bars> visible bars.
// Prints per case the model counts from chart.inspect() and the drawn table/label DOM.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const path = require('path');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8097';
const OUT = process.env.OUT || path.join(require('os').tmpdir(), 'pine-tv-style');
fs.mkdirSync(OUT, { recursive: true });
const TFS = (process.env.TFS || '1').split(',');
const W = +process.env.W || 1440, H = +process.env.H || 900;
const IGNORE = /WebSocket connection to|ERR_FAILED|ERR_CONNECTION|WebGL|GroupMarker|GPU stall|favicon|firebase|Failed to load resource|net::/i;

(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'chart-pine-builtins.js'), 'utf8');
  const all = [...src.matchAll(/\{ id: '([^']+)', name: '([^']+)'/g)].map((m) => [m[1], m[2]]);
  const want = process.env.IDS ? process.env.IDS.split(',') : all.map((x) => x[0]);
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const results = [];
  try {
    const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: W < 500, hasTouch: W < 500 });
    await ctx.addInitScript(stub);
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_community_disclaimer_ack_v1', JSON.stringify({ _anon: 1, u1: 1 })); } catch (e) {} });
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage();
    const errs = [];
    p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text().slice(0, 300)); });
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 60000 });
    for (const tf of TFS) {
      await p.evaluate(([s, t]) => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol(s); c.setTimeframe(t); }, ['futures:NQ1!', tf]);
      const n = await p.evaluate(async () => {
        const chart = window.STRYKER_VELA.context().cells[0].chart;
        for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 500)); try { if (chart.orchestrator.rawBars.length > 50 && chart.orchestrator.historyState !== 'backfill') break; } catch (e) {} }
        return chart.orchestrator.rawBars.length;
      });
      for (const id of want) {
        const name = (all.find((x) => x[0] === id) || [id, id])[1];
        await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; window.STRYKER_PINE.pineHandles(c).forEach((h) => h.remove()); });
        const r = await p.evaluate(async ([id, name]) => {
          const m = await import('/assets/chart-pine-builtins.js?v=' + document.querySelector('meta[name=stryker-build]').content);
          const source = await m.builtinSource(id);
          const chart = window.STRYKER_VELA.context().cells[0].chart;
          const t0 = performance.now();
          try { await window.STRYKER_PINE.addSource(name, source, { engine: 'next', builtin: true }); } catch (e) { return { err: String(e && e.message || e) }; }
          while (performance.now() - t0 < 45000) {
            const hs = window.STRYKER_PINE.pineHandles(chart); const h = hs[hs.length - 1];
            const ind = h && (chart.inspect().indicators || []).find((x) => x.id === h.id);
            const k = ind ? (Object.keys(ind.series || {}).length + (ind.boxes || 0) + (ind.labels || 0) + (ind.lines || 0) + (ind.tables || 0)) : 0;
            if (k > 0) { await new Promise((r) => setTimeout(r, 2500)); const s2 = (chart.inspect().indicators || []).find((x) => x.id === h.id) || ind; return { ms: Math.round(performance.now() - t0), series: Object.keys(s2.series || {}).length, lines: s2.lines, boxes: s2.boxes, labels: s2.labels, tables: s2.tables }; }
            await new Promise((r) => setTimeout(r, 300));
          }
          return { timeout: true };
        }, [id, name]);
        if (process.env.ZOOM) await p.evaluate((z) => { try { const c = window.STRYKER_VELA.context().cells[0].chart; c.setVisibleBars && c.setVisibleBars(+z); } catch (e) {} }, process.env.ZOOM);
        await p.waitForTimeout(800);
        const file = `${OUT}/${id}-NQ-${tf}-${W}.png`;
        await p.screenshot({ path: file });
        console.log(JSON.stringify({ id, tf, bars: n, ...r, file }));
        results.push({ id, tf, bars: n, ...r, file });
      }
    }
    console.log('console errors:', errs.length ? errs.slice(0, 6).join(' | ') : 'none');
    await ctx.close();
  } finally { await b.close(); }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
})();
