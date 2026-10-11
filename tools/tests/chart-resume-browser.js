// Charts "resume after leaving the tab" browser test (Owner bug 2026-10-12: "whenever I move away
// from charts like changing tab, it freezes, candles stop moving and I have to refresh").
//
// Fully offline and deterministic: the futures bars endpoint (/api/chart/bars), the futures
// stream bridge (/api/chart/stream), Binance REST (klines) and the Binance kline WebSocket are
// all mocked here from ONE synthetic price series driven by a fake clock. Like production, the
// futures REST pages lag ~10 min (Yahoo-delayed) while the stream is current.
//
// For NQ1! 1m and BTCUSDT 1m, each scenario hides the page (visibilityState hidden +
// visibilitychange), fast-forwards the fake clock, freezes the page with CDP
// Page.setWebLifecycleState frozen -> active, then brings it back (visible, pageshow, focus):
//   30s-keep     30 s hidden, the socket survives (desktop tab switch)
//   5m-kill      5 min hidden, the server/OS closed the socket while hidden (phone)
//   35m-zombie   35 min hidden, the socket stays "open" but never delivers again (half-open
//                socket after a phone sleeps / changes network)
//   net-drop     context offline for 20 s (sockets dropped, REST fails), then online
// After each resume it asserts, within RECOVER_MS (default 3 s): the newest chart bar is the
// current minute, the hidden period is back-filled with no missing minutes, the forming bar's
// price keeps ticking, and there is exactly one open feed socket and no extra setInterval timers.
//
//   flock /tmp/stryker-chrome.lock node tools/tests/chart-resume-browser.js [shotsDir]
// Starts and stops its own static server on 127.0.0.1. Env: RECOVER_MS, ONLY=futures|binance.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launch, ROOT } = require('./lib.js');
const stub = require('./richstub.js');

const OUT = process.argv[2] || '/tmp';
const RECOVER_MS = Number(process.env.RECOVER_MS || 3000);
const ONLY = process.env.ONLY || '';
const T0 = Date.parse('2026-10-07T14:00:00Z'); // a Wednesday, CME Globex open (10:00 New York)
const MIN = 60000, H = 3600, D = 86400;
const REST_DELAY_MS = 10 * MIN;                 // production futures REST lags ~10 min
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- virtual clock shared by the page (Playwright fake clock) and the mocks ----
let offset = 0; // virtual now = real now + offset (set at install, grown by every fastForward)
const vnow = () => Date.now() + offset;

// ---- one deterministic price series ----
function bar(tMs, stepMs, base) {
  const i = Math.floor(tMs / stepMs);
  const o = base + 40 * Math.sin(i / 37) + (i % 7);
  const c = base + 40 * Math.sin((i + 1) / 37) + ((i + 3) % 7);
  return { t: i * stepMs, o, h: Math.max(o, c) + 2, l: Math.min(o, c) - 2, c, v: 100 + (i % 50) };
}
// the forming bar at virtual time `now`: its close moves every second
function forming(now, stepMs, base) {
  const b = bar(now, stepMs, base);
  const s = Math.floor((now - b.t) / 1000);
  const c = b.o + ((s * 7) % 23) - 11 + s / 100;
  return { ...b, c, h: Math.max(b.h, c), l: Math.min(b.l, c) };
}
const r2 = (x) => Math.round(x * 4) / 4;

// ---- static server ----
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp', '.ico': 'image/x-icon' };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const u = new URL(req.url, 'http://x');
      let p = path.join(ROOT, decodeURIComponent(u.pathname));
      if (!p.startsWith(ROOT)) { rsp.writeHead(403); rsp.end(); return; }
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html';
      if (!fs.existsSync(p)) { rsp.writeHead(404); rsp.end('nf'); return; }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

// ---- mocks ----
const TF_MIN = { '1': 1, '5': 5, '15': 15, '30': 30, '60': 60, '120': 120, '240': 240, D: 1440 };
const PAGE_SECS = { '1': 8 * H, '5': 2 * D, '15': 5 * D, '30': 10 * D, '60': 20 * D, '120': 40 * D, '240': 60 * D, D: 730 * D };
const NQ_BASE = 21000, BTC_BASE = 64000;
const net = { offline: false };
const socks = { futures: [], binance: [] }; // { ws, mode: 'live'|'zombie'|'closed', timer }
let feedState = 'keep';                      // what happens to sockets while "hidden"

