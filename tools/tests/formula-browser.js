// (harness copied from) Charts BAR REPLAY browser test (Owner order 2026-10-12, assets/chart-bar-replay.js).
//
// Offline + deterministic: futures bars endpoint / stream and Binance REST / WS are mocked from a
// formula (same harness as chart-paper-trading-browser.js), so every revealed bar can be checked
// against what existed at the replay clock.
//   NQ1! 5m, update interval 1m: scissor select -> step x5 (forming candle built from 1m) ->
//   play / pause -> step back -> no future bar and a Pine SMA equal to the SMA of the revealed
//   closes -> TF switch keeps the time -> replay paper market + bracket fills on replayed bars ->
//   reload resumes -> exit restores live + the live paper account is untouched.
//   BTCUSDT 1m: start, step, no lookahead, exit.
//   Screenshots 1280 + 390: scissor select, control bar, replay with a paper position.
//
//   flock /tmp/stryker-chrome.lock node tools/tests/chart-bar-replay-browser.js [shotsDir]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launch, ROOT } = require('./lib.js');
const stub = require('./richstub.js');

const OUT = process.argv[2] || '/tmp';
const T0 = Date.parse('2026-10-07T14:00:00Z');   // Wednesday 10:00 New York
const MIN = 60000, H = 3600, D = 86400;
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let offset = 0;
const vnow = () => Date.now() + offset;
const vnowNode = vnow;
const NQ_BASE = 21000, BTC_BASE = 64000;
// 1m formula bars; higher timeframes are aggregated from them, so a 5m bar == its five 1m bars
function m1(t, base) {
  const i = Math.floor(t / MIN);
  const o = base + 20 * Math.sin(i / 37) + 3 * Math.sin(i / 3), c = base + 20 * Math.sin((i + 1) / 37) + 3 * Math.sin((i + 1) / 3);
  return { t: i * MIN, o, h: Math.max(o, c) + 1 + (i % 3), l: Math.min(o, c) - 1 - (i % 2), c, v: 100 + (i % 50) };
}
const r4 = (x) => Math.round(x * 4) / 4;
function hist(t, step, base) {
  const t0 = Math.floor(t / step) * step;
  let b = null;
  for (let k = t0; k < t0 + step; k += MIN) {
    const x = m1(k, base); const q = { o: r4(x.o), h: r4(x.h), l: r4(x.l), c: r4(x.c), v: x.v };
    if (!b) b = { t: t0, o: q.o, h: q.h, l: q.l, c: q.c, v: q.v };
    else { b.h = Math.max(b.h, q.h); b.l = Math.min(b.l, q.l); b.c = q.c; b.v += q.v; }
  }
  return b;
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
// history depth per interval, as production serves it (functions/api/chart/_bars.js): 1m ~29 days
const DEPTH_SECS = { '1': 29 * D, '5': 59 * D, '15': 59 * D, '30': 59 * D, '60': 729 * D, '120': 729 * D, '240': 729 * D, D: 40 * 365 * D };
const timers = [];
async function mockRoutes(ctx) {
  await ctx.route(/\/api\/chart\/bars\//, (route) => {
    const u = new URL(route.request().url());
    const tf = u.searchParams.get('tf') || '1';
    const step = (TF_MIN[tf] || 1) * MIN;
    const page = Number(u.searchParams.get('page') || 0);
    const ps = PAGE_SECS[tf] || 8 * H;
    const cur = Math.floor(vnow() / step) * step;
    const from = Math.max(page * ps * 1000, vnow() - (DEPTH_SECS[tf] || 40 * 365 * D) * 1000), to = Math.min((page + 1) * ps * 1000, cur + 1);
    const bars = [];
    for (let t = Math.ceil(from / step) * step; t < to; t += step) { const b = hist(t, step, NQ_BASE); bars.push([t / 1000, b.o, b.h, b.l, b.c, b.v]); }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf, page, bars }) });
  });
  await ctx.routeWebSocket(/\/api\/chart\/stream\//, (ws) => {
    const tf = new URL(ws.url()).searchParams.get('tf') || '1';
    const step = (TF_MIN[tf] || 1) * MIN;
    ws.send(JSON.stringify({ event: 'connected', s: 'NQ', tf }));
    const iv = setInterval(() => { const b = hist(vnow(), step, NQ_BASE); try { ws.send(JSON.stringify({ event: 'bar', s: 'NQ', tf, bar: [b.t / 1000, b.o, b.h, b.l, b.c, b.v] })); } catch (e) {} }, 500);
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
      return json(ts.map((t) => { const b = hist(t, step, BTC_BASE); return [t, String(b.o), String(b.h), String(b.l), String(b.c), String(b.v), t + step - 1, '0', 1, '0', '0', '0']; }));
    }
    return json([]);
  });
  await ctx.routeWebSocket(/^wss:\/\/[^/]*binance[^/]*\//, (ws) => {
    const m = /@kline_(\w+)$/.exec(ws.url());
    if (!m) return;
    const step = ({ '1m': 1, '5m': 5, '15m': 15, '1h': 60 }[m[1]] || 1) * MIN;
    const iv = setInterval(() => { const b = hist(vnow(), step, BTC_BASE); try { ws.send(JSON.stringify({ e: 'kline', k: { t: b.t, o: String(b.o), h: String(b.h), l: String(b.l), c: String(b.c), v: String(b.v), x: false } })); } catch (e) {} }, 500);
    timers.push(iv); ws.onClose(() => clearInterval(iv));
  });
}
const INIT = () => {
  try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
  window.__simSounds = [];
  window.addEventListener('stryker:chart-sim-sound', (e) => window.__simSounds.push(e.detail.event + ':' + e.detail.source + (e.detail.replay ? ':replay' : '')));
};

