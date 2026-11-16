// Delta bars (L2) empty while CME is closed (member GK 2026-11-14, msg 1571034091573346387). The Delta (L2) panel got its trades only from
// the live stores, so a closed market / failed read left it empty while the footprint (recorder) had numbers. Now the recorder fills the gaps.
//   node tools/tests/chart-dev-server.mjs 8153 &  ;  CHART_BASE=http://127.0.0.1:8153 flock /tmp/stryker-chrome.lock node tools/tests/delta-l2-closed-browser.js <shotsDir>
// (adapted from fp-l2-loading-browser.js) Footprint (L2) "Loading order flow…" never clears (member GK 2026-11-14 09:15 IST, Saturday, CME closed). FIXTURE data only.
//   node tools/tests/chart-dev-server.mjs 8153 &
//   CHART_BASE=http://127.0.0.1:8153 flock /tmp/stryker-chrome.lock node tools/tests/fp-l2-loading-browser.js <shotsDir>
// Cases (NQ1! 1m, Volume footprint chart style, Data = L2):
//   closed  the hub's 3 h read (/ts-aux) has no minutes and no trades arrive: the label must not say "Loading" after the read; the
//           footprint shows the recorder's trades (L1) for the bars it has, with a plain note; live trades later switch it back to L2.
//   fail    /ts-aux answers 500 (twice): a plain "did not load, retrying" note, then the next read succeeds and the footprint draws.
//   hang    /ts-aux never answers: the read times out and the label stops saying "Loading".
// SHOTS=1 also takes the before/after screenshots at 1440 dark / light and 390 dark.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

const MIN = Math.floor(Date.now() / 60000), N = 240, TICK = 0.25, NMIN = 40;
const price = (m) => 28650 + Math.sin((m - MIN) / 17) * 40 + Math.sin((m - MIN) / 5) * 9;
const BARS = [];
for (let m = MIN - N; m < MIN; m++) {
  const o = Math.round(price(m) / TICK) * TICK, c = Math.round(price(m + 1) / TICK) * TICK;
  BARS.push([m * 60, o, Math.max(o, c) + 3, Math.min(o, c) - 3, c, 400 + (m % 7) * 30]);
}
// /orderflow fixture (the L1 recorder format, chart-footprint-data.js decodeOrderflow): one minute per fixture candle
const uv = (n) => { const o = []; do { let x = n % 128; n = Math.floor(n / 128); o.push(n ? x + 128 : x); } while (n); return o; };
const sv = (n) => uv(n < 0 ? -2 * n - 1 : 2 * n);
function orderflowBody() {
  const mins = BARS.slice(-NMIN).map((r) => {
    const lo = Math.round(r[3] / TICK), hi = Math.round(r[2] / TICK), n = hi - lo + 1, o = Math.round(r[1] / TICK) - lo, c = Math.round(r[4] / TICK) - lo, body = [];
    body.push(...uv(r[0] / 60), ...sv(lo), ...uv(n), ...uv(o), ...uv(c));
    for (let j = 0; j < n; j++) body.push(...uv(3 + ((j * 5) % 23)), ...uv(2 + ((j * 7) % 19)));
    body.push(...sv(10), ...sv(-10), ...uv(50), ...uv(0));
    return [...uv(body.length), ...body];
  });
  const hdr = Buffer.from(JSON.stringify({ tick: TICK, thr: 50 }));
  return Buffer.from([0x4f, 0x46, 0x31, 0x0a, ...uv(hdr.length), ...hdr, ...uv(mins.length), ...mins.flat()]);
}
// /ts-aux fixture with footprint minutes for the last 30 bars
function auxBody() {
  const fp = BARS.slice(-30).map((r) => ({ t: r[0] / 60, lv: Array.from({ length: 13 }, (_, j) => [r[3] + j * 0.5, 4 + ((j * 3) % 11), 3 + ((j * 5) % 9)]) }));
  return JSON.stringify({ fp, imb: [] });
}

// the hub socket: market closed (status idle, book frames but NO trades) until window.__sendTicks is set
function fakeWs() {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage({ data: JSON.stringify({ event: 'hub_attached', state: 'idle', tier: 'book' }) }); }, 50);
    let n = 0;
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage) return; n++;
      const now = Date.now(), b = Math.floor((window.__L2MID || 28650) * 4) / 4, bids = [], asks = [];
      for (let i = 0; i < 12; i++) { bids.push([b - i * 0.25, 10 + ((i * 7 + n) % 30)]); asks.push([b + 0.25 + i * 0.25, 10 + ((i * 5 + n) % 30)]); }
      ws.onmessage({ data: JSON.stringify({ type: 'snap', symbol: 'NQ', ts: now, bids, asks, imb: 0, imb10: 0 }) });
      if (window.__sendTicks) ws.onmessage({ data: JSON.stringify({ type: 'ticks', symbol: 'NQ', t: [[b, 3, -1, now], [b + 0.25, 2, 1, now]] }) });
    }, 200);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
