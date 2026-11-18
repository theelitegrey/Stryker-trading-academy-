// ONE ACCOUNT, SYNCED EVERYWHERE (Owner 18 Nov): two browser contexts signed in as the SAME member, sharing one
// in-memory Firestore (Node side) with live snapshot listeners (polled every 250 ms, like a real listener firing on
// server change; own writes come back too, as they do in Firestore, which exercises the echo guard).
// Same harness as chart-workspaces-layouts-browser.js (recorded bars, no network).
//   python3 -m http.server 8264   (repo root)
//   CHART_BASE=http://127.0.0.1:8264 flock -w 3600 /tmp/stryker-chrome.lock node tools/tests/account-sync-browser.js <outDir>
// In context A: save a chart template, save indicator style defaults, save chart settings default, switch the theme,
// star a chart type, add a watchlist symbol, set a paper hotkey, star an interval. Context B (open the whole time, no
// reload) must show every one within a few seconds. Then B changes things back -> A follows. Counts writes (no storm).
const fs = require('fs');
const { launch } = require('./lib.js');
const { newCtx, sleep } = require('./phone-layouts-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8264';
const OUT = process.argv[2] || '.';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };

const DB = new Map();
DB.set('students/alice', { name: 'Alice', plan: 'Elite', residenceCountry: 'US', sanctionsAttest: true, emailVerified: true });
const rev = (v) => { if (Array.isArray(v)) return v.map(rev); if (v && typeof v === 'object') { if (v.__ts) return { __ms: Date.now() }; const o = {}; for (const k in v) o[k] = rev(v[k]); return o; } return v; };
const deepMerge = (a, b) => { const o = Object.assign({}, a); for (const k in b) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && b[k].__ms === undefined && a && a[k] && typeof a[k] === 'object') ? deepMerge(a[k], b[k]) : b[k]; return o; };
const denied = () => { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; };
const mine = (uid, path) => { const s = path.split('/'); return !!uid && (!['students', 'users'].includes(s[0]) || s[1] === uid); };
const writesBy = {};   // path prefix -> count
const server = {
  get: (uid, path) => { if (!mine(uid, path)) denied(); return { exists: DB.has(path), data: DB.get(path) || null }; },
  commit: (uid, ws) => {
    ws.forEach((w) => { if (!mine(uid, w.path)) denied(); });
    ws.forEach((w) => {
      const k = w.path.split('/').slice(0, 4).join('/'); writesBy[k] = (writesBy[k] || 0) + 1;
      const cur = DB.get(w.path);
      if (w.op === 'delete') DB.delete(w.path);
      else if (w.op === 'set') DB.set(w.path, w.merge && cur ? deepMerge(cur, rev(w.data)) : rev(w.data));
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
  const meta = { hasPendingWrites: false, fromCache: false };
  const snap = (id, r) => ({ id, exists: !!r.exists, metadata: meta, data: () => (r.exists ? back(cl(r.data)) : undefined), get: (f) => (r.exists ? back(cl(r.data))[f] : undefined) });
  // live listener: poll the shared server, fire when the JSON changes (first call fires at once)
  const live = (read, wrap, cb) => { let last = null, stop = false; const tick = () => { if (stop) return; read().then((r) => { const j = JSON.stringify(r); if (j !== last) { last = j; try { cb(wrap(r)); } catch (e) { console.error(e); } } }).catch(() => {}).finally(() => { if (!stop) setTimeout(tick, 250); }); }; tick(); return () => { stop = true; }; };
  const FV = { serverTimestamp: () => ({ __ts: 1 }), increment: (n) => ({ __inc: n }), delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' };
  const listOf = (rows) => { const docs = rows.map((r) => snap(r.id, { exists: true, data: r.data })); return { docs, empty: !docs.length, size: docs.length, metadata: meta, forEach: (f) => docs.forEach(f), docChanges: () => [] }; };
  const ref = (path) => ({ id: path.split('/').pop(), path,
    get: () => window.__fs('get', U(), path).then((r) => snap(path.split('/').pop(), r)),
    set: (d, o) => window.__fs('commit', U(), [{ op: 'set', path, data: d, merge: !!(o && o.merge) }]),
    update: (d) => window.__fs('commit', U(), [{ op: 'update', path, data: d }]),
    delete: () => window.__fs('commit', U(), [{ op: 'delete', path }]),
    onSnapshot: (cb) => live(() => window.__fs('get', U(), path), (r) => snap(path.split('/').pop(), r), cb),
    collection: (s) => col(path + '/' + s) });
  const col = (path) => { const self = {
    doc: (id) => ref(path + '/' + (id || Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12))),
    where: () => self, orderBy: () => self, limit: () => self, startAfter: () => self,
    get: () => window.__fs('query', U(), path).then(listOf),
    add: async (d) => { const r = self.doc(); await r.set(d); return r; },
    onSnapshot: (cb) => live(() => window.__fs('query', U(), path), listOf, cb) }; return self; };
  const db = { collection: col, doc: (p) => ref(p), batch: () => { const w = []; const b = { set: (r, d, o) => { w.push({ op: 'set', path: r.path, data: d, merge: !!(o && o.merge) }); return b; }, update: (r, d) => { w.push({ op: 'update', path: r.path, data: d }); return b; }, delete: (r) => { w.push({ op: 'delete', path: r.path }); return b; }, commit: () => window.__fs('commit', U(), w) }; return b; }, runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o), update: (r, d) => r.update(d), delete: (r) => r.delete() }) };
  window.__stubDb = db; window.db = db;
  window.firebase.apps = [{}];
  window.firebase.firestore = Object.assign(() => db, { FieldValue: FV, Timestamp: { now: () => ({ toDate: () => new Date() }), fromDate: (d) => ({ toDate: () => d }) } });
  const u = window.__stubAuth.currentUser; u.uid = U();
}
async function session(b, uid, w, h, mobile) {
  const ctx = await newCtx(b, { w, h, mobile });
  await ctx.exposeFunction('__fsRaw', async (op, u, ...a) => { try { return { ok: server[op](u, ...a) }; } catch (e) { return { err: e.code || 'error', msg: e.message }; } });
  await ctx.addInitScript(([u]) => {
    window.__UID = u;
    window.__fs = (...a) => window.__fsRaw(...a).then((r) => { if (r.err) { const e = new Error(r.msg); e.code = r.err; throw e; } return r.ok; });
  }, [uid]);
  await ctx.addInitScript('(' + mockInit.toString() + ')()');
  return ctx;
}
async function open(ctx, seed) {
  const p = await ctx.newPage();
  p.errs = []; p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) p.errs.push(String(e).slice(0, 200)); }); p.on('dialog', (d) => d.accept());
  if (seed) await p.addInitScript((s) => { try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, v)); } } catch (e) {} }, seed);
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_WATCHLIST && window.__stkPaper && window.StrykerAccountSync && window.StrykerAccountSync.ready, null, { timeout: 60000 });
  await sleep(2500);
  return p;
}
const W = (p, fn, a) => p.evaluate(fn, a);
const until = async (p, fn, a, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 6000)) { if (await p.evaluate(fn, a).catch(() => false)) return Date.now() - t0; await sleep(150); } return -1; };
const prefWrites = () => Object.entries(writesBy).filter(([k]) => k.startsWith('users/alice/prefs')).reduce((s, [, n]) => s + n, 0);

