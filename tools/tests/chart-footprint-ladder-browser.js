// (copy of the helpers) Delta ladder style tests. Original: Order flow on Charts (assets/chart-footprint.js): the Footprint chart type + the "Order Flow"
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

async function open(b, { w, h, mobile, q }) {
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
  await p.goto(BASE + '/charts.html' + (q || ''), { waitUntil: 'domcontentloaded' });
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
  const b = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  const T = RAW.t * 1000;
  const eng = (p, v) => p.evaluate((v) => window.STRYKER_VELA.chart.orchestrator.typeEngines.get('stk_fp').onSettings(v), v);
  const perf = async (p) => {
    await p.evaluate(() => { window.__stkFpStats = []; });
    for (let i = 0; i < 20; i++) { await p.evaluate(() => window.STRYKER_VELA.chart.panBy(0.01)); await sleep(50); }
    const fr = await p.evaluate(() => window.__stkFpStats.slice());
    fr.sort((a, c) => a - c); return { n: fr.length, med: +(fr[Math.floor(fr.length / 2)] || 0).toFixed(2), max: +(fr[fr.length - 1] || 0).toFixed(2) };
  };
  try {
    for (const vp of [{ w: 1440, h: 900, tag: '1440' }, { w: 390, h: 844, tag: '390', mobile: true }]) {
      for (const theme of ['dark', 'light']) {
        for (const vela of ['0.9', '0.6']) {
          if (theme === 'light' && vela === '0.6') continue;
          const { ctx, p, errors } = await open(b, { ...vp, q: vela === '0.6' ? '?vela=0.6' : '' });
          await p.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); window.dispatchEvent(new Event('stryker:theme')); }, theme);
          await p.evaluate(() => { window.__stkOfTestTier = { free: false, plan: 'Pro' }; });
          await setMarket(p, 'futures:NQ1!', '1');
          await p.evaluate(() => window.STRYKER_VELA.active.setPriceStyle('stk_fp'));
          const tag = vp.tag + '-' + theme + '-v' + vela;
          const N = vp.w === 390 ? 2 : 4;
          await frameOn(p, T - N * 60000, T + N * 60000);
          await p.waitForFunction(() => window.__stkOrderflow.loaded('NQ').some((d) => d.n > 0), null, { timeout: 15000 }).catch(() => {});
          await sleep(1200);
          await eng(p, { fpMode: 'bidask' }); await sleep(300);
          const pb = await perf(p);
          await p.screenshot({ path: OUT + '/bidask-' + tag + '.png' });
          await eng(p, { fpMode: 'ladder', fpLadShow: 'volume' }); await sleep(500);
          const pl = await perf(p);
          check(pl.n > 3 && pl.med <= Math.max(8, pb.med * 1.3), tag + ': ladder frame ms median ' + pl.med + ' max ' + pl.max + ' vs bidask median ' + pb.med + ' max ' + pb.max, { pl, pb });
          await frameOn(p, T - N * 60000, T + N * 60000);
          await p.screenshot({ path: OUT + '/ladder-' + tag + '.png' });
          if (vela === '0.9' && theme === 'dark') {
            await eng(p, { fpMode: 'ladder', fpScale: 'bar', fpLadShow: 'delta' }); await sleep(400);
            await p.screenshot({ path: OUT + '/ladder-' + tag + '-perbar.png' });
            await frameOn(p, T - 40 * 60000, T + 40 * 60000); await sleep(500);
            await p.screenshot({ path: OUT + '/ladder-' + tag + '-zoomout.png' });
            await eng(p, { fpMode: 'ladder', fpScale: 'range', fpLadShow: 'volume', fpLadPoc: true, fpLadUnf: true }); await sleep(400); await p.screenshot({ path: OUT + '/ladder-' + tag + '-poc-on.png' }); await eng(p, { fpMode: 'ladder', fpLadShow: 'volume' });
            if (vp.w === 1440) {
              await setMarket(p, 'futures:NQ1!', '5'); await sleep(1500);
              await frameOn(p, T - 40 * 60000, T + 40 * 60000); await sleep(800);
              await p.screenshot({ path: OUT + '/ladder-' + tag + '-5m.png' });
            }
          }
          check(errors.length === 0, tag + ': no console errors', errors);
          await ctx.close();
        }
      }
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILS ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
