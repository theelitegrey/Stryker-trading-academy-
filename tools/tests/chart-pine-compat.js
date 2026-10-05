// Pine compatibility sweep: runs every tools/tests/fixtures/pine/compat/*.pine through the
// real Charts engine (worker) on futures:NQ1! 5m and prints OK / the member-facing error.
//   CHART_BASE=http://localhost:8041 node tools/tests/chart-pine-compat.js
// Optional PINETS=<version> overrides the import map's pinets (to compare runtimes).
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const path = require('path');
const BASE = process.env.CHART_BASE || 'http://localhost:8031';
const DIR = path.join(__dirname, 'fixtures', 'pine', 'compat');

(async () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort();
  const b = await launch();
  const out = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(stub);
    await ctx.route(/^https?:\/\/(?!localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 40000 });
    await p.evaluate(() => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol('futures:NQ1!'); c.setTimeframe('5'); });
    await p.evaluate(async () => { for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 400)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 50) return; } catch (e) {} } });
    for (const f of files) {
      const src = fs.readFileSync(path.join(DIR, f), 'utf8');
      const r = await p.evaluate(async (src) => {
        const P = window.STRYKER_PINE;
        const chart = window.STRYKER_VELA.context().cells[0].chart;
        P.pineHandles(chart).forEach((h) => h.remove());
        const res = await P.runOnChart(chart, src);
        let plots = null;
        if (res.ok) {
          await new Promise((r) => setTimeout(r, 400));
          try { const cx = await res.handle.context(['plots']); if (cx && cx.plots) { const ks = Object.keys(cx.plots).filter((k) => !k.startsWith('__')); plots = ks.length + ' plots, values ' + ks.map((k) => cx.plots[k].filter((x) => x && x.value != null && x.value !== false && !Number.isNaN(x.value)).length).join('/'); } } catch (e) {}
        }
        return { ok: res.ok, msg: res.msg || '', line: res.line || null, plots };
      }, src);
      out.push({ file: f, ...r });
      console.log((r.ok ? 'OK   ' : 'FAIL ') + f + (r.ok ? ' (plots ' + r.plots + ')' : ' -> ' + (r.line ? 'Line ' + r.line + ': ' : '') + r.msg));
    }
    // member-facing wording for engine gaps vs typos
    const ex = await p.evaluate(() => [
      window.STRYKER_PINE.explain(new Error('scale is not defined'), '//@version=5\nindicator("x", scale=scale.right)\nplot(close)'),
      window.STRYKER_PINE.explain(new Error('ta.fancything is not a function'), '//@version=5\nindicator("x")\nplot(ta.fancything(close))'),
      window.STRYKER_PINE.explain(new Error('myAverage is not defined'), '//@version=5\nindicator("x")\nplot(myAverage(close))')]);
    ex.forEach((e) => console.log('MSG  Line ' + e.line + ': ' + e.msg));
    await ctx.close();
  } finally { await b.close(); }
  if (process.env.JSON_OUT) fs.writeFileSync(process.env.JSON_OUT, JSON.stringify(out, null, 1));
})();
