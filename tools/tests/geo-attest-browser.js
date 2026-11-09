// Sanctions attestation, browser test (Owner order 09 Nov 2026): sign-up picker + checkbox, the one-time member
// prompt, the blocked-residence lock, and screenshots of the block page and the attestation (390/1440, dark/light).
//
//   (setsid nohup python3 -m http.server 8000 --directory ../.. >/dev/null 2>&1 &)
//   flock /tmp/stryker-chrome.lock node tools/tests/geo-attest-browser.js [outdir]
//
// Firebase is stubbed (students doc + recorded writes); every non-local request is aborted.
const fs = require('fs');
const path = require('path');
const { launch, BASE } = require('./lib');
const OUT = process.argv[2] || '/tmp/geo-shots';
fs.mkdirSync(OUT, { recursive: true });

function stub(cfg) {
  const body = function (CFG) {
    const DATA = {
      'settings/commerce': { usdInr: 88, stripeCheckout: true },
      'settings/pageAccess': {},
      'plans/free': { name: 'Starter', displayName: 'Free', rank: 0, price: '0', period: 'month' },
      'students/u1': CFG.student || null
    };
    window.__sets = []; window.__signedOut = 0;
    const snap = (id, d) => ({ id, exists: !!d, data: () => d || {}, ref: {} });
    const list = () => ({ empty: true, size: 0, docs: [], forEach() {} });
    const docRef = (col, id) => ({
      id, get: () => Promise.resolve(snap(id, DATA[col + '/' + id])),
      set: (d, o) => { window.__sets.push({ path: col + '/' + id, d, o }); if (CFG.failSet && col === 'students') return Promise.reject({ code: 'unavailable' }); return Promise.resolve(); },
      update: () => Promise.resolve(), delete: () => Promise.resolve(),
      onSnapshot: (cb) => { setTimeout(() => cb(snap(id, DATA[col + '/' + id])), 10); return () => {}; },
      collection: (sub) => colRef(col + '/' + id + '/' + sub)
    });
    const colRef = (col) => ({
      doc: (id) => docRef(col, id || 'auto'), get: () => Promise.resolve(list()), add: () => Promise.resolve({ id: 'x' }),
      where: () => colRef(col), orderBy: () => colRef(col), limit: () => colRef(col), startAfter: () => colRef(col),
      onSnapshot: (cb) => { setTimeout(() => cb(list()), 10); return () => {}; }
    });
    const db = { collection: colRef, batch: () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() }),
      runTransaction: (f) => f({ get: (r) => r.get(), set() {}, update() {} }) };
    const user = CFG.signedIn ? { uid: 'u1', email: 't@e.com', emailVerified: true, displayName: 'Test Trader', providerData: [],
      getIdToken: () => Promise.resolve('t'), getIdTokenResult: () => Promise.resolve({ claims: {} }), reload: () => Promise.resolve() } : null;
    const authObj = {
      currentUser: user,
      onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; },
      setPersistence: () => Promise.resolve(), signOut: () => { window.__signedOut++; return Promise.resolve(); },
      createUserWithEmailAndPassword: () => { window.__created = (window.__created || 0) + 1; return new Promise(() => {}); },
      signInWithPopup: () => { window.__popup = (window.__popup || 0) + 1; return new Promise(() => {}); }
    };
    const fns = { httpsCallable: () => () => new Promise(() => {}) };
    window.firebase = {
      apps: [{}], initializeApp: () => ({}), app: () => ({ functions: () => fns }), functions: () => fns,
      firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => 'TS', increment: (n) => n, delete: () => 'D', arrayUnion: () => 'AU', arrayRemove: () => 'AR' },
        Timestamp: { now: () => ({ toDate: () => new Date() }) } }),
      auth: Object.assign(() => authObj, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } }, GoogleAuthProvider: function () { this.setCustomParameters = () => {}; } }),
      messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} })
    };
    try {
      localStorage.setItem('stryker_install_dismissed', '1');
      localStorage.setItem('stryker_cookie_notice', '1');
      if (CFG.light) localStorage.setItem('stryker_theme', 'day'); else localStorage.removeItem('stryker_theme');
      if (CFG.saved) sessionStorage.setItem('tz_geo_attest', JSON.stringify({ c: CFG.saved, t: Date.now() }));
    } catch (e) { /* ignore */ }
  };
  return '(' + body.toString() + ')(' + JSON.stringify(cfg) + ')';
}

