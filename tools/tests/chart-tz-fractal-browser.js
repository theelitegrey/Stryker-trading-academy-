// Focused smoke/perf test for TZ Fractal Model.
// CHART_BASE=http://127.0.0.1:8061 OUT=/path node tools/tests/chart-tz-fractal-browser.js
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const path = require('path');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061';
const OUT = process.env.OUT || '/tmp/tz-fractal';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; };
const IGNORE = /ERR_FAILED|WebGL|GroupMarker|GPU stall|favicon|firebase|Failed to load resource|WebSocket connection .*\/api\/chart\/stream\/.*Unexpected response code: 404/i;
async function page(browser, w, h){
  const ctx = await browser.newContext({ viewport: { width:w, height:h }, isMobile:w<500, hasTouch:w<500 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch(e){} });
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance|data-api\.binance|fapi\.binance|stream\.binance|data-stream\.binance)/, r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => { if (/pine|fract|worker|TradeZoro/i.test(m.text())) console.log('CONSOLE', m.type(), m.text().slice(0, 240)); if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text().slice(0, 300)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto(BASE + '/charts.html', { waitUntil:'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout:60000 });
  return { ctx, p, errs };
}
async function setMarket(p, sym, tf, deep){
  await p.evaluate(([s,t]) => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol(s); c.setTimeframe(t); }, [sym, tf]);
  return p.evaluate(async ([s, deep]) => {
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    for (let i=0;i<90;i++){ await new Promise(r=>setTimeout(r,500)); try { if (chart.market.symbol === s && chart.orchestrator.rawBars.length > 50 && chart.orchestrator.historyState !== 'backfill') break; } catch(e){} }
    if (deep) { await chart.setMarket({ bars: deep }); await chart.historyComplete(); }
    return chart.orchestrator.rawBars.length;
  }, [sym, deep]);
}
async function add(p){
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await p.waitForSelector('.stkiw-row', { timeout:20000 });
  await p.evaluate(() => document.querySelector('.stkiw-tab[data-k="picks"]').click());
  await p.waitForTimeout(300);
  const listed = await p.evaluate(() => [...document.querySelectorAll('.stkiw-row')].map(r => ({ name:(r.querySelector('.stkiw-nm')||{}).textContent, key:r.dataset.key, sub:(r.querySelector('.stkiw-sub')||{}).textContent })).find(r => r.name === 'TZ Fractal Model [TradeZoro]'));
  check(!!listed && listed.key === 'x:tz-fractal-model' && listed.sub === 'TradeZoro', 'listed in Editors picks: ' + JSON.stringify(listed));
  const before = await p.evaluate(() => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length);
  const t0 = Date.now();
  await p.evaluate(() => [...document.querySelectorAll('.stkiw-row')].find(r => (r.querySelector('.stkiw-nm')||{}).textContent === 'TZ Fractal Model [TradeZoro]').querySelector('.stkiw-name').click());
  await p.waitForFunction(n => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length > n, before, { timeout:60000 });
  await p.evaluate(() => { try { window.STRYKER_VELA.indicatorPicker.close(); } catch(e){} });
  return Date.now() - t0;
}
async function counts(p){
  return p.evaluate(async () => {
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    const hs = window.STRYKER_PINE.pineHandles(chart); const h = hs[hs.length-1];
    for (let i=0;i<160;i++){
      const rec = [...chart.orchestrator.registry.all()].find(r => r.model && r.model.id === h.id);
      if (rec && rec.model && (rec.model.boxes || rec.model.lines || rec.model.labels || rec.model.tables)) {
        await new Promise(r=>setTimeout(r,1200));
        const m = rec.model;
        const lastIdx = chart.orchestrator.rawBars.length - 1;
        let rightBoxes=0, maxX=0;
        (m.boxes||[]).forEach(b => { if (b.xloc === 'bar_index') { if (b.left > lastIdx) rightBoxes++; maxX = Math.max(maxX, b.right); } });
        const text = [].concat((m.labels||[]).map(l=>l.text||''), ...(m.tables||[]).map(t => JSON.stringify(t).match(/"text":"[^"]*"/g)||[])).join(' | ');
        return { boxes:(m.boxes||[]).length, lines:(m.lines||[]).length, labels:(m.labels||[]).length, tables:(m.tables||[]).length, text, rightBoxes, maxX, lastIdx };
      }
      await new Promise(r=>setTimeout(r,500));
    }
    return { timeout:true, handles:hs.map(x=>x.title) };
  });
}
(async () => {
  const b = await launch();
  try {
    for (const [sym, tf, w, h, shot] of [['futures:NQ1!', '5', 1280, 860, 'nq-5m-1280.png'], ['binance:BTCUSDT','1',1280,860,'btc-1m-1280.png'], ['futures:NQ1!','5',390,844,'nq-5m-390.png']]) {
      const { ctx, p, errs } = await page(b, w, h);
      const bars = await setMarket(p, sym, tf, 5000);
      console.log('INFO market', sym, tf, bars, 'bars');
      const addMs = await add(p);
      const t0 = Date.now();
      const c = await counts(p);
      const totalMs = addMs + Date.now() - t0;
      console.log('INFO model', sym, tf, JSON.stringify({ totalMs, ...c, text:(c.text||'').slice(0,400) }));
      check(totalMs < 20000, `${sym} ${tf}: first draw under 20s (${totalMs}ms)`);
      check(c.boxes > 0 && c.lines > 0 && c.tables > 0, `${sym} ${tf}: draws boxes/lines/table ${JSON.stringify(c)}`);
      check(c.rightBoxes > 0 && c.maxX > c.lastIdx, `${sym} ${tf}: HTF candles right of last bar (${c.rightBoxes}, ${c.maxX}>${c.lastIdx})`);
      check(/Model/.test(c.text||'') && /Education only\. Not financial advice\.|Chart TF above/.test(c.text||''), `${sym} ${tf}: table text/disclaimer`);
      check(/C2/.test(c.text||'') && /C3/.test(c.text||'') && /C4/.test(c.text||''), `${sym} ${tf}: C2/C3/C4 labels render`);
      check(/CISD/.test(c.text||'') && /EQ/.test(c.text||'') && /C1 liq/.test(c.text||''), `${sym} ${tf}: CISD/EQ/C1 liquidity render`);
      check(!/\b(buy|sell)\b/i.test(c.text||''), `${sym} ${tf}: no buy/sell text`);
      await p.screenshot({ path: path.join(OUT, shot), fullPage:false });
      check(!errs.length, `${sym} ${tf}: console errors: ${errs.slice(0,3).join(' | ') || 'none'}`);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
