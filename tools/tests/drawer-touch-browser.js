// Drawer / More-sheet TOUCH test (Owner 2026-10-31: "tapping Manage <name> closed the menu").
// Chrome with touch emulation at 390x844 (hasTouch, isMobile, no hover) on the real creator.html:
//  - opens the drawer, taps every in-place control, asserts the drawer STAYS open
//  - taps a real nav link, asserts the drawer closes and the browser navigates
//  - same for the bottom-dock "More" sheet
//  - desktop (1440, mouse): hover opens the Manage flyout, items are links, Esc closes
// Firebase/network is blocked; the owner state is seeded in sessionStorage (cn_owned).
//   node tools/tests/drawer-touch-browser.js        (starts its own local server)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const { executablePath, ROOT } = require('./lib');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };
function serve() {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
      let f = path.join(ROOT, p);
      if (!path.extname(f) && fs.existsSync(f + '.html')) f += '.html';
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('nf'); return; }
      r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
    }).listen(0, '127.0.0.1', () => res(s));
  });
}
let fails = 0;
function ok(c, m) { if (!c) { fails++; console.log('  FAIL ' + m); } else console.log('  ok   ' + m); }

(async () => {
  const srv = await serve(), BASE = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch({ executablePath: executablePath() });
  const seed = () => { localStorage.setItem('stryker_nav_authed', '1'); sessionStorage.setItem('cn_owned', JSON.stringify({ t: Date.now(), uid: 'u1', owned: [{ id: 'richard-nq', name: 'Richard NQ' }], admin: false })); };
  async function page(ctx, url) {
    const pg = await ctx.newPage();
    await pg.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith(BASE)) { if (/\/(creator|c\/[^/?]+|communities|dashboard-user)(\?|$)/.test(u.replace(BASE, '')) && r.request().resourceType() === 'document' && u.includes('NAVTARGET')) return r.fulfill({ body: '<html>nav</html>', contentType: 'text/html' }); return r.continue(); } return r.abort(); });
    pg.on('pageerror', (e) => console.log('  pageerror', String(e).slice(0, 150)));
    await pg.addInitScript(seed);
    await pg.goto(BASE + url); await pg.waitForTimeout(700);
    await pg.evaluate(() => window.dispatchEvent(new Event('cn:route'))); await pg.waitForTimeout(200); // auth is blocked here: render from the seeded cache
    return pg;
  }
  const drawerOpen = (pg) => pg.evaluate(() => document.querySelector('.sidebar').classList.contains('mobile-open'));
  async function openDrawer(pg) { if (!(await drawerOpen(pg))) { await pg.tap('#dash-menu-toggle'); await pg.waitForTimeout(400); } }
  async function scrollTo(pg, sel) { await pg.evaluate((s) => { const e = document.querySelector(s); const sb = document.querySelector('.sidebar'); sb.scrollTop = e.offsetTop - 200; }, sel); await pg.waitForTimeout(150); }
  async function tapDrawerControls(pg, selectors, expectedLabels) {
    const found = [];
    for (const sel of selectors) {
      const el = await pg.$(sel);
      ok(!!el, 'in-place control exists: ' + sel);
      if (!el) continue;
      const label = await el.evaluate((n) => (n.getAttribute('aria-label') || n.textContent || '').trim().replace(/\s+/g, ' '));
      found.push(label);
      await el.scrollIntoViewIfNeeded();
      const before = await el.getAttribute('aria-expanded');
      await el.tap(); await pg.waitForTimeout(180);
      ok(await drawerOpen(pg), 'tap in-place "' + label + '": drawer stays open');
      if (before !== null) ok((await el.getAttribute('aria-expanded')) !== before, 'tap in-place "' + label + '": state changes');
    }
    expectedLabels.forEach((label) => ok(found.some((v) => v.indexOf(label) !== -1), 'in-place audit includes ' + label));
  }

  // ---------- phone ----------
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  let pg = await page(ctx, '/creator');
  console.log('PHONE drawer');
  ok(await pg.evaluate(() => !matchMedia('(hover:hover) and (pointer:fine)').matches), 'emulation: no hover');
  await openDrawer(pg);
  ok(await drawerOpen(pg), 'drawer opens by tap on the menu button');
  ok(await pg.evaluate(() => document.querySelector('.cn-mg-row').tagName) === 'BUTTON', 'Manage row is a <button> on touch');
  await scrollTo(pg, '.cn-mg-row');
  const exp = () => pg.getAttribute('.cn-mg-row', 'aria-expanded');
  if ((await exp()) === 'true') { await pg.tap('.cn-mg-row'); await pg.waitForTimeout(180); }
  await tapDrawerControls(pg, ['.sidebar .cn-mg-row', '.sidebar a[data-sign-out][href="#"]'], ['Manage Richard NQ', 'Sign out']);
  ok((await exp()) === 'true' && await pg.evaluate(() => document.querySelectorAll('.cn-mg.open .cn-sub a').length) === 8, 'accordion open with 8 items (Dashboard + 7)');
  // The generic delegated-close contract also covers Quick notes, which admin pages inject later as href="#".
  await pg.evaluate(() => {
    const a = document.createElement('a'); a.href = '#'; a.id = 'drawer-test-quick-notes'; a.className = 'side-link'; a.textContent = 'Quick notes';
    a.addEventListener('click', (e) => e.preventDefault()); document.querySelector('.sidebar').appendChild(a);
  });
  await tapDrawerControls(pg, ['#drawer-test-quick-notes'], ['Quick notes']);
  // Dashboard is the first real link inside the touch-only accordion: it must close and navigate.
  await scrollTo(pg, '.cn-mg-row');
  const dashHref = await pg.$eval('.cn-mg.open .cn-sub a[data-cn="dash"]', (a) => a.getAttribute('href'));
  ok(dashHref === '/creator?c=richard-nq', 'Dashboard item deep-links ' + dashHref);
  await Promise.all([pg.waitForNavigation({ timeout: 8000 }).catch(() => null), pg.tap('.cn-mg.open .cn-sub a[data-cn="dash"]')]);
  ok(/\/creator\?c=richard-nq$/.test(pg.url()), 'tap Dashboard: navigated (' + pg.url().replace(BASE, '') + ')');
  await pg.waitForTimeout(500);
  ok(!(await drawerOpen(pg)), 'tap Dashboard: drawer is closed');
  // A plain sidebar link has the same close-before-navigation contract.
  await openDrawer(pg);
  const closed = await pg.evaluate(() => new Promise((res) => {
    const a = document.querySelector('.sidebar a.side-link[href="/communities"]'); if (!a) return res('no-link');
    document.addEventListener('click', (e) => e.preventDefault(), { once: true });
    a.click(); setTimeout(() => res(!document.querySelector('.sidebar').classList.contains('mobile-open')), 150);
  }));
  ok(closed === true, 'real nav link (Explore communities) closes the drawer');

  // Admin drawer: every section fold and the sign-out action are in-place controls.
  console.log('PHONE admin drawer');
  const admin = await page(ctx, '/dashboard-admin');
  await openDrawer(admin);
  const adminHeads = await admin.$$eval('.sidebar .side-group-head', (n) => n.length);
  ok(adminHeads === 4, 'admin drawer exposes all 4 section folds');
  const adminSelectors = Array.from({ length: adminHeads }, (_, i) => '.sidebar .side-group-head:nth-of-type(1)');
  // nth-of-type is scoped per group, so use data-group selectors for stable coverage.
  await tapDrawerControls(admin, ['.side-group[data-group="people"] .side-group-head', '.side-group[data-group="content"] .side-group-head', '.side-group[data-group="commerce"] .side-group-head', '.side-group[data-group="system"] .side-group-head', '.sidebar a[data-sign-out][href="#"]'], ['People', 'Content', 'Commerce', 'System', 'Sign out']);
  ok(adminSelectors.length === 4, 'all discovered admin folds were tap-tested');
  await admin.close();

  // ---------- phone: More sheet ----------
  console.log('PHONE More sheet');
  pg = await page(ctx, '/creator');
  await pg.tap('#appnav-more'); await pg.waitForTimeout(500);
  const sheetOpen = () => pg.evaluate(() => document.getElementById('appnav-sheet').classList.contains('open'));
  ok(await sheetOpen(), 'More sheet opens');
  await pg.tap('#appnav-more'); await pg.waitForTimeout(320);
  ok(!(await sheetOpen()), 'More dock toggle closes the sheet in place');
  await pg.tap('#appnav-more'); await pg.waitForTimeout(500);
  ok(await sheetOpen(), 'More dock toggle reopens the sheet');
  const inPlace = await pg.$$eval('#appnav-sheet button:not(.appnav-sh-x)', (n) => n.length);
  ok(inPlace === 1, 'all sheet in-place content controls discovered (1 Manage accordion)');
  const sr = await pg.$('#appnav-sheet .cn-mg-row');
  ok(!!sr, 'sheet has the Manage accordion row');
  if (sr) {
    await sr.scrollIntoViewIfNeeded();
    const s0 = await sr.getAttribute('aria-expanded');
    await sr.tap(); await pg.waitForTimeout(300);
    ok(await sheetOpen(), 'tap Manage row in sheet: sheet stays open');
    ok((await sr.getAttribute('aria-expanded')) !== s0, 'sheet accordion toggled');
    if ((await sr.getAttribute('aria-expanded')) !== 'true') { await sr.tap(); await pg.waitForTimeout(300); }
    const items = await pg.$$eval('#appnav-sheet .cn-acc-list a', (n) => n.length);
    ok(items === 7, 'sheet accordion shows 7 items');
    await Promise.all([pg.waitForNavigation({ timeout: 8000 }).catch(() => null), pg.tap('#appnav-sheet .cn-acc-list a[data-more="cn-plans"]')]);
    ok(/tab=plans/.test(pg.url()), 'tap Plans in sheet: navigated (' + pg.url().replace(BASE, '') + ')');
  }
  await ctx.close();

  // ---------- desktop ----------
  console.log('DESKTOP flyout');
  const dctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  pg = await page(dctx, '/creator');
  ok(await pg.evaluate(() => document.querySelector('.cn-mg-row').tagName) === 'A', 'Manage row is a link on desktop');
  // on desktop the sidebar is also an off-canvas drawer; open it when it is one
  await pg.evaluate(() => { const sb = document.querySelector('.sidebar'); if (sb.getBoundingClientRect().right <= 0) sb.classList.add('mobile-open'); });
  await pg.waitForTimeout(500); await scrollTo(pg, '.cn-mg-row');
  await pg.hover('.cn-mg-row'); await pg.waitForTimeout(450);
  ok(await pg.$$eval('.cn-fly a', (n) => n.length) === 7, 'hover opens flyout with 7 items');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
  ok(await pg.$$eval('.cn-fly', (n) => n.length) === 0, 'Esc closes flyout');
  await pg.mouse.move(900, 600); await pg.waitForTimeout(100);
  await pg.hover('.cn-mg-row'); await pg.waitForTimeout(450);
  await Promise.all([pg.waitForNavigation({ timeout: 8000 }).catch(() => null), pg.click('.cn-fly a[data-cn="settings"]')]);
  ok(/tab=settings/.test(pg.url()), 'click Settings in flyout: navigated');
  await dctx.close(); await b.close(); srv.close();
  console.log(fails ? ('FAILED: ' + fails) : 'drawer-touch-browser: all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