let fails = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label.padEnd(66) + ' ' + JSON.stringify(got) + (ok ? '' : '   (want ' + JSON.stringify(want) + ')'));
}

async function open(browser, url, cfg, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: width < 500 ? 2 : 1,
    colorScheme: cfg.light ? 'light' : 'dark' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(stub(cfg));
  await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await p.goto(BASE + '/' + url, { waitUntil: 'load' });
  await p.waitForTimeout(cfg.wait || 1500);
  return { p, ctx, errors };
}
const hideOverlays = (p) => p.evaluate(() => document.querySelectorAll('body *').forEach((e) => {
  const cs = getComputedStyle(e);
  if (cs.position === 'fixed' && !e.closest('#geo-gate') && e.id !== 'geo-gate' && e.offsetHeight > 60) e.style.display = 'none';
}));

(async () => {
  const browser = await launch();
  try {
    // ---------- block page ----------
    for (const [w, light] of [[390, false], [1440, false], [390, true], [1440, true]]) {
      const { p, ctx } = await open(browser, 'unavailable.html', { light, wait: 300 }, w);
      const t = await p.evaluate(() => ({ h: document.querySelector('h1').textContent, m: document.querySelector('.msg').textContent,
        bg: getComputedStyle(document.body).backgroundColor, sw: document.documentElement.scrollWidth <= innerWidth }));
      check('block page ' + w + (light ? ' light' : ' dark') + ': text + no overflow', [t.h, t.m, t.sw],
        ['Not available in your region', "TradeZoro isn't available in your region. Due to US regulations, we can't offer our services in this location.", true]);
      check('block page ' + w + (light ? ' light' : ' dark') + ': background', t.bg, light ? 'rgb(245, 245, 247)' : 'rgb(5, 5, 6)');
      await p.screenshot({ path: path.join(OUT, 'block-' + w + (light ? '-light' : '-dark') + '.png') });
      await ctx.close();
    }

    // ---------- sign-up ----------
    for (const [w, light] of [[390, false], [1440, false], [390, true], [1440, true]]) {
      const { p, ctx, errors } = await open(browser, 'signup.html', { light }, w);
      const tag = w + (light ? ' light' : ' dark');
      const st = () => p.evaluate(() => ({ g: document.querySelector('[data-google-signin]').disabled, e: document.querySelector('#signup-form button[type=submit]').disabled,
        msg: !document.getElementById('geo-su-msg').hidden }));
      check('signup ' + tag + ': picker + checkbox present, above Google', await p.evaluate(() => {
        const g = document.getElementById('geo-signup'); const s = document.querySelector('.social-row');
        return [!!g, !!document.getElementById('geo-su-country'), !!document.getElementById('geo-su-attest'),
          !!(g.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING), document.getElementById('geo-su-country').options.length > 240];
      }), [true, true, true, true, true]);
      check('signup ' + tag + ': both sign-up buttons disabled at start', await st(), { g: true, e: true, msg: false });
      if (w === 390 && !light) {
        await hideOverlays(p);
        await p.locator('#geo-signup').screenshot({ path: path.join(OUT, 'signup-empty-390-dark.png') });
      }
      await p.selectOption('#geo-su-country', 'RU');
      await p.check('#geo-su-attest');
      check('signup ' + tag + ': Russia -> region message, still disabled', await st(), { g: true, e: true, msg: true });
      check('signup ' + tag + ': Russia option labelled "(not available)"', await p.evaluate(() => document.querySelector('#geo-su-country option[value=RU]').textContent), 'Russia (not available)');
      await hideOverlays(p);
      await p.locator('.auth-box').screenshot({ path: path.join(OUT, 'signup-blocked-' + w + (light ? '-light' : '-dark') + '.png') });
      await p.selectOption('#geo-su-country', 'UA-43');
      check('signup ' + tag + ': Ukraine - Crimea -> blocked', await st(), { g: true, e: true, msg: true });
      await p.selectOption('#geo-su-country', 'IN');
      check('signup ' + tag + ': India + ticked -> enabled', await st(), { g: false, e: false, msg: false });
      check('signup ' + tag + ': answer kept for the first page', await p.evaluate(() => JSON.parse(sessionStorage.getItem('tz_geo_attest')).c), 'IN');
      await p.uncheck('#geo-su-attest');
      check('signup ' + tag + ': unticked -> disabled again', await st(), { g: true, e: true, msg: false });
      // a forced click/submit while unanswered does nothing
      await p.evaluate(() => { document.querySelector('[data-google-signin]').disabled = false; document.querySelector('[data-google-signin]').click();
        const f = document.getElementById('signup-form'); f.querySelector('button[type=submit]').disabled = false; f.requestSubmit(); });
      await p.waitForTimeout(200);
      check('signup ' + tag + ': forced Google click / submit while unanswered start nothing', await p.evaluate(() => [window.__popup || 0, window.__created || 0]), [0, 0]);
      await p.check('#geo-su-attest');
      await hideOverlays(p);
      await p.locator('.auth-box').screenshot({ path: path.join(OUT, 'signup-ready-' + w + (light ? '-light' : '-dark') + '.png') });
      check('signup ' + tag + ': no page errors', errors, []);
      check('signup ' + tag + ': no horizontal overflow', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await ctx.close();
    }

    // ---------- existing member, no answer yet: must answer ----------
    for (const [w, light] of [[390, false], [1440, false], [390, true], [1440, true]]) {
      const tag = w + (light ? ' light' : ' dark');
      const { p, ctx, errors } = await open(browser, 'dashboard-user.html', { signedIn: true, light, student: { plan: 'Starter', displayName: 'Test Trader' }, wait: 2500 }, w);
      check('member ' + tag + ': dialog shown', await p.evaluate(() => !!document.getElementById('geo-gate') && getComputedStyle(document.getElementById('geo-gate')).display !== 'none'), true);
      check('member ' + tag + ': dialog covers the viewport, no close button', await p.evaluate(() => {
        const r = document.getElementById('geo-gate').getBoundingClientRect();
        return [r.top <= 0 && r.left <= 0 && r.width >= innerWidth && r.height >= innerHeight, !document.querySelector('#geo-gate .tz-x, #geo-gate [aria-label=Close]')];
      }), [true, true]);
      await p.keyboard.press('Escape');
      await p.mouse.click(5, 5);
      check('member ' + tag + ': Escape / outside click do not close it', await p.evaluate(() => !!document.getElementById('geo-gate')), true);
      check('member ' + tag + ': Continue disabled until answered', await p.evaluate(() => document.getElementById('geo-gt-save').disabled), true);
      await p.waitForTimeout(400);
      await p.screenshot({ path: path.join(OUT, 'member-prompt-' + w + (light ? '-light' : '-dark') + '.png') });
      await p.selectOption('#geo-gt-country', 'GB');
      await p.check('#geo-gt-attest');
      await p.click('#geo-gt-save');
      await p.waitForTimeout(400);
      const set = await p.evaluate(() => window.__sets.filter((s) => s.path === 'students/u1' && 'sanctionsAttest' in s.d));
      check('member ' + tag + ': saves residenceCountry + attest + server time, merge', set.map((s) => [s.d.residenceCountry, s.d.sanctionsAttest, s.d.sanctionsAttestAt, s.o && s.o.merge]), [['GB', true, 'TS', true]]);
      check('member ' + tag + ': dialog closed after saving', await p.evaluate(() => !document.getElementById('geo-gate')), true);
      check('member ' + tag + ': no page errors', errors.filter((e) => !/Failed to fetch|NetworkError|net::/.test(e)), []);
      await ctx.close();
    }

    // ---------- member picks a blocked country -> locked ----------
    {
      const { p, ctx } = await open(browser, 'dashboard-user.html', { signedIn: true, student: { plan: 'Starter' }, wait: 2500 }, 390);
      await p.selectOption('#geo-gt-country', 'IR');
      check('member picks Iran: region message + Confirm', await p.evaluate(() => [!document.getElementById('geo-gt-msg').hidden, document.getElementById('geo-gt-save').textContent, document.getElementById('geo-gt-save').disabled]), [true, 'Confirm', false]);
      await p.screenshot({ path: path.join(OUT, 'member-blocked-choice-390-dark.png') });
      await p.click('#geo-gt-save');
      await p.waitForTimeout(500);
      check('member picks Iran: stored (no attest), page locked, signed out', await p.evaluate(() => [
        window.__sets.filter((s) => s.path === 'students/u1' && 'residenceCountry' in s.d).map((s) => [s.d.residenceCountry, 'sanctionsAttest' in s.d]),
        document.querySelector('h1') && document.querySelector('h1').textContent, window.__signedOut > 0]), [[['IR', false]], 'Not available in your region', true]);
      await p.screenshot({ path: path.join(OUT, 'member-locked-390-dark.png') });
      await ctx.close();
    }
    // ---------- stored blocked residence / server lock -> locked on load ----------
    for (const [label, student] of [['stored RU', { plan: 'Starter', residenceCountry: 'RU' }], ['server lock', { plan: 'Pro', residenceCountry: 'US', sanctionsAttest: true, sanctionsLocked: true }]]) {
      const { p, ctx } = await open(browser, 'charts.html', { signedIn: true, student, wait: 3000 }, 1440);
      check('locked on load (' + label + ')', await p.evaluate(() => [document.querySelector('h1') && document.querySelector('h1').textContent, window.__signedOut > 0]), ['Not available in your region', true]);
      if (label === 'server lock') await p.screenshot({ path: path.join(OUT, 'member-locked-1440-dark.png') });
      await ctx.close();
    }
    // ---------- already answered -> nothing shown ----------
    {
      const { p, ctx } = await open(browser, 'settings.html', { signedIn: true, student: { plan: 'Starter', residenceCountry: 'IN', sanctionsAttest: true }, wait: 2500 }, 390);
      check('answered member: no dialog, no writes of the fields', await p.evaluate(() => [!document.getElementById('geo-gate'), window.__sets.filter((s) => s.d && 'residenceCountry' in s.d).length]), [true, 0]);
      await ctx.close();
    }
    // ---------- just signed up: the sign-up answer is saved silently ----------
    {
      const { p, ctx } = await open(browser, 'dashboard-user.html', { signedIn: true, saved: 'IN', student: { plan: 'Starter' }, wait: 2500 }, 390);
      check('fresh sign-up: saved silently, no dialog', await p.evaluate(() => [!document.getElementById('geo-gate'),
        window.__sets.filter((s) => s.path === 'students/u1' && s.d.sanctionsAttest === true).map((s) => s.d.residenceCountry)]), [true, ['IN']]);
      await ctx.close();
    }
    // ---------- save fails -> error line, dialog stays ----------
    {
      const { p, ctx } = await open(browser, 'dashboard-user.html', { signedIn: true, failSet: true, student: { plan: 'Starter' }, wait: 2500 }, 390);
      await p.selectOption('#geo-gt-country', 'US'); await p.check('#geo-gt-attest'); await p.click('#geo-gt-save'); await p.waitForTimeout(400);
      check('save fails: error shown, dialog stays, button usable', await p.evaluate(() => [!document.getElementById('geo-gt-err').hidden, !!document.getElementById('geo-gate'), document.getElementById('geo-gt-save').disabled]), [true, true, false]);
      await ctx.close();
    }
    // ---------- legal pages don't prompt; terms show the section ----------
    {
      const { p, ctx } = await open(browser, 'terms.html#restricted-regions', { signedIn: true, student: { plan: 'Starter' }, wait: 2500 }, 390);
      check('terms: no prompt, Restricted regions section present', await p.evaluate(() => [!document.getElementById('geo-gate'), !!document.getElementById('restricted-regions'),
        (document.getElementById('site-page-updated') || {}).textContent]), [true, true, 'Last updated 9 November 2026']);
      await p.screenshot({ path: path.join(OUT, 'terms-restricted-390-dark.png') });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(fails ? 'FAILED: ' + fails : 'geo-attest browser: all pass');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
