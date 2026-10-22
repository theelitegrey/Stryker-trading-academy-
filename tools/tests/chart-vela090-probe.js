const { launch } = require('./lib.js');
const stub = require('./richstub.js');
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(stub);
  if (process.argv[3] !== 'member') await ctx.addInitScript(() => { let L; Object.defineProperty(window, 'StrykerPineLibrary', { configurable: true, get() { return L; }, set(v) { if (v) v.isAdmin = () => Promise.resolve(true); L = v; } }); });
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage(); let loads = 0; p.on('load', () => loads++);
  p.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 300)));
  p.on('console', (m) => { if (m.type() !== 'log' || /TradeZoro|vela/i.test(m.text())) console.log('CON', m.type(), m.text().slice(0, 300)); });
  p.on('requestfailed', (r) => { if (!/google|gstatic|firebase/.test(r.url())) console.log('REQFAIL', r.url().slice(0, 150)); });
  await p.goto(process.env.CHART_BASE + '/charts.html?vela=' + (process.argv[2] || '0.9'), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(25000);
  console.log(JSON.stringify(await p.evaluate(() => { let n = null; try { const ws = window.STRYKER_VELA; n = ws && ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount; } catch (e) { n = String(e); } return { flag: window.__stkVela090, ws: !!window.STRYKER_VELA, n, fb: !document.getElementById('stkchart-fallback')?.hidden }; })));
  console.log('loads', loads, p.url()); await b.close();
})();
