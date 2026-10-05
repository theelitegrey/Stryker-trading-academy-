// Charts watchlist, signed-in e2e against LIVE Firestore with two throwaway members (A, B).
// node tools/tests/chart-watchlist-e2e.js <base url> <creds.json> <outdir>
// Covers: cloud store + reload, share link read-only for B, Make a copy, share off -> link fails,
// upload with unknown symbols (reported), "Add alert on the list" (alerts saved to A's account).
const { launch } = require('./lib.js');
const fs = require('fs');
const BASE = process.argv[2], U = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), OUT = process.argv[4] + '/';
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 260)); };

async function member(b, who, path) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_dismissed', '1'); } catch (e) {} });
  const p = await ctx.newPage();
  p.errs = []; p.toasts = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(BASE + '/charts.html', { waitUntil: 'load' });
  await p.waitForFunction(() => window.firebase && firebase.auth, null, { timeout: 30000 });
  await p.evaluate(async (u) => { await firebase.auth().signInWithEmailAndPassword(u.email, u.password); }, U[who]);
  await p.goto(BASE + (path || '/charts.html'), { waitUntil: 'load' });
  await p.waitForFunction(() => window.STRYKER_WATCHLIST && window.STRYKER_WATCHLIST.store === 'cloud' && window.STRYKER_WATCHLIST.current, null, { timeout: 40000 });
  await p.waitForTimeout(2000);
  return { ctx, p };
}
const toastText = (p) => p.evaluate(() => [...document.querySelectorAll('.stkc-toast, .toast, [role="status"]')].map((x) => x.textContent.trim()).filter(Boolean).join(' | '));

