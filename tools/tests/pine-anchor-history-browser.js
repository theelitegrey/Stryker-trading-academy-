// iFVG Pro+ RR box regression (member GK, thread 1571751106915082280, 16-18 Nov): a Pine box drawn at bar_index
// must stay on its trigger candle when the chart's history changes under a LIVE script: the head trimmed ("days to
// load" setting), more history prepended (scroll-back pager), panned / zoomed, and new live bars. The script logic
// itself (live vs fresh run) is covered by ifvg-rr-live.test.mjs.
//   node tools/tests/chart-dev-server.mjs 8461 &   (or any static preview of the repo)
//   CHART_BASE=http://127.0.0.1:8461 flock /tmp/stryker-chrome.lock node tools/tests/pine-anchor-history-browser.js <outDir>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8241';
const OUT = process.argv[2] || '/tmp/pine-anchor';
fs.mkdirSync(OUT, { recursive: true });
// Sample data: 1m NQ candles from the saved order-flow fixture (20-21 Oct), served as /api/chart/bars; the clock is set to 21 Oct.
const FIX = path.join(__dirname, 'fixtures', 'orderflow');
const NOW = Date.UTC(2026, 9, 21, 17, 0);
let CAND = null;
async function candles(tfMin) {
  if (!CAND) {
    const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js'));
    const bars = [].concat(...['2026-10-20', '2026-10-21'].map((d) => D.decodeOrderflow(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'NQ-' + d + '.bin.gz'))))).bars));
    CAND = { D, bars };
  }
  return CAND.D.aggregate(CAND.bars, tfMin * 60000).map((b) => [b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]).filter((x) => x[0] * 1000 < NOW);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 500))); };
// The RR box of the member's screenshot reduced to its anchoring: a box from the trigger bar's bar_index, a label one
// bar right of it, both at the trigger candle's high / low. TRIG is replaced with the trigger bar's open time (ms).
const SRC = `//@version=6
indicator("Anchor probe", overlay=true, max_boxes_count=50, max_labels_count=50)
var box bx = na
var label lb = na
if time == TRIG
    bx := box.new(bar_index, high, bar_index + 5, low, bgcolor=color.new(color.red, 70))
    lb := label.new(bar_index + 1, high, "+IFVG", style=label.style_label_left)
`;

