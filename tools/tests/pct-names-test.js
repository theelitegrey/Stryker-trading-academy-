// Free/Pro plan names, and NO "% OFF" badge (CoS ruling 2026-10-11).
// Stubs the live plan state (Pro 109 on sale at 39, colour #ff0000; Starter
// displayName Free; Elite archived) and checks:
//   - home #pricing Pro spotlight: $39, struck $109, no "% OFF" pill
//     with "/ month" (no overlap, no wrap inside a group) at 390 and 1280
//   - INR visitor: ₹3,772, struck ₹10,544, no "% OFF"
//   - upgrade modal: no "% OFF" in the price row, mint pill (not red), name Pro
//   - admin Recent signups: Starter -> Free, Elite -> Pro (legacy)
//   PCT_SHOTS=<dir> node pct-names-test.js     (needs http.server on 8000)
const { BASE, launch } = require('./lib.js');
const log = [];
const ok = (l, c, x) => log.push((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '   ' + x : ''));
const SHOTS = process.env.PCT_SHOTS || '';
const RATE = 96.73;

function stubFor(mode) {
  const body = function (MODE, RATE) {
    const UID = 'u1';
    const FREE = 'WuvUQyHX82ZzHP2sKLms', PRO = 'Sj1bjdpwvYJUVErjNMAb', ELITE = 'OMSNNQrZ4aBPReRMOpUB';
    const plans = [
      { id: FREE, name: 'Starter', displayName: 'Free', rank: 0, chapterAccess: '1-10', price: '0', period: 'month', features: ['Chapters 1-10'], color: '#00ffff' },
      { id: PRO, name: 'Pro', rank: 1, chapterAccess: 'all', price: '109', salePrice: '39', onSale: true, saleLabel: 'Launch sale', saleEndsAt: '', period: 'month', featured: true, yearlyPlanId: 'proYearly', features: ['All 64 chapters', 'Every GEX symbol', 'Unlimited journal', 'Replay', 'Community', 'Indicators'], color: '#ff0000', ctaLabel: 'Join Pro' },
      { id: 'proYearly', name: 'Pro', rank: 1, chapterAccess: 'all', price: '349', period: 'year', hidden: true },
      { id: ELITE, name: 'Elite', rank: 2, chapterAccess: 'all', price: '129', salePrice: '49', onSale: false, period: 'month', archived: true, features: ['x'], color: '#ffff00' }
    ];
    const ts = (h) => { const ms = Date.now() - h * 3600e3; return { toMillis: () => ms, toDate: () => new Date(ms) }; };
    const STUDENTS = [
      { id: 's1', displayName: 'Student A', email: 'a@example.com', plan: 'Starter', createdAt: ts(1) },
      { id: 's2', displayName: 'Student B', email: 'b@example.com', plan: 'Pro', createdAt: ts(3) },
      { id: 's3', displayName: 'Student C', email: 'c@example.com', plan: 'Elite', createdAt: ts(5) },
      { id: 's4', displayName: 'Student D', email: 'd@example.com', plan: 'Starter', createdAt: ts(8) },
      { id: 's5', displayName: 'Student E', email: 'e@example.com', createdAt: ts(9) }
    ];
    const PLAN = { free: 'Starter', pro: 'Pro', elite: 'Elite', admin: 'Pro', out: null }[MODE];
    const snap = (id, d) => ({ id, exists: !!d, data: () => d || {} });
    function docGet(coll, id) {
      if (coll === 'settings' && id === 'commerce') return Promise.resolve(snap(id, { usdInr: RATE, launchSale: { active: false } }));
      if (coll === 'settings' && id === 'pageAccess') return Promise.resolve(snap(id, { 'trade-journal': { minRole: FREE, viewOnlyRole: FREE } }));
      if (coll === 'admins') return Promise.resolve(snap(id, MODE === 'admin' ? { role: 'admin' } : null));
      if (coll === 'students') return Promise.resolve(snap(id, PLAN ? { uid: UID, plan: PLAN, name: 'Stub ' + MODE, completedLessons: [], completedChapters: [] } : null));
      if (coll === 'plans') return Promise.resolve(snap(id, plans.find((p) => p.id === id) || null));
      return Promise.resolve(snap(id, null));
    }
    function docRef(coll, id) {
      return { id, get: () => docGet(coll, id), set: () => Promise.resolve(), update: () => Promise.resolve(), delete: () => Promise.resolve(),
        onSnapshot: (cb) => { docGet(coll, id).then(cb, () => {}); return () => {}; }, collection: (sub) => colRef(sub) };
    }
    function rows(coll) {
      if (coll === 'plans') return plans.slice();
      if (coll === 'students' && MODE === 'admin') return STUDENTS.slice();
      return [];
    }
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
    window.__stubDb = { collection: (c) => colRef(c), batch: () => ({ set(){}, update(){}, delete(){}, commit: () => Promise.resolve() }) };
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
    try { ['stryker_tour_done', 'stryker_onboarding_done', 'stryker_install_prompt_shown_u1'].forEach((k) => localStorage.setItem(k, '1')); } catch (e) {}
  };
  return '(' + body.toString() + ')(' + JSON.stringify(mode) + ',' + RATE + ')';
}

