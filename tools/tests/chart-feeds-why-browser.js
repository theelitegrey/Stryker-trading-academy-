// Why note + one-source note/chip + no overlap. node tools/tests/chart-dev-server.mjs 8011; CHART_BASE=http://127.0.0.1:8011 node tools/tests/chart-feeds-why-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8011', OUT = process.argv[2] || '/tmp/w1why';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (ok, m, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + m + (ok ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const FUT = /Order book · Pro/, CRY = /Full order book · Pro/;
async function open(b, { w, h, mobile, theme, plan, sym }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([plan, t]) => { if (plan === 'pro') window.__stkL2Test = { base: 'http://127.0.0.1:9', trades: true }; window.__stkChartTestFree = plan === 'free';
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, [plan, theme]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
  await p.evaluate(async (s) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1'); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 300)); if (ws.chart.market.symbol === s && ws.chart.orchestrator.rawBars.length > 20) break; } }, sym);
  return { ctx, p };
}
const addI = (p, t) => p.evaluate((t) => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator(t, { inputs: {} }); window.STRYKER_VELA.context().stateChanged(); }, t);
const panel = (p, on, mkt) => p.evaluate(([on, mkt]) => window.STRYKER_FEEDS.setPanel('t_book', on, { needs: 'L2', title: 'Order book heatmap (L2)', mkt }), [on, mkt]);
const state = (p) => p.evaluate(() => {
  const vis = (e) => e && !e.hidden && e.offsetWidth;
  const bx = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  const wrap = document.getElementById('stkfeeds-wrap'), note = document.getElementById('stkfeed-note'), w = vis(wrap) ? bx(wrap) : null;
  const hit = [];
  if (w) for (const s of ['.vela-statusline', '.vela-ind-fold', '.stkdp', '.vela-ind-table', '.vela-table', '[class*="fab"]', '[class*="gex-chip"]', '[class*="vela-tbl"]']) for (const e of document.querySelectorAll(s)) { if (!e.offsetWidth || wrap.contains(e)) continue; const o = bx(e); if (o[2] - o[0] < 400 && o[0] < w[2] && o[2] > w[0] && o[1] < w[3] && o[3] > w[1]) hit.push(s); }
  return { w, noteVis: !!vis(note), noteText: vis(note) ? note.innerText : '', noteH: vis(note) ? note.getBoundingClientRect().height : 0, chips: [...document.querySelectorAll('.stkfeed')].map((x) => x.dataset.l + ':' + x.className.replace('stkfeed ', '')), whyBtn: !!document.querySelector('.stkfeed-why-b'), whyText: (document.querySelector('.stkfeed-why-t') || {}).textContent || '', vw: innerWidth, sw: document.documentElement.scrollWidth, hit, lines: vis(note) ? [...note.querySelectorAll('.stkfeed-reason,.stkfeed-why-l')].map((e) => Math.round(e.getBoundingClientRect().height)) : [] };
});
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) for (const theme of ['dark', 'light']) {
      const T = w + '-' + theme;
      // FREE, futures: add / remove / add again; expand Why
      let { ctx, p } = await open(b, { w, h, mobile, theme, plan: 'free', sym: 'futures:NQ1!' });
      await panel(p, true, 'futures'); await sleep(1800);
      let s = await state(p); console.log('INFO free-fut ' + T, JSON.stringify(s));
      check(s.noteVis && FUT.test(s.noteText) && s.whyBtn, T + ' Free NQ: lock note + Why? (1st add)', s);
      check(s.chips.some((c) => /^L2:is-locked/.test(c)), T + ' Free NQ: L2 chip locked (same state as note)', s.chips);
      await panel(p, false, 'futures'); await sleep(1500); s = await state(p);
      check(!s.noteVis && !s.w, T + ' removed: note + chips gone', s);
      await panel(p, true, 'futures'); await sleep(1800); s = await state(p);
      check(s.noteVis && FUT.test(s.noteText), T + ' added again: note + Why? appears again', s);
      check(s.hit.length === 0 && s.sw <= s.vw + 1 && s.w[0] >= 0 && s.w[2] <= s.vw, T + ' no overlap, inside viewport', s);
      if (mobile) check(s.lines.every((x) => x <= 40) && s.noteH < 110, T + ' collapsed: compact, Why line is one line', s);
      await p.screenshot({ path: OUT + '/why-free-fut-' + T + '-collapsed.png' });
      await p.click('.stkfeed-why-b').catch(() => p.tap('.stkfeed-why-b')); await sleep(700); s = await state(p);
      check(/paid licence/.test(s.whyText) && !/Rithmic|InsightSentry|Binance/i.test(s.whyText), T + ' Why? expands inline with CME copy', s);
      check(s.hit.length === 0 && s.sw <= s.vw + 1, T + ' expanded: no overlap', s);
      await p.screenshot({ path: OUT + '/why-free-fut-' + T + '-expanded.png' });
      await p.click('.stkfeed[data-l="L2"]').catch(() => p.tap('.stkfeed[data-l="L2"]')); await sleep(600);
      const sh = await p.evaluate(() => { const e = document.getElementById('stkfeed-sheet'); return e && !e.hidden ? e.innerText : ''; });
      check(/paid licence/.test(sh), T + ' sheet locked section has the Why copy', sh);
      await ctx.close();
      // FREE, crypto
      ({ ctx, p } = await open(b, { w, h, mobile, theme, plan: 'free', sym: 'binance:BTCUSDT' }));
      await addI(p, 'stk_crypto_dom'); await sleep(2500);
      await panel(p, true, 'crypto'); await sleep(1500); s = await state(p);
      check(s.noteVis && CRY.test(s.noteText) && !FUT.test(s.noteText), T + ' Free BTC: crypto copy', s);
      await p.click('.stkfeed-why-b').catch(() => p.tap('.stkfeed-why-b')); await sleep(600); s = await state(p);
      check(/Trades and candles stay free/.test(s.whyText), T + ' BTC Why? expanded', s);
      if (theme === 'dark' || w === 390) await p.screenshot({ path: OUT + '/why-free-btc-' + T + '.png' });
      await ctx.close();
      // PRO MNQ: Delta (L1) + Key Levels (market stats) + GEX: chip lit => note absent, nothing overlaps
      ({ ctx, p } = await open(b, { w: mobile ? 412 : w, h, mobile, theme, plan: 'pro', sym: 'futures:MNQ1!' }));
      for (const t of ['stk_ts_dsuite', 'stk_msess', 'stk_gex', 'stk_fut_dom']) await addI(p, t).catch(() => {});
      await sleep(4000); s = await state(p); console.log('INFO pro ' + T, JSON.stringify(s));
      const lit = s.chips.some((c) => /^L2:is-lit/.test(c));
      check(!(lit && s.noteVis) && !s.noteVis, T + ' Pro: chip lit => no lock note', s);
      check(s.hit.length === 0, T + ' Pro MNQ Key Levels + GEX + Delta (L1): nothing overlapped', s.hit);
      await p.screenshot({ path: OUT + '/why-pro-mnq-' + T + '.png' });
      await ctx.close();
      // FREE MNQ with the same tools (gate may strip some): shot
      ({ ctx, p } = await open(b, { w: mobile ? 412 : w, h, mobile, theme, plan: 'free', sym: 'futures:MNQ1!' }));
      for (const t of ['stk_ts_dsuite', 'stk_msess', 'stk_gex']) await addI(p, t).catch(() => {});
      await panel(p, true, 'futures'); await sleep(4000); s = await state(p);
      check(s.hit.length === 0, T + ' Free MNQ Key Levels + GEX + Delta: nothing overlapped', s.hit);
      await p.screenshot({ path: OUT + '/why-free-mnq-' + T + '.png' });
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
