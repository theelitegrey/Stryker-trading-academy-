// Liquidity heatmap "Deep" view in the browser (assets/chart-orderflow.js stk_crypto_dom + chart-liquidity-data.js), both
// chart engines (?vela=0.9 default, ?vela=0.6), 1440 + 390. Everything Binance is answered from a REAL recording
// (fixtures/liquidity/btcusdt-*.json.gz: the public BTCUSDT book at 1 sample a second + its aggTrades), the clock is
// pinned to the end of the recording, and the page's own book history is replaced with the recorded samples
// (__stkFlow.domDebugLoad), as if the page had been open for the whole recording. No network.
//   node tools/tests/chart-dev-server.mjs 8073
//   flock /tmp/stryker-chrome.lock systemd-run --scope -q -p MemoryMax=1200M env CHART_BASE=http://127.0.0.1:8073 \
//     node --max-old-space-size=768 tools/tests/chart-liquidity-browser.js [shotsDir]
// Checks: Deep is the default view; heat cells in the dark scale; big levels labelled with their size in BTC; at least one
// vanished level tagged and every tag agrees with the Node maths on the same trades (pulled vs filled); the ICE hint count
// equals icebergEvents() on the same data; the other views still work (Combined has no tags); phone 390: no horizontal
// scroll, labels capped; no "live" / "real-time" text; no console errors.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8073';
const OUT = process.argv[2] || '.';
const FXD = path.join(__dirname, 'fixtures/liquidity');
const FN = fs.readdirSync(FXD).filter((f) => /\.json\.gz$/.test(f))[0];
const R = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FXD, FN))).toString());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const T_END = R.samples[R.samples.length - 1].ts;
const NOW = T_END + 3000;
const MIN = 60000;
// 1m klines from the recorded trades; flat bars before the recording
function klines(from, to) {
  const by = new Map();
  for (const [, p, q, , T] of R.trades) {
    const t = Math.floor(T / MIN) * MIN; let b = by.get(t);
    if (!b) { b = [t, p, p, p, p, 0]; by.set(t, b); }
    b[2] = Math.max(b[2], p); b[3] = Math.min(b[3], p); b[4] = p; b[5] += q;
  }
  const first = R.trades[0][1], out = [];
  for (let t = Math.floor(from / MIN) * MIN; t <= to; t += MIN) {
    const b = by.get(t) || [t, first, first + 2, first - 2, first, 0.5];
    out.push([t, String(b[1]), String(b[2]), String(b[3]), String(b[4]), String(b[5]), t + MIN - 1, '0', 1, '0', '0', '0']);
  }
  return out;
}
// the newest recorded sample as a /depth snapshot (fine rows -> price levels at the row's low edge)
function depthSnap() {
  const s = R.samples[R.samples.length - 1], bids = [], asks = [];
  s.fv.forEach((v, k) => { if (!v) return; const p = ((s.fi0 + k) * s.fs).toFixed(2); (v > 0 ? bids : asks).push([v > 0 ? (Number(p) + s.fs - 0.01).toFixed(2) : p, String(Math.abs(v))]); });
  bids.sort((a, b) => b[0] - a[0]); asks.sort((a, b) => a[0] - b[0]);
  return { lastUpdateId: 1, bids, asks };
}
const aggT = (t) => ({ a: t[0], p: String(t[1]), q: String(t[2]), m: !!t[3], T: t[4] });

