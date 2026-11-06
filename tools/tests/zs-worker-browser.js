// Zscript sandbox, real browser: the shipped worker under its _headers CSP.
//   NODE_PATH=<node_modules> tools/chrome-slot.sh node tools/tests/zs-worker-browser.js
// 1. probe worker (tools/fixtures/zs/probe-worker.js) loads the real worker, then tries fetch,
//    importScripts, XHR, WebSocket, eval/Function, postMessage forgery, prototype pollution...
//    every one must be blocked.
// 2. ZsRunner end to end: compile + run + update in the worker, results match node.
// 3. an infinite loop is stopped by the VM limit and the page stays responsive.
// 4. the wall-clock kill terminates a worker that never answers.
// Serves the worktree with a tiny static server it starts and stops itself.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launch, ROOT } = require('./lib.js');

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };
function workerCsp() {
  const h = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
  const m = /\/assets\/zs\/worker\.js\n\s+Content-Security-Policy: ([^\n]+)/.exec(h);
  if (!m) throw new Error('no worker CSP in _headers');
  return m[1].trim();
}
const CSP = workerCsp();

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/zs-test.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><meta charset=utf-8><title>zs</title><body>zs</body>'); return; }
  const f = path.join(ROOT, path.normalize(u.pathname).replace(/^([/\\])+/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  const headers = { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' };
  // the worker and the probe (which stands in for it) get the shipped worker CSP
  if (u.pathname === '/assets/zs/worker.js' || u.pathname === '/tools/fixtures/zs/probe-worker.js') headers['content-security-policy'] = CSP;
  res.writeHead(200, headers); fs.createReadStream(f).pipe(res);
});

let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('ok  ', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    await page.goto(base + '/zs-test.html');

    // ---- 1. escape attempts ----
    const probe = await page.evaluate(() => new Promise((resolve) => {
      const w = new Worker('/tools/fixtures/zs/probe-worker.js', { type: 'module' });
      const got = { messages: [], error: null };
      w.onmessage = (e) => got.messages.push(e.data);
      w.onerror = (e) => { e.preventDefault(); got.error = String(e.message || ''); };
      setTimeout(() => { w.terminate(); resolve(got); }, 3000);
    }));
    const m = /ZSPROBE (\{.*\})/.exec(probe.error || '');
    ok(!!m, 'probe worker ran under the worker CSP', probe);
    if (m) {
      const r = JSON.parse(m[1]);
      ok(r.reached.length === 0, 'every escape attempt blocked (fetch, importScripts, XHR, WebSocket, eval, Function, postMessage, pollution, ...)', r.reached);
    }
    ok(!probe.messages.some((x) => x && x.out === 'forged'), 'no forged result message reached the page', probe.messages);
    ok(probe.messages.length <= 1 && (!probe.messages[0] || probe.messages[0].type === 'ready'), 'only the engine ready message came out', probe.messages);

    // ---- 2. runner end to end ----
    const e2e = await page.evaluate(async () => {
      const { ZsRunner } = await import('/assets/zs/runner.js?v=901');
      const r = new ZsRunner();
      const n = 300, bars = { time: [], open: [], high: [], low: [], close: [], volume: [] };
      let p = 100; for (let i = 0; i < n; i++) { const o = p; p += Math.sin(i / 7) * 1.3; bars.time.push(1767571200000 + i * 60000); bars.open.push(o); bars.close.push(p); bars.high.push(Math.max(o, p) + 0.5); bars.low.push(Math.min(o, p) - 0.5); bars.volume.push(100 + i); }
      const c = await r.compile('//@zscript 1\nindicator("Sample EMA", overlay=true)\nlen = input.int(9)\nplot(ta.ema(close, len), "EMA")\nvar c = 0\nc += 1\nplot(c, "Count")');
      const out = await r.run({ program: c.program, bars, timeframe: '1', inputs: { 0: 5 } });
      const upd = await r.update({ bar: { time: bars.time[n - 1] + 60000, open: p, high: p + 1, low: p - 1, close: p + 0.5, volume: 1 } });
      const bad = await r.compile('//@zscript 1\nindicator("x")\nplot(clse)');
      r.dispose();
      return { ok: c.ok, title: c.meta.title, runOk: out.ok, len: out.plots[0].values.length, isF64: out.plots[0].values instanceof Float64Array, last: out.plots[0].values[n - 1], count: out.plots[1].values[n - 1], updLen: upd.plots[0].values.length, updCount: upd.plots[1].values[n], badCode: bad.diagnostics[0].code, badHint: bad.diagnostics[0].hint, bars, program: c.program };
    });
    ok(e2e.ok && e2e.runOk && e2e.title === 'Sample EMA', 'compile + run in the worker', e2e.title);
    ok(e2e.len === 300 && e2e.isF64, 'plot values come back as Float64Array');
    ok(e2e.count === 300 && e2e.updLen === 301 && e2e.updCount === 301, 'live update appends a bar and keeps var state', [e2e.count, e2e.updLen, e2e.updCount]);
    ok(e2e.badCode === 'E303' && /close/.test(e2e.badHint), 'diagnostics with "did you mean" come back', [e2e.badCode, e2e.badHint]);
    // same numbers as node
    const { run } = await import(path.join(ROOT, 'assets/zs/index.js'));
    const nodeOut = run(e2e.program, { bars: e2e.bars, timeframe: '1', inputs: { 0: 5 } });
    ok(Math.abs(nodeOut.plots[0].values[299] - e2e.last) < 1e-12, 'browser result equals node result');

    // ---- 2b. protected script: sealed to the worker's key, program never comes back ----
    const prot = await page.evaluate(async () => {
      const { ZsRunner } = await import('/assets/zs/runner.js?v=901');
      const { compile } = await import('/assets/zs/index.js?v=901');
      const { sealTo } = await import('/assets/creator-seal.js?v=901');
      const seen = [];
      const r = new ZsRunner();
      const pub = await r.session();
      const w = r.w; const orig = w.onmessage; w.onmessage = (ev) => { seen.push(JSON.stringify(ev.data).slice(0, 20000)); orig(ev); };
      const c = compile('//@zscript 1\nindicator("Sample protected")\nsecretLen = input.int(4)\nplot(ta.sma(close, secretLen) * 2, "P")');
      const sealed = await sealTo(pub, JSON.stringify({ kind: 'zsbin', sid: 'x', program: c.program }));   // what the delivery API does
      const bars = { time: [0, 60000, 120000, 180000, 240000], open: [1, 2, 3, 4, 5], high: [1, 2, 3, 4, 5], low: [1, 2, 3, 4, 5], close: [1, 2, 3, 4, 5], volume: [1, 1, 1, 1, 1] };
      const out = await r.run({ sealed, bars, timeframe: '1' });
      // a second runner has a different key: the same sealed blob must not open there
      const r2 = new ZsRunner(); await r2.session();
      let otherErr = null; try { const o2 = await r2.run({ sealed, bars, timeframe: '1' }); otherErr = o2 && o2.ok ? null : 'failed'; } catch (e) { otherErr = String(e.message); }
      r.dispose(); r2.dispose();
      return { pubLen: pub.length, ok: out.ok, v: out.plots[0].values[3], leaked: seen.some((x) => x.includes('"units"') || x.includes('"code"')), otherErr };
    });
    ok(prot.pubLen > 40, 'worker session key made (public half only leaves the worker)');
    ok(prot.ok && prot.v === 5, 'sealed program opened and ran inside the worker', prot);
    ok(!prot.leaked, 'the opened program was never posted back to the page');
    ok(!!prot.otherErr, 'a sealed program does not open in another worker session', prot.otherErr);

    // ---- 2c. data hub messages (S3 protocol) feed book/flow/gex/opt ----
    const hubRes = await page.evaluate(async () => {
      const { ZsRunner } = await import('/assets/zs/runner.js?v=901');
      const { compile } = await import('/assets/zs/index.js?v=901');
      const lives = [], notices = [];
      const r = new ZsRunner({ onLive: (o) => lives.push(o), onNotice: (n) => notices.push(n) });
      const F = { book: { bb: [[100, 5]], ba: [[100.25, 4]] }, flow: { buy: 30, sell: 10, n: 3, cvd: 20, fp: [], poc: 100, vah: 100, val: 100 }, gex: { call: 110, put: 90, flip: 100, zu: 105, zl: 95, net: 1, lv: [100], ts: 1 } };
      r.post({ kind: 'zs.data.init', sessionId: 's', tfMs: 60000, status: { book: 'ok', flow: 'ok', gex: 'locked', opt: 'unused' } });
      r.post({ kind: 'zs.data.frames', sessionId: 's', reset: true, tfMs: 60000, frames: [[0, null], [60000, F]] });
      r.post({ kind: 'zs.data.notice', sessionId: 's', ns: 'gex', state: 'locked', upgrade: 'gex', text: 'GEX levels are part of Pro.' });
      const c = compile('//@zscript 1\nindicator("Sample data")\nplot(book.bid())\nplot(flow.delta)\nplot(gex.flip)');
      const bars = { time: [0, 60000], open: [1, 1], high: [1, 1], low: [1, 1], close: [1, 1], volume: [1, 1] };
      const out = await r.run({ program: c.program, bars, timeframe: '1' });
      const F2 = JSON.parse(JSON.stringify(F)); F2.flow.buy = 70;
      r.post({ kind: 'zs.data.live', sessionId: 's', t: 60000, frame: F2 });
      await new Promise((res) => setTimeout(res, 300));
      r.dispose();
      return { book: out.plots[0].values[1], delta: out.plots[1].values[1], gex: out.plots[2].values[1], first: out.plots[0].values[0], notices: out.notices, pushed: notices.map((n) => n.text), live: lives.length ? lives[0].plots[1].values[1] : null };
    });
    ok(hubRes.book === 100 && hubRes.delta === 20, 'hub frames reach book.* / flow.*', hubRes);
    ok(Number.isNaN(hubRes.gex) && Number.isNaN(hubRes.first), 'locked namespace and empty bar are na', hubRes);
    ok(hubRes.pushed.length === 1, 'hub notice forwarded to the page once', hubRes.pushed);
    ok(hubRes.live === 60, 'zs.data.live re-runs the last bar and pushes a live result', hubRes.live);

    // ---- 3. runaway loop is stopped, page stays alive ----
    const loop = await page.evaluate(async () => {
      const { ZsRunner } = await import('/assets/zs/runner.js?v=901');
      const r = new ZsRunner();
      const c = await r.compile('//@zscript 1\nindicator("x")\ni = 0\nwhile true\n    i += 1\nplot(i)');
      const t0 = performance.now();
      let ticks = 0; const iv = setInterval(() => ticks++, 20);
      const out = await r.run({ program: c.program, bars: { time: [0, 60000], open: [1, 1], high: [1, 1], low: [1, 1], close: [1, 1], volume: [1, 1] }, timeframe: '1' });
      clearInterval(iv); r.dispose();
      return { code: out.error && out.error.code, ms: performance.now() - t0, ticks };
    });
    ok(loop.code === 'E404', 'infinite loop stopped by the loop limit', loop);
    ok(loop.ms < 5000, 'stopped quickly (' + Math.round(loop.ms) + ' ms)');

    // ---- 4. wall-clock kill ----
    const kill = await page.evaluate(async () => {
      const { ZsRunner, KILL_MS } = await import('/assets/zs/runner.js?v=901');
      KILL_MS.compile = 300;
      // a worker that never answers stands in for a hung engine
      const blob = URL.createObjectURL(new Blob(['self.onmessage = () => { for (;;) {} }'], { type: 'text/javascript' }));
      const r = new ZsRunner({ workerUrl: blob });
      const t0 = performance.now();
      const out = await r.compile('x');
      const gone = r.w === null;
      KILL_MS.compile = 10000;
      return { code: out.diagnostics[0].code, ms: performance.now() - t0, gone };
    });
    ok(kill.code === 'E401' && kill.gone, 'hung worker killed by the wall clock', kill);
    ok(kill.ms < 2000, 'kill on time (' + Math.round(kill.ms) + ' ms)');
    ok(consoleErrors.length === 0, 'no page errors', consoleErrors);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`zs-worker-browser: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