async function page(b, mode, path, opt) {
  opt = opt || {};
  const w = opt.w || 1280;
  const ctx = await b.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, deviceScaleFactor: w < 500 ? 2 : 1, timezoneId: opt.tz || 'America/New_York' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(stubFor(mode));
  await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await p.goto(BASE + '/' + path, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(opt.wait || 3000);
  p.__errs = errs; p.__ctx = ctx;
  return p;
}
const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };

(async () => {
  const b = await launch();
  try {
    // 1. Home pricing, USD + INR, 390 and 1280
    for (const [tz, cur] of [['America/New_York', 'USD'], ['Asia/Kolkata', 'INR']]) {
      for (const w of [390, 1280]) {
        const p = await page(b, 'out', 'index.html', { tz, w });
        await p.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
        await p.evaluate(() => document.getElementById('pricing').scrollIntoView());
        await p.waitForTimeout(900);
        const r = await p.evaluate((rectSrc) => {
          const rect = eval(rectSrc);
          const row = document.querySelector('.pv-hero .pv-price');
          if (!row) return null;
          const q = (s) => row.querySelector(s);
          const per = q('.pv-per'), was = q('.pv-was'), pct = q('.pp-pct'), amt = q('.pv-amt');
          const R = { per: rect(per), was: rect(was), pct: pct && rect(pct), amt: rect(amt) };
          const overlap = (a, c) => a && c && !(a.r <= c.l || c.r <= a.l || a.b <= c.t || c.b <= a.t);
          return { text: row.innerText.replace(/\s+/g, ' '), pct: pct ? pct.textContent : '',
            pctBg: pct ? getComputedStyle(pct).backgroundColor : '', ovPer: overlap(R.per, R.pct) || overlap(R.per, R.was),
            pctOneLine: pct ? pct.getBoundingClientRect().height < 30 : false,
            wasPctSameLine: pct ? Math.abs(R.was.t + (R.was.b - R.was.t) / 2 - (R.pct.t + (R.pct.b - R.pct.t) / 2)) < 8 : false,
            amtPerSameLine: R.amt.b >= R.per.t && R.per.b >= R.amt.t,
            popular: !!document.querySelector('.pv-hero .pv-pill') && /most popular/i.test(document.querySelector('.pv-hero .pv-pill').textContent),
            banned: /limited|ends|left\b|hurry/i.test(document.querySelector('.pv-hero-l').innerText),
            docW: document.documentElement.scrollWidth };
        }, '(' + rect.toString() + ')');
        const label = `home ${cur} ${w}`;
        ok(`${label}: price row rendered`, !!r);
        if (r) {
          const want = cur === 'USD' ? ['$39', '$109'] : ['₹3,772', '₹10,544'];
          ok(`${label}: ${want[0]} + struck ${want[1]}, no "% OFF"`, r.text.includes(want[0]) && r.text.includes(want[1]) && !r.pct && !/% OFF/i.test(r.text), r.text);
          ok(`${label}: struck price never overlaps "/ month"`, !r.ovPer);
          ok(`${label}: "$39 / month" together`, r.amtPerSameLine);
          ok(`${label}: MOST POPULAR kept`, r.popular);
          ok(`${label}: no limited/ends wording`, !r.banned);
          ok(`${label}: no horizontal overflow`, r.docW <= w, String(r.docW));
        }
        ok(`${label}: no page errors`, !p.__errs.length, p.__errs.join('; '));
        if (SHOTS) {
          const el = await p.$('.pv-hero');
          if (el) await el.screenshot({ path: `${SHOTS}/home-pricing-${cur}-${w}.png` });
        }
        await p.__ctx.close();
      }
    }
    // 2. Upgrade modal (Free member on a gated page)
    for (const w of [390, 1280]) {
      const p = await page(b, 'free', 'gex.html', { w, wait: 4000 });
      await p.evaluate(() => window.openPlanUpgradeModal && window.openPlanUpgradeModal('Pro unlocks every symbol.'));
      await p.waitForTimeout(1200);
      const m = await p.evaluate(() => {
        const card = document.querySelector('.plan-modal-card');
        if (!card) return null;
        const pill = card.querySelector('.plan-modal-pill');
        const pct = card.querySelector('.plan-price .pp-row .pp-pct');
        return { text: card.innerText.replace(/\s+/g, ' '), pill: pill.textContent, pillColor: getComputedStyle(pill).color,
          pct: pct ? pct.textContent : '', flag: !!card.querySelector('.plan-sale-flag'), all: document.querySelector('.plan-modal').innerText };
      });
      ok(`modal ${w}: rendered`, !!m);
      if (m) {
        ok(`modal ${w}: no "% OFF" in the price row or card`, !m.pct && !/% OFF/i.test(m.text), m.text.slice(0, 120));
        ok(`modal ${w}: $39 and $109`, /\$39/.test(m.text) && /\$109/.test(m.text));
        ok(`modal ${w}: pill says Pro, mint not red`, m.pill === 'Pro' && m.pillColor === 'rgb(3, 201, 136)', m.pill + ' ' + m.pillColor);
        ok(`modal ${w}: no corner flag, no Elite/Starter`, !m.flag && !/Elite|Starter/.test(m.all));
      }
      if (SHOTS) {
        const el = await p.$('.plan-modal');
        if (el) await el.screenshot({ path: `${SHOTS}/modal-${w}.png` });
      }
      await p.__ctx.close();
    }
    // 3. Legacy Elite member: sidebar badge / chip read Pro
    { const p = await page(b, 'elite', 'dashboard-user.html', { w: 1280, wait: 4000 });
      const r = await p.evaluate(() => ({ badges: [...document.querySelectorAll('.brand-plan, .role-tag')].map((e) => e.textContent), body: document.body.innerText }));
      ok('elite member: badges read Pro', r.badges.length > 0 && r.badges.every((t) => t === 'Pro'), JSON.stringify(r.badges));
      ok('elite member: no "Elite" on dashboard', !/\bElite\b/.test(r.body));
      await p.__ctx.close(); }
    // 4. Admin recent signups
    for (const w of [390, 1280]) {
      const p = await page(b, 'admin', 'dashboard-admin.html', { w, wait: 5000 });
      const r = await p.evaluate(() => { const el = document.getElementById('aa-recent-signups'); return el ? el.innerText : null; });
      ok(`admin ${w}: recent signups rendered`, !!r);
      if (r) {
        ok(`admin ${w}: Starter -> Free`, /Student A — Free/.test(r) && !/Starter/.test(r), r.replace(/\s+/g, ' '));
        ok(`admin ${w}: Elite -> Pro (legacy)`, /Student C — Pro \(legacy\)/.test(r));
        ok(`admin ${w}: Pro stays Pro`, /Student B — Pro\b/.test(r));
      }
      if (SHOTS) {
        await p.evaluate(() => { const el = document.getElementById('aa-recent-signups'); if (el) (el.closest('.panel, .card, section, .aa-card') || el).scrollIntoView(); });
        await p.waitForTimeout(500);
        const el = await p.$('#aa-recent-signups');
        const box = el && await p.evaluate(() => { const e = document.getElementById('aa-recent-signups'); const c = e.closest('.panel, .card, .aa-card, section') || e; c.scrollIntoView({ block: 'center' }); return true; });
        await p.waitForTimeout(400);
        const tgt = await p.$('#aa-recent-signups');
        const parent = tgt && await tgt.evaluateHandle((e) => e.closest('.panel, .card, .aa-card') || e.parentElement);
        if (parent) await parent.asElement().screenshot({ path: `${SHOTS}/admin-signups-${w}.png` });
      }
      ok(`admin ${w}: no page errors`, !p.__errs.length, p.__errs.join('; '));
      await p.__ctx.close();
    }
    // 5. Students admin list: tags and plan picker
    { const p = await page(b, 'admin', 'students-admin.html', { w: 1280, wait: 5000 });
      const r = await p.evaluate(() => ({ tags: [...document.querySelectorAll('#students-table-body .role-tag')].map((e) => e.textContent),
        opts: [...(document.querySelector('.student-plan-select') || { options: [] }).options].map((o) => o.value + '=' + o.textContent),
        colors: [...document.querySelectorAll('#students-table-body .role-tag')].map((e) => e.style.color) }));
      ok('students admin: tags Free / Pro / Pro (legacy)', r.tags.includes('Free') && r.tags.includes('Pro') && r.tags.includes('Pro (legacy)') && !r.tags.some((t) => /Starter|^Elite$/.test(t)), JSON.stringify(r.tags));
      ok('students admin: picker keeps stored keys, shows new names', r.opts.includes('Starter=Free') && r.opts.includes('Elite=Pro (legacy)'), JSON.stringify(r.opts));
      ok('students admin: no red/yellow/cyan pills', !r.colors.some((c) => /255, 0, 0|255, 255, 0|0, 255, 255/.test(c)), JSON.stringify(r.colors));
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/students-admin-1280.png` });
      await p.__ctx.close(); }
  } finally { await b.close(); }
  console.log(log.join('\n'));
  const f = log.filter((l) => l.startsWith('FAIL')).length;
  console.log(`\n${log.length - f} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
