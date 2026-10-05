// Charts layout menu e2e: local dev server, REAL Firebase, two throwaway users.
// E2E_CREDS=/path/creds.json node tools/tests/chart-layouts-e2e.js <base> <outdir>  (creds file: {A:{email,password},B:{...}}, throwaway @example.invalid users, never committed)
const { launch } = require('/root/projects/wt/t6-layouts/tools/tests/lib.js');
const fs = require('fs');
const U = JSON.parse(fs.readFileSync(process.env.E2E_CREDS, 'utf8'));
const BASE = process.argv[2], OUT = process.argv[3];
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 260)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(b, who, w, h, url, mobile) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, acceptDownloads: true, isMobile: !!mobile, hasTouch: !!mobile,
    userAgent: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' : undefined });
  await ctx.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (/install_prompt|push_prompt/.test(k)) {} } catch (e) {} });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => { p.errs.push(e.message); console.log('pageerror', who, e.message.slice(0, 150)); });
  p.on('dialog', (d) => d.accept());
  await p.goto(BASE + '/charts.html', { waitUntil: 'load' });
  await p.waitForFunction(() => window.firebase && firebase.apps.length, null, { timeout: 30000 });
  await p.evaluate(async (u) => { await firebase.auth().signInWithEmailAndPassword(u.email, u.password); }, U[who]);
  await p.goto(BASE + (url || '/charts.html'), { waitUntil: 'load' });
  await p.waitForFunction(() => window.STRYKER_LAYOUTS && firebase.auth().currentUser, null, { timeout: 40000 });
  await p.waitForTimeout(2500);
  return { ctx, p };
}
const shot = (p, n) => p.screenshot({ path: OUT + '/' + n + '.png' });
const L = (p, fn, arg) => p.evaluate(fn, arg);
const btnText = (p) => p.$eval('#stkl-btn', (e) => e.textContent.trim());

