// Chart Library browser test (assets/chart-layouts-lib.js). No network: recorded NQ bars + an in-memory
// Firestore shared by every browser context (the "server"), with a small copy of the access rules for the
// cases under test (private layouts, link-only, community members). The real rules are covered by
// tools/tests/chart-layouts-lib-rules-test.py.
//   node tools/tests/chart-fixture-server.mjs 8251 any.json     (any.json = {})
//   CHART_BASE=http://127.0.0.1:8251 flock -w 3600 /tmp/stryker-chrome.lock node tools/tests/chart-layouts-lib-browser.js <outDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const { newCtx, sleep } = require('./phone-layouts-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8251';
const OUT = process.argv[2] || '.';
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
    if (th === 'light') document.documentElement.setAttribute('data-theme', 'light');
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
  const pages = [];
  try {
    const A = await session(b, 'alice', 1440, 900, false);
    const a = await open(A, BASE); pages.push(a);
    // chart with 3 indicators (changed inputs) and 2 panes
    await a.evaluate(async () => {
      const ch = window.STRYKER_VELA.chart;
      ch.addNativeIndicator('ema', { inputs: { length: 34 } }); ch.addNativeIndicator('rsi', { inputs: { length: 7 } }); ch.addNativeIndicator('macd', { inputs: { fast: 8 } });
      await new Promise((r) => setTimeout(r, 1200));
      window.STRYKER_CHART_UI.setLayout('2h');
      await new Promise((r) => setTimeout(r, 1500));
    });
    const before = await fp(a);
    await a.evaluate(() => window.STRYKER_LAYOUTS.saveAsNew('Alice setup'));
    await sleep(1500);
    const saved = [...DB.entries()].find(([p]) => p.startsWith('students/alice/chartLayouts/'));
    t('save: doc has state, 2 panes, indicators, webp thumb <= 60000', !!saved && saved[1].panes === 2 && saved[1].indicators >= 3 && /^data:image\/webp/.test(saved[1].thumb || '') && saved[1].thumb.length <= 60000, saved && { panes: saved[1].panes, ind: saved[1].indicators, thumb: (saved[1].thumb || '').length });
    const lid = saved[0].split('/').pop();
    // the wipe below is a test device, not a member edit: keep autosave from saving it over the layout
    await a.evaluate(() => localStorage.setItem('stryker_chart_layout_auto_' + window.__UID, 'false'));
    await a.evaluate(() => window.STRYKER_CHART_UI.applySaved({ state: { version: 1, layout: '1', charts: [{ id: 'A', symbol: 'futures:NQ1!', timeframe: '5' }] } }));
    await sleep(800);
    await a.evaluate((id) => window.STRYKER_LAYOUTS.openById(id), lid);
    await sleep(2500);
    const after = await fp(a);
    t('save -> wipe -> open: indicators + inputs, drawings, panes identical', before === after, before === after ? undefined : { before: before.slice(0, 200), after: after.slice(0, 200) });

    await lib(a, 'browse'); await sleep(900);
    t('Discover empty: friendly state + "Share your first layout"', (await txt(a, '.lyl-empty')).join('|').includes('The library is empty') && (await txt(a, '.lyl-empty button')).includes('Share your first layout'));
    await shot(a, 'browse-empty-1440-dark');
    await closeLib(a);

    await lib(a, 'mine'); await sleep(900);
    const mc = (await txt(a, '.lyl-mr')).join('|');
    t('Mine: Current tag, visibility pill, edited + "2 panes · N indicators"', mc.includes('Current') && /Private/.test(mc) && /edited/.test(mc) && /2 panes · [3-9] indicators/.test(mc), mc);
    await shot(a, 'mine-1440-dark');
    await a.click('.lyl-hd .lyl-ib[aria-label="More actions"]'); await a.click('.lyl-menu button:has-text("Share")'); await a.waitForSelector('.lyl-pub');
    await a.fill('.lyl-pub input[aria-label="Name"]', 'Order flow pair');
    await a.fill('.lyl-pub textarea', 'EMA, RSI and MACD with two panes');
    await a.click('.lyl-pub .lyl-chips .lyl-chip:nth-child(1)'); await a.click('.lyl-pub .lyl-chips .lyl-chip:nth-child(4)');
    await a.fill('.lyl-pub input[aria-label="Custom tag"]', 'My Tag!'); await a.keyboard.press('Enter');
    await a.click('.lyl-vopt:nth-child(3)');
    await shot(a, 'share-1440-dark');
    await a.fill('.lyl-pub input[aria-label="Name"]', 'Fuck this');
    await a.click('.lyl-pub .lyl-pri'); await sleep(300);
    t('publish: blocked word refused, nothing written', (await a.$eval('.lyl-pub .stkc-err', (e) => !e.hidden && /offensive/.test(e.textContent))) && ![...DB.keys()].some((k) => k.startsWith('publicLayouts/')));
    await a.fill('.lyl-pub input[aria-label="Name"]', 'Order flow pair');
    await a.click('.lyl-pub .lyl-pri'); await sleep(1800);
    const pl = DB.get('publicLayouts/' + lid);
    t('publish public: card (author = profile name, no email, counts 0) + state doc', !!pl && pl.visibility === 'public' && pl.authorName === 'Alice T' && !JSON.stringify(pl).includes('@') && pl.likeCount === 0 && pl.useCount === 0 && pl.tags.includes('my tag') && DB.has('publicLayouts/' + lid + '/data/s'), pl && { v: pl.visibility, a: pl.authorName, tags: pl.tags });
    await a.close();

    // ---- bob
    const B = await session(b, 'bob', 1440, 900, false);
    const bp = await open(B, BASE); pages.push(bp);
    await lib(bp, 'browse'); await sleep(1200);
    const items = (await txt(bp, '.lyl-gc')).join('|');
    t('Browse: public layout listed with NEW, author, 0 counts', items.includes('Order flow pair') && items.includes('New') && items.includes('by @alicet') && /\d+ uses/.test(items), items);
    await sleep(800);
    const ics = (await txt(bp, '.lyl-gc .lyl-ic')).join('|');
    t('Discover: indicator-name chips (first 2 + "+N") and topic row, no carousel', /EMA|Ema/.test(ics) && /\+\d/.test(ics) && !!(await bp.$('.lyl-topics')) && !(await bp.$('.lyl-car')), ics);
    await bp.click('.lyl-topics .lyl-chip:has-text("Scalping")'); await sleep(200);
    t('topic chip filters (no scalping layout)', (await txt(bp, '.lyl-gc')).length === 0);
    await bp.click('.lyl-topics .lyl-chip:has-text("All")'); await sleep(200);
    await bp.click('.lyl-gc h3'); await sleep(900);
    const dt = (await txt(bp, '.lyl-det')).join('|');
    t('detail: description, indicators with settings, tags, Use / Copy to mine / Report', dt.includes('EMA, RSI and MACD') && (await bp.$$('.lyl-irow')).length >= 3 && /length 34/.test(dt) && dt.includes('#my tag') && dt.includes('Use layout') && dt.includes('Copy to mine') && dt.includes('Report'), dt.slice(0, 300));
    await shot(bp, 'detail-1440-dark');
    await bp.click('.lyl-det .lyl-dback'); await sleep(300);
    t('detail: back returns to the grid', !(await bp.$('.lyl-det')));
    await bp.fill('.lyl-search', 'nomatch'); await sleep(200);
    t('search: no match state', (await txt(bp, '.lyl-empty')).join('|').includes('Nothing matches'));
    await bp.fill('.lyl-search', '#my tag'); await sleep(200);
    t('search by tag', (await txt(bp, '.lyl-gc')).length === 1);
    await bp.fill('.lyl-search', 'alice'); await sleep(200);
    t('search by author', (await txt(bp, '.lyl-gc')).length === 1);
    await bp.fill('.lyl-search', ''); await sleep(200);
    await bp.click('.lyl-gc .lyl-like'); await sleep(600);
    t('like: count 1 + marker', DB.get('publicLayouts/' + lid).likeCount === 1 && DB.has('publicLayouts/' + lid + '/likes/bob'));
    await bp.click('.lyl-gc .lyl-like'); await sleep(600);
    t('unlike: back to 0, marker gone', DB.get('publicLayouts/' + lid).likeCount === 0 && !DB.has('publicLayouts/' + lid + '/likes/bob'));
    await bp.click('.lyl-gc .lyl-like'); await sleep(500);
    await bp.click('.lyl-gc .lyl-fav'); await sleep(600);
    t('favourite: layoutFavs doc', DB.has('students/bob/layoutFavs/' + lid));
    await shot(bp, 'browse-1440-dark');
    await bp.click('#lyl-tab-favs'); await sleep(900);
    t('Favorites tab lists it', (await txt(bp, '.lyl-gc')).join('|').includes('Order flow pair'));
    await shot(bp, 'favs-1440-dark');
    await bp.click('#lyl-tab-browse'); await sleep(800);
    await bp.click('.lyl-gc .lyl-use'); await sleep(2500);
    const bfp = await fp(bp);
    t('apply: chart matches the published layout', bfp === before, bfp.slice(0, 120));
    t('apply: use counted once, sheet closed', DB.get('publicLayouts/' + lid).useCount === 1 && DB.has('publicLayouts/' + lid + '/uses/bob') && !(await bp.$('.lyl-panel')));
    await lib(bp, 'browse'); await sleep(800); await bp.click('.lyl-gc .lyl-use'); await sleep(2000);
    t('apply again: still 1 use for bob', DB.get('publicLayouts/' + lid).useCount === 1);
    await lib(bp, 'favs'); await sleep(600); await bp.click('.lyl-fav'); await sleep(500);
    t('unstar -> "Nothing starred yet"', (await txt(bp, '.lyl-empty')).join('|').includes('Nothing starred yet') && !DB.has('students/bob/layoutFavs/' + lid));
    await shot(bp, 'favs-empty-1440-dark');
    await bp.click('#lyl-tab-browse'); await sleep(600);
    await bp.click('.lyl-gc h3'); await sleep(500); await bp.click('.lyl-det .lyl-txt'); await bp.click('.lyl-row:has-text("Spam")'); await sleep(700);
    t('report: marker + reportCount 1', DB.get('publicLayouts/' + lid).reportCount === 1 && DB.has('publicLayouts/' + lid + '/reports/bob'));
    await closeLib(bp);
    await bp.evaluate(() => window.STRYKER_LAYOUTS.saveAsNew('Bob private')); await sleep(1200);
    const bobId = [...DB.keys()].find((k) => k.startsWith('students/bob/chartLayouts/')).split('/').pop();
    await lib(bp, 'mine'); await sleep(800);
    await bp.evaluate((id) => window.STRYKER_LAYOUTS_LIB.publishDialog(id), bobId); await bp.waitForSelector('.lyl-pub');
    await bp.click('.lyl-vopt:nth-child(2)'); await bp.click('.lyl-pub .lyl-pri'); await sleep(1500);
    t('link only: chartShared written, NOT in publicLayouts', DB.has('chartShared/' + bobId) && !DB.has('publicLayouts/' + bobId));
    await bp.evaluate((id) => window.STRYKER_LAYOUTS_LIB.publishDialog(id), bobId); await bp.waitForSelector('.lyl-pub');
    await bp.click('.lyl-vopt:nth-child(4)'); await sleep(200);
    t('community, no community owned: "Create a community in Creator Hub"', (await txt(bp, '.lyl-comm')).join('|').includes('Create a community in Creator Hub'));
    await shot(bp, 'share-community-nocomm-1440-dark');
    await bp.close();

    // ---- alice sells to community zoro
    const A2 = await session(b, 'alice', 1440, 900, false);
    const a2 = await open(A2, BASE); pages.push(a2);
    await a2.evaluate((id) => window.STRYKER_LAYOUTS.openById(id), lid); await sleep(2500);
    await lib(a2, 'mine'); await sleep(700);
    await a2.evaluate((id) => window.STRYKER_LAYOUTS_LIB.publishDialog(id), lid); await a2.waitForSelector('.lyl-pub');
    await a2.click('.lyl-vopt:nth-child(4)'); await sleep(200);
    t('community option: picker lists my community', (await txt(a2, '.lyl-comm option')).includes('Zoro Room'));
    await shot(a2, 'share-community-1440-dark');
    await a2.click('.lyl-pub .lyl-pri'); await sleep(1800);
    const cd = DB.get('publicLayouts/' + lid);
    t('community: card visibility=community, communityId=zoro', cd.visibility === 'community' && cd.communityId === 'zoro', cd);
    await a2.close();

    const D = await session(b, 'dave', 1440, 900, false);
    const dp = await open(D, BASE); pages.push(dp);
    await lib(dp, 'browse'); await sleep(1000);
    t('Browse hides the community layout from the public list', !(await txt(dp, '.lyl-gc')).join('|').includes('Order flow pair'));
    const dr = await dp.evaluate(async (id) => { const r = {}; try { await firebase.firestore().doc('publicLayouts/' + id + '/data/s').get(); r.state = 'READ'; } catch (e) { r.state = e.code; } try { await firebase.firestore().doc('students/alice/chartLayouts/' + id).get(); r.priv = 'READ'; } catch (e) { r.priv = e.code; } return r; }, lid);
    t('non-member: community state denied; another member\'s private layout denied', dr.state === 'permission-denied' && dr.priv === 'permission-denied', dr);
    await dp.close();
    const B2 = await session(b, 'bob', 1440, 900, false);
    const b2 = await open(B2, BASE); pages.push(b2);
    const br = await b2.evaluate(async (id) => { try { return (await firebase.firestore().doc('publicLayouts/' + id + '/data/s').get()).exists; } catch (e) { return e.code; } }, lid);
    t('community member: can read the state', br === true, br);

    // ================= shots + real touch test (card is made public again so Browse has content)
    const cur0 = DB.get('publicLayouts/' + lid); cur0.visibility = 'public'; cur0.communityId = ''; cur0.useCount = 3; cur0.likeCount = 2;
    DB.set('publicLayouts/' + lid + '/data/s', DB.get('publicLayouts/' + lid + '/data/s'));
    // more cards so the shots show a real grid (same state doc, different card fields)
    [['gexmap', 'GEX levels + flow', 'Mia R', ['gex', 'futures'], 'futures:ES1!', '5', 12, 7], ['scalp5', 'Fast scalp stack', 'Raj P', ['scalping', 'order flow'], 'futures:NQ1!', '1', 5, 2], ['swingd', 'Daily swing trend', 'Lena V', ['swing', 'trend'], 'crypto:BTCUSDT', 'D', 0, 0], ['cryptoh', 'Crypto hourly map', 'Tom B', ['crypto'], 'crypto:ETHUSDT', '60', 2, 1]].forEach(([id, name, au, tags, sym, iv, uc, lc], i) => {
      DB.set('publicLayouts/' + id, Object.assign({}, cur0, { ownerUid: 'u_' + id, authorName: au, name, tags, symbol: sym, interval: iv, useCount: uc, likeCount: lc, desc: 'Sample ' + name, createdAt: { __ms: Date.now() - (i + 2) * 864e5 * 3 } }));
      DB.set('publicLayouts/' + id + '/data/s', DB.get('publicLayouts/' + lid + '/data/s'));
    });
    const swipe = async (p, x1, x2, y) => {
      const c = await p.context().newCDPSession(p);
      await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }] });
      for (let i = 1; i <= 8; i++) await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * i / 8, y }] });
      await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(900);
    };
    const tabNow = (p) => p.$eval('.lyl-tab.on', (e) => e.textContent.trim()).catch(async () => { await p.screenshot({ path: OUT + '/debug.png' }); return 'NONE ' + p.url() + ' ' + (await p.evaluate(() => document.body && document.body.innerText.slice(0, 80)).catch((e) => 'x ' + e.message)); });
    for (const [w, h, theme, mobile] of [[390, 844, 'dark', true], [390, 844, 'light', true], [1440, 900, 'light', false], [1440, 900, 'dark', false]]) {
      const tag = w + '-' + theme;
      const Bs = await session(b, 'bob', w, h, mobile, theme);
      const p = await open(Bs, BASE);
      if (mobile && theme === 'dark') {
        // open from the real layout menu with a tap
        await p.tap('#stkc-more-btn'); await sleep(600);
        await p.tap('#stkc-more-pop [data-ob-label^="Layout"]'); await sleep(700);
        const menuItem = await p.$('#stkl-pop .stkl-item:has-text("Chart Library")');
        t('390: ⋯ > Layout menu has "Chart Library…"', !!menuItem);
        if (menuItem) await menuItem.tap(); else await lib(p, 'browse');
        await p.waitForSelector('.lyl-panel', { timeout: 8000 }); await sleep(1200);
        const box = await p.$eval('.lyl-panel', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, b: r.bottom, h: innerHeight, sw: document.documentElement.scrollWidth }; });
        t('390: sheet fits (no horizontal scroll, bottom sheet)', box.w <= 390 && box.sw <= 390 && Math.abs(box.b - box.h) < 4, box);
        await swipe(p, 320, 60, 640);
        t('390: swipe left -> Mine', (await tabNow(p)) === 'Mine', await tabNow(p));
        await swipe(p, 320, 60, 640);
        t('390: swipe left -> Starred', (await tabNow(p)) === 'Starred', await tabNow(p));
        await swipe(p, 100, 340, 640); await swipe(p, 100, 340, 640);
        t('390: swipe right x2 -> Discover', (await tabNow(p)) === 'Discover', await tabNow(p));
        await p.tap('.lyl-gc[data-id="' + lid + '"] .lyl-fav'); await sleep(700);
        t('390: tap star favourites', DB.has('students/bob/layoutFavs/' + lid));
        await p.tap('.lyl-filter'); await sleep(500);
        t('390: tap sort/filter opens menu inside the sheet', !!(await p.$('.lyl-menu')) && (await p.$eval('.lyl-menu', (e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })));
        await shot(p, 'menu-390-dark');
        await p.tap('.lyl-panel .lyl-hd h2').catch(() => {}); await sleep(300);
        await p.tap('.lyl-gc[data-id="' + lid + '"] h3'); await sleep(900);
        t('390: tap card opens the detail view', !!(await p.$('.lyl-det')) && (await p.$$('.lyl-irow')).length >= 3);
        await shot(p, 'detail-390-dark-touch');
        await p.tap('.lyl-det .lyl-dback'); await sleep(400);
        const tapTargets = await p.$$eval('.lyl-panel button, .lyl-panel select, .lyl-panel input', (a) => a.filter((x) => x.offsetParent && !x.closest('.lyl-menu')).map((x) => { const r = x.getBoundingClientRect(); return { c: x.className.slice(0, 20), h: Math.round(r.height), w: Math.round(r.width) }; }).filter((x) => x.h < 40 || x.w < 40));
        t('390: tap targets >= 40px (excluding inline like count)', tapTargets.filter((x) => !/lyl-stat|lyl-chip/.test(x.c)).length === 0, tapTargets);
        await p.tap('.lyl-gc[data-id="' + lid + '"] .lyl-use'); await sleep(2500);
        t('390: tap Use layout loads the layout and closes the sheet', (await fp(p)) === before && !(await p.$('.lyl-panel')));
      }
      await lib(p, 'browse'); await sleep(1800); await shot(p, 'discover-' + tag);
      await p.click('.lyl-gc[data-id="' + lid + '"] h3'); await sleep(1000); await shot(p, 'detail-' + tag);
      if (theme === 'dark' && w === 390) {
        await p.click('.lyl-det .lyl-sec'); await sleep(2500);
        t('detail: Copy to mine applies + saves a copy', [...DB.keys()].some((k) => k.startsWith('students/bob/chartLayouts/') && /copy$/.test((DB.get(k) || {}).name || '')));
        await lib(p, 'browse'); await sleep(1000);
      }
      await p.click('.lyl-det .lyl-dback').catch(() => {}); await sleep(300);
      await p.click('#lyl-tab-favs'); await sleep(900); await shot(p, 'starred-' + tag);
      await p.click('#lyl-tab-mine'); await sleep(900); await shot(p, 'mine-' + tag);
      await closeLib(p);
      await p.close();
    }
    for (const [w, h, theme, mobile] of [[390, 844, 'dark', true], [390, 844, 'light', true], [1440, 900, 'light', false], [1440, 900, 'dark', false]]) {
      const tag = w + '-' + theme;
      const As = await session(b, 'alice', w, h, mobile, theme);
      const p = await open(As, BASE);
      await p.evaluate((id) => window.STRYKER_LAYOUTS.openById(id), lid); await sleep(2500);
      await lib(p, 'mine'); await sleep(1000); await shot(p, 'mine-owner-' + tag);
      if (mobile && theme === 'dark') {
        await p.tap('.lyl-mr .lyl-more'); await sleep(500);
        const mm = (await txt(p, '.lyl-menu button')).join('|');
        t('390: Mine overflow menu has Share…, Duplicate, Delete', ['Share…', 'Duplicate', 'Delete'].every((w) => mm.includes(w)), mm);
        await shot(p, 'mine-menu-390-dark'); await p.tap('.lyl-panel .lyl-hd h2'); await sleep(300);
      }
      await p.evaluate((id) => window.STRYKER_LAYOUTS_LIB.publishDialog(id), lid); await p.waitForSelector('.lyl-pub'); await sleep(500);
      await shot(p, 'share-' + tag);
      if (mobile && theme === 'dark') {
        const fits = await p.$eval('.lyl-pub', (e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; });
        t('390: Publish dialog inside the viewport', fits);
        await p.click('.lyl-vopt:nth-child(4)'); await sleep(300); await shot(p, 'share-community-390-dark');
      }
      await p.keyboard.press('Escape'); await closeLib(p);
      await p.close();
    }
    const errs = pages.map((p) => p.errs).flat();
    t('no page errors', !errs.length, errs);
    await b2.close();
  } catch (e) { fail++; console.log('FAIL exception', e.stack || e); }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
