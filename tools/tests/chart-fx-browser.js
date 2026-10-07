// Charts spot forex test (FxProvider in assets/chart-futures-provider.js, the "fx" rows of
// functions/api/chart/_bars.js) against tools/tests/chart-dev-server.mjs (real Yahoo upstream).
// Needs network (Yahoo + jsDelivr for the Pine engine).
//   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-fx-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

async function open(b, { w, h, mobile, fixedTime }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  if (fixedTime) await p.clock.setFixedTime(new Date(fixedTime));
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|^WebSocket connection to|Failed to load resource: the server responded with a status of 404/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_DATA_DOT, null, { timeout: 40000 });
  await p.waitForTimeout(2500);
  return { ctx, p, errors };
}
const setSym = (p, sym, tf) => p.evaluate(async ([sym, tf]) => {
  const ws = window.STRYKER_VELA;
  ws.active.setSymbol(sym);
  if (tf) ws.setActiveTimeframe ? ws.setActiveTimeframe(tf) : ws.active.setTimeframe(tf);
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const c = ws.context().cells[0];
    try { if (c.symbol.includes(sym.split(':')[1]) && c.chart.orchestrator.rawBars.length > 50) break; } catch (e) {}
  }
}, [sym, tf]);
const state = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.context().cells[0];
  const bars = c.chart.orchestrator.rawBars;
  const last = bars[bars.length - 1];
  const dot = document.querySelector('#vela-chart .stkc-dd');
  const R = c.chart.renderer.renderer;
  return { sym: c.symbol, tf: c.timeframe, n: bars.length, last: last && { t: new Date(last.time).toISOString(), c: last.close },
    dot: dot && { s: dot.dataset.s, tag: dot.textContent.trim(), tip: dot.dataset.tip }, cd: R && R.scene ? R.scene.__stkCdText : null, fut: R && R.scene ? R.scene.__stkCdFut : null,
    legend: (document.querySelector('#vela-chart .vela-statusline') || {}).innerText };
});

