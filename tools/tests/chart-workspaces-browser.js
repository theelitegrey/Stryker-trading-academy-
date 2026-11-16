// Charts WORKSPACES browser test (assets/chart-workspaces.js). No network: recorded NQ bars (phone-layouts-lib.js)
// + an in-memory Firestore in this node process shared by every page of a context (the "server"), so a reload
// reads back what the page wrote. The rules themselves: tools/tests/chart-workspaces-rules-test.py.
//   node tools/tests/chart-fixture-server.mjs 8263 tools/tests/fixtures/empty.json   (or python3 -m http.server)
//   CHART_BASE=http://127.0.0.1:8263 flock -w 3600 /tmp/stryker-chrome.lock node tools/tests/chart-workspaces-browser.js <outDir>
// Checks: create 2 workspaces with different symbols + grids + panels, switch back and forth (tabs, list,
// Ctrl+2 / Ctrl+1), reload -> both restored (index + charts), rename, drag reorder, delete, signed-out mode,
// phone bottom sheet; screenshots at 390 / 412 / 1440 in dark + light.
const fs = require('fs');
const { launch } = require('./lib.js');
const { newCtx, sleep } = require('./phone-layouts-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8263';
const OUT = process.argv[2] || '.';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };

const DB = new Map();
DB.set('students/alice', { name: 'Alice', plan: 'Elite', residenceCountry: 'US', sanctionsAttest: true, emailVerified: true });   // geo gate already answered
const rev = (v) => { if (Array.isArray(v)) return v.map(rev); if (v && typeof v === 'object') { if (v.__ts) return { __ms: Date.now() }; const o = {}; for (const k in v) o[k] = rev(v[k]); return o; } return v; };
const denied = () => { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; };
const mine = (uid, path) => { const s = path.split('/'); return !!uid && (s[0] !== 'students' || s[1] === uid); };
let writes = 0;
const server = {
  get: (uid, path) => { if (!mine(uid, path)) denied(); return { exists: DB.has(path), data: DB.get(path) || null }; },
  commit: (uid, ws) => {
    ws.forEach((w) => { if (!mine(uid, w.path)) denied(); });
    ws.forEach((w) => {
      writes++;
      const cur = DB.get(w.path);
      if (w.op === 'delete') DB.delete(w.path);
      else if (w.op === 'set') DB.set(w.path, w.merge && cur ? Object.assign({}, cur, rev(w.data)) : rev(w.data));
      else { if (!cur) throw Object.assign(new Error('not-found'), { code: 'not-found' }); DB.set(w.path, Object.assign({}, cur, rev(w.data))); }
    });
    return true;
  },
  query: (uid, coll) => {
    if (!mine(uid, coll)) denied();
    const n = coll.split('/').length;
    return [...DB.entries()].filter(([p]) => p.startsWith(coll + '/') && p.split('/').length === n + 1).map(([p, d]) => ({ id: p.split('/').pop(), data: d }));
  }
};
function mockInit() {
  const cl = (v) => JSON.parse(JSON.stringify(v));
  const back = (v) => { if (Array.isArray(v)) return v.map(back); if (v && typeof v === 'object') { if (v.__ms !== undefined) return { toMillis: () => v.__ms, toDate: () => new Date(v.__ms) }; const o = {}; for (const k in v) o[k] = back(v[k]); return o; } return v; };
  const U = () => window.__UID;
  const snap = (id, r) => ({ id, exists: !!r.exists, data: () => (r.exists ? back(cl(r.data)) : undefined) });
  const FV = { serverTimestamp: () => ({ __ts: 1 }), increment: (n) => ({ __inc: n }), delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' };
  const ref = (path) => ({ id: path.split('/').pop(), path,
    get: () => window.__fs('get', U(), path).then((r) => snap(path.split('/').pop(), r)),
    set: (d, o) => window.__fs('commit', U(), [{ op: 'set', path, data: d, merge: !!(o && o.merge) }]),
    update: (d) => window.__fs('commit', U(), [{ op: 'update', path, data: d }]),
    delete: () => window.__fs('commit', U(), [{ op: 'delete', path }]),
    onSnapshot: (cb) => { ref(path).get().then(cb); return () => {}; },
    collection: (s) => col(path + '/' + s) });
  const col = (path) => { const self = {
    doc: (id) => ref(path + '/' + (id || Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12))),
    where: () => self, orderBy: () => self, limit: () => self, startAfter: () => self,
    get: () => window.__fs('query', U(), path).then((rows) => { const docs = rows.map((r) => snap(r.id, { exists: true, data: r.data })); return { docs, empty: !docs.length, size: docs.length, forEach: (f) => docs.forEach(f), docChanges: () => [] }; }),
    add: async (d) => { const r = self.doc(); await r.set(d); return r; },
    onSnapshot: (cb) => { self.get().then(cb); return () => {}; } }; return self; };
  const db = { collection: col, doc: (p) => ref(p), batch: () => { const w = []; const b = { set: (r, d, o) => { w.push({ op: 'set', path: r.path, data: d, merge: !!(o && o.merge) }); return b; }, update: (r, d) => { w.push({ op: 'update', path: r.path, data: d }); return b; }, delete: (r) => { w.push({ op: 'delete', path: r.path }); return b; }, commit: () => window.__fs('commit', U(), w) }; return b; } };
  window.__stubDb = db; window.db = db;
  window.firebase.apps = [{}];
  window.firebase.firestore = Object.assign(() => db, { FieldValue: FV, Timestamp: { now: () => ({ toDate: () => new Date() }), fromDate: (d) => ({ toDate: () => d }) } });
  if (!U()) { window.__stubAuth.currentUser = null; window.__stubAuth.onAuthStateChanged = (cb) => { setTimeout(() => cb(null), 10); return () => {}; }; }
  else { const u = window.__stubAuth.currentUser; u.uid = U(); }
}
async function session(b, uid, w, h, mobile, theme) {
  const ctx = await newCtx(b, { w, h, mobile });
  await ctx.exposeFunction('__fsRaw', async (op, u, ...a) => { try { return { ok: server[op](u, ...a) }; } catch (e) { return { err: e.code || 'error', msg: e.message }; } });
  await ctx.addInitScript(([u, th]) => {
    window.__UID = u;
    window.__fs = (...a) => window.__fsRaw(...a).then((r) => { if (r.err) { const e = new Error(r.msg); e.code = r.err; throw e; } return r.ok; });
    try { localStorage.setItem('stryker_theme', th === 'light' ? 'day' : 'night'); } catch (e) {}
  }, [uid, theme || 'dark']);
  await ctx.addInitScript('(' + mockInit.toString() + ')()');
  return ctx;
}
async function open(ctx, page){
  const p = page || await ctx.newPage();
  if (!page) { p.errs = []; p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) p.errs.push(String(e).slice(0, 200)); }); p.on('dialog', (d) => d.accept()); }
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_LAYOUTS && window.STRYKER_WORKSPACES, null, { timeout: 60000 });
  await sleep(2500);
  return p;
}
const shot = (p, n) => p.screenshot({ path: OUT + '/' + n + '.png' });
const W = (p, fn, a) => p.evaluate(fn, a);
// what is on screen: grid + each visible chart's symbol / interval
const screen = (p) => W(p, () => { const s = window.STRYKER_VELA.getState(); const n = (/^(\d+)/.exec(s.layout || '') || [0, 1])[1]; return { layout: s.layout, charts: s.charts.slice(0, +n).map((c) => c.symbol + '@' + c.timeframe) }; });
const waitIdle = (p) => p.waitForFunction(() => !window.STRYKER_WORKSPACES.busy, null, { timeout: 15000 }).then(() => sleep(1500));

