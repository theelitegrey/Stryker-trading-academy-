// Workspace TAB right-click menu browser test (assets/chart-workspaces.js openMenu). Same harness as chart-workspaces-browser.js.
//   node tools/tests/chart-fixture-server.mjs 8263 tools/tests/fixtures/empty.json
//   CHART_BASE=http://127.0.0.1:8263 flock -w 3600 /tmp/stryker-chrome.lock node tools/tests/chart-wsmenu-browser.js <outDir>
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

const items = (p) => W(p, () => [...document.querySelectorAll('.stkws-cm .stkws-cm-it')].map((x) => x.querySelector('.stkws-cm-l').textContent));
const names = (p) => W(p, () => window.STRYKER_WORKSPACES.index.items.map((x) => x.name + (x.pinned ? '*' : '')).join('|'));
const rc = async (p, i) => { await p.click('.stkws-tab >> nth=' + i, { button: 'right' }); await p.waitForSelector('.stkws-cm.open'); };
const pick = async (p, label) => { await p.click('.stkws-cm .stkws-cm-l >> text="' + label + '"'); await sleep(400); };

// the Workspaces list popover: measure rows (open + closed) on one centre line, equal pads
const listMeasure = (p) => W(p, () => {
  const pop = document.querySelector('#stkws-pop'), pb = pop.getBoundingClientRect(), bad = [], out = { bad };
  const rows = [...pop.querySelectorAll('.stkws-li')];
  rows.forEach((li) => {
    const lr = li.getBoundingClientRect(), c = lr.top + lr.height / 2;
    [...li.children].forEach((k) => { const r = k.getBoundingClientRect(); if (Math.abs(r.top + r.height / 2 - c) > 1) bad.push('centre ' + k.className + ' ' + (r.top + r.height / 2 - c)); });
    if (lr.left - pb.left < 7 || pb.right - lr.right < 7) bad.push('edge pad');
  });
  const cl = [...pop.querySelectorAll('.stkws-cli')];
  cl.forEach((li) => {
    const r = li.querySelector('.stkws-row').getBoundingClientRect(), re = li.querySelector('.stkws-reopen').getBoundingClientRect(), d = li.querySelector('.stkws-cdel').getBoundingClientRect(), l = li.querySelector('.stkws-l').getBoundingClientRect();
    out.closedRow = { h: r.height, delH: d.height, delW: d.width, reopenCy: re.top + re.height / 2 - (r.top + r.height / 2), padL: l.left - r.left, padR: r.right - re.right, delRight: pb.right - d.right };
    if (Math.abs(re.top + re.height / 2 - (d.top + d.height / 2)) > 1) bad.push('reopen/delete centres');
  });
  const open0 = rows.find((x) => !x.classList.contains('stkws-cli')).getBoundingClientRect();
  out.openRowH = open0.height; out.closedCount = cl.length; out.pad = [Math.round(pb.left), Math.round(pb.right)];
  out.sameH = cl.every((x) => Math.abs(x.getBoundingClientRect().height - open0.height) <= 1);
  out.onScreen = pb.left >= 0 && pb.right <= innerWidth && pb.bottom <= innerHeight && pb.top >= 0;
  return out;
});
const openList = async (p) => { await p.click('#stkws-btn'); await p.waitForSelector('#stkws-pop:not([hidden])'); await sleep(400); };
const tabNames = (p) => W(p, () => [...document.querySelectorAll('.stkws-tab .stkws-tn')].map((x) => x.textContent).join('|'));
const ixNames = (p) => W(p, () => window.STRYKER_WORKSPACES.index.items.map((x) => x.name + (x.closed ? '~' : '')).join('|'));

