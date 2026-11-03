// Passkey browser test: Chrome virtual authenticator (CDP WebAuthn) against tools/tests/passkey-dev-server.mjs.
// Firebase is stubbed (signInWithCustomToken just trusts the token's uid); the passkey API + crypto are real.
//   node tools/tests/passkey-dev-server.mjs 8044 &   then:   STRYKER_TEST_BASE=http://localhost:8044 node tools/tests/passkey-browser.js [outdir]
const fs = require('fs'), path = require('path');
const { launch, BASE } = require('./lib');
const OUT = process.argv[2] || '/tmp/pk-shots'; fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + l.padEnd(58) + JSON.stringify(got) + (ok ? '' : ' (want ' + JSON.stringify(want) + ')')); };

function stub() {
  const SEL = 'tz_stub_uid';
  const uidNow = () => localStorage.getItem(SEL);
  const mkUser = (uid) => ({ uid, email: 'pk@test.com', emailVerified: true, displayName: 'Test Trader',
    getIdToken: () => fetch('/__test/idtoken?uid=' + uid + '&ago=' + (Number(localStorage.getItem('tz_stub_ago')) || 0)).then((r) => r.text()),
    getIdTokenResult: () => Promise.resolve({ claims: {}, authTime: new Date(Date.now() - (Number(localStorage.getItem('tz_stub_ago')) || 0) * 1000).toISOString() }), reload: () => Promise.resolve() });
  const listeners = [];
  const authObj = { get currentUser() { return uidNow() ? mkUser(uidNow()) : null; },
    onAuthStateChanged: (cb) => { listeners.push(cb); setTimeout(() => cb(authObj.currentUser), 10); return () => {}; },
    setPersistence: () => Promise.resolve(),
    signInWithCustomToken: (t) => { const c = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); localStorage.setItem(SEL, c.uid); window.__customToken = true; return Promise.resolve({ user: mkUser(c.uid) }); },
    signOut: () => { localStorage.removeItem(SEL); return Promise.resolve(); } };
  const snap = (id, d) => ({ id, exists: !!d, data: () => d || {}, ref: {} });
  const docRef = (col, id) => ({ id, get: () => Promise.resolve(snap(id, null)), set: () => Promise.resolve(), update: () => Promise.resolve(), delete: () => Promise.resolve(),
    onSnapshot: (cb) => { setTimeout(() => cb(snap(id, null)), 10); return () => {}; }, collection: (s) => colRef(col + '/' + id + '/' + s) });
  const colRef = (col) => ({ doc: (id) => docRef(col, id || 'a'), get: () => Promise.resolve({ empty: true, size: 0, docs: [], forEach() {} }), add: () => Promise.resolve({ id: 'x' }),
    where: () => colRef(col), orderBy: () => colRef(col), limit: () => colRef(col), startAfter: () => colRef(col), onSnapshot: (cb) => { setTimeout(() => cb({ empty: true, size: 0, docs: [], forEach() {} }), 10); return () => {}; } });
  const db = { collection: colRef, batch: () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() }), runTransaction: (f) => f({ get: (r) => r.get(), set() {}, update() {} }) };
  const fns = { httpsCallable: () => () => new Promise(() => {}) };
  window.firebase = { apps: [{}], initializeApp: () => ({}), app: () => ({ functions: () => fns }), functions: () => fns,
    firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => 'TS', increment: (n) => n, delete: () => 'D', arrayUnion: () => 'AU', arrayRemove: () => 'AR' }, Timestamp: { now: () => ({ toDate: () => new Date() }) } }),
    auth: Object.assign(() => authObj, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } }, GoogleAuthProvider: function () { this.setCustomParameters = () => {}; } }),
    messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} }) };
  if (localStorage.getItem('tz_no_cond') === '1') PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
  window.db = db; window.auth = authObj;
  try { localStorage.setItem('stryker_install_dismissed', '1'); } catch (e) {}
}

