// Pricing change 2026-10-05: Free + Pro only, live INR rate, Free limits.
// Stubs the post-change Firestore state (Starter displayName Free 1-10,
// Pro 39 / 349 with no rupee prices, Elite archived, pageAccess journal Free).
//   PRICING_SHOTS=<dir> node pricing-test.js
const { BASE, launch } = require('./lib.js');
const log = [];
const ok = (l, c, x) => log.push((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '   ' + x : ''));
const SHOTS = process.env.PRICING_SHOTS || '';
const RATE = 96.3;

function stubFor(mode) {
  const body = function (MODE, RATE) {
    const UID = 'u1';
    const FREE = 'WuvUQyHX82ZzHP2sKLms', PRO = 'Sj1bjdpwvYJUVErjNMAb', ELITE = 'OMSNNQrZ4aBPReRMOpUB';
    const plans = [
      { id: FREE, name: 'Starter', displayName: 'Free', rank: 0, chapterAccess: '1-10', price: '0', period: 'month', features: ['Chapters 1-10'], color: '#00ffff' },
      { id: PRO, name: 'Pro', rank: 1, chapterAccess: 'all', price: '39', period: 'month', featured: true, yearlyPlanId: 'proYearly', features: ['All 64 chapters'], color: '#ff0000', ctaLabel: 'Join Pro' },
      { id: 'proYearly', name: 'Pro', rank: 1, chapterAccess: 'all', price: '349', period: 'year', hidden: true },
      { id: ELITE, name: 'Elite', rank: 2, chapterAccess: 'all', price: '129', period: 'month', archived: true, hidden: true, features: ['x'] }
    ];
    const PLAN = { free: 'Starter', pro: 'Pro', out: null }[MODE];
    const pageAccess = {
      'trade-journal': { minRole: FREE, viewOnlyRole: FREE },
      'live-sessions': { minRole: PRO, viewOnlyRole: PRO },
      'trading-floor': { minRole: PRO, viewOnlyRole: FREE },
      models: { minRole: PRO, viewOnlyRole: PRO }
    };
    const catalog = () => (typeof CHAPTERS_SEED !== 'undefined' ? CHAPTERS_SEED : []);
    const minRank = (num) => (/^\d+$/.test(num) && parseInt(num, 10) <= 10 ? 0 : 1);
    const snap = (id, d) => ({ id, exists: !!d, data: () => d || {} });
    const denied = () => { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; return e; };
    function docGet(coll, id) {
      if (coll === 'chapterBodies') {
        if (!PLAN) return Promise.reject(denied());
        const r = minRank(id);
        if (r > 0 && PLAN === 'Starter') return Promise.reject(denied());
        const cat = catalog().find((c) => c.num === id);
        if (!cat) return Promise.resolve(snap(id, null));
        return Promise.resolve(snap(id, { num: id, minRank: r, video: '', bodyHtml: '<p>FULL-TEXT-' + id + '</p>', paragraphs: ['FULL-TEXT-' + id],
          lessons: cat.lessons.map((l, i) => ({ title: l.title, desc: 'l' + i, descHtml: '<p>L</p>' })) }));
      }
      if (coll === 'settings' && id === 'commerce') return Promise.resolve(snap(id, { usdInr: RATE, launchSale: { active: false, taken: 0, limit: 100 } }));
      if (coll === 'settings' && id === 'pageAccess') return Promise.resolve(snap(id, pageAccess));
      if (coll === 'admins') return Promise.resolve(snap(id, null));
      if (coll === 'students') return Promise.resolve(snap(id, PLAN ? { uid: UID, plan: PLAN, name: 'Stub ' + MODE, completedLessons: [], completedChapters: [] } : null));
      if (coll === 'plans') return Promise.resolve(snap(id, plans.find((p) => p.id === id) || null));
      return Promise.resolve(snap(id, null));
    }
    function docRef(coll, id) {
      return { id, get: () => docGet(coll, id), set: () => Promise.resolve(), update: () => Promise.resolve(), delete: () => Promise.resolve(),
        onSnapshot: (cb) => { docGet(coll, id).then(cb, () => {}); return () => {}; }, collection: (sub) => colRef(sub) };
    }
    function rows(coll) {
      if (coll === 'chapters') return catalog().map((c) => Object.assign({}, c));
      if (coll === 'plans') return plans.slice();
      return [];
    }
    function listSnap(list) {
      const docs = list.map((d) => ({ id: d.id || d.num, exists: true, data: () => d }));
      return { empty: !docs.length, size: docs.length, docs, forEach: (f) => docs.forEach(f), docChanges: () => [] };
    }
    function colRef(coll) {
      const self = { doc: (id) => docRef(coll, id || 'auto'), get: () => Promise.resolve(listSnap(rows(coll))), add: () => Promise.resolve({ id: 'x' }),
        where: () => self, orderBy: () => self, limit: () => self, startAfter: () => self,
        onSnapshot: (cb) => { setTimeout(() => cb(listSnap(rows(coll))), 10); return () => {}; } };
      return self;
    }
    const user = PLAN ? { uid: UID, email: 'stub@test.local', displayName: 'Stub', emailVerified: true,
      getIdTokenResult: () => Promise.resolve({ claims: {} }), getIdToken: () => Promise.resolve('t') } : null;
    window.__stubDb = { collection: colRef, batch: () => ({ set(){}, update(){}, delete(){}, commit: () => Promise.resolve() }) };
    window.db = window.__stubDb;
    window.__stubAuth = { currentUser: user, onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; },
      setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve() };
    window.firebase = { apps: [], initializeApp: () => ({}),
      app: () => ({ functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }) }),
      firestore: Object.assign(() => window.__stubDb, { FieldValue: { serverTimestamp: () => 'TS', increment: (n) => ({ inc: n }), delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' },
        Timestamp: { now: () => ({ toDate: () => new Date(), toMillis: () => Date.now() }), fromDate: (d) => ({ toDate: () => d }) } }),
      auth: Object.assign(() => window.__stubAuth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } } }),
      functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }),
      messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} }) };
    window.auth = window.__stubAuth;
    try { localStorage.setItem('stryker_tour_done', '1'); localStorage.setItem('stryker_onboarding_done', '1'); localStorage.setItem('stryker_install_prompt_shown_u1', '1'); } catch (e) {}
  };
  return '(' + body.toString() + ')(' + JSON.stringify(mode) + ',' + RATE + ')';
}

