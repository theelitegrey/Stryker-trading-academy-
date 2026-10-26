// Backtest replay regression (Owner 2026-10-26 "backtest ui"): real taps at 390 and 1440 for the
// current UI and, with BT_Q=ui=2, the new UI. Offline rig (bt-rig.js). Each control is reached the
// way a member reaches it: if it is not on screen, the UI's own "reveal" (ui=2 sheets) opens it.
//   flock /tmp/stryker-chrome.lock node tools/tests/bt-regress.js [shotsDir]     (BT_Q=ui=2, BT_DEVS=phone,desktop)
const path = require('path');
const R = require('./bt-rig.js');
const OUT = process.argv[2] || '/tmp';
const Q = process.env.BT_Q || '';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

async function tap(p, sel, taps) {
  // reveal through the UI if hidden (ui=2 sheets / menus); counts the taps that took
  let vis = await p.locator(sel).first().isVisible().catch(() => false);
  if (!vis) {
    const n = await p.evaluate((sel) => (window.__btUi && window.__btUi.reveal) ? window.__btUi.reveal(sel) : 0, sel);
    if (taps) taps.n += n || 0;
    await p.waitForTimeout(250);
  }
  await p.locator(sel).first().click({ timeout: 5000 });
  if (taps) taps.n++;
  await p.waitForTimeout(150);
}
async function choose(p, sel, value) {
  let vis = await p.locator(sel).first().isVisible().catch(() => false);
  if (!vis) { await p.evaluate((sel) => window.__btUi && window.__btUi.reveal && window.__btUi.reveal(sel), sel); await p.waitForTimeout(250); }
  await p.selectOption(sel, value); await p.waitForTimeout(150);
}
const ovf = async (p, tag, what) => { const s = await st(p); if (s.sw > s.vw) console.log('OVERFLOW after ' + what + ' ' + s.sw + ' ' + s.wide); };
const st = (p) => p.evaluate(() => { const RP = window.__RP; return { tf: RP.tf, htfTf: RP.htfTf, cursor: RP.cursor, speed: RP.speedIdx, playing: RP.playing, tz: RP.tz, pos: RP.sim.positions.map((x) => ({ side: x.side, sl: x.sl, tp: x.tp })), trades: RP.sim.trades.length, ind: RP.chart.indicators.length, draw: RP.chart.drawings.length, htf: !document.getElementById('rp-chart-htf').hidden, ny: RP.chart.opts.sessions.ny, ldn: RP.chart.opts.sessions.ldn, sw: document.documentElement.scrollWidth, vw: Math.min(innerWidth, screen.width), wide: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > screen.width + 1 && e.getClientRects().length && !e.closest('.sidebar,.appnav-sheet,#appnav-dock,.rp-lwc')).slice(0, 4).map((e) => (e.id || e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().right)) }; });
async function closeModals(p) { await p.evaluate(() => { const m = document.getElementById('rp-modal'); if (m && !m.hidden) m.hidden = true; }); }