async function shotPage(p, name) { await p.waitForTimeout(400); await p.screenshot({ path: path.join(OUT, name + '.png') }); }
(async () => {
  const browser = await launch();
  try {
    for (const [w, theme] of [[390, 'dark'], [1440, 'dark'], [390, 'light'], [1440, 'light']]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, deviceScaleFactor: w < 500 ? 2 : 1, colorScheme: theme });
      const p = await ctx.newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await p.addInitScript(stub);
      await p.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
      await p.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
      await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|www\.gstatic\.com\/firebasejs)/, (r) => r.abort());
      const cdp = await ctx.newCDPSession(p);
      await cdp.send('WebAuthn.enable');
      const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
      const creds = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials.length;
      await p.evaluate(() => localStorage.setItem('tz_no_cond', '1')).catch(() => {});
      const tag = w + '-' + theme;
      console.log('\n== ' + tag + ' ==');

      // 1. signed out: login page shows the button
      await p.goto(BASE + '/login.html', { waitUntil: 'load' }); await p.evaluate(() => localStorage.setItem('tz_no_cond', '1')); await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(800);
      check('login: passkey button visible', await p.locator('[data-passkey-signin]').isVisible(), true);
      check('login: email autocomplete has webauthn', await p.getAttribute('#login-email', 'autocomplete'), 'username webauthn');
      check('login: no horizontal overflow', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await shotPage(p, 'login-' + tag);
      // login before registering -> fails with a friendly message
      await p.click('[data-passkey-signin]'); await p.waitForTimeout(1500);
      check('login with no passkey: stays signed out + message', [await p.evaluate(() => localStorage.getItem('tz_stub_uid')), (await p.textContent('#login-error')).length > 0], [null, true]);

      // 2. signed in (recent) -> settings -> add
      await p.evaluate(() => localStorage.setItem('tz_stub_uid', 'uid-A'));
      await p.goto(BASE + '/settings.html', { waitUntil: 'load' }); await p.waitForTimeout(1500);
      check('settings: passkeys panel visible, empty', [await p.locator('#passkeys-panel').isVisible(), await p.locator('#pk-empty').isVisible()], [true, true]);
      await p.locator('#passkeys-panel').scrollIntoViewIfNeeded(); await shotPage(p, 'settings-empty-' + tag);
      await p.click('#pk-add'); await p.waitForTimeout(1500);
      check('settings: one row after add', await p.locator('.pk-row').count(), 1);
      check('authenticator holds 1 credential', await creds(), 1);
      check('row name is a device name', (await p.textContent('.pk-name')).length > 0, true);
      await p.locator('#passkeys-panel').scrollIntoViewIfNeeded(); await shotPage(p, 'settings-list-' + tag);
      // rename
      await p.click('.pk-act button:first-child'); await p.fill('.pk-input', 'My test phone'); await p.press('.pk-input', 'Enter'); await p.waitForTimeout(800);
      check('rename sticks', await p.textContent('.pk-name'), 'My test phone');

      // 3a. sign out, sign in by clicking the button
      await p.evaluate(() => localStorage.removeItem('tz_stub_uid'));
      await p.goto(BASE + '/login.html', { waitUntil: 'load' }); await p.waitForTimeout(800);
      await p.click('[data-passkey-signin]'); await p.waitForTimeout(2500);
      check('passkey sign-in: signed in as the same uid', await p.evaluate(() => localStorage.getItem('tz_stub_uid')), 'uid-A');
      check('passkey sign-in: no offer flag (not a password login)', await p.evaluate(() => sessionStorage.getItem('tz_pk_offer')), null);
      // 3b. conditional UI (the email box suggests the passkey; the virtual device answers at once)
      await p.evaluate(() => { localStorage.removeItem('tz_stub_uid'); localStorage.removeItem('tz_no_cond'); });
      await p.goto(BASE + '/login.html', { waitUntil: 'load' }); await p.waitForTimeout(3000);
      check('conditional UI: signed in without a click', await p.evaluate(() => localStorage.getItem('tz_stub_uid')), 'uid-A');
      await p.evaluate(() => localStorage.setItem('tz_no_cond', '1'));

      // 4. stale sign-in blocks add
      await p.evaluate(() => localStorage.setItem('tz_stub_ago', '3600'));
      await p.goto(BASE + '/settings.html', { waitUntil: 'load' }); await p.waitForTimeout(1500);
      await p.click('#pk-add'); await p.waitForTimeout(800);
      check('stale sign-in: asks to sign in again', /sign in again/.test(await p.textContent('#pk-msg')), true);
      await p.evaluate(() => localStorage.setItem('tz_stub_ago', '0'));

      // 5. remove -> login now fails
      await p.goto(BASE + '/settings.html', { waitUntil: 'load' }); await p.waitForTimeout(1500);
      p.once('dialog', (d) => d.accept());
      await p.click('.pk-del'); await p.waitForTimeout(1000);
      check('removed: list empty again', await p.locator('.pk-row').count(), 0);
      await p.evaluate(() => localStorage.removeItem('tz_stub_uid'));
      await p.goto(BASE + '/login.html', { waitUntil: 'load' }); await p.waitForTimeout(800);
      await p.click('[data-passkey-signin]'); await p.waitForTimeout(2000);
      check('removed passkey: sign-in fails, still signed out', await p.evaluate(() => localStorage.getItem('tz_stub_uid')), null);
      await shotPage(p, 'login-error-' + tag);

      // 6. offer after a normal sign-in
      await p.evaluate(() => { localStorage.setItem('tz_stub_uid', 'uid-A'); sessionStorage.setItem('tz_pk_offer', '1'); });
      await p.goto(BASE + '/dashboard-user.html', { waitUntil: 'load' }); await p.waitForTimeout(1500);
      await p.evaluate(() => { const m = document.getElementById('ob-modal'); if (m) m.hidden = true; document.body.classList.remove('ob-open'); }); await p.waitForTimeout(1500);
      check('offer shown', await p.locator('#pk-offer').isVisible().catch(() => false), true);
      await shotPage(p, 'offer-' + tag);
      await p.click('#pk-offer .btn-ghost'); await p.waitForTimeout(300);
      check('"Not now" hides it and snoozes ~30 days', [await p.locator('#pk-offer').count(), await p.evaluate(() => Number(localStorage.getItem('tz_pk_snooze_until')) > Date.now() + 29 * 864e5)], [0, true]);
      check('no page errors', errors.filter((e) => !/Firebase|firestore/i.test(e)), []);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed'); process.exit(fails ? 1 : 0);
})();
