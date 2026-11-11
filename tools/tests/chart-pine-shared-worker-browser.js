// RAM round 2: ONE Pine worker shared by every chart cell (assets/chart-pine-next.js hub).
// 2-chart layout: both run Pine on one worker; a broken script on chart 2 does not stop chart 1;
// removing chart 2's scripts (and going back to 1 chart) leaves no session behind.
const { launch } = require('./lib.js');
const { openPhone } = require('./phone-mem-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8190', HUB = process.env.HUB || 'http://127.0.0.1:8191';
let fails = 0; const check = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) fails++; };
const SRC = (n) => `//@version=5\nindicator("shared ${n}", overlay=true)\nplot(ta.sma(close, ${n}))`;
(async () => {
  const b = await launch();
  try {
    const { p } = await openPhone(b, { w: 1440, h: 900, dpr: 2, seed: false, base: BASE, hub: HUB });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 180000, polling: 250 });
    await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('2h')); await p.waitForTimeout(4000);
    const run = (i, src) => p.evaluate(async ([i, src]) => { const c = window.STRYKER_VELA.context().cells[i].chart; let r; try { r = await window.STRYKER_PINE.runOnChart(c, src, undefined, false, { engine: 'next', builtin: true }); } catch (e) { return 'threw ' + (e && e.message); } return r && r.ok ? 'ok' : JSON.stringify(r); }, [i, src]);
    const hub = () => p.evaluate(async () => (await import('/assets/chart-pine-next.js?v=959')).sharedWorkerState());
    const workers = () => p.evaluate(() => performance.getEntriesByType('resource').filter((e) => /chart-pine-next-worker\.js/.test(e.name)).length);
    const plots = (i) => p.evaluate((i) => { const c = window.STRYKER_VELA.context().cells[i].chart; return window.STRYKER_PINE.pineHandles(c).length; }, i);
    for (const [i, sym] of [[0, 'NQ1!'], [1, 'ES1!']]) await p.evaluate(async ([i, sym]) => {
      const ws = window.STRYKER_VELA, c = ws.cell(ws.context().cells[i].id); c.setSymbol('futures:' + sym); c.setTimeframe('1');
      for (let k = 0; k < 150; k++) { await new Promise((r) => setTimeout(r, 200)); const o = c.chart.orchestrator; if (o.config.market.symbol === 'futures:' + sym && o.rawBars.length > 50 && !o.switchingMarket) break; }
    }, [i, sym]);
    await p.waitForFunction(() => window.STRYKER_VELA.context().cells.length === 2 && window.STRYKER_VELA.context().cells.every((c) => c.chart && c.chart.orchestrator && c.chart.orchestrator.rawBars.length > 50), null, { timeout: 90000 }).catch(() => {});
    const r0 = await run(0, SRC(20)); check(r0 === 'ok', 'chart 1 runs a Pine script (' + r0 + ')');
    check((await run(1, SRC(50))) === 'ok', 'chart 2 runs a Pine script');
    let h = await hub(); console.log('  hub', JSON.stringify(h));
    check(h.worker && h.engines === 2 && h.sessions >= 2, 'one shared worker serves both charts');
    const bad = await run(1, '//@version=5\nindicator("bad")\nplot(nosuchfn(close))');
    console.log('  broken script on chart 2:', bad.slice(0, 80));
    await p.waitForTimeout(3000);
    check((await run(0, SRC(30))) === 'ok' && (await plots(0)) >= 2, 'chart 1 still adds and runs scripts after chart 2 errored');
    await p.evaluate(async () => { const c = window.STRYKER_VELA.context().cells[1].chart; for (const hd of window.STRYKER_PINE.pineHandles(c)) { try { c.removeIndicator(hd.id || hd); } catch (e) {} } window.STRYKER_CHART_UI.setLayout('1'); });
    await p.waitForTimeout(5000);
    h = await hub(); console.log('  hub after removing chart 2', JSON.stringify(h));
    const left = await plots(0);
    check(h.sessions === left && left >= 2, `only chart 1's scripts stay on the worker (${h.sessions} sessions, chart 1 has ${left})`);
  } catch (e) { check(false, 'run: ' + (e && e.message)); }
  finally { await b.close(); }
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