(async () => {
  const b = await launch();
  try {
    const VW = +process.env.VW || 1440, VH = +process.env.VH || 900;
    // A is an existing browser with settings from before this feature (migration source)
    const A = await session(b, 'alice', VW, VH, VW < 700);
    const a = await open(A, { stryker_theme: 'night', stryker_ctype_favs: '["candles"]', 'stryker.indstyle.defaults': '{"b:stk_vwap":{"z":"front"}}' });
    t('A: account-sync ready (signed in)', await W(a, () => window.StrykerAccountSync.status().ready));
    await sleep(1500);
    const chartDoc = () => DB.get('users/alice/prefs/chart') || { v: {} };
    t('migration: A\'s existing chart type favs uploaded', chartDoc().v.chartTypeFavs === '["candles"]', chartDoc().v);
    t('migration: A\'s indicator defaults uploaded', /stk_vwap/.test(chartDoc().v.indicatorDefaults || ''));
    // B: a phone-sized second device (a different browser profile), nothing saved locally
    const B = await session(b, 'alice', 412, 892, true);
    const bp = await open(B);
    t('B adopted A\'s chart type favs on first open', await W(bp, () => localStorage.getItem('stryker_ctype_favs')) === '["candles"]');
    t('B adopted A\'s indicator defaults on first open', /stk_vwap/.test(await W(bp, () => localStorage.getItem('stryker.indstyle.defaults') || '')));
    const w0 = prefWrites();

    // ---------------------------------------------------------------- changes in A appear in B (no reload)
    await W(bp, () => { window.__tplEv = 0; window.addEventListener('stk:templates-changed', () => { window.__tplEv++; }); });
    await W(a, () => window.StrykerChartTemplates.save('Sync test template', window.STRYKER_VELA.getState()));
    await W(a, () => localStorage.setItem('stryker.indstyle.defaults', JSON.stringify({ 'b:stk_vwap': { z: 'back', layer: { color: '#ff8800' } } })));
    await W(a, () => localStorage.setItem('stryker_chart_settings_default', JSON.stringify({ cfg: { candles: { upColor: '#26a69a', downColor: '#ef5350' } }, ours: {}, status: {}, style: {} })));
    await W(a, () => window.setStrykerTheme('day'));
    await W(a, () => localStorage.setItem('stryker_ctype_favs', '["candles","bars","line"]'));
    const wlSym = 'futures:ZN1!';
    await W(a, (s) => window.STRYKER_WATCHLIST.addSymbol(s), wlSym);
    await W(a, () => window.__stkPaper.hotkeys.set({ buyMarket: 'Shift+B', sellMarket: 'Shift+S' }));
    const tp = await until(bp, () => window.__tplEv > 0 || null, null, 8000);
    t('template saved in A -> B told live (stk:templates-changed)', tp >= 0, tp);
    const bl = await W(bp, () => window.StrykerChartTemplates.list().then((r) => r.items.map((x) => x.name)));
    t('template saved in A is in B\'s list', bl.includes('Sync test template'), bl);
    const ti = await until(bp, () => /ff8800/.test(localStorage.getItem('stryker.indstyle.defaults') || ''), null, 6000);
    t('indicator style defaults (A) -> B ' + ti + ' ms', ti >= 0 && ti < 6000);
    const tc = await until(bp, () => /26a69a/.test(localStorage.getItem('stryker_chart_settings_default') || ''), null, 6000);
    t('chart settings default / colours (A) -> B ' + tc + ' ms', tc >= 0);
    const tt = await until(bp, () => document.documentElement.getAttribute('data-theme') === 'light', null, 6000);
    t('theme day (A) -> B repainted light live ' + tt + ' ms', tt >= 0);
    const ty = await until(bp, () => localStorage.getItem('stryker_ctype_favs') === '["candles","bars","line"]', null, 6000);
    t('chart type favourites (A) -> B ' + ty + ' ms', ty >= 0);
    const tw = await until(bp, (s) => window.STRYKER_WATCHLIST.current && window.STRYKER_WATCHLIST.current.items.includes(s), wlSym, 8000);
    t('watchlist symbol (A) -> B ' + tw + ' ms', tw >= 0, await W(bp, () => window.STRYKER_WATCHLIST.current && window.STRYKER_WATCHLIST.current.items));
    const th = await until(bp, () => { const m = window.__stkPaper.hotkeys.get(); return m.buyMarket === 'Shift+B' && m.sellMarket === 'Shift+S'; }, null, 6000);
    t('paper hotkeys (A) -> B ' + th + ' ms', th >= 0, await W(bp, () => window.__stkPaper.hotkeys.get()));
    await bp.screenshot({ path: OUT + '/acctsync-B-412-after-A.png' });

    // honest latency: one change, clock started in Node right before it is made in A
    const t0 = Date.now();
    await W(a, () => localStorage.setItem('stryker_ctype_favs', '["candles","area"]'));
    await until(bp, () => localStorage.getItem('stryker_ctype_favs') === '["candles","area"]', null, 8000);
    const lat = Date.now() - t0;
    t('one change A -> B end to end ' + lat + ' ms (1 s debounce + listener)', lat < 3500, lat);
    // ---------------------------------------------------------------- and back: B -> A
    await W(bp, () => window.setStrykerTheme('night'));
    await W(bp, () => window.__stkPaper.hotkeys.set({ buyMarket: 'Alt+B' }));
    const tt2 = await until(a, () => document.documentElement.getAttribute('data-theme') !== 'light', null, 6000);
    t('theme night (B) -> A ' + tt2 + ' ms', tt2 >= 0);
    const th2 = await until(a, () => window.__stkPaper.hotkeys.get().buyMarket === 'Alt+B' && !window.__stkPaper.hotkeys.get().sellMarket, null, 6000);
    t('hotkey change (B) -> A ' + th2 + ' ms', th2 >= 0, await W(a, () => window.__stkPaper.hotkeys.get()));
    // device-only fields stay put: B's order-panel window position never reaches A
    await W(bp, () => { const k = 'stryker_op_alice'; const o = JSON.parse(localStorage.getItem(k) || '{}'); o.x = 5; o.y = 6; o.hk = true; localStorage.setItem(k, JSON.stringify(o)); });
    await until(a, () => JSON.parse(localStorage.getItem('stryker_op_alice') || '{}').hk === true, null, 6000);
    const aop = await W(a, () => JSON.parse(localStorage.getItem('stryker_op_alice') || '{}'));
    t('order panel setting synced, B\'s window position not', aop.hk === true && aop.x !== 5, aop);
    await a.screenshot({ path: OUT + '/acctsync-A-' + VW + '-after-B.png' });

    // ---------------------------------------------------------------- no write storm
    const w1 = prefWrites();
    await sleep(6000);
    const w2 = prefWrites();
    t('idle 6 s after the changes: no prefs writes (no echo loop)', w2 === w1, { w1, w2 });
    t('total prefs writes for ~10 changes stay small', w1 - w0 <= 14, { during: w1 - w0, byPath: writesBy });
    const sa = await W(a, () => window.StrykerAccountSync.status()), sb = await W(bp, () => window.StrykerAccountSync.status());
    t('nothing left queued', !sa.dirty.length && !sb.dirty.length, { sa, sb });
    // reload B: settings come from the cache at once and stay
    await bp.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await bp.waitForFunction(() => window.__stkPaper && window.__stkPaper.account && window.StrykerAccountSync && window.StrykerAccountSync.ready, null, { timeout: 30000 })
      .catch(async (e) => { console.log('reload state', JSON.stringify(await W(bp, () => ({ href: location.href, title: document.title, paper: !!window.__stkPaper, acct: !!(window.__stkPaper && window.__stkPaper.account), sync: window.StrykerAccountSync && window.StrykerAccountSync.status ? window.StrykerAccountSync.status() : String(window.StrykerAccountSync) })))); throw e; });
    await sleep(2000);
    t('after reload B keeps the synced theme + hotkey', await W(bp, () => document.documentElement.getAttribute('data-theme') !== 'light' && window.__stkPaper.hotkeys.get().buyMarket === 'Alt+B'));
    t('no page errors', !a.errs.length && !bp.errs.length, a.errs.concat(bp.errs));
    await A.close(); await B.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
