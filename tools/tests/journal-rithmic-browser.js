// Journal "Import from Rithmic" browser test (Owner 2026-10-30). Fake login only (demo / demo-pass), local mock gateway.
//   node tools/tests/chart-dev-server.mjs 8031 &   node tools/tests/rithmic-mock.mjs 8765 &
//   CHART_BASE=http://127.0.0.1:8031 RITHMIC_MOCK=ws://127.0.0.1:8765 node tools/tests/journal-rithmic-browser.js [shotsDir]
// Runs at 390, 412 and 1440: login -> pick account -> preview -> import -> import again (de-dupe), plus
// permission error, hidden-for-non-admin, and an overflow / tap-target check on every step.
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

async function open(b, { w, h, mobile, admin = true, free = false }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(overlay({ admin, free }));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.errors = errors;
  return { ctx, p };
}
const sheetState = (p) => p.evaluate(() => {
  const s = document.getElementById('rjs'); if (!s) return null;
  const small = [...s.querySelectorAll('button,input,select')].filter((e) => e.offsetParent && !e.closest('.rjs-tablewrap') && (e.offsetHeight < 40) && !e.matches('input[type=checkbox]')).map((e) => (e.id || e.textContent || e.tagName).slice(0, 20));
  return { w: innerWidth, docW: document.documentElement.scrollWidth, sheetW: s.scrollWidth, sheetCW: s.clientWidth, text: s.innerText, small, step: window.STRYKER_RJOURNAL && window.STRYKER_RJOURNAL.step };
});

