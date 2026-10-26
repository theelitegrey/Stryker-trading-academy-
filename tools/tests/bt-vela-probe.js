const R = require('./bt-rig.js');
(async () => {
  const srv = await R.serve(); const b = await R.launch();
  const { p, errors } = await R.page(b, srv, 'desktop');
  p.on('console', (m) => { const t = m.text(); if (/bt|Backtest|TradeZoro|provider|symbol/i.test(t)) console.log('C:', t.slice(0, 200)); });
  await R.startSession(p, srv.base, 'chart=tz');
  await p.waitForTimeout(4000);
  console.log(JSON.stringify(await p.evaluate(async () => {
    const ws = window.STRYKER_VELA, c = ws.active; const o = {};
    o.sym = c.symbol; o.tf = c.timeframe; o.ls = Object.keys(localStorage).filter((k) => /vela/.test(k));
    try { o.res = JSON.stringify(c.chart.data.resolve(c.symbol)).slice(0, 200); } catch (e) { o.res = 'err ' + e.message; }
    try { o.state = c.chart.orchestrator.state || null; } catch (e) {}
    try { o.bars = (await window.__stkBt.feed.provider.getBars('SESSION', '5', {})).length; } catch (e) { o.bars = 'err ' + e.message; }
    return o;
  })));
  await b.close(); srv.close();
})();