(async () => {
  const b = await launch();
  try {
    for (const theme of ['dark', 'light']) {
      for (const k of [...DB.keys()]) if (/chartPrefs|chartLayouts/.test(k)) DB.delete(k);   // each run starts clean
      const A = await session(b, 'alice', 1440, 900, false, theme);
      const a = await open(A);
      let dialogs = 0; a.removeAllListeners('dialog'); a.on('dialog', (d) => { dialogs++; d.accept(); });
      for (const n of ['Two', 'Three']) { await W(a, (n) => window.STRYKER_WORKSPACES.createNew(n), n); await waitIdle(a); }
      if (theme === 'dark') {
        // BEFORE: x on the active tab used to ask "Delete the workspace" (index length shrank). Now: closes, nothing asked, nothing deleted.
        t('tab x exists on 3 tabs', await W(a, () => document.querySelectorAll('.stkws-tab .stkws-x').length) === 3);
        await a.hover('.stkws-tab.on'); await a.click('.stkws-tab.on .stkws-x'); await sleep(900);
        t('x closes the tab, no confirm, workspace kept', dialogs === 0 && (await tabNames(a)) === 'Workspace 1|Two' && (await ixNames(a)) === 'Workspace 1|Two|Three~', [dialogs, await tabNames(a), await ixNames(a)]);
        t('closing the active tab switched to a neighbour', await W(a, () => window.STRYKER_WORKSPACES.active.name) === 'Two');
        // middle click closes too
        await a.click('.stkws-tab >> nth=0', { button: 'middle' }); await sleep(800);
        t('middle-click closes', (await tabNames(a)) === 'Two' && dialogs === 0, await ixNames(a));
        t('last open tab: no x delete, close refused', (await W(a, async () => window.STRYKER_WORKSPACES.close(window.STRYKER_WORKSPACES.active.id))) === false && (await tabNames(a)) === 'Two');
        await a.screenshot({ path: OUT + '/ws-closed-tabs-1440-dark.png' });
      } else {
        await a.click('.stkws-tab >> nth=1 >> .stkws-x'); await sleep(600); await a.click('.stkws-tab >> nth=0 >> .stkws-x'); await sleep(900);
      }
      await openList(a);
      const m = await listMeasure(a);
      t(theme + ': list shows Closed workspaces with 2 rows', m.closedCount === 2 && await W(a, () => [...document.querySelectorAll('#stkws-pop .stkws-h')].map((x) => x.textContent).join() === 'Workspaces,Closed workspaces'), m);
      t(theme + ': alignment (one centre, same row height, edge pads, on screen)', Math.abs(m.closedRow.reopenCy) <= 1 && !m.bad.length && m.sameH && m.onScreen, m);
      console.log(theme + ' list measure', JSON.stringify(m));
      const box = await W(a, () => { const r = document.querySelector('#stkws-pop').getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 48), width: r.width + 16, height: r.height + 56 }; });
      await a.screenshot({ path: OUT + '/ws-closed-list-1440-' + theme + '-crop.png', clip: box });
      if (theme === 'dark') {
        await a.click('.stkws-cli >> nth=0 >> .stkws-row'); await sleep(1500); await waitIdle(a);
        t('click a closed workspace reopens + opens it', (await ixNames(a)).split('|').filter((x) => /~$/.test(x)).length === 1 && (await tabNames(a)).split('|').length === 2 && dialogs === 0, [await tabNames(a), await ixNames(a)]);
        // delete stays explicit with confirm
        let asked = ''; a.removeAllListeners('dialog'); a.on('dialog', (d) => { asked = d.message(); d.dismiss(); });
        await openList(a); await a.click('.stkws-cli .stkws-cdel'); await sleep(500);
        t('delete from closed list asks, cancel keeps it', /Delete the workspace/.test(asked) && (await ixNames(a)).split('|').length === 3, asked);
        a.removeAllListeners('dialog'); a.on('dialog', (d) => d.accept());
        await openList(a); await a.click('.stkws-cli .stkws-cdel'); await sleep(900);
        t('delete confirmed removes it for good', (await ixNames(a)).split('|').length === 2 && !/~/.test(await ixNames(a)), await ixNames(a));
        // menu: Close workspace, then reload keeps closed state
        await W(a, () => window.STRYKER_WORKSPACES.createNew('Four')); await waitIdle(a);
        await a.click('.stkws-tab >> nth=0', { button: 'right' }); await a.waitForSelector('.stkws-cm.open');
        await pick(a, 'Close workspace'); await sleep(800);
        const before = await ixNames(a);
        await sleep(2000); await open(A, a); await sleep(1500);
        t('reload keeps closed workspace closed and saved', (await ixNames(a)) === before && /~/.test(before), [before, await ixNames(a)]);
        t('Ctrl+1 hits first OPEN workspace', await W(a, () => { const i = window.STRYKER_WORKSPACES.index; return i.items.filter((x) => !x.closed).length >= 1; }));
      }
      t(theme + ': no page errors', !a.errs.length, a.errs);
      await A.close();
    }
    // phone 390: list sheet
    for (const k of [...DB.keys()]) if (/chartPrefs|chartLayouts/.test(k)) DB.delete(k);
    const P = await session(b, 'alice', 390, 844, true);
    const p = await open(P);
    for (const n of ['Two', 'Three']) { await W(p, (n) => window.STRYKER_WORKSPACES.createNew(n), n); await waitIdle(p); }
    await W(p, () => window.STRYKER_WORKSPACES.close(window.STRYKER_WORKSPACES.index.items[0].id)); await sleep(600);
    await openList(p);
    const pm = await listMeasure(p);
    t('390: sheet lists the closed workspace; rows 48px, one centre, on screen', pm.closedCount === 1 && pm.closedRow.h >= 47.5 && pm.closedRow.delH >= 47.5 && !pm.bad.length && pm.sameH, pm);
    console.log('390 list measure', JSON.stringify(pm));
    await p.screenshot({ path: OUT + '/ws-closed-list-390.png' });
    t('390: no page errors', !p.errs.length, p.errs);
    await P.close();
  } catch (e) { fail++; console.log('FAIL exception', String(e && e.stack || e).slice(0, 700)); }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
