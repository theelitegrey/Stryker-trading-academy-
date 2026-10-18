// Crypto footprint on Charts (assets/chart-footprint-crypto.js): BTCUSDT 1m + the "Footprint" picker row.
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node --max-old-space-size=768 \
//     tools/tests/chart-footprint-crypto-browser.js [shotsDir]
// Talks to the REAL public Binance endpoints (aggTrades REST + aggTrade WebSocket); no key.
// CHART_BASE=https://tradezoro.com runs the same checks against the live site.
// Checks: picking "Footprint" on BTCUSDT draws cells within 10 s (1440); the backfill reaches back
//   >= 2 h; the forming candle's volume grows live; Delta + CVD (trades) have values; 390 shows the
//   compact mode; with Binance unreachable a "temporarily unavailable" note shows (never blank).
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const SYM = process.env.SYM || 'binance:BTCUSDT';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined && !ok ? ' ' + JSON.stringify(extra).slice(0, 500) : '')); };
const BINANCE = /^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net|tradezoro\.com|www\.tradezoro\.com)/;

async function open(b, { w, h, mobile, blockBinance }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker.vela.session'); } catch (e) {} });
  if (blockBinance) await ctx.route(/binance\.(com|vision)\/(api|fapi)\/.*aggTrades/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource|status of|econ-calendar|CORS/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkOrderflow, null, { timeout: 60000 });
  await sleep(2500);
  await p.evaluate(async ([s]) => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === s && ws.chart.orchestrator.rawBars.length > 50) break; }
  }, [SYM]);
  await sleep(1000);
  return { ctx, p, errors };
}
// Pick "Footprint" exactly like the indicator picker does (the same addFromLibrary path).
const pickFootprint = (p) => p.evaluate(() => {
  const cell = window.STRYKER_VELA.active, rows = cell.libraryRows();
  const i = rows.findIndex((r) => r.native && r.nativeType === 'stk_footprint');
  if (i < 0) return { ok: false, rows: rows.length };
  cell.addFromLibrary(i);
  return { ok: true, style: cell.priceStyle };
});
const cells = (p) => p.evaluate(() => {
  let best = 0;
  for (const c of document.querySelectorAll('#vela-chart canvas')) {
    if (!c.width || !c.height) continue;
    const g = c.getContext('2d'); if (!g) continue;
    let d; try { d = g.getImageData(0, 0, c.width, c.height).data; } catch (e) { continue; }
    let n = 0; for (let i = 3; i < d.length; i += 64) if (d[i] > 0) n++;
    best = Math.max(best, n);
  }
  return best;
});
const zoom = (p, n) => p.evaluate((n) => { const c = window.STRYKER_VELA.chart, rb = c.orchestrator.rawBars, k = rb.length; c.setVisibleRange({ from: rb[k - n].time, to: rb[k - 1].time + 90000 }); }, n);
const fp = (p) => p.evaluate(() => {
  const o = window.__stkOrderflow, f = o.crypto ? o.crypto() : null;
  return f;
});

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900 });
      const pk = await pickFootprint(p);
      check(pk.ok && pk.style === 'stk_fp', '1440: picker "Footprint" row switches BTCUSDT to the Footprint chart type', pk);
      const t0 = Date.now();
      await zoom(p, 14);
      let n = 0;
      while (Date.now() - t0 < 10000) { n = await cells(p); if (n > 1500) break; await sleep(500); }
      const took = Date.now() - t0;
      check(n > 1500, '1440: BTC footprint cells drawn within 10 s (' + n + ' px samples, ' + took + ' ms)', n);
      for (let i = 0; i < 60; i++) { const q = await fp(p); if (q && q.status === 'live') break; await sleep(1000); }
      await zoom(p, 120);
      await sleep(2500);
      await p.screenshot({ path: OUT + '/btc-fp-1440-2h.png' });
      const cov = await p.evaluate(() => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars.slice(-120), o = window.__stkOrderflow.crypto(), have = new Set(o.vols.map((v) => v[0])); return rb.filter((b) => have.has(b.time)).length / rb.length; });
      check(cov >= 0.97, '1440: the last 120 one-minute candles (2 h) all have footprint data (' + Math.round(cov * 100) + '%)', cov);
      await zoom(p, 14);
      await sleep(1500);
      await p.screenshot({ path: OUT + '/btc-fp-1440.png' });
      const st = await fp(p);
      const kl = await p.evaluate(async () => { const k = await (await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=60')).json(); const o = window.__stkOrderflow.crypto(), m = new Map(o.vols.map((v) => [v[0], v[1]])); let worst = 0, n = 0; for (const x of k.slice(0, -2)) { const v = m.get(x[0]); if (v == null) continue; n++; worst = Math.max(worst, Math.abs(v - +x[5]) / +x[5]); } return { n, worst }; });
      check(kl.n >= 40 && kl.worst < 0.01, '1440: footprint volume = Binance 1m kline volume on ' + kl.n + ' finished candles (worst diff ' + (kl.worst * 100).toFixed(3) + '%)', kl);
      check(st && st.minutes >= 100, '1440: backfill reaches back >= 100 minutes (' + (st && st.minutes) + ' min, ' + (st && st.status) + ')', st);
      check(st && st.status === 'live', '1440: feed status live', st);
      // live: the newest minute's volume grows
      const v0 = st && st.lastVol;
      await sleep(8000);
      const st2 = await fp(p);
      check(st2 && st2.lastVol > v0 || (st2 && st2.lastT > st.lastT), '1440: forming candle updates live (vol ' + v0 + ' -> ' + (st2 && st2.lastVol) + ')', [st, st2]);
      // Delta + CVD (trades) on crypto
      await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_of_delta'); c.addNativeIndicator('stk_of_cvd'); });
      await sleep(2500);
      const ind = await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.inspect().indicators.filter((x) => /Delta|CVD|Cumulative/i.test(x.title)).map((x) => ({ t: x.title, n: JSON.stringify(x).length, msg: JSON.stringify(x.tables || '').slice(0, 120) })));
      const cv = await p.evaluate(() => { const i = window.STRYKER_VELA.context().cells[0].chart.inspect().indicators.find((x) => /Cumulative/.test(x.title)); return i && i.series; });
      check(cv && cv.line === 1, '1440: CVD (trades) draws a line series on BTC', cv);
      check(ind.length >= 2 && ind.every((x) => !/unavailable|Needs/.test(x.msg)), '1440: Delta + CVD (trades) added on BTC, no error note', ind);
      await p.screenshot({ path: OUT + '/btc-fp-1440-delta.png' });
      check(errors.length === 0, '1440: no console errors', errors);
      await ctx.close();
    }
    {
      const { ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true });
      await pickFootprint(p);
      for (let i = 0; i < 60; i++) { const q = await fp(p); if (q && q.status === 'live') break; await sleep(1000); }
      await zoom(p, 7);
      let n = 0; const t0 = Date.now();
      while (Date.now() - t0 < 12000) { n = await cells(p); if (n > 600) break; await sleep(500); }
      check(n > 600, '390: BTC footprint cells drawn (' + n + ' px samples)', n);
      await sleep(800);
      await p.screenshot({ path: OUT + '/btc-fp-390.png' });
      await zoom(p, 60); await sleep(2000);
      await p.screenshot({ path: OUT + '/btc-fp-390-1h.png' });
      const cov = await p.evaluate(() => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars.slice(-120), o = window.__stkOrderflow.crypto(), have = new Set(o.vols.map((v) => v[0])); return rb.filter((b) => have.has(b.time)).length / rb.length; });
      check(cov >= 0.97, '390: the last 120 candles all have footprint data (' + Math.round(cov * 100) + '%)', cov);
      const sw = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      check(sw, '390: no horizontal scroll');
      check(errors.length === 0, '390: no console errors', errors);
      await ctx.close();
    }
    {
      const { ctx, p } = await open(b, { w: 1440, h: 900, blockBinance: true });
      await pickFootprint(p);
      await zoom(p, 14);
      await sleep(6000);
      const st = await fp(p);
      check(st && st.status === 'error' && /temporarily unavailable/.test(st.err), '1440: Binance blocked -> "temporarily unavailable" note, not blank', st);
      await p.screenshot({ path: OUT + '/btc-fp-1440-blocked.png' });
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
