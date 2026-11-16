// /desktop-login + the in-app "We opened your browser" note: browser test with measurements and screenshots.
// Firebase is stubbed; the /api/desktop/handoff call is answered by a route stub that checks the request shape.
//   python3 -m http.server 8046 &   then:   STRYKER_TEST_BASE=http://localhost:8046 node tools/tests/desktop-login-browser.js [outdir]
const fs = require('fs'), path = require('path');
const { launch, BASE } = require('./lib');
const OUT = process.argv[2] || '/tmp/dl-shots'; fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (l, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + l + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const NONCE = 'N'.repeat(43), CODE = 'K'.repeat(43);

function stub() {
  const user = { uid: 'g1', email: 'g@test.com', getIdToken: () => Promise.resolve('ID.TOKEN.x') };
  const mk = (name) => ({ name, options: { apiKey: 'k' }, auth: () => authFor(name) });
  const auths = {};
  function authFor(name) {
    if (auths[name]) return auths[name];
    auths[name] = { currentUser: null, setPersistence: () => Promise.resolve(), onAuthStateChanged: (cb) => { setTimeout(() => cb(null), 5); return () => {}; },
      signInWithPopup: () => { window.__popupApp = name; return window.__popupFail ? Promise.reject({ code: 'auth/popup-closed-by-user' }) : Promise.resolve({ user }); },
      signInWithCustomToken: (t) => { window.__ct = t; return new Promise(() => {}); }, signOut: () => { window.__signedOut = name; return Promise.resolve(); } };
    return auths[name];
  }
  const apps = [];
  window.firebase = { apps, initializeApp: (o, name) => { const a = mk(name || '[DEFAULT]'); apps.push(a); return a; }, app: () => apps[0],
    auth: Object.assign(() => authFor('[DEFAULT]'), { Auth: { Persistence: { LOCAL: 'l', SESSION: 's', NONE: 'n' } }, GoogleAuthProvider: function () { this.setCustomParameters = () => {}; } }),
    firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => 'TS', increment: (n) => n, delete: () => 'D', arrayUnion: () => 'AU', arrayRemove: () => 'AR' }, Timestamp: { now: () => ({ toDate: () => new Date() }) } }) };
  const snap = { empty: true, size: 0, docs: [], forEach() {}, exists: false, data: () => ({}) };
  const ref = () => ({ doc: () => ref(), collection: () => ref(), where: () => ref(), orderBy: () => ref(), limit: () => ref(), get: () => Promise.resolve(snap), set: () => Promise.resolve(), update: () => Promise.resolve(), add: () => Promise.resolve({ id: 'x' }), onSnapshot: (cb) => { setTimeout(() => cb(snap), 5); return () => {}; } });
  const db = { collection: () => ref(), batch: () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() }) };
  try { localStorage.setItem('stryker_install_dismissed', '1'); localStorage.setItem('stryker_cookie_ok', '1'); } catch (e) {}
}

const box = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), cy: +(r.y + r.height / 2).toFixed(1) }; }, sel);

