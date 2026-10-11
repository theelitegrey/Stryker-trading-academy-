// Signed-out gate: a guest on a plan-guard page must never be left behind the
// loading overlay until gate-timeout.js fires ("This page took too long to
// confirm your access"). plan-guard.js settles the gate itself a short grace
// after auth reports no user:
//   - ungated pages (no data-page-access: charts, gex, ...) are revealed;
//   - pages that show their own guest card (models, indicators) are revealed
//     behind it, card still up;
//   - other gated pages (global-monitor) show the "Sign in to use this page"
//     prompt in the content column, content hidden;
//   - pages with their own login redirect (trade-journal) still redirect.
// A signed-in student with a plan is unaffected (revealed, no prompt).
//
//   node gate-signedout-test.js
const { BASE, launch } = require('./lib.js');

const log = [];
const ok = (l, c, x) => log.push((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '   ' + x : ''));

// Minimal Firebase stub: auth resolves to `user` (null = signed out); every
// read returns an empty doc / list (signed-in case gets a Pro student doc).
function stub(signedIn) {
  const body = function (SIGNED_IN) {
    const user = SIGNED_IN ? { uid: 'u1', email: 'g@test.local', emailVerified: true, getIdTokenResult: () => Promise.resolve({ claims: {} }), getIdToken: () => Promise.resolve('t') } : null;
    const snap = (id, d) => ({ id, exists: !!d, data: () => d || {} });
    const plans = [{ id: 'st', name: 'Starter', rank: 0 }, { id: 'pr', name: 'Pro', rank: 1 }];
    const docRef = (coll, id) => ({
      id, get: () => Promise.resolve(snap(id, SIGNED_IN && coll === 'students' ? { plan: 'Pro' } : (coll === 'settings' && id === 'pageAccess' ? { 'global-monitor': 'Starter' } : null))),
      set: () => Promise.resolve(), update: () => Promise.resolve(), delete: () => Promise.resolve(),
      onSnapshot: (cb) => { setTimeout(() => cb(snap(id, null)), 10); return () => {}; }, collection: (s) => colRef(s)
    });
    const listSnap = (l) => { const docs = l.map((d) => ({ id: d.id, exists: true, data: () => d })); return { empty: !docs.length, size: docs.length, docs, forEach: (f) => docs.forEach(f) }; };
    function colRef(coll) {
      const self = { doc: (id) => docRef(coll, id || 'auto'), get: () => Promise.resolve(listSnap(coll === 'plans' ? plans : [])),
        add: () => Promise.resolve({ id: 'x' }), where: () => self, orderBy: () => self, limit: () => self, startAfter: () => self,
        onSnapshot: (cb) => { setTimeout(() => cb(listSnap([])), 10); return () => {}; } };
      return self;
    }
    window.__stubDb = { collection: colRef, batch: () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() }) };
    window.__stubAuth = { currentUser: user, onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 30); return () => {}; },
      setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve() };
    window.firebase = {
      apps: [], initializeApp: () => ({}),
      app: () => ({ functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }) }),
      firestore: Object.assign(() => window.__stubDb, { FieldValue: { serverTimestamp: () => 'TS', increment: (n) => n, delete: () => 'D', arrayUnion: () => 'A', arrayRemove: () => 'R' },
        Timestamp: { now: () => ({ toDate: () => new Date() }), fromDate: (d) => ({ toDate: () => d }) } }),
      auth: Object.assign(() => window.__stubAuth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's', NONE: 'n' } } }),
      functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }),
      messaging: Object.assign(() => ({ getToken: () => Promise.resolve(null), onMessage: () => {} }), { isSupported: () => false })
    };
    try { localStorage.setItem('stryker_tour_done', '1'); localStorage.setItem('stryker_onboarding_done', '1'); } catch (e) {}
  };
  return '(' + body.toString() + ')(' + JSON.stringify(signedIn) + ')';
}

async function visit(b, page, signedIn, width) {
  const p = await b.newPage({ viewport: { width, height: width < 500 ? 844 : 900 } });
  await p.addInitScript(stub(signedIn));
  await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await p.addInitScript(() => {
    window.__clear = null; const t = () => { const s = document.querySelector('.dash-shell');
      if (s && !s.classList.contains('gate-pending') && window.__clear === null) window.__clear = Math.round(performance.now());
      if (window.__clear === null) requestAnimationFrame(t); }; requestAnimationFrame(t);
  });
  await p.goto(BASE + '/' + page + '.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(9500);   // past gate-timeout.js's 8 s
  const r = await p.evaluate(() => {
    const vis = (e) => !!e && getComputedStyle(e).display !== 'none';
    const ov = document.getElementById('guest-paywall-overlay');
    return { path: location.pathname, notice: !!document.getElementById('gate-timeout-notice'), pending: !!document.querySelector('.gate-pending'),
      clear: window.__clear, overlay: vis(ov), heading: (document.getElementById('paywall-heading') || {}).textContent || '',
      gateOverlay: vis(document.getElementById('access-gate-overlay')) };
  }).catch((e) => ({ err: e.message }));
  await p.close();
  return r;
}

(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const w of [390, 1440]) {
    for (const pg of ['charts', 'gex', 'market-map', 'roadmap']) {
      const r = await visit(b, pg, false, w);
      ok(`${w} ${pg} signed out: no timeout notice, gate cleared < 4 s, page shown`, !r.notice && !r.pending && r.clear !== null && r.clear < 4000 && !r.gateOverlay, JSON.stringify(r));
    }
    for (const pg of ['models', 'indicators']) {
      const r = await visit(b, pg, false, w);
      ok(`${w} ${pg} signed out: own "Sign in to browse" card stays up, no notice`, !r.notice && !r.pending && r.overlay && /Sign in to browse/.test(r.heading), JSON.stringify(r));
    }
    {
      const r = await visit(b, 'global-monitor', false, w);
      ok(`${w} global-monitor (gated) signed out: sign-in prompt, no notice`, !r.notice && r.overlay && /Sign in to use this page/.test(r.heading), JSON.stringify(r));
    }
    {
      const r = await visit(b, 'trade-journal', false, w);
      ok(`${w} trade-journal signed out: still redirects to login`, /login/.test(r.path || ''), JSON.stringify(r));
    }
    {
      const r = await visit(b, 'gex', true, w);
      ok(`${w} gex signed in (Pro): revealed, no prompt, no notice`, !r.notice && !r.pending && !r.overlay, JSON.stringify(r));
    }
  }
  await b.close();
  console.log(log.join('\n'));
  const fails = log.filter((l) => l.startsWith('FAIL')).length;
  console.log(fails ? fails + ' FAILED' : 'ALL PASS (' + log.length + ')');
  process.exit(fails ? 1 : 0);
})();
