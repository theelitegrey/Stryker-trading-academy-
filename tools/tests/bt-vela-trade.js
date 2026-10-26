// Scripted trade sequence on old (lw) and new (tz) chart: P&L must be identical. Also drags a bracket on tz.
// node bt-vela-trade.js [phone|desktop]
const R = require('./bt-rig.js');
const dev = process.argv[2] || 'desktop';
async function run(b, srv, q) {
  const { p, errors } = await R.page(b, srv, dev);
  await R.startSession(p, srv.base, q);
  await p.waitForTimeout(q.includes('tz') ? 3500 : 800);
  const res = {};
  const step = async (sel, n) => { for (let i = 0; i < n; i++) { await p.evaluate((x) => document.querySelector(x).click(), sel); await p.waitForTimeout(30); } };
  await step('#rp-step10', 3);
  await p.evaluate(() => document.querySelector('#rp-strip-buy').click()); await p.waitForTimeout(300);                       // buy 1, stop 40 ticks, target 2R
  await step('#rp-step10', 6);
  await p.evaluate(() => document.querySelector('#rp-strip-sell').click()); await p.waitForTimeout(300);                      // sell 1 (nets/hedges per engine rules)
  await step('#rp-step10', 8);
  await p.evaluate(() => { const s = window.__RP.sim; const pos = s.positions[0]; if (pos) s.modifyPosition(pos.id, { sl: pos.entry + (pos.side === 'buy' ? -30 : 30) * 0.25 }); });
  await step('#rp-step10', 30);
  if (q.includes('tz')) { await R.shot(p, (process.env.TMPDIR || '/tmp') + '/bt-vela-trade-' + dev + '.png'); }
  await p.evaluate(() => document.querySelector('#rp-closeall').click()); await p.waitForTimeout(300);
  res.snap = await p.evaluate(() => { const s = window.__RP.sim; return { cursor: window.__RP.cursor, balance: s.balance, trades: s.trades.map((t) => [t.side, t.size, t.entry, t.exit, t.pnl, t.reason]), open: s.positions.length, pending: s.pending.length }; });
  res.errors = errors.slice(0, 5);
  await p.context().close();
  return res;
}
(async () => {
  const srv = await R.serve(); const b = await R.launch();
  const a = await run(b, srv, 'chart=lw'); const c = await run(b, srv, 'chart=tz');
  console.log('LW', JSON.stringify(a.snap)); console.log('TZ', JSON.stringify(c.snap));
  console.log('PARITY', JSON.stringify(a.snap) === JSON.stringify(c.snap) ? 'IDENTICAL' : 'DIFFERENT');
  console.log('errors lw', JSON.stringify(a.errors), 'tz', JSON.stringify(c.errors));
  await b.close(); srv.close();
})();
