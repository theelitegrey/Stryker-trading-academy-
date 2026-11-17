// Charts ACCOUNT STRIP browser test (Owner 2026-11-17): Bal / RP&L / UP&L in the top bar, left of the session pill.
//   flock /tmp/stryker-chrome.lock node tools/tests/chart-acctstrip-browser.js [shotsDir]
// ON through the real settings dialog -> everything appears; reload keeps it; switched OFF with an
// open position + working order -> all hidden again but the account is kept (and the working
// order still fills silently); Bar replay follows the switch. Screenshots of both states + the
// settings tab at 1280 and 390.
//
//   flock /tmp/stryker-chrome.lock node tools/tests/chart-paper-trading-browser.js [shotsDir]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launch, ROOT } = require('./lib.js');
const stub = require('./richstub.js');

const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const T0 = Date.parse('2026-10-07T14:00:00Z'); // a Wednesday, CME Globex open (10:00 New York)
const MIN = 60000, H = 3600, D = 86400;
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let offset = 0;
const vnow = () => Date.now() + offset;
const NQ_BASE = 21000, BTC_BASE = 64000;
function hist(tMs, stepMs, base) {
  const i = Math.floor(tMs / stepMs);
  const o = base + 20 * Math.sin(i / 37), c = base + 20 * Math.sin((i + 1) / 37);
  return { t: i * stepMs, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 100 + (i % 50) };
}
const r4 = (x) => Math.round(x * 4) / 4;
// the price the test drives + the forming bar built from it
const px = { futures: null, binance: null };
const forming = { futures: null, binance: null };
function formingBar(kind, stepMs, base) {
  const now = vnow(), t = Math.floor(now / stepMs) * stepMs;
  if (px[kind] == null) px[kind] = hist(t - stepMs, stepMs, base).c;
  let f = forming[kind];
  if (!f || f.t !== t) f = forming[kind] = { t, o: px[kind], h: px[kind], l: px[kind], c: px[kind], v: 1 };
  f.c = px[kind]; f.h = Math.max(f.h, f.c); f.l = Math.min(f.l, f.c); f.v++;
  return f;
}

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
      // The live feed is the tick hub by default (2026-11-03); this test scripts ticks through the old /api/chart/stream mock, so serve the flag as 'is'.
      if (/\/live-source\.js$/.test(p)) { rsp.end(fs.readFileSync(p, 'utf8').replace("LIVE_SOURCE = 'hub'", "LIVE_SOURCE = 'is'")); return; }
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