async function open(b, { w, h, mobile, v09 }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([now]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1');
      localStorage.removeItem('stryker.vela.session'); localStorage.removeItem('vela-workspace'); localStorage.removeItem('vela-workspace-090'); } catch (e) {}
    const RealDate = Date, off = now - RealDate.now();
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
    window.Date = FakeDate;
    window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true };
    // a member who has used the volume tools before: the order-flow layers register before the chart is built
    try { localStorage.setItem('stryker.volume', '1'); } catch (e) {}
    try { indexedDB.deleteDatabase('stryker-book'); } catch (e) {}
  }, [NOW]);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/^https:\/\/(api\.binance\.com|data-api\.binance\.vision|api\.binance\.us)\//, (route) => {
    const u = new URL(route.request().url());
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (/\/ping$/.test(u.pathname)) return json({});
    if (/\/exchangeInfo$/.test(u.pathname)) return json({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }] }] });
    if (/\/depth$/.test(u.pathname)) return json(depthSnap());
    if (/\/aggTrades$/.test(u.pathname)) {
      const lim = Math.min(1000, Number(u.searchParams.get('limit') || 500)), from = u.searchParams.get('fromId');
      const list = from != null ? R.trades.filter((t) => t[0] >= Number(from)).slice(0, lim) : R.trades.slice(-lim);
      return json(list.map(aggT));
    }
    if (/\/klines$/.test(u.pathname)) {
      const lim = Math.min(1000, Number(u.searchParams.get('limit') || 500));
      const en = Math.min(Number(u.searchParams.get('endTime') || NOW), NOW), st = u.searchParams.get('startTime');
      const from = st != null ? Number(st) : en - (lim - 1) * MIN;
      return json(klines(from, en).slice(0, lim));
    }
    return json([]);
  });
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/book-history/, (r) => r.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  await ctx.routeWebSocket(/^wss:\/\/[^/]*binance[^/]*\//, () => {});   // open, silent: everything comes from the recording
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (process.env.LIQ_DEBUG && m.type() !== 'log') console.log('CONSOLE', m.type(), m.text().slice(0, 300)); if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|\/api\/chart\/stream|firebase|firestore|CORS|status of 5/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  await p.goto(BASE + '/charts.html?vela=' + (v09 ? '0.9' : '0.6'), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkFlow, null, { timeout: 60000 });
  await sleep(2000);
  await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol('binance:BTCUSDT'); ws.active.setTimeframe('1');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); const c = ws.chart; if (c.market.symbol === 'binance:BTCUSDT' && c.orchestrator.rawBars.length > 50) break; }
  });
  await p.waitForFunction(() => window.__stkFlow, null, { timeout: 30000 });
  await sleep(1000);
  return { ctx, p, errors };
}
const addDom = (p, inputs) => p.evaluate((i) => !!window.STRYKER_VELA.chart.addNativeIndicator('stk_crypto_dom', { inputs: i || {} }), inputs || null);
const setDom = (p, i) => p.evaluate((i) => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === 'stk_crypto_dom'); h.setInputs(Object.assign({}, h.inputValues(), i)); }, i);
const dbg = (p) => p.evaluate(() => window.__stkFlow.domDebug());
const frame = (p, a, z) => p.evaluate(([a, z]) => window.STRYKER_VELA.chart.setVisibleRange({ from: a, to: z }), [a, z]).then(() => sleep(1200));

