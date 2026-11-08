// LAYOUT-PERF Part 2: indicator-load timings on the Charts page, phone profile (390x844, CPU 4x slower, Fast 4G-ish).
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/chart-indicator-perf.js [runs] [out.json]
// Real market data (Binance BTCUSDT 5m candles + trades, GEX API). Firebase is the rich stub (a Pro/Elite member).
// Measures (performance.now ms in the page):
//   first-candle   page start -> stk:first-candles mark
//   add:<name>     click "add" (addNativeIndicator / built-in Pine add) -> the indicator's first non-empty model/draw
//   heavy-open     applying a ~10-indicator layout -> every indicator drawn
// "Drawn" = the registry record has a model with points/boxes/lines/labels, or a renderer layer of its type painted.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const RUNS = +(process.argv[2] || 2);
const OUTF = process.argv[3] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [name, type, symbol]: order flow on BTC (exchange trades), GEX tools on NQ futures (options data for NQ)
const NATIVES = [
  ['Cumulative Delta (trades)', 'stk_of_cvd', 'binance:BTCUSDT'],
  ['Big Trades', 'stk_of_big', 'binance:BTCUSDT'],
  ['Zoro Levels (GEX Levels)', 'stk_gex', 'futures:NQ1!'],
  ['GEX Heatmap', 'stk_gexheat', 'futures:NQ1!'],
];
const PINE = [['FVG Relay (ICT structure, Pine)', 'fvg-relay-stryker', 'binance:BTCUSDT']];

async function page(b) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8 * 4, uploadThroughput: 750 * 1024 / 8 });
  p.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 160)));
  return { ctx, p };
}
const DRAWN = `(() => {
  window.__drawn = (pred) => {
    try {
      const c = window.STRYKER_VELA.chart, recs = c.orchestrator.registry.all();
      return recs.filter(pred).some((r) => {
        const m = r.model; if (!m) return false;
        const n = (a) => (Array.isArray(a) ? a.length : 0);
        const pts = (m.series || []).reduce((s, x) => s + (x && x.points ? x.points.filter((p) => p && p.value != null).length : 0), 0);
        return pts + n(m.boxes) + n(m.lines) + n(m.labels) + n(m.polylines) + n(m.tables) + n(m.fills) > 0 || (m.custom && Object.keys(m.custom).length > 0);
      });
    } catch (e) { return false; }
  };
})()`;

async function boot(p, state) {
  await p.addInitScript((st) => { try { localStorage.setItem('stryker.vela.session', ''); for (const k of ['vela-workspace', 'vela-workspace-090']) { if (st) localStorage.setItem(k, st); else localStorage.removeItem(k); } } catch (e) {} }, state || null);
  const t0 = Date.now();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkFirstCandles && window.STRYKER_VELA, null, { timeout: 120000 });
  const fc = await p.evaluate(() => { const m = performance.getEntriesByName('stk:first-candles')[0]; return m ? Math.round(m.startTime) : null; });
  await p.evaluate(DRAWN);
  return { firstCandle: fc, wall: Date.now() - t0 };
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const res = { firstCandle: [], heavyReady: [], add: {}, heavyOpen: [], heavyOpenAll: [] };
  try {
    for (let run = 0; run < RUNS; run++) {
      // --- fresh page: first candle, then add each indicator on its own page state
      for (const [name, type, sym] of NATIVES.concat(PINE.map(([n, id, s]) => [n, 'pine:' + id, s]))) {
        const { ctx, p } = await page(b);
        const bt = await boot(p);
        if (name === NATIVES[0][0]) res.firstCandle.push(bt.firstCandle);
        await p.evaluate(async (sym) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(sym); ws.active.setTimeframe('5'); for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 200)); if (ws.chart.orchestrator.rawBars.length > 100 && ws.chart.market.symbol === sym) break; } }, sym);
        await sleep(1500);
        const r = await p.evaluate(async (t) => {
          const t0 = performance.now();
          const c = window.STRYKER_VELA.chart;
          if (window.__stkHeavyNow) window.__stkHeavyNow();   // what opening the Indicators window does (after the fix)
          try { window.STRYKER_PINE.warm && window.STRYKER_PINE.warm(); } catch (e) {}   // worst case: the pick lands the moment the window opens
          if (!window.__stkHeavyReady) await new Promise((r) => window.addEventListener('stk:heavy-ready', r, { once: true }));
          const heavyWait = performance.now() - t0;
          let pred;
          if (t.startsWith('pine:')) {
            const v = document.querySelector('script[src*="chart-templates.js"]').src.split('v=')[1];
            const { builtinSource } = await import('/assets/chart-pine-builtins.js?v=' + v);
            const src = await builtinSource(t.slice(5));
            const before = new Set(c.orchestrator.registry.all().map((x) => x.id));
            window.STRYKER_PINE.addSource('x', src, { engine: 'next', builtin: true });
            pred = (x) => !before.has(x.id);
          } else {
            c.addNativeIndicator(t, {});
            pred = (x) => x.nativeType === t || (x.native && x.native.type === t) || (x.def && x.def.type === t) || x.type === t;
          }
          for (;;) { if (window.__drawn(pred)) break; if (performance.now() - t0 > 60000) return { ms: -1, heavyWait }; await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); }
          await new Promise((r) => requestAnimationFrame(r));
          return { ms: Math.round(performance.now() - t0), heavyWait: Math.round(heavyWait) };
        }, type);
        (res.add[name] = res.add[name] || []).push(r);
        console.log('run', run, name, JSON.stringify(r));
        await ctx.close();
      }
      // --- heavy layout: ~10 indicators in the saved session, page load -> all drawn
      {
        const v = '913';
        const st = { version: 1, layout: '1', charts: [{ id: 'A', symbol: 'binance:BTCUSDT', provider: 'binance', timeframe: '5', indicators: { natives: ['volume', 'stk_of_cvd', 'stk_of_big', 'stk_of_vp', 'stk_svp', 'ema', 'vwap', 'rsi', 'macd'], manifest: [] },
          ext: { 'stryker.pine': [{ name: 'FVG Relay [TradeZoro]', builtin: 'fvg-relay-stryker', inputs: {}, engine: 'next' }, { name: 'Liquidity Master [TradeZoro]', builtin: 'liquidity-master-tradezoro', inputs: {}, engine: 'next' }] } }] };
        void v;
        const { ctx, p } = await page(b);
        const bt = await boot(p, JSON.stringify(st));
        const r = await p.evaluate(async () => {
          const t0 = 0; void t0;
          const c = window.STRYKER_VELA.chart;
          for (;;) {
            const recs = c.orchestrator.registry.all().filter((x) => (x.nativeType || '') !== 'volume');
            const drawn = recs.filter((x) => window.__drawn((y) => y === x)).length;
            if (recs.length >= 10 && drawn >= recs.length) return { all: Math.round(performance.now()), n: recs.length, drawn };
            if (performance.now() > 120000) return { all: -1, n: recs.length, drawn, names: recs.map((x) => x.nativeType || x.title) };
            await new Promise((r) => setTimeout(r, 50));
          }
        });
        res.heavyOpen.push(Object.assign({ firstCandle: bt.firstCandle }, r));
        console.log('run', run, 'heavy layout', JSON.stringify(Object.assign({ firstCandle: bt.firstCandle }, r)));
        await ctx.close();
      }
    }
  } finally { await b.close(); }
  if (OUTF) fs.writeFileSync(OUTF, JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res));
})();
