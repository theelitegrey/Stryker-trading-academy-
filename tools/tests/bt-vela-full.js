// Full phone/desktop flow on the new chart: trade + Liquidity Master shot, REAL pointer drag of a stop/target chip
// (touch via CDP on phone, mouse on desktop), snapshot download, coach, play/speed, full screen, sheet.
// node bt-vela-full.js <phone|phone412|desktop> [query]
const R = require('./bt-rig.js'); const dev = process.argv[2] || 'phone', extra = process.argv[3] || '';
const DIR = process.env.SHOTDIR || '/root/projects/stryker-notes/reports/workers/t5-bt-phone';
(async () => {
  const srv = await R.serve(); const b = await R.launch();
  const { ctx, p, errors } = await R.page(b, srv, dev);
  await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\//, (r) => r.continue());
  const res = {}; const ok = (k, v) => { res[k] = v; console.log((v === true ? 'PASS ' : v === false ? 'FAIL ' : '     ') + k + (v !== true && v !== false ? ' ' + JSON.stringify(v) : '')); };
  await R.startSession(p, srv.base, 'chart=tz' + (extra ? '&' + extra : '')); await p.waitForTimeout(4500);
  const phone = dev !== 'desktop';
  // play / speed
  const c0 = await p.evaluate(() => window.__RP.cursor);
  await p.evaluate(() => document.getElementById('rp-play').click()); await p.waitForTimeout(2500);
  const c1 = await p.evaluate(() => window.__RP.cursor); ok('play advances', c1 > c0);
  await p.evaluate(() => document.getElementById('rp-play').click());
  const sp = await p.evaluate(() => { const s = document.getElementById('rp-speed'); const n = s.options.length; s.selectedIndex = n - 1; s.dispatchEvent(new Event('change', { bubbles: true })); return [n, s.options[s.selectedIndex].text]; });
  const c2 = await p.evaluate(() => window.__RP.cursor); await p.evaluate(() => document.getElementById('rp-play').click()); await p.waitForTimeout(1500); await p.evaluate(() => document.getElementById('rp-play').click());
  const c3 = await p.evaluate(() => window.__RP.cursor); ok('speed change (' + sp[1] + ') advances', c3 - c2 > 0);
  // Liquidity Master
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await p.waitForSelector('.stkiw-row', { timeout: 20000 });
  await p.evaluate(() => document.querySelector('.stkiw-tab[data-k="picks"]').click()); await p.waitForTimeout(300);
  await p.evaluate(() => [...document.querySelectorAll('.stkiw-row')].find((r) => (r.querySelector('.stkiw-nm') || {}).textContent === 'Liquidity Master [TradeZoro]').querySelector('.stkiw-name').click());
  await p.waitForFunction(() => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.active.chart).length > 0, null, { timeout: 90000 }).catch(() => {});
  await p.evaluate(() => { try { window.STRYKER_VELA.indicatorPicker.close(); } catch (e) {} });
  ok('Liquidity Master on', await p.evaluate(() => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.active.chart).length > 0));
  // step, buy with stop + target
  for (let i = 0; i < 3; i++) { await p.evaluate(() => document.getElementById('rp-step10').click()); await p.waitForTimeout(120); }
  await p.evaluate(() => document.getElementById('rp-strip-buy').click()); await p.waitForTimeout(1200);
  for (let i = 0; i < 2; i++) { await p.evaluate(() => document.getElementById('rp-step').click()); await p.waitForTimeout(150); }
  await p.waitForTimeout(2500);
  const pos = await p.evaluate(() => ({ open: window.__RP.sim.positions ? window.__RP.sim.positions.length : -1, chips: [...document.querySelectorAll('.stkbt-chip')].map((c) => c.dataset.id + ':' + c.dataset.drag) }));
  ok('position open + chips', pos);
  await R.shot(p, DIR + '/after-trade-LM-' + dev + (extra ? '-' + extra.replace(/\W/g, '') : '') + '.png');
  // real pointer drag of the stop chip
  const stop = await p.evaluate(() => { const c = [...document.querySelectorAll('.stkbt-chip[data-drag="1"]')].find((x) => /^s/.test(x.dataset.id)); if (!c) return null; const r = c.querySelector('.stkbt-chip-a').getBoundingClientRect(); return { id: c.dataset.id, x: r.x + r.width / 2, y: r.y + r.height / 2, sl: window.__RP.sim.positions[0].sl, tp: window.__RP.sim.positions[0].tp }; });
  if (!stop) ok('stop chip found', false); else {
    const dy = phone ? 40 : 30;
    if (phone) {
      const cdp = await ctx.newCDPSession(p);
      const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
      await tp('touchStart', stop.x, stop.y); for (let i = 1; i <= 8; i++) { await tp('touchMove', stop.x, stop.y + dy * i / 8); await p.waitForTimeout(30); } await tp('touchEnd');
    } else { await p.mouse.move(stop.x, stop.y); await p.mouse.down(); for (let i = 1; i <= 8; i++) { await p.mouse.move(stop.x, stop.y + dy * i / 8); await p.waitForTimeout(30); } await p.mouse.up(); }
    await p.waitForTimeout(800);
    const after = await p.evaluate(() => ({ sl: window.__RP.sim.positions[0].sl, tp: window.__RP.sim.positions[0].tp }));
    ok((phone ? 'touch' : 'mouse') + ' drag of stop chip moved the stop', { before: stop.sl, after: after.sl, moved: after.sl !== stop.sl });
    res.drag = after.sl !== stop.sl;
  }
  // target chip too
  const tgt = await p.evaluate(() => { const c = [...document.querySelectorAll('.stkbt-chip[data-drag="1"]')].find((x) => /^t/.test(x.dataset.id)); if (!c) return null; const r = c.querySelector('.stkbt-chip-a').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, tp: window.__RP.sim.positions[0].tp }; });
  if (tgt) { await p.mouse.move(tgt.x, tgt.y); await p.mouse.down(); for (let i = 1; i <= 6; i++) { await p.mouse.move(tgt.x, tgt.y - 6 * i); await p.waitForTimeout(30); } await p.mouse.up(); await p.waitForTimeout(600); ok('target chip drag', { before: tgt.tp, after: await p.evaluate(() => window.__RP.sim.positions[0].tp) }); }
  // snapshot
  const dl = p.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await p.evaluate(() => document.getElementById('rp-snap-btn').click()); const d = await dl; ok('snapshot download', !!d && /\.(jpg|png)$/.test(d.suggestedFilename()));
  // coach + analytics sheet
  await p.evaluate(() => { const t = document.getElementById('rp-sheet-toggle'); if (!document.getElementById('rp-sheet').classList.contains('is-open')) t.click(); }); await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('#rp-sheet [data-tab="coach"]').click()); await p.waitForTimeout(800);
  const coach = await p.evaluate(() => { const e = document.getElementById('rp-coach'); return { vis: !document.getElementById('rp-tab-coach').hidden, len: (e.innerText || '').trim().length, txt: (e.innerText || '').trim().slice(0, 80) }; }); ok('coach panel', coach.vis && coach.len > 10 ? true : coach);
  await p.evaluate(() => document.querySelector('#rp-sheet [data-tab="stats"]').click()); await p.waitForTimeout(400);
  ok('analytics stats', await p.evaluate(() => (document.getElementById('rp-stats').innerText || '').trim().length > 10));
  await p.evaluate(() => document.getElementById('rp-sheet-toggle').click());
  // phone: pull-up sheet + full screen + symbol info + one top bar, no scroll
  if (phone) {
    await p.evaluate(() => document.getElementById('bt-psum').click()); await p.waitForTimeout(500);
    ok('pull-up sheet has stop/target + account', await p.evaluate(() => { const s = document.getElementById('bt-psheet'); return !s.hidden && !!s.querySelector('#rp-strip-sl') && !!s.querySelector('#rp-acct'); }));
    await R.shot(p, DIR + '/sheet-' + dev + (extra ? '-' + extra.replace(/\W/g, '') : '') + '.png');
    await p.evaluate(() => document.querySelector('.bt-psheet-x').click());
    ok('symbol tap shows session info', await (async () => { await p.evaluate(() => document.querySelector('#stkc-bar .vela-mb-symbol').click()); await p.waitForTimeout(400); const r = await p.evaluate(() => { const e = document.getElementById('bt-syminfo'); return e ? e.innerText.replace(/\s+/g, ' ').slice(0, 160) : null; }); await R.shot(p, DIR + '/syminfo-' + dev + '.png'); await p.evaluate(() => { const e = document.getElementById('bt-syminfo'); e && e.remove(); }); return r ? true : false; })());
    const lay = await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, vh: innerHeight, sw: document.documentElement.scrollWidth, vw: innerWidth, chartH: document.getElementById('rp-chart-main').getBoundingClientRect().height, bars: document.querySelectorAll('#stkc-bar').length, menus: [...document.querySelectorAll('.stkcps-menu, .mobile-topnav .menu-btn, #dash-menu-toggle')].filter((e) => e.getBoundingClientRect().width > 0).length, pageTop: (() => { const m = document.querySelector('.mobile-topnav'); return m ? m.getBoundingClientRect().height : 0; })() }));
    ok('layout', lay); ok('no page scroll, no h-overflow', lay.sh <= lay.vh + 1 && lay.sw <= lay.vw); ok('chart >= 65% of height', lay.chartH / lay.vh >= 0.65); ok('one menu, no page bar', lay.menus === 1 && lay.pageTop === 0);
    await p.evaluate(() => document.getElementById('stkc-fs-btn') ? document.getElementById('stkc-fs-btn').click() : null).catch(() => {}); await p.waitForTimeout(600);
    ok('full screen toggles', await p.evaluate(() => document.documentElement.classList.contains('stk-chart-fs') || !document.getElementById('stkc-fs-btn')));
  }
  console.log('errors', JSON.stringify(errors.slice(0, 5)));
  await b.close(); srv.close();
})();
