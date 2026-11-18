// Depth Heatmap: the WHOLE recorded book is drawn on wide views, and the chart says where the recording starts
// (member GK 18 Nov, thread 1572517424065020025: "heatmap not loading properly", NQ1! 15m, heat only on the last ~day).
// Root cause: the graphics-card heatmap uploads one texture column per book sample into an 8192-column ring. 48 h of 5 s
// samples (~34 000) overflowed it, so only the newest 8192 (~11 h) were ever drawn. Fix: at most one column per pixel.
// FIXTURE data only (labelled sample data): 1m/5m/15m NQ bars + a fake /ts-book-history holding 48 h of 5 s samples.
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/heatmap-history-browser.js <shotsDir>
// Checks per timeframe (1, 5, 15) at 1440 dark + 15m at 390 dark and 1440 light: the heat starts at the left edge of the recorded
// book (within a few px), every sample window was read, the "Order book history starts ..." note sits at that edge, no errors.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 600) : '')); };

const NOW = Date.now(), KEEP = 48 * 3600000, FIRST = Math.ceil((NOW - KEEP + 20 * 60000) / 5000) * 5000, TICK = 0.25;
const price = (t) => 25600 + Math.sin(t / 6e6) * 60 + Math.sin(t / 7e5) * 12;
const TFS = { '1': 60, '5': 300, '15': 900 }, PAGE = { '1': 8 * 3600, '5': 2 * 86400, '15': 5 * 86400 };
function barsFor(tf, page) {   // sample data: 20 days of bars, every page the chart asks for
  const s = TFS[tf], p1 = page * PAGE[tf], p2 = (page + 1) * PAGE[tf], out = [];
  for (let t = p1; t < p2; t += s) {
    if (t * 1000 > NOW || t * 1000 < NOW - 20 * 864e5) continue;
    const o = Math.round(price(t * 1000) / TICK) * TICK, c = Math.round(price((t + s) * 1000) / TICK) * TICK;
    out.push([t, o, Math.max(o, c) + 3, Math.min(o, c) - 3, c, 400]);
  }
  return out;
}
function fakeWs() {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    const send = (o) => ws.onmessage && ws.onmessage({ data: JSON.stringify(o) });
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); send({ event: 'status', state: 'live' }); }, 50);
    let n = 0;
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1) return; n++;
      const now = Date.now(), b = Math.round((25600 + Math.sin(now / 6e6) * 60 + Math.sin(now / 7e5) * 12) * 4) / 4, bids = [], asks = [];
      for (let i = 0; i < 12; i++) { bids.push([b - i * 0.25, 10 + ((i * 7 + n) % 30)]); asks.push([b + 0.25 + i * 0.25, 10 + ((i * 5 + n) % 30)]); }
      send({ type: 'snap', symbol: 'NQ', ts: now, bids, asks, imb: 0, imb10: 0 });
      send({ type: 'ticks', symbol: 'NQ', t: [[b, 3, -1, now], [b + 0.25, 2, 1, now]] });
    }, 1000);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile, colorScheme: theme });
  await ctx.addInitScript(stub); await ctx.addInitScript(fakeWs);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => {
    const u = new URL(r.request().url()), tf = u.searchParams.get('tf') || '1', pg = u.searchParams.get('page');
    const page = pg == null ? Math.floor(NOW / 1000 / PAGE[tf]) : Number(pg);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf, page, bars: TFS[tf] ? barsFor(tf, page) : [] }) });
  });
  const reads = [];
  await ctx.route(/127\.0\.0\.1:9\/ts-book-history/, async (r) => {
    const { encodeSamples } = await import('../../workers/book-recorder/src/bucket.js');
    const u = new URL(r.request().url()), from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to')), out = [];
    reads.push([from, to]);
    for (let t = Math.ceil(Math.max(from, FIRST) / 5000) * 5000; t <= Math.min(to, NOW); t += 5000) {
      const mid = price(t), step = 2.5, i0 = Math.floor(mid * 0.99 / step), len = Math.ceil(mid * 0.02 / step), v = new Float32Array(len);
      for (let k = 0; k < len; k++) { const p = (i0 + k + 0.5) * step, d = Math.abs(p - mid), hh = Math.abs(Math.sin((i0 + k) * 12.9898) * 43758.5453) % 1; const q = Math.exp(1 + 2.2 * hh * hh) * (1 + Math.exp(-d / 80)) + (Math.abs(p - 25640) < 2 ? 900 : 0); v[k] = p < mid ? q : -q; }
      out.push({ ts: t, mid, bb: mid - 0.25, ba: mid + 0.25, step, i0, v });
    }
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'x-ts-fill-left': '0', 'access-control-expose-headers': 'x-ts-fill-left' }, body: Buffer.from(encodeSamples(out)) });
  });
  await ctx.route(/127\.0\.0\.1:9\/(?!ts-book-history)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage(), errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|\/api\/chart\/stream|Failed to load resource|Ping received after close/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
  return { ctx, p, errors, reads };
}
const setTf = (p, tf) => p.evaluate(async (tf) => {
  const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe(tf);
  for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 300)); const o = ws.chart.orchestrator; if (ws.chart.market.symbol === 'futures:NQ1!' && String(o.config.market.timeframe) === tf && o.rawBars.length > 50 && !o.switchingMarket) break; }
}, tf);
// view: the last 3 days (more than the recorder keeps), so the recording's start is inside the chart
const show3d = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.chart, t = Date.now(); c.setVisibleRange({ from: t - 3 * 864e5, to: t + 2 * 3600000 }); });
const dbg = (p) => p.evaluate(() => window.__stkFlow.dhDebug && window.__stkFlow.dhDebug());
const xOf = (p, t) => p.evaluate((t) => { const c = window.STRYKER_VELA.chart, r = c.renderer && (c.renderer.renderer || c.renderer); try { return r.coords ? r.coords().timeToX(t) : null; } catch (e) { return null; } }, t);

