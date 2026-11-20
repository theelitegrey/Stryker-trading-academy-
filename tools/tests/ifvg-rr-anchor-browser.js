// IFVG Pro+ [TradeZoro] risk / reward box on the REAL Charts page, with the REAL script (member GK, thread
// 1571751106915082280, 16-20 Nov: "the box is not aligned with the price where the IFVG triggered, it doesn't move with
// price, I have to refresh the indicator"). pine-anchor-history-browser.js covers a 6-line probe; this runs the shipped
// script and follows every RR box through: more history prepended (scroll-back pager), the head trimmed ("days to load"),
// pan / zoom, and new live bars. Each box must stay on the bar it was drawn on (by TIME, read back from the renderer's own
// coordinates) at the same entry / SL / TP prices.
// Sample data: 1m NQ candles from the saved order-flow fixture (20-21 Oct), the clock set to 21 Oct.
//   node tools/tests/chart-dev-server.mjs 8462 &
//   CHART_BASE=http://127.0.0.1:8462 flock /tmp/stryker-chrome.lock node tools/tests/ifvg-rr-anchor-browser.js <outDir>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8462';
const OUT = process.argv[2] || '/tmp/ifvg-rr-anchor';
fs.mkdirSync(OUT, { recursive: true });
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
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 700))); };

// every RR box (SL / TP text) of the script: its prices, and the bar TIME its left edge sits on (renderer coordinates)
const probe = (p, theme) => p.evaluate(() => {
  const ch = window.STRYKER_VELA.chart, o = ch.orchestrator, R = ch.renderer.renderer;
  const rec = [...o.registry.all()].find((r) => r.model && /IFVG Pro\+/.test(r.model.title || ''));
  if (!rec || !rec.model) return { none: true };
  const m = rec.model, off = R.scene.offsetOf(m.id), bars = R.bars;
  const timeAt = (bx) => { const L = bx.xloc === 'bar_time' ? R.coords.timeToLogical(bx.left) : bx.left + off; const i = Math.round(L); return Math.abs(L - i) < 0.01 && bars[i] ? bars[i].time : null; };
  const rr = (m.boxes || []).filter((b) => /^(SL|TP) /.test(b.text || '')).map((b) => ({ k: b.text.slice(0, 2), t: timeAt(b), top: b.top, bot: b.bottom, xloc: b.xloc || 'bar_index' }));
  return { n: bars.length, head: bars[0].time, times: bars.map((x) => x.time), off, rr };
});
// RR boxes keyed by their prices (stable across re-runs); value = bar time
const keyed = (g) => new Map(g.rr.map((b) => [b.k + ' ' + b.top + '/' + b.bot, b.t]));
function same(ref, g, what) {
  const now = keyed(g), moved = [];
  const has = new Set(g.times || []), on = (t) => has.has(t);   // boxes whose candle is no longer on the chart cannot be placed: skip them
  for (const [k, t] of ref) if (on(t) && now.has(k) && now.get(k) !== t) moved.push({ box: k, was: t, now: now.get(k) });
  const kept = [...ref.keys()].filter((k) => on(ref.get(k)) && now.has(k)).length;
  check(!g.none && kept >= Math.min(ref.size, 4) && moved.length === 0, what + ': every RR box on its trigger bar at the same prices (' + kept + ' of ' + ref.size + ' boxes checked)', moved.slice(0, 4));
}

