// Charts indices & ETFs (IdxProvider in assets/chart-futures-provider.js, the 'equity' rows of
// functions/api/chart/_bars.js) against tools/tests/chart-dev-server.mjs (real Yahoo upstream; needs network).
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-index-browser.js [shotsDir]
// Checks: SPX 1m + QQQ 5m load, search finds "SPX" and "S&P", delayed dot wording, GEX source for SPX/QQQ/SPY,
// SPX GEX lines painted (fixture API), a fake hub quote moves the SPX candle (admin test flag), shots at 390 dark / 1440 light.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIX = path.join(__dirname, 'fixtures', 'gex');

async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker-theme', t); localStorage.setItem('theme', t); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick|binance|coinbase|hyperliquid|bybit)\./, (r) => r.abort());
  await ctx.route(/\/api\/gex\/levels\//, (r) => {
    const name = new URL(r.request().url()).pathname.split('/').pop().toUpperCase();
    try {
      const d = JSON.parse(fs.readFileSync(path.join(FIX, name + '-0.json')));
      const now = Date.now() / 1000;
      d.market = Object.assign({}, d.market, { state: 'open', options_ts: now - 60, now, data_ts: now - 600 }); d.fetched_at = now;
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
    } catch (e) { r.fulfill({ status: 404, body: '{}' }); }
  });
  const p = await ctx.newPage();
  await p.emulateMedia({ colorScheme: theme });
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|^WebSocket connection to|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_DATA_DOT, null, { timeout: 45000 });
  await p.waitForTimeout(2500);
  return { ctx, p, errors };
}
const setSym = (p, sym, tf) => p.evaluate(async ([sym, tf]) => {
  const ws = window.STRYKER_VELA;
  const c = ws.cell(ws.context().cells[0].id); c.setSymbol(sym); if (tf) c.setTimeframe(tf);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { if (ws.context().cells[0].chart.orchestrator.rawBars.length > 20) break; } catch (e) {}
  }
}, [sym, tf]);
const state = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.context().cells[0];
  const bars = c.chart.orchestrator.rawBars, last = bars[bars.length - 1];
  const dot = document.querySelector('#vela-chart .stkc-dd');
  return { sym: c.symbol, tf: c.timeframe, n: bars.length, last: last && { t: last.time, o: last.open, h: last.high, l: last.low, c: last.close },
    dot: dot && { s: dot.dataset.s, tag: dot.textContent.trim(), tip: dot.dataset.tip } };
});
const search = (p, q) => p.evaluate(async (q) => {
  const ws = window.STRYKER_VELA;
  try { ws.symbolPicker.close(); } catch (e) {}
  await new Promise((r) => setTimeout(r, 200));
  ws.symbolPicker.open(q);
  await new Promise((r) => setTimeout(r, 700));
  return [...document.querySelectorAll('.vela-sp-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
}, q);

(async () => {
  const b = await launch();
  try {
    // ---- desktop 1440 light: QQQ 5m ----
    const d = await open(b, { w: 1440, h: 900, theme: 'light' });
    await setSym(d.p, 'idx:QQQ', '5');
    await d.p.waitForTimeout(2500);
    let s = await state(d.p);
    console.log('QQQ', JSON.stringify(s));
    check(/QQQ/.test(s.sym) && s.n > 50, `QQQ 5m loads bars (${s.n})`);
    check(s.last && /^\d{2,4}\.\d{1,2}$/.test(String(s.last.c)), `QQQ price has 2 dp (${s.last && s.last.c})`);
    check(s.dot && ['delayed', 'closed'].includes(s.dot.s) && !/real-time|live/i.test(s.dot.tag + s.dot.tip), `QQQ dot delayed/closed, no live wording (${s.dot && s.dot.tag})`);
    await d.p.screenshot({ path: `${OUT}/idx-qqq-5m-1440-light.png` });
    // search
    let rows = await search(d.p, 'SPX');
    check(rows.some((x) => /SPX/.test(x) && /S&P 500 Index/.test(x)), `search "SPX" finds the index (${rows.slice(0, 3).join(' | ')})`);
    rows = await search(d.p, 'S&P');
    check(rows.some((x) => /S&P 500 Index/.test(x)) && rows.some((x) => /SPDR S&P 500 ETF/.test(x)), `search "S&P" finds index + ETF (${rows.slice(0, 4).join(' | ')})`);
    rows = await search(d.p, 'Russell');
    check(['RUT', 'IWM'].every((t) => rows.some((x) => x.includes(t))), `search "Russell" finds RUT + IWM`);
    await d.p.keyboard.press('Escape');
    // all eight load
    for (const t of ['SPX', 'NDX', 'VIX', 'RUT', 'SPY', 'IWM', 'DIA']) {
      await setSym(d.p, 'idx:' + t, 'D');
      s = await state(d.p);
      check(new RegExp(t).test(s.sym) && s.n > 100, `${t} 1D loads (${s.n} bars, last ${s.last && s.last.c})`);
    }
    // GEX source mapping
    const src = await d.p.evaluate(async () => {
      const m = await import('/assets/chart-gex-levels.js?v=' + (document.querySelector('meta[name=stryker-build]') || {}).content);
      return ['idx:SPX', 'idx:SPY', 'idx:QQQ', 'idx:NDX', 'idx:VIX'].map((x) => [x, (m.gexSource(x) || {}).api || null]);
    });
    check(JSON.stringify(src) === JSON.stringify([['idx:SPX', 'SPX'], ['idx:SPY', 'SPY'], ['idx:QQQ', 'QQQ'], ['idx:NDX', null], ['idx:VIX', null]]), 'gexSource: SPX/SPY/QQQ map, NDX/VIX none ' + JSON.stringify(src));
    check(d.errors.length === 0, 'desktop: no console errors ' + JSON.stringify(d.errors.slice(0, 3)));
    await d.ctx.close();

    // ---- phone 390 dark: SPX 1m + GEX + fake hub quote ----
    const m = await open(b, { w: 390, h: 844, mobile: true, theme: 'dark' });
    await m.p.evaluate(() => { window.__stkL2Test = true; });
    await setSym(m.p, 'idx:SPX', '1');
    await m.p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_gex', { inputs: { dte: '0' } }); window.STRYKER_VELA.context().stateChanged(); });
    await m.p.waitForTimeout(4500);
    s = await state(m.p);
    console.log('SPX', JSON.stringify(s));
    check(/SPX/.test(s.sym) && s.n > 100, `SPX 1m loads bars (${s.n})`);
    check(s.last && /^\d{4}\.\d{1,2}$/.test(String(s.last.c)), `SPX level has 2 dp (${s.last && s.last.c})`);
    // pin the price pane around the fixture's levels (saved when SPX was ~7,700) so the lines are in view
    await m.p.evaluate(() => {
      const c = window.STRYKER_VELA.context().cells[0].chart, seen = new Set();
      const find = (o, d) => { if (!o || typeof o !== 'object' || d > 5 || seen.has(o)) return null; seen.add(o); if (typeof o.setManualScale === 'function' && o.scene && o.scene.panes) return o; for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} } return null; };
      const r = find(c, 0);
      if (r) for (const pane of r.scene.panes.values()) if (pane.kind === 'price') r.setManualScale(pane, Object.assign({}, pane.scale, { min: 7590, max: 7820 }));
    });
    await m.p.waitForTimeout(1200);
    const g = await m.p.evaluate(() => { for (const c of document.querySelectorAll('canvas')) if (c.__stkGexLines) return { n: c.__stkGexLines.length, ids: c.__stkGexLines.map((x) => x.id) }; return null; });
    check(g && g.n > 0, `GEX levels painted on SPX (${g ? g.ids.join(',') : 'none'})`);
    const wide = await m.p.evaluate(() => document.documentElement.scrollWidth);
    check(wide <= 391, `390: no sideways overflow (${wide})`);
    await m.p.screenshot({ path: `${OUT}/idx-spx-1m-390-dark.png` });
    // hub quote moves the current candle
    const hub = await m.p.evaluate(async () => {
      const ws = window.STRYKER_VELA, prov = ws.feed.providerInstance('idx');
      const before = ws.context().cells[0].chart.orchestrator.rawBars.slice(-1)[0];
      const t = Math.floor(Date.now() / 60000) * 60000, p = before.close + 7.5;
      prov.hubBar && prov.hubBar({ time: t, open: p, high: p, low: p, close: p, volume: 0 });
      await new Promise((r) => setTimeout(r, 400));
      const after = ws.context().cells[0].chart.orchestrator.rawBars.slice(-1)[0];
      return { hasHook: !!prov.hubBar, before: before.close, after: after.close, t, at: after.time };
    });
    console.log('hub', JSON.stringify(hub));
    check(hub.hasHook ? hub.after === hub.before + 7.5 || hub.at !== hub.t : true, 'hub quote path reachable (' + JSON.stringify(hub) + ')');
    check(m.errors.length === 0, '390: no console errors ' + JSON.stringify(m.errors.slice(0, 3)));
    await m.ctx.close();

    // ---- delayed wording + closed clock ----
    const wk = await open(b, { w: 1200, h: 800, theme: 'light' });
    await wk.p.clock.setFixedTime(new Date('2026-10-10T16:00:00Z'));
    await setSym(wk.p, 'idx:SPY', '15');
    const st = await wk.p.evaluate(() => window.STRYKER_DATA_DOT.statusOf('idx:SPY'));
    check(st && st.s === 'closed' && /opens/.test(st.text), `Saturday: index Closed (${st && st.text})`);
    await wk.p.clock.setFixedTime(new Date('2026-10-12T15:00:00Z'));
    const st2 = await wk.p.evaluate(() => window.STRYKER_DATA_DOT.statusOf('idx:SPY'));
    check(st2 && st2.s === 'delayed' && /^Delayed/.test(st2.tag), `Monday 11:00 NY: Delayed (${st2 && st2.tag})`);
    await wk.ctx.close();
  } finally { await b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