async function open(b, { w, h, mobile, theme, aux }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile, colorScheme: theme === 'light' ? 'light' : 'dark' });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs);
  if (theme === 'light') await ctx.addInitScript(() => { try { localStorage.setItem('stryker_theme', 'day'); } catch (e) {} });
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); window.__stkL2SeedTimeoutMs = 4000; } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars: BARS }) }));
  const st = { aux: 0 };
  await ctx.route(/127\.0\.0\.1:9\//, (r) => {
    const u = r.request().url();
    if (/\/ts-aux/.test(u)) {
      st.aux++;
      if (aux === 'hang') return;   // never answers
      if (aux === 'fail' && st.aux <= 2) return r.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: '' });
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: aux === 'closed' ? JSON.stringify({ fp: [], imb: [] }) : auxBody() });
    }
    return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
  });
  const p = await ctx.newPage(), errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|\/api\/chart\/stream|Failed to load resource|Ping received after close/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
  return { ctx, p, errors, st };
}
const setSym = (p) => p.evaluate(async (mid) => {
  window.__L2MID = mid;
  const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1');
  for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === 'futures:NQ1!' && c.orchestrator.rawBars.length > 50) break; }
}, price(MIN));
const zoomTo = (p, n) => p.evaluate((n) => { const c = window.STRYKER_VELA.chart, rb = c.orchestrator.rawBars, k = rb.length; c.setVisibleRange({ from: rb[Math.max(0, k - n)].time, to: rb[k - 1].time + 120000 }); }, n);
// what the footprint layer draws from: the engine's flow for the chart's bars (same call as footprintLayer.paint)
const flow = (p) => p.evaluate(() => {
  const e = window.STRYKER_VELA.chart.orchestrator.typeEngines.get('stk_fp'), bars = window.STRYKER_VELA.chart.orchestrator.rawBars;
  if (!e) return null;
  const f = e.l2Flow(bars, 1);
  return f ? { l2: f.src !== 'l1', note: f.note || '', n: f.map ? f.map.size : -1 } : { l2: false, note: '(trades feed)', n: -1 };
});
const waitNote = async (p, fn, ms) => { const t0 = Date.now(); let f; while (Date.now() - t0 < ms) { f = await flow(p); if (fn(f)) return f; await sleep(500); } return f; };

const add = (p, type) => p.evaluate((t) => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator(t, { inputs: {} }); window.STRYKER_VELA.context().stateChanged(); }, type);
const nOf = (p) => p.evaluate(() => (window.__stkL2Flow && window.__stkL2Flow.stk_l2f_delta && window.__stkL2Flow.stk_l2f_delta.n) || 0);
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const views = process.env.SHOTS ? [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [390, 844, true, 'dark']] : [[1440, 900, false, 'dark']];
    for (const [w, h, mobile, theme] of views) {
      const tag = w + '-' + theme;
      const { ctx, p, errors } = await open(b, { w, h, mobile, theme, aux: 'closed' });
      await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: orderflowBody() }));
      await setSym(p);
      await add(p, 'stk_l2f_delta');
      await sleep(1000); await zoomTo(p, mobile ? 20 : 40);
      if (process.env.DBG) console.log(JSON.stringify(await p.evaluate(() => ({ ind: window.STRYKER_VELA.context().cells[0].chart.indicators().map((h) => h.nativeType), err: window.__l2fErr, fp: window.__fpd, fl: window.__stkL2Flow, fpd: window.__fpd })))); const t0 = Date.now(); let n = 0; while (Date.now() - t0 < 25000 && n < 10) { await sleep(700); n = await nOf(p); }
      check(n >= 10, tag + ': market closed, empty live stores: Delta (L2) still has bars from the recorder (' + n + ')', n);
      await sleep(800); if (process.env.DBG) console.log(JSON.stringify(await p.evaluate(() => ({ ind: window.STRYKER_VELA.context().cells[0].chart.indicators().map((h) => h.nativeType), err: window.__l2fErr, fp: window.__fpd, fl: window.__stkL2Flow, fpd: window.__fpd }))));
      await p.screenshot({ path: OUT + '/delta-' + tag + '.png' });
      check(errors.length === 0, tag + ': no page errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
