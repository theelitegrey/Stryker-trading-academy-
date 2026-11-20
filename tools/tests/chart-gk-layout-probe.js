// Member GK's layout (Discord 1572203424009953341, 17-20 Nov: "one workspace, 2 charts, ~1.6-2 GB tab + 500-780 MB GPU",
// worse in the Windows app). Rebuilt from his screenshots: 2 charts side by side at 1920x1080 (his screen) @1x,
//   left  NQ1! 1m footprint candles + Big Trades L2, Delta Profile L2, Footprint Patterns L2, Delta Ladder L2, Dark pool,
//         Delta L2 (pane), SMT Divergence Pro (Pine)
//   right NQ1! 1m candles + EMA, VWAP (trades), Wall Events, Econ events, GEX Levels, Delta Ladder L2, Big Trades L2, and
//         6 Pine scripts (SMT Divergence Pro, IFVG Pro+, FVG Relay, Liquidity Master, Session Sweep SMT + IFVG, HTF PO3 Lens)
// on the signed-in tick-engine lane with live fixture ticks. Prints: JS heap (page + workers, and performance.memory with
// --enable-precise-memory-info), DOM counters, every canvas with pixel memory (cell, CSS size, backing size, dpr ratio),
// renderer / GPU process RSS, and idle cost (rAF callbacks/s, canvas draw calls/s) over IDLE seconds.
//   TE_ALLSYM=1 python3 tools/tests/tick-engine-hub.py 8191 &  node tools/tests/chart-dev-server.mjs 8190 &
//   CHART_BASE=http://127.0.0.1:8190 HUB=http://127.0.0.1:8191 node tools/tests/chart-gk-layout-probe.js
// env: W, H, DPR (default 1920x1080 @1), THEME (night | day), IDLE (s, default 10), OUT (json), SHOT (png), BUDGET_MB (renderer+GPU, fails above)
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const { openPhone, measure } = require('./phone-mem-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8190', HUB = process.env.HUB || 'http://127.0.0.1:8191';
const W = +(process.env.W || 1920), H = +(process.env.H || 1080), DPR = +(process.env.DPR || 1), IDLE = +(process.env.IDLE || 10);
const LEFT = ['stk_l2f_big', 'stk_l2f_dp', 'stk_fpat_l2', 'stk_l2f_lad', 'stk_darkpool', 'stk_l2f_delta'];
const RIGHT = ['ema', 'stk_of_vwap', 'stk_bk_walls', 'stk_econ', 'stk_gex', 'stk_l2f_lad', 'stk_l2f_big'];
const PINE_L = ['smt-pro-stryker'];
const PINE_R = ['smt-pro-stryker', 'ifvg-pro-stryker', 'fvg-relay-stryker', 'liquidity-master-tradezoro', 'session-sweep-smt-ifvg', 'htf-po3-lens-stryker'];
const src = (id) => fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'pine', id + '.pine'), 'utf8');

// canvas census for pages opened without phone-mem-lib (live site, desktop app)
const CENSUS = () => {
  const all = window.__cvAll = [], ce = Document.prototype.createElement;
  Document.prototype.createElement = function (t) { const el = ce.apply(this, arguments); if (String(t).toLowerCase() === 'canvas') all.push(new WeakRef(el)); return el; };
  const P = CanvasRenderingContext2D.prototype;
  for (const k of ['fill', 'stroke', 'fillRect', 'fillText', 'drawImage', 'putImageData', 'clearRect']) { const f = P[k]; P[k] = function () { if (this.canvas) this.canvas.__px = 1; return f.apply(this, arguments); }; }
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t) { const r = gc.apply(this, arguments); if (r && /webgl/.test(t)) this.__gl = true; return r; };
  try { localStorage.setItem('stryker_theme', 'night'); } catch (e) {}
};

// LIVE=https://tradezoro.com : the real site as a signed-out visitor (delayed data), no stubs, only the canvas census
async function openLive(b) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  await ctx.addInitScript(CENSUS);
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  const cdp = await ctx.newCDPSession(p);
  await p.goto(process.env.LIVE + '/charts.html', { waitUntil: 'domcontentloaded', timeout: 90000 });
  return { p, cdp, errors };
}

async function build(b) {
  const { p, cdp, errors } = process.env.LIVE ? await openLive(b) : await openPhone(b, { w: W, h: H, dpr: DPR, seed: false, base: BASE, hub: HUB, theme: process.env.THEME || 'night' });
  await setup(p);
  return { p, cdp, errors };
}

