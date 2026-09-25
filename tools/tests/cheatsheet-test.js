// Cheat-sheet download pages: /cheat-sheet (FVG & Order Block) and
// /prop-firm-cheat-sheet (Prop Firm) share assets/cheat-sheet.js, which reads
// the PDF path, the return path and the activity label from <body data-cs-*>.
//
// For each page, signed out and signed in (Firebase stubbed), at 375, 390,
// 414 and 1440, plain and with the Instagram UTM query:
//   - signed out: the signup gate shows, the download is hidden, and clicking
//     "Create a free account" / "Log in" stores the right stryker_return_to
//   - signed in: the download link points at the right PDF, the PDF answers
//     200 application/pdf, and a click logs content.download with the right
//     label (nothing else is logged)
//   - no horizontal overflow, no page errors
// Plus: the Prop Firm Mastery track on /courses shows the cheat-sheet link,
// and the two Learn articles link to the page.
//
//   node cheatsheet-test.js
//   CS_SHOTS=<dir> node cheatsheet-test.js   also screenshots at 390 and 1440
const { BASE, launch } = require('./lib.js');

const log = [];
const ok = (l, c, x) => log.push((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '   ' + x : ''));
const SHOTS = process.env.CS_SHOTS || '';
const UTM = '?utm_source=instagram&utm_medium=social&utm_campaign=cheatsheet-prop';

const PAGES = [
  { path: '/cheat-sheet.html', ret: '/cheat-sheet', pdf: 'assets/downloads/stryker-fvg-order-block-cheat-sheet.pdf',
    label: 'Downloaded the FVG & Order Block cheat sheet', name: 'fvg' },
  { path: '/prop-firm-cheat-sheet.html', ret: '/prop-firm-cheat-sheet', pdf: 'assets/downloads/stryker-prop-firm-cheat-sheet.pdf',
    label: 'Downloaded the Prop Firm cheat sheet', name: 'prop' }
];

function stub(signedIn) {
  const body = function (IN) {
    const user = IN ? { uid: 'u1', email: 'cs@test.local', displayName: 'CS Test', emailVerified: true,
      getIdTokenResult: () => Promise.resolve({ claims: {} }), getIdToken: () => Promise.resolve('t') } : null;
    const snap = (id, d) => ({ id, exists: !!d, data: () => d || {} });
    window.__logged = [];
    function docRef(coll, id) {
      return { id, get: () => Promise.resolve(snap(id, coll === 'students' && IN ? { uid: 'u1', plan: 'Starter' } : null)),
        set: () => Promise.resolve(), update: () => Promise.resolve(), delete: () => Promise.resolve(),
        onSnapshot: (cb) => { setTimeout(() => cb(snap(id, null)), 5); return () => {}; }, collection: (s) => colRef(s) };
    }
    function colRef(coll) {
      const empty = { empty: true, size: 0, docs: [], forEach() {} };
      const self = { doc: (id) => docRef(coll, id || 'auto'), get: () => Promise.resolve(empty),
        add: (d) => { if (coll === 'activityLog') window.__logged.push(d); return Promise.resolve({ id: 'x' }); },
        where: () => self, orderBy: () => self, limit: () => self, startAfter: () => self,
        onSnapshot: (cb) => { setTimeout(() => cb(empty), 5); return () => {}; } };
      return self;
    }
    window.__stubDb = { collection: colRef, batch: () => ({ set(){}, update(){}, delete(){}, commit: () => Promise.resolve() }),
      runTransaction: () => Promise.resolve() };
    window.__stubAuth = { currentUser: user, onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; },
      setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve() };
    window.firebase = {
      apps: [{}], initializeApp: () => ({}), app: () => ({ functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }) }),
      firestore: Object.assign(() => window.__stubDb, {
        FieldValue: { serverTimestamp: () => 'TS', increment: (n) => ({ inc: n }), delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' },
        Timestamp: { now: () => ({ toDate: () => new Date() }), fromDate: (d) => ({ toDate: () => d }) } }),
      auth: Object.assign(() => window.__stubAuth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } }, GoogleAuthProvider: function () {} }),
      functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }),
      messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} })
    };
  };
  return '(' + body.toString() + ')(' + JSON.stringify(signedIn) + ')';
}

