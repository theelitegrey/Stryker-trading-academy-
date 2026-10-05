// Charts page futures smoke test against tools/tests/chart-dev-server.mjs (real Yahoo via the
// real Pages Function). Not part of run.js (needs network).  node chart-futures-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://localhost:8031';
const OUT = process.argv[2] || '/tmp';
const log = []; let fail = 0;
const check = (ok, msg) => { log.push((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

async function run(b, { w, h, mobile, theme, tag, full }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  // External hosts are blocked by the harness, so their ERR_FAILED lines are expected noise.
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  p.on('requestfailed', (r) => { if (r.url().includes('localhost')) errors.push('local request failed ' + r.url()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  const api = [];
  p.on('response', (r) => { if (r.url().includes('/api/chart/bars/')) api.push(r.status()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 30000 });
  await p.waitForTimeout(6000);
  const state = () => p.evaluate(() => {
    const ws = window.STRYKER_VELA;
    const chart = ws.chart;
    let bars = null, sym = null, tf = null;
    try { bars = chart.orchestrator.rawBars.length; } catch (e) {}
    try { sym = chart.market.symbol; tf = chart.market.timeframe; } catch (e) {}
    return { sym, tf, bars, txt: document.querySelector('#vela-chart').innerText.slice(0, 300) };
  });
  const s0 = await state();
  console.log(tag, 'initial', JSON.stringify(s0).slice(0, 300));
  await p.screenshot({ path: `${OUT}/charts-${tag}.png` });
  check(/NQ1!/.test(JSON.stringify(s0)), `${tag}: default symbol NQ1! (${s0.sym} ${s0.tf})`);
  const scrollers = await p.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)) {
        if (cs.scrollbarWidth !== 'thin' && cs.scrollbarWidth !== 'none') bad.push((el.id || el.className || el.tagName).toString().slice(0, 40) + ':' + cs.scrollbarWidth);
      }
    }
    return { bad, docW: document.documentElement.scrollWidth };
  });
  check(scrollers.docW <= w + 2, `${tag}: no horizontal page overflow (${scrollers.docW})`);
  console.log(tag, 'scrollers without thin style:', scrollers.bad.join(', ') || 'none');
  if (full) {
    for (const [sym, tf] of [['futures:ES1!', '60'], ['futures:CL1!', '5'], ['futures:GC1!', '240'], ['futures:NQ1!', '1'], ['futures:NQ1!', '30'], ['futures:NQ1!', 'D'], ['futures:NQ1!', 'W'], ['futures:NQ1!', '15']]) {
      const r = await p.evaluate(async ([sym, tf]) => {
        const ws = window.STRYKER_VELA;
        ws.active.setSymbol(sym); ws.active.setTimeframe(tf);
        const chart = ws.chart;
        for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); if (chart.market.symbol === sym && chart.market.timeframe === tf && chart.orchestrator.historyState !== 'backfill' && chart.orchestrator.rawBars.length) break; }
        await new Promise((r) => setTimeout(r, 800));
        const bars = chart.orchestrator.rawBars;
        return { n: bars.length, first: bars[0] && new Date(bars[0].time).toISOString(), last: bars.at(-1) && new Date(bars.at(-1).time).toISOString(), close: bars.at(-1) && bars.at(-1).close };
      }, [sym, tf]);
      check(r.n > 50, `${tag}: ${sym} ${tf} -> ${r.n} bars ${r.first} .. ${r.last} close ${r.close}`);
      if (sym.includes('ES') || sym.includes('CL') || (sym.includes('NQ') && tf === '15')) await p.screenshot({ path: `${OUT}/charts-${tag}-${sym.split(':')[1].replace('1!', '')}-${tf}.png` });
    }
  }
  if (full) {
    const deep = await p.evaluate(async () => {
      const ws = window.STRYKER_VELA; const chart = ws.chart;
      const before = chart.orchestrator.rawBars.length;
      await chart.setMarket({ bars: 20000 });
      await chart.historyComplete();
      const bars = chart.orchestrator.rawBars;
      // forming bar: wait for one poll cycle and compare
      const last0 = { ...bars.at(-1) };
      await new Promise((r) => setTimeout(r, 23000));
      const last1 = chart.orchestrator.rawBars.at(-1);
      return { before, after: bars.length, first: new Date(bars[0].time).toISOString(), sym: chart.market.symbol, tf: chart.market.timeframe,
        last0, last1 };
    });
    console.log(tag, 'deep', JSON.stringify(deep));
    check(deep.after > deep.before * 2, `${tag}: deep history ${deep.sym} ${deep.tf}: ${deep.before} -> ${deep.after} bars, oldest ${deep.first}`);
    check(deep.last1.time >= deep.last0.time, `${tag}: forming bar polled (close ${deep.last0.close} -> ${deep.last1.close}, t ${deep.last0.time} -> ${deep.last1.time})`);
  }
  await ctx.close();
  check(errors.length === 0, `${tag}: console errors: ${errors.length ? errors.slice(0, 5).join(' | ') : 'none'}`);
  check(api.every((s) => s === 200), `${tag}: ${api.length} API requests, statuses ${[...new Set(api)].join(',')}`);
}

(async () => {
  const b = await launch();
  try {
    await run(b, { w: 1440, h: 900, theme: 'dark', tag: 'desk-dark', full: true });
    await run(b, { w: 390, h: 844, mobile: true, theme: 'dark', tag: 'phone-dark' });
    await run(b, { w: 390, h: 844, mobile: true, theme: 'day', tag: 'phone-day' });
    await run(b, { w: 1440, h: 900, theme: 'day', tag: 'desk-day' });
  } finally { await b.close(); }
  console.log(`\n${fail} failures`);
  process.exit(fail ? 1 : 0);
})();
