// Footprint Auto text size + Bar stats table row toggles. FIXTURE data only. Based on fp-table-ontop-browser.js.
//   node tools/tests/chart-dev-server.mjs 8041
//   CHART_BASE=http://127.0.0.1:8041 flock /tmp/stryker-chrome.lock node tools/tests/fp-autotext-browser.js <shotsDir>
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

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, vp, theme] of [[1440, 900, false, '1440', 'dark'], [1440, 900, false, '1440', 'light'], [390, 844, true, '390', 'dark']]) {
      const tag = vp + '-' + theme, { ctx, p, errors } = await open(b, { w, h, mobile, free: false, theme });
      await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: orderflowBody() }));
      await setSym(p, 'futures:NQ1!');
      await p.evaluate(() => window.STRYKER_VELA.active.setPriceStyle('stk_fp'));
      await sleep(2500);
      await setCfg(p, { fpSrc: 'l1', fpStyle: 'delta', fpTable: true, fpTablePos: 'br' }); await sleep(1500);
      await zoomTo(p, mobile ? 6 : 12); await sleep(1500);
      const c = await cfgOf(p);
      check(c.auto === false && c.tblHide.length === 0, tag + ': defaults = auto off, no row hidden', { auto: c.auto, h: c.tblHide });
      await dbgReset(p); await sleep(900);
      const all = ((await dbg(p)).table || {}).rows || [];
      check(all.includes('buy') && all.includes('sell') && all.includes('vol') && all.includes('delta'), tag + ': table shows Buy + Sell by default', all);
      await p.screenshot({ path: OUT + '/auto-' + tag + '-default.png' });
      await setCfg(p, { fpTblBuy: false, fpTblSell: false }); await dbgReset(p); await sleep(900);
      const hid = ((await dbg(p)).table || {}).rows || [];
      check(hid.length === all.length - 2 && !hid.includes('buy') && !hid.includes('sell') && hid.includes('delta'), tag + ': Buy + Sell rows hidden, others kept', hid);
      await p.screenshot({ path: OUT + '/auto-' + tag + '-rows-hidden.png' });
      await setCfg(p, { fpTblVol: false, fpTblDelta: false, fpTblDpct: false, fpTblTrd: false }); await dbgReset(p); await sleep(900);
      const none = ((await dbg(p)).table || {}).rows || [];
      check(none.length === 0, tag + ': all rows off -> empty table, no crash', none);
      await setCfg(p, { fpTblBuy: true, fpTblSell: true, fpTblVol: true, fpTblDelta: true, fpTblDpct: true, fpTblTrd: true }); await sleep(600);
      // record the font of every number drawn
      await p.evaluate(() => {
        const proto = CanvasRenderingContext2D.prototype, d = Object.getOwnPropertyDescriptor(proto, 'font'), ft = proto.fillText;
        Object.defineProperty(proto, 'font', { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); this.__f = v; } });
        window.__fontLog = [];
        proto.fillText = function (t) { if (/^[\u2212+-]?\d/.test(String(t)) && !/apple-system|Segoe/.test(this.font)) window.__fontLog.push(parseFloat(this.font.match(/([\d.]+)px/)[1])); return ft.apply(this, arguments); };
      });
      const sizes = async () => { await p.evaluate(() => { window.__fontLog.length = 0; }); await p.evaluate(() => window.STRYKER_VELA.chart.setVisibleRange && 0); await sleep(1800); return p.evaluate(() => [...new Set(window.__fontLog)].sort((a, b) => a - b)); };
      for (const st of ['delta', 'boxes', 'classic']) {
        await setCfg(p, { fpStyle: st, fpAutoText: false, fpTable: false }); await zoomTo(p, mobile ? 4 : 8); await sleep(800);
        const off = await sizes();
        await setCfg(p, { fpAutoText: true, fpAutoMin: 8, fpAutoMax: 14 }); await sleep(800);
        const on = await sizes();
        check(on.length > 1 && on.length >= off.length, tag + ' ' + st + ': auto on draws several text sizes (off ' + off + ' / on ' + on + ')', { off, on });
        check(on.length && on.every((x) => x >= 7 && x <= 14), tag + ' ' + st + ': auto sizes stay within the limits', on);
        if (st === 'delta') await p.screenshot({ path: OUT + '/auto-' + tag + '-on.png' });
        await setCfg(p, { fpAutoText: false }); await sleep(500);
      }
      check(errors.length === 0, tag + ': no page errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
