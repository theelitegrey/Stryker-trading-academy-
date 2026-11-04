// App shell audit (Owner order 2026-10-31: "every page opens inside the app, shouldn't happen in future").
//
// 1. Finds every page that the app links to: app-nav.js (More sheet, side menu, creator menu), the dock,
//    and every href in every page that already has the app shell (side menus, cards, account menu, in-page links),
//    plus href strings inside assets/*.js.
// 2. Loads each target SIGNED IN (stubbed Firebase, stored nav flag) at 390 and 1440 and asserts:
//      app header (.mobile-topnav) + side menu (aside.sidebar) are there, the marketing header
//      (nav#site-nav / .nav-links) and marketing footer are NOT visible, the bottom dock shows at 390,
//      and the page did not bounce to another URL.
//    Pages in tools/tests/app-shell-allowlist.json:
//      "marketing": intentionally marketing even when signed in (not asserted)
//      "dual":      public + app pages: signed in = app shell (asserted), signed out = marketing header (asserted)
//      "ignore":    link targets that are not pages a member browses (login, redirects, overlays)
// 3. Every dual page is also loaded signed out and must show the marketing header and no app chrome.
//
// node tools/tests/app-shell-audit.js [--list] [--shots <dir>]      exit code 1 on any failure
// Needs playwright-core + a Chromium (lib.js finds one). Run under: tools/chrome-slot.sh
const fs = require('fs'), path = require('path'), http = require('http');
const { ROOT, launch } = require('./lib.js');

