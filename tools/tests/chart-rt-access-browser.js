// Charts real-time gate, browser side (Owner order 2026-10-16). Against tools/tests/chart-dev-server.mjs.
//   CHART_BASE=http://127.0.0.1:8091 node tools/tests/chart-rt-access-browser.js [shotsDir]
// Non-admin (signed out, and a signed-in non-admin): NO stream socket is opened, the data dot is amber
// "Delayed 10m", no page errors, candles drawn. Admin: a stream socket is opened with the
// ("tz-auth", token) subprotocol, dot green "Real-time", bars requested with the Bearer header.
// /api/chart/rt is faked here (the dev server has no Pages routes for it); the token is a dummy string.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8091';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

async function run(b, { who, w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((who) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
    window.__wsOpened = []; window.__barAuth = [];
    const W = window.WebSocket;
    window.WebSocket = function (u, p) { if (/api\/chart\/stream/.test(u)) window.__wsOpened.push({ u, p }); return new W(u, p); };
    window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    const F = window.fetch;
    window.fetch = function (u, init) { if (/\/api\/chart\/bars\//.test(String(u))) window.__barAuth.push(!!(init && init.headers && (init.headers.authorization || init.headers.Authorization))); return F.apply(this, arguments); };
    if (who !== 'signed-out') {
      const user = { uid: 'u-' + who, getIdToken: () => Promise.resolve('dummy.' + who + '.token') };
      firebase.apps = [{}];
      const a = firebase.auth(); a.currentUser = user; a.onIdTokenChanged = (cb) => { setTimeout(() => cb(user), 20); return () => {}; };
    }
  }, who);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  await ctx.route('**/api/chart/rt', (r) => r.fulfill({ json: { admin: /Bearer dummy\.admin\./.test(r.request().headers().authorization || '') }, headers: { 'cache-control': 'no-store' } }));
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|WebSocket connection to|status of 404|Failed to load resource|blocked by CORS policy/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_DATA_DOT, null, { timeout: 45000 });
  await p.waitForFunction(() => { const d = document.querySelector('.stkc-dd'); return d && (d.dataset.s === 'rt' || d.dataset.s === 'delayed' || d.dataset.s === 'closed'); }, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(7000);
  const info = await p.evaluate(() => {
    const d = document.querySelector('.stkc-dd');
    return { s: d && d.dataset.s, tag: d && d.querySelector('.stkc-dd-t').textContent, ws: window.__wsOpened, barAuth: window.__barAuth, color: d && getComputedStyle(d.querySelector('.stkc-dd-dot')).backgroundColor, canvases: document.querySelectorAll('#vela-chart canvas').length };
  });
  const shot = `${OUT}/rt-${who}-${w}.png`;
  await p.screenshot({ path: shot });
  console.log(who, w, JSON.stringify({ ...info, ws: info.ws.map((x) => ({ proto: x.p && x.p[0], hasTok: !!(x.p && x.p[1]) })) }), shot);
  await ctx.close();
  return { info, errors };
}

(async () => {
  const b = await launch();
  const open = true; // Globex open check is done by the dot itself ('closed' is reported and skipped)
  for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
    for (const who of ['signed-out', 'free', 'admin']) {
      const { info, errors } = await run(b, { who, w, h, mobile });
      if (info.s === 'closed') { console.log('SKIP ' + who + ' ' + w + ': Globex closed, dot is grey'); continue; }
      check(errors.length === 0, `${who} ${w}: no page errors ${errors.slice(0, 2)}`);
      check(info.canvases > 0, `${who} ${w}: chart drawn`);
      if (who === 'admin') {
        check(info.s === 'rt' && /Real-time/.test(info.tag) && info.color === 'rgb(8, 153, 129)', `${who} ${w}: green Real-time (${info.tag})`);
        check(info.ws.length > 0 && info.ws[0].p && info.ws[0].p[0] === 'tz-auth' && !!info.ws[0].p[1], `${who} ${w}: stream opened with tz-auth subprotocol`);
        check(info.barAuth.length > 0 && info.barAuth.every(Boolean), `${who} ${w}: bars fetched with Authorization`);
      } else {
        check(info.s === 'delayed' && info.tag === 'Delayed 10m' && info.color === 'rgb(245, 166, 35)', `${who} ${w}: amber "Delayed 10m" (${info.tag})`);
        check(info.ws.length === 0, `${who} ${w}: no stream socket opened`);
      }
    }
  }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'all passed');
  process.exit(fail ? 1 : 0);
})();