(async () => {
  const b = await launch();
  try {
    // ---- A: default list in the cloud, edit, reload
    let A = await member(b, 'A');
    let s = await A.p.evaluate(() => ({ items: window.STRYKER_WATCHLIST.current.items, n: window.STRYKER_WATCHLIST.lists.length }));
    t('A: default list created in the account', s.n === 1 && s.items.join() === '###FUTURES,futures:NQ1!,futures:ES1!,futures:YM1!,futures:RTY1!,futures:GC1!,futures:CL1!,###CRYPTO,binance:BTCUSDT,binance:ETHUSDT', s);
    await A.p.evaluate(async () => { const W = window.STRYKER_WATCHLIST; W.addSymbol('futures:SI1!'); await W.renameCur('E2E list'); await W.saveNow(); });
    await A.p.waitForTimeout(1500);
    await A.p.reload({ waitUntil: 'load' });
    await A.p.waitForFunction(() => window.STRYKER_WATCHLIST && window.STRYKER_WATCHLIST.store === 'cloud' && window.STRYKER_WATCHLIST.current && window.STRYKER_WATCHLIST.current.name === 'E2E list', null, { timeout: 40000 }).catch(() => {});
    s = await A.p.evaluate(() => ({ name: window.STRYKER_WATCHLIST.current.name, items: window.STRYKER_WATCHLIST.current.items }));
    t('A: reload keeps rename + added symbol (cloud)', s.name === 'E2E list' && s.items.includes('futures:SI1!'), s);
    // share on via the list menu switch
    if (!(await A.p.evaluate(() => window.STRYKER_WATCHLIST.open))) await A.p.click('.stkw-railbtn');
    await A.p.click('.stkw-title');
    await A.p.click('.stkw-menu:not([hidden]) .stkw-swrow:has-text("Share list") input');
    await A.p.waitForTimeout(2000);
    const id = await A.p.evaluate(() => window.STRYKER_WATCHLIST.current.shared && window.STRYKER_WATCHLIST.current.id);
    t('A: Share list on', !!id, id);
    await A.p.screenshot({ path: OUT + 'e2e-A-shared.png' });

    // ---- B opens the link: read-only, Make a copy
    const B = await member(b, 'B', '/charts?watchlist=' + id);
    await B.p.waitForFunction(() => window.STRYKER_WATCHLIST.viewing, null, { timeout: 15000 }).catch(() => {});
    s = await B.p.evaluate(() => ({ v: !!window.STRYKER_WATCHLIST.viewing, open: window.STRYKER_WATCHLIST.open, rows: [...document.querySelectorAll('.stkw-row')].map((r) => r.dataset.sym), banner: document.querySelector('.stkw-banner') && document.querySelector('.stkw-banner').textContent, add: document.querySelector('.stkw-hd button[aria-label="Add symbol"]').disabled }));
    t('B: link opens A\'s list read-only', s.v && s.open && s.rows.includes('futures:SI1!') && /Read-only/.test(s.banner) && s.add, s);
    await B.p.waitForTimeout(4000);
    await B.p.screenshot({ path: OUT + 'e2e-B-readonly.png' });
    // B tries to edit: Delete key / ctx menu do nothing
    await B.p.click('.stkw-row[data-sym="futures:NQ1!"]');
    await B.p.keyboard.press('Delete');
    await B.p.waitForTimeout(300);
    t('B: cannot remove rows from the shared list', await B.p.evaluate(() => window.STRYKER_WATCHLIST.current.items.includes('futures:NQ1!')));
    t('B: row click still loads the chart', await B.p.evaluate(() => window.STRYKER_VELA.active.symbol) === 'futures:NQ1!');
    // B tries to write the shared doc directly
    const wr = await B.p.evaluate(async (id) => { try { await firebase.firestore().collection('watchlistShared').doc(id).set({ ownerUid: firebase.auth().currentUser.uid, name: 'x', items: [], updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); return 'written'; } catch (e) { return e.code; } }, id);
    t('B: direct write to A\'s share is denied', wr === 'permission-denied', wr);
    const rd = await B.p.evaluate(async (uid) => { try { await firebase.firestore().collection('students').doc(uid).collection('watchlists').get(); return 'read'; } catch (e) { return e.code; } }, U.A.uid);
    t('B: reading A\'s private lists is denied', rd === 'permission-denied', rd);
    await B.p.click('.stkw-banner .stkw-bb');
    await B.p.click('.stkw-dlg .stkw-pbtn');
    await B.p.waitForFunction(() => !window.STRYKER_WATCHLIST.viewing, null, { timeout: 3000 }).catch(() => {});
    s = await B.p.evaluate(() => ({ v: !!window.STRYKER_WATCHLIST.viewing, name: window.STRYKER_WATCHLIST.current.name, n: window.STRYKER_WATCHLIST.lists.length, items: window.STRYKER_WATCHLIST.current.items }));
    t('B: Make a copy -> own editable list', !s.v && /copy/.test(s.name) && s.n === 2 && s.items.includes('futures:SI1!'), s);

    // ---- A: share off -> link fails for B
    await A.p.click('.stkw-title');
    await A.p.click('.stkw-menu:not([hidden]) .stkw-swrow:has-text("Share list") input');
    await A.p.waitForTimeout(2000);
    t('A: Share list off', await A.p.evaluate(() => window.STRYKER_WATCHLIST.current.shared === false));
    await B.p.goto(BASE + '/charts?watchlist=' + id, { waitUntil: 'load' });
    await B.p.waitForFunction(() => window.STRYKER_WATCHLIST && window.STRYKER_WATCHLIST.store === 'cloud', null, { timeout: 40000 });
    await B.p.waitForFunction(() => !/watchlist=/.test(location.search), null, { timeout: 20000 }).catch(() => {});
    await B.p.waitForTimeout(500);
    s = await B.p.evaluate(() => ({ v: !!window.STRYKER_WATCHLIST.viewing, name: window.STRYKER_WATCHLIST.current && window.STRYKER_WATCHLIST.current.name, url: location.search }));
    const tx = await toastText(B.p);
    t('B: the copy survived a reload (saved in B\'s account)', await B.p.evaluate(() => window.STRYKER_WATCHLIST.lists.some((l) => /\(copy\)/.test(l.name))));
    t('B: link no longer works after share off', !s.v && !/watchlist=/.test(s.url), { s, tx });
    await B.p.screenshot({ path: OUT + 'e2e-B-link-off.png' });
    t('no page errors (B)', B.p.errs.length === 0, B.p.errs);
    await B.ctx.close();

    // ---- A: upload a list with unknown symbols
    await A.p.click('.stkw-title');
    await A.p.click('.stkw-menu:not([hidden]) .stkw-mi:has-text("Upload list")');
    fs.writeFileSync(OUT + '../upload-test.txt', '###INDEX\nCME_MINI:NQ1!,ES1!\nFOOBAR\n###METALS\nCOMEX:GC1!\nZZZ999\n###CRYPTO\nBINANCE:BTCUSDT\nETH\n');
    await A.p.setInputFiles('.stkw-dlg input[type=file]', OUT + '../upload-test.txt');
    await A.p.waitForTimeout(800);
    s = await A.p.evaluate(() => document.querySelector('.stkw-dlg .stkw-dbody').textContent);
    t('upload: reports the 2 unknown symbols', /5 symbols found/.test(s) && /2 not recognised and NOT added/.test(s) && /FOOBAR/.test(s) && /ZZZ999/.test(s), s.slice(-160));
    await A.p.screenshot({ path: OUT + 'e2e-upload.png' });
    await A.p.click('.stkw-dlg .stkw-pbtn');
    await A.p.waitForTimeout(2000);
    s = await A.p.evaluate(() => ({ name: window.STRYKER_WATCHLIST.current.name, items: window.STRYKER_WATCHLIST.current.items, n: window.STRYKER_WATCHLIST.lists.length }));
    t('upload: new list with sections', s.n === 2 && s.items.join() === '###INDEX,futures:NQ1!,futures:ES1!,###METALS,futures:GC1!,###CRYPTO,binance:BTCUSDT,binance:ETHUSDT', s);

    // ---- A: Add alert on the list (2 selected rows)
    await A.p.waitForFunction(() => [...document.querySelectorAll('.stkw-row .stkw-last')].filter((x) => /\d/.test(x.textContent)).length >= 5, null, { timeout: 30000 }).catch(() => {});
    await A.p.evaluate(() => window.STRYKER_WATCHLIST.selectMany(['futures:NQ1!', 'binance:BTCUSDT']));
    await A.p.click('.stkw-title');
    await A.p.click('.stkw-menu:not([hidden]) .stkw-mi:has-text("Add alert on the list")');
    await A.p.waitForTimeout(500);
    s = await A.p.evaluate(() => [...document.querySelectorAll('.stkw-dlg .stkw-arow:not(.stkw-acond)')].map((r) => r.textContent + '=' + r.querySelector('input[type=number]').value));
    t('list alerts: dialog lists the 2 selected rows, prefilled', s.length === 2 && s.every((x) => /=\d/.test(x)), s);
    await A.p.screenshot({ path: OUT + 'e2e-list-alerts.png' });
    await A.p.click('.stkw-dlg .stkw-pbtn');
    await A.p.waitForTimeout(2500);
    const al = await A.p.evaluate(async () => { const q = await firebase.firestore().collection('students').doc(firebase.auth().currentUser.uid).collection('chartAlerts').get(); return q.docs.map((d) => d.data().symbol + ':' + d.data().cond); });
    t('list alerts: 2 alerts saved to the account', al.length === 2 && al.some((x) => x.startsWith('futures:NQ1!')) && al.some((x) => x.startsWith('binance:BTCUSDT')), al);
    t('no page errors (A)', A.p.errs.length === 0, A.p.errs);
    await A.ctx.close();
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