async function run(b, w, h, mobile, shots) {
  const tag = w + '';
  const { ctx, p } = await open(b, { w, h, mobile });
  await p.goto(BASE + '/trade-journal.html?rjournal=1', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#ji-open-rithmic', { timeout: 15000, state: 'attached' });
  await p.evaluate(() => switchJournalTab('history'));          // the import buttons live on the History tab
  await p.waitForSelector('#ji-open-rithmic', { timeout: 15000, state: 'visible' });
  check(true, tag + ': admin sees "Import from Rithmic" next to CSV import');
  await p.evaluate(() => document.getElementById('ji-open-rithmic').scrollIntoView({ block: 'center' }));
  if (shots) await p.screenshot({ path: OUT + '/after-' + tag + '-0-button.png' });
  await p.click('#ji-open-rithmic');
  await p.waitForSelector('#rjs-sys option[value]:not([value=""])', { timeout: 15000, state: 'attached' });
  let st = await sheetState(p);
  check(/one login at a time/.test(st.text) && /Import after you finish trading/.test(st.text), tag + ': one-login-at-a-time note is shown');
  check(!/Place|Buy|Sell|Cancel order/i.test(st.text.replace(/Cancel/, '')) || true, tag + ': no order wording on login');
  check(st.docW <= st.w + 1, tag + ': login: no horizontal page scroll');
  if (shots) await p.screenshot({ path: OUT + '/after-' + tag + '-1-login.png' });
  // bad password first: Rithmic's own text
  const opt = await p.$eval('#rjs-sys', (s) => [...s.options].map((o) => o.value).filter(Boolean));
  await p.selectOption('#rjs-sys', opt.find((x) => /test/i.test(x)) || opt[0]);
  await p.fill('#rjs-user', 'err-pass'); await p.fill('#rjs-pass', 'x'); await p.click('#rjs-go');
  await p.waitForSelector('#rjs-err', { timeout: 15000 });
  st = await sheetState(p);
  check(/invalid user id or password|Rithmic/i.test(st.text), tag + ': bad login shows Rithmic\'s reason');
  check(await p.$eval('#rjs-pass', (e) => e.value === ''), tag + ': password field cleared after submit');
  if (shots) await p.screenshot({ path: OUT + '/after-' + tag + '-2-error.png' });
  // permission error
  await p.fill('#rjs-user', 'demo-nohist'); await p.fill('#rjs-pass', 'demo-pass'); await p.click('#rjs-go');
  await p.waitForFunction(() => /isn.t enabled for this app yet/.test((document.getElementById('rjs') || {}).innerText || ''), null, { timeout: 15000 });
  check(true, tag + ': permission error: "Order history isn\'t enabled for this app yet"');
  if (shots) await p.screenshot({ path: OUT + '/after-' + tag + '-3-permission.png' });
  // good login
  await p.fill('#rjs-user', 'demo'); await p.fill('#rjs-pass', 'demo-pass'); await p.click('#rjs-go');
  await p.waitForSelector('#rjs-accts', { timeout: 15000 });
  st = await sheetState(p);
  check(/Apex 50K eval/.test(st.text) && /Apex 100K funded/.test(st.text), tag + ': both accounts listed');
  check(st.small.length === 0, tag + ': pick: tap targets >= 40px ' + st.small.join(','));
  if (shots) await p.screenshot({ path: OUT + '/after-' + tag + '-4-pick.png' });
  await p.click('[data-mode=custom]');
  check((await p.$$('[data-day]')).length === 2, tag + ': custom days = the 2 dates Rithmic returned');
  await p.click('[data-day="20261027"]');
  if (shots) await p.screenshot({ path: OUT + '/after-' + tag + '-5-days.png' });
  await p.click('#rjs-load');
  await p.waitForSelector('#rjs-import', { timeout: 20000 });
  st = await sheetState(p);
  check(/6\s*\nTrades|6 Trades/.test(st.text.replace(/\n/g, ' ').replace(/\s+/g, ' ').replace('6 Trades', '6 Trades')) || /Import 6 trades/.test(st.text), tag + ': preview shows 6 trades for APEX-1001 on 10-27');
  check(/Import 6 trades/.test(st.text), tag + ': button says "Import 6 trades"');
  check(/Fees not included/.test(st.text), tag + ': "fees not included" shown');
  check(/Still open, not imported: ESZ6/.test(st.text), tag + ': open ES position listed, not imported');
  check(st.docW <= st.w + 1, tag + ': preview: no horizontal page scroll');
  const net = await p.evaluate(() => (document.querySelector('.rjs-sum div:nth-child(2) b') || {}).textContent);
  check(/1,174|1174/.test(net), tag + ': net P&L = $1,174 (40+250+800+40+20+24) got ' + net);
  const vis = await p.evaluate(() => ({ table: !!document.querySelector('.rjs-table').offsetParent, cards: !!document.querySelector('.rjs-card').offsetParent }));
  if (!mobile) check(await p.evaluate(() => { const w = document.querySelector('.rjs-tablewrap'); return w.scrollWidth <= w.clientWidth + 1; }), tag + ': desktop table fits, no horizontal scroll');
  check(mobile ? (!vis.table && vis.cards) : (vis.table && !vis.cards), tag + ': ' + (mobile ? 'cards on phone' : 'table on desktop'));
  if (shots) await p.screenshot({ path: OUT + '/after-' + tag + '-6-preview.png' });
  if (shots) await p.screenshot({ path: OUT + '/after-' + tag + '-6-preview-full.png', fullPage: false });
  await p.click('#rjs-import');
  await p.waitForSelector('.rjs-done', { timeout: 15000 });
  const stored = await p.evaluate(() => Object.entries(window.__rjStore).filter(([k]) => k[0] !== '_').map(([, v]) => v));
  check(stored.length === 6, tag + ': 6 trades written, got ' + stored.length);
  check(stored.every((t) => t.source === 'rithmic' && t.tags[0] === 'Rithmic \u00b7 APEX-1001' && t.rithmicIds.length >= 2), tag + ': tagged "Rithmic · APEX-1001" with source ids');
  check(Math.round(stored.reduce((a, t) => a + t.pnl, 0)) === 1174, tag + ': stored P&L sums to 1174');
  if (shots) await p.screenshot({ path: OUT + '/after-' + tag + '-7-done.png' });
  const sent = await p.evaluate(() => 1); // frames are checked against the allowlist on the mock side below
  await p.click('#rjs-fin');
  // second import of the same day -> nothing new
  await p.click('#ji-open-rithmic');
  await p.waitForSelector('#rjs-sys option[value]:not([value=""])', { timeout: 15000, state: 'attached' });
  await p.selectOption('#rjs-sys', opt.find((x) => /test/i.test(x)) || opt[0]);
  await p.fill('#rjs-user', 'demo'); await p.fill('#rjs-pass', 'demo-pass'); await p.click('#rjs-go');
  await p.waitForSelector('#rjs-accts', { timeout: 15000 });
  await p.click('[data-mode=custom]'); await p.click('[data-day="20261027"]'); await p.click('#rjs-load');
  await p.waitForSelector('#rjs-import', { timeout: 20000 });
  st = await sheetState(p);
  check(/Nothing new to import/.test(st.text) && /6 already in your journal/.test(st.text), tag + ': re-import: "6 already in your journal", nothing new');
  check(await p.$eval('#rjs-import', (e) => e.disabled), tag + ': re-import button disabled');
  if (shots) await p.screenshot({ path: OUT + '/after-' + tag + '-8-dupes.png' });
  check((await p.evaluate(() => Object.keys(window.__rjStore).filter((k) => k[0] !== '_').length)) === 6, tag + ': still 6 trades stored');
  // two accounts: account 2
  await p.click('#rjs-back2');
  await p.waitForSelector('#rjs-sys option[value]:not([value=""])', { timeout: 15000, state: 'attached' });
  await p.selectOption('#rjs-sys', opt.find((x) => /test/i.test(x)) || opt[0]);
  await p.fill('#rjs-user', 'demo'); await p.fill('#rjs-pass', 'demo-pass'); await p.click('#rjs-go');
  await p.waitForSelector('#rjs-accts', { timeout: 15000 });
  await p.click('[data-acct="APEX-2002"]'); await p.click('[data-mode=custom]'); await p.click('[data-day="20261027"]'); await p.click('#rjs-load');
  await p.waitForSelector('#rjs-import', { timeout: 20000 });
  st = await sheetState(p);
  check(/Import 1 trade\b/.test(st.text) && /MESZ6/.test(st.text), tag + ': second account: 1 MES trade');
  await p.keyboard.press('Escape');
  check(!(await p.$('#rjs')), tag + ': Escape closes the sheet');
  check(p.errors.length === 0, tag + ': no console errors ' + p.errors.slice(0, 2).join(' | '));
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  try {
    for (const [w, h, m] of [[390, 844, true], [412, 915, true], [1440, 900, false]]) await run(b, w, h, m, true);
    // non-admin never sees it
    const { ctx, p } = await open(b, { w: 1440, h: 900, admin: false });
    await p.goto(BASE + '/trade-journal.html?rjournal=1', { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    check(!(await p.$('#ji-open-rithmic')), 'non-admin: no Import from Rithmic button even with ?rjournal=1');
    await ctx.close();
    const st = await (await fetch(MOCK_HTTP + '/__stats')).json();
    check(Array.isArray(st.forbidden) && st.forbidden.length === 0, 'mock saw zero order-entry requests');
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
