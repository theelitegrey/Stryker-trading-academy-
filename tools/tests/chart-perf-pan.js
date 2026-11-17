// Chart pan / zoom smoothness benchmark (Owner 18 Nov: "vela is smooth, ours feels jaggy while moving around").
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 tools/chrome-slot.sh node tools/tests/chart-perf-pan.js [out.json] [scenarios] [dprs]
//     scenarios: comma list of bare,member,heavy (default all three); dprs: comma list (default 1,2)
//     RUNS=n repeats each measured pass (default 2; the median run is reported). PROFILE=0 skips the profiled pass.
// Scenarios (1440x900, NQ1! 1m, the same bars everywhere):
//   bare    tools/tests/perf-bare-vela.html: the chart engine alone, no TradeZoro layers (the target).
//   member  charts.html as a member opens it (stock workspace: legend, bottom bar, workspace tabs, Volume) on NQ1! 1m
//           with GEX Levels added.
//   heavy   member + Futures DOM Heatmap (L2, fake hub socket) + the Footprint chart type.
//   fp / hm the two halves of heavy on their own (Footprint chart type only / DOM Heatmap only), to split the cost.
// Data: candles AND footprint come from the real recorder payloads in fixtures/orderflow (NQ 20-21 Oct 2026), shifted so
// the last minute is "now"; GEX levels from fixtures/gex/QQQ-0.json moved onto those prices. No live network.
// Per pass: 5 s continuous drag-pan (page.mouse, left button), then 3 s wheel zoom (in/out). A rAF logger in the page
// gives frame times (p50/p95/p99, dropped = intervals over 1.5 frames, counted in missed vsyncs) and a PerformanceObserver
// gives long tasks. A second, profiled pass (CDP Profiler) gives the top self-time functions by file:function; the
// profiler slows the page, so frame numbers come from the unprofiled passes only.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUTF = process.argv[2] || '';
const SCEN = (process.argv[3] || 'bare,member,heavy').split(',');
const DPRS = (process.argv[4] || '1,2').split(',').map(Number);
const RUNS = +(process.env.RUNS || 2);
const PROFILE = process.env.PROFILE !== '0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIX = path.join(__dirname, 'fixtures');

// ---- data: two recorded NQ days, re-stamped to end at the current minute ------------------------------------------
const readUv = (b, i) => { let x = 0, s = 1, c; do { c = b[i++]; x += (c & 127) * s; s *= 128; } while (c & 128); return [x, i]; };
const uv = (x) => { const o = []; do { let c = x % 128; x = Math.floor(x / 128); if (x) c |= 128; o.push(c); } while (x); return o; };
function records(u8) {   // header bytes + one {t, rest} per bar (see decodeOrderflow in assets/chart-footprint-data.js)
  let i = 4, hl, cnt; [hl, i] = readUv(u8, i); const head = u8.subarray(0, i + hl); i += hl; [cnt, i] = readUv(u8, i);
  const out = [];
  for (let k = 0; k < cnt; k++) { let len, t; [len, i] = readUv(u8, i); const end = i + len; const j = i; [t, i] = readUv(u8, j); out.push({ t, rest: u8.subarray(i, end) }); i = end; }
  return { head, recs: out };
}
const days = ['NQ-2026-10-20', 'NQ-2026-10-21'].map((f) => records(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'orderflow', f + '.bin.gz'))))));
const HEAD = days[0].head;
const ALL = days[0].recs.concat(days[1].recs);
const NOW_MIN = Math.floor(Date.now() / 60000);
const SHIFT = NOW_MIN - 1 - ALL[ALL.length - 1].t;   // minutes
const REC = ALL.map((r) => ({ t: r.t + SHIFT, rest: r.rest }));
function encodeDay(day) {   // the recorder's /orderflow body for one UTC day
  const d0 = Date.parse(day + 'T00:00:00Z') / 60000, sel = REC.filter((r) => r.t >= d0 && r.t < d0 + 1440);
  const parts = [Buffer.from(HEAD), Buffer.from(uv(sel.length))];
  for (const r of sel) { const t = uv(r.t); parts.push(Buffer.from(uv(t.length + r.rest.length)), Buffer.from(t), Buffer.from(r.rest)); }
  return Buffer.concat(parts);
}
let CANDLES = null, LAST = 0;
async function candles() {
  if (CANDLES) return CANDLES;
  const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js'));
  const bars = [];
  for (const day of [...new Set(REC.map((r) => new Date(r.t * 60000).toISOString().slice(0, 10)))]) bars.push(...D.decodeOrderflow(new Uint8Array(encodeDay(day))).bars);
  CANDLES = bars.map((b) => [b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]);
  LAST = CANDLES[CANDLES.length - 1][4];
  return CANDLES;
}
function gexBody() {
  const j = JSON.parse(fs.readFileSync(path.join(FIX, 'gex', 'QQQ-0.json'), 'utf8'));
  const now = Date.now() / 1000;
  for (const k of ['NQ', 'MNQ']) {
    const f = j.futures[k], d = LAST - (f.futures_price != null ? f.futures_price : f.levels.spot);
    for (const n of Object.keys(f.levels)) if (typeof f.levels[n] === 'number') f.levels[n] = Math.round((f.levels[n] + d) * 4) / 4;
    f.futures_price = LAST; f.futures_ts = Math.floor(now - 60);
  }
  Object.assign(j.market, { state: 'open', futures: 'open', options: 'open', now, futures_ts: Math.floor(now - 60), options_ts: Math.floor(now - 90), data_ts: Math.floor(now - 60) });
  return JSON.stringify(j);
}

