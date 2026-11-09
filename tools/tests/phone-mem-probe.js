// Probe: memory of Neon's layout at phone size over time. Prints JSON lines. Not a pass/fail test.
//   CHART_BASE=http://127.0.0.1:8460 HUB=http://127.0.0.1:8461 flock /tmp/stryker-chrome.lock node tools/tests/phone-mem-probe.js [secs] [out.json]
const fs = require('fs');
const { launch } = require('./lib.js');
const { openPhone, measure } = require('./phone-mem-lib.js');
const SECS = +(process.argv[2] || 120), OUT = process.argv[3];
(async () => {
  const b = await launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const root = process.pid;
  const res = { samples: [] };
  try {
    const { p, cdp, errors, t0 } = await openPhone(b, { base: process.env.CHART_BASE || 'http://127.0.0.1:8460', hub: process.env.HUB || 'http://127.0.0.1:8461', throttle: +(process.env.THROTTLE || 0), w: +(process.env.W || 390), dpr: +(process.env.DPR || 3) });
    await p.waitForFunction(() => window.__stkFirstCandles, null, { timeout: 120000 }).catch(() => {});
    res.firstCandlesMs = Date.now() - t0;
    await p.waitForFunction(() => { try { return window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.chart).length >= 2; } catch (e) { return false; } }, null, { timeout: 120000 }).catch(() => {});
    res.pineHandlesMs = Date.now() - t0;
    // indicators drawn: both Pine scripts have produced a model (no session computing)
    await p.waitForFunction(() => !document.documentElement.classList.contains('stk-pine-busy') && window.__stkHeavyReady, null, { timeout: 180000, polling: 250 }).catch(() => {});
    res.indicatorsDrawnMs = Date.now() - t0;
    // SCROLL=n: scroll back (jump the view to the oldest bar, the same viewport event a drag gives the pager) until n bars are loaded
    if (+process.env.SCROLL) {
      const t1 = Date.now();
      for (let i = 0; i < 60; i++) {
        const n = await p.evaluate(() => { const c = window.STRYKER_VELA.chart, b = c.orchestrator.rawBars, v = c.getVisibleRange(); c.setVisibleRange({ from: b[0].time, to: b[0].time + (v.to - v.from) }); return b.length; });
        if (n >= +process.env.SCROLL) break;
        await p.waitForTimeout(1500);
      }
      res.scrollMs = Date.now() - t1;
      res.scrolledBars = await p.evaluate(() => window.STRYKER_VELA.chart.orchestrator.rawBars.length);
      console.log(JSON.stringify({ scrolledBars: res.scrolledBars, scrollMs: res.scrollMs }));
      await p.waitForFunction(() => !document.documentElement.classList.contains('stk-pine-busy'), null, { timeout: 180000, polling: 500 }).catch(() => {});
      res.scrollPineMs = Date.now() - t1;
    }
    const start = Date.now();
    while (Date.now() - start < SECS * 1000) {
      const m = await measure(b, p, cdp, root);
      m.t = Math.round((Date.now() - t0) / 1000);
      res.samples.push(m);
      console.log(JSON.stringify(m));
      await p.waitForTimeout(Math.min(30000, SECS * 1000 / 6));
    }
    res.errors = errors.slice(0, 5);
  } finally { await b.close(); }
  console.log(JSON.stringify({ scrolledBars: res.scrolledBars, scrollPineMs: res.scrollPineMs, firstCandlesMs: res.firstCandlesMs, pineHandlesMs: res.pineHandlesMs, indicatorsDrawnMs: res.indicatorsDrawnMs, errors: res.errors }));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
})().catch((e) => { console.error(e); process.exit(2); });
