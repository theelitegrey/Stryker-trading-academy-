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
const fmtD = (v) => { const a = Math.abs(v), s = v < 0 ? '\u2212' : ''; if (a >= 1e7) return s + Math.round(a / 1e6) + 'M'; if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M'; if (a >= 1e4) return s + Math.round(a / 1e3) + 'K'; if (a >= 1e3) return s + (a / 1e3).toFixed(1) + 'K'; if (Number.isInteger(a) || a >= 100) return s + Math.round(a); return a < 0.005 ? '0' : s + +a.toFixed(a >= 10 ? 1 : 2); };
const greenish = (c) => c && c[1] > c[0] + 15;
const reddish = (c) => c && c[0] > c[1] + 15;

// Footprint colours, text size and table / strip positions (member request 11 Nov). FIXTURE data only.
//   node tools/tests/chart-dev-server.mjs 8147
//   CHART_BASE=http://127.0.0.1:8147 flock /tmp/stryker-chrome.lock node tools/tests/fp-colors-browser.js <shotsDir>
const cfg = (p) => p.evaluate(() => { const e = window.STRYKER_VELA.chart.orchestrator.typeEngines.get('stk_fp'); return e && e.cfg; });
const saved = (p) => p.evaluate(() => window.STRYKER_VELA.chart.renderer.renderer.getConfig().chartTypes.stk_fp);
const margins = (p) => p.evaluate(() => window.STRYKER_VELA.chart.renderer.renderer.getConfig().margins);
const near = (c, r, g, b) => c && Math.abs(c[0] - r) < 40 && Math.abs(c[1] - g) < 40 && Math.abs(c[2] - b) < 40;
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, vp, theme] of [[1440, 900, false, '1440', 'dark'], [1440, 900, false, '1440', 'light'], [390, 844, true, '390', 'dark']]) {
      const tag = vp + '-' + theme, phone = w < 520;
      const { ctx, p, errors } = await open(b, { w, h, mobile, free: false, theme });
      await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: orderflowBody() }));
      await setSym(p, 'futures:NQ1!');
      await p.evaluate(() => window.STRYKER_VELA.active.setPriceStyle('stk_fp'));
      await sleep(2500); await setCfg(p, { fpSrc: 'l1', fpStyle: 'classic', fpTable: true }); await sleep(1500);
      await zoomTo(p, 12); await sleep(1500);
      // defaults: nothing changed
      let c = await cfg(p);
      check(c.buyC === null && c.sellC === null && c.adj === 0 && c.tblPos === 'br' && c.statsPos === 'bl', tag + ': defaults = today (no colour override, normal size, table bottom right, strip bottom left)', c);
      await dbgReset(p); await sleep(900);
      const D0 = await dbg(p), T0 = D0.table, S0 = D0.strip;
      await p.screenshot({ path: OUT + '/colors-' + tag + '-default.png' });
      check(phone ? !!T0 : T0 && S0 && S0.y0 + S0.h <= T0.y0 + 0.5, tag + ': strip sits above the table, no overlap (strip ' + Math.round(S0 ? S0.y0 + S0.h : 0) + ' <= table ' + Math.round(T0 && T0.y0) + ')', { T0, S0 });
      const plotH = await p.evaluate(() => { let m = 0; for (const c of document.querySelectorAll('#vela-chart canvas')) m = Math.max(m, c.getBoundingClientRect().height); return m; });
      // colours: the delta heat-map cell of the table follows the picked colours
      await setCfg(p, { fpBuyColor: '#3b82f6', fpSellColor: '#f59e0b' }); await dbgReset(p); await sleep(1200);
      c = await cfg(p);
      check(c.buyC === '#3b82f6' && c.sellC === '#f59e0b', tag + ': picked colours reach the footprint', c);
      const T1 = (await dbg(p)).table, sr = T1.rows.indexOf('sell'), br = T1.rows.indexOf('buy');
      const colr = T1.cols[Math.floor(T1.cols.length / 2)];
      const sp = await px(p, colr.xl + 3, T1.y0 + sr * T1.rh + 3), bp = await px(p, colr.xl + 3, T1.y0 + br * T1.rh + 3);
      check(near(sp, 245, 158, 11) || (sp && sp[0] > sp[2] + 40 && sp[1] > 90), tag + ': Sell row is amber now', sp);
      check(near(bp, 59, 130, 246) || (bp && bp[2] > bp[0] + 40), tag + ': Buy row is blue now', bp);
      await p.screenshot({ path: OUT + '/colors-' + tag + '-picked.png' });
      // they persist in the saved chart settings (layouts and templates store the whole renderer config) and survive a restore
      const sv = await saved(p);
      check(sv && sv.fpBuyColor === '#3b82f6' && sv.fpSellColor === '#f59e0b', tag + ': saved in the chart settings', sv);
      await p.evaluate((sv) => { const r = window.STRYKER_VELA.chart.renderer.renderer; r.applyConfig({ chartTypes: { stk_fp: { fpBuyColor: '#03c988', fpSellColor: '#f23645' } } }); window.__sv = sv; }, sv);
      await sleep(600); c = await cfg(p);
      check(c.buyC === null && c.sellC === null, tag + ': the default colours mean "no override"', c);
      await p.evaluate(() => { const r = window.STRYKER_VELA.chart.renderer.renderer; r.applyConfig({ chartTypes: { stk_fp: window.__sv } }); }); await sleep(600);
      c = await cfg(p);
      check(c.buyC === '#3b82f6' && c.sellC === '#f59e0b', tag + ': restoring a saved config brings the colours back', c);
      // text size
      await setCfg(p, { fpTextSize: 'large' }); await sleep(900); c = await cfg(p);
      check(c.adj === 2, tag + ': text size Large', c.adj);
      await setCfg(p, { fpTextSize: 'small' }); await sleep(900); c = await cfg(p);
      check(c.adj === -1, tag + ': text size Small', c.adj);
      await setCfg(p, { fpTextSize: 'xlarge' }); await dbgReset(p); await sleep(1200);
      const Tx = (await dbg(p)).table;
      check(Tx.rh >= (phone ? 14 : 16) && Tx.y0 + Tx.H <= plotH - 10, tag + ': extra large text: table still above the time axis', Tx);
      await p.screenshot({ path: OUT + '/colors-' + tag + '-xlarge.png' });
      await setCfg(p, { fpTextSize: 'normal' });
      // positions
      for (const [tp, sp2] of [['tl', 'tr'], ['tr', 'bl'], ['bl', 'tl'], ['br', 'br']]) {
        await setCfg(p, { fpTablePos: tp, fpStatsPos: sp2 }); await dbgReset(p); await sleep(1500);
        const D = await dbg(p), T = D.table, S = D.strip;
        const tTop = T.y0 < plotH / 2;
        check(tTop === (tp[0] === 't'), tag + ': table ' + tp + ' is at the ' + (tTop ? 'top' : 'bottom'), { y0: T.y0 });
        if (!phone) {
          check(S && (S.y0 < plotH / 2) === (sp2[0] === 't'), tag + ': strip ' + sp2 + ' is at the ' + (S && S.y0 < plotH / 2 ? 'top' : 'bottom'), S);
          if (S && (S.y0 < plotH / 2) === tTop) check(S.y0 + S.h <= T.y0 + 0.5 || T.y0 + T.H <= S.y0 + 0.5, tag + ': table ' + tp + ' + strip ' + sp2 + ' on one edge never overlap', { T: [T.y0, T.H], S });
        }
        check(T.y0 >= 0 && T.y0 + T.H <= plotH - 8, tag + ': table ' + tp + ' fully inside the plot', { y0: T.y0, H: T.H, plotH });
        await p.screenshot({ path: OUT + '/colors-' + tag + '-pos-' + tp + '-' + sp2 + '.png' });
      }
      // table off: the member's own margins come back
      await setCfg(p, { fpTable: false, fpTablePos: 'br', fpStatsPos: 'bl' }); await sleep(1800);
      const mg = await margins(p);
      check(mg.top <= 12 && mg.bottom <= 12 || mg.bottom < 40, tag + ': margins restored after the table goes off', mg);
      check(errors.length === 0, tag + ': no page errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
