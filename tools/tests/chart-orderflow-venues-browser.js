// Crypto order flow on the venues added after Hyperliquid (assets/orderflow-venue-{okx,bitget,kraken,bybit}.js):
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/chart-orderflow-venues-browser.js <outDir>
// OKX / Bitget / Kraken use the REAL public sockets; Bybit uses tools/tests/bybit-mock.js (api.bybit.com is
// geo-blocked here). Per symbol, 1m: Footprint chart type goes live and draws, Delta + CVD + Big Trades add with no
// blocking note, Crypto DOM heatmap draws cells + depth bars, no console errors. Then a Bybit 403 shows the
// "isn't available in your region" note. SHOTS=dir writes M-<venue>-of-<390-dark|1440-dark|1440-light>.png
// (footprint + heatmap together) for OKX:BTC-USDT-SWAP and BITGET:BTCUSDT.P.
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.VENUES ? process.env.VENUES.split(',') : null;
const SYMS = [
  { sym: 'okx:BTC-USDT-SWAP', tag: 'okx', shots: true },
  { sym: 'bitget:BTCUSDT.P', tag: 'bitget', shots: true },
  { sym: 'kraken:XBTUSD', tag: 'kraken' },
  { sym: 'bybit:BTCUSDT.P', tag: 'bybit', mock: true },
].filter((s) => !ONLY || ONLY.includes(s.tag));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (ok, msg, extra) => { if (!ok) fail++; else pass++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined && !ok ? ' ' + JSON.stringify(extra).slice(0, 500) : '')); };
const IGNORE = /ERR_FAILED|net::|Failed to load resource|status of|econ-calendar|CORS|Firestore|FirebaseError|offline|bybit/i;

