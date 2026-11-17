// Tab-title test: CHART_BASE=http://127.0.0.1:8061 node tools/tests/chart-tabtitle-browser.js
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x))); };
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(stub);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && /ZoroCharts$/.test(document.title) && /\d/.test(document.title), null, { timeout: 60000 });
  const t1 = await p.title();
  check(/^[\d,]+\.\d+( [▲▼])? BTCUSDT · ZoroCharts$/.test(t1), 'title has formatted price + symbol', t1);
  const m = await p.evaluate(async () => {
    const m = await import('/assets/chart-tabtitle.js');
    return [m.buildTitle('futures:NQ1!', [{ close: 21340 }, { close: 21345.25 }], 0.25), m.buildTitle('x:ABC', [], 0.01), m.buildTitle('binance:ETHUSDT', [{ close: 3000 }], 0.01)];
  });
  check(m[0] === '21,345.25 ▲ NQ1! · ZoroCharts', 'format NQ up', m[0]);
  check(m[1] === 'ABC · ZoroCharts', 'no data', m[1]);
  check(m[2] === '3,000.00 ETHUSDT · ZoroCharts', 'no arrow when prev unknown', m[2]);
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.active.id).setSymbol('binance:ETHUSDT'); });
  await p.waitForFunction(() => /ETHUSDT/.test(document.title), null, { timeout: 30000 }).catch(() => {});
  const t2 = await p.title();
  check(/ETHUSDT · ZoroCharts$/.test(t2) && t2 !== t1, 'title follows symbol switch', t2);
  const w = await p.evaluate(async () => {
    let n = 0; const d = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
    Object.defineProperty(document, 'title', { configurable: true, get() { return d.get.call(document); }, set(v) { n++; d.set.call(document, v); } });
    const s0 = document.title; document.title = 'x'; n = 0;
    await new Promise((r) => setTimeout(r, 3100)); return n;
  });
  check(w <= 14, 'writes in 3.1 s stay under the ~4/s cap', w);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