(async () => {
  const b = await launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=768'] });
  try {
    const RUNS = [['1', 1440, 900, false, 'dark'], ['5', 1440, 900, false, 'dark'], ['15', 1440, 900, false, 'dark'], ['15', 390, 844, true, 'dark'], ['15', 1440, 900, false, 'light']];
    for (const [tf, w, h, mobile, theme] of (process.env.ONLY ? RUNS.filter((r, i) => String(i) === process.env.ONLY) : RUNS)) {
      const tag = tf + 'm-' + w + '-' + theme;
      const { ctx, p, errors, reads } = await open(b, { w, h, mobile, theme });
      await setTf(p, tf);
      await p.evaluate(() => { window.STRYKER_VELA.chart.addNativeIndicator('stk_depth_heat'); window.STRYKER_VELA.context().stateChanged(); });
      await sleep(1500); await show3d(p);
      // the 48 h are read in 6 h windows, one a second at most: wait until the oldest window is in
      let d = null;
      for (let i = 0; i < 40; i++) { await sleep(1000); d = await dbg(p); if (d && d.visFrom > NOW - 3600000) { await show3d(p); continue; }   // 1m: a range set before the bars landed collapses to the last minute
        if (d && d.visFrom && (d.visFrom >= FIRST ? reads.some(([f]) => f <= d.visFrom + 60000) && d.heat && d.heat.columns > 50 && !(d.histStart && /Loading/.test(d.histStart.msg)) : d.histStart && !/Loading/.test(d.histStart.msg) && reads.some(([f]) => f <= FIRST))) break; }
      d = await dbg(p);
      const firstRead = Math.min(...reads.map((x) => x[0]));
      const edgeIn = d && d.visFrom < FIRST;   // 15m shows 3 days: the recording's start is on screen. 1m / 5m: the view starts inside the 48 h
      const want = edgeIn ? FIRST : d.visFrom;
      check(firstRead <= want + 60000, tag + ': every window the view needs was read (oldest read ' + (firstRead <= want + 60000 ? '<=' : '>') + ' ' + (edgeIn ? 'first sample' : 'view start') + ')', { firstRead, want, n: reads.length });
      check(d && d.heat && d.heat.gl, tag + ': graphics-card path', d && d.heat);
      check(d && d.heat && d.heat.columns > 50 && d.heat.columns < 8192, tag + ': columns drawn fit the ring (' + (d && d.heat && d.heat.columns) + ')', d && d.heat);
      const hs = d && d.histStart;
      if (edgeIn) {
        check(d.samples > 30000, tag + ': all 48 h of samples handed to the heatmap (' + d.samples + ')', d.samples);
        check(hs && Math.abs(hs.ts - FIRST) < 120000, tag + ': history start = the first recorded sample', { hs, FIRST });
        check(d.heat && hs && Math.abs(d.heat.xFirst - hs.x) <= 3, tag + ': heat starts at the recording edge (heat x ' + (d.heat && d.heat.xFirst) + ' vs edge ' + (hs && hs.x) + ')', { heat: d.heat, hs });
        check(hs && (mobile ? /^Book from / : /^Order book history starts /).test(hs.msg), tag + ': note "' + (hs && hs.msg) + '"', hs);
        if (hs) { const [px, py, pw, ph] = hs.pill; check(px >= hs.x && px + pw <= w && py > 0, tag + ': note pill right of the edge, inside the chart', hs.pill); }
      } else {
        check(d.heat && d.heat.xFirst <= 2, tag + ': heat fills the view from its left edge (x ' + (d.heat && d.heat.xFirst) + ')', d.heat);
        check(!hs, tag + ': no history note while the whole view is recorded', hs);
      }
      await p.screenshot({ path: OUT + '/hm-hist-' + tag + '.png' });
      check(errors.length === 0, tag + ': no console errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