const TF_MIN = { '1': 1, '5': 5, '15': 15, '30': 30, '60': 60, '120': 120, '240': 240, D: 1440 };
const PAGE_SECS = { '1': 8 * H, '5': 2 * D, '15': 5 * D, '30': 10 * D, '60': 20 * D, '120': 40 * D, '240': 60 * D, D: 730 * D };
const timers = [];
async function mockRoutes(ctx) {
  // Real-time futures are admin only since 2026-10-16 (assets/rt-access.js): a non-admin polls the
  // 10-min-delayed REST tail every 20 s, so the scripted ticks below never arrived. The paper engine is
  // the same on both feeds; the test rides the live stream as a realtime admin (faked server answer).
  await ctx.route(/\/api\/chart\/rt(\?|$)/, (r) => r.fulfill({ json: { admin: true }, headers: { 'cache-control': 'no-store' } }));
  await ctx.route(/\/api\/chart\/bars\//, (route) => {
    const u = new URL(route.request().url());
    const tf = u.searchParams.get('tf') || '1';
    const step = (TF_MIN[tf] || 1) * MIN;
    const page = Number(u.searchParams.get('page') || 0);
    const ps = PAGE_SECS[tf] || 8 * H;
    const cur = Math.floor(vnow() / step) * step;
    const from = page * ps * 1000, to = Math.min((page + 1) * ps * 1000, cur);
    const bars = [];
    for (let t = Math.ceil(from / step) * step; t < to; t += step) { const b = hist(t, step, NQ_BASE); bars.push([t / 1000, r4(b.o), r4(b.h), r4(b.l), r4(b.c), b.v]); }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf, page, bars }) });
  });
  await ctx.routeWebSocket(/\/api\/chart\/stream\//, (ws) => {
    const tf = new URL(ws.url()).searchParams.get('tf') || '1';
    const step = (TF_MIN[tf] || 1) * MIN;
    const row = (b) => [b.t / 1000, r4(b.o), r4(b.h), r4(b.l), r4(b.c), b.v];
    ws.send(JSON.stringify({ event: 'connected', s: 'NQ', tf }));
    setTimeout(() => {
      const cur = Math.floor(vnow() / step) * step;
      for (let t = cur - 200 * step; t < cur; t += step) ws.send(JSON.stringify({ event: 'bar', s: 'NQ', tf, bar: row(hist(t, step, NQ_BASE)) }));
      ws.send(JSON.stringify({ event: 'bar', s: 'NQ', tf, bar: row(step === MIN ? formingBar('futures', step, NQ_BASE) : hist(cur, step, NQ_BASE)) }));
    }, 300);
    const iv = setInterval(() => { if (step === MIN) { try { ws.send(JSON.stringify({ event: 'bar', s: 'NQ', tf, bar: row(formingBar('futures', step, NQ_BASE)) })); } catch (e) {} } }, 400);
    timers.push(iv); ws.onClose(() => clearInterval(iv));
  });
  await ctx.route(/^https:\/\/(api\.binance\.com|data-api\.binance\.vision|api\.binance\.us)\//, (route) => {
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
      return json(ts.map((t) => { const b = t === curT && step === MIN ? formingBar('binance', step, BTC_BASE) : hist(t, step, BTC_BASE); return [t, String(b.o), String(b.h), String(b.l), String(b.c), String(b.v), t + step - 1, '0', 1, '0', '0', '0']; }));
    }
    return json([]);
  });
  await ctx.routeWebSocket(/^wss:\/\/[^/]*binance[^/]*\//, (ws) => {
    const m = /@kline_(\w+)$/.exec(ws.url());
    if (!m) return;
    const step = ({ '1m': 1, '5m': 5, '15m': 15, '1h': 60 }[m[1]] || 1) * MIN;
    const iv = setInterval(() => { const b = step === MIN ? formingBar('binance', step, BTC_BASE) : hist(vnow(), step, BTC_BASE); try { ws.send(JSON.stringify({ e: 'kline', k: { t: b.t, o: String(b.o), h: String(b.h), l: String(b.l), c: String(b.c), v: String(b.v), x: false } })); } catch (e) {} }, 400);
    timers.push(iv); ws.onClose(() => clearInterval(iv));
  });
}

// Records the paper account doc + journal writes (persisted across reloads in localStorage keys
// the page never uses), on top of the rich stub.
const RECORDER = () => {
  try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
  const fb = window.firebase; if (!fb) return;
  // realtime-admin lane for assets/rt-access.js (see mockRoutes): it listens on onIdTokenChanged of an initialised app
  try { fb.apps = [{}]; const A = fb.auth(); if (!A.onIdTokenChanged) A.onIdTokenChanged = (cb) => { setTimeout(() => cb(A.currentUser), 20); return () => {}; }; } catch (e) {}
  const orig = fb.firestore;
  const CLOUD = '__test_cloud_paper', JW = '__test_journal_writes';
  const wrapD = (d, p) => {
    const w = Object.assign({}, d, { collection: (sub) => wrapC(d.collection(sub), p + '/' + sub) });
    if (/\/paperTrading\/account$/.test(p)) {
      w.get = () => { const s = localStorage.getItem(CLOUD); return Promise.resolve({ id: 'account', exists: !!s, data: () => (s ? JSON.parse(s) : {}) }); };
      w.set = (data) => { localStorage.setItem(CLOUD, JSON.stringify({ state: data.state, updatedAt: data.updatedAt, keys: Object.keys(data) })); return Promise.resolve(); };
    }
    if (/\/journal\/[^/]+$/.test(p)) w.set = (data) => { const a = JSON.parse(localStorage.getItem(JW) || '[]'); a.push(data); localStorage.setItem(JW, JSON.stringify(a)); return Promise.resolve(); };
    return w;
  };
  const wrapC = (c, p) => Object.assign({}, c, { doc: (id) => wrapD(c.doc(id), p + '/' + (id || 'auto')) });
  const db = Object.assign({}, orig(), { collection: (n) => wrapC(orig().collection(n), n) });
  fb.firestore = Object.assign(() => db, orig);
  window.__toasts = []; window.__simSounds = [];
  window.addEventListener('stryker:chart-sim-sound', (e) => window.__simSounds.push(e.detail.event + ':' + e.detail.source));
  // assets/toast.js assigns window.showToast later: wrap whatever it sets
  let st = null;
  Object.defineProperty(window, 'showToast', { configurable: true,
    get: () => function (type, msg) { window.__toasts.push({ type, msg: String(msg) }); return st && st.apply(this, arguments); },
    set: (f) => { st = f; } });
};

