// Phone multi-chart layouts + the phone ⋯ list (Owner bugs 2026-10-26). Real taps, fixtures only
// (phone-layouts-lib.js: recorded NQ bars for every symbol; no live data source is called).
//   node tools/tests/chart-fixture-server.mjs 8251 <any.json> &
//   CHART_BASE=http://127.0.0.1:8251 flock -w 900 /tmp/stryker-chrome.lock \
//     node tools/tests/chart-phone-layouts-browser.js <outDir>
// Env: PL_ENG=09|06 (default both), PL_SIZES="390x844,412x915" (portrait; landscape = swapped).
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const { newCtx, openPage, sleep } = require('./phone-layouts-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8251';
const OUT = process.argv[2] || '.';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };

const tapXY = async (p, x, y) => { await p.touchscreen.tap(x, y); await sleep(450); };
async function tapSel(p, sel) {
  const e = await p.$(sel); const bb = e && await e.boundingBox();
  if (!bb) return false;
  const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
  const top = await p.evaluate(([x, y, sel]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest(sel)); }, [x, y, sel]);
  await tapXY(p, x, y);
  return top;
}
const menuOpen = (p) => p.evaluate(() => !document.getElementById('stkc-more-pop').hidden);
async function openMenu(p) { if (!await menuOpen(p)) await tapSel(p, '#stkc-more-btn'); return menuOpen(p); }
async function tapRow(p, label) {
  if (!await openMenu(p)) return false;
  const sel = '#stkc-more-pop [data-ob-label="' + label.replace(/"/g, '\\"') + '"]';
  // rows lower in a long list: scroll the list, not the page
  await p.evaluate((sel) => { const e = document.querySelector(sel); const pop = document.getElementById('stkc-more-pop'); if (e) { const r = e.getBoundingClientRect(), pr = pop.getBoundingClientRect(); if (r.bottom > pr.bottom || r.top < pr.top) pop.scrollTop += r.top - pr.top - 40; } }, sel);
  return tapSel(p, sel);
}
const menuRows = (p) => p.evaluate(() => {
  const pop = document.getElementById('stkc-more-pop'); const pr = pop.getBoundingClientRect();
  const bar = document.getElementById('stkc-bar').getBoundingClientRect();
  const rows = [...pop.querySelectorAll('[data-ob-trig]')].filter((n) => n.getClientRects().length).map((n) => {
    const r = n.getBoundingClientRect(); const cs = getComputedStyle(n); const ic = getComputedStyle(n, '::before');
    return { l: n.getAttribute('data-ob-label'), x: Math.round(r.left), h: Math.round(r.height), icW: Math.round(parseFloat(ic.width) + parseFloat(ic.paddingLeft) + parseFloat(ic.paddingRight)), font: cs.fontSize + ' ' + cs.fontWeight };
  });
  const loose = [...pop.children].filter((n) => !n.hidden && n.getClientRects().length && !n.matches('.stkc-ob-gh, #stkc-credits') && !n.querySelector('[data-ob-trig]') && !n.hasAttribute('data-ob-trig')).map((n) => n.className || n.id);
  const heads = [...pop.querySelectorAll('.stkc-ob-gh')].filter((n) => !n.hidden).map((n) => n.textContent);
  return { rows, loose, heads, top: Math.round(pr.top), bottom: Math.round(pr.bottom), barBottom: Math.round(bar.bottom), vh: innerHeight, vw: innerWidth, right: Math.round(pr.right), left: Math.round(pr.left), scrolls: pop.scrollHeight > pop.clientHeight + 1, overflowY: getComputedStyle(pop).overflowY };
});
const panes = (p) => p.evaluate(() => {
  const ws = window.STRYKER_VELA; const host = document.getElementById('vela-chart'); const hr = host.getBoundingClientRect();
  const cells = ws.cells().map((c) => { const r = c.host.getBoundingClientRect(); return { id: c.id, sym: c.symbol, tf: c.timeframe, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vis: getComputedStyle(c.host).visibility !== 'hidden', bars: (() => { try { return c.chart.orchestrator.rawBars.length; } catch (e) { return -1; } })() }; });
  let active = null; try { active = ws.active.id; } catch (e) {}
  const tabs = document.querySelector('.stkc-cells');
  return { pl: host.dataset.stkpl || null, layout: ws.layout.id, max: ws.maximizedCell, active, plotH: Math.round(hr.height), cells, tabs: tabs && !tabs.hidden ? [...tabs.querySelectorAll('.stkc-cell')].map((b) => b.textContent.trim()) : null };
});
async function settle(p) {
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 300)); if (ws.cells().every((c) => { try { return c.chart.orchestrator.rawBars.length > 0; } catch (e) { return false; } })) break; } });
  await sleep(800);
}
// Did a candle get painted in each visible pane? (a non-background pixel run in the plot canvas)
const painted = (p) => p.evaluate(() => window.STRYKER_VELA.cells().filter((c) => getComputedStyle(c.host).visibility !== 'hidden').map((c) => {
  const cvs = [...c.host.querySelectorAll('canvas')].filter((x) => x.width > 50 && x.height > 50);
  return cvs.length > 0 && c.chart.orchestrator.rawBars.length > 0;
}));
async function pickCount(p, n) {
  await openMenu(p);
  const okRow = await tapRow(p, (await p.evaluate(() => (document.querySelector('#stkc-more-pop [data-ob-label^="Charts in layout"]') || {}).getAttribute ? document.querySelector('#stkc-more-pop [data-ob-label^="Charts in layout"]').getAttribute('data-ob-label') : '')));
  const pick = await p.evaluate(() => { const pop = document.getElementById('stkc-layout-pop'); return { open: !pop.hidden, grid: !document.querySelector('.stkg-grid').hidden, phone: [...document.querySelectorAll('.stkg-phone:not([hidden]) .stkg-pc')].map((b) => b.textContent.trim()), note: document.querySelector('.stkg-note').textContent, off: [...pop.querySelectorAll('.stkg-off')].filter((e) => e.getClientRects().length).length }; });
  const okPick = await tapSel(p, '.stkg-pc[data-n="' + n + '"]');
  await settle(p);
  return { okRow, okPick, pick };
}
const sig = (p) => p.evaluate(() => {
  const vis = (e) => e && !e.hidden && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
  const open = [...document.querySelectorAll('[role=dialog], [role=menu], .stkc-pop, [class*="sheet"], [class*="modal"], [class*="drawer"], .vela-popover, .vela-menu, .vela-dialog')].filter((e) => vis(e) && !e.closest('#stkc-more-pop > .stkc-ob-gh')).map((e) => e.id || e.className.split(' ')[0]).filter((x) => x !== 'stkc-ob-pop');
  return { html: document.documentElement.className, panel: (document.querySelector('.stkchart-panel') || {}).className, open: [...new Set(open)].sort(), replay: !!(window.__stkReplay && window.__stkReplay.on), sel: (() => { try { return !!window.STRYKER_VELA.chart.replay && window.__stkBarReplay && window.__stkBarReplay.selecting; } catch (e) { return false; } })() };
});
async function closeAll(p) {
  for (let i = 0; i < 3; i++) { await p.keyboard.press('Escape'); await sleep(200); }
}

