// Screenshots of a DEMO community for the /creators landing page (never real data).
// Stubs Firebase in the browser with an in-memory "Harbor Lane (example)" community, serves the repo on 127.0.0.1 only.
// Run (Chrome under the shared lock): node tools/creator/landing-shots.js <outdir> [sizes]
// Needs playwright-core and a Chromium (tools/tests/lib.js finds one).
const http = require('http'), fs = require('fs'), path = require('path');
const { launch } = require('../tests/lib.js');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.argv[2] || '/tmp/creators-shots';
fs.mkdirSync(OUT, { recursive: true });
const MT = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const PORT = 8751;
const srv = http.createServer((q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u.startsWith('/c/')) u = '/c.html';
  if (u === '/') u = '/index.html';
  let f = u.startsWith('/__demo/') ? path.join(OUT, '_demo', u.slice(8)) : path.join(ROOT, u);
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': MT[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(PORT, '127.0.0.1');

function stubSrc(member) {
  return '(' + function (MEMBER) {
    const NOW = Date.now(), H = 3600e3, D = 864e5;
    const ts = (ago) => { const t = NOW - ago; return { toMillis: () => t, toDate: () => new Date(t), seconds: Math.floor(t / 1000) }; };
    const S = {}; // path -> data
    const put = (p, d) => { S[p] = d; };
    const C = 'communities/harbor-lane';
    put(C, { name: 'Harbor Lane Futures', tagline: 'A small, calm room for futures traders who journal.', about: 'Example community made for this page.\n\nWeekly level notes, a course on journaling, and one indicator we use on ZoroCharts. Education only. Not financial advice.', ownerUid: 'own', ownerName: 'Ana', status: 'active', visibility: 'public', accent: '#03c988', tags: ['futures', 'order-flow'], memberCount: 0, coverUrl: '/__demo/cover.jpg', features: { feed: true, courses: true, indicators: true, events: true, leaderboard: true, discord: true } });
    put(C + '/plans/free', { name: 'Free room', order: 0, status: 'live', price: { interval: 'free', amount: 0, currency: 'USD' }, joinMode: 'open', desc: 'The feed and the weekly level notes.', bullets: ['Community feed', 'Weekly level notes'] });
    put(C + '/plans/pro', { name: 'Member', order: 1, status: 'live', popular: true, price: { interval: 'month', amount: 29, currency: 'USD' }, desc: 'Everything in the room.', bullets: ['Courses and events', 'Indicators on ZoroCharts', 'Discord role'] });
    if (MEMBER) put(C + '/members/u1', { status: 'active', planId: 'pro', role: 'member', joinedAt: ts(9 * D), source: 'free' });
    put(C + '/indicators/i1', { name: 'Session Levels Pro', version: 3, status: 'live', protected: true, tags: ['levels', 'session'], desc: 'Marks the session highs and lows and the prior-day levels on your chart.', planIds: ['pro'], solo: { mode: 'off' }, shots: ['/assets/images/charts/hero.webp'], settingsNotes: 'Start with the defaults.' });
    put(C + '/indicators/i2', { name: 'Journal Marks', version: 1, status: 'live', protected: true, tags: ['ict'], desc: 'Drop a labelled mark on any bar and review them later.', planIds: ['pro'], solo: { mode: 'free' }, shots: [] });
    put(C + '/courses/c1', { title: 'Journaling for futures traders', desc: 'A short course on keeping a journal you will actually use.', status: 'published', order: 0, solo: { mode: 'off' }, access: { mode: 'all', planIds: [] }, sequential: false });
    put(C + '/courses/c1/modules/m1', { title: 'Start here', order: 0, status: 'published', planIds: [], drip: { mode: 'none' } });
    put(C + '/courses/c1/modules/m2', { title: 'Weekly review', order: 1, status: 'published', planIds: [], drip: { mode: 'date', at: ts(-6 * D) } });
    const L = (id, m, o, t, ty, mins, x) => put(C + '/courses/c1/lessons/' + id, Object.assign({ title: t, type: ty, mins: mins, order: o, moduleId: m, status: 'published', drip: { mode: 'none' } }, x || {}));
    L('l1', 'm1', 0, 'Welcome and how this works', 'video', 4, { preview: true });
    L('l2', 'm1', 1, 'The one-page journal template', 'pdf', 0);
    L('l3', 'm1', 2, 'What to write after each session', 'text', 6, { hasQuiz: true });
    L('l4', 'm2', 0, 'Sunday review routine', 'video', 12);
    L('l5', 'm2', 1, 'Spotting your own patterns', 'text', 8);
    put(C + '/courses/c1/progress/u1', { uid: 'u1', done: { l1: 1, l2: 1 }, pos: {}, last: 'l3', quiz: {} });
    put(C + '/posts/p1', { authorUid: 'own', authorName: 'Ana', text: 'Weekly levels go up Sunday evening. This week: how I mark the prior-day high and low, and why I skip the first five minutes. Education only.', pinned: true, createdAt: ts(3 * D) });
    put(C + '/posts/p2', { authorUid: 'm2', authorName: 'Jordan', text: 'Anyone journaling their ES sessions? I keep a simple checklist and review it every Friday.', pinned: false, createdAt: ts(5 * H) });
    put(C + '/posts/p3', { authorUid: 'm3', authorName: 'Sam', text: 'Finished lesson 3. The after-session questions are short enough that I actually do them.', pinned: false, createdAt: ts(2 * H) });
    put(C + '/comments/k1', { postId: 'p2', authorUid: 'own', authorName: 'Ana', text: 'Yes. Happy to share my template in the course.', createdAt: ts(4 * H) });
    put(C + '/comments/k2', { postId: 'p3', authorUid: 'own', authorName: 'Ana', text: 'That is the idea. Keep it short.', createdAt: ts(1 * H) });
    put(C + '/comments/k3', { postId: 'p1', authorUid: 'm2', authorName: 'Jordan', text: 'Thanks, this helps.', createdAt: ts(2 * D) });
    put(C + '/events/e1', { title: 'Sunday review, live call', desc: 'We go through the week together. Bring one chart you want to talk about.', startsAt: ts(-3 * D), durationMin: 60, link: 'https://example.com/call' });
    put(C + '/events/e2', { title: 'Q and A: building a journal', desc: '', startsAt: ts(-10 * D), durationMin: 45 });
    put(C + '/events/e1/rsvps/m2', { at: ts(D) });
    const kids = (path) => Object.keys(S).filter((k) => k.startsWith(path + '/') && k.slice(path.length + 1).indexOf('/') < 0);
    const snap = (p) => ({ exists: !!S[p], id: p.split('/').pop(), data: () => S[p] || undefined });
    const cmp = (a, b) => (a && a.toMillis ? a.toMillis() : a) - (b && b.toMillis ? b.toMillis() : b);
    function colRef(path, flt, ord, lim) {
      flt = flt || []; ord = ord || null; lim = lim || 0;
      const run = () => {
        let ids = kids(path).map((k) => ({ id: k.split('/').pop(), d: S[k], k }));
        flt.forEach((f) => { ids = ids.filter((x) => f[1] === '==' ? x.d[f[0]] === f[2] : f[1] === '>=' ? cmp(x.d[f[0]], f[2]) >= 0 : true); });
        if (ord) ids.sort((a, b) => (ord[1] === 'desc' ? -1 : 1) * cmp(a.d[ord[0]], b.d[ord[0]]));
        if (lim) ids = ids.slice(0, lim);
        return { empty: !ids.length, size: ids.length, docs: ids.map((x) => ({ id: x.id, exists: true, data: () => x.d })), forEach(fn) { this.docs.forEach(fn); } };
      };
      return { doc: (id) => docRef(path + '/' + id), get: () => Promise.resolve(run()), add: () => Promise.resolve({ id: 'x' }),
        where: (a, b, c) => colRef(path, flt.concat([[a, b, c]]), ord, lim), orderBy: (a, b) => colRef(path, flt, [a, b || 'asc'], lim), limit: (n) => colRef(path, flt, ord, n), onSnapshot: () => () => {} };
    }
    function docRef(p) { return { get: () => Promise.resolve(snap(p)), set: () => Promise.resolve(), update: () => Promise.resolve(), delete: () => Promise.resolve(), collection: (n) => colRef(p + '/' + n) }; }
    window.db = { collection: (n) => colRef(n), doc: docRef, batch: () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() }) };
    const user = MEMBER ? { uid: 'u1', email: 'demo@example.com', displayName: 'Taylor', emailVerified: true, getIdToken: () => Promise.resolve('demo') } : null;
    window.auth = { currentUser: user, onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; }, setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve() };
    window.firebase = { apps: [], initializeApp: () => ({}), app: () => ({ functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }) }),
      firestore: Object.assign(() => window.db, { FieldValue: { serverTimestamp: () => 'TS', increment: (n) => ({ inc: n }), delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' }, Timestamp: { now: () => ts(0), fromDate: (d) => ({ toMillis: () => +d, toDate: () => d }) } }),
      auth: Object.assign(() => window.auth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } } }), messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} }) };
    window.showToast = () => Promise.resolve();
  }.toString() + ')(' + (member ? 'true' : 'false') + ')';
}