function wireFeed(kind, ws, send) {
  const s = { ws, mode: 'live', timer: null };
  socks[kind].push(s);
  s.timer = setInterval(() => { if (s.mode === 'live' && !net.offline) { try { send(); } catch (e) {} } }, 1000);
  ws.onClose(() => { s.mode = 'closed'; clearInterval(s.timer); try { ws.close(); } catch (e) {} }); // finish the close handshake
  return s;
}
async function mockRoutes(ctx) {
  // futures REST pages (lag REST_DELAY_MS, like Yahoo)
  await ctx.route(/\/api\/chart\/bars\//, (route) => {
    if (net.offline) return route.abort('internetdisconnected');
    const u = new URL(route.request().url());
    const tf = u.searchParams.get('tf') || '1';
    const step = (TF_MIN[tf] || 1) * MIN;
    const page = Number(u.searchParams.get('page') || 0);
    const ps = PAGE_SECS[tf] || 8 * H;
    const from = page * ps * 1000, to = Math.min((page + 1) * ps * 1000, vnow() - REST_DELAY_MS + step);
    const bars = [];
    for (let t = Math.ceil(from / step) * step; t < to; t += step) {
      const b = bar(t, step, NQ_BASE);
      bars.push([t / 1000, r2(b.o), r2(b.h), r2(b.l), r2(b.c), b.v]);
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf, page, bars }) });
  });
  // futures stream bridge: connected, a snapshot burst of the last 200 bars, then the forming bar every second
  await ctx.routeWebSocket(/\/api\/chart\/stream\//, (ws) => {
    if (net.offline) { ws.close({ code: 1006 }); return; }
    const tf = new URL(ws.url()).searchParams.get('tf') || '1';
    const step = (TF_MIN[tf] || 1) * MIN;
    const row = (b) => [b.t / 1000, r2(b.o), r2(b.h), r2(b.l), r2(b.c), b.v];
    ws.send(JSON.stringify({ event: 'connected', s: 'NQ', tf }));
    setTimeout(() => {
      const now = vnow();
      const cur = Math.floor(now / step) * step;
      for (let t = cur - 200 * step; t < cur; t += step) ws.send(JSON.stringify({ event: 'bar', s: 'NQ', tf, bar: row(bar(t, step, NQ_BASE)) }));
      ws.send(JSON.stringify({ event: 'bar', s: 'NQ', tf, bar: row(forming(now, step, NQ_BASE)) }));
    }, 300);
    wireFeed('futures', ws, () => ws.send(JSON.stringify({ event: 'bar', s: 'NQ', tf, bar: row(forming(vnow(), step, NQ_BASE)) })));
  });
  // Binance REST
  await ctx.route(/^https:\/\/(api\.binance\.com|data-api\.binance\.vision|api\.binance\.us)\//, (route) => {
    if (net.offline) return route.abort('internetdisconnected');
    const u = new URL(route.request().url());
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (/\/ping$/.test(u.pathname)) return json({});
    if (/\/exchangeInfo$/.test(u.pathname)) return json({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }] }] });
    if (/\/klines$/.test(u.pathname)) {
      const iv = u.searchParams.get('interval') || '1m';
      const m = { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240, '1d': 1440 }[iv] || 1;
      const step = m * MIN, now = vnow();
      const limit = Math.min(1000, Number(u.searchParams.get('limit') || 500));
      const st = u.searchParams.get('startTime'), en = u.searchParams.get('endTime');
      const endT = Math.min(en != null ? Number(en) : now, now);
      let ts = [];
      if (st != null) { for (let t = Math.ceil(Number(st) / step) * step; t <= endT && ts.length < limit; t += step) ts.push(t); }
      else { for (let t = Math.floor(endT / step) * step; ts.length < limit; t -= step) ts.unshift(t); }
      const curT = Math.floor(now / step) * step;
      return json(ts.map((t) => { const b = t === curT ? forming(now, step, BTC_BASE) : bar(t, step, BTC_BASE); return [t, String(b.o), String(b.h), String(b.l), String(b.c), String(b.v), t + step - 1, '0', 1, '0', '0', '0']; }));
    }
    return json([]);
  });
  // Binance kline stream (other Binance streams stay silent)
  await ctx.routeWebSocket(/^wss:\/\/[^/]*binance[^/]*\//, (ws) => {
    if (net.offline) { ws.close({ code: 1006 }); return; }
    const m = /@kline_(\w+)$/.exec(ws.url());
    if (!m) return;
    const step = ({ '1m': 1, '5m': 5, '15m': 15, '1h': 60 }[m[1]] || 1) * MIN;
    wireFeed('binance', ws, () => { const b = forming(vnow(), step, BTC_BASE); ws.send(JSON.stringify({ e: 'kline', k: { t: b.t, o: String(b.o), h: String(b.h), l: String(b.l), c: String(b.c), v: String(b.v), x: false } })); });
  });
}

