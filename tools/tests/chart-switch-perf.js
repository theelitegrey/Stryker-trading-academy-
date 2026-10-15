// Charts symbol-switch timing (Owner order 2026-10-14: "switching symbols takes 3-5 s, need < 1 s").
//   CHART_BASE=https://tradezoro.com node tools/tests/chart-switch-perf.js [--member] [--fast4g] [--json out.json]
// Run under flock /tmp/stryker-chrome.lock (one Chrome at a time on the 4 GB server).
// For each timeframe (1m, 5m, 1h) switches NQ1! -> ES1! -> GC1! -> BTCUSDT -> AAPL -> NQ1! (cold,
// then the same loop again = warm) and records per switch:
//   paint  = click -> the new symbol's candles are in the chart (rawBars of the new market, a frame drawn)
//   hist   = -> history settled (orchestrator.historyState no longer 'backfill')
//   idle   = -> no new network request and no long task for 400 ms (indicators / GEX / overlays done)
//   bars   = /api/chart/bars requests issued for the switch: count, max TTFB, total bytes
// AAPL is not a TradeZoro symbol: the row records what the chart does with it (no data provider).
const { launch } = require('./lib.js');
const fs = require('fs');
const BASE = process.env.CHART_BASE || 'https://tradezoro.com';
const MEMBER = process.argv.includes('--member');
const FAST4G = process.argv.includes('--fast4g');
const jsonOut = (() => { const i = process.argv.indexOf('--json'); return i > 0 ? process.argv[i + 1] : null; })();
const TFS = (process.env.TFS || '1,5,60').split(',');
const SYMS = ['futures:NQ1!', 'futures:ES1!', 'futures:GC1!', 'binance:BTCUSDT', 'AAPL', 'futures:NQ1!'];

(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  if (MEMBER) {
    await ctx.addInitScript(require('./richstub.js'));
    await ctx.route(/www\.gstatic\.com\/firebasejs|firestore\.googleapis|identitytoolkit|securetoken/, (r) => r.abort());
  }
  await ctx.addInitScript(() => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
    window.__lt = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  if (FAST4G) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 165, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  // response headers of the bars API (edge cache status) by URL
  const hdr = new Map();
  p.on('response', (r) => { if (r.url().includes('/api/chart/bars/')) hdr.set(r.url(), { cf: r.headers()['cf-cache-status'] || '', xc: r.headers()['x-bars-cache'] || '', cc: r.headers()['cache-control'] || '' }); });
  const tLoad = Date.now();
  await p.goto(BASE + (BASE.includes('localhost') || BASE.includes('127.0.0.1') ? '/charts.html' : '/charts'), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_VELA.chart.orchestrator.rawBars.length > 0, null, { timeout: 60000 });
  const firstChart = Date.now() - tLoad;
  await p.waitForTimeout(4000);

  const rows = [];
  for (const tf of TFS) {
    await p.evaluate(async (tf) => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe(tf); }, tf);
    await p.waitForTimeout(3000);
    for (const pass of ['cold', 'warm']) {
      for (const sym of SYMS.slice(1)) {
        const r = await p.evaluate(async ([sym, tf]) => {
          const ws = window.STRYKER_VELA;
          const chart = ws.chart;
          const before = performance.getEntriesByType('resource').length;
          const lt0 = window.__lt.length;
          const prevKey = chart.market.symbol + '|' + chart.market.timeframe;
          const prevLast = chart.orchestrator.rawBars.length ? chart.orchestrator.rawBars[chart.orchestrator.rawBars.length - 1] : null;
          const t0 = performance.now();
          ws.active.setSymbol(sym);
          let paint = null, hist = null, idle = null;
          let lastAct = performance.now(), nRes = before, nLt = lt0;
          const deadline = t0 + 15000;
          while (performance.now() < deadline) {
            await new Promise((r) => requestAnimationFrame(r));
            const now = performance.now();
            const m = chart.market, o = chart.orchestrator;
            const raw = o.rawBars;
            const same = String(m.symbol).toUpperCase() === String(sym).toUpperCase() || (m.symbol + '|' + m.timeframe) !== prevKey;
            if (paint == null && same && raw.length && raw[raw.length - 1] !== prevLast) paint = now - t0;
            if (paint != null && hist == null && o.historyState !== 'backfill') hist = now - t0;
            const nr = performance.getEntriesByType('resource').length;
            if (nr !== nRes || window.__lt.length !== nLt) { nRes = nr; nLt = window.__lt.length; lastAct = now; }
            if (paint != null && hist != null && now - lastAct > 400) { idle = lastAct - t0; break; }
          }
          const res = performance.getEntriesByType('resource').slice(before).filter((e) => e.startTime >= t0 - 5);
          const bars = res.filter((e) => e.name.includes('/api/chart/bars/') || /binance|coinbase|hyperliquid/.test(e.name));
          const lts = window.__lt.slice(lt0);
          return {
            sym, tf, paint: paint && Math.round(paint), hist: hist && Math.round(hist), idle: idle && Math.round(idle),
            n: raw0(chart), state: chart.orchestrator.historyState, msym: chart.market.symbol,
            reqs: bars.map((e) => ({ u: e.name, ttfb: Math.round(e.responseStart - e.requestStart), dur: Math.round(e.duration), start: Math.round(e.startTime - t0), size: e.encodedBodySize, xfer: e.transferSize })),
            other: res.filter((e) => !bars.includes(e)).map((e) => e.name.replace(location.origin, '').slice(0, 90) + ' ' + Math.round(e.duration) + 'ms'),
            longTasks: lts.length, longMax: Math.round(Math.max(0, ...lts.map((x) => x[1]))), longSum: Math.round(lts.reduce((a, x) => a + x[1], 0))
          };
          function raw0(c) { return c.orchestrator.rawBars.length; }
        }, [sym, tf]);
        r.pass = pass;
        for (const q of r.reqs) { const h = hdr.get(q.u); if (h) Object.assign(q, h); }
        rows.push(r);
        const br = r.reqs.filter((q) => q.u.includes('/api/chart/bars/'));
        console.log(`${tf.padStart(2)} ${pass} ${sym.padEnd(16)} paint ${String(r.paint).padStart(5)} hist ${String(r.hist).padStart(5)} idle ${String(r.idle).padStart(5)} bars=${r.n} reqs=${r.reqs.length} maxTTFB=${Math.max(0, ...r.reqs.map((q) => q.ttfb))} bytes=${r.reqs.reduce((a, q) => a + (q.xfer || 0), 0)} lt=${r.longTasks}/${r.longSum}ms ${br.map((q) => (q.xc || q.cf || '-')).join(',')}`);
        await p.waitForTimeout(600);
      }
    }
  }
  const mem = await p.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  const out = { base: BASE, member: MEMBER, fast4g: FAST4G, at: new Date().toISOString(), firstChart, heapMB: mem, rows, errors: errors.slice(0, 30) };
  console.log('first chart', firstChart, 'ms; heap', mem, 'MB; console errors', errors.length);
  errors.slice(0, 8).forEach((e) => console.log('  err', e));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
