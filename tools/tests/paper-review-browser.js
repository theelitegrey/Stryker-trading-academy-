// Paper trading TRADE REVIEW browser test (Owner order 2026-10-14, step A of "Paper trading
// leaderboard + trade review"). Offline: Firebase is the rich stub (member u1) with the paper
// account doc recorded in localStorage, futures bars + Binance klines are mocked.
//
// paper-review.html at 1280x800 and 390x844 with a seeded member account (14 closed trades with
// stops, tags, a note; plus 2 Replay-account trades):
//   - the disclaimer "Demo account. Simulated results, not real trading. ..." is on the page
//   - KPIs match PaperReviewStats on the same state (win rate, avg R, expectancy, max drawdown)
//   - breakdowns by setup / session / weekday / symbol, equity curve drawn
//   - a trade expands: the mini chart snapshot draws bars (mocked /api/chart/bars), R / MAE / MFE
//     / hold / session shown; note + tags saved -> local copy and cloud doc carry them, nothing
//     else in the account changed
//   - filters (symbol, tag) narrow the list; CSV export downloads the filtered rows with the
//     disclaimer line
//   - the Replay toggle shows only the Replay account's trades
//   - 390: no sideways overflow of the document
// charts.html 1280 + 390: paper trading ON (seeded), the panel has a Review tab that mounts the
// component with the same disclaimer and a link to the full page.
//
//   flock /tmp/stryker-chrome.lock node tools/tests/paper-review-browser.js [shotsDir]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launch, ROOT } = require('./lib.js');
const stub = require('./richstub.js');
const S = require(path.join(ROOT, 'assets', 'paper-review-stats.js'));

const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN = 60000, H = 3600, D = 86400;
const NOW = Date.now();
const NQ_BASE = 21000, BTC_BASE = 64000;
function hist(tMs, stepMs, base) {
  const i = Math.floor(tMs / stepMs);
  const o = base + 20 * Math.sin(i / 37), c = base + 20 * Math.sin((i + 1) / 37);
  return { t: i * stepMs, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 100 + (i % 50) };
}
const r4 = (x) => Math.round(x * 4) / 4;

