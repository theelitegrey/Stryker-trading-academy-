// chapters-admin stat-cards suite.
//
// Covers the swap from db.collection('students').get() (an unprojected
// download of every student document) to a single adminStats/current read.
//
// Run from tools/tests/chapters-admin/: node run.js
// Needs a local http.server on port 8000 serving the repo root, same
// convention as tools/tests/admin-analytics/run.js.
const path = require('path');
const fs = require('fs');
const { launch, BASE } = require('../lib.js');

const OUT_DIR = '/root/projects/stryker-notes/chapters-admin';
fs.mkdirSync(OUT_DIR, { recursive: true });

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
  results.push({ name, ok: !!cond, detail: detail || null });
}

// Fixture snapshot: 56 users, 48 completions spread over the catalogue.
// Ch. 02 and Ch. 07 deliberately TIE on 9 so the tie-break is exercised.
const SNAPSHOT = {
  totalUsers: 56,
  scanned: 56,
  startedCount: 5,
  avgCompletion: 15,
  chapterCompletions: { '01': 9, '02': 9, '03': 4, '04': 3, '05': 2, '07': 9, '10': 1,
                        '12': 1, '15': 1, '20': 1, '30': 1, '42': 1, 'PF-01': 3, 'VP-01': 3 },
  generatedAtMs: Date.now() - 7 * 60 * 1000, // 7 minutes ago
};

function buildStub(mode) {
  return `(() => {
    const MODE = ${JSON.stringify(mode)};
    const SNAP = ${JSON.stringify(SNAPSHOT)};
    window.__calls = [];
    const rec = (collection, method, extra) => window.__calls.push({ collection, method, extra: extra || null });

    const docSnap = (data, id) => ({ exists: data !== null, data: () => data, id: id || 'x' });
    const emptyQuery = { forEach: () => {}, docs: [], empty: true, size: 0 };

    const colRef = (name, filtered) => {
      const ref = {
        // An UNBOUNDED scan is a get() on a collection ref that has had no
        // where/limit applied — that is the thing this change removes. A
        // filtered or limited query, or a single doc.get, is bounded and is
        // recorded distinctly so the assertion can tell them apart.
        get: () => { rec(name, filtered ? 'filtered.get' : 'UNBOUNDED.get'); return Promise.resolve(emptyQuery); },
        where: () => { rec(name, 'where'); return colRef(name, true); },
        orderBy: () => { rec(name, 'orderBy'); return colRef(name, true); },
        limit: () => { rec(name, 'limit'); return colRef(name, true); },
        onSnapshot: () => () => {},
        doc: (id) => ({
          id: id,
          get: () => {
            rec(name, 'doc.get', id);
            if (name === 'adminStats' && id === 'current') {
              if (MODE === 'missing') return Promise.resolve(docSnap(null, id));
              if (MODE === 'error') return Promise.reject(new Error('permission-denied (fixture)'));
              const s = Object.assign({}, SNAP);
              s.generatedAt = { toMillis: () => SNAP.generatedAtMs, toDate: () => new Date(SNAP.generatedAtMs) };
              delete s.generatedAtMs;
              return Promise.resolve(docSnap(s, id));
            }
            if (name === 'admins') return Promise.resolve(docSnap({ role: 'admin' }, id));
            return Promise.resolve(docSnap(null, id));
          },
          set: () => Promise.resolve(), update: () => Promise.resolve(), delete: () => Promise.resolve(),
          onSnapshot: () => () => {},
          collection: () => colRef(name + '/sub'),
        }),
        add: () => Promise.resolve({ id: 'x' }),
      };
      return ref;
    };

    window.__stubDb = {
      collection: colRef,
      batch: () => ({ set(){}, update(){}, delete(){}, commit: () => Promise.resolve() }),
      runTransaction: (fn) => Promise.resolve(fn({ get: () => Promise.resolve(docSnap(null)), set(){}, update(){} })),
    };
    window.db = window.__stubDb;

    const ADMIN = { uid: 'adm', email: 'admin@example.com', displayName: 'Admin',
                    emailVerified: true, getIdToken: () => Promise.resolve('fake-id-token') };
    window.__stubAuth = {
      currentUser: ADMIN,
      onAuthStateChanged: (cb) => { setTimeout(() => cb(ADMIN), 10); return () => {}; },
      setPersistence: () => Promise.resolve(),
      signOut: () => Promise.resolve(),
    };
    window.firebase = {
      apps: [],
      initializeApp: () => ({}),
      app: () => ({ functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }) }),
      firestore: Object.assign(() => window.__stubDb, {
        FieldValue: { serverTimestamp: () => 'TS', increment: (n) => ({ inc: n }), delete: () => 'DEL',
                      arrayUnion: () => 'AU', arrayRemove: () => 'AR' },
        Timestamp: { now: () => ({ toDate: () => new Date(), toMillis: () => Date.now() }) },
      }),
      auth: Object.assign(() => window.__stubAuth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } } }),
      messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} }),
    };
    window.auth = window.__stubAuth;
    window.showToast = () => Promise.resolve();

    // Admin gate: this page's body runs behind guardAdminPage. Defined both
    // before and (via the property setter below) after admin-guard.js loads,
    // so the real guard cannot replace it with a Firestore round-trip.
    let _guard = (fn) => fn();
    Object.defineProperty(window, 'guardAdminPage', {
      configurable: true,
      get: () => _guard,
      set: () => {},
    });

    // Chapter catalogue: ordered, so the argmax tie-break is deterministic.
    const CH = [];
    for (let i = 1; i <= 42; i++) CH.push({ num: String(i).padStart(2, '0'), title: 'Chapter ' + i, level: 1 });
    CH.push({ num: 'PF-01', title: 'Prop firms', level: 1 });
    CH.push({ num: 'VP-01', title: 'Volume profile', level: 1 });
    window.CHAPTERS = CH;
    window.CHAPTERS_SEED = CH;
    window.CHAPTERS_FROM_SEED = false;
    window.LEVEL_LABEL = { 1: 'Foundation', 2: 'Intermediate', 3: 'Advanced' };
    // loadChapters is defined by chapters-store.js; force the fixture so the
    // list renders without a catalogue fetch.
    Object.defineProperty(window, 'loadChapters', {
      configurable: true,
      get: () => () => Promise.resolve(CH),
      set: () => {},
    });
  })();`;
}

