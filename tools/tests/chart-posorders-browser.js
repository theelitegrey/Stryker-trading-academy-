// Positions & Orders dock (Owner 17 Nov 2026). Paper account only (no broker, no network but the local server).
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/chart-posorders-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/posorders';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
const SYM = 'hyperliquid:BTC';

async function open(b, w, theme) {
  const mobile = w < 500;
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net|[a-z0-9.-]*hyperliquid\.xyz)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e.message || e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|WebSocket connection/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => window.__stkPaper.setEnabled(true));
  await p.evaluate(async (s) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 50) break; } }, SYM);
  await p.waitForTimeout(3000);
  return { ctx, p, errs };
}
const wait = (p, fn, arg, ms = 8000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
const chartH = (p) => p.evaluate(() => document.querySelector('#vela-chart .vela-ws-main').getBoundingClientRect().height);
const measure = (p) => p.evaluate(() => {
  const bar = document.querySelector('.vela-widget-bottombar'), R = (e) => { const r = e.getBoundingClientRect(); return { n: String(e.className).split(' ')[0], x: +r.x.toFixed(1), r: +r.right.toFixed(1), cy: +(r.y + r.height / 2).toFixed(1), h: +r.height.toFixed(1) }; };
  const items = [];
  for (const k of bar.children) { if (!k.offsetWidth || !k.offsetHeight) continue; if (k.id === 'stkpt-bb' || k.id === 'stkpt-tw' || k.id === 'stkai-chip') items.push(...[...k.children].filter((c) => c.offsetWidth && c.offsetHeight && !c.hidden).map(R)); else items.push(R(k)); }
  const dock = document.getElementById('stkpo-dock'), bb = bar.getBoundingClientRect(), db = dock && !dock.hidden ? dock.getBoundingClientRect() : null;
  return { items, barR: bb.right, barL: bb.left, sw: bar.scrollWidth, cw: bar.clientWidth, dock: db && { top: db.top, bottom: db.bottom, l: db.left, r: db.right }, barTop: bb.top };
});

(async () => {
  const b = await launch();
  try {
    for (const [w, theme] of [[1440, 'night'], [1440, 'day']]) {
      const { ctx, p, errs } = await open(b, w, theme), L = w + ' ' + theme + ': ', tn = theme === 'night' ? 'dark' : 'light';
      const bt = await p.evaluate(() => { const e = document.getElementById('stkpo-btn'); return e && { vis: e.offsetWidth > 0, label: e.textContent.trim(), aria: e.getAttribute('aria-label'), parent: e.parentElement.className, next: e.nextElementSibling && e.nextElementSibling.className.toString().split(' ')[0] }; });
      check(bt && bt.vis && /Positions & Orders/.test(bt.label) && /vela-widget-bottombar/.test(bt.parent), L + 'button in the bottom bar with its label', bt);
      check(bt && /stklat-chip/.test(bt.next), L + 'button sits right before the latency pill', bt);
      const m0 = await measure(p), cys = m0.items.map((i) => i.cy), spread = Math.max(...cys) - Math.min(...cys);
      check(spread <= 1, L + 'bar items one centre line (spread ' + spread.toFixed(2) + ')');
      check(m0.sw <= m0.cw + 1, L + 'bar no overflow (' + m0.sw + '/' + m0.cw + ')');
      const pb = m0.items.find((i) => /stkpo-btn/.test(i.n)), rb = m0.items.find((i) => /vela-bb-range/.test(i.n));
      check(pb && rb && pb.h === 24 && rb.h === 24, L + 'button same 24px height as the range buttons', pb);
      const h0 = await chartH(p);
      await p.evaluate(() => window.__stkPaper.placeOrder({ symbol: 'hyperliquid:BTC', side: 'buy', type: 'market', qty: 1 }));
      check(await wait(p, () => Object.keys(window.__stkPaper.account.state.positions).length === 1), L + 'paper position opened');
      const last = await p.evaluate(() => { const a = window.__stkPaper.account; return a.last['hyperliquid:BTC']; });
      await p.evaluate((l) => window.__stkPaper.placeOrder({ symbol: 'hyperliquid:BTC', side: 'buy', type: 'limit', qty: 1, price: Math.round(l * 0.8) }), last);
      check(await wait(p, () => window.__stkPaper.account.state.orders.length === 1), L + 'working order placed');
      check(await wait(p, () => document.querySelector('#stkpo-btn .stkpo-n').textContent === '2'), L + 'count badge shows 2', await p.evaluate(() => document.querySelector('#stkpo-btn .stkpo-n').textContent));
      await p.click('#stkpo-btn');
      check(await wait(p, () => !document.getElementById('stkpo-dock').hidden), L + 'click opens the dock');
      await p.waitForTimeout(700);
      const m1 = await measure(p), h1 = await chartH(p);
      check(m1.dock && Math.abs(m1.dock.bottom - m1.barTop) <= 1, L + 'dock sits right above the bottom bar', m1.dock);
      check(h1 < h0 - 100, L + 'chart area shrank (' + Math.round(h0) + ' -> ' + Math.round(h1) + ')');
      const tabs = await p.$$eval('#stkpo-dock [role=tab]', (a) => a.map((x) => x.textContent.trim().replace(/\s+\d+$/, '')));
      check(JSON.stringify(tabs) === JSON.stringify(['Positions', 'Open orders', 'Order history', 'Trade history', 'Balances']), L + 'tabs', tabs);
      const rows = await p.$$eval('#stkpo-dock tbody tr', (a) => a.map((r) => r.textContent.replace(/\s+/g, ' ')));
      check(rows.length === 1 && /BTC/.test(rows[0]) && /Long/.test(rows[0]), L + 'Positions tab shows the paper position', rows);
      await p.screenshot({ path: OUT + '/dock-' + w + '-' + tn + '-positions.png' });
      await p.click('#stkpo-dock [data-t=ord]');
      const orows = await p.$$eval('#stkpo-dock tbody tr', (a) => a.map((r) => r.textContent.replace(/\s+/g, ' ')));
      check(orows.length === 1 && /Limit/.test(orows[0]) && /Working/.test(orows[0]), L + 'Open orders tab shows the order', orows);
      await p.click('#stkpo-dock [data-t=oh]'); await p.waitForTimeout(150);
      check((await p.$$eval('#stkpo-dock tbody tr', (a) => a.length)) >= 1, L + 'Order history has the fill');
      await p.click('#stkpo-dock [data-t=th]');
      check(/No trades yet/.test(await p.textContent('#stkpo-dock .stkpo-view')), L + 'Trade history empty state in plain words');
      await p.click('#stkpo-dock [data-t=bal]');
      check(/Balance/.test(await p.textContent('#stkpo-dock .stkpo-view')) && /Equity/.test(await p.textContent('#stkpo-dock .stkpo-view')), L + 'Balances tab');
      if (w === 1440) await p.screenshot({ path: OUT + '/dock-' + w + '-' + tn + '-balances.png' });
      // resize by dragging the top edge, height remembered across close/open
      await p.click('#stkpo-dock [data-t=pos]');
      const g = await p.evaluate(() => { const r = document.querySelector('.stkpo-grip').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      const hBefore = (await measure(p)).dock; await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.move(g.x, g.y - 80, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(300);
      const hAfter = (await measure(p)).dock, dh = (hAfter.bottom - hAfter.top) - (hBefore.bottom - hBefore.top);
      check(Math.abs(dh - 80) <= 4, L + 'drag top edge grows the dock by ~80px (' + dh + ')');
      await p.keyboard.press('Escape');
      check(await wait(p, () => document.getElementById('stkpo-dock').hidden), L + 'Esc closes');
      check(Math.abs((await chartH(p)) - h0) <= 2, L + 'chart area back to full height');
      await p.click('#stkpo-btn'); await p.waitForTimeout(300);
      const hRe = (await measure(p)).dock; check(Math.abs((hRe.bottom - hRe.top) - (hAfter.bottom - hAfter.top)) <= 2, L + 'height remembered on reopen');
      // close X on the position, cancel X on the order
      await p.evaluate(() => { window.confirm = () => true; });
      await p.click('#stkpo-dock [data-t=ord]'); await p.click('#stkpo-dock [data-x="0"]');
      check(await wait(p, () => window.__stkPaper.account.state.orders.length === 0), L + 'cancel X cancels the order');
      check(/No open orders/.test(await p.textContent('#stkpo-dock .stkpo-view')), L + 'empty state "No open orders"');
      await p.click('#stkpo-dock [data-t=pos]'); await p.click('#stkpo-dock [data-x="0"]');
      check(await wait(p, () => Object.keys(window.__stkPaper.account.state.positions).length === 0), L + 'close X closes the position');
      check(/No open positions/.test(await p.textContent('#stkpo-dock .stkpo-view')), L + 'empty state "No open positions"');
      await p.click('#stkpo-dock [data-t=th]'); await p.waitForTimeout(200);
      check((await p.$$eval('#stkpo-dock tbody tr', (a) => a.length)) === 1, L + 'closed trade lands in Trade history');
      check(await wait(p, () => document.querySelector('#stkpo-btn .stkpo-n').hidden), L + 'badge gone when flat');
      // alignment numbers for the open dock row (tab row + close button)
      const al = await p.evaluate(() => { const R = (s) => { const e = document.querySelector(s).getBoundingClientRect(); return { cy: e.y + e.height / 2, h: e.height, l: e.left, r: e.right }; }; const t = document.querySelector('#stkpo-dock .stkpo-tabs [role=tab]').getBoundingClientRect(), c = R('.stkpo-close'), hd = R('.stkpo-head'); return { tabCy: t.y + t.height / 2, closeCy: c.cy, tabL: t.left - hd.l, closeR: hd.r - c.r }; });
      check(Math.abs(al.tabCy - al.closeCy) <= 1, L + 'tab row and close button share one centre', al);
      console.log('  numbers', JSON.stringify({ cySpread: +spread.toFixed(2), btnH: pb.h, barOverflow: m0.sw - m0.cw, dockHeadPad: [al.tabL, al.closeR] }));
      await p.click('#stkpo-btn'); await p.waitForTimeout(300);
      await p.screenshot({ path: OUT + '/bar-' + w + '-' + tn + '-closed.png', clip: { x: 0, y: 700, width: w, height: 200 } });
      await p.click('#stkpo-btn'); await p.waitForTimeout(300);
      await p.screenshot({ path: OUT + '/bar-' + w + '-' + tn + '-open-crop.png', clip: { x: 0, y: 600, width: w, height: 300 } });
      check(errs.length === 0, L + 'no console errors', errs);
      await ctx.close();
    }
    // phones: icon only + bottom sheet
    for (const w of [412, 390]) {
      const { ctx, p, errs } = await open(b, w, 'night'), L = w + ': ';
      const info = await p.evaluate(() => { const e = document.getElementById('stkpo-btn'); const r = e.getBoundingClientRect(); const l = e.querySelector('.stkpo-l').getBoundingClientRect(); return { w: r.width, h: r.height, vis: r.width > 0, labelW: l.width, aria: e.getAttribute('aria-label'), title: e.title, inBar: !!e.closest('.vela-widget-bottombar') || !!e.closest('.stkpt-head') }; });
      check(info.vis && info.labelW <= 1 && /Positions & Orders/.test(info.aria) && /Positions & Orders/.test(info.title), L + 'icon-only with aria-label + tooltip', info);
      console.log('  btn', JSON.stringify(info));
      await p.evaluate(() => window.__stkPaper.placeOrder({ symbol: 'hyperliquid:BTC', side: 'buy', type: 'market', qty: 1 }));
      await wait(p, () => Object.keys(window.__stkPaper.account.state.positions).length === 1);
      await p.evaluate(() => window.__stkPosOrders.toggle(true)); await p.waitForTimeout(600);
      const sh = await p.evaluate(() => { const d = document.getElementById('stkpo-dock'), r = d.getBoundingClientRect(); return { sheet: d.classList.contains('sheet'), bottom: r.bottom, vh: innerHeight, w: r.width, vis: !d.hidden, hscroll: document.documentElement.scrollWidth > innerWidth }; });
      check(sh.vis && sh.sheet && Math.abs(sh.bottom - sh.vh) <= 1 && Math.abs(sh.w - w) <= 1 && !sh.hscroll, L + 'opens as a bottom sheet, no page overflow', sh);
      await p.screenshot({ path: OUT + '/sheet-' + w + '-dark.png' });
      await p.keyboard.press('Escape');
      check(await wait(p, () => document.getElementById('stkpo-dock').hidden), L + 'Esc closes the sheet');
      await p.screenshot({ path: OUT + '/phone-' + w + '-closed.png' });
      check(errs.length === 0, L + 'no console errors', errs);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
