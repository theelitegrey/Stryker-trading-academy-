// Free live futures L1 with the Market Data Agreement (Owner 2026-11-04), browser side, against chart-dev-server.mjs.
//   node tools/tests/chart-dev-server.mjs 8092; CHART_BASE=http://127.0.0.1:8092 node tools/tests/free-l1-browser.js [shotsDir]
// A Free member WITHOUT the agreement sees the delayed pill and a "Sign the market data agreement" row (no buy row); one tap opens
// the StkMDA form; after Accept the page re-asks /api/chart/rt (stubbed: yes once signed) and goes live without a reload.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8092';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

async function run(b, { w, h, mobile, theme }) {
  let signed = false;
  const tag = w + '-' + theme;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((theme) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', theme); localStorage.setItem('theme', theme); } catch (e) {}
    window.__stkChartTestFree = true;
    const user = { uid: 'u-free', getIdToken: () => Promise.resolve('dummy.free.token') };
    firebase.apps = [{}];
    const a = firebase.auth(); a.currentUser = user; a.onIdTokenChanged = (cb) => { setTimeout(() => cb(user), 20); return () => {}; };
  }, theme);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  await ctx.route('**/api/chart/rt', (r) => r.fulfill({ json: { admin: signed }, headers: { 'cache-control': 'no-store' } }));
  await ctx.route('**/api/chart/bars/**', async (r) => {
    try { const res = await r.fetch(); const j = await res.json(); if (signed) j.rt = true; await r.fulfill({ json: j, headers: { 'x-tz-rt': signed ? '1' : '0' } }); } catch (e) { await r.abort(); }
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_DATA_BANNER, null, { timeout: 60000 });
  await p.evaluate(() => { window.STRYKER_VELA.active.setSymbol('futures:NQ1!'); window.STRYKER_VELA.active.setTimeframe('1'); });
  await p.waitForFunction(() => { const x = document.getElementById('stkdp'); return x && !x.hidden; }, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const a = await p.evaluate(() => ({ pill: !document.getElementById('stkdp').hidden, dot: (document.querySelector('.stkc-dd') || {}).dataset?.s }));
  check(a.pill && a.dot === 'delayed', tag + ' unsigned: delayed pill + amber dot ' + JSON.stringify(a));
  await p.screenshot({ path: OUT + '/free-l1-a-unsigned-' + tag + '.png' });
  await p.click('#stkdp');
  await p.waitForTimeout(500);
  const s = await p.evaluate(() => ({ sign: !!document.getElementById('stkdp-sign'), buy: !!document.getElementById('stkdp-buy'), txt: document.getElementById('stkdp-sheet').innerText }));
  check(s.sign && !s.buy && !/\$7|add-on/i.test(s.txt), tag + ' sheet: sign row, no buy row');
  await p.screenshot({ path: OUT + '/free-l1-a-sheet-' + tag + '.png' });
  await p.click('#stkdp-sign');
  await p.waitForSelector('.mda-dlg', { timeout: 5000 });
  for (const q of ['regulated', 'business', 'advisor', 'redistribute']) await p.check('input[name="mda-' + q + '"][value="no"]', { force: true });
  await p.check('.mda-c', { force: true });
  await p.fill('.mda-name', 'Test Trader');
  await p.screenshot({ path: OUT + '/free-l1-a-form-' + tag + '.png' });
  signed = true;
  await p.click('.mda-btn');
  await p.waitForFunction(() => window.tzRtState && window.tzRtState().admin === true, null, { timeout: 20000 }).catch(() => {});
  await p.evaluate(() => { window.STRYKER_VELA.active.setTimeframe('5'); });
  await p.waitForFunction(() => document.getElementById('stkdp').hidden, null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(3000);
  const l2 = await p.evaluate(async () => { const m = await import('/assets/chart-futures-l2.js?v=875'); return { badge: m.l2Badge(), vis: m.l2Visible(), live: m.liveVisible() }; });
  check(!l2.badge && !l2.vis && l2.live, tag + ' signed Free member: L2 still locked ' + JSON.stringify(l2));
  const c = await p.evaluate(() => ({ rt: window.tzRtState().admin, pill: !document.getElementById('stkdp').hidden, modal: !!document.querySelector('.mda-dlg'), dot: (document.querySelector('.stkc-dd') || {}).dataset?.s}));
  check(c.rt && !c.pill && !c.modal, tag + ' signed: server says live, pill gone, no reload ' + JSON.stringify(c));
  await p.screenshot({ path: OUT + '/free-l1-b-signed-' + tag + '.png' });
  check(!errors.length, tag + ' no page errors ' + errors.slice(0, 2).join(' | '));
  await ctx.close();
}

(async () => {
  const b = await launch();
  try {
    for (const theme of ['dark', 'light']) {
      await run(b, { w: 390, h: 844, mobile: true, theme });
      await run(b, { w: 1440, h: 900, theme });
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'free-l1: all ok');
  process.exit(fail ? 1 : 0);
})();
