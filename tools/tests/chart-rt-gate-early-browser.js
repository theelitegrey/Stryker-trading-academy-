// Charts data-access gate with the chart built DURING the sign-in check (PHONE SPEED B, 2026-10-26).
// The Owner rule: real-time CME is admin-only, members and signed-out visitors get the 10-minute delayed
// lane. The server picks the lane from the bearer token (functions/api/chart/bars/[sym].js); the page
// must therefore (1) never send a bars request before the auth state (rt-access) is known, (2) never
// open the real-time stream socket unless the server said "admin", and (3) never show the page before
// the plan gate cleared. Run against tools/tests/chart-speed-server.mjs, whose /api/chart/rt and bars
// answer like the real endpoints for tokens 'admin.*' / 'member.*' (anything else = signed out lane).
// Sign-in and the plan read are slowed (1.2 s / 1.5 s) so the chart really builds before they finish.
//   node tools/tests/chart-speed-server.mjs 8261 &
//   CHART_BASE=http://127.0.0.1:8261 node tools/tests/chart-rt-gate-early-browser.js
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8261';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const AUTH_MS = 1200, GATE_MS = 1500;

async function run(b, who, eng, w, h) {
  const mobile = w < 800;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([who, AUTH_MS, GATE_MS, now]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); } catch (e) {}
    const RealDate = Date, off = now - RealDate.now();
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
    window.Date = FakeDate;
    window.__log = { bars: [], ws: [], authAt: null, gateAt: null, shownBeforeGate: false };
    const t = () => Math.round(performance.now());
    const F = window.fetch;
    window.fetch = function (u, init) {
      const s = String(u && u.url || u);
      if (/\/api\/chart\/bars\//.test(s)) {
        const hd = (init && init.headers) || {};
        const a = hd.authorization || hd.Authorization || '';
        const rec = { at: t(), auth: a ? a.split('.')[0] : '', rt: null };
        window.__log.bars.push(rec);
        return F.apply(this, arguments).then((r) => { rec.rt = r.headers.get('x-tz-rt'); return r; });
      }
      return F.apply(this, arguments);
    };
    const W = window.WebSocket;
    window.WebSocket = function (u, p) { if (/api\/chart\/stream/.test(u)) window.__log.ws.push({ at: t(), proto: p && p[0] }); return new W(u, p); };
    window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    const fb = window.firebase, a = window.__stubAuth;
    fb.apps = [{}];
    const user = who === 'signed-out' ? null : Object.assign({}, a.currentUser, { uid: 'u-' + who, getIdToken: () => Promise.resolve(who + '.token.x') });
    a.currentUser = null;   // nobody known until the (slow) sign-in answer
    const answer = (cb) => setTimeout(() => { a.currentUser = user; if (window.__log.authAt == null) window.__log.authAt = t(); cb(user); }, AUTH_MS);
    a.onAuthStateChanged = (cb) => { answer(cb); return () => {}; };
    a.onIdTokenChanged = (cb) => { answer(cb); return () => {}; };
    // slow plan / role reads (the gate)
    const D = window.__stubDb, wrapRef = (r) => { if (r && r.get) { const g = r.get; r.get = (...x) => new Promise((ok) => setTimeout(ok, GATE_MS)).then(() => g.apply(r, x)); } return r; };
    const c0 = D.collection, d0 = D.doc;
    D.collection = (...x) => { const c = c0(...x); const dd = c.doc; if (dd) c.doc = (...y) => wrapRef(dd.apply(c, y)); return wrapRef(c); };
    D.doc = (...x) => wrapRef(d0(...x));
    // when does the shell become visible, and was any candle data on screen before that
    addEventListener('DOMContentLoaded', () => {
      const sh = document.querySelector('.dash-shell');
      if (!sh) return;
      new MutationObserver(() => { if (!sh.classList.contains('gate-pending') && window.__log.gateAt == null) window.__log.gateAt = t(); }).observe(sh, { attributes: true, attributeFilter: ['class'] });
    });
  }, [who, AUTH_MS, GATE_MS, Date.UTC(2026, 9, 21, 17, 0)]);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await p.goto(BASE + '/charts.html?vela=' + eng, { waitUntil: 'domcontentloaded' });
  // while the gate is pending: the page must be hidden (visibility) whatever the chart is doing
  const hiddenEarly = [];
  for (let i = 0; i < 12; i++) {
    await sleep(150);
    hiddenEarly.push(await p.evaluate(() => { const sh = document.querySelector('.dash-shell'); return !sh ? 'noshell' : sh.classList.contains('gate-pending') ? (getComputedStyle(sh).visibility === 'hidden' ? 'hidden' : 'VISIBLE-WHILE-PENDING') : 'cleared'; }));
  }
  await p.waitForFunction(() => window.__stkFirstCandles, null, { timeout: 60000 }).catch(() => {});
  await sleep(6000);
  const L = await p.evaluate(() => Object.assign({}, window.__log, { marks: performance.getEntriesByType('mark').filter((m) => /^stk:/.test(m.name)).map((m) => [m.name, Math.round(m.startTime)]) }));
  const tag = `${who} ${eng} ${w}`;
  const built = (L.marks.find((m) => m[0] === 'stk:workspace-built') || [])[1];
  check(L.bars.length > 0, `${tag}: chart requested bars`, L.bars.length);
  check(L.authAt != null && L.bars.every((r) => r.at >= L.authAt), `${tag}: no bars request before the sign-in answer`, { authAt: L.authAt, first: L.bars[0] });
  check(!hiddenEarly.includes('VISIBLE-WHILE-PENDING'), `${tag}: page hidden while the plan gate is pending`, hiddenEarly);
  if (who === 'admin') {
    check(L.bars.some((r) => r.auth === 'Bearer admin' && r.rt === '1'), `${tag}: (control) admin gets the real-time lane`, L.bars.slice(0, 3));
    check(L.ws.length > 0, `${tag}: (control) admin opens the stream`, L.ws);
  } else {
    check(L.bars.every((r) => r.rt === '0' || r.rt === null), `${tag}: every bars answer is the 10-min delayed lane`, L.bars.filter((r) => r.rt !== '0').slice(0, 3));
    check(L.bars.every((r) => r.auth !== 'Bearer admin'), `${tag}: no admin token sent`, L.bars.map((r) => r.auth).slice(0, 3));
    check(L.ws.length === 0, `${tag}: no real-time stream socket`, L.ws);
    if (who === 'member') check(L.bars.every((r) => r.auth === 'Bearer member'), `${tag}: member bars carry the member token`, L.bars.map((r) => r.auth).slice(0, 3));
    if (who === 'signed-out') check(L.bars.every((r) => r.auth === ''), `${tag}: signed-out bars carry no token`, L.bars.map((r) => r.auth).slice(0, 3));
  }
  console.log(`  ${tag}: auth ${L.authAt} ms, workspace built ${built} ms, first bars request ${L.bars[0] && L.bars[0].at} ms, gate cleared ${L.gateAt} ms`);
  check(errors.length === 0, `${tag}: no page errors`, errors);
  await ctx.close();
  return { built, authAt: L.authAt };
}

(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE cdn.jsdelivr.net'] });
  for (const eng of ['0.9', '0.6']) {
    for (const [w, h] of [[390, 844], [1440, 900]]) {
      for (const who of ['signed-out', 'member', 'admin']) await run(b, who, eng, w, h);
    }
  }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
