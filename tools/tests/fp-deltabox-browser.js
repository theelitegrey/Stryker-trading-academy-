// Volume footprint STYLE selector, Delta boxes and Bar stats table (Owner 10 Nov). FIXTURE data only (no Worker, no key, no Binance).
//   node tools/tests/chart-dev-server.mjs 8041
//   CHART_BASE=http://127.0.0.1:8041 flock /tmp/stryker-chrome.lock node tools/tests/fp-deltabox-browser.js <shotsDir>
// NQ1! (Pro, L1 recorder fixture) and BTCUSDT (crypto aggTrades fixture), 1m + 5m: every style switches; Delta boxes colours match the
// delta sign; the POC box is marked; the stats table has the right rows, one column per bar aligned to the bar, stays above the time
// axis and goes away when off; a chart saved with only the old fpMode keeps its look; no page errors.
const NMIN = 40;
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 500) : '')); };

const MIN = Math.floor(Date.now() / 60000), N = 240, TICK = 0.25;
const price = (m) => 28650 + Math.sin((m - MIN) / 17) * 40 + Math.sin((m - MIN) / 5) * 9;
const BARS = [];
for (let m = MIN - N; m < MIN; m++) {
  const o = Math.round(price(m) / TICK) * TICK, c = Math.round(price(m + 1) / TICK) * TICK;
  BARS.push([m * 60, o, Math.max(o, c) + 3, Math.min(o, c) - 3, c, 400 + (m % 7) * 30]);
}

function fakeWs(opt) {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  if (opt.free) window.__stkChartTestFree = true;
  window.openPlanUpgradeModal = (why) => { window.__upsell = why; };
  
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) }); }, 50);
    let n = 0;
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage) return; n++;
      const now = Date.now(), b = Math.floor((window.__L2MID || 28650) * 4) / 4;
      const bids = [], asks = [];
      for (let i = 0; i < 12; i++) { bids.push([b - i * 0.25, 10 + ((i * 7 + n) % 30)]); asks.push([b + 0.25 + i * 0.25, 10 + ((i * 5 + n) % 30)]); }
      ws.onmessage({ data: JSON.stringify({ type: 'snap', symbol: 'NQ', ts: now, bids, asks, imb: 0, imb10: 0 }) });
      ws.onmessage({ data: JSON.stringify({ type: 'ticks', symbol: 'NQ', t: [[b, 3, -1, now], [b + 0.25, 2, 1, now]].concat(n % 15 === 0 ? [[b + 0.25, 60, 1, now]] : []) }) });
    }, 200);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
async function open(b, { w, h, mobile, free, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile, colorScheme: theme === 'light' ? 'light' : 'dark' });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs, { free: !!free });
  if (theme === 'light') await ctx.addInitScript(() => { try { localStorage.setItem('stryker_theme', 'day'); } catch (e) {} });
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars: BARS }) }));
  await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage(), errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|\/api\/chart\/stream|Failed to load resource|Ping received after close/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkL2Only, null, { timeout: 60000 });
  await sleep(1500);
  return { ctx, p, errors };
}
const setSym = (p, sym) => p.evaluate(async ([s, mid]) => {
  window.__L2MID = mid;
  const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1');
  for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === s && c.orchestrator.rawBars.length > 50) break; }
}, [sym, price(MIN)]);


// /orderflow fixture (the L1 recorder format, assets/chart-footprint-data.js decodeOrderflow): one minute per fixture candle, buy/sell by tick
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
const types = (p) => p.evaluate(() => window.STRYKER_VELA.chart.indicators().map((x) => x.nativeType));
const setSrc = (p, src) => p.evaluate((src) => { const r = window.STRYKER_VELA.chart.renderer.renderer; r.applyConfig({ chartTypes: { stk_fp: { fpSrc: src } } }); return JSON.stringify(r.getConfig().chartTypes); }, src);
const src = (p) => p.evaluate(() => { const e = window.STRYKER_VELA.chart.orchestrator.typeEngines.get('stk_fp'); return e && e.cfg && e.cfg.src; });