async function open(b, { w, h, mobile, theme, sym, mock, block }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker.vela.session'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme || 'dark');
  await require('./binance-mock.js').install(ctx);
  if (mock) await require('./bybit-mock.js').install(ctx);
  if (block) {   // what CloudFront answers from a blocked country
    await ctx.route(/^https:\/\/api\.bybit\.com\//, (r) => r.fulfill({ status: 403, contentType: 'text/html', body: '<h1>403 ERROR</h1>' }));
    await ctx.routeWebSocket(/stream\.bybit\.com/, (ws) => ws.close());
  }
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkOrderflow && window.__stkFlow, null, { timeout: 60000 });
  await sleep(2000);
  await p.evaluate(async ([s, blk]) => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1');
    for (let i = 0; i < (blk ? 40 : 100); i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === s && ws.chart.orchestrator.rawBars.length > 50) break; }
  }, [sym, !!block]);
  await sleep(1000);
  return { ctx, p, errors };
}
const pickFootprint = (p) => p.evaluate(() => {
  const cell = window.STRYKER_VELA.active, rows = cell.libraryRows();
  const i = rows.findIndex((r) => r.native && r.nativeType === 'stk_footprint');
  if (i < 0) return { ok: false };
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
const fp = (p) => p.evaluate(() => { const o = window.__stkOrderflow; return o.crypto ? o.crypto() : null; });
const add = (p, type, inputs) => p.evaluate(([t, i]) => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator(t, i ? { inputs: i } : undefined); window.STRYKER_VELA.context().stateChanged(); }, [type, inputs || null]);
const notes = (p) => p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.inspect().indicators.map((x) => ({ t: x.title, msg: JSON.stringify(x.tables || '').slice(0, 160) })));
const view = (p, n, padMin) => p.evaluate(([n, pad]) => { const c = window.STRYKER_VELA.context().cells[0].chart, rb = c.orchestrator.rawBars, k = rb.length; c.setVisibleRange({ from: rb[Math.max(0, k - n)].time, to: rb[k - 1].time + pad * 60000 }); }, [n, padMin]);
const dom = async (p) => { let d = null; for (let i = 0; i < 60; i++) { d = await p.evaluate(() => window.__stkFlow.domDebug && window.__stkFlow.domDebug()); if (d && d.cells > 0 && d.depthBars > 0 && d.samples > 10) break; await sleep(1000); } return d; };

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const S of SYMS) {
      const T = S.sym.toUpperCase();
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900, sym: S.sym, mock: S.mock });
      const nb = await p.evaluate(() => window.STRYKER_VELA.chart.orchestrator.rawBars.length);
      check(nb > 50, T + ': candles (' + nb + ')', nb);
      const pk = await pickFootprint(p);
      check(pk.ok && pk.style === 'stk_fp', T + ': Footprint chart type', pk);
      let st = null;
      for (let i = 0; i < 45; i++) { st = await fp(p); if (st && st.status === 'live' && st.minutes >= 1 && st.tick > 0) break; await sleep(1000); }
      check(st && st.status === 'live' && st.tick > 0, T + ': trade feed live (' + (st && st.status) + ', ' + (st && st.minutes) + ' min, row ' + (st && st.tick) + ')', st);
      await view(p, 14, 1);
      let n = 0; const t1 = Date.now();
      while (Date.now() - t1 < 15000) { n = await cells(p); if (n > 1500) break; await sleep(500); }
      check(n > 1500, T + ': footprint cells drawn (' + n + ' px samples)', n);
      await sleep(4000); const st2 = await fp(p);
      const deltas = st2 ? st2.vols.filter((v) => v[3] > 0) : [];
      check(deltas.length && deltas.every((v) => Math.abs(v[2]) <= v[1] + 1e-9), T + ': per-minute delta within +-volume (' + deltas.length + ' minutes)', deltas.slice(-3));
      check(deltas.some((v) => Math.abs(v[2]) < v[1] - 1e-9), T + ': both buy and sell volume seen (side mapped)', deltas.slice(-3));
      await add(p, 'stk_of_delta'); await add(p, 'stk_of_cvd'); await add(p, 'stk_of_big');
      await add(p, 'stk_crypto_dom', { style: 'Combined (heatmap + depth + walls)' });
      await sleep(3000);
      const of = (await notes(p)).filter((x) => /Delta|CVD|Cumulative|Big/i.test(x.t));
      check(of.length >= 3 && of.every((x) => !/unavailable|Needs|needs a crypto|only/i.test(x.msg)), T + ': Delta + CVD + Big Trades, no blocking note', of);
      await view(p, 10, 4);
      const d = await dom(p);
      check(d && d.cells > 0 && d.depthBars > 0, T + ': Crypto DOM heatmap draws cells + depth bars (' + (d && d.cells) + ' cells, ' + (d && d.depthBars) + ' bars, ' + (d && d.samples) + ' samples)', d);
      await p.screenshot({ path: OUT + '/of-' + S.tag + '-1440.png' });
      check(errors.length === 0, T + ': no console errors', errors);
      await ctx.close();
      if (!S.shots || !SHOTS) continue;
      for (const [w, h, theme, tg] of [[390, 844, 'dark', '390-dark'], [1440, 900, 'dark', '1440-dark'], [1440, 900, 'day', '1440-light']]) {
        const mobile = w < 500;
        const o = await open(b, { w, h, mobile, theme, sym: S.sym });
        await pickFootprint(o.p);
        await add(o.p, 'stk_crypto_dom', { style: 'Combined (heatmap + depth + walls)' });
        for (let i = 0; i < 45; i++) { const s = await fp(o.p); if (s && s.status === 'live' && s.minutes >= 1) break; await sleep(1000); }
        await sleep(15000);   // let the heatmap gather some columns
        await view(o.p, mobile ? 5 : 12, mobile ? 2 : 4);
        const dd = await dom(o.p);
        check(dd && dd.cells > 0, T + ' ' + tg + ': heatmap + footprint drawn (' + (dd && dd.cells) + ' cells)', dd);
        if (mobile) check(await o.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), T + ' ' + tg + ': no horizontal scroll');
        await sleep(1500);
        await o.p.screenshot({ path: SHOTS + '/M-' + S.tag + '-of-' + tg + '.png' });
        await o.ctx.close();
      }
    }
    if (!ONLY || ONLY.includes('bybit')) {   // Bybit refused (403): a clear message, not a blank chart
      for (const [w, h, mobile, tg] of [[1440, 900, false, '1440'], [390, 844, true, '390']]) {
        const { ctx, p } = await open(b, { w, h, mobile, sym: 'bybit:BTCUSDT.P', block: true });
        let r = null;
        for (let i = 0; i < 30; i++) { r = await p.evaluate(() => { const n = document.querySelector('#vela-chart .stkc-venue-note'); const dot = document.querySelector('#vela-chart .stkc-dd'); return { note: n && n.offsetParent !== null ? n.textContent : '', dot: dot ? dot.dataset.tip : '' }; }); if (r.note) break; await sleep(500); }
        check(r && /Bybit isn't available in your region/.test(r.note), 'BYBIT 403 ' + tg + ': note on the chart', r);
        check(r && /isn't available in your region/.test(r.dot), 'BYBIT 403 ' + tg + ': data dot says not available', r);
        await p.screenshot({ path: OUT + '/bybit-blocked-' + tg + '.png' });
        if (SHOTS) await p.screenshot({ path: SHOTS + '/M-bybit-blocked-' + tg + '-dark.png' });
        await ctx.close();
      }
    }
  } finally { await b.close(); }
  console.log(pass + ' PASS, ' + fail + ' FAIL');
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
