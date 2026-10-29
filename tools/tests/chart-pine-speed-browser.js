// Pine engine speed harness (job "indicator engine speed 1030"). Recorded NQ candles, nothing live.
//   node tools/tests/chart-dev-server.mjs 8103 &
//   CHART_BASE=http://127.0.0.1:8103 flock /tmp/stryker-chrome.lock node tools/tests/chart-pine-speed-browser.js <outJson> [shotsDir]
// env: PS_TF=1|5 (default 1), PS_V=0.6|0.9 (default 0.6), PS_CASES="alone,3,6" , PS_TARGET=cisd-model-plus-triton, PS_W=1440|390
// For each case: add N "other" scripts one after another (each waits for its first draw), then the target.
// Measures: target add -> first draw, whether it was accepted, others still drawing, worker message counts per
// kind per second (re-run frequency), main-thread long tasks during the add, heap, worker count.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8103';
const OUT = process.argv[2] || '/tmp/pine-speed.json';
const SHOTS = process.argv[3] || '';
const TF = Number(process.env.PS_TF || 1), V09 = process.env.PS_V === '0.9', W = Number(process.env.PS_W || 1440);
const TARGET = process.env.PS_TARGET || 'cisd-model-plus-triton';
const CASES = (process.env.PS_CASES || 'alone,3,6').split(',');
// heavy-ish popular scripts (Editors' picks + community), added as the "other indicators"
const OTHERS = (process.env.PS_OTHERS || 'liquidity-master-tradezoro,session-sweep-smt-ifvg,smt-pro-stryker,ict-pro-plus-timmynq,wcsmc-sp,htf-po3-lens-stryker,ifvg-pro-stryker,fvg-relay-stryker').split(',');
const FIX = path.join(__dirname, 'fixtures/orderflow');
const NOW = Date.UTC(2026, 9, 21, 20, 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let CAND = null;
async function candles(tf) {
  if (!CAND) {
    const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js'));
    const bars = [].concat(...['2026-10-20', '2026-10-21'].map((d) => D.decodeOrderflow(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'NQ-' + d + '.bin.gz'))))).bars));
    CAND = { D, bars };
  }
  return CAND.D.aggregate(CAND.bars, tf * 60000).filter((b) => b.t < NOW).map((b) => [b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]);
}
async function open(b) {
  const ctx = await b.newContext({ viewport: { width: W, height: W > 600 ? 900 : 800 }, deviceScaleFactor: 1, isMobile: W < 600, hasTouch: W < 600 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([now]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1');
      localStorage.removeItem('stryker.vela.session'); localStorage.removeItem('vela-workspace'); localStorage.removeItem('vela-workspace-090'); } catch (e) {}
    const RealDate = Date, off = now - RealDate.now();
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
    window.Date = FakeDate;
    // instrumentation: worker count + message traffic, long tasks
    const T = window.__ps = { workers: 0, msgs: [], long: [], t0: performance.now() };
    const WP = Worker.prototype.postMessage;
    const RW = window.Worker;
    window.Worker = function (...a) { const w = new RW(...a); T.workers++; const id = T.workers;
      w.addEventListener('message', (e) => { const d = e.data || {}; if (d.kind === 'model' || d.kind === 'done' || d.kind === 'error') T.msgs.push([Math.round(performance.now()), 'w' + id, d.kind, d.sessionId]); else if (d.type) T.msgs.push([Math.round(performance.now()), 'w' + id, d.type, d.sessionId || d.id]); });
      const pm = w.postMessage.bind(w);
      w.postMessage = (m, ...r) => { if (m && m.kind) T.msgs.push([Math.round(performance.now()), 'w' + id, '>' + m.kind, m.sessionId]); else if (m && m.type) T.msgs.push([Math.round(performance.now()), 'w' + id, '>' + m.type, m.sessionId || m.id]); return pm(m, ...r); };
      return w; };
    window.Worker.prototype = RW.prototype;
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => T.long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  }, [NOW]);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, async (r) => {
    const u = new URL(r.request().url());
    const tf = Number(u.searchParams.get('tf')) || 1, page = Number(u.searchParams.get('page')) || 0;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: String(tf), page, bars: await candles(tf) }) });
  });
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/stream/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|\/api\/chart\/stream|firebase|firestore|CORS|WebSocket/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  await p.goto(BASE + '/charts.html?vela=' + (V09 ? '0.9' : '0.6'), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 90000 });
  await sleep(1500);
  await p.evaluate(async (tf) => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe(String(tf));
    const c = ws.chart;
    for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 250)); if (c.market.symbol === 'futures:NQ1!' && c.market.timeframe === String(tf) && c.orchestrator.rawBars.length > 50 && c.orchestrator.historyState !== 'backfill') break; }
  }, TF);
  await sleep(1500);
  return { ctx, p, errors };
}
// add a built-in/community script by id through the same path the Indicators window uses
const ADD = `async (id) => {
  const M = await import('/assets/chart-pine-builtins.js');
  const b = M.PICKER_SCRIPTS.find((x) => x.id === id); if (!b) return { ok: false, msg: 'unknown ' + id };
  const src = await M.builtinSource(id);
  const P = window.STRYKER_PINE, chart = window.STRYKER_VELA.chart;
  const n0 = P.pineHandles(chart).length, t0 = performance.now();
  const r = await P.addSource(b.name, src, { engine: 'next', builtin: true });
  const t1 = performance.now();
  // first draw = a model with content on the new handle
  let drawn = null;
  if (r.ok) {
    for (let i = 0; i < 400; i++) {
      const hs = P.pineHandles(chart), h = hs[hs.length - 1];
      const rec = h && [...chart.orchestrator.registry.all()].find((q) => q.model && q.model.id === h.id);
      const m = rec && rec.model;
      if (m && ((m.lines||[]).length + (m.labels||[]).length + (m.boxes||[]).length + (m.plots||[]).length + (m.tables||[]).length + (m.polylines||[]).length)) { drawn = Math.round(performance.now() - t0); break; }
      await new Promise((q) => setTimeout(q, 50));
    }
  }
  return { id, ok: r.ok, msg: r.msg || '', addMs: Math.round(t1 - t0), drawMs: drawn, n: P.pineHandles(chart).length - n0 };
}`;
const STATE = `() => { const P = window.STRYKER_PINE, chart = window.STRYKER_VELA.chart;
  const hs = P.pineHandles(chart); const recs = [...chart.orchestrator.registry.all()];
  return { handles: hs.length, drawing: hs.map((h) => { const r = recs.find((q) => q.model && q.model.id === h.id); const m = r && r.model; return [P.titleOf(h), m ? (m.lines||[]).length + (m.labels||[]).length + (m.boxes||[]).length + (m.plots||[]).length + (m.tables||[]).length : -1]; }),
    workers: window.__ps.workers, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, bars: chart.orchestrator.rawBars.length }; }`;
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  const results = [];
  try {
    for (const cs of CASES) {
      const n = cs === 'alone' ? 0 : Number(cs);
      console.log('open', cs); const { ctx, p, errors } = await open(b); console.log('opened');
      const row = { case: cs, tf: TF, vela: V09 ? '0.9' : '0.6', w: W, others: [] };
      for (const id of OTHERS.slice(0, n)) { const o = await p.evaluate(eval(ADD), id); console.log('other', JSON.stringify(o)); row.others.push(o); }
      await sleep(2500);
      const idle0 = await p.evaluate(() => window.__ps.msgs.length);
      const tIdle = Date.now(); await sleep(8000);   // idle re-run traffic with n others, before the target
      const idleMsgs = await p.evaluate((i) => window.__ps.msgs.slice(i), idle0);
      row.idleModelsPer10s = Math.round(idleMsgs.filter((m) => m[2] === 'model').length * 10 / ((Date.now() - tIdle) / 1000));
      row.idleRunsPer10s = Math.round(idleMsgs.filter((m) => /^>(notifyBars|execute|update)/.test(m[2])).length * 10 / ((Date.now() - tIdle) / 1000));
      const m0 = await p.evaluate(() => ({ i: window.__ps.msgs.length, l: window.__ps.long.length, t: Math.round(performance.now()) }));
      console.log('adding target'); const t = await p.evaluate(eval(ADD), TARGET); console.log('target', JSON.stringify(t));
      row.target = t;
      await sleep(3000);
      const after = await p.evaluate((m0) => ({ long: window.__ps.long.slice(m0.l), msgs: window.__ps.msgs.slice(m0.i) }), m0);
      row.longTasksDuringAdd = after.long.filter((x) => x[0] >= m0.t).map((x) => x[1]);
      row.maxLongMs = Math.max(0, ...row.longTasksDuringAdd);
      row.modelsDuringAddAndAfter3s = after.msgs.filter((m) => m[2] === 'model').length;
      row.state = await p.evaluate(eval(STATE));
      // steady-state: re-run traffic over 10 s with everything on
      const s0 = await p.evaluate(() => window.__ps.msgs.length); await sleep(10000);
      const st = await p.evaluate((i) => window.__ps.msgs.slice(i), s0);
      row.steady10s = { models: st.filter((m) => m[2] === 'model').length, runs: st.filter((m) => /^>(notifyBars|execute|update)/.test(m[2])).length };
      row.errors = errors.slice(0, 5);
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `speed-${V09 ? 'v09' : 'v06'}-tf${TF}-${W}-${cs}.png`) });
      console.log(JSON.stringify(row));
      results.push(row);
      await ctx.close();
    }
  } catch (e) { console.log('FAIL exception ' + (e && e.stack || e)); }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  await b.close();
})();
