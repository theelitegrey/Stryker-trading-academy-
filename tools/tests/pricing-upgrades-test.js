// Pricing upgrades (2026-10-12): yearly-as-monthly line + the shared Pro lock card.
// Stubs the live plan shape (Pro 109 on sale at 39, yearly twin 349; Free
// chapterAccess 1-10) and checks, at 390 and 1280:
//   - home #pricing: "or $29/mo billed yearly ($349) · save 25%" (USD) and the
//     rupee figures from the same rate + floor (INR)
//   - upgrade modal + checkout: the same yearly line
//   - GEX as a Free member: tapping QQQ (NQ) / 1DTE shows ONE lock card (title,
//     2 bullets, button, "Education only..."); the strike table shows the same card
//   - button reads "Start 7-day free trial" when the trial callable says eligible,
//     "Join Pro" when not (trial already used)
//   - chapter 11 as a Free member: the lock card in the paywall; end of chapter 10:
//     the lock card above prev/next
//   UPG_SHOTS=<dir> node pricing-upgrades-test.js     (needs http.server on STRYKER_TEST_PORT)
const fs = require('fs');
const path = require('path');
const { BASE, launch } = require('./lib.js');
const log = [];
const ok = (l, c, x) => log.push((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '   ' + x : ''));
const SHOTS = process.env.UPG_SHOTS || '';
const RATE = 96.73;
const FIX = path.join(__dirname, 'fixtures', 'gex');

function stubFor(mode, trial) {
  const body = function (MODE, RATE, TRIAL) {
    const UID = 'u1';
    const FREE = 'WuvUQyHX82ZzHP2sKLms', PRO = 'Sj1bjdpwvYJUVErjNMAb', ELITE = 'OMSNNQrZ4aBPReRMOpUB';
    const plans = [
      { id: FREE, name: 'Starter', displayName: 'Free', rank: 0, chapterAccess: '1-10', price: '0', period: 'month', features: ['Chapters 1-10'], color: '#00ffff' },
      { id: PRO, name: 'Pro', rank: 1, chapterAccess: 'all', price: '109', salePrice: '39', onSale: true, saleLabel: 'Launch sale', saleEndsAt: '', period: 'month', featured: true, yearlyPlanId: 'proYearly', features: ['All chapters', 'Every GEX symbol', 'Unlimited journal', 'Replay', 'Community', 'Indicators'], color: '#ff0000', ctaLabel: 'Join Pro' },
      { id: 'proYearly', name: 'Pro', rank: 1, chapterAccess: 'all', price: '349', period: 'year', hidden: true },
      { id: ELITE, name: 'Elite', rank: 2, chapterAccess: 'all', price: '129', period: 'month', archived: true, features: ['x'], color: '#ffff00' }
    ];
    const PLAN = { free: 'Starter', pro: 'Pro', out: null }[MODE];
    const snap = (id, d) => ({ id, exists: !!d, data: () => d || {} });
    function docGet(coll, id) {
      if (coll === 'settings' && id === 'commerce') return Promise.resolve(snap(id, { usdInr: RATE, trialEnabled: true, launchSale: { active: false } }));
      if (coll === 'settings' && id === 'pageAccess') return Promise.resolve(snap(id, {}));
      if (coll === 'admins') return Promise.resolve(snap(id, null));
      if (coll === 'students') return Promise.resolve(snap(id, PLAN ? { uid: UID, plan: PLAN, name: 'Stub ' + MODE, completedLessons: [], completedChapters: [] } : null));
      if (coll === 'plans') return Promise.resolve(snap(id, plans.find((p) => p.id === id) || null));
      if (coll === 'chapterBodies') {
        const n = parseInt(id, 10);
        return Promise.resolve(snap(id, n <= 10 ? { num: id, bodyHtml: '<p>Stub chapter text for chapter ' + id + '.</p>' } : null));
      }
      return Promise.resolve(snap(id, null));
    }
    function docRef(coll, id) {
      return { id, get: () => docGet(coll, id), set: () => Promise.resolve(), update: () => Promise.resolve(), delete: () => Promise.resolve(),
        onSnapshot: (cb) => { docGet(coll, id).then(cb, () => {}); return () => {}; }, collection: (sub) => colRef(sub) };
    }
    function rows(coll) { return coll === 'plans' ? plans.slice() : []; }
    function listSnap(list) {
      const docs = list.map((d) => ({ id: d.id, exists: true, data: () => d }));
      return { empty: !docs.length, size: docs.length, docs, forEach: (f) => docs.forEach(f), docChanges: () => [] };
    }
    function colRef(coll, n) {
      const self = { doc: (id) => docRef(coll, id || 'auto'), get: () => Promise.resolve(listSnap(rows(coll).slice(0, n || 999))), add: () => Promise.resolve({ id: 'x' }),
        where: () => self, orderBy: () => self, limit: (k) => colRef(coll, k), startAfter: () => self,
        onSnapshot: (cb) => { setTimeout(() => cb(listSnap(rows(coll))), 10); return () => {}; } };
      return self;
    }
    const user = PLAN ? { uid: UID, email: 'stub@test.local', displayName: 'Stub', emailVerified: true,
      getIdTokenResult: () => Promise.resolve({ claims: {} }), getIdToken: () => Promise.resolve('t') } : null;
    const callable = (name) => () => Promise.resolve({ data: name === 'trialEligibility' ? { eligible: !!TRIAL } : {} });
    window.__stubDb = { collection: (c) => colRef(c), batch: () => ({ set(){}, update(){}, delete(){}, commit: () => Promise.resolve() }) };
    window.db = window.__stubDb;
    window.__stubAuth = { currentUser: user, onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; },
      setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve() };
    window.firebase = { apps: [{}], initializeApp: () => ({}),
      app: () => ({ functions: () => ({ httpsCallable: callable }) }),
      firestore: Object.assign(() => window.__stubDb, { FieldValue: { serverTimestamp: () => 'TS', increment: (n) => ({ inc: n }), delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' },
        Timestamp: { now: () => ({ toDate: () => new Date(), toMillis: () => Date.now() }), fromDate: (d) => ({ toDate: () => d }) } }),
      auth: Object.assign(() => window.__stubAuth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } } }),
      functions: () => ({ httpsCallable: callable }),
      messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} }) };
    window.auth = window.__stubAuth;
    window.__lockEvents = [];
    document.addEventListener('stryker:lock', (e) => window.__lockEvents.push(e.detail));
    try { ['stryker_tour_done', 'stryker_onboarding_done', 'stryker_install_prompt_shown_u1'].forEach((k) => localStorage.setItem(k, '1')); } catch (e) {}
  };
  return '(' + body.toString() + ')(' + JSON.stringify(mode) + ',' + RATE + ',' + JSON.stringify(!!trial) + ')';
}

