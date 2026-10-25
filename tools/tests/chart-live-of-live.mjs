// LIVE check for the admin live order flow (a1), market hours, light use: ONE page, NQ 1m footprint, signed in with
// the demo/real-time account file (tools/demo-account/lib/browser.mjs; never printed), stk_live_of=1 in THIS browser
// only. Every `trades` message is timed on arrival (lag = arrival - newest print's exchange time), the forming
// footprint minute is sampled every second (screen lag = now - newest print time the footprint holds), and at the end
// window.tzLiveOfStats('NQ') compares the closed live minutes with the of_feeder record (drop/coalesce check).
//   flock /tmp/stryker-chrome.lock node tools/tests/chart-live-of-live.mjs <minutes> <outdir>
import fs from 'fs';
import { launch, login, BASE } from '../demo-account/lib/browser.mjs';
const MIN = Number(process.argv[2] || 15), OUT = process.argv[3] || '.';
const { b, ctx, page, errors } = await launch(1440, 900);
const out = { base: BASE, start: new Date().toISOString(), minutes: MIN };
const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
try {
  await ctx.addInitScript(() => {
    try { localStorage.setItem('stk_live_of', '1'); } catch (e) {}
    window.__ofLag = { msgs: 0, prints: 0, lags: [], gapsMs: [], last: 0, urls: [] };
    const W = window.WebSocket;
    window.WebSocket = function (u, p) {
      const ws = p ? new W(u, p) : new W(u);
      if (/\/api\/chart\/stream\//.test(String(u))) {
        window.__ofLag.urls.push(String(u).replace(/token=[^&]+/, 'token=*'));
        ws.addEventListener('message', (ev) => {
          let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (!m || m.event !== 'trades' || !Array.isArray(m.tr) || !m.tr.length) return;
          const L = window.__ofLag, now = Date.now(), newest = m.tr[m.tr.length - 1][0] * 1000;
          L.msgs++; L.prints += m.tr.length; L.lags.push(now - newest);
          if (L.last) L.gapsMs.push(now - L.last); L.last = now;
          if (L.lags.length > 20000) L.lags.shift();
        });
      }
      return ws;
    };
    window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  });
  await login(page);
  await page.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.__stkOrderflow, null, { timeout: 90000 });
  await page.evaluate(async () => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 30) break; }
    ws.active.setPriceStyle('stk_fp');
  });
  await page.waitForTimeout(5000);
  const screenLag = [], staleRec = [], ago = [];
  const end = Date.now() + MIN * 60000;
  while (Date.now() < end) {
    const s = await page.evaluate(() => {
      const O = window.__stkOrderflow, now = Date.now();
      const bs = O.minuteBars('NQ', now - 5 * 60000, now + 60000), l = bs[bs.length - 1];
      return { now, t: l ? l.t : 0, live: !!(l && l.live), trades: l ? l.trades : 0, agoMs: window.tzLiveOfStats ? window.tzLiveOfStats('NQ').lastPrintAgoMs : null };
    });
    // footprint minute lag: how far the newest footprint minute is behind the current minute (0 = forming minute)
    screenLag.push(Math.floor(s.now / 60000) - Math.floor(s.t / 60000));
    if (!s.live) staleRec.push(s.now);
    if (s.agoMs != null) ago.push(s.agoMs);
    await page.waitForTimeout(1000);
  }
  const L = await page.evaluate(() => ({ ...window.__ofLag, lags: window.__ofLag.lags, gapsMs: window.__ofLag.gapsMs }));
  const st = await page.evaluate(() => window.tzLiveOfStats('NQ'));
  const del = st && st.deliveries;
  out.end = new Date().toISOString();
  out.stream = { urls: L.urls, msgs: L.msgs, prints: L.prints, lagMs: { p50: pct(L.lags, 0.5), p90: pct(L.lags, 0.9), p99: pct(L.lags, 0.99), max: L.lags.length ? Math.max(...L.lags) : null },
    msgGapMs: { p50: pct(L.gapsMs, 0.5), p99: pct(L.gapsMs, 0.99), max: L.gapsMs.length ? Math.max(...L.gapsMs) : null } };
  out.footprint = { samples: screenLag.length, formingMinuteShare: Math.round(1000 * screenLag.filter((x) => x === 0).length / Math.max(1, screenLag.length)) / 10,
    maxMinutesBehind: Math.max(...screenLag), notLiveSamples: staleRec.length,
    newestPrintAgoMs: { p50: pct(ago, 0.5), p90: pct(ago, 0.9), max: ago.length ? Math.max(...ago) : null } };
  out.stats = st; out.deliveries = del; out.errors = errors.slice(0, 10);
  await page.screenshot({ path: OUT + '/live-of-live-1440.png' });
} finally {
  fs.writeFileSync(OUT + '/live-of-live.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, (k, v) => (k === 'rows' ? undefined : v), 1).slice(0, 4000));
  await b.close();
}