async function loadPage(browser, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await ctx.addInitScript(buildStub(mode));
  const page = await ctx.newPage();
  const errors = [];
  // Blocked external requests (the gstatic Firebase SDK) are expected here:
  // ctx.route aborts everything off-localhost on purpose, and window.firebase
  // is fully stubbed. Only real page errors count.
  const isNoise = (t) => /ERR_FAILED|ERR_BLOCKED|Failed to load resource|net::/i.test(t);
  page.on('pageerror', (e) => { if (!isNoise(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(BASE + '/chapters-admin.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => ({
    total: (document.getElementById('chstat-total-students') || {}).textContent,
    avg: (document.getElementById('chstat-avg-completion') || {}).textContent,
    most: (document.getElementById('chstat-most-completed') || {}).textContent,
    updated: (document.getElementById('chstat-updated') || {}).textContent || '',
    calls: window.__calls || [],
  }));
  return { ctx, page, state, errors };
}

(async () => {
  const browser = await launch();
  try {
    // ---- 1. normal snapshot
    console.log('\n[normal snapshot]');
    let r = await loadPage(browser, 'normal');
    const studentScans = r.state.calls.filter((c) => c.collection === 'students' && c.method === 'UNBOUNDED.get');
    const otherScripts = r.state.calls.filter((c) => c.collection === 'students');

    check('ZERO unbounded students scans on page load',
      studentScans.length === 0, 'got ' + JSON.stringify(studentScans));
    check('no unbounded scan of ANY user-data collection (students/profiles/presence)',
      r.state.calls.filter((c) => c.method === 'UNBOUNDED.get'
        && ['students', 'profiles', 'presence'].includes(c.collection)).length === 0,
      JSON.stringify(r.state.calls.filter((c) => c.method === 'UNBOUNDED.get')));
    check('the only students traffic left is bounded (own doc.get / filtered where), from other page scripts',
      otherScripts.every((c) => c.method === 'doc.get' || c.method === 'where' || c.method === 'filtered.get'),
      JSON.stringify(otherScripts));
    check('reads adminStats/current exactly once',
      r.state.calls.filter((c) => c.collection === 'adminStats' && c.method === 'doc.get' && c.extra === 'current').length === 1,
      JSON.stringify(r.state.calls));
    check('card: total students comes from snapshot totalUsers (56)',
      r.state.total === '56', 'got ' + r.state.total);
    check('card: average = sum(chapterCompletions)/totalUsers = 48/56 = 0.9',
      r.state.avg === '0.9', 'got ' + r.state.avg);
    check('card: most-completed is the argmax chapter',
      r.state.most === 'Ch. 01', 'got ' + r.state.most);
    check('argmax TIE breaks to the earliest catalogue chapter (01 over 02 and 07, all = 9)',
      r.state.most === 'Ch. 01', 'got ' + r.state.most);
    check('freshness line shows the snapshot age',
      /Stats updated 7 min ago/.test(r.state.updated), 'got ' + JSON.stringify(r.state.updated));
    check('no page errors with a normal snapshot', r.errors.length === 0, JSON.stringify(r.errors));
    await r.ctx.close();

    // ---- 2. missing snapshot
    console.log('\n[missing snapshot]');
    r = await loadPage(browser, 'missing');
    check('missing snapshot: cards show a dash, not 0 and not a crash',
      r.state.total === '—' && r.state.avg === '—' && r.state.most === '—',
      JSON.stringify([r.state.total, r.state.avg, r.state.most]));
    check('missing snapshot: shows a "not yet generated" note',
      /not yet generated/i.test(r.state.updated), 'got ' + JSON.stringify(r.state.updated));
    check('missing snapshot: does NOT throw',
      r.errors.length === 0, JSON.stringify(r.errors));
    check('missing snapshot: does NOT fall back to scanning students',
      r.state.calls.filter((c) => c.collection === 'students' && c.method === 'UNBOUNDED.get').length === 0,
      JSON.stringify(r.state.calls.filter((c) => c.method === 'UNBOUNDED.get')));
    check('missing snapshot: chapter list still renders',
      await r.page.evaluate(() => (document.getElementById('chapter-editor-list') || {}).children.length > 0));
    await r.ctx.close();

    // ---- 3. failed snapshot read
    console.log('\n[snapshot read rejects]');
    r = await loadPage(browser, 'error');
    check('read error: cards degrade to a dash',
      r.state.total === '—' && r.state.avg === '—' && r.state.most === '—',
      JSON.stringify([r.state.total, r.state.avg, r.state.most]));
    check('read error: still no students scan',
      r.state.calls.filter((c) => c.collection === 'students' && c.method === 'UNBOUNDED.get').length === 0,
      JSON.stringify(r.state.calls.filter((c) => c.method === 'UNBOUNDED.get')));
    check('read error: chapter list still renders (page not dead)',
      await r.page.evaluate(() => (document.getElementById('chapter-editor-list') || {}).children.length > 0));
    await r.ctx.close();
  } finally {
    await browser.close();
  }

  console.log('\n' + pass + '/' + (pass + fail) + ' passed');
  fs.writeFileSync(path.join(OUT_DIR, 'ui-checks.json'),
    JSON.stringify({ pass, fail, total: pass + fail, allPass: fail === 0, results }, null, 1));
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(2); });