// ---- page instrumentation (after the fake clock, so it wraps the fake timers) ----
const INSTRUMENT = () => {
  const open = new Map();
  const NWS = window.WebSocket;
  window.WebSocket = function (url, p) {
    const ws = p ? new NWS(url, p) : new NWS(url);
    open.set(ws, String(url));
    ws.addEventListener('close', () => open.delete(ws));
    return ws;
  };
  window.WebSocket.prototype = NWS.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k) => { window.WebSocket[k] = NWS[k]; });
  // sockets the page has not closed (CONNECTING or OPEN)
  window.__openSockets = (re) => [...open.entries()].filter(([w, u]) => w.readyState <= 1 && (!re || new RegExp(re).test(u))).map(([, u]) => u);
  const ivs = new Set();
  const si = window.setInterval, ci = window.clearInterval;
  window.setInterval = function () { const id = si.apply(this, arguments); ivs.add(id); return id; };
  window.clearInterval = function (id) { ivs.delete(id); return ci.apply(this, arguments); };
  window.__intervals = () => ivs.size;
  let hidden = false;
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  window.__setHidden = (h) => {
    hidden = h;
    document.dispatchEvent(new Event('visibilitychange'));
    if (h) { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); }
    else { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); window.dispatchEvent(new Event('focus')); }
  };
  try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
};

const chartState = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.chart;
  const o = c.orchestrator;
  const b = o.rawBars;
  return { sym: c.market.symbol, tf: c.market.timeframe, n: b.length, last: b.length ? b[b.length - 1].time : 0, close: b.length ? b[b.length - 1].close : 0,
    times: b.slice(-80).map((x) => x.time), now: Date.now(), healing: !!o.healing };
});
async function setMarket(p, sym, tf) {
  await p.evaluate(async ([sym, tf]) => {
    const ws = window.STRYKER_VELA;
    ws.active.setSymbol(sym); ws.active.setTimeframe(tf);
    const c = ws.chart;
    for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); if (c.market.symbol === sym && c.market.timeframe === tf && c.orchestrator.rawBars.length > 50 && c.orchestrator.historyState !== 'backfill') break; }
  }, [sym, tf]);
  await sleep(2500);
}
const feedRe = (kind) => (kind === 'futures' ? '/api/chart/stream/' : 'binance.*@kline_');