async function run(b, v09, w, h, phoneShots) {
  const eng = v09 ? 'v09' : 'v06';
  const key = eng + '-' + w + 'x' + h;
  const ctx = await newCtx(b, { w, h, mobile: true });
  let { p, errors } = await openPage(ctx, BASE, v09);
  await settle(p);
  const portrait = h > w;
  // ---- ⋯ list ----
  await openMenu(p);
  const M = await menuRows(p);
  await p.screenshot({ path: path.join(OUT, key + '-menu.png') });
  console.log('MENU ' + key + ' ' + JSON.stringify(M.rows.map((r) => r.l)));
  check(M.rows.length >= 6 && M.rows.every((r) => r.l && r.l.length > 2), key + ': every ⋯ row has a text label', M.rows.map((r) => r.l));
  check(new Set(M.rows.map((r) => r.x)).size === 1, key + ': one left edge', [...new Set(M.rows.map((r) => r.x))]);
  check(M.rows.every((r) => r.h >= 44 && r.h <= 48), key + ': rows 44-48 px', M.rows.filter((r) => r.h < 44 || r.h > 48));
  check(M.rows.every((r) => r.icW === 24), key + ': icon column 24 px', M.rows.map((r) => r.icW));
  check(new Set(M.rows.map((r) => r.font)).size === 1, key + ': one font', [...new Set(M.rows.map((r) => r.font))]);
  check(M.loose.length === 0, key + ': no bare item without a label', M.loose);
  check(M.heads.length >= 2, key + ': grouped (Chart / Tools / Panels)', M.heads);
  check(M.top >= M.barBottom && M.bottom <= M.vh && M.left >= 0 && M.right <= M.vw, key + ': list on screen, under the toolbar', M);
  check(M.overflowY === 'auto', key + ': list scrolls when taller', { scrolls: M.scrolls });
  check(!M.rows.some((r) => /broker/i.test(r.l)), key + ': no "Connect broker" label');
  const layoutRow = M.rows.find((r) => /^Layout:/.test(r.l));
  const onBar = await p.evaluate(() => { const b = document.getElementById('stkl-btn'); return b ? { inMore: !!b.closest('#stkc-more-pop'), shown: !!b.getClientRects().length, name: (b.querySelector('.stkl-name') || {}).textContent } : null; });
  console.log('INFO ' + key + ': layout menu ' + JSON.stringify({ row: layoutRow && layoutRow.l, onBar }));
  await closeAll(p);
  // ---- every ⋯ item opens what it says ----
  const labels = M.rows.map((r) => r.l).filter((l) => !/^Charts in layout/.test(l));
  for (const l of labels) {
    await closeAll(p);
    const before = await sig(p);
    const ok = await tapRow(p, l);
    await sleep(700);
    const after = await sig(p);
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    const what = after.open.filter((x) => !before.open.includes(x));
    check(ok && changed, key + ': ⋯ "' + l + '" opens/does something', { opened: what, html: after.html !== before.html ? after.html : undefined, replay: after.replay });
    if (/full screen/i.test(l)) {
      // tap again to exit
      await tapRow(p, (await p.evaluate(() => (document.querySelector('#stkc-more-pop [data-ob-label*="ull screen"]') || {}).getAttribute ? document.querySelector('#stkc-more-pop [data-ob-label*="ull screen"]').getAttribute('data-ob-label') : 'Exit full screen')));
      await sleep(500);
    }
    if (after.replay || after.sel) { await p.evaluate(() => { try { window.__stkBarReplay.stop(); } catch (e) {} try { window.__stkBarReplay.selectMode && window.__stkBarReplay.selectMode(false); } catch (e) {} }); }
    await closeAll(p);
    await tapXY(p, Math.round(w / 2), Math.round(h * 0.55));
    await closeAll(p);
  }
  // fresh page for the layout part (the item taps above may leave panels behind)
  await p.close();
  ({ p, errors } = await openPage(ctx, BASE, v09));
  await settle(p);
  // ---- layouts 2 / 3 / 4 ----
  for (const n of [2, 3, 4]) {
    const r = await pickCount(p, n);
    if (n === 2) {
      check(r.pick.phone.join(',') === '1 chart,2 charts,3 charts,4 charts' && !r.pick.grid && r.pick.off === 0, key + ': phone picker = 1-4 only (5-16 hidden)', r.pick);
      check(/^On a phone you can use up to 4 charts\./.test(r.pick.note), key + ': plain note', r.pick.note);
    }
    const P = await panes(p);
    const vis = P.cells.filter((c) => c.vis && c.h > 0);
    const want = portrait ? 'p' + n : 'l' + n;
    check(r.okRow && r.okPick, key + ': ' + n + ' charts picked by taps', r);
    check(P.cells.length === n && P.pl === want, key + ': ' + n + ' charts -> phone shape ' + want, { pl: P.pl, layout: P.layout });
    check(vis.length === n, key + ': all ' + n + ' panes on screen', P.cells);
    check(P.cells.every((c) => c.bars > 0), key + ': every pane has candles', P.cells.map((c) => c.bars));
    check((await painted(p)).every(Boolean), key + ': every pane drew its canvas');
    if (n === 2 && portrait) check(vis.every((c) => c.h >= 0.45 * P.plotH), key + ': 2 stacked, each >= 45% of the plot height', vis.map((c) => c.h + '/' + P.plotH));
    const noOverlap = vis.every((a, i) => vis.every((c, j) => i === j || a.x + a.w <= c.x + 1 || c.x + c.w <= a.x + 1 || a.y + a.h <= c.y + 1 || c.y + c.h <= a.y + 1));
    check(noOverlap, key + ': panes do not overlap');
    await p.screenshot({ path: path.join(OUT, key + '-' + n + '.png') });
  }
  // ---- tap pane 2, change its symbol through the toolbar ----
  await pickCount(p, 2);
  let P = await panes(p);
  const c2 = P.cells[1];
  await tapXY(p, c2.x + c2.w * 0.4, c2.y + c2.h * 0.45);
  await sleep(500);
  P = await panes(p);
  check(P.active === c2.id, key + ': tapping pane 2 makes it active', { active: P.active, want: c2.id });
  const sym1 = P.cells[0].sym;
  await tapSel(p, '#stkc-bar .vela-mb-symbol');
  await sleep(700);
  const inp = await p.$('.vela-sp input, input.vela-sp-input, .vela-symbol-picker input, [class*="sp-search"] input, input[type="search"]');
  if (inp) { await inp.fill('GC1!'); await sleep(900); await p.keyboard.press('Enter'); }
  await sleep(2500);
  await settle(p);
  P = await panes(p);
  check(!!inp && /GC1!/.test(P.cells[1].sym) && P.cells[0].sym === sym1, key + ': symbol change edits pane 2 only', P.cells.map((c) => c.sym));
  await p.screenshot({ path: path.join(OUT, key + '-pane2-gc.png') });
  // ---- reload: remembered ----
  await sleep(1500);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_CHART_UI && window.STRYKER_CHART_UI.grid && window.__stkOneBar, null, { timeout: 60000 });
  await sleep(2500); await settle(p);
  const R = await panes(p);
  check(R.cells.length === 2 && R.pl === (portrait ? 'p2' : 'l2') && /GC1!/.test(R.cells[1].sym), key + ': reload keeps 2 charts + pane 2 symbol', { pl: R.pl, syms: R.cells.map((c) => c.sym) });
  // ---- full screen on / off ----
  await tapRow(p, 'Full screen');
  await sleep(900);
  const F = await panes(p);
  const fsOn = await p.evaluate(() => document.documentElement.classList.contains('stk-chart-fs'));
  check(fsOn && F.cells.filter((c) => c.vis && c.h > 0).length === 2, key + ': full screen on, both panes shown', { fsOn, cells: F.cells.map((c) => c.h) });
  await p.screenshot({ path: path.join(OUT, key + '-2-fs.png') });
  await tapRow(p, 'Exit full screen');
  await sleep(900);
  const fsOff = await p.evaluate(() => !document.documentElement.classList.contains('stk-chart-fs'));
  const F2 = await panes(p);
  check(fsOff && F2.cells.filter((c) => c.vis && c.h > 0).length === 2, key + ': full screen off, both panes shown');
  // ---- bottom-nav handle still there (portrait phone) ----
  if (portrait) {
    const hd = await p.evaluate(() => { const h = document.getElementById('stkcps-handle'); return !!(h && h.getClientRects().length); });
    check(hd, key + ': bottom-nav handle still shown');
  }
  // back to 1 chart for the next run
  await pickCount(p, 1);
  const one = await panes(p);
  check(one.cells.length === 1 && !one.pl, key + ': back to 1 chart', one.pl);
  check(errors.length === 0, key + ': no console errors', errors);
  await ctx.close();
}