// ---- the fake L2 hub (same shapes as tools/tests/heatmap-gl-browser.js) -------------------------------------------
function fakeWs() {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    let n = 0;
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage && ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) }); }, 50);
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage) return;
      n++;
      const mid = Math.round((window.__L2MID || 21000) * 4) / 4 + Math.sin(n / 9) * 3, now = Date.now();
      const step = 2.5, i0 = Math.floor(mid * 0.996 / step), len = Math.ceil(mid * 0.008 / step) + 2, v = new Array(len).fill(0);
      for (let k = 0; k < len; k++) { const p = (i0 + k + 0.5) * step, d = Math.abs(p - mid); let q = 30 + 25 * Math.abs(Math.sin(k * 1.7 + n / 40)) + Math.max(0, 200 - d * 4); if (Math.abs(d - 14) < 1.1) q += 900; v[k] = p < mid ? Math.round(q) : -Math.round(q); }
      const bid = Math.floor(mid * 4) / 4, ask = bid + 0.25, bids = [], asks = [];
      for (let j = 0; j < 150; j++) { bids.push([bid - j * 0.25, Math.round(5 + 40 * Math.abs(Math.sin(j / 3 + n / 20)))]); asks.push([ask + j * 0.25, Math.round(5 + 40 * Math.abs(Math.cos(j / 3 + n / 25)))]); }
      const send = (o) => ws.onmessage({ data: JSON.stringify(o) });
      send({ type: 'snap', symbol: 'NQ', ts: now, bids, asks, imb: 0, imb10: 0 });
      send({ type: 'coarse', symbol: 'NQ', ts: now, mid, bb: bid, ba: ask, step, i0, v });
      send({ type: 'ticks', symbol: 'NQ', t: [[bid, 1 + (n % 7), -1, now], [ask, 2 + (n % 5), 1, now]] });
    }, 100);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}