(async () => {
  const b = await launch();
  try {
    // ---- desktop: EURUSD 15m -------------------------------------------------------------
    const d = await open(b, { w: 1440, h: 900 });
    await setSym(d.p, 'fx:EURUSD', '15');
    await d.p.waitForTimeout(2500);
    let s = await state(d.p);
    console.log('desktop', JSON.stringify(s));
    check(/EURUSD/.test(s.sym) && s.n > 100, `EURUSD 15m loads bars (${s.n})`);
    check(s.last && /^\d\.\d{3,5}$/.test(String(s.last.c)), `5 dp price (${s.last && s.last.c})`);
    check(s.dot && (s.dot.s === 'delayed' || s.dot.s === 'closed') && !/real-time|live|tick/i.test(s.dot.tag + s.dot.tip), `dot delayed/closed, no live wording (${s.dot && s.dot.tag} / ${s.dot && s.dot.tip})`);
    check(s.fut === 'fx', 'countdown treats symbol as forex');
    const ps = await d.p.evaluate(async () => { const c = window.STRYKER_VELA.context().cells[0]; const i = await window.STRYKER_VELA.feed.providerInstance('fx').getSymbolInfo('EURUSD'); return i.pricescale; });
    check(ps === 100000, 'EURUSD pricescale 1e5 (' + ps + ')');

    // Symbol search: Forex + Commodities tabs.
    const tabs = await d.p.evaluate(async () => {
      const ws = window.STRYKER_VELA;
      ws.symbolPicker.open('');
      await new Promise((r) => setTimeout(r, 600));
      const out = {};
      for (const name of ['Forex', 'Commodities']) {
        const t = [...document.querySelectorAll('.vela-sp-tab')].find((x) => x.textContent === name);
        t.click();
        await new Promise((r) => setTimeout(r, 300));
        out[name] = [...document.querySelectorAll('.vela-sp-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()).slice(0, 40);
      }
      return out;
    });
    console.log('tabs', JSON.stringify(tabs));
    await d.p.screenshot({ path: `${OUT}/fx-picker-commodities-1440.png` });
    check(tabs.Forex.length >= 18 && tabs.Forex.some((x) => /EURUSD/.test(x)), `Forex tab lists pairs (${tabs.Forex.length})`);
    check(['GC1!', 'SI1!', 'CL1!', 'NG1!', 'HG1!', 'MGC1!', 'MCL1!'].every((t) => tabs.Commodities.some((x) => x.includes(t))), `Commodities tab lists GC SI CL NG HG + micros (${tabs.Commodities.length})`);
    // Pick from Commodities -> opens the futures symbol.
    await d.p.evaluate(async () => {
      const row = [...document.querySelectorAll('.vela-sp-row')].find((r) => /\bHG1!/.test(r.innerText));
      row.click();
    });
    await d.p.waitForTimeout(3000);
    s = await state(d.p);
    check(/(futures|COMEX):HG1!$/i.test(s.sym) && s.n > 10, `picking HG from Commodities opens futures:HG1! (${s.sym}, ${s.n})`);

    // Pine on forex: EMA cross + Stoic on EURUSD 15m.
    await setSym(d.p, 'fx:EURUSD', '15');
    d.p.on('crash', () => console.log('PAGE CRASH'));
    const pine = await d.p.evaluate(async () => {
      const P = window.STRYKER_PINE;
      const src = `//@version=5\nindicator("EMA cross test", overlay=true)\nf = ta.ema(close, 9)\ns = ta.ema(close, 21)\nplot(f, "fast", color.teal)\nplot(s, "slow", color.orange)\nplotshape(ta.crossover(f, s), "x", shape.triangleup, location.belowbar)`;
      P.open();
      const c = window.STRYKER_VELA.context().cells[0];
      const stoic = await (await fetch('/assets/pine/stoic-edge-compass.pine?test=' + Date.now())).text();
      P.load('Stoic Edge Compass', stoic, null); await P.addToChart();
      await new Promise((r) => setTimeout(r, 3000));
      const afterStoic = P.pineHandles(c.chart).map((h) => P.titleOf(h));
      const stoicErrEl = document.querySelector('.stkc-pine-err');
      const stoicErr = stoicErrEl && !stoicErrEl.hidden ? stoicErrEl.textContent : '';
      P.load('EMA cross test', src, null); await P.addToChart();
      await new Promise((r) => setTimeout(r, 2000));
      P.close();
      const err = document.querySelector('.stkc-pine-err');
      const titles = P.pineHandles(c.chart).map((h) => P.titleOf(h));
      return { titles, afterStoic, stoicErr, err: err && !err.hidden ? err.textContent : '' };
    });
    console.log('pine', JSON.stringify(pine));
    check(pine.afterStoic.includes('Stoic Edge Compass') && !pine.stoicErr && pine.titles.includes('EMA cross test') && !pine.err, `EMA cross + Stoic run on EURUSD 15m (Stoic: ${pine.afterStoic.join(', ')}, EMA: ${pine.titles.join(', ')})`);
    await d.p.waitForTimeout(1500);
    await d.p.screenshot({ path: `${OUT}/fx-eurusd-15m-1440.png` });
    // USDJPY 3 dp
    await setSym(d.p, 'fx:USDJPY', '60');
    s = await state(d.p);
    check(s.last && /^\d{3}\.\d{1,3}$/.test(String(s.last.c)), `USDJPY 3 dp (${s.last && s.last.c})`);
    check(d.errors.length === 0, 'desktop: no console errors ' + JSON.stringify(d.errors.slice(0, 3)));
    await d.ctx.close();

    // ---- phone 390: EURUSD 15m -------------------------------------------------------------
    const m = await open(b, { w: 390, h: 844, mobile: true });
    await setSym(m.p, 'fx:EURUSD', '15');
    await m.p.waitForTimeout(2500);
    s = await state(m.p);
    check(/EURUSD/.test(s.sym) && s.n > 100, `390: EURUSD 15m loads (${s.n})`);
    const wide = await m.p.evaluate(() => document.documentElement.scrollWidth);
    check(wide <= 391, `390: no sideways overflow (${wide})`);
    await m.p.screenshot({ path: `${OUT}/fx-eurusd-15m-390.png` });
    await m.ctx.close();

    // ---- weekend clock: closed dot, no countdown ------------------------------------------
    const wk = await open(b, { w: 1200, h: 800, fixedTime: '2026-10-10T16:00:00Z' });
    await setSym(wk.p, 'fx:EURUSD', '15');
    await wk.p.waitForTimeout(1500);
    s = await wk.p.evaluate(() => window.STRYKER_DATA_DOT.statusOf('fx:EURUSD'));
    check(s && s.s === 'closed' && /opens/.test(s.text), `Saturday: forex Closed (${s && s.text})`);
    await wk.ctx.close();
  } finally { await b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
