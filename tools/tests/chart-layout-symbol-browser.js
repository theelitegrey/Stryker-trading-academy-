// Regression (BUG-TEMPLATES): signed-in member, two saved layouts (NQ 5m, GC 15m). After a full
// reload (same account + same browser storage) each layout must still open on its own symbol/interval,
// and autosave must never write the restored chart over a different layout.
// In-memory Firestore (same fake server as chart-layouts-lib-browser.js), recorded bars, no network.
//   node tools/tests/chart-fixture-server.mjs 8263 any.json   (any.json = {})
//   CHART_BASE=http://127.0.0.1:8263 flock -w 3600 /tmp/stryker-chrome.lock node tools/tests/chart-layout-symbol-browser.js [outDir]
const fs = require('fs');
const { launch } = require('./lib.js');
const { newCtx, sleep } = require('./phone-layouts-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8263';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
// ---------------------------------------------------------------- the fake server
const DB = new Map();           // path -> data
const put = (p, d) => DB.set(p, d);
put('profiles/alice', { displayName: 'Alice T' }); put('students/alice', { uid: 'alice', plan: 'Elite', role: 'elite', residenceCountry: 'US', sanctionsAttest: true, onboardingDone: true }); put('profiles/bob', { displayName: 'Bob K' });
put('communities/zoro', { ownerUid: 'alice', name: 'Zoro Room', status: 'active', visibility: 'public' });
put('communities/zoro/members/bob', { uid: 'bob', status: 'active', expiresAt: null });
put('admins/carol', { x: 1 });
const rev = (v) => {
  if (Array.isArray(v)) return v.map(rev);
  if (v && typeof v === 'object') { if (v.__ts) return { __ms: Date.now() }; const o = {}; for (const k in v) o[k] = rev(v[k]); return o; }
  return v;
};
const segs = (p) => p.split('/');
const member = (cid, uid) => { const m = DB.get('communities/' + cid + '/members/' + uid); return !!m && m.status === 'active'; };
const denied = () => { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; };
function can(uid, op, path) {
  const s = segs(path);
  if (!uid) return false;
  if (s[0] === 'students') return s[1] === uid;
  if (s[0] === 'chartShared') return op === 'get' || op === 'write';
  if (s[0] === 'publicLayouts') {
    const parent = DB.get('publicLayouts/' + s[1]);
    const owner = parent && parent.ownerUid === uid, admin = DB.has('admins/' + uid);
    if (s.length === 2) {
      if (op === 'write' || !parent) return true; // shape + owner rules: covered by the rules test
      return owner || admin || (!parent.hidden && ['public', 'community'].includes(parent.visibility));
    }
    if (s[2] === 'data') { if (op !== 'get') return true; return !!parent && (owner || admin || (!parent.hidden && (parent.visibility === 'public' || (parent.visibility === 'community' && member(parent.communityId, uid))))); }
    return s[3] === uid || admin || op === 'write';
  }
  return true;
}
function applyWrite(w) {
  const { op, path, data } = w; const cur = DB.get(path);
  if (op === 'delete') { DB.delete(path); return; }
  if (op === 'set') { DB.set(path, w.merge && cur ? Object.assign({}, cur, rev(data)) : rev(data)); return; }
  if (!cur) throw Object.assign(new Error('not-found'), { code: 'not-found' });
  const n = Object.assign({}, cur);
  for (const k in data) { const v = data[k]; n[k] = v && v.__inc !== undefined ? (cur[k] || 0) + v.__inc : rev(v); }
  DB.set(path, n);
}
const server = {
  get: (uid, path) => { if (!can(uid, 'get', path)) denied(); return { exists: DB.has(path), data: DB.get(path) || null }; },
  commit: (uid, writes) => { writes.forEach((w) => { if (!can(uid, 'write', w.path)) denied(); }); writes.forEach(applyWrite); return true; },
  query: (uid, coll, wheres, orders, limit) => {
    const n = segs(coll).length;
    if (segs(coll)[0] === 'students' && segs(coll)[1] !== uid) denied();
    let rows = [...DB.entries()].filter(([p]) => p.startsWith(coll + '/') && segs(p).length === n + 1);
    rows = rows.filter(([p, d]) => wheres.every(([f, o, v]) => (o === '==' ? d[f] === v : true)));
    orders.forEach(([f, dir]) => rows.sort((a, b) => { const g = (x) => (x[f] && x[f].__ms) || x[f] || 0; return (dir === 'desc' ? -1 : 1) * (g(a[1]) - g(b[1])); }));
    if (limit) rows = rows.slice(0, limit);
    return rows.map(([p, d]) => ({ id: p.split('/').pop(), data: d }));
  }
};

function mockInit() {
  const cl = (v) => JSON.parse(JSON.stringify(v));
  const back = (v) => { if (Array.isArray(v)) return v.map(back); if (v && typeof v === 'object') { if (v.__ms !== undefined) return { toMillis: () => v.__ms, toDate: () => new Date(v.__ms) }; const o = {}; for (const k in v) o[k] = back(v[k]); return o; } return v; };
  const U = () => window.__UID;
  const snap = (id, r) => ({ id, exists: !!r.exists, data: () => (r.exists ? back(cl(r.data)) : undefined) });
  const FV = { serverTimestamp: () => ({ __ts: 1 }), increment: (n) => ({ __inc: n }), delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' };
  const ref = (path) => ({
    id: path.split('/').pop(), path,
    get: () => window.__fs('get', U(), path).then((r) => snap(path.split('/').pop(), r)),
    set: (d, o) => window.__fs('commit', U(), [{ op: 'set', path, data: d, merge: !!(o && o.merge) }]),
    update: (d) => window.__fs('commit', U(), [{ op: 'update', path, data: d }]),
    delete: () => window.__fs('commit', U(), [{ op: 'delete', path }]),
    collection: (s) => col(path + '/' + s)
  });
  const col = (path) => {
    const q = { w: [], o: [], l: 0 };
    const self = {
      doc: (id) => ref(path + '/' + (id || Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12))),
      where: (f, o, v) => { q.w.push([f, o, v]); return self; }, orderBy: (f, d) => { q.o.push([f, d || 'asc']); return self; }, limit: (n) => { q.l = n; return self; },
      get: () => window.__fs('query', U(), path, q.w, q.o, q.l).then((rows) => { const docs = rows.map((r) => snap(r.id, { exists: true, data: r.data })); return { docs, empty: !docs.length, size: docs.length, forEach: (f) => docs.forEach(f) }; }),
      add: async (d) => { const r = self.doc(); await r.set(d); return r; },
      onSnapshot: (cb) => { self.get().then(cb); return () => {}; }
    };
    return self;
  };
  const db = { collection: col, doc: (p) => ref(p), batch: () => { const w = []; const mk = (op) => (r, d, o) => { w.push({ op, path: r.path, data: d, merge: !!(o && o.merge) }); return b; }; const b = { set: mk('set'), update: mk('update'), delete: (r) => { w.push({ op: 'delete', path: r.path }); return b; }, commit: () => window.__fs('commit', U(), w) }; return b; } };
  window.__stubDb = db; window.db = db;
  window.firebase.apps = [{}];
  window.firebase.firestore = Object.assign(() => db, { FieldValue: FV, Timestamp: { now: () => ({ toDate: () => new Date() }), fromDate: (d) => ({ toDate: () => d }) } });
  const u = window.__stubAuth.currentUser; u.uid = U(); u.displayName = U();
  window.__stubAuth.onIdTokenChanged = (cb) => { setTimeout(() => cb(u), 10); return () => {}; };   // rt-access.js hooks this; without it the futures feed waits ~15 s
}

async function session(b, uid, w, h, mobile, theme) {
  const ctx = await newCtx(b, { w, h, mobile });
  await ctx.exposeFunction('__fsRaw', async (op, u, ...a) => { try { return { ok: server[op](u, ...a) }; } catch (e) { return { err: e.code || 'error', msg: e.message }; } });
  await ctx.route(/\/api\/chart\/rt/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"admin":false}' }));
  await ctx.addInitScript(([u, th]) => {
    window.__UID = u;
    window.__fs = (...a) => window.__fsRaw(...a).then((r) => { if (r.err) { const e = new Error(r.msg); e.code = r.err; throw e; } return r.ok; });
    try { localStorage.setItem('stryker_theme', th === 'light' ? 'day' : 'night'); } catch (e) {}
    if (th === 'light' && document.documentElement) document.documentElement.setAttribute('data-theme', 'light');
  }, [uid, theme || 'dark']);
  await ctx.addInitScript('(' + mockInit.toString() + ')()');
  return ctx;
}
async function open(ctx, base) {
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) p.errs.push(String(e).slice(0, 200)); });
  p.on('dialog', (d) => d.accept());
  await p.goto(base + '/charts.html?vela=0.9', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_LAYOUTS && window.STRYKER_CHART_UI && window.STRYKER_CHART_UI.grid, null, { timeout: 60000 });
  await sleep(2500);
  return p;
}
const cur = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0]; return c.symbol + '|' + c.timeframe; });
const stored = (name) => { const e = [...DB.entries()].find(([k, v]) => k.startsWith('students/alice/chartLayouts/') && v.name === name); return e && (e[1].symbol + '|' + e[1].interval); };
const settle = async (p, want) => { for (let i = 0; i < 40; i++) { if ((await cur(p)) === want) break; await sleep(1000); } await sleep(1500); };
const openL = async (p, name, want) => { await p.evaluate((n) => window.STRYKER_LAYOUTS.list().then((a) => window.STRYKER_LAYOUTS.openById(a.find((x) => x.name === n).id)), name); await settle(p, want); };
const setSym = async (p, s, tf) => { await p.evaluate(([s, tf]) => { const c = window.STRYKER_VELA.active; c.setSymbol(s); c.setTimeframe(tf); }, [s, tf]); await settle(p, s + '|' + tf); };

