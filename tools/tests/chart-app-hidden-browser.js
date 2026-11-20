// Windows app hidden in the tray / minimised = no chart paints (assets/vela-chart.js holdWhenHidden, member GK 20 Nov).
// Opens charts.html with a stand-in window.tzDesktop.onShown (what desktop/src/preload.js exposes), then:
// shown -> charts paint on live ticks; hidden -> zero paints; shown again -> one catch-up paint and painting resumes.
// Without tzDesktop (a browser) nothing changes. Needs the fixture servers:
//   TE_ALLSYM=1 python3 tools/tests/tick-engine-hub.py 8191 &  node tools/tests/chart-dev-server.mjs 8190 &
//   CHART_BASE=http://127.0.0.1:8190 HUB=http://127.0.0.1:8191 flock /tmp/stryker-chrome.lock node tools/tests/chart-app-hidden-browser.js
const { launch } = require('./lib.js');
const { openPhone } = require('./phone-mem-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8190', HUB = process.env.HUB || 'http://127.0.0.1:8191';
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

// futures NQ1! 1m on the fixture lane (the rig serves no crypto)
async function ready(p) {
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 180000, polling: 250 });
  await p.evaluate(async () => {
    const ws = window.STRYKER_VELA, c = ws.cell(ws.context().cells[0].id);
    c.setSymbol('futures:NQ1!'); c.setTimeframe('1');
    for (let k = 0; k < 150; k++) { await new Promise((r) => setTimeout(r, 200)); const o = c.chart.orchestrator; if (o.config.market.symbol === 'futures:NQ1!' && o.rawBars.length > 50 && !o.switchingMarket) break; }
  });
}
const paintsIn = (p, ms) => p.evaluate(async (ms) => {
  const cells = window.STRYKER_VELA.context().cells.map((c) => c.chart.renderer.renderer || c.chart.renderer);
  let n = 0; const keep = cells.map((R) => { const f = R.paintData; R.paintData = function () { n++; return f.apply(this, arguments); }; return f; });
  await new Promise((r) => setTimeout(r, ms));
  cells.forEach((R, i) => { R.paintData = keep[i]; });
  return n;
}, ms);

(async () => {
  const b = await launch();
  try {
    // app: tzDesktop present before any page script runs
    const { p } = await openPhone(b, { w: 1440, h: 900, dpr: 1, seed: false, base: BASE, hub: HUB,
      init: () => { window.tzDesktop = { platform: 'windows-app', onShown: (cb) => { window.__shown = cb; } }; } });
    await ready(p);
    await p.evaluate(() => window.STRYKER_VELA.chart.addNativeIndicator('ema'));
    await p.waitForTimeout(3000);
    check(await p.evaluate(() => typeof window.__shown === 'function'), 'chart registered for the app shown/hidden signal');
    const a = await paintsIn(p, 4000);
    check(a > 0, 'shown: chart paints on live ticks (' + a + ' in 4 s)');
    await p.evaluate(() => window.__shown(false));
    const h = await paintsIn(p, 4000);
    check(h === 0, 'hidden: no chart paints (' + h + ' in 4 s)');
    // a change while hidden (new indicator) is not lost: it paints once shown
    await p.evaluate(() => window.STRYKER_VELA.chart.addNativeIndicator('stk_of_vwap'));
    const h2 = await paintsIn(p, 1500);
    check(h2 === 0, 'hidden: adding an indicator does not paint either (' + h2 + ')');
    const back = await p.evaluate(async () => {
      const R = window.STRYKER_VELA.chart.renderer.renderer || window.STRYKER_VELA.chart.renderer;
      let n = 0; const f = R.paintData; R.paintData = function () { n++; return f.apply(this, arguments); };
      window.__shown(true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      R.paintData = f; return n;
    });
    check(back >= 1, 'shown again: the held frame paints at once (' + back + ')');
    const s = await paintsIn(p, 4000);
    check(s > 0, 'shown again: painting resumes (' + s + ' in 4 s)');
    await p.context().close();

    // browser: no tzDesktop -> unchanged
    const r2 = await openPhone(b, { w: 1440, h: 900, dpr: 1, seed: false, base: BASE, hub: HUB });
    await ready(r2.p);
    await r2.p.waitForTimeout(2000);
    const w = await paintsIn(r2.p, 4000);
    check(w > 0, 'browser (no app bridge): chart paints as before (' + w + ' in 4 s)');
  } finally { await b.close(); }
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
