const R = require('./bt-rig.js');
(async () => {
  const srv = await R.serve(); const b = await R.launch(); const out = process.env.TMPDIR || '/tmp';
  const { ctx, p, errors } = await R.page(b, srv, 'desktop');
  p.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url().slice(0, 140)); });
  p.on('console', (m) => { if (/warn|error/.test(m.type())) console.log('C:', m.text().slice(0, 220)); });
  await R.startSession(p, srv.base, 'chart=tz');
  await p.waitForTimeout(6000);
  console.log(JSON.stringify(await p.evaluate(() => ({ heavy: window.__stkHeavyReady, iw: !!document.querySelector('.stkiw'), btns: [...document.querySelectorAll('#stkc-bar button')].map((b) => b.textContent.trim() || b.title).slice(0, 25) }))));
  await p.evaluate(() => document.querySelector('.stkiw-tab[data-k="picks"]') && 0);
  await p.getByRole('button', { name: /^Indicators$/ }).last().click().catch((e) => console.log('click fail', e.message.slice(0, 100)));
  await p.waitForTimeout(1500);
  console.log(JSON.stringify(await p.evaluate(() => ({ rows: document.querySelectorAll('.stkiw-row').length, win: !!document.querySelector('.stkiw') }))));
  await R.shot(p, out + '/bt-vela-ind2.png');
  await b.close(); srv.close();
})();
