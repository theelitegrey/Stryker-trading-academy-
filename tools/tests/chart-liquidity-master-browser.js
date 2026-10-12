// Liquidity Master [TradeZoro] (Owner 2026-10-12 "add this indicator"): smoke + perf on the
// real Charts page. Listed in Editors' picks as TradeZoro, adds from the picker, first draw
// under 10 s (maxBars 1,500; the cap is 20 s) with 5,000 bars on NQ1! 5m, NQ1! 1m and BTCUSDT 1m, draws its session /
// period / FVG / REQ levels, the two draw-on-liquidity tables and the watermark, no console errors.
// Screenshots at 1280 and 390 go to OUT.
//   node tools/tests/chart-dev-server.mjs 8061 &
//   CHART_BASE=http://127.0.0.1:8061 OUT=/path flock /tmp/stryker-chrome.lock node tools/tests/chart-liquidity-master-browser.js
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const path = require('path');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061';
const OUT = process.env.OUT || '/tmp/liquidity-master';
const NAME = 'Liquidity Master [TradeZoro]';
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
  p.on('console', m => { if (/pine|liquidity|worker/i.test(m.text())) console.log('CONSOLE', m.type(), m.text().slice(0, 240)); if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text().slice(0, 300)); });
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
  const rows = await p.evaluate(() => [...document.querySelectorAll('.stkiw-row')].map(r => ({ name:(r.querySelector('.stkiw-nm')||{}).textContent, key:r.dataset.key, sub:(r.querySelector('.stkiw-sub')||{}).textContent })));
  const listed = rows.find(r => r.name === NAME);
  check(!!listed && listed.key === 'x:liquidity-master-tradezoro' && listed.sub === 'TradeZoro', 'listed in Editors picks: ' + JSON.stringify(listed));
  check(['SMT Divergence Pro [TradeZoro]', 'IFVG Pro+ [TradeZoro]', 'HTF PO3 Lens [TradeZoro]', 'FVG Relay [TradeZoro]', 'TZ Fractal Model [TradeZoro]'].every(n => rows.some(r => r.name === n)), 'the other picks are still listed');
  const before = await p.evaluate(() => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length);
  const t0 = Date.now();
  await p.evaluate((n) => [...document.querySelectorAll('.stkiw-row')].find(r => (r.querySelector('.stkiw-nm')||{}).textContent === n).querySelector('.stkiw-name').click(), NAME);
  await p.waitForFunction(n => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length > n, before, { timeout:60000 });
  await p.evaluate(() => { try { window.STRYKER_VELA.indicatorPicker.close(); } catch(e){} });
  return Date.now() - t0;
}
async function model(p){
  return p.evaluate(async () => {
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    const hs = window.STRYKER_PINE.pineHandles(chart); const h = hs[hs.length-1];
    for (let i=0;i<160;i++){
      const rec = [...chart.orchestrator.registry.all()].find(r => r.model && r.model.id === h.id);
      if (rec && rec.model && rec.model.tables && rec.model.tables.length) {
        await new Promise(r=>setTimeout(r,1200));
        const m = rec.model;
        const cellTexts = (t) => JSON.stringify(t).match(/"text":"[^"]*"/g) || [];
        const lineCols = {}; (m.lines||[]).forEach(l => { const c = String(l.color || l.line_color || ''); lineCols[c] = (lineCols[c]||0)+1; });
        return { boxes:(m.boxes||[]).length, lines:(m.lines||[]).length, labels:(m.labels||[]).length, polylines:(m.polylines||[]).length,
          tables:(m.tables||[]).map(t => ({ pos:t.position, text:cellTexts(t).join(' ').slice(0, 600) })),
          labelText:[...new Set((m.labels||[]).map(l => l.text||''))].join(' | '), lineCols, title:h.title,
          anchorOk: m.anchorTime == null || m.anchorTime === chart.orchestrator.rawBars[Math.max(0, chart.orchestrator.rawBars.length - 1500)].time,
          anchorTime: m.anchorTime, firstBar: chart.orchestrator.rawBars[0].time };
      }
      await new Promise(r=>setTimeout(r,500));
    }
    return { timeout:true, handles:hs.map(x=>x.title) };
  });
}
(async () => {
  const b = await launch();
  const report = [];
  try {
    for (const [sym, tf, w, h, shot] of [['futures:NQ1!','5',1280,860,'nq-5m-1280.png'], ['futures:NQ1!','1',1280,860,'nq-1m-1280.png'], ['binance:BTCUSDT','1',1280,860,'btc-1m-1280.png'], ['futures:NQ1!','5',390,844,'nq-5m-390.png']]) {
      const { ctx, p, errs } = await page(b, w, h);
      const bars = await setMarket(p, sym, tf, 5000);
      console.log('INFO market', sym, tf, bars, 'bars', w + 'px');
      const addMs = await add(p);
      const t0 = Date.now();
      const c = await model(p);
      const totalMs = addMs + Date.now() - t0;
      console.log('INFO model', sym, tf, JSON.stringify({ totalMs, bars, ...c }).slice(0, 2500));
      report.push({ sym, tf, w, bars, totalMs, ...c });
      const tag = `${sym} ${tf} @${w}`;
      check(!c.timeout, `${tag}: model arrived`);
      check(totalMs < 10000, `${tag}: first draw under 10s (${totalMs}ms, ${bars} bars)`);
      const tt = (c.tables||[]).map(t => t.text).join(' ');
      check(/DRAW ON LIQUIDITY  ·  ABOVE/.test(tt) && /DRAW ON LIQUIDITY  ·  BELOW/.test(tt), `${tag}: both draw-on-liquidity tables`);
      check((c.tables||[]).some(t => t.pos === 'top_right' && /ABOVE/.test(t.text)) && (c.tables||[]).some(t => t.pos === 'bottom_right' && /BELOW/.test(t.text)), `${tag}: tables top-right / bottom-right`);
      check(/Liquidity Master \[TradeZoro\]/.test(tt) && !/Stryker/i.test(tt + c.labelText), `${tag}: TradeZoro watermark, no Stryker text`);
      check(c.lines > 0 && c.boxes > 0 && c.labels > 0, `${tag}: draws lines/boxes/labels (${c.lines}/${c.boxes}/${c.labels})`);
      check(/FVG/.test(c.labelText), `${tag}: FVG labels`);
      check(c.anchorOk, `${tag}: script runs on the newest 1,500 bars (maxBars), drawings anchored there (${c.anchorTime} vs first chart bar ${c.firstBar})`);
      check(c.lines <= 500 && c.boxes <= 500 && c.labels <= 500, `${tag}: within 500 lines/boxes/labels`);
      // Session / period / REQ names depend on the live bars in view: report them.
      for (const k of ['Asia High', 'Asia Low', 'London High', 'London Low', 'NY High', 'NY Low', 'PDH', 'PDL', 'PWH', 'PWL', 'REQH', 'REQL', 'Open'])
        console.log(`INFO ${tag}: ${k} ${(c.labelText + ' ' + tt).includes(k)}`);
      await p.waitForTimeout(800);
      await p.screenshot({ path: path.join(OUT, shot), fullPage:false });
      check(!errs.length, `${tag}: console errors: ${errs.slice(0,3).join(' | ') || 'none'}`);
      await ctx.close();
    }
  } finally { await b.close(); }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
