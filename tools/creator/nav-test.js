// Creator Hub app-menu test: stubs Firebase (reuses landing-shots.js stub), serves repo on 127.0.0.1.
// Run (Chrome under the shared lock): node tools/creator/nav-test.js <outdir>
// Cases: guest-ish new member vs creator who owns one community; clicks every new item and checks landing + active state; shots.
const fs = require('fs');
let src = fs.readFileSync(__dirname + '/landing-shots.js', 'utf8');
src = src.slice(0, src.indexOf('(async () => {')).replace("process.argv[2] || '/tmp/creators-shots'", "process.argv[2] || '/tmp/creator-nav'");
src = src.replace('const PORT = 8751', 'const PORT = 8761').replace("ownerUid: 'own'", "ownerUid: window.__OWN ? 'u1' : 'zz'") + `
module.exports = { stubSrc, srv, OUT, PORT };`;
const m = { exports: {} };
new Function('require', 'module', 'exports', '__dirname', 'process', src)(require, m, m.exports, __dirname, process);
const { stubSrc, srv, OUT, PORT } = m.exports;
const { launch } = require('../tests/lib.js');
const ownerStub = (own) => 'window.__OWN=' + own + ';' + stubSrc(true).replace(/window\.db = \{/, "S['admins/u1'] = window.__ADM ? {x:1} : undefined; if(!S['admins/u1']) delete S['admins/u1']; window.db = {");
const fails = [];
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails.push(msg); };
(async () => {
  const b = await launch();
  const cases = [['new', false, false], ['owner', true, false]];
  const sizes = [[390, 844], [412, 915], [1440, 900]];
  for (const [who, own] of cases) for (const [w, h] of sizes) for (const theme of ['dark', 'light']) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 });
    await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.addInitScript(ownerStub(own));
    await page.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_nav_authed', '1'); } catch (e) {} }, theme);
    const base = 'http://127.0.0.1:' + PORT;
    const tag = who + '-' + w + '-' + theme;
    await page.goto(base + '/giveaways.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const t = document.getElementById('dash-menu-toggle'); t && t.click(); }); await page.waitForTimeout(500);
    const sb = await page.$('.sidebar');
    await page.evaluate(() => { const l = document.getElementById('cn-label'); l && l.scrollIntoView({ block: 'center' }); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: OUT + '/menu-' + tag + '.png' });
    if (false) console.log(await page.evaluate(async () => JSON.stringify({q: (await db.collection('communities').where('ownerUid','==','u1').get()).size, all: (await db.collection('communities').get()).size, own: window.__OWN, c: sessionStorage.getItem('cn_owned'), dbt: typeof db, au: typeof auth})));
    const labels = await page.$$eval('#cn-section .side-link', (a) => a.map((x) => x.textContent.trim()));
    if (theme === 'dark' && w === 390) {
      console.log(tag, JSON.stringify(labels));
      const exp = own ? ['Explore communities', 'My communities', 'Creator dashboard', 'Members', 'Courses', 'Indicators', 'Feed & events', 'Plans', 'Discord', 'Settings'] : ['Explore communities', 'My communities', 'Start a community', 'How it works'];
      ok(JSON.stringify(labels.filter((x) => x !== 'How it works' || !own)) === JSON.stringify(exp.filter((x) => x !== 'How it works' || !own)), tag + ' sidebar items');
      const order = await page.$$eval('.sidebar .side-label', (a) => a.map((x) => x.textContent.trim()));
      ok(order.join('|').includes('Community|Creator Hub|Account'), tag + ' section order ' + order.join('>'));
      ok(!(await page.$$eval('.sidebar .side-link', (a) => a.some((x) => /^(Communities|Creator Hub)$/.test(x.textContent.trim())))), tag + ' old items removed');
      // click every item
      const hrefs = await page.$$eval('#cn-section .side-link', (a) => a.map((x) => x.getAttribute('href')));
      for (const hr of hrefs) {
        const p2 = await ctx.newPage(); await p2.addInitScript(ownerStub(own));
        await p2.addInitScript(() => { try { localStorage.setItem('stryker_nav_authed', '1'); } catch (e) {} });
        await p2.goto(base + '/giveaways.html', { waitUntil: 'domcontentloaded' }); await p2.waitForTimeout(1200);
        await p2.evaluate(() => { const t = document.getElementById('dash-menu-toggle'); t && t.click(); }); await p2.waitForTimeout(300);
        const resp = [];
        p2.on('response', (r) => { if (r.request().resourceType() === 'document') resp.push(r.status()); });
        await p2.click('#cn-section a[href="' + hr + '"]'); await p2.waitForLoadState('domcontentloaded'); await p2.waitForTimeout(1800);
        const tabOn = await p2.evaluate(() => { const t = document.querySelector('.cx-tabs button.on'); return t ? t.textContent.trim() : ''; });
        const act = await p2.evaluate(() => { const a = document.querySelector('.sidebar .side-link.active[data-cn], .appnav-sh-item.on'); return a ? a.textContent.trim() : ''; });
        const h1 = await p2.evaluate(() => (document.querySelector('h1') || {}).textContent || '');
        ok(resp.every((s) => s < 400) && resp.length > 0, tag + ' click ' + hr + ' -> ' + p2.url().replace(base, '') + ' [' + resp.join(',') + '] tab="' + tabOn + '" h1="' + h1.trim().slice(0, 30) + '"');
        const more = await p2.$('#appnav-more');
        if (more && await more.isVisible()) {
          await more.click(); await p2.waitForTimeout(600);
          const on = await p2.$$eval('.appnav-sh-item.on', (a) => a.map((x) => x.querySelector('.appnav-sh-l').textContent));
          const want = { '/communities': 'Explore communities', '/communities?view=mine': 'My communities', '/creator': 'Creator dashboard', '/creator-new': 'Start a community', '/features/creators': 'How it works', '/c/harbor-lane?tab=feed': 'Feed & events' }[hr] || ((hr.match(/tab=(\w+)/) || [])[1] || '').replace(/^./, (c) => c.toUpperCase());
          ok(on.length === 1 && (hr.startsWith('/features') ? true : on[0] === want), tag + ' sheet active on ' + hr + ' = ' + JSON.stringify(on));
          if (hr === '/creator?c=harbor-lane&tab=courses' || hr === '/creator-new') await p2.screenshot({ path: OUT + '/sheet-' + tag + '-' + hr.replace(/\W+/g, '_') + '.png' });
        }
        await p2.close();
      }
    }
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(fails.length ? 'FAILS ' + fails.length : 'ALL PASS');
})().catch((e) => { console.error(e); process.exit(1); });
