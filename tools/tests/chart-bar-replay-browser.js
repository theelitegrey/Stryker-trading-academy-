// Charts BAR REPLAY browser test (Owner order 2026-10-12, assets/chart-bar-replay.js).
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
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
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
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper && window.__stkBarReplay, null, { timeout: 60000 });
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

(async () => {
  const srv = await serve();
  const BASE = `http://127.0.0.1:${srv.address().port}`;
  const b = await launch({ args: ['--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  try {
    const { ctx, p, errors } = await newPage(b, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await boot(p, BASE);
    await setMarket(p, 'futures:NQ1!', '5');
    check(await p.evaluate(() => !!document.getElementById('stkr-btn')), 'Replay button in the chart toolbar');
    // a live paper position on the LIVE account, which replay must never touch
    await waitFor(p, () => Number.isFinite(window.__stkPaper.account.last['futures:NQ1!']));
    await p.evaluate(() => window.__stkPaper.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 }));
    await sleep(400);
    const live0 = await p.evaluate(() => JSON.stringify({ pos: window.__stkPaper.account.state.positions, bal: window.__stkPaper.account.state.balance, h: window.__stkPaper.account.state.history.length }));
    // Pine SMA for the no-lookahead check
    const pr = await p.evaluate(async (src) => { const r = await window.STRYKER_PINE.runOnChart(window.STRYKER_VELA.chart, src); return r && (r.ok !== false) ? 'ok' : JSON.stringify(r); }, PINE);
    check(pr === 'ok', 'Pine SMA test script on the chart: ' + pr);
    await sleep(2000);

    // ---- menu + scissor select ----
    await p.click('#stkr-btn');
    await p.waitForSelector('#stkr-pop:not([hidden])');
    const items = await p.evaluate(() => [...document.querySelectorAll('#stkr-pop .stkr-il')].map((e) => e.textContent));
    check(['Select bar', 'Random bar', 'First available bar'].every((x) => items.includes(x)) && items.some((x) => /Select date/.test(x)), 'menu: ' + items.join(' | '));
    await p.screenshot({ path: path.join(OUT, 'replay-1280-menu.png') });
    await p.click('#stkr-pop .stkr-item');               // Select bar
    await p.waitForSelector('.stkr-sel');
    const box = await p.evaluate(() => { const R = window.STRYKER_VELA.chart.renderer.renderer; const r = R.input.el.getBoundingClientRect(); return { x: r.left + R.coords.width * 0.6, y: r.top + r.height * 0.4 }; });
    await p.mouse.move(box.x, box.y); await sleep(300);
    const target = await p.evaluate(([x]) => {
      const R = window.STRYKER_VELA.chart.renderer.renderer, r = R.input.el.getBoundingClientRect();
      const bars = window.STRYKER_VELA.chart.orchestrator.rawBars;
      const i = Math.max(0, Math.min(bars.length - 1, Math.round(R.coords.xToLogical(x - r.left))));
      return { i, t: bars[i].time, tip: document.querySelector('.stkr-sel-tip').textContent, line: !document.querySelector('.stkr-sel-line').hidden };
    }, [box.x]);
    check(target.line && /^Start at /.test(target.tip), 'scissor line follows the cursor: "' + target.tip + '"');
    await p.screenshot({ path: path.join(OUT, 'replay-1280-scissor.png') });
    await p.mouse.click(box.x, box.y);
    await waitFor(p, () => window.__stkBarReplay.state.on && !window.__stkBarReplay.state.busy, null, 20000);
    await sleep(1500);
    let st = await RS(p), sh = await shown(p);
    check(st.on && st.E === target.t + 5 * MIN, 'select bar: replay on, clock = end of the clicked bar (' + new Date(st.E).toISOString() + ' vs bar ' + new Date(target.t).toISOString() + ')');
    check(sh.n > 50 && sh.maxT === target.t && sh.last.time + 5 * MIN <= st.E, 'everything to the right is hidden: ' + sh.n + ' bars, newest ' + new Date(sh.maxT).toISOString());
    const badge = await p.evaluate(() => { const b = document.querySelector('.stkr-badge'); return b && !b.hidden ? b.textContent : ''; });
    check(/^REPLAY · .+ ET$/.test(badge), 'header badge: "' + badge + '"');
    check(await p.evaluate(() => !document.getElementById('stkr-bar').hidden), 'control bar shown');
    check(await p.evaluate(() => window.__stkPaper.replay === true && window.__stkPaper.account !== window.__stkPaper.liveAccount), 'paper switched to the separate Replay account');
    const pill = await p.evaluate(() => (document.querySelector('.mclock-head') || {}).textContent || '');
    check(/^Replay · /.test(pill), 'market-hours pill follows the replay clock: "' + pill + '"');
    const dd = await p.evaluate(() => { const d = document.querySelector('.stkc-dd'); return d ? d.dataset.s : null; });
    check(dd === 'replay' || dd === null, 'data dot shows replay: ' + dd);
    await pineCheck(p, 'NQ1! 5m at select');

    // ---- update interval 1m + step forward ----
    await p.evaluate(() => window.__stkBarReplay.setStepTf('1'));
    await sleep(1500);
    st = await RS(p);
    check(st.stepTf === '1', 'update interval 1m');
    const E0 = st.E;
    for (let k = 0; k < 3; k++) { await p.keyboard.press('Shift+ArrowRight'); await waitFor(p, (e) => window.__stkBarReplay.state.E > e && !window.__stkBarReplay.state.busy, E0 + k * MIN, 8000); }
    await sleep(800);
    st = await RS(p); sh = await shown(p);
    const exp = expectedLast(st.E, MIN, NQ_BASE, 5 * MIN);
    check(st.E === E0 + 3 * MIN, 'Shift+Right x3: clock +3 min (' + (st.E - E0) / MIN + ')');
    check(sh.last.time === exp.time && near(sh.last.open, exp.open) && near(sh.last.high, exp.high) && near(sh.last.low, exp.low) && near(sh.last.close, exp.close),
      'forming 5m candle built from 3 complete 1m bars: ' + JSON.stringify([sh.last.open, sh.last.high, sh.last.low, sh.last.close]) + ' expected ' + JSON.stringify([exp.open, exp.high, exp.low, exp.close]));
    await pineCheck(p, 'NQ1! 5m forming bar');

    // ---- play / pause / step back ----
    await p.evaluate(() => window.__stkBarReplay.setSpeed(10));
    await p.click('.stkr-playb');
    await sleep(2500);
    await p.click('.stkr-playb');
    await sleep(600);
    const st2 = await RS(p);
    // >= 2 steps in 2.5 s: each step reloads every series, so on a loaded 4 GB server 10 steps/s is not reached (fails on old code too)
    check(!st2.playing && st2.E >= st.E + 2 * MIN, 'play at 10x then pause: clock moved ' + (st2.E - st.E) / MIN + ' min');
    sh = await shown(p);
    check(sh.maxT < st2.E, 'still no bar at/after the clock after playing');
    await p.click('.stkr-backb');
    await waitFor(p, (e) => window.__stkBarReplay.state.E < e && !window.__stkBarReplay.state.busy, st2.E, 15000);
    await sleep(1500);
    const st3 = await RS(p); sh = await shown(p);
    check(st3.E === st2.E - MIN && sh.maxT < st3.E, 'step back: clock -1 min, chart reloaded to it (' + new Date(st3.E).toISOString() + ')');
    const exp3 = expectedLast(st3.E, MIN, NQ_BASE, 5 * MIN);
    check(near(sh.last.close, exp3.close) && near(sh.last.high, exp3.high), 'after step back the forming bar matches the truncated data');
    await pineCheck(p, 'NQ1! 5m after step back');

    // ---- intra-bar real-time replay (Owner 2026-10-14): the forming candle moves inside a step ----
    {
      const r0 = await RS(p);
      await p.evaluate(() => { window.__rtSeen = []; const c = window.STRYKER_VELA.chart; window.__rtIv = setInterval(() => { const rb = c.orchestrator.rawBars; const b = rb[rb.length - 1]; if (b) window.__rtSeen.push([b.time, b.close, b.high, b.low]); }, 50); });
      await p.evaluate(() => { window.__stkBarReplay.pause(); window.__stkBarReplay.setRealtime(30); });
      const playMs = await p.evaluate(async () => { const t0 = performance.now(); window.__stkBarReplay.play(); await new Promise((r) => setTimeout(r, 4000)); window.__stkBarReplay.pause(); return performance.now() - t0; });
      await sleep(300);
      const r1 = await RS(p);
      const seen = await p.evaluate(() => { clearInterval(window.__rtIv); return window.__rtSeen; });
      const lbl = await p.evaluate(() => !document.querySelector('.stkr-sim').hidden);
      const closes = new Set(seen.map((x) => x[0] + '|' + x[1]));
      const moved = (r1.E - r0.E) / 1000, want = playMs / 1000 * 30;
      check(r1.rt === 30 && moved > want * 0.7 && moved < want * 1.3, 'real-time 30x: clock moved ' + moved.toFixed(0) + ' s in ' + (playMs / 1000).toFixed(1) + ' s of play (want ~' + want.toFixed(0) + ')');
      check(closes.size >= 12, 'forming candle changed ' + closes.size + ' times in ' + (playMs / 1000).toFixed(1) + ' s (' + (closes.size / playMs * 1000).toFixed(1) + '/s, >= 3/s)');
      check(r1.sim === true && lbl, 'no tick record here -> "(simulated path)" label shown');
      sh = await shown(p);
      check(sh.maxT < r1.E, 'real-time replay: still no bar at/after the clock');
      const opt = await p.evaluate(() => [...document.querySelectorAll('.stkr-speed option')].map((o) => o.textContent).join(','));
      check(/1x,2x,5x,10x,30x,60x/.test(opt) && /bar/.test(opt), 'speed menu has 1x..60x real time + bar per step: ' + opt);
      await p.evaluate(() => window.__stkBarReplay.setSpeed(1));
      // land back on a whole update-interval boundary for the step checks below
      await p.evaluate(() => window.__stkBarReplay.stepForward());
      await sleep(800);
      st = await RS(p); sh = await shown(p);
    }

    // ---- replay paper: market + bracket on replayed bars ----
    const lastPx = await p.evaluate(() => window.__stkPaper.account.last['futures:NQ1!']);
    check(Number.isFinite(lastPx) && near(lastPx, sh.last.close), 'Replay account price = the replayed close (' + lastPx + ')');
    const stP = await RS(p);
    await p.evaluate((px) => window.__stkPaper.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1, tp: px + 2, sl: px - 30 }), lastPx);
    await sleep(500);
    const rp1 = await p.evaluate(() => { const a = window.__stkPaper.account; const pos = a.position('futures:NQ1!'); return pos && { avg: pos.avg, tp: pos.tp, openedAt: pos.openedAt }; });
    check(rp1 && rp1.openedAt === stP.E, 'replay market buy filled at the replay clock: ' + JSON.stringify(rp1));
    await p.screenshot({ path: path.join(OUT, 'replay-1280-position.png') });
    let tpHit = false;
    for (let k = 0; k < 60 && !tpHit; k++) {
      await p.evaluate(() => window.__stkBarReplay.stepForward());
      tpHit = await p.evaluate(() => !window.__stkPaper.account.position('futures:NQ1!'));
    }
    const tr = await p.evaluate(() => { const h = window.__stkPaper.account.state.trades || []; return JSON.parse(JSON.stringify(h[h.length - 1] || null)); });
    const stE = await RS(p);
    check(tpHit && tr && (tr.reason === 'tp' || tr.reason === 'sl') && tr.exitAt < stE.E, 'bracket exit on a replayed bar: ' + JSON.stringify(tr && { reason: tr.reason, exit: tr.exit, exitAt: tr.exitAt && new Date(tr.exitAt).toISOString() }));
    const snd = await p.evaluate(() => window.__simSounds.filter((x) => /replay/.test(x)));
    check(snd.some((x) => /^long/.test(x)) && snd.some((x) => /^(tp|sl)/.test(x)), 'chart sounds fired for replay trades: ' + snd.join(','));

    // ---- timeframe switch keeps the replay time ----
    const before = await RS(p);
    await p.evaluate(() => window.STRYKER_VELA.active.setTimeframe('15'));
    await waitFor(p, () => window.STRYKER_VELA.chart.market.timeframe === '15' && window.STRYKER_VELA.chart.orchestrator.rawBars.length > 20, null, 15000);
    await sleep(2000);
    const after = await RS(p); sh = await shown(p);
    check(after.on && after.E === before.E && sh.maxT < after.E && sh.maxT >= after.E - 15 * MIN, 'TF 5m -> 15m keeps the clock (' + new Date(after.E).toISOString() + '), newest bar ' + new Date(sh.maxT).toISOString());
    await p.evaluate(() => window.STRYKER_VELA.active.setTimeframe('5'));
    await waitFor(p, () => window.STRYKER_VELA.chart.market.timeframe === '5' && window.STRYKER_VELA.chart.orchestrator.rawBars.length > 20, null, 15000);
    await sleep(1500);

    // ---- reload resumes ----
    const preReload = await RS(p);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkBarReplay && window.__stkBarReplay.state.on && !window.__stkBarReplay.state.busy, null, { timeout: 60000 }).catch(() => {});
    await sleep(2500);
    const post = await RS(p); sh = await shown(p);
    check(post.on && post.E === preReload.E && post.stepTf === preReload.stepTf && sh.maxT < post.E, 'reload resumes the replay at the same time (' + new Date(post.E).toISOString() + ', step ' + post.stepTf + ')');
    check(await p.evaluate(() => window.__stkPaper.replay && (window.__stkPaper.account.state.trades || []).length >= 1), 'Replay account history survives the reload');

    // ---- exit restores live ----
    await p.click('.stkr-xb');
    await waitFor(p, () => !window.__stkBarReplay.state.on, null, 10000);
    await waitFor(p, () => { const b = window.STRYKER_VELA.chart.orchestrator.rawBars; return b.length && b[b.length - 1].time > Date.now() - 15 * 60000; }, null, 20000);
    sh = await shown(p);
    const nowV = await p.evaluate(() => Date.now());
    check(sh.maxT > nowV - 15 * MIN, 'exit: live chart back (newest bar ' + new Date(sh.maxT).toISOString() + ')');
    const live1 = await p.evaluate(() => JSON.stringify({ pos: window.__stkPaper.account.state.positions, bal: window.__stkPaper.account.state.balance, h: window.__stkPaper.account.state.history.length }));
    check(live1 === live0 && await p.evaluate(() => !window.__stkPaper.replay), 'live paper account untouched by replay');
    check(await p.evaluate(() => !localStorage.getItem('stryker_bar_replay_v1') && document.getElementById('stkr-bar').hidden && document.querySelector('.stkr-badge').hidden), 'exit clears the saved session, bar and badge');

    // ---- history depth: 1m only goes back ~29 days (production depth); replay must fall back ----
    await p.evaluate(() => {
      window.__toasts = [];
      const orig = window.showToast;
      window.showToast = function (type, m) { window.__toasts.push(String(m)); return orig && orig.apply(this, arguments); };
    });
    const TFMS = { D: 1440 * MIN, '60': 60 * MIN };
    for (const [tf, days, want] of [['D', 90, '60'], ['60', 45, '5'], ['60', 10, '1']]) {
      await setMarket(p, 'futures:NQ1!', tf);
      await p.evaluate(() => { window.__toasts = []; });
      const E0 = Math.floor((T0 - days * 86400000) / 86400000) * 86400000 + 15 * 3600000;
      await p.evaluate(async (E) => { await window.__stkBarReplay.setStepTf('1'); await window.__stkBarReplay.start(E); }, E0);
      await waitFor(p, () => window.__stkBarReplay.state.on && !window.__stkBarReplay.state.busy, null, 30000);
      await sleep(1200);
      let s = await p.evaluate(() => window.__stkBarReplay.state);
      const sel = await p.evaluate(() => { const x = document.querySelector('.stkr-step'); return x ? x.value : null; });
      check(s.stepTf === '1' && s.effTf === want && sel === want, `depth ${tf} ${days}d back: member picked 1m, replay steps by ${s.effTf} (want ${want}), Step select shows ${sel}`);
      const res = [], gaps = [];
      let prevE = s.E, jumpOk = true, hiddenOk = true;
      for (let k = 0; k < 4; k++) {
        res.push(await p.evaluate(() => window.__stkBarReplay.stepForward()));
        s = await p.evaluate(() => window.__stkBarReplay.state);
        gaps.push((s.E - prevE) / MIN);
        if (s.E - prevE > TFMS[tf] || s.E <= prevE) jumpOk = false;
        prevE = s.E;
      }
      await sleep(800);
      const sh = await shown(p);
      if (!(sh.maxT < s.E)) hiddenOk = false;
      check(res.every(Boolean), `depth ${tf} ${days}d back: 4 steps all move forward ${JSON.stringify(res)}`);
      check(jumpOk && hiddenOk, `depth ${tf} ${days}d back: no step jumps past a chart bar (step sizes in minutes ${JSON.stringify(gaps)}), newest shown ${new Date(sh.maxT).toISOString()} < clock ${new Date(s.E).toISOString()}`);
      const ex = expectedLast(s.E, Number(want) * MIN, NQ_BASE, TFMS[tf]);
      check(sh.last && sh.last.time === ex.time && near(sh.last.close, ex.close) && near(sh.last.high, ex.high) && near(sh.last.low, ex.low),
        `depth ${tf} ${days}d back: forming bar rebuilt from ${want}m steps (close ${sh.last && sh.last.close} vs ${ex.close})`);
      const toasts = await p.evaluate(() => window.__toasts.slice());
      const note = toasts.filter((m) => /only goes back about a month/.test(m));
      if (want === '1') check(note.length === 0 && !toasts.some((m) => /newest bar/.test(m)), `depth ${tf} ${days}d back: 1m covers it, no note, no "newest bar" (${JSON.stringify(toasts)})`);
      else check(note.length === 1 && note[0] === '1m data only goes back about a month here, so replay steps by ' + (want === '60' ? '1h' : want + 'm') + '.' && !toasts.some((m) => /newest bar/.test(m)),
        `depth ${tf} ${days}d back: told once in plain words: ${JSON.stringify(toasts)}`);
      await p.evaluate(() => window.__stkBarReplay.exit()); await sleep(2000);
    }
    // 1h, 45 days back, played forward into the 1m zone: switches back to 1m without a jump
    {
      await setMarket(p, 'futures:NQ1!', '60');
      const E0 = Math.floor(vnowNode() / (60 * MIN)) * 60 * MIN - 29 * 86400000 - 3 * 60 * MIN;
      await p.evaluate(async (E) => { await window.__stkBarReplay.setStepTf('1'); await window.__stkBarReplay.start(E); }, E0);
      await waitFor(p, () => window.__stkBarReplay.state.on && !window.__stkBarReplay.state.busy, null, 30000);
      const seen = new Set(); let prev = (await RS(p)).E, ok = true;
      for (let k = 0; k < 80; k++) {
        if (!await p.evaluate(() => window.__stkBarReplay.stepForward())) { ok = false; break; }
        const s = await p.evaluate(() => window.__stkBarReplay.state);
        seen.add(s.effTf);
        if (s.E - prev > 60 * MIN || s.E <= prev) { ok = false; break; }
        prev = s.E;
        if (s.effTf === '1' && seen.size > 1) break;
      }
      check(ok && seen.has('1') && seen.size > 1, `depth 1h at the 29-day edge: steps through it with no jump, intervals used ${JSON.stringify([...seen])}`);
      await p.evaluate(() => window.__stkBarReplay.exit()); await sleep(2000);
    }
    // "Reached the newest bar" only at the live edge
    {
      await setMarket(p, 'futures:NQ1!', '5');
      await p.evaluate(() => { window.__toasts = []; });
      const E0 = Math.floor(vnowNode() / (5 * MIN)) * 5 * MIN - 5 * MIN;
      await p.evaluate(async (E) => { await window.__stkBarReplay.setStepTf('1'); await window.__stkBarReplay.start(E); }, E0);
      await waitFor(p, () => window.__stkBarReplay.state.on && !window.__stkBarReplay.state.busy, null, 30000);
      let n = 0;
      while (n < 20 && await p.evaluate(() => window.__stkBarReplay.stepForward())) n++;
      const s = await RS(p), toasts = await p.evaluate(() => window.__toasts.slice());
      check(n < 20 && toasts.some((m) => /reached the newest bar/.test(m)) && s.E >= vnowNode() - 2 * MIN, `live edge: ${n} steps, then "newest bar" (${JSON.stringify(toasts)})`);
      await p.evaluate(() => window.__stkBarReplay.exit()); await sleep(2000);
    }

    // ---- BTCUSDT 1m ----
    await setMarket(p, 'binance:BTCUSDT', '1');
    await p.evaluate(() => window.__stkBarReplay.startRandom());
    await waitFor(p, () => window.__stkBarReplay.state.on && !window.__stkBarReplay.state.busy, null, 20000);
    await sleep(1500);
    let bs = await RS(p);
    for (let k = 0; k < 4; k++) await p.evaluate(() => window.__stkBarReplay.stepForward());
    await sleep(800);
    const bs2 = await RS(p); sh = await shown(p);
    const eb = expectedLast(bs2.E, MIN, BTC_BASE, MIN);
    check(bs.on && bs2.E === bs.E + 4 * MIN && sh.maxT === bs2.E - MIN && near(sh.last.close, eb.close), 'BTCUSDT 1m: random start, 4 steps, newest bar = the last complete minute, close ' + sh.last.close + ' (expected ' + eb.close + ')');
    await pineCheck(p, 'BTCUSDT 1m');
    await p.evaluate(() => window.__stkBarReplay.exit());
    await sleep(1500);
    check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
    await ctx.close();

    // ================= phone =================
    const P = await newPage(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await boot(P.p, BASE);
    await setMarket(P.p, 'futures:NQ1!', '5');
    await P.p.evaluate(() => window.__stkBarReplay.selectMode(true));
    await sleep(300);
    const pb = await P.p.evaluate(() => { const R = window.STRYKER_VELA.chart.renderer.renderer; const r = R.input.el.getBoundingClientRect(); return { x: r.left + R.coords.width * 0.55, y: r.top + r.height * 0.4 }; });
    await P.p.mouse.move(pb.x, pb.y); await sleep(300);
    await P.p.screenshot({ path: path.join(OUT, 'replay-390-scissor.png') });
    await P.p.mouse.click(pb.x, pb.y);
    await waitFor(P.p, () => window.__stkBarReplay.state.on && !window.__stkBarReplay.state.busy, null, 20000);
    await sleep(1500);
    const lp = await P.p.evaluate(() => window.__stkPaper.account.last['futures:NQ1!']);
    await P.p.evaluate((px) => window.__stkPaper.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1, tp: px + 40, sl: px - 40 }), lp);
    for (let k = 0; k < 3; k++) await P.p.evaluate(() => window.__stkBarReplay.stepForward());
    await sleep(1200);
    const geo = await P.p.evaluate(() => { const r = document.getElementById('stkr-bar').getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, h: r.height, vw: innerWidth, vh: innerHeight }; });
    check(geo.l >= 0 && geo.r <= geo.vw && geo.b <= geo.vh, 'phone: control bar docked inside the screen ' + JSON.stringify(geo));
    await P.p.screenshot({ path: path.join(OUT, 'replay-390-bar.png') });
    check(P.errors.length === 0, 'phone: no console errors' + (P.errors.length ? ': ' + P.errors.slice(0, 4).join(' | ') : ''));
    await P.ctx.close();
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  finally { timers.forEach(clearInterval); await b.close(); srv.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
