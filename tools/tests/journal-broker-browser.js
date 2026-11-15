// Journal "Import from Rithmic" browser test (Owner 2026-10-30). Fake login only (demo / demo-pass), local mock gateway.
//   node tools/tests/chart-dev-server.mjs 8031 &   node tools/tests/rithmic-mock.mjs 8765 &
//   CHART_BASE=http://127.0.0.1:8031 RITHMIC_MOCK=ws://127.0.0.1:8765 node tools/tests/journal-rithmic-browser.js [shotsDir]
// Runs at 390, 412 and 1440: login -> pick account -> preview -> import -> import again (de-dupe), plus
// permission error, hidden-for-non-admin, and an overflow / tap-target check on every step.
// Journal "Broker sync (beta)" browser test. Mocked /connect/finatic/* (Sample data). node tools/tests/chart-dev-server.mjs 8031 &  CHART_BASE=http://127.0.0.1:8031 node tools/tests/journal-broker-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const MOCK = process.env.RITHMIC_MOCK || 'ws://127.0.0.1:8765';
const MOCK_HTTP = MOCK.replace(/^ws/, 'http');
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Overlay on the Firebase stub: admins/{uid} exists (or not), journal docs written by the import are remembered
// and come back from loadAllTrades / doc().get(), batches really store.
function overlay({ admin, free, dev }) {
  return `(${function (admin, free, dev) {
    const store = {};   // id -> data
    const real = window.__stubDb;
    const origCol = real.collection, origDoc = real.doc;
    const isJournal = (path) => /\/journal$/.test(path);
    function wrapCol(path, col) {
      if (/^admins$/.test(path)) return { doc: (id) => ({ get: () => Promise.resolve({ exists: !!admin, data: () => ({}) }) }) };
      if (/^settings$/.test(path)) return { doc: (id) => (id === 'commerce' ? { get: () => Promise.resolve({ exists: true, data: () => ({}) }) } : col.doc(id)) };
      if (!isJournal(path)) return col;
      const doc = (id) => { const d = col.doc(id); return Object.assign({}, d, {
        get: () => (store[id] ? Promise.resolve({ id, exists: true, data: () => store[id] }) : d.get()),
        set: (v) => { store[id] = v; return Promise.resolve(); } }); };
      return Object.assign({}, col, { doc,
        get: () => col.get().then((snap) => { const rows = []; snap.forEach((x) => rows.push(x)); Object.keys(store).forEach((id) => rows.push({ id, data: () => store[id] }));
          return { forEach: (cb) => rows.forEach(cb), size: rows.length, docs: rows, empty: !rows.length }; }) });
    }
    real.collection = (p) => wrapCol(p, origCol(p));
    window.__rjStore = store;
    const dbDoc = (p) => origDoc(p);
    real.doc = dbDoc;
    // students/{uid} doc: collection('students').doc(uid).collection('journal') must be wrapped too.
    const stuCol = real.collection;
    real.collection = (p) => {
      const c = stuCol(p);
      if (p !== 'students') return c;
      return Object.assign({}, c, { doc: (id) => { const d = c.doc(id); return Object.assign({}, d, { set: () => Promise.resolve(), collection: (sub) => wrapCol('students/' + id + '/' + sub, origCol('students/' + id + '/' + sub)) }); } });
    };
    real.batch = () => { const ops = []; return { set: (ref, v) => { ops.push([ref, v]); }, update() {}, delete() {}, commit: () => { ops.forEach(([ref, v]) => { store[ref.id] = v; }); return Promise.resolve(); } }; };
    window.strykerPlanTier = () => Promise.resolve({ free: !!free, admin: !!admin });
    try { localStorage.setItem('stryker_rithmic_dev', JSON.stringify({ gateway: dev })); } catch (e) {}
  }.toString()})(${!!admin}, ${!!free}, ${JSON.stringify(MOCK)})`;
}

