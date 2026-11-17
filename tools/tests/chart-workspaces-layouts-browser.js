// Charts WORKSPACES vs LAYOUTS test (Owner 17 Nov: "layouts are different stuff and workspace is different stuff").
// A workspace's own chart doc (kind 'workspace') must never show as a layout; the Layouts menu acts on real layouts only.
// Same harness as chart-workspaces-leak-browser.js (in-memory Firestore, recorded bars, no network).
//   python3 -m http.server 8263   (repo root)
//   CHART_BASE=http://127.0.0.1:8263 flock -w 3600 /tmp/stryker-chrome.lock node tools/tests/chart-workspaces-layouts-browser.js <outDir>
// Checks: 2 workspaces + 2 real layouts -> Recently used + Open layout + Library list only the 2 layouts; the Workspaces list
// only workspaces; Save layout in WS2 asks for a name and makes a new layout (workspace doc not renamed); switching to WS1
// leaves WS1 unchanged (own chart, no layout from WS2); legacy index (own doc in layoutId, named after the workspace)
// is migrated + marked without changing any doc's content; stale Recently used entries for workspace docs are cleaned.
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

const LAY = 'students/alice/chartLayouts/';
const docsNow = () => [...DB.entries()].filter(([k]) => k.startsWith(LAY)).map(([k, v]) => ({ id: k.slice(LAY.length), name: v.name, kind: v.kind || '', ws: v.ws || '', state: v.state }));
// open the Layout menu the way a member does: the toolbar button (desktop) or the ⋯ list's "Layout:" row (phone)
const openLayMenu = async (p) => {
  const vis = await p.evaluate(() => !!document.getElementById('stkl-btn').getClientRects().length && !document.getElementById('stkl-btn').closest('#stkc-more-pop'));
  if (vis) await p.click('#stkl-btn');
  else { await p.click('#stkc-more-btn'); await sleep(400); await p.click('#stkl-btn'); }
  await sleep(700);
};
const recentNames = async (p) => { await openLayMenu(p); return p.$$eval('#stkl-pop .stkl-rec .stkc-mi-l', (e) => e.map((x) => x.textContent)); };
const closeMenus = async (p) => { await p.keyboard.press('Escape'); await sleep(200); };
const openNames = async (p) => { await openLayMenu(p);
  await p.evaluate(() => [...document.querySelectorAll('#stkl-pop .stkl-item')].find((b) => /Open layout/.test(b.textContent)).click()); await p.waitForSelector('.stkl-list .stkl-row', { timeout: 8000 }).catch(() => {});
  await sleep(400); return p.$$eval('.stkl-list .stkl-row b', (b) => b.map((x) => x.textContent)); };
const askLayout = async (p, nm) => { await p.waitForSelector('.stkl-dlg input', { timeout: 8000 }); await p.fill('.stkl-dlg input', nm); await p.click('.stkl-dlg .stkc-sbtn'); await sleep(1500); };