const AL = JSON.parse(fs.readFileSync(path.join(__dirname, 'app-shell-allowlist.json'), 'utf8'));
const argv = process.argv.slice(2);
const LIST = argv.includes('--list');
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;
const WIDTHS = argv.includes('--widths') ? argv[argv.indexOf('--widths') + 1].split(',').map(Number).filter((n) => n >= 320) : [390, 1440];
if (!WIDTHS.length) throw new Error('--widths needs a comma-separated viewport list');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// ---- 1. link discovery --------------------------------------------------------------------------------
const pages = new Set(fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5)));
if (fs.existsSync(path.join(ROOT, 'features'))) fs.readdirSync(path.join(ROOT, 'features')).filter((f) => f.endsWith('.html')).forEach((f) => pages.add('features/' + f.slice(0, -5)));
const hasShell = (html) => /dash-nav\.js/.test(html) && /<aside[^>]*class="sidebar/.test(html);
const norm = (h) => {
  h = h.split('#')[0].split('?')[0].trim();
  if (!h || /^(https?:|mailto:|tel:|javascript:|\/\/)/.test(h)) return null;
  h = h.replace(/^\.?\//, '').replace(/\/$/, '').replace(/\.html$/, '');
  return pages.has(h) ? h : null;
};
const sources = {};                       // page -> Set of places that link to it
const add = (t, from) => { if (t) (sources[t] = sources[t] || new Set()).add(from); };
const HREF = /href\s*=\s*\\?["']([^"'\\]+)\\?["']/g;
const rootHtml = [...pages].map((p) => [p, fs.readFileSync(path.join(ROOT, p + '.html'), 'utf8')]);
// Marketing header/footer links (hidden when signed in) do not count, and public-and-app pages (dual) only
// contribute through their shell, which is the same menu every app page has.
const stripPub = (h) => h.replace(/<nav class="nav[^"]*" id="site-nav">[\s\S]*?<\/nav>/g, '').replace(/<footer[\s\S]*?<\/footer>/g, '');
for (const [p, html] of rootHtml) {
  if (!hasShell(html) && !/id="appnav-dock"/.test(html)) continue;
  if (AL.dual[p]) continue;
  for (const m of stripPub(html).matchAll(HREF)) add(norm(m[1]), p);
}
// app-nav.js: More sheet rows are ['file', 'Label', ...]; plus every href inside it
const appNav = fs.readFileSync(path.join(ROOT, 'assets/app-nav.js'), 'utf8');
for (const m of appNav.matchAll(/\['([a-z0-9-]+)', '[^']+', '[^']*'/g)) add(norm(m[1]), 'app-nav.js');
for (const m of appNav.matchAll(/\['[a-z]+', '[^']+', '[^']*', '(\/[^']+)'\]/g)) add(norm(m[1]), 'app-nav.js');
for (const m of appNav.matchAll(HREF)) add(norm(m[1]), 'app-nav.js');
// other shell scripts that write links (account menu, admin menu, notifications, dashboard cards)
for (const f of fs.readdirSync(path.join(ROOT, 'assets')).filter((x) => x.endsWith('.js') && !/^(chart|vela|bt-|admin|seo|site-pages|creator-(admin|courses|ind|pay)|indicators-admin|models-admin)/.test(x))) {
  const s = fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8');
  for (const m of s.matchAll(HREF)) add(norm(m[1]), f);
  for (const m of s.matchAll(/(?:href|location(?:\.href)?)\s*=\s*['"]([^'"]+)['"]/g)) add(norm(m[1]), f);
  for (const m of s.matchAll(/['"`]\/?([a-z][a-z0-9-]*)\.html\?[^'"`]*['"`]/g)) add(norm(m[1]), f);   // 'model.html?id=' style links
}
// dual pages are checked even if nothing links to them yet
for (const p of Object.keys(AL.dual)) add(p, 'allowlist.dual');

const ignore = new Set(Object.keys(AL.ignore || {}));
const marketing = new Set(Object.keys(AL.marketing || {}));
const targets = Object.keys(sources).filter((t) => !ignore.has(t) && (!process.env.ONLY || process.env.ONLY.split(',').includes(t))).sort();
if (LIST) { targets.forEach((t) => console.log(t.padEnd(30), marketing.has(t) ? 'marketing' : AL.dual[t] ? 'dual' : 'app', ' <- ' + [...sources[t]].slice(0, 4).join(', '))); process.exit(0); }

// ---- 2. server + stub ---------------------------------------------------------------------------------
const MT = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u.startsWith('/c/')) u = '/c.html'; if (u === '/') u = '/index.html';
  let f = path.join(ROOT, u); if ((!fs.existsSync(f) || fs.statSync(f).isDirectory()) && fs.existsSync(f + '.html')) f += '.html';   // /indicators: indicators.html beside indicators/ (as Cloudflare Pages serves it)
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': MT[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});

function stubSrc(signed) {
  return '(' + function (SIGNED) {
    const ts = () => ({ toMillis: () => Date.now(), toDate: () => new Date(), seconds: Math.floor(Date.now() / 1000) });
    const snap = (id, path) => ({ exists: !/^(bannedUsers|deletedUsers|blocked)/.test(path || ''), id, data: () => ({ plan: 'pro', role: 'admin', status: 'active', name: 'Audit', displayName: 'Audit', email: 'audit@example.com', onboarding: { seen: true, skipped: true, completedAt: 'TS' }, tour: { seen: true, done: true } }) });
    const empty = { empty: true, size: 0, docs: [], forEach() {} };
    function col(p) { const o = { doc: (id) => doc(p + '/' + id), get: () => Promise.resolve(empty), add: () => Promise.resolve({ id: 'x' }), onSnapshot: (cb) => { try { setTimeout(() => cb(empty), 5); } catch (e) {} return () => {}; } };
      ['where', 'orderBy', 'limit', 'startAfter', 'endBefore'].forEach((k) => { o[k] = () => o; }); return o; }
    function doc(p) { return { id: p.split('/').pop(), get: () => Promise.resolve(snap(p.split('/').pop(), p)), set: () => Promise.resolve(), update: () => Promise.resolve(), delete: () => Promise.resolve(), collection: (n) => col(p + '/' + n), onSnapshot: (cb) => { setTimeout(() => cb(snap('x')), 5); return () => {}; } }; }
    window.db = { collection: (n) => col(n), doc: (p) => doc(p), batch: () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() }), runTransaction: (fn) => Promise.resolve() };
    const user = SIGNED ? { uid: 'u1', email: 'audit@example.com', displayName: 'Audit', emailVerified: true, getIdToken: () => Promise.resolve('x') } : null;
    window.auth = { currentUser: user, onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; }, setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve() };
    window.firebase = { apps: [], initializeApp: () => ({}), app: () => ({ functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }) }),
      firestore: Object.assign(() => window.db, { FieldValue: { serverTimestamp: () => 'TS', increment: (n) => n, delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' }, Timestamp: { now: ts, fromDate: ts } }),
      auth: Object.assign(() => window.auth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } } }), messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} }), functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }) };
  }.toString() + ')(' + (signed ? 'true' : 'false') + ')';
}

// ---- 3. the audit -------------------------------------------------------------------------------------
const POOL = +process.env.POOL || 6;   // pages at once inside one width x signed-in/out pass
const fails = [], rows = [];
const ok = (c, t) => { if (!c) fails.push(t); return c; };
const pathOf = (t) => '/' + t;
const probe = () => {
  const vis = (e) => { if (!e) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const q = (s) => document.querySelector(s);
  const pub = [...document.querySelectorAll('nav.nav, #site-nav, .cx-pubnav')].some(vis);
  const pubFoot = [...document.querySelectorAll('footer')].some((f) => vis(f) && f.querySelector('.footer-grid, .footer-links'));
  return { url: location.pathname, top: vis(q('.mobile-topnav')), side: !!q('aside.sidebar'), sideInFlow: !!q('aside.sidebar') && getComputedStyle(q('aside.sidebar')).position === 'static', dock: vis(q('#appnav-dock')), hasDock: !!q('#appnav-dock'), pub, pubFoot,
    ov: document.documentElement.scrollWidth > innerWidth + 1 };
};

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browsers = [];
  const run = async (w, signed, list) => {
    const b = await launch(); browsers.push(b);   // one browser per pass: a single Chrome process was the bottleneck
    const ctx = await b.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, deviceScaleFactor: 1 });
    await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await ctx.route(/\.(png|jpe?g|webp|gif|svg|woff2?|mp4|webm)(\?|$)/, (r) => r.abort());   // layout probe needs no pictures/fonts (faster)
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.addInitScript(stubSrc(signed));
    await ctx.addInitScript(([s, th]) => { try { localStorage.setItem('stryker_theme', th); if (s) localStorage.setItem('stryker_nav_authed', '1'); else localStorage.removeItem('stryker_nav_authed'); } catch (e) {} }, [signed, process.env.THEME || 'night']);
    const queue = list.slice();
    const worker = async () => { for (let t; (t = queue.shift()) !== undefined;) {
      const p = await ctx.newPage();
      try {
        await p.goto(base + pathOf(t), { waitUntil: 'domcontentloaded', timeout: 60000 });
        // shell markers (app header, sidebar, marketing nav) or a 900 ms cap, then a short settle for redirects/late class flips
        await p.waitForFunction(() => document.querySelector('.mobile-topnav, aside.sidebar, nav.nav, #site-nav, .cx-pubnav'), null, { timeout: 900 }).catch(() => {});
        await p.waitForTimeout(250);
        let c = await p.evaluate(probe);
        // a loaded machine can be slow to run the shell scripts: give a page that looks wrong one more, longer look before failing it
        if (signed ? !(c.side && (c.top || w >= 821)) : !c.pub) { await p.waitForTimeout(2500); c = await p.evaluate(probe); }
        const isDual = !!AL.dual[t], isMkt = marketing.has(t);
        const tag = t + ' ' + (signed ? 'in' : 'out') + ' ' + w;
        if (signed && !isMkt) {
          const bad = [];
          if (c.url.replace(/\.html$/, '') !== pathOf(t)) bad.push('bounced to ' + c.url);
          if (!c.top && !(w >= 821 && c.side) && !(AL.noheader || {})[t]) bad.push('no app header');
          if (!c.side) bad.push('no side menu');
          if (c.sideInFlow) bad.push('side menu is not a drawer (sidebar must be a direct child of .dash-shell)');
          if (c.pub) bad.push('MARKETING HEADER visible');
          if (c.pubFoot) bad.push('marketing footer visible');
          if (w < 821 && c.hasDock && !c.dock) bad.push('dock hidden');
          if (c.ov && !(AL.nooverflow || {})[t]) bad.push('horizontal overflow');
          rows.push(tag + ' ' + (bad.length ? 'FAIL ' + bad.join('; ') : 'ok'));
          ok(!bad.length, tag + ': ' + bad.join('; '));
        } else if (!signed && isDual) {
          const bad = [];
          if (!c.pub) bad.push('signed-out marketing header missing');
          if (c.top || c.dock) bad.push('app chrome visible to a signed-out visitor');
          rows.push(tag + ' ' + (bad.length ? 'FAIL ' + bad.join('; ') : 'ok'));
          ok(!bad.length, tag + ': ' + bad.join('; '));
        }
        if (SHOTS && (isDual || !isMkt) && (signed || isDual)) await p.screenshot({ path: path.join(SHOTS, t.replace(/\//g, '_') + '-' + (signed ? 'in' : 'out') + '-' + w + '.png') });
      } catch (e) { ok(false, t + ' ' + (signed ? 'in' : 'out') + ' ' + w + ': ' + String(e.message).split('\n')[0]); rows.push(t + ' ERROR ' + e.message.split('\n')[0]); }
      await p.close();
    } };
    await Promise.all(Array.from({ length: POOL }, worker));
    await ctx.close();
  };
  // SHARD=i/n (1-based): this job takes every n-th page, so CI can split the audit across parallel runners
  const [si, sn] = (process.env.SHARD || '1/1').split('/').map(Number);
  const mine = (_, k) => k % sn === si - 1;
  const appPages = targets.filter((t) => !marketing.has(t)).filter(mine);
  const dual = Object.keys(AL.dual).filter((t) => pages.has(t)).filter(mine);
  // every width x signed-in/out pass runs at once; rows/fails are sorted below so the output does not depend on timing
  await Promise.all([...WIDTHS.map((w) => run(w, true, appPages)), ...WIDTHS.map((w) => run(w, false, dual))]);
  rows.sort(); fails.sort();
  await Promise.all(browsers.map((x) => x.close())); srv.close();
  rows.filter((r) => /FAIL|ERROR/.test(r)).forEach((r) => console.log(r));
  console.log('app-shell-audit: ' + appPages.length + ' app/dual pages signed in x' + WIDTHS.length + ' widths, ' + dual.length + ' dual pages signed out x' + WIDTHS.length + ', ' + marketing.size + ' marketing-only allowlisted, ' + fails.length + ' failure(s)');
  if (fails.length) { console.log('FAILED. A member-facing page must carry the app shell (see docs/DESIGN-STANDARD.md). If a page is meant to stay marketing, add it to tools/tests/app-shell-allowlist.json with a reason.'); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