// ---- the seeded member account ----
function seedState() {
  const resetAt = NOW - 20 * D * 1000;
  const trades = [];
  const setups = ['FVG', 'Order block', 'Liquidity sweep'];
  const mistakes = ['', 'Early exit', '', 'Moved stop'];
  const emotions = ['Calm', 'FOMO', 'Calm', 'Hesitant'];
  for (let i = 0; i < 14; i++) {
    const entryAt = NOW - (14 - i) * 26 * H * 1000 + (i % 3) * 5 * H * 1000;
    const hold = (20 + i * 7) * MIN;
    const crypto = i % 5 === 4;
    const side = i % 3 === 1 ? 'sell' : 'buy';
    const entry = crypto ? r4(BTC_BASE + i * 3) : r4(NQ_BASE + i);
    const pts = [30, -10, 15, -10, 20, 5, -10, 40, -5, 12, -10, 25, 8, -10][i] * (crypto ? 10 : 1);
    const exit = side === 'buy' ? entry + pts : entry - pts;
    const pv = crypto ? 1 : 20, qty = crypto ? 0.5 : 1;
    const sl0 = side === 'buy' ? entry - (crypto ? 100 : 10) : entry + (crypto ? 100 : 10);
    const pnl = Math.round(pts * qty * pv * 100) / 100;
    trades.push({ id: 100 + i, symbol: crypto ? 'binance:BTCUSDT' : 'futures:NQ1!', side, qty, entry, exit, entryAt, exitAt: entryAt + hold,
      gross: pnl, fees: 0, pnl, reason: pts > 0 ? 'tp' : 'sl', sl: sl0, tp: null, sl0, pointValue: pv, journaled: false,
      mae: Math.abs(pts) / 3 + 2, mfe: Math.max(pts, 0) + 3, lev: 4.2, run: resetAt,
      setup: setups[i % 3], mistake: mistakes[i % 4] || undefined, emotion: emotions[i % 4], note: i === 13 ? 'Waited for the London sweep, entered on the 1m FVG.' : undefined });
  }
  for (const t of trades) for (const k of Object.keys(t)) if (t[k] === undefined) delete t[k];
  return { v: 1, currency: 'USD', startBalance: 50000, balance: 50000 + trades.reduce((a, t) => a + t.pnl, 0), realized: 0, fees: 0, createdAt: resetAt, resetAt,
    settings: { enabled: true, commission: 0, slippage: 0, oneClick: true, lines: true, sounds: false, askJournal: false, qty: {} },
    positions: {}, orders: [], history: [], trades, nextId: 200, savedAt: NOW - 1000 };
}
function seedReplay() {
  const t0 = NOW - 400 * D * 1000;
  const mk = (id, pts) => ({ id, symbol: 'futures:ES1!', side: 'buy', qty: 1, entry: 5000, exit: 5000 + pts, entryAt: t0 + id * H * 1000, exitAt: t0 + id * H * 1000 + 30 * MIN,
    gross: pts * 50, fees: 0, pnl: pts * 50, reason: 'manual', sl: 4995, sl0: 4995, pointValue: 50, mae: 1, mfe: 3, src: 'replay', run: t0 });
  return { v: 1, currency: 'USD', startBalance: 100000, balance: 100000, realized: 0, fees: 0, createdAt: t0, resetAt: t0, settings: { enabled: true, qty: {} },
    positions: {}, orders: [], history: [], trades: [mk(1, 4), mk(2, -2)], nextId: 10, savedAt: NOW };
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
let barRequests = 0;
async function mockRoutes(ctx) {
  await ctx.route(/\/api\/chart\/bars\//, (route) => {
    barRequests++;
    const u = new URL(route.request().url());
    const tf = u.searchParams.get('tf') || '1';
    const step = (TF_MIN[tf] || 1) * MIN;
    const page = Number(u.searchParams.get('page') || 0);
    const ps = PAGE_SECS[tf] || 8 * H;
    const from = page * ps * 1000, to = Math.min((page + 1) * ps * 1000, Date.now());
    const bars = [];
    for (let t = Math.ceil(from / step) * step; t < to; t += step) { const b = hist(t, step, NQ_BASE); bars.push([t / 1000, r4(b.o), r4(b.h), r4(b.l), r4(b.c), b.v]); }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf, page, bars }) });
  });
  await ctx.routeWebSocket(/\/api\/chart\/stream\//, (ws) => { ws.send(JSON.stringify({ event: 'connected' })); });
  await ctx.route(/^https:\/\/(api\.binance\.com|data-api\.binance\.vision|api\.binance\.us)\//, (route) => {
    const u = new URL(route.request().url());
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (/\/exchangeInfo$/.test(u.pathname)) return json({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }] }] });
    if (/\/klines$/.test(u.pathname)) {
      const iv = u.searchParams.get('interval') || '1m';
      const m = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 }[iv] || 1;
      const step = m * MIN, limit = Math.min(1000, Number(u.searchParams.get('limit') || 500));
      const st = u.searchParams.get('startTime'), en = Math.min(Number(u.searchParams.get('endTime') || Date.now()), Date.now());
      const ts = [];
      if (st != null) { for (let t = Math.ceil(Number(st) / step) * step; t <= en && ts.length < limit; t += step) ts.push(t); }
      else { for (let t = Math.floor(en / step) * step; ts.length < limit; t -= step) ts.unshift(t); }
      return json(ts.map((t) => { const b = hist(t, step, BTC_BASE); return [t, String(b.o), String(b.h), String(b.l), String(b.c), String(b.v), t + step - 1, '0', 1, '0', '0', '0']; }));
    }
    return json([]);
  });
  await ctx.routeWebSocket(/^wss:\/\/[^/]*binance[^/]*\//, () => {});
}
// cloud doc recorder (students/u1/paperTrading/account) in a localStorage key the page never uses
const RECORDER = ([seed, rseed]) => {
  try {
    localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
    if (!localStorage.getItem('__seeded')) {
      localStorage.setItem('__seeded', '1');
      localStorage.setItem('__test_cloud_paper', JSON.stringify({ state: JSON.stringify(seed) }));
      localStorage.setItem('stryker_paper_replay_u1', JSON.stringify(rseed));
    }
  } catch (e) {}
  const fb = window.firebase; if (!fb) return;
  const orig = fb.firestore;
  const CLOUD = '__test_cloud_paper';
  const wrapD = (d, p) => {
    const w = Object.assign({}, d, { collection: (sub) => wrapC(d.collection(sub), p + '/' + sub) });
    if (/\/paperTrading\/account$/.test(p)) {
      w.get = () => { const s = localStorage.getItem(CLOUD); return Promise.resolve({ id: 'account', exists: !!s, data: () => (s ? JSON.parse(s) : {}) }); };
      w.set = (data) => { localStorage.setItem(CLOUD, JSON.stringify({ state: data.state, keys: Object.keys(data) })); window.__cloudWrites = (window.__cloudWrites || 0) + 1; return Promise.resolve(); };
    }
    return w;
  };
  const wrapC = (c, p) => Object.assign({}, c, { doc: (id) => wrapD(c.doc(id), p + '/' + (id || 'auto')) });
  const db = Object.assign({}, orig(), { collection: (n) => wrapC(orig().collection(n), n) });
  fb.firestore = Object.assign(() => db, orig);
};

