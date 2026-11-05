// STOCKS ENGINE browser test with a FIXTURE provider (no Worker, no key, no network): the REAL server engine
// (workers/book-recorder/src/stock-engine.js) answers /sk-bars + /sk-search inside this process, fed by a fake provider.
//   node tools/tests/chart-dev-server.mjs 8056 &   CHART_BASE=http://127.0.0.1:8056 node tools/tests/stocks-engine-browser.js <shotsDir>
// Opens stocks:NASDAQ:AAPL, stocks:AMEX:SPY, stocks:NSE:RELIANCE, stocks:XETR:SAP on 1m / 5m / 1D: bars load (right grid, ascending,
// the fixture's prices), scroll-back loads older bars, a quote moves the forming candle (live lane), the delayed lane ends 10 min
// back, the symbol search finds a stock the page did not know, and no page errors. Shots at 390 + 1440, dark.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8056', OUT = process.argv[2] || '/tmp/sk-shots';
fs.mkdirSync(OUT, { recursive: true });
const V = JSON.parse(fs.readFileSync(__dirname + '/../../assets/version.json', 'utf8')).build;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const log = (m) => console.log('.. ' + m);
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
const MIN = 60000, DAY = 86400000;
const FIX = {
  'NASDAQ:AAPL': { p: 230, tz: 'America/New_York', type: 'STOCK', d: 'Apple Inc.', sess: '0930-1600', ext: '0400-2000' },
  'AMEX:SPY': { p: 600, tz: 'America/New_York', type: 'FUND', d: 'SPDR S&P 500 ETF Trust', sess: '0930-1600', ext: '0400-2000' },
  'NSE:RELIANCE': { p: 1450, tz: 'Asia/Kolkata', type: 'STOCK', d: 'Reliance Industries Ltd', sess: '0915-1530', ext: '0915-1530' },
  'XETR:SAP': { p: 210, tz: 'Europe/Berlin', type: 'STOCK', d: 'SAP SE', sess: '0900-1730', ext: '0800-2200' }
};
// deterministic bars: close = base + small wave by index, on the requested grid, ending at the bar holding `now`
function series(code, bt, n, dp, now) {
  const f = FIX[code], ms = bt === 'second' ? n * 1000 : bt === 'minute' ? n * MIN : bt === 'day' ? DAY : bt === 'week' ? 7 * DAY : 30 * DAY;
  const last = Math.floor(now / ms) * ms, N = Math.min(dp, 3000), rows = [];
  for (let i = 0; i < N; i++) { const t = last - (N - 1 - i) * ms, c = +(f.p + Math.sin(i / 9) * f.p * 0.01).toFixed(2); rows.push([t / 1000, c, +(c * 1.001).toFixed(2), +(c * 0.999).toFixed(2), c, 1000 + i]); }
  return { series_keys: ['time', 'open', 'high', 'low', 'close', 'volume'], series: rows };
}
let calls = [];
async function fakeProvider(url) {
  url = String(url); calls.push(url);
  const now = Date.now();
  let m = /\/symbols\/([^/]+)\/session/.exec(url);
  if (m) { const c = decodeURIComponent(m[1]), f = FIX[c]; if (!f) return new Response('{}', { status: 404 }); return Response.json({ type: f.type, description: f.d, currency_code: c.startsWith('NSE') ? 'INR' : c.startsWith('XETR') ? 'EUR' : 'USD', timezone: f.tz, tick_size: '0.01', price_scale: 100, start_hour: f.ext.slice(0, 4), end_hour: f.ext.slice(5), details: [{ session: f.sess, description: 'Regular Trading Hours' }] }); }
  if (/\/symbols\/search/.test(url)) { const q = new URL(url).searchParams.get('query').toUpperCase(); return Response.json({ symbols: Object.entries(FIX).filter(([c, f]) => c.includes(q) || f.d.toUpperCase().includes(q)).map(([c, f]) => ({ code: c, name: c.split(':')[1], type: f.type, exchange: c.split(':')[0], country: '', currency_code: 'USD', description: f.d })) }); }
  m = /\/symbols\/([^/]+)\/series\?bar_type=(\w+)&bar_interval=(\d+)&dp=(\d+)/.exec(url);
  if (m) { const c = decodeURIComponent(m[1]); if (!FIX[c]) return new Response('{}', { status: 404 }); return Response.json(series(c, m[2], +m[3], +m[4], now)); }
  return new Response('{}', { status: 404 });
}

