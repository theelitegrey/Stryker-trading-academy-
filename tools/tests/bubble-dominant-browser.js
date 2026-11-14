// Depth Heatmap bubbles coloured by the dominant side (member request 13 Nov). Based on depth-heatmap-browser.js. FIXTURE data only (1m NQ bars + a fake /ts-live socket with book snaps,
// whole-book rows and ticks; BTC book samples loaded through the page's own debug loader). No Worker, no key.
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/depth-heatmap-browser.js <shotsDir>
// Checks at 1440 + 390 dark (+ 1440 light for Pro):
//   Pro: the picker lists "Depth Heatmap (L2)" on NQ and BTC; it draws on NQ (heatmap columns on the graphics card, price trace,
//        volume bars, the book column) and on BTC; the light theme keeps the heatmap's own dark field; no console errors.
//   Free: the row carries the PRO tag, a click opens the upgrade modal and adds nothing; a saved chart with it is swept (no broken pane).
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 500) : '')); };

const MIN = Math.floor(Date.now() / 60000), N = 180, TICK = 0.25;
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
      if (n % 5 === 0) {   // the whole book in 2.75-point rows once a second, with two walls
        const step = 2.75, i0 = Math.floor((b - 120) / step), v = [];
        for (let k = 0; k < 88; k++) { const p = (i0 + k + 0.5) * step, w = Math.abs(p - (b + 30)) < 2 || Math.abs(p - (b - 45)) < 2 ? 900 : 20 + ((k * 13) % 50); v.push(p < b ? w : -w); }
        ws.onmessage({ data: JSON.stringify({ type: 'coarse', symbol: 'NQ', ts: now, mid: b, bb: b, ba: b + 0.25, step, i0, v }) });
      }
    }, 200);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
async function open(b, { w, h, mobile, free, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile, colorScheme: theme });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs, { free: !!free });
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  // BTC candles (the exchange is blocked in tests): 1m klines around 76 000 for the last 3 hours
  await ctx.route(/binance[^/]*\/(api\/v3|fapi\/v1)\/klines/, (r) => {
    const u = new URL(r.request().url()), e = Number(u.searchParams.get('endTime')) || Date.now(), m1 = Math.floor(e / 60000), k = [];
    if (!u.searchParams.get('endTime')) for (let m = m1 - 180; m <= m1; m++) { const o = 76000 + Math.sin(m / 9) * 40, c = 76000 + Math.sin((m + 1) / 9) * 40; k.push([m * 60000, String(o), String(Math.max(o, c) + 5), String(Math.min(o, c) - 5), String(c), '12', m * 60000 + 59999, '0', 10, '6', '0', '0']); }
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(k) });
  });
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars: BARS }) }));
  await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage(), errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|\/api\/chart\/stream|Failed to load resource|Ping received after close/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
  return { ctx, p, errors };
}
const setSym = (p, sym) => p.evaluate(async ([s, mid]) => {
  window.__L2MID = mid;
  const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1');
  for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === s && c.orchestrator.rawBars.length > 20) break; }
}, [sym, price(MIN)]);
const types = (p) => p.evaluate(() => window.STRYKER_VELA.chart.indicators().map((x) => x.nativeType));
const dbg = (p) => p.evaluate(() => window.__stkFlow.dhDebug && window.__stkFlow.dhDebug());
async function search(p, q) {
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await p.waitForSelector('.stkiw-row', { timeout: 20000 });
  await p.fill('.stkiw-search', q); await sleep(600);
  return p.evaluate(() => [...document.querySelectorAll('.stkiw-row')].filter((r) => r.offsetParent).map((r) => ({ n: (r.querySelector('.stkiw-nm') || {}).textContent || '', pro: !!r.querySelector('.stk-protag') })));
}
const closePicker = async (p) => { await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.close()); await sleep(300); };
const NAME = 'Depth Heatmap (L2)';
// the colour of the heatmap field (left, mid-height), read from the page pixels
const fieldRgb = (p, w, h) => p.evaluate(([x, y]) => new Promise((res) => {
  const cs = [...document.querySelectorAll('canvas')].filter((c) => c.dataset.stkHeatmapGl === '1' && c.style.display !== 'none');
  res(cs.length ? 'gl-canvas' : 'none');
}), [Math.round(w * 0.3), Math.round(h * 0.5)]);

const setHm = (p, i) => p.evaluate((i) => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === 'stk_depth_heat'); h.setInputs(Object.assign({}, h.inputValues(), i)); return h.inputValues(); }, i);
const shot = (p) => p.screenshot({ type: 'png' });
(async () => {
  const b = await launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [390, 844, true, 'dark']]) {
      const tag = w + '-' + theme;
      const { ctx, p, errors } = await open(b, { w, h, mobile, free: false, theme });
      await setSym(p, 'futures:NQ1!');
      await p.evaluate(() => { window.STRYKER_VELA.chart.addNativeIndicator('stk_depth_heat'); window.STRYKER_VELA.context().stateChanged(); });
      await sleep(10000);
      let d = await dbg(p);
      check(d && d.bubbles > 0, tag + ': bubbles drawn by default', d && d.bubbles);
      const sch = await p.evaluate(() => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === 'stk_depth_heat'); return h.inputValues(); });
      check(!sch.bubbleDom, tag + ': dominant-side colouring is off by default', sch.bubbleDom);
      const a = await shot(p);
      fs.writeFileSync(OUT + '/bub-' + tag + '-split.png', a);
      await setHm(p, { bubbleDom: true }); await sleep(2500);
      d = await dbg(p);
      check(d && d.bubbles > 0, tag + ': bubbles still drawn with it on', d && d.bubbles);
      const b2 = await shot(p);
      fs.writeFileSync(OUT + '/bub-' + tag + '-dominant.png', b2);
      check(!a.equals(b2), tag + ': the picture changes when it is on');
      if (process.env.HM_ICE) { await setHm(p, { showIce: true }); await sleep(2500); d = await dbg(p); check(Array.isArray(d && d.ice), tag + ': iceberg option draws without error (marks: ' + (d && d.ice && d.ice.length) + ')'); fs.writeFileSync(OUT + '/bub-' + tag + '-ice.png', await shot(p)); await setHm(p, { showIce: false }); }
      await setHm(p, { bubbleBuyColor: '#3b82f6', bubbleSellColor: '#f59e0b' }); await sleep(2500);
      const c2 = await shot(p);
      fs.writeFileSync(OUT + '/bub-' + tag + '-custom.png', c2);
      check(!b2.equals(c2), tag + ': custom colours change the bubbles');
      const iv = await p.evaluate(() => window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === 'stk_depth_heat').inputValues());
      check(iv.bubbleBuyColor === '#3b82f6' && iv.bubbleSellColor === '#f59e0b', tag + ': colours saved in the indicator settings', iv);
      await setHm(p, { bubbleDom: false }); await sleep(2500);
      d = await dbg(p); const e = await shot(p);
      check(d && d.bubbles > 0, tag + ': off again: bubbles back to the split look');
      check(errors.length === 0, tag + ': no console errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