async function newPage(b, BASE, opts) {
  const ctx = await b.newContext(Object.assign({ acceptDownloads: true }, opts));
  await ctx.addInitScript(stub);
  await ctx.addInitScript(RECORDER, [seedState(), seedReplay()]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|api\.binance\.com|data-api\.binance\.vision|api\.binance\.us)/, (r) => r.abort());
  await mockRoutes(ctx);
  const p = await ctx.newPage();
  const errors = [];
  const IGNORE = [/ERR_FAILED|ERR_INTERNET_DISCONNECTED|net::|status of 4|status of 5|Failed to fetch/i, /WebSocket connection to/];
  p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, p, errors };
}
const shot = async (p, name) => { const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('screenshot', f); };
const canvasInk = (p, sel) => p.evaluate((sel) => {
  const cv = document.querySelector(sel); if (!cv || !cv.width) return 0;
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0;
  for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++;
  return n;
}, sel);

async function reviewPage(b, BASE, vp, tag) {
  const phone = vp.width < 500;
  const { ctx, p, errors } = await newPage(b, BASE, phone ? { viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : { viewport: vp });
  await p.goto(BASE + '/paper-review.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.pr .pr-kpis', { timeout: 20000 });
  await sleep(800);
  const st = seedState();
  const want = S.stats(st.trades, st.startBalance);
  const kp = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.pr-kpi')].map((k) => [k.querySelector('em').textContent, k.querySelector('b').textContent])));
  check(/Demo account\. Simulated results, not real trading\. Education only\. Not financial advice\./.test(await p.textContent('.pr-disc')), tag + ': disclaimer on the page');
  check(kp['Win rate'] === want.winRate.toFixed(1) + '%' && kp['Average R'] === (want.avgR > 0 ? '+' : '') + want.avgR.toFixed(2) + 'R' && kp['Max drawdown'].replace(/[^0-9.]/g, '') === want.maxDD.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '').replace(/,/g, ''),
    tag + ': KPIs match the stats maths ' + JSON.stringify({ kp, winRate: want.winRate, avgR: want.avgR, maxDD: want.maxDD, exp: want.expectancy }));
  check((await p.$$('.pr-item')).length === 14, tag + ': 14 closed trades listed');
  check((await p.$$('.pr-grid .pr-card')).length === 4, tag + ': breakdowns by setup / session / weekday / symbol');
  check(await canvasInk(p, '.pr-eq canvas') > 50, tag + ': equity curve drawn');
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, tag + ': no sideways overflow (' + over + ' px)');
  await shot(p, `paper-review-${vp.width}.png`);
  // expand the newest trade (has a note)
  await p.click('.pr-item:first-child .pr-row');
  await p.waitForSelector('.pr-item.open .pr-snap canvas');
  let ink = 0; for (let i = 0; i < 40 && ink < 200; i++) { await sleep(250); ink = await canvasInk(p, '.pr-item.open .pr-snap canvas'); }
  check(ink > 200 && barRequests > 0, tag + ': mini chart snapshot drew bars around the trade (' + ink + ' px, ' + barRequests + ' bar requests)');
  const facts = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.pr-item.open .pr-kv')].map((k) => [k.querySelector('em').textContent, k.querySelector('b').textContent])));
  const t13 = S.enrich(st.trades[13]);
  check(facts['R multiple'] === (t13.r > 0 ? '+' : '') + t13.r.toFixed(2) + 'R' && /pts/.test(facts.MAE) && /pts/.test(facts.MFE) && facts.Hold === S.fmtHold(t13.hold) && facts.Session.startsWith(t13.session),
    tag + ': trade facts R / MAE / MFE / hold / session ' + JSON.stringify(facts));
  check(await p.inputValue('.pr-item.open textarea') === 'Waited for the London sweep, entered on the 1m FVG.', tag + ': saved note shown');
  await shot(p, `paper-review-${vp.width}-trade.png`);
  if (!phone) {
    // edit + save
    await p.fill('.pr-item.open textarea', 'Edited in the test: entry was late.');
    await p.fill('.pr-item.open [data-k=setup]', 'SMT divergence');
    await p.fill('.pr-item.open [data-k=mistake]', 'Late entry');
    await p.click('.pr-item.open .pr-actions .pr-btn-pri');
    await sleep(600);
    const saved = await p.evaluate(() => {
      const cloud = JSON.parse(JSON.parse(localStorage.getItem('__test_cloud_paper')).state);
      const local = JSON.parse(localStorage.getItem('stryker_paper_u1'));
      const pick = (s) => s.trades.find((t) => t.id === 113);
      return { cloud: pick(cloud), local: pick(local), n: cloud.trades.length, bal: cloud.balance, keys: JSON.parse(localStorage.getItem('__test_cloud_paper')).keys, rev: localStorage.getItem('stryker_paper_u1:rev') };
    });
    check(saved.cloud.note === 'Edited in the test: entry was late.' && saved.cloud.setup === 'SMT divergence' && saved.cloud.mistake === 'Late entry' && saved.local.note === saved.cloud.note,
      'save: note + tags written to the cloud doc and the local copy');
    check(saved.n === 14 && Math.abs(saved.bal - st.balance) < 1e-6 && saved.cloud.pnl === st.trades[13].pnl && /^review:/.test(saved.rev || '') && saved.keys.join() === 'state,updatedAt',
      'save: nothing else in the account changed, doc keys state+updatedAt, rev stamp for open Charts tabs');
    // filters
    await p.selectOption('[data-f=symbol]', 'BTCUSDT'); await sleep(300);
    const nBtc = (await p.$$('.pr-item')).length;
    check(nBtc === st.trades.filter((t) => /BTC/.test(t.symbol)).length, 'filter by symbol: ' + nBtc + ' BTCUSDT trades');
    await p.selectOption('[data-f=symbol]', ''); await p.selectOption('[data-f=tag]', 'FOMO'); await sleep(300);
    const nF = (await p.$$('.pr-item')).length;
    check(nF === st.trades.filter((t) => t.emotion === 'FOMO').length, 'filter by tag FOMO: ' + nF);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('text=Export CSV')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    const lines = csv.trim().split(/\r\n/);
    check(/^# Demo account\. Simulated results/.test(lines[0]) && /^id,account,symbol/.test(lines[1]) && lines.length === 2 + nF && /\.csv$/.test(dl.suggestedFilename()),
      'CSV export: disclaimer line + header + ' + (lines.length - 2) + ' filtered rows, file ' + dl.suggestedFilename());
    await p.click('.pr-clear'); await sleep(300);
    // replay toggle
    await p.click('.pr-kind button:has-text("Replay account")'); await sleep(400);
    const rp = await p.evaluate(() => ({ n: document.querySelectorAll('.pr-item').length, syms: [...document.querySelectorAll('.pr-c-sym b')].map((x) => x.textContent), note: document.body.textContent.includes('never counted on the leaderboard') }));
    check(rp.n === 2 && rp.syms.every((s) => s === 'ES1!') && rp.note, 'Replay toggle: only the 2 Replay-account trades, with the "kept apart" note ' + JSON.stringify(rp));
    await shot(p, `paper-review-${vp.width}-replay.png`);
    await p.click('.pr-kind button:has-text("Paper account")'); await sleep(300);
  }
  check(errors.length === 0, tag + ': no console errors ' + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}