(async () => {
  const b = await launch();
  try {
    const VW = +process.env.VW || 1440, VH = +process.env.VH || 900, TH = process.env.THEME || 'dark', TAG = VW + '-' + TH;
    // ---------------------------------------------------------------- legacy account (written by the old code)
    // WS "Workspace 2" kept its chart as a layout named after it; WS "Main" had the real layout "Gary" opened in it.
    const LEG = 'ABCDEFGHIJ0000000002', GARY = 'ABCDEFGHIJ00000000GA';
    const st = (sym) => JSON.stringify({ version: 1, layout: '1', charts: [{ id: 'A', symbol: sym, timeframe: '15' }] });
    DB.set(LAY + LEG, { name: 'Workspace 2', state: st('futures:CL1!'), symbol: 'futures:CL1!', interval: '15', shared: false, updatedAt: { __ms: 1 } });
    DB.set(LAY + GARY, { name: 'Gary', state: st('futures:MNQ1!'), symbol: 'futures:MNQ1!', interval: '15', shared: false, updatedAt: { __ms: 2 } });
    const before = { [LEG]: DB.get(LAY + LEG).state, [GARY]: DB.get(LAY + GARY).state };
    DB.set('students/alice/chartPrefs/workspaces', { index: JSON.stringify({ v: 1, active: 'wmain0001', t: Date.now() + 1e9, items: [
      { id: 'wmain0001', name: 'Main', layoutId: GARY, layoutName: 'Gary' }, { id: 'wleg00002', name: 'Workspace 2', layoutId: LEG, layoutName: 'Workspace 2' }] }), updatedAt: { __ms: 3 } });
    const A = await session(b, 'alice', VW, VH, VW < 700, TH);
    await A.addInitScript(([leg, gary]) => { try { if (!localStorage.getItem('__seeded')) { localStorage.setItem('__seeded', '1');
      localStorage.setItem('stryker_chart_layout_recent_alice', JSON.stringify([{ id: leg, name: 'Workspace 2' }, { id: gary, name: 'Gary', sub: 'MNQ1! · 15m' }])); } } catch (e) {} }, [LEG, GARY]);
    const a = await open(A); await sleep(5000);
    const ixA = await W(a, () => window.STRYKER_WORKSPACES.index);
    const leg = ixA.items.find((x) => x.name === 'Workspace 2'), main = ixA.items.find((x) => x.name === 'Main');
    t('legacy: own doc moved to wsDoc, real layout stays a layout', !!leg && leg.wsDoc === LEG && !leg.layoutId && !!main && main.layoutId === GARY && main.wsDoc !== GARY, ixA.items.map((x) => [x.name, x.wsDoc, x.layoutId]));
    t('legacy: workspace doc marked kind workspace in the account', DB.get(LAY + LEG).kind === 'workspace' && DB.get(LAY + LEG).ws === 'wleg00002' && !DB.get(LAY + GARY).kind, [DB.get(LAY + LEG).kind, DB.get(LAY + GARY).kind]);
    t('legacy: no content changed (state of both docs identical)', DB.get(LAY + LEG).state === before[LEG] && DB.get(LAY + GARY).state === before[GARY] && DB.get(LAY + LEG).name === 'Workspace 2' && DB.get(LAY + GARY).name === 'Gary');
    t('legacy: stale Recently used entry for the workspace doc cleaned', await W(a, (leg) => !JSON.parse(localStorage.getItem('stryker_chart_layout_recent_alice') || '[]').some((x) => x.id === leg), LEG));

    // ---------------------------------------------------------------- 2 workspaces + 2 real layouts
    await W(a, () => window.STRYKER_WORKSPACES.rename(window.STRYKER_WORKSPACES.active.id, 'WS1'));
    await W(a, () => window.STRYKER_LAYOUTS.createNew('Layout A')); await sleep(1500);
    await edit(a, 'futures:ES1!'); await sleep(3000);
    await W(a, () => window.STRYKER_LAYOUTS.createNew('Layout B')); await sleep(1500);
    await edit(a, 'futures:GC1!'); await sleep(3000);
    const s1 = await screen(a);
    await W(a, () => window.STRYKER_WORKSPACES.createNew('WS2')); await waitIdle(a);
    // WS2 = 2 charts side by side (a different grid, so switching back rebuilds the grid; see the report: a same-grid
    // in-place restore depends on the engine's market:changed event, which this offline harness never fires)
    await W(a, async () => { window.STRYKER_CHART_UI.setLayout('2h'); await new Promise((r) => setTimeout(r, 1200)); });
    await edit(a, 'crypto:BTCUSDT'); await sleep(4000);
    const realNames = ['Gary', 'Layout A', 'Layout B'];
    const wsNames = await W(a, () => window.STRYKER_WORKSPACES.index.items.map((x) => x.name));
    const rec = await recentNames(a); await shot(a, 'wslay-' + TAG + '-layouts-menu');
    // alignment of the Recently used rows: icon + text share one centre, same height, equal side padding
    const mL = await W(a, () => { const pop = document.getElementById('stkl-pop').getBoundingClientRect();
      return [...document.querySelectorAll('#stkl-pop .stkl-rec')].map((r) => { const b = r.getBoundingClientRect(), i = r.querySelector('.stkc-mi-ic').getBoundingClientRect(), t = r.querySelector('.stkc-mi-t').getBoundingClientRect();
        return { h: Math.round(b.height), icC: +(i.top + i.height / 2 - (b.top + b.height / 2)).toFixed(1), txC: +(t.top + t.height / 2 - (b.top + b.height / 2)).toFixed(1), padL: Math.round(i.left - pop.left), padR: Math.round(pop.right - b.right) }; }); });
    console.log('MEASURE layouts-recent ' + TAG + ' ' + JSON.stringify(mL));
    t('Recently used rows: same height, icon and text centred (+-1px)', mL.every((r) => r.h === mL[0].h && Math.abs(r.icC) <= 1 && Math.abs(r.txC) <= 1), mL);
    await closeMenus(a);
    t('Recently used lists only layouts (no workspace names)', rec.length >= 2 && rec.every((n) => realNames.includes(n)) && !rec.some((n) => wsNames.includes(n) || /^Workspace/.test(n)), { rec, wsNames });
    const opn = await openNames(a); await shot(a, 'wslay-' + TAG + '-open-dialog'); await closeMenus(a);
    t('Open layout lists only the real layouts', opn.slice().sort().join('|') === realNames.join('|'), opn);
    const lib = await W(a, async () => (await window.STRYKER_LAYOUTS.list()).map((x) => x.name).sort());
    t('Library / count list (L.list) only the real layouts', lib.join('|') === realNames.join('|'), lib);
    await W(a, () => document.getElementById('stkws-btn').click()); await sleep(600); await shot(a, 'wslay-' + TAG + '-workspaces-menu');
    const wl = await a.$$eval('#stkws-pop .stkws-l', (e) => e.map((x) => x.textContent));
    const mW = await W(a, () => { const pop = document.getElementById('stkws-pop').getBoundingClientRect();
      return [...document.querySelectorAll('#stkws-pop .stkws-li')].map((li) => { const b = li.getBoundingClientRect(), g = li.querySelector('.stkws-grip').getBoundingClientRect(), t = li.querySelector('.stkws-t').getBoundingClientRect();
        return { h: Math.round(b.height), gripC: +(g.top + g.height / 2 - (b.top + b.height / 2)).toFixed(1), txC: +(t.top + t.height / 2 - (b.top + b.height / 2)).toFixed(1), padL: Math.round(b.left - pop.left), padR: Math.round(pop.right - b.right) }; }); });
    console.log('MEASURE workspaces-list ' + TAG + ' ' + JSON.stringify(mW));
    t('Workspaces rows: grip and text centred (+-1px), equal side padding', mW.every((r) => Math.abs(r.gripC) <= 1 && Math.abs(r.txC) <= 1 && r.padL === r.padR), mW);
    await closeMenus(a);
    t('Workspaces list only workspaces', wl.slice().sort().join('|') === wsNames.slice().sort().join('|') && !wl.some((n) => realNames.includes(n)), { wl, wsNames });
    t('every workspace doc in the account is kind workspace', docsNow().filter((d) => !realNames.includes(d.name)).every((d) => d.kind === 'workspace'), docsNow().map((d) => [d.name, d.kind]));

    // ---------------------------------------------------------------- Save layout inside WS2 makes a normal layout
    const ws2 = await W(a, () => window.STRYKER_WORKSPACES.active);
    t('WS2 opens with no layout tracked (Unsaved layout)', await W(a, () => !window.STRYKER_LAYOUTS.current));
    await W(a, () => window.STRYKER_LAYOUTS.saveNow(true));
    await askLayout(a, 'BTC idea');
    const d2 = DB.get(LAY + ws2.wsDoc);
    t('Save layout in WS2 asked for a name and made a new layout', docsNow().some((d) => d.name === 'BTC idea' && !d.kind) && await W(a, () => window.STRYKER_LAYOUTS.current && window.STRYKER_LAYOUTS.current.name === 'BTC idea'));
    t('WS2 own doc not renamed, still a workspace', !!d2 && d2.name === 'WS2' && d2.kind === 'workspace');
    await edit(a, 'crypto:ETHUSDT'); await sleep(3500);
    await a.keyboard.press('Control+1'); await waitIdle(a);
    const back1 = await screen(a);
    await shot(a, 'wslay-' + TAG + '-ws1-after');
    t('switch to WS1: unchanged, its own chart', same(back1, s1) && (await name(a)) === 'WS1', { back1, s1 });
    t('WS1 does not show the layout saved in WS2', await W(a, () => !window.STRYKER_LAYOUTS.current || window.STRYKER_LAYOUTS.current.name !== 'BTC idea'), await W(a, () => window.STRYKER_LAYOUTS.current));
    // opening a real layout in WS1 loads it without turning it into the workspace
    await W(a, () => window.STRYKER_LAYOUTS.list().then((l) => window.STRYKER_LAYOUTS.openById(l.find((x) => x.name === 'Gary').id))); await sleep(2500);
    t('open Gary in WS1: workspace keeps its name, Gary keeps its name', (await name(a)) === 'WS1' && DB.get(LAY + GARY).name === 'Gary' && !DB.get(LAY + GARY).kind);
    await W(a, () => window.STRYKER_WORKSPACES.switchTo(window.STRYKER_WORKSPACES.index.items.find((x) => x.name === 'WS2').id)); await waitIdle(a);
    t('back in WS2: its chart (2 charts, ETH) and its layout BTC idea', (await screen(a)).layout === '2h' && /^crypto:ETHUSDT@/.test((await screen(a)).charts[0]) && await W(a, () => window.STRYKER_LAYOUTS.current && window.STRYKER_LAYOUTS.current.name === 'BTC idea'), await screen(a));
    // reload: still separate
    await open(A, a); await sleep(3000);
    const rec2 = await recentNames(a); await closeMenus(a);
    t('after reload: Recently used still only layouts', rec2.every((n) => realNames.concat('BTC idea').includes(n)), rec2);
    t('no layout or workspace doc lost', ['Gary', 'Layout A', 'Layout B', 'BTC idea', 'WS1', 'WS2', 'Workspace 2'].every((n) => docsNow().some((d) => d.name === n)), docsNow().map((d) => d.name));
    t('no page errors', !a.errs.length, a.errs);
    await A.close();
  } catch (e) { fail++; console.log('FAIL exception', String(e && e.stack || e).slice(0, 600)); }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