async function open(b, scen, dpr) {
  await candles();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
  if (scen !== 'bare') {
    await ctx.addInitScript(stub);
    await ctx.addInitScript(() => { try { for (const k of ['stryker_install_prompt_shown_u1', 'stryker_push_prompt_shown_u1', 'stryker_community_disclaimer_ack_v1']) localStorage.setItem(k, '1'); localStorage.setItem('stryker.vela.session', ''); } catch (e) {} });
    if (scen === 'heavy' || scen === 'hm') await ctx.addInitScript(fakeWs);
    await ctx.addInitScript((mid) => { window.__L2MID = mid; }, LAST);
  }
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/\/api\/chart\/bars\//, (r) => {
    const u = new URL(r.request().url()), tf = u.searchParams.get('tf') || '1', page = Number(u.searchParams.get('page')) || 0;
    if (!/NQ/.test(u.pathname) || tf !== '1') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'X', tf, page, bars: [] }) });
    const P = 8 * 3600, bars = page ? CANDLES.filter((x) => Math.floor(x[0] / P) === page) : CANDLES;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf, page, bars }) });
  });
  await ctx.route(/\/api\/gex\/levels\//, (r) => (/\/QQQ|\/NDX|\/NQ/i.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'application/json', body: gexBody() }) : r.fulfill({ status: 404, contentType: 'application/json', body: '{}' })));
  await ctx.route(/127\.0\.0\.1:9\//, async (r) => {
    const u = new URL(r.request().url());
    if (!/ts-book-history/.test(u.pathname)) return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
    const { encodeSamples } = await import('../../workers/book-recorder/src/bucket.js');
    const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to')), out = [];
    for (let t = Math.ceil(from / 120000) * 120000; t < to; t += 120000) {
      const c = CANDLES.find((x) => x[0] * 1000 >= t) || CANDLES[CANDLES.length - 1], mid = c[4], step = 2.5, i0 = Math.floor(mid * 0.98 / step), len = Math.ceil(mid * 0.04 / step) + 2, v = new Float32Array(len);
      for (let k = 0; k < len; k++) { const p = (i0 + k + 0.5) * step, d = Math.abs(p - mid), hh = Math.abs(Math.sin((i0 + k) * 12.9898) * 43758.5453) % 1; let q = Math.exp(1.2 + 2.4 * hh * hh) * (1 + 1.5 * Math.exp(-d / 120)); if (hh > 0.985) q *= 14; v[k] = p < mid ? q : -q; }
      out.push({ ts: t, mid, bb: mid - 0.25, ba: mid + 0.25, step, i0, v });
    }
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'x-ts-fill-left': '0', 'access-control-expose-headers': 'x-ts-fill-left' }, body: Buffer.from(encodeSamples(out)) });
  });
  await ctx.route(/book-recorder\.[^/]+\/orderflow/, (r) => {
    const day = new URL(r.request().url()).searchParams.get('day');
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: encodeDay(day) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await p.goto(BASE + (scen === 'bare' ? '/tools/tests/perf-bare-vela.html' : '/charts.html'), { waitUntil: 'domcontentloaded' });
  if (process.env.DBG) p.on('console', (m) => console.log('CON', m.type(), m.text().slice(0, 160)));
  await p.waitForFunction((bare) => { try { const ws = window.STRYKER_VELA; return ws && (bare ? ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 20 : window.__stkHeavyReady); } catch (e) { return false; } }, scen === 'bare', { timeout: 90000 }).catch(async (e) => { console.log('boot state', await p.evaluate(() => ({ heavy: !!window.__stkHeavyReady, ws: !!window.STRYKER_VELA, fc: !!window.__stkFirstCandles }))); throw e; });
  if (scen !== 'bare') {
    await p.evaluate(async ([fp, hm]) => {
      const ws = window.STRYKER_VELA;
      ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1');
      for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 250)); const c = ws.chart; if (c.market.symbol === 'futures:NQ1!' && c.market.timeframe === '1' && c.orchestrator.rawBars.length > 300) break; }
      ws.chart.addNativeIndicator('stk_gex', {});
      if (hm) ws.chart.addNativeIndicator('stk_fut_dom', {});
      if (fp) ws.active.setPriceStyle('stk_fp');
      try { ws.context().stateChanged(); } catch (e) {}
    }, [scen === 'heavy' || scen === 'fp', scen === 'heavy' || scen === 'hm']);
  }
  await sleep(scen === 'bare' ? 3000 : 9000);   // indicators fetch + first paint, history pager settles
  // Frame the newest ~3 h (180 bars at 1440) so every scenario pans the same span.
  await p.evaluate(() => { const ws = window.STRYKER_VELA, c = ws.cell(ws.active.id).chart, now = Date.now(); c.setVisibleRange({ from: now - 3 * 3600000, to: now }); });
  await sleep(2500);
  return { ctx, p, errors };
}