async function page(b, mode, p, opt) {
  opt = opt || {};
  const w = opt.w || 1280;
  const ctx = await b.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, deviceScaleFactor: w < 500 ? 2 : 1, timezoneId: opt.tz || 'America/New_York' });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(stubFor(mode, opt.trial));
  await pg.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await pg.route(/\/api\/gex\/levels\//, (r) => {
    const m = r.request().url().match(/levels\/([A-Z]+)/);
    const f = path.join(FIX, (m ? m[1] : 'SPX') + '-0.json');
    r.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(fs.existsSync(f) ? f : path.join(FIX, 'SPX-0.json')) });
  });
  await pg.route(/\/api\/gex\/candles\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"candles":[]}' }));
  await pg.goto(BASE + '/' + p, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(opt.wait || 3000);
  pg.__errs = errs; pg.__ctx = ctx;
  return pg;
}

const LOCK_INFO = `(el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cta = el.querySelector('.plan-lock-cta');
  return { title: (el.querySelector('h3') || {}).textContent, bullets: el.querySelectorAll('.plan-lock-list li').length,
    cta: cta && cta.textContent, href: cta && cta.getAttribute('href'), edu: (el.querySelector('.plan-lock-edu') || {}).textContent,
    icon: !!el.querySelector('.plan-lock-ico svg'), w: r.width, l: r.left, r: r.right, inView: r.top < innerHeight && r.bottom > 0,
    docW: document.documentElement.scrollWidth, text: el.innerText,
    banned: /\\blimited|hurry|left\\b|ends in|only \\d/i.test(el.innerText) };
}`;