async function pageRun(b, pg, signedIn, width, utm) {
  const ctx = await b.newContext({ viewport: { width, height: width < 500 ? 844 : 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.addInitScript(stub(signedIn));
  await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  const tag = `${pg.name} ${signedIn ? 'in' : 'out'} ${width}${utm ? ' utm' : ''}`;
  await p.goto(BASE + pg.path + (utm ? UTM : ''), { waitUntil: 'domcontentloaded' });
  const cfg = await p.evaluate(() => Object.assign({}, document.body.dataset));
  ok(`${tag}: data-cs-* set`, cfg.csPdf === pg.pdf && cfg.csReturn === pg.ret && cfg.csLabel === pg.label, JSON.stringify(cfg));
  if (signedIn) {
    await p.waitForFunction(() => { const d = document.getElementById('cs-download'); return d && !d.hidden; }, null, { timeout: 8000 }).catch(() => {});
  } else {
    await p.waitForTimeout(600);
  }
  const st = await p.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.offsetParent !== null; };
    return { out: vis('cs-signed-out'), inn: vis('cs-signed-in'), dl: vis('cs-download'), pending: vis('cs-pending'),
      href: (document.getElementById('cs-download') || {}).getAttribute && document.getElementById('cs-download').getAttribute('href'),
      signupText: (document.getElementById('cs-signup') || {}).textContent || '',
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      preview: (() => { const i = document.querySelector('.cs-preview img'); return i ? i.complete && i.naturalWidth > 0 : false; })() };
  });
  ok(`${tag}: no horizontal overflow`, st.overflow <= 0, 'overflow ' + st.overflow);
  ok(`${tag}: preview image loaded`, st.preview);
  if (SHOTS && !utm && (width === 390 || width === 1440)) await p.screenshot({ path: `${SHOTS}/${pg.name}-${signedIn ? 'signedin' : 'signedout'}-${width}.png` });
  if (!signedIn) {
    ok(`${tag}: gate shows, download hidden`, st.out && !st.inn && !st.dl, JSON.stringify(st));
    ok(`${tag}: signup button text`, st.signupText.trim() === 'Create a free account to download', st.signupText);
    for (const id of ['cs-signup', 'cs-login']) {
      await p.evaluate(() => sessionStorage.removeItem('stryker_return_to'));
      await p.evaluate((i) => { const a = document.getElementById(i); a.addEventListener('click', (e) => e.preventDefault(), { once: true }); a.click(); }, id);
      const ret = await p.evaluate(() => sessionStorage.getItem('stryker_return_to'));
      ok(`${tag}: ${id} stores return path`, ret === pg.ret, ret);
    }
  } else {
    ok(`${tag}: download shows, gate hidden`, !st.out && st.inn && st.dl && !st.pending, JSON.stringify(st));
    ok(`${tag}: download href`, st.href === pg.pdf, st.href);
    const r = await p.request.get(BASE + '/' + pg.pdf);
    const ct = r.headers()['content-type'] || '';
    const buf = await r.body();
    ok(`${tag}: PDF 200 application/pdf`, r.status() === 200 && /application\/pdf/.test(ct) && buf.slice(0, 5).toString() === '%PDF-', `${r.status()} ${ct} ${buf.length}B`);
    await p.evaluate(() => { window.__logged.length = 0; });
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), p.click('#cs-download')]);
    await p.waitForTimeout(300);
    // The real logActivity (assets/activity-log.js) writes activityLog via the stub db.
    const la = await p.evaluate(() => window.__logged.map((d) => [d.action, d.summary, d.actorUid]));
    ok(`${tag}: click logs content.download once with label`, la.length === 1 && la[0][0] === 'content.download' && la[0][1] === pg.label && la[0][2] === 'u1', JSON.stringify(la));
    ok(`${tag}: browser download starts`, !!dl && /\.pdf$/.test(dl.suggestedFilename()), dl ? dl.suggestedFilename() : 'none');
  }
  const real = errs.filter((e) => !/net::ERR_FAILED|Failed to load resource|ERR_BLOCKED/.test(e));
  ok(`${tag}: no page errors`, !real.length, real.slice(0, 3).join(' | '));
  await ctx.close();
}

