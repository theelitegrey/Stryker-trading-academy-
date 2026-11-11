// Desktop chart memory (member GK, Discord 11 Nov: "a single TradeZoro chart tab is ~4 GB: 3.3 GB chart + ~1 GB GPU,
// two-chart layout with 16 indicators, no footprint or heatmap").
// Layout: 2 charts side by side at 1440x900 @2x (a laptop screen), CME NQ1! 1m left and ES1! 1m right, 8 indicators
// each (Liquidity Master [Pine], EMA, VWAP (trades), Volume Profile (trades), Big Trades, Delta, Session Volume Profile,
// Previous Day POC/VAH/VAL), on the signed-in tick-engine lane with a live fixture feed (tick-engine-hub.py, both symbols
// get trades) and fixture bars for the old source (60 days of 1m).
//
// MEASURES at t=0 (indicators up), MID and END minutes of live ticks:
//   - JS heap: page + every worker (CDP Runtime.getHeapUsage after a GC)
//   - DOM nodes / listeners (Memory.getDOMCounters)
//   - canvases: count and backing-store pixels (width x height, already x dpr) of every canvas with a context, per cell
// FAILS when: heap > HEAP_MB, canvas pixels > CANVAS_MP, or heap grows more than GROW_PCT % between MID and END.
// Budgets = the "after" numbers of hermes/w1-auto-ram2 (reports/workers/auto-ram.md ROUND 2) + 15 %.
//
//   TE_ALLSYM=1 python3 tools/tests/tick-engine-hub.py 8191 &
//   node tools/tests/chart-dev-server.mjs 8190 &
//   CHART_BASE=http://127.0.0.1:8190 HUB=http://127.0.0.1:8191 flock /tmp/stryker-chrome.lock node tools/tests/chart-memory-browser.js
// env: MINUTES (default 3; the full proof is 30), MID (default MINUTES/3), OUT (json of the samples), SHOT (png at t=0),
//      SNAP (dir: heap snapshots at MID and END, for tools/tests/heap-diff.mjs)
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const { openPhone, measure } = require('./phone-mem-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8190', HUB = process.env.HUB || 'http://127.0.0.1:8191';
const MIN = +(process.env.MINUTES || 3), MID = +(process.env.MID || Math.max(1, Math.round(MIN / 3)));
// round 2 (hermes/w1-auto-ram2) 30-min run: heap 121 MB, canvas 59.3 MP, renderer+GPU 1382 MB max -> +15 %
const BUDGET = { heapMB: +(process.env.HEAP_MB || 140), canvasMP: +(process.env.CANVAS_MP || 68), rssMB: +(process.env.RSS_MB || 1590), growPct: 10, growFloorMB: 12 };
const SYMS = ['NQ1!', 'ES1!'];
const NATIVES = ['ema', 'stk_of_vwap', 'stk_of_vp', 'stk_of_big', 'stk_dsuite', 'stk_svp', 'stk_pdvp'];
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

// canvases per chart cell: backing pixels of the ones with a context (a canvas without one holds no pixel memory)
const canvasPerCell = (p) => p.evaluate(() => {
  const cells = window.STRYKER_VELA.context().cells.map((c) => { const w = c.chart.renderer && (c.chart.renderer.renderer || c.chart.renderer).wrapper; let el = w; for (let i = 0; i < 6 && el && el.parentElement; i++) { el = el.parentElement; if (el.getBoundingClientRect().width < window.innerWidth * 0.75 && el.querySelectorAll('canvas').length > 2) break; } return el; });
  const out = cells.map(() => ({ n: 0, mp: 0, ctx: 0, ctxMp: 0, used: 0, usedMp: 0 })), rest = { n: 0, mp: 0, ctx: 0, ctxMp: 0, used: 0, usedMp: 0 };
  for (const r of window.__cvAll || []) {
    const c = r.deref(); if (!c) continue;
    const i = cells.findIndex((el) => el && el.contains(c)), o = i >= 0 ? out[i] : rest, px = c.width * c.height / 1e6;
    o.n++; o.mp += px; if (c.__ctx) { o.ctx++; o.ctxMp += px; }
    if (px && (c.__gl || c.__px)) { o.used++; o.usedMp += px; }   // pixel memory really allocated: a GL context or a 2D call reached the canvas
  }
  const r1 = (o) => ({ n: o.n, ctx: o.ctx, used: o.used, ctxMp: Math.round(o.ctxMp * 10) / 10, usedMp: Math.round(o.usedMp * 10) / 10 });
  return { cells: out.map(r1), other: r1(rest) };
});

async function snapshot(cdp, file) {
  const chunks = [];
  const on = (e) => chunks.push(e.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', on);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', on);
  fs.writeFileSync(file, chunks.join(''));
  console.log('  heap snapshot', file, Math.round(fs.statSync(file).size / 1048576) + ' MB file');
}

// the layout above, indicators up and idle -> { p, cdp, errors } (also used by probe scripts)
async function build(b) {
  const { p, cdp, errors } = await openPhone(b, { w: 1440, h: 900, dpr: 2, seed: false, base: BASE, hub: HUB });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_PINE, null, { timeout: 180000, polling: 250 });
  let st = 0; p.on('pageerror', (e) => { if (st++ < 1) console.log('  first page error stack:', String(e.stack || e).split('\n').slice(0, 4).join(' | ')); });
  await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('2h')); await p.waitForTimeout(2500);
  const lm = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'pine', 'liquidity-master-tradezoro.pine'), 'utf8');
  for (let i = 0; i < SYMS.length; i++) {
    await p.evaluate(async ([i, sym]) => {
      const ws = window.STRYKER_VELA, c = ws.cell(ws.context().cells[i].id);
      c.setSymbol('futures:' + sym); c.setTimeframe('1');
      for (let k = 0; k < 150; k++) { await new Promise((r) => setTimeout(r, 200)); const o = c.chart.orchestrator; if (o.config.market.symbol === 'futures:' + sym && String(o.config.market.timeframe) === '1' && o.rawBars.length > 50 && !o.switchingMarket) break; }
    }, [i, SYMS[i]]);
    const added = await p.evaluate(async ([i, types, src]) => {
      const c = window.STRYKER_VELA.context().cells[i].chart;
      for (const t of types) { try { c.addNativeIndicator(t); } catch (e) { return 'ERR ' + t + ' ' + e; } }
      window.STRYKER_VELA.context().stateChanged();
      const r = await window.STRYKER_PINE.runOnChart(c, src, undefined, false, { engine: 'next', builtin: true });
      return r && r.ok ? (c.indicators() || []).filter((h) => h.nativeType !== 'volume').length : 'pine ' + JSON.stringify(r && r.msg);
    }, [i, NATIVES, lm]);
    check(added >= 8, `chart ${i + 1} (${SYMS[i]} 1m): 8 indicators on it (${added})`);
  }
  await p.waitForFunction(() => window.STRYKER_VELA.context().cells.every((c) => window.STRYKER_PINE.pineHandles(c.chart).length === 1), null, { timeout: 120000 }).catch(() => {});
  await p.waitForFunction(() => !document.documentElement.classList.contains('stk-pine-busy'), null, { timeout: 180000, polling: 500 }).catch(() => {});
  await p.waitForTimeout(8000);
  return { p, cdp, errors };
}
module.exports = { build, canvasPerCell, snapshot };

