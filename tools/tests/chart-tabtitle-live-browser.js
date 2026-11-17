// Tab title follows live ticks (Owner 17 Nov). Needs the dev server + the fixture hub (futures) ; crypto uses the Binance mock:
//   python3 tools/tests/tick-engine-hub.py 8077 &   (TE_ALLSYM=1 so MNQ gets ticks; needs the python "websockets" package)
//   node tools/tests/chart-dev-server.mjs 8071 &
//   CHART_BASE=http://127.0.0.1:8071 TE_HUB=http://127.0.0.1:8077 node tools/tests/chart-tabtitle-live-browser.js
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const bm = require('./binance-mock.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031', HUB = process.env.TE_HUB || 'http://127.0.0.1:8077';
const V = JSON.parse(require('fs').readFileSync(__dirname + '/../../assets/version.json', 'utf8')).build;
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const num = (t) => Number(/^([\d,]+(?:\.\d+)?)/.exec(t || '')[1].replace(/,/g, ''));
// Watch: longest time document.title showed a price other than the chart's newest close; also counts title writes.
const watch = (p, ms) => p.evaluate((ms) => new Promise((res) => {
  const ws = window.STRYKER_VELA, c = ws.cell(ws.active.id), sc = () => c.chart.renderer.renderer.scene.bars;
  let writes = 0; const d = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
  Object.defineProperty(document, 'title', { configurable: true, get() { return d.get.call(document); }, set(v) { writes++; d.set.call(document, v); } });
  // staleness: the title shows some past newest-close k; it is stale since the moment k was replaced by the next close. Report the worst.
  let maxStale = 0, changes = 0; const t0 = Date.now(), hist = [[t0, sc()[sc().length - 1].close]];
  const iv = setInterval(() => {
    const now = Date.now(), cl = sc()[sc().length - 1].close;
    if (cl !== hist[hist.length - 1][1]) { hist.push([now, cl]); changes++; }
    const shown = Number((/^([\d,]+(?:\.\d+)?)/.exec(document.title) || [0, 'NaN'])[1].replace(/,/g, ''));
    let k = -1; for (let i = hist.length - 1; i >= 0; i--) if (hist[i][1] === shown) { k = i; break; }
    if (k < 0) maxStale = Math.max(maxStale, now - t0);   // shows a price the chart never had in this window
    else if (k < hist.length - 1) maxStale = Math.max(maxStale, now - hist[k + 1][0]);
    if (now - t0 > ms) { clearInterval(iv); delete document.title; res({ changes, maxStale, writes, hidden: document.hidden, title: document.title, sym: c.symbol }); }
  }, 20);
}), ms);
async function open(b, fut) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((h) => { window.__STK_BOOK_RECORDER = h; }, HUB);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)(?!(api\.binance\.com|data-api\.binance\.vision|fapi\.binance\.com|stream\.binance))/, (r) => r.abort());
  await bm.install(ctx);
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html' + (fut ? '?engine=1' : ''), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  if (fut) {
    await p.evaluate(async (v) => { (await import('/assets/rt-access.js?v=' + v))._rtSetForTests(true, 'test-token'); const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:MNQ1!'); ws.active.setTimeframe('1'); }, V);
    await p.waitForFunction(() => /MNQ1! · ZoroCharts$/.test(document.title) && window.STRYKER_VELA.chart.orchestrator.rawBars.length > 30, null, { timeout: 60000 });
  } else await p.waitForFunction(() => /BTCUSDT · ZoroCharts$/.test(document.title), null, { timeout: 60000 });
  await p.waitForTimeout(2000);
  return p;
}
(async () => {
  const b = await launch();
  for (const [name, fut, re] of [['futures MNQ1!', true, /^[\d,]+\.\d\d( [▲▼])? MNQ1! · ZoroCharts$/], ['crypto BTCUSDT', false, /^[\d,]+\.\d\d( [▲▼])? BTCUSDT · ZoroCharts$/]]) {
    const p = await open(b, fut);
    let r = await watch(p, 6000);
    const mx = r.maxStale;
    check(r.changes >= 3 && re.test(r.title), name + ': ticks arrive and the title keeps its format', { changes: r.changes, title: r.title });
    check(mx <= 1000, name + ': title shows the chart\'s newest price within 1 s (longest stale ' + mx + ' ms over ' + r.changes + ' changes)');
    check(r.writes <= 6 * 4 + 2, name + ': title writes stay at ~4/s (' + r.writes + ' in 6 s)', r.writes);
    // hidden tab (page visibility forced, as Chrome reports it): still follows the feed, at most ~1 write/s
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); });
    r = await watch(p, 6000);
    const mx2 = r.maxStale;
    check(r.changes >= 3 && mx2 <= 2500, name + ': hidden tab: title still follows (longest stale ' + mx2 + ' ms over ' + r.changes + ' changes)');
    check(r.writes <= 8, name + ': hidden tab: writes ~1/s (' + r.writes + ' in 6 s)', r.writes);
    await p.context().close();
  }
  await b.close();
  process.exit(fail ? 1 : 0);
})();
