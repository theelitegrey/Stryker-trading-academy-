// Crypto order flow on Hyperliquid (assets/orderflow-venue-hyperliquid.js through assets/orderflow-venues.js):
//   flock /tmp/stryker-chrome.lock tools/ci-browser.sh chart-orderflow-hyperliquid-browser.js
// Talks to the REAL public Hyperliquid WebSocket (wss://api.hyperliquid.xyz/ws, no key). SHOTS=dir also writes the
// design shots (390 / 412 / 1440 dark, 1440 light). Checks on HYPERLIQUID:BTC 1m:
//   footprint chart type draws cells and its feed goes live; Delta + CVD (trades) + Big Trades add with no error note;
//   Crypto DOM heatmap gets a book with bids below asks and draws cells; the last candle's close moves within 30 s
//   (tick boost); no console errors; 390 has no horizontal scroll.
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const SHOTS = process.env.SHOTS || '';
const SYM = 'hyperliquid:BTC';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined && !ok ? ' ' + JSON.stringify(extra).slice(0, 500) : '')); };

async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker.vela.session'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme || 'dark');
  await require('./binance-mock.js').install(ctx);   // the page opens on BINANCE:BTCUSDT first; offline Binance keeps geo-blocked hosts quiet
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource|status of|econ-calendar|CORS|Firestore|FirebaseError|offline/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkOrderflow && window.__stkFlow, null, { timeout: 60000 });
  await sleep(2000);
  await p.evaluate(async ([s]) => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === s && ws.chart.orchestrator.rawBars.length > 50) break; }
  }, [SYM]);
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
const zoom = (p, n) => p.evaluate((n) => { const c = window.STRYKER_VELA.chart, rb = c.orchestrator.rawBars, k = rb.length; c.setVisibleRange({ from: rb[k - n].time, to: rb[k - 1].time + 90000 }); }, n);
const fp = (p) => p.evaluate(() => { const o = window.__stkOrderflow; return o.crypto ? o.crypto() : null; });
const add = (p, type, inputs) => p.evaluate(([t, i]) => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator(t, i ? { inputs: i } : undefined); window.STRYKER_VELA.context().stateChanged(); }, [type, inputs || null]);
const notes = (p) => p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.inspect().indicators.map((x) => ({ t: x.title, msg: JSON.stringify(x.tables || '').slice(0, 160) })));
const lastClose = (p) => p.evaluate(() => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars; const l = rb[rb.length - 1]; return l ? [l.time, l.close] : null; });

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900 });
      // price moves (tick boost through the venue trade stream, or klines)
      const c0 = await lastClose(p); let moved = false; const t0 = Date.now();
      while (Date.now() - t0 < 30000) { const c1 = await lastClose(p); if (c1 && c0 && (c1[1] !== c0[1] || c1[0] !== c0[0])) { moved = true; break; } await sleep(500); }
      check(moved, '1440: HYPERLIQUID:BTC last price updates within 30 s (' + (Date.now() - t0) + ' ms)', c0);
      const pk = await pickFootprint(p);
      check(pk.ok && pk.style === 'stk_fp', '1440: "Footprint" picker row switches HYPERLIQUID:BTC to the Footprint chart type', pk);
      let st = null;
      for (let i = 0; i < 40; i++) { st = await fp(p); if (st && st.status === 'live' && st.minutes >= 1) break; await sleep(1000); }
      check(st && st.status === 'live', '1440: Hyperliquid trade feed live (' + (st && st.status) + ', ' + (st && st.minutes) + ' min, tick ' + (st && st.tick) + ')', st);
      await zoom(p, 14);
      let n = 0; const t1 = Date.now();
      while (Date.now() - t1 < 15000) { n = await cells(p); if (n > 1500) break; await sleep(500); }
      check(n > 1500, '1440: footprint cells drawn (' + n + ' px samples)', n);
      const v0 = st && st.lastVol; await sleep(8000); const st2 = await fp(p);
      check(st2 && (st2.lastVol > v0 || st2.lastT > st.lastT), '1440: forming minute volume grows (' + v0 + ' -> ' + (st2 && st2.lastVol) + ')', [st, st2]);
      const deltas = st2 ? st2.vols.filter((v) => v[3] > 0) : [];
      check(deltas.length && deltas.every((v) => Math.abs(v[2]) <= v[1] + 1e-9), '1440: per-minute delta within +-volume (' + deltas.length + ' minutes)', deltas.slice(-3));
      await add(p, 'stk_of_delta'); await add(p, 'stk_of_cvd'); await add(p, 'stk_of_big');
      await sleep(3000);
      const ind = await notes(p);
      const of = ind.filter((x) => /Delta|CVD|Cumulative|Big/i.test(x.t));
      check(of.length >= 3 && of.every((x) => !/unavailable|Needs|needs a crypto|only/i.test(x.msg)), '1440: Delta + CVD + Big Trades on Hyperliquid, no blocking note', of);
      await p.screenshot({ path: OUT + '/hl-fp-1440.png' });
      if (SHOTS) await p.screenshot({ path: SHOTS + '/A-hl-footprint-1440-dark.png' });
      check(errors.length === 0, '1440: no console errors (footprint)', errors);
      await ctx.close();
    }
    for (const [w, h, theme, tag] of [[1440, 900, 'dark', '1440-dark'], [1440, 900, 'day', '1440-light'], [390, 844, 'dark', '390-dark'], [412, 915, 'dark', '412-dark']]) {
      const mobile = w < 500;
      const { ctx, p, errors } = await open(b, { w, h, mobile, theme });
      await add(p, 'stk_crypto_dom', { style: 'Combined (heatmap + depth + walls)' });
      // a few bars plus empty space on the right (where the depth bars sit), like chart-crypto-dom-browser.js
      await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; const b = c.orchestrator.rawBars; c.setVisibleRange({ from: b[b.length - 4].time, to: b[b.length - 1].time + 4 * 60000 }); });
      let d = null;
      for (let i = 0; i < 70; i++) { d = await p.evaluate(() => window.__stkFlow.domDebug && window.__stkFlow.domDebug()); if (d && d.cells > 0 && d.samples > 20) break; await sleep(1000); }
      check(d && d.cells > 0 && d.depthBars > 0, tag + ': Crypto DOM heatmap on Hyperliquid draws cells + depth bars (' + (d && d.cells) + ' cells, ' + (d && d.depthBars) + ' bars, ' + (d && d.samples) + ' samples)', d);
      const fd = await p.evaluate(() => { const o = window.__stkFlow.domDebugBytes && window.__stkFlow.domDebugBytes(); return o || null; });
      if (tag === '1440-dark') check(fd && fd.samples > 0, '1440: book feed stores samples (' + (fd && fd.samples) + ')', fd);
      if (mobile) check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), tag + ': no horizontal scroll');
      await sleep(1500);
      await p.screenshot({ path: OUT + '/hl-dom-' + tag + '.png' });
      if (SHOTS) await p.screenshot({ path: SHOTS + '/A-hl-dom-' + tag + '.png' });
      check(errors.length === 0, tag + ': no console errors (DOM)', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
