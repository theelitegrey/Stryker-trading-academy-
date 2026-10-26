const R = require('./bt-rig.js');
(async () => { const srv = await R.serve(); const b = await R.launch(); const { p } = await R.page(b, srv, 'phone');
  await R.startSession(p, srv.base, 'chart=tz'); await p.waitForTimeout(4500);
  console.log(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('#vela-chart *')].filter((e) => e.children.length === 0 && /SESSION|MNQ|NQ|Oct|BT/.test(e.textContent || '')).map((e) => e.className.toString().slice(0, 30) + ':' + e.textContent.slice(0, 50)).slice(0, 8))));
  const wm = await p.evaluate(() => { const c = document.querySelector('.vela-watermark'); return c ? c.innerText : null; }); console.log('wm', wm);
  await b.close(); srv.close(); })();
