// Charts endless scroll-back (assets/chart-history-pager.js), Owner order 2026-10-22 ("tv feel gap" row 1).
// Against tools/tests/chart-dev-server.mjs (real /api/chart/bars, live Yahoo upstream).
// On NQ1! 15m: drag the chart back with the mouse until the left edge is 25 days older than the
// first load; asserts history keeps growing past 500 bars, the candle under the cursor does not
// move when a page lands (no view jump), bars stay strictly ascending, no page errors, then a quick
// pass on 5m and 1h, and a 390 px phone swipe.
//   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-history-pager-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const DAY = 864e5;

async function open(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.__stkHistoryPager, null, { timeout: 60000 });
  return { ctx, p, errors };
}
const set = (p, sym, tf) => p.evaluate(async ([sym, tf]) => {
  const ws = window.STRYKER_VELA; const c = ws.cell(ws.active.id);
  if (c.symbol !== sym) c.setSymbol(sym);
  if (String(c.timeframe) !== tf) c.setTimeframe(tf);
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const o = c.chart.orchestrator;
    if (String(o.config.market.timeframe) === tf && o.rawBars.length > 50 && o.historyCompleted && !o.switchingMarket) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await new Promise((r) => setTimeout(r, 1200));
}, [sym, tf]);
const state = (p) => p.evaluate(() => {
  const ws = window.STRYKER_VELA; const c = ws.cell(ws.active.id); const o = c.chart.orchestrator; const R = c.chart.renderer.renderer;
  const b = o.rawBars; const vr = c.chart.getVisibleRange();
  let mono = true; for (let i = 1; i < b.length; i++) if (b[i].time <= b[i - 1].time) { mono = false; break; }
  const rect = R.wrapper ? R.wrapper.getBoundingClientRect() : null;
  return { n: b.length, oldest: b[0] && b[0].time, newest: b[b.length - 1] && b[b.length - 1].time, from: vr && vr.from, to: vr && vr.to, mono,
    busy: !!(c.chart.__stkPager && c.chart.__stkPager.busy), hist: o.historyState, stats: window.__stkHistoryPager.stats(),
    rect: rect && { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
});
// Time of the bar at screen x (via Vela's coords), to see whether the view jumps when a page lands.
const timeAt = (p, x) => p.evaluate((x) => {
  const ws = window.STRYKER_VELA; const c = ws.cell(ws.active.id); const R = c.chart.renderer.renderer;
  const rect = R.wrapper.getBoundingClientRect();
  try { const L = Math.round(R.coords.xToLogical(x - rect.x)); return R.coords.logicalToTime(L); } catch (e) { return null; }
}, x);

async function dragBack(p, st, steps, px, touch) {
  const r = st.rect; const y = r.y + r.h * 0.45; const x0 = r.x + r.w * 0.25;
  for (let i = 0; i < steps; i++) {
    if (touch) {
      const cdp = await p.context().newCDPSession(p);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
      for (let k = 1; k <= 10; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (px * k) / 10, y }] }); await p.waitForTimeout(16); }
      await p.waitForTimeout(150);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    } else {
      await p.mouse.move(x0, y); await p.mouse.down();
      for (let k = 1; k <= 10; k++) { await p.mouse.move(x0 + (px * k) / 10, y); await p.waitForTimeout(16); }
      await p.waitForTimeout(150); await p.mouse.up();   // hold still before release: no glide
    }
    await p.waitForTimeout(250);
  }
}

