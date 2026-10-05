// Fallback-engine persistence check: a scale.right script (runs on the in-process engine)
// must come back after a reload. CHART_BASE=http://localhost:8041 node tools/tests/chart-pine-fallback.js
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://localhost:8031';
const SRC = '//@version=5\nindicator("Scale right test", overlay=true, scale=scale.right)\nplot(ta.sma(close, 20), "SMA")\n';
(async () => {
  const b = await launch();
  let fail = 0;
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(stub);
    await ctx.route(/^https?:\/\/(?!localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const boot = async () => {
      const p = await ctx.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 40000 });
      await p.waitForTimeout(6000);
      return { p, errs };
    };
    let { p, errs } = await boot();
    const r = await p.evaluate(async (src) => { const c = window.STRYKER_VELA.context().cells[0].chart; const x = await window.STRYKER_PINE.runOnChart(c, src); return { ok: x.ok, engine: x.engine, msg: x.msg || '' }; }, SRC);
    console.log('add', JSON.stringify(r)); if (!r.ok || r.engine !== 'main') fail++;
    const st = await p.evaluate(() => JSON.stringify(window.STRYKER_VELA.getState()));
    const tagged = /"engine":"main"/.test(st); console.log('state tags engine main:', tagged); if (!tagged) fail++;
    await p.waitForTimeout(1500);
    await p.close();
    ({ p, errs } = await boot());
    const on = await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; return window.STRYKER_PINE.pineHandles(c.chart || c).map(window.STRYKER_PINE.titleOf); });
    const pill = await p.evaluate(() => [...document.querySelectorAll('.vela-toast[data-open]')].map((t) => t.textContent));
    console.log('after reload:', JSON.stringify(on), 'pill', JSON.stringify(pill), 'errors', errs.length);
    if (!on.includes('Scale right test') || pill.length || errs.length) fail++;
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
