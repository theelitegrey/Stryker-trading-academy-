// Probe: how many Pine run contexts the worker still holds after a scroll-back (Runtime.queryObjects on pinets'
// Context prototype), with each one's bar count. 2 scripts on the chart = 2 expected; more = old runs kept alive.
//   SCROLL=18000 CHART_BASE=... HUB=... flock /tmp/stryker-chrome.lock node tools/tests/phone-ctx-count-probe.js
const { launch } = require('./lib.js');
const { openPhone } = require('./phone-mem-lib.js');
const TARGET = +(process.env.SCROLL || 18000);
(async () => {
  const b = await launch();
  try {
    const { p } = await openPhone(b, { base: process.env.CHART_BASE || 'http://127.0.0.1:8460', hub: process.env.HUB || 'http://127.0.0.1:8461' });
    await p.waitForFunction(() => window.__stkFirstCandles && window.__stkHeavyReady && !document.documentElement.classList.contains('stk-pine-busy'), null, { timeout: 180000, polling: 250 });
    const bs = await b.newBrowserCDPSession();
    let t;
    for (let i = 0; i < 40 && !t; i++) { const { targetInfos } = await bs.send('Target.getTargets'); t = targetInfos.find((x) => x.type === 'worker' && /pine-next-worker/.test(x.url)); if (!t) await p.waitForTimeout(500); }
    const { sessionId } = await bs.send('Target.attachToTarget', { targetId: t.targetId, flatten: false });
    let id = 0; const waits = new Map();
    bs.on('Target.receivedMessageFromTarget', (e) => { if (e.sessionId !== sessionId) return; const m = JSON.parse(e.message); if (m.id && waits.has(m.id)) { waits.get(m.id)(m.result || m.error); waits.delete(m.id); } });
    const send = (method, params) => new Promise((res) => { const i = ++id; waits.set(i, res); bs.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: i, method, params: params || {} }) }); });
    const count = async (label) => {
      await send('HeapProfiler.collectGarbage');
      const h = await send('Runtime.getHeapUsage');
      const proto = await send('Runtime.evaluate', { expression: "import('https://cdn.jsdelivr.net/npm/pinets@0.11.0/dist/pinets.min.browser.es.js').then((m) => m.Context.prototype)", awaitPromise: true });
      const q = await send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId });
      const r = await send('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: 'function(){ const roots = new Map(); for (const c of this) { const r = c.fullContext || c; const e = roots.get(r) || { bars: r.data && r.data.close ? r.data.close.data.length : -1, tf: r.timeframe, vars: ["const","var","let"].reduce((n, k) => n + Object.keys(r[k] || {}).length, 0), tick: r._execTick, views: 0 }; e.views++; roots.set(r, e); } return JSON.stringify([...roots.values()].filter((e) => e.bars > 0).sort((a, b) => b.bars - a.bars)); }', returnByValue: true });
      console.log(label, 'worker heap', (h.usedSize / 1048576).toFixed(1), 'MB, contexts', r.result.value);
    };
    await p.waitForFunction(() => { try { return window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.chart).length >= 2; } catch (e) { return false; } }, null, { timeout: 120000 });
    await p.waitForTimeout(4000);
    await p.waitForFunction(() => !document.documentElement.classList.contains('stk-pine-busy'), null, { timeout: 120000, polling: 500 });
    await count('loaded');
    let n = 0;
    for (let i = 0; i < 80; i++) {
      n = await p.evaluate(() => { const c = window.STRYKER_VELA.chart, b = c.orchestrator.rawBars, v = c.getVisibleRange(); c.setVisibleRange({ from: b[0].time, to: b[0].time + (v.to - v.from) }); return b.length; });
      if (n >= TARGET) break;
      await p.waitForTimeout(1500);
    }
    await p.waitForTimeout(1500);
    await p.waitForFunction(() => !document.documentElement.classList.contains('stk-pine-busy'), null, { timeout: 240000, polling: 500 }).catch(() => {});
    await p.waitForTimeout(3000);
    await count('scrolled ' + n + ' bars');
    await p.waitForTimeout(10000);
    await count('scrolled +10s');
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
