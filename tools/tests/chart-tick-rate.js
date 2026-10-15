// Live candle update rate (Owner 2026-10-14: "if we are getting tick data, why are the candles not
// moving fast?"). Opens /charts, sets each symbol x tf, then for SECS seconds counts:
//   wsMsgs   = 'bar' messages on /api/chart/stream sockets (what the server sends)
//   onBar    = bars handed to the chart (wraps every provider subscribe callback)
//   polls    = /api/chart/bars requests (fallback polling)
//   changes  = rAF samples where the chart's last bar (close/high/low/volume) differs from the previous frame
//   paints   = frames in which the main chart canvas was drawn
//   CHART_BASE=https://tradezoro.com SECS=60 CASES=futures:NQ1!@1,futures:NQ1!@5 node tools/tests/chart-tick-rate.js
// Run under flock /tmp/stryker-chrome.lock.
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'https://tradezoro.com';
const SECS = Number(process.env.SECS || 60);
const CASES = (process.env.CASES || 'futures:NQ1!@1,futures:NQ1!@5,futures:NQ1!@60,binance:BTCUSDT@1').split(',').map((c) => c.split('@'));
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    const S = window.__tk = { ws: 0, wsUrls: [], onBar: 0, paints: 0, opens: 0, closes: [] };
    const OW = window.WebSocket;
    window.WebSocket = function (url, p) {
      const s = p ? new OW(url, p) : new OW(url);
      if (String(url).includes('/api/chart/stream')) {
        S.wsUrls.push(String(url).replace(/^.*\/stream\//, '')); S.opens++;
        s.addEventListener('message', (e) => { if (String(e.data).includes('"bar"')) S.ws++; });
        s.addEventListener('close', (e) => S.closes.push(e.code + ' ' + Math.round(performance.now() / 1000) + 's'));
      }
      return s;
    };
    window.WebSocket.prototype = OW.prototype;
    Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    const of = CanvasRenderingContext2D.prototype.fillRect;
    let frameMark = -1;
    CanvasRenderingContext2D.prototype.fillRect = function (...a) {
      const c = this.canvas;
      if (c && c.width > 600 && c.height > 300) { const f = window.__frameNo | 0; if (f !== frameMark) { frameMark = f; S.paints++; } }
      return of.apply(this, a);
    };
    const tickF = () => { window.__frameNo = (window.__frameNo | 0) + 1; requestAnimationFrame(tickF); };
    requestAnimationFrame(tickF);
  });
  const p = await ctx.newPage();
  await p.goto(BASE + (BASE.includes('localhost') ? '/charts.html' : '/charts'), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_VELA.chart.orchestrator.rawBars.length > 0, null, { timeout: 60000 });
  // count bars handed to the chart: wrap subscribe on every provider the workspace built
  await p.evaluate(() => {
    const S = window.__tk;
    const seen = new WeakSet();
    const wrap = (prov) => {
      if (!prov || seen.has(prov) || typeof prov.subscribe !== 'function') return; seen.add(prov);
      const o = prov.subscribe.bind(prov);
      prov.subscribe = (t, tf, cb, ...r) => o(t, tf, (bar) => { S.onBar++; return cb(bar); }, ...r);
    };
    window.__wrapProv = () => { try { const d = window.STRYKER_VELA.chart.data; const ps = d.providers || d._providers || d.registry; if (ps && ps.forEach) ps.forEach((v) => wrap(v)); else if (ps) Object.values(ps).forEach(wrap); } catch (e) {} };
    window.__wrapProv();
  });
  for (const [sym, tf] of CASES) {
    await p.evaluate(([s, tf]) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe(tf); }, [sym, tf]);
    await p.waitForTimeout(8000);
    const r = await p.evaluate(async (secs) => {
      const S = window.__tk; window.__wrapProv();
      const chart = window.STRYKER_VELA.chart;
      const z = { ws: S.ws, onBar: S.onBar, paints: S.paints, opens: S.opens };
      const res0 = performance.getEntriesByType('resource').length;
      let changes = 0, prev = '', t0 = performance.now(), gaps = [], lastChange = t0;
      while (performance.now() - t0 < secs * 1000) {
        await new Promise((r) => requestAnimationFrame(r));
        const raw = chart.orchestrator.rawBars; const lb = raw[raw.length - 1];
        const k = lb ? lb.time + '|' + lb.close + '|' + lb.high + '|' + lb.low + '|' + lb.volume : '';
        if (k !== prev) { if (prev) { changes++; gaps.push(performance.now() - lastChange); lastChange = performance.now(); } prev = k; }
      }
      const polls = performance.getEntriesByType('resource').slice(res0).filter((e) => e.name.includes('/api/chart/bars/')).length;
      gaps.sort((a, b) => a - b);
      return { ws: S.ws - z.ws, onBar: S.onBar - z.onBar, paints: S.paints - z.paints, opens: S.opens - z.opens, polls, changes,
        maxGap: Math.round(gaps[gaps.length - 1] || 0), medGap: Math.round(gaps[gaps.length >> 1] || 0), urls: S.wsUrls.slice(-3), closes: S.closes.slice(-3), market: chart.market.symbol + ' ' + chart.market.timeframe };
    }, SECS);
    const per = (n) => (n / SECS).toFixed(2);
    console.log(`${sym}@${tf}: server ws bars ${per(r.ws)}/s | onBar ${per(r.onBar)}/s | last-bar changes ${per(r.changes)}/s (median gap ${r.medGap} ms, max ${r.maxGap} ms) | chart paints ${per(r.paints)}/s | polls ${r.polls} | new sockets ${r.opens} ${JSON.stringify(r.urls)} closes ${JSON.stringify(r.closes)} [${r.market}]`);
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
