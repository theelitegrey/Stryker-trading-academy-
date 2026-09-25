// Chapter gate: the reader shows chapter text only when the (stubbed) server
// hands it over, and the paywall when it refuses.
//
// The stub answers chapterBodies/{num} the way the Firestore rules do:
// admin, or minRank 0, or plan rank >= minRank; otherwise the read rejects
// with code 'permission-denied'. Chapters 01-07 are minRank 0, the rest 1.
//
//   node gate-test.js            assertions only
//   GATE_SHOTS=<dir> node gate-test.js   also screenshots at 390 and 1440
const { BASE, launch } = require('./lib.js');

const log = [];
const ok = (l, c, x) => log.push((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '   ' + x : ''));

function stubFor(mode) {
  const body = function (MODE) {
    const UID = 'u1';
    const RANK = { Starter: 0, Pro: 1, Elite: 2 };
    const PLAN = { starter: 'Starter', pro: 'Pro', admin: 'Starter', out: null }[MODE];
    const plans = [
      { id: 'st', name: 'Starter', rank: 0, chapterAccess: '1-7', price: 0 },
      { id: 'pr', name: 'Pro', rank: 1, chapterAccess: 'all', price: 19 },
      { id: 'el', name: 'Elite', rank: 2, chapterAccess: 'all', price: 49 }
    ];
    const minRank = (num) => (/^\d+$/.test(num) && parseInt(num, 10) <= 7 ? 0 : 1);   // track ids: Pro
    const catalog = () => (typeof CHAPTERS_SEED !== 'undefined' ? CHAPTERS_SEED : []);
    window.__bodyReads = [];
    const snap = (id, d) => ({ id, exists: !!d, data: () => d || {} });
    const denied = () => { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; return e; };

    function docGet(coll, id) {
      if (coll === 'chapterBodies') {
        window.__bodyReads.push(id);
        if (!PLAN && MODE !== 'admin') return Promise.reject(denied());
        const r = minRank(id);
        if (MODE !== 'admin' && r > 0 && RANK[PLAN] < r) return Promise.reject(denied());
        const cat = catalog().find((c) => c.num === id);
        if (!cat) return Promise.resolve(snap(id, null));
        return Promise.resolve(snap(id, {
          num: id, minRank: r, video: '',
          bodyHtml: '<p id="gate-body">FULL-TEXT-' + id + '</p>',
          paragraphs: ['FULL-TEXT-' + id],
          lessons: cat.lessons.map((l, i) => ({ title: l.title, desc: 'lesson ' + i, descHtml: '<p>LESSON-TEXT-' + id + '-' + i + '</p>' }))
        }));
      }
      if (coll === 'admins') return Promise.resolve(snap(id, MODE === 'admin' ? { role: 'admin' } : null));
      if (coll === 'students') return Promise.resolve(snap(id, PLAN || MODE === 'admin' ? { uid: UID, plan: PLAN, name: 'Gate Test', completedLessons: [], completedChapters: [] } : null));
      if (coll === 'plans') return Promise.resolve(snap(id, plans.find((p) => p.id === id) || null));
      return Promise.resolve(snap(id, null));
    }
    function docRef(coll, id) {
      return {
        id,
        get: () => docGet(coll, id),
        set: () => Promise.resolve(), update: () => Promise.resolve(), delete: () => Promise.resolve(),
        onSnapshot: (cb) => { docGet(coll, id).then(cb, () => {}); return () => {}; },
        collection: (sub) => colRef(sub)
      };
    }
    function rows(coll) {
      if (coll === 'chapters') return catalog().map((c) => Object.assign({}, c));
      if (coll === 'plans') return plans.slice();
      return [];
    }
    function listSnap(list) {
      const docs = list.map((d) => ({ id: d.id || d.num, exists: true, data: () => d }));
      return { empty: !docs.length, size: docs.length, docs, forEach: (f) => docs.forEach(f) };
    }
    function colRef(coll) {
      const self = {
        doc: (id) => docRef(coll, id || 'auto'),
        get: () => Promise.resolve(listSnap(rows(coll))),
        add: () => Promise.resolve({ id: 'x' }),
        where: () => self, orderBy: () => self, limit: () => self, startAfter: () => self,
        onSnapshot: (cb) => { setTimeout(() => cb(listSnap(rows(coll))), 10); return () => {}; }
      };
      return self;
    }
    const user = MODE === 'out' ? null : {
      uid: UID, email: 'gate@test.local', displayName: 'Gate Test', emailVerified: true,
      getIdTokenResult: () => Promise.resolve({ claims: {} }), getIdToken: () => Promise.resolve('t')
    };
    window.__stubDb = { collection: colRef, batch: () => ({ set(){}, update(){}, delete(){}, commit: () => Promise.resolve() }) };
    window.db = window.__stubDb;
    window.__stubAuth = {
      currentUser: user,
      onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; },
      setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve()
    };
    window.firebase = {
      apps: [], initializeApp: () => ({}),
      app: () => ({ functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }) }),
      firestore: Object.assign(() => window.__stubDb, {
        FieldValue: { serverTimestamp: () => 'TS', increment: (n) => ({ inc: n }), delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' },
        Timestamp: { now: () => ({ toDate: () => new Date() }), fromDate: (d) => ({ toDate: () => d }) }
      }),
      auth: Object.assign(() => window.__stubAuth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } } }),
      functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }),
      messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} })
    };
    window.auth = window.__stubAuth;
    try { localStorage.setItem('stryker_tour_done', '1'); localStorage.setItem('stryker_onboarding_done', '1'); } catch (e) {}
  };
  return '(' + body.toString() + ')(' + JSON.stringify(mode) + ')';
}

