// Admin "Live chart data" switch (assets/admin-live-feed.js, assets/students-admin.js), Firebase stubbed.
// Run (server on STRYKER_TEST_PORT serving the repo root): node tools/tests/admin-live-feed-browser.js [shotDir]
// Checks: Users page switch (confirm text, cancel = no write, OK = write liveFeed/liveFeedBy/liveFeedAt + Saved tick),
// "Live data on" filter + "Live data: N users" count, switch off without a confirm; dashboard panel list, search,
// switch on/off. Screens at 390 and 1440.
const fs = require('fs');
const path = require('path');
const { launch, BASE } = require('./lib.js');
const SHOTS = process.argv[2] || path.join(__dirname, 'shots-live-feed');
fs.mkdirSync(SHOTS, { recursive: true });

const stub = '(' + function () {
  const ADMIN = 'adm1';
  const NOW = Date.now();
  const ts = (d) => ({ toDate: () => new Date(NOW - d * 864e5), toMillis: () => NOW - d * 864e5, seconds: Math.floor((NOW - d * 864e5) / 1000) });
  const STU = {
    adm1: { displayName: 'Owner Admin', email: 'owner@example.com', plan: 'Elite', createdAt: ts(300) },
    s1: { displayName: 'Student Alpha', email: 'alpha@example.com', plan: 'Pro', createdAt: ts(20), liveFeed: true },
    s2: { displayName: 'Student Bravo', email: 'bravo@example.com', plan: 'Starter', createdAt: ts(10) },
    s3: { displayName: 'Student Charlie', email: 'charlie@example.com', plan: 'Pro', createdAt: ts(5) }
  };
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

(async () => {
  const browser = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  for (const vp of [{ w: 390, h: 844 }, { w: 1440, h: 1000 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.w < 700 ? 3 : 1, isMobile: vp.w < 700, hasTouch: vp.w < 700 });
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
    await ctx.addInitScript(stub);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message || e)));

    // ---- Users page
    await page.goto(BASE + '/students-admin.html', { waitUntil: 'load' });
    await page.waitForSelector('.student-row', { timeout: 15000 });
    await page.waitForFunction(() => /Live data: \d/.test((document.getElementById('users-live-count') || {}).textContent || ''), null, { timeout: 8000 });
    ok(await page.textContent('#users-live-count') === 'Live data: 1 user', vp.w + ' users: count "Live data: 1 user"');
    const tagRows = await page.$$eval('.student-row', (els) => els.filter((e) => e.querySelector('.live-feed-tag')).map((e) => e.querySelector('.cell-name').textContent));
    ok(tagRows.length === 1 && /Alpha/.test(tagRows[0]), vp.w + ' users: Live data tag on Alpha only');
    // filter
    await page.click('[data-role="live"]');
    let names = await page.$$eval('.student-row .cell-name', (e) => e.map((x) => x.textContent));
    ok(names.length === 1 && /Alpha/.test(names[0]), vp.w + ' users: "Live data on" filter shows only Alpha');
    await page.click('[data-role="all"]');
    // open Bravo, cancel confirm
    const bravo = page.locator('.student-row', { hasText: 'Student Bravo' });
    await bravo.locator('.student-row-head').click();
    await page.evaluate(() => { window.__confirmAnswer = false; window.__writes.length = 0; window.__confirms.length = 0; });
    await bravo.locator('.live-feed-switch').click();
    let st = await page.evaluate(() => ({ w: window.__writes.length, c: window.__confirms.slice() }));
    ok(st.c[0] === 'Give Student Bravo live chart data?', vp.w + ' users: confirm text "' + st.c[0] + '"');
    ok(st.w === 0 && !(await bravo.locator('[data-live-feed]').isChecked()), vp.w + ' users: cancel = no write, switch stays off');
    // OK
    await page.evaluate(() => { window.__confirmAnswer = true; });
    await bravo.locator('.live-feed-switch').click();
    await page.waitForFunction(() => /Saved/.test([...document.querySelectorAll('.student-row')].find((r) => /Bravo/.test(r.textContent)).querySelector('.live-feed-saved').textContent), null, { timeout: 5000 });
    st = await page.evaluate(() => window.__writes.slice());
    ok(st.length === 1 && st[0].coll === 'students' && st[0].id === 's2' && st[0].v.liveFeed === true && st[0].v.liveFeedBy === 'adm1' && st[0].v.liveFeedAt && st[0].v.liveFeedAt.__ts === 'server' && st[0].o && st[0].o.merge === true,
      vp.w + ' users: wrote students/s2 {liveFeed:true, liveFeedBy:adm1, liveFeedAt:serverTimestamp} merge');
    ok(await page.textContent('#users-live-count') === 'Live data: 2 users', vp.w + ' users: count now 2');
    ok(await bravo.locator('.live-feed-tag').count() === 1, vp.w + ' users: Bravo row gets the Live data tag');
    const box = await bravo.locator('.live-feed-switch').boundingBox();
    ok(box && box.height >= 44, vp.w + ' users: switch tap target ' + (box && Math.round(box.height)) + 'px tall');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= vp.w, vp.w + ' users: no sideways scroll (' + sw + ')');
    await bravo.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, 'users-' + vp.w + '-switch-on.png') });
    // turn off: no confirm
    await page.evaluate(() => { window.__writes.length = 0; window.__confirms.length = 0; });
    await page.waitForTimeout(2600);
    await bravo.locator('.live-feed-switch').click();
    await page.waitForFunction(() => /Saved/.test([...document.querySelectorAll('.student-row')].find((r) => /Bravo/.test(r.textContent)).querySelector('.live-feed-saved').textContent), null, { timeout: 5000 });
    st = await page.evaluate(() => ({ w: window.__writes.slice(), c: window.__confirms.length }));
    ok(st.c === 0 && st.w.length === 1 && st.w[0].v.liveFeed === false && st.w[0].v.liveFeedBy === 'adm1', vp.w + ' users: switch off = no confirm, wrote liveFeed:false + liveFeedBy');
    ok(await page.textContent('#users-live-count') === 'Live data: 1 user', vp.w + ' users: count back to 1');
    // write refused -> switch reverts, "Not saved"
    await page.evaluate(() => { window.__failWrites = true; });
    const charlie = page.locator('.student-row', { hasText: 'Student Charlie' });
    await charlie.locator('.student-row-head').click();
    await charlie.locator('.live-feed-switch').click();
    await page.waitForFunction(() => /Not saved/.test([...document.querySelectorAll('.student-row')].find((r) => /Charlie/.test(r.textContent)).querySelector('.live-feed-saved').textContent), null, { timeout: 5000 });
    ok(!(await charlie.locator('[data-live-feed]').isChecked()), vp.w + ' users: refused write reverts the switch and says Not saved');
    await page.evaluate(() => { window.__failWrites = false; });
    await page.click('[data-role="live"]');
    await page.waitForTimeout(150);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.users-filter-row').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, 'users-' + vp.w + '-filter.png') });

    // ---- Dashboard panel
    await page.goto(BASE + '/dashboard-admin.html', { waitUntil: 'load' });
    await page.waitForSelector('#live-feed-list .live-feed-item', { timeout: 15000 });
    ok(await page.textContent('#live-feed-count') === 'Live data: 1 user', vp.w + ' dashboard: count "Live data: 1 user"');
    ok(/Alpha/.test(await page.textContent('#live-feed-list')), vp.w + ' dashboard: Alpha listed');
    await page.fill('#live-feed-search', 'cha');
    await page.waitForSelector('#live-feed-results .live-feed-item', { timeout: 5000 });
    await page.evaluate(() => { window.__writes.length = 0; window.__confirms.length = 0; window.__confirmAnswer = true; });
    await page.locator('#live-feed-results .live-feed-switch').first().click();
    await page.waitForFunction(() => /Saved/.test(document.querySelector('#live-feed-results .live-feed-saved').textContent), null, { timeout: 5000 });
    st = await page.evaluate(() => ({ w: window.__writes.slice(), c: window.__confirms.slice() }));
    ok(st.c[0] === 'Give Student Charlie live chart data?' && st.w[0] && st.w[0].id === 's3' && st.w[0].v.liveFeed === true, vp.w + ' dashboard: search + switch on Charlie (confirm + write)');
    ok(await page.textContent('#live-feed-count') === 'Live data: 2 users', vp.w + ' dashboard: count 2');
    const sw2 = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw2 <= vp.w, vp.w + ' dashboard: no sideways scroll (' + sw2 + ')');
    await page.locator('#live-feed-panel').scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await page.locator('#live-feed-panel').screenshot({ path: path.join(SHOTS, 'dashboard-' + vp.w + '-panel.png') });
    ok(!errs.length, vp.w + ' no page errors ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'admin-live-feed: all ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
