// Charts WORKSPACES RESTORE test (bug: workspace 2's layout loaded into workspace 1 after reopening).
// Same harness as chart-workspaces-browser.js. Run: CHART_BASE=http://127.0.0.1:8263 flock /tmp/stryker-chrome.lock node tools/tests/chart-workspaces-restore-browser.js <outDir>
// (old header) Charts WORKSPACES browser test (assets/chart-workspaces.js). No network: recorded NQ bars (phone-layouts-lib.js)
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
    const VW = +process.env.VW || 1440, VH = +process.env.VH || 900, TH = process.env.THEME || 'dark', TAG = VW + '-' + TH;   // VW=390 VH=844 for the phone run
    const A = await session(b, 'alice', VW, VH, VW < 700, TH);
    const a = await open(A);
    const build = async (a, name, lay, sym, sym2) => {
      await W(a, async ([l, s, s2]) => { window.STRYKER_CHART_UI.setLayout(l); await new Promise((r) => setTimeout(r, 1000)); const c = window.STRYKER_VELA.cells(); c[0].setSymbol(s); c[0].setTimeframe('5'); if (s2) { c[1].setSymbol(s2); c[1].setTimeframe('15'); } }, [lay, sym, sym2]);
      await sleep(1500);
    };
    const ids = (p) => W(p, () => window.STRYKER_WORKSPACES.index.items.map((x) => x.name + ':' + (x.layoutId || '').slice(0, 5)).join(' ') + ' cur=' + (window.STRYKER_LAYOUTS.current || {}).id);
    const name = (p) => p.$eval('#stkws-btn', (e) => e.textContent.trim());
    // two workspaces, different layouts; the first one is saved by switching away
    await build(a, 'One', '2h', 'futures:NQ1!', 'futures:ES1!');
    const s1 = await screen(a);
    await W(a, () => window.STRYKER_WORKSPACES.rename(window.STRYKER_WORKSPACES.active.id, 'One'));
    await W(a, () => window.STRYKER_WORKSPACES.createNew('Two')); await waitIdle(a);
    await build(a, 'Two', '4', 'crypto:BTCUSDT', 'crypto:ETHUSDT');
    const s2 = await screen(a);
    t('setup: the two workspaces differ', JSON.stringify(s1) !== JSON.stringify(s2), { s1, s2 });
    await sleep(1500);
    // 1) plain reload on workspace 2
    await open(A, a);
    t('reload on workspace 2: opens workspace 2 with its own layout', (await name(a)) === 'Two' && JSON.stringify(await screen(a)) === JSON.stringify(s2), { n: await name(a), now: await screen(a), s2 });
    // 2) a second tab (same browser) works in workspace 1; then the first tab reloads
    const b2 = await open(A);
    await b2.keyboard.press('Control+1'); await waitIdle(b2);
    t('2nd tab: workspace 1 shows its layout', JSON.stringify(await screen(b2)) === JSON.stringify(s1), await screen(b2));
    await sleep(1500);
   
    await open(A, a);
    t('tab 1 (was on workspace 2) reloads after tab 2 used workspace 1: still workspace 2, own layout', (await name(a)) === 'Two' && JSON.stringify(await screen(a)) === JSON.stringify(s2), { n: await name(a), now: await screen(a), s2 });
    await a.keyboard.press('Control+1'); await waitIdle(a);
    t('and workspace 1 still has its own layout', JSON.stringify(await screen(a)) === JSON.stringify(s1), await screen(a));
    await a.keyboard.press('Control+2'); await waitIdle(a); await sleep(1500);
    // 3) a new tab (no tab memory) opens the last used workspace, with that workspace's layout
    await b2.close();
    const b3 = await open(A);
    t('new tab opens the last active workspace (Two) with its layout', (await name(b3)) === 'Two' && JSON.stringify(await screen(b3)) === JSON.stringify(s2), { n: await name(b3), now: await screen(b3) });
    await shot(b3, 'wsrestore-' + TAG + '-two');
    await b3.keyboard.press('Control+1'); await waitIdle(b3); await sleep(+process.env.SETTLE || 1500);
    await open(A, b3);
    t('reload on workspace 1: opens workspace 1 with its layout', (await name(b3)) === 'One' && JSON.stringify(await screen(b3)) === JSON.stringify(s1), { n: await name(b3), now: await screen(b3) });
    await shot(b3, 'wsrestore-' + TAG + '-one');
    await a.close();
    t('no page errors', !a.errs.length && !b3.errs.length, [a.errs, b3.errs]);
    await A.close();
    // signed out
    const G = await session(b, null, 1440, 900, false);
    const g = await open(G);
    await build(g, 'One', '2v', 'futures:GC1!');
    const g1 = await screen(g);
    await W(g, () => window.STRYKER_WORKSPACES.createNew('Gold two')); await waitIdle(g);
    await build(g, 'Two', '4', 'futures:CL1!', 'futures:ES1!');
    const g2 = await screen(g); await sleep(1500);
    const g3 = await open(G);
    await g3.keyboard.press('Control+1'); await waitIdle(g3); await sleep(1500);
    t('signed out: 2nd tab on workspace 1 shows its layout', JSON.stringify(await screen(g3)) === JSON.stringify(g1), await screen(g3));
    await g3.close();
    await open(G, g);
    t('signed out: reload tab on workspace 2 keeps workspace 2 layout', (await name(g)) === 'Gold two' && JSON.stringify(await screen(g)) === JSON.stringify(g2), { n: await name(g), now: await screen(g), g2 });
    await G.close();
  } catch (e) { fail++; console.log('FAIL exception', String(e && e.stack || e).slice(0, 600)); }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