(async () => {
  const browser = await launch();
  try {
    for (const [w, theme] of [[390, 'dark'], [412, 'dark'], [1440, 'dark'], [390, 'light'], [1440, 'light']]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, deviceScaleFactor: w < 500 ? 2 : 1 });
      const p = await ctx.newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await p.addInitScript(stub);
      await p.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
      await p.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
      let handoffReq = null, navTo = null;
      await p.route('**/api/desktop/handoff', async (r) => {
        const q = r.request(); handoffReq = { method: q.method(), auth: q.headers().authorization, body: q.postDataJSON() };
        await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: CODE, expiresIn: 120 }) });
      });
      await p.route(/^http:\/\/127\.0\.0\.1:51999\//, (r) => { navTo = r.request().url(); r.fulfill({ status: 302, headers: { location: BASE + '/desktop-login.html?done=1' } }); });
      await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|www\.gstatic\.com\/firebasejs)/, (r) => r.abort());
      const tag = w + '-' + theme;
      console.log('\n== ' + tag + ' ==');

      // 1. start state
      await p.goto(BASE + '/desktop-login.html?nonce=' + NONCE + '&port=51999', { waitUntil: 'load' });
      await p.waitForTimeout(400);
      check('nonce removed from the address bar', !/nonce/.test(p.url()), p.url().replace(BASE, ''));
      check('start: Continue with Google visible', await p.locator('#dl-google').isVisible());
      const card = await box(p, '.dl-card'), btn = await box(p, '#dl-google'), logo = await box(p, '.dl-logo'), title = await box(p, '.dl-card h1');
      const vw = w;
      check('card centred horizontally (±1px)', Math.abs(card.x - (vw - card.x - card.w)) <= 1, { left: card.x, right: +(vw - card.x - card.w).toFixed(1) });
      check('button inside card with equal side padding', Math.abs((btn.x - card.x) - (card.x + card.w - btn.x - btn.w)) <= 1, { l: +(btn.x - card.x).toFixed(1), r: +(card.x + card.w - btn.x - btn.w).toFixed(1) });
      check('Google button 48px tall (tap target)', btn.h >= 48 && btn.h <= 49, btn.h);
      const inner = await p.evaluate(() => { const b = document.getElementById('dl-google'); const s = b.querySelector('svg').getBoundingClientRect(), t = [...b.querySelectorAll('span')].find((x) => !x.hidden).getBoundingClientRect(), r = b.getBoundingClientRect(); return { btn: +(r.y + r.height / 2).toFixed(1), icon: +(s.y + s.height / 2).toFixed(1), text: +(t.y + t.height / 2).toFixed(1), gap: +(t.x - s.right).toFixed(1) }; });
      check('icon + label share the button centre (±1px), gap 12', Math.abs(inner.icon - inner.btn) <= 1 && Math.abs(inner.text - inner.btn) <= 1 && Math.abs(inner.gap - 12) <= 0.5, inner);
      check('logo centred in card (±1px)', Math.abs((logo.x + logo.w / 2) - (card.x + card.w / 2)) <= 1, { logo: logo.x + logo.w / 2, card: card.x + card.w / 2 });
      check('logo -> title gap 24', Math.abs(title.y - (logo.y + logo.h) - 24) <= 1, +(title.y - logo.y - logo.h).toFixed(1));
      check('no horizontal scroll', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await p.screenshot({ path: path.join(OUT, 'dl-start-' + tag + '.png') });

      // 2. popup closed: error shown, button usable again
      await p.evaluate(() => { window.__popupFail = true; });
      await p.click('#dl-google'); await p.waitForTimeout(300);
      const errTxt = await p.locator('.dl-error').first().textContent();
      check('popup closed -> friendly error, button enabled', /closed before finishing/.test(errTxt) && await p.locator('#dl-google').isEnabled(), errTxt);
      await p.screenshot({ path: path.join(OUT, 'dl-error-' + tag + '.png') });

      // 3. success: separate in-memory Firebase app, handoff POST, loopback redirect, done screen
      await p.evaluate(() => { window.__popupFail = false; });
      await p.click('#dl-google');
      await p.waitForURL(/done=1/, { timeout: 5000 }).catch(() => {});
      check('handoff POST: Bearer ID token + nonce, no cookies needed', handoffReq && handoffReq.method === 'POST' && handoffReq.auth === 'Bearer ID.TOKEN.x' && handoffReq.body.nonce === NONCE, handoffReq);
      check('browser sent to http://127.0.0.1:<port>/done?code=<code>', navTo === 'http://127.0.0.1:51999/done?code=' + CODE, navTo);
      await p.waitForTimeout(300);
      const doneTxt = await p.locator('.dl-card').innerText();
      check('done: "You\'re signed in, you can close this tab"', /You're signed in/.test(doneTxt) && /close this tab and go back to TradeZoro/.test(doneTxt));
      const chk = await box(p, '.dl-check'), card2 = await box(p, '.dl-card');
      check('done tick centred (±1px)', Math.abs((chk.x + chk.w / 2) - (card2.x + card2.w / 2)) <= 1);
      await p.screenshot({ path: path.join(OUT, 'dl-done-' + tag + '.png') });

      // 4. bad link + opened inside the app
      await p.goto(BASE + '/desktop-login.html', { waitUntil: 'load' }); await p.waitForTimeout(300);
      check('no nonce -> "Start again from the app"', /Start again from the app/.test(await p.locator('.dl-card').innerText()));
      await p.screenshot({ path: path.join(OUT, 'dl-invalid-' + tag + '.png') });

      // 5. the app's login page while waiting (tzDesktop stub)
      await p.addInitScript(() => { window.tzDesktop = { platform: 'windows-app', googleSignIn: () => new Promise((res, rej) => { window.__deskReject = rej; window.__deskResolve = res; }), cancelGoogleSignIn: () => window.__deskReject(new Error('cancelled')) }; });
      await p.goto(BASE + '/login.html', { waitUntil: 'load' }); await p.waitForTimeout(800);
      await p.click('[data-google-signin]'); await p.waitForTimeout(300);
      const note = await box(p, '#tz-desk-wait'), cbtn = await box(p, '#tz-desk-wait .auth-note-action'), ntext = await box(p, '#tz-desk-wait > span'), gbtn = await box(p, '[data-google-signin]');
      check('waiting note: text and Cancel share one vertical centre (±1px)', Math.abs(cbtn.cy - note.cy) <= 1 && Math.abs(ntext.cy - note.cy) <= 1, { note: note.cy, text: ntext.cy, cancel: cbtn.cy });
      check('waiting note: Cancel 32px, right inset 1px border + 8 padding', cbtn.h === 32 && Math.abs((note.x + note.w - cbtn.x - cbtn.w) - 9) <= 1, { h: cbtn.h, right: +(note.x + note.w - cbtn.x - cbtn.w).toFixed(1) });
      check('waiting note same width as the Google button', Math.abs(note.w - gbtn.w) <= 1 && Math.abs(note.x - gbtn.x) <= 1, { note: [note.x, note.w], btn: [gbtn.x, gbtn.w] });
      await p.screenshot({ path: path.join(OUT, 'app-waiting-' + tag + '.png') });
      await p.click('#tz-desk-wait .auth-note-action'); await p.waitForTimeout(300);
      check('Cancel -> "Google sign-in was cancelled." and note gone', /cancelled/.test(await p.locator('#login-error').textContent()) && !(await p.locator('#tz-desk-wait').count()));
      await p.click('[data-google-signin]'); await p.waitForTimeout(200);
      await p.evaluate(() => window.__deskResolve({ token: 'CUSTOM.TOKEN.x' })); await p.waitForTimeout(300);
      check('token from the app -> signInWithCustomToken', await p.evaluate(() => window.__ct) === 'CUSTOM.TOKEN.x');
      check('no page errors', errors.length === 0, errors);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