(async () => {
  const b = await launch();
  try {
    // ================================================================ signed in, desktop 1440
    const A = await session(b, 'alice', 1440, 900, false);
    const a = await open(A);
    t('button in the top bar with the workspace name', /Workspace 1/.test(await a.$eval('#stkws-btn', (e) => e.textContent)));
    t('top bar: one tab (active) after the logo, in the top bar not the toolbar', await W(a, () => { const t = document.querySelectorAll('#stkws-tabs .stkws-tab.on'); const lg = document.querySelector('.topnav-left .brand-mark').getBoundingClientRect(); const r = t[0] && t[0].getBoundingClientRect(); return t.length === 1 && !!t[0].closest('.mobile-topnav') && r.left > lg.right && !document.querySelector('#stkc-bar #stkws-btn'); }));
    t('logo ~18px tall, tab 30px, same centre line (+-3px)', await W(a, () => { const l = document.querySelector('.topnav-left .brand-mark').getBoundingClientRect(), r = document.querySelector('.stkws-tab').getBoundingClientRect(); return Math.round(l.height) <= 18 && Math.round(r.height) === 30 && Math.abs((l.top + l.height / 2) - (r.top + r.height / 2)) <= 3; }));
    await a.click('#stkws-plus, .stkws-plus'); await a.waitForSelector('.stkws-dlg input'); await a.fill('.stkws-dlg input', 'Tab add'); await a.click('.stkws-dlg .stkc-sbtn'); await waitIdle(a);
    t('+ adds a workspace and opens it', await W(a, () => { const x = window.STRYKER_WORKSPACES.index; return x.items.length === 2 && x.items[1].name === 'Tab add' && document.querySelectorAll('.stkws-tab').length === 2; }));
    await a.click('.stkws-tab >> nth=0'); await waitIdle(a);
    t('clicking a tab switches', await W(a, () => window.STRYKER_WORKSPACES.active.name === 'Workspace 1'));
    await a.click('.stkws-tab >> nth=1', { button: 'right' });
    t('right-click opens the workspace menu (details: chart-wsmenu-browser.js)', await W(a, () => !!document.querySelector('.stkws-cm .stkws-cm-it') && [...document.querySelectorAll('.stkws-cm-l')].some((x) => x.textContent === 'Rename')));
    await a.keyboard.press('Escape');
    await a.click('.stkws-tab >> nth=1', { button: 'middle' }); await waitIdle(a);
    t('middle-click closes (kept saved, no delete)', await W(a, () => { const x = window.STRYKER_WORKSPACES.index; return x.items.length === 2 && x.items[1].closed === true && document.querySelectorAll('.stkws-tab').length === 1; }));
    await W(a, () => window.STRYKER_WORKSPACES.remove(window.STRYKER_WORKSPACES.index.items[1].id)); await waitIdle(a);   // delete the closed one (confirm accepted)
    t('closed workspace deleted for good', await W(a, () => window.STRYKER_WORKSPACES.index.items.length === 1));
    // workspace 1: NQ, 2 charts side by side, watchlist open at 300 px
    await W(a, async () => {
      window.STRYKER_CHART_UI.setLayout('2h'); await new Promise((r) => setTimeout(r, 1200));
      const ws = window.STRYKER_VELA; const c = ws.cells();
      c[0].setSymbol('futures:NQ1!'); c[0].setTimeframe('5'); c[1].setSymbol('futures:ES1!'); c[1].setTimeframe('15');
      window.STRYKER_WATCHLIST.setOpen(true); window.STRYKER_WATCHLIST.setWidth(300);
    });
    await sleep(1500);
    const s1 = await screen(a);
    await W(a, () => window.STRYKER_WORKSPACES.rename(window.STRYKER_WORKSPACES.active.id, 'NQ scalping'));
    // workspace 2 from the list: New workspace…
    await a.click('#stkws-btn'); await sleep(300);
    await shot(a, 'ws-list-1440-dark-1');
    await a.click('#stkws-pop .stkws-act:has-text("New workspace")');
    await a.waitForSelector('.stkws-dlg input');
    await a.fill('.stkws-dlg input', 'BTC order flow');
    await shot(a, 'ws-new-dialog-1440-dark');
    await a.click('.stkws-dlg .stkc-sbtn');
    await waitIdle(a);
    t('new workspace opens a fresh single chart', (await screen(a)).charts.length === 1, await screen(a));
    t('switching away closed the watchlist (panels are per workspace)', await W(a, () => !window.STRYKER_WATCHLIST.open));
    await W(a, async () => {
      window.STRYKER_CHART_UI.setLayout('4'); await new Promise((r) => setTimeout(r, 1200));
      const c = window.STRYKER_VELA.cells();
      c[0].setSymbol('crypto:BTCUSDT'); c[0].setTimeframe('1'); c[1].setSymbol('crypto:ETHUSDT'); c[1].setTimeframe('5');
      window.__stkBookPanel && window.__stkBookPanel.open();
    });
    await sleep(2500);
    const s2 = await screen(a);
    t('workspace 2 differs (4 charts, BTC)', s2.layout === '4' && s2.charts[0] === 'crypto:BTCUSDT@1' && s1.layout === '2h' && s1.charts[0] === 'futures:NQ1!@5', { s1, s2 });
    t('tab strip shows 2 tabs, second active', await W(a, () => { const t = [...document.querySelectorAll('#stkws-tabs .stkws-tab')]; return !document.getElementById('stkws-tabs').hidden && t.length === 2 && t[1].classList.contains('on') && t[1].textContent === 'BTC order flow'; }));
    await shot(a, 'ws-tabs-1440-dark');
    // Ctrl+1 -> back to NQ, instantly (from memory)
    const t0 = Date.now();
    await a.keyboard.press('Control+1');
    await waitIdle(a);
    const back1 = await screen(a);
    t('Ctrl+1 restores workspace 1 (grid + symbols + intervals)', JSON.stringify(back1) === JSON.stringify(s1), { back1, s1 });
    t('workspace 1 panels back: watchlist open at 300 px, book closed', await W(a, () => window.STRYKER_WATCHLIST.open && window.STRYKER_WATCHLIST.width === 300 && !(window.__stkBookPanel && window.__stkBookPanel.isOpen)), await W(a, () => [window.STRYKER_WATCHLIST.open, window.STRYKER_WATCHLIST.width, window.__stkBookPanel && window.__stkBookPanel.isOpen]));
    const sw = await W(a, async () => { const t = performance.now(); await window.STRYKER_WORKSPACES.switchTo(window.STRYKER_WORKSPACES.index.items[1].id); const d = performance.now() - t; await window.STRYKER_WORKSPACES.switchTo(window.STRYKER_WORKSPACES.index.items[0].id); return d; });
    t('switch from memory is fast (< 1500 ms to apply)', sw < 1500, Math.round(sw));
    t('both chart documents kept in memory', await W(a, () => window.STRYKER_WORKSPACES.cached.length === 2));
    // Ctrl+2 -> BTC
    await a.keyboard.press('Control+2');
    await waitIdle(a);
    const back2 = await screen(a);
    t('Ctrl+2 switches to workspace 2', JSON.stringify(back2) === JSON.stringify(s2), { back2, s2 });
    t('workspace 2 panels back: book open, watchlist closed', await W(a, () => !window.STRYKER_WATCHLIST.open && !!(window.__stkBookPanel && window.__stkBookPanel.isOpen)));
    // switching saved the layouts (signed in: one chartLayouts doc per workspace, named after it)
    await sleep(2500);
    const lays = [...DB.entries()].filter(([k]) => k.startsWith('students/alice/chartLayouts/'));
    const names = lays.map(([, v]) => v.name).sort();
    t('each workspace saved as a layout', names.includes('NQ scalping') && names.includes('BTC order flow'), names);
    const ixDoc = DB.get('students/alice/chartPrefs/workspaces');
    t('index synced to chartPrefs/workspaces (index string + updatedAt only)', !!ixDoc && typeof ixDoc.index === 'string' && Object.keys(ixDoc).sort().join() === 'index,updatedAt' && ixDoc.index.length <= 20000);
    // an edit in workspace 2, then reload WITHOUT switching (crash-like): it must come back
    await W(a, () => window.STRYKER_VELA.cells()[1].setTimeframe('15'));
    await sleep(3000);
    const s2b = await screen(a);
    await open(A, a);
    await a.waitForFunction(() => window.STRYKER_WORKSPACES.index.items.length === 2, null, { timeout: 10000 }).catch(() => {});
    const r2 = await screen(a);
    t('reload: active workspace (2) restored with the last edit', JSON.stringify(r2) === JSON.stringify(s2b) && /BTC order flow/.test(await a.$eval('#stkws-btn', (e) => e.textContent)), { r2, s2b });
    t('reload: both workspaces listed, order kept', await W(a, () => window.STRYKER_WORKSPACES.index.items.map((x) => x.name).join('|')) === 'NQ scalping|BTC order flow');
    await a.keyboard.press('Control+1');
    await waitIdle(a);
    t('reload then Ctrl+1: workspace 1 restored from the saved layout', JSON.stringify(await screen(a)) === JSON.stringify(s1), await screen(a));
    await a.keyboard.press('Control+2');
    await waitIdle(a);
    t('and Ctrl+2 back to workspace 2', JSON.stringify(await screen(a)) === JSON.stringify(s2b), await screen(a));
    t('Ctrl+3 with 2 workspaces does nothing', await (async () => { await a.keyboard.press('Control+3'); await sleep(500); return JSON.stringify(await screen(a)) === JSON.stringify(s2b); })());

    // third workspace via Duplicate, then reorder by dragging its tab first, then delete it
    await W(a, () => window.STRYKER_WORKSPACES.duplicate()); await waitIdle(a);
    t('duplicate: 3 workspaces, copy has the same charts', await W(a, () => window.STRYKER_WORKSPACES.index.items.length) === 3 && JSON.stringify(await screen(a)) === JSON.stringify(s2b));
    await W(a, () => window.STRYKER_WORKSPACES.rename(window.STRYKER_WORKSPACES.active.id, 'GEX swing'));
    await sleep(300);
    const tabs = await a.$$('#stkws-tabs .stkws-tab');
    const bb = await tabs[2].boundingBox(), fb0 = await tabs[0].boundingBox();
    await a.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await a.mouse.down();
    await a.mouse.move(bb.x - 40, bb.y + bb.height / 2, { steps: 6 }); await a.mouse.move(fb0.x + 4, fb0.y + fb0.height / 2, { steps: 8 }); await a.mouse.up();
    await sleep(500);
    t('drag the tab to the front reorders', await W(a, () => window.STRYKER_WORKSPACES.index.items.map((x) => x.name).join('|')) === 'GEX swing|NQ scalping|BTC order flow', await W(a, () => window.STRYKER_WORKSPACES.index.items.map((x) => x.name).join('|')));
    await a.click('#stkws-btn'); await sleep(300);
    await shot(a, 'ws-list-1440-dark');
    t('list: 3 rows, sub-labels, shortcut hints, active checked', await W(a, () => { const r = [...document.querySelectorAll('#stkws-pop .stkws-li')]; return r.length === 3 && r[0].classList.contains('on') && /BTCUSDT/.test(r[0].textContent) && /1/.test(r[0].querySelector('.stkws-kbd').textContent); }));
    await a.keyboard.press('Escape');
    await W(a, () => window.STRYKER_WORKSPACES.remove(window.STRYKER_WORKSPACES.active.id)); await waitIdle(a);
    const del = { names: await W(a, () => window.STRYKER_WORKSPACES.index.items.map((x) => x.name).join('|')), scr: await screen(a), kept: [...DB.values()].some((v) => v && v.name === 'GEX swing') };
    t('delete the active one: 2 left, the next one opens, its layout kept', del.names === 'NQ scalping|BTC order flow' && JSON.stringify(del.scr) === JSON.stringify(s1) && del.kept, del);
    t('no page errors (desktop)', !a.errs.length, a.errs);

    await A.close();
    // light theme at 1440 (a fresh load in light, same account)
    const AL = await session(b, 'alice', 1440, 900, false, 'light');
    const al = await open(AL);
    await sleep(1500);
    await shot(al, 'ws-tabs-1440-light');
    await al.click('#stkws-btn'); await sleep(300); await shot(al, 'ws-list-1440-light'); await al.keyboard.press('Escape');
    t('1440 light: no page errors', !al.errs.length, al.errs);
    await AL.close();

    // ================================================================ phones: 390 and 412, dark + light (same account, server shared)
    for (const [w, h] of [[390, 844], [412, 915]]) {
      for (const th of ['dark', 'light']) {
        const P = await session(b, 'alice', w, h, true, th);
        const p = await open(P);
        t(w + ' ' + th + ': no tab strip on a phone', await W(p, () => { const e = document.getElementById('stkws-tabs'); return !e || e.getBoundingClientRect().width === 0; }));
        const reach = await W(p, () => { const b = document.getElementById('stkws-btn'); const r = b.getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth ? 'bar' : (document.querySelector('#stkc-more-pop #stkws-btn') ? 'more' : 'none'); });
        t(w + ' ' + th + ': compact pill shows the name (phone has no site bar: it starts the toolbar)', await W(p, () => { const b = document.getElementById('stkws-btn'), n = b.querySelector('.stkws-name'); return getComputedStyle(n).display !== 'none' && n.textContent.length > 0 && b.closest('#stkc-bar') && b.getBoundingClientRect().height >= 30; }));
        t(w + ' ' + th + ': workspace control reachable (' + reach + ')', reach !== 'none');
        await shot(p, 'ws-bar-' + w + '-' + th);
        if (reach === 'more') { await p.click('#stkc-more-btn'); await sleep(400); await shot(p, 'ws-more-' + w + '-' + th); }
        await p.click('#stkws-btn'); await sleep(700);
        const sheet = await W(p, () => { const s = document.getElementById('stkws-pop'); const r = s.getBoundingClientRect(); const rows = [...s.querySelectorAll('.stkws-row')].map((x) => x.getBoundingClientRect().height); return { bottom: Math.round(innerHeight - r.bottom), w: Math.round(r.width), rows, head: !!s.querySelector('.stkc-sh') && getComputedStyle(s.querySelector('.stkc-sh')).display !== 'none' }; });
        t(w + ' ' + th + ': bottom sheet, full width, grabber head, rows >= 48 px', sheet.bottom <= 1 && sheet.w >= w - 1 && sheet.head && sheet.rows.length === 2 && sheet.rows.every((x) => x >= 47.5), sheet);
        await shot(p, 'ws-sheet-' + w + '-' + th);
        if (w === 390 && th === 'dark') {
          await p.click('#stkws-pop .stkws-row >> nth=1'); await waitIdle(p);
          t('390: tap a row switches', /BTC order flow/.test(await p.$eval('#stkws-btn', (e) => e.textContent)) && (await screen(p)).layout === s2b.layout);
          await W(p, () => window.STRYKER_WORKSPACES.switchTo(window.STRYKER_WORKSPACES.index.items[0].id)); await waitIdle(p);
        }
        t(w + ' ' + th + ': no horizontal overflow', await W(p, () => document.documentElement.scrollWidth <= innerWidth));
        t(w + ' ' + th + ': no page errors', !p.errs.length, p.errs);
        await P.close();
      }
    }

    const acc = JSON.parse(DB.get('students/alice/chartPrefs/workspaces').index);
    t('new devices never overwrite the account list (still 2 workspaces)', acc.items.map((x) => x.name).join('|') === 'NQ scalping|BTC order flow', acc.items.map((x) => x.name));

    // ================================================================ signed out: this device only
    const G = await session(b, null, 1440, 900, false);
    const g = await open(G);
    const w0 = writes;
    await W(g, async () => { window.STRYKER_CHART_UI.setLayout('2v'); await new Promise((r) => setTimeout(r, 900)); window.STRYKER_VELA.cells()[0].setSymbol('futures:GC1!'); });
    await sleep(1200);
    const gs1 = await screen(g);
    await W(g, () => window.STRYKER_WORKSPACES.createNew('Gold')); await waitIdle(g);
    await W(g, () => window.STRYKER_VELA.cells()[0].setSymbol('futures:CL1!')); await sleep(1500);
    const gs2 = await screen(g);
    await g.keyboard.press('Control+1'); await waitIdle(g);
    t('signed out: Ctrl+1 restores the first (from this device)', JSON.stringify(await screen(g)) === JSON.stringify(gs1), { now: await screen(g), gs1 });
    await open(G, g);
    t('signed out: reload keeps both + the active one', await W(g, () => window.STRYKER_WORKSPACES.index.items.length) === 2 && JSON.stringify(await screen(g)) === JSON.stringify(gs1));
    await g.keyboard.press('Control+2'); await waitIdle(g);
    t('signed out: reload then Ctrl+2 restores the second', JSON.stringify(await screen(g)) === JSON.stringify(gs2), { now: await screen(g), gs2 });
    t('signed out: nothing written to the account', writes === w0);
    t('no page errors (signed out)', !g.errs.length, g.errs);
    await G.close();
  } catch (e) { fail++; console.log('FAIL exception', String(e && e.stack || e).slice(0, 600)); }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
