// Shared rig for the phone chart memory test (chart-phone-memory-browser.js) and its probe runs.
// Opens charts.html at phone size with member Neon's saved layout (09 Nov bug report: CME:NQ1! 1m, two big community
// Pine scripts on the next engine, absorption + big trades + GEX levels) restored from the local save, on the signed-in
// tick-engine lane (fixture hub tools/tests/tick-engine-hub.py, ?engine=1 + _rtSetForTests), fixture bars for the old
// source (60 days of 1m). No network beyond 127.0.0.1 and cdn.jsdelivr.net (the pinned Pine runtime).
// Memory: page JS heap (CDP Runtime.getHeapUsage), every dedicated worker's JS heap (Target attach), DOM counters,
// and the renderer process RSS from /proc (holds the canvases in headless software mode).
const fs = require('fs');
const path = require('path');
const stub = require('./richstub.js');
const DAY = 864e5;
const V = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'version.json'), 'utf8')).build;
const PAGE = { 1: 8 * 3600, 5: 2 * 86400, 15: 5 * 86400 };

// fixture old source: one bar per step back 60 days (same as chart-history-gap2-browser.js)
function fixturePage(url) {
  const tf = +/tf=(\d+)/.exec(url)[1], ps = PAGE[tf], step = tf * 60, now = Math.floor(Date.now() / 1000);
  const m = /page=(\d+)/.exec(url), page = m ? +m[1] : Math.floor(now / ps);
  const rows = [];
  let p = 21000 + (page % 97) * 3;
  for (let t = page * ps; t < (page + 1) * ps && t <= now - 600; t += step) if (t > now - 60 * 86400) { const o = p; p += Math.sin(t / 3700) * 4 + Math.sin(t / 611) * 2; rows.push([t, o, Math.max(o, p) + 2, Math.min(o, p) - 2, p, 777]); }
  return JSON.stringify({ s: 'NQ', tf: String(tf), page, bars: rows, rt: true });
}

// Neon's layout state (the CoS's read-only copy; layout only, no user data). NEON_LAYOUT overrides the path.
function neonState() {
  const f = process.env.NEON_LAYOUT || path.join(__dirname, 'fixtures', 'neon-layout-state.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  return typeof j.state === 'string' ? j.state : JSON.stringify(j);
}

async function openPhone(b, opts) {
  const o = Object.assign({ w: 390, h: 844, dpr: 3, hub: 'http://127.0.0.1:8091', base: 'http://127.0.0.1:8090', theme: 'night', seed: true, throttle: 0, url: '/charts.html?engine=1' }, opts || {});
  const ctx = await b.newContext({ viewport: { width: o.w, height: o.h }, deviceScaleFactor: o.dpr, isMobile: o.w <= 700, hasTouch: o.w <= 700,
    userAgent: o.w <= 700 ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' : undefined });
  await ctx.addInitScript(stub);
  const st = o.seed ? neonState() : null;
  await ctx.addInitScript(([h, th, st, key]) => {
    window.__STK_BOOK_RECORDER = h;
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', th);
      if (st && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); localStorage.setItem(key, st); }
    } catch (e) {}
  }, [o.hub, o.theme, st, o.key || 'vela-workspace-090']);
  // canvas census: every canvas made (in the DOM or not) and whether its pixel memory was touched (a real 2D call or a GL context)
  await ctx.addInitScript(() => {
    const all = window.__cvAll = [];
    const ce = Document.prototype.createElement;
    Document.prototype.createElement = function (t) { const el = ce.apply(this, arguments); if (String(t).toLowerCase() === 'canvas') all.push(new WeakRef(el)); return el; };
    const P = CanvasRenderingContext2D.prototype;
    for (const k of ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage', 'putImageData', 'clearRect', 'setTransform', 'getImageData']) {
      const f = P[k]; const draw = !/clearRect|setTransform|getImageData/.test(k);
      if (typeof f === 'function') P[k] = function () { const c = this.canvas; if (c) { c.__px = c.width * c.height; if (draw) c.__ink = (c.__ink || 0) + 1; else c.__clr = (c.__clr || 0) + 1; } return f.apply(this, arguments); };
    }
    const gc = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t) { const r = gc.apply(this, arguments); if (r) this.__ctx = true; if (r && /webgl/.test(t)) this.__gl = true; return r; };
    window.__cvCensus = () => {
      let made = 0, live = 0, nominal = 0, touched = 0, inDom = 0, gl = 0, withCtx = 0;
      for (const r of all) { const c = r.deref(); made++; if (!c) continue; live++; const px = c.width * c.height; nominal += px; if (c.isConnected) inDom++; if (c.__ctx) withCtx += px; if (c.__gl) { gl++; touched += px; } else if (c.__px) touched += px; }
      return { made, live, inDom, gl, nominalMB: Math.round(nominal * 4 / 1048576), ctxMB: Math.round(withCtx * 4 / 1048576), touchedMB: Math.round(touched * 4 / 1048576) };
    };
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/\/api\/chart\/bars\/[A-Z0-9%!]+\?tf=(1|5|15)(&|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: fixturePage(r.request().url()) }));
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  const cdp = await ctx.newCDPSession(p);
  if (o.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.throttle });
  await cdp.send('Performance.enable');
  const t0 = Date.now();
  await p.goto(o.base + o.url, { waitUntil: 'domcontentloaded' });
  // signed-in live lane (same as chart-history-gap2-browser.js): every bars request waits for this answer
  await p.evaluate(async (v) => { (await import('/assets/rt-access.js?v=' + v))._rtSetForTests(true, 'test-token'); }, V);
  return { ctx, p, cdp, errors, t0 };
}

