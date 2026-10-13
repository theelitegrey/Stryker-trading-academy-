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
// Build 505 (Owner 2026-10-12, "where is everything?"): the book is bucketed at store time over
// +-2% of the mid, so at 390 px on BTCUSDT 1m the stored rows, the depth bars and the heatmap
// span at least +-1% of the price; "recording since HH:MM" sits by the first heatmap column;
// hiding the indicator keeps recording; a reload keeps the recorded history (IndexedDB); the
// footer under a Binance chart names Binance, not the futures "Yahoo Finance, delayed" line.
// Review fixes (build 505): "recording since" uses the CHART's timezone (Asia/Kolkata, then
// America/New_York; checked against Intl, the chart's clock and the renderer's timezone); no
// /depth snapshot while the page is hidden and one on return; a stale IndexedDB chunk of
// another symbol is deleted on the next page load.
// Build 525 (book recorder, workers/book-recorder): phase R first, with the recorder MOCKED
// (Playwright route serving 24 h of 1-min samples in the Worker's own binary format, bucketed
// from a real Binance snapshot by the Worker's own code): on open, BTCUSDT 1m at 390 and 1280,
// the heatmap covers the whole visible range from the left edge, the note reads
// "book history: 24 h", the request asks back to the visible left edge. Then the recorder
// failing (HTTP 503): heat starts only where this page's recording starts, the note is
// "book history from HH:MM", no console errors. The legacy phases below run with the recorder
// unreachable (blocked like every non-allowed host), i.e. today's behaviour.
//   RECORDER_ONLY=1 runs phase R alone (~2 min).
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
const HIST_RE = /^book history from \d\d:\d\d$/;
const MEM_MB = Number(process.env.MEM_MB || 25), REBIN_MS = Number(process.env.REBIN_MS || 250);
const VIEWS = ['Combined (heatmap + depth + walls)', 'Heatmap only', 'Depth bars only', 'Walls only'];