const INSTR = () => {
  window.__perf = { on: false, ft: [], lt: [] };
  let last = 0;
  const loop = (t) => { if (window.__perf.on) { if (last) window.__perf.ft.push(t - last); last = t; } else last = 0; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => { if (window.__perf.on) for (const e of l.getEntries()) window.__perf.lt.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false }); } catch (e) {}
};
async function plotBox(p) {
  return p.evaluate(() => { const ws = window.STRYKER_VELA, host = ws.cell(ws.active.id).host || document.querySelector('.vela-cell') || document.getElementById('vela-chart'); const c = [...host.querySelectorAll('canvas')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
}
async function metrics(p) {
  if (!p.__cdp) { p.__cdp = await p.context().newCDPSession(p); await p.__cdp.send('Performance.enable'); }
  return Object.fromEntries((await p.__cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
}
async function drive(p, box) {
  const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.5;
  const res = {};
  for (const [kind, ms] of [['pan', 5000], ['zoom', 3000]]) {
    await p.mouse.move(cx, cy);
    await p.evaluate(() => { window.__perf.ft = []; window.__perf.lt = []; window.__perf.on = true; });
    const m0 = await metrics(p);
    const t0 = Date.now();
    if (kind === 'pan') {
      await p.mouse.down();
      let k = 0;   // a slow back-and-forth sweep, ~8 px per move, like a hand dragging
      while (Date.now() - t0 < ms) { k++; const x = cx + Math.sin(k / 40) * box.w * 0.3, y = cy + Math.sin(k / 23) * 30; await p.mouse.move(x, y); }
      await p.mouse.up();
    } else {
      let k = 0;
      while (Date.now() - t0 < ms) { k++; await p.mouse.wheel(0, (Math.floor(k / 20) % 2 ? 1 : -1) * 60); await sleep(16); }
    }
    await sleep(300);
    const r = await p.evaluate(() => { window.__perf.on = false; return { ft: window.__perf.ft, lt: window.__perf.lt }; });
    const m1 = await metrics(p), secs = (Date.now() - t0) / 1000, per = (k) => Math.round((m1[k] - m0[k]) * 1000 / secs);
    res[kind] = Object.assign(stats(r.ft, r.lt), { mainMsPerSec: { task: per('TaskDuration'), script: per('ScriptDuration'), style: per('RecalcStyleDuration'), layout: per('LayoutDuration') } });
  }
  return res;
}
function pct(a, q) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1); }
function stats(ft, lt) {
  const V = 1000 / 60;
  return { frames: ft.length, p50: pct(ft, 0.5), p95: pct(ft, 0.95), p99: pct(ft, 0.99), max: ft.length ? +Math.max(...ft).toFixed(1) : null,
    dropped: ft.reduce((s, d) => s + (d > V * 1.5 ? Math.round(d / V) - 1 : 0), 0), longTasks: lt.length, longTasksOver50: lt.filter((x) => x > 50).length, longestTask: lt.length ? Math.max(...lt) : 0 };
}
function topSelf(profile, n) {
  const self = new Map(), byId = new Map(profile.nodes.map((x) => [x.id, x]));
  const dt = profile.timeDeltas, smp = profile.samples;
  let total = 0;
  for (let i = 0; i < smp.length; i++) {
    const node = byId.get(smp[i]), d = (dt[i + 1] != null ? dt[i + 1] : 0) / 1000; if (!node) continue;
    const f = node.callFrame, file = (f.url || '').replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '') || '(native)';
    const key = f.functionName === '(idle)' || f.functionName === '(program)' || f.functionName === '(garbage collector)' ? f.functionName : file + ':' + (f.functionName || '(anon)') + ':' + (f.lineNumber + 1);
    self.set(key, (self.get(key) || 0) + d); if (f.functionName !== '(idle)') total += d;
  }
  const byFile = new Map();
  for (const [k, v] of self) { if (k.startsWith('(')) continue; const f = k.split(':')[0]; byFile.set(f, (byFile.get(f) || 0) + v); }
  const r = (m) => [...m.entries()].filter(([k]) => k !== '(idle)').sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, +v.toFixed(1)]);
  return { busyMs: +total.toFixed(0), top: r(self), files: r(byFile) };
}