(async () => {
  const b = await launch();
  try {
    // 1. Home pricing yearly line: USD + INR at 390 and 1280
    for (const [tz, cur, want] of [['America/New_York', 'USD', 'or $29/mo billed yearly ($349) · save 25%'],
                                   ['Asia/Kolkata', 'INR', null]]) {
      for (const w of [390, 1280]) {
        const p = await page(b, 'out', 'index.html', { tz, w });
        await p.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
        await p.evaluate(() => { const h = document.querySelector('.pv-hero'); if (h) window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 80); });
        await p.waitForTimeout(900);
        const r = await p.evaluate(() => {
          const a = document.querySelector('.pv-hero .plan-yearly');
          if (!a) return null;
          const rr = a.getBoundingClientRect();
          const pc = document.querySelector('.pv-hero .pv-was-grp .pp-pct');
          return { pct: pc ? pc.textContent : null, text: a.textContent.trim(), href: a.getAttribute('href'), right: rr.right, docW: document.documentElement.scrollWidth };
        });
        const label = `home ${cur} ${w}`;
        ok(`${label}: yearly line rendered`, !!r);
        if (r) {
          // INR expected value computed the same way as the spec: whole rupees, floor
          const exp = want || (() => {
            const y = Math.round(349 * RATE), m = Math.round(39 * RATE);
            const pct = Math.floor((12 * m - y) / (12 * m) * 100 + 1e-9);
            return 'or ₹' + Math.floor(y / 12).toLocaleString('en-IN') + '/mo billed yearly (₹' + y.toLocaleString('en-IN') + ') · save ' + pct + '%';
          })();
          ok(`${label}: text is "${exp} →"`, r.text === exp + '\u00a0→', r.text);
          ok(`${label}: "64% OFF" pill in the price row`, r.pct === '64% OFF', r.pct);
          ok(`${label}: links to yearly checkout`, /plan=proYearly/.test(r.href), r.href);
          ok(`${label}: no horizontal overflow`, r.docW <= w && r.right <= w, r.docW + '/' + r.right);
        }
        ok(`${label}: no page errors`, !p.__errs.length, p.__errs.join('; '));
        if (SHOTS) { const el = await p.$('.pv-hero'); if (el) await el.screenshot({ path: `${SHOTS}/pro-card-${cur}-${w}.png` }); }
        await p.__ctx.close();
      }
    }
    // 2. Upgrade modal yearly line (Free member)
    for (const w of [390, 1280]) {
      const p = await page(b, 'free', 'gex.html', { w, wait: 4000 });
      await p.evaluate(() => window.openPlanUpgradeModal && window.openPlanUpgradeModal('Pro unlocks every symbol.'));
      await p.waitForTimeout(1200);
      const t = await p.evaluate(() => { const a = document.querySelector('.plan-modal-card .plan-yearly'); return a ? a.textContent.trim() : null; });
      const mb = await p.evaluate(() => { const e = document.querySelector('.plan-modal-card .pp-was-grp .pp-pct'); return e ? e.textContent : null; });
      ok(`modal ${w}: "64% OFF" beside struck price`, mb === '64% OFF', mb);
      ok(`modal ${w}: yearly line`, t === 'or $29/mo billed yearly ($349) · save 25%\u00a0→', t);
      if (SHOTS) { const el = await p.$('.plan-modal'); if (el) await el.screenshot({ path: `${SHOTS}/modal-${w}.png` }); }
      await p.__ctx.close();
    }
    // 3. Checkout plan summary (monthly -> yearly link; yearly -> pay monthly)
    for (const w of [390, 1280]) {
      const p = await page(b, 'free', 'checkout.html?plan=Sj1bjdpwvYJUVErjNMAb', { w, wait: 4000 });
      const t = await p.evaluate(() => { const a = document.querySelector('#checkout-yearly-line .plan-yearly'); return a ? { t: a.textContent.trim(), h: a.getAttribute('href') } : null; });
      const cb = await p.evaluate(() => { const e = document.querySelector('#checkout-plan-summary .pp-was-grp .pp-pct'); return e ? { t: e.textContent, bg: getComputedStyle(e).backgroundColor } : null; });
      ok(`checkout ${w}: "64% OFF" mint pill beside struck price`, cb && cb.t === '64% OFF' && cb.bg === 'rgb(3, 201, 136)', JSON.stringify(cb));
      ok(`checkout ${w}: monthly shows yearly line`, t && t.t === 'or $29/mo billed yearly ($349) · save 25%\u00a0→' && /plan=proYearly/.test(t.h), JSON.stringify(t));
      if (SHOTS) { const el = await p.$('#checkout-plan-summary'); if (el) await el.screenshot({ path: `${SHOTS}/checkout-${w}.png` }); }
      ok(`checkout ${w}: no page errors`, !p.__errs.length, p.__errs.join('; '));
      await p.__ctx.close();
      const q = await page(b, 'free', 'checkout.html?plan=proYearly', { w, wait: 4000 });
      const y = await q.evaluate(() => { const e = document.getElementById('checkout-yearly-line'); return e ? e.innerText.replace(/[ \t\n]+/g, ' ').trim() : null; });
      ok(`checkout ${w}: yearly plan shows per-month + "or pay monthly"`, y === '$29/mo billed yearly ($349) · save 25% or pay monthly\u00a0→', y);
      await q.__ctx.close();
    }
    // 4. GEX lock as a Free member (trial eligible), market tap + expiry tap + strike table
    for (const w of [390, 1280]) {
      const p = await page(b, 'free', 'gex.html', { w, wait: 5000, trial: true });
      const strikes = await p.evaluate(`(${LOCK_INFO})(document.querySelector('#gex-ladder .plan-lock'))`);
      ok(`gex ${w}: strike table shows the lock card`, !!strikes && strikes.title === 'Futures GEX levels are part of Pro', strikes && strikes.title);
      await p.click('#gex-tabs [data-m="QQQ"]');
      await p.waitForTimeout(1500);
      const r = await p.evaluate(`(${LOCK_INFO})(document.querySelector('#gex-lock-slot .plan-lock'))`);
      ok(`gex ${w}: tapping QQQ (NQ) shows the lock card`, !!r);
      if (r) {
        ok(`gex ${w}: title`, r.title === 'Futures GEX levels are part of Pro', r.title);
        ok(`gex ${w}: lock icon + 2 bullets`, r.icon && r.bullets === 2);
        ok(`gex ${w}: trial-eligible button reads "Start 7-day free trial"`, r.cta === 'Start 7-day free trial', r.cta);
        ok(`gex ${w}: button links to Pro checkout`, /checkout\.html\?plan=Sj1bjdpwvYJUVErjNMAb/.test(r.href), r.href);
        ok(`gex ${w}: "Education only. Not financial advice."`, r.edu === 'Education only. Not financial advice.');
        ok(`gex ${w}: no scarcity / countdown wording`, !r.banned);
        ok(`gex ${w}: card in view and inside the viewport`, r.inView && r.l >= 0 && r.r <= w, `${r.l}-${r.r}`);
        ok(`gex ${w}: no horizontal overflow`, r.docW <= w, String(r.docW));
      }
      const still = await p.evaluate(() => document.querySelector('#gex-tabs .is-on').dataset.m);
      ok(`gex ${w}: market stays SPX (no paid data loaded)`, still === 'SPX', still);
      const modalOpen = await p.evaluate(() => !!document.querySelector('#plan-upgrade-modal.open'));
      ok(`gex ${w}: no modal on top of the card`, !modalOpen);
      if (SHOTS) {
        const el = await p.$('#gex-lock-slot');
        await p.evaluate(() => { const s = document.getElementById('gex-lock-slot'); window.scrollTo(0, s.getBoundingClientRect().top + scrollY - 140); });
        await p.waitForTimeout(400);
        await p.screenshot({ path: `${SHOTS}/gex-lock-${w}.png` });
        if (el && w === 390) await el.screenshot({ path: `${SHOTS}/gex-lock-card-${w}.png` });
      }
      await p.click('#gex-dtes [data-d="1"]');
      await p.waitForTimeout(600);
      const cards = await p.evaluate(() => document.querySelectorAll('#gex-lock-slot .plan-lock').length);
      const where = await p.evaluate(() => (document.querySelector('#gex-lock-slot .plan-lock') || {}).getAttribute && document.querySelector('#gex-lock-slot .plan-lock').getAttribute('data-lock-where'));
      ok(`gex ${w}: expiry tap swaps to ONE card (gex-expiry)`, cards === 1 && where === 'gex-expiry', cards + ' ' + where);
      // click event
      await p.evaluate(() => { const a = document.querySelector('#gex-lock-slot .plan-lock-cta'); a.addEventListener('click', (e) => e.preventDefault(), { once: true }); a.click(); });
      const ev = await p.evaluate(() => window.__lockEvents);
      ok(`gex ${w}: lock_view + lock_click events with where`, ev.some((e) => e.event === 'lock_view' && e.where === 'gex-market') && ev.some((e) => e.event === 'lock_click' && e.where === 'gex-expiry'), JSON.stringify(ev));
      await p.click('#gex-lock-slot .plan-lock-x');
      const gone = await p.evaluate(() => !document.querySelector('#gex-lock-slot .plan-lock'));
      ok(`gex ${w}: close button removes the card`, gone);
      ok(`gex ${w}: no page errors`, !p.__errs.length, p.__errs.join('; '));
      await p.__ctx.close();
    }
    // 4b. Trial already used: "Join Pro"
    { const p = await page(b, 'free', 'gex.html', { w: 390, wait: 5000, trial: false });
      await p.click('#gex-tabs [data-m="QQQ"]');
      await p.waitForTimeout(1500);
      const r = await p.evaluate(`(${LOCK_INFO})(document.querySelector('#gex-lock-slot .plan-lock'))`);
      ok('gex trial-used: button reads "Join Pro"', r && r.cta === 'Join Pro', r && r.cta);
      await p.__ctx.close(); }
    // 4c. Pro member: no lock
    { const p = await page(b, 'pro', 'gex.html', { w: 1280, wait: 5000 });
      const n = await p.evaluate(() => document.querySelectorAll('.plan-lock').length);
      ok('gex pro member: no lock card', n === 0, String(n));
      await p.__ctx.close(); }
    // 5. Chapter 11 as a Free member
    for (const w of [390, 1280]) {
      const p = await page(b, 'free', 'chapter.html?ch=11', { w, wait: 5000, trial: true });
      const r = await p.evaluate(`(${LOCK_INFO})(document.querySelector('#guest-paywall-overlay .plan-lock'))`);
      ok(`chapter 11 ${w}: lock card in the paywall`, !!r);
      if (r) {
        ok(`chapter 11 ${w}: title "Chapters 11+ are part of Pro"`, r.title === 'Chapters 11+ are part of Pro', r.title);
        ok(`chapter 11 ${w}: trial button + edu line + 2 bullets`, r.cta === 'Start 7-day free trial' && r.edu === 'Education only. Not financial advice.' && r.bullets === 2, r.cta);
        ok(`chapter 11 ${w}: inside the viewport`, r.l >= 0 && r.r <= w && r.docW <= w, `${r.l}-${r.r}/${r.docW}`);
        ok(`chapter 11 ${w}: no scarcity wording`, !r.banned);
      }
      const old = await p.evaluate(() => getComputedStyle(document.querySelector('#guest-paywall-overlay .paywall-card')).display);
      ok(`chapter 11 ${w}: old paywall card hidden`, old === 'none', old);
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/chapter11-lock-${w}.png` });
      ok(`chapter 11 ${w}: no page errors`, !p.__errs.length, p.__errs.join('; '));
      await p.__ctx.close();
    }
    // 6. End of chapter 10 (Free): card above prev/next; chapter 9 has none
    for (const w of [390, 1280]) {
      const p = await page(b, 'free', 'chapter.html?ch=10', { w, wait: 5000 });
      const r = await p.evaluate(`(${LOCK_INFO})(document.querySelector('#reader-end-lock .plan-lock'))`);
      ok(`chapter 10 ${w}: end-of-free lock card`, r && r.title === 'Chapters 11+ are part of Pro', r && r.title);
      ok(`chapter 10 ${w}: reader not paywalled`, await p.evaluate(() => getComputedStyle(document.getElementById('guest-paywall-overlay')).display === 'none'));
      if (SHOTS) {
        await p.evaluate(() => { const s = document.getElementById('reader-end-lock'); if (s) window.scrollTo(0, s.getBoundingClientRect().top + scrollY - 120); });
        await p.waitForTimeout(400);
        await p.screenshot({ path: `${SHOTS}/chapter10-end-${w}.png` });
      }
      await p.__ctx.close();
    }
    { const p = await page(b, 'free', 'chapter.html?ch=09', { w: 390, wait: 5000 });
      ok('chapter 9: no end lock', await p.evaluate(() => !document.getElementById('reader-end-lock')));
      await p.__ctx.close(); }
    { const p = await page(b, 'pro', 'chapter.html?ch=10', { w: 390, wait: 5000 });
      ok('chapter 10 pro member: no end lock', await p.evaluate(() => !document.getElementById('reader-end-lock')));
      await p.__ctx.close(); }
  } catch (e) {
    ok('suite crashed', false, e.stack);
  } finally {
    await b.close();
  }
  console.log(log.join('\n'));
  const fails = log.filter((l) => l.startsWith('FAIL')).length;
  console.log(`\n${log.length - fails} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