async function chartsTab(b, BASE, vp, tag) {
  const phone = vp.width < 500;
  const { ctx, p, errors } = await newPage(b, BASE, phone ? { viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : { viewport: vp });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.__stkPaper && window.__stkPaper.account && window.__stkPaper.enabled, null, { timeout: 60000 });
  await sleep(1500);
  await p.evaluate(() => window.__stkPaper.openPanel('review'));
  await p.waitForSelector('#stkpt .pr-compact .pr-kpis', { timeout: 10000 });
  await sleep(600);
  const r = await p.evaluate(() => ({ tab: !!document.querySelector('#stkpt [data-tab=review].on'), disc: (document.querySelector('#stkpt .pr-disc') || {}).textContent, n: document.querySelectorAll('#stkpt .pr-item').length,
    href: (document.querySelector('#stkpt a.pr-btn') || {}).getAttribute ? document.querySelector('#stkpt a.pr-btn').getAttribute('href') : null }));
  check(r.tab && /Demo account\. Simulated results, not real trading/.test(r.disc || '') && r.n === 14 && r.href === 'paper-review.html', tag + ': Charts panel Review tab: disclaimer, 14 trades, link to the full page ' + JSON.stringify(r));
  // re-render on a tick must not reset an open editor
  await p.click('#stkpt .pr-item:first-child .pr-row'); await sleep(300);
  await p.fill('#stkpt .pr-item.open textarea', 'typing…'); await sleep(2500);
  check(await p.inputValue('#stkpt .pr-item.open textarea') === 'typing…', tag + ': panel refreshes do not wipe a note being typed');
  if (!phone) {
    let ink = 0; for (let i = 0; i < 40 && ink < 200; i++) { await sleep(250); ink = await canvasInk(p, '#stkpt .pr-item.open .pr-snap canvas'); }
    check(ink > 200, tag + ': snapshot drawn from the chart provider (' + ink + ' px)');
  }
  await shot(p, `paper-review-charts-${vp.width}.png`);
  check(errors.length === 0, tag + ': no console errors ' + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}

(async () => {
  const srv = await serve();
  const BASE = `http://127.0.0.1:${srv.address().port}`;
  const b = await launch({ args: ['--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  try {
    await reviewPage(b, BASE, { width: 1280, height: 800 }, '1280');
    await reviewPage(b, BASE, { width: 390, height: 844 }, '390');
    await chartsTab(b, BASE, { width: 1280, height: 800 }, 'charts 1280');
    await chartsTab(b, BASE, { width: 390, height: 844 }, 'charts 390');
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close(); srv.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
