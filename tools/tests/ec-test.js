const { chromium, ROOT, BASE, launch } = require('./lib.js');
const fs = require('fs');

const CAL = JSON.parse(fs.readFileSync(ROOT + '/assets/econ-calendar.json', 'utf8'));

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

// Re-base the shipped calendar onto "now" so the fixture never rots: the same
// relative shape of past and future events regardless of when the suite runs.
function rebased(extra) {
  // Anchor on the file's own generatedAt rather than a date typed here: a
  // hardcoded anchor silently stops matching the shipped data the first time
  // the calendar's window moves, and every past/future assertion below then
  // tests a fixture nobody meant to build.
  const anchor = Date.parse(CAL.generatedAt);
  const shift = Date.now() - anchor;
  const c = JSON.parse(JSON.stringify(CAL));
  c.generatedAt = new Date(Date.now() - 3600e3).toISOString();
  c.events.forEach(e => { e.at = new Date(Date.parse(e.at) + shift).toISOString(); });
  return Object.assign(c, extra || {});
}

async function open(b, url, override, viewport, opts) {
  const o = opts || {};
  const page = await b.newPage(Object.assign(
    { viewport: viewport || { width: 1280, height: 950 } },
    o.reducedMotion ? { reducedMotion: 'reduce' } : {}));
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_FAILED|ERR_BLOCKED|net::/.test(m.text())) return;   // our own aborts
    errs.push('console: ' + m.text());
  });
  await page.addInitScript(stub);
  if (o.theme) await page.addInitScript(`try{localStorage.setItem('stryker_theme','${o.theme}')}catch(e){}`);
  if (override) await page.route(/econ-calendar\.json/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(override) }));
  await page.route(/^https?:\/\/(?!localhost)/, r => r.abort());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1100);
  page.__errs = errs;
  return page;
}

