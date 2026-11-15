// Depth Heatmap on any chart that has an order book (Owner 2026-11-15: "heatmap should work on any charts if it gets data for").
// FIXTURE data only: fake /ts-live hub socket for NQ, BTC book samples through the page's debug loader, a MOCKED member depth feed
// (window.__stkBookSources.futures, the slot a connected broker fills) for SI, and AAPL with no source. No Worker, no key.
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/chart-heatmap-any-browser.js <shotsDir>
// Checks at 1440 dark, 390 dark, 1440 light (Pro): NQ draws from the hub; BTC draws from the exchange book; SI1! draws from the member
// feed (after "Waiting for order book…"); NQ stays on the hub while a member feed is connected; AAPL shows the honest no-source note.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 500) : '')); };

const MIN = Math.floor(Date.now() / 60000), N = 180, TICK = 0.25;
const price = (m) => 28650 + Math.sin((m - MIN) / 17) * 40 + Math.sin((m - MIN) / 5) * 9;
// up to the minute of the request: the live book columns (stamped now) sit at the right edge, as on a live chart
const barsNow = () => { const out = [], m1 = Math.floor(Date.now() / 60000) + 1; for (let m = m1 - N; m < m1; m++) {
  const o = Math.round(price(m) / TICK) * TICK, c = Math.round(price(m + 1) / TICK) * TICK;
  out.push([m * 60, o, Math.max(o, c) + 3, Math.min(o, c) - 3, c, 400 + (m % 7) * 30]); } return out; };
const WAIT = 'Waiting for order book…';
const NOTE = 'No order book for AAPL yet. Connect a broker that streams depth to see it.';

function fakeWs() {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) }); }, 50);
    let n = 0;
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage) return; n++;
      const now = Date.now(), b = Math.floor((window.__L2MID || 28650) * 4) / 4, bids = [], asks = [];
      for (let i = 0; i < 12; i++) { bids.push([b - i * 0.25, 10 + ((i * 7 + n) % 30)]); asks.push([b + 0.25 + i * 0.25, 10 + ((i * 5 + n) % 30)]); }
      ws.onmessage({ data: JSON.stringify({ type: 'snap', symbol: 'NQ', ts: now, bids, asks, imb: 0, imb10: 0 }) });
      ws.onmessage({ data: JSON.stringify({ type: 'ticks', symbol: 'NQ', t: [[b, 3, -1, now], [b + 0.25, 2, 1, now]] }) });
      if (n % 5 === 0) {
        const step = 2.75, i0 = Math.floor((b - 120) / step), v = [];
        for (let k = 0; k < 88; k++) { const p = (i0 + k + 0.5) * step, w = Math.abs(p - (b + 30)) < 2 || Math.abs(p - (b - 45)) < 2 ? 900 : 20 + ((k * 13) % 50); v.push(p < b ? w : -w); }
        ws.onmessage({ data: JSON.stringify({ type: 'coarse', symbol: 'NQ', ts: now, mid: b, bb: b, ba: b + 0.25, step, i0, v }) });
      }
    }, 200);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
