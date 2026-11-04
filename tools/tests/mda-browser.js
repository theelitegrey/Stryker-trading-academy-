// Market Data Agreement (2026-11-01), client side, same stub as addon-billing-browser.js: add-on checkout, Settings > Billing for
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

const OUT = process.argv[2] || '/tmp/mda-shots';
fs.mkdirSync(OUT, { recursive: true });

function stub(cfg) {
  const body = function (CFG) {
    const DATA = {
      'settings/commerce': { usdInr: 88.2, stripeCheckout: true, trialEnabled: CFG.trialOn },
      'settings/pageAccess': {},
      'plans/free': { name: 'Starter', displayName: 'Free', rank: 0, price: '0', period: 'month', features: ['Core lessons'] },
      'plans/LiveData': { name: 'Live Futures Data', displayName: 'Live Futures Data', rank: 0, price: '7', period: 'month', interval: 'month', addon: true, hidden: true, features: ['Real-time CME futures data on ZoroCharts'] },
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
      if (name === 'acceptMarketDataAgreement') return Promise.resolve({ data: { ok: true, version: 'v1' } });
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



const THEMES = ['dark', 'light'];
async function theme(p, t) { await p.evaluate((t) => { if (t === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme'); }, t); await p.waitForTimeout(200); }
const calls = (p) => p.evaluate(() => window.__calls.map((c) => c.name));

(async () => {
  const browser = await launch();
  try {
    for (const w of [390, 412, 1440]) {
      console.log('\n== width ' + w + ' ==');
      // 1. checkout?plan=LiveData: the add-on is no longer sold (Owner 2026-11-04, free L1 with the agreement): no form, no pay, a pointer to Settings
      let { p, ctx, errors } = await page(browser, 'checkout.html?plan=LiveData', { signedIn: true }, w);
      let r = await p.evaluate(() => ({ form: !!document.querySelector('#checkout-mda .mda-btn'), pay: document.getElementById('checkout-complete-btn').disabled, msg: document.getElementById('checkout-plan-summary').innerText, over: document.documentElement.scrollWidth > window.innerWidth }));
      check('checkout LiveData: not sold, points to free L1', [r.form, r.pay, /free once you sign the market data agreement/.test(r.msg), r.over], [false, true, true, false]);
      for (const t of THEMES) { await theme(p, t); await p.screenshot({ path: path.join(OUT, 'checkout-free-' + w + '-' + t + '.png') }); }
      check('checkout: no page errors', errors, []); await ctx.close();
      // 3. terms page
      ({ p, ctx, errors } = await page(browser, 'market-data-terms.html', { signedIn: false }, w));
      r = await p.evaluate(() => ({ h2: document.querySelectorAll('.article-body h2').length, ver: /v1 · 2026-11-01|Version v1/.test(document.body.innerText), over: document.documentElement.scrollWidth > window.innerWidth, foot: !!document.querySelector('.footer-legal-row a[href="market-data-terms"]') }));
      check('terms page: 10 sections, version, footer link, no overflow', [r.h2, r.ver, r.foot, r.over], [10, true, true, false]);
      for (const t of THEMES) { await theme(p, t); await p.screenshot({ path: path.join(OUT, 'terms-' + w + '-' + t + '.png'), fullPage: true }); }
      check('terms page: no page errors', errors, []); await ctx.close();
      // 4. settings line
      for (const [name, stu, want] of [['accepted', { name: 'T', plan: 'Starter', marketDataAgreement: { version: 'v1', nonProfessional: true, acceptedAt: { seconds: 1793527200 } } }, /accepted .*2026 · View terms/], ['none', { name: 'T', plan: 'Starter' }, /Not accepted · View terms/]]) {
        ({ p, ctx, errors } = await page(browser, 'settings.html', { signedIn: true, student: stu }, w));
        r = await p.evaluate(() => ({ t: document.getElementById('settings-ld-agree').textContent, buy: getComputedStyle(document.getElementById('settings-ld-sign')).display !== 'none', st: document.getElementById('settings-ld-status').textContent, nobuy: !document.getElementById('settings-ld-buy'), note: /Personal, non-commercial use only\. Terms/.test(document.getElementById('settings-livedata-panel').innerText) }));
        check('settings ' + name + ': agreement line', want.test(r.t), true);
        check('settings ' + name + ': sign button only when not signed, no buy button, disclaimer (free L1, 2026-11-04)', [r.buy, r.nobuy, r.note], [name !== 'accepted', true, true]);
        for (const t of THEMES) { await theme(p, t); await p.locator('#settings-livedata-panel').scrollIntoViewIfNeeded(); await p.locator('#settings-livedata-panel').screenshot({ path: path.join(OUT, 'settings-' + name + '-' + w + '-' + t + '.png') }); }
        await ctx.close();
      }
      // 5. modal (as ZoroCharts opens it): drive StkMDA directly on a lightweight page
      ({ p, ctx, errors } = await page(browser, 'settings.html', { signedIn: true, student: { name: 'T', plan: 'Starter', liveFeed: true } }, w));
      await p.addScriptTag({ url: '/assets/market-data-agreement.js' }); await p.evaluate(() => StkMDA.modal());
      for (const t of THEMES) { await theme(p, t); await p.screenshot({ path: path.join(OUT, 'modal-' + w + '-' + t + '.png') }); }
      r = await p.evaluate(() => { const d = document.querySelector('.mda-dlg').getBoundingClientRect(); return { fits: d.right <= window.innerWidth && d.left >= 0, x: Math.round(document.querySelector('.mda-x').getBoundingClientRect().width) }; });
      check('modal: fits viewport, close button 44px', [r.fits, r.x], [true, 44]);
      await p.keyboard.press('Escape'); r = await p.evaluate(() => !document.querySelector('.mda-scrim'));
      check('modal: Escape closes it', r, true);
      await p.evaluate(() => StkMDA.modal()); r = await p.evaluate(() => !!document.querySelector('.mda-scrim'));
      check('modal: opens again (closing is not remembered)', r, true);
      check('modal: no page errors', errors, []); await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