// Every paper line must sit on the MAIN PRICE PANE at priceToY(price) of that pane.
async function linesOnPricePane(p, label) {
  await sleep(700);
  const r = await p.evaluate(() => {
    const R = window.STRYKER_VELA.chart.renderer.renderer, l = R.extLayers.find((x) => x.def.id === 'stk_paper');
    const inst = l.instance, a = inst.args, pane = R.scene.panes.get('price');
    const out = { paneTop: pane.bounds.top, paneH: pane.bounds.height, argTop: a.bounds.top, argH: a.bounds.height, lines: [] };
    for (const ln of (a.data && a.data.lines) || []) {
      const want = Math.round(R.coords.priceToY(ln.price, pane.scale, pane.bounds)) + 0.5;
      out.lines.push({ id: ln.id, price: ln.price, y: inst.ys[ln.id], want, inPane: want >= pane.bounds.top && want <= pane.bounds.top + pane.bounds.height });
    }
    return out;
  });
  const ok = r.lines.length > 0 && r.argTop === r.paneTop && r.argH === r.paneH && r.lines.every((x) => Math.abs(x.y - x.want) < 1) && r.lines.some((x) => x.id === 'pos' && x.inPane);
  check(ok, label + ': every paper line at priceToY(price) on the main price pane: ' + r.lines.map((x) => x.id + '@' + x.price + ' y=' + x.y + '/' + x.want + (x.inPane ? '' : '(off)')).join(' | ') + ` pane ${r.paneTop}+${r.paneH} layer ${r.argTop}+${r.argH}`);
}
async function setMarket(p, sym, tf) {
  await p.evaluate(async ([sym, tf]) => {
    const ws = window.STRYKER_VELA;
    ws.active.setSymbol(sym); ws.active.setTimeframe(tf);
    const c = ws.chart;
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (c.market.symbol === sym && c.market.timeframe === tf && c.orchestrator.rawBars.length > 50) break; }
  }, [sym, tf]);
  await sleep(2000);
}

