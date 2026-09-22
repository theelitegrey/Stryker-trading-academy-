const { chromium, ROOT, BASE, launch } = require('./lib.js');
const fs = require('fs');
const BRIEF = JSON.parse(fs.readFileSync(ROOT + '/assets/market-brief.json', 'utf8'));

const stub = `(${function () {
  const snap = (d) => ({ exists: !!d, data: () => d || {} });
  const docRef = () => ({ get: () => Promise.resolve(snap(null)), set: () => Promise.resolve(), collection: () => colRef() });
  const colRef = () => ({ doc: docRef, get: () => Promise.resolve({empty:true,size:0,forEach:()=>{}}), where: () => colRef(), orderBy: () => colRef(), limit: () => colRef(), onSnapshot: () => () => {} });
  window.__stubDb = { collection: colRef }; window.db = window.__stubDb;
  window.__stubAuth = { currentUser: {uid:'u1'}, onAuthStateChanged: (cb)=>setTimeout(()=>cb({uid:'u1'}),10), setPersistence: ()=>Promise.resolve() };
  window.firebase = { apps: [], initializeApp: () => ({}), app: () => ({ functions: () => ({ httpsCallable: () => () => Promise.resolve({data:{}}) }) }),
    firestore: Object.assign(()=>window.__stubDb,{FieldValue:{serverTimestamp:()=>'TS',increment:n=>({inc:n}),delete:()=>'DEL',arrayUnion:()=>'AU',arrayRemove:()=>'AR'}}),
    auth: Object.assign(()=>window.__stubAuth,{Auth:{Persistence:{LOCAL:'l',SESSION:'s'}}}), messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} }) };
  window.auth = window.__stubAuth; window.showToast = () => Promise.resolve();
}})()`;

