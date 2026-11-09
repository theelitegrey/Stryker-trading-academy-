// Probe: for every renderer layer, does it have an owner / data, and did it draw (ink)? A layer that never draws without
// data or an owner can keep a 0x0 canvas until it does (the phone memory fix in tools/vela-090-mem-patch.py).
//   CHART_BASE=... HUB=... flock /tmp/stryker-chrome.lock node tools/tests/phone-layer-probe.js [secs]
const { launch } = require('./lib.js');
const { openPhone } = require('./phone-mem-lib.js');
const SECS = +(process.argv[2] || 25);
(async () => {
  const b = await launch();
  try {
    const { p } = await openPhone(b, { base: process.env.CHART_BASE || 'http://127.0.0.1:8460', hub: process.env.HUB || 'http://127.0.0.1:8461', seed: process.env.SEED !== '0' });
    await p.waitForFunction(() => window.__stkFirstCandles && window.__stkHeavyReady, null, { timeout: 120000 });
    await p.waitForTimeout(SECS * 1000);
    const r = await p.evaluate(() => {
      const R = window.STRYKER_VELA.chart.renderer.renderer;
      return (R.extLayers || []).map((l) => ({ id: l.channel, owner: !!R.layerOwner(l), data: R.scene.nativeData.get(l.channel) != null, ink: l.canvas.__ink || 0, w: l.canvas.width }));
    });
    const bad = r.filter((x) => x.ink && !x.owner && !x.data);
    console.log('layers', r.length, 'with ink', r.filter((x) => x.ink).length, 'owner/data', r.filter((x) => x.owner || x.data).length, 'sized', r.filter((x) => x.w > 1).length);
    console.log('drew WITHOUT owner or data:', JSON.stringify(bad));
    console.log(JSON.stringify(r.filter((x) => x.ink || x.owner || x.data)));
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
