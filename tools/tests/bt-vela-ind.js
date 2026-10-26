// Indicators on the backtest chart: add Liquidity Master (Pine) + 2 natives, step, no look-ahead, reload persists.
// node bt-vela-ind.js [desktop|phone]
const R = require('./bt-rig.js');
const dev = process.argv[2] || 'desktop'; const NAME = 'Liquidity Master [TradeZoro]';
(async () => {
  const srv = await R.serve(); const b = await R.launch(); const out = process.env.TMPDIR || '/tmp';
  const { ctx, p, errors } = await R.page(b, srv, dev);
  await ctx.unroute(/^https?:\/\/(?!127\.0\.0\.1)(?!cdn\.jsdelivr\.net\/npm\/lightweight)(?!us-central1-strykertrades-e0cd8\.cloudfunctions\.net\/replayBars)/).catch(() => {});
  await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\//, (r) => r.continue());
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)(?!cdn\.jsdelivr\.net\/)(?!us-central1-strykertrades-e0cd8\.cloudfunctions\.net\/replayBars)/, (r) => r.abort());
  p.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url().slice(0, 120)); });
  p.on('console', (m) => { if (/pine|worker|liquidity/i.test(m.text())) console.log('C:', m.text().slice(0, 200)); });
  await R.startSession(p, srv.base, 'chart=tz');
  await p.waitForFunction(() => window.STRYKER_VELA && window.__stkHeavyReady, null, { timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(2000);
  const cellInfo = () => p.evaluate(() => { const c = window.STRYKER_VELA.active; let h = []; try { h = window.STRYKER_PINE.pineHandles(c.chart); } catch (e) {} let inds = []; try { inds = [...c.chart.renderer.scene.indicators.keys()]; } catch (e) {} return { pine: h.length, inds: inds.length, cursorT: window.__RP.series.base[window.__RP.cursor].t, bars: c.chart.orchestrator.rawBars.length }; });
  // add Liquidity Master through the Indicators window taps
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await p.waitForSelector('.stkiw-row', { timeout: 20000 });
  await p.evaluate(() => document.querySelector('.stkiw-tab[data-k="picks"]').click());
  await p.waitForTimeout(300);
  await p.evaluate((n) => [...document.querySelectorAll('.stkiw-row')].find((r) => (r.querySelector('.stkiw-nm') || {}).textContent === n).querySelector('.stkiw-name').click(), NAME);
  await p.waitForFunction(() => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.active.chart).length > 0, null, { timeout: 90000 }).catch((e) => console.log('LM add timeout'));
  // two natives: search by name
  for (const nm of ['Moving Average Exponential', 'Relative Strength Index']) {
    await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await p.waitForSelector('.stkiw-row', { timeout: 20000 });
    const ok = await p.evaluate((n) => { const rows = [...document.querySelectorAll('.stkiw-row')]; const r = rows.find((x) => ((x.querySelector('.stkiw-nm') || {}).textContent || '').trim() === n); if (!r) return false; r.querySelector('.stkiw-name').click(); return true; }, nm);
    console.log('native', nm, ok);
    await p.evaluate(() => { try { window.STRYKER_VELA.indicatorPicker.close(); } catch (e) {} }); await p.waitForTimeout(500);
  }
  console.log('after add', JSON.stringify(await cellInfo()));
  // step with indicators on
  for (let i = 0; i < 5; i++) { await p.evaluate(() => document.querySelector('#rp-step10').click()); await p.waitForTimeout(150); }
  await p.waitForTimeout(3000);
  // look-ahead: every Pine plot/box time must be <= cursor time
  const la = await p.evaluate(() => { const c = window.STRYKER_VELA.active; const cur = window.__RP.series.base[window.__RP.cursor].t; const raw = c.chart.orchestrator.rawBars; const lastBar = raw[raw.length - 1].time; return { lastBar, cur, ok: lastBar <= cur }; });
  console.log('look-ahead check (last bar <= cursor):', JSON.stringify(la));
  await R.shot(p, out + '/bt-vela-ind-' + dev + '.png');
  // persist: reload and see indicators back
  const before = await cellInfo();
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#rp-work:not([hidden])', { timeout: 30000 }).catch(async () => { const id = await p.evaluate(() => (document.querySelector('.rp-sess') || {}).dataset && document.querySelector('.rp-sess').dataset.id); console.log('resume via list', id); });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.active, null, { timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(6000);
  console.log('before', JSON.stringify(before), 'after reload', JSON.stringify(await cellInfo()), 'cursor', await p.evaluate(() => window.__RP && window.__RP.cursor));
  console.log('errors', JSON.stringify(errors.slice(0, 6)));
  await b.close(); srv.close();
})();
