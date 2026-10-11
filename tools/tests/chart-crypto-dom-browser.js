// Charts "Crypto DOM Heatmap (Binance)" browser test: resting liquidity at price levels
// (assets/chart-orderflow.js stk_crypto_dom). Uses Binance's public order book, no key.
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 [WAIT_MIN=3.5] [SYM=binance:BTCUSDT] \
//     flock /tmp/stryker-chrome.lock node tools/tests/chart-crypto-dom-browser.js [shotsDir]
// Checks: no console errors; the Style setting switches (Combined / Heatmap / Depth / Walls);
// wall labels are in base-asset units ("BTC"); old saved charts ('right ladder') still load;
// a non-Binance symbol shows the "needs a Binance crypto symbol" message; phone 390 has no
// horizontal overflow and every on-chart text is free of "live" / "real-time".
// Phone budget (build 503 fix): a full-cap history (BOOK_HISTORY_MAX samples pushed through
// __stkFlow.domDebugFill) adds <= 25 MB of JS heap, and at 390 px with the CPU throttled 4x the
// redraw after a zoom that changes the price bucket takes <= 250 ms (MEM_MB / REBIN_MS override).
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const WAIT_MS = Number(process.env.WAIT_MIN || 3.5) * 60000;
const SYM = process.env.SYM || 'binance:BTCUSDT';
const BASE_ASSET = /BTC/.test(SYM) ? 'BTC' : SYM.replace(/^.*:/, '').replace(/USDT(\.P)?$/, '');
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MEM_MB = Number(process.env.MEM_MB || 25), REBIN_MS = Number(process.env.REBIN_MS || 250);
const VIEWS = ['Combined (heatmap + depth + walls)', 'Heatmap only', 'Depth bars only', 'Walls only'];