module.exports = { open, R, T_END, NOW, MIN, sleep };
if (0) (async () => {
  const L = await import(path.resolve(__dirname, '../../assets/chart-liquidity-data.js'));
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const v09 of (process.env.LIQ_ENG === '09' ? [true] : process.env.LIQ_ENG === '06' ? [false] : [true, false])) {
      const eng = v09 ? 'v09' : 'v06';
      for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]].filter((x) => !process.env.LIQ_W || String(x[0]) === process.env.LIQ_W)) {
        const { ctx, p, errors } = await open(b, { w, h, mobile, v09 });
        const v = await p.evaluate(() => window.__stkVela090 === true);
        check(v === v09, eng + ' ' + w + ': engine ' + (v09 ? '0.9' : '0.6'));
        check(await addDom(p, { historyMinutes: 120 }), eng + ' ' + w + ': Crypto DOM Heatmap added');
        await sleep(1500);
        const n = await p.evaluate((s) => window.__stkFlow.domDebugLoad(s), R.samples);
        check(n === 1, eng + ' ' + w + ': recorded samples loaded into the page (' + R.samples.length + ')');
        // wait for the trade feed backfill (coverFrom set) and a redraw
        await p.waitForFunction(() => { const d = window.__stkFlow.domDebug(); return d && d.columns > 50; }, null, { timeout: 30000 }).catch(() => {});
        const span = T_END - R.samples[0].ts;
        await frame(p, T_END - (w < 500 ? Math.min(span, 25 * MIN) : span) , T_END + (w < 500 ? 4 : 8) * MIN);
        await sleep(2500);
        const d = await dbg(p);
        if (!d) console.log('DEBUG no frame drawn');
        check(d && d.view === 'deep', eng + ' ' + w + ': Deep is the default view', d && d.view);
        check(d && d.cells > 100 && d.columns > 50, eng + ' ' + w + ': heat cells drawn (' + (d && d.cells) + ' cells, ' + (d && d.columns) + ' columns)');
        const labs = (d.walls || []).filter((x) => x.drawn);
        check(labs.length > 0 && labs.every((x) => / BTC$/.test(x.label)) && labs.length <= (w < 500 ? 6 : 12), eng + ' ' + w + ': ' + labs.length + ' big levels labelled with their size in BTC', labs.slice(0, 4).map((x) => x.label));
        // tags agree with the Node maths on the very same trades
        const vs = d.vanished || [];
        const tradesM = new Map();
        for (const [, pr, q, mk, T] of R.trades) { const t = Math.floor(T / MIN) * MIN; let m = tradesM.get(t); if (!m) { m = []; tradesM.set(t, m); } m.push([pr, q, mk]); }
        check(vs.length > 0, eng + ' ' + w + ': vanished big levels tagged: ' + vs.filter((x) => x.kind === 'pulled').length + ' pulled, ' + vs.filter((x) => x.kind === 'filled').length + ' filled', vs.slice(0, 4));
        check(vs.every((x) => (x.kind === 'filled') === (x.traded >= 0.3 * x.last)), eng + ' ' + w + ': every tag follows its own numbers (filled = traded >= 30% of the last size)');
        const ice = d.ice || [];
        check(Array.isArray(d.ice), eng + ' ' + w + ': iceberg hints computed (' + ice.length + ' on screen)', ice.slice(0, 3));
        const txt = await p.evaluate(() => document.body.innerText);
        check(!/\blive\b|real[- ]time/i.test(JSON.stringify(d.walls) + (d.since || '')), eng + ' ' + w + ': no "live" / "real-time" in the heatmap text');
        await p.mouse.move(5, 5).catch(() => {}); await sleep(600);
        await p.screenshot({ path: path.join(OUT, 'liq-' + eng + '-' + w + '-deep.png') });
        if (w === 1440) {
          // zoomed in on the last 12 minutes: the fine rows, so labels + tags are readable
          await frame(p, T_END - 12 * MIN, T_END + 3 * MIN); await sleep(1500);
          const dz = await dbg(p);
          check(dz.cells > 50, eng + ' zoom: heat drawn at step ' + dz.step + ' (' + (dz.walls || []).filter((x) => x.drawn).length + ' labels, ' + (dz.vanished || []).length + ' tags, ' + (dz.ice || []).length + ' ICE)');
          await p.screenshot({ path: path.join(OUT, 'liq-' + eng + '-1440-zoom.png') });
          // the older Combined view: no pulled / filled tags, two-tone
          await setDom(p, { style: 'Combined (heatmap + depth + walls)' }); await sleep(1500);
          const dc = await dbg(p);
          check(dc.view === 'combined' && !(dc.vanished || []).some((x) => x.kind), eng + ': Combined view still works, without tags');
          await setDom(p, { style: 'Deep heatmap (heat + depth + sizes + pulled / filled)', showVanish: false }); await sleep(1500);
          const dn = await dbg(p);
          check(dn.view === 'deep' && !(dn.vanished || []).length, eng + ': "Pulled / filled tags" setting off removes the tags');
          await setDom(p, { showVanish: true });
        }
        const hs = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
        check(hs, eng + ' ' + w + ': no horizontal scroll');
        check(!errors.length, eng + ' ' + w + ': no console errors', errors);
        await ctx.close();
      }
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