const probe = (p, trig) => p.evaluate((trig) => {
  const ch = window.STRYKER_VELA.chart, o = ch.orchestrator, R = ch.renderer.renderer;
  const rec = [...o.registry.all()].find((r) => r.model && r.model.title === 'Anchor probe');
  if (!rec || !rec.model || !(rec.model.boxes || []).length) return { none: true, live: rec && rec.session ? 1 : 0 };
  const m = rec.model, bx = m.boxes[0], off = R.scene.offsetOf(m.id);
  const bars = R.bars, at = bars.findIndex((b) => b.time === trig);
  return { raw: o.rawBars.length, rawHead: o.rawBars[0].time, sorted: o.rawBars.every((b, i) => !i || b.time > o.rawBars[i - 1].time), n: bars.length, at, left: bx.left, off, logical: bx.left + off, xBox: R.coords.logicalToX(bx.left + off), xBar: R.coords.timeToX(trig), anchorTime: m.anchorTime, head: bars[0].time };
}, trig);

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=700'] });
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((now) => {
      try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('vela-workspace'); localStorage.removeItem('vela-workspace-090'); localStorage.setItem('stryker_theme', 'night'); } catch (e) {}
      const RealDate = Date, off = now - RealDate.now();
      class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
      window.Date = FakeDate;
      window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true }; window.__stkChartTestFree = false;
    }, NOW);
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
    await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, async (r) => {
      const u = new URL(r.request().url()), tf = Number(u.searchParams.get('tf')) || 1, page = Number(u.searchParams.get('page')) || 0;
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: String(tf), page, bars: await candles(tf) }) });
    });
    await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/stream/, (r) => r.abort());
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => { try { return window.__stkHeavyReady && window.STRYKER_PINE && !!window.STRYKER_VELA.chart.renderer.renderer.userDrawings; } catch (e) { return false; } }, null, { timeout: 60000 });
    await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); const o = ws.chart.orchestrator; if (ws.chart.market.symbol === 'futures:NQ1!' && o.rawBars.length > 300) break; } });
    await sleep(1500);
    const info = await p.evaluate(() => { const o = window.STRYKER_VELA.chart.orchestrator, raw = o.rawBars, n = raw.length; return { n, trig: raw[n - 60].time, live: o.config.live }; });
    console.log('NOTE bars', info);
    const r = await p.evaluate((src) => window.STRYKER_PINE.addSource('Anchor probe', src, { engine: 'next' }), SRC.replace('TRIG', String(info.trig)));
    check(r && r.ok, 'probe script added', r);
    let g = null;
    for (let i = 0; i < 60; i++) { await sleep(500); g = await probe(p, info.trig); if (!g.none) break; }
    const ok = (g, what) => check(!g.none && g.sorted && g.logical === g.at && Math.abs(g.xBox - g.xBar) <= 1, what + ': box on the trigger candle', g);
    ok(g, 'first draw');
    const live = await p.evaluate(() => { const o = window.STRYKER_VELA.chart.orchestrator; const rec = [...o.registry.all()].find((r) => r.model && r.model.title === 'Anchor probe'); return rec && rec.session ? 'session' : 'none'; });
    console.log('NOTE session', live);
    // 1. head trimmed under the running script (chart-history-pager "days to load": setBarSeries(slice) + notifySessionsBars())
    await p.evaluate(() => { const o = window.STRYKER_VELA.chart.orchestrator; window.__cut = o.rawBars.slice(0, 120); o.setBarSeries(o.rawBars.slice(120), { preserveView: true }); o.notifySessionsBars(); });
    await sleep(600); ok(await probe(p, info.trig), 'head trimmed (0.6 s)');
    await sleep(4000); ok(await probe(p, info.trig), 'head trimmed (after re-run)');
    // 2. older history prepended (scroll-back pager: setBarSeries([...head, ...raw]) + 'backfill', then complete)
    // the pager may have refilled the head after step 1, so cut the CURRENT head off first and prepend exactly those bars
    await p.evaluate(() => { const o = window.STRYKER_VELA.chart.orchestrator; window.__cut = o.rawBars.slice(0, 120); o.setBarSeries(o.rawBars.slice(120), { preserveView: true }); });
    await sleep(300);
    await p.evaluate(() => { const o = window.STRYKER_VELA.chart.orchestrator; const c = window.__cut.filter((b) => b.time < o.rawBars[0].time); o.setBarSeries([...c, ...o.rawBars], { preserveView: true }); o.notifySessionsBars('backfill'); });
    await sleep(600); ok(await probe(p, info.trig), 'history prepended (backfill)');
    await p.evaluate(() => { const o = window.STRYKER_VELA.chart.orchestrator; o.notifySessionsBars('complete'); });
    await sleep(4000); ok(await probe(p, info.trig), 'history prepended (complete)');
    // 3. pan + zoom
    await p.evaluate((t) => { const ch = window.STRYKER_VELA.chart; ch.setVisibleRange({ from: t - 3600e3 * 6, to: t + 3600e3 * 2 }); }, info.trig);
    await sleep(800); ok(await probe(p, info.trig), 'panned / zoomed');
    // 4. live bars (two new candles, then ticks)
    await p.evaluate(() => { const o = window.STRYKER_VELA.chart.orchestrator, l = o.rawBars[o.rawBars.length - 1], tf = l.time - o.rawBars[o.rawBars.length - 2].time;
      for (let k = 1; k <= 2; k++) o.onBar({ time: l.time + k * tf, open: l.close, high: l.close + 2, low: l.close - 2, close: l.close + 1, volume: 10 });
      o.onBar({ time: l.time + 2 * tf, open: l.close, high: l.close + 3, low: l.close - 2, close: l.close + 2, volume: 12 }); });
    await sleep(4000); ok(await probe(p, info.trig), 'live bars added');
    // 5. trim again after live bars (the member's chart: the days window moves forward)
    await p.evaluate(() => { const o = window.STRYKER_VELA.chart.orchestrator; o.setBarSeries(o.rawBars.slice(30), { preserveView: true }); o.notifySessionsBars(); });
    await sleep(4000); ok(await probe(p, info.trig), 'head trimmed again');
    await p.evaluate((t) => { const ch = window.STRYKER_VELA.chart; ch.setVisibleRange({ from: t - 3600e3 * 3, to: t + 3600e3 * 3 }); }, info.trig);
    await sleep(800);
    await p.screenshot({ path: path.join(OUT, 'pine-anchor-1440.png') }); console.log('SHOT ' + path.join(OUT, 'pine-anchor-1440.png'));
    check(!errs.length, 'no page errors', errs);
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
