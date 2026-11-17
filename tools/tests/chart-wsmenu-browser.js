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
// measure rows: one centre line, icon / label / shortcut columns aligned, 32 px rows, 8-pt gaps
const measure = (p) => W(p, () => {
  const box = document.querySelector('.stkws-cm'), bb = box.getBoundingClientRect();
  const rows = [...box.querySelectorAll('.stkws-cm-row')], out = { rows: rows.length, bad: [] };
  const ic0 = rows[0].querySelector('.stkws-cm-ic').getBoundingClientRect().left, rr = rows[0].getBoundingClientRect();
  rows.forEach((r) => {
    const q = r.getBoundingClientRect(), c = q.top + q.height / 2, ic = r.querySelector('.stkws-cm-ic').getBoundingClientRect();
    const l = r.querySelector('.stkws-cm-l'), k = r.querySelector('.stkws-cm-k'), kids = [ic, l && l.getBoundingClientRect(), k && k.getBoundingClientRect()].filter(Boolean);
    if (Math.abs(q.height - rows[0].getBoundingClientRect().height) > 1) out.bad.push('height ' + q.height);
    if (Math.abs(ic.left - ic0) > 1) out.bad.push('icon col ' + ic.left);
    if (Math.abs(q.left - rr.left) > 1 || Math.abs(q.right - rr.right) > 1) out.bad.push('row edges');
    if (Math.abs(ic.left - q.left - 8) > 1) out.bad.push('left pad ' + (ic.left - q.left));
    kids.forEach((x) => { if (Math.abs(x.top + x.height / 2 - c) > 1) out.bad.push('centre ' + (x.top + x.height / 2 - c)); });
    if (l) { const lr = l.getBoundingClientRect(); if (Math.abs(lr.left - ic.right - 8) > 1) out.bad.push('label gap ' + (lr.left - ic.right)); }
    if (k && Math.abs(q.right - 8 - k.getBoundingClientRect().right) > 1) out.bad.push('kbd right pad');
  });
  out.h = Math.round(rr.height); out.padL = Math.round(rr.left - bb.left - 1); out.padR = Math.round(bb.right - 1 - rr.right);
  out.onScreen = bb.left >= 0 && bb.top >= 0 && bb.right <= innerWidth && bb.bottom <= innerHeight;
  return out;
});
const cropOf = (p) => W(p, () => { const r = document.querySelector('.stkws-cm').getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 40), width: r.width + 16, height: r.height + 48 }; });

