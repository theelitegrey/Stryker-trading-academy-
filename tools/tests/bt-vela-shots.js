// Phone/desktop shots of a tz session: node bt-vela-shots.js <dev> <label> [query] ; saves to DIR
const R = require('./bt-rig.js'); const dev = process.argv[2] || 'phone', label = process.argv[3] || 'x', extra = process.argv[4] || '';
const DIR = process.env.SHOTDIR || '/root/projects/stryker-notes/reports/workers/t5-bt-phone';
(async () => {
  const srv = await R.serve(); const b = await R.launch();
  const { ctx, p, errors } = await R.page(b, srv, dev);
  await R.startSession(p, srv.base, extra); await p.waitForTimeout(5000);
  const m = await p.evaluate(() => { const q = (s) => document.querySelector(s); const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }; return { vh: innerHeight, vw: innerWidth, sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, chart: r(q('#rp-chart-main')), bars: [...document.querySelectorAll('#stkc-bar')].map(r), head: r(q('#rp-head')), top: r(q('.rpw-top')), float: r(q('#rp-float')), bottom: r(q('.rpw-bottom')) }; });
  console.log(label, dev, JSON.stringify(m));
  await R.shot(p, DIR + '/' + label + '-' + dev + '.png');
  console.log('errors', JSON.stringify(errors.slice(0, 4)));
  await b.close(); srv.close();
})();