async function newPage(b, opts) {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(stub);
  await ctx.addInitScript(INIT);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance\.com|data-api\.binance\.vision|api\.binance\.us)/, (r) => r.abort());
  await mockRoutes(ctx);
  if (process.env.STK_VELA === '0.6') await ctx.addInitScript(() => { try { localStorage.setItem('stryker_vela06', '1'); } catch (e) {} });   // compare on the old engine
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
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper && window.__stkBarReplay, null, { timeout: 60000 });
  await p.waitForFunction(() => window.__stkPaper.account, null, { timeout: 15000 });
  // paper trading is OFF by default (Chart settings → Paper trading, 2026-10-14): this suite trades
  await p.evaluate(() => window.__stkPaper.setEnabled(true));
  offset = (await p.evaluate(() => Date.now())) - Date.now();
  await sleep(1500);
}
async function setMarket(p, sym, tf) {
  await p.evaluate(async ([sym, tf]) => {
    const ws = window.STRYKER_VELA;
    ws.active.setSymbol(sym); ws.active.setTimeframe(tf);
    const c = ws.chart;
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (c.market.symbol === sym && c.market.timeframe === tf && c.orchestrator.rawBars.length > 50) break; }
  }, [sym, tf]);
  await sleep(1500);
}
async function waitFor(p, fn, arg, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 10000)) { if (await p.evaluate(fn, arg).catch(() => false)) return true; await sleep(200); }
  return false;
}
const RS = (p) => p.evaluate(() => { const s = window.__stkBarReplay.state; return { on: s.on, E: s.E, stepTf: s.stepTf, playing: s.playing, undo: s.undo, busy: s.busy, rt: s.rt, sim: s.sim }; });
// bars shown on the active chart + what existed at E (computed here from the formula)
async function shown(p) {
  return p.evaluate(() => {
    const c = window.STRYKER_VELA.chart, b = c.orchestrator.rawBars;
    return { tf: c.market.timeframe, sym: c.market.symbol, n: b.length, last: b[b.length - 1] && Object.assign({}, b[b.length - 1]), first: b[0] && b[0].time, maxT: b.length ? b[b.length - 1].time : 0, closes: b.slice(-30).map((x) => x.close) };
  });
}
function expectedLast(E, stepMs, base, tfMs) {
  // the chart bar containing the newest revealed step, built from the complete 1m bars before E
  const lastStep = E - stepMs, t0 = Math.floor(lastStep / tfMs) * tfMs;
  let b = null;
  for (let k = t0; k < E; k += MIN) {
    const x = m1(k, base); const q = { o: r4(x.o), h: r4(x.h), l: r4(x.l), c: r4(x.c) };
    if (!b) b = { time: t0, open: q.o, high: q.h, low: q.l, close: q.c };
    else { b.high = Math.max(b.high, q.h); b.low = Math.min(b.low, q.l); b.close = q.c; }
  }
  return b;
}
const near = (a, b) => Math.abs(a - b) < 1e-6;
// A Pine SMA(9) on the chart; its newest values must equal the SMA of the revealed closes.
const PINE = '//@version=5\nindicator("Replay SMA test", overlay=true)\nplot(ta.sma(close, 9), "sma")\n';
async function pineCheck(p, label) {
  const r = await p.evaluate(async () => {
    const c = window.STRYKER_VELA.chart;
    for (let i = 0; i < 60; i++) {
      const rec = [...c.orchestrator.registry.all()].find((x) => x.model && /Replay SMA test/.test(x.model.title || ''));
      const s = rec && rec.model.series && rec.model.series[0];
      const pts = s && (s.points || s.data || s.values);
      const bars = c.orchestrator.rawBars;
      if (pts && pts.length && bars.length && !rec.loading) {
        const lastP = pts[pts.length - 1];
        const pt = typeof lastP === 'object' ? lastP : { time: bars[pts.length - 1] && bars[pts.length - 1].time, value: lastP };
        if (pt.time === bars[bars.length - 1].time) {
          const cl = bars.slice(-9).map((b) => b.close); const sma = cl.reduce((a, b) => a + b, 0) / 9;
          return { ok: true, v: pt.value, sma, t: pt.time, maxPt: Math.max(...pts.map((q) => (typeof q === 'object' ? q.time : 0))), lastBar: bars[bars.length - 1].time };
        }
      }
      await new Promise((res) => setTimeout(res, 250));
    }
    const rec = [...c.orchestrator.registry.all()].find((x) => x.model && /Replay SMA test/.test(x.model.title || ''));
    const s0 = rec && rec.model && rec.model.series && rec.model.series[0];
    return { ok: false, titles: [...c.orchestrator.registry.all()].map((x) => x.model && x.model.title), keys: s0 ? Object.keys(s0) : null, sample: s0 ? JSON.stringify(s0).slice(0, 300) : null };
  });
  check(r.ok && Math.abs(r.v - r.sma) < 1e-6 && r.maxPt <= r.lastBar, label + ': Pine SMA(9) newest value ' + (r.v != null ? r.v.toFixed(4) : '?') + ' == SMA of revealed closes ' + (r.sma != null ? r.sma.toFixed(4) : '?') + ', no plot point past the last revealed bar ' + JSON.stringify(r.ok ? {} : r));
}


