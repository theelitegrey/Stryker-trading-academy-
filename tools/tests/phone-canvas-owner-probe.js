// Probe: which canvases actually hold pixel memory (drawn on / cleared / GL) at phone size, by owner.
//   CHART_BASE=... HUB=... flock /tmp/stryker-chrome.lock node tools/tests/phone-canvas-owner-probe.js [waitSecs]
const { launch } = require('./lib.js');
const { openPhone } = require('./phone-mem-lib.js');
const WAIT = +(process.argv[2] || 30);
(async () => {
  const b = await launch();
  try {
    const { p } = await openPhone(b, { base: process.env.CHART_BASE || 'http://127.0.0.1:8460', hub: process.env.HUB || 'http://127.0.0.1:8461', seed: process.env.SEED !== '0', w: +(process.env.W || 390), dpr: +(process.env.DPR || 3) });
    await p.waitForFunction(() => window.__stkFirstCandles && window.__stkHeavyReady, null, { timeout: 120000 });
    await p.waitForTimeout(WAIT * 1000);
    const r = await p.evaluate(() => {
      const names = new Map();
      for (const cell of window.STRYKER_VELA.context().cells) {
        const R = cell.chart.renderer.renderer || cell.chart.renderer;
        for (const k of Object.keys(R)) { const v = R[k]; if (v instanceof HTMLCanvasElement) names.set(v, k); }
        (R.extLayers || []).forEach((l) => names.set(l.canvas, 'layer:' + l.def.id + (l.owner ? '#' + l.owner : '')));
        for (const k of Object.keys(R)) { const v = R[k]; if (v && typeof v === 'object' && v.sliceCache instanceof Map) v.sliceCache.forEach((c, key) => names.set(c, k + '.slice:' + key)); }
      }
      const out = [];
      for (const ref of window.__cvAll) {
        const c = ref.deref(); if (!c) continue;
        const px = c.width * c.height;
        out.push({ who: names.get(c) || (c.isConnected ? 'dom:' + (c.parentElement && c.parentElement.className) : 'offdom'), MB: Math.round(px * 4 / 1048576 * 10) / 10, touched: !!(c.__px || c.__gl), ink: c.__ink || 0, clr: c.__clr || 0, par: c.parentElement ? (c.parentElement.className || c.parentElement.tagName) + '<' + (c.parentElement.parentElement && (c.parentElement.parentElement.className || c.parentElement.parentElement.tagName)) : '', gl: !!c.__gl, inDom: c.isConnected, vis: c.style.visibility || '' });
      }
      return out;
    });
    const t = r.filter((x) => x.touched);
    console.log('touched', t.length, 'MB', Math.round(t.reduce((a, x) => a + x.MB, 0)), 'of', r.length, 'canvases');
    t.sort((a, b) => b.MB - a.MB).forEach((x) => console.log(JSON.stringify(x)));
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