// ---- the "Enable paper trading" switch ----
// What paper trading currently shows on the page.
const paperUi = (p) => p.evaluate(() => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  let lines = 0; try { const R = window.STRYKER_VELA.chart.renderer.renderer, l = R.extLayers.find((x) => x.def.id === 'stk_paper'); lines = ((l.instance.args && l.instance.args.data && l.instance.args.data.lines) || []).length; } catch (e) {}
  return { enabled: window.__stkPaper.enabled, cls: document.documentElement.classList.contains('stkpt-on'), panel: vis(document.querySelector('.stkpt-toggle')), trade: vis(document.getElementById('stkc-paper-btn')),
    oneClick: [...document.querySelectorAll('.stkpt-1c')].filter(vis).length, chips: [...document.querySelectorAll('.stkpt-chip')].filter(vis).length, lines };
});
const allHidden = (u) => !u.enabled && !u.cls && !u.panel && u.oneClick === 0 && u.chips === 0 && u.lines === 0;
// Opens Chart settings (top-bar gear; ☰ tab list on a phone) on the "Paper trading" tab.
async function openPaperTab(p, phone) {
  // phone (build 537): the slim TradingView-style row keeps the gear behind ⋯ More
  if (!(await p.isVisible('#stkc-settings-btn'))) { await (phone ? p.tap('#stkc-more-btn') : p.click('#stkc-more-btn')); await sleep(700); }
  await (phone ? p.tap('#stkc-settings-btn') : p.click('#stkc-settings-btn'));
  await p.waitForSelector('.vela-dialog--settings .vela-sd-rail', { state: 'attached', timeout: 10000 });
  await sleep(300);
  if (phone && await p.isVisible('.vela-dialog--settings .vela-sd-burger')) { await p.click('.vela-dialog--settings .vela-sd-burger'); await sleep(300); }
  const tab = p.locator('.vela-dialog--settings .vela-sd-tab', { hasText: /^\s*Paper trading\s*$/ });
  check(await tab.count() === 1, (phone ? 'phone: ' : '') + 'Chart settings has a "Paper trading" tab');
  await tab.first().click();
  await p.waitForSelector('.vela-dialog--settings .stkpt-set-ui .stkpt-switch input', { state: 'attached', timeout: 5000 });
  await sleep(250);
}
async function closeSettings(p) {
  await p.keyboard.press('Escape'); await sleep(250);
  if (await p.$('.vela-dialog--settings')) { const x = await p.$('.vela-dialog--settings [aria-label="Close"], .vela-dialog--settings .vela-sd-close'); if (x) await x.click().catch(() => {}); await sleep(250); }
}
// Flip the switch from the settings tab (a real click on the switch), returns the new state.
async function flipSwitch(p, phone, shot) {
  await openPaperTab(p, phone);
  const before = await p.evaluate(() => document.querySelector('.vela-dialog--settings .stkpt-switch input').checked);
  await p.click('.vela-dialog--settings .stkpt-switch');
  await sleep(400);
  const after = await p.evaluate(() => ({ sw: document.querySelector('.vela-dialog--settings .stkpt-switch input').checked, en: window.__stkPaper.enabled, note: document.querySelector('.vela-dialog--settings .stkpt-set-note').textContent }));
  if (shot) { await p.screenshot({ path: shot }); console.log('screenshot', shot); }
  await closeSettings(p);
  return Object.assign({ before }, after);
}
const paper = (p, fn, arg) => p.evaluate(fn, arg);
async function waitFor(p, fn, arg, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) { if (await p.evaluate(fn, arg).catch(() => false)) return true; await sleep(200); }
  return false;
}
const BROKER_RE = /rithmic|tradovate|ninjatrader|tradestation|interactivebrokers|ibkr|alpaca|oanda|tastytrade|tradier|projectx|topstepx|\/order(s)?\b|\/trade(s)?\/(place|submit)|\/api\/(paper|broker|order)/i;
// Site features that load with the chart page and are not paper trading: the Connect-broker 'is this provider set up' GET probes (/connect/<broker>/token?probe=1), broker logo images, the Vest symbol list.
const SITE_PROBES = /^http:\/\/127\.0\.0\.1:\d+\/(connect\/[\w-]+\/token\?probe=1$|assets\/images\/|api\/vest\/exchangeInfo$)/;
const ALLOWED = (u) => SITE_PROBES.test(u) || /^https:\/\/(api\.bitget\.com\/api\/v2\/mix\/market\/|api\.kraken\.com\/0\/public\/|book-recorder\.theelitegrey\.workers\.dev\/te-bars\?|cdn\.jsdelivr\.net\/npm\/)/.test(u) || /^https:\/\/(api\.bybit\.com\/v5\/market\/instruments-info|www\.okx\.com\/api\/v5\/public\/instruments|api\.bitget\.com\/api\/v2\/spot\/public\/symbols)/.test(u) || /^http:\/\/127\.0\.0\.1:\d+\/(assets\/|api\/chart\/(bars|stream)\/|api\/chart\/rt$|[\w-]+(\.html)?(\?|$)|manifest\.json|favicon)/.test(u)
  || /^https:\/\/(api\.binance\.com|data-api\.binance\.vision|api\.binance\.us)\/api\/v3\/(klines|exchangeInfo|ping|depth|trades|aggTrades|ticker)/.test(u)
  || /^wss:\/\/[^/]*binance[^/]*\//.test(u)
  || /^https:\/\/www\.gstatic\.com\/firebasejs\//.test(u) || /^https:\/\/api\.dicebear\.com\//.test(u)
  || /^https:\/\/api\.hyperliquid\.xyz\/info$/.test(u)
  // existing Charts market data / symbol metadata (not paper trading)
  || /^https:\/\/fapi\.binance\.com\/fapi\/v1\/(exchangeInfo|klines|ticker)/.test(u)
  || /^https:\/\/api\.exchange\.coinbase\.com\/products/.test(u)
  || /^https:\/\/crypto-icons\.ledger\.com\//.test(u);