(async () => {
  const sizes = (process.argv[3] || '1440,390').split(',').map(Number);
  const b = await launch();
  const log = [];
  for (const w of sizes) for (const theme of ['dark', 'light']) {
    const h = w >= 1000 ? 900 : 700;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w >= 1000 ? 1.5 : 2 });
    await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await ctx.route(/discord-roles\.theelitegrey\.workers\.dev/, (r) => {
      const u = r.request().url();
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      const body = /\/public/.test(u) ? { ready: true, connected: true, guildName: 'Harbor Lane (example)', autoJoin: null } : { ok: true, linked: true, state: 'active' };
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    });
    const shoot = async (name, member, tab, sel, opts) => {
      const p = await ctx.newPage();
      await p.addInitScript(stubSrc(member));
      await p.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
      await p.goto('http://127.0.0.1:' + PORT + '/c/harbor-lane' + (tab ? '?tab=' + tab : ''), { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('.cx-tabs', { timeout: 15000 });
      if (tab && !['indicators', 'courses'].includes(tab)) { await p.click('.cx-tabs button[data-t=' + tab + ']'); }
      await p.waitForTimeout(1400);
      await p.addStyleTag({ content: '#appnav-dock,.appnav-dock{display:none!important}.cx-cover{height:140px!important}.cx-chip:last-of-type{display:none}.cx-row .cx-chip:nth-last-child(1){display:none}' });
      if (opts && opts.eval) { await p.evaluate(opts.eval); await p.waitForTimeout(300); }
      const ov = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      const file = OUT + '/' + name + '-' + w + '-' + theme + '.png';
      if (sel) { const el = await p.$(sel); await el.screenshot({ path: file }); } else { const bx = await (await p.$('#cm-root')).boundingBox(); await p.screenshot({ path: file, fullPage: true, clip: { x: bx.x, y: bx.y, width: bx.width, height: Math.min(bx.height, w >= 1000 ? 860 : 1000) } }); }
      log.push(name + ' ' + w + ' ' + theme + ' overflowX=' + ov);
      await p.close();
    };
    const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
    const _s = shoot; const shootF = (n, ...a) => (!ONLY || ONLY.includes(n)) ? _s(n, ...a) : null;
    await shootF('feed', true, 'feed', null, { clip: { x: 0, y: 0, width: w, height: h } });
    await shootF('plans', false, null, null, { clip: { x: 0, y: 0, width: w, height: h } });
    await shootF('indicators', true, 'indicators', null, { clip: { x: 0, y: 0, width: w, height: h } });
    await shootF('courses', true, 'courses', null, { clip: { x: 0, y: 0, width: w, height: h } });
    await shootF('events', true, 'events', null, { clip: { x: 0, y: 0, width: w, height: h } });
    await shootF('leaderboard', true, 'leaderboard', null, { clip: { x: 0, y: 0, width: w, height: h } });
    await shootF('discord', true, null, '#cm-discord');
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(log.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