(async () => {
  const b = await launch();
  try {
    const A = await session(b, 'alice', 1440, 900, false);
    const a = await open(A);
    for (const n of ['Two', 'Three', 'Four']) { await W(a, (n) => window.STRYKER_WORKSPACES.createNew(n), n); await waitIdle(a); }
    t('4 workspaces', (await names(a)) === 'Workspace 1|Two|Three|Four', await names(a));
    await rc(a, 1);
    t('right-click opens the menu at the cursor', await W(a, () => { const r = document.querySelector('.stkws-cm').getBoundingClientRect(), t = document.querySelectorAll('.stkws-tab')[1].getBoundingClientRect(); return r.left >= t.left && r.left <= t.right && r.top >= t.top; }));
    const it0 = await items(a);
    t('menu items + 4 dividers', it0.join('|') === 'Pin tab|Set as default workspace|Rename|Duplicate|Save as template…|Copy share link|Move left|Move right|Open in new window|Reset to one chart…|Close workspace|Close other workspaces|Close workspaces to the right|Delete other workspaces…|Delete workspaces to the right…|Delete workspace…' && (await W(a, () => document.querySelectorAll('.stkws-cm .stkws-cm-sep').length)) === 4, it0);
    const m = await measure(a);
    t('alignment: rows 32px, icon/label/kbd columns, 8px pads, centre line, on screen', m.h === 32 && !m.bad.length && m.padL === 8 && m.padR === 8 && m.onScreen, m);
    console.log('dark measure', JSON.stringify(m));
    await shot(a, 'wsmenu-1440-dark');
    await a.screenshot({ path: OUT + '/wsmenu-1440-dark-crop.png', clip: await cropOf(a) });
    await a.keyboard.press('Escape'); await sleep(300);
    t('Escape closes', await W(a, () => !document.querySelector('.stkws-cm')));
    await rc(a, 1); await a.keyboard.press('ArrowDown'); await a.keyboard.press('ArrowDown');
    t('ArrowDown moves focus', await W(a, () => document.activeElement.textContent.includes('Set as default')));
    await a.keyboard.press('ArrowUp'); await a.keyboard.press('Enter'); await sleep(400);
    t('Enter on Pin tab pins; pinned sits left, no close x', (await names(a)) === 'Two*|Workspace 1|Three|Four' && await W(a, () => !document.querySelector('.stkws-tab.pinned .stkws-x')), await names(a));
    await rc(a, 3); await pick(a, 'Set as default workspace'); t('set default', await W(a, () => window.STRYKER_WORKSPACES.index.def === window.STRYKER_WORKSPACES.index.items[3].id));
    await rc(a, 2); await a.click('.stkws-cm .stkws-cm-o.dot[data-o="green"]'); await sleep(400);
    await rc(a, 2); await a.click('.stkws-cm .stkws-cm-o.gl[data-o="star"]'); await sleep(400);
    t('colour + icon stick', await W(a, () => { const x = window.STRYKER_WORKSPACES.index.items[2]; return x.color === 'green' && x.glyph === 'star' && document.querySelectorAll('.stkws-tab')[2].classList.contains('c-green'); }));
    await rc(a, 3); await pick(a, 'Move left');
    t('move left', (await names(a)) === 'Two*|Workspace 1|Four|Three', await names(a));
    await rc(a, 0); t('single pin: Move left disabled', await W(a, () => [...document.querySelectorAll('.stkws-cm .stkws-cm-it')].filter((x) => x.disabled).map((x) => x.textContent).join('|').includes('Move left'))); await a.keyboard.press('Escape'); await sleep(300);
    await rc(a, 1); await pick(a, 'Rename'); await a.fill('.stkws-dlg input', 'Renamed'); await a.click('.stkws-dlg .stkc-sbtn'); await sleep(500);
    t('rename', (await names(a)) === 'Two*|Renamed|Four|Three', await names(a));
    await rc(a, 1); await pick(a, 'Duplicate'); await waitIdle(a);
    t('duplicate', (await names(a)).includes('Renamed (copy)'), await names(a));
    await rc(a, 1); await pick(a, 'Save as template…'); await a.waitForSelector('.stkws-dlg input'); await a.click('.stkws-dlg .stkc-sbtn'); await sleep(1200);
    t('template saved to chartTemplates', [...DB.keys()].some((k) => k.startsWith('students/alice/chartTemplates/')), [...DB.keys()].filter((k) => k.includes('emplate')));
    await W(a, async () => { window.STRYKER_CHART_UI.setLayout('2h'); await new Promise((r) => setTimeout(r, 1000)); });
    const cur = await W(a, () => [...document.querySelectorAll('.stkws-tab')].findIndex((x) => x.classList.contains('on')));
    await rc(a, cur); await pick(a, 'Reset to one chart…'); await sleep(900);
    t('reset layout -> 1 chart, workspace kept', (await screen(a)).charts.length === 1 && (await W(a, () => window.STRYKER_WORKSPACES.index.items.length)) === 5);
    let asked = '';
    a.removeAllListeners('dialog'); a.on('dialog', (d) => { asked = d.message(); d.dismiss(); });
    const n0 = (await names(a)).split('|').length;
    await rc(a, 3); await pick(a, 'Delete workspace…'); await sleep(300);
    t('delete asks first; cancel keeps it', /Delete the workspace/.test(asked) && (await names(a)).split('|').length === n0, asked);
    a.removeAllListeners('dialog'); a.on('dialog', (d) => d.accept());
    await rc(a, 3); await pick(a, 'Delete workspace…'); await sleep(900);
    t('delete confirmed removes it', (await names(a)).split('|').length === n0 - 1, await names(a));
    const keep = await W(a, () => window.STRYKER_WORKSPACES.index.items[1].name);
    await rc(a, 1); await pick(a, 'Delete other workspaces…'); await sleep(1000);
    t('delete others keeps pinned + this one', (await names(a)) === 'Two*|' + keep, await names(a));
    await sleep(2000); await open(A, a); await sleep(1500);
    t('reload: pin persisted', (await names(a)) === 'Two*|' + keep, await names(a));
    await a.close(); await A.close();
    const G = await session(b, null, 1440, 900, false);
    const g = await open(G);
    await W(g, () => window.STRYKER_WORKSPACES.createNew('Gold')); await waitIdle(g);
    await rc(g, 1);
    t('signed out: no share-link item (no layout sharing)', !(await items(g)).includes('Copy share link'));
    await g.keyboard.press('Escape'); await sleep(300);
    await rc(g, 1); await pick(g, 'Pin tab'); await open(G, g); await sleep(1000);
    t('signed out: pin kept on this device', (await names(g)) === 'Gold*|Workspace 1', await names(g));
    await G.close();
    const AL = await session(b, 'alice', 1440, 900, false, 'light');
    const al = await open(AL);
    await rc(al, 0); await sleep(300); await shot(al, 'wsmenu-1440-light');
    await al.screenshot({ path: OUT + '/wsmenu-1440-light-crop.png', clip: await cropOf(al) });
    console.log('light measure', JSON.stringify(await measure(al)));
    await al.keyboard.press('Escape'); await sleep(300);
    await W(al, () => window.STRYKER_WORKSPACES.openMenu(window.STRYKER_WORKSPACES.index.items[0].id, innerWidth - 4, innerHeight - 4, false)); await sleep(300);
    t('edge: stays on screen', (await measure(al)).onScreen);
    t('no page errors (desktop)', !al.errs.length, al.errs);
    await AL.close();
    const P = await session(b, 'alice', 390, 844, true);
    const p = await open(P);
    const bx = await p.$eval('#stkws-btn', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    const cdp = await P.newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bx[0], y: bx[1] }] }); await sleep(800);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(600);
    t('390: long-press opens the menu as a bottom sheet', await W(p, () => { const s = document.querySelector('.stkws-cm.sheet.open'); if (!s) return false; const r = s.getBoundingClientRect(); return Math.abs(innerHeight - r.bottom) <= 1 && r.width >= innerWidth - 1 && [...s.querySelectorAll('.stkws-cm-it')].every((x) => x.getBoundingClientRect().height >= 47.5) && !document.querySelector('#stkws-pop:not([hidden])'); }));
    await shot(p, 'wsmenu-390-sheet');
    t('390: no page errors', !p.errs.length, p.errs);
    await P.close();
  } catch (e) { fail++; console.log('FAIL exception', String(e && e.stack || e).slice(0, 600)); }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