if (require.main === module) (async () => {
  const b = await launch();
  try {
    const { p, cdp, errors } = await build(b);
    if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
    const s = [], t0 = Date.now();
    for (const at of [...new Set([0, MID, MIN])]) {
      const wait = t0 + at * 60000 - Date.now(); if (wait > 0) await p.waitForTimeout(wait);
      const m = await measure(b, p, cdp, process.pid);
      m.t = at; m.cv = await canvasPerCell(p);
      m.mp = Math.round((m.cv.cells.reduce((a, x) => a + x.usedMp, 0) + m.cv.other.usedMp) * 10) / 10;
      s.push(m);
      console.log(`t=${at}m heap page ${m.pageHeapMB} + workers ${m.workerHeapMB} = ${m.totalHeapMB} MB | nodes ${m.dom.nodes} listeners ${m.dom.jsEventListeners} | canvases ${JSON.stringify(m.cv)} = ${m.mp} MP | bars ${m.bars} | rss renderer ${Math.round(m.rss.renderer / 1024)} MB gpu ${Math.round(m.rss.gpu / 1024)} MB`);
      console.log('   workers', JSON.stringify(m.workersMB));
      if (process.env.SNAP && at && at === MID || process.env.SNAP && at === MIN) { fs.mkdirSync(process.env.SNAP, { recursive: true }); await snapshot(cdp, path.join(process.env.SNAP, `t${at}.heapsnapshot`)); }
    }
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ budget: BUDGET, samples: s }, null, 1));
    const mid = s.find((x) => x.t === MID), end = s[s.length - 1];
    const maxHeap = Math.max(...s.map((x) => x.totalHeapMB)), maxMp = Math.max(...s.map((x) => x.mp));
    check(maxHeap <= BUDGET.heapMB, `JS heap page + workers ${maxHeap} MB <= ${BUDGET.heapMB} MB`);
    check(maxMp <= BUDGET.canvasMP, `canvas backing pixels ${maxMp} MP (${Math.round(maxMp * 4)} MB) <= ${BUDGET.canvasMP} MP`);
    const maxRss = Math.max(...s.map((x) => Math.round((x.rss.renderer + x.rss.gpu) / 1024)));
    check(maxRss <= BUDGET.rssMB, `renderer + GPU memory ${maxRss} MB <= ${BUDGET.rssMB} MB`);
    // shortcut: one Pine worker made the heap base smaller, so the same capped 48 h trade window filling up reads as a
    // bigger %; growth also passes under growFloorMB absolute. Upgrade to a pure % rule if the base grows again.
    const growMB = end.totalHeapMB - mid.totalHeapMB, grow = growMB / mid.totalHeapMB * 100;
    check(grow <= BUDGET.growPct || growMB <= BUDGET.growFloorMB, `heap growth ${MID} -> ${MIN} min ${grow.toFixed(1)} % (${growMB.toFixed(1)} MB) <= ${BUDGET.growPct} % or ${BUDGET.growFloorMB} MB`);
    check(end.bars.every((n) => n > 50), 'both charts still have bars ' + end.bars);
    check(!errors.length, 'no page errors ' + errors.slice(0, 3).join(' | '));
  } finally { await b.close(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