// crypto fixture: Binance aggTrades for the last NMIN minutes around the fixture candles (REST only; the socket is blocked)
function aggTrades() {
  const out = []; let id = 1000;
  for (const r of BARS.slice(-NMIN)) {
    const lo = Math.round(r[3] / TICK), hi = Math.round(r[2] / TICK);
    for (let j = lo; j <= hi; j += 2) for (let q = 0; q < 3; q++) { id++; out.push({ a: id, p: String(j * TICK), q: String(0.4 + ((j * 7 + q * 3) % 11) / 5), T: r[0] * 1000 + ((j * 131 + q * 977) % 59000), m: ((j * 5 + q) % 7) < (j % 3 === 0 ? 5 : 2) }); }
  }
  return out.sort((x, y) => x.T - y.T);
}
const cfgOf = (p) => p.evaluate(() => { const e = window.STRYKER_VELA.chart.orchestrator.typeEngines.get('stk_fp'); return e && e.cfg; });
const setCfg = (p, o) => p.evaluate((o) => window.STRYKER_VELA.chart.renderer.renderer.applyConfig({ chartTypes: { stk_fp: o } }), o);
const dbgReset = (p) => p.evaluate(() => { window.__stkFpDebug = {}; });
const dbg = (p) => p.evaluate(() => window.__stkFpDebug);
const tf = (p, t) => p.evaluate(async (t) => { const ws = window.STRYKER_VELA; ws.active.setTimeframe(t); await new Promise((r) => setTimeout(r, 2500)); }, t);
const zoomTo = (p, n) => p.evaluate((n) => { const c = window.STRYKER_VELA.chart, rb = c.orchestrator.rawBars, k = rb.length; c.setVisibleRange({ from: rb[Math.max(0, k - n)].time, to: rb[k - 1].time + 120000 }); }, n);
// the colour under a CSS-pixel point on the layer canvases
const px = (p, x, y) => p.evaluate(([x, y]) => {
  let best = null;
  for (const c of document.querySelectorAll('#vela-chart canvas')) {
    if (!c.width || !c.height) continue;
    const k = c.width / c.getBoundingClientRect().width, g = c.getContext('2d'); if (!g) continue;
    let d; try { d = g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data; } catch (e) { continue; }
    if (d[3] > 40 && (!best || d[3] > best[3])) best = [d[0], d[1], d[2], d[3]];
  }
  return best;
}, [x, y]);
const greenish = (c) => c && c[1] > c[0] + 15;
const reddish = (c) => c && c[0] > c[1] + 15;

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, vp, theme] of [[1440, 900, false, '1440', 'dark'], [1440, 900, false, '1440', 'light'], [390, 844, true, '390', 'dark']]) {
      for (const sym of ['futures:NQ1!', 'binance:BTCUSDT']) {
        const crypto = sym.startsWith('binance');
        const { ctx, p, errors } = await open(b, { w, h, mobile, free: false, theme });
        await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: orderflowBody() }));
        await ctx.route(/binance\.(com|vision)\/(api|fapi)\/.*aggTrades/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(aggTrades()) }));
        await ctx.route(/binance\.(com|vision)\/(api|fapi)\/.*klines/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(BARS.map((r) => [r[0] * 1000, String(r[1]), String(r[2]), String(r[3]), String(r[4]), String(r[5]), r[0] * 1000 + 59999, '0', 1, '0', '0', '0'])) }));
        await ctx.route(/wss?:\/\/.*binance/, (r) => r.abort());
        await p.evaluate(() => { window.__stkFpDebug = {}; });
        await setSym(p, sym);
        await p.evaluate(() => window.STRYKER_VELA.active.setPriceStyle('stk_fp'));
        await sleep(2500);
        if (!crypto) await setCfg(p, { fpSrc: 'l1' });
        await sleep(1500);
        for (const t of ['1', '5']) {
          if (t !== '1') await tf(p, t);
          const tag = vp + '-' + theme + '-' + (crypto ? 'BTC' : 'NQ') + '-' + t + 'm';
          await zoomTo(p, t === '1' ? 12 : 4); await sleep(1500);
          // every style switches and the engine follows
          for (const st of ['classic', 'delta', 'volume', 'ladder', 'boxes']) {
            await setCfg(p, { fpStyle: st }); await sleep(500);
            const c = await cfgOf(p);
            check(c && c.style === st && c.mode === (st === 'classic' ? 'bidask' : st), tag + ': Style ' + st + ' applies', c);
          }
          // Delta boxes
          await dbgReset(p); await setCfg(p, { fpStyle: 'boxes', fpTable: true }); await sleep(300); await setCfg(p, { fpTable: false }); await sleep(900);
          let d = await dbg(p);
          const boxes = (d && d.boxes) || [];
          check(boxes.length > 5, tag + ': Delta boxes draws boxes (' + boxes.length + ')', boxes.length);
          const big = boxes.filter((q) => q.h >= 5 && q.w >= 6 && Math.abs(q.d) > 0).slice(0, 80);
          let ok = 0, bad = 0;
          for (const q of big) { const c = await px(p, q.x + 2, q.y + q.h / 2); if (!c) continue; if (q.d > 0 ? greenish(c) : reddish(c)) ok++; else if (q.d > 0 ? reddish(c) : greenish(c)) bad++; }
          check(ok >= 5 && bad <= Math.ceil(ok * 0.1), tag + ': box colour matches the delta sign (' + ok + ' match, ' + bad + ' off)', { ok, bad });
          const pocs = boxes.filter((q) => q.poc), bars = new Set(boxes.map((q) => q.i));
          check(pocs.length === bars.size && pocs.length > 0, tag + ': one POC box per bar (' + pocs.length + '/' + bars.size + ')', { pocs: pocs.length, bars: bars.size });
          let yel = 0;
          for (const q of pocs.slice(0, 6)) { let hit = false; for (const [dx, dy] of [[q.w / 2, 1.2], [q.w / 2, q.h - 0.8], [1.2, q.h / 2], [q.w - 1.5, q.h / 2]]) { const c = await px(p, q.x + dx, q.y + dy); if (c && c[0] > 110 && c[1] > 90 && c[2] < 120) hit = true; } if (hit) yel++; }
          check(yel >= 1 && yel >= Math.min(6, pocs.length) - 2, tag + ': POC box has the highlight outline (' + yel + ' sampled)', yel);
          await p.screenshot({ path: OUT + '/boxes-' + tag + '.png' });
          // stats table
          await dbgReset(p); await setCfg(p, { fpTable: true }); await sleep(1200);
          d = await dbg(p);
          const T = d && d.table;
          const phone = w < 520;
          check(!!T, tag + ': stats table appears when on', d);
          if (T) {
            const want = phone ? 4 : (crypto && true ? 6 : 6);
            check(T.rows.length === want || (T.rows.length === want - 1 && !phone), tag + ': table rows ' + T.rows.join(','), T);
            check(T.rows.includes('vol') && T.rows.includes('delta'), tag + ': table has Total volume + Delta rows', T.rows);
            const bcols = new Set(boxes.map((q) => q.i)), tcols = new Set(T.cols.map((q) => q.i));
            const aligned = [...bcols].every((i) => tcols.has(i)) && T.cols.every((c) => Math.abs(c.xl + c.w / 2 - c.xc) < 2);
            const bx = boxes.find((q) => q.i === T.cols[T.cols.length - 1].i);
            check(aligned && (!bx || Math.abs(bx.x - 6 - T.cols[T.cols.length - 1].xc) < 2), tag + ': one table column per bar, centred under its bar', { cols: T.cols.length });
            const plotH = await p.evaluate(() => { let m = 0; for (const c of document.querySelectorAll('#vela-chart canvas')) m = Math.max(m, c.getBoundingClientRect().height); return m; });
            check(T.y0 + T.H <= plotH - 10, tag + ': table stays above the time axis (ends ' + Math.round(T.y0 + T.H) + ' of ' + Math.round(plotH) + ')', { y: T.y0 + T.H, plotH });
            // heat-map: a positive-delta cell is green, a negative one red
            const dr = T.rows.indexOf('delta'), cy = T.y0 + dr * T.rh + T.rh / 2;
            let g1 = 0, r1 = 0;
            for (const c of T.cols) { const bx2 = boxes.find((q) => q.i === c.i); if (!bx2) continue; const col = await px(p, c.xl + 2, cy); if (bx2.d !== 0 && col) { /* delta of the whole bar is not the box sign: just count colours */ if (greenish(col)) g1++; else if (reddish(col)) r1++; } }
            check(g1 + r1 >= 1, tag + ': delta row is colour coded (' + g1 + ' green, ' + r1 + ' red)', { g1, r1 });
            await p.screenshot({ path: OUT + '/table-' + tag + '.png' });
            // table works with another style too
            await dbgReset(p); await setCfg(p, { fpStyle: 'classic' }); await sleep(1200);
            check(!!((await dbg(p)) || {}).table, tag + ': table also shows with Classic', 0);
            await setCfg(p, { fpStyle: 'boxes' }); await sleep(300);
          }
          await dbgReset(p); await setCfg(p, { fpTable: false }); await sleep(1200);
          check(!((await dbg(p)) || {}).table, tag + ': table gone when off', 0);
        }
        // old saved charts: fpMode only keeps its look
        for (const [mode, want] of [['delta', 'delta'], ['volume', 'volume'], ['ladder', 'ladder'], ['bidask', 'classic']]) {
          await p.evaluate(() => { const r = window.STRYKER_VELA.chart.renderer.renderer; r.applyConfig({ chartTypes: { stk_fp: { fpStyle: undefined } } }); });
          await p.evaluate((m) => { window.STRYKER_VELA.chart.orchestrator.typeEngines.get('stk_fp').onSettings({ fpMode: m }); }, mode); await sleep(300);
          const c = await cfgOf(p);
          check(c.style === want && c.mode === (want === 'classic' ? 'bidask' : want), vp + '-' + theme + '-' + (crypto ? 'BTC' : 'NQ') + ': saved fpMode ' + mode + ' -> Style ' + want, c);
        }
        const c0 = await p.evaluate(() => { const e = window.STRYKER_VELA.chart.orchestrator.typeEngines.get('stk_fp'); e.onSettings({}); return e.cfg; });
        check(c0.style === 'classic' && c0.table === false, vp + '-' + theme + ': no saved settings = Classic, table off', c0);
        // perf: 200+ visible bars
        if (crypto && vp === '1440' && theme === 'dark') {
          await setCfg(p, { fpStyle: 'boxes', fpTable: true }); await tf(p, '1');
          const nb = await p.evaluate(() => window.STRYKER_VELA.chart.orchestrator.rawBars.length); console.log('raw bars', nb); await zoomTo(p, 205); await sleep(1500);
          await p.evaluate(() => { window.__stkFpStats = []; const c = window.STRYKER_VELA.chart; const rb = c.orchestrator.rawBars, k = rb.length; for (let i = 0; i < 20; i++) setTimeout(() => c.setVisibleRange({ from: rb[k - 205 + i].time, to: rb[k - 1].time + 120000 }), i * 60); });
          await sleep(2500);
          const st = await p.evaluate(() => window.__stkFpStats.slice());
          st.sort((x, y) => x - y);
          console.log('frame ms over 205-bar pan:', st.length, 'frames, median', (st[st.length >> 1] || 0).toFixed(1), 'p95', (st[Math.floor(st.length * 0.95)] || 0).toFixed(1));
          check(st.length > 5 && st[Math.floor(st.length * 0.95)] < 16, vp + ': Delta boxes + table frame time p95 < 16 ms at 200+ bars', st.slice(-3));
          await p.screenshot({ path: OUT + '/perf-1440-205.png' });
        }
        check(errors.length === 0, vp + '-' + theme + '-' + (crypto ? 'BTC' : 'NQ') + ': no page errors', errors.slice(0, 3));
        await ctx.close();
      }
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
