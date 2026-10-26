// Admin leftovers check (form sweep deploy 4): sessions-admin date/time/tz heights, logs-admin filter row,
// x-admin Settings panel opened, roadmap-admin item rows. Measures + screenshots.  OUT=<dir> node form-admin-check.js
const R = require('./bt-rig.js'); const { PROBE, ADMIN_INIT } = require('./form-probe.js');
(async () => {
  const OUT = process.env.OUT || '/tmp'; const srv = await R.serve(); const b = await R.launch(); let fails = 0;
  const ok = (k, v, x) => { console.log((v ? 'PASS ' : 'FAIL ') + k + (x ? ' ' + JSON.stringify(x) : '')); if (!v) fails++; };
  for (const dev of ['desktop', 'phone']) {
    const { ctx, p, errors } = await R.page(b, srv, dev); await ctx.addInitScript(ADMIN_INIT);
    await p.goto(srv.base + '/sessions-admin.html', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2200);
    const h = await p.evaluate(() => ['admin-session-date', 'admin-session-time', 'admin-session-tz'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().height)));
    ok(dev + ' sessions date/time/tz same height', Math.max(...h) - Math.min(...h) <= 1, h);
    await p.fill('#admin-session-date', '2026-11-02'); await p.fill('#admin-session-time', '14:30');
    ok(dev + ' sessions date/time accept values', (await p.inputValue('#admin-session-date')) === '2026-11-02' && (await p.inputValue('#admin-session-time')) === '14:30');
    await p.goto(srv.base + '/logs-admin.html', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2200);
    const lh = await p.evaluate(() => ['log-filter-user', 'log-filter-action', 'log-filter-from', 'log-filter-to'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().height)));
    ok(dev + ' logs filter row one height', Math.max(...lh) - Math.min(...lh) <= 1, lh);
    await p.screenshot({ path: OUT + '/after4-logs-admin-' + dev + '.png' });
    await p.goto(srv.base + '/x-admin.html', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2200);
    await p.evaluate(() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); const s = [...document.querySelectorAll('button, summary, h2, h3')].find((e) => /^\s*Settings\s*$/.test(e.textContent)); if (s) s.click(); });
    await p.waitForTimeout(500);
    const r = await p.evaluate(PROBE); const nat = r.native.filter((n) => n.visible);
    ok(dev + ' x-admin settings opened: no native/white controls, no row misalignment, no hscroll', !nat.length && !r.rowmis.length && !r.whitebtn.length && !r.hscroll, { nat: nat.slice(0, 3), rm: r.rowmis.slice(0, 2), wb: r.whitebtn.slice(0, 2), hs: r.hscroll });
    await p.evaluate(() => { const s = [...document.querySelectorAll('h2, h3, summary, button')].find((e) => /^\s*Settings\s*$/.test(e.textContent)); if (s) window.scrollTo(0, s.getBoundingClientRect().top + scrollY - 80); });
    await p.waitForTimeout(200); await p.screenshot({ path: OUT + '/after4-x-admin-settings-' + dev + '.png' });
    ok(dev + ' no page errors', !errors.length, errors.slice(0, 2));
    await ctx.close();
  }
  console.log('FAILS', fails); await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