async function newPage(b, BASE, opts, reqs) {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(stub);
  await ctx.addInitScript(RECORDER);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|api\.binance\.com|data-api\.binance\.vision|api\.binance\.us)/, (r) => { reqs.push({ url: r.request().url(), method: r.request().method(), blocked: true }); r.abort(); });
  await mockRoutes(ctx);
  ctx.on('request', (r) => reqs.push({ url: r.url(), method: r.method() }));
  ctx.on('websocket', (w) => reqs.push({ url: w.url(), method: 'WS' }));
  const p = await ctx.newPage();
  offset = T0 - Date.now();
  await p.clock.install({ time: new Date(T0) });
  const errors = [];
  const IGNORE = [/ERR_FAILED|ERR_INTERNET_DISCONNECTED|net::|status of 4|status of 5|Failed to fetch/i, /WebSocket connection to/];
  p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, p, errors };
}
async function boot(p, BASE) {
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
  await p.waitForFunction(() => window.__stkPaper.account, null, { timeout: 15000 });
  offset = (await p.evaluate(() => Date.now())) - Date.now();
  await sleep(1500);
}

const SYM = 'futures:NQ1!';
const stripOf = (p) => p.evaluate(() => {
  const s = document.getElementById('stkas'), vis = s && !s.hidden && s.getBoundingClientRect().width > 0;
  const q = (k) => { const i = s && s.querySelector('[data-k=' + k + ']'); const v = i && i.querySelector('.stkas-v'); return i ? { t: v.textContent, c: v.className.replace('stkas-v', '').trim(), tip: i.title, shown: i.getBoundingClientRect().width > 0 } : null; };
  const pill = document.querySelector('.mclock-pill'), bar = document.querySelector('.mobile-topnav'), sb = s && s.querySelector('.stkas-b');
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height, cy: (b.top + b.bottom) / 2 }; };
  return { vis: !!vis, bal: q('bal'), rp: q('rp'), up: q('up'), strip: r(sb), pill: r(pill), bar: r(bar), barOverflow: bar ? bar.scrollWidth > bar.clientWidth + 1 : null, barH: bar ? bar.getBoundingClientRect().height : null,
    pillVis: pill ? pill.getBoundingClientRect().width > 0 : false };
});
const num = (t) => Number(String(t).replace(/[$,+]/g, ''));
(async () => {
  const srv = await serve();
  const BASE = `http://127.0.0.1:${srv.address().port}`;
  const b = await launch({ args: ['--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  const reqs = [];
  try {
    for (const theme of (process.env.PHONE_ONLY ? [] : ['night', 'day'])) {
      const { ctx, p, errors } = await newPage(b, BASE, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, reqs);
      await p.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t); } catch (e) {} }, theme);
      await boot(p, BASE);
      await setMarket(p, SYM, '1');
      await waitFor(p, () => Number.isFinite(window.__stkPaper.account.last['futures:NQ1!']));
      await sleep(1500);
      const T = theme + ' 1440: ';
      let s = await stripOf(p);
      check(!s.vis, T + 'hidden with no account (Paper off)');
      check(s.pillVis, T + 'session pill still there');
      await p.evaluate(() => window.__stkPaper.setEnabled(true)); await sleep(700);
      s = await stripOf(p);
      check(s.vis, T + 'appears when Paper turns on');
      const eng0 = await p.evaluate(() => window.__stkPaper.account.summary(0));
      check(Math.abs(num(s.bal.t) - eng0.balance) < 0.01, T + 'Bal matches engine ' + s.bal.t + ' vs ' + eng0.balance);
      check(s.up.t === '$ --' && s.up.c === '', T + 'flat: UP&L is "$ --"');
      check(s.rp.t === '$0.00' && s.rp.c === '', T + 'RP&L neutral at 0: ' + s.rp.t);
      check(s.bal.tip === 'Balance' && s.rp.tip === 'Realized P&L today' && s.up.tip === 'Unrealized P&L on open positions', T + 'tooltips');
      // buy, move price up, then down
      const visOf = () => p.evaluate(() => ['stkc-pine-btn', 'stkc-tpl-btn'].map((id) => { const e = document.getElementById(id); return !!e && e.getBoundingClientRect().width > 0; }));
      let base = null;
      await p.evaluate((sym) => window.__stkPaper.placeOrder({ symbol: sym, side: 'buy', type: 'market', qty: 1 }), SYM); await sleep(800);
      px.futures += 20; await sleep(2500);
      s = await stripOf(p);
      let eng = await p.evaluate(() => window.__stkPaper.account.summary(new Date(new Date().setHours(0, 0, 0, 0)).getTime()));
      check(eng.unrealized > 0 && Math.abs(num(s.up.t) - eng.unrealized) < 0.01 && s.up.c === 'up', T + 'price up: UP&L ' + s.up.t + ' (' + s.up.c + ') = engine ' + eng.unrealized);
      if (theme === 'night') await p.screenshot({ path: OUT + '/acctstrip-1440-dark-up.png', clip: { x: 0, y: 0, width: 1440, height: 80 } });
      px.futures -= 40; await sleep(2500);
      s = await stripOf(p);
      eng = await p.evaluate(() => window.__stkPaper.account.summary(new Date(new Date().setHours(0, 0, 0, 0)).getTime()));
      check(eng.unrealized < 0 && Math.abs(num(s.up.t) - eng.unrealized) < 0.01 && s.up.c === 'down', T + 'price down: UP&L ' + s.up.t + ' (' + s.up.c + ') = engine ' + eng.unrealized);
      // alignment at 3 widths while a position is open
      for (const w of [1440, 1280, 1024]) {
        await p.setViewportSize({ width: w, height: 900 }); await sleep(900);
        const a = await stripOf(p);
        const row = { strip: a.strip, pill: a.pill };
        check(a.vis && a.pillVis && !a.barOverflow, T + w + ': bar one row, no overflow, strip + pill visible (barH ' + a.barH + ')');
        check(Math.abs(a.strip.cy - a.pill.cy) <= 1 && Math.abs(a.strip.h - a.pill.h) <= 1, T + w + ': strip/pill centre ' + a.strip.cy + '/' + a.pill.cy + ' height ' + a.strip.h + '/' + a.pill.h);
        const gap = a.pill.l - a.strip.r; check(gap >= 7 && gap <= 16 && gap % 4 < 1, T + w + ': gap strip->pill ' + gap + 'px (labels ' + (a.up.shown ? 'n/a' : '') + ')');
        const lab = await p.evaluate(() => getComputedStyle(document.querySelector('.stkas-l')).display);
        console.log('  ' + w + ' strip ' + JSON.stringify(a.strip) + ' pill ' + JSON.stringify(a.pill) + ' labels:' + lab);
        const pine = await visOf();
        if (!base) base = pine;
        check(pine.every((x, i) => x === base[i]), T + w + ': Pine + Templates visibility unchanged by the strip ' + JSON.stringify(pine) + ' vs ' + JSON.stringify(base));
        if (w === 1024) await p.screenshot({ path: OUT + '/acctstrip-1024-' + (theme === 'night' ? 'dark' : 'light') + '.png', clip: { x: 0, y: 0, width: 1024, height: 80 } });
      }
      await p.setViewportSize({ width: 1440, height: 900 }); await sleep(600);
      await p.screenshot({ path: OUT + '/acctstrip-1440-' + (theme === 'night' ? 'dark' : 'light') + '.png' });
      await p.screenshot({ path: OUT + '/acctstrip-crop-' + (theme === 'night' ? 'dark' : 'light') + '.png', clip: { x: 700, y: 0, width: 740, height: 70 } });
      // click opens Positions panel
      await p.click('.stkas-b'); await sleep(500);
      check(await p.evaluate(() => !!document.querySelector('.stkpt-toggle') && document.querySelector('.stkpt-toggle').getAttribute('aria-expanded') !== 'false'), T + 'click opens Positions & Orders panel');
      // close -> RP&L
      await p.evaluate((sym) => window.__stkPaper.closePos(sym), SYM); await sleep(2200);
      s = await stripOf(p);
      eng = await p.evaluate(() => window.__stkPaper.account.summary(new Date(new Date().setHours(0, 0, 0, 0)).getTime()));
      check(eng.dayPnl < 0 && Math.abs(num(s.rp.t) - eng.dayPnl) < 0.01 && s.rp.c === 'down', T + 'close: RP&L ' + s.rp.t + ' (' + s.rp.c + ') = engine ' + eng.dayPnl);
      check(s.up.t === '$ --', T + 'flat again: UP&L "$ --"');
      // off
      await p.evaluate(() => window.__stkPaper.setEnabled(false)); await sleep(600);
      s = await stripOf(p);
      check(!s.vis && s.pillVis, T + 'hides when Paper turns off');
      const gapOff = await p.evaluate(() => { const m = document.querySelector('.mclock').getBoundingClientRect(), r = document.querySelector('.topnav-right').getBoundingClientRect(); return Math.round(r.left - m.right); });
      console.log('  pill->right gap with strip hidden', gapOff);
      check(errors.length === 0, T + 'no console errors ' + JSON.stringify(errors.slice(0, 3)));
      await ctx.close();
    }
    // ---- phone 390 ----
    {
      const { ctx, p, errors } = await newPage(b, BASE, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, reqs);
      await boot(p, BASE); await setMarket(p, SYM, '1');
      await waitFor(p, () => Number.isFinite(window.__stkPaper.account.last['futures:NQ1!']));
      let s = await stripOf(p); check(!s.vis, 'phone: hidden with no account');
      await p.evaluate(() => window.__stkPaper.setEnabled(true)); await sleep(800);
      s = await stripOf(p);
      check(s.vis && s.bal.shown && !s.up.shown && !s.rp.shown, 'phone: one chip, Bal when flat ' + JSON.stringify([s.bal, s.up]));
      await p.evaluate((sym) => window.__stkPaper.placeOrder({ symbol: sym, side: 'buy', type: 'market', qty: 1 }), SYM); await sleep(800);
      px.futures += 20; await sleep(2500);
      s = await stripOf(p);
      check(s.vis && s.up.shown && !s.bal.shown && s.up.c === 'up', 'phone: chip shows UP&L (green) when in a position ' + JSON.stringify(s.up));
      check(!s.barOverflow, 'phone: header no overflow');
      await p.tap('.stkas-b'); await sleep(400);
      const pop = await p.evaluate(() => { const e = document.querySelector('.stkas-pop'); const r = e.getBoundingClientRect(); return { vis: !e.hidden && r.width > 0, rows: [...e.querySelectorAll('.stkas-row')].map((x) => x.textContent), l: r.left, r: r.right }; });
      check(pop.vis && pop.rows.length === 3 && pop.l >= 8 && pop.r <= 382, 'phone: tap opens popover with all three ' + JSON.stringify(pop));
      const row = await p.evaluate(() => [...document.querySelectorAll('#stkc-bar > *, #stkc-bar-l > *')].map((e) => { const r = e.getBoundingClientRect(); return (e.id || e.className.toString().slice(0, 18)) + ':' + Math.round(r.left) + '-' + Math.round(r.right) + (getComputedStyle(e).display === 'none' ? '(none)' : ''); }).join(' '));
      console.log('  phone bar', row);
      await p.screenshot({ path: OUT + '/acctstrip-390.png' });
      await p.tap('#stkc-bar .vela-mb-symbol, #stkc-bar'); await sleep(300);
      check(errors.length === 0, 'phone: no console errors ' + JSON.stringify(errors.slice(0, 3)));
      await ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close(); srv.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