// every dedicated worker's JS heap, through the browser CDP session (non-flat attach)
async function workerHeaps(b) {
  const bs = await b.newBrowserCDPSession();
  const { targetInfos } = await bs.send('Target.getTargets');
  const out = [];
  for (const t of targetInfos.filter((x) => x.type === 'worker')) {
    try {
      const { sessionId } = await bs.send('Target.attachToTarget', { targetId: t.targetId, flatten: false });
      const call = (id, method) => new Promise((res) => {
        const on = (e) => { if (e.sessionId !== sessionId) return; const m = JSON.parse(e.message); if (m.id === id) { bs.off('Target.receivedMessageFromTarget', on); res(m.result || {}); } };
        bs.on('Target.receivedMessageFromTarget', on);
        bs.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method }) }).catch(() => res({}));
        setTimeout(() => res({}), 20000);   // a worker busy in a long script run answers only between tasks
      });
      await call(6, 'HeapProfiler.collectGarbage');
      const r = await call(7, 'Runtime.getHeapUsage');
      out.push({ url: t.url.replace(/^.*\/assets\//, '').slice(0, 60), used: r.usedSize || 0, total: r.totalSize || 0 });
      await bs.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    } catch (e) {}
  }
  await bs.detach().catch(() => {});
  return out;
}

// RSS (KB) of every chrome renderer / gpu process (the test owns the only browser under the lock)
function procRss(rootPid) {
  const res = { renderer: 0, gpu: 0, other: 0 };
  const kids = (pid) => { try { return fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number); } catch (e) { return []; } };
  const seen = new Set(), q = [rootPid];
  while (q.length) { const x = q.shift(); if (seen.has(x)) continue; seen.add(x); q.push(...kids(x)); }
  for (const pid of seen) {
    if (pid === rootPid) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      const rss = +(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8')) || [0, 0])[1];
      if (/--type=renderer/.test(cmd)) res.renderer += rss; else if (/--type=gpu/.test(cmd)) res.gpu += rss; else res.other += rss;
    } catch (e) {}
  }
  return res;
}

async function measure(b, p, cdp, rootPid) {
  try { await cdp.send('HeapProfiler.collectGarbage'); } catch (e) {}
  const h = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters').catch(() => ({}));
  const w = await workerHeaps(b);
  const pg = await p.evaluate(() => {
    const out = { canvasPx: 0, canvases: 0, bars: [], pine: 0 };
    document.querySelectorAll('canvas').forEach((c) => { out.canvases++; out.canvasPx += c.width * c.height; });
    try { window.STRYKER_VELA.context().cells.forEach((c) => out.bars.push(c.chart.orchestrator.rawBars.length)); } catch (e) {}
    try { out.census = window.__cvCensus(); } catch (e) {}
    try { out.pine = window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.chart).length; } catch (e) {}
    try { out.inds = window.STRYKER_VELA.chart.indicators().map((h) => h.nativeType || h.name || h.id).slice(0, 10); } catch (e) {}
    return out;
  }).catch(() => ({}));
  const MB = (x) => Math.round(x / 1048576 * 10) / 10;
  return { pageHeapMB: MB(h.usedSize), workersMB: w.map((x) => [x.url, MB(x.used)]), workerHeapMB: MB(w.reduce((a, x) => a + x.used, 0)), totalHeapMB: MB(h.usedSize + w.reduce((a, x) => a + x.used, 0)),
    dom, canvasMB: MB(pg.canvasPx * 4), canvases: pg.canvases, census: pg.census, bars: pg.bars, pine: pg.pine, inds: pg.inds, rss: rootPid ? procRss(rootPid) : null };
}

module.exports = { openPhone, measure, workerHeaps, procRss, fixturePage, neonState, DAY };