const SHOTS = process.env.GATE_SHOTS || '';

async function readerState(b, mode, ch, width) {
  const p = await b.newPage({ viewport: { width, height: width < 500 ? 844 : 950 } });
  const errs = [], reqs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('request', (r) => reqs.push(r.url()));
  await p.addInitScript(stubFor(mode));
  await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await p.goto(BASE + '/chapter.html?ch=' + ch, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1800);
  const r = await p.evaluate(() => {
    const ov = document.getElementById('guest-paywall-overlay');
    const body = document.getElementById('reader-body');
    const lessons = document.getElementById('reader-lessons');
    return {
      paywall: !!ov && getComputedStyle(ov).display !== 'none',
      heading: (document.getElementById('paywall-heading') || {}).textContent || '',
      title: (document.getElementById('reader-title') || {}).textContent || '',
      bodyText: body ? body.textContent : '',
      lessonsText: lessons ? lessons.textContent : '',
      pageHtmlHasFull: document.documentElement.innerHTML.includes('FULL-TEXT-'),
      reads: window.__bodyReads || [],
      crumb: (document.getElementById('reader-crumb-title') || {}).textContent || '',
      next: (() => { const n = document.getElementById('reader-next'); return n && n.style.visibility !== 'hidden' ? (n.querySelector('b') || {}).textContent || '' : ''; })()
    };
  });
  r.errs = errs.filter((e) => !/net::ERR_FAILED|Failed to load resource/.test(e));
  r.oldSeed = reqs.some((u) => /chapters-data\.js/.test(u));
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/gate-${mode}-ch${ch}-${width}.png` });
  await p.close();
  return r;
}

(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const cases = [
    // mode,    ch,   expect text?, expect paywall heading
    ['starter', '07', true,  null],
    ['starter', '08', false, /Upgrade/],
    ['pro',     '08', true,  null],
    ['pro',     '42', true,  null],
    ['admin',   '08', true,  null],
    ['out',     '08', false, /Sign in/],
    ['out',     '01', false, /Sign in/],
    ['starter', 'VP-01', false, /Upgrade/],
    ['starter', 'PF-10', false, /Upgrade/],
    ['pro',     'VP-01', true,  null],
    ['pro',     'PF-05', true,  null],
    ['out',     'VP-01', false, /Sign in/]
  ];
  for (const width of [390, 1440]) {
    for (const [mode, ch, text, pw] of cases) {
      const r = await readerState(b, mode, ch, width);
      const tag = `${mode} ch${ch} @${width}`;
      ok(tag + ': title rendered from the catalog', r.title.length > 3, r.title);
      if (text) {
        ok(tag + ': full text shown', r.bodyText.includes('FULL-TEXT-' + ch));
        ok(tag + ': lesson text shown', r.lessonsText.includes('LESSON-TEXT-' + ch));
        ok(tag + ': no paywall', !r.paywall, r.heading);
      } else {
        ok(tag + ': no full text anywhere in the page', !r.pageHtmlHasFull);
        ok(tag + ': teaser shown instead', r.bodyText.trim().length > 20, r.bodyText.slice(0, 60));
        ok(tag + ': paywall shown', r.paywall && pw.test(r.heading), r.heading);
      }
      if (mode === 'out') ok(tag + ': signed out never asks for the body', r.reads.length === 0, r.reads.join(','));
      if (/-/.test(ch)) {
        ok(tag + ': reader stays inside its track (next link)', !r.next || r.next.startsWith(ch.slice(0, 3)) || r.next === '', r.next);
        ok(tag + ': the requested track chapter is the one shown', r.title.length > 3 && r.crumb === 'Chapter ' + ch, r.crumb);
      }
      ok(tag + ': old chapters-data.js not requested', !r.oldSeed);
      ok(tag + ': no page/console errors', r.errs.length === 0, r.errs.join(' | ').slice(0, 300));
    }
  }

  // Course list: catalog only, teaser shows, no text fetched.
  for (const width of [390, 1440]) {
    const p = await b.newPage({ viewport: { width, height: width < 500 ? 844 : 950 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript(stubFor('starter'));
    await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
    await p.goto(BASE + '/courses.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1800);
    const r = await p.evaluate(() => ({
      cards: document.querySelectorAll('.chapter-num').length,
      text: (document.querySelector('.chapter-body p') || {}).textContent || '',
      tracks: document.querySelectorAll('[data-track-heading]').length,
      trackLocks: [...document.querySelectorAll('[data-track] .status-pill.locked')].length,
      reads: window.__bodyReads || []
    }));
    ok(`courses @${width}: 42 core + 22 track cards`, r.cards === 64, String(r.cards));
    ok(`courses @${width}: both track headings`, r.tracks === 2, String(r.tracks));
    ok(`courses @${width}: Starter sees 22 track locks`, r.trackLocks === 22, String(r.trackLocks));
    ok(`courses @${width}: teaser text present`, r.text.length > 20, r.text.slice(0, 50));
    ok(`courses @${width}: no chapter bodies fetched`, r.reads.length === 0, r.reads.join(','));
    ok(`courses @${width}: no page errors`, errs.length === 0, errs.join(' | '));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/gate-courses-starter-${width}.png` });
    await p.close();
  }

  for (const width of [390, 1440]) {
    const p = await b.newPage({ viewport: { width, height: width < 500 ? 844 : 950 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript(stubFor('pro'));
    await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
    await p.goto(BASE + '/courses.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1800);
    await p.click('.level-tab[data-level="tracks"]');
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => ({
      cards: document.querySelectorAll('.chapter').length,
      locks: document.querySelectorAll('[data-track] .status-pill.locked').length,
      core: [...document.querySelectorAll('.chapter-num')].filter((e) => /^\d+$/.test(e.textContent)).length
    }));
    ok(`courses Pro Tracks tab @${width}: 22 track cards, no core`, r.cards === 22 && r.core === 0, r.cards + '/' + r.core);
    ok(`courses Pro Tracks tab @${width}: no locks`, r.locks === 0, String(r.locks));
    ok(`courses Pro Tracks tab @${width}: no page errors`, errs.length === 0, errs.join(' | '));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/tracks-courses-pro-tab-${width}.png`, fullPage: false });
    await p.close();
    // Learn article (public, no stub needed beyond blocking the network)
    const q = await b.newPage({ viewport: { width, height: width < 500 ? 844 : 950 } });
    const qe = [];
    q.on('pageerror', (e) => qe.push(e.message));
    await q.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
    for (const slug of ['learn-volume-profile', 'learn-order-flow', 'learn-how-prop-firms-work']) {
      await q.goto(BASE + '/' + slug + '.html', { waitUntil: 'domcontentloaded' });
      await q.waitForTimeout(700);
      const a = await q.evaluate(() => ({ h1: (document.querySelector('h1') || {}).textContent || '', words: document.querySelector('main').innerText.split(/\s+/).length,
        svg: document.querySelectorAll('main svg').length, over: document.documentElement.scrollWidth - window.innerWidth }));
      ok(`${slug} @${width}: renders`, a.h1.length > 10 && a.words > 800, a.h1.slice(0, 50) + ' / ' + a.words + ' words / ' + a.svg + ' svg');
      ok(`${slug} @${width}: no sideways scroll`, a.over <= 0, String(a.over));
      if (SHOTS) await q.screenshot({ path: `${SHOTS}/${slug}-${width}.png` });
    }
    // Firebase's CDN is blocked here, so db is null; every public page (about.html
    // included) logs "reading 'collection'" in that state. Live has no such error.
    const real = qe.filter((m) => !/reading 'collection'/.test(m));
    ok(`learn @${width}: no page errors (besides blocked-Firebase noise)`, real.length === 0, real.join(' | ').slice(0, 200));
    await q.close();
  }

  await b.close();
  console.log(log.join('\n'));
  const fails = log.filter((l) => l.startsWith('FAIL')).length;
  console.log(fails ? `\n${fails} FAILED of ${log.length}` : `\nALL PASS (${log.length})`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
