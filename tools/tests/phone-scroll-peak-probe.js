// Probe: PEAK memory while Neon's layout scrolls back to ~SCROLL 1m bars (default 18000).
// Renderer RSS (page + Pine worker + canvases, one process) sampled from /proc every 250 ms, so a worker that is busy
// in a long run (it does not answer CDP then) is still measured. Worker JS heap sampled (no forced GC) when it answers.
//   CHART_BASE=http://127.0.0.1:8460 HUB=http://127.0.0.1:8461 flock /tmp/stryker-chrome.lock node tools/tests/phone-scroll-peak-probe.js
const { launch } = require('./lib.js');
const { openPhone, procRss } = require('./phone-mem-lib.js');
const TARGET = +(process.env.SCROLL || 18000);
(async () => {
  const b = await launch();
  const root = process.pid;
  let peakRss = 0, peakWorker = 0, base = 0, stop = false;
  const rssLoop = (async () => { while (!stop) { const r = procRss(root).renderer; if (r > peakRss) peakRss = r; await new Promise((r) => setTimeout(r, 250)); } })();
  try {
    const { p } = await openPhone(b, { base: process.env.CHART_BASE || 'http://127.0.0.1:8460', hub: process.env.HUB || 'http://127.0.0.1:8461' });
    await p.waitForFunction(() => window.__stkFirstCandles && window.__stkHeavyReady && !document.documentElement.classList.contains('stk-pine-busy'), null, { timeout: 180000, polling: 250 });
    await p.waitForTimeout(3000);
    base = procRss(root).renderer; peakRss = base;
    const bs = await b.newBrowserCDPSession();
    const wloop = (async () => {
      while (!stop) {
        try {
          const { targetInfos } = await bs.send('Target.getTargets');
          const t = targetInfos.find((x) => x.type === 'worker' && /pine-next-worker/.test(x.url));
          if (t) {
            const { sessionId } = await bs.send('Target.attachToTarget', { targetId: t.targetId, flatten: false });
            const r = await new Promise((res) => {
              const on = (e) => { if (e.sessionId !== sessionId) return; const m = JSON.parse(e.message); if (m.id === 1) { bs.off('Target.receivedMessageFromTarget', on); res(m.result || {}); } };
              bs.on('Target.receivedMessageFromTarget', on);
              bs.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method: 'Runtime.getHeapUsage' }) }).catch(() => res({}));
              setTimeout(() => res({}), 5000);
            });
            if (r.usedSize > peakWorker) peakWorker = r.usedSize;
            await bs.send('Target.detachFromTarget', { sessionId }).catch(() => {});
          }
        } catch (e) {}
        await new Promise((r) => setTimeout(r, 500));
      }
    })();
    const t1 = Date.now();
    let n = 0;
    for (let i = 0; i < 80; i++) {
      n = await p.evaluate(() => { const c = window.STRYKER_VELA.chart, b = c.orchestrator.rawBars, v = c.getVisibleRange(); c.setVisibleRange({ from: b[0].time, to: b[0].time + (v.to - v.from) }); return b.length; });
      if (n >= TARGET) break;
      await p.waitForTimeout(1500);
    }
    await p.waitForTimeout(1500);
    await p.waitForFunction(() => !document.documentElement.classList.contains('stk-pine-busy'), null, { timeout: 240000, polling: 500 }).catch(() => {});
    const settle = Date.now() - t1;
    await p.waitForTimeout(5000);
    stop = true; await rssLoop; await wloop;
    const MB = (kb) => Math.round(kb / 1024);
    console.log(JSON.stringify({ bars: n, scrollToIdleMs: settle, rendererBaseMB: MB(base), rendererPeakMB: MB(peakRss), rendererGrowthMB: MB(peakRss - base), workerHeapPeakMB: Math.round(peakWorker / 1048576) }));
  } finally { stop = true; await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
