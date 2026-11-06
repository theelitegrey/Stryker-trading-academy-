// Zscript Script Library (script-library.html + moderation-admin.html Script Library panel), Firebase stubbed, no network.
// Run (server on STRYKER_TEST_PORT serving the repo root): node tools/zs-library/browser.test.js [shotDir]
// Who: ?who=bu (member) | au (author with payouts) | tz (admin). No real charges: the Buy call is captured, never sent.
const fs = require('fs');
const path = require('path');
const { launch, BASE } = require('../tests/lib.js');
const SHOTS = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const stub = '(' + function () {
  try { sessionStorage.setItem('stk_zs_preview', '1'); } catch (e) {}   // Zscript is hidden until launch (assets/zs-config.js): preview on
  const NOW = Date.now(), D = 864e5;
  const who = new URLSearchParams(location.search).get('who') || sessionStorage.getItem('who') || 'bu';
  try { sessionStorage.setItem('who', who); } catch (e) {}
  const ts = (ms) => ({ toDate: () => new Date(ms), toMillis: () => ms, seconds: Math.floor(ms / 1000) });
  const store = {};
  const put = (p, v) => { store[p] = v; };
  const SIDS = { a: 'A'.repeat(20), b: 'B'.repeat(20), c: 'C'.repeat(20), d: 'D'.repeat(20) };
  const sc = (o) => Object.assign({ authorUid: 'au', authorName: 'Ana Cruz', desc: '', category: 'trend', dataUsed: [], access: 'open', sale: { mode: 'free', price: { amount: 0, currency: 'USD' } },
    shots: [], version: 1, versionNotes: '', status: 'live', srcSize: 300, ratingSum: 0, ratingCount: 0, addCount: 0, modNote: '', createdAt: ts(NOW - 9 * D), updatedAt: ts(NOW - 2 * D), publishedAt: ts(NOW - 2 * D) }, o);
  put('admins/tz', {});
  put('profiles/bu', { displayName: 'Dev Patel' }); put('profiles/au', { displayName: 'Ana Cruz' });
  put('creatorAccounts/au', { status: 'active' });
  put('settings/commerce', { creatorPayments: true });
  put('zsScripts/' + SIDS.a, sc({ name: 'Sample: Delta Bands', desc: 'Sample script. Draws a band around price from bar delta.\n\nWider bands mean one side traded more on that bar.', category: 'order-flow', dataUsed: ['flow'], version: 3, ratingSum: 9, ratingCount: 2, addCount: 41 }));
  put('zsScripts/' + SIDS.a + '/versions/v1', { version: 1, notes: 'First version', createdAt: ts(NOW - 9 * D) });
  put('zsScripts/' + SIDS.a + '/versions/v2', { version: 2, notes: 'Smoother band edges', createdAt: ts(NOW - 5 * D) });
  put('zsScripts/' + SIDS.a + '/versions/v3', { version: 3, notes: 'Colour input added', createdAt: ts(NOW - 2 * D) });
  put('zsScripts/' + SIDS.a + '/src/v3', { version: 3, source: '//@zscript 1\nindicator("Sample: Delta Bands", overlay=true)\nd = flow.delta\nplot(ta.ema(close, 20) + d * 0.01)' });
  put('zsScripts/' + SIDS.a + '/ratings/u7', { uid: 'u7', stars: 5, text: 'Clear on the 5-minute chart.', authorName: 'Sam Lee', createdAt: ts(NOW - 3 * D), updatedAt: ts(NOW - 3 * D) });
  put('zsScripts/' + SIDS.a + '/ratings/u8', { uid: 'u8', stars: 4, text: '', authorName: 'Maya Rao', createdAt: ts(NOW - 1 * D), updatedAt: ts(NOW - 1 * D) });
  put('zsScripts/' + SIDS.b, sc({ name: 'Sample: Book Heat Levels', desc: 'Sample script. Marks price levels where resting size in the order book stands out.', category: 'levels', dataUsed: ['book'], access: 'protected', sale: { mode: 'paid', price: { amount: 19, currency: 'USD' } }, ratingSum: 5, ratingCount: 1, addCount: 7, publishedAt: ts(NOW - 1 * D), updatedAt: ts(NOW - 1 * D) }));
  put('zsScripts/' + SIDS.b + '/versions/v1', { version: 1, notes: 'First version', createdAt: ts(NOW - 1 * D) });
  put('zsScripts/' + SIDS.c, sc({ name: 'Sample: Gamma Walls', desc: 'Sample script. Draws the call wall and put wall as lines.', category: 'options', dataUsed: ['gex'], authorName: 'Sam Lee', authorUid: 'u7', publishedAt: ts(NOW - 6 * D), updatedAt: ts(NOW - 6 * D) }));
  put('zsScripts/' + SIDS.d, sc({ name: 'Sample: Copied Bands', status: 'removed', modNote: 'Copied code', authorName: 'Zed', authorUid: 'zz' }));
  put('zsReports/' + SIDS.c + '_bu', { sid: SIDS.c, reporterUid: 'bu', reason: 'broken', note: 'Lines never draw on NQ.', status: 'open', createdAt: ts(NOW) });
  put('zsReports/' + SIDS.c + '_u8', { sid: SIDS.c, reporterUid: 'u8', reason: 'copied', note: '', status: 'open', createdAt: ts(NOW) });
  window.__writes = []; window.__calls = []; window.__uploads = [];
  window.confirm = () => true; window.prompt = () => 'Copied code';
  const snapOf = (rows) => ({ size: rows.length, empty: !rows.length, docs: rows, forEach(f) { rows.forEach(f); } });
  const mk = (p) => ({ id: p.split('/').pop(), exists: p in store, data: () => store[p] || {}, ref: { id: p.split('/').pop() } });
  const keep = (k, o) => { try { const a = JSON.parse(sessionStorage.getItem(k) || '[]'); a.push(o); sessionStorage.setItem(k, JSON.stringify(a)); } catch (e) {} };
  const rec = (op, p, v) => { const o = { op, p, v: v && JSON.parse(JSON.stringify(v)) }; window.__writes.push(o); keep('__w', o); };
  function docRef(p) {
    return { id: p.split('/').pop(), path: p, get: () => Promise.resolve(mk(p)),
      set: (v) => { rec('set', p, v); store[p] = v; return Promise.resolve(); },
      update: (v) => { rec('update', p, v); store[p] = Object.assign({}, store[p], v); return Promise.resolve(); },
      delete: () => { rec('delete', p); delete store[p]; return Promise.resolve(); },
      onSnapshot: (cb) => { setTimeout(() => cb(mk(p)), 5); return () => {}; }, collection: (sub) => colRef(p + '/' + sub) };
  }
  let auto = 0;
  function colRef(p, filt) {
    filt = filt || [];
    const self = {
      doc: (id) => docRef(p + '/' + (id || ('Q' + String(++auto).padStart(19, '0')))),
      get: () => { const depth = p.split('/').length + 1; return Promise.resolve(snapOf(Object.keys(store).filter((k) => k.startsWith(p + '/') && k.split('/').length === depth && filt.every(([f, v]) => store[k][f] === v)).map(mk))); },
      add: (v) => { rec('add', p, v); return Promise.resolve({ id: 'new' }); },
      where: (f, op, v) => colRef(p, filt.concat([[f, v]])), orderBy: () => self, startAfter: () => self, limit: () => self,
      onSnapshot: (cb) => { setTimeout(() => cb(snapOf([])), 5); return () => {}; }
    };
    return self;
  }
  const batch = () => { const ops = []; return { set: (r, v) => ops.push(() => r.set(v)), update: (r, v) => ops.push(() => r.update(v)), delete: (r) => ops.push(() => r.delete()), commit: () => { window.__writes.push({ op: 'batch', n: ops.length }); keep('__w', { op: 'batch', n: ops.length }); ops.forEach((f) => f()); return Promise.resolve(); } }; };
  const names = { bu: 'Dev Patel', au: 'Ana Cruz', tz: 'Owner Admin' };
  const user = { uid: who, email: who + '@example.com', displayName: names[who], emailVerified: true, photoURL: null, getIdTokenResult: () => Promise.resolve({ claims: {} }), getIdToken: () => Promise.resolve('t') };
  const fns = { httpsCallable: (name) => (data) => { window.__calls.push({ name, data }); keep('__c', { name, data }); return Promise.resolve({ data: { url: location.origin + '/script-library.html?stripe=stub' } }); } };
  window.__stubDb = { collection: colRef, doc: (p) => docRef(String(p)), batch, runTransaction: (f) => f({ get: (r) => r.get(), set() {}, update() {} }) };
  window.db = window.__stubDb;
  window.__stubAuth = { currentUser: user, onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; }, onIdTokenChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; }, setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve() };
  const fsFn = Object.assign(() => window.__stubDb, { FieldValue: { serverTimestamp: () => ({ __ts: 'server' }), increment: (n) => ({ inc: n }), delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' }, Timestamp: { now: () => ts(NOW), fromDate: (d) => ts(+d), fromMillis: ts } });
  const storage = () => ({ ref: (p) => ({ put: (f) => { window.__uploads.push(p); return Promise.resolve(); }, getDownloadURL: () => Promise.resolve('https://firebasestorage.googleapis.com/v0/b/x/o/' + encodeURIComponent(p) + '?alt=media') }) });
  const fb = { apps: [{}], initializeApp: () => ({}), app: () => ({ functions: () => fns }), firestore: fsFn, storage, auth: Object.assign(() => window.__stubAuth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } } }), functions: () => fns, messaging: Object.assign(() => ({}), { isSupported: () => false }) };
  Object.defineProperty(window, 'firebase', { get: () => fb, set: () => {}, configurable: false });
  window.auth = window.__stubAuth;
  try { localStorage.setItem('stryker_nav_authed', '1'); localStorage.setItem('stryker_tour_done', '1'); localStorage.setItem('stryker_push_prompt_dismissed', String(Date.now())); localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true, analytics: false })); } catch (e) {}
}.toString() + ')()';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const A = 'A'.repeat(20), B = 'B'.repeat(20);
module.exports = { stub };   // tools/tests/zs-e2e-browser.js reuses the Firebase stub
if (require.main === module) (async () => {
  const browser = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  const runs = (process.env.ZS_RUNS ? JSON.parse(process.env.ZS_RUNS) : [['dark', 390, 844], ['dark', 412, 915], ['dark', 1440, 1000], ['light', 1440, 1000]]);
  for (const [theme, w, h] of runs) {
    const mob = w < 700, tag = w + '-' + theme, full = w === 390 || w === 1440 && theme === 'dark';
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mob ? 2 : 1, isMobile: mob, hasTouch: mob });
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
    await ctx.route(/\/api\/zs\/get/, (r) => r.fulfill({ status: 404, contentType: 'text/html', body: 'no functions' }));
    // the library page alone, without the engine (after integration the engine is on the site; protected publish WITH it is
    // covered by tools/tests/zs-e2e-browser.js)
    await ctx.route(/\/assets\/zs\/index\.js/, (r) => r.fulfill({ status: 404, body: '' }));
    await ctx.addInitScript(stub);
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
    await ctx.addInitScript(() => { const st = document.createElement('style'); st.textContent = '.tzc{display:none!important}'; document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st)); });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e.message || e)));
    const shot = (n) => page.screenshot({ path: path.join(SHOTS, 'S4-' + tag + '-' + n + '.png') });
    const noOverflow = async (n) => { const sw = await page.evaluate(() => document.documentElement.scrollWidth); ok(sw <= w, tag + ' ' + n + ' no sideways scroll (' + sw + ')'); };
    const writes = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('__w') || '[]'));
    const clear = () => page.evaluate(() => { window.__writes.length = 0; window.__calls.length = 0; sessionStorage.removeItem('__w'); sessionStorage.removeItem('__c'); });

    // ---- browse (member)
    await page.goto(BASE + '/script-library.html?who=bu', { waitUntil: 'load' });
    await page.waitForSelector('.zl-card', { timeout: 15000 });
    await page.waitForTimeout(300);
    ok(await page.locator('.zl-card').count() === 3, tag + ' list: 3 live scripts (taken-down one hidden)');
    const main = await page.evaluate(() => document.getElementById('main').innerText);
    ok(!/\$\s?\d/.test(main), tag + ' list: no prices on the library list');
    ok(!/ZoroScript|Pine|TradingView/i.test(main), tag + ' list: no wrong or rival names');
    ok(/Education only\. Not financial advice\./.test(main), tag + ' list: education line');
    await noOverflow('list');
    await shot('1-list');
    await page.fill('#zl-q', 'gamma'); await page.waitForTimeout(100);
    ok(await page.locator('.zl-card').count() === 1, tag + ' search: gamma -> 1');
    await page.fill('#zl-q', ''); await page.click('#zl-sale [data-v="paid"]'); await page.waitForTimeout(100);
    ok(await page.locator('.zl-card').count() === 1 && /Book Heat/.test(await page.textContent('.zl-card')), tag + ' filter: paid -> Book Heat');
    await page.click('#zl-sale [data-v="all"]'); await page.click('#zl-data [data-v="flow"]'); await page.waitForTimeout(100);
    ok(await page.locator('.zl-card').count() === 1 && /Delta Bands/.test(await page.textContent('.zl-card')), tag + ' filter: order flow data -> Delta Bands');
    await page.click('#zl-data [data-v=""]'); await page.click('#zl-cats [data-v="options"]'); await page.waitForTimeout(100);
    ok(await page.locator('.zl-card').count() === 1, tag + ' filter: category options -> 1');
    await page.click('#zl-cats [data-v=""]'); await page.selectOption('#zl-sort', 'added'); await page.waitForTimeout(100);
    ok(/Delta Bands/.test(await page.textContent('.zl-card')), tag + ' sort: most added first');

    // ---- free script page
    await page.click('.zl-card[data-sid="' + A + '"]');
    await page.waitForSelector('.zs-page', { timeout: 8000 }); await page.waitForTimeout(300);
    const p1 = await page.evaluate(() => document.getElementById('main').innerText);
    ok(/v3/.test(p1) && /Colour input added/.test(p1) && /Smoother band edges/.test(p1), tag + ' script page: version history');
    ok(/4\.5/.test(p1) && /Sam Lee/.test(p1) && /Clear on the 5-minute chart/.test(p1), tag + ' script page: real ratings + average');
    ok(/Order flow data/.test(p1) && /only the data your plan includes/.test(p1), tag + ' script page: data-used plan note');
    ok(await page.isVisible('#zs-add') && await page.isVisible('#zs-src'), tag + ' free open-source: Add to chart + View code');
    ok(!(await page.isVisible('#zs-rate')), tag + ' cannot rate before adding it');
    await noOverflow('script');
    await shot('2-script-free');
    if (full) { await page.screenshot({ path: path.join(SHOTS, 'S4-' + tag + '-2-script-free-full.png'), fullPage: true }); }
    await page.click('#zs-src'); await page.waitForSelector('.zs-pre');
    ok(/flow\.delta/.test(await page.textContent('.zs-pre')), tag + ' view code shows the current version');
    await shot('3-code-sheet');
    await page.keyboard.press('Escape');
    // report
    await clear();
    await page.click('#zs-rep'); await page.click('#zrr-go');
    ok(/reason/.test(await page.textContent('#zrr-err')), tag + ' report needs a reason');
    await page.check('input[name=zrr][value=broken]'); await page.fill('#zrr-n', 'Bands vanish on 1m.');
    await shot('4-report');
    await page.click('#zrr-go'); await page.waitForTimeout(200);
    let wr = await writes();
    ok(wr.length === 1 && wr[0].p === 'zsReports/' + A + '_bu' && wr[0].v.status === 'open' && wr[0].v.reason === 'broken', tag + ' report written as zsReports/{sid}_{uid}');
    // add to chart -> marker + count, then navigate to chart
    await clear();
    await Promise.all([page.waitForURL(/\/charts\?zs=/, { timeout: 8000 }).catch(() => null), page.click('#zs-add')]);
    wr = await writes();
    ok(wr.some((x) => x.p === 'zsScripts/' + A + '/adds/bu') && wr.some((x) => x.op === 'update' && x.v.addCount && x.v.addCount.inc === 1), tag + ' add: marker + addCount +1 in one batch');
    ok(/\/charts\?zs=A{20}/.test(page.url()), tag + ' add: opens the chart with ?zs=<sid>');

    // ---- paid script, member (not a buyer)
    await page.goto(BASE + '/script-library.html?who=bu&s=' + B, { waitUntil: 'load' });
    await page.waitForSelector('.zs-page', { timeout: 8000 }); await page.waitForTimeout(300);
    const p2 = await page.evaluate(() => document.getElementById('main').innerText);
    ok(/\$19/.test(p2) && await page.isVisible('#zs-buy'), tag + ' paid: price on the script page + Buy');
    ok(!(await page.isVisible('#zs-add')) && !(await page.isVisible('#zs-src')), tag + ' paid non-buyer: no Add, no code');
    ok(/Protected/.test(p2) && /independent creator/.test(p2) && /Stripe/.test(p2), tag + ' paid: protected note + seller line');
    await noOverflow('paid');
    await shot('5-script-paid');
    await clear();
    await page.click('#zs-buy'); await page.waitForTimeout(800);
    const calls = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__c') || '[]'));
    ok(calls.length === 1 && calls[0].name === 'creatorPay' && calls[0].data.action === 'zsCheckout' && calls[0].data.sid === B && Object.keys(calls[0].data).length === 2, tag + ' Buy calls creatorPay zsCheckout {sid} only (price comes from the server)');
    const bw = (await writes()).filter((x) => /^zs/.test(x.p || '') || x.op === 'batch'); if (bw.length) console.log(JSON.stringify(bw).slice(0, 400));
    ok(bw.length === 0, tag + ' Buy writes nothing client-side (access only from the webhook)');

    // ---- author: publish flow
    await page.goto(BASE + '/script-library.html?who=au', { waitUntil: 'load' });
    await page.waitForSelector('.zl-card', { timeout: 15000 });
    await page.click('#zl-pub'); await page.waitForSelector('#zp-name');
    await page.waitForTimeout(250);
    await shot('6-publish');
    await clear();
    await page.click('#zp-go');
    ok(/name/.test(await page.textContent('#zp-err')), tag + ' publish: empty name refused');
    await page.fill('#zp-name', 'Sample: VWAP Ribbon');
    await page.fill('#zp-desc', 'Guaranteed profits on every trade');
    await page.fill('#zp-src', '//@zscript 1\nindicator("Sample: VWAP Ribbon", overlay=true)\nplot(ta.vwap(close))\n// book.bid in a comment');
    await page.click('#zp-go');
    ok(/results|profits/.test(await page.textContent('#zp-err')), tag + ' publish: result claims refused');
    await page.fill('#zp-desc', 'Sample script. Draws VWAP with two bands.');
    await page.click('#zp-mode [data-v="paid"]');
    ok(await page.isVisible('#zp-price'), tag + ' publish: price field shows for paid');
    await page.fill('#zp-price', '1500'); await page.click('#zp-go');
    ok(/\$1 to \$999/.test(await page.textContent('#zp-err')), tag + ' publish: price over $999 refused');
    await page.fill('#zp-price', '12');
    await page.click('#zp-acc [data-v="protected"]'); await page.click('#zp-go'); await page.waitForTimeout(300);
    ok(/engine/.test(await page.textContent('#zp-err')) && (await writes()).length === 0, tag + ' publish protected without the engine: clear error, nothing written');
    await shot('7-publish-paid');
    await page.click('#zp-acc [data-v="open"]'); await page.click('#zp-mode [data-v="free"]');
    await page.click('#zp-go');
    await page.waitForFunction(() => /versions\/v1/.test(sessionStorage.getItem('__w') || ''), null, { timeout: 8000 }).catch(() => null);
    wr = await writes();
    const m = wr.find((x) => x.op === 'set' && /^zsScripts\/[A-Za-z0-9]{20}$/.test(x.p));
    ok(m && m.v.authorUid === 'au' && m.v.authorName === 'Ana Cruz' && m.v.version === 1 && m.v.ratingCount === 0 && m.v.addCount === 0 && m.v.sale.mode === 'free' && m.v.status === 'live', tag + ' publish: script doc v1 (own name, zero counters)');
    ok(m && JSON.stringify(m.v.dataUsed) === '[]', tag + ' publish: dataUsed ignores the comment');
    ok(m && wr.some((x) => x.p === m.p + '/src/v1' && /vwap/.test(x.v.source)) && wr.some((x) => x.p === m.p + '/versions/v1') && !wr.some((x) => x.p === m.p + '/bin/v1'), tag + ' publish: src + versions in the batch, no bin for open-source');
    ok(wr.filter((x) => x.op === 'batch').length === 1, tag + ' publish: one atomic batch');
    // author's own script page: new version + unlist
    await page.goto(BASE + '/script-library.html?who=au&s=' + A, { waitUntil: 'load' });
    await page.waitForSelector('#zs-ver', { timeout: 8000 });
    ok(!(await page.isVisible('#zs-rep')) && !(await page.isVisible('#zs-rate')), tag + ' author: cannot report or rate own script');
    await page.click('#zs-ver'); await page.waitForSelector('#zp-notes');
    ok(/Publish v4/.test(await page.textContent('#zp-go')), tag + ' new version: button says v4');
    await page.fill('#zp-src', '//@zscript 1\nindicator("Sample: Delta Bands")\nplot(flow.cvd)');
    await page.fill('#zp-notes', 'Uses CVD');
    await clear(); await page.click('#zp-go');
    await page.waitForFunction(() => /versions\/v4/.test(sessionStorage.getItem('__w') || ''), null, { timeout: 8000 }).catch(() => null);
    wr = await writes();
    const mv = wr.find((x) => x.op === 'set' && x.p === 'zsScripts/' + A);
    ok(mv && mv.v.version === 4 && mv.v.ratingSum === 9 && mv.v.addCount === 41 && wr.some((x) => x.p === 'zsScripts/' + A + '/src/v4') && wr.some((x) => x.p === 'zsScripts/' + A + '/versions/v4' && x.v.notes === 'Uses CVD'), tag + ' new version: v4 src + notes, counters kept');
    ok(errs.length === 0, tag + ' library: no page errors' + (errs.length ? ': ' + errs[0] : ''));

    // ---- admin moderation panel
    await page.goto(BASE + '/moderation-admin.html?who=tz', { waitUntil: 'load' });
    await page.waitForSelector('#zs-mod-list .record-card', { timeout: 15000 }); await page.waitForTimeout(300);
    const mt = await page.textContent('#zs-mod');
    ok(/Gamma Walls/.test(mt) && /Lines never draw on NQ/.test(mt) && /Dismiss 2 reports/.test(mt), tag + ' admin: reports grouped by script');
    ok(/Copied Bands/.test(mt) && /Restore/.test(mt), tag + ' admin: taken-down list with Restore');
    await page.evaluate(() => document.getElementById('zs-mod').scrollIntoView());
    await noOverflow('admin');
    await shot('8-admin');
    await clear();
    await page.click('#zs-mod-list [data-a="down"]'); await page.waitForTimeout(400);
    wr = await writes();
    ok(wr.some((x) => x.op === 'update' && x.p === 'zsScripts/' + 'C'.repeat(20) && x.v.status === 'removed' && x.v.modNote === 'Copied code') && wr.filter((x) => x.op === 'update' && /^zsReports\//.test(x.p) && x.v.status === 'actioned').length === 2, tag + ' admin: take down = status removed + note, reports actioned');
    ok(errs.length === 0, tag + ' no page errors' + (errs.length ? ': ' + errs[0] : ''));
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
