// Live futures data add-on, client side (copy of trial-test.js plumbing): add-on checkout, Settings > Billing for
// add-on / early-Pro (grandfathered) / manual approval / lapsed, and the Help answer. Shots at 390 and 1440.
//
//   (setsid nohup python3 -m http.server 8000 --directory ../.. >/dev/null 2>&1 &)
//   node trial-test.js [outdir]
//
// Firebase is stubbed (settings/commerce, plans, the student doc, and the
// trialEligibility callable); every non-local request is aborted. Screenshots
// at 390 and 1440 go to outdir (default /tmp/trial-shots).
const fs = require('fs');
const path = require('path');
const { launch, BASE } = require('./lib');

const OUT = process.argv[2] || '/tmp/t6-r2-shots';
fs.mkdirSync(OUT, { recursive: true });

function stub(cfg) {
  const body = function (CFG) {
    const DATA = {
      'settings/commerce': { usdInr: 88.2, stripeCheckout: true, trialEnabled: CFG.trialOn },
      'settings/pageAccess': {},
      'plans/free': { name: 'Starter', displayName: 'Free', rank: 0, price: '0', period: 'month', features: ['Core lessons'] },
      'plans/LiveData': { name: 'Live Futures Data', displayName: 'Live Futures Data', rank: 0, price: '5', period: 'month', interval: 'month', addon: true, hidden: true, features: ['Real-time CME futures data on ZoroCharts'] },
      'plans/pro': { name: 'Pro', rank: 1, price: '39', period: 'month', featured: true, yearlyPlanId: 'proy', color: '#03c988',
        features: ['Full curriculum', 'Trade journal', 'Backtesting', 'Community'] },
      'plans/proy': { name: 'Pro', rank: 1, price: '349', period: 'year', hidden: true },
      'students/u1': CFG.student || { name: 'Test Trader', plan: 'Starter', planId: 'free' }
    };
    window.__calls = [];
    const snap = (id, d) => ({ id, exists: !!d, data: () => d || {}, ref: {} });
    const list = (col) => {
      const docs = Object.keys(DATA).filter((k) => k.startsWith(col + '/') && k.split('/').length === 2)
        .map((k) => snap(k.split('/')[1], DATA[k]));
      return { empty: !docs.length, size: docs.length, docs, forEach: (f) => docs.forEach(f) };
    };
    const docRef = (col, id) => ({
      id, get: () => Promise.resolve(snap(id, DATA[col + '/' + id])),
      set: () => Promise.resolve(), update: () => Promise.resolve(), delete: () => Promise.resolve(),
      onSnapshot: (cb) => { setTimeout(() => cb(snap(id, DATA[col + '/' + id])), 10); return () => {}; },
      collection: (sub) => colRef(col + '/' + id + '/' + sub)
    });
    const colRef = (col) => ({
      doc: (id) => docRef(col, id || 'auto'),
      get: () => Promise.resolve(list(col)),
      add: () => Promise.resolve({ id: 'x' }),
      where: () => colRef(col), orderBy: () => colRef(col), limit: () => colRef(col), startAfter: () => colRef(col),
      onSnapshot: (cb) => { setTimeout(() => cb(list(col)), 10); return () => {}; }
    });
    const db = { collection: colRef, batch: () => ({ set(){}, update(){}, delete(){}, commit: () => Promise.resolve() }),
      runTransaction: (f) => f({ get: (r) => r.get(), set(){}, update(){} }) };
    const user = CFG.signedIn ? { uid: 'u1', email: 't@e.com', emailVerified: true, displayName: 'Test Trader',
      getIdToken: () => Promise.resolve('t'), getIdTokenResult: () => Promise.resolve({ claims: {} }), reload: () => Promise.resolve() } : null;
    const authObj = {
      currentUser: user,
      onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; },
      setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve()
    };
    const fns = { httpsCallable: (name) => (data) => {
      window.__calls.push({ name, data });
      if (name === 'trialEligibility') return Promise.resolve({ data: { eligible: !!CFG.eligible, days: 7, reason: CFG.eligible ? 'ok' : 'trial-used' } });
      return new Promise(() => {});
    } };
    window.firebase = {
      apps: [{}], initializeApp: () => ({}),
      app: () => ({ functions: () => fns }), functions: () => fns,
      firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => 'TS', increment: (n) => n, delete: () => 'D',
        arrayUnion: () => 'AU', arrayRemove: () => 'AR' }, Timestamp: { now: () => ({ toDate: () => new Date() }) } }),
      auth: Object.assign(() => authObj, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } }, GoogleAuthProvider: function () {} }),
      messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} })
    };
    window.db = db;
    window.auth = authObj;
    if (CFG.inr) { try { localStorage.setItem('stryker_currency', 'INR'); } catch (e) {} }
    else { try { localStorage.setItem('stryker_currency', 'USD'); } catch (e) {} }
    try { localStorage.setItem('stryker_install_dismissed', '1'); } catch (e) {}
  };
  return '(' + body.toString() + ')(' + JSON.stringify(cfg) + ')';
}

let fails = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label.padEnd(60) + ' ' + JSON.stringify(got) + (ok ? '' : '   (want ' + JSON.stringify(want) + ')'));
}

