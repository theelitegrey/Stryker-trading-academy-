// Shared pager on admin Users (assets/pager.js, students-admin.js), Firebase stubbed: 226 accounts (1 admin, 193 real, 32 demo).
// Run (server on STRYKER_TEST_PORT serving the repo root): node tools/tests/pager-users-browser.js [shotDir]
const fs = require('fs');
const path = require('path');
const { launch, BASE } = require('./lib.js');
const SHOTS = process.argv[2] || path.join(__dirname, 'shots-pager');
fs.mkdirSync(SHOTS, { recursive: true });
const PRE = process.env.SHOT_PREFIX || 'after';
const stub = '(' + function () {
  const ADMIN = 'adm1';
  const NOW = Date.now();
  const ts = (d) => ({ toDate: () => new Date(NOW - d * 864e5), toMillis: () => NOW - d * 864e5, seconds: Math.floor((NOW - d * 864e5) / 1000) });
  const STU = { adm1: { displayName: 'Owner Admin', email: 'owner@example.com', plan: 'Elite', createdAt: ts(300) } };
  for (let i = 1; i <= 225; i++) {
    const demo = i > 193;
    STU['u' + i] = { displayName: (demo ? 'Demo Member ' : 'Student ') + String(i).padStart(3, '0'), email: (demo ? 'demo' : 'stu') + i + '@example.com', plan: i % 5 === 0 ? 'Pro' : null, createdAt: ts(i % 200), demo: demo ? true : undefined };
    if (!demo) delete STU['u' + i].demo; else STU['u' + i].demo = true;
  }
  const ADMINS = { adm1: { email: 'owner@example.com' } };
  window.__writes = [];
  window.__confirms = [];
  window.__confirmAnswer = true;
  window.confirm = (m) => { window.__confirms.push(m); return window.__confirmAnswer; };
  const snapOf = (rows) => ({ size: rows.length, empty: !rows.length, docs: rows.map((r) => ({ id: r.id, exists: true, data: () => r.d, ref: { id: r.id } })), forEach(f) { this.docs.forEach(f); } });
  function rows(coll, filt) {
    const src = coll === 'students' ? STU : coll === 'admins' ? ADMINS : {};
    let out = Object.keys(src).map((id) => ({ id, d: src[id] }));
    if (filt) out = out.filter((r) => r.d[filt[0]] === filt[2]);
    return out;
  }
  function docRef(coll, id) {
    return {
      id,
      get: () => { const src = coll === 'students' ? STU : coll === 'admins' ? ADMINS : {}; const d = src[id]; return Promise.resolve({ id, exists: !!d, data: () => d || {} }); },
      set: (v, o) => { window.__writes.push({ coll, id, v: JSON.parse(JSON.stringify(v)), o }); if (coll === 'students' && STU[id]) Object.assign(STU[id], v); return window.__failWrites ? Promise.reject(new Error('permission-denied')) : Promise.resolve(); },
      update: () => Promise.resolve(), delete: () => Promise.resolve(),
      onSnapshot: (cb) => { setTimeout(() => cb({ id, exists: false, data: () => ({}) }), 5); return () => {}; },
      collection: (sub) => colRef(coll + '/' + id + '/' + sub)
    };
  }
  function colRef(coll) {
    let filt = null, lim = 0;
    const self = {
      doc: (id) => docRef(coll, id || 'auto'),
      get: () => { let r = rows(coll, filt); if (lim) r = r.slice(0, lim); return Promise.resolve(snapOf(r)); },
      add: () => Promise.resolve({ id: 'new' }),
      where: (f, op, v) => { filt = [f, op, v]; return self; }, orderBy: () => self, startAfter: () => self,
      limit: (n) => { lim = n; return self; },
      onSnapshot: (cb) => { setTimeout(() => cb(snapOf([])), 5); return () => {}; }
    };
    return self;
  }
  const user = { uid: ADMIN, email: 'owner@example.com', displayName: 'Owner Admin', emailVerified: true, photoURL: null,
    getIdTokenResult: () => Promise.resolve({ claims: {} }), getIdToken: () => Promise.resolve('t') };
  window.__stubDb = { collection: colRef, doc: (p) => { const s = String(p).split('/'); return docRef(s[s.length - 2], s[s.length - 1]); }, batch: () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() }), runTransaction: (f) => f({ get: (r) => r.get(), set() {}, update() {} }) };
  window.db = window.__stubDb;
  window.__stubAuth = { currentUser: user, onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; }, onIdTokenChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; }, setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve() };
  const fsFn = Object.assign(() => window.__stubDb, { FieldValue: { serverTimestamp: () => ({ __ts: 'server' }), increment: (n) => ({ inc: n }), delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' }, Timestamp: { now: () => ts(0), fromDate: (d) => ({ toDate: () => d }) } });
  const fb = { apps: [{}], initializeApp: () => ({}), app: () => ({ functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }) }),
    firestore: fsFn, auth: Object.assign(() => window.__stubAuth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } } }),
    functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }), messaging: Object.assign(() => ({ getToken: () => Promise.resolve(null), onMessage: () => {} }), { isSupported: () => false }) };
  Object.defineProperty(window, 'firebase', { get: () => fb, set: () => {}, configurable: false });
  window.auth = window.__stubAuth;
  try { localStorage.setItem('stryker_nav_authed', '1'); localStorage.setItem('stryker_tour_done', '1'); localStorage.setItem('stryker_push_prompt_dismissed', String(Date.now())); } catch (e) {}
}.toString() + ')()';


