// Probe: canvases at phone size that have a drawing context (WebKit allocates their pixels) but never drew, by owner.
//   CHART_BASE=... HUB=... flock /tmp/stryker-chrome.lock node tools/tests/phone-canvas-ctx-probe.js
const { launch } = require('./lib.js');
const { openPhone } = require('./phone-mem-lib.js');
(async () => {
  const b = await launch();
  try {
    const { p } = await openPhone(b, { base: process.env.CHART_BASE || 'http://127.0.0.1:8460', hub: process.env.HUB || 'http://127.0.0.1:8461' });
    await p.waitForFunction(() => window.__stkFirstCandles && window.__stkHeavyReady, null, { timeout: 120000 });
    await p.waitForTimeout(25000);
    const r = await p.evaluate(() => {
      const out = { census: window.__cvCensus(), idle: {} };
      const R = window.STRYKER_VELA.chart.renderer.renderer;
      const names = new Map();
      for (const k of Object.keys(R)) { const v = R[k]; if (v instanceof HTMLCanvasElement) names.set(v, k); }
      try { (R.extLayers || []).forEach((l) => { if (l.canvas) names.set(l.canvas, 'layer:' + (l.def && l.def.id)); }); } catch (e) {}
      for (const w of window.__cvAll) {
        const c = w.deref(); if (!c || !c.__ctx || c.__ink) continue;
        const k = names.get(c) || ('?' + (c.parentElement ? c.parentElement.className.slice(0, 30) : 'offdom'));
        const MB = c.width * c.height * 4 / 1048576;
        out.idle[k.replace(/layer:.*/, 'layer:*')] = Math.round(((out.idle[k.replace(/layer:.*/, 'layer:*')] || 0) + MB) * 10) / 10;
      }
      out.layers = (R.extLayers || []).length;
      out.layerKeys = Object.keys(R).filter((k) => /layer|canvas/i.test(k)).slice(0, 40);
      return out;
    });
    console.log(JSON.stringify(r, null, 1));
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
