// HTF second cell + object tree + migration of an old session. node bt-vela-htf.js [desktop|phone]
const R = require('./bt-rig.js'); const dev = process.argv[2] || 'desktop';
(async () => {
  const srv = await R.serve(); const b = await R.launch(); const out = process.env.TMPDIR || '/tmp';
  const { ctx, p, errors } = await R.page(b, srv, dev);
  p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200))); p.on('console', (m) => { if (m.type() === 'error') console.log('CERR', m.text().slice(0, 200)); });
  await R.startSession(p, srv.base, 'chart=tz').catch(async (e) => { console.log('start fail'); await R.shot(p, out + '/bt-fail.png'); throw e; }); await p.waitForTimeout(5000);
  const info = () => p.evaluate(() => { const ws = window.STRYKER_VELA; const cs = ws.cells(); return { cells: cs.length, tfs: cs.map((c) => c.timeframe), bars: cs.map((c) => c.chart.orchestrator.rawBars.length), last: cs.map((c) => { const r = c.chart.orchestrator.rawBars; return r.length && r[r.length - 1].time <= window.__RP.series.base[window.__RP.cursor].t; }), tree: (document.getElementById('rp-objtree') || {}).innerText }; });
  console.log('start', JSON.stringify(await info()));
  await p.evaluate(() => { const s = document.getElementById('rp-split'); s.checked = true; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(4000); console.log('htf on', JSON.stringify(await info()));
  await p.evaluate(() => document.getElementById('rp-step10').click()); await p.waitForTimeout(1500);
  console.log('after step', JSON.stringify(await info()));
  await p.evaluate(() => { const c = window.STRYKER_VELA.cells()[0]; c.addNative('ema'); c.chart.drawings.add('trendline', { paneId: 'price', anchors: [{ time: window.__RP.series.base[window.__RP.cursor - 50].t, price: 29900 }, { time: window.__RP.series.base[window.__RP.cursor].t, price: 29950 }] }); });
  await p.waitForTimeout(1500); console.log('tree', JSON.stringify((await info()).tree));
  await R.shot(p, out + '/bt-vela-htf-' + dev + '.png');
  console.log('errors', JSON.stringify(errors.slice(0, 5)));
  await b.close(); srv.close();
})();
