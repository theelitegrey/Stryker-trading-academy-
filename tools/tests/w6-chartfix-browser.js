// Charts PAPER TRADING browser test (Owner order 2026-10-12, assets/chart-paper.js).
//
// Offline and deterministic: the futures bars endpoint + stream bridge and Binance REST + kline
// WebSocket are mocked from a price the test controls (px.futures / px.binance), so fills are
// triggered on purpose. Firebase is the rich stub, with the paper account doc and the journal
// collection recorded so the cloud copy and the journal hook can be asserted.
//
// Desktop 1280x800, NQ1! 1m then BTCUSDT 1m:
//   - Trade button -> ticket: market BUY 2 NQ with a bracket (TP 40 ticks / SL 20 ticks)
//   - a buy limit below the price that FILLS when the mock price trades down through it
//   - one-click Buy/Sell is on the chart; right-click shows "Paper Buy limit/stop @ price"
//   - drag the TP chip up -> the position's take profit moves up
//   - BTCUSDT: market buy 0.5 + sell limit above that fills (TP-like exit), multi-symbol panel
//   - close NQ from the chip ×, the trade lands in History, "Send to Journal" writes the journal
//     doc with the point-value P&L
//   - closed market: a market order is rejected with a clear message, a limit waits
//   - reload -> the account is still there (local copy), and again with the local copy deleted
//     (cloud copy, students/u1/paperTrading/account)
//   - NO request to any broker / order endpoint, and no non-GET request at all
// Phone 390x844: bottom sheet + ticket screenshots.
// "Enable paper trading" switch (Owner order 2026-10-14, Chart settings → Paper trading): OFF by
// default -> no one-click buttons, panel, Trade button, lines or right-click paper items; switched
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
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

const TF_MIN = { '1': 1, '5': 5, '15': 15, '30': 30, '60': 60, '120': 120, '240': 240, D: 1440 };
const PAGE_SECS = { '1': 8 * H, '5': 2 * D, '15': 5 * D, '30': 10 * D, '60': 20 * D, '120': 40 * D, '240': 60 * D, D: 730 * D };
const timers = [];
async function mockRoutes(ctx) {
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
    const row = (b) => [b.t / 1000, b.o + 0.12, b.h + 0.12, b.l + 0.12, b.c + 0.12, b.v];
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
  return { enabled: window.__stkPaper.enabled, cls: document.documentElement.classList.contains('stkpt-on'), panel: vis(document.getElementById('stkpt')), trade: vis(document.getElementById('stkc-paper-btn')),
    oneClick: [...document.querySelectorAll('.stkpt-1c')].filter(vis).length, chips: [...document.querySelectorAll('.stkpt-chip')].filter(vis).length, lines };
});
const allHidden = (u) => !u.enabled && !u.cls && !u.panel && !u.trade && u.oneClick === 0 && u.chips === 0 && u.lines === 0;
// Opens Chart settings (top-bar gear; ☰ tab list on a phone) on the "Paper trading" tab.
async function openPaperTab(p, phone) {
  // phone (build 537): the slim TradingView-style row keeps the gear behind ⋯ More
  if (!(await p.isVisible('#stkc-settings-btn'))) { await p.click('#stkc-more-btn'); await sleep(200); }
  await p.click('#stkc-settings-btn');
  await p.waitForSelector('.vela-dialog--settings .vela-sd-rail', { state: 'attached', timeout: 10000 });
  await sleep(300);
  if (phone && await p.$('.vela-dialog--settings .vela-sd-burger')) { await p.click('.vela-dialog--settings .vela-sd-burger'); await sleep(300); }
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
const ALLOWED = (u) => /^http:\/\/127\.0\.0\.1:\d+\/(assets\/|api\/chart\/(bars|stream)\/|[\w-]+(\.html)?(\?|$)|manifest\.json|favicon)/.test(u)
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


(async () => {
  const srv = await serve();
  const BASE = `http://127.0.0.1:${srv.address().port}`;
  const b = await launch({ args: ['--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  const reqs = [];
  try {
    for (const mob of [false, true]) {
      const tag = mob ? '390' : '1440';
      const { ctx, p, errors } = await newPage(b, BASE, mob ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }, reqs);
      await ctx.route(/book-recorder[^/]*\/orderflow/, (r) => r.fulfill({ status: 503, body: 'down' }));
      await boot(p, BASE);
      await setMarket(p, 'futures:NQ1!', '1');
      await p.evaluate(() => window.__stkPaper.setEnabled ? window.__stkPaper.setEnabled(true) : null);
      await p.evaluate(() => { try { const k = 'stryker_paper_u1'; const j = JSON.parse(localStorage.getItem(k) || '{}'); j.settings = Object.assign(j.settings || {}, { enabled: true, oneClick: true }); localStorage.setItem(k, JSON.stringify(j)); } catch (e) {} });
      await p.reload({ waitUntil: 'domcontentloaded' }); await boot(p, BASE); await setMarket(p, 'futures:NQ1!', '1');
      await sleep(3000);
      const r = await p.evaluate(() => {
        const R = window.STRYKER_VELA.chart.renderer.renderer, bars = window.STRYKER_VELA.chart.orchestrator.rawBars, lb = bars[bars.length - 1];
        const oc = [...document.querySelectorAll('.stkpt-1c b')].map((e) => e.textContent);
        const all = bars.slice(-300).every((x) => [x.open, x.high, x.low, x.close].every((v) => Math.abs(v * 4 - Math.round(v * 4)) < 1e-6));
        return { last: lb.close, allTick: all, oc, acct: window.__stkPaper.account.last['futures:NQ1!'], enabled: window.__stkPaper.enabled };
      });
      console.log(tag, JSON.stringify(r));
      check(r.allTick, tag + ': every bar price is a 0.25 multiple');
      check(r.acct === r.last, tag + ': paper last == chart last ' + r.acct + ' / ' + r.last);
      check(r.oc.length === 2 && r.oc.every((t) => Number(t.replace(/,/g, '')) === r.last), tag + ': ticket Sell/Buy show chart price ' + r.oc);
      await p.evaluate(() => window.STRYKER_VELA.active.setPriceStyle && window.STRYKER_VELA.active.setPriceStyle('stk_fp'));
      await sleep(2500);
      await p.screenshot({ path: OUT + '/w6-' + tag + '-footprint-down.png' }); console.log('shot', OUT + '/w6-' + tag + '-footprint-down.png');
      const fb = await p.evaluate(() => { const o = document.querySelector('.stkpt-1c').getBoundingClientRect(); const f = document.querySelector('.stk-fb'); const fr = f && !f.hidden ? f.getBoundingClientRect() : null; return { oc: [o.left, o.top, o.right, o.bottom], fb: fr && [fr.left, fr.top, fr.right, fr.bottom] }; });
      console.log(tag, JSON.stringify(fb));
      check(!fb.fb || fb.fb[1] >= fb.oc[3] || fb.fb[0] >= fb.oc[2] || fb.fb[2] <= fb.oc[0], tag + ': favbar not over ticket');
      check(!errors.length, tag + ': no page errors ' + errors.slice(0, 2).join('|'));
      await ctx.close();
    }
  } finally { await b.close(); srv.close(); }
  console.log(fail ? fail + ' failures' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
