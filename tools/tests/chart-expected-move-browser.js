// Charts "TradeZoro Expected Move" browser test (assets/chart-expected-move.js) at 1440 + 390.
//   node tools/tests/chart-dev-server.mjs 8061
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8061 node tools/tests/chart-expected-move-browser.js [shotsDir]
// The recorder's /opt-analytics is answered from tools/tests/fixtures/opt-analytics-*.json (real
// feeder output 2026-10-14), so the expected ranges are known.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061';
const OUT = process.argv[2] || '/tmp';
const FIX = path.join(__dirname, 'fixtures');
const FX = { SPX: JSON.parse(fs.readFileSync(path.join(FIX, 'opt-analytics-SPX.json'))), QQQ: JSON.parse(fs.readFileSync(path.join(FIX, 'opt-analytics-QQQ.json'))) };
// keep the fixture "fresh" so the status reads minutes, not days
for (const k in FX) FX[k].t = Math.floor(Date.now() / 1000) - 180;
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(b, { w, h, mobile, free }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((free) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
    if (free) Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => Promise.resolve({ free: true }), set() {} });
  }, !!free);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const hits = [];
  // registered after the catch-all abort: Playwright tries the newest route first
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/opt-analytics/, (r) => {
    const u = new URL(r.request().url()).searchParams.get('u'); hits.push(u);
    if (!FX[u]) return r.fulfill({ status: 404, body: 'no data' });
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(FX[u]) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e) + ' @ ' + String(e.stack || '').split('\n').slice(1, 3).join(' ')));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 45000 });
  await waitBars(p);
  return { ctx, p, errors, hits };
}
const waitBars = (p) => p.evaluate(async () => {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {}
  }
  return false;
});
const setSym = async (p, sym, tf) => { await p.evaluate(([s, tf]) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); if (tf) c.setTimeframe(tf); }, [sym, tf]); await sleep(2500); await waitBars(p); await sleep(1500); };
const emData = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.context().cells[0].chart;
  const seen = new Set();
  const find = (o, d) => {
    if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null;
    seen.add(o);
    if (o.nativeData instanceof Map && o.nativeData.has('stk_em')) return o.nativeData.get('stk_em');
    for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} }
    return null;
  };
  return JSON.parse(JSON.stringify(find(c, 0) || null));
});
const painted = (p) => p.evaluate(() => { for (const c of document.querySelectorAll('canvas')) if (c.__stkEm && c.__stkEm.length) return c.__stkEm; return []; });
const chip = (p) => p.evaluate(() => { const c = document.querySelector('.stk-em-chip'); return c && !c.hidden ? c.textContent : null; });
const add = (p, inputs) => p.evaluate((inputs) => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_em', { inputs }); window.STRYKER_VELA.context().stateChanged(); }, inputs || {});
const setIn = (p, v) => p.evaluate((v) => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_em'); h.setInputs(Object.assign({}, h.inputValues(), v)); }, v);
async function shot(p, name) { await p.mouse.move(5, 5).catch(() => {}); await sleep(600); await p.screenshot({ path: OUT + '/' + name }); console.log('SHOT ' + OUT + '/' + name); }

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    // ---- Pro, desktop, ES ----
    let { ctx, p, errors, hits } = await open(b, { w: 1440, h: 900 });
    // the indicator window lists it in the TradeZoro group
    await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
    await sleep(700);
    await p.evaluate(() => { const b = [...document.querySelectorAll('.stkiw-side button, .stkiw-side a')].find((x) => /Technicals/.test(x.textContent)); if (b) b.click(); });
    await sleep(500);
    const row = await p.evaluate(() => { const r = document.querySelector('.stkiw-row[data-key="b:stk_em"]'); return r ? r.textContent : null; });
    check(row && /TradeZoro Expected Move/.test(row) && /ATM straddle/.test(row), 'indicator window row: ' + row);
    await p.keyboard.press('Escape'); await sleep(400);
    await setSym(p, 'futures:ES1!', '5');
    await add(p, { expiry: '0DTE' });
    await sleep(2500);
    let d = await emData(p);
    const es0 = FX.SPX.em.find((r) => r.k === '0DTE').fut;
    check(d && d.ranges && d.ranges.length === 1 && d.ranges[0].lo === es0.lo && d.ranges[0].hi === es0.hi, 'ES 0DTE range = feeder ES range ' + es0.lo + '–' + es0.hi + ' (got ' + JSON.stringify(d && d.ranges) + ')');
    check(d && /^Expected move updated \d+ min ago · ES \(from SPX\)$/.test(d.status), 'status wording: ' + (d && d.status));
    check(!/live|real-time|delayed|behind/i.test(JSON.stringify(d)), 'no banned words');
    check(hits.every((u) => u === 'SPX'), 'ES asks SPX only: ' + hits.join(','));
    const pp = await painted(p);
    check(pp.length === 1 && pp[0].yHi < pp[0].yLo, 'range painted (hi above lo): ' + JSON.stringify(pp));
    await shot(p, 'em-es-1440.png');
    await setIn(p, { showAll: true });
    await sleep(1500);
    d = await emData(p);
    check(d && d.ranges.length >= 3 && d.ranges.some((r) => / \/ /.test(r.k)), 'show every expiry, Weekly / Monthly merged: ' + (d && d.ranges.map((r) => r.k).join(', ')));
    await shot(p, 'em-es-all-1440.png');
    // NQ -> QQQ
    await setIn(p, { showAll: false, expiry: '1DTE' });
    await setSym(p, 'futures:NQ1!', '5');
    d = await emData(p);
    const nq1 = FX.QQQ.em.find((r) => r.k === '1DTE').fut;
    check(d && d.ranges && d.ranges[0].lo === nq1.lo && d.ranges[0].hi === nq1.hi, 'NQ 1DTE = feeder NQ range');
    // bar replay: nothing drawn
    await p.evaluate(() => { window.__emSavedReplay = window.__stkReplay; window.__stkReplay = { on: true, E: Date.now() - 86400000 }; const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_em'); h.setInputs(Object.assign({}, h.inputValues(), { labels: true })); });
    await sleep(1200);
    d = await emData(p);
    check(d && !d.ranges && /bar replay/.test(d.note || ''), 'replay on -> no range (' + JSON.stringify(d) + ')');
    await p.evaluate(() => { window.__stkReplay = window.__emSavedReplay; });
    // unsupported symbol
    await setSym(p, 'binance:BTCUSDT', '15');
    d = await emData(p);
    check(d && !d.ranges && /available for/.test(d.note || ''), 'BTC -> note only');
    check(!errors.length, 'no page errors ' + errors.join(' | ').slice(0, 300));
    await ctx.close();

    // ---- Free, phone ----
    ({ ctx, p, errors, hits } = await open(b, { w: 390, h: 844, mobile: true, free: true }));
    await setSym(p, 'futures:ES1!', '5');
    await add(p, { expiry: 'Weekly' });
    await sleep(2500);
    d = await emData(p);
    check(d && d.ranges && d.ranges.length === 1, 'Free: ES (SPX) range shown');
    await shot(p, 'em-es-free-390.png');
    await setSym(p, 'futures:NQ1!', '5');
    d = await emData(p);
    check(d && d.pill && /Pro/.test(d.pill) && !d.ranges, 'Free: NQ -> Pro pill, no range');
    check(!hits.includes('QQQ'), 'Free never fetches QQQ');
    const c = await chip(p);
    check(c && /Pro/.test(c), 'chip shows the Pro pill: ' + c);
    await shot(p, 'em-nq-free-390.png');
    check(!errors.length, 'no page errors (phone) ' + errors.join(' | ').slice(0, 300));
    await ctx.close();
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
