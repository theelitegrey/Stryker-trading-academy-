// Backtest on Vela smoke: node tools/tests/bt-vela-smoke.js [phone|phone412|desktop] [chart query, default chart=tz]
const R = require('./bt-rig.js');
(async () => {
  const dev = process.argv[2] || 'desktop'; const q = process.argv[3] || 'chart=tz';
  const srv = await R.serve(); const b = await R.launch();
  const { p, errors } = await R.page(b, srv, dev);
  const out = process.env.OUT || (process.env.TMPDIR || '/tmp');
  try {
    await R.startSession(p, srv.base, q);
    await p.waitForSelector('#vela-chart canvas', { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(2500);
    const info = () => p.evaluate(() => {
      const ws = window.STRYKER_VELA; let n = -1, last = null, tf = null;
      try { const c = ws.active; tf = c.timeframe; const bars = c.chart.orchestrator.rawBars; n = bars.length; last = bars[bars.length - 1]; } catch (e) {}
      return { n, last, tf, cursor: window.__RP.cursor, cur: document.getElementById('rp-cursor').textContent, canv: document.querySelectorAll('#vela-chart canvas').length, ovf: document.documentElement.scrollWidth - innerWidth };
    });
    console.log('after open', JSON.stringify(await info()));
    await p.click('#rp-step'); await p.waitForTimeout(500);
    console.log('after +1', JSON.stringify(await info()));
    await p.click('#rp-step10'); await p.waitForTimeout(600);
    console.log('after +10', JSON.stringify(await info()));
    await p.click('#rp-jumpday'); await p.waitForTimeout(2000);
    console.log('after Day', JSON.stringify(await info()));
    await R.shot(p, out + '/bt-vela-' + dev + '.png');
  } catch (e) { console.log('FAIL', e.message); await R.shot(p, out + '/bt-vela-fail-' + dev + '.png').catch(() => {}); }
  console.log('errors', JSON.stringify(errors.slice(0, 8)));
  await b.close(); srv.close();
})();