// the member's own depth feed (what a connected broker hands the chart): a book around the bar price, the first after 3 s
const memberFeed = () => {
  window.__memberCalls = [];
  window.__stkBookSources = window.__stkBookSources || {};
  window.__stkBookSources.futures = (ticker, onEv, onStatus) => {
    window.__memberCalls.push(ticker); onStatus('waiting');
    let n = 0;
    const iv = setInterval(() => {
      if (++n < 15) return;   // 3 s of nothing: the note says "Waiting for order book…"
      const mid = Math.round((window.__L2MID || 28650) * 4) / 4, bids = [], asks = [];
      for (let i = 1; i <= 160; i++) { const wall = i === 60 ? 700 : 0; bids.push([mid - i * 0.25, 5 + ((i * 7 + n) % 20) + wall]); asks.push([mid + i * 0.25, 5 + ((i * 3 + n) % 20) + (i === 90 ? 900 : 0)]); }
      onEv({ kind: 'book', full: true, bids, asks });
    }, 200);
    return () => clearInterval(iv);
  };
  window.dispatchEvent(new CustomEvent('stryker:booksource', { detail: { provider: 'futures' } }));
};
async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile, colorScheme: theme });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/binance[^/]*\/(api\/v3|fapi\/v1)\/klines/, (r) => {
    const u = new URL(r.request().url()), e = Number(u.searchParams.get('endTime')) || Date.now(), m1 = Math.floor(e / 60000), k = [];
    if (!u.searchParams.get('endTime')) for (let m = m1 - 180; m <= m1; m++) { const o = 76000 + Math.sin(m / 9) * 40, c = 76000 + Math.sin((m + 1) / 9) * 40; k.push([m * 60000, String(o), String(Math.max(o, c) + 5), String(Math.min(o, c) - 5), String(c), '12', m * 60000 + 59999, '0', 10, '6', '0', '0']); }
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(k) });
  });
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars: barsNow() }) }));
  await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  // AAPL candles (stocks lane, fixture recorder): 1m bars around 230, so the no-source note sits over a real chart
  await ctx.addInitScript(() => { window.__STK_BOOK_RECORDER = 'https://sk.fixture.test'; });
  await ctx.route(/^https:\/\/sk\.fixture\.test\//, (r) => {
    const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization', 'content-type': 'application/json' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: h });
    const u = new URL(r.request().url());
    if (u.pathname !== '/sk-bars' || u.searchParams.get('to')) return r.fulfill({ status: 200, headers: h, body: JSON.stringify({ b: [], info: { mintick: 0.01 } }) });
    const m1 = Math.floor(Date.now() / 60000), b = [];
    for (let m = m1 - 180; m <= m1; m++) { const o = 230 + Math.sin(m / 11) * 1.5, c = 230 + Math.sin((m + 1) / 11) * 1.5; b.push([m * 60000, o, Math.max(o, c) + 0.1, Math.min(o, c) - 0.1, c, 1000]); }
    r.fulfill({ status: 200, headers: h, body: JSON.stringify({ info: { mintick: 0.01, description: 'Apple Inc.' }, live: true, lane: 'live', now: Date.now(), b }) });
  });
  const p = await ctx.newPage(), errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|\/api\/chart\/stream|Failed to load resource|Ping received after close/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
  return { ctx, p, errors };
}
const setSym = (p, sym, bars) => p.evaluate(async ([s, mid, need]) => {
  window.__L2MID = mid;
  const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1');
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === s && (!need || c.orchestrator.rawBars.length > 20)) break; }
}, [sym, price(Math.floor(Date.now() / 60000)), bars !== false]);
const dbg = (p) => p.evaluate(() => window.__stkFlow.dhDebug && window.__stkFlow.dhDebug());
const note = (p) => p.evaluate(() => String(window.__stkDhNote || ''));
const fit = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.chart, t = Date.now(); c.setVisibleRange({ from: t - 600000, to: t + (innerWidth < 520 ? 420000 : 120000) }); });
(async () => {
  const b = await launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=768'] });
  try {
    const ALL = [[1440, 900, false, 'dark'], [390, 844, true, 'dark'], [1440, 900, false, 'light']];
    for (const [w, h, mobile, theme] of process.env.HM_ONLY ? [ALL[+process.env.HM_ONLY]] : ALL) {
      const tag = w + '-' + theme;
      const { ctx, p, errors } = await open(b, { w, h, mobile, theme });
      // 1. NQ: the hub book
      await setSym(p, 'futures:NQ1!');
      await p.evaluate(() => { window.STRYKER_VELA.chart.addNativeIndicator('stk_depth_heat'); window.STRYKER_VELA.context().stateChanged(); });
      await sleep(10000);
      let d = await dbg(p);
      check(d && d.feed === 'tsl2|NQ' && d.heat && d.heat.columns > 5 && d.heat.cells > 100, tag + ': NQ draws from the hub book', d);
      await p.screenshot({ path: OUT + '/hm-any-nq-' + tag + '.png' });
      // 2. BTC: the exchange book
      await setSym(p, 'binance:BTCUSDT'); await sleep(1500);
      const now = Date.now(), S = [];
      for (let k = 0; k < 120; k++) { const ts = now - (120 - k) * 5000, mid = 76000 + Math.sin(k / 9) * 40, step = 2, i0 = Math.floor((mid - 160) / step), v = []; for (let r = 0; r < 160; r++) { const p0 = (i0 + r + 0.5) * step, q = Math.abs(p0 - 76100) < 3 ? 60 : 0.5 + ((r * 7) % 9) / 3; v.push(p0 < mid ? q : -q); } S.push({ ts, mid, bb: mid - 0.5, ba: mid + 0.5, step, i0, v }); }
      await p.evaluate((s) => window.__stkFlow.domDebugLoad(s), S);
      await fit(p); await sleep(4000);
      d = await dbg(p);
      check(d && d.feed === 'binance|BTCUSDT' && d.heat && d.heat.columns > 5, tag + ': BTC draws from the exchange book', d);
      await p.screenshot({ path: OUT + '/hm-any-btc-' + tag + '.png' });
      // 3. AAPL: no source -> the honest note, nothing drawn
      await setSym(p, 'stocks:NASDAQ:AAPL');
      await p.waitForFunction(() => window.STRYKER_VELA.chart.orchestrator.rawBars.length > 20, null, { timeout: 30000 }).catch(() => {});   // the stocks lane waits for the access headers (up to 15 s)
      await fit(p); await sleep(2500);
      check((await note(p)) === NOTE, tag + ': AAPL shows the no-source note', await note(p));
      check(!/InsightSentry|Databento|Tick-stream|Rithmic|NQ, ES/.test(await note(p)), tag + ': no vendor names or ticker list in the note');
      await p.screenshot({ path: OUT + '/hm-any-aapl-' + tag + '.png' });
      // 4. a member's own depth feed (connected broker) on a futures root the hub does not carry (SI)
      await p.evaluate(memberFeed);
      await setSym(p, 'futures:SI1!'); await sleep(1200);
      const w0 = await note(p);
      await p.screenshot({ path: OUT + '/hm-any-waiting-' + tag + '.png' });
      check(w0 === WAIT, tag + ': SI1! with a member feed says "' + WAIT + '" before the first book', w0);
      await sleep(9000); await fit(p);
      for (let i = 0; i < 10; i++) { await sleep(1000); d = await dbg(p); if (d && d.heat && d.heat.columns > 3) break; }
      check(await p.evaluate(() => window.__memberCalls.length > 0 && /SI/.test(window.__memberCalls[window.__memberCalls.length - 1])), tag + ': the member feed was asked for SI', await p.evaluate(() => window.__memberCalls));
      check(d && /^member\|FUTURES:SI1!$/i.test(d.feed) && d.heat && d.heat.columns > 3 && d.heat.cells > 50, tag + ': SI1! draws from the member feed', d);
      check(d && d.ladderRows > 5, tag + ': member book column rows', d);
      check((await note(p)) === '', tag + ': no note once the book is in', await note(p));
      await p.screenshot({ path: OUT + '/hm-any-member-' + tag + '.png' });
      // 5. NQ again with the member feed connected: still the hub (recorded history), live futures access unchanged
      await setSym(p, 'futures:NQ1!'); await sleep(6000);
      d = await dbg(p);
      check(d && d.feed === 'tsl2|NQ', tag + ': NQ stays on the hub while a member feed is connected', d && d.feed);
      check(errors.length === 0, tag + ': no console errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
