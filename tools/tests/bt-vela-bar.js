const R = require('./bt-rig.js');
(async () => { const srv = await R.serve(); const b = await R.launch(); const { p } = await R.page(b, srv, 'phone');
  await R.startSession(p, srv.base, 'chart=tz&ui=2'); await p.waitForTimeout(4500);
  console.log(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('#stkc-bar button')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.className.toString().slice(0, 45) + '|' + (e.title || e.getAttribute('aria-label'))))));
  await b.close(); srv.close(); })();