(async () => {
  const b = await launch();
  let shareId = null;
  try {
    // ================= A
    const A = await session(b, 'A', 1440, 900);
    t('A: menu button present, unsaved', /Unsaved layout/.test(await btnText(A.p)), await btnText(A.p));
    await A.p.click('#stkl-btn'); await A.p.waitForTimeout(300);
    await shot(A.p, 'e2e-menu-unsaved-1440');
    const items = await A.p.$$eval('#stkl-pop .stkl-item', (a) => a.map((x) => x.textContent.trim() + (x.disabled ? '(off)' : '')));
    t('A: menu items', items.join('|').includes('Save layout') && items.join('|').includes('Open layout') && items.join('|').includes('Download chart data'), items);
    await A.p.keyboard.press('Escape');
    // Ctrl+S on unsaved -> name dialog
    await A.p.evaluate(() => window.STRYKER_CHART_UI.setLayout('2h'));
    await A.p.waitForTimeout(1500);
    await A.p.keyboard.press('Control+s');
    await A.p.waitForSelector('.stkl-dlg input');
    await A.p.fill('.stkl-dlg input', 'E2E NQ pair');
    await shot(A.p, 'e2e-save-dialog-1440');
    await A.p.click('.stkl-dlg .stkc-sbtn');
    await A.p.waitForFunction(() => window.STRYKER_LAYOUTS.current && window.STRYKER_LAYOUTS.current.name === 'E2E NQ pair', null, { timeout: 15000 });
    const id1 = await L(A.p, () => window.STRYKER_LAYOUTS.current.id);
    t('A: Ctrl+S saves a new layout', /^[A-Za-z0-9]{20}$/.test(id1), id1);
    // Autosave: change interval, wait 2s+, read doc from Firestore
    await L(A.p, () => window.STRYKER_VELA.active.setTimeframe('5'));
    const dirty = await A.p.waitForFunction(() => window.STRYKER_LAYOUTS.dirty, null, { timeout: 3000, polling: 50 }).then(() => true).catch(() => false);
    const t0 = Date.now();
    await A.p.waitForFunction(() => !window.STRYKER_LAYOUTS.dirty, null, { timeout: 8000, polling: 50 }).catch(() => {});
    const savedAfter = Date.now() - t0;
    console.log('autosave fired', savedAfter, 'ms after the dirty mark');
    await A.p.waitForTimeout(1200);
    const after = await L(A.p, async (id) => { const d = await firebase.firestore().collection('students').doc(firebase.auth().currentUser.uid).collection('chartLayouts').doc(id).get(); const x = d.data(); return { interval: x.interval, layout: JSON.parse(x.state).layout, shared: x.shared, dirty: window.STRYKER_LAYOUTS.dirty }; }, id1);
    t('A: autosave 2 s after a change', dirty === true && after.interval === '5' && after.layout === '2h' && after.dirty === false, { dirty, after });
    // Autosave off -> change not saved
    await L(A.p, () => localStorage.setItem('stryker_chart_layout_auto_' + firebase.auth().currentUser.uid, 'false'));
    await L(A.p, () => window.STRYKER_VELA.active.setTimeframe('15'));
    await A.p.waitForTimeout(3500);
    const off = await L(A.p, async (id) => { const d = await firebase.firestore().collection('students').doc(firebase.auth().currentUser.uid).collection('chartLayouts').doc(id).get(); return { interval: d.data().interval, dirty: window.STRYKER_LAYOUTS.dirty }; }, id1);
    t('A: autosave off keeps the doc unchanged (dirty dot)', off.interval === '5' && off.dirty === true, off);
    await shot(A.p, 'e2e-dirty-dot-1440');
    await L(A.p, () => localStorage.setItem('stryker_chart_layout_auto_' + firebase.auth().currentUser.uid, 'true'));
    await L(A.p, () => window.STRYKER_LAYOUTS.saveNow(true));
    // Rename
    await A.p.click('#stkl-btn'); await A.p.click('#stkl-pop .stkl-item:has-text("Rename")');
    await A.p.fill('.stkl-dlg input', 'E2E NQ pair renamed'); await A.p.click('.stkl-dlg .stkc-sbtn');
    await A.p.waitForTimeout(1500);
    t('A: rename', /E2E NQ pair renamed/.test(await btnText(A.p)), await btnText(A.p));
    // Make a copy
    await A.p.click('#stkl-btn'); await A.p.click('#stkl-pop .stkl-item:has-text("Make a copy")');
    await A.p.click('.stkl-dlg .stkc-sbtn');
    await A.p.waitForTimeout(2000);
    const id2 = await L(A.p, () => window.STRYKER_LAYOUTS.current.id);
    t('A: make a copy -> new id, "(copy)" name', id2 !== id1 && /\(copy\)/.test(await btnText(A.p)), [id2, await btnText(A.p)]);
    // Create new
    await A.p.click('#stkl-btn'); await A.p.click('#stkl-pop .stkl-item:has-text("Create new layout")');
    await A.p.fill('.stkl-dlg input', 'E2E fresh'); await A.p.click('.stkl-dlg .stkc-sbtn');
    await A.p.waitForTimeout(2500);
    const fresh = await L(A.p, () => ({ n: window.STRYKER_VELA.cells().length, name: window.STRYKER_LAYOUTS.current && window.STRYKER_LAYOUTS.current.name }));
    t('A: create new layout = 1 chart, saved', fresh.n === 1 && fresh.name === 'E2E fresh', fresh);
    // Recent
    await A.p.click('#stkl-btn'); await A.p.waitForTimeout(300);
    const rec = await A.p.$$eval('.stkl-rec span', (a) => a.map((x) => x.textContent));
    t('A: recently used lists the others', rec.includes('E2E NQ pair renamed') && rec.some((x) => /copy/.test(x)), rec);
    await shot(A.p, 'e2e-menu-recent-1440');
    // Open via recent
    await A.p.evaluate(() => [...document.querySelectorAll('.stkl-rec')].find((b) => b.querySelector('span').textContent === 'E2E NQ pair renamed').click());
    await A.p.waitForTimeout(3000);
    const op = await L(A.p, () => ({ id: window.STRYKER_LAYOUTS.current.id, layout: window.STRYKER_VELA.layout.id }));
    t('A: open from Recent restores the 2-chart layout', op.id === id1 && op.layout === '2h', op);
    // Open dialog: search + delete
    await A.p.click('#stkl-btn'); await A.p.click('#stkl-pop .stkl-item:has-text("Open layout")');
    await A.p.waitForSelector('.stkl-row');
    const rows = await A.p.$$eval('.stkl-row', (a) => a.map((x) => x.textContent));
    await shot(A.p, 'e2e-open-dialog-1440');
    await A.p.fill('.stkl-dlg input[type=search]', 'fresh');
    const rows2 = await A.p.$$eval('.stkl-row', (a) => a.map((x) => x.querySelector('b').textContent));
    t('A: open dialog lists 3 with subtitle + time, search filters', rows.length === 3 && rows.some((r) => /NQ1! · 15m|NQ1! · 5m/.test(r) && /ago|just now/.test(r)) && rows2.length === 1 && rows2[0] === 'E2E fresh', { rows, rows2 });
    await A.p.click('.stkl-li .stkc-del');
    await A.p.waitForTimeout(1500);
    const rows3 = await A.p.$$eval('.stkl-row b', (a) => a.map((x) => x.textContent));
    await A.p.keyboard.press('Escape');
    const n3 = (await L(A.p, () => window.STRYKER_LAYOUTS.list())).length;
    t('A: delete from Open dialog', rows3.length === 0 && n3 === 2, { rows3, n3 });
    // Share on
    await A.p.click('#stkl-btn');
    await A.p.click('#stkl-pop .stkg-swrow:has-text("Share layout") input');
    await A.p.waitForTimeout(2500);
    shareId = await L(A.p, () => window.STRYKER_LAYOUTS.current.shared && window.STRYKER_LAYOUTS.current.id);
    const clip = await A.p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    t('A: share on + link copied', shareId === id1 && clip.endsWith('?layout=' + id1), clip);
    await A.p.click('#stkl-btn'); await A.p.waitForTimeout(300);
    await shot(A.p, 'e2e-menu-shared-1440');
    await A.p.keyboard.press('Escape');
    // CSV
    await A.p.waitForTimeout(1500);
    await A.p.click('#stkl-btn'); await A.p.click('#stkl-pop .stkl-item:has-text("Download chart data")');
    await A.p.waitForSelector('.stkl-dlg .stkl-info');
    await shot(A.p, 'e2e-csv-dialog-1440');
    const dlgText = await A.p.$eval('.stkl-dlg', (e) => e.textContent);
    const [dl] = await Promise.all([A.p.waitForEvent('download'), A.p.click('.stkl-dlg .stkc-sbtn')]);
    const path = OUT + '/e2e-' + dl.suggestedFilename(); await dl.saveAs(path);
    const csv = fs.readFileSync(path, 'utf8').trim().split('\n');
    const tz = await L(A.p, () => window.STRYKER_VELA.timezone);
    t('CSV: dialog says For personal use', /For personal use\./.test(dlgText), dlgText.slice(0, 160));
    t('CSV: header + rows in member timezone', csv.length > 20 && csv[0].startsWith('time (' + tz + '),open,high,low,close,volume') && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,[\d.]+,[\d.]+,[\d.]+,[\d.]+,/.test(csv[1]), { tz, head: csv[0], r1: csv[1], n: csv.length, file: dl.suggestedFilename() });
    // CSV with an indicator: add EMA via Pine example if available, else native VWAP
    const addInd = await L(A.p, async () => { try { const h = window.STRYKER_VELA.active.chart.addNativeIndicator('vwap'); await new Promise((r) => setTimeout(r, 2500)); return !!h; } catch (e) { return String(e); } });
    const csv2 = await L(A.p, () => { const r = window.STRYKER_LAYOUTS.csv(); return { head: r.csv.split('\n')[0], cols: r.indCols, row: r.csv.split('\n')[r.rows] }; });
    t('CSV: indicator plot columns', csv2.cols >= 1, { addInd, csv2 });
    await L(A.p, () => window.STRYKER_LAYOUTS.saveNow(false));
    await A.p.waitForTimeout(1500);

    // ================= B opens A's link (read-only)
    const before = await L(A.p, async (id) => (await firebase.firestore().collection('students').doc(firebase.auth().currentUser.uid).collection('chartLayouts').doc(id).get()).data().state, id1);
    const B = await session(b, 'B', 1440, 900, '/charts?layout=' + id1);
    await B.p.waitForFunction(() => window.STRYKER_LAYOUTS.viewing, null, { timeout: 20000 }).catch(() => {});
    await B.p.waitForTimeout(3000);
    const bv = await L(B.p, () => ({ viewing: window.STRYKER_LAYOUTS.viewing, layout: window.STRYKER_VELA.layout.id, banner: !!document.querySelector('.stkl-banner'), btn: document.getElementById('stkl-btn').textContent, persist: window.STRYKER_VELA.persistKey }));
    t('B: opens shared layout read-only (banner, Viewing:, persistence paused)', bv.viewing && bv.layout === '2h' && bv.banner && /Viewing/.test(bv.btn) && bv.persist === null, bv);
    await shot(B.p, 'e2e-b-viewing-1440');
    // B changes something; Ctrl+S => Make a copy dialog, never writes A's
    await L(B.p, () => window.STRYKER_VELA.active.setTimeframe('60'));
    await B.p.waitForTimeout(3000);
    const bw = await L(B.p, async (id) => { try { await firebase.firestore().collection('chartShared').doc(id).set({ ownerUid: firebase.auth().currentUser.uid, name: 'hijack', state: '{}', updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); return 'WROTE'; } catch (e) { return e.code; } }, id1);
    const bw2 = await L(B.p, async (id) => { try { await firebase.firestore().collection('chartShared').doc(id).delete(); return 'DELETED'; } catch (e) { return e.code; } }, id1);
    const bl = await L(B.p, async () => { try { await firebase.firestore().collection('chartShared').limit(5).get(); return 'LISTED'; } catch (e) { return e.code; } });
    t('B: cannot overwrite / delete / list shared', bw === 'permission-denied' && bw2 === 'permission-denied' && bl === 'permission-denied', [bw, bw2, bl]);
    const after2 = await L(A.p, async (id) => (await firebase.firestore().collection('students').doc(firebase.auth().currentUser.uid).collection('chartLayouts').doc(id).get()).data().state, id1);
    t("B's change did not touch A's copy", after2 === before);
    await B.p.keyboard.press('Control+s');
    await B.p.waitForSelector('.stkl-dlg input');
    await B.p.click('.stkl-dlg .stkc-sbtn');
    await B.p.waitForTimeout(2500);
    const bc = await L(B.p, async () => ({ viewing: window.STRYKER_LAYOUTS.viewing, cur: window.STRYKER_LAYOUTS.current, n: (await window.STRYKER_LAYOUTS.list()).length, persist: window.STRYKER_VELA.persistKey, url: location.search }));
    t('B: Make a copy -> own layout, read-only ends', !bc.viewing && bc.cur && /\(copy\)/.test(bc.cur.name) && bc.n === 1 && bc.persist === 'vela-workspace' && !bc.url.includes('layout='), bc);
    await shot(B.p, 'e2e-b-copied-1440');
    // Phone view of shared link
    const Bm = await session(b, 'B', 390, 844, '/charts?layout=' + id1, true);
    await Bm.p.waitForTimeout(3000);
    t('B phone: shared link opens read-only', await L(Bm.p, () => !!window.STRYKER_LAYOUTS.viewing && !!document.querySelector('.stkl-banner') && document.documentElement.scrollWidth <= 391));
    await shot(Bm.p, 'e2e-b-viewing-390');
    await Bm.p.click('#stkl-btn'); await Bm.p.waitForTimeout(300);
    await shot(Bm.p, 'e2e-b-menu-390');
    await Bm.ctx.close();

    // ================= A turns share off -> link fails
    await A.p.click('#stkl-btn');
    await A.p.click('#stkl-pop .stkg-swrow:has-text("Share layout") input');
    await A.p.waitForTimeout(2500);
    const B2 = await session(b, 'B', 1440, 900, '/charts?layout=' + id1);
    await B2.p.waitForTimeout(3000);
    const gone = await L(B2.p, async (id) => ({ viewing: window.STRYKER_LAYOUTS.viewing, toast: [...document.querySelectorAll('.toast, [class*=toast]')].map((x) => x.textContent).join(' | ').slice(0, 200), get: await firebase.firestore().collection('chartShared').doc(id).get().then((d) => d.exists ? 'EXISTS' : 'MISSING').catch((e) => e.code) }), id1);
    t('Share off -> link fails for B', !gone.viewing && gone.get !== 'EXISTS', gone);
    await shot(B2.p, 'e2e-b-gone-1440');
    await B2.ctx.close(); await B.ctx.close();
    // A phone menu
    const Am = await session(b, 'A', 390, 844, '/charts.html', true);
    await Am.p.click('#stkl-btn'); await Am.p.waitForTimeout(300);
    const pr = await Am.p.$eval('#stkl-pop', (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), document.documentElement.scrollWidth]; });
    t('A phone: menu on screen', pr[0] >= 0 && pr[1] <= 390 && pr[2] <= 391, pr);
    await shot(Am.p, 'e2e-a-menu-390');
    t('no page errors', A.p.errs.length + B.p.errs.length + Am.p.errs.length === 0, A.p.errs.concat(B.p.errs, Am.p.errs).slice(0, 3));
    await Am.ctx.close(); await A.ctx.close();
  } catch (e) { fail++; console.log('FAIL exception', e.message.slice(0, 400)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
})();
