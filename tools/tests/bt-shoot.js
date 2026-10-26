// Quick screenshots + layout probes of an open replay session (used for before/after shots).
//   node bt-shoot.js <outDir> [prefix] [query]     (BT_ROOT=<other checkout> to shoot another tree)
const path = require('path');
const R = require('./bt-rig.js');
(async () => {
  const OUT = process.argv[2] || '/tmp'; const PRE = process.argv[3] || 'bt'; const Q = process.argv[4] || '';
  const srv = await R.serve(process.env.BT_ROOT || undefined); const b = await R.launch();
  try {
    for (const dev of (process.env.BT_DEVS || 'phone,desktop').split(',')) {
      const { p, errors, ctx } = await R.page(b, srv, dev);
      await R.startSession(p, srv.base, Q);
      await p.click('#rp-step10').catch(() => {});
      await p.waitForTimeout(500);
      const info = await p.evaluate(() => {
        const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
        return { sw: document.documentElement.scrollWidth, vw: innerWidth, title: (document.getElementById('rp-title') || {}).textContent, res: (document.getElementById('rp-res') || {}).textContent, h1: document.getElementById('rp-h1').textContent, sub: document.getElementById('rp-h1-sub').textContent, float: r('#rp-float'), legend: r('.rp-legend'), indlegend: r('.rp-indlegend'), chart: r('#rp-chart-main'), buy: r('#rp-strip-buy'), sell: r('#rp-strip-sell'), day: r('#rp-jumpday') };
      });
      console.log(dev, JSON.stringify(info));
      await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(250);
      await R.shot(p, path.join(OUT, PRE + '-' + dev + '-top.png'));
      await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await p.waitForTimeout(300);
      await R.shot(p, path.join(OUT, PRE + '-' + dev + '-bottom.png'));
      if (errors.length) console.log('errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); srv.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