async function links(b) {
  for (const slug of ['how-prop-firms-work', 'prop-firm-challenge-rules']) {
    for (const width of [390, 1440]) {
      const p = await b.newPage({ viewport: { width, height: width < 500 ? 844 : 950 } });
      await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
      await p.goto(`${BASE}/learn-${slug}.html`, { waitUntil: 'domcontentloaded' });
      const r = await p.evaluate(() => {
        const box = document.getElementById('prop-firm-cheat-sheet');
        const a = box && box.querySelector('a[href^="prop-firm-cheat-sheet"]');
        return { box: !!box, href: a ? a.getAttribute('href') : '', visible: !!a && a.getBoundingClientRect().width > 0,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      ok(`learn-${slug} ${width}: cheat-sheet callout links to the page`, r.box && r.visible && /^prop-firm-cheat-sheet\?utm_/.test(r.href), r.href);
      ok(`learn-${slug} ${width}: no horizontal overflow`, r.overflow <= 0, 'overflow ' + r.overflow);
      if (SHOTS) {
        await p.evaluate(() => { const e = document.getElementById('prop-firm-cheat-sheet'); window.scrollTo({ top: e.getBoundingClientRect().top + window.scrollY - 200, behavior: 'instant' }); });
        await p.waitForTimeout(400);
        await p.screenshot({ path: `${SHOTS}/learn-${slug}-${width}.png` });
      }
      await p.close();
    }
  }
}

async function courses(b) {
  const gate = require('fs').readFileSync(__dirname + '/gate-test.js', 'utf8');
  // Reuse the chapter-gate suite's stub (catalog from the seed, Starter plan).
  const m = gate.match(/function stubFor\(mode\) \{[\s\S]*?\n\}\n/);
  const stubFor = new Function(m[0] + '; return stubFor;')();
  for (const width of [390, 1440]) {
    for (const mode of ['starter', 'pro']) {
      const p = await b.newPage({ viewport: { width, height: width < 500 ? 844 : 950 } });
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      await p.addInitScript(stubFor(mode));
      await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
      await p.goto(`${BASE}/courses.html`, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('.level-tab[data-level="tracks"]', { timeout: 8000 });
      await p.waitForTimeout(1200);
      await p.click('.level-tab[data-level="tracks"]');
      const r = await p.waitForFunction(() => {
        const a = document.querySelector('a[data-track-link="pf"]');
        return a ? { href: a.getAttribute('href'), text: a.parentElement.textContent, w: a.getBoundingClientRect().width,
          vp: !!document.querySelector('a[data-track-link="vp"]'),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth } : null;
      }, null, { timeout: 8000 }).then((h) => h.jsonValue()).catch(() => null);
      ok(`courses ${mode} ${width}: PF track shows the cheat-sheet link`, !!r && r.href === 'prop-firm-cheat-sheet' && r.w > 0, r ? r.text : 'missing');
      ok(`courses ${mode} ${width}: VP track has no link`, !!r && !r.vp);
      ok(`courses ${mode} ${width}: no horizontal overflow`, !!r && r.overflow <= 0, r ? 'overflow ' + r.overflow : '');
      ok(`courses ${mode} ${width}: no page errors`, !errs.length, errs.slice(0, 2).join(' | '));
      if (SHOTS && mode === 'starter') {
        await p.evaluate(() => { const e = document.querySelector('[data-track-heading="pf"]'); window.scrollTo({ top: e.getBoundingClientRect().top + window.scrollY - 160, behavior: 'instant' }); });
        await p.waitForTimeout(400);
        await p.screenshot({ path: `${SHOTS}/courses-pf-track-${width}.png` });
      }
      await p.close();
    }
  }
}

(async () => {
  const b = await launch();
  try {
    for (const pg of PAGES) {
      for (const width of [375, 390, 414, 1440]) {
        for (const signedIn of [false, true]) {
          await pageRun(b, pg, signedIn, width, false);
          if (width === 390 || width === 1440) await pageRun(b, pg, signedIn, width, true);
        }
      }
    }
    await links(b);
    await courses(b);
  } finally {
    await b.close();
  }
  const fails = log.filter((l) => l.startsWith('FAIL'));
  console.log(log.join('\n'));
  console.log(`\n${log.length - fails.length}/${log.length} passed`);
  process.exit(fails.length ? 1 : 0);
})();
