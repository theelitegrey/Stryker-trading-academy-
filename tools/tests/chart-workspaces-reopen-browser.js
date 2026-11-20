// Charts WORKSPACES REOPEN test (member bug 20 Nov, thread 1571862505435955292: "saved workspaces are not opening properly when
// we reopen the platform. Only Workspace-1 is saved and restored correctly", plus Workspace-1 and Workspace-2 open at the same
// time, and a red "Could not open the layout." toast with "Unsaved layout" in the header).
// Same harness as chart-workspaces-restore-browser.js (in-memory Firestore in this node process = the "server").
// A "platform reopen" here is a NEW browser context started from the old one's storage (localStorage kept, sessionStorage
// gone), like closing and reopening the browser or the Windows app. A second device / the app next to the browser is a
// second context sharing only the server.
//   node tools/tests/chart-fixture-server.mjs 8263 <empty fixture.json>
//   CHART_BASE=http://127.0.0.1:8263 flock -w 3600 /tmp/stryker-chrome.lock node tools/tests/chart-workspaces-reopen-browser.js <outDir>
// Env: VW/VH (390x844 = phone run), THEME=dark|light.
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
const FAILGET = { n: 0, skip: 0, re: /^$/ };   // the error path: the next n reads of matching docs fail like an offline client
const server = {
  get: (uid, path) => { if (!mine(uid, path)) denied(); if (FAILGET.n > 0 && FAILGET.re.test(path)) { if (FAILGET.skip > 0) { FAILGET.skip--; return { exists: DB.has(path), data: DB.get(path) || null }; } FAILGET.n--; const e = new Error('Failed to get document because the client is offline.'); e.code = 'unavailable'; throw e; } return { exists: DB.has(path), data: DB.get(path) || null }; },
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
// every red toast and every "TradeZoro: layout open / workspace doc" warning the page shows
const watch = () => {
  window.__bad = [];
  const seen = new WeakSet();
  const scan = () => document.querySelectorAll('.toast-error').forEach((n) => { if (seen.has(n)) return; seen.add(n); window.__bad.push('toast: ' + n.textContent.trim().slice(0, 120)); });
  new MutationObserver(scan).observe(document, { childList: true, subtree: true });
  const w = console.warn.bind(console);
  console.warn = (...a) => { const s = String(a[0] || ''); if (/layout open|workspace doc|workspace layout|workspace save|workspaces sync/.test(s)) window.__bad.push('warn: ' + a.map((x) => (x && x.code) || String(x)).join(' ').slice(0, 160)); w(...a); };
};
// A context that starts from another one's localStorage (= the browser / app closed and opened again: sessionStorage is gone).
async function reopenCtx(b, uid, VW, VH, TH, dump){
  const ctx = await session(b, uid, VW, VH, VW < 700, TH);
  await ctx.addInitScript((d) => { try { if (localStorage.getItem('__reopened')) return; for (const k in d) localStorage.setItem(k, d[k]); localStorage.setItem('__reopened', '1'); } catch (e) {} }, dump);
  return ctx;
}
async function openAt(ctx, url, page){
  const p = page || await ctx.newPage();
  if (!page) { p.errs = []; p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) p.errs.push(String(e).slice(0, 200)); }); p.on('dialog', (d) => d.accept()); await p.addInitScript(watch); }
  await p.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_LAYOUTS && window.STRYKER_WORKSPACES, null, { timeout: 60000 });
  await sleep(3500);
  await p.waitForFunction(() => !window.STRYKER_WORKSPACES.busy, null, { timeout: 15000 }).catch(() => {});
  await sleep(800);
  return p;
}
const shot = (p, n) => p.screenshot({ path: OUT + '/' + n + '.png' });
const W = (p, fn, a) => p.evaluate(fn, a);
const screen = (p) => W(p, () => { const s = window.STRYKER_VELA.getState(); const n = (/^(\d+)/.exec(s.layout || '') || [0, 1])[1]; return { layout: s.layout, charts: s.charts.slice(0, +n).map((c) => c.symbol + '@' + c.timeframe) }; });
const waitIdle = (p) => p.waitForFunction(() => !window.STRYKER_WORKSPACES.busy, null, { timeout: 15000 }).then(() => sleep(1500));
const name = (p) => p.$eval('#stkws-btn', (e) => e.textContent.trim());
const bad = (p) => W(p, () => window.__bad || []);
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
// (a normal close fires pagehide, which clears the phone crash-guard mark; a copied live mark would open SAFE MODE)
const dumpLS = (p) => W(p, () => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== '__reopened' && k !== 'stryker_chart_loading') o[k] = localStorage.getItem(k); } return o; });
const build = async (p, lay, sym, sym2) => {
  await W(p, async ([l, s, s2]) => { window.STRYKER_CHART_UI.setLayout(l); await new Promise((r) => setTimeout(r, 1000)); const c = window.STRYKER_VELA.cells(); c[0].setSymbol(s); c[0].setTimeframe('5'); if (s2 && c[1]) { c[1].setSymbol(s2); c[1].setTimeframe('15'); } }, [lay, sym, sym2]);
  await sleep(1500);
};
const go = async (p, n) => { await p.keyboard.press('Control+' + n); await waitIdle(p); };
const accountIndex = () => { const d = DB.get('students/alice/chartPrefs/workspaces'); try { return d ? JSON.parse(d.index) : null; } catch (e) { return null; } };
const wsSym = (wsName) => { const ix = accountIndex(); const it = ix && ix.items.find((x) => x.name === wsName); const d = it && it.wsDoc && DB.get('students/alice/chartLayouts/' + it.wsDoc); if (!d) return 'none'; try { return JSON.parse(d.state).charts[0].symbol; } catch (e) { return 'unreadable'; } };

