// Plain page screenshots for the form-sweep report. PAGES=a.html,b.html COMBOS=desktop:dark,phone:day OUT=<dir> TAG=x [ROOT_DIR=<repo>] [SCROLL=sel]
const R = require('./bt-rig.js');
(async () => {
  const OUT = process.env.OUT || '/tmp'; const TAG = process.env.TAG || 'after';
  const srv = await R.serve(process.env.ROOT_DIR); const b = await R.launch();
  for (const combo of (process.env.COMBOS || 'desktop:dark').split(',')) {
    const [dev, theme] = combo.split(':');
    for (const pg of process.env.PAGES.split(',')) {
      const [file, sel] = pg.split('@');
      const adminInit = /-admin|-editor/.test(file) ? require('./form-probe.js').ADMIN_INIT : null;
      const { ctx, p } = await R.page(b, srv, dev, (t) => { try { localStorage.setItem('stryker_theme', t); } catch (e) {} });
      if (adminInit) await ctx.addInitScript(adminInit);
      await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t); } catch (e) {} }, theme === 'day' ? 'day' : 'night');
      await p.goto(srv.base + '/' + file, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
      if (sel) await p.evaluate((s) => { const e = document.querySelector(s); if (e) window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 90); }, sel);
      await p.waitForTimeout(300);
      const f = OUT + '/' + TAG + '-' + file.replace('.html', '') + (sel ? '-' + sel.replace(/[^a-z0-9]/gi, '') : '') + '-' + dev + '-' + theme + '.png';
      await p.screenshot({ path: f }); console.log(f); await ctx.close();
    }
  }
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
