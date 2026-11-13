// Browser test: GEX Levels "Live overnight levels" + HOD / LOD.
//   node tools/tests/chart-dev-server.mjs 8031 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-gex-live-browser.js [shotsDir]
// The indicator's bars are replaced by synthetic New York-time bars so the expected numbers are known.
const path = require('path');
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const SPX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'gex', 'SPX-0.json')));
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (v) => Math.round(v * 100) / 100;

async function run(b, name, w, h, mobile) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile, colorScheme: 'dark' });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker-theme', 'dark'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/\/api\/gex\/levels\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SPX) }));
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 45000 });
  await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol('futures:ES1!'); c.setTimeframe('5'); });
  await p.waitForFunction(() => { try { return window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0; } catch (e) { return false; } }, null, { timeout: 60000 });
  await sleep(1500);
  await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_gex', { inputs: {} }); window.STRYKER_VELA.context().stateChanged(); });
  await sleep(2500);
  const payload = () => p.evaluate(() => {
    const c = window.STRYKER_VELA.context().cells[0].chart, seen = new Set();
    const find = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null; seen.add(o);
      if (o.nativeData instanceof Map && o.nativeData.has('stk_gex')) return o.nativeData.get('stk_gex');
      for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} } return null; };
    return JSON.parse(JSON.stringify(find(c, 0) || null));
  });
  const set = (o) => p.evaluate((o) => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_gex'); h.setInputs(Object.assign({}, h.inputValues(), o)); window.STRYKER_VELA.context().stateChanged(); }, o);
  // find the live indicator instance; feed it synthetic bars starting Wed 11 Nov 2026 18:00 ET (23:00 UTC)
  const hook = await p.evaluate(() => {
    const g = window.__stkGexNative; if (!g) return false;
    const base = Date.UTC(2026, 10, 11, 23, 0);
    const bars = []; let px = Math.round(window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.slice(-1)[0].close);   // start at the real price so the lines sit on screen
    for (let i = 0; i < 80; i++) { px += (i % 2 ? 1.5 : -1); bars.push({ time: base + i * 300000, open: px, high: px + 2, low: px - 2, close: px + 0.5 }); }
    window.__synthBars = bars; g.ctx.bars = () => window.__synthBars; g.ctx.timeframe = '5';
    window.__gex = g; return true;
  });
  check(hook, name + ': found the indicator instance');
  if (!hook) { await ctx.close(); return; }
  const ses = SPX.session.ES;
  const line = (d, id) => d && d.lines && d.lines.find((l) => l.id === id);
  await p.evaluate(() => { window.__gex.sig = ''; window.__gex.onBars(); window.__gex.refresh(); }); await sleep(600);
  let d = await payload();
  check(line(d, 'onh') && line(d, 'onh').price === r2(ses.overnight_high) && !line(d, 'hod') && !line(d, 'lod'), name + ': defaults = old behaviour (fixed ONH ' + ses.overnight_high + ', no HOD/LOD)');
  await set({ liveOvernight: true, showHod: true, showLod: true });
  await p.evaluate(() => { window.__gex.onBars(); window.__gex.refresh(); }); await sleep(800);
  d = await payload();
  const barsNow = await p.evaluate(() => window.__synthBars);
  const hi0 = Math.max(...barsNow.map((x) => x.high)), lo0 = Math.min(...barsNow.map((x) => x.low));
  check(line(d, 'onh') && /^ONH \(live\)/.test(line(d, 'onh').text) && line(d, 'onh').price === hi0, name + ': ONH (live) = running high ' + hi0 + ' (got ' + (line(d, 'onh') && line(d, 'onh').text) + ')');
  check(line(d, 'onl') && /^ONL \(live\)/.test(line(d, 'onl').text) && line(d, 'onl').price === lo0, name + ': ONL (live) = running low ' + lo0);
  check(line(d, 'hod') && line(d, 'hod').price === hi0 && line(d, 'lod') && line(d, 'lod').price === lo0 && line(d, 'hod').color === '#34d399', name + ': HOD / LOD drawn with their own colours');
  await set({ hodColor: '#ff00aa' }); await sleep(600); d = await payload();
  check(line(d, 'hod') && line(d, 'hod').color === '#ff00aa', name + ': HOD colour setting applies');
  await set({ hodColor: '#34d399' });
  // a new high and a new low arrive on a new bar
  await p.evaluate(([hi, lo]) => { const L = window.__synthBars[window.__synthBars.length - 1]; window.__synthBars.push({ time: L.time + 300000, open: L.close, high: hi, low: lo, close: L.close }); window.__gex.onBars(); window.__gex.refresh(); }, [hi0 + 25, lo0 - 13]);
  await sleep(800); d = await payload();
  check(line(d, 'onh').price === hi0 + 25 && line(d, 'hod').price === hi0 + 25 && line(d, 'onl').price === lo0 - 13 && line(d, 'lod').price === lo0 - 13, name + ': new bar moves all four lines (' + [line(d, 'onh').price, line(d, 'onl').price, line(d, 'hod').price, line(d, 'lod').price].join(' / ') + ')');
  // zoom + screenshot while live
  await p.evaluate(([lo, hi]) => { try { window.STRYKER_VELA.context().cells[0].chart.setPriceRange(lo, hi); } catch (e) {} }, [lo0 - 30, hi0 + 40]);
  await p.mouse.move(5, 5); await sleep(900);
  await p.screenshot({ path: OUT + '/auto-onh-' + name + '.png' }); console.log('SHOT ' + OUT + '/auto-onh-' + name + '.png');
  // session closes (a bar at 09:30 ET): back to the fixed ONH/ONL, HOD/LOD keep going
  await p.evaluate(() => { const L = window.__synthBars[window.__synthBars.length - 1]; window.__synthBars.push({ time: Date.UTC(2026, 10, 12, 14, 30), open: L.close, high: L.close + 1, low: L.close - 1, close: L.close }); window.__gex.onBars(); window.__gex.refresh(); });
  await sleep(800); d = await payload();
  check(line(d, 'onh').text.startsWith('ONH ') && !/live/.test(line(d, 'onh').text) && line(d, 'onh').price === r2(ses.overnight_high) && line(d, 'hod'), name + ': after 09:30 ET ONH is the fixed API level again, HOD still drawn');
  const inputs = await p.evaluate(() => JSON.stringify(window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_gex').inputValues()));
  check(/"liveOvernight":true/.test(inputs) && /"showHod":true/.test(inputs), name + ': options stored in the indicator settings');
  check(!errors.length, name + ': no page errors ' + errors.join(' | '));
  await ctx.close();
}
(async () => {
  const b = await launch();
  try { await run(b, '1440-dark', 1440, 900, false); await run(b, '390-dark', 390, 844, true); } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