async function traceSummary(p, box) {
  const browser = p.context().browser();
  await browser.startTracing(p, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink.user_timing'] });
  await drive(p, box);
  const buf = await browser.stopTracing();
  const ev = JSON.parse(buf.toString()).traceEvents || [];
  const main = ev.find((e) => e.name === 'thread_name' && e.args && e.args.name === 'CrRendererMain');
  if (!main) return null;
  const own = ev.filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === 'X' && e.dur);
  // self time per event name (child events subtracted), top level by nesting on one thread
  own.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const self = new Map(), stack = [];
  for (const e of own) {
    while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts) stack.pop();
    if (stack.length) stack[stack.length - 1].kids += e.dur;
    e.kids = 0; stack.push(e);
  }
  for (const e of own) self.set(e.name, (self.get(e.name) || 0) + Math.max(0, e.dur - e.kids) / 1000);
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, +v.toFixed(0)]);
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=1024'].concat((process.env.CHROME_ARGS || '').split(' ').filter(Boolean)) });
  const out = {};
  try {
    for (const dpr of DPRS) for (const scen of SCEN) {
      const key = scen + '@' + dpr;
      const { ctx, p, errors } = await open(b, scen, dpr);
      await p.evaluate(INSTR);
      const box = await plotBox(p);
      const runs = [];
      for (let i = 0; i < RUNS; i++) runs.push(await drive(p, box));
      const med = (kind) => runs.map((r) => r[kind]).sort((x, y) => x.p95 - y.p95)[Math.floor(runs.length / 2)];
      out[key] = { pan: med('pan'), zoom: med('zoom'), runs: runs.map((r) => ({ panP95: r.pan.p95, zoomP95: r.zoom.p95 })) };
      if (PROFILE && dpr === DPRS[0]) {
        const cdp = await ctx.newCDPSession(p);
        await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
        await drive(p, box);
        const { profile } = await cdp.send('Profiler.stop');
        out[key].profile = topSelf(profile, 25);
        if (process.env.PROFILE_DIR) fs.writeFileSync(path.join(process.env.PROFILE_DIR, key + '.cpuprofile'), JSON.stringify(profile));
        // Chrome trace of one more pass: main-thread time by event (layout, style, paint, script, GC ...).
        out[key].trace = await traceSummary(p, box);
      }
      if (process.env.SHOT_DIR) await p.screenshot({ path: path.join(process.env.SHOT_DIR, 'perf-' + key + '.png') });
      out[key].errors = errors.slice(0, 5);
      const s = out[key];
      console.log(`${key.padEnd(10)} pan p50/p95/p99 ${s.pan.p50}/${s.pan.p95}/${s.pan.p99} ms drop ${s.pan.dropped}/${s.pan.frames} LT ${s.pan.longTasks} (>50: ${s.pan.longTasksOver50}, max ${s.pan.longestTask})` +
        ` | zoom ${s.zoom.p50}/${s.zoom.p95}/${s.zoom.p99} drop ${s.zoom.dropped}/${s.zoom.frames} LT ${s.zoom.longTasks} (>50: ${s.zoom.longTasksOver50})`);
      const mm = (x) => `task ${x.task} script ${x.script} style ${x.style} layout ${x.layout}`;
      console.log(`  main-thread ms per s: pan ${mm(s.pan.mainMsPerSec)} | zoom ${mm(s.zoom.mainMsPerSec)}`);
      if (s.profile) { console.log('  busy ' + s.profile.busyMs + ' ms; files: ' + s.profile.files.slice(0, 8).map(([k, v]) => k + ' ' + v).join(', ')); for (const [k, v] of s.profile.top.slice(0, 15)) console.log('   ' + String(v).padStart(7) + '  ' + k); }
      if (s.trace) console.log('  trace main-thread self ms: ' + s.trace.map(([k, v]) => k + ' ' + v).join(', '));
      if (errors.length) console.log('  pageerrors: ' + errors.slice(0, 3).join(' | '));
      await ctx.close();
    }
  } finally { await b.close(); }
  if (OUTF) fs.writeFileSync(OUTF, JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
