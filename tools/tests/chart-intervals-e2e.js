// Charts interval prefs, signed-in e2e against LIVE Firestore with one throwaway member.
// node tools/tests/chart-intervals-e2e.js <base url> <creds.json> <outdir>
// Covers: guest favourites copied up on first sign-in, star/custom/collapse changes saved to
// students/{uid}/chartPrefs/intervals, a fresh browser (empty localStorage) gets them back after sign-in.
const { launch } = require('./lib.js');
const fs = require('fs');
const BASE = process.argv[2], U = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), OUT = process.argv[4] + '/';
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 260)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function page(b, local) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((local) => { try { localStorage.setItem('stryker_install_prompt_dismissed', '1'); if (local) for (const k in local) localStorage.setItem(k, JSON.stringify(local[k])); } catch (e) {} }, local);
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto(BASE + '/charts.html', { waitUntil: 'load' });
  await p.waitForFunction(() => window.firebase && firebase.auth && window.__stkIntervals, null, { timeout: 45000 });
  return { ctx, p };
}
const signIn = (p) => p.evaluate(async (u) => { await firebase.auth().signInWithEmailAndPassword(u.email, u.password); }, U);
const cloud = (p) => p.evaluate(async () => { const s = await firebase.firestore().collection('students').doc(firebase.auth().currentUser.uid).collection('chartPrefs').doc('intervals').get(); return s.exists ? s.data() : null; });
// the row = starred intervals + the active one (shown even when not starred, as on TradingView); the
// chart opens on 15m, which these lists do not star, so it rides along in time order.
const row = (p) => p.evaluate(() => [...document.querySelectorAll('.stk-iv-row .stk-iv-b[data-iv]')].map((b) => b.dataset.iv));
(async () => {
  const b = await launch();
  try {
    // 1) a guest with a customised list signs in for the first time -> copied up
    const A = await page(b, { stryker_chart_iv_favs: ['1', '3', '45', 'W'], stryker_chart_iv_custom: ['7'], stryker_chart_iv_collapsed: ['ticks'] });
    t('guest row comes from this browser', JSON.stringify(await row(A.p)) === JSON.stringify(['1', '3', '15', '45', 'W']), await row(A.p));
    await signIn(A.p); await sleep(3000);
    let d = await cloud(A.p);
    t('first sign-in copies local favs/custom/collapsed up', d && JSON.stringify(d.favs) === JSON.stringify(['1', '3', '45', 'W']) && JSON.stringify(d.custom) === '["7"]' && JSON.stringify(d.collapsed) === '["ticks"]', d);
    // 2) changes save to the account
    await A.p.evaluate(() => { const I = window.__stkIntervals; I.toggleFav('240'); I.toggleFav('3'); I.addCustom('20S'); }); await sleep(2500);
    d = await cloud(A.p);
    t('star 4h / unstar 3m / add custom 20s saved', d && d.favs.includes('240') && !d.favs.includes('3') && d.custom.includes('20S') && d.favs.includes('20S'), d);
    await A.p.screenshot({ path: OUT + 'iv-e2e-A-1440.png' });
    t('page A no errors', A.p.errs.length === 0, A.p.errs);
    await A.ctx.close();
    // 3) a fresh browser (default favourites in localStorage) signs in -> gets the account's lists
    const B = await page(b, null);
    t('fresh browser starts on the defaults', JSON.stringify(await row(B.p)) === JSON.stringify(['1', '5', '15', '60', '240', 'D']), await row(B.p));
    await signIn(B.p); await sleep(3500);
    const r = await row(B.p);
    t('after sign-in the row is the account list (time order)', JSON.stringify(r) === JSON.stringify(['20S', '1', '15', '45', '240', 'W']), r);
    const st = await B.p.evaluate(() => ({ custom: window.__stkIntervals.custom(), collapsed: window.__stkIntervals.collapsed() }));
    t('custom + collapsed restored', st.custom.includes('7') && st.custom.includes('20S') && st.collapsed.includes('ticks'), st);
    await B.p.evaluate(() => window.__stkIntervals.open()); await sleep(400);
    await B.p.screenshot({ path: OUT + 'iv-e2e-B-menu-1440.png' });
    // sign-out: local copy stays, nothing else written
    await B.p.evaluate(() => firebase.auth().signOut()); await sleep(800);
    t('after sign-out the row keeps working', (await row(B.p)).length === 6, await row(B.p));
    t('page B no errors', B.p.errs.length === 0, B.p.errs);
    await B.ctx.close();
  } finally { await b.close(); }
  console.log(fail ? 'FAILURES ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
