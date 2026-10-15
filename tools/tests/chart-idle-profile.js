// What keeps the Charts main thread busy while the page is idle? CPU-profiles N seconds of an
// untouched chart and prints the top self-time functions + long-task totals.
//   CHART_BASE=https://tradezoro.com node tools/tests/chart-idle-profile.js [--member] [seconds]
// Run under flock /tmp/stryker-chrome.lock.
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'https://tradezoro.com';
const MEMBER = process.argv.includes('--member');
const SECS = Number(process.argv.filter((a) => /^\d+$/.test(a))[0] || 8);
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  if (MEMBER) await ctx.addInitScript(require('./richstub.js'));
  await ctx.addInitScript(() => { window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {} });
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_VELA.chart.orchestrator.rawBars.length > 0, null, { timeout: 60000 });
  await p.waitForTimeout(5000);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  const lt0 = await p.evaluate(() => window.__lt.length);
  await cdp.send('Profiler.start');
  await p.waitForTimeout(SECS * 1000);
  const { profile } = await cdp.send('Profiler.stop');
  const lts = await p.evaluate((n) => window.__lt.slice(n), lt0);
  const self = new Map();
  const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const cnt = new Map();
  profile.samples.forEach((id, i) => cnt.set(id, (cnt.get(id) || 0) + (dt[i] || 0)));
  let total = 0;
  for (const [id, us] of cnt) {
    const n = byId.get(id); const f = n.callFrame;
    const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}`;
    self.set(k, (self.get(k) || 0) + us); total += us;
  }
  // inclusive by url
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  console.log(`profiled ${SECS}s; long tasks ${lts.length}, sum ${Math.round(lts.reduce((a, x) => a + x[1], 0))} ms, max ${Math.round(Math.max(0, ...lts.map((x) => x[1])))} ms`);
  for (const [k, us] of top) console.log(String(Math.round(us / 1000)).padStart(6), 'ms', k);
  const byUrl = new Map();
  for (const [k, us] of self) { const u = k.split(' ').pop().split(':')[0]; byUrl.set(u, (byUrl.get(u) || 0) + us); }
  console.log('--- self time by file');
  for (const [u, us] of [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(String(Math.round(us / 1000)).padStart(6), 'ms', u);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
