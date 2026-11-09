// Volume footprint style, Data source L2 / L1 (Owner 09 Nov). Based on l2-only-browser.js fixtures.
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/fp-style-browser.js <shotsDir>
// (was: Futures order flow = the L2 tools only (Owner 2026-11-06: "Remove L1 orderflow indicators, only L2 stays and comes in pro").
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/l2-only-browser.js <shotsDir>
// FIXTURE data only (1m NQ bars + a fake /ts-live socket with book snaps and ticks; no Worker, no key).
// Checks, Pro at 1440 + 390 dark: NQ picker search "delta" / "big trades" / "footprint" lists only (L2) tools; an old saved chart with
// stk_ts_big + stk_ts_delta (+ the Footprint chart type) comes back as Big Trades (L2) + Delta (L2) (+ Footprint (L2) on candles), changed
// colour kept; BTC still lists the crypto Big Trades. Non-Pro at 1440 + 390 dark: the same saved chart gives no error and no broken pane
// (the Pro sweep removes the L2 tools), the picker rows carry the PRO tag and a click opens the upgrade modal. No console errors anywhere.
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
  try { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('stryker-theme', 'dark'); } catch (e) {}
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
async function open(b, { w, h, mobile, free }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile, colorScheme: 'dark' });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs, { free: !!free });
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
  const mins = BARS.slice(-14).map((r) => {
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
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const theme of ['dark', 'light']) for (const [w, h, mobile, vp] of [[1440, 900, false, '1440'], [390, 844, true, '390']]) {
      const tag = vp + '-' + theme;
      const { ctx, p, errors } = await open(b, { w, h, mobile, free: false });
      await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: orderflowBody() }));
      if (theme === 'light') await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); });
      await setSym(p, 'futures:NQ1!');
      await p.evaluate(() => window.STRYKER_VELA.active.setPriceStyle('stk_fp'));
      await sleep(3000);
      // fixture minutes through the hub's own seed path (what /ts-aux feeds): the last 14 closed minutes, around each bar's real close
      await p.evaluate(async (V) => {
        const M = await import('/assets/chart-futures-l2.js?v=' + V), rb = window.STRYKER_VELA.chart.orchestrator.rawBars, now = Math.floor(Date.now() / 60000), fp = [];
        for (let k = 1; k <= 14; k++) { const bar = rb.find((x) => Math.floor(x.time / 60000) === now - k); if (!bar) continue; const lv = []; for (let q = bar.low; q <= bar.high; q += 0.25) lv.push([Math.round(q * 4) / 4, 5 + ((q * 4) % 37), 4 + ((q * 7) % 29)]); fp.push({ t: now - k, lv }); }
        M.rootState('NQ').trades.seed(fp);
      }, JSON.parse(fs.readFileSync(__dirname + '/../../assets/version.json', 'utf8')).build);
      await sleep(1500);
      const t = await types(p), style = await p.evaluate(() => window.STRYKER_VELA.active.priceStyle);
      check(style === 'stk_fp' && !t.includes('stk_l2f_fp'), tag + ': Volume footprint stays, no Footprint (L2) indicator added', { style, t });
      await sleep(2000);
      await p.evaluate(() => { const c = window.STRYKER_VELA.chart; const rb = c.orchestrator.rawBars, n = rb.length; c.setVisibleRange({ from: rb[Math.max(0, n - 12)].time, to: rb[n - 1].time + 120000 }); });
      await sleep(1500);
      await p.screenshot({ path: OUT + '/fp-l2-' + tag + '.png' });
      const l2 = await p.evaluate(() => { const h = window.__stkL2FlowHubs; const hub = h && [...h.values()][0]; return { hubs: h ? h.size : 0, bars: hub ? hub.footBars().bars.length : 0 }; });
      check(l2.hubs > 0 && l2.bars > 0, tag + ': Data = L2 default: L2 hub feeds the footprint', l2);
      check((await src(p)) === 'l2', tag + ': engine Data source = l2 by default', await src(p));
      await setSrc(p, 'l1'); await sleep(2500);
      check((await src(p)) === 'l1', tag + ': switch to L1 (trades): engine follows', await src(p));
      await p.screenshot({ path: OUT + '/fp-l1-' + tag + '.png' });
      await setSrc(p, 'l2'); await sleep(1500);
      check((await src(p)) === 'l2' && (await p.evaluate(() => window.STRYKER_VELA.active.priceStyle)) === 'stk_fp', tag + ': back to L2, style still stk_fp', await src(p));
      if (tag === '1440-dark') {   // persistence: the choice is in the saved session and a reload restores it
        await setSrc(p, 'l1'); await sleep(800);
        const saved = await p.evaluate(() => { const r = window.STRYKER_VELA.chart.renderer.renderer.getConfig(); return r.chartTypes && r.chartTypes.stk_fp; });
        check(saved && saved.fpSrc === 'l1', tag + ': L1 choice is in the chart config (saved with the layout)', saved);
        await p.evaluate(() => window.STRYKER_VELA.context().stateChanged()); await sleep(1500);
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 }); await sleep(4000);
        const again = await p.evaluate(() => ({ st: window.STRYKER_VELA.active.priceStyle, ct: window.STRYKER_VELA.chart.renderer.renderer.getConfig().chartTypes }));
        console.log('after reload', JSON.stringify(again));
        check(again.st === 'stk_fp' && again.ct.stk_fp && again.ct.stk_fp.fpSrc === 'l1', tag + ': after reload still Volume footprint + Data = L1', again);
      }
      check(errors.length === 0, tag + ': no console errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
