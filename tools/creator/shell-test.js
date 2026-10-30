// Creator Hub pages inside the app shell: stubbed Firebase, real clicks, shots. Chrome under the shared lock.
// node tools/creator/shell-test.js <outdir> [tag]   (env ROOT=<repo copy to test>, e.g. a checkout of origin/main for "before" shots)
const fs = require('fs'), path = require('path'), http = require('http');
let src = fs.readFileSync(__dirname + '/landing-shots.js', 'utf8');
src = src.slice(0, src.indexOf('(async () => {')).replace("process.argv[2] || '/tmp/creators-shots'", "process.argv[2] || '/tmp/creator-shell'");
src = src.replace('const PORT = 8751', 'const PORT = 8771').replace("ownerUid: 'own'", "ownerUid: window.__OWN ? 'u1' : 'zz'") + '\nmodule.exports = { stubSrc, srv, OUT, PORT };';
const m = { exports: {} };
new Function('require', 'module', 'exports', '__dirname', 'process', src)(require, m, m.exports, __dirname, process);
const { stubSrc, srv, OUT, PORT } = m.exports;
srv.close();
const ROOT = process.env.ROOT || path.resolve(__dirname, '..', '..');
const MT = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const P2 = 8772;
const srv2 = http.createServer((q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u.startsWith('/c/')) u = '/c.html'; if (u === '/') u = '/index.html';
  let f = path.join(ROOT, u); if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': MT[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(P2, '127.0.0.1');
const { launch } = require('../tests/lib.js');
const fails = [];
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails.push(msg); };
const ACCT = { none: { status: 'none' }, active: { status: 'active', chargesEnabled: true, payoutsEnabled: true }, hang: 'hang' };
function stub(own, admin, acct) {
  let s = 'window.__OWN=' + own + ';window.__ACCT=' + JSON.stringify(ACCT[acct] || ACCT.none) + ';' + stubSrc(true)
    .replace(/window\.db = \{/, "S['admins/u1'] = " + (admin ? '{x:1}' : 'undefined') + "; if(!S['admins/u1']) delete S['admins/u1']; window.db = {")
    .replace("email: 'demo@example.com'", "email: 'stryker-qa-shell@example.com'")
    .replace("httpsCallable: () => () => Promise.resolve({ data: {} })", "httpsCallable: () => (d) => window.__ACCT === 'hang' ? new Promise(() => {}) : Promise.resolve({ data: d && d.action === 'status' ? { account: window.__ACCT, legalName: 'Gaurav Singh LLC' } : (d && d.action === 'adminList' ? { creators: [], mode: 'test' } : {}) })");
  return s;
}
(async () => {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const b = await launch();
  const sizes = [[390, 844], [412, 915], [1440, 900]];
  const shot = async (ctx, who, path_, name, w, theme, after, opts) => {
    opts = opts || {};
    const p = await ctx.newPage();
    await p.addInitScript(stub(who === 'owner', !!opts.admin, opts.acct || 'none'));
    await p.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_nav_authed', '1'); } catch (e) {} }, theme);
    await p.goto('http://127.0.0.1:' + P2 + path_, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(opts.wait || 2200);
    if (opts.then) await opts.then(p);
    const ov = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    await p.screenshot({ path: OUT + '/' + name + '-' + who + '-' + w + '-' + theme + '.png' });
    if (ov) console.log('  overflowX on ' + name + ' ' + who + ' ' + w + ' ' + theme);
    return p;
  };
  for (const theme of ['dark', 'light']) for (const [w, h] of sizes) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 });
    await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const tag = process.argv[3] || 'after';
    for (const who of ['owner', 'new']) {
      let p = await shot(ctx, who, '/giveaways', 'ref-giveaways', w, theme); await p.close();
      p = await shot(ctx, who, who === 'owner' ? '/creator?c=harbor-lane' : '/creator', tag + '-creator', w, theme); await p.close();
      p = await shot(ctx, who, '/communities', tag + '-communities', w, theme); await p.close();
      p = await shot(ctx, who, '/creator-new', tag + '-creator-new', w, theme); await p.close();
    }
    await ctx.close();
  }
  if (tag0() === 'before') { await b.close(); srv2.close(); return; }
  // behaviour checks (after only)
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5 });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const base = 'http://127.0.0.1:' + P2;
  const open = async (path_, own, admin, acct, w) => {
    const p = await ctx.newPage(); if (w) await p.setViewportSize({ width: w, height: 900 });
    await p.addInitScript(stub(own, admin, acct));
    await p.addInitScript(() => { try { localStorage.setItem('stryker_nav_authed', '1'); } catch (e) {} });
    const codes = []; p.on('response', (r) => { if (r.request().resourceType() === 'document') codes.push(r.status()); });
    await p.goto(base + path_, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1800); p.codes = codes; return p;
  };
  const chrome = (p) => p.evaluate(() => ({ marketing: !!document.querySelector('#site-nav, nav.nav, footer'), topnav: !!document.querySelector('.mobile-topnav'), sidebar: !!document.querySelector('aside.sidebar'), dock: !!document.querySelector('#appnav-dock'), shellHidden: !!document.querySelector('.dash-shell.gate-pending'), h1: (document.querySelector('h1') || {}).textContent }));
  for (const [pg, own, adm] of [['/creator?c=harbor-lane', true, false], ['/creator', false, false], ['/creator-new', false, false], ['/creator-admin', true, true], ['/communities', false, false]]) {
    for (const w of [390, 1440]) {
      const p = await open(pg, own, adm, 'none', w); const c = await chrome(p);
      ok(!c.marketing && c.topnav && c.sidebar && c.dock && !c.shellHidden, pg + ' ' + w + ' app chrome only ' + JSON.stringify(c));
      await p.close();
    }
  }
  // every tab of the dashboard: real click, tab shown, URL, sidebar active
  const tabs = ['dash', 'settings', 'plans', 'members', 'invites', 'indicators', 'courses', 'discord', 'mods'];
  const p = await open('/creator?c=harbor-lane', true, false, 'none', 1440);
  for (const t of tabs) {
    await p.click('#hb-tabs button[data-t=' + t + ']'); await p.waitForTimeout(500);
    const r = await p.evaluate(() => ({ on: (document.querySelector('#hb-tabs .active') || {}).textContent, url: location.search, act: [].map.call(document.querySelectorAll('.sidebar .side-link.active'), (a) => a.textContent.trim()), h1: document.querySelector('h1').textContent.trim() }));
    const want = { dash: 'Creator dashboard', settings: 'Settings', plans: 'Plans', members: 'Members', invites: 'Creator dashboard', indicators: 'Indicators', courses: 'Courses', discord: 'Discord', mods: 'Creator dashboard' }[t];
    ok(r.on && r.url.indexOf('tab=' + t) >= 0 === (t !== 'dash') && r.act.length === 1 && r.act[0] === want, 'tab ' + t + ' -> ' + JSON.stringify(r));
  }
  ok((await p.evaluate(() => document.querySelector('h1').textContent)).startsWith('Creator Hub'), 'h1 Creator Hub · name');
  await p.close();
  // sidebar menu: real click each creator item from the dashboard page
  for (const href of ['/communities', '/communities?view=mine', '/creator', '/creator?c=harbor-lane&tab=members', '/creator?c=harbor-lane&tab=courses', '/creator?c=harbor-lane&tab=indicators', '/creator?c=harbor-lane&tab=plans', '/creator?c=harbor-lane&tab=discord', '/creator?c=harbor-lane&tab=settings', '/c/harbor-lane?tab=feed', '/creator-new']) {
    const q = await open('/creator?c=harbor-lane', true, false, 'none', 1440); const codes = [];
    q.on('response', (r) => { if (r.request().resourceType() === 'document') codes.push(r.status()); });
    const sel = '#cn-section a[href="' + href + '"]';
    if (!(await q.$(sel))) { ok(href === '/creator-new', 'menu has ' + href); await q.close(); continue; }
    await q.evaluate(() => { const t = document.getElementById('dash-menu-toggle'); if (t && t.offsetParent) t.click(); }); await q.waitForTimeout(400);
    await q.click(sel); await q.waitForLoadState('domcontentloaded'); await q.waitForTimeout(1800);
    const r = await q.evaluate(() => ({ act: [].map.call(document.querySelectorAll('.sidebar .side-link.active[data-cn]'), (a) => a.textContent.trim()), tab: (document.querySelector('#hb-tabs .active') || {}).textContent || '', h1: document.querySelector('h1').textContent.trim().slice(0, 28) }));
    ok(codes.every((c) => c < 400) && codes.length > 0 && r.act.length === 1, 'menu click ' + href + ' ' + JSON.stringify(r) + ' [' + codes + ']');
    await q.close();
  }
  // payouts states
  for (const a of ['none', 'active']) {
    const q = await open('/creator?c=harbor-lane', true, false, a, 1440); await q.waitForTimeout(800);
    const t = await q.evaluate(() => { const c = document.querySelector('.cp-card'); return c ? c.textContent.replace(/\s+/g, ' ') : 'NO CARD'; });
    ok(!/Checking your payout/.test(t) && (a === 'none' ? /Connect Stripe/.test(t) : /Active/.test(t)), 'payouts ' + a + ': ' + t);
    if (!only || only.includes('pay')) await q.screenshot({ path: OUT + '/payouts-' + a + '-1440-dark.png' });
    await q.close();
  }
  const hq = await open('/creator?c=harbor-lane', true, false, 'hang', 390); await hq.waitForTimeout(16500);
  const ht = await hq.evaluate(() => (document.querySelector('.cp-card') || {}).textContent || 'NO CARD');
  ok(!/Checking your payout/.test(ht) && /Try again/.test(ht), 'payouts hang resolves: ' + ht.replace(/\s+/g, ' ').slice(0, 100));
  await hq.screenshot({ path: OUT + '/payouts-timeout-390-dark.png' }); await hq.close();
  // phone tabs: fade edges + horizontal scroll, no page overflow
  const tq = await open('/creator?c=harbor-lane', true, false, 'none', 390);
  const tr = await tq.evaluate(() => { const t = document.getElementById('hb-tabs'); return { fadeR: t.classList.contains('fade-r'), sw: t.scrollWidth, cw: t.clientWidth, pageOv: document.documentElement.scrollWidth > innerWidth + 1 }; });
  ok(tr.fadeR && tr.sw > tr.cw && !tr.pageOv, 'phone tabs fade-r and scroll ' + JSON.stringify(tr)); await tq.close();
  // moderation tabs + communities tab
  const aq = await open('/creator-admin', true, true, 'none', 1440);
  for (const t of ['rp', 'pay', 'cm']) { await aq.click('.level-tabs button[data-t=' + t + ']'); await aq.waitForTimeout(400); ok(await aq.evaluate((x) => document.querySelector('.level-tabs .active').dataset.t === x, t), 'admin tab ' + t); }
  ok(await aq.evaluate(() => [].some.call(document.querySelectorAll('.sidebar .side-link.active'), (a) => /moderation/i.test(a.textContent))), 'admin menu active = Creator moderation'); await aq.close();
  const cq = await open('/communities?view=mine', false, false, 'none', 1440);
  ok(await cq.evaluate(() => (document.querySelector('.sidebar .side-link.active[data-cn]') || {}).textContent.trim() === 'My communities'), 'communities?view=mine active = My communities');
  await cq.click('#cd-tabs button[data-t=all]'); await cq.waitForTimeout(400);
  ok(await cq.evaluate(() => (document.querySelector('.sidebar .side-link.active[data-cn]') || {}).textContent.trim() === 'Explore communities'), 'switch to All -> Explore communities active'); await cq.close();
  await b.close(); srv2.close();
  console.log(fails.length ? 'FAILS ' + fails.length : 'ALL PASS');
})().catch((e) => { console.error(e); process.exit(1); });
function tag0() { return process.argv[3] || 'after'; }
