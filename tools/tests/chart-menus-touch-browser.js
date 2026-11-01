// Chart menus touch test at 390 (Owner 2026-11-01 "cleaner chart menus on phone"): ⋯ > Layout and Templates
// bottom sheets with real taps and swipes; reuses the in-memory Firestore from chart-layouts-lib-browser.js.
// (fake-server code below is a copy of that file)
// Firestore shared by every browser context (the "server"), with a small copy of the access rules for the
// cases under test (private layouts, link-only, community members). The real rules are covered by
// tools/tests/chart-layouts-lib-rules-test.py.
//   node tools/tests/chart-fixture-server.mjs 8251 any.json     (any.json = {})
//   CHART_BASE=http://127.0.0.1:8251 flock -w 3600 /tmp/stryker-chrome.lock node tools/tests/chart-menus-touch-browser.js <outDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const { newCtx, sleep } = require('./phone-layouts-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8251';
const OUT = process.argv[2] || '.'; fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

// ---------------------------------------------------------------- the fake server
const DB = new Map();           // path -> data
const put = (p, d) => DB.set(p, d);
put('profiles/alice', { displayName: 'Alice T' }); put('profiles/bob', { displayName: 'Bob K' });
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
}

async function session(b, uid, w, h, mobile, theme) {
  const ctx = await newCtx(b, { w, h, mobile });
  await ctx.exposeFunction('__fsRaw', async (op, u, ...a) => { try { return { ok: server[op](u, ...a) }; } catch (e) { return { err: e.code || 'error', msg: e.message }; } });
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
const lib = (p, tab) => p.evaluate((x) => window.STRYKER_LAYOUTS.library.open(x), tab);
const shot = (p, n) => p.screenshot({ path: OUT + '/' + n + '.png' });
const txt = (p, sel) => p.$$eval(sel, (a) => a.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
const fp = (p) => p.evaluate(() => JSON.stringify(window.STRYKER_VELA.getState().charts.map((c) => ({ i: c.indicators, d: c.drawings, tf: c.timeframe, sym: c.symbol }))));
const closeLib = async (p) => { await p.keyboard.press('Escape'); await sleep(400); };
(async () => {
  const b = await launch();
  try {
    const C = await session(b, 'bob', 390, 844, true, 'dark');
    const p = await open(C, BASE);
    const cdp = await C.newCDPSession(p);
    const drag = async (x, y1, y2) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y1 }] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y1 + (y2 - y1) * i / 8 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(700);
    };
    const vis = (s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && !!e.getClientRects().length; }, s);
    const openMenu = async (label) => { await sleep(300); await p.tap('#stkc-more-btn'); await sleep(600); await p.tap('#stkc-more-pop [data-ob-label^="' + label + '"]'); await sleep(700); };
    // 1. layout sheet
    await openMenu('Layout');
    const box = await p.$eval('#stkl-pop', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, w: r.width, b: Math.round(r.bottom), h: innerHeight }; });
    await sleep(400);
    t('⋯ > Layout opens a bottom sheet', box.l === 0 && box.w === 390 && Math.abs(box.b - box.h) < 2, box);
    const kb = await p.$$eval('#stkl-pop kbd', (a) => a.filter((k) => k.getClientRects().length).length);
    t('no keyboard shortcut shown on touch', kb === 0, kb);
    const small = await p.$$eval('#stkl-pop .stkc-mi', (a) => a.filter((x) => x.getBoundingClientRect().height < 48).map((x) => x.textContent.trim()));
    t('every row >= 48 px', !small.length, small);
    const dis = await p.$$eval('#stkl-pop button:disabled', (a) => a.length);
    t('no greyed rows', dis === 0, dis);
    // 2. Autosave toggle by tap
    const a0 = await p.$eval('#stkl-pop .stkg-swrow input', (c) => c.checked);
    await p.tap('#stkl-pop .stkg-swrow:has-text("Autosave")'); await sleep(400);
    const a1 = await p.$eval('#stkl-pop .stkg-swrow input', (c) => c.checked);
    t('tap Autosave toggles it', a0 !== a1, { a0, a1 });
    await p.tap('#stkl-pop .stkg-swrow:has-text("Autosave")'); await sleep(300);
    // 3. close by tapping outside (scrim)
    await p.touchscreen.tap(195, 60); await sleep(500);
    t('tap outside closes the sheet', !(await vis('#stkl-pop')));
    // 4. save, then Share link
    await p.evaluate(() => window.STRYKER_LAYOUTS.saveAsNew('NQ morning')); await sleep(1500);
    await openMenu('Layout');
    await p.tap('#stkl-pop .stkl-item:has-text("Share link")'); await sleep(700);
    t('Share link opens the share sheet', await vis('.stkl-dlg'));
    await p.tap('.stkl-dlg .stkg-swrow:has-text("Share with a link")'); await sleep(1500);
    const sh = await p.evaluate(() => !!(window.STRYKER_LAYOUTS.current && window.STRYKER_LAYOUTS.current.shared));
    t('share switch turns sharing on + link row shows', sh && await vis('.stkl-linkrow'), sh);
    await p.screenshot({ path: OUT + '/touch-390-share-on.png' });
    await p.tap('.stkl-dlg .stkl-hd button'); await sleep(400);
    // 5. close by swipe-down on the header
    await openMenu('Layout');
    const hb = await p.$eval('#stkl-pop .stkc-sh', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 120, y: r.top + 20 }; });
    await drag(hb.x, hb.y, hb.y + 220);
    t('swipe down closes the layout sheet', !(await vis('#stkl-pop')));
    // 6. Templates: apply a starter, set default
    await openMenu('Templates');
    t('Templates opens as a bottom sheet', await vis('#stkc-tpl-pop'));
    await p.tap('#stkc-tpl-pop .stkc-tname:has-text("Index pair")'); await sleep(1500);
    const lay = await p.evaluate(() => [document.querySelector('[data-layout]') && document.querySelector('[data-layout]').getAttribute('data-layout'), window.STRYKER_VELA.getState().charts.map((c) => c.symbol)]);
    t('apply starter "Index pair" (2h, NQ + ES)', !(await vis('#stkc-tpl-pop')) && JSON.stringify(lay).includes('NQ') && JSON.stringify(lay).includes('ES'), lay);
    await openMenu('Templates');
    await p.tap('#stkc-tpl-pop .stkc-trow:has-text("Quad") .stkc-tstar'); await sleep(900);
    const st = await p.$eval('#stkc-tpl-pop .stkc-trow:has-text("Quad") .stkc-tstar', (e) => [e.getAttribute('aria-pressed'), e.title]);
    t('star sets default (filled, labelled)', st[0] === 'true' && /Default/.test(st[1]), st);
    await p.screenshot({ path: OUT + '/touch-390-tpl-default.png' });
    const th = await p.$eval('#stkc-tpl-pop .stkc-sh', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 120, y: r.top + 20 }; });
    await drag(th.x, th.y, th.y + 220);
    t('swipe down closes Templates', !(await vis('#stkc-tpl-pop')));
    // 7. Chart layout sheet (Owner 2026-11-01 follow-up): pick 2 charts, Symbol sync, swipe down, state kept
    await p.evaluate(() => window.STRYKER_CHART_UI.grid.setLayout('1')); await sleep(800);
    await openMenu('Charts in layout');
    const gb = await p.$eval('#stkc-layout-pop', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, w: r.width, b: Math.round(r.bottom), h: innerHeight, t: (e.querySelector('.stkc-sh h2') || {}).textContent }; });
    t('Charts in layout opens the "Chart layout" bottom sheet', gb.l === 0 && gb.w === 390 && Math.abs(gb.b - gb.h) < 2 && gb.t === 'Chart layout', gb);
    const one = await p.evaluate(() => ({ note: !document.querySelector('.stkg-syncnote').hidden, rows: [...document.querySelectorAll('#stkc-layout-pop .stkg-swrow')].filter((r) => r.getClientRects().length).length }));
    t('1 chart: sync switches hidden, one line shown', one.note && one.rows === 0, one);
    await p.screenshot({ path: OUT + '/touch-390-grid-1.png' });
    await p.tap('#stkc-layout-pop .stkg-pc[data-n="2"]'); await sleep(1500);
    t('picking 2 charts closes the sheet + sets 2 charts', !(await vis('#stkc-layout-pop')) && await p.evaluate(() => window.STRYKER_VELA.getState().charts.length === 2));
    await openMenu('Charts in layout');
    const sel = await p.$eval('#stkc-layout-pop .stkg-pc[data-n="2"]', (e) => [e.getAttribute('aria-pressed'), getComputedStyle(e.querySelector('.stkg-ck')).display]);
    t('2 tile selected with check', sel[0] === 'true' && sel[1] !== 'none', sel);
    const s0 = await p.$eval('#stkc-layout-pop [data-sync="symbol"]', (c) => c.checked);
    await p.tap('#stkc-layout-pop .stkg-swrow:has([data-sync="symbol"])'); await sleep(500);
    const s1 = await p.$eval('#stkc-layout-pop [data-sync="symbol"]', (c) => c.checked);
    t('tap Symbol sync toggles it', s0 !== s1 && s1, { s0, s1 });
    const sw = await p.$eval('#stkc-layout-pop [data-sync="symbol"]', (c) => { const cs = getComputedStyle(c), k = getComputedStyle(c, '::after'); return [cs.backgroundColor, k.backgroundColor, c.getBoundingClientRect().height]; });
    t('on switch = solid green track, white knob', /rgb\(3, 201, 136\)/.test(sw[0]) && sw[1] === 'rgb(255, 255, 255)', sw);
    await p.screenshot({ path: OUT + '/touch-390-grid-2-sync.png' });
    const gh = await p.$eval('#stkc-layout-pop .stkc-sh', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 120, y: r.top + 20 }; });
    await drag(gh.x, gh.y, gh.y + 220);
    t('swipe down closes the Chart layout sheet', !(await vis('#stkc-layout-pop')));
    await openMenu('Charts in layout');
    const kept = await p.evaluate(() => [document.querySelector('#stkc-layout-pop [data-sync="symbol"]').checked, window.STRYKER_CHART_UI.grid.syncState().symbol]);
    t('reopen: Symbol sync still on', kept[0] === true && !!kept[1], kept);
    await p.touchscreen.tap(195, 60); await sleep(500);
    t('tap outside closes the Chart layout sheet', !(await vis('#stkc-layout-pop')));
    // 8. Market sessions (clock) sheet: title, ⓘ expands the note, swipe down closes
    await p.tap('.mclock-pill'); await sleep(700);
    const ck = await p.$eval('.mclock-pop', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, w: r.width, b: Math.round(r.bottom), h: innerHeight, t: (e.querySelector('.stkms-hd h2') || {}).textContent, note: getComputedStyle(e.querySelector('.mclock-note')).display }; });
    t('clock opens the "Market sessions" bottom sheet, note folded', ck.l === 0 && ck.w === 390 && Math.abs(ck.b - ck.h) < 2 && ck.t === 'Market sessions' && ck.note === 'none', ck);
    await p.tap('.stkms-i'); await sleep(400);
    t('ⓘ expands the session note', await p.$eval('.mclock-note', (e) => getComputedStyle(e).display !== 'none' && !e.closest('[hidden]')));
    const cs = await p.$eval('.stkms-hd', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 120, y: r.top + 20 }; });
    await drag(cs.x, cs.y, cs.y + 220);
    t('swipe down closes the clock sheet', !(await vis('.mclock-pop')));
    // 9. Chart settings: header, green Ok, 44 px footer, tapping a row label toggles its switch
    await openMenu('Chart settings'); await sleep(600);
    const sd = await p.evaluate(() => { const d = document.querySelector('.vela-dialog--settings'); const ok = d.querySelector('.stk-sd-ok'); return { t: d.querySelector('.vela-dialog-title').textContent, ok: getComputedStyle(ok).backgroundColor, small: [...d.querySelectorAll('.stk-sd-foot .vela-sd-btn')].filter((b) => b.getClientRects().length && b.getBoundingClientRect().height < 44).length, burger: !!(d.querySelector('.vela-sd-burger') || {}).offsetParent }; });
    t('settings: "Chart settings", green Ok, footer >= 44 px, no burger', sd.t === 'Chart settings' && /rgb\(3, 201, 136\)/.test(sd.ok) && sd.small === 0 && !sd.burger, sd);
    const lab = await p.$('.vela-dialog--settings .vela-sd-bool:not(.stk-sd-off) .vela-field-label');
    const sw0 = await lab.evaluate((l) => l.closest('.vela-sd-bool').querySelector('[role=switch]').getAttribute('aria-checked'));
    await lab.tap(); await sleep(400);
    const sw1 = await lab.evaluate((l) => l.closest('.vela-sd-bool').querySelector('[role=switch]').getAttribute('aria-checked'));
    t('tap on a settings row label toggles its switch', sw0 !== sw1, { sw0, sw1 });
    await p.tap('.vela-dialog--settings .stk-sd-foot .vela-sd-btn:has-text("Cancel")'); await sleep(600);
    t('Cancel closes settings', !(await vis('.vela-dialog--settings')));
    // 10. Alerts: empty state + quiet Sounds + counter
    await openMenu('Alerts'); await sleep(600);
    const al = await p.evaluate(() => { const b = document.querySelector('.stk-al-box'); return { empty: !!b.querySelector('.stk-al-empty b') && b.querySelector('.stk-al-empty b').textContent, cnt: b.querySelector('.stk-al-count').textContent, snd: getComputedStyle(b.querySelector('.stk-al-sounds')).backgroundColor }; });
    t('alerts: empty state, "0 of 200 alerts", Sounds not a filled primary', al.empty === 'No alerts yet' && /^0 of 200 alerts/.test(al.cnt) && !/rgb\(3, 201, 136\)/.test(al.snd), al);
    await p.tap('.stk-al-x'); await sleep(500);
    // 11. Watchlist ⋯ menu is a bottom sheet; tapping outside closes it
    await openMenu('Watchlist'); await sleep(600);
    await p.tap('.stkw-ib[title="More"]'); await sleep(500);
    const wm = await p.evaluate(() => { const m = [...document.querySelectorAll('.stkw-menu')].find((x) => !x.hidden); const r = m.getBoundingClientRect(); return { l: r.left, w: r.width, b: Math.round(r.bottom), h: innerHeight, foot: document.querySelector('.stkw-foot').textContent }; });
    t('watchlist ⋯ opens as a bottom sheet; one-line footer', wm.l === 0 && wm.w === 390 && Math.abs(wm.b - wm.h) < 2 && /dot = data status/.test(wm.foot), wm);
    await p.touchscreen.tap(195, 120); await sleep(500);
    t('tap outside closes the watchlist menu', await p.evaluate(() => [...document.querySelectorAll('.stkw-menu')].every((x) => x.hidden)));
    t('"Education only" still on the page', await p.evaluate(() => /Education only/.test(document.querySelector('.stkchart-credit').textContent)));
    await p.screenshot({ path: OUT + '/touch-390-after-swipe.png' }); console.log('page errors', JSON.stringify(p.errs));
  } catch (e) { fail++; console.log('FAIL exception', e.message); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