async function open(b, { w, h, mobile, admin = true, free = false, configured = true }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(overlay({ admin, free }));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const seen = []; ctx.seen = seen;
  const j = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
  const fill = (id, side, q, pr, t) => ({ fillId: id, orderId: 'o' + id, side, quantity: q, price: pr, commission: 0.74 * q, executedAt: '2026-10-' + t + 'Z', instrument: { displaySymbol: 'MNQZ6' } });
  const FILLS = [fill('f1', 'BUY', 2, 25000, '28T14:00:00'), fill('f2', 'SELL', 1, 25010, '28T14:05:00'), fill('f3', 'SELL', 1, 24995, '28T14:09:00'), fill('f4', 'SELL', 1, 25100, '29T15:00:00'), fill('f5', 'BUY', 1, 25120, '29T15:20:00')];
  await ctx.route('**/connect/finatic/**', (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    seen.push({ path: u.pathname, body });
    if (u.pathname.endsWith('/session') && r.request().method() === 'GET') return r.fulfill(j({ configured }, configured ? 200 : 503));
    // failure scenarios (Owner bug 15 Nov): stale stored user id, HTML error page, network drop, server message
    if (ctx.failMode === 'stale' && body.op === 'accounts' && body.userId) return r.fulfill(j({ error: 'Not connected yet', code: 'needs_connect', needsConnect: true }, 409));
    if (ctx.failMode === 'html' && u.pathname.endsWith('/session')) return r.fulfill({ status: 500, contentType: 'text/html', body: '<html>error code: 1101</html>' });
    if (ctx.failMode === 'net' && u.pathname.endsWith('/session')) return r.abort('internetdisconnected');
    if (ctx.failMode === 'msg' && u.pathname.endsWith('/session')) return r.fulfill(j({ error: 'Broker sync could not start: the connection service answered with an error. Try again in a minute; if it keeps happening, tell support. (code 401)', code: 'upstream' }, 502));
    if (u.pathname.endsWith('/session')) return r.fulfill(j({ portalUrl: 'http://127.0.0.1:1/portal', sessionId: 's1' }));
    if (u.pathname.endsWith('/order')) { if (body.op === 'env') return r.fulfill(j({ env: 'sandbox', enabled: true })); if (body.op === 'place') { global.__placed = body; return r.fulfill(j({ ok: true, orderId: 'ord-9', status: 'PENDING', accepted: true })); } if (body.op === 'cancel') { global.__cancelled = body.orderId; return r.fulfill(j({ ok: true })); } return r.fulfill(j({ error: 'Not allowed' }, 400)); }
    if (body.op === 'accounts') return r.fulfill(j({ userId: '0aaa1111-2222-3333-4444-555566667777', data: [{ accountId: '123e4567-e89b-12d3-a456-426614174000', accountName: 'Sample Tradovate DEMO', brokerName: 'Tradovate', currency: 'USD' }] }));
    if (body.op === 'orders' && ctx.sampleOpen) return r.fulfill(j({ data: [{ orderId: 'ord-open1', status: 'SUBMITTED', legs: [{ securityId: 'MESZ6' }] }, { orderId: FILLS[0].orderId, status: 'FILLED' }] }));
    if (body.op === 'orders') return r.fulfill(j({ data: FILLS.map((f) => ({ orderId: f.orderId, status: 'FILLED', orderTerminalAt: f.executedAt })).concat([{ orderId: 'zc', status: 'CANCELLED' }]) }));
    if (body.op === 'fills') return r.fulfill(j({ data: FILLS.filter((f) => body.orderIds.includes(f.orderId)) }));
    return r.fulfill(j({ error: 'Not allowed' }, 400));
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.errors = errors;
  return { ctx, p };
}

const state = (p) => p.evaluate(() => { const s = document.getElementById('fjs'); if (!s) return null; return { w: innerWidth, docW: document.documentElement.scrollWidth, sheetW: s.scrollWidth, sheetCW: s.clientWidth, text: s.innerText, step: window.STRYKER_BROKER_SYNC && window.STRYKER_BROKER_SYNC.step }; });
async function run(b, w, h, mobile, shots) {
  const tag = w + '';
  const { ctx, p } = await open(b, { w, h, mobile });
  await p.addInitScript(() => { window.STRYKER_BROKER_SAMPLE = true; });
  await p.goto(BASE + '/trade-journal.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#ji-open-broker', { timeout: 15000, state: 'attached' });
  await p.evaluate(() => switchJournalTab('history'));
  await p.waitForSelector('#ji-open-broker', { state: 'visible' });
  check(true, tag + ': admin sees Broker sync (beta)');
  if (shots) await sleep(450), await p.screenshot({ path: OUT + '/broker-' + tag + '-1-button.png' });
  await p.click('#ji-open-broker');
  await p.waitForSelector('#fjs-connect');
  let st = await state(p);
  check(!/finatic/i.test(st.text), tag + ': no vendor name in member-facing copy');
  check(/never place or change an order/.test(st.text) && !/Buy|Sell now|Place order/i.test(st.text), tag + ': read-only wording, no order buttons');
  if (shots) await sleep(450), await p.screenshot({ path: OUT + '/broker-' + tag + '-2-start.png' });
  await p.evaluate(() => { window.open = () => ({ location: {}, close() {} }); });
  await p.click('#fjs-connect'); await p.waitForSelector('#fjs-cont');
  await p.click('#fjs-cont'); await p.waitForSelector('#fjs-load');
  st = await state(p);
  check(/Sample Tradovate DEMO/.test(st.text), tag + ': account listed');
  const days = await p.$eval('#fjs-from', (e) => Math.round((Date.now() - Date.parse(e.value)) / 864e5));
  check(days >= 29 && days <= 31, tag + ': default range is last 30 days (' + days + ')');
  await p.fill('#fjs-from', '2026-10-01'); await p.fill('#fjs-to', '2026-11-03');
  if (shots) await sleep(450), await p.screenshot({ path: OUT + '/broker-' + tag + '-3-pick.png' });
  await p.click('#fjs-load'); await p.waitForSelector('#fjs-import', { timeout: 15000 });
  st = await state(p);
  check(/MNQZ6/.test(st.text) && /Import 2 trades/.test(st.text), tag + ': preview shows 2 round trips: ' + (st.text.match(/Import \d+ trades?/) || [''])[0]);
  check(/sample data/i.test(st.text), tag + ': preview labelled Sample data');
  check(st.docW <= st.w + 1, tag + ': preview: no horizontal page scroll');
  if (shots) await sleep(450), await p.screenshot({ path: OUT + '/broker-' + tag + '-4-preview.png' });
  await p.click('#fjs-import'); await p.waitForFunction(() => /trades? added/.test((document.getElementById('fjs') || {}).innerText || ''), null, { timeout: 15000 });
  const keys = await p.evaluate(() => Object.values(window.__rjStore || {}).map((t) => t.syncKey).filter(Boolean));
  check(keys.length === 2 && keys.every((k) => /^broker\|/.test(k)), tag + ': 2 trades written with broker syncKeys');
  await p.click('#fjs-fin');
  // sync again: the same fills are now duplicates
  await p.evaluate(async () => { JOURNAL_TRADES = Object.values(window.__rjStore).map((t) => Object.assign({}, t)); });
  await p.click('#ji-open-broker'); await p.waitForSelector('#fjs-have, #fjs-load', { timeout: 10000 });
  if (await p.$('#fjs-have')) await p.click('#fjs-have');
  await p.waitForSelector('#fjs-load'); await p.fill('#fjs-from', '2026-10-01'); await p.fill('#fjs-to', '2026-11-03'); await p.click('#fjs-load'); await p.waitForSelector('#fjs-import');
  st = await state(p);
  check(/Nothing new to import/.test(st.text), tag + ': re-sync adds nothing twice');
  await p.keyboard.press('Escape');
  check(ctx.seen.every((c) => !/\/order$/.test(c.path) && !/^(place|cancel|modify)$/.test(c.body.op || '') ), tag + ': import flow never sends an order op');
  check(p.errors.length === 0, tag + ': no console errors ' + p.errors.slice(0, 2).join(' | '));
  await ctx.close();
}
async function runOrders(b, w, h, mobile) {
  const tag = w + '';
  const { ctx, p } = await open(b, { w, h, mobile }); ctx.sampleOpen = true; global.__placed = null; global.__cancelled = null;
  await p.addInitScript(() => { window.STRYKER_BROKER_SAMPLE = true; });
  await p.goto(BASE + '/trade-journal.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#ji-open-broker', { state: 'attached' }); await p.evaluate(() => switchJournalTab('history')); await p.click('#ji-open-broker');
  await p.evaluate(() => { window.open = () => ({ location: {}, close() {} }); });
  await p.waitForSelector('#fjs-connect'); await p.click('#fjs-connect'); await p.waitForSelector('#fjs-cont'); await p.click('#fjs-cont'); await p.waitForSelector('#fjs-ordbtn');
  await p.click('#fjs-ordbtn'); await p.waitForSelector('#fo-place');
  let st = await state(p);
  check(/SANDBOX/.test(st.text) && /Order test \(admin\)/.test(st.text), tag + ': order panel with SANDBOX badge');
  check(/Open orders/.test(st.text) && /MESZ6/.test(st.text) && /Recent fills/.test(st.text), tag + ': open orders + recent fills lists');
  check(!/finatic/i.test(st.text), tag + ': no vendor name');
  await sleep(400); await p.screenshot({ path: OUT + '/orders-' + tag + '-1-panel.png' });
  await p.fill('#fo-sym', 'mesz6'); await p.fill('#fo-qty', '3'); await p.click('#fo-place');
  check(/Quantity must be 1 or 2/.test((await state(p)).text), tag + ': qty 3 refused in the form');
  await p.fill('#fo-qty', '1'); await p.fill('#fo-sym', 'mesz6'); await p.click('#fo-place'); await p.waitForSelector('#fo-yes');
  st = await state(p);
  check(/Place BUY 1 MESZ6 market on Sample Tradovate DEMO\?/.test(st.text), tag + ': confirm step text');
  await p.evaluate(() => document.getElementById('fo-conf').scrollIntoView({ block: 'center' })); await sleep(400); await p.screenshot({ path: OUT + '/orders-' + tag + '-2-confirm.png' });
  await p.click('#fo-yes'); await p.waitForSelector('#fo-place', { timeout: 10000 });
  check(global.__placed && global.__placed.qty === 1 && global.__placed.side === 'buy' && String(global.__placed.symbol).toUpperCase() === 'MESZ6', tag + ': place sent with the confirmed values');
  await p.click('[data-cancel="ord-open1"]'); await p.waitForFunction(() => !!document.getElementById('fo-place'), null, { timeout: 8000 }); await sleep(300);
  check(global.__cancelled === 'ord-open1', tag + ': cancel sent for the open order');
  check((await state(p)).docW <= w + 1, tag + ': no horizontal scroll');
  check(p.errors.length === 0, tag + ': no console errors ' + p.errors.slice(0, 2).join(' | '));
  await ctx.close();
}
// MEASURE=1: alignment numbers for the start sheet with the error banner (dark + light, 390 + 1440). Prints JSON, saves crops.
async function measure(b) {
  for (const theme of ['dark', 'light']) for (const [w, h, m] of [[390, 844, true], [1440, 900, false]]) {
    const { ctx, p } = await open(b, { w, h, mobile: m }); ctx.failMode = 'msg';
    if (theme === 'light') await p.addInitScript(() => { try { localStorage.setItem('stryker_theme', 'day'); } catch (e) {} });
    await p.goto(BASE + '/trade-journal.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#ji-open-broker', { state: 'attached' }); await p.evaluate(() => switchJournalTab('history')); await p.click('#ji-open-broker');
    await p.waitForSelector('#fjs-connect'); await p.evaluate(() => { window.open = () => ({ location: {}, close() {} }); });
    await p.click('#fjs-connect'); await p.waitForSelector('#fjs .rjs-err'); await sleep(500);
    const r = await p.evaluate(() => {
      const R = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left * 10) / 10, r: Math.round(b.right * 10) / 10, t: Math.round(b.top * 10) / 10, b: Math.round(b.bottom * 10) / 10, h: Math.round(b.height * 10) / 10, cy: Math.round((b.top + b.height / 2) * 10) / 10 }; };
      const sheet = R('#fjs'), title = R('#fjs .rjs-head h2'), tag = R('#fjs .fjs-tag'), x = R('#fjs-x'), err = R('#fjs .rjs-err'), lead = R('#fjs .rjs-lead'), go = R('#fjs-connect'), fine = R('#fjs .rjs-fine');
      const cs = getComputedStyle(document.querySelector('#fjs .rjs-err'));
      return { theme: document.documentElement.getAttribute('data-theme') || 'dark', sheet, title, tag, x, err, lead, go, fine,
        errPad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
        innerL: { err: err.l - sheet.l, lead: lead.l - sheet.l, go: go.l - sheet.l, title: title.l - sheet.l }, innerR: { err: sheet.r - err.r, go: sheet.r - go.r, x: sheet.r - x.r },
        gaps: { headToErr: err.t - x.b, errToLead: lead.t - err.b, leadToGo: go.t - lead.b, goToFine: fine.t - go.b },
        headCentres: { title: title.cy, tag: tag.cy, x: x.cy } };
    });
    console.log('MEASURE ' + theme + ' ' + w + ' ' + JSON.stringify(r));
    const s = r.sheet; await p.screenshot({ path: OUT + '/measure-' + theme + '-' + w + '.png', clip: { x: Math.max(0, s.l), y: Math.max(0, s.t), width: Math.min(w, s.r) - Math.max(0, s.l), height: Math.min(h, s.b) - Math.max(0, s.t) } });
    await ctx.close();
  }
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  if (process.env.MEASURE === '1') { try { await measure(b); } catch (e) { console.log('FAIL measure ' + (e && e.stack || e)); } await b.close(); return process.exit(0); }
  try {
    for (const [w, h, m] of [[390, 844, true], [412, 915, true], [1440, 900, false]]) await run(b, w, h, m, true);
    await runOrders(b, 390, 844, true); await runOrders(b, 1440, 900, false);
    // Failure paths: the start screen never shows the generic "Request failed".
    for (const [w, h, m] of [[390, 844, true], [1440, 900, false]]) {
      const tag = w + '';
      { const { ctx, p } = await open(b, { w, h, mobile: m }); ctx.failMode = 'stale';
        await p.goto(BASE + '/trade-journal.html', { waitUntil: 'domcontentloaded' });
        await p.waitForSelector('#ji-open-broker', { state: 'attached' }); await p.evaluate(() => switchJournalTab('history'));
        await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('stryker_broker_sync_user_')) localStorage.removeItem(k); const uid = (window.auth && auth.currentUser && auth.currentUser.uid) || (typeof JOURNAL_UID !== 'undefined' ? JOURNAL_UID : ''); localStorage.setItem('stryker_broker_sync_user_' + uid, '0bbb1111-2222-3333-4444-555566667777'); });
        await p.click('#ji-open-broker');
        await p.waitForFunction(() => { const s = document.getElementById('fjs'); return s && !document.getElementById('fjs-have') && document.getElementById('fjs-connect') && (window.__ls = Object.keys(localStorage).filter((k) => k.startsWith('stryker_broker_sync_user_')).length) === 0; }, null, { timeout: 10000 });
        const st = await state(p);
        check(ctx.seen.some((c) => c.body.op === 'accounts' && c.body.userId), tag + ': stale id was tried once');
        check(!(await p.$('#fjs .rjs-err')) && !/Request failed/.test(st.text), tag + ': stale stored id cleared silently (no red error)');
        await sleep(450); await p.screenshot({ path: OUT + '/broker-' + tag + '-6-stale-cleared.png' });
        { const js = p.errors.filter((e) => !/Failed to load resource/.test(e)); check(js.length === 0, tag + ': stale: no JS errors (the 409 network line is expected) ' + js.slice(0, 2).join(' | ')); }
        await ctx.close(); }
      for (const [mode, re, name] of [['html', /Broker sync hit an error \(code 500\)/, 'HTML error page'], ['net', /Couldn.t reach TradeZoro, try again/, 'network error'], ['msg', /connection service answered with an error.*\(code 401\)/, 'server message']]) {
        const { ctx, p } = await open(b, { w, h, mobile: m }); ctx.failMode = mode;
        await p.goto(BASE + '/trade-journal.html', { waitUntil: 'domcontentloaded' });
        await p.waitForSelector('#ji-open-broker', { state: 'attached' }); await p.evaluate(() => switchJournalTab('history')); await p.click('#ji-open-broker');
        await p.waitForSelector('#fjs-connect'); await p.evaluate(() => { window.open = () => ({ location: {}, close() {} }); });
        await p.click('#fjs-connect'); await p.waitForSelector('#fjs .rjs-err', { timeout: 10000 });
        const txt = await p.$eval('#fjs .rjs-err', (e) => e.innerText);
        check(re.test(txt) && !/Request failed/.test(txt), tag + ': ' + name + ' -> "' + txt.slice(0, 70) + '"');
        check(!!(await p.$('#fjs-connect:not([disabled])')), tag + ': ' + name + ': Connect button usable again');
        if (mode === 'msg') { await sleep(450); await p.screenshot({ path: OUT + '/broker-' + tag + '-7-error-msg.png' }); }
        await ctx.close();
      }
    }
    { const { ctx, p } = await open(b, { w: 390, h: 844, mobile: true, configured: false });
      await p.goto(BASE + '/trade-journal.html', { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('#ji-open-broker', { state: 'attached' }); await p.evaluate(() => switchJournalTab('history')); await p.click('#ji-open-broker');
      await p.waitForFunction(() => /Not set up yet/.test((document.getElementById('fjs') || {}).innerText || ''), null, { timeout: 10000 });
      check(true, 'not-set-up state shows "Not set up yet"');
      await sleep(500); await p.screenshot({ path: OUT + '/broker-390-5-notsetup.png' });
      await ctx.close(); }
    { const { ctx, p } = await open(b, { w: 1440, h: 900, admin: false });
      await p.goto(BASE + '/trade-journal.html', { waitUntil: 'domcontentloaded' }); await sleep(3000);
      check(!(await p.$('#ji-open-broker')), 'non-admin: no Broker sync button'); await ctx.close(); }
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