// the layout on an open charts page (also used by the desktop-app probe)
async function setup(p) {
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_PINE, null, { timeout: 180000, polling: 250 });
  await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('2h')); await p.waitForTimeout(2500);
  const plan = [[LEFT, PINE_L, 'stk_fp'], [RIGHT, PINE_R, null]];
  const nCells = await p.evaluate(() => window.STRYKER_VELA.context().cells.length);   // a phone shows one chart
  for (let i = 0; i < Math.min(2, nCells); i++) {
    await p.evaluate(async (i) => {
      const ws = window.STRYKER_VELA, c = ws.cell(ws.context().cells[i].id);
      c.setSymbol('futures:NQ1!'); c.setTimeframe('1');
      for (let k = 0; k < 150; k++) { await new Promise((r) => setTimeout(r, 200)); const o = c.chart.orchestrator; if (o.config.market.symbol === 'futures:NQ1!' && String(o.config.market.timeframe) === '1' && o.rawBars.length > 50 && !o.switchingMarket) break; }
    }, i);
    const [nat, pines, style] = plan[i];
    const r = await p.evaluate(async ([i, nat, srcs, style]) => {
      const ws = window.STRYKER_VELA, c = ws.context().cells[i].chart, bad = [];
      if (style) try { ws.cell(ws.context().cells[i].id).setPriceStyle(style); } catch (e) { bad.push('style ' + e); }
      for (const t of nat) { try { c.addNativeIndicator(t); } catch (e) { bad.push(t + ' ' + e); } }
      window.STRYKER_VELA.context().stateChanged();
      for (const s of srcs) { const r = await window.STRYKER_PINE.runOnChart(c, s, undefined, false, { engine: 'next', builtin: true }); if (!r || !r.ok) bad.push('pine ' + JSON.stringify(r && r.msg)); }
      return { n: (c.indicators() || []).length, bad };
    }, [i, nat, pines.map(src), style]);
    console.log(`chart ${i + 1}: ${r.n} indicators`, r.bad.length ? 'problems ' + r.bad.join(' | ') : '');
  }
  await p.waitForFunction(() => !document.documentElement.classList.contains('stk-pine-busy'), null, { timeout: 240000, polling: 500 }).catch(() => {});
  await p.waitForTimeout(10000);
}

// every canvas holding pixels: where it sits, CSS box vs backing store
const canvases = (p) => p.evaluate(() => {
  const cells = window.STRYKER_VELA.context().cells.map((c) => { let el = c.chart.renderer && (c.chart.renderer.renderer || c.chart.renderer).wrapper; for (let i = 0; i < 6 && el && el.parentElement; i++) { el = el.parentElement; if (el.getBoundingClientRect().width < window.innerWidth * 0.75 && el.querySelectorAll('canvas').length > 2) break; } return el; });
  const out = [];
  for (const r of window.__cvAll || []) {
    const c = r.deref(); if (!c || !c.width || !c.height || !(c.__gl || c.__px)) continue;
    const b = c.isConnected ? c.getBoundingClientRect() : { width: 0, height: 0 };
    const cell = cells.findIndex((el) => el && el.contains(c));
    const vis = c.isConnected && b.width > 0 && getComputedStyle(c).visibility !== 'hidden' && getComputedStyle(c).display !== 'none';
    out.push({ cell, dom: c.isConnected, vis, css: Math.round(b.width) + 'x' + Math.round(b.height), px: c.width + 'x' + c.height, mb: Math.round(c.width * c.height * 4 / 1048576 * 10) / 10,
      ratio: b.width ? Math.round(c.width / b.width * 100) / 100 : 0, gl: !!c.__gl, cls: (c.className || c.id || (c.parentElement && c.parentElement.className) || '').toString().slice(0, 40) });
  }
  return out.sort((a, b) => b.mb - a.mb);
});

// idle cost: rAF callbacks and 2D draw calls per second while nothing but the fixture ticks
const idle = (p, s) => p.evaluate(async (s) => {
  let raf = 0, draws = 0; const R = window.requestAnimationFrame, P = CanvasRenderingContext2D.prototype, keep = {};
  window.requestAnimationFrame = function (f) { return R.call(window, function (t) { raf++; return f(t); }); };
  for (const k of ['fillRect', 'fillText', 'stroke', 'fill', 'drawImage']) { keep[k] = P[k]; P[k] = function () { draws++; return keep[k].apply(this, arguments); }; }
  await new Promise((r) => setTimeout(r, s * 1000));
  window.requestAnimationFrame = R; Object.assign(P, keep);
  return { rafPerS: Math.round(raf / s), drawsPerS: Math.round(draws / s) };
}, s);

module.exports = { build, setup, canvases, idle, CENSUS };

if (require.main === module) (async () => {
  const b = await launch({ args: ['--enable-precise-memory-info'] });
  let fails = 0;
  try {
    const { p, cdp, errors } = await build(b);
    if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
    const m = await measure(b, p, cdp, process.pid);
    const pm = await p.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
    const cv = await canvases(p), id = await idle(p, IDLE);
    const sum = (f) => Math.round(cv.filter(f).reduce((a, x) => a + x.mb, 0));
    const res = { heap: { page: m.pageHeapMB, workers: m.workerHeapMB, total: m.totalHeapMB, perfMemory: pm, workerList: m.workersMB }, dom: m.dom, bars: m.bars,
      canvasMB: { all: sum(() => true), visible: sum((x) => x.vis), hiddenOrDetached: sum((x) => !x.vis), count: cv.length, oversized: cv.filter((x) => x.ratio > DPR * 1.05).length },
      rssMB: { renderer: Math.round(m.rss.renderer / 1024), gpu: Math.round(m.rss.gpu / 1024) }, idle: id, errors: errors.slice(0, 5) };
    console.log(JSON.stringify(res, null, 1));
    console.log('top canvases:'); cv.slice(0, 25).forEach((x) => console.log('  ' + JSON.stringify(x)));
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(Object.assign(res, { canvases: cv }), null, 1));
    if (process.env.BUDGET_MB && res.rssMB.renderer + res.rssMB.gpu > +process.env.BUDGET_MB) { fails++; console.log('FAIL renderer+GPU over budget'); }
  } finally { await b.close(); }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
