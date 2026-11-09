// Probe: list every canvas at phone size (Neon's layout) by backing-store size, with its owner path.
//   CHART_BASE=http://127.0.0.1:8460 HUB=http://127.0.0.1:8461 flock /tmp/stryker-chrome.lock node tools/tests/phone-canvas-probe.js
const { launch } = require('./lib.js');
const { openPhone } = require('./phone-mem-lib.js');
(async () => {
  const b = await launch();
  try {
    const { p } = await openPhone(b, { base: process.env.CHART_BASE || 'http://127.0.0.1:8460', hub: process.env.HUB || 'http://127.0.0.1:8461', seed: process.env.SEED !== '0', w: +(process.env.W || 390), dpr: +(process.env.DPR || 3) });
    await p.waitForFunction(() => window.__stkFirstCandles && window.__stkHeavyReady, null, { timeout: 120000 });
    await p.waitForTimeout(+(process.env.WAIT || 15000));
    const r = await p.evaluate(() => {
      const path = (el) => { const a = []; for (let n = el; n && a.length < 6; n = n.parentElement) a.push((n.id ? '#' + n.id : n.tagName.toLowerCase()) + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : '')); return a.join(' < '); };
      return [...document.querySelectorAll('canvas')].map((c) => { const R = c.getBoundingClientRect(); const cs = getComputedStyle(c); return { w: c.width, h: c.height, MB: Math.round(c.width * c.height * 4 / 1048576 * 10) / 10, css: [Math.round(R.width), Math.round(R.height)], vis: cs.display !== 'none' && cs.visibility !== 'hidden' && R.width > 0 && !!c.offsetParent, ctx: c.__ctxType || '', path: path(c) }; }).sort((a, b) => b.MB - a.MB);
    });
    let tot = 0, hid = 0; r.forEach((x) => { tot += x.MB; if (!x.vis) hid += x.MB; });
    console.log('total MB', Math.round(tot), 'hidden MB', Math.round(hid), 'count', r.length);
    r.forEach((x) => console.log(JSON.stringify(x)));
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