async function scenario(p, cdp, ctx, kind, { name, hideMs, mode, offline }) {
  const before = await chartState(p);
  const sockBefore = await p.evaluate((re) => window.__openSockets(re).length, feedRe(kind));
  const ivBefore = await p.evaluate(() => window.__intervals());
  // leave
  await p.evaluate(() => window.__setHidden(true));
  if (offline) { net.offline = true; await ctx.setOffline(true); }
  socks[kind].forEach((s) => {
    if (s.mode !== 'live') return;
    if (mode === 'kill' || offline) { s.mode = 'closed'; clearInterval(s.timer); try { s.ws.close({ code: 1006 }); } catch (e) {} }
    else if (mode === 'zombie') s.mode = 'zombie';
  });
  await sleep(500);
  offset += hideMs;
  await p.clock.fastForward(hideMs);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await sleep(1500);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  if (offline) { await sleep(1000); net.offline = false; await ctx.setOffline(false); }
  // come back
  const t0 = Date.now();
  await p.evaluate(() => window.__setHidden(false));
  let st, ok = false;
  const step = 60000;
  while (Date.now() - t0 < RECOVER_MS + 4000) {
    await sleep(250);
    st = await chartState(p);
    const curMin = Math.floor(st.now / step) * step;
    const span = st.times.filter((t) => t >= before.last);
    let contiguous = span.length > 0;
    for (let i = 1; i < span.length; i++) if (span[i] - span[i - 1] !== step) contiguous = false;
    if (st.last === curMin && contiguous && !st.healing) { ok = true; break; }
  }
  const took = Date.now() - t0;
  const curMin = Math.floor(st.now / step) * step;
  check(ok && took <= RECOVER_MS, `${kind} ${name}: newest bar is the current minute with the hidden ${Math.round(hideMs / 1000)} s back-filled, in ${took} ms (last ${new Date(st.last).toISOString()} vs now ${new Date(curMin).toISOString()}, bars ${before.n} -> ${st.n})`);
  // ticks keep coming
  const c0 = st.close, l0 = st.last;
  await sleep(2500);
  const st2 = await chartState(p);
  check(st2.close !== c0 || st2.last > l0, `${kind} ${name}: price ticks after resume (${c0} -> ${st2.close})`);
  const sockAfter = await p.evaluate((re) => window.__openSockets(re), feedRe(kind));
  const ivAfter = await p.evaluate(() => window.__intervals());
  const liveSrv = socks[kind].filter((s) => s.mode === 'live').length;
  check(sockAfter.length === 1 && sockAfter.length <= Math.max(1, sockBefore) && liveSrv === 1, `${kind} ${name}: one feed socket (page ${sockBefore} -> ${sockAfter.length}, live on server ${liveSrv}) ${sockAfter.join(" ")}`);
  check(ivAfter <= ivBefore, `${kind} ${name}: no extra intervals (${ivBefore} -> ${ivAfter})`);
  return st2;
}

(async () => {
  const srv = await serve();
  const BASE = `http://127.0.0.1:${srv.address().port}`;
  const b = await launch({ args: ['--disable-dev-shm-usage'] });
  try {
    for (const [kind, sym] of [['futures', 'futures:NQ1!'], ['binance', 'binance:BTCUSDT']]) {
      if (ONLY && ONLY !== kind) continue;
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await ctx.addInitScript(stub);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|api\.binance\.com|data-api\.binance\.vision|api\.binance\.us)/, (r) => r.abort());
      await mockRoutes(ctx);
      const p = await ctx.newPage();
      offset = T0 - Date.now();
      await p.clock.install({ time: new Date(T0) });
      await p.addInitScript(INSTRUMENT);
      const errors = [];
      const IGNORE = [/ERR_FAILED|ERR_INTERNET_DISCONNECTED|net::|status of 4|status of 5|Failed to fetch/i, /WebSocket connection to/];
      p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) errors.push(m.text()); });
      p.on('pageerror', (e) => errors.push(String(e)));
      const cdp = await ctx.newCDPSession(p);
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
      await sleep(3000);
      await setMarket(p, sym, '1');
      offset = (await p.evaluate(() => Date.now())) - Date.now(); // re-sync the mocks with the page clock
      const s0 = await chartState(p);
      check(s0.sym.endsWith(sym.split(':')[1]) && s0.tf === '1' && s0.last === Math.floor(s0.now / MIN) * MIN, `${kind}: ${s0.sym} ${s0.tf} live at the current minute before leaving (${s0.n} bars)`);
      await scenario(p, cdp, ctx, kind, { name: '30s-keep', hideMs: 30000, mode: 'keep' });
      await scenario(p, cdp, ctx, kind, { name: '5m-kill', hideMs: 5 * MIN, mode: 'kill' });
      await scenario(p, cdp, ctx, kind, { name: '35m-zombie', hideMs: 35 * MIN, mode: 'zombie' });
      await scenario(p, cdp, ctx, kind, { name: 'net-drop', hideMs: 20000, mode: 'kill', offline: true });
      const shot = `${OUT}/chart-resume-${kind}-390.png`;
      await p.screenshot({ path: shot });
      console.log('screenshot', shot);
      check(errors.length === 0, `${kind}: console errors: ${errors.length ? errors.slice(0, 4).join(' | ') : 'none'}`);
      await ctx.close();
    }
  } finally {
    await b.close();
    srv.close();
  }
  console.log(`\n${fail} failures`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