(async () => {
  const b = await launch();
  try {
    // ---- autosave must not carry a template's symbol into the open layout (the member's bug)
    for (const [vt, vw, vh, vm] of [['1440', 1440, 900, false], ['390', 390, 844, true]]) {
    DB.forEach((v, k) => { if (k.startsWith('students/alice/')) DB.delete(k); });
    const A = await session(b, 'alice', vw, vh, vm);   // autosave ON (default)
    await A.addInitScript(() => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', '1'); localStorage.setItem('stryker_chart_layout_auto_alice', 'false'); } });   // off while building the fixtures
    const a = await open(A, BASE);
    await setSym(a, 'futures:NQ1!', '5');
    await a.evaluate(() => window.STRYKER_LAYOUTS.saveAsNew('L-NQ')); await sleep(1500);
    await setSym(a, 'futures:GC1!', '15');
    await a.evaluate(() => window.STRYKER_LAYOUTS.saveAsNew('L-GC')); await sleep(1500);
    await a.evaluate(() => window.StrykerChartTemplates.save('TplGC', window.STRYKER_VELA.getState()));
    await a.evaluate(() => localStorage.setItem('stryker_chart_layout_auto_alice', 'true'));
    await openL(a, 'L-NQ', 'futures:NQ1!|5'); await sleep(4000);
    t(vt + ' S1 L-NQ intact after open+wait', stored('L-NQ') === 'futures:NQ1!|5' && stored('L-GC') === 'futures:GC1!|15', [stored('L-NQ'), stored('L-GC')]);
    // apply the GC *template* while layout L-NQ is the open one
    await a.evaluate(() => { const b = document.getElementById('stkc-tpl-btn'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); });   // the real click path
    await a.waitForSelector('button[aria-label="Apply TplGC"]', { state: 'attached', timeout: 8000 });
    await a.evaluate(() => document.querySelector('button[aria-label="Apply TplGC"]').click());
    await settle(a, 'futures:GC1!|15'); await sleep(4500);
    await a.screenshot({ path: `${OUT}/${process.env.TAG || 'after'}-S2-${vt}-dark.png` });
    t(vt + ' S2 applying a template does not overwrite the open layout', stored('L-NQ') === 'futures:NQ1!|5', [stored('L-NQ'), stored('L-GC')]);
    await A.close();
    }
    for (const [tag, w, h, mobile] of [['1440', 1440, 900, false], ['390', 390, 844, true]]) {
      DB.forEach((v, k) => { if (k.startsWith('students/alice/')) DB.delete(k); });
      const A = await session(b, 'alice', w, h, mobile);
      await A.addInitScript(() => { try { localStorage.setItem('stryker_chart_layout_auto_alice', 'false'); } catch (e) {} });   // setup only: changing the symbol must not autosave into the open layout
      const a = await open(A, BASE);
      await setSym(a, 'futures:NQ1!', '5');
      await a.evaluate(() => window.STRYKER_LAYOUTS.saveAsNew('L-NQ')); await sleep(1500);
      await setSym(a, 'futures:GC1!', '15');
      await a.evaluate(() => window.STRYKER_LAYOUTS.saveAsNew('L-GC')); await sleep(1500);
      t(`${tag} saved L-NQ`, stored('L-NQ') === 'futures:NQ1!|5', stored('L-NQ'));
      t(`${tag} saved L-GC`, stored('L-GC') === 'futures:GC1!|15', stored('L-GC'));
      await openL(a, 'L-NQ', 'futures:NQ1!|5');
      t(`${tag} switch to L-NQ`, (await cur(a)) === 'futures:NQ1!|5', await cur(a));
      await openL(a, 'L-GC', 'futures:GC1!|15');   // last used = L-GC, then the browser is closed
      t(`${tag} switch to L-GC`, (await cur(a)) === 'futures:GC1!|15', await cur(a));
      const st = await A.storageState(); await A.close();
      for (const name of ['L-GC', 'L-NQ', 'L-GC']) {
        const want = name === 'L-NQ' ? 'futures:NQ1!|5' : 'futures:GC1!|15';
        const C = await session(b, 'alice', w, h, mobile);
        await C.addInitScript((s) => { JSON.parse(s).origins.forEach((og) => (og.localStorage || []).forEach((kv) => { if (!/theme|prompt|ack|layout_auto/.test(kv.name)) localStorage.setItem(kv.name, kv.value); })); }, JSON.stringify(st));
        const q = await open(C, BASE); await sleep(5000);   // let any autosave fire
        t(`${tag} reload: L-NQ stored symbol intact`, stored('L-NQ') === 'futures:NQ1!|5', stored('L-NQ'));
        t(`${tag} reload: L-GC stored symbol intact`, stored('L-GC') === 'futures:GC1!|15', stored('L-GC'));
        await openL(q, name, want);
        t(`${tag} reload, open ${name}`, (await cur(q)) === want, await cur(q));
        await q.screenshot({ path: `${OUT}/${process.env.TAG || 'after'}-layout-${tag}-${name}-dark.png` });
        await C.close();
      }
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
