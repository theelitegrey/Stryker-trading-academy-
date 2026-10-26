const R = require('./bt-rig.js');
(async () => {
  const srv = await R.serve(); const b = await R.launch();
  const { ctx, p } = await R.page(b, srv, 'phone');
  await R.startSession(p, srv.base, 'chart=tz&ui=2'); await p.waitForTimeout(5000);
  console.log(JSON.stringify(await p.evaluate(() => {
    const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    const vis = (e) => { const s = getComputedStyle(e); const b = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
    const bar = [...document.querySelectorAll('#stkc-bar button, #stkc-bar [role=button]')].filter(vis).map((e) => (e.id || e.className.toString().slice(0, 40)) + '|' + (e.title || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 12)) + '|' + r(e).join(','));
    const sym = document.querySelector('.stkc-sym, #stkc-symbol, [data-role=symbol]');
    const draw = [...document.querySelectorAll('button')].filter((e) => vis(e) && /draw|pencil|fav/i.test((e.title || '') + e.className + (e.getAttribute('aria-label') || ''))).map((e) => e.className.toString().slice(0, 50) + '|' + (e.title || e.getAttribute('aria-label')) + '|' + r(e).join(','));
    const tops = [...document.querySelectorAll('body > *, .dash-shell > *, main, main > *')].filter(vis).map((e) => e.tagName + '#' + e.id + '.' + e.className.toString().slice(0, 30) + ' ' + r(e).join(','));
    return { html: document.documentElement.className, body: document.body.className, bar, draw, tops: tops.slice(0, 25) };
  })));
  await R.shot(p, '/root/projects/stryker-notes/reports/workers/t5-bt-phone/before-tz-ui2-phone.png');
  await b.close(); srv.close();
})();
