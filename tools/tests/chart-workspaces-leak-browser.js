// Charts WORKSPACES LEAK test: two tabs open at the same time on the same account, one on each workspace.
// Run: CHART_BASE=http://127.0.0.1:8263 flock /tmp/stryker-chrome.lock node tools/tests/chart-workspaces-leak-browser.js <outDir>
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
const screen = (p) => W(p, () => { const s = window.STRYKER_VELA.getState(); const n = (/^(\d+)/.exec(s.layout || '') || [0, 1])[1]; return { layout: s.layout, charts: s.charts.slice(0, +n).map((c) => c.symbol + '@' + c.timeframe) }; });
const waitIdle = (p) => p.waitForFunction(() => !window.STRYKER_WORKSPACES.busy, null, { timeout: 15000 }).then(() => sleep(1500));
const name = (p) => p.$eval('#stkws-btn', (e) => e.textContent.trim());
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const edit = async (p, sym) => { await W(p, (s) => { const c = window.STRYKER_VELA.cells(); c[0].setSymbol(s); c[0].setTimeframe('5'); }, sym); await sleep(500); };
// what the account holds for each workspace's chart: "name=first chart symbol" (read back through the layouts library)
// (since 17 Nov a workspace's chart is its own doc, item.wsDoc, kind 'workspace'; layoutId is only a real layout opened in it)
const saved = (p) => W(p, async () => { const o = []; for (const x of window.STRYKER_WORKSPACES.index.items) { const id = x.wsDoc || x.layoutId; if (!id) { o.push(x.name + '=none'); continue; }
  const r = await window.STRYKER_LAYOUTS.fetchDoc(id); o.push(x.name + '=' + (r && r.doc && r.doc.charts ? r.doc.charts[0].symbol : 'none')); } return o; });

(async () => {
  const b = await launch();
  try {
    const VW = +process.env.VW || 1440, VH = +process.env.VH || 900, TH = process.env.THEME || 'dark', TAG = VW + '-' + TH;
    const A = await session(b, 'alice', VW, VH, VW < 700, TH);
    const a = await open(A);
    await edit(a, 'futures:NQ1!');
    await W(a, () => window.STRYKER_WORKSPACES.rename(window.STRYKER_WORKSPACES.active.id, 'One'));
    await W(a, () => window.STRYKER_WORKSPACES.createNew('Two')); await waitIdle(a);
    await edit(a, 'crypto:BTCUSDT');
    await a.keyboard.press('Control+1'); await waitIdle(a); await sleep(3500);   // workspace One saved
    const s1 = await screen(a);
    // tab B opens while tab A sits on One; B moves to Two
    const bb = await open(A);
    await bb.keyboard.press('Control+2'); await waitIdle(bb);
    const s2 = await screen(bb);
    t('setup: tabs show different workspaces', name(a) && (await name(a)) === 'One' && (await name(bb)) === 'Two' && !same(s1, s2), { s1, s2 });
    // B edits Two for a while (its autosave runs), then A edits One
    await edit(bb, 'crypto:ETHUSDT'); await sleep(4500);
    await edit(a, 'futures:ES1!'); await sleep(4500);
    const SAFE = await W(bb, () => !!(window.__stkSafe && window.__stkSafe.active));   // safe mode (phone harness) writes nothing by design: the save checks are skipped there
    if (SAFE) console.log('NOTE safe mode active: saved-layout and reload-B checks skipped');
    const s1b = await screen(a), s2b = await screen(bb);
    t('A kept its own chart while B worked (no collapse / change)', (await name(a)) === 'One' && s1b.charts[0] === 'futures:ES1!@5' && s1b.layout === s1.layout, { s1b });
    t('B kept its own chart while A worked', (await name(bb)) === 'Two' && s2b.charts[0] === 'crypto:ETHUSDT@5', { s2b });
    // what the account holds: One's layout has One's symbol, Two's layout has Two's
    const sv = await saved(a);
    t('saved layouts: One holds ES, Two holds ETH (nothing crossed)', SAFE || sv.some((x) => x === 'One=futures:ES1!') && sv.some((x) => x === 'Two=crypto:ETHUSDT'), sv);
    // B saves explicitly, A idles with a pending change: neither overwrites the other
    await W(bb, () => window.STRYKER_LAYOUTS.saveNow(true)); await sleep(1500);
    const sv2 = await saved(a);
    t('after B saves, One is still ES', sv2.some((x) => x === 'One=futures:ES1!'), sv2);
    // new third tab (the layout pointer written last belongs to One or Two): must open its workspace, not save over the other
    const c = await open(A);
    await edit(c, 'futures:GC1!'); await sleep(4500);
    const nc = await name(c), sv3 = await saved(a);
    t('third tab edit lands only in its own workspace layout', sv3.length === 2 && sv3.filter((x) => /=futures:GC1!/.test(x)).length <= 1 && sv3.filter((x) => /^One=futures:ES1!/.test(x)).length === 1, { nc, sv3 });
    await shot(a, 'wsleak-' + TAG + '-tabA'); await shot(bb, 'wsleak-' + TAG + '-tabB');
    await c.close();
    // same workspace in two tabs: tab C opens another chart (1 grid) while tab A keeps a 2-chart grid; Chrome reloads A later
    await W(a, async () => { window.STRYKER_CHART_UI.setLayout('2h'); await new Promise((r) => setTimeout(r, 1000)); const c = window.STRYKER_VELA.cells(); c[0].setSymbol('futures:ES1!'); c[1].setSymbol('futures:NQ1!'); }); await sleep(2500);
    const sA = await screen(a);
    const c2 = await open(A); await edit(c2, 'crypto:SOLUSDT'); await sleep(2500);
    await open(A, a);
    const rA = await screen(a);
    t('tab A reloaded after another tab opened another chart: keeps its own grid and charts', (await name(a)) === 'One' && same(rA, sA), { sA, rA });
    await c2.close();
    // reload both
    await open(A, a); await open(A, bb);
    t('reload A: One, its chart', (await name(a)) === 'One', { n: await name(a), s: await screen(a) });
    t('reload B: Two, its chart', (await name(bb)) === 'Two' && (SAFE || /^(crypto:ETHUSDT|futures:GC1!)@5$/.test((await screen(bb)).charts[0])), { n: await name(bb), s: await screen(bb) });
    t('no page errors', !a.errs.length && !bb.errs.length, [a.errs, bb.errs]);
    await A.close();
  } catch (e) { fail++; console.log('FAIL exception', String(e && e.stack || e).slice(0, 600)); }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
