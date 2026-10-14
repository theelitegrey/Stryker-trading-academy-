// Economic calendar page with InsightSentry rows (assets/econ-calendar.js + econ-calendar-is.js).
// /cal is answered from fixtures; econ-calendar.json is the real file (fallback + notes).
//   STRYKER_TEST_BASE=http://127.0.0.1:8071 flock -w 900 /tmp/stryker-chrome.lock node --max-old-space-size=768 tools/tests/econ-calendar-is-browser.js <shotsDir>
// Checks: IS rows replace the file's; importance + country filters; actual/forecast/previous;
// countdown to the next HIGH-impact release; IST / New York / local time toggle; Earnings,
// Dividends, IPOs tabs; FALLBACK to the file when /cal fails; 390 phone layout, no overflow.
const { launch } = require('./lib.js');
const BASE = process.env.STRYKER_TEST_BASE || 'http://127.0.0.1:8071';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x !== undefined && !ok ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

const now = Date.now();
const H = 3600000;
const ev = (h, i, c, cur, ti, x) => Object.assign({ t: Math.round((now + h * H) / 60000) * 60000, c, cur, i, ti, ty: ti }, x || {});
const EVENTS = [
  ev(-5, 'high', 'US', 'USD', 'Inflation Rate YoY', { a: 3.7, f: 3.6, p: 3.4, u: '%' }),
  ev(2.5, 'medium', 'US', 'USD', 'Retail Sales MoM', { f: 0.3, p: 1.2, u: '%' }),
  ev(3, 'high', 'US', 'USD', 'Fed Interest Rate Decision', { f: 4, p: 4, u: '%' }),
  ev(4, 'low', 'US', 'USD', 'Redbook YoY', { p: 5.1, u: '%' }),
  ev(5, 'high', 'EU', 'EUR', 'ECB Interest Rate Decision', { f: 2.15, p: 2.15, u: '%' }),
  ev(30, 'high', 'GB', 'GBP', 'BoE Interest Rate Decision', { f: 3.5, u: '%' })
];
for (let i = 0; i < 25; i++) EVENTS.push(ev(40 + i, 'low', 'JP', 'JPY', 'Filler ' + i));
const CORP = {
  earnings: [{ code: 'NYSE:BAC', n: 'Bank of America', c: 'US', t: now + 6 * H, done: 0, epsF: 0.9, revF: 26e9 }, { code: 'NYSE:UNH', n: 'UnitedHealth Group', c: 'US', t: now - 30 * H, done: 1, eps: 4.69, epsF: 4.13, rev: 112e9, revF: 111e9 }, { code: 'TSE:7203', n: 'Toyota Motor', c: 'JAPAN', t: now + 8 * H, done: 0, epsF: 1.2 }],
  dividends: [{ code: 'NASDAQ:MSFT', n: 'Microsoft', c: 'US', t: now + 20 * H, amt: 0.83, pay: now + 60 * H, y: 0.7 }],
  ipos: [{ code: 'NASDAQ:NEWC', n: 'NewCo Inc', c: 'US', t: now + 10 * H, x: 'NASDAQ', st: 'Expected', px: 18 }]
};
let failCal = false;