async function open(b, url, briefOverride, viewport) {
  const page = await b.newPage({ viewport: viewport || { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(stub);
  // Serve a controlled brief so staleness can be tested without touching the file.
  if (briefOverride) {
    await page.route(/market-brief\.json/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(briefOverride) }));
  }
  await page.route(/^https?:\/\/(?!localhost)/, r => r.abort());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  page.__errs = errs;
  return page;
}
const fresh = (extra) => Object.assign({}, BRIEF, { generatedAt: new Date(Date.now() - 3600e3).toISOString(), goodUntil: new Date(Date.now() + 24 * 3600e3).toISOString() }, extra || {});
// goodUntil outranks the hour count, so a stale fixture has to move both.
const stale = (extra) => Object.assign({}, BRIEF, { generatedAt: new Date(Date.now() - 50 * 3600e3).toISOString(), goodUntil: new Date(Date.now() - 3600e3).toISOString() }, extra || {});

(async () => {
  const b = await launch();
  const log = []; const ok = (l, c, x) => log.push((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '   ' + x : ''));

  // --- 1. the shipped file is valid and complete ---
  ok('brief has a headline', !!BRIEF.headline);
  ok('brief has 3 to 5 bullets', BRIEF.bullets.length >= 3 && BRIEF.bullets.length <= 5, BRIEF.bullets.length + '');
  ok('every bullet has a title and text', BRIEF.bullets.every(x => x.title && x.text));
  ok('every calendar row has a time and event', BRIEF.calendar.every(c => c.time && c.event));
  ok('sources are named', (BRIEF.sources || []).length > 0);
  ok('attribution names Bigdata.com with a link', /Bigdata\.com/.test(BRIEF.attribution) && /https:\/\/bigdata\.com/.test(BRIEF.attribution));
  ok('disclaimer says it is not advice', /not trading advice/i.test(BRIEF.disclaimer));
  ok('has a watchOut', !!BRIEF.watchOut);

  // --- 2. fresh brief on the full page ---
  let p = await open(b, BASE + '/market-brief.html', fresh());
  let r = await p.evaluate(() => {
    const el = document.getElementById('mb-page');
    return { text: el.textContent, stale: !!el.querySelector('.mb-stale'), cal: el.querySelectorAll('.mb-cal li').length,
             points: el.querySelectorAll('.mb-points li').length, archive: el.querySelectorAll('.mb-archive li').length };
  });
  ok('page renders the headline', r.text.indexOf(BRIEF.headline) !== -1);
  ok('fresh brief shows no stale warning', !r.stale);
  ok('calendar rendered in full', r.cal === BRIEF.calendar.length, r.cal + ' rows');
  ok('all bullets rendered', r.points === BRIEF.bullets.length);
  ok('archive rendered', r.archive === BRIEF.archive.length);
  ok('sources printed in the footer', r.text.indexOf('Sources:') !== -1);
  ok('disclaimer printed', /not trading advice/i.test(r.text));
  await p.close();

  // --- 3. THE important one: a stale brief must not present a calendar ---
  p = await open(b, BASE + '/market-brief.html', stale());
  r = await p.evaluate(() => {
    const el = document.getElementById('mb-page');
    return { stale: !!el.querySelector('.mb-stale'), cal: el.querySelectorAll('.mb-cal li').length,
             points: el.querySelectorAll('.mb-points li').length, text: el.textContent };
  });
  ok('stale brief warns loudly', r.stale);
  ok('stale brief HIDES the calendar', r.cal === 0, r.cal + ' rows shown');
  ok('stale brief keeps the analysis', r.points === BRIEF.bullets.length);
  ok('stale warning says how old', /days ago|hours ago/.test(r.text));
  await p.close();

  // --- 3b. goodUntil, the weekend case ------------------------------------
  //
  // This is the whole reason the field exists: a Friday brief read on a Sunday
  // is 50+ hours old and must NOT be marked stale, because the market has not
  // opened since it was written. If this test ever goes red, the banner is back
  // to crying wolf every weekend.
  const gu = (over) => Object.assign({}, BRIEF,
    { generatedAt: new Date(Date.now() - 50 * 3600e3).toISOString() }, over);

  p = await open(b, BASE + '/market-brief.html',
                 gu({ goodUntil: new Date(Date.now() + 12 * 3600e3).toISOString() }));
  r = await p.evaluate(() => {
    const el = document.getElementById('mb-page');
    return { stale: !!el.querySelector('.mb-stale'), cal: el.querySelectorAll('.mb-cal li').length };
  });
  ok('50h old but inside goodUntil is NOT stale', !r.stale);
  ok('...and still shows its calendar', r.cal === BRIEF.calendar.length, r.cal + '');
  await p.close();

  // The mirror: goodUntil outranks a comfortable hour count in the other
  // direction too, so a generator can retire a file early.
  p = await open(b, BASE + '/market-brief.html',
                 Object.assign({}, BRIEF, {
                   generatedAt: new Date(Date.now() - 3600e3).toISOString(),
                   goodUntil: new Date(Date.now() - 60e3).toISOString() }));
  r = await p.evaluate(() => ({ stale: !!document.querySelector('#mb-page .mb-stale') }));
  ok('1h old but past goodUntil IS stale', r.stale);
  await p.close();

  // No goodUntil at all: fall back to staleAfterHours, both ways.
  const noGU = (hoursOld) => { const o = Object.assign({}, BRIEF,
    { generatedAt: new Date(Date.now() - hoursOld * 3600e3).toISOString() });
    delete o.goodUntil; return o; };

  p = await open(b, BASE + '/market-brief.html', noGU(50));
  r = await p.evaluate(() => ({ stale: !!document.querySelector('#mb-page .mb-stale') }));
  ok('no goodUntil falls back to staleAfterHours', r.stale);
  await p.close();

  p = await open(b, BASE + '/market-brief.html', noGU(2));
  r = await p.evaluate(() => ({ stale: !!document.querySelector('#mb-page .mb-stale') }));
  ok('no goodUntil, inside the window, stays fresh', !r.stale);
  await p.close();

  // An unparseable goodUntil must not silently pin the file as fresh forever.
  p = await open(b, BASE + '/market-brief.html',
                 gu({ goodUntil: 'next tuesday-ish' }));
  r = await p.evaluate(() => ({ stale: !!document.querySelector('#mb-page .mb-stale') }));
  ok('garbage goodUntil falls back to the hour count', r.stale);
  await p.close();

  // --- 4. dashboard card ---
  p = await open(b, BASE + '/dashboard-user.html', fresh());
  r = await p.evaluate(() => {
    const el = document.getElementById('dash-brief');
    return { hidden: el.hidden, text: el.textContent, next: !!el.querySelector('.mb-next'),
             link: !!el.querySelector('a[href="market-brief.html"]'), points: el.querySelectorAll('.mb-card-points li').length };
  });
  ok('card shows on the dashboard', !r.hidden);
  ok('card shows the headline', r.text.indexOf(BRIEF.headline) !== -1);
  ok('card shows the next release', r.next);
  ok('card is trimmed to two points', r.points === 2, r.points + '');
  ok('card links to the full brief', r.link);
  await p.close();

  // --- 5. stale card hides the next-release chip ---
  p = await open(b, BASE + '/dashboard-user.html', stale());
  r = await p.evaluate(() => {
    const el = document.getElementById('dash-brief');
    return { stale: !!el.querySelector('.mb-stale'), next: !!el.querySelector('.mb-next') };
  });
  ok('stale card warns', r.stale);
  ok('stale card hides the next release', !r.next);
  await p.close();

  // --- 6. a missing brief must not break the dashboard ---
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(stub);
  await page.route(/market-brief\.json/, r2 => r2.fulfill({ status: 404, body: 'nope' }));
  await page.route(/^https?:\/\/(?!localhost)/, r2 => r2.abort());
  await page.goto(BASE + '/dashboard-user.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  r = await page.evaluate(() => ({ hidden: document.getElementById('dash-brief').hidden,
                                   dash: !!document.querySelector('.dash-topbar') }));
  ok('missing brief hides the card silently', r.hidden);
  ok('rest of the dashboard still renders', r.dash);
  await page.close();

  // --- 7. escaping: the renderer must not trust its own data file ---
  p = await open(b, BASE + '/market-brief.html',
    fresh({ headline: '<img src=x onerror="window.__PWNED=true">', watchOut: '<script>window.__PWNED=true<\/script>' }));
  await p.waitForTimeout(300);
  // Escaped text still CONTAINS the substring "onerror=" (as onerror=&quot;),
  // so searching innerHTML for it is a false positive. What matters is whether
  // a live element was created and whether anything ran.
  const probe = await p.evaluate(() => ({
    pwned: window.__PWNED === true,
    liveImg: !!document.querySelector('#mb-page img'),
    liveScript: !!document.querySelector('#mb-page script'),
    shownAsText: document.getElementById('mb-page').textContent.indexOf('<img src=x') !== -1
  }));
  ok('no payload executed', !probe.pwned);
  ok('no live element created from the data file', !probe.liveImg && !probe.liveScript);
  ok('markup is shown as text instead', probe.shownAsText, JSON.stringify(probe));
  await p.close();

  log.forEach(l => console.log(l));
  const fails = log.filter(l => l.startsWith('FAIL')).length;
  console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
  await b.close();
  process.exit(fails ? 1 : 0);
})();
