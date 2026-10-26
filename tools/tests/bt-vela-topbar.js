// compare top bar: charts vs backtest. node bt-vela-topbar.js <phone|phone412> <query>
const R = require('./bt-rig.js'); const dev = process.argv[2] || 'phone', q = process.argv[3] || 'chart=tz&ui=2'; const DIR = process.env.SHOTDIR || process.env.TMPDIR; const label = process.env.LABEL || 'tb';
const dump = () => [...document.querySelectorAll('#stkc-bar')].map((b) => [...b.querySelectorAll('button, .mclock, .mclock-pill, .vela-mb-item')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.y < 60; }).map((e) => { const r = e.getBoundingClientRect(); return (e.id || e.className.toString().split(' ').slice(0, 2).join('.')).slice(0, 28) + ' x' + Math.round(r.x) + ' w' + Math.round(r.width) + ' h' + Math.round(r.height); }).join('\n'));
(async () => { const srv = await R.serve(); const b = await R.launch();
  { const { p } = await R.page(b, srv, dev); await p.goto(srv.base + '/charts.html', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#stkc-bar .vela-mb-symbol', { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(4000);
    console.log('--- CHARTS\n' + (await p.evaluate(dump)).join('\n')); await R.shot(p, DIR + '/' + label + '-charts-' + dev + '.png'); await p.context().close(); }
  { const { ctx, p } = await R.page(b, srv, dev); await R.startSession(p, srv.base, q); await p.waitForTimeout(4500);
    console.log('--- BACKTEST\n' + (await p.evaluate(dump)).join('\n')); await R.shot(p, DIR + '/' + label + '-bt-' + dev + '.png'); }
  await b.close(); srv.close(); })();