async function open(b, w, h, opts) {
  const o = opts || {};
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, timezoneId: o.tz || 'Asia/Kolkata' });
  await ctx.addInitScript(`(${function () {
    const snap = (d) => ({ exists: !!d, data: () => d || {} });
    const docRef = () => ({ get: () => Promise.resolve(snap(null)), set: () => Promise.resolve(), collection: () => colRef() });
    const colRef = () => ({ doc: docRef, get: () => Promise.resolve({ empty: true, size: 0, forEach: () => {} }), where: () => colRef(), orderBy: () => colRef(), limit: () => colRef(), onSnapshot: () => () => {} });
    window.db = { collection: colRef };
    window.auth = { currentUser: { uid: 'u1' }, onAuthStateChanged: (cb) => { setTimeout(() => cb({ uid: 'u1' }), 10); return () => {}; }, setPersistence: () => Promise.resolve() };
    window.firebase = { apps: [], initializeApp: () => ({}), app: () => ({ functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }) }),
      firestore: Object.assign(() => window.db, { FieldValue: { serverTimestamp: () => 'TS', increment: (n) => ({ inc: n }), delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' } }),
      auth: Object.assign(() => window.auth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } } }), messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} }) };
    window.showToast = () => Promise.resolve();
  }})()`);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/cal/, (r) => {
    const u = new URL(r.request().url()), kind = u.searchParams.get('kind');
    if (failCal) return r.fulfill({ status: 503, body: 'down' });
    const items = kind === 'events' ? EVENTS : CORP[kind] || [];
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ kind, items, updated: now, from: '2026-10-14', to: '2026-11-13' }) });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|ERR_BLOCKED|net::|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE + '/economic-calendar.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.ec-row, .ec-empty, .ec-stale', { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1200);
  return { ctx, p, errs };
}
const names = (p) => p.evaluate(() => [...document.querySelectorAll('.ec-row .ec-name-v')].map((x) => x.textContent));

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    {
      const { ctx, p, errs } = await open(b, 1440, 900);
      await p.click('.ec-chip[data-range="all"]');
      await p.click('.ec-chip[data-imp="low"]');
      await p.click('.ec-chip[data-cur="ALL"]');
      let n = await names(p);
      check(n.includes('Fed Interest Rate Decision') && n.includes('Inflation Rate YoY') && n.includes('BoE Interest Rate Decision'), 'IS rows are on the page', n.slice(0, 5));
      check(!n.some((x) => /Bank of America Q3 earnings/.test(x)), 'file rows are replaced by the IS rows');
      // importance filter
      await p.click('.ec-chip[data-imp="high"]');
      n = await names(p);
      check(n.length === 4 && !n.includes('Retail Sales MoM') && !n.includes('Redbook YoY'), 'High-only filter', n);
      await p.click('.ec-chip[data-imp="medium"]');
      n = await names(p);
      check(n.includes('Retail Sales MoM') && !n.includes('Redbook YoY'), 'Medium and up filter', n);
      // country (currency) filter
      await p.click('.ec-chip[data-cur="EUR"]');
      n = await names(p);
      check(n.length === 1 && n[0] === 'ECB Interest Rate Decision', 'country filter EUR', n);
      await p.click('.ec-chip[data-cur="USD"]');
      // actual / forecast / previous
      const nums = await p.evaluate(() => { const r = [...document.querySelectorAll('.ec-row')].find((x) => /Inflation Rate YoY/.test(x.textContent)); return r ? [...r.querySelectorAll('.ec-num')].map((x) => x.textContent) : null; });
      check(nums && nums[0] === '3.7%' && nums[1] === '3.6%' && nums[2] === '3.4%', 'actual / forecast / previous shown', nums);
      check(await p.evaluate(() => !!document.querySelector('.ec-actual.is-above')), 'actual above forecast is marked');
      // countdown to the next HIGH event
      const nx = await p.evaluate(() => ({ k: document.querySelector('.ec-next .ec-kicker').textContent, h: document.querySelector('.ec-next h2').textContent, cd: document.querySelector('#ec-countdown').textContent }));
      check(/high-impact/.test(nx.k) && nx.h === 'Fed Interest Rate Decision' && /^\d+h \d\dm \d\ds$/.test(nx.cd), 'countdown targets the next high-impact event', nx);
      // time zones: the Fed row at now+3h
      const target = EVENTS.find((e) => e.ti === 'Fed Interest Rate Decision').t;
      const want = (tz) => new Date(target).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
      const time = () => p.evaluate(() => { const r = [...document.querySelectorAll('.ec-row')].find((x) => /Fed Interest Rate Decision/.test(x.textContent)); return r.querySelector('.ec-time-v').textContent; });
      check((await time()) === want('Asia/Kolkata'), 'default = the visitor\'s own clock (browser tz Kolkata)', await time());
      await p.click('.ec-chip[data-tz="ny"]');
      check((await time()) === want('America/New_York'), 'New York toggle', [await time(), want('America/New_York')]);
      await p.click('.ec-chip[data-tz="ist"]');
      check((await time()) === want('Asia/Kolkata') && /IST/.test(await p.evaluate(() => document.querySelector('.ec-next-at').textContent)), 'IST toggle labels IST');
      await p.screenshot({ path: OUT + '/cal-1440.png' });
      console.log('screenshot', OUT + '/cal-1440.png');
      // tabs
      for (const [tab, text, scope] of [['earnings', 'Bank of America', 'us'], ['dividends', 'Microsoft', 'us'], ['ipos', 'NewCo', 'us']]) {
        await p.click('.ec-tab[data-tab="' + tab + '"]');
        await p.waitForSelector('.ec-row', { timeout: 5000 }).catch(() => {});
        const t = await p.evaluate(() => document.querySelector('#ec-days').textContent);
        check(t.includes(text), tab + ' tab lists ' + text, t.slice(0, 120));
      }
      await p.click('.ec-tab[data-tab="earnings"]');
      let t = await p.evaluate(() => document.querySelector('#ec-days').textContent);
      check(!/Toyota/.test(t), 'earnings: US scope hides Toyota');
      await p.click('.ec-chip[data-scope="all"]');
      t = await p.evaluate(() => document.querySelector('#ec-days').textContent);
      check(/Toyota/.test(t), 'earnings: All markets shows Toyota');
      await p.click('.ec-chip[data-crange="past"]');
      t = await p.evaluate(() => document.querySelector('#ec-days').textContent);
      check(/UnitedHealth/.test(t) && !/Bank of America/.test(t) && /4\.69/.test(t), 'earnings: past week shows reported EPS', t.slice(0, 160));
      const hdr = await p.evaluate(() => { const th = [...document.querySelectorAll('.ec-corp thead th')], td = [...document.querySelectorAll('.ec-corp tbody tr:first-child td')]; return th.map((h, i) => Math.abs((h.getBoundingClientRect().right) - (td[i].getBoundingClientRect().right)) < 2 || Math.abs(h.getBoundingClientRect().left - td[i].getBoundingClientRect().left) < 2); });
      check(hdr.length >= 5 && hdr.every(Boolean), 'earnings: headers line up with the values', hdr);
      const nm = await p.evaluate(() => document.querySelector('.ec-corp .ec-name-v').textContent);
      check(/UnitedHealth Group/.test(nm) && (await p.evaluate(() => { const e = document.querySelector('.ec-corp .ec-name-v'); return e.scrollWidth <= e.clientWidth + 1; })), 'earnings: full company name visible', nm);
      await p.screenshot({ path: OUT + '/cal-1440-earnings.png' });
      console.log('screenshot', OUT + '/cal-1440-earnings.png');
      check(errs.length === 0, '1440: no console errors', errs);
      await ctx.close();
    }
    {   // fallback: /cal down -> the file renders as before
      failCal = true;
      const { ctx, p, errs } = await open(b, 1440, 900);
      const n = await p.evaluate(() => document.querySelectorAll('.ec-row, .ec-empty, .ec-stale').length);
      const tabs = await p.evaluate(() => !!document.querySelector('.ec-tab'));
      check(n > 0 && tabs, 'fallback: /cal down, the page still renders from econ-calendar.json', { n, tabs });
      await p.click('.ec-chip[data-range="all"]').catch(() => {});
      const hasFile = await p.evaluate(() => /Euro area|Bank of America|HICP|Fed/.test(document.querySelector('#ec-page').textContent));
      check(hasFile, 'fallback: file rows shown');
      check(errs.length === 0, 'fallback: no console errors', errs);
      await ctx.close();
      failCal = false;
    }
    {
      const { ctx, p, errs } = await open(b, 390, 844);
      const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, tabs: !!document.querySelector('.ec-tab'), rows: document.querySelectorAll('.ec-row').length }));
      check(m.sw <= 391 && m.tabs && m.rows > 0, '390: no horizontal scroll, tabs + rows present', m);
      await p.screenshot({ path: OUT + '/cal-390.png' });
      console.log('screenshot', OUT + '/cal-390.png');
      await p.click('.ec-tab[data-tab="dividends"]');
      await p.waitForSelector('.ec-row', { timeout: 5000 }).catch(() => {});
      const m2 = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, rows: document.querySelectorAll('.ec-row').length }));
      check(m2.sw <= 391 && m2.rows > 0, '390: dividends tab fits', m2);
      check(errs.length === 0, '390: no console errors', errs);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
