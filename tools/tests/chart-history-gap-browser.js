// History gap (Owner bug 08 Nov, Discord #bug-reports): NQ1! 5m + a Pine script (Liquidity Master) and/or a
// 2-chart layout stopped loading older candles; blank space stayed left of the oldest bar.
// Scenarios (desktop 1440, phone 390): plain / +Liquidity Master / 2-chart layout + LM on both.
// For each: drag back ~12 screens; assert the chart ends up with data left of the view (oldest bar
// is not later than the view's left edge unless the source depth ~59 d is reached), and that a
// first view with an empty area on the left triggers a load without any scroll.
//   node tools/tests/chart-dev-server.mjs 8071 &
//   CHART_BASE=http://127.0.0.1:8071 OUT=/tmp/hg flock /tmp/stryker-chrome.lock node tools/tests/chart-history-gap-browser.js
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8071';
const OUT = process.env.OUT || '/tmp/history-gap';
fs.mkdirSync(OUT, { recursive: true });
const DAY = 864e5, NAME = 'Liquidity Master [TradeZoro]';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

async function open(b, w, h, inject) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance|data-api\.binance|fapi\.binance|stream\.binance|data-stream\.binance)/, (r) => r.abort());
  // Failure injection (live-like upstream trouble): pages cur-4 and cur-5 (~8-10 days back).
  if (inject) {
    const cur = Math.floor(Date.now() / 1000 / 172800); const seen = {};
    await ctx.route(/\/api\/chart\/bars\/NQ\?tf=5&page=\d+/, (r) => {
      const pg = +/page=(\d+)/.exec(r.request().url())[1]; seen[pg] = (seen[pg] || 0) + 1;
      if (inject === 'empty2' && (pg === cur - 4 || pg === cur - 5)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '5', page: pg, bars: [] }) });
      if (inject === 'err' && pg === cur - 4 && seen[pg] <= 3) return r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"upstream unavailable"}' });
      if (inject === 'hang' && pg === cur - 4 && seen[pg] === 1) return;   // never answered
      return r.continue();
    });
  }
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE && window.__stkHistoryPager, null, { timeout: 60000 });
  return { ctx, p };
}
const settle = (p, idx) => p.evaluate(async (idx) => {
  const c = window.STRYKER_VELA.context().cells[idx].chart;
  for (let i = 0; i < 90; i++) { await new Promise((r) => setTimeout(r, 500)); try { if (c.orchestrator.rawBars.length > 50 && c.orchestrator.historyState !== 'backfill' && !c.orchestrator.switchingMarket) break; } catch (e) {} }
}, idx);
const setMkt = async (p, idx) => {
  await p.evaluate((idx) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[idx].id); c.setSymbol('futures:NQ1!'); c.setTimeframe('5'); }, idx);
  await settle(p, idx);
};
const addLM = async (p, idx) => {
  await p.evaluate((i) => { const ws = window.STRYKER_VELA; ws.setActiveCell(ws.context().cells[i].id); }, idx);
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await p.waitForSelector('.stkiw-row', { timeout: 20000 });
  await p.evaluate(() => document.querySelector('.stkiw-tab[data-k="picks"]').click());
  await p.waitForTimeout(300);
  const before = await p.evaluate((i) => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[i].chart).length, idx);
  await p.evaluate((n) => [...document.querySelectorAll('.stkiw-row')].find((r) => (r.querySelector('.stkiw-nm') || {}).textContent === n).querySelector('.stkiw-name').click(), NAME);
  await p.waitForFunction(([n, i]) => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[i].chart).length > n, [before, idx], { timeout: 60000 });
  await p.evaluate(() => { try { window.STRYKER_VELA.indicatorPicker.close(); } catch (e) {} });
  await p.waitForTimeout(3000);
};
const st = (p, idx) => p.evaluate(async (idx) => {
  for (let i = 0; i < 60 && !(window.STRYKER_VELA.context().cells[idx].chart.orchestrator.rawBars || []).length; i++) await new Promise((r) => setTimeout(r, 500));
  const c = window.STRYKER_VELA.context().cells[idx].chart; const o = c.orchestrator; const b = o.rawBars; const vr = c.getVisibleRange();
  const R = c.renderer.renderer; const r = R.wrapper.getBoundingClientRect();
  return { n: b.length, oldest: b[0].time, from: vr.from, to: vr.to, busy: !!(c.__stkPager && c.__stkPager.busy), hist: o.historyState,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height }, stats: window.__stkHistoryPager.stats() };
}, idx);
// the view's left edge is "covered" when a bar exists at or before it (or within 2 bars of it)
const gapBars = (s) => Math.max(0, Math.round((s.oldest - s.from) / 300000));
async function drag(p, idx, px, touch) {
  const s = await st(p, idx); const y = s.rect.y + s.rect.h * 0.45, x0 = s.rect.x + s.rect.w * 0.25;
  if (touch) {
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let k = 1; k <= 10; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + px * k / 10, y }] }); await p.waitForTimeout(16); }
    await p.waitForTimeout(150); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
  } else {
    await p.mouse.move(x0, y); await p.mouse.down();
    for (let k = 1; k <= 10; k++) { await p.mouse.move(x0 + px * k / 10, y); await p.waitForTimeout(16); }
    await p.waitForTimeout(150); await p.mouse.up();
  }
  await p.waitForTimeout(300);
}
// Drag back N times, waiting for loads; report how far the view got and whether blank space remains.
async function scrollBack(p, idx, touch, drags, inject) {
  const s0 = await st(p, idx); let s = s0;
  for (let i = 0; i < drags; i++) {
    await drag(p, idx, touch ? 280 : 700, touch);
    for (let k = 0; k < 40; k++) { s = await st(p, idx); if (!s.busy) break; await p.waitForTimeout(250); }
  }
  await p.waitForTimeout(2500);
  for (let k = 0; k < 40; k++) { s = await st(p, idx); if (!s.busy) break; await p.waitForTimeout(250); }
  if (inject) { for (let k = 0; k < 20; k++) { await p.waitForTimeout(3000); s = await st(p, idx); if (gapBars(s) <= 2 || s.n > s0.n + 3000) break; await drag(p, idx, 300, touch); } }
  return { s0, s };
}
async function scenario(b, label, w, h, touch, { lm, two, inject }) {
  const { ctx, p } = await open(b, w, h, inject);
  if (two) { await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('2h')); await p.waitForTimeout(2500); }
  const cells = two ? 2 : 1;
  for (let i = 0; i < cells; i++) { await setMkt(p, i); if (lm) await addLM(p, i); }
  // First view: no empty area on the left without any scroll (when older data exists).
  for (let i = 0; i < cells; i++) {
    await p.waitForTimeout(1500);
    const f = await st(p, i);
    check(gapBars(f) <= 2, `${label} chart${i}: first view has no empty area on the left`, { gapBars: gapBars(f), n: f.n });
  }
  for (let i = 0; i < cells; i++) {
    const { s0, s } = await scrollBack(p, i, touch, 14, inject);
    const days = (s0.oldest - s.oldest) / DAY;
    console.log(label, 'chart' + i, { n0: s0.n, n: s.n, oldest: new Date(s.oldest).toISOString(), from: new Date(s.from).toISOString(), stats: s.stats });
    check(gapBars(s) <= 2 || (Date.now() - s.oldest) / DAY > 57, `${label} chart${i}: no blank space left of the oldest bar (or source depth reached)`, { gapBars: gapBars(s), depthDays: ((Date.now() - s.oldest) / DAY).toFixed(1) });
    check(s.n > s0.n, `${label} chart${i}: older history loaded`, [s0.n, s.n, days.toFixed(1) + ' d']);
  }
  await p.screenshot({ path: `${OUT}/${label}.png` });
  await ctx.close();
}
(async () => {
  const b = await launch();
  const only = process.env.ONLY;
  const run = (label, ...a) => (!only || only === label) ? scenario(b, label, ...a) : null;
  await run('1440-plain', 1440, 900, false, {});
  await run('1440-lm', 1440, 900, false, { lm: true });
  await run('1440-two-lm', 1440, 900, false, { lm: true, two: true });
  await run('1440-empty2', 1440, 900, false, { inject: 'empty2' });
  await run('1440-err', 1440, 900, false, { inject: 'err' });
  await run('1440-hang', 1440, 900, false, { inject: 'hang' });
  await run('390-lm', 390, 844, true, { lm: true });
  await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