(async () => {
  const b = await launch();
  try {
    const VW = +process.env.VW || 1440, VH = +process.env.VH || 900, TH = process.env.THEME || 'dark', TAG = VW + '-' + TH;
    // ---------- 1) one window: two workspaces, a real layout saved inside workspace 2, then the platform is closed and reopened
    const A = await session(b, 'alice', VW, VH, VW < 700, TH);
    const a = await openAt(A, '/charts.html');
    await build(a, '2h', 'futures:NQ1!', 'futures:ES1!');
    await W(a, () => window.STRYKER_WORKSPACES.rename(window.STRYKER_WORKSPACES.active.id, 'MNQ_01'));
    const s1 = await screen(a);
    await W(a, () => window.STRYKER_WORKSPACES.createNew('MNQ_02')); await waitIdle(a);
    await build(a, '4', 'futures:RTY1!', 'futures:HG1!');
    await W(a, () => window.STRYKER_LAYOUTS.saveAsNew('MNQ two layout')); await sleep(800);
    await build(a, '4', 'futures:SI1!', 'futures:HG1!');   // a change after the save (autosave on)
    const s2 = await screen(a);
    t('setup: the two workspaces differ', !same(s1, s2), { s1, s2 });
    await sleep(4500);   // autosaves
    const url1 = await W(a, () => location.pathname + location.search);
    const dump1 = await dumpLS(a);
    await a.close(); await A.close();
    const R = await reopenCtx(b, 'alice', VW, VH, TH, dump1);
    const r = await openAt(R, url1);
    t('reopen (closed on workspace 2): workspace 2 with its own charts', (await name(r)) === 'MNQ_02' && same(await screen(r), s2), { url1, n: await name(r), now: await screen(r), s2 });
    t('reopen: no red toast / open errors', !(await bad(r)).length, await bad(r));
    await go(r, 1);
    t('reopen: workspace 1 has its own charts', same(await screen(r), s1), await screen(r));
    await go(r, 2);
    t('reopen: back to workspace 2, its charts', same(await screen(r), s2), await screen(r));
    t('reopen: layout menu shows workspace 2 layout', await W(r, () => (window.STRYKER_LAYOUTS.current || {}).name) === 'MNQ two layout', await W(r, () => window.STRYKER_LAYOUTS.current));
    t('reopen + switching: no red toast / open errors', !(await bad(r)).length, await bad(r));
    await shot(r, 'wsopen-' + TAG + '-reopen-ws2');
    // closed on workspace 1 this time
    await go(r, 1); await sleep(2500);
    const url2 = await W(r, () => location.pathname + location.search);
    const dump2 = await dumpLS(r);
    await r.close(); await R.close();
    const R2 = await reopenCtx(b, 'alice', VW, VH, TH, dump2);
    const r2 = await openAt(R2, url2);
    t('reopen (closed on workspace 1): workspace 1 with its own charts', (await name(r2)) === 'MNQ_01' && same(await screen(r2), s1), { url2, n: await name(r2), now: await screen(r2) });
    await go(r2, 2);
    t('then workspace 2: its own charts', same(await screen(r2), s2), await screen(r2));
    t('no red toast / open errors', !(await bad(r2)).length, await bad(r2));
    await r2.close(); await R2.close();

    // ---------- 2) workspace 1 and workspace 2 open AT THE SAME TIME in two windows that share only the account
    //              (the Windows app next to a browser, or two computers). Each edits its own workspace.
    const X = await reopenCtx(b, 'alice', VW, VH, TH, dump2);
    const x = await openAt(X, '/charts.html');
    const Y = await session(b, 'alice', VW, VH, VW < 700, TH);   // a second device: nothing local, only the account
    const y = await openAt(Y, '/charts.html');
    if ((await name(x)) !== 'MNQ_01') await go(x, 1);
    if ((await name(y)) !== 'MNQ_02') await go(y, 2);
    t('2 windows: one on each workspace, own charts', (await name(x)) === 'MNQ_01' && (await name(y)) === 'MNQ_02' && same(await screen(x), s1) && same(await screen(y), s2), { x: await screen(x), y: await screen(y) });
    // the second window adds a new workspace 3 and works in workspace 2; the first window works in workspace 1
    await W(y, () => window.STRYKER_WORKSPACES.createNew('MNQ_03')); await waitIdle(y);
    await build(y, '1', 'futures:CL1!');
    await sleep(4500);
    await W(x, () => { const w = window.STRYKER_WORKSPACES; w.rename(w.active.id, 'MNQ_01'); });   // any list change in X
    await build(x, '2h', 'futures:GC1!', 'futures:ES1!');
    await W(y, async () => { await window.STRYKER_WORKSPACES.switchTo(window.STRYKER_WORKSPACES.index.items.find((i) => i.name === 'MNQ_02').id); });
    await waitIdle(y);
    await build(y, '4', 'futures:YM1!', 'futures:HG1!');
    await sleep(5000);
    // window 1 writes its list LAST (a tab colour): its copy was read before window 2 added MNQ_03
    await W(x, () => { const w = window.STRYKER_WORKSPACES; w.openMenu(w.active.id, 100, 100); });
    await W(x, () => { const b = document.querySelector('.stkws-cm .stkws-cm-o.c-blue'); if (b) b.click(); });
    await sleep(4000);
    t('2 windows: neither is in phone safe mode', !(await W(x, () => !!(window.__stkSafe && window.__stkSafe.active))) && !(await W(y, () => !!(window.__stkSafe && window.__stkSafe.active))));
    const sx = await screen(x), sy = await screen(y);
    t('2 windows: each kept its own chart while the other worked', (await name(x)) === 'MNQ_01' && sx.charts[0] === 'futures:GC1!@5' && (await name(y)) === 'MNQ_02' && sy.charts[0] === 'futures:YM1!@5', { sx, sy });
    const ix = accountIndex();
    t('account list keeps all 3 workspaces, each with its own chart doc', !!ix && ix.items.length === 3 && ix.items.every((i) => i.wsDoc) && new Set(ix.items.map((i) => i.wsDoc)).size === 3, ix && ix.items.map((i) => i.name + ':' + i.wsDoc));
    t('account docs: 1=GC, 2=YM, 3=CL (nothing crossed)', wsSym('MNQ_01') === 'futures:GC1!' && wsSym('MNQ_02') === 'futures:YM1!' && wsSym('MNQ_03') === 'futures:CL1!', [wsSym('MNQ_01'), wsSym('MNQ_02'), wsSym('MNQ_03')]);
    await shot(x, 'wsopen-' + TAG + '-win1'); await shot(y, 'wsopen-' + TAG + '-win2');
    t('2 windows: no red toast / open errors', !(await bad(x)).length && !(await bad(y)).length, [await bad(x), await bad(y)]);
    const dx = await dumpLS(x), ux = await W(x, () => location.pathname + location.search);
    await x.close(); await X.close(); await y.close(); await Y.close();
    // reopen the first window's browser: its workspace 1, and workspace 2 + 3 show what the other window saved
    const Z = await reopenCtx(b, 'alice', VW, VH, TH, dx);
    const z = await openAt(Z, ux);
    const zl = await W(z, () => window.STRYKER_WORKSPACES.index.items.map((i) => i.name));
    t('reopen after 2 windows: all 3 workspaces listed', zl.length === 3, zl);
    t('reopen after 2 windows: workspace 1 = GC', (await name(z)) === 'MNQ_01' && (await screen(z)).charts[0] === 'futures:GC1!@5', { n: await name(z), s: await screen(z) });
    await go(z, 2);
    t('reopen after 2 windows: workspace 2 = what window 2 saved (YM)', (await screen(z)).charts[0] === 'futures:YM1!@5', await screen(z));
    await go(z, 3);
    t('reopen after 2 windows: workspace 3 = CL', (await screen(z)).charts[0] === 'futures:CL1!@5', await screen(z));
    t('reopen after 2 windows: no red toast / open errors', !(await bad(z)).length, await bad(z));
    await go(z, 2); await shot(z, 'wsopen-' + TAG + '-after2win-ws2');
    t('no page errors', !z.errs.length, z.errs);
    await z.close(); await Z.close();

    // ---------- 3) TWO TABS / APP WINDOWS in one browser (shared storage): tab 1 on workspace 2 (a saved layout open, so its
    //              address is /charts/<ID>), tab 2 on workspace 1 and used last. Close everything, reopen both tabs from their
    //              addresses (what a browser "restore tabs" and the Windows app do).
    const T = await reopenCtx(b, 'alice', VW, VH, TH, dx);
    const t1 = await openAt(T, '/charts.html');
    if ((await name(t1)) !== 'MNQ_02') await go(t1, 2);
    await W(t1, async () => { const L = window.STRYKER_LAYOUTS, all = await L.list(); const l = all.find((x) => x.name === 'MNQ two layout'); if (l && (!L.current || L.current.id !== l.id)) await L.openById(l.id); });
    await sleep(3000);
    const st1 = await screen(t1), u1 = await W(t1, () => location.pathname);
    const t2 = await openAt(T, '/charts.html');
    if ((await name(t2)) !== 'MNQ_01') await go(t2, 1);
    await build(t2, '2h', 'futures:GC1!', 'futures:NQ1!'); await sleep(4500);
    const st2 = await screen(t2), u2 = await W(t2, () => location.pathname + location.search);   // (u1 stays a bare /charts/<ID>: the address an older version left in a restored tab)
    t('two tabs: tab 1 = workspace 2 at /charts/<ID>, tab 2 = workspace 1', (await name(t1)) === 'MNQ_02' && /^\/charts\/[A-Z0-9]{8}$/.test(u1) && (await name(t2)) === 'MNQ_01', { u1, u2, st1, st2 });
    const dt = await dumpLS(t2);
    await t1.close(); await t2.close(); await T.close();
    const T2 = await reopenCtx(b, 'alice', VW, VH, TH, dt);
    const q1 = await openAt(T2, u1);
    t('restored tab 1 (/charts/<ID> of workspace 2 layout): opens workspace 2 with its charts', (await name(q1)) === 'MNQ_02' && same(await screen(q1), st1), { n: await name(q1), now: await screen(q1), st1 });
    t('restored tab 1: no red toast', !(await bad(q1)).length, await bad(q1));
    const q2 = await openAt(T2, u2);
    t('restored tab 2 opened next to tab 1: not in phone safe mode (tab 1 is alive, not crashed)', !(await W(q2, () => !!(window.__stkSafe && window.__stkSafe.active))), await W(q2, () => localStorage.getItem('stryker_chart_loading')));
    t('restored tab 2 (its address): opens workspace 1 with its own charts', (await name(q2)) === 'MNQ_01' && same(await screen(q2), st2), { u2, n: await name(q2), now: await screen(q2), st2 });
    await sleep(5000);
    const ix3 = accountIndex();
    t('after both restored tabs: account docs still 1=GC, 2=YM-or-layout chart (workspace 1 never got workspace 2 chart)', wsSym('MNQ_01') === 'futures:GC1!' && wsSym('MNQ_02') !== 'futures:GC1!', [wsSym('MNQ_01'), wsSym('MNQ_02'), ix3 && ix3.items.map((i) => i.name + ':' + (i.layoutId || '-'))]);
    await go(q1, 1);
    t('restored tab 1 -> workspace 1: GC chart (not workspace 2 layout)', (await screen(q1)).charts[0] === 'futures:GC1!@5', await screen(q1));
    await go(q1, 2);
    t('restored tab 1 -> workspace 2: its layout', same(await screen(q1), st1), await screen(q1));
    await shot(q1, 'wsopen-' + TAG + '-restoredtab-ws2');
    t('restored tabs: no red toast / no page errors', !(await bad(q1)).length && !(await bad(q2)).length && !q1.errs.length && !q2.errs.length, [await bad(q1), await bad(q2), q1.errs, q2.errs]);
    await T2.close();

    // ---------- 4) ERROR PATH: the window reopens at /charts/<ID> (workspace 2's layout) while the account is not reachable
    //              yet (the first reads of that layout fail, as Firestore does on a cold start). Before: red "Could not open
    //              the layout." + "Unsaved layout". Now: tried again quietly, the window opens workspace 2.
    const lay2 = [...DB.entries()].find(([k, v]) => /chartLayouts\//.test(k) && v.name === 'MNQ two layout');
    FAILGET.re = new RegExp('chartLayouts/' + lay2[0].split('/').pop() + '$'); FAILGET.skip = 1; FAILGET.n = 1;   // the address check reads it fine, the open itself fails once
    const E = await reopenCtx(b, 'alice', VW, VH, TH, dt);
    const e1 = await openAt(E, u1);
    t('layout read fails once on reopen: no red toast', !(await bad(e1)).filter((x) => /toast/.test(x)).length, await bad(e1));
    t('layout read fails once on reopen: workspace 2 with its layout', (await name(e1)) === 'MNQ_02' && same(await screen(e1), st1) && (await W(e1, () => (window.STRYKER_LAYOUTS.current || {}).name)) === 'MNQ two layout', { n: await name(e1), s: await screen(e1) });
    await shot(e1, 'wsopen-' + TAG + '-errorpath');
    await E.close();
    FAILGET.skip = 0; FAILGET.n = 5;   // still unreachable after the retry: no toast, the workspace's own saved chart is shown
    const E2 = await reopenCtx(b, 'alice', VW, VH, TH, dt);
    const e2 = await openAt(E2, u1);
    t('layout unreadable on reopen: no red toast, its workspace still opens with its chart', !(await bad(e2)).filter((x) => /toast/.test(x)).length && (await name(e2)) === 'MNQ_02' && (await screen(e2)).charts[0] === st1.charts[0], { bad: await bad(e2), n: await name(e2), s: await screen(e2) });
    FAILGET.n = 0;
    await E2.close();
    // the toast is still shown when the member opens a layout from the menu and it cannot be read
    const E3 = await reopenCtx(b, 'alice', VW, VH, TH, dt);
    const e3 = await openAt(E3, '/charts.html');
    FAILGET.n = 2;
    await W(e3, (id) => window.STRYKER_LAYOUTS.openById(id), lay2[0].split('/').pop()); await sleep(800);
    FAILGET.n = 0;
    t('opening a layout from the menu that cannot be read still says so', (await bad(e3)).some((x) => /Could not open the layout/.test(x)), await bad(e3));
    await E3.close();
  } catch (e) { fail++; console.log('FAIL exception', String(e && e.stack || e).slice(0, 600)); }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
