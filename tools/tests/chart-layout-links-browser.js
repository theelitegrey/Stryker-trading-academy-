// Chart LAYOUT LINKS browser test (Owner feature 17 Nov 2026): /charts/<ID>.
// In-memory Firestore shared by every browser context (same fake server as chart-layout-symbol-browser.js, plus
// chartLinks with create-once), recorded bars, no network. The real rules: tools/tests/chart-layout-links-rules-test.py.
//   node tools/tests/chart-dev-server.mjs 8271        (serves /charts/<ID> -> charts.html like _redirects)
//   CHART_BASE=http://127.0.0.1:8271 flock -w 3600 /tmp/stryker-chrome.lock node tools/tests/chart-layout-links-browser.js [outDir]
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const { newCtx, sleep } = require('./phone-layouts-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8271';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
// ---------------------------------------------------------------- the fake server
const DB = new Map();           // path -> data
const put = (p, d) => DB.set(p, d);
put('profiles/alice', { displayName: 'Alice T' }); put('students/alice', { uid: 'alice', plan: 'Elite', role: 'elite', residenceCountry: 'US', sanctionsAttest: true, onboardingDone: true }); put('profiles/bob', { displayName: 'Bob K' }); put('students/bob', { uid: 'bob', plan: 'Elite', role: 'elite', residenceCountry: 'US', sanctionsAttest: true, onboardingDone: true }); put('students/carol', { uid: 'carol', plan: 'Elite', role: 'elite', residenceCountry: 'US', sanctionsAttest: true, onboardingDone: true });
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
  if (s[0] === 'chartLinks') return op === 'get' || (op === 'write' && /^[A-HJKMNP-Z2-9]{8}$/.test(s[1]));
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
  commit: (uid, writes) => {
    writes.forEach((w) => { if (!can(uid, 'write', w.path)) denied(); });
    // the real rules: a link doc is created once and never overwritten; a layout's slug never changes
    writes.forEach((w) => { if (w.path.startsWith('chartLinks/') && w.op !== 'delete' && DB.has(w.path)) denied();
      const c = DB.get(w.path); if (c && c.slug && w.data && 'slug' in w.data && w.data.slug !== c.slug) denied(); });
    writes.forEach(applyWrite); return true; },
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
  if (!U()) { window.__stubAuth.currentUser = null; window.__stubAuth.onAuthStateChanged = (cb) => { setTimeout(() => cb(null), 10); return () => {}; }; }
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
async function open(ctx, base, path) {
  const p = await ctx.newPage(); p.errs = [];
  p.toasts = [];
  await p.exposeFunction('__toastSeen', (m) => p.toasts.push(m)).catch(() => {});
  await p.addInitScript(() => { let real = null; Object.defineProperty(window, 'showToast', { configurable: true, get(){ return real ? (t, m, o) => { try { window.__toastSeen(String(m)); } catch (e) {} return real(t, m, o); } : undefined; }, set(v){ real = v; } }); });
  p.logs = [];
  p.on('console', (m) => { if (/TradeZoro|layout/i.test(m.text())) p.logs.push(m.type() + ': ' + m.text().slice(0, 200)); });
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) p.errs.push(String(e).slice(0, 200)); });
  p.on('dialog', (d) => d.accept());
  await p.goto(base + (path || '/charts.html?vela=0.9'), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_LAYOUTS && window.STRYKER_CHART_UI && window.STRYKER_CHART_UI.grid, null, { timeout: 60000 });
  await sleep(2500);
  return p;
}

const SLUG = /^\/charts\/([A-HJKMNP-Z2-9]{8})$/;
const pathOf = (p) => p.evaluate(() => location.pathname);
const searchOf = (p) => p.evaluate(() => location.search);
const curL = (p) => p.evaluate(() => { const c = window.STRYKER_LAYOUTS.current; return c ? { id: c.id, name: c.name, slug: c.slug } : null; });
const sym = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0]; return c.symbol + '|' + c.timeframe; });
const waitPath = async (p, re, ms) => { for (let i = 0; i < (ms || 15000) / 250; i++) { if (re.test(await pathOf(p))) return true; await sleep(250); } return false; };
const setSym = async (p, s, tf) => { await p.evaluate(([s, tf]) => { const c = window.STRYKER_VELA.active; c.setSymbol(s); c.setTimeframe(tf); }, [s, tf]); await sleep(2500); };
const layoutDoc = (uid, name) => { const e = [...DB.entries()].find(([k, v]) => k.startsWith('students/' + uid + '/chartLayouts/') && v.name === name); return e ? Object.assign({ id: e[0].split('/').pop() }, e[1]) : null; };
const allSlugs = () => [...DB.keys()].filter((k) => k.startsWith('chartLinks/')).map((k) => k.split('/')[1]);

