// SVP "Show delta bars" browser test (assets/chart-orderflow.js svpDelta + drawSvpDelta). Same fixture setup as bar-stats-browser.js.
//   node tools/tests/chart-dev-server.mjs 8071
//   CHART_BASE=http://127.0.0.1:8071 OF_FIXTURE_DIR=<dir with NQ-2026-10-13.bin + empty.bin> NODE_PATH=<repo>/node_modules node tools/tests/svp-delta-browser.js <shotsDir>
// Sample data: a recorded NQ day (13 Oct 2026). Checks: default OFF draws no delta colours; ON draws green+red bars; 'beside' differs from 'inside';
// opacity changes the pixels; pure svpDelta maths; no page errors. Shots at 1440 dark/light and 390.
const fs = require('fs'), path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8071', FIX = process.env.OF_FIXTURE_DIR, OUT = process.argv[2] || '/tmp/svpd';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
let CANDLES = null;
async function candles(tf) {
  if (!CANDLES) { const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js')); CANDLES = { D, bars: D.decodeOrderflow(new Uint8Array(fs.readFileSync(path.join(FIX, 'NQ-2026-10-13.bin')))).bars }; }
  return CANDLES.D.aggregate(CANDLES.bars, tf * 60000).map((b) => [b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]);
}
(async () => {
  const U = await import(path.resolve(__dirname, '../../assets/chart-orderflow.js')).catch(() => null);
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const vp of [{ w: 1440, h: 900, tag: '1440-dark' }, { w: 1440, h: 900, tag: '1440-light', light: true }, { w: 390, h: 844, tag: '390-dark', mobile: true }]) {
      const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker.vela.session'); } catch (e) {} });
      await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
      await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, async (r) => { const u = new URL(r.request().url()), tf = Number(u.searchParams.get('tf')) || 1, page = Number(u.searchParams.get('page')) || 0; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: String(tf), page, bars: await candles(tf) }) }); });
      await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => { const u = new URL(r.request().url()), f = path.join(FIX, u.searchParams.get('sym') + '-' + u.searchParams.get('day') + '.bin'); r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(fs.existsSync(f) ? f : path.join(FIX, 'empty.bin')) }); });
      const p = await ctx.newPage(), errors = [];
      p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkOrderflow, null, { timeout: 60000 });
      if (vp.light) await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); window.dispatchEvent(new Event('stryker:theme')); try { window.STRYKER_VELA.setTheme('light'); } catch (e) {} });
      await sleep(2000);
      await p.evaluate(() => { window.__stkTestL1 = true; window.__stkOfTestTier = { free: false, plan: 'Pro' }; });
      await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('5'); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === 'futures:NQ1!' && ws.chart.orchestrator.rawBars.length > 50) break; } });
      const T = await p.evaluate(() => { const r = window.STRYKER_VELA.chart.orchestrator.rawBars; return [r[0].time, r[r.length - 1].time]; });
      await p.evaluate((t) => window.STRYKER_VELA.chart.setVisibleRange({ from: t[0], to: t[1] + 3600000 }), T);
      await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator('stk_svp', { inputs: { session: 'day', widthPct: 70 } }));
      const set = (o) => p.evaluate((o) => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === 'stk_svp'); h.setInputs(Object.assign({}, h.inputValues(), o)); }, o);
      const probe = () => p.evaluate(() => { let g = 0, r = 0; for (const cv of document.querySelectorAll('#vela-chart canvas')) { const c = cv.getContext('2d'); if (!c) continue; let d; try { d = c.getImageData(0, 0, cv.width, cv.height).data; } catch (e) { continue; }
        for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 40) continue; if (d[i + 1] > 120 && d[i] < 60 && d[i + 2] > 90 && d[i + 2] < 160) g++; if (d[i] > 190 && d[i + 1] < 90 && d[i + 2] < 100) r++; } } return { g, r }; });
      await sleep(2500);
      const off = await probe();
      await set({ showDelta: true }); await sleep(4000);
      const on = await probe();
      await p.screenshot({ path: `${OUT}/svp-delta-inside-${vp.tag}.png` });
      await set({ showDelta: true, deltaPos: 'beside' }); await sleep(1500);
      const bs = await probe();
      await p.screenshot({ path: `${OUT}/svp-delta-beside-${vp.tag}.png` });
      await set({ showDelta: true, deltaPos: 'beside', deltaOpacity: 20 }); await sleep(1200);
      const lo = await probe();
      await set({ showDelta: false }); await sleep(1200);
      const off2 = await probe();
      check(off.g + off.r > 0, vp.tag + ' default OFF baseline (candles only)', off);
      check(on.g > off.g + 100 && on.r > off.r + 100, vp.tag + ' ON: green + red bars drawn', { off, on });
      check(bs.g !== on.g || bs.r !== on.r, vp.tag + ' beside differs from inside', { on, bs });
      check(lo.g < bs.g, vp.tag + ' lower opacity = fewer opaque pixels', { bs, lo });
      check(Math.abs(off2.g - off.g) + Math.abs(off2.r - off.r) < 50, vp.tag + ' toggled back OFF returns to the default look', { off, off2 });
      check(!errors.length, vp.tag + ' no page errors', errors.slice(0, 2));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'all ok'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
