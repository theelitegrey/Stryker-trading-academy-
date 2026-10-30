// Pager on every changed page (assets/pager.js), Firebase stubbed with generated rows.
// Run: STRYKER_TEST_PORT=8217 node tools/tests/pager-pages-browser.js [shotDir]
const fs = require('fs');
const path = require('path');
const { launch, BASE } = require('./lib.js');
const SHOTS = process.argv[2] || path.join(__dirname, 'shots-pager');
fs.mkdirSync(SHOTS, { recursive: true });
const stub = '(' + function () {
  const ADMIN = 'adm1';
  const NOW = Date.now();
  const ts = (d) => ({ toDate: () => new Date(NOW - d * 864e5), toMillis: () => NOW - d * 864e5, seconds: Math.floor((NOW - d * 864e5) / 1000) });
  const STU = { adm1: { displayName: 'Owner Admin', email: 'owner@example.com', plan: 'Elite', createdAt: ts(300) } };
  const gen = (n, f) => { const o = {}; for (let i = 1; i <= n; i++) o['d' + String(i).padStart(3, '0')] = f(i); return o; };
  const DATA = {
    orders: gen(70, (i) => ({ studentName: 'Buyer ' + i, studentEmail: 'b' + i + '@example.com', planName: 'Pro', finalAmount: 10, currency: 'USD', createdAt: ts(i) })),
    coupons: gen(60, (i) => ({ type: 'percent', value: 10, appliesToPlan: 'all', active: true, redemptionCount: 0, createdAtMillis: NOW - i * 1000 })),
    contactMessages: gen(70, (i) => ({ name: 'Sender ' + i, email: 's' + i + '@example.com', message: 'Hello ' + i, status: 'new', createdAt: ts(i) })),
    communityPosts: gen(60, (i) => ({ hidden: true, authorName: 'Poster ' + i, authorUid: 'p' + i, text: 'Flagged post ' + i, moderatedAt: ts(i), createdAt: ts(i) })),
    activityLog: gen(130, (i) => ({ actorName: 'Admin', actorUid: 'adm1', actorRole: 'admin', action: 'x', summary: 'Entry ' + i, createdAt: ts(i / 10) })),
    suggestions: gen(70, (i) => ({ title: 'Idea ' + i, body: 'Body ' + i, category: 'other', status: 'open', votes: 70 - i, hidden: false, authorUid: 'z' + i, authorName: 'Member', createdAt: ts(i), updatedAt: ts(i) })),
    communities: gen(60, (i) => ({ name: 'Community ' + i, tagline: 'Tag ' + i, visibility: 'public', status: 'active', memberCount: i, tags: [], createdAt: ts(i), ownerUid: 'o' + i, ownerName: 'Owner' })),
  };
  const STUALL = STU;
  const ADMINS = { adm1: { email: 'owner@example.com' } };
  window.__writes = [];
  window.__confirms = [];
  window.__confirmAnswer = true;
  window.confirm = (m) => { window.__confirms.push(m); return window.__confirmAnswer; };
  const snapOf = (rows) => ({ size: rows.length, empty: !rows.length, docs: rows.map((r) => ({ id: r.id, exists: true, data: () => r.d, ref: { id: r.id } })), forEach(f) { this.docs.forEach(f); } });
  function rows(coll, filt) {
    const src = coll === 'students' ? STU : coll === 'admins' ? ADMINS : (DATA[coll] || {});
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
  window.__stubDb = { collection: colRef, collectionGroup: () => colRef('__cg'), doc: (p) => { const s = String(p).split('/'); return docRef(s[s.length - 2], s[s.length - 1]); }, batch: () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() }), runTransaction: (f) => f({ get: (r) => r.get(), set() {}, update() {} }) };
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
// name, url, row selector, pager selector, expected total, default size
const PAGES = [
  ['orders', '/orders-admin.html', '#orders-list > .record-card', 70, 25],
  ['coupons', '/coupons-admin.html', '#coupon-list > .record-card', 60, 25],
  ['support', '/support-admin.html', '#sup-list > .sup-msg', 70, 25],
  ['moderation', '/moderation-admin.html', '#moderation-list > *', 60, 25],
  ['logs', '/logs-admin.html', '#log-list > .record-card', 130, 50],
  ['suggestions', '/suggestions.html', '#sg-list > *', 70, 25],
  ['communities', '/communities.html', '#cd-grid > *', 60, 24],
  ['help', '/help.html?q=trade', '#hc-results .hc-item', 0, 25],
  ['roadmap', '/roadmap.html', '#rmp-cl-list > .rmp-cl', 0, 25],
];
(async () => {
  const browser = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  for (const vp of [{ w: 390, h: 844 }, { w: 1440, h: 1000 }]) {
    for (const [name, url, rowSel, total, def] of PAGES) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.w < 700 ? 2 : 1, isMobile: vp.w < 700, hasTouch: vp.w < 700 });
      await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
      await ctx.addInitScript(stub);
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(String(e.message || e)));
      const T = vp.w + ' ' + name + ' ';
      try {
        await page.goto(BASE + url, { waitUntil: 'load' });
        await page.waitForSelector('.szp:not([hidden])', { timeout: 15000 });
        await page.waitForTimeout(400);
        const n = () => page.$$eval(rowSel, (e) => e.length);
        ok(await n() === def, T + 'default ' + def + ' rows (got ' + await n() + ')');
        const info = () => page.textContent('.szp .szp-info').then((s) => s.replace(/\s+/g, ' '));
        ok(total === 0 ? /of \d+/.test(await info()) : (await info()).includes('of ' + total), T + 'info ' + (await info()));
        await page.click('.szp [aria-label="Next page"]');
        ok((await info()).includes((def + 1) + '–'), T + 'next -> ' + (await info()));
        if (name !== 'help') {
          ok(/page=2/.test(page.url()) || /(jh|bl|mp)=2/.test(page.url()), T + 'URL has page: ' + page.url().replace(BASE, ''));
          await page.reload({ waitUntil: 'load' });
          await page.waitForSelector('.szp:not([hidden])');
          await page.waitForTimeout(300);
          ok((await info()).includes((def + 1) + '–'), T + 'refresh keeps page 2');
        }
        await page.click('.szp [aria-label="Previous page"]');
        ok((await info()).includes('1–' + def), T + 'prev back to 1');
        const sel = page.locator('.szp select');
        const opts = await sel.locator('option').allTextContents();
        await sel.selectOption(opts[1]);
        ok(await n() === (total ? Math.min(total, +opts[1]) : await n()), T + 'size ' + opts[1] + ' -> ' + await n() + ' rows');
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        ok(sw <= vp.w + 1, T + 'no sideways scroll (' + sw + ')');
        await sel.selectOption(opts[0]);
        await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; const p = document.querySelector('.szp'); window.scrollTo(0, p.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 24); });
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SHOTS, 'after-' + name + '-' + vp.w + '-dark.png') });
      } catch (e) { ok(false, T + 'threw ' + String(e.message).split('\n')[0]); try { await page.screenshot({ path: path.join(SHOTS, 'FAIL-' + name + '-' + vp.w + '.png') }); } catch (x) {} }
      ok(!errs.length, T + 'no page errors ' + errs.slice(0, 2).join('|'));
      await ctx.close();
    }
  }
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
