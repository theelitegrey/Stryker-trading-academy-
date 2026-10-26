// Old session (saved on lw with indicator+drawing+trade) resumes on tz; reload keeps bar + trades; ?ui=2 / vela=0.6 variants.
// node bt-vela-resume.js [desktop|phone] [extra query e.g. ui=2 or vela=0.6]
const R = require('./bt-rig.js'); const dev = process.argv[2] || 'desktop', extra = process.argv[3] || '';
(async () => {
  const srv = await R.serve(); const b = await R.launch(); const out = process.env.TMPDIR || '/tmp';
  const { ctx, p, errors } = await R.page(b, srv, dev);
  await R.startSession(p, srv.base, 'chart=lw' + (extra ? '&' + extra : ''));
  await p.waitForTimeout(2500);
  const id = await p.evaluate(async () => {
    const RP = window.__RP;
    RP.chart.addIndicator && RP.chart.addIndicator('ema', { len: 21 });
    RP.chart.drawings.push({ type: 'hline', p1: { t: RP.series.base[RP.cursor - 20].t, price: 29940 }, p2: null });
    for (let i = 0; i < 6; i++) document.getElementById('rp-step10').click();
    await new Promise((r) => setTimeout(r, 600));
    document.querySelector('#rp-buy, [data-side="buy"]').click(); await new Promise((r) => setTimeout(r, 300));
    for (let i = 0; i < 3; i++) document.getElementById('rp-step10').click();
    await new Promise((r) => setTimeout(r, 1500));
    return RP.session.id;
  });
  await p.waitForTimeout(3000);
  const snap = (RP) => ({ cursor: RP.cursor, tr: RP.sim.trades.length, open: RP.sim.positions ? RP.sim.positions.length : (RP.sim.position ? 1 : 0), bal: RP.sim.balance });
  const lw = await p.evaluate(() => { const RP = window.__RP; return { cursor: RP.cursor, bal: RP.sim.balance, trades: RP.sim.trades.length, ind: RP.chart.getIndicators().length, dr: RP.chart.getDrawings().length, sid: RP.session.id }; });
  console.log('lw saved', JSON.stringify(lw));
  await p.goto(srv.base + '/replay.html?session=' + encodeURIComponent(lw.sid) + '&chart=tz' + (extra ? '&' + extra : ''), { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#rp-work:not([hidden])', { timeout: 40000 });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.cells().length && window.STRYKER_VELA.cells()[0].chart.orchestrator.rawBars.length > 10, null, { timeout: 40000 });
  await p.waitForTimeout(4000);
  const tzState = () => p.evaluate(() => { const RP = window.__RP, c = window.STRYKER_VELA.cells()[0]; return { cursor: RP.cursor, bal: RP.sim.balance, trades: RP.sim.trades.length, vind: RP.chart.indicators.length, vdr: RP.chart.drawings.length, oldInd: (RP.session.indicators || []).length, oldDr: (RP.session.drawings || []).length, ovf: document.documentElement.scrollWidth - innerWidth, tree: document.getElementById('rp-objtree').innerText.replace(/\s+/g, ' ').slice(0, 120) }; });
  const a = await tzState(); console.log('tz opened', JSON.stringify(a));
  await p.evaluate(() => { const c = document.getElementById('rp-sess-ldn'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(1500);
  await R.shot(p, out + '/bt-vela-resume-' + dev + '.png');
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#rp-work:not([hidden])', { timeout: 40000 }).catch(() => console.log('no auto-resume after reload'));
  await p.waitForTimeout(6000);
  console.log('tz reloaded', JSON.stringify(await tzState().catch((e) => e.message)));
  console.log('errors', JSON.stringify(errors.slice(0, 5)));
  await b.close(); srv.close();
})();