(async () => {
  const b = await launch();
  let { ctx, p, errors } = await open(b, { w: 1440, h: 900 });
  await set(p, 'NQ1!', '15');
  const s0 = await state(p);
  console.log('first load', { n: s0.n, oldest: new Date(s0.oldest).toISOString(), from: new Date(s0.from).toISOString() });
  check(s0.n > 100, 'NQ 15m first load painted', s0.n);

  // Record the visible range right before and right after every prepend (view jump probe).
  await p.evaluate(() => {
    const ws = window.STRYKER_VELA; const c = ws.cell(ws.active.id); const o = c.chart.orchestrator;
    window.__pg = [];
    const orig = o.setBarSeries.bind(o);
    o.setBarSeries = (raw, opts) => {
      const a = c.chart.getVisibleRange(); const n0 = o.rawBars.length;
      orig(raw, opts);
      if (opts && opts.preserveView && raw.length > n0) { const z = c.chart.getVisibleRange(); window.__pg.push({ n0, n1: raw.length, a, z }); }
    };
  });
  // Drag back until the left edge is 25 days older than the first load's oldest bar (240 s cap).
  const goal = s0.oldest - 25 * DAY;   // 25 d: needs at least two pages to land
  const tStart = Date.now();
  let drags = 0;
  while (Date.now() - tStart < 240000) {
    const st = await state(p);
    if (st.from <= goal) break;
    await dragBack(p, st, 1, 900, false); drags++;
  }
  await p.waitForTimeout(1500);
  const jumps = await p.evaluate(() => window.__pg);
  const s1 = await state(p);
  const secs = (Date.now() - tStart) / 1000;
  console.log('after drag', { drags, secs, n: s1.n, oldest: new Date(s1.oldest).toISOString(), from: new Date(s1.from).toISOString(), stats: s1.stats });
  check(s1.n > 500, 'history grew past 500 bars', s1.n);
  check(s1.from <= goal, 'dragged back 25 days beyond the first load (left edge ' + ((s0.oldest - s1.from) / DAY).toFixed(1) + ' d older)', { secs, drags });
  check(((s0.from - s1.from) / DAY) >= 25, 'view moved 25+ days back in time', ((s0.from - s1.from) / DAY).toFixed(1));
  check(s1.mono, 'bars strictly ascending after prepends');
  check(s1.newest === s0.newest || s1.newest > s0.newest, 'newest bar kept');
  check(jumps.length >= 2, 'two or more pages landed while dragging', jumps.length);
  check(jumps.every((j) => j.a && j.z && j.a.from === j.z.from && j.a.to === j.z.to), 'no view jump when a page lands (visible range identical before/after each prepend)', jumps);
  check(s1.stats.requests <= 20, 'request count bounded (one chunk per approach, no polling)', s1.stats);
  await p.screenshot({ path: OUT + '/pager-1440-15m-back.png' });

  // Idle: no requests while the view sits still (no polling).
  const r0 = (await state(p)).stats.requests;
  await p.waitForTimeout(5000);
  const r1 = (await state(p)).stats.requests;
  check(r1 === r0, 'no history requests while idle', [r0, r1]);

  for (const tf of ['5', '60']) {
    await set(p, 'NQ1!', tf);
    const a = await state(p);
    await dragBack(p, a, 8, 600, false);
    await p.waitForTimeout(2500);
    const z = await state(p);
    check(z.n > a.n && z.mono, `NQ ${tf}: history grows on scroll-back`, [a.n, z.n, new Date(z.oldest).toISOString()]);
  }
  check(!errors.filter((e) => !/docChanges/.test(e)).length, 'no page errors (desktop; the stub-only docChanges error is ignored)', errors);
  await ctx.close();

  ({ ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true }));
  await set(p, 'NQ1!', '15');
  const m0 = await state(p);
  await dragBack(p, m0, 10, 260, true);
  await p.waitForTimeout(2500);
  const m1 = await state(p);
  check(m1.n > m0.n && m1.mono, 'phone 390: swipe back loads older history', [m0.n, m1.n]);
  await p.screenshot({ path: OUT + '/pager-390-15m-back.png' });
  check(!errors.filter((e) => !/docChanges/.test(e)).length, 'no page errors (phone; stub-only docChanges ignored)', errors);
  await ctx.close();
  await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
