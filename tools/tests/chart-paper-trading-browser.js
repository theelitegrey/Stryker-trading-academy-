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

async function setMarket(p, sym, tf) {
  await p.evaluate(async ([sym, tf]) => {
    const ws = window.STRYKER_VELA;
    ws.active.setSymbol(sym); ws.active.setTimeframe(tf);
    const c = ws.chart;
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (c.market.symbol === sym && c.market.timeframe === tf && c.orchestrator.rawBars.length > 50) break; }
  }, [sym, tf]);
  await sleep(2000);
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
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
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
    // ================= desktop =================
    const { ctx, p, errors } = await newPage(b, BASE, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, reqs);
    await boot(p, BASE);
    await setMarket(p, 'futures:NQ1!', '1');
    check(await waitFor(p, () => Number.isFinite(window.__stkPaper.account.last['futures:NQ1!'])), 'NQ1! 1m: paper engine sees the live price');
    const lbl = await p.evaluate(() => document.querySelector('.stkpt-foot').textContent);
    check(/Paper trading · demo money · simulated fills/.test(lbl) && /Education only\. Not financial advice\./.test(lbl) && /Charts tab is open/.test(lbl), 'panel footer: label, disclaimer, "works while a Charts tab is open"');
    check(await p.evaluate(() => !!document.getElementById('stkc-paper-btn')), 'Trade button in the chart toolbar');

    // ---- market + bracket through the ticket ----
    await p.click('#stkc-paper-btn');
    await p.waitForSelector('#stkpt-tk:not([hidden])');
    const tag = await p.evaluate(() => document.querySelector('#stkpt-tk .stkpt-tag').textContent + ' | ' + document.querySelector('#stkpt-tk .stkpt-fine').textContent);
    check(/demo money · simulated fills/.test(tag) && /Not financial advice/.test(tag) && /Nothing is sent to any broker/.test(tag), 'ticket labelled paper / demo / no broker');
    await p.click('#stkpt-tk [data-side=buy]');
    await p.click('#stkpt-tk [data-type=market]');
    await p.fill('#stkpt-tk input[name=qty]', '2');
    await p.check('#stkpt-tk input[name=tpon]'); await p.check('#stkpt-tk input[name=slon]');
    await p.fill('#stkpt-tk input[name=tpv]', '40'); await p.fill('#stkpt-tk input[name=slv]', '20');
    await p.click('#stkpt-tk .stkpt-go');
    await waitFor(p, () => !!window.__stkPaper.account.position('futures:NQ1!'));
    const pos1 = await p.evaluate(() => JSON.parse(JSON.stringify(window.__stkPaper.account.position('futures:NQ1!'))));
    check(pos1 && pos1.side === 'buy' && pos1.qty === 2 && pos1.tp === pos1.avg + 10 && pos1.sl === pos1.avg - 5, `market BUY 2 NQ with bracket: avg ${pos1 && pos1.avg}, TP ${pos1 && pos1.tp} (+40 ticks), SL ${pos1 && pos1.sl} (-20 ticks)`);
    await sleep(800);
    // a line outside the visible price range is hidden (as on TradingView): check every line has
    // its chip and canvas line, and that the ones inside the pane are shown
    const chips = await p.evaluate(() => {
      const R = window.STRYKER_VELA.chart.renderer.renderer, l = R.extLayers.find((x) => x.def.id === 'stk_paper'), a = l.instance.args;
      const top = a.bounds.top, bot = top + a.bounds.height;
      return [...document.querySelectorAll('.stkpt-chip')].map((c) => {
        const line = a.data.lines.find((x) => x.id === c.dataset.id); const y = line ? a.coords.priceToY(line.price, a.scale, a.bounds) : NaN;
        const inside = y > top + 6 && y < bot - 6;
        return { id: c.dataset.id, txt: c.textContent, ok: !!line && (inside ? c.style.visibility !== 'hidden' : c.style.visibility === 'hidden'), inside };
      });
    });
    check(['pos', 'ptp', 'psl'].every((k) => chips.some((c) => c.id === k && c.ok)) && chips.some((c) => c.id === 'pos' && c.inside && /^LONG 2/.test(c.txt)), 'position, TP and SL lines on the chart with qty + P&L: ' + chips.map((c) => c.id + ':' + c.txt + (c.inside ? '' : ' (off-screen)')).join(' | '));
    const oneClick = await p.evaluate(() => { const o = document.querySelector('.stkpt-1c'); if (!o) return null; const r = o.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, q: o.querySelector('input').value, t: o.textContent }; });
    check(oneClick && oneClick.w > 100 && oneClick.x < 120 && /SELL/.test(oneClick.t) && /BUY/.test(oneClick.t), 'one-click SELL | qty | BUY top-left of the chart ' + JSON.stringify(oneClick));

    // ---- live P&L moves with the price ----
    const pnlA = await p.evaluate(() => window.__stkPaper.account.openPnl(window.__stkPaper.account.position('futures:NQ1!')));
    px.futures = pos1.avg + 2;
    await waitFor(p, (v) => window.__stkPaper.account.last['futures:NQ1!'] === v, pos1.avg + 2);
    await sleep(600);
    const live = await p.evaluate(() => ({ pnl: window.__stkPaper.account.openPnl(window.__stkPaper.account.position('futures:NQ1!')), chip: document.querySelector('.stkpt-chip[data-id=pos] .stkpt-chip-b').textContent }));
    check(live.pnl === 2 * 2 * 20 && live.chip === '+$80.00', `live P&L at +2 points x 2 NQ x $20 = $80 (engine ${live.pnl}, chip ${live.chip}; was ${pnlA})`);

    // ---- a buy limit that fills ----
    const lim = pos1.avg - 1;
    await p.evaluate((price) => window.__stkPaper.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price }), lim);
    const ord = await p.evaluate(() => window.__stkPaper.account.state.orders.map((o) => o.type + ' ' + o.side + ' ' + o.price));
    check(ord.length === 1 && ord[0] === 'limit buy ' + lim, 'buy limit working: ' + ord.join(','));
    check(await waitFor(p, () => !!document.querySelector('.stkpt-chip[data-kind=ord]')), 'order line on the chart');
    px.futures = lim - 0.5;
    const filled = await waitFor(p, () => window.__stkPaper.account.state.orders.length === 0 && window.__stkPaper.account.position('futures:NQ1!').qty === 3, null, 6000);
    const pos2 = await p.evaluate(() => JSON.parse(JSON.stringify(window.__stkPaper.account.position('futures:NQ1!'))));
    check(filled && Math.abs(pos2.avg - (pos1.avg * 2 + lim) / 3) < 0.01, `limit filled when price traded through ${lim}: qty 3, avg ${pos2.avg}`);

    // ---- right-click: paper limit/stop at the clicked price ----
    const box = await p.evaluate(() => { const R = window.STRYKER_VELA.chart.renderer.renderer; const r = R.input.el.getBoundingClientRect(); return { x: r.left + R.coords.width * 0.5, y: r.top + r.height * 0.3 }; });
    await p.mouse.click(box.x, box.y, { button: 'right' });
    await sleep(500);
    const menuTxt = await p.evaluate(() => [...document.querySelectorAll('[role=menuitem], [role=menu] *')].map((e) => e.textContent.trim()).filter((t) => /^Paper /.test(t)).filter((t, i, a) => a.indexOf(t) === i));
    check(menuTxt.some((t) => /^Paper Buy (limit|stop) \d+ @ /.test(t)) && menuTxt.some((t) => /^Paper Sell (limit|stop) \d+ @ /.test(t)), 'right-click menu: ' + menuTxt.join(' | '));
    await p.keyboard.press('Escape');

    // ---- drag the TP chip up ----
    const tp0 = pos2.tp;
    const chip = await p.evaluate(() => { const c = document.querySelector('.stkpt-chip[data-id=ptp]'); const r = c.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
    await p.mouse.move(chip.x, chip.y); await p.mouse.down();
    for (let i = 1; i <= 8; i++) { await p.mouse.move(chip.x, chip.y - i * 6); await sleep(30); }
    await p.mouse.up();
    await sleep(500);
    const tp1 = await p.evaluate(() => window.__stkPaper.account.position('futures:NQ1!').tp);
    check(tp1 > tp0, `dragged the TP line up: ${tp0} -> ${tp1}`);

    // ---- BTCUSDT: market + bracket, then a sell limit that fills ----
    await setMarket(p, 'binance:BTCUSDT', '1');
    check(await waitFor(p, () => Number.isFinite(window.__stkPaper.account.last['binance:BTCUSDT'])), 'BTCUSDT 1m: paper engine sees the live price');
    const bLast = await p.evaluate(() => window.__stkPaper.account.last['binance:BTCUSDT']);
    await p.evaluate((l) => window.__stkPaper.placeOrder({ symbol: 'binance:BTCUSDT', side: 'buy', type: 'market', qty: 0.5, tp: l + 500, sl: l - 500 }), bLast);
    const bpos = await p.evaluate(() => JSON.parse(JSON.stringify(window.__stkPaper.account.position('binance:BTCUSDT'))));
    check(bpos && bpos.qty === 0.5 && bpos.tp === +(bLast + 500).toFixed(2), `market BUY 0.5 BTC with bracket @ ${bpos && bpos.avg}`);
    await p.evaluate(() => window.__stkPaper.openPanel('positions'));
    await sleep(400);
    const rows = await p.evaluate(() => [...document.querySelectorAll('#stkpt tr[data-sym]')].map((r) => r.dataset.sym));
    check(rows.includes('futures:NQ1!') && rows.includes('binance:BTCUSDT'), 'Positions tab lists both symbols after switching: ' + rows.join(', '));
    // desktop screenshot: BTC position + panel
    await p.evaluate(() => window.__stkPaper.placeOrder({ symbol: 'binance:BTCUSDT', side: 'sell', type: 'limit', qty: 0.5, price: window.__stkPaper.account.last['binance:BTCUSDT'] + 200 }));
    await sleep(900);
    const shotD = `${OUT}/chart-paper-1280.png`;
    await p.screenshot({ path: shotD }); console.log('screenshot', shotD);
    px.binance = bLast + 250;
    const bFill = await waitFor(p, () => !window.__stkPaper.account.position('binance:BTCUSDT') && window.__stkPaper.account.state.orders.length === 0, null, 6000);
    const bTrade = await p.evaluate(() => window.__stkPaper.account.state.trades.slice(-1)[0]);
    check(bFill && bTrade && bTrade.symbol === 'binance:BTCUSDT' && bTrade.pnl === +((bTrade.exit - bTrade.entry) * 0.5).toFixed(2) && bTrade.pnl > 0, `sell limit filled above the price and closed the BTC long: P&L ${bTrade && bTrade.pnl} (per unit)`);

    // ---- close NQ from the chart chip × (NQ not on a chart now: switch back) ----
    await setMarket(p, 'futures:NQ1!', '1');
    await waitFor(p, () => !!document.querySelector('.stkpt-chip[data-id=pos] .stkpt-chip-x'));
    await p.click('.stkpt-chip[data-id=pos] .stkpt-chip-x');
    await waitFor(p, () => !window.__stkPaper.account.position('futures:NQ1!'));
    const t = await p.evaluate(() => window.__stkPaper.account.state.trades.slice(-1)[0]);
    const expect = +((t.exit - t.entry) * 3 * 20).toFixed(2);
    check(t && t.symbol === 'futures:NQ1!' && t.qty === 3 && t.pnl === expect, `closed 3 NQ from the chip ×: P&L ${t.pnl} = (exit ${t.exit} - entry ${t.entry}) x 3 x $20`);
    const sounds = await p.evaluate(() => window.__simSounds.filter((s) => /:paper$/.test(s)));
    check(sounds.includes('long:paper') && sounds.includes('closed:paper'), 'chart-sounds events fired for paper fills: ' + sounds.join(', '));
    // journal offer -> send
    check(await waitFor(p, () => !!document.querySelector('.stkpt-offer button.stkpt-b-pri')), '"Send to Journal" offer after the close');
    // the newest offer is the NQ close (the BTC one, if still shown, is above it)
    await p.evaluate(() => { const o = [...document.querySelectorAll('.stkpt-offer')].pop(); o.querySelector('button.stkpt-b-pri').click(); });
    await waitFor(p, () => JSON.parse(localStorage.getItem('__test_journal_writes') || '[]').some((x) => x.instrument === 'NQ'));
    const jw = await p.evaluate(() => JSON.parse(localStorage.getItem('__test_journal_writes') || '[]').find((x) => x.instrument === 'NQ'));
    check(jw && jw.instrument === 'NQ' && jw.direction === 'long' && jw.pnl === expect && jw.source === 'paper' && (jw.tags || []).includes('paper'), `journal doc written: ${jw && jw.instrument} ${jw && jw.direction} pnl ${jw && jw.pnl} (point value applied)`);

    // ---- History tab ----
    await p.evaluate(() => window.__stkPaper.openPanel('history'));
    await sleep(300);
    const hist1 = await p.evaluate(() => document.querySelector('#stkpt .stkpt-view').textContent);
    check(/Closed trades/.test(hist1) && /NQ1!/.test(hist1) && /BTCUSDT/.test(hist1) && /✓ Journal/.test(hist1), 'History lists both closed trades, NQ marked as journaled');

    // ---- closed market: market rejected, limit waits ----
    const closed = await p.evaluate(() => {
      const MH = window.StrykerMarketHours, orig = MH.futuresStatus;
      MH.futuresStatus = () => ({ open: false, until: Date.now() + 3600e3 });
      window.__toasts.length = 0;
      const r1 = window.__stkPaper.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 });
      const msg = (window.__toasts.find((x) => x.type === 'error') || {}).msg || '';
      const l = window.__stkPaper.account.last['futures:NQ1!'];
      const r2 = window.__stkPaper.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: l - 3 });
      return { r1, msg, r2: !!(r2 && r2.order), id: r2 && r2.order && r2.order.id, lim: l - 3, restore: (MH.__orig = orig, true) };
    });
    px.futures = closed.lim - 1;
    await sleep(1500);
    const still = await p.evaluate((id) => !!window.__stkPaper.account.state.orders.find((o) => o.id === id) && !window.__stkPaper.account.position('futures:NQ1!'), closed.id);
    check(closed.r1 === null && /Market closed/.test(closed.msg) && closed.r2 && still, 'market closed: market order rejected ("' + closed.msg.slice(0, 60) + '…"), limit placed and NOT filled while closed');
    await p.evaluate(() => { const MH = window.StrykerMarketHours; MH.futuresStatus = MH.__orig; });
    await p.evaluate((id) => window.__stkPaper.cancelOrder(id), closed.id);
    px.futures = closed.lim + 3;

    // leave one working order + position for the persistence check
    await sleep(800);
    await p.evaluate(() => { const l = window.__stkPaper.account.last['futures:NQ1!']; window.__stkPaper.placeOrder({ symbol: 'futures:NQ1!', side: 'sell', type: 'market', qty: 1, sl: l + 8 }); window.__stkPaper.placeOrder({ symbol: 'futures:NQ1!', side: 'sell', type: 'limit', qty: 2, price: l + 20 }); });
    await sleep(1800);   // debounced cloud save
    const before = await p.evaluate(() => { const s = window.__stkPaper.account.summary(); const a = window.__stkPaper.account.state; return { bal: s.balance, trades: a.trades.length, orders: a.orders.length, pos: Object.keys(a.positions).join(','), j: a.trades.filter((x) => x.journaled).length }; });
    const cloud = await p.evaluate(() => JSON.parse(localStorage.getItem('__test_cloud_paper') || 'null'));
    check(cloud && cloud.keys.join(',') === 'state,updatedAt' && typeof cloud.state === 'string' && cloud.state.length < 400000, 'cloud doc students/u1/paperTrading/account = { state (JSON string), updatedAt } (matches the new rules block)');

    // ---- reload: persisted (local copy) ----
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkPaper && window.__stkPaper.account, null, { timeout: 60000 });
    const after = await p.evaluate(() => { const s = window.__stkPaper.account.summary(); const a = window.__stkPaper.account.state; return { bal: s.balance, trades: a.trades.length, orders: a.orders.length, pos: Object.keys(a.positions).join(','), j: a.trades.filter((x) => x.journaled).length }; });
    check(JSON.stringify(after) === JSON.stringify(before), 'reload keeps the account (local): ' + JSON.stringify(after));
    // ---- reload with the local copy gone: cloud copy ----
    await p.evaluate(() => localStorage.removeItem('stryker_paper_u1'));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkPaper && window.__stkPaper.account, null, { timeout: 60000 });
    await sleep(500);
    const after2 = await p.evaluate(() => { const s = window.__stkPaper.account.summary(); const a = window.__stkPaper.account.state; return { bal: s.balance, trades: a.trades.length, orders: a.orders.length, pos: Object.keys(a.positions).join(','), j: a.trades.filter((x) => x.journaled).length }; });
    check(JSON.stringify(after2) === JSON.stringify(before), 'reload with no local copy loads the cloud copy: ' + JSON.stringify(after2));

    // ---- TWO Charts tabs (same browser): exactly one fills, both end on the same account ----
    {
      const p2 = await ctx.newPage();
      await p2.clock.install({ time: new Date(T0) });
      p2.on('pageerror', (e) => errors.push('tab2: ' + e));
      await boot(p2, BASE);
      await setMarket(p2, 'futures:NQ1!', '1');
      await sleep(3500);   // two leader ticks + confirm
      const leaders = [await p.evaluate(() => window.__stkPaper.leader), await p2.evaluate(() => window.__stkPaper.leader)];
      check(leaders.filter(Boolean).length === 1, 'two tabs: exactly one fill leader ' + JSON.stringify(leaders));
      const l2 = await p2.evaluate(() => window.__stkPaper.account.last['futures:NQ1!']);
      // the order is placed in the tab that is NOT the leader, so the fill must come from the other one
      const placer = leaders[0] ? p2 : p;
      const oid = await placer.evaluate((lim) => { const r = window.__stkPaper.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: lim }); return r && r.order && r.order.id; }, l2 - 4);
      await sleep(800);
      px.futures = l2 - 6;
      await sleep(2500);
      const view = (pg) => pg.evaluate((id) => { const a = window.__stkPaper.account.state; return { fills: a.history.filter((h) => h.kind === 'fill' && h.orderId === id).length, working: a.orders.some((o) => o.id === id), savedAt: a.savedAt }; }, oid);
      const v1 = await view(p), v2 = await view(p2);
      check(oid && v1.fills === 1 && v2.fills === 1 && !v1.working && !v2.working, 'two tabs: order placed in the follower filled ONCE and both tabs agree ' + JSON.stringify({ oid, v1, v2 }));
      // and a hand-made race: both tabs see the same price move while the leader key is free
      await p.evaluate(() => localStorage.removeItem('stryker_paper_leader'));
      await p2.evaluate(() => localStorage.removeItem('stryker_paper_leader'));
      await sleep(2500);
      const leaders2 = [await p.evaluate(() => window.__stkPaper.leader), await p2.evaluate(() => window.__stkPaper.leader)];
      check(leaders2.filter(Boolean).length === 1, 'two tabs: after the leader slot is freed, one leader again ' + JSON.stringify(leaders2));
      await p2.close();
      px.futures = l2 - 6;
    }

    // ---- optional soak: PAPER_SOAK_S=600 (10 min) with a position, a bracket and a working order ----
    const SOAK = Number(process.env.PAPER_SOAK_S || 0);
    if (SOAK > 0) {
      const cdp = await ctx.newCDPSession(p);
      const probe = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        const hu = await cdp.send('Runtime.getHeapUsage');
        const m = await p.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, chips: document.querySelectorAll('.stkpt-chip').length, oneclick: document.querySelectorAll('.stkpt-1c').length, offers: document.querySelectorAll('.stkpt-offer').length }));
        const { result } = await cdp.send('Runtime.evaluate', { expression: 'window', objectGroup: 'soak' });
        const ls = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: -1 }).catch(() => ({ listeners: [] }));
        await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'soak' });
        m.listeners = ls.listeners.length; m.heap = hu.usedSize;
        return m;
      };
      const t0 = await probe();
      const end = Date.now() + SOAK * 1000;
      let k = 0;
      while (Date.now() < end) { px.futures += (k++ % 20 < 10 ? 0.25 : -0.25); await sleep(1000); }
      const t1 = await probe();
      console.log('soak', SOAK + 's', JSON.stringify({ start: t0, end: t1 }));
      check(t1.chips <= t0.chips + 2 && t1.oneclick === t0.oneclick && t1.nodes < t0.nodes * 1.05 + 200 && t1.listeners <= t0.listeners + 20 && t1.heap < t0.heap * 1.3 + 8e6, `soak ${SOAK}s: no growth in chips/one-click/nodes/listeners/heap`);
    }
    check(errors.length === 0, 'desktop console errors: ' + (errors.slice(0, 4).join(' | ') || 'none'));
    await ctx.close();

    // ================= phone 390 =================
    const ph = await newPage(b, BASE, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, reqs);
    await boot(ph.p, BASE);
    await setMarket(ph.p, 'futures:NQ1!', '1');
    await waitFor(ph.p, () => Number.isFinite(window.__stkPaper.account.last['futures:NQ1!']));
    await ph.p.evaluate(() => { const l = window.__stkPaper.account.last['futures:NQ1!']; window.__stkPaper.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1, tp: l + 15, sl: l - 8 }); window.__stkPaper.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: l - 4 }); });
    await sleep(1200);
    const shotC = `${OUT}/chart-paper-390-chart.png`;
    await ph.p.screenshot({ path: shotC }); console.log('screenshot', shotC);
    await ph.p.click('#stkpt .stkpt-toggle');
    await sleep(500);
    const sheet = await ph.p.evaluate(() => { const r = document.getElementById('stkpt').getBoundingClientRect(); const docW = document.documentElement.scrollWidth; const btns = [...document.querySelectorAll('#stkpt .stkpt-b, #stkpt [role=tab]')].map((x) => x.getBoundingClientRect().height); return { top: r.top, h: r.height, w: r.width, docW, minBtn: Math.min(...btns), pos: getComputedStyle(document.getElementById('stkpt')).position }; });
    check(sheet.pos === 'fixed' && sheet.w <= 390 && sheet.docW <= 390 && sheet.minBtn >= 34 && sheet.h < 844 * 0.75, 'phone: Paper trading opens as a bottom sheet, no overflow, thumb-size buttons ' + JSON.stringify(sheet));
    const shotS = `${OUT}/chart-paper-390-sheet.png`;
    await ph.p.screenshot({ path: shotS }); console.log('screenshot', shotS);
    await ph.p.click('#stkpt .stkpt-trade');
    await ph.p.waitForSelector('#stkpt-tk:not([hidden])');
    await ph.p.check('#stkpt-tk input[name=tpon]');
    await sleep(300);
    const shotT = `${OUT}/chart-paper-390-ticket.png`;
    await ph.p.screenshot({ path: shotT }); console.log('screenshot', shotT);
    check(ph.errors.length === 0, 'phone console errors: ' + (ph.errors.slice(0, 4).join(' | ') || 'none'));
    await ph.ctx.close();

    // ================= network: no broker / order endpoints =================
    // Static page code (e.g. assets/rithmic-config.js, the existing market-data "Connect broker"
    // flag module that every Charts load imports) is not a call to a broker; every other URL is.
    const broker = reqs.filter((r) => BROKER_RE.test(r.url) && !/^http:\/\/127\.0\.0\.1:\d+\/assets\/[\w.-]+\.js(\?|$)/.test(r.url));
    // the only non-GET the page makes is Hyperliquid's market-data info endpoint (existing data dots)
    const nonGet = reqs.filter((r) => !r.blocked && r.method !== 'GET' && r.method !== 'WS' && !/^https:\/\/api\.hyperliquid\.xyz\/info$/.test(r.url));
    const unknown = reqs.filter((r) => !r.blocked && !ALLOWED(r.url));
    // and the paper modules themselves contain no network primitive at all
    const src = fs.readFileSync(path.join(ROOT, 'assets/chart-paper.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'assets/paper-engine.js'), 'utf8');
    const prim = (src.match(/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(|new\s+(WebSocket|XMLHttpRequest|EventSource)\b/g) || []);
    check(prim.length === 0, 'paper modules use no fetch / XHR / WebSocket / beacon (market data comes from the chart provider, storage from Firestore)' + (prim.length ? ': ' + prim.join(',') : ''));
    check(broker.length === 0, 'no request to any broker / order endpoint (' + reqs.length + ' requests seen)' + (broker.length ? ': ' + broker.slice(0, 3).map((x) => x.url).join(' ') : ''));
    check(nonGet.length === 0, 'no non-GET request at all' + (nonGet.length ? ': ' + nonGet.slice(0, 3).map((x) => x.method + ' ' + x.url).join(' ') : ''));
    check(unknown.length === 0, 'every request is page assets or chart market data' + (unknown.length ? ': ' + [...new Set(unknown.map((x) => x.url.slice(0, 90)))].slice(0, 5).join(' ') : ''));
  } finally {
    timers.forEach(clearInterval);
    await b.close();
    srv.close();
  }
  console.log(`\n${fail} failures`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