async function page(b, mode, path, opt) {
  opt = opt || {};
  const ctx = await b.newContext({ viewport: { width: opt.w || 1440, height: opt.w < 500 ? 844 : 950 }, timezoneId: opt.tz || 'America/New_York' });
  if (opt.day) await ctx.addInitScript(() => { try { localStorage.setItem('stryker_theme', 'day'); } catch (e) {} });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(stubFor(mode));
  await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await p.goto(BASE + '/' + path, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(opt.wait || 2500);
  p.__errs = errs; p.__ctx = ctx;
  return p;
}
const shot = async (p, name, full) => { if (SHOTS) await p.screenshot({ path: SHOTS + '/' + name + '.png', fullPage: !!full }); };

module.exports = { stubFor };
if (require.main === module) (async () => {
  const b = await launch();
  try {
    // 1. homepage cards, USD and INR
    for (const [tz, cur] of [['America/New_York', 'USD'], ['Asia/Kolkata', 'INR']]) {
      for (const w of [1440, 390]) {
        const p = await page(b, 'out', 'index.html', { tz, w });
        const r = await p.evaluate(() => {
          const cards = [...document.querySelectorAll('.price-card')];
          return { names: cards.map((c) => (c.querySelector('h3') || {}).textContent), text: cards.map((c) => c.innerText).join(' | '),
            body: document.body.innerText };
        });
        ok(`home ${cur} ${w}: cards = Free, Pro`, JSON.stringify(r.names) === '["Free","Pro"]', JSON.stringify(r.names));
        if (cur === 'USD') ok(`home USD ${w}: $39 and $349`, /\$39\b/.test(r.text) && /\$349\b/.test(r.text), r.text.slice(0, 200).replace(/\s+/g, ' '));
        else {
          const m = Math.round(39 * RATE).toLocaleString('en-IN'), y = Math.round(349 * RATE).toLocaleString('en-IN');
          ok(`home INR ${w}: ₹${m} and ₹${y}`, r.text.includes(m) && r.text.includes(y), r.text.slice(0, 220).replace(/\s+/g, ' '));
        }
        ok(`home ${cur} ${w}: no Elite / 100 spots / trial`, !/Elite|100 spots|free trial/i.test(r.body));
        ok(`home ${cur} ${w}: no page errors`, !p.__errs.length, p.__errs.join('; '));
        if (w === 390 || cur === 'USD') {
          await p.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
          await p.waitForTimeout(900);
          if (SHOTS) await (await p.$('#pricing')).screenshot({ path: SHOTS + `/home-${cur}-${w}.png` });
        }
        await p.__ctx.close();
      }
    }
    // 2. Free member: GEX limited, upgrade modal shows Pro only
    for (const w of [1440, 390]) {
      const p = await page(b, 'free', 'gex.html', { w, wait: 4000 });
      const r = await p.evaluate(() => ({ note: !!document.getElementById('gex-free-note'), body: document.body.innerText }));
      ok(`gex free ${w}: free note shown`, r.note);
      await shot(p, `gex-free-${w}`);
      await p.evaluate(() => window.openPlanUpgradeModal && window.openPlanUpgradeModal('test'));
      await p.waitForTimeout(800);
      const m = await p.evaluate(() => { const o = document.querySelector('.plan-modal, #plan-upgrade-modal, [class*="plan-modal"]'); return o ? o.innerText : ''; });
      ok(`modal free ${w}: offers Pro, no Elite`, /Pro/.test(m) && !/Elite/.test(m), m.slice(0, 160).replace(/\s+/g, ' '));
      await shot(p, `modal-free-${w}`);
      ok(`gex free ${w}: no page errors`, !p.__errs.length, p.__errs.join('; '));
      await p.__ctx.close();
    }
    // 3. Pro member: GEX unlimited
    { const p = await page(b, 'pro', 'gex.html', { wait: 4000 });
      ok('gex pro: no free note', !(await p.evaluate(() => !!document.getElementById('gex-free-note'))));
      await p.__ctx.close(); }
    // 4. Free member opens the journal
    for (const w of [1440, 390]) {
      const p = await page(b, 'free', 'trade-journal.html', { w, wait: 4000 });
      const r = await p.evaluate(() => { const g = document.getElementById('plan-gate-overlay') || document.querySelector('.plan-gate, .page-locked');
        try { if (typeof switchJournalTab === 'function') switchJournalTab('add'); } catch (e) {}
        const m = document.getElementById('jr-free-meter');
        return { locked: !!g && getComputedStyle(g).display !== 'none', text: m ? m.textContent : '' }; });
      await p.waitForTimeout(500);
      ok(`journal free ${w}: not locked`, !r.locked);
      ok(`journal free ${w}: shows x of 20`, /0 of 20/.test(r.text), r.text);
      await shot(p, `journal-free-${w}`);
      await p.__ctx.close();
    }
    // 5. Free member reads chapter 9
    for (const w of [1440, 390]) {
      const p = await page(b, 'free', 'chapter.html?ch=09', { w, wait: 3000 });
      const r = await p.evaluate(() => { const ov = document.getElementById('guest-paywall-overlay');
        return { paywall: !!ov && getComputedStyle(ov).display !== 'none', full: document.documentElement.innerHTML.includes('FULL-TEXT-09') }; });
      ok(`chapter 09 free ${w}: text, no paywall`, r.full && !r.paywall, JSON.stringify(r));
      await shot(p, `ch09-free-${w}`);
      await p.__ctx.close();
    }
    { const p = await page(b, 'free', 'chapter.html?ch=11', { wait: 3000 });
      const r = await p.evaluate(() => { const ov = document.getElementById('guest-paywall-overlay'); return !!ov && getComputedStyle(ov).display !== 'none'; });
      ok('chapter 11 free: paywall', r);
      await p.__ctx.close(); }
    // 6. one day-mode shot
    { const p = await page(b, 'out', 'index.html', { day: true });
      await p.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
      await p.waitForTimeout(900);
      await (await p.$('#pricing')).screenshot({ path: SHOTS + '/home-USD-1440-day.png' });
      await p.__ctx.close(); }
  } finally { await b.close(); }
  console.log(log.join('\n'));
  const f = log.filter((l) => l.startsWith('FAIL')).length;
  console.log(`\n${log.length - f} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
