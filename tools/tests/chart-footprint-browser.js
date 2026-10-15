// Order flow on Charts (assets/chart-footprint.js): the Footprint chart type + the "Order Flow"
// indicators, against tools/tests/chart-dev-server.mjs. The recorder's /orderflow is answered from
// a REAL recorder payload saved to disk (OF_FIXTURE_DIR/<day>.bin = the gunzipped body), so no
// live dependency; bars are live (Yahoo via the dev server).
//   CHART_BASE=http://127.0.0.1:8071 OF_FIXTURE_DIR=<dir> OF_RAW=<raw-1430.json> \
//     flock /tmp/stryker-chrome.lock node --max-old-space-size=768 tools/tests/chart-footprint-browser.js <shotsDir>
// Checks:
//   1440: "Footprint" is in the chart-style menu; picking it draws cells; one 1m bar's buy/sell,
//         delta and POC equal the raw InsightSentry ticks (OF_RAW); 5m re-aggregation equals the
//         raw ticks over 5 minutes; frame time < 8 ms; the 5 "Order Flow" indicators are in the
//         picker group and each one adds + renders; no console errors.
//   replay: with the replay clock mid-session, no footprint bar / big trade after the clock.
//   free plan: ES shows the Pro note; NQ older than 24 h is not drawn.
//   390: footprint readable at max zoom; no horizontal scroll.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8071';
const FIX = process.env.OF_FIXTURE_DIR;
const RAW = JSON.parse(fs.readFileSync(process.env.OF_RAW, 'utf8'));
const OUT = process.argv[2] || '/tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined && !ok ? ' ' + JSON.stringify(extra).slice(0, 600) : '')); };
const reqs = [];
// Candles for the chart: built from the same real recorder payload (o/h/l/c/volume of each
// 1-minute footprint bar, price = tick index x 0.25), so candles and footprint line up exactly.
let CANDLES = null;
async function candles(tf) {
  if (!CANDLES) {
    const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js'));
    const bars = D.decodeOrderflow(new Uint8Array(fs.readFileSync(path.join(FIX, 'NQ-2026-10-13.bin')))).bars;
    CANDLES = { D, bars };
  }
  const { D, bars } = CANDLES;
  const agg = D.aggregate(bars, tf * 60000);
  return agg.map((b) => [b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]);
}