(async () => {
  let src = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'pine', 'ifvg-pro-stryker.pine'), 'utf8').replace(/\r/g, '');
  // make setups easy to trigger on two days of 1m bars, so there are several RR boxes to follow; the drawing code is untouched
  const set = (a, z) => { if (!src.includes(a)) throw new Error('not found: ' + a); src = src.replace(a, z); };
  set('minGapT * syminfo.mintick', '0.0'); set('hideFail  = input.bool(true', 'hideFail  = input.bool(false'); set('minLeg   = input.float(1.0', 'minLeg   = input.float(0.0');
  set('input.string("Wick through, close back inside", "Sweep definition"', 'input.string("Either", "Sweep definition"'); set('input.int(5, "Setups kept', 'input.int(50, "Setups kept');
  const b = await launch({ args: ['--js-flags=--max-old-space-size=700'] });
  try {
    for (const [w, h, theme] of [[1440, 900, 'night'], [390, 844, 'day']]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(([now, theme]) => {
        try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('vela-workspace'); localStorage.removeItem('vela-workspace-090'); localStorage.setItem('stryker_theme', theme); } catch (e) {}
        const RealDate = Date, off = now - RealDate.now();
        class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
        window.Date = FakeDate;
        window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true }; window.__stkChartTestFree = false;
      }, [NOW, theme]);
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
      const r = await p.evaluate((s) => window.STRYKER_PINE.addSource('IFVG Pro+ [TradeZoro]', s, { engine: 'next', builtin: true }), src);
      check(r && r.ok, w + ': IFVG Pro+ added', r);
      let g = null;
      for (let i = 0; i < 120; i++) { await sleep(500); g = await probe(p); if (!g.none && g.rr.length >= 4) break; }
      await sleep(5000); g = await probe(p);                 // let the Pine depth load (more history) land and the script re-run
      const ref = keyed(g);
      console.log('NOTE', w, 'bars', g.n, 'rr boxes', g.rr.length, 'xloc', g.rr[0] && g.rr[0].xloc);
      check(g.rr.length >= 4 && g.rr.every((x) => x.t != null), w + ': RR boxes drawn, each left edge exactly on a bar', g.rr.slice(0, 3));
      // 1. more history prepended (scroll-back pager path): cut the head off, then put it back as 'backfill' + 'complete'
      await p.evaluate(() => { const o = window.STRYKER_VELA.chart.orchestrator; window.__cut = o.rawBars.slice(0, 200); o.setBarSeries(o.rawBars.slice(200), { preserveView: true }); o.notifySessionsBars(); });
      await sleep(800); same(ref, await probe(p), w + ' head trimmed (0.8 s)');
      await sleep(4000); same(ref, await probe(p), w + ' head trimmed (after re-run)');
      await p.evaluate(() => { const o = window.STRYKER_VELA.chart.orchestrator; const c = window.__cut.filter((b) => b.time < o.rawBars[0].time); o.setBarSeries([...c, ...o.rawBars], { preserveView: true }); o.notifySessionsBars('backfill'); });
      await sleep(800); same(ref, await probe(p), w + ' history prepended (backfill)');
      await p.evaluate(() => window.STRYKER_VELA.chart.orchestrator.notifySessionsBars('complete'));
      await sleep(6000); same(ref, await probe(p), w + ' history prepended (complete, script re-ran)');
      // 2. prepend and trim in ONE change (a days-to-load window that moves while older pages land): the old head is in neither set
      await p.evaluate(() => { const o = window.STRYKER_VELA.chart.orchestrator, raw = o.rawBars; o.setBarSeries(raw.slice(150), { preserveView: true }); o.setBarSeries([...raw.slice(40, 100), ...o.rawBars], { preserveView: true }); o.notifySessionsBars(); });
      await sleep(800); same(ref, await probe(p), w + ' trimmed + prepended at once (0.8 s)');
      await sleep(4000); same(ref, await probe(p), w + ' trimmed + prepended at once (after re-run)');
      // 3. pan / zoom around the newest boxes
      const tLast = Math.max(...[...ref.values()]);
      await p.evaluate((t) => window.STRYKER_VELA.chart.setVisibleRange({ from: t - 3600e3 * 3, to: t + 3600e3 }), tLast);
      await sleep(800); same(ref, await probe(p), w + ' panned / zoomed');
      // 4. live: new candles and ticks
      await p.evaluate(() => { const o = window.STRYKER_VELA.chart.orchestrator, l = o.rawBars[o.rawBars.length - 1], tf = l.time - o.rawBars[o.rawBars.length - 2].time;
        for (let k = 1; k <= 3; k++) o.onBar({ time: l.time + k * tf, open: l.close, high: l.close + 2, low: l.close - 2, close: l.close + 1, volume: 10 });
        o.onBar({ time: l.time + 3 * tf, open: l.close, high: l.close + 3, low: l.close - 2, close: l.close + 2, volume: 12 }); });
      await sleep(4000); same(ref, await probe(p), w + ' live bars added');
      // the screenshot: newest boxes in view
      await p.evaluate((t) => window.STRYKER_VELA.chart.setVisibleRange({ from: t - 3600e3 * 2, to: t + 3600e3 * 0.7 }), tLast);
      await sleep(1200);
      const shot = path.join(OUT, 'ifvg-rr-' + w + '-' + theme + '.png');
      await p.screenshot({ path: shot }); console.log('SHOT ' + shot);
      check(!errs.length, w + ': no page errors', errs);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