// Screenshot the card/panel that holds `sel` (or `sel` itself), with every
// fixed overlay (onboarding, install prompt) hidden so the subject is in frame.
async function shot(p, sel, name, self) {
  await p.addStyleTag({ content: '.reveal{opacity:1!important;transform:none!important}' });
  await p.evaluate(() => document.querySelectorAll('body *').forEach((e) => {
    const cs = getComputedStyle(e);
    if (cs.position === 'fixed' && e.offsetHeight > 200 && !e.closest('.plan-modal-overlay')) e.style.display = 'none';
  }));
  const target = self ? p.locator(sel) : p.locator(sel).locator('xpath=ancestor-or-self::*[contains(@class,"card") or contains(@class,"panel") or contains(@class,"dash-main")][1]');
  await target.first().scrollIntoViewIfNeeded();
  await p.waitForTimeout(300);
  await target.first().screenshot({ path: path.join(OUT, name + '.png') });
}

async function page(browser, url, cfg, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: width < 500 ? 2 : 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(stub(cfg));
  await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await p.goto(BASE + '/' + url, { waitUntil: 'load' });
  await p.waitForTimeout(1800);
  return { p, ctx, errors };
}


(async () => {
  const browser = await launch();
  const soon = Date.now() + 20 * 864e5;
  try {
    for (const w of [390, 1440]) {
      console.log('\n== width ' + w + ' ==');
      let { p, ctx, errors } = await page(browser, 'checkout.html?plan=LiveData', { trialOn: true, eligible: true, signedIn: true }, w);
      let r = await p.evaluate(() => ({ txt: document.body.innerText, total: (document.getElementById('checkout-total') || {}).textContent, overflow: document.documentElement.scrollWidth > window.innerWidth }));
      check('addon checkout: total shows $5', /\$5(\.00)?/.test(r.total || ''), true);
      check('addon checkout: bullet present', /Real-time CME futures/.test(r.txt), true);
      check('addon checkout: no overflow', r.overflow, false);
      check('addon checkout: no trial wording', /free trial|7-day/i.test(r.txt), false);
      await p.screenshot({ path: path.join(OUT, 'checkout-addon-' + w + '.png') });
      check('addon checkout: no page errors', errors, []);
      await ctx.close();
      ({ p, ctx, errors } = await page(browser, 'settings.html', { signedIn: true, student: { name: 'Test Trader', plan: 'Starter', planId: 'free', liveData: { active: true, source: 'stripe', autopay: true, paidThroughMillis: soon, stripeSubscriptionId: 'sub_1' } } }, w));
      r = await p.evaluate(() => ({ st: document.getElementById('settings-ld-status').textContent, date: document.getElementById('settings-ld-date').textContent }));
      check('settings add-on: status on', r.st, 'On: real-time CME futures');
      check('settings add-on: renews line', /\$5\/month/.test(r.date), true);
      await shot(p, '#settings-livedata-panel', 'settings-addon-' + w, true);
      await ctx.close();
      ({ p, ctx, errors } = await page(browser, 'settings.html', { signedIn: true, student: { name: 'Test Trader', plan: 'Pro', planId: 'pro', subscriptionStatus: 'active', paidThroughMillis: soon, liveFeed: true, liveFeedGrandfathered: true } }, w));
      r = await p.evaluate(() => ({ st: document.getElementById('settings-ld-status').textContent, buy: getComputedStyle(document.getElementById('settings-ld-buy')).display }));
      check('settings grandfathered: early Pro line', r.st, 'Live futures data: included for you as an early Pro member');
      check('settings grandfathered: no buy button', r.buy, 'none');
      await shot(p, '#settings-livedata-panel', 'settings-grandfathered-' + w, true);
      await ctx.close();
      ({ p, ctx, errors } = await page(browser, 'settings.html', { signedIn: true, student: { name: 'Test Trader', plan: 'Starter', planId: 'free', subscriptionStatus: 'expired', liveFeed: true, liveFeedGrandfathered: true } }, w));
      r = await p.evaluate(() => ({ st: document.getElementById('settings-ld-status').textContent, buy: getComputedStyle(document.getElementById('settings-ld-buy')).display }));
      check('settings grandfathered, Pro ended: off + buy shown', [r.st, r.buy !== 'none'], ['Off: futures are 10 minutes behind', true]);
      await ctx.close();
      ({ p, ctx, errors } = await page(browser, 'settings.html', { signedIn: true, student: { name: 'Test Trader', plan: 'Starter', planId: 'free', liveFeed: true } }, w));
      r = await p.evaluate(() => document.getElementById('settings-ld-status').textContent);
      check('settings manual liveFeed: approved line', r, 'On: approved by TradeZoro');
      await ctx.close();
      ({ p, ctx, errors } = await page(browser, 'help.html', { signedIn: false }, w));
      const hit = await p.evaluate(() => { const d = [...document.querySelectorAll('details')].find((x) => /How do I get live futures data\?/.test(x.textContent)); if (!d) return null; d.open = true; d.scrollIntoView({ block: 'center' }); return d.innerText.slice(0, 600); });
      check('help: live futures answer exists', !!hit, true);
      await p.waitForTimeout(300);
      await p.screenshot({ path: path.join(OUT, 'help-answer-' + w + '.png') });
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
