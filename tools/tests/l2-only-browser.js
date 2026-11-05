// Futures order flow = the L2 tools only (Owner 2026-11-06: "Remove L1 orderflow indicators, only L2 stays and comes in pro").
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
// third-party community Pine scripts ("Real-Time Big Trades Bubbles ...") are not TradeZoro order-flow tools: left out of the search check
const types = (p) => p.evaluate(() => window.STRYKER_VELA.chart.indicators().map((x) => x.nativeType));
// an "old saved layout": the L1 tools land on the chart the way a restored session / template / shared chart adds them
const oldLayout = (p) => p.evaluate(() => {
  const ws = window.STRYKER_VELA, c = ws.chart;
  ws.active.setPriceStyle('stk_fp');
  c.addNativeIndicator('stk_ts_big', { inputs: { buyColor: '#ff00ff', showSize: false } });
  c.addNativeIndicator('stk_ts_delta', { inputs: { upColor: '#ff00ff' } });
});
async function search(p, q) {
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await p.waitForSelector('.stkiw-row', { timeout: 20000 });
  await p.fill('.stkiw-search', q); await sleep(600);
  return p.evaluate(() => [...document.querySelectorAll('.stkiw-row')].filter((r) => r.offsetParent).map((r) => ({ n: (r.querySelector('.stkiw-nm') || {}).textContent || '', pro: !!r.querySelector('.stk-protag'), third: !!r.querySelector('.is-third') })).filter((r) => !r.third));
}
const closePicker = async (p) => { await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.close()); await sleep(300); };
const OF_RX = /\bdelta\b|big trades|footprint|\bcvd\b/i;
const onlyL2 = (rows) => rows.filter((r) => OF_RX.test(r.n) && !/^Estimated CVD/.test(r.n)).every((r) => /\(L2\)/.test(r.n));

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const free of [false, true]) {
      for (const [w, h, mobile, vp] of [[1440, 900, false, '1440'], [390, 844, true, '390']]) {
        const tag = (free ? 'nonpro-' : 'pro-') + vp + '-dark';
        const { ctx, p, errors } = await open(b, { w, h, mobile, free });
        await setSym(p, 'futures:NQ1!');
        await oldLayout(p);
        await sleep(5000);
        const t = await types(p), style = await p.evaluate(() => window.STRYKER_VELA.active.priceStyle);
        check(!t.some((x) => /^stk_ts_|^stk_of_(big|delta|cvd)$/.test(x)) && style !== 'stk_fp', tag + ': no L1 / old order-flow tool and no L1 footprint left on NQ', { t, style });
        if (!free) {
          check(t.includes('stk_l2f_big') && t.includes('stk_l2f_delta') && t.includes('stk_l2f_fp'), tag + ': swapped to Big Trades (L2) + Delta (L2) + Footprint (L2)', t);
          const v = await p.evaluate(() => window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === 'stk_l2f_big').inputValues());
          check(v.buyColor === '#ff00ff' && v.showSize === false, tag + ': changed Big Trades inputs carried over', v);
        } else {
          check(!t.some((x) => /^stk_l2f_/.test(x)), tag + ': non-Pro: the L2 twins are removed by the Pro sweep (no broken pane)', t);
        }
        await p.evaluate(() => { const c = window.STRYKER_VELA.chart; const rb = c.orchestrator.rawBars, n = rb.length; c.setVisibleRange({ from: rb[Math.max(0, n - 70)].time, to: rb[n - 1].time + 120000 }); });
        await sleep(1500);
        await p.screenshot({ path: OUT + '/nq-1m-' + tag + '.png' });
        for (const q of ['delta', 'big trades', 'footprint']) {
          const rows = await search(p, q);
          const of = rows.filter((r) => OF_RX.test(r.n));
          check(of.length > 0 && onlyL2(rows), tag + ': NQ search "' + q + '" lists only (L2) order-flow tools', rows.map((r) => r.n));
          if (free) check(of.filter((r) => /\(L2\)/.test(r.n)).every((r) => r.pro), tag + ': "' + q + '" L2 rows carry the PRO tag', rows);
          if (q === 'big trades') await p.screenshot({ path: OUT + '/picker-nq-' + tag + '.png' });
          if (free && q === 'big trades') {
            await p.evaluate(() => { window.openPlanUpgradeModal = (why) => { window.__upsell = why; }; const r = [...document.querySelectorAll('.stkiw-row')].find((x) => /Big Trades \(L2\)/.test(x.textContent)); r.querySelector('.stkiw-name').click(); });
            await sleep(500);
            check(/Pro/.test(await p.evaluate(() => window.__upsell || '')) && !(await types(p)).includes('stk_l2f_big'), tag + ': click on Big Trades (L2) opens the Pro upsell, adds nothing');
          }
          await closePicker(p);
        }
        await setSym(p, 'binance:BTCUSDT'); await sleep(1500);
        const btc = await p.evaluate(() => window.STRYKER_VELA.active.libraryRows().filter((r) => /big trades/i.test(r.name)).map((r) => r.name));
        check(btc.includes('Big Trades') && !btc.includes('Big Trades (L1)'), tag + ': BTC lists the crypto Big Trades', btc);
        check(errors.length === 0, tag + ': no console errors', errors);
        await ctx.close();
      }
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
