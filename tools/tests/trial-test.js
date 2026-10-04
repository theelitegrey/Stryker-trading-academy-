// 7-day free trial, client side: checkout, pricing cards, upgrade modal,
// settings billing line and the dashboard strip, with the switch on and off.
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

const OUT = process.argv[2] || '/tmp/trial-shots';
fs.mkdirSync(OUT, { recursive: true });

function stub(cfg) {
  const body = function (CFG) {
    const DATA = {
      'settings/commerce': { usdInr: 88.2, stripeCheckout: true, trialEnabled: CFG.trialOn },
      'settings/pageAccess': {},
      'plans/free': { name: 'Starter', displayName: 'Free', rank: 0, price: '0', period: 'month', features: ['Core lessons'] },
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
  const trialSmall = /^Card required\. You won't be charged until \d{1,2} \w{3} \d{4}\. Then \$39\/month\. Cancel anytime before \d{1,2} \w{3} \d{4} in Billing\.$/;
  try {
    for (const w of [390, 1440]) {
      console.log('\n== width ' + w + ' ==');
      // Checkout, USD, eligible, switch on
      let { p, ctx, errors } = await page(browser, 'checkout.html?plan=pro', { trialOn: true, eligible: true, signedIn: true }, w);
      let r = await p.evaluate(() => ({
        btn: document.getElementById('checkout-complete-btn').textContent,
        small: (document.getElementById('checkout-trial-print') || {}).innerText,
        under: !!document.querySelector('#checkout-complete-btn + #checkout-trial-print'),
        total: document.getElementById('checkout-total').textContent,
        overflow: document.documentElement.scrollWidth > window.innerWidth
      }));
      check('checkout USD: trial button', r.btn, 'Start 7-day free trial');
      check('checkout USD: honest small print', trialSmall.test(r.small), true);
      check('checkout USD: total $0 today', r.total, '$0 today');
      check('checkout USD: small print sits right under the button', r.under, true);
      check('checkout: no sideways scroll', r.overflow, false);
      await shot(p, '#checkout-complete-btn', 'checkout-usd-' + w);
      // click -> stripeCreateCheckout with trial:true (billing form must be filled first)
      await p.evaluate(() => {
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
        set('bill-name', 'Test'); set('bill-address', '1 St'); set('bill-city', 'X'); set('bill-postal', '1'); set('bill-country', 'US');
        document.getElementById('checkout-complete-btn').click();
      });
      await p.waitForTimeout(600);
      const calls = await p.evaluate(() => window.__calls);
      const sc = calls.find((c) => c.name === 'stripeCreateCheckout');
      check('click: stripeCreateCheckout sent trial:true', sc && sc.data.trial, true);
      check('checkout: no page errors', errors, []);
      await ctx.close();

      // Checkout, switch OFF: unchanged
      ({ p, ctx, errors } = await page(browser, 'checkout.html?plan=pro', { trialOn: false, eligible: true, signedIn: true }, w));
      r = await p.evaluate(() => ({ btn: document.getElementById('checkout-complete-btn').textContent,
        calls: window.__calls.map((c) => c.name), print: !!document.getElementById('checkout-trial-print') && document.getElementById('checkout-trial-print').style.display !== 'none' }));
      check('switch OFF: no trial small print', r.print, false);
      check('switch OFF: normal subscribe button', /^Subscribe: \$39 today$/.test(r.btn), true);
      check('switch OFF: eligibility callable never called', r.calls.includes('trialEligibility'), false);
      await ctx.close();

      // Checkout, switch on but NOT eligible
      ({ p, ctx } = await page(browser, 'checkout.html?plan=pro', { trialOn: true, eligible: false, signedIn: true }, w));
      r = await p.evaluate(() => document.getElementById('checkout-complete-btn').textContent);
      check('not eligible: normal subscribe button', /^Subscribe: \$39 today$/.test(r), true);
      await ctx.close();

      // Checkout, INR, eligible (mandate)
      ({ p, ctx, errors } = await page(browser, 'checkout.html?plan=pro', { trialOn: true, eligible: true, signedIn: true, inr: true }, w));
      r = await p.evaluate(() => ({ btn: document.getElementById('checkout-complete-btn').textContent,
        small: (document.getElementById('checkout-trial-print') || {}).innerText }));
      check('checkout INR: trial button', r.btn, 'Start 7-day free trial');
      check('checkout INR: rupee price at live rate (39 x 88.2 = 3,440)', /Then ₹3,440\/month/.test(r.small), true);
      check('checkout INR: says card or UPI AutoPay required', /UPI AutoPay required/.test(r.small), true);
      await shot(p, '#checkout-complete-btn', 'checkout-inr-' + w);
      check('checkout INR: no page errors', errors, []);
      await ctx.close();

      // Homepage pricing: the "Hero Pro" layout (build 393, assets/pricing-hero.js).
      // The spotlight CTA .pv-hero [data-pro-cta] gets the trial label and small
      // print; the "Start free" strip must stay untouched.
      ({ p, ctx, errors } = await page(browser, 'index.html', { trialOn: true, eligible: true, signedIn: true }, w));
      await p.waitForSelector('.pv-hero [data-pro-cta]', { timeout: 8000 }).catch(() => {});
      await p.waitForTimeout(800);
      r = await p.evaluate(() => {
        const cta = document.querySelector('.pv-hero [data-pro-cta]');
        const next = cta && cta.nextElementSibling;
        const strip = document.querySelector('.pv-strip');
        return { cta: cta ? cta.textContent : null,
          small: !!(next && next.classList.contains('trial-smallprint')),
          freeSmall: !!(strip && strip.querySelector('.trial-smallprint')),
          freeBtn: strip ? (strip.querySelector('a.btn') || {}).textContent : null };
      });
      check('pricing: Hero Pro CTA says Start 7-day free trial + small print', [r.cta, r.small], ['Start 7-day free trial', true]);
      check('pricing: Start free strip untouched', [r.freeSmall, /trial/i.test(r.freeBtn || '')], [false, false]);
      await shot(p, '.pv-hero', 'pricing-' + w, true);
      check('pricing: no page errors', errors, []);
      await ctx.close();

      // Switch off: the Hero Pro CTA keeps its normal label, no small print
      ({ p, ctx, errors } = await page(browser, 'index.html', { trialOn: false, eligible: true, signedIn: true }, w));
      await p.waitForSelector('.pv-hero [data-pro-cta]', { timeout: 8000 }).catch(() => {});
      await p.waitForTimeout(800);
      r = await p.evaluate(() => {
        const cta = document.querySelector('.pv-hero [data-pro-cta]');
        return { cta: cta ? cta.textContent : null, small: !!document.querySelector('.pv-hero .trial-smallprint') };
      });
      check('pricing (switch off): Hero Pro CTA has no trial label or small print', [/trial/i.test(r.cta || ''), r.small, !!r.cta], [false, false, true]);
      await ctx.close();

      // Upgrade modal (dashboard)
      ({ p, ctx, errors } = await page(browser, 'dashboard-user.html', { trialOn: true, eligible: true, signedIn: true }, w));
      const opener = await p.evaluate(() => typeof window.openPlanUpgradeModal === 'function' ? ['openPlanUpgradeModal'] : []);
      if (opener.length) {
        await p.evaluate((n) => window[n]('Test reason'), opener[0]);
        await p.waitForTimeout(1200);
        r = await p.evaluate(() => [...document.querySelectorAll('.plan-modal-card')].map((c) => ({
          btn: (c.querySelector('.plan-modal-pick') || {}).textContent, small: !!c.querySelector('.trial-smallprint') })));
        check('upgrade modal: Pro offers the trial + small print', r.some((c) => c.btn === 'Start 7-day free trial' && c.small), true);
        await p.evaluate(() => document.querySelectorAll('body > *').forEach((e) => {
          if (getComputedStyle(e).position === 'fixed' && e.id !== 'plan-upgrade-modal') e.style.display = 'none';
        }));
        await p.locator('#plan-upgrade-modal .plan-modal-card').last().scrollIntoViewIfNeeded();
        await p.locator('.plan-modal').screenshot({ path: path.join(OUT, 'modal-' + w + '.png') });
      } else {
        check('upgrade modal opener found', opener, ['<fn>']);
      }
      await ctx.close();

      // Dashboard strip + settings line for a member on a trial
      const trialStudent = { name: 'Test Trader', onboardingDone: true, tourDone: true, journalOnboarded: true, plan: 'Pro', planId: 'pro', subscriptionStatus: 'trialing', subscriptionAutopay: true,
        paidThroughMillis: Date.now() + 5 * 864e5 - 3600e3, trialEndsAt: Date.now() + 5 * 864e5, billingProvider: 'stripe', stripeSubscriptionId: 'sub_1' };
      ({ p, ctx, errors } = await page(browser, 'dashboard-user.html', { trialOn: false, signedIn: true, student: trialStudent }, w));
      r = await p.evaluate(() => { const e = document.getElementById('trial-strip'); return e ? e.innerText : null; });
      check('dashboard strip: days left + charge date + cancel link', !!r && /Free trial: 5 days left\..*first charge is on .* unless you cancel.*Cancel or manage billing/.test(r), true);
      check('dashboard: no sideways scroll', await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      await shot(p, '#trial-strip', 'dashboard-' + w);
      await ctx.close();

      ({ p, ctx, errors } = await page(browser, 'settings.html', { trialOn: false, signedIn: true, student: trialStudent }, w));
      r = await p.evaluate(() => ({ line: (document.getElementById('settings-plan-renewal') || {}).textContent,
        bill: (document.getElementById('settings-manage-billing') || {}).textContent,
        billShown: (document.getElementById('settings-manage-billing') || { style: {} }).style.display !== 'none' }));
      check('settings: trial line with days left + charge date', /^Free trial: 5 days left\. First charge on .+ unless you cancel before then\.$/.test(r.line || ''), true);
      check('settings: cancel link shown (Stripe portal)', [r.billShown, r.bill], [true, 'Cancel free trial or manage card']);
      await shot(p, '#settings-renewal-row', 'settings-' + w);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