(async () => {
  const srv = await R.serve(process.env.BT_ROOT || undefined); const b = await R.launch();
  try {
    for (const dev of (process.env.BT_DEVS || 'phone,desktop').split(',')) {
      const tag = dev + (Q ? ' [' + Q + ']' : '');
      const { p, errors, ctx } = await R.page(b, srv, dev);
      await R.startSession(p, srv.base, Q);
      let s = await st(p); check(s.sw <= s.vw, tag + ' no sideways overflow at start (' + s.sw + '/' + s.vw + ') ' + s.wide);
      // timeframe
      await ovf(p, tag, 'start'); await tap(p, '#rp-tfs [data-tf="15m"]'); await ovf(p, tag, 'tf'); s = await st(p); check(s.tf === '15m', tag + ' timeframe -> 15m');
      // step / +10 / speed / play / Day
      let c0 = s.cursor; await tap(p, '#rp-step'); s = await st(p); check(s.cursor === c0 + 1, tag + ' +1 bar');
      c0 = s.cursor; await tap(p, '#rp-step10'); s = await st(p); check(s.cursor === c0 + 10, tag + ' +10 bars');
      await choose(p, '#rp-speed', '4'); s = await st(p); check(s.speed === 4, tag + ' speed 15 bars/s');
      c0 = s.cursor; await tap(p, '#rp-play'); await p.waitForTimeout(700); await tap(p, '#rp-play'); s = await st(p); check(!s.playing && s.cursor > c0, tag + ' play then pause moved ' + (s.cursor - c0) + ' bars');
      c0 = s.cursor; await tap(p, '#rp-jumpday'); s = await st(p); check(s.cursor > c0, tag + ' Day > jumped ' + (s.cursor - c0) + ' bars');
      // HTF / NY / LDN / timezone
      await tap(p, 'label:has(#rp-split)'); await p.waitForTimeout(300); s = await st(p); check(s.htf, tag + ' HTF on'); await ovf(p, tag, 'htf');
      await choose(p, '#rp-htf-tf', '4h'); s = await st(p); check(s.htfTf === '4h', tag + ' HTF timeframe 4h');
      await tap(p, 'label:has(#rp-split)'); await p.waitForTimeout(300); s = await st(p); check(!s.htf, tag + ' HTF off');
      await tap(p, 'label:has(#rp-sess-ny)'); s = await st(p); check(s.ny === false, tag + ' NY shading off');
      await tap(p, 'label:has(#rp-sess-ldn)'); s = await st(p); check(s.ldn === true, tag + ' LDN shading on');
      await choose(p, '#rp-tz-live', 'UTC'); s = await st(p); check(s.tz === 'UTC', tag + ' timezone UTC');
      // indicator
      const i0 = s.ind; await tap(p, '#rp-ind-btn'); await p.locator('#rp-modal .rp-indopt[data-ind="rsi"]').click(); await p.waitForTimeout(400); await closeModals(p); s = await st(p); check(s.ind === i0 + 1, tag + ' indicator RSI added'); await ovf(p, tag, 'rsi');
      // draw a horizontal line
      const d0 = s.draw; await tap(p, '#rp-tools [data-tool="hline"]');
      const box = await p.locator('#rp-chart-main .rp-lwc').boundingBox(); await p.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4); await p.waitForTimeout(250);
      s = await st(p); check(s.draw === d0 + 1, tag + ' horizontal line drawn'); await ovf(p, tag, 'draw');
      // Buy with stop + target, then Sell
      await tap(p, '#rp-strip-buy'); await p.waitForTimeout(250); s = await st(p);
      check(s.pos.length >= 1 && s.pos[0].side === 'buy' && s.pos[0].sl != null && s.pos[0].tp != null, tag + ' Buy with stop + target ' + JSON.stringify(s.pos));
      await tap(p, '#rp-strip-sell'); await p.waitForTimeout(250); await closeModals(p); s = await st(p);
      check(s.trades >= 1 || s.pos.some((x) => x.side === 'sell'), tag + ' Sell placed (trades ' + s.trades + ', positions ' + s.pos.length + ')');
      await tap(p, '#rp-strip-buy'); await p.waitForTimeout(250); await closeModals(p);
      const t0 = (await st(p)).trades;
      await tap(p, '#rp-closeall'); await p.waitForTimeout(300); await closeModals(p); s = await st(p); check(s.pos.length === 0 && s.trades > t0, tag + ' Close all'); await ovf(p, tag, 'closeall');
      // analytics
      await tap(p, '#rp-sheet-toggle'); await p.waitForTimeout(1200);   // the page scrolls smoothly to the sheet
      const sheet = await p.evaluate(() => document.getElementById('rp-sheet').classList.contains('is-open') || !!document.querySelector('.bt2-sheet.is-open #rp-sheet, #rp-sheet:not([hidden]) .rp-tabs'));
      check(sheet, tag + ' analytics opens'); await ovf(p, tag, 'analytics'); { const iw = await p.evaluate(() => innerWidth); check(iw <= (dev === 'desktop' ? 1440 : 412), tag + ' layout viewport not zoomed out with analytics open (' + iw + ')'); }
      await tap(p, '.rp-tabs [data-tab="stats"]'); const tiles = await p.locator('#rp-stats .rp-stat').count(); check(tiles >= 10, tag + ' statistics tiles ' + tiles);
      await R.shot(p, path.join(OUT, 'reg-' + dev + (Q ? '-ui2' : '') + '-analytics.png'));
      await p.evaluate(() => window.__btUi && window.__btUi.closeAll && window.__btUi.closeAll()); await p.keyboard.press('Escape');
      // snapshot
      const dl = p.waitForEvent('download', { timeout: 5000 }).catch(() => null); await tap(p, '#rp-snap-btn'); const f = await dl; check(!!f, tag + ' snapshot downloads ' + (f ? f.suggestedFilename() : ''));
      s = await st(p); check(s.sw <= s.vw, tag + ' no sideways overflow after the run (' + s.sw + '/' + s.vw + ') ' + s.wide);
      // reload: state kept
      const before = await st(p); await p.evaluate(() => { window.dispatchEvent(new Event('beforeunload')); });
      await p.waitForTimeout(400); await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#rp-work:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(900);
      const after = await st(p);
      check(after.tf === before.tf && after.cursor === before.cursor && after.trades === before.trades && after.ind === before.ind && after.draw === before.draw && after.tz === before.tz, tag + ' reload keeps tf/cursor/trades/indicators/drawings/tz ' + JSON.stringify({ b: [before.tf, before.cursor, before.trades, before.ind, before.draw, before.tz], a: [after.tf, after.cursor, after.trades, after.ind, after.draw, after.tz] }));
      await R.shot(p, path.join(OUT, 'reg-' + dev + (Q ? '-ui2' : '') + '-reload.png'));
      check(!errors.length, tag + ' no page errors ' + JSON.stringify(errors.slice(0, 3)));
      await ctx.close();
    }
  } finally { await b.close(); srv.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
