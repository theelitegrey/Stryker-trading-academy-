// probe: time-axis left label at several scroll offsets (phone), crops saved
const R = require('./bt-rig.js');
(async () => {
  const OUT = process.argv[2] || '/tmp';
  const srv = await R.serve(process.env.BT_ROOT || undefined); const b = await R.launch();
  try {
    const { p } = await R.page(b, srv, 'phone');
    await R.startSession(p, srv.base, process.argv[3] || '');
    const box = await p.evaluate(() => { const r = document.getElementById('rp-chart-main').getBoundingClientRect(); window.scrollTo(0, r.top + scrollY - 200); return null; });
    for (let k = 0; k < 4; k++) {
      await p.evaluate((k) => { const c = window.__RP.chart.chart.timeScale(); const r = c.getVisibleLogicalRange(); c.setVisibleLogicalRange({ from: r.from - 1.3, to: r.to - 1.3 }); }, k);
      await p.waitForTimeout(250);
      const r = await p.evaluate(() => { const e = document.getElementById('rp-chart-main').getBoundingClientRect(); return { x: e.left, y: e.bottom - 70, w: 200, h: 70 }; });
      await p.screenshot({ path: OUT + '/axis-' + k + '.png', clip: { x: Math.max(0, r.x - 20), y: r.y, width: 220, height: 70 } });
    }
  } finally { await b.close(); srv.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