// ---- FORMULA CHARTS (Roadmap: Formula charts) ----
// flock /tmp/stryker-chrome.lock node tools/tests/formula-browser.js [shotsDir]
const SHOTS = process.argv[2];
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const F = 'formula:BTCUSDT-NQ1!*3';
async function typeSearch(p, text) {
  await p.evaluate(() => window.STRYKER_VELA.symbolPicker && window.STRYKER_VELA.symbolPicker.open(''));
  await p.waitForSelector('.vela-sp-input', { state: 'visible', timeout: 8000 });
  await p.fill('.vela-sp-input', text);
  await sleep(500);
  return p.evaluate(() => ({ rows: [...document.querySelectorAll('.vela-sp-row')].filter((e) => e.getClientRects().length).map((e) => (e.querySelector('.vela-sp-ticker') || e).textContent.trim()), msg: (document.querySelector('.vela-sp-empty') || {}).textContent || '' }));
}
(async () => {
  const srv = await serve();
  const BASE = `http://127.0.0.1:${srv.address().port}`;
  const b = await launch({ args: ['--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
      const { ctx, p, errors } = await newPage(b, { viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await boot(p, BASE);
      const tag = String(w);
      await setMarket(p, 'binance:BTCUSDT', '15');
      // -- search: a good expression, a bad one, an unknown symbol
      let r = await typeSearch(p, 'BTCUSDT-NQ1!*3');
      check(r.rows.length === 1 && /BTCUSDT-NQ1!\*3/.test(r.rows[0]), tag + ': search offers one formula row', r);
      if (SHOTS) await p.screenshot({ path: SHOTS + '/formula-' + tag + '-search.png' });
      r = await typeSearch(p, 'BTCUSDT-ZZZQ1!*3');
      check(r.rows.length === 0 && /ZZZQ1!.*not on our data feeds/.test(r.msg), tag + ': unknown symbol -> clear message', r);
      r = await typeSearch(p, 'BTCUSDT+NQ1!+ES1!+CL1!+GC1!');
      check(/up to 4 symbols/.test(r.msg), tag + ': 5 symbols -> limit message', r);
      r = await typeSearch(p, 'BTCUSDT*(NQ1!');
      check(/bracket/i.test(r.msg), tag + ': open bracket -> message', r);
      r = await typeSearch(p, 'BTC');
      check(r.rows.length > 0 && !r.msg, tag + ': a normal search is untouched', r);
      // pick the good one with the keyboard
      await p.fill('.vela-sp-input', 'BTCUSDT-NQ1!*3'); await sleep(400); await p.keyboard.press('Enter');
      const ok = await waitFor(p, () => { const c = window.STRYKER_VELA.chart; return /^formula:/i.test(c.market.symbol) && c.orchestrator.rawBars.length > 20; }, null, 25000);
      check(ok, tag + ': formula chart loaded candles');
      await sleep(1500);
      // -- the candles are the formula of the legs, bar for bar
      const v = await p.evaluate(async () => {
        const ws = window.STRYKER_VELA, c = ws.chart, bars = c.orchestrator.rawBars, tf = c.market.timeframe;
        const A = await ws.feed.providerInstance('binance').getBars('BTCUSDT', tf, { limit: 400 });
        const B = await ws.feed.providerInstance('futures').getBars('NQ1!', tf, { limit: 400 });
        const bm = new Map(B.map((x) => [x.time, x])); let n = 0, bad = 0, vol = 0;
        for (const x of bars) { const a = A.find((y) => y.time === x.time), q = bm.get(x.time); if (!a || !q) continue; n++;
          const o = a.open - q.open * 3, cl = a.close - q.close * 3, hi = a.high - q.high * 3, lo = a.low - q.low * 3;
          if (Math.abs(x.open - o) > 1e-6 || Math.abs(x.close - cl) > 1e-6 || Math.abs(x.high - Math.max(o, hi, lo, cl)) > 1e-6 || Math.abs(x.low - Math.min(o, hi, lo, cl)) > 1e-6) bad++; if (x.volume) vol++; }
        return { n, bad, vol, shown: bars.length, sym: c.market.symbol, label: document.body.innerText.includes('BTCUSDT-NQ1!*3') };
      });
      check(v.n > 20 && v.bad === 0 && v.vol === 0, tag + ': O/H/L/C = formula of the legs, volume blank', v);
      check(v.label, tag + ': chart shows the formula text');
      // -- indicators work on it (Pine SMA + a built-in)
      const pr = await p.evaluate(async (src) => { const r = await window.STRYKER_PINE.runOnChart(window.STRYKER_VELA.chart, src); return r && (r.ok !== false) ? 'ok' : JSON.stringify(r); }, PINE);
      check(pr === 'ok', tag + ': Pine indicator runs on the formula chart: ' + pr);
      await pineCheck(p, tag + ' formula');
      // -- layouts save the symbol as it is; watchlist keeps it
      const st = await p.evaluate(() => JSON.stringify(window.STRYKER_VELA.serialize ? window.STRYKER_VELA.serialize() : window.STRYKER_VELA.chart.market));
      check(/formula:BTCUSDT-NQ1!\*3/.test(st), tag + ': saved state holds the formula symbol');
      const wl = await p.evaluate(async () => { const m = await import('/assets/chart-watchlist.js?v=842'); return [m.normalizeSymbol('formula: btcusdt - nq1! * 3', window.STRYKER_VELA.feed), m.normalizeSymbol('formula:BTCUSDT', window.STRYKER_VELA.feed)]; });
      check(wl[0] === 'formula:BTCUSDT-NQ1!*3' && wl[1] === null, tag + ': watchlist accepts a good formula and refuses a bad one', wl);
      // -- watchlist row shows the formula text
      if (SHOTS) {
        await p.screenshot({ path: SHOTS + '/formula-' + tag + '-dark.png' });
        await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); try { window.STRYKER_VELA.setTheme && window.STRYKER_VELA.setTheme('light'); } catch (e) {} });
        await sleep(1200);
        await p.screenshot({ path: SHOTS + '/formula-' + tag + '-light.png' });
      }
      const bad = errors.filter((e) => !/formula/i.test(e) ? true : true);
      check(errors.length === 0, tag + ': no console errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await b.close(); srv.close(); timers.forEach(clearInterval); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