async function open(b, { w, h, mobile, recorder }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => {
    // count the order-book REST snapshots (/depth) for the hidden-tab check
    window.__depthFetches = 0;
    const of = window.fetch;
    window.fetch = function (u) { try { if (/\/depth\?/.test(String(u && u.url || u))) window.__depthFetches++; } catch (e) {} return of.apply(this, arguments); };
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance\.com|fapi\.binance\.com|data-api\.binance\.vision)/, (r) => r.abort());
  if (recorder) await ctx.route(/book-recorder\.[a-z0-9-]+\.workers\.dev\/book-history/, recorder);
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
const credit = (p) => p.evaluate(() => document.querySelector('.stkchart-credit').textContent);
// legend row control (eye = 'Hide' / 'Show') of the Crypto DOM row in cell 0
async function legendCtl(p, label) {
  await p.evaluate((label) => {
    const ch = window.STRYKER_VELA.context().cells[0].chart;
    const h = ch.indicators().find((x) => x.nativeType === 'stk_crypto_dom');
    const r = ch.orchestrator.renderer.inputsUI.rows.get(h.id);
    r.el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    r.el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const b = [...r.el.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === label);
    if (!b) throw new Error('no ' + label + ' button: ' + [...r.el.querySelectorAll('button')].map((x) => x.getAttribute('aria-label')).join('|'));
    b.click();
  }, label);
  await sleep(900);
}
// back to auto price scale (drop the manual scale the wide-view check set)
const autoScale = (p) => p.evaluate(() => { const r = window.STRYKER_VELA.context().cells[0].chart.orchestrator.renderer; r.scene.panes.forEach((x) => { x.manualScale = null; }); r.scheduler.invalidate(4); });
const samples = (p) => p.evaluate(() => window.__stkFlow.domDebugBytes().samples);
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
// HH:MM of ms in tz, computed here in Node (full ICU), independent of the page's code
const hm = (ms, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
async function tzCheck(p, tz) {
  await p.evaluate((tz) => window.STRYKER_VELA.setTimezone(tz), tz);
  await sleep(1500);
  const r = await p.evaluate(() => {
    const st = window.__stkFlow.domDebug();
    const c = window.STRYKER_VELA.context().cells[0].chart;
    const clock = document.querySelector('.vela-bb-clock');
    return { since: st && st.since, ts: st && st.sinceTs, tz: st && st.sinceTz, wsTz: window.STRYKER_VELA.getState().timezone, axisTz: c.renderer.get('timezone'), clock: clock ? clock.textContent : '', now: Date.now() };
  });
  const want = 'book history from ' + hm(r.ts, tz);
  console.log('tz ' + tz, JSON.stringify(r), 'want "' + want + '"');
  check(r.since === want, tz + ': note "' + r.since + '" = HH:MM of the first column in ' + tz + ' ("' + want + '")');
  check(r.tz === tz && r.wsTz === tz && r.axisTz === tz, tz + ': note, workspace and time axis use one timezone (' + r.tz + ' / ' + r.wsTz + ' / ' + r.axisTz + ')');
  // the clock shows HH:MM:SS of now in the same timezone (allow a minute tick between reads)
  const ok = [r.now - 2000, r.now, r.now + 2000].some((ms) => r.clock.slice(0, 5) === hm(ms, tz));
  check(ok, tz + ': chart clock "' + r.clock + '" is in the same timezone as the note');
  return r;
}
async function shot(p, name) { await p.mouse.move(5, 5).catch(() => {}); await sleep(900); await p.screenshot({ path: OUT + '/' + name }); console.log('SHOT ' + OUT + '/' + name); }

// ---- phase R: mocked book recorder ----
async function recorderPhase(b) {
  const { bucketSnapshot, encodeSamples } = await import('../../workers/book-recorder/src/bucket.js');
  const sym = SYM.replace(/^.*:/, '');
  const snap = await (await fetch('https://api.binance.com/api/v3/depth?symbol=' + sym + '&limit=5000')).json();
  const now = Date.now(), base = bucketSnapshot(snap, now);
  // 24 h of 1-min samples ending 1 min ago: the real rows with a small random walk
  const all = [];
  let shift = 0;
  for (let t = Math.floor(now / 60000) * 60000 - 60000; t > now - 24 * 3600000 + 60000; t -= 60000) {
    shift += Math.round((Math.random() - 0.5) * 2);
    const v = Float32Array.from(base.v, (x) => x * (0.6 + Math.random() * 0.8));
    all.push({ ts: t, mid: base.mid + shift * base.step, bb: base.bb + shift * base.step, ba: base.ba + shift * base.step, step: base.step, i0: base.i0 + shift, v });
  }
  all.reverse();
  const reqs = [];
  const ok = (route) => {
    const u = new URL(route.request().url()); reqs.push(u.search);
    const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'));
    const body = Buffer.from(encodeSamples(all.filter((x) => x.ts >= from && x.ts <= to)));
    route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-book-from', 'x-book-from': String(all[0].ts) }, body });
  };
  const bad = (route) => { reqs.push('FAIL ' + new URL(route.request().url()).search); route.fulfill({ status: 503, body: 'down' }); };
  for (const [label, handler] of [['recorder', ok], ['recorder failing', bad]]) {
    for (const vp of [{ w: 390, h: 844, mobile: true }, { w: 1280, h: 800 }]) {
      reqs.length = 0;
      const s = await open(b, Object.assign({ recorder: handler }, vp));
      await s.p.evaluate(() => { window.__STK_BOOK_RECORDER = 'https://book-recorder.theelitegrey.workers.dev'; });
      await setSym(s.p, SYM, '1'); await sleep(2500); await waitBars(s.p);
      await zoom(s.p, vp.mobile ? 90 : 150, vp.mobile ? 6 : 10);
      await addDom(s.p);
      await sleep(12000);
      const st = await dbg(s.p);
      const tag = label + ' ' + vp.w + ': ';
      console.log(tag + JSON.stringify({ remoteState: st.remoteState, remoteSamples: st.remoteSamples, samples: st.samples, columns: st.columns, cells: st.cells, heatX0: st.heatX0, since: st.since, visFrom: st.visFrom && new Date(st.visFrom).toISOString(), reqs }));
      const ow = await s.p.evaluate(() => document.documentElement.scrollWidth);
      check(ow <= vp.w, tag + 'no horizontal overflow (' + ow + ')');
      if (handler === ok) {
        check(reqs.length >= 1 && reqs.every((q) => /symbol=BTCUSDT/.test(q) || !/BTC/.test(SYM)), tag + 'asked the recorder for ' + sym + ' (' + reqs.length + ' request(s))');
        const from0 = reqs.length ? Number(new URLSearchParams(reqs[0]).get('from')) : NaN;
        check(from0 <= st.visFrom && st.visFrom - from0 <= 15 * 60000, tag + 'request starts at the visible left edge (from ' + new Date(from0).toISOString().slice(11, 16) + ', view from ' + new Date(st.visFrom).toISOString().slice(11, 16) + ')');
        check(st.remoteState === 'ok' && st.remoteSamples >= 60, tag + 'recorder history merged (' + st.remoteSamples + ' samples)');
        check(st.heatX0 != null && st.heatX0 <= 4, tag + 'heatmap starts at the left edge of the chart (x0=' + st.heatX0 + ')');
        check(st.columns >= (vp.mobile ? 40 : 80) && st.cells > 200, tag + 'heat across the visible range: ' + st.columns + ' columns, ' + st.cells + ' cells');
        check(st.since === 'book history: 24 h', tag + 'note "' + st.since + '"');
        check(st.samples > st.remoteSamples / 2, tag + 'local live samples kept alongside (' + st.samples + ' total)');
      } else {
        check(st.remoteState === 'failed' && st.remoteSamples === 0, tag + 'recorder failed, nothing merged (' + st.remoteState + ')');
        check(st.heatX0 == null || st.heatX0 > st.width * 0.5, tag + 'heat only where this page recorded (x0=' + st.heatX0 + ' of ' + st.width + ')');
        check(st.since == null || HIST_RE.test(st.since), tag + 'note "' + st.since + '" (or none until the first column)');
        const msg = await tables(s.p);
        check(msg <= 1, tag + 'indicator still works (status tables ' + msg + ', depth bars ' + st.depthBars + ')');
        check(st.depthBars > 5, tag + 'depth bars drawn from the live book (' + st.depthBars + ')');
      }
      const words = await s.p.evaluate(() => { const st = window.__stkFlow.domDebug(); return [st.since || '', document.querySelector('.stkchart-credit') ? document.querySelector('.stkchart-credit').textContent : ''].join(' | '); });
      check(!/\blive\b|real-time|delayed/i.test(words), tag + 'no "live" / "real-time" / "delayed" in "' + words + '"');
      await shot(s.p, 'R-' + (handler === ok ? 'recorder' : 'recorder-fail') + '-' + vp.w + '.png');
      check(!s.errors.length, tag + 'no console errors ' + s.errors.join(' | '));
      await s.ctx.close();
    }
  }
}

(async () => {
  // precise heap numbers + window.gc() for the phone memory budget check
  const b = await launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc --max-old-space-size=768'] });
  try {
    await recorderPhase(b);
    if (process.env.RECORDER_ONLY) throw 'done';
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

    // ---- coverage on the phone: rows across +-1% of the price ----
    let sw = await dbg(m.p);
    console.log('phone stored rows', JSON.stringify({ mid: sw.mid, rowLo: sw.rowLo, rowHi: sw.rowHi, rows: sw.rows, storeStep: sw.storeStep, step: sw.step, scale: [sw.scaleMin, sw.scaleMax] }));
    check(sw.rowLo <= sw.mid * 0.99 && sw.rowHi >= sw.mid * 1.01, 'stored book rows span +-1% of the price (' + ((sw.mid - sw.rowLo) / sw.mid * 100).toFixed(2) + '% / ' + ((sw.rowHi - sw.mid) / sw.mid * 100).toFixed(2) + '%, step ' + sw.storeStep + ')');
    // show +-1.5% of the price (the Owner's zoomed-out phone view) and check what is drawn
    // (Vela's renderer: freeze the price pane to a manual scale, as dragging the price axis does)
    await m.p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; const st = window.__stkFlow.domDebug(); const b = c.orchestrator.rawBars; const from = Math.floor(st.histFrom / 60000) * 60000 - 4 * 60000; c.setVisibleRange({ from, to: b[b.length - 1].time + 3 * 60000 }); });
    await sleep(800);
    const widened = await m.p.evaluate((mid) => {
      const r = window.STRYKER_VELA.context().cells[0].chart.orchestrator.renderer;
      const pane = r && r.scene && [...r.scene.panes.values()].find((x) => x.kind === 'price');
      if (!pane || !r.setManualScale) return false;
      r.setManualScale(pane, { min: mid * 0.985, max: mid * 1.015 }); return true;
    }, sw.mid);
    await sleep(1500);
    sw = await dbg(m.p);
    console.log('phone wide view', JSON.stringify({ widened, scale: [sw.scaleMin, sw.scaleMax], depth: [sw.depthLo, sw.depthHi], heatData: [sw.dataLo, sw.dataHi], heatDrawn: [sw.heatLo, sw.heatHi], depthBars: sw.depthBars, cells: sw.cells, walls: sw.walls.filter((w) => w.drawn).map((w) => w.label + '@' + Math.round(w.price)) }));
    const lo1 = sw.mid * 0.99, hi1 = sw.mid * 1.01;
    const inView = sw.scaleMin <= lo1 && sw.scaleMax >= hi1;
    check(inView, 'phone 390: view shows +-1% of the price (' + Math.round(sw.scaleMin) + '..' + Math.round(sw.scaleMax) + ')');
    check(sw.depthLo <= lo1 && sw.depthHi >= hi1, 'phone 390: depth bars span +-1% (' + Math.round(sw.depthLo) + '..' + Math.round(sw.depthHi) + ' around ' + Math.round(sw.mid) + ')');
    // heat rows = recorded rows in view (thin ones are then hidden by the percentile setting)
    check(sw.dataLo <= lo1 && sw.dataHi >= hi1, 'phone 390: heatmap rows span +-1% (' + Math.round(sw.dataLo) + '..' + Math.round(sw.dataHi) + '; drawn after the 60th-percentile filter ' + Math.round(sw.heatLo) + '..' + Math.round(sw.heatHi) + ')');
    check(HIST_RE.test(sw.since || ''), 'phone 390: "' + sw.since + '" note by the first heatmap column');
    await shot(m.p, 'D-wide-390.png');
    // ---- "recording since" in the chart's timezone, and it follows a timezone change ----
    await autoScale(m.p);
    await m.p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; const st = window.__stkFlow.domDebug(); const b = c.orchestrator.rawBars; const from = Math.floor(st.histFrom / 60000) * 60000 - 4 * 60000; c.setVisibleRange({ from, to: b[b.length - 1].time + 3 * 60000 }); });
    await sleep(1200);
    await tzCheck(m.p, 'Asia/Kolkata');
    await shot(m.p, 'G-since-IST-390.png');
    await tzCheck(m.p, 'America/New_York');
    await shot(m.p, 'G-since-NY-390.png');
    await m.p.evaluate(() => window.STRYKER_VELA.setTimezone('Asia/Kolkata'));

    // ---- no /depth snapshot while the page is hidden; one when it is visible again ----
    // The 2-min interval is fired on demand through __stkFlow.domDebugSnapTick() (the real
    // ticker, as if 2 min had passed), and the last snapshot is aged by the same 2 min.
    const vis = await m.p.evaluate(async () => {
      const setHidden = (h) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
        document.dispatchEvent(new Event('visibilitychange'));
      };
      const fire = () => window.__stkFlow.domDebugSnapTick(121000);
      const out = { tickers: 0 };
      setHidden(true);
      let n0 = window.__depthFetches;
      for (let k = 0; k < 3; k++) { out.tickers = fire(); }  // 3 faked 2-min periods
      await new Promise((r) => setTimeout(r, 1500));
      out.whileHidden = window.__depthFetches - n0;
      n0 = window.__depthFetches;
      setHidden(false);
      await new Promise((r) => setTimeout(r, 2500));
      out.onReturn = window.__depthFetches - n0;
      // visible again: the ticker fetches as before
      n0 = window.__depthFetches; fire();
      await new Promise((r) => setTimeout(r, 1500));
      out.visibleTick = window.__depthFetches - n0;
      delete document.hidden; delete document.visibilityState;
      return out;
    });
    console.log('hidden tab', JSON.stringify(vis));
    check(vis.tickers >= 1, 'snapshot ticker found (' + vis.tickers + ')');
    check(vis.whileHidden === 0, 'hidden tab: 0 /depth snapshots over 3 faked 2-min periods (' + vis.whileHidden + ')');
    check(vis.onReturn === 1, 'tab visible again: exactly 1 catch-up /depth snapshot (' + vis.onReturn + ')');
    check(vis.visibleTick === 1, 'visible tab: the 2-min ticker fetches again (' + vis.visibleTick + ')');
    // the footer names Binance on a Binance symbol
    const cr = await credit(m.p);
    check(/^Crypto: Binance/.test(cr) && !/delayed|Yahoo|real-time|\blive\b/i.test(cr), 'footer on BTCUSDT: "' + cr + '"');
    // hidden indicator keeps recording
    const n0 = await samples(m.p);
    await legendCtl(m.p, 'Hide');
    await sleep(8000);
    const n1 = await samples(m.p);
    check(n1 >= n0 + 5, 'hidden indicator keeps recording (' + n0 + ' -> ' + n1 + ' samples)');
    await legendCtl(m.p, 'Show');
    await zoom(m.p, 30, 6); await sleep(1200);
    // a few minutes of candles before the recording started, plus room on the right for the depth bars
    await m.p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; const st = window.__stkFlow.domDebug(); const b = c.orchestrator.rawBars; const from = Math.floor(st.histFrom / 60000) * 60000 - 4 * 60000; c.setVisibleRange({ from, to: b[b.length - 1].time + 3 * 60000 }); });
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
    check(sm && sm.heatX0 != null && sm.heatX0 < sm.width * 0.5, 'phone 390: heatmap starts under the visible candles (x0=' + (sm && sm.heatX0) + ' of ' + (sm && sm.width) + ')');
    check(HIST_RE.test(sm.since || ''), 'phone 390: "' + sm.since + '" by the first heatmap column');
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
    const crf = await credit(d.p);
    check(/^Futures:/.test(crf), 'footer on a futures symbol is the futures line again');
    // the note is drawn on the canvas; its text is BOOK_NEEDS_BINANCE ("Crypto DOM needs a Binance crypto symbol.")
    check(nm === 1, 'non-Binance symbol shows the note (' + nm + ' table)');
    await shot(d.p, 'non-binance-NQ-1280.png');

    // ---- reload keeps the recorded history (IndexedDB, per symbol) ----
    // a stale chunk (ended 7 h ago) for a symbol this page never opens, plus a fresh one
    const seeded = await m.p.evaluate(() => new Promise((res) => {
      const rq = indexedDB.open('stryker_dom', 1);
      rq.onsuccess = () => {
        const tx = rq.result.transaction('chunks', 'readwrite'), st = tx.objectStore('chunks'), now = Date.now();
        const mk = (id, t1) => ({ id, key: 'binance|ZZTESTUSDT', t0: t1 - 30000, t1, ts: new Float64Array([t1]), mid: new Float64Array([1]), bb: new Float64Array([1]), ba: new Float64Array([1]), step: new Float64Array([1]), i0: new Int32Array([0]), cnt: new Int32Array([0]), v: new Float32Array(0) });
        st.put(mk('binance|ZZTESTUSDT|stale', now - 7 * 3600 * 1000));
        st.put(mk('binance|ZZTESTUSDT|fresh', now - 60 * 1000));
        tx.oncomplete = () => res(true); tx.onerror = () => res(false);
      };
      rq.onerror = () => res(false);
    }));
    check(seeded, 'stale + fresh IndexedDB chunks written for binance|ZZTESTUSDT');
    const before = await m.p.evaluate(async () => { await window.__stkFlow.domFlush(); const st = window.__stkFlow.domDebug(); return { from: st.recordedFrom, n: window.__stkFlow.domDebugBytes().samples }; });
    await m.p.reload({ waitUntil: 'domcontentloaded' });
    await m.p.waitForFunction(() => window.STRYKER_VELA && window.__stkFlow, null, { timeout: 45000 });
    await waitBars(m.p);
    const symNow = await m.p.evaluate(() => window.STRYKER_VELA.context().cells[0].symbol);
    if (!/BTCUSDT/i.test(symNow)) { await setSym(m.p, SYM, '1'); await sleep(3000); await waitBars(m.p); }
    const hasDom = await m.p.evaluate(() => !!window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_crypto_dom'));
    if (!hasDom) await addDom(m.p);
    await sleep(6000);
    const after = await m.p.evaluate(() => { const st = window.__stkFlow.domDebug(); return { from: st && st.recordedFrom, n: window.__stkFlow.domDebugBytes().samples }; });
    console.log('reload', JSON.stringify({ before, after, restoredIndicator: hasDom }));
    const pr = await m.p.evaluate(async () => {
      const deleted = await window.__stkFlow.domPruned();
      const ids = await new Promise((res) => { const rq = indexedDB.open('stryker_dom', 1); rq.onsuccess = () => { const g = rq.result.transaction('chunks').objectStore('chunks').getAllKeys(); g.onsuccess = () => res(g.result.filter((k) => /ZZTEST/.test(k))); }; });
      return { deleted, ids };
    });
    console.log('prune', JSON.stringify(pr));
    check(!pr.ids.includes('binance|ZZTESTUSDT|stale') && pr.deleted >= 1, 'page load pruned the stale chunk of a symbol never reopened (deleted ' + pr.deleted + ')');
    check(pr.ids.includes('binance|ZZTESTUSDT|fresh'), 'the fresh chunk of that symbol is kept');
    check(after.from && Math.abs(after.from - before.from) <= 2000 && after.n >= before.n * 0.9, 'reload keeps history: recorded since ' + new Date(before.from).toISOString().slice(11, 19) + ' -> ' + new Date(after.from || 0).toISOString().slice(11, 19) + ', ' + before.n + ' -> ' + after.n + ' samples');
    await m.p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; const st = window.__stkFlow.domDebug(); const b = c.orchestrator.rawBars; const from = Math.floor(st.recordedFrom / 60000) * 60000 - 4 * 60000; c.setVisibleRange({ from, to: b[b.length - 1].time + 3 * 60000 }); });
    await sleep(1500);
    const sr = await dbg(m.p);
    check(sr && sr.columns > 10 && /^book history from/.test(sr.since || ''), 'after reload: heatmap drawn from the stored history (' + (sr && sr.columns) + ' columns, "' + (sr && sr.since) + '")');
    await shot(m.p, 'F-after-reload-390.png');

    // ---- phone budget: memory at the full history cap, and the step-change redraw time ----
    await setDom(m.p, { style: VIEWS[0], showWalls: true, bucketUsd: 0 }); await autoScale(m.p); await sleep(800);
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
    check(r.store.samples >= 5000, 'full-cap 6 h history built: ' + r.store.samples + ' samples, ' + r.store.avgRows + ' rows each');
    check(memMb <= MEM_MB, 'phone: full-cap book history adds ' + memMb.toFixed(1) + ' MB of heap (<= ' + MEM_MB + ' MB)');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const times = [];
    // Step changes: zooms (auto bucket) and, since the bucket now snaps to the stored rows and a
    // manual-scale view can keep one step across zooms, manual bucket changes too.
    for (const n of ZOOMS) {
      const before = await dbg(m.p);
      const t = await zoomFrame(m.p, n);
      await sleep(400);
      const after = await dbg(m.p);
      if (after.step !== before.step) times.push({ bars: n, from: before.step, to: after.step, frameMs: t, layerMs: after.rebinMs, cols: after.rebinCols });
    }
    for (const bu of [5, 50, 10, 0]) {
      const before = await dbg(m.p);
      await setDom(m.p, { style: VIEWS[0], showWalls: true, bucketUsd: bu }); await sleep(900);
      const after = await dbg(m.p);
      if (after.step !== before.step) times.push({ bucket: bu, from: before.step, to: after.step, frameMs: 0, layerMs: after.rebinMs, cols: after.rebinCols });
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log('step-change redraws with the indicator (390 px, CPU x4)', JSON.stringify(times));
    check(times.length >= 2, 'zoom changed the price bucket ' + times.length + ' times');
    // The budget is this indicator's redraw (re-bin of every drawn column + paint), timed inside
    // its render(). The whole frame also holds the chart's own redraw, printed above as baseline.
    const worst = times.reduce((x, r) => Math.max(x, r.layerMs), 0);
    const worstFrame = times.reduce((x, r) => Math.max(x, r.frameMs || 0), 0);
    check(times.length && worst <= REBIN_MS, 'phone CPU x4: Crypto DOM redraw after a step-changing zoom ' + worst + ' ms (<= ' + REBIN_MS + ' ms); whole frame ' + worstFrame + ' ms vs ' + Math.max(...base) + ' ms without the indicator');
    await shot(m.p, 'E-fullcap-390.png');

    check(!d.errors.length, 'no console errors (desktop) ' + d.errors.join(' | '));
    check(!m.errors.length, 'no console errors (phone) ' + m.errors.join(' | '));
    await d.ctx.close(); await m.ctx.close();
  } catch (e) { if (e !== 'done') { fail++; console.log('FAIL exception ' + (e && e.stack || e)); } }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