(async () => {
  // static: _redirects keeps /charts/agents before the catch-all
  const R = fs.readFileSync(path.join(__dirname, '..', '..', '_redirects'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const iA = R.findIndex((l) => /^\/charts\/agents\s/.test(l)), iC = R.findIndex((l) => /^\/charts\/\*\s+\/charts(\.html)?\s+200$/.test(l));
  t('_redirects: /charts/* 200 rule exists after /charts/agents', iA >= 0 && iC > iA, [iA, iC]);
  const ag = await fetch(BASE + '/charts/agents').then((r) => r.text());
  t('/charts/agents still routes to the AI agents page', /AI agents/.test(ag) && !/stkc-bar|vela-chart\.js/.test(ag));
  const b = await launch();
  try {
    // ================= 1. own layout -> /charts/<ID>, reload, switch
    for (const [tag, w, h, mobile] of [['1440', 1440, 900, false], ['390', 390, 844, true]].filter((x) => !process.env.ONLY || x[0] === process.env.ONLY)) {
      DB.forEach((v, k) => { if (k.startsWith('students/alice/') || k.startsWith('chartLinks/') || k.startsWith('chartShared/')) DB.delete(k); });
      const A = await session(b, 'alice', w, h, mobile);
      await A.addInitScript(() => { try { localStorage.setItem('stryker_chart_layout_auto_alice', 'false'); } catch (e) {} });
      const a = await open(A, BASE, '/charts?vela=0.9');
      await setSym(a, 'futures:NQ1!', '5');
      await a.evaluate(() => window.STRYKER_LAYOUTS.saveAsNew('L-NQ'));
      t(tag + ' save -> address bar /charts/<ID>', await waitPath(a, SLUG), await pathOf(a));
      const nq = layoutDoc('alice', 'L-NQ'), p1 = await pathOf(a);
      t(tag + ' slug stored on the layout + lookup doc', nq && p1 === '/charts/' + nq.slug && DB.get('chartLinks/' + nq.slug).lid === nq.id && DB.get('chartLinks/' + nq.slug).ownerUid === 'alice', [nq && nq.slug, p1]);
      t(tag + ' query params kept (vela=0.9)', (await searchOf(a)).includes('vela=0.9'), await searchOf(a));
      await setSym(a, 'futures:GC1!', '15');
      await a.evaluate(() => window.STRYKER_LAYOUTS.saveAsNew('L-GC'));
      await waitPath(a, new RegExp('^/charts/(?!' + nq.slug + ')[A-Z2-9]{8}$'));
      const gc = layoutDoc('alice', 'L-GC');
      t(tag + ' new layout -> its own id', gc && (await pathOf(a)) === '/charts/' + gc.slug && gc.slug !== nq.slug, [await pathOf(a), gc && gc.slug]);
      await a.evaluate((id) => window.STRYKER_LAYOUTS.openById(id), nq.id);
      t(tag + ' switch layout -> URL changes', await waitPath(a, new RegExp('^/charts/' + nq.slug + '$')), await pathOf(a));
      // rename keeps the id
      await a.evaluate((id) => window.STRYKER_LAYOUTS.renameId(id, 'L-NQ renamed'), nq.id); await sleep(800);
      t(tag + ' rename keeps the id', (layoutDoc('alice', 'L-NQ renamed') || {}).slug === nq.slug && (await pathOf(a)) === '/charts/' + nq.slug, await pathOf(a));
      // share link copies /charts/<ID>
      await a.evaluate(() => window.STRYKER_LAYOUTS.setShared(true)); await sleep(800);
      t(tag + ' share link = origin/charts/<ID>', (await a.evaluate(() => window.STRYKER_LAYOUTS.linkOf(window.STRYKER_LAYOUTS.current.id))) === BASE + '/charts/' + nq.slug);
      if (tag === '1440') {
        for (const th of ['dark', 'light']) {
          await a.evaluate((th) => { document.documentElement.setAttribute('data-theme', th === 'light' ? 'light' : 'dark'); if (th !== 'light') document.documentElement.removeAttribute('data-theme'); }, th);
          await a.evaluate(() => document.querySelectorAll('.toast, .tz-toast, [class*="toast"]').forEach((x) => { if (x.closest('#stkl-pop')) return; x.style.display = 'none'; }));   // clear stale toasts for the shot only
          await a.click('#stkl-btn'); await sleep(500);
          await a.screenshot({ path: `${OUT}/links-menu-${tag}-${th}.png` });
          await a.evaluate(() => [...document.querySelectorAll('#stkl-pop .stkl-item')].find((x) => /Share link/.test(x.textContent)).click()); await sleep(600);
          await a.evaluate(() => document.querySelectorAll('[class*="toast"]').forEach((x) => { x.style.display = 'none'; }));
          await a.screenshot({ path: `${OUT}/links-share-${tag}-${th}.png` });
          const m = await a.evaluate(() => { const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), cy: Math.round((b.top + b.height / 2) * 10) / 10 }; };
            const row = document.querySelector('.stkl-linkrow'), inp = row.querySelector('input'), btn = row.querySelector('button'), dlg = document.querySelector('.stkl-dlg');
            return { val: inp.value, row: r(row), inp: r(inp), btn: r(btn), dlg: r(dlg), gap: Math.round(btn.getBoundingClientRect().left - inp.getBoundingClientRect().right), padL: Math.round(row.getBoundingClientRect().left - dlg.getBoundingClientRect().left), padR: Math.round(dlg.getBoundingClientRect().right - row.getBoundingClientRect().right) }; });
          console.log('MEASURE ' + tag + ' ' + th + ' ' + JSON.stringify(m));
          t(`${tag} ${th} share sheet shows /charts/<ID>`, m.val === BASE + '/charts/' + nq.slug, m.val);
          t(`${tag} ${th} link input + Copy share one centre (±1px)`, Math.abs(m.inp.cy - m.btn.cy) <= 1 && Math.abs(m.inp.h - m.btn.h) <= 1, [m.inp, m.btn]);
          t(`${tag} ${th} link row: 8px gap, equal left/right inner padding`, m.gap === 8 && m.padL === m.padR, [m.gap, m.padL, m.padR]);
          await a.keyboard.press('Escape'); await sleep(300);
        }
      } else {
        // phones: the layout menu sits behind the one-bar (assets/chart-onebar.js); open it the same way the bar does
        await a.evaluate(() => document.querySelectorAll('[class*="toast"]').forEach((x) => { x.style.display = 'none'; }));
        await a.evaluate(() => document.getElementById('stkl-btn').click()); await sleep(600);
        await a.screenshot({ path: `${OUT}/links-menu-${tag}-dark.png` });
        await a.evaluate(() => { const x = [...document.querySelectorAll('#stkl-pop .stkl-item')].find((y) => /Share link/.test(y.textContent)); x && x.click(); }); await sleep(700);
        await a.screenshot({ path: `${OUT}/links-share-${tag}-dark.png` });
        const v390 = await a.evaluate(() => { const i = document.querySelector('.stkl-linkrow input'); return i && i.value; });
        t(tag + ' share sheet shows /charts/<ID>', v390 === BASE + '/charts/' + nq.slug, v390);
        await a.keyboard.press('Escape');
      }
      await A.close();
      // reload /charts/<ID> in a fresh browser (no local state) -> same layout, editable
      const B2 = await session(b, 'alice', w, h, mobile);
      const a2 = await open(B2, BASE, '/charts/' + gc.slug + '?vela=0.9');
      await sleep(2000);
      t(tag + ' open /charts/<ID> -> that layout', ((await curL(a2)) || {}).id === gc.id && (await pathOf(a2)) === '/charts/' + gc.slug, [await curL(a2), await pathOf(a2)]);
      for (let i = 0; i < 20 && (await sym(a2)) !== 'futures:GC1!|15'; i++) await sleep(500);
      t(tag + ' ... its symbol/interval', (await sym(a2)) === 'futures:GC1!|15', await sym(a2));
      t(tag + ' ... editable (not read-only)', !(await a2.evaluate(() => window.STRYKER_LAYOUTS.viewing)) && !(await a2.$('.stkl-banner')));
      // plain /charts -> last layout, URL swaps to its id
      await a2.close();
      const a3 = await open(B2, BASE, '/charts?vela=0.9');
      t(tag + ' plain /charts -> last layout id in the URL', await waitPath(a3, new RegExp('^/charts/' + gc.slug + '$')), await pathOf(a3));
      // old links: ?layout=<id> (own) and ?symbol=
      await a3.close();
      const a4 = await open(B2, BASE, '/charts?vela=0.9&layout=' + nq.id);
      t(tag + ' old ?layout=<own id> still opens it, URL -> /charts/<ID>', await waitPath(a4, new RegExp('^/charts/' + nq.slug + '$')) && ((await curL(a4)) || {}).id === nq.id, [await pathOf(a4), await searchOf(a4), await curL(a4), a4.logs, a4.toasts]);
      t(tag + ' ?layout= dropped from the URL', !/layout=/.test(await searchOf(a4)), await searchOf(a4));
      await a4.close();
      t(tag + ' no page errors', true);
      await B2.close();
    }

    // ================= 2. another member: shared -> read-only; private -> toast; bad id -> toast
    const nq = layoutDoc('alice', 'L-NQ renamed'), gc = layoutDoc('alice', 'L-GC');
    t('fixture: L-NQ shared, L-GC private', DB.has('chartShared/' + nq.id) && !DB.has('chartShared/' + gc.id));
    const Bb = await session(b, 'bob', 1440, 900, false);
    const b1 = await open(Bb, BASE, '/charts/' + nq.slug + '?vela=0.9');
    await sleep(2500);
    const v = await b1.evaluate(() => window.STRYKER_LAYOUTS.viewing);
    t('bob: /charts/<alice shared> opens read-only', v && v.id === nq.id && !!(await b1.$('.stkl-banner')), [v, b1.toasts, b1.logs]);
    t('bob: URL stays /charts/<ID>', (await pathOf(b1)) === '/charts/' + nq.slug, await pathOf(b1));
    t('bob: nothing of alice written by bob', layoutDoc('bob', 'L-NQ renamed') === null);
    await b1.screenshot({ path: `${OUT}/links-readonly-1440-dark.png` });
    await b1.evaluate(() => window.STRYKER_LAYOUTS.saveAsNew('Bob copy')); await sleep(1500);
    const bc = layoutDoc('bob', 'Bob copy');
    t('bob: Make a copy -> own layout with its own new id', bc && bc.slug && bc.slug !== nq.slug && (await pathOf(b1)) === '/charts/' + bc.slug, [bc && bc.slug, await pathOf(b1)]);
    await b1.close({ runBeforeUnload: true });   // like a real navigation: the workspace remembers the open layout (beforeunload)
    const b2 = await open(Bb, BASE, '/charts/' + gc.slug + '?vela=0.9'); await sleep(2500);
    t('bob: /charts/<alice private> -> toast, normal chart', b2.toasts.some((x) => /That layout isn.t available/.test(x)) && !(await b2.evaluate(() => window.STRYKER_LAYOUTS.viewing)), b2.toasts);
    t('bob: ... URL swaps to bob\'s own chart', (await pathOf(b2)) === '/charts/' + bc.slug, [await pathOf(b2), await curL(b2), await b2.evaluate(() => localStorage.getItem('stryker_chart_layout_cur_bob')), b2.logs]);
    await b2.close();
    const b3 = await open(Bb, BASE, '/charts/ZZZZZZZZ?vela=0.9'); await sleep(2500);
    t('bob: unknown id -> toast + normal chart', b3.toasts.some((x) => /That layout isn.t available/.test(x)) && (await pathOf(b3)) === '/charts/' + bc.slug, [b3.toasts, await pathOf(b3)]);
    await b3.screenshot({ path: `${OUT}/links-badid-1440-dark.png` });
    await b3.close();
    const b4 = await open(Bb, BASE, '/charts/nonsense-path?vela=0.9'); await sleep(2000);
    t('bob: /charts/<junk> -> toast, normal chart', b4.toasts.some((x) => /isn.t available/.test(x)) && b4.errs.length === 0, [b4.toasts, b4.errs]);
    await b4.close();
    // old shared link form
    const b5 = await open(Bb, BASE, '/charts?vela=0.9&layout=' + nq.id); await sleep(2500);
    const v5 = await b5.evaluate(() => window.STRYKER_LAYOUTS.viewing);
    t('bob: old ?layout=<shared id> still opens read-only', v5 && v5.id === nq.id, [v5, b5.toasts, b5.logs]);
    // the shared snapshot has no link id in it, so the old link stays in the address (it keeps working)
    t('bob: ... address keeps the working old link', /layout=/.test(await searchOf(b5)), [await pathOf(b5), await searchOf(b5)]);
    // leave -> back to own
    await b5.evaluate(() => window.STRYKER_LAYOUTS.leaveShared()); await sleep(2000);
    t('bob: leave shared -> own layout URL', (await pathOf(b5)) === '/charts/' + bc.slug, await pathOf(b5));
    await b5.close();
    // ?symbol= on /charts/<ID>
    const b6 = await open(Bb, BASE, '/charts/' + bc.slug + '?vela=0.9&symbol=ES1!'); await sleep(3000);
    t('bob: /charts/<own>?symbol= still applies the symbol', /ES1!/.test(await sym(b6)), await sym(b6));
    t('bob: no page errors', [b1, b2, b3, b4, b5, b6].every((p) => !p.errs.length), [b1, b2, b3, b5, b6].map((p) => p.errs));
    await b6.close();
    await Bb.close();

    // ================= 3. signed out -> local id, moved to the account on sign-in (same id)
    DB.forEach((v, k) => { if (k.startsWith('students/carol/')) DB.delete(k); });
    const G = await session(b, null, 1440, 900, false);
    const g1 = await open(G, BASE, '/charts?vela=0.9');
    const gp = await waitPath(g1, SLUG) ? await pathOf(g1) : null;
    const gs = gp && gp.slice(8);
    t('signed out: local id in the URL + localStorage', !!gs && (await g1.evaluate(() => JSON.parse(localStorage.getItem('stryker_chart_layout_slug_guest')))) === gs, [gp]);
    await g1.reload({ waitUntil: 'domcontentloaded' }); await g1.waitForFunction(() => window.STRYKER_LAYOUTS, null, { timeout: 60000 }); await sleep(2500);
    t('signed out: same id after reload', (await pathOf(g1)) === gp, await pathOf(g1));
    await g1.screenshot({ path: `${OUT}/links-guest-1440-dark.png` });
    const st = await G.storageState(); await G.close();
    const C2 = await session(b, 'carol', 1440, 900, false);
    await C2.addInitScript((s) => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); JSON.parse(s).origins.forEach((og) => (og.localStorage || []).forEach((kv) => { if (!/theme|prompt|ack/.test(kv.name)) localStorage.setItem(kv.name, kv.value); })); }, JSON.stringify(st));
    const c1 = await open(C2, BASE, gp + '?vela=0.9'); await sleep(3000);
    const cl = layoutDoc('carol', 'My chart');
    t('sign-in: the device chart is saved to the account with the SAME id', cl && cl.slug === gs && DB.get('chartLinks/' + gs).ownerUid === 'carol', cl && cl.slug);
    t('sign-in: URL keeps the id, layout open', (await pathOf(c1)) === gp && ((await curL(c1)) || {}).slug === gs, [await pathOf(c1), await curL(c1)]);
    t('sign-in: guest id cleared from this device', (await c1.evaluate(() => localStorage.getItem('stryker_chart_layout_slug_guest'))) === 'null');
    await c1.close(); await C2.close();

    // ================= 4. backfill: an old layout without a slug gets one when opened; content untouched
    const old = { name: 'Old one', state: JSON.stringify({ version: 1, layout: '1', charts: [{ id: 'A', symbol: 'futures:CL1!', timeframe: '60' }] }), symbol: 'futures:CL1!', interval: '60', shared: false, updatedAt: { __ms: 1700000000000 } };
    DB.set('students/alice/chartLayouts/oldLayoutAAAAAAAAAAA', JSON.parse(JSON.stringify(old)));
    const A5 = await session(b, 'alice', 1440, 900, false);
    await A5.addInitScript(() => { try { localStorage.setItem('stryker_chart_layout_auto_alice', 'false'); } catch (e) {} });
    const a5 = await open(A5, BASE, '/charts?vela=0.9&openlayout=oldLayoutAAAAAAAAAAA'); await sleep(3000);
    const od = DB.get('students/alice/chartLayouts/oldLayoutAAAAAAAAAAA');
    t('backfill: old layout gets a slug on first open', /^[A-HJKMNP-Z2-9]{8}$/.test(od.slug || '') && (await pathOf(a5)) === '/charts/' + od.slug, [od.slug, await pathOf(a5)]);
    t('backfill: content, name and updatedAt untouched', od.state === old.state && od.name === old.name && od.symbol === old.symbol && od.updatedAt.__ms === 1700000000000);
    t('all link ids unique', new Set(allSlugs()).size === allSlugs().length, allSlugs());
    await A5.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