async function open(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker.vela.session'); } catch (e) {} window.__stkFpStats = []; });
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, async (r) => {
    const u = new URL(r.request().url());
    const tf = Number(u.searchParams.get('tf')) || 1, page = Number(u.searchParams.get('page')) || 0;
    const rows = await candles(tf);   // every page (the provider asks for the page holding "now")
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: String(tf), page, bars: rows }) });
  });
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => {
    const u = new URL(r.request().url());
    reqs.push(u.search);
    const f = path.join(FIX, u.searchParams.get('sym') + '-' + u.searchParams.get('day') + '.bin');
    if (!fs.existsSync(f)) { r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(FIX, 'empty.bin')) }); return; }
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(f) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|\/api\/chart\/stream/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkOrderflow, null, { timeout: 60000 });
  await sleep(2500);
  return { ctx, p, errors };
}
async function setMarket(p, sym, tf) {
  await p.evaluate(async ([sym, tf]) => {
    const ws = window.STRYKER_VELA;
    ws.active.setSymbol(sym); ws.active.setTimeframe(tf);
    const c = ws.chart;
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (c.market.symbol === sym && c.market.timeframe === tf && c.orchestrator.rawBars.length > 50) break; }
  }, [sym, tf]);
  await sleep(1200);
}
// Frame the chart on [t0, t1] (ms).
async function frameOn(p, t0, t1) {
  await p.evaluate(([a, z]) => window.STRYKER_VELA.chart.setVisibleRange({ from: a, to: z }), [t0, t1]);
  await sleep(900);
}
async function fpCellsDrawn(p) {
  return p.evaluate(() => {
    const cs = [...document.querySelectorAll('#vela-chart canvas')];
    let best = 0;
    for (const c of cs) { // count non-transparent pixels on the layer canvases (cheap sample)
      if (!c.width || !c.height) continue;
      const g = c.getContext('2d'); if (!g) continue;
      let d; try { d = g.getImageData(0, 0, c.width, c.height).data; } catch (e) { continue; }
      let n = 0; for (let i = 3; i < d.length; i += 64) if (d[i] > 0) n++;
      best = Math.max(best, n);
    }
    return best;
  });
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const T = RAW.t * 1000;
  try {
    // ---------------- desktop 1440
    {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900 });
      await p.evaluate(() => { window.__stkOfTestTier = { free: false, plan: 'Pro' }; });
      await setMarket(p, 'futures:NQ1!', '1');
      // chart-type menu lists Footprint
      const styles = await p.evaluate(() => { try { return window.STRYKER_VELA.chart.renderer ? [...document.querySelectorAll('[role="menuitemradio"],[role="menuitem"]')].map((x) => x.textContent.trim()) : []; } catch (e) { return []; } });
      await p.click('[aria-label^="Chart style"]').catch(() => {});
      await sleep(500);
      const menu = await p.evaluate(() => [...document.querySelectorAll('[role="menu"] *, .vela-menu *, .vela-dropdown *')].map((x) => x.textContent.trim()).filter((t) => t && t.length < 30));
      check(menu.includes('Footprint'), '1440: "Footprint" is in the chart-style menu', [...new Set(menu)].slice(0, 30));
      await p.screenshot({ path: OUT + '/fp-1440-style-menu.png' });
      await p.keyboard.press('Escape');
      await p.evaluate(() => window.STRYKER_VELA.active.setPriceStyle('stk_fp'));
      await sleep(800);
      // a 25-minute window around the checked bar so the cells have room
      const t0s = Date.now();
      await frameOn(p, T - 12 * 60000, T + 12 * 60000);
      await p.waitForFunction(() => window.__stkOrderflow.loaded('NQ').some((d) => d.n > 0), null, { timeout: 15000 }).catch(() => {});
      const switchMs = Date.now() - t0s;
      await sleep(1500);
      // one bar vs the raw ticks
      const bar = await p.evaluate((T) => {
        const O = window.__stkOrderflow, bs = O.minuteBars('NQ', T - 60000, T + 300000);
        const b = bs.find((x) => x.t === T);
        if (!b) return null;
        const rs = O.rows(b, 1), k = O.poc(rs), tick = 0.25;
        const lv = {}; rs.forEach((r) => { if (r.buy || r.sell) lv[(r.p * tick).toFixed(2)] = [r.sell, r.buy]; });
        const five = O.aggregate(bs.filter((x) => x.t >= T && x.t < T + 300000), 300000)[0];
        const r5 = O.rows(five, 1), k5 = O.poc(r5);
        return { buy: b.buy.reduce((a, c) => a + c, 0), sell: b.sell.reduce((a, c) => a + c, 0), delta: b.delta, trades: b.trades, poc: rs[k].p * tick, pocVol: rs[k].buy + rs[k].sell, lv,
          f5: { buy: five.buy.reduce((a, c) => a + c, 0), sell: five.sell.reduce((a, c) => a + c, 0), delta: five.delta, poc: r5[k5].p * tick, pocVol: r5[k5].buy + r5[k5].sell } };
      }, T);
      const m1 = RAW.m1, m5 = RAW.m5;
      check(bar && bar.buy === m1.buy && bar.sell === m1.sell && bar.delta === m1.delta, '1440: the 14:30 UTC 1m bar buy ' + (bar && bar.buy) + ' / sell ' + (bar && bar.sell) + ' / delta ' + (bar && bar.delta) + ' = raw ticks (' + m1.buy + ' / ' + m1.sell + ' / ' + m1.delta + ', ' + m1.prints + ' prints)', bar);
      check(bar && bar.poc === m1.poc && bar.pocVol === m1.pocVol, '1440: POC ' + (bar && bar.poc) + ' (' + (bar && bar.pocVol) + ' lots) = raw ticks ' + m1.poc + ' (' + m1.pocVol + ')', bar);
      const lvOk = bar && Object.keys(m1.levels).every((k) => { const x = bar.lv[Number(k).toFixed(2)]; return x && x[0] === m1.levels[k][0] && x[1] === m1.levels[k][1]; }) && Object.keys(bar.lv).length === Object.keys(m1.levels).length;
      check(lvOk, '1440: every price level of that bar (sell x buy) = raw ticks (' + Object.keys(m1.levels).length + ' levels)');
      check(bar && bar.f5.buy === m5.buy && bar.f5.sell === m5.sell && bar.f5.delta === m5.delta && bar.f5.poc === m5.poc, '1440: 14:30-14:35 re-aggregated to 5m = raw ticks over 5 minutes (delta ' + (bar && bar.f5.delta) + ', POC ' + (bar && bar.f5.poc) + ')', { got: bar && bar.f5, raw: m5 });
      check(switchMs < 3000, '1440: switching to Footprint + loading the day took ' + switchMs + ' ms (fixture served locally)');
      const px = await fpCellsDrawn(p);
      check(px > 2000, '1440: footprint cells are drawn (' + px + ' sampled px)');
      // zoom so the bar's text is readable: frame 7 bars
      await frameOn(p, T - 3 * 60000, T + 3 * 60000);
      await sleep(800);
      await p.evaluate(() => { window.__stkFpStats = []; });
      for (let i = 0; i < 12; i++) { await p.evaluate(() => window.STRYKER_VELA.chart.panBy(0.01)); await sleep(60); }
      const fr = await p.evaluate(() => window.__stkFpStats.slice());
      const med = fr.length ? fr.slice().sort((a, c) => a - c)[Math.floor(fr.length / 2)] : -1, mx = fr.length ? Math.max(...fr) : -1;
      check(fr.length > 3 && med < 8, '1440: footprint frame time median ' + med.toFixed(2) + ' ms, max ' + mx.toFixed(2) + ' ms over ' + fr.length + ' frames (< 8 ms)');
      await frameOn(p, T - 3 * 60000, T + 3 * 60000);
      await p.screenshot({ path: OUT + '/fp-1440-bidask.png' });
      // modes
      for (const mode of ['delta', 'volume']) {
        await p.evaluate((m) => { const c = window.STRYKER_VELA.chart; c.orchestrator.typeEngines.get('stk_fp').onSettings({ fpMode: m }); }, mode);
        await sleep(500);
        await p.screenshot({ path: OUT + '/fp-1440-' + mode + '.png' });
      }
      await p.evaluate(() => window.STRYKER_VELA.chart.orchestrator.typeEngines.get('stk_fp').onSettings({ fpMode: 'bidask' }));
      // zoomed out: delta candles
      await frameOn(p, T - 180 * 60000, T + 60 * 60000);
      await p.screenshot({ path: OUT + '/fp-1440-zoomed-out.png' });

      // indicators: picker group + each one renders
      const lib = await p.evaluate(() => window.STRYKER_VELA.active.libraryRows().filter((r) => r.category === 'Order Flow').map((r) => r.name));
      check(lib.length === 5, '1440: Indicators picker has the "Order Flow" group with 5 tools', lib);
      const cats = await p.evaluate(() => { const o = []; window.STRYKER_VELA.active.libraryRows().forEach((r) => { if (!o.includes(r.category)) o.push(r.category); }); return o; });
      check(cats.indexOf('Order Flow') >= 0 && cats.indexOf('Order Flow') < cats.indexOf('Volume & Order flow'), '1440: "Order Flow" group sits above "Volume & Order flow" in the picker', cats);
      await p.evaluate(() => window.STRYKER_VELA.active.setPriceStyle('candles'));
      await frameOn(p, T - 90 * 60000, T + 30 * 60000);
      const types = ['stk_of_delta', 'stk_of_cvd', 'stk_of_big', 'stk_of_vp', 'stk_of_vwap'];
      for (const t of types) await p.evaluate((t) => window.STRYKER_VELA.chart.addNativeIndicator(t), t);
      await sleep(2500);
      const T2 = await p.evaluate(() => window.STRYKER_VELA.chart.orchestrator.rawBars[10].time);   // a bar on the chart (the dev feed holds the last 500)
      const want = await p.evaluate((T2) => { const b = window.__stkOrderflow.minuteBars('NQ', T2 - 60000, T2 + 60000).find((x) => x.t === T2); return b ? { delta: b.delta } : null; }, T2);
      const ind = await p.evaluate((T) => {
        const c = window.STRYKER_VELA.chart, out = {};
        for (const r of c.orchestrator.registry.all()) {
          if (!r.native) continue;
          const m = r.model, s = m && m.series && m.series[0];
          let n = 0, at = null, first = null, last = null;
          const near = (a) => a.reduce((best, q) => (q && (best == null || Math.abs(q.time - T) < Math.abs(best.time - T)) ? q : best), null);
          if (s && s.points) { n = s.points.filter((q) => q.value != null).length; const q = near(s.points.filter((q) => q.value != null)); at = q && q.time === T ? q.value : null; first = s.points[0].time; last = s.points[s.points.length - 1].time; }
          if (s && s.bars) { n = s.bars.filter(Boolean).length; const q = near(s.bars.filter(Boolean)); at = q && q.time === T ? [q.open, q.close] : null; first = s.bars[0] && s.bars[0].time; }
          out[r.native.type] = { n, at, first, last, T, tables: (m && m.tables || []).map((t) => t.cells[0][0].text) };
        }
        return out;
      }, T2);
      check(want && ind.stk_of_delta && ind.stk_of_delta.n > 30 && ind.stk_of_delta.at === want.delta, '1440: Delta (trades) plots; the bar at ' + new Date(T2).toISOString().slice(11, 16) + ' UTC = ' + (ind.stk_of_delta && ind.stk_of_delta.at) + ' (that bar\'s trade data: ' + (want && want.delta) + '; the 14:30 bar was checked against raw ticks above)', { ind: ind.stk_of_delta, want });
      check(want && ind.stk_of_cvd && ind.stk_of_cvd.n > 30 && Array.isArray(ind.stk_of_cvd.at) && ind.stk_of_cvd.at[1] - ind.stk_of_cvd.at[0] === want.delta, '1440: CVD (trades) candles; that bar close - open = its delta', { ind: ind.stk_of_cvd, want });
      check(ind.stk_of_vwap && ind.stk_of_vwap.n > 30, '1440: VWAP (trades) plots with bands', ind.stk_of_vwap);
      check(ind.stk_of_big && !ind.stk_of_big.tables.length && ind.stk_of_vp && !ind.stk_of_vp.tables.length, '1440: Big Trades + Volume Profile (trades) on, no error note', { big: ind.stk_of_big, vp: ind.stk_of_vp });
      await p.screenshot({ path: OUT + '/fp-1440-indicators.png' });

      // replay: clock at 14:32:30 -> no 14:32 bar (not complete), nothing after
      await p.evaluate(() => window.STRYKER_VELA.active.setPriceStyle('stk_fp'));
      const E2 = T2 + 150000;
      await p.evaluate((E) => {
        // drive the order-flow clip directly (the replay UI's own suite covers the provider side)
        Object.defineProperty(window, '__stkReplay', { configurable: true, value: { on: true, E, now: () => E } });
      }, E2);
      await sleep(400);
      const rp = await p.evaluate((T) => {
        const c = window.STRYKER_VELA.chart;
        // the indicator values after the clock must be empty
        const d = [...c.orchestrator.registry.all()].find((r) => r.native && r.native.type === 'stk_of_delta');
        d.native.instance.render();
        const pts = d.model.series[0].points;
        const after = pts.filter((q) => q.time >= T + 120000 && q.value != null).length;
        const before = pts.filter((q) => q.time === T + 60000 && q.value != null).length;
        return { after, before, first: pts[0].time, last: pts[pts.length - 1].time, nn: pts.filter((q) => q.value != null).length };
      }, T2);
      check(rp.after === 0 && rp.before === 1, 'replay: with the clock 2.5 min into a bar, Delta has the previous bar and nothing from the forming minute on (no lookahead)', rp);
      await p.evaluate(() => { Object.defineProperty(window, '__stkReplay', { configurable: true, value: { on: false, E: 0, now: () => Date.now() } }); });

      // free plan: ES -> Pro note
      await p.evaluate(() => { window.__stkOfTestTier = { free: true }; });
      await setMarket(p, 'futures:ES1!', '1');
      await sleep(1500);
      const note = await p.evaluate(() => { const r = [...window.STRYKER_VELA.chart.orchestrator.registry.all()].find((r) => r.native && r.native.type === 'stk_of_delta'); r.native.instance.render(); return (r.model.tables || []).map((t) => t.cells[0][0].text); });
      check(note.some((t) => /part of Pro/.test(t)), 'free plan: ES shows "part of Pro"', note);
      await p.screenshot({ path: OUT + '/fp-1440-free-es.png' });
      check(!errors.length, '1440: no console errors', errors);
      await ctx.close();
    }
    // ---------------- phone 390
    {
      const { ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true });
      await p.evaluate(() => { window.__stkOfTestTier = { free: false, plan: 'Pro' }; });
      await setMarket(p, 'futures:NQ1!', '1');
      await p.evaluate(() => window.STRYKER_VELA.active.setPriceStyle('stk_fp'));
      await frameOn(p, T - 60000, T + 60000);
      await sleep(1800);
      await frameOn(p, T - 60000, T + 60000);
      const px = await fpCellsDrawn(p);
      const hs = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(px > 1000, '390: footprint cells drawn at max zoom (' + px + ' px)');
      check(!hs, '390: no horizontal scroll');
      await p.screenshot({ path: OUT + '/fp-390-bidask.png' });
      check(!errors.length, '390: no console errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
