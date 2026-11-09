// Probe: what the Pine worker holds after a scroll-back to ~SCROLL 1m bars (default 18000) with Neon's layout.
// Sampling heap profile of the worker (allocation sites of what is still live at the end, after a GC), plus the worker
// heap after GC. ALL=1 also counts objects already collected (= allocation churn during the scroll-back).
//   SCROLL=18000 CHART_BASE=... HUB=... flock /tmp/stryker-chrome.lock node tools/tests/phone-worker-sample-probe.js
const { launch } = require('./lib.js');
const { openPhone } = require('./phone-mem-lib.js');
const TARGET = +(process.env.SCROLL || 18000), ALL = process.env.ALL === '1';
(async () => {
  const b = await launch();
  try {
    const { p } = await openPhone(b, { base: process.env.CHART_BASE || 'http://127.0.0.1:8460', hub: process.env.HUB || 'http://127.0.0.1:8461' });
    await p.waitForFunction(() => window.__stkFirstCandles && window.__stkHeavyReady && !document.documentElement.classList.contains('stk-pine-busy'), null, { timeout: 180000, polling: 250 });
    const bs = await b.newBrowserCDPSession();
    let t;
    for (let i = 0; i < 40 && !t; i++) { const { targetInfos } = await bs.send('Target.getTargets'); t = targetInfos.find((x) => x.type === 'worker' && /pine-next-worker/.test(x.url)); if (!t) { if (i === 39) console.log(JSON.stringify(targetInfos.map((x) => [x.type, x.url.slice(0, 80)]))); await p.waitForTimeout(500); } }
    const { sessionId } = await bs.send('Target.attachToTarget', { targetId: t.targetId, flatten: false });
    let id = 0; const waits = new Map();
    bs.on('Target.receivedMessageFromTarget', (e) => { if (e.sessionId !== sessionId) return; const m = JSON.parse(e.message); if (m.id && waits.has(m.id)) { waits.get(m.id)(m.result || m.error); waits.delete(m.id); } });
    const send = (method, params) => new Promise((res) => { const i = ++id; waits.set(i, res); bs.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: i, method, params: params || {} }) }); });
    await send('HeapProfiler.enable');
    await send('HeapProfiler.collectGarbage');
    const h0 = await send('Runtime.getHeapUsage');
    await send('HeapProfiler.startSampling', { samplingInterval: 65536, includeObjectsCollectedByMajorGC: ALL, includeObjectsCollectedByMinorGC: ALL });
    let n = 0;
    for (let i = 0; i < 80; i++) {
      n = await p.evaluate(() => { const c = window.STRYKER_VELA.chart, b = c.orchestrator.rawBars, v = c.getVisibleRange(); c.setVisibleRange({ from: b[0].time, to: b[0].time + (v.to - v.from) }); return b.length; });
      if (n >= TARGET) break;
      await p.waitForTimeout(1500);
    }
    await p.waitForTimeout(1500);
    await p.waitForFunction(() => !document.documentElement.classList.contains('stk-pine-busy'), null, { timeout: 240000, polling: 500 }).catch(() => {});
    await p.waitForTimeout(3000);
    await send('HeapProfiler.collectGarbage');
    const h1 = await send('Runtime.getHeapUsage');
    const prof = (await send('HeapProfiler.stopSampling')).profile;
    // self size per function (url:line), and per top-level caller chain of 3
    const self = new Map(), chain = new Map();
    const walk = (node, stack) => {
      const f = node.callFrame, k = (f.functionName || '(anon)') + ' ' + f.url.replace(/^.*\//, '').slice(0, 40) + ':' + f.lineNumber + ':' + f.columnNumber;
      const st = stack.concat(k);
      if (node.selfSize) { self.set(k, (self.get(k) || 0) + node.selfSize); const c = st.slice(-4).join(' < '); chain.set(c, (chain.get(c) || 0) + node.selfSize); }
      for (const ch of node.children || []) walk(ch, st);
    };
    walk(prof.head, []);
    const MB = (x) => (x / 1048576).toFixed(1);
    console.log('bars', n, 'worker heap after GC', MB(h0.usedSize), '->', MB(h1.usedSize), 'MB', ALL ? '(sampled = all allocations)' : '(sampled = live at end)');
    console.log('top self:'); [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log('  ', MB(v).padStart(7), k));
    console.log('top chains:'); [...chain.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log('  ', MB(v).padStart(7), k.slice(0, 260)));
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