async function open(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance\.com|fapi\.binance\.com|data-api\.binance\.vision)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  // Ignored: the local dev server has no futures stream (ws 404), and Chrome logs "Ping received
  // after close" when the chart's own kline socket closes on a symbol switch (not this indicator).
  const IGNORE = [/ERR_FAILED|net::|status of 4|status of 5/, /WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/api\/chart\/stream/, /@kline_\w+' failed: Ping received after close/];
  p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.__stkFlow, null, { timeout: 45000 });
  await waitBars(p);
  return { ctx, p, errors };
}
const waitBars = (p) => p.evaluate(async () => {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {}
  }
  return false;
});
const setSym = (p, sym, tf) => p.evaluate(([s, tf]) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); if (tf) c.setTimeframe(tf); }, [sym, tf]);
const addDom = (p, inputs) => p.evaluate((i) => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_crypto_dom', i ? { inputs: i } : undefined); window.STRYKER_VELA.context().stateChanged(); }, inputs || null);
const setDom = (p, inputs) => p.evaluate((i) => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_crypto_dom'); h.setInputs(i); }, inputs);
const dbg = (p) => p.evaluate(() => window.__stkFlow.domDebug && window.__stkFlow.domDebug());
// Number of status-note tables the indicator shows (Vela's inspect() reports a count).
const tables = (p) => p.evaluate(() => { const i = window.STRYKER_VELA.context().cells[0].chart.inspect().indicators.find((x) => /Crypto DOM/.test(x.title)); return i ? i.tables : -1; });
// The last n 1m bars plus `pad` empty bars on the right, where the depth bars sit.
const zoom = (p, bars, pad) => p.evaluate(([n, pad]) => { const c = window.STRYKER_VELA.context().cells[0].chart; const b = c.orchestrator.rawBars; c.setVisibleRange({ from: b[Math.max(0, b.length - n)].time, to: b[b.length - 1].time + pad * 60000 }); }, [bars, pad]);
// Time a zoom to the last n bars: setVisibleRange, then two animation frames (the redraw).
const zoomFrame = (p, n) => p.evaluate(async (n) => {
  const c = window.STRYKER_VELA.context().cells[0].chart; const b = c.orchestrator.rawBars;
  const t0 = performance.now();
  c.setVisibleRange({ from: b[Math.max(0, b.length - n)].time, to: b[b.length - 1].time + 60000 });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return Math.round(performance.now() - t0);
}, n);
const ZOOMS = [12, 45, 8, 30];
async function shot(p, name) { await p.mouse.move(5, 5).catch(() => {}); await sleep(900); await p.screenshot({ path: OUT + '/' + name }); console.log('SHOT ' + OUT + '/' + name); }

(async () => {
  // precise heap numbers + window.gc() for the phone memory budget check
  const b = await launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  try {
    // desktop + phone run side by side so both build the same few minutes of book history
    const d = await open(b, { w: 1280, h: 800 });
    const m = await open(b, { w: 390, h: 844, mobile: true });
    for (const s of [d, m]) { await setSym(s.p, SYM, '1'); }
    await sleep(3000); await waitBars(d.p); await waitBars(m.p);
    // baseline: the same throttled zooms on the phone chart WITHOUT the indicator
    const cdp = await m.ctx.newCDPSession(m.p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const base = []; for (const n of ZOOMS) { base.push(await zoomFrame(m.p, n)); await sleep(400); }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log('baseline zoom redraw without the indicator (390 px, CPU x4) ms', JSON.stringify(base));
    await addDom(d.p); await addDom(m.p);
    const msg0 = await tables(d.p);
    check(msg0 === 1, 'status note shown while the book loads / history builds (' + msg0 + ')');
    console.log('building book history for ' + Math.round(WAIT_MS / 1000) + ' s');
    await sleep(WAIT_MS);
    await zoom(d.p, 30, 6);
    // Phone: show the candles the book history covers (history only exists from when the
    // indicator was added; nothing is backfilled or stretched), so the heatmap spans them.
    await m.p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; const st = window.__stkFlow.domDebug(); const b = c.orchestrator.rawBars; const from = Math.floor(st.histFrom / 60000) * 60000; c.setVisibleRange({ from, to: b[b.length - 1].time + 60000 }); });
    await sleep(1500);

    // default = Combined
    let s = await dbg(d.p);
    console.log('combined', JSON.stringify(Object.assign({}, s, { walls: (s && s.walls || []).slice(0, 12) })));
    check(s && s.view === 'combined', 'default style is Combined');
    check(s && s.samples >= Math.min(120, WAIT_MS / 1000 * 0.8), 'book history built: ' + (s && s.samples) + ' samples (1 per second)');
    check(s && s.columns > 20 && s.cells > 50, 'heatmap drawn over time: ' + (s && s.columns) + ' columns, ' + (s && s.cells) + ' cells');
    check(s && s.depthBars > 10, 'depth bars drawn: ' + (s && s.depthBars));
    const drawn = (s && s.walls || []).filter((w) => w.drawn);
    check(drawn.length > 0, 'wall labels drawn: ' + drawn.map((w) => w.label).join(', '));
    check(drawn.length > 0 && drawn.every((w) => new RegExp('^[0-9.KM]+ ' + BASE_ASSET + '$').test(w.label)), 'wall labels are in ' + BASE_ASSET);
    check((s && s.walls || []).length <= 12, 'at most 12 walls');
    const sides = new Map(); (s && s.walls || []).forEach((w) => { const k = w.price.toFixed(6) + w.side; check(!sides.has(k), 'wall unique per (price, side) ' + k); sides.set(k, 1); });
    await shot(d.p, 'D-combined-1280.png');
    const sm = await dbg(m.p);
    console.log('phone', JSON.stringify(Object.assign({}, sm, { walls: (sm && sm.walls || []).map((w) => w.label) })));
    check(sm && sm.view === 'combined' && sm.columns > 10 && sm.depthBars > 5, 'phone 390: Combined draws heatmap + depth');
    check(sm && sm.heatX0 != null && sm.heatX0 < sm.width * 0.2, 'phone 390: heatmap starts near the left edge, under the visible candles (x0=' + (sm && sm.heatX0) + ' of ' + (sm && sm.width) + ')');
    const ow = await m.p.evaluate(() => document.documentElement.scrollWidth);
    check(ow <= 390, 'phone 390: no horizontal overflow (' + ow + ')');
    await shot(m.p, 'D-combined-390.png');

    // the Style setting switches
    const want = ['heat', 'depth', 'walls'];
    for (let k = 1; k < VIEWS.length; k++) {
      await setDom(d.p, { style: VIEWS[k] }); await sleep(1500);
      s = await dbg(d.p);
      check(s && s.view === want[k - 1], 'style switches to ' + VIEWS[k] + ' (' + (s && s.view) + ')');
      if (want[k - 1] === 'heat') check(s.cells > 50 && s.depthBars === 0 && s.walls.length === 0, 'Heatmap only: heat, no depth, no walls');
      if (want[k - 1] === 'depth') check(s.cells === 0 && s.depthBars > 10 && s.walls.length === 0, 'Depth bars only: depth, no heat, no walls');
      if (want[k - 1] === 'walls') check(s.cells === 0 && s.depthBars === 0 && s.walls.some((w) => w.drawn && / BTC$|\s\S+$/.test(w.label)), 'Walls only: walls with sizes, no heat, no depth');
      await shot(d.p, ['A-heatmap', 'B-depth', 'C-walls'][k - 1] + '-1280.png');
    }
    // Combined toggles
    await setDom(d.p, { style: VIEWS[0], showWalls: false }); await sleep(1200);
    s = await dbg(d.p);
    check(s.view === 'combined' && s.walls.length === 0 && s.cells > 0 && s.depthBars > 0, 'Combined: "Show walls" off hides walls only');
    // old saved chart: style 'right ladder' -> Depth bars only; 'liquidity heatmap' -> Combined
    await setDom(d.p, { style: 'right ladder', showWalls: true, widthPct: 36, opacity: 32 }); await sleep(1200);
    check((await dbg(d.p)).view === 'depth', 'old "right ladder" setting loads as Depth bars only');
    await setDom(d.p, { style: 'liquidity heatmap' }); await sleep(1200);
    check((await dbg(d.p)).view === 'combined', 'old "liquidity heatmap" setting loads as Combined');
    // manual price bucket
    await setDom(d.p, { bucketUsd: 5 }); await sleep(1200);
    check((await dbg(d.p)).step === 5, 'manual price bucket $5');
    await setDom(d.p, { bucketUsd: 0 });

    // words on the chart: no "live" / "real-time"
    const txt = await d.p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; const i = c.indicators().find((x) => x.nativeType === 'stk_crypto_dom'); return JSON.stringify([i.title, i.inputs.map((x) => [x.title, x.options || []])]); });
    check(!/\blive\b|real-time|realtime/i.test(txt), 'no "live" / "real-time" in title or settings');

    // non-Binance symbol keeps the message
    await setSym(d.p, 'futures:NQ1!', '5'); await sleep(3000); await waitBars(d.p); await sleep(2000);
    const nm = await tables(d.p);
    // the note is drawn on the canvas; its text is BOOK_NEEDS_BINANCE ("Crypto DOM needs a Binance crypto symbol.")
    check(nm === 1, 'non-Binance symbol shows the note (' + nm + ' table)');
    await shot(d.p, 'non-binance-NQ-1280.png');

    // ---- phone budget: memory at the full history cap, and the step-change redraw time ----
    await setDom(m.p, { style: VIEWS[0], showWalls: true, bucketUsd: 0 }); await sleep(800);
    const heap = () => m.p.evaluate(async () => { for (let k = 0; k < 3; k++) { window.gc(); await new Promise((r) => setTimeout(r, 50)); } return performance.memory.usedJSHeapSize; });
    // show ~45 min so the filled history is on screen and every drawn column holds its bins
    await m.p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; const b = c.orchestrator.rawBars; c.setVisibleRange({ from: b[Math.max(0, b.length - 45)].time, to: b[b.length - 1].time + 60000 }); });
    const h0 = await heap();
    // Fill to the cap and cache bins on the newest 640 samples (a 1280 px desktop chart draws at
    // most 640 two-pixel columns; a 390 px phone ~160), then gc and read the heap in the SAME task:
    // the next 1 s live sample would push the history over the cap and thin it to ~1800.
    const step0 = (await dbg(m.p)).step;
    const r = await m.p.evaluate((st) => {
      const F = window.__stkFlow; const fill = F.domDebugFill(0, 640, st);
      const store = F.domDebugBytes(); window.gc(); window.gc();
      return { fill, store, heap: performance.memory.usedJSHeapSize };
    }, step0);
    const memMb = (r.heap - h0) / 1048576;
    console.log('fill', JSON.stringify(r.fill), 'store', JSON.stringify(r.store), 'heap delta ' + memMb.toFixed(1) + ' MB');
    check(r.store.samples >= 2400, 'full-cap history built: ' + r.store.samples + ' samples, ' + r.store.avgLevels + ' levels each');
    check(memMb <= MEM_MB, 'phone: full-cap book history adds ' + memMb.toFixed(1) + ' MB of heap (<= ' + MEM_MB + ' MB)');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const times = [];
    for (const n of ZOOMS) {
      const before = await dbg(m.p);
      const t = await zoomFrame(m.p, n);
      await sleep(400);
      const after = await dbg(m.p);
      if (after.step !== before.step) times.push({ bars: n, from: before.step, to: after.step, frameMs: t, layerMs: after.rebinMs, cols: after.rebinCols, binned: after.binned });
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log('step-change redraws with the indicator (390 px, CPU x4)', JSON.stringify(times));
    check(times.length >= 2, 'zoom changed the price bucket ' + times.length + ' times');
    // The budget is this indicator's redraw (re-bin of every drawn column + paint), timed inside
    // its render(). The whole frame also holds the chart's own redraw, printed above as baseline.
    const worst = times.reduce((x, r) => Math.max(x, r.layerMs), 0);
    const worstFrame = times.reduce((x, r) => Math.max(x, r.frameMs), 0);
    check(times.length && worst <= REBIN_MS, 'phone CPU x4: Crypto DOM redraw after a step-changing zoom ' + worst + ' ms (<= ' + REBIN_MS + ' ms); whole frame ' + worstFrame + ' ms vs ' + Math.max(...base) + ' ms without the indicator');
    await shot(m.p, 'E-fullcap-390.png');

    check(!d.errors.length, 'no console errors (desktop) ' + d.errors.join(' | '));
    check(!m.errors.length, 'no console errors (phone) ' + m.errors.join(' | '));
    await d.ctx.close(); await m.ctx.close();
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