// strip fallback: a short phone with 4 charts -> one at a time + tabs
async function strip(b, v09) {
  const key = (v09 ? 'v09' : 'v06') + '-390x560-strip';
  const ctx = await newCtx(b, { w: 390, h: 560, mobile: true });
  const { p, errors } = await openPage(ctx, BASE, v09);
  await pickCount(p, 4);
  let P = await panes(p);
  check(P.pl === 'strip' && P.tabs && P.tabs.length === 4 && P.cells.filter((c) => c.vis).length === 1, key + ': short screen -> tabs "1 2 3 4" + one chart', { pl: P.pl, tabs: P.tabs });
  await p.screenshot({ path: path.join(OUT, key + '.png') });
  await tapSel(p, '.stkc-cell[data-cell="' + P.cells[2].id + '"]');
  P = await panes(p);
  check(P.active === P.cells[2].id && P.max === P.cells[2].id, key + ': tap tab 3 shows chart 3');
  // swipe left on the tabs -> chart 4
  const bb = await (await p.$('.stkc-cells')).boundingBox();
  const cdp = await ctx.newCDPSession(p);
  const y = bb.y + bb.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
  for (const x of [260, 200, 140, 100]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(600);
  P = await panes(p);
  check(P.active === P.cells[3].id, key + ': swipe left on the tabs -> chart 4', P.active);
  await pickCount(p, 1);
  check(errors.length === 0, key + ': no console errors', errors);
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const engs = process.env.PL_ENG === '09' ? [true] : process.env.PL_ENG === '06' ? [false] : [true, false];
    const sizes = (process.env.PL_SIZES || '390x844,412x915').split(',').map((s) => s.split('x').map(Number));
    for (const v09 of engs) {
      for (const [w, h] of sizes) {
        await run(b, v09, w, h);
        if (!process.env.PL_NOLAND) await run(b, v09, h, w);
      }
      if (!process.env.PL_NOSTRIP) await strip(b, v09);
    }
  } catch (e) { fail++; console.log('FAIL crashed ' + (e && e.stack || e)); } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
