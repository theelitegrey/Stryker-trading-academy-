const R = require('./bt-rig.js');
(async () => {
  const srv = await R.serve(); const b = await R.launch();
  for (const q of ['chart=tz&ui=2', 'chart=tz']) {
    const { ctx, p } = await R.page(b, srv, 'phone');
    await R.startSession(p, srv.base, q); await p.waitForTimeout(4000);
    console.log('=== ' + q);
    console.log(await p.evaluate(() => {
      const d = (e, n) => { let s = ''; for (const c of e.children) { const nm = c.tagName.toLowerCase() + (c.id ? '#' + c.id : '') + (c.className && typeof c.className === 'string' ? '.' + c.className.trim().split(/\s+/).slice(0, 2).join('.') : ''); s += '  '.repeat(n) + nm + (c.children.length && n < 2 ? '\n' + d(c, n + 1) : '') + '\n'; } return s; };
      return d(document.querySelector('.rpw-top'), 0) + '--- body children\n' + [...document.body.children].map((c) => c.tagName + '#' + c.id + '.' + c.className.toString().slice(0, 40)).join('\n') + '\nfab:' + [...document.querySelectorAll('.stk-fb-fab')].map((e) => e.hidden + ' ' + JSON.stringify(e.getBoundingClientRect())).join(';');
    }));
    await ctx.close();
  }
  await b.close(); srv.close();
})();