(async () => {
  const SE = await import(path.join(__dirname, '../../workers/book-recorder/src/stock-engine.js'));
  const mem = () => { const s = new Map(), i = new Map(); return { get: (c, t) => s.get(c + '|' + t) || null, put: (c, t, at, f) => s.set(c + '|' + t, { at, f }), info: (c) => i.get(c) || null, putInfo: (c, at, j) => i.set(c, { at, j }), count: () => s.size, prune() {} }; };
  const E = new SE.StockEngine(mem(), { key: 'K', fetch: fakeProvider, DAY_MAX: 500, MIN_MAX: 30, CONC: 3 });
  const route = async (r) => {
    const req = r.request(), u = new URL(req.url()), auth = req.headers()['authorization'] || '';
    const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: h });
    const live = auth === 'Bearer test-token', spend = !!auth;
    try {
      if (u.pathname === '/sk-search') return r.fulfill({ status: 200, headers: h, body: JSON.stringify({ r: await E.search(u.searchParams.get('q'), spend) }) });
      if (u.pathname === '/sk-bars') {
        const now = Date.now(), lane = live ? 'live' : 'delayed';
        const out = await E.bars(u.searchParams.get('code'), u.searchParams.get('tf'), { to: Number(u.searchParams.get('to')) || 0, limit: Number(u.searchParams.get('limit')) || 500, cut: SE.skCut(lane, now), spend });
        if (!out) return r.fulfill({ status: 400, headers: h, body: '{}' });
        if (out.refused) return r.fulfill({ status: 404, headers: h, body: '{}' });
        return r.fulfill({ status: 200, headers: h, body: JSON.stringify(Object.assign(out, { lane, now })) });
      }
    } catch (e) { return r.fulfill({ status: e && e.signin ? 401 : 502, headers: h, body: '{}' }); }
    return r.fulfill({ status: 404, headers: h, body: '{}' });
  };
  const b = await launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(stub);
    await ctx.addInitScript(() => { window.__STK_BOOK_RECORDER = 'https://sk.fixture.test'; try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', 'night'); } catch (e) {} });
    await ctx.route(/^https:\/\/sk\.fixture\.test\//, route);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|sk\.fixture\.test|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage(), errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 90000 });
    await p.evaluate(async (v) => { (await import('/assets/rt-access.js?v=' + v))._rtSetForTests(true, 'test-token'); }, V);
    const load = (sym, tf) => p.evaluate(async ([sym, tf]) => {
      const ws = window.STRYKER_VELA; ws.active.setSymbol(sym); ws.active.setTimeframe(tf);
      for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 300)); const o = ws.chart.orchestrator; if (ws.chart.market.symbol === sym && String(ws.chart.market.timeframe) === tf && o.rawBars.length > 20) break; }
      return { sym: ws.chart.market.symbol, tf: String(ws.chart.market.timeframe), bars: ws.chart.orchestrator.rawBars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume]) };
    }, [sym, tf]);
    const step = { '1': MIN, '5': 5 * MIN, 'D': DAY };
    for (const code of Object.keys(FIX)) for (const tf of ['1', '5', 'D']) {
      const g = await load('stocks:' + code, tf), bs = g.bars;
      let asc = true, grid = true; for (let i = 1; i < bs.length; i++) { if (!(bs[i][0] > bs[i - 1][0])) asc = false; if ((bs[i][0] - bs[i - 1][0]) % step[tf]) grid = false; }
      const f = FIX[code], inRange = bs.length && bs.every((x) => x[4] > f.p * 0.97 && x[4] < f.p * 1.03);
      check(g.sym === 'stocks:' + code && bs.length >= 100 && asc && grid && inRange, code + ' ' + tf + ': ' + bs.length + ' bars, ascending, on the ' + tf + ' grid, fixture prices', { sym: g.sym, n: bs.length, asc, grid, inRange, last: bs[bs.length - 1] });
      if (tf === '1') check(Date.now() - bs[bs.length - 1][0] < 3 * MIN, code + ' 1m (live lane): newest bar is the current minute', bs[bs.length - 1]);
    }
    log('scroll-back');
    // scroll-back: the provider gives the bars before the first one on screen
    await load('stocks:NASDAQ:AAPL', '5');
    const back2 = await p.evaluate(async () => { const ws = window.STRYKER_VELA, pr = ws.feed.providerInstance('stocks'); const first = ws.chart.orchestrator.rawBars[0].time; const older = await pr.getBars('NASDAQ:AAPL', '5', { to: first - 1, limit: 300 }); return { first, n: older.length, lastOlder: older.length ? older[older.length - 1].time : null }; });
    check(back2.n === 300 && back2.lastOlder < back2.first, 'scroll-back: 300 older AAPL 5m bars before the first one on screen', back2);
    log('live');
    // live update: a quote moves the forming 1m candle on the page (via the server tail)
    await load('stocks:NASDAQ:AAPL', '1');
    E.onQuote({ code: 'NASDAQ:AAPL', last_price: 240.55, volume: 999999, lp_time: Date.now() / 1000 });
    E.want.set('NASDAQ:AAPL', Date.now());
    let moved = null;
    for (let i = 0; i < 30 && !moved; i++) { await sleep(1000); moved = await p.evaluate(() => { const b = window.STRYKER_VELA.chart.orchestrator.rawBars; const x = b[b.length - 1]; return x && x.close === 240.55 ? [x.time, x.close, x.high] : null; }); }
    check(!!moved && moved[2] >= 240.55, 'live: a quote moves the forming 1m candle within 30 s (close 240.55, high raised)', moved);
    // the data dot says "Updated N s ago" + the exchange timezone, never "real-time"
    await sleep(1500);
    const dot = await p.evaluate(() => { const d = document.querySelector('.stkc-dd'); return d ? { tag: d.textContent, tip: d.dataset.tip || '' } : null; });
    check(!!dot && /Updated/.test(dot.tag + dot.tip) && /New York/.test(dot.tip) && !/real-?time/i.test(dot.tag + dot.tip), 'data dot: "Updated N s ago" + the exchange timezone, no "real-time" wording', dot);
    log('search');
    // search: the picker asks the server and lists a stock the page did not know
    // open the picker the way chart-index-browser.js does (ws.symbolPicker.open), then type like a member (input events)
    await p.evaluate(() => { const ws = window.STRYKER_VELA; try { ws.symbolPicker.close(); } catch (e) {} ws.symbolPicker.open(''); });
    await p.waitForSelector('.vela-sp-input', { state: 'visible', timeout: 10000 }).catch(() => {});
    const n1 = calls.length;
    await p.locator('.vela-sp-input:visible').first().pressSequentially('RELI', { delay: 60 }).catch(() => {});
    let row = null;
    for (let i = 0; i < 20 && !row; i++) { await sleep(500); row = await p.evaluate(() => { const r = [...document.querySelectorAll('.vela-sp-row')].find((x) => x.getClientRects().length && /RELIANCE/.test(x.dataset.ticker || x.textContent)); return r ? (r.dataset.ticker || '') + ' | ' + r.textContent.replace(/\s+/g, ' ').trim() : null; }); }
    check(!!row && /NSE/.test(row), 'search: typing RELI lists NSE:RELIANCE (non-US) from the server search', { row, rows: await p.evaluate(() => [...document.querySelectorAll('.vela-sp-row')].slice(0, 5).map((r) => (r.dataset.ticker || '') + ' ' + r.textContent.trim().slice(0, 40))) });
    check(calls.slice(n1).some((u) => /symbols\/search\?query=RELI/.test(u)), 'search: the server asked the provider for RELI', calls.slice(n1).slice(-3));
    await p.screenshot({ path: OUT + '/stocks-search-1440.png' });
    // and a picked non-US row opens its chart
    const picked = await p.evaluate(async () => { const r = [...document.querySelectorAll('.vela-sp-row')].find((x) => x.getClientRects().length && /RELIANCE/.test(x.dataset.ticker || x.textContent)); if (!r) return null; r.click(); for (let i = 0; i < 40; i++) { await new Promise((z) => setTimeout(z, 250)); const ws = window.STRYKER_VELA; if (/RELIANCE/.test(ws.chart.market.symbol) && ws.chart.orchestrator.rawBars.length > 20) return ws.chart.market.symbol; } return 'stuck:' + window.STRYKER_VELA.chart.market.symbol; });
    check(picked === 'stocks:NSE:RELIANCE', 'search: picking the row opens stocks:NSE:RELIANCE with bars', picked);
    log('shots');
    // shots: AAPL 5m desktop + phone
    await load('stocks:NASDAQ:AAPL', '5'); await sleep(1500);
    await p.screenshot({ path: OUT + '/stocks-aapl-5m-1440.png' });
    await p.setViewportSize({ width: 390, height: 844 }); await sleep(2500);
    await load('stocks:NSE:RELIANCE', 'D'); await sleep(1500);
    await p.screenshot({ path: OUT + '/stocks-reliance-1d-390.png' });
    await p.setViewportSize({ width: 412, height: 915 }); await sleep(2000);
    await p.screenshot({ path: OUT + '/stocks-reliance-1d-412.png' });
    log('futures');
    // futures still load (nothing broken): NQ resolves to the futures provider
    const fut = await p.evaluate(() => { const ws = window.STRYKER_VELA; return ws.feed.resolveSymbol('NQ1!'); });
    check(fut && fut.provider === 'futures', 'futures symbols still resolve to the futures provider', fut);
    const spy = await p.evaluate(() => window.STRYKER_VELA.feed.resolveSymbol('SPY'));
    check(spy && spy.provider === 'idx', 'bare SPY still resolves to the index provider (stocks are always stocks:EXCH:TICKER)', spy);
    check(errors.length === 0, 'no page errors', errors.slice(0, 5));

    log('signed-out');
    // signed out: the delayed lane, whole bars up to 10 minutes ago, store only
    const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx2.addInitScript(stub);
    await ctx2.addInitScript(() => { window.__STK_BOOK_RECORDER = 'https://sk.fixture.test'; try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', 'day'); } catch (e) {} });   // light theme: the one light shot
    await ctx2.route(/^https:\/\/sk\.fixture\.test\//, route);
    await ctx2.route(/^https?:\/\/(?!127\.0\.0\.1|sk\.fixture\.test|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const q = await ctx2.newPage(), errs2 = []; q.on('pageerror', (e) => errs2.push(String(e)));
    await q.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await q.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 90000 });
    const n0 = calls.length;
    const d = await q.evaluate(async () => { const pr = window.STRYKER_VELA.feed.providerInstance('stocks'); const b = await pr.getBars('NASDAQ:AAPL', '1', { limit: 200 }); return b.length ? b[b.length - 1].time : null; });
    check(d != null && Date.now() - d >= 10 * MIN, 'signed out: the newest 1m bar is at least 10 minutes old', d && (Date.now() - d) / MIN);
    const un = await q.evaluate(async () => (await window.STRYKER_VELA.feed.providerInstance('stocks').getBars('NASDAQ:TSLA', '1', { limit: 10 })).length);
    check(un === 0 && calls.length === n0, 'signed out: an unseen stock is not fetched from the provider (no spend)', { un, calls: calls.length - n0 });
    // light shot, signed out (delayed lane): AAPL 5m from the store
    await q.evaluate(() => { const ws = window.STRYKER_VELA; ws.active.setSymbol('stocks:NASDAQ:AAPL'); ws.active.setTimeframe('5'); });
    await sleep(4000);
    await q.screenshot({ path: OUT + '/stocks-aapl-5m-1440-light-signedout.png' });
    check(errs2.length === 0, 'signed out: no page errors', errs2.slice(0, 5));
    console.log('provider calls:', calls.length, 'budget', JSON.stringify(E.stats().budget));
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
