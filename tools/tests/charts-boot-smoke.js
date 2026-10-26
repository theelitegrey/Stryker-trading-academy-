// Charts page must be unchanged by the backtest boot flag: node charts-boot-smoke.js [vela=0.9|0.6]
const R = require('./bt-rig.js');
(async () => {
  const srv = await R.serve(); const b = await R.launch(); const out = process.env.TMPDIR || '/tmp';
  for (const eng of ['0.9', '0.6']) for (const dev of ['phone', 'desktop']) {
    const { ctx, p, errors } = await R.page(b, srv, dev);
    await ctx.route(/\/api\/chart\/bars\//, (r) => { const now = Math.floor(Date.now() / 1000); const bars = R.bars(now - 86400 * 3, now).map((x) => [Math.floor(x[0] / 1000), x[1], x[2], x[3], x[4], x[5]]); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bars }) }); });
    await p.goto(srv.base + '/charts.html?vela=' + eng, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(5000);
    const r = await p.evaluate(() => { let n = -1, sym = null; try { const c = window.STRYKER_VELA.active; n = c.chart.orchestrator.rawBars.length; sym = c.symbol; } catch (e) {} return { n, sym, bt: !!window.__stkBt, ovf: document.documentElement.scrollWidth - innerWidth, paper: !!document.querySelector('.stkpt, #stkpt-css'), bar: !!document.getElementById('stkc-bar') }; });
    console.log(eng, dev, JSON.stringify(r), 'errors', JSON.stringify(errors.filter((e) => !/Firebase|firestore/i.test(e)).slice(0, 4)));
    await R.shot(p, out + '/charts-smoke-' + eng + '-' + dev + '.png');
    await ctx.close();
  }
  await b.close(); srv.close();
})();