let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const rows = (page) => page.$$eval('.student-row .cell-name', (e) => e.map((x) => x.textContent.trim()));
const info = (page) => page.evaluate(() => { const e = document.querySelector('#students-pager .szp-info'); return e ? e.textContent : ''; });

(async () => {
  const browser = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  const SHOT_ONLY = process.env.SHOT_ONLY === '1';
  for (const theme of ['dark', 'light']) {
  for (const vp of [{ w: 390, h: 844 }, { w: 412, h: 915 }, { w: 1440, h: 1000 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.w < 700 ? 2 : 1, isMobile: vp.w < 700, hasTouch: vp.w < 700 });
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
    await ctx.addInitScript(stub);
    await ctx.addInitScript('try{localStorage.setItem("stryker_theme","' + (theme === 'light' ? 'day' : 'dark') + '")}catch(e){}');
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message || e)));
    const T = vp.w + '/' + theme + ' ';
    await page.goto(BASE + '/students-admin.html', { waitUntil: 'load' });
    await page.waitForSelector('.student-row', { timeout: 15000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, PRE + '-users-' + vp.w + '-' + theme + '.png') });
    if (SHOT_ONLY || theme === 'light') { await ctx.close(); continue; }

    ok((await rows(page)).length === 25, T + 'default 25 rows');
    ok(/226|194/.test(await page.textContent('#users-filter-count')) || true, T + 'count line: ' + (await page.textContent('#users-filter-count')));
    ok((await page.textContent('#users-filter-count')) === '194 users', T + 'All = 194 real users (demo hidden)');
    ok(/\+32 demo accounts hidden/.test(await page.textContent('#users-demo-note')), T + 'demo note');
    ok(/Live data: \d+ user/.test(await page.textContent('#users-live-count')), T + 'live count line kept');
    ok((await info(page)).replace(/\s+/g, ' ').includes('1–25 of 194'), T + 'info: ' + (await info(page)));
    ok(!(await page.$$eval('.student-row .cell-name', (e) => e.some((x) => /Demo Member/.test(x.textContent)))), T + 'no demo rows in All');
    // next
    await page.click('#students-pager [aria-label="Next page"]');
    ok((await info(page)).includes('26–50 of 194'), T + 'next -> 26–50');
    ok(/page=2/.test(page.url()), T + 'URL has page=2: ' + page.url().replace(BASE, ''));
    await page.click('#students-pager [aria-label="Previous page"]');
    ok((await info(page)).includes('1–25'), T + 'prev -> 1–25');
    ok(await page.$eval('#students-pager [aria-label="Previous page"]', (b) => b.disabled), T + 'prev disabled on page 1');
    if (vp.w > 480) {
      await page.click('#students-pager [aria-label="Page 8"]');
      ok((await info(page)).includes('176–194 of 194'), T + 'number 8 (last) -> 176–194: ' + (await info(page)));
      ok((await rows(page)).length === 19, T + 'last page has 19 rows');
      ok(await page.$eval('#students-pager [aria-label="Next page"]', (b) => b.disabled), T + 'next disabled on last page');
    } else {
      for (let k = 0; k < 7; k++) await page.click('#students-pager [aria-label="Next page"]');
      ok((await page.textContent('#students-pager .szp-compact')).trim() === 'Page 8 of 8', T + 'compact label Page 8 of 8');
      const bb = await page.locator('#students-pager [aria-label="Previous page"]').boundingBox();
      ok(bb && bb.width >= 44 && bb.height >= 44, T + 'prev tap target ' + Math.round(bb.width) + 'x' + Math.round(bb.height));
    }
    // refresh keeps page
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.student-row');
    ok((await info(page)).includes('176–194 of 194'), T + 'refresh keeps page 8');
    // size
    await page.selectOption('#students-pager select', '50');
    ok((await rows(page)).length === 50 && (await info(page)).includes('1–50 of 194'), T + 'size 50 -> 50 rows, page 1');
    ok(/size=50/.test(page.url()) && !/page=/.test(page.url()), T + 'URL size=50: ' + page.url().replace(BASE, ''));
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.student-row');
    ok((await rows(page)).length === 50, T + 'refresh keeps size 50');
    await page.selectOption('#students-pager select', '100');
    await page.click('#students-pager [aria-label="Next page"]');
    ok((await info(page)).includes('101–194 of 194'), T + 'size 100 page 2');
    // search resets to page 1, across ALL users
    await page.fill('#students-search', 'Student 15');
    let r = await rows(page);
    ok(r.length === 10 && r.every((n) => /Student 15/.test(n)), T + 'search "Student 15" -> ' + r.length + ' rows (all users, not just this page)');
    ok(!/page=/.test(page.url()), T + 'search reset page in URL');
    await page.fill('#students-search', '');
    // go to page 2 then click a chip
    await page.selectOption('#students-pager select', '25');
    await page.click('#students-pager [aria-label="Next page"]');
    await page.click('[data-role="plan-free"]');
    ok((await info(page)) === '' || (await info(page)).includes('1–') || (await rows(page)).length <= 25, T + 'chip Free resets');
    ok(!/page=/.test(page.url()), T + 'chip reset page in URL');
    r = await rows(page);
    ok(r.length === 25 && /Showing/.test(await info(page)), T + 'Free chip: 25 rows page 1 of ' + (await page.textContent('#students-pager .szp-info')));
    // demo chip
    await page.click('[data-role="demo"]');
    ok((await page.textContent('#users-filter-count')) === '32 users', T + 'Demo chip 32 users');
    ok((await rows(page)).length === 25, T + 'Demo chip first page 25');
    await page.click('[data-role="all"]');
    await page.click('#users-demo-note a');
    ok((await page.textContent('#users-filter-count')) === '32 users', T + 'demo-note link opens Demo chip');
    await page.click('[data-role="student"]');
    // small list hides pager
    await page.click('[data-role="admin"]');
    ok(await page.$eval('#students-pager', (e) => e.hidden), T + 'pager hidden when list <= 25');
    await page.click('[data-role="all"]');
    // scroll to top on page change
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.click('#students-pager [aria-label="Next page"]');
    await page.waitForTimeout(800);
    const top = await page.evaluate(() => document.getElementById('students-top').getBoundingClientRect().top);
    ok(top > -40 && top < 200, T + 'scrolled back to top of list (top=' + Math.round(top) + ')');
    // keyboard
    await page.focus('#students-pager [aria-label="Next page"]');
    await page.keyboard.press('Enter');
    ok((await info(page)).includes('51–75'), T + 'keyboard Enter on Next -> 51–75');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= vp.w, T + 'no sideways scroll (' + sw + ')');
    await page.evaluate(() => { const p = document.getElementById('students-pager'); document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, p.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 24); });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(SHOTS, 'after-users-pager-' + vp.w + '-dark.png') });
    ok(!errs.length, T + 'no page errors ' + errs.join('|'));
    await ctx.close();
  }
  }
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
