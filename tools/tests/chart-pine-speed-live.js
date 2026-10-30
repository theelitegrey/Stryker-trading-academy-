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
const BASE = process.env.CHART_BASE || 'https://tradezoro.com';
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
let CAND = null; const NET = { n: 0, urls: [] };
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
  await ctx.addInitScript(([now]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1');
      localStorage.removeItem('stryker.vela.session'); localStorage.removeItem('vela-workspace'); localStorage.removeItem('vela-workspace-090'); } catch (e) {}
    // instrumentation: worker count + message traffic, long tasks
    window.__psDebug = true; const T = window.__ps = { workers: 0, msgs: [], long: [], t0: performance.now() };
    const WP = Worker.prototype.postMessage;
    const RW = window.Worker;
    window.Worker = function (...a) { const w = new RW(...a); T.workers++; const id = T.workers;
      w.addEventListener('message', (e) => { const d = e.data || {}; if (d.kind === 'model' || d.kind === 'done' || d.kind === 'error' || d.kind === 'started' || d.kind === 'own') T.msgs.push([Math.round(performance.now()), 'w' + id, d.kind, d.sessionId]); else if (d.type) T.msgs.push([Math.round(performance.now()), 'w' + id, d.type, d.sessionId || d.id]); });
      const pm = w.postMessage.bind(w);
      w.postMessage = (m, ...r) => { if (m && m.kind) T.msgs.push([Math.round(performance.now()), 'w' + id, '>' + m.kind, m.sessionId]); else if (m && m.type) T.msgs.push([Math.round(performance.now()), 'w' + id, '>' + m.type, m.sessionId || m.id]); return pm(m, ...r); };
      return w; };
    window.Worker.prototype = RW.prototype;
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => T.long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  }, [NOW]);
  if (process.env.NOCACHE) await ctx.route(/assets\/chart-pine-next\.js/, async (r) => { const resp = await r.fetch(); let t = await resp.text(); const n = t.length; t = t.replace('return this.seriesCache.get(m.symbol, m.timeframe, range, (sy, tf, r) => s.req.fetchSeries(sy, tf, r), base);', 'return s.req.fetchSeries(m.symbol, m.timeframe, range);'); if (t.length === n) console.log('NOCACHE PATCH MISSED'); r.fulfill({ response: resp, body: t }); });
  const p = await ctx.newPage();
  if (process.env.PS_CPU) { const cd = await ctx.newCDPSession(p); await cd.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.PS_CPU) }); }
  if (process.env.PS_LAT) { const cd2 = await ctx.newCDPSession(p); await cd2.send('Network.enable'); await cd2.send('Network.emulateNetworkConditions', { offline: false, latency: Number(process.env.PS_LAT), downloadThroughput: 1.5e6 / 8 * 8, uploadThroughput: 750e3, connectionType: 'cellular4g' }); }
  const errors = []; p.on('request', (q) => { const u = q.url(); if (/\/api\/chart\/bars\//.test(u)) { NET.n++; NET.urls.push(u.replace(/^.*\/api\/chart\/bars\//, '').slice(0, 40)); } });
  p.on('console', (m) => { if (/exceeds|timed out|too long/i.test(m.text())) NET.warn = (NET.warn||[]).concat(m.text().slice(0,120)); });
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
  const chart = window.STRYKER_VELA.chart, P = window.STRYKER_PINE; const t0 = performance.now(); const ev = [];
  const S = (x) => { window.__ps.step = x; ev.push(x + '@' + Math.round(performance.now() - t0)); };
  if (!chart.__psWrap) { chart.__psWrap = 1; const orig = chart.addIndicator.bind(chart); chart.addIndicator = (src, opt) => { S('addIndicator ' + opt.language); const h = orig(src, opt); try { h.on('ready', () => S('ready')); h.on('error', (e) => S('error ' + String(e && e.error && e.error.message || e).slice(0, 100))); } catch (e) {} return h; }; }
  const M = await import('/assets/chart-pine-builtins.js');
  const b = M.PICKER_SCRIPTS.find((x) => x.id === id); if (!b) return { ok: false, msg: 'unknown ' + id };
  const src = await M.builtinSource(id);
  const n0 = P.pineHandles(chart).length;
  let r = null; S('call addSource');
  P.addSource(b.name, src, { engine: 'next', builtin: true }).then((x) => { r = x; S('added ' + x.ok); }, (e) => { r = { ok: false, msg: 'EXC ' + e }; });
  for (let i = 0; i < 1500 && !r; i++) await new Promise((q) => setTimeout(q, 100));
  if (!r) return { id, ok: false, msg: 'addSource never returned', ev };
  let drawn = null;
  if (r.ok) {
    for (let i = 0; i < 1200; i++) {
      const hs = P.pineHandles(chart), h = hs[hs.length - 1];
      const rec = h && [...chart.orchestrator.registry.all()].find((q) => q.model && q.model.id === h.id);
      const m = rec && rec.model;
      if (m && ((m.lines||[]).length + (m.labels||[]).length + (m.boxes||[]).length + (m.series||[]).length + (m.tables||[]).length + (m.polylines||[]).length)) { drawn = Math.round(performance.now() - t0); break; }
      await new Promise((q) => setTimeout(q, 100));
    }
  }
  return { id, ok: r.ok, msg: r.msg || '', drawMs: drawn, ev, n: P.pineHandles(chart).length - n0 };
}`;
const STATE = `() => { const P = window.STRYKER_PINE, chart = window.STRYKER_VELA.chart;
  const hs = P.pineHandles(chart); const recs = [...chart.orchestrator.registry.all()];
  return { handles: hs.length, drawing: hs.map((h) => { const r = recs.find((q) => q.model && q.model.id === h.id); const m = r && r.model; return [P.titleOf(h), m ? (m.lines||[]).length + (m.labels||[]).length + (m.boxes||[]).length + (m.plots||[]).length + (m.tables||[]).length : -1]; }),
    workers: window.__ps.workers, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, bars: chart.orchestrator.rawBars.length }; }`;
async function addId(p, id, limitMs) {
  // exactly the probe3 flow (known to work), parametrised; the drawn-model poll is a second evaluate
  const t0 = Date.now();
  const o = await p.evaluate(async ([id]) => {
    const o = { ev: [] }; const chart = window.STRYKER_VELA.chart; const t0 = performance.now(); const T = (x) => o.ev.push(x + '@' + Math.round(performance.now() - t0));
    window.__tStart = performance.now(); window.__readyAt = null; window.__addRes = null;
    const orig = chart.addIndicator.bind(chart); chart.addIndicator = (src, opt) => { T('addIndicator ' + opt.language); const h = orig(src, opt); try { h.on('ready', () => { T('ready'); if (window.__readyAt == null) window.__readyAt = performance.now(); }); h.on('error', (e) => T('error ' + String(e && e.error && e.error.message || e).slice(0, 120))); } catch (e) {} return h; };
    const M = await import('/assets/chart-pine-builtins.js'); const src = await M.builtinSource(id);
    const P = window.STRYKER_PINE; window.__n0 = P.pineHandles(chart).length;
    window.__p3 = P.addSource('t', src, { engine: 'next', builtin: true }).then((r) => { T('result ' + JSON.stringify(r).slice(0, 200)); window.__addRes = r; });
    window.__ev = o.ev;
    return o;
  }, [id]);
  let drawn = null;
  while (Date.now() - t0 < limitMs && drawn == null) {
    await sleep(250);
    drawn = await p.evaluate(() => { const chart = window.STRYKER_VELA.chart, P = window.STRYKER_PINE; const hs = P.pineHandles(chart); if (hs.length <= window.__n0) return null; const h = hs[hs.length - 1]; const rec = [...chart.orchestrator.registry.all()].find((q) => q.model && q.model.id === h.id); const m = rec && rec.model; return m && ((m.lines || []).length + (m.labels || []).length + (m.boxes || []).length + (m.series || []).length + (m.plots || []).length + (m.tables || []).length + (m.polylines || []).length) ? Math.round(performance.now() - window.__tStart) : null; });
  }
  const f = await p.evaluate(() => ({ ev: window.__ev, readyMs: window.__readyAt ? Math.round(window.__readyAt - window.__tStart) : null, res: window.__addRes }));
  return { id, ok: !!(f.res && f.res.ok), msg: f.res && f.res.msg || '', readyMs: f.readyMs, drawMs: drawn, ev: f.ev, n: 1 };
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  const results = [];
  try {
    for (const cs of CASES) {
      const n = cs === 'alone' ? 0 : Number(cs);
      console.log('open', cs); const { ctx, p, errors } = await open(b); console.log('opened');
      const row = { case: cs, cpu: process.env.PS_CPU || 1, tf: TF, vela: V09 ? '0.9' : '0.6', w: W, others: [] };
      for (const id of OTHERS.slice(0, n)) { const o = await addId(p, id, Number(process.env.PS_LIM||150000)); console.log('other', JSON.stringify(o)); row.others.push(o); }
      if (n) await sleep(2500);
      const idle0 = await p.evaluate(() => window.__ps.msgs.length);
      const tIdle = Date.now(); if (n) await sleep(8000); else await sleep(50);   // idle re-run traffic with n others, before the target
      const idleMsgs = await p.evaluate((i) => window.__ps.msgs.slice(i), idle0);
      row.idleModelsPer10s = Math.round(idleMsgs.filter((m) => m[2] === 'model').length * 10 / ((Date.now() - tIdle) / 1000));
      row.idleRunsPer10s = Math.round(idleMsgs.filter((m) => /^>(notifyBars|execute|update)/.test(m[2])).length * 10 / ((Date.now() - tIdle) / 1000));
      row.netFetchesOthers = NET.n; NET.n = 0; NET.urls = [];
      const m0 = await p.evaluate(() => ({ i: window.__ps.msgs.length, l: window.__ps.long.length, t: Math.round(performance.now()) }));
      if (process.env.PS_PROBE) { const pr = await p.evaluate(async () => { const o = {}; for (const u of ['https://cdn.jsdelivr.net/npm/@luxalgo/vela-pinets@0.2.11/dist/index.js', 'https://cdn.jsdelivr.net/npm/pinets@0.11.0/dist/pinets.min.browser.es.js']) { const t = performance.now(); try { const r = await Promise.race([fetch(u), new Promise((_, j) => setTimeout(() => j(new Error('15s timeout')), 15000))]); o[u.slice(30, 60)] = r.status + ' ' + Math.round(performance.now() - t) + 'ms'; } catch (e) { o[u.slice(30, 60)] = String(e).slice(0, 80); } } o.next = await Promise.race([import('/assets/chart-pine-next.js?v=731').then(() => 'ok', (e) => String(e).slice(0, 80)), new Promise((r) => setTimeout(() => r('timeout'), 10000))]); return o; }); console.log('PROBE', JSON.stringify(pr)); }
      if (process.env.PS_PROBE2) { const pr = await p.evaluate(async () => { const o = {}; const chart = window.STRYKER_VELA.chart; const ai = chart.addIndicator.bind(chart); chart.addIndicator = (...a) => { o.addInd = 'called'; return ai(...a); };
        const M = await import('/assets/chart-pine-builtins.js'); const src = await M.builtinSource('cisd-model-plus-triton'); o.len = src.length;
        const P = window.STRYKER_PINE; const t = performance.now();
        const r = await Promise.race([P.addSource('t', 'indicator("x", overlay=true)\nplot(close)', { engine: 'next', builtin: true }), new Promise((q) => setTimeout(() => q('tiny timeout'), 20000))]);
        o.tiny = typeof r === 'string' ? r : JSON.stringify(r) + ' ' + Math.round(performance.now() - t) + 'ms'; o.workers = window.__ps.workers; return o; }); console.log('PROBE2', JSON.stringify(pr)); }
      if (process.env.PS_PROBE3) { const pr = await p.evaluate(async () => { const o = { ev: [] }; const chart = window.STRYKER_VELA.chart; const t0 = performance.now(); const T = (x) => o.ev.push(x + '@' + Math.round(performance.now() - t0));
        const orig = chart.addIndicator.bind(chart); chart.addIndicator = (src, opt) => { T('addIndicator ' + opt.language); const h = orig(src, opt); try { h.on('ready', () => T('ready')); h.on('error', (e) => T('error ' + String(e && e.error && e.error.message || e).slice(0, 120))); } catch (e) {} return h; };
        const M = await import('/assets/chart-pine-builtins.js'); const src = await M.builtinSource('cisd-model-plus-triton');
        const P = window.STRYKER_PINE; window.__p3 = P.addSource('t', src, { engine: 'next', builtin: true }).then((r) => { T('result ' + JSON.stringify(r).slice(0, 200)); });
        await new Promise((q) => setTimeout(q, 25000)); o.workers = window.__ps.workers; o.lastMsgs = window.__ps.msgs.slice(-8); return o; }); console.log('PROBE3', JSON.stringify(pr)); }
      console.log('adding target'); const tw = setInterval(async () => { try { const st = await Promise.race([p.evaluate(() => ({ t: Math.round(performance.now()), long: window.__ps.long.slice(-3), msgs: window.__ps.msgs.slice(-6), workers: window.__ps.workers, step: window.__ps.step, hand: window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.chart).length, hs: window.STRYKER_VELA.chart.orchestrator.historyState })), sleep(4000).then(() => 'PAGE UNRESPONSIVE')]); console.log('  ..', JSON.stringify(st).slice(0, 500)); } catch (e) { console.log('  .. err', String(e).slice(0, 100)); } }, 10000);
      const t = await addId(p, TARGET, Number(process.env.PS_LIM||150000)); clearInterval(tw);
      row.secLog = await p.evaluate(() => (window.__secLog || []).slice(0, 60)); row.cacheStats = await p.evaluate(() => { try { return window.STRYKER_PINE && window.__pineEng ? window.__pineEng.seriesCache.stats : null; } catch (e) { return null; } });
      row.target = t; row.netFetches = NET.n; row.warn = NET.warn; row.netUrls = NET.urls.slice(0, 40);
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
      row.errors = errors.slice(0, 5); row.clock = await p.evaluate(() => window.__ps.msgs.filter((m) => m[2] === 'started' || m[2] === 'own' || m[2] === '>execute').slice(-30));
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `speed-${V09 ? 'v09' : 'v06'}-tf${TF}-${W}-${cs}.png`) });
      console.log(JSON.stringify(row));
      results.push(row);
      await ctx.close();
    }
  } catch (e) { console.log('FAIL exception ' + (e && e.stack || e)); }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  await b.close();
})();
