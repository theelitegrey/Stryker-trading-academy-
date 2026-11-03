// Partner programme (partner.html, partners-admin.html), Firebase stubbed. Scenarios: ?sc=none|pending|rejected|active|paused|admin.
// Run (server on STRYKER_TEST_PORT serving the repo root): node tools/tests/partner-browser.js [shotDir]
const fs = require('fs');
const path = require('path');
const { launch, BASE } = require('./lib.js');
const SHOTS = process.argv[2] || path.join(__dirname, 'shots-partner');
fs.mkdirSync(SHOTS, { recursive: true });

const stub = '(' + function () {
  const NOW = Date.now(), D = 864e5;
  const sc = new URLSearchParams(location.search).get('sc') || (sessionStorage.getItem('sc') || 'none');
  try { sessionStorage.setItem('sc', sc); } catch (e) {}
  const ts = (ms) => ({ toDate: () => new Date(ms), toMillis: () => ms, seconds: Math.floor(ms / 1000) });
  const wkKey = (ms) => { let d = new Date(ms); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day); const y = d.getUTCFullYear(); const w = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7); return y + '-W' + (w < 10 ? '0' : '') + w; };
  const APP = { platform: 'instagram', handle: '@marketminded', profileUrl: 'https://instagram.com/marketminded', followers: 4200, postLinks: ['https://instagram.com/p/a1', 'https://instagram.com/p/a2', 'https://instagram.com/p/a3'], why: 'I post daily futures breakdowns and want my audience to try the tools.', agreedAt: ts(NOW - 20 * D) };
  const me = sc.startsWith('admin') ? 'adm1' : 'u1';
  const store = {};
  const put = (p, v) => { store[p] = v; };
  put('admins/adm1', { email: 'owner@example.com' });
  put('students/u1', { displayName: 'Maya Rao', email: 'maya@example.com', plan: 'Starter' });
  put('students/u2', { displayName: 'Dev Patel', email: 'dev@example.com', plan: 'Starter' });
  put('students/u3', { displayName: 'Sam Lee', email: 'sam@example.com', plan: 'Pro' });
  put('students/u4', { displayName: 'Ana Cruz', email: 'ana@example.com', plan: 'Starter' });
  const cur = wkKey(NOW), w1 = wkKey(NOW - 7 * D), w2 = wkKey(NOW - 14 * D), w3 = wkKey(NOW - 21 * D);
  const L = (n) => Array.from({ length: n }, (_, i) => 'https://instagram.com/p/' + Math.random().toString(36).slice(2, 8) + i);
  if (sc === 'pending') put('partners/u1', Object.assign({}, APP, { status: 'pending' }));
  if (sc === 'rejected') put('partners/u1', Object.assign({}, APP, { status: 'rejected', reviewNote: 'Your account is under 3 months old. Please apply again later.', reapplyAfterMillis: NOW + 12 * D }));
  if (sc === 'active' || sc === 'paused') {
    put('partners/u1', Object.assign({}, APP, { status: sc, approvedAtMillis: NOW - 30 * D, proUntil: NOW + (sc === 'paused' ? 9 : 22) * D, reviewNote: sc === 'paused' ? 'Two weeks were missed in October. Add your posts and the bio line, then we will renew.' : undefined }));
    put('partners/u1/weeks/' + cur, { links: L(1) });
    put('partners/u1/weeks/' + w1, { links: L(3) });
    put('partners/u1/weeks/' + w2, { links: L(1) });
    put('partners/u1/weeks/' + w3, { links: L(2) });
  }
  if (sc.startsWith('admin')) {
    put('partners/u1', Object.assign({}, APP, { status: 'pending' }));
    put('partners/u2', Object.assign({}, APP, { handle: '@dev.trades', platform: 'x', followers: 60, status: 'pending' }));
    put('partners/u3', Object.assign({}, APP, { handle: '@samflow', platform: 'youtube', followers: 18000, status: 'active', approvedAtMillis: NOW - 40 * D, proUntil: NOW + 3 * D }));
    put('partners/u3/weeks/' + cur, { links: L(2) }); put('partners/u3/weeks/' + w1, { links: L(1) }); put('partners/u3/weeks/' + w2, { links: L(0) }); put('partners/u3/weeks/' + w3, { links: L(2) });
    put('partners/u4', Object.assign({}, APP, { handle: '@anacruz', platform: 'tiktok', status: 'paused', approvedAtMillis: NOW - 60 * D, proUntil: NOW + 6 * D, reviewNote: 'Bio line missing.' }));
  }
  window.__writes = []; window.__calls = [];
  window.confirm = () => true;
  const snapOf = (rows) => ({ size: rows.length, empty: !rows.length, docs: rows, forEach(f) { rows.forEach(f); } });
  const mk = (p) => ({ id: p.split('/').pop(), exists: p in store, data: () => store[p] || {}, ref: { id: p.split('/').pop() } });
  function docRef(p) {
    return {
      id: p.split('/').pop(), path: p,
      get: () => Promise.resolve(mk(p)),
      set: (v, o) => { window.__writes.push({ p, v: JSON.parse(JSON.stringify(v)), o }); store[p] = Object.assign({}, o && o.merge ? store[p] : {}, v); return Promise.resolve(); },
      update: () => Promise.resolve(), delete: () => { delete store[p]; return Promise.resolve(); },
      onSnapshot: (cb) => { setTimeout(() => cb(mk(p)), 5); return () => {}; },
      collection: (sub) => colRef(p + '/' + sub)
    };
  }
  function colRef(p) {
    const self = {
      doc: (id) => docRef(p + '/' + (id || 'auto')),
      get: () => { const depth = p.split('/').length + 1; return Promise.resolve(snapOf(Object.keys(store).filter((k) => k.startsWith(p + '/') && k.split('/').length === depth).map(mk))); },
      add: (v) => { window.__writes.push({ p, v: JSON.parse(JSON.stringify(v)) }); return Promise.resolve({ id: 'new' }); },
      where: () => self, orderBy: () => self, startAfter: () => self, limit: () => self,
      onSnapshot: (cb) => { setTimeout(() => cb(snapOf([])), 5); return () => {}; }
    };
    return self;
  }
  const user = { uid: me, email: me === 'adm1' ? 'owner@example.com' : 'maya@example.com', displayName: me === 'adm1' ? 'Owner Admin' : 'Maya Rao', emailVerified: true, photoURL: null, getIdTokenResult: () => Promise.resolve({ claims: {} }), getIdToken: () => Promise.resolve('t') };
  const callable = (name) => (data) => { window.__calls.push({ name, data }); return Promise.resolve({ data: { ok: true } }); };
  const fns = { httpsCallable: callable };
  window.__stubDb = { collection: colRef, doc: (p) => docRef(String(p)), batch: () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() }), runTransaction: (f) => f({ get: (r) => r.get(), set() {}, update() {} }) };
  window.db = window.__stubDb;
  window.__stubAuth = { currentUser: user, onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; }, onIdTokenChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; }, setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve() };
  const fsFn = Object.assign(() => window.__stubDb, { FieldValue: { serverTimestamp: () => ({ __ts: 'server' }), increment: (n) => ({ inc: n }), delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' }, Timestamp: { now: () => ts(NOW), fromDate: (d) => ts(+d) } });
  const fb = { apps: [{}], initializeApp: () => ({}), app: () => ({ functions: () => fns }), firestore: fsFn, auth: Object.assign(() => window.__stubAuth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } } }), functions: () => fns, messaging: Object.assign(() => ({ getToken: () => Promise.resolve(null), onMessage: () => {} }), { isSupported: () => false }) };
  Object.defineProperty(window, 'firebase', { get: () => fb, set: () => {}, configurable: false });
  window.auth = window.__stubAuth;
  try { localStorage.setItem('stryker_nav_authed', '1'); localStorage.setItem('stryker_tour_done', '1'); localStorage.setItem('stryker_push_prompt_dismissed', String(Date.now())); } catch (e) {}
}.toString() + ')()';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  for (const theme of ['dark', 'light']) for (const vp of [{ w: 390, h: 844 }, { w: 1440, h: 1000 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.w < 700 ? 2 : 1, isMobile: vp.w < 700, hasTouch: vp.w < 700 });
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
    await ctx.addInitScript(stub);
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e.message || e)));
    const tag = vp.w + '-' + theme;
    const noOverflow = async (n) => { const sw = await page.evaluate(() => document.documentElement.scrollWidth); ok(sw <= vp.w, tag + ' ' + n + ' no sideways scroll (' + sw + ')'); };
    for (const sc of ['none', 'pending', 'rejected', 'active', 'paused']) {
      await page.goto(BASE + '/partner.html?sc=' + sc, { waitUntil: 'load' });
      await page.waitForFunction(() => { const l = document.getElementById('pt-loading'); return l && l.hidden; }, null, { timeout: 15000 });
      await page.waitForTimeout(300);
      await noOverflow(sc);
      const txt = await page.evaluate(() => document.getElementById('main').innerText);
      ok(!/\$\s?\d/.test(txt), tag + ' ' + sc + ' no $ amount on the page');
      if (sc === 'none') {
        ok(/Grow with TradeZoro. Get Pro free./.test(txt) && /100\+\s*followers/.test(txt) && /2 posts a week/.test(txt) && /Partner @thetradezoro/.test(txt), tag + ' apply: hero + terms from constants');
        if (theme === 'dark' || vp.w > 700) {}
        await page.screenshot({ path: path.join(SHOTS, tag + '-1-apply-top.png') });
        await page.evaluate(() => document.getElementById('pt-form').scrollIntoView());
        await page.screenshot({ path: path.join(SHOTS, tag + '-1-apply-form.png') });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(SHOTS, tag + '-1-apply-full.png'), fullPage: true });
        await page.click('#pv-faq summary');
        ok(await page.evaluate(() => !!document.querySelector('#pv-faq details[open]')), tag + ' faq opens');
        ok(await page.locator('#pv-caps li').count() === 3, tag + ' 3 captions');
        await page.click('[data-copy-bio]');
        await page.waitForTimeout(200);
        for (const [n, sel] of [['mid1', '.pv-steps'], ['mid2', '.pv-kit'], ['mid3', '.pv-pills']]) { await page.evaluate((q) => { const e = document.querySelector(q); window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 120); }, sel); await page.waitForTimeout(150); await page.screenshot({ path: path.join(SHOTS, tag + '-1-apply-' + n + '.png') }); }
        await page.evaluate(() => document.getElementById('pt-form').scrollIntoView());
        await page.screenshot({ path: path.join(SHOTS, tag + '-1-apply-form.png') });
        // validation
        await page.evaluate(() => { window.__writes.length = 0; });
        await page.click('#pt-submit');
        ok(await page.evaluate(() => document.getElementById('pt-form-error').textContent.length > 0) && await page.evaluate(() => window.__writes.length === 0), tag + ' empty form: error, no write');
        await page.fill('#pt-handle', '@marketminded'); await page.fill('#pt-profile', 'https://instagram.com/marketminded'); await page.fill('#pt-followers', '50');
        await page.click('#pt-submit');
        ok(/at least 100/.test(await page.textContent('#pt-form-error')), tag + ' under 100 followers refused');
        await page.fill('#pt-followers', '4200');
        for (let i = 0; i < 3; i++) await page.fill('#pt-post-' + i, i === 2 ? 'http://x.com/insecure' : 'https://instagram.com/p/' + i);
        await page.fill('#pt-why', 'I post futures breakdowns.');
        await page.click('#pt-submit');
        ok(/https/.test(await page.textContent('#pt-form-error')), tag + ' http link refused');
        await page.fill('#pt-post-2', 'https://instagram.com/p/2');
        await page.click('#pt-submit');
        ok(/agree/.test(await page.textContent('#pt-form-error')), tag + ' must agree to terms');
        // terms sheet
        await page.click('#pt-open-terms');
        ok(await page.isVisible('#pt-terms-modal'), tag + ' terms sheet opens');
        await page.screenshot({ path: path.join(SHOTS, tag + '-1-terms-sheet.png') });
        await page.click('#pt-terms-modal .tz-x');
        ok(!(await page.isVisible('#pt-terms-modal')), tag + ' terms sheet closes');
        await page.check('#pt-agree');
        await page.click('#pt-submit');
        await page.waitForFunction(() => window.__writes.length > 0, null, { timeout: 4000 });
        const w = await page.evaluate(() => window.__writes[0]);
        const keys = Object.keys(w.v).sort().join(',');
        ok(w.p === 'partners/u1' && keys === 'agreedAt,followers,handle,platform,postLinks,profileUrl,why', tag + ' wrote only the application fields: ' + keys);
        ok(w.v.agreedAt && w.v.agreedAt.__ts === 'server', tag + ' agreedAt is the server time');
      }
      if (sc === 'pending') { ok(/Pending review/.test(txt), tag + ' pending status'); await page.screenshot({ path: path.join(SHOTS, tag + '-2-pending.png') }); }
      if (sc === 'rejected') { ok(/under 3 months old/.test(txt), tag + ' rejected shows the reason'); await page.screenshot({ path: path.join(SHOTS, tag + '-2-rejected.png') }); }
      if (sc === 'active' || sc === 'paused') {
        ok(/Pro active until|Pro stays on until/.test(txt), tag + ' ' + sc + ': Pro date shown');
        ok(/1\/2/.test(txt), tag + ' ' + sc + ': posts this week 1/2');
        await page.screenshot({ path: path.join(SHOTS, tag + '-3-' + sc + '-top.png') });
        if (sc === 'active') {
          await page.evaluate(() => { window.__writes.length = 0; });
          await page.fill('#pt-links', 'http://bad.com/x');
          await page.click('#pt-links-btn');
          ok(/https/.test(await page.textContent('#pt-links-error')) && await page.evaluate(() => window.__writes.length === 0), tag + ' http week link refused');
          await page.fill('#pt-links', 'https://instagram.com/p/new1\nhttps://instagram.com/p/new2');
          await page.click('#pt-links-btn');
          await page.waitForFunction(() => window.__writes.length > 0, null, { timeout: 4000 });
          const w = await page.evaluate(() => window.__writes[0]);
          ok(/^partners\/u1\/weeks\/20\d\d-W\d\d$/.test(w.p) && w.v.links.length === 3, tag + ' links appended to this week (now ' + w.v.links.length + ')');
          await page.waitForTimeout(400);
          ok(/3\/2/.test(await page.evaluate(() => document.getElementById('pt-checklist').innerText)), tag + ' checklist now 3/2');
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.screenshot({ path: path.join(SHOTS, tag + '-3-active-bottom.png') });
          await page.evaluate(() => { window.__calls.length = 0; });
          await page.click('#pt-leave');
          const c = await page.evaluate(() => window.__calls.slice());
          ok(c.length === 1 && c[0].name === 'partnerLeave', tag + ' Leave calls partnerLeave');
        }
      }
    }
    ok(errs.length === 0, tag + ' no page errors' + (errs.length ? ': ' + errs[0] : ''));
    // admin
    await page.goto(BASE + '/partners-admin.html?sc=admin', { waitUntil: 'load' });
    await page.waitForSelector('.pa-card', { timeout: 15000 });
    await page.waitForTimeout(300);
    await noOverflow('admin');
    ok(await page.locator('.pa-card').count() === 2, tag + ' admin: 2 pending cards');
    ok(await page.locator('.pa-card', { hasText: 'Under 100 ' }).count() === 1, tag + ' admin: under-100 flag on Dev');
    await page.screenshot({ path: path.join(SHOTS, tag + '-4-admin-pending.png') });
    await page.click('[data-tab="active"]');
    const a = await page.textContent('.pa-card');
    ok(/Due for review/.test(a) && /Missed/.test(a), tag + ' admin: active partner flagged Due for review + Missed week');
    await page.screenshot({ path: path.join(SHOTS, tag + '-4-admin-active.png') });
    await page.evaluate(() => { window.__calls.length = 0; });
    await page.click('[data-act="renew"]');
    await page.waitForFunction(() => window.__calls.length > 0);
    ok(await page.evaluate(() => JSON.stringify(window.__calls[0])) === JSON.stringify({ name: 'partnerAdmin', data: { uid: 'u3', action: 'renew', note: '' } }), tag + ' admin: Renew calls partnerAdmin');
    await page.click('[data-tab="pending"]');
    await page.click('.pa-card:first-child [data-act="reject"]');
    await page.click('#pa-modal-ok');
    ok(/reason/i.test(await page.textContent('#pa-modal-error')), tag + ' admin: reject needs a reason');
    await page.fill('#pa-modal-note', 'Under the follower minimum.');
    await page.screenshot({ path: path.join(SHOTS, tag + '-4-admin-reject.png') });
    await page.evaluate(() => { window.__calls.length = 0; });
    await page.click('#pa-modal-ok');
    await page.waitForFunction(() => window.__calls.length > 0);
    ok(await page.evaluate(() => window.__calls[0].data.action === 'reject' && window.__calls[0].data.note.length > 0), tag + ' admin: Reject sends the reason');
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
