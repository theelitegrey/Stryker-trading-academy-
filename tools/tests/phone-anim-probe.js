// Probe: legend status calls (same status again?) and running Web Animations over time (leak check).
//   CHART_BASE=... HUB=... flock /tmp/stryker-chrome.lock node tools/tests/phone-anim-probe.js [secs]
const { launch } = require('./lib.js');
const { openPhone } = require('./phone-mem-lib.js');
const SECS = +(process.argv[2] || 30);
(async () => {
  const b = await launch();
  try {
    const { p, cdp } = await openPhone(b, { base: process.env.CHART_BASE || 'http://127.0.0.1:8460', hub: process.env.HUB || 'http://127.0.0.1:8461' });
    await p.waitForFunction(() => window.__stkFirstCandles && window.__stkHeavyReady, null, { timeout: 120000 });
    await p.waitForTimeout(15000);
    const snap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return p.evaluate(() => ({ anims: document.getAnimations().length, rows: document.querySelectorAll('.vela-ind-row, [class*=legend] span').length, status: JSON.stringify(window.__stkStatusLog || null) })); };
    const a = await snap();
    await p.waitForTimeout(SECS * 1000);
    const c = await snap();
    const dom = await cdp.send('Memory.getDOMCounters');
    console.log('animations', a.anims, '->', c.anims, '| DOM', JSON.stringify(dom), '| status calls', c.status);
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
