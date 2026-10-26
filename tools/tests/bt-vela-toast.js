// real "Added ... to the chart" toast: position vs dock, lifetime. node bt-vela-toast.js <dev> <query> <label>
const R = require('./bt-rig.js'); const [dev, q, label] = [process.argv[2] || 'phone', process.argv[3] || 'chart=tz&ui=2', process.argv[4] || 'fix2']; const DIR = process.env.SHOTDIR || process.env.TMPDIR; const BASE = process.env.BASE;
(async () => { const srv = BASE ? { base: BASE, close() {} } : await R.serve(); const b = await R.launch(); const { ctx, p, errors } = await R.page(b, srv, dev);
  await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\//, (r) => r.continue());
  if (BASE) { await ctx.unroute(/.*/).catch(() => {}); }
  await R.startSession(p, srv.base, q); await p.waitForTimeout(4500);
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await p.waitForSelector('.stkiw-row'); await p.evaluate(() => document.querySelector('.stkiw-tab[data-k="picks"]').click());
  await p.evaluate(() => [...document.querySelectorAll('.stkiw-row')].find((r) => (r.querySelector('.stkiw-nm') || {}).textContent === 'Liquidity Master [TradeZoro]').querySelector('.stkiw-name').click());
  const t0 = Date.now(); let seen = null, gone = null;
  for (let i = 0; i < 60; i++) { await p.waitForTimeout(250); const s = await p.evaluate(() => { const t = document.querySelector('.toast'); if (!t) return null; const r = t.getBoundingClientRect(); const f = document.getElementById('rp-float').getBoundingClientRect(); const bt = document.getElementById('rp-bottom') || document.querySelector('.rpw-bottom'); return { y: Math.round(r.y), bottom: Math.round(r.bottom), dockTop: Math.round(f.y), txt: t.textContent.slice(0, 40) }; }); if (s && !seen) { seen = s; seen.t = Date.now() - t0; await R.shot(p, DIR + '/' + label + '-toast-' + dev + '.png'); } if (seen && !s && !gone) { gone = Date.now() - t0; break; } }
  console.log('toast', JSON.stringify(seen), 'life ms ~', gone && seen ? gone - seen.t : 'n/a', 'clear of dock:', seen ? seen.bottom <= seen.dockTop : 'n/a');
  await p.evaluate(() => { try { window.STRYKER_VELA.indicatorPicker.close(); } catch (e) {} });
  console.log('errors', JSON.stringify(errors.slice(0, 3))); await b.close(); srv.close(); })();