(async () => {
  const b = await launch();
  const log = []; const ok = (l, c, x) => log.push((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '   ' + x : ''));
  const IMP = ['high', 'medium', 'low', 'holiday'];

  // ---- 1. the shipped file --------------------------------------------
  ok('has events', CAL.events.length > 25, CAL.events.length + '');
  ok('every event has a UTC timestamp', CAL.events.every(e => /Z$/.test(e.at) && isFinite(Date.parse(e.at))));
  ok('NO event carries a local or named timezone', !/\d\d:\d\d\s?(ET|EST|EDT|GMT|BST)/.test(JSON.stringify(CAL.events)));
  ok('every event has a currency and an impact', CAL.events.every(e => e.cur && IMP.indexOf(e.impact) >= 0));
  ok('every currency used is declared', CAL.events.every(e =>
     CAL.currencies.some(c => c.code === e.cur)),
     CAL.events.filter(e => !CAL.currencies.some(c => c.code === e.cur)).map(e => e.cur).join(','));
  ok('events are stored in time order', CAL.events.every((e, i, a) => i === 0 || Date.parse(e.at) >= Date.parse(a[i-1].at)));
  ok('default currency is USD', CAL.defaultCurrency === 'USD');
  ok('high-impact events carry a note explaining why', 
     CAL.events.filter(e => e.impact === 'high' && !e.kind).every(e => e.note || e.event === 'FOMC press conference' || /press conference|meeting begins/i.test(e.event)),
     CAL.events.filter(e => e.impact === 'high' && !e.note && !e.kind).map(e => e.event).join(' | '));
  ok('no event claims an actual it does not have', CAL.events.every(e =>
     e.actual === undefined || String(e.actual).length > 0));
  ok('policy rates are listed', (CAL.banks || []).length >= 4);
  ok('every policy card leads with an actual rate',
     (CAL.banks || []).every(b => b.rate && !/^[—–-]$/.test(b.rate)),
     (CAL.banks || []).filter(b => !b.rate || /^[—–-]$/.test(b.rate)).map(b => b.cur).join(','));
  ok('every policy card names its bank and what is priced',
     (CAL.banks || []).every(b => b.bank && b.expect));
  ok('attribution names Bigdata.com with a link', /Bigdata\.com/.test(CAL.attribution) && /https:\/\/bigdata\.com/.test(CAL.attribution));
  ok('disclaimer says it is not advice', /not trading advice/i.test(CAL.disclaimer));

  // ---- 2. the page renders, defaulting to USD --------------------------
  let p = await open(b, BASE + '/economic-calendar.html', rebased());
  let r = await p.evaluate(() => {
    const el = document.getElementById('ec-page');
    const rows = Array.from(el.querySelectorAll('.ec-row'));
    return {
      rows: rows.length,
      currencies: Array.from(new Set(rows.map(t => t.querySelector('.ec-code').textContent))),
      days: el.querySelectorAll('.ec-day').length,
      chips: el.querySelectorAll('.ec-chip[data-cur]').length,
      onChip: (el.querySelector('.ec-chip[data-cur].is-on') || {}).textContent,
      next: !!el.querySelector('.ec-next'),
      banks: el.querySelectorAll('.ec-bank').length,
      how: el.querySelectorAll('.ec-how li').length,
      caption: el.querySelectorAll('.ec-table caption').length,
      text: el.textContent
    };
  });
  ok('no page errors', p.__errs.length === 0, p.__errs.join(' | '));
  ok('defaults to USD only', r.currencies.length === 1 && r.currencies[0] === 'USD', r.currencies.join(','));

  const first = r;   // the default-view snapshot, before any chip is clicked

  // ---- 2b. THE DEFAULT VIEW: today onwards, nothing behind ---------------
  const REB = rebased();
  const todayLocal = new Date().toLocaleDateString('en-CA');
  const dayOf = (iso) => new Date(Date.parse(iso)).toLocaleDateString('en-CA');
  const usdAhead = REB.events.filter(e => e.cur === 'USD' && dayOf(e.at) >= todayLocal).length;
  const usdPast  = REB.events.filter(e => e.cur === 'USD' && dayOf(e.at) < todayLocal).length;
  ok('the fixture actually has past events to hide', usdPast > 0, usdPast + ' behind today');
  ok('default range is From today', await p.evaluate(() => window.__EC.getRange()) === 'ahead');
  ok('default view hides everything before today', r.rows === usdAhead, r.rows + ' of ' + usdAhead);
  ok('no rendered day is earlier than today', await p.evaluate(() => {
       const t = new Date().toLocaleDateString('en-CA');
       return Array.from(document.querySelectorAll('.ec-row')).every(tr =>
         new Date(Date.parse(tr.getAttribute('data-at'))).toLocaleDateString('en-CA') >= t);
     }));
  ok('the range chips are all offered', await p.evaluate(() =>
       Array.from(document.querySelectorAll('.ec-chip[data-range]')).map(b => b.getAttribute('data-range')).join(',')
     ) === 'ahead,today,past,week,next,month,nmonth,all');
  ok('exactly one range chip is selected', await p.evaluate(() =>
       document.querySelectorAll('.ec-chip[data-range].is-on').length) === 1);

  // Widen to Everything so the original whole-file counts still mean something.
  await p.click('.ec-chip[data-range="all"]');
  await p.waitForTimeout(400);
  r = await p.evaluate(() => {
    const el = document.getElementById('ec-page');
    const rows = Array.from(el.querySelectorAll('.ec-row'));
    return { rows: rows.length, days: el.querySelectorAll('.ec-day').length,
             caption: el.querySelectorAll('.ec-table caption').length };
  });
  const usdCount = CAL.events.filter(e => e.cur === 'USD').length;
  ok('Everything shows every USD event', r.rows === usdCount, r.rows + ' of ' + usdCount);
  ok('USD chip is the selected one', /USD/.test(first.onChip || ''), first.onChip);
  ok('renders the next-release card', first.next);
  ok('groups into days', r.days >= 4, r.days + ' days');
  ok('renders the policy rates', await p.evaluate(() => document.querySelectorAll('.ec-bank').length) === CAL.banks.length);
  ok('renders the how-to-read notes', await p.evaluate(() => document.querySelectorAll('.ec-how li').length) === CAL.howToRead.length);
  ok('every table has a caption for screen readers', r.caption === r.days);
  ok('credits the data source', /Bigdata\.com/.test(first.text));

  // ---- 3. impact is never colour alone ---------------------------------
  const imp = await p.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.ec-impact'));
    return {
      total: cells.length,
      withWord: cells.filter(c => c.querySelector('.ec-imp-word') && c.querySelector('.ec-imp-word').textContent.trim()).length,
      withLabel: cells.filter(c => c.getAttribute('aria-label') || c.querySelector('.ec-imp-word')).length,
      barCounts: Array.from(new Set(cells.map(c => c.querySelectorAll('.ec-bar.on').length)))
    };
  });
  ok('every impact badge prints its level as a word', imp.withWord === imp.total, imp.withWord + '/' + imp.total);
  ok('every impact badge is labelled for assistive tech', imp.withLabel === imp.total);
  ok('impact also encoded as a bar count', imp.barCounts.every(n => n >= 0 && n <= 3), imp.barCounts.join(','));

  // ---- 4. the currency filter is a real filter -------------------------
  await p.click('.ec-chip[data-cur="EUR"]');
  await p.waitForTimeout(400);
  let f = await p.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.ec-row'));
    return { n: rows.length,
             curs: Array.from(new Set(rows.map(t => t.querySelector('.ec-code').textContent))),
             on: document.querySelectorAll('.ec-chip[data-cur].is-on').length,
             next: (document.querySelector('.ec-next .ec-code') || {}).textContent };
  });
  ok('switching to EUR shows only EUR', f.curs.length === 1 && f.curs[0] === 'EUR', f.curs.join(','));
  ok('EUR row count matches the data', f.n === CAL.events.filter(e => e.cur === 'EUR').length, f.n + '');
  ok('exactly one currency chip stays selected', f.on === 1);
  ok('the next-release card follows the filter', f.next === 'EUR', f.next);

  await p.click('.ec-chip[data-cur="ALL"]');
  await p.waitForTimeout(400);
  f = await p.evaluate(() => document.querySelectorAll('.ec-row').length);
  ok('All shows every event', f === CAL.events.length, f + ' of ' + CAL.events.length);

  // ---- 5. the impact floor --------------------------------------------
  await p.click('.ec-chip[data-imp="high"]');
  await p.waitForTimeout(400);
  f = await p.evaluate(() => Array.from(document.querySelectorAll('.ec-row'))
    .map(t => Array.from(t.classList).find(c => /^is-(high|medium|low|holiday)$/.test(c))));
  ok('High only shows nothing below high, holidays aside',
     f.every(c => c === 'is-high' || c === 'is-holiday'), Array.from(new Set(f)).join(','));
  ok('High only count matches the data',
     f.length === CAL.events.filter(e => e.impact === 'high' || e.impact === 'holiday').length, f.length + '');
  ok('a market holiday survives every impact floor',
     f.filter(c => c === 'is-holiday').length === CAL.events.filter(e => e.impact === 'holiday').length,
     'a closed market is never filtered out as low impact');

  await p.click('.ec-chip[data-imp="low"]');
  await p.waitForTimeout(300);

  // ---- 5b. every range preset, checked against its own boundaries ------
  await p.click('.ec-chip[data-cur="ALL"]');
  await p.click('.ec-chip[data-imp="low"]');
  await p.waitForTimeout(400);

  const dayStr = (iso) => new Date(Date.parse(iso)).toLocaleDateString('en-CA');
  const shiftDay = (k, n) => { const d = new Date(k + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const monday = (k) => shiftDay(k, -((new Date(k + 'T12:00:00Z').getUTCDay() + 6) % 7));
  const T = new Date().toLocaleDateString('en-CA');
  const monthOf = (k, n) => { const d = new Date(k + 'T12:00:00Z'); d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n); const from = d.toISOString().slice(0,10);
    d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
    return [from, d.toISOString().slice(0,10)]; };

  const expected = {
    ahead:  [T, null],
    today:  [T, T],
    past:   [shiftDay(T, -6), T],
    week:   [monday(T), shiftDay(monday(T), 6)],
    next:   [shiftDay(monday(T), 7), shiftDay(monday(T), 13)],
    month:  monthOf(T, 0),
    nmonth: monthOf(T, 1),
    all:    [null, null]
  };

  for (const key of Object.keys(expected)) {
    const [from, to] = expected[key];
    await p.click('.ec-chip[data-range="' + key + '"]');
    await p.waitForTimeout(320);
    const got = await p.evaluate(() => ({
      days: Array.from(document.querySelectorAll('.ec-row')).map(tr => tr.getAttribute('data-at')),
      chipOn: (document.querySelector('.ec-chip[data-range].is-on') || {}).getAttribute
              ? document.querySelector('.ec-chip[data-range].is-on').getAttribute('data-range') : null,
      onCount: document.querySelectorAll('.ec-chip[data-range].is-on').length,
      empty: !!document.querySelector('.ec-empty')
    }));
    const want = REB.events.filter(e => {
      const k = dayStr(e.at);
      return (!from || k >= from) && (!to || k <= to);
    }).length;

    ok(key + ': selects itself and only itself', got.chipOn === key && got.onCount === 1, got.chipOn);
    ok(key + ': row count matches the window', got.days.length === want, got.days.length + ' of ' + want);
    ok(key + ': no row falls outside ' + (from || '-inf') + '..' + (to || '+inf'),
       got.days.every(a => { const k = dayStr(a); return (!from || k >= from) && (!to || k <= to); }),
       got.days.map(dayStr).filter(k => (from && k < from) || (to && k > to)).join(','));
    if (want === 0) ok(key + ': an empty window explains itself', got.empty);
  }

  // The boundary days themselves must be inside, not one off.
  await p.click('.ec-chip[data-range="today"]');
  await p.waitForTimeout(320);
  const todayOnly = await p.evaluate(() => {
    const t = new Date().toLocaleDateString('en-CA');
    return Array.from(document.querySelectorAll('.ec-row'))
      .map(tr => new Date(Date.parse(tr.getAttribute('data-at'))).toLocaleDateString('en-CA'))
      .every(k => k === t);
  });
  ok('Today is inclusive of today and nothing else', todayOnly);

  await p.click('.ec-chip[data-range="past"]');
  await p.waitForTimeout(320);
  const pastInc = await p.evaluate(() => {
    const t = new Date().toLocaleDateString('en-CA');
    return Array.from(document.querySelectorAll('.ec-row'))
      .map(tr => new Date(Date.parse(tr.getAttribute('data-at'))).toLocaleDateString('en-CA'))
      .some(k => k === t);
  });
  ok('Past week includes today, not just the days behind it', pastInc);

  // This week and next week must not overlap by a single day.
  const wk = async (k) => { await p.click('.ec-chip[data-range="' + k + '"]');
    await p.waitForTimeout(300);
    return p.evaluate(() => Array.from(document.querySelectorAll('.ec-row'))
      .map(tr => new Date(Date.parse(tr.getAttribute('data-at'))).toLocaleDateString('en-CA'))); };
  const thisW = await wk('week'), nextW = await wk('next');
  ok('this week and next week share no day',
     !thisW.some(d => nextW.indexOf(d) !== -1),
     thisW.filter(d => nextW.indexOf(d) !== -1).join(','));

  // Range chip counts have to be honest about what clicking will produce.
  await p.click('.ec-chip[data-range="all"]');
  await p.waitForTimeout(320);
  const claims = await p.evaluate(() => Array.from(document.querySelectorAll('.ec-chip[data-range]'))
    .map(b => ({ k: b.getAttribute('data-range'), n: parseInt(b.querySelector('.ec-chip-n').textContent, 10) })));
  let mismatched = [];
  for (const c of claims) {
    await p.click('.ec-chip[data-range="' + c.k + '"]');
    await p.waitForTimeout(280);
    const actual = await p.evaluate(() => document.querySelectorAll('.ec-row').length);
    if (actual !== c.n) mismatched.push(c.k + ': said ' + c.n + ', showed ' + actual);
  }
  ok('every range chip count matches what it actually shows', mismatched.length === 0, mismatched.join(' | '));

  // The same promise for the currency and impact rows: a badge is a claim
  // about what clicking will produce, with every OTHER choice held fixed.
  for (const [attr, sel] of [['data-cur', '.ec-chip[data-cur]'], ['data-imp', '.ec-chip[data-imp]']]) {
    await p.click('.ec-chip[data-range="all"]');
    await p.waitForTimeout(260);
    const promises = await p.evaluate((s2) => Array.from(document.querySelectorAll(s2))
      .filter(b => b.querySelector('.ec-chip-n'))
      .map(b => ({ v: b.getAttribute(s2.indexOf('cur') > 0 ? 'data-cur' : 'data-imp'),
                   n: parseInt(b.querySelector('.ec-chip-n').textContent, 10) })), sel);
    const bad = [];
    for (const c of promises) {
      await p.click(sel.replace(']', '="' + c.v + '"]'));
      await p.waitForTimeout(240);
      const actual = await p.evaluate(() => document.querySelectorAll('.ec-row').length);
      if (actual !== c.n) bad.push(c.v + ': said ' + c.n + ', showed ' + actual);
    }
    ok(attr + ' chip counts match what they actually show', bad.length === 0, bad.join(' | '));
  }
  await p.click('.ec-chip[data-imp="low"]');
  await p.click('.ec-chip[data-cur="ALL"]');
  await p.waitForTimeout(260);

  // A currency with nothing upcoming SHOULD say so rather than inventing one.
  //
  // Which currency that is depends on the data, not on this file: the chips are
  // built from the events, so a currency named here can simply stop existing
  // the next time the calendar's window moves. Pick one at run time, and when
  // every currency has something ahead — which is the normal case early in a
  // week — assert the opposite instead, that the quiet state is not being shown
  // when it should not be. Either way the branch is covered by real data.
  const codes = await p.evaluate(() => Array.from(document.querySelectorAll('.ec-chip[data-cur]'))
    .map(c => c.getAttribute('data-cur')).filter(c => c && c !== 'ALL'));
  const calNow = rebased();
  const now = Date.now();
  const ahead = (cur) => calNow.events.some(e => e.cur === cur && Date.parse(e.at) > now);
  const quietPick = { quiet: codes.find(c => !ahead(c)) || null, busy: codes.find(ahead) || null };
  if (quietPick.quiet) {
    await p.click('.ec-chip[data-cur="' + quietPick.quiet + '"]');
    await p.waitForTimeout(320);
    ok('a currency with nothing ahead says so instead of guessing',
       await p.evaluate(() => {
         const h = document.querySelector('.ec-next');
         return !!h && h.classList.contains('is-quiet');
       }), quietPick.quiet);
  } else {
    await p.click('.ec-chip[data-cur="' + quietPick.busy + '"]');
    await p.waitForTimeout(320);
    ok('a currency with something ahead does not claim to be quiet',
       await p.evaluate(() => {
         const h = document.querySelector('.ec-next');
         return !!h && !h.classList.contains('is-quiet');
       }), 'no currency is quiet in this data; checked ' + quietPick.busy);
  }
  await p.click('.ec-chip[data-cur="ALL"]');
  await p.waitForTimeout(260);

  // The next-release card is about NOW, so browsing the past must not blank it.
  await p.click('.ec-chip[data-range="past"]');
  await p.waitForTimeout(350);
  const heroInPast = await p.evaluate(() => {
    const h = document.querySelector('.ec-next');
    return { present: !!h, quiet: h ? h.classList.contains('is-quiet') : true,
             at: h ? h.getAttribute('data-at') : null };
  });
  ok('browsing the past week still shows a real next release',
     heroInPast.present && !heroInPast.quiet && Date.parse(heroInPast.at) > Date.now(),
     JSON.stringify(heroInPast));

  await p.click('.ec-chip[data-range="ahead"]');
  await p.click('.ec-chip[data-cur="USD"]');
  await p.waitForTimeout(350);

  // ---- 6. times follow the timezone toggle ----------------------------
  const localTimes = await p.evaluate(() => Array.from(document.querySelectorAll('.ec-time-v')).map(t => t.textContent));
  await p.click('.ec-chip[data-tz="ny"]');
  await p.waitForTimeout(400);
  const nyTimes = await p.evaluate(() => ({
    times: Array.from(document.querySelectorAll('.ec-time-v')).map(t => t.textContent),
    zone: document.querySelector('.ec-next-at') ? document.querySelector('.ec-next-at').textContent : ''
  }));
  ok('the New York toggle actually changes the printed times',
     JSON.stringify(localTimes) !== JSON.stringify(nyTimes.times) || localTimes.length === 0,
     'container runs UTC, NY is UTC-4 — a change is expected');
  ok('the zone is named beside the time as a readable short name, not an IANA key',
     /\b(EDT|EST|New York)\b/.test(nyTimes.zone) && !/\//.test(nyTimes.zone), nyTimes.zone);
  await p.click('.ec-chip[data-tz="local"]');
  await p.waitForTimeout(300);

  // ---- 7. the "why it matters" disclosure -----------------------------
  const note = await p.evaluate(() => {
    const row = document.querySelector('.ec-row[data-note]');
    const before = { open: row.getAttribute('aria-expanded'), hidden: document.getElementById(row.getAttribute('data-note')).hidden };
    row.click();
    const after = { open: row.getAttribute('aria-expanded'), hidden: document.getElementById(row.getAttribute('data-note')).hidden,
                    text: document.getElementById(row.getAttribute('data-note')).textContent.trim().length };
    row.click();
    const closed = document.getElementById(row.getAttribute('data-note')).hidden;
    return { before, after, closed, controls: !!row.getAttribute('aria-controls') };
  });
  ok('notes start closed', note.before.hidden === true && note.before.open === 'false');
  ok('clicking a row opens its note', note.after.hidden === false && note.after.open === 'true');
  ok('the note has content', note.after.text > 20);
  ok('clicking again closes it', note.closed === true);
  ok('the row points at its note for assistive tech', note.controls);

  // ---- 8. keyboard reaches the notes ----------------------------------
  const kb = await p.evaluate(() => {
    const row = document.querySelector('.ec-row[data-note]');
    row.focus();
    const focused = document.activeElement === row;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const opened = !document.getElementById(row.getAttribute('data-note')).hidden;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return { focused, opened, closed: document.getElementById(row.getAttribute('data-note')).hidden };
  });
  ok('rows with notes are focusable', kb.focused);
  ok('Enter opens the note', kb.opened);
  ok('Enter closes it again', kb.closed);

  // ---- 9. the countdown is live and correct ---------------------------
  const pure = await p.evaluate(() => ({
    min: window.__EC.countdown(90 * 1000),
    hour: window.__EC.countdown(3 * 3600 * 1000 + 5000),
    day: window.__EC.countdown(50 * 3600 * 1000),
    past: window.__EC.countdown(-1)
  }));
  ok('countdown carries seconds at every scale so it visibly moves',
     /s$/.test(pure.min) && /s$/.test(pure.hour), JSON.stringify(pure));
  ok('countdown drops seconds only past a day', /m$/.test(pure.day), pure.day);
  ok('countdown returns null once the event has passed', pure.past === null);

  const cd1 = await p.evaluate(() => document.getElementById('ec-countdown').textContent);
  await p.waitForTimeout(2100);
  const cd2 = await p.evaluate(() => ({
    now: document.getElementById('ec-countdown').textContent,
    at: document.querySelector('.ec-next').getAttribute('data-at')
  }));
  ok('the countdown ticks on screen', cd1 !== cd2.now, cd1 + ' -> ' + cd2.now);
  ok('the countdown targets a future event', Date.parse(cd2.at) > Date.now());
  const nextExpect = rebased().events
    .filter(e => e.cur === 'USD' && Date.parse(e.at) > Date.now() && e.impact !== 'holiday')
    .sort((a, c) => (Date.parse(a.at) - Date.parse(c.at)) ||
                    ({high:0,medium:1,low:2}[a.impact] - {high:0,medium:1,low:2}[c.impact]))[0];
  await p.click('.ec-chip[data-cur="USD"]');
  await p.waitForTimeout(400);
  const nextShown = await p.evaluate(() => document.querySelector('.ec-next h2').textContent);
  ok('the next-release card names the genuinely next event',
     nextShown === nextExpect.event, nextShown + ' vs ' + nextExpect.event);

  // ---- 9b. a shared print time: the hero follows its own advice ---------
  //
  // The how-to-read card says "when you see the same time twice, read the
  // highest-impact row". The hero was picking whichever row came first in the
  // file, and on FOMC day that was import prices over retail sales. Fixture
  // order is medium THEN high, so a time-only sort fails this.
  {
    const soon = new Date(Date.now() + 3 * 3600e3).toISOString();
    const tie = Object.assign({}, CAL, { generatedAt: new Date().toISOString(),
      goodUntil: new Date(Date.now() + 86400e3).toISOString(),
      events: [
        { at: soon, cur: 'USD', impact: 'medium', event: 'Import prices (fixture)' },
        { at: soon, cur: 'USD', impact: 'high',   event: 'Retail sales (fixture)', note: 'x' },
        { at: new Date(Date.now() + 9 * 3600e3).toISOString(), cur: 'USD', impact: 'high', event: 'Later thing (fixture)', note: 'y' }
      ] });
    const q = await open(b, BASE + '/economic-calendar.html', tie);
    const r9 = await q.evaluate(() => ({
      hero: (document.querySelector('.ec-next h2') || {}).textContent,
      firstRow: (document.querySelector('.ec-day tbody tr .ec-ev, .ec-day tbody tr td:nth-child(4)') || {}).textContent
    }));
    ok('hero picks the highest-impact row at a shared print time',
       r9.hero === 'Retail sales (fixture)', r9.hero);
    await q.close();

    // And the dashboard strip, which shares the picker.
    const q2 = await open(b, BASE + '/dashboard-user.html', tie);
    const r9b = await q2.evaluate(() => {
      const el = document.getElementById('dash-econ') || document.querySelector('.ec-strip');
      return el ? el.textContent : '';
    });
    ok('dashboard strip headlines the same high-impact row', /Retail sales \(fixture\)/.test(r9b),
       r9b.slice(0, 120));
    await q2.close();
  }

  // ---- 10. motion ------------------------------------------------------
  const mo = await p.evaluate(() => {
    const rise = Array.from(document.querySelectorAll('.stk-rise'));
    const fold = window.innerHeight * 0.92;   // the observer's -8% rootMargin
    const onscreen = rise.filter(n => {
      const r = n.getBoundingClientRect();
      return r.top < fold && r.bottom > 0 && r.height > 0;
    });
    return {
      guard: document.documentElement.classList.contains('stk-motion'),
      lib: typeof window.stkMotion === 'object',
      risers: rise.length,
      onscreen: onscreen.length,
      onscreenHidden: onscreen.filter(n => !n.classList.contains('is-in')).length
    };
  });
  ok('motion.js set its guard class', mo.guard);
  ok('the motion library is present', mo.lib);
  ok('reveal targets exist', mo.risers > 0, mo.risers + '');
  ok('everything already on screen is revealed', mo.onscreenHidden === 0,
     mo.onscreenHidden + ' of ' + mo.onscreen + ' visible still hidden');

  // The failsafe: an observer that never fires must not be able to hide
  // content forever. Wait past the two-second backstop and check the tail.
  await p.waitForTimeout(2200);
  const failsafe = await p.evaluate(() => Array.from(document.querySelectorAll('.stk-rise'))
    .filter(n => !n.classList.contains('is-in')).length);
  ok('the failsafe reveals anything the observer missed', failsafe === 0, failsafe + ' still hidden');
  await p.close();

  // ---- 11. reduced motion shows everything, instantly ------------------
  p = await open(b, BASE + '/economic-calendar.html', rebased(), null, { reducedMotion: true });
  const rm = await p.evaluate(() => {
    const rise = Array.from(document.querySelectorAll('.stk-rise'));
    const anim = rise.filter(n => getComputedStyle(n).transitionDuration !== '0s').length;
    return {
      rows: document.querySelectorAll('.ec-row').length,
      invisible: rise.filter(n => parseFloat(getComputedStyle(n).opacity) < 1).length,
      animating: anim,
      pulse: getComputedStyle(document.querySelector('.ec-ring-pulse')).animationName
    };
  });
  ok('reduced motion still renders every row', rm.rows > 0, rm.rows + '');
  ok('reduced motion leaves nothing transparent', rm.invisible === 0, rm.invisible + '');
  ok('reduced motion removes the transitions', rm.animating === 0, rm.animating + ' still transitioning');
  ok('reduced motion stops the pulse', rm.pulse === 'none', rm.pulse);
  await p.close();

  // ---- 12. a missing file must not break the page ---------------------
  p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs12 = []; p.on('pageerror', e => errs12.push(e.message));
  await p.addInitScript(stub);
  await p.route(/econ-calendar\.json/, r => r.fulfill({ status: 404, body: 'no' }));
  await p.route(/^https?:\/\/(?!localhost)/, r => r.abort());
  await p.goto(BASE + '/economic-calendar.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(900);
  const miss = await p.evaluate(() => document.getElementById('ec-page').textContent);
  ok('a missing file shows a message, not a blank page', /could not be loaded/i.test(miss));
  ok('a missing file throws no uncaught error', errs12.length === 0, errs12.join(' | '));
  await p.close();

  // ---- 13. mobile ------------------------------------------------------
  p = await open(b, BASE + '/economic-calendar.html', rebased(), { width: 390, height: 844 });
  const m = await p.evaluate(() => ({
    doc: document.documentElement.scrollWidth, win: window.innerWidth,
    rows: document.querySelectorAll('.ec-row').length,
    scrollers: document.querySelectorAll('.ec-scroll').length
  }));
  ok('mobile: no horizontal page scroll', m.doc <= m.win + 1, m.doc + ' vs ' + m.win);
  ok('mobile: rows still render', m.rows > 0);
  ok('mobile: tables are in their own scrollers', m.scrollers > 0);
  await p.close();

  // ---- 14. the dashboard strip ----------------------------------------
  p = await open(b, BASE + '/dashboard-user.html', rebased());
  const dash = await p.evaluate(() => {
    const s = document.getElementById('dash-cal');
    return { present: !!s, hidden: s ? s.hidden : true,
             next: s ? !!s.querySelector('.ec-strip-next') : false,
             cd: s && s.querySelector('.ec-cd-v') ? s.querySelector('.ec-cd-v').textContent : '',
             link: s ? !!s.querySelector('a[href="economic-calendar.html"]') : false,
             roadmap: !!document.getElementById('dash-roadmap'),
             brief: !!document.querySelector('#dash-brief .mb-card'),
             map: !!document.querySelector('#dash-map .mm-strip') };
  });
  ok('dashboard mounts the calendar strip', dash.present && !dash.hidden && dash.next);
  ok('dashboard strip shows a live countdown', /\d/.test(dash.cd), dash.cd);
  ok('dashboard strip links to the calendar', dash.link);
  ok('the roadmap widget is gone from the dashboard', !dash.roadmap);
  ok('the brief card still renders', dash.brief);
  ok('the market map strip still renders', dash.map);
  ok('dashboard has no errors', p.__errs.length === 0, p.__errs.slice(0, 3).join(' | '));
  await p.close();

  // ---- 15. navigation --------------------------------------------------
  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
  const withNav = pages.filter(f => fs.readFileSync(ROOT + '/' + f, 'utf8').includes('href="market-brief.html" class="side-link'));
  const bad = [];
  withNav.forEach(f => {
    const s = fs.readFileSync(ROOT + '/' + f, 'utf8');
    const nav = s.slice(s.indexOf('<aside class="sidebar"'), s.indexOf('sidebar-foot'));
    const order = (nav.match(/side-label">([^<]+)|href="([a-z-]+\.html)"/g) || []);
    const idx = (needle) => order.findIndex(x => x.includes(needle));
    const terminal = idx('>Terminal'), community = idx('>Community');
    ['economic-calendar.html', 'market-brief.html', 'market-map.html'].forEach(h => {
      const i = idx('"' + h + '"');
      if (i < 0 || i < terminal || i > community) bad.push(f + ':' + h);
    });
    if (idx('"roadmap.html"') < community) bad.push(f + ':roadmap-too-early');
  });
  ok('the three terminal modules sit inside Terminal on every page', bad.length === 0, bad.slice(0, 4).join(' '));
  ok('roadmap stays out of Terminal', !bad.some(x => /roadmap/.test(x)));
  ok('every nav page links the calendar',
     withNav.every(f => fs.readFileSync(ROOT + '/' + f, 'utf8').includes('href="economic-calendar.html" class="side-link')),
     withNav.length + ' pages');
  ok('the calendar page marks its own link active',
     /href="economic-calendar\.html" class="side-link active"/.test(fs.readFileSync(ROOT + '/economic-calendar.html', 'utf8')));
  ok('roadmap.html still exists as a module', fs.existsSync(ROOT + '/roadmap.html'));
  ok('the dashboard no longer loads the roadmap scripts',
     !fs.readFileSync(ROOT + '/dashboard-user.html', 'utf8').includes('roadmap.js'));

  await b.close();
  console.log(log.join('\n'));
  const fails = log.filter(l => l.startsWith('FAIL')).length;
  console.log('\n' + (log.length - fails) + '/' + log.length + ' passed');
  process.exit(fails ? 1 : 0);
})();
