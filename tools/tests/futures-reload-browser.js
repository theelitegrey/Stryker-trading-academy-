// Futures chart: the SAME mode on every load (member bug 2026-11-05, "every refresh gives a different result: sometimes live,
// sometimes delayed, sometimes broken candles"). A Free member who SIGNED the market data agreement (the server says live L1)
// reloads /charts on NQ 1m again and again while the sign-in, the plan read, the /api/chart/rt answer and the hub socket land
// in a different order each time (seeded random latencies, some past the page's old 4 s / 8 s give-ups, the odd failed rt call).
// ONE deterministic price world feeds every lane: the live REST lane (to now), the 10-min delayed lane (cut like the server) and
// a fake /ts-live hub (20 min of 1m bars on subscribe, then trades), so any broken candle comes from the page, not from the data.
// Per load it asserts: live mode (no "delayed" pill, the hub feeds NQ, rt-access says live), bars strictly ascending, no gap
// above 2 min inside the open session, the newest bar within 2 min of now, and no bar that disagrees with the world.
//   node tools/tests/chart-dev-server.mjs 8094 &
//   CHART_BASE=http://127.0.0.1:8094 node tools/tests/futures-reload-browser.js [reloads=10] [shotsDir] [--signed-out-first]
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8094';
const N = Number(process.argv[2] || 10), OUT = process.argv[3] || '';
const SIGNIN = process.argv.includes('--signed-out-first');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

// ---- the price world (minute m = epoch minute). Same function in node (REST lanes) and in the page (fake hub).
function world() {
  const px = (m) => Math.round((25000 + 60 * Math.sin(m / 37) + 18 * Math.sin(m / 5.3) + 6 * Math.sin(m * 1.7)) * 4) / 4;
  const bar = (m, upToSec = 60) => {
    const o = px(m), e = px(m + 1), f = Math.min(1, upToSec / 60), c = Math.round((o + (e - o) * f) * 4) / 4;
    return [m * 60, o, Math.max(o, c) + 1.5, Math.min(o, c) - 1.5, c, 50 + (m % 17) * 9];
  };
  return { px, bar };
}
const W = world();
const globex = (s) => { const d = new Date((s - 5 * 3600) * 1000), wd = d.getUTCDay(), h = d.getUTCHours(); return !(wd === 6 || (wd === 5 && h >= 17) || (wd === 0 && h < 18) || h === 17); };   // EST approx, good enough for a fixture
// rows of a page for a lane (live: up to the forming minute; delayed: open <= now - 600, like delayRows)
function rows(tf, page, live) {
  const P = { 1: 8 * 3600, 5: 2 * 86400, 15: 5 * 86400 }[tf] || 8 * 3600, step = Number(tf) * 60, now = Date.now() / 1000;
  const out = [];
  for (let t = page * P; t < (page + 1) * P; t += step) {
    if (t > now) break;
    if (!live && t > now - 600) break;
    if (!globex(t)) continue;
    const m0 = t / 60, k = Number(tf);
    let o, h = -Infinity, l = Infinity, c, v = 0;
    for (let i = 0; i < k; i++) { const m = m0 + i; if (m * 60 > now) break; const b = W.bar(m, Math.min(60, now - m * 60)); if (i === 0) o = b[1]; h = Math.max(h, b[2]); l = Math.min(l, b[3]); c = b[4]; v += b[5]; }
    out.push([t, o, h, l, c, v]);
  }
  return out;
}

// ---- the page side: fake Firebase timing, plan read, fake hub
function pageInit(cfg) {
  const px = new Function('m', 'return Math.round((25000 + 60 * Math.sin(m / 37) + 18 * Math.sin(m / 5.3) + 6 * Math.sin(m * 1.7)) * 4) / 4;');
  try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1');
    if (cfg.saved) for (const k in cfg.saved) localStorage.setItem(k, cfg.saved[k]); } catch (e) {}   // the member's saved chart (NQ 1m), captured by prime()
  window.__log = { t0: performance.now(), ev: [] };
  const ev = (k, v) => window.__log.ev.push([Math.round(performance.now()), k, v]);
  // Firebase: apps appear after cfg.appMs, the persisted user after cfg.authMs more (signed out: never)
  const user = cfg.signedOut ? null : { uid: 'u-mda', email: 'm@x.y', emailVerified: true, getIdTokenResult: () => Promise.resolve({ claims: {} }), getIdToken: () => new Promise((r) => setTimeout(() => r('dummy.mda.token'), cfg.tokMs)) };
  const A = window.__stubAuth;
  A.currentUser = null;
  const cbs = [];
  A.onIdTokenChanged = (cb) => { cbs.push(cb); if (A.currentUser !== undefined && window.__authIn) setTimeout(() => cb(A.currentUser), 0); return () => {}; };
  A.onAuthStateChanged = A.onIdTokenChanged;
  setTimeout(() => {
    firebase.apps = [{}]; ev('apps', 1);
    setTimeout(() => { A.currentUser = user; window.__authIn = true; ev('auth', !!user); cbs.slice().forEach((cb) => { try { cb(user); } catch (e) {} }); }, cfg.authMs);
  }, cfg.appMs);
  window.__signIn = () => { const u = { uid: 'u-mda', email: 'm@x.y', emailVerified: true, getIdTokenResult: () => Promise.resolve({ claims: {} }), getIdToken: () => Promise.resolve('dummy.mda.token') }; A.currentUser = u; cbs.slice().forEach((cb) => { try { cb(u); } catch (e) {} }); };
  // plan read (assets/plan-limits.js strykerPlanTier): this member is FREE, answer after cfg.planMs
  let real = null;
  Object.defineProperty(window, 'strykerPlanTier', { configurable: true, get: () => (real ? () => new Promise((r) => setTimeout(() => { ev('plan', 'free'); r({ free: true, plan: 'Starter' }); }, cfg.planMs)) : undefined), set: (v) => { real = v; } });
  // fake hub: every /ts-live socket. Entitled = the token the server would let in (trades tier).
  const Real = window.WebSocket;
  window.__hub = { opened: 0, refused: 0 };
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const ok = Array.isArray(proto) && proto[1] === 'dummy.mda.token';
    const sym = new URL(String(url)).searchParams.get('symbol');
    const ws = { readyState: 0, send() {}, close() { if (this.readyState === 3) return; this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    setTimeout(() => {
      if (!ok) { window.__hub.refused++; ws.readyState = 3; ws.onerror && ws.onerror({}); ws.onclose && ws.onclose({ code: 1006 }); return; }   // the Worker answers 403 before the upgrade
      window.__hub.opened++; ws.readyState = 1; ws.onopen && ws.onopen();
      const send = (o) => ws.onmessage && ws.onmessage({ data: JSON.stringify(o) });
      send({ event: 'hub_attached', state: 'live', tier: 'trades' }); send({ event: 'status', state: 'live' });
      if (sym !== 'NQ') return;
      const nowM = Math.floor(Date.now() / 60000), b = [];
      for (let m = nowM - 19; m <= nowM; m++) { const s = Math.min(60, Date.now() / 1000 - m * 60), o = px(m), e = px(m + 1), c = Math.round((o + (e - o) * Math.min(1, s / 60)) * 4) / 4; b.push([m * 60000, o, Math.max(o, c) + 1.5, Math.min(o, c) - 1.5, c, 50 + (m % 17) * 9]); }
      send({ type: 'bars', symbol: 'NQ', b });
      ws.iv = setInterval(() => {
        const t = Date.now(), m = Math.floor(t / 60000), s = (t / 1000 - m * 60), o = px(m), e = px(m + 1), p = Math.round((o + (e - o) * Math.min(1, s / 60)) * 4) / 4;
        send({ type: 'ticks', symbol: 'NQ', t: [[p, 1, 1, t]] });
      }, 250);
    }, cfg.hubMs);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}

// One clean load that sets NQ 1m through the app, then hands back the saved workspace so every probe load starts the way a
// member who left the chart on NQ 1m does.
let SAVED = null;
async function prime(b) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(stub);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route('**/api/chart/bars/**', (r) => r.fulfill({ json: { bars: [] } }));
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.active, null, { timeout: 60000 });
  await p.evaluate(() => { const a = window.STRYKER_VELA.active; a.setSymbol('futures:NQ1!'); a.setTimeframe('1'); });
  await sleep(2500);
  SAVED = await p.evaluate(() => { const o = {}; for (let k = 0; k < localStorage.length; k++) { const n = localStorage.key(k); if (/^vela-workspace|^stryker\.vela/.test(n)) o[n] = localStorage.getItem(n); } return o; });
  await ctx.close();
}

async function load(b, i, cfg, w = 1440, h = 900) {
  cfg = Object.assign({ saved: SAVED }, cfg);
  const mobile = w < 800;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(pageInit, cfg);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => (/book-recorder/.test(r.request().url()) ? r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }) : r.abort()));
  const net = { rt: [], bars: [] };
  let rtN = 0;
  await ctx.route('**/api/chart/rt', async (r) => {
    const n = rtN++, tok = /Bearer dummy\.mda\./.test(r.request().headers().authorization || '');
    await sleep(cfg.rtMs);
    if (n < cfg.rtFails) { net.rt.push('ERR'); return r.abort(); }   // a network blip / an isolate that could not verify yet
    net.rt.push(tok); return r.fulfill({ json: { admin: tok }, headers: { 'cache-control': 'no-store' } });
  });
  await ctx.route('**/api/chart/bars/**', async (r) => {
    const u = new URL(r.request().url()), tok = /Bearer dummy\.mda\./.test(r.request().headers().authorization || '');
    const tf = u.searchParams.get('tf') || '15', P = { 1: 8 * 3600, 5: 2 * 86400, 15: 5 * 86400 }[tf] || 8 * 3600, page = u.searchParams.has('page') ? Number(u.searchParams.get('page')) : Math.floor(Date.now() / 1000 / P);
    if (!/NQ/.test(u.pathname) || !{ 1: 1, 5: 1, 15: 1 }[tf]) return r.fulfill({ json: { bars: [] } });
    net.bars.push((tok ? 'T' : '-') + (page === Math.floor(Date.now() / 1000 / P) ? 'c' : ''));
    await sleep(80);
    const body = { s: 'NQ', tf, page, bars: rows(tf, page, tok), rt: tok };
    return r.fulfill({ json: body, headers: { 'x-tz-rt': tok ? '1' : '0', 'cache-control': tok ? 'private, max-age=10' : 'public, max-age=15, s-maxage=15', vary: 'Authorization' } });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await p.goto(BASE + '/charts.html?symbol=NQ', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.active && window.STRYKER_DATA_BANNER, null, { timeout: 60000 }).catch(() => {});
  const t0 = Date.now();
  const snaps = [];
  if (cfg.signInAt) { await sleep(cfg.signInAt); snaps.push(await snap(p)); await p.evaluate(() => window.__signIn()); }
  for (const at of cfg.snapAt || [4000, 9000, 16000]) { await sleep(Math.max(0, at - (Date.now() - t0))); snaps.push(await snap(p)); }
  const s = snaps[snaps.length - 1];
  if (OUT && cfg.shot) await p.screenshot({ path: OUT + '/' + cfg.shot + '.png' });
  await ctx.close();
  return { i, cfg, snaps, s, net, errors };
}
const VER = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', '..', 'assets', 'version.json'), 'utf8')).build;
function snap(p) {
  return p.evaluate(async (VER) => {
    const ws = window.STRYKER_VELA, a = ws.active, rb = (a.chart.orchestrator && a.chart.orchestrator.rawBars) || [];
    const px = new Function('m', 'return Math.round((25000 + 60 * Math.sin(m / 37) + 18 * Math.sin(m / 5.3) + 6 * Math.sin(m * 1.7)) * 4) / 4;');
    let ooo = 0, gap = 0, bad = 0;
    for (let k = 1; k < rb.length; k++) { const d = (rb[k].time - rb[k - 1].time) / 60000; if (d <= 0) ooo++; else if (d > gap && d < 60) gap = d; }   // session breaks (>= 60 min) are not gaps
    for (const x of rb.slice(-40, -1)) { const m = x.time / 60000; if (Math.abs(x.open - px(m)) > 0.01 || Math.abs(x.close - px(m + 1)) > 0.3) bad++; }   // a closed minute must match the world
    const pill = document.getElementById('stkdp'), dd = document.querySelector('.stkc-dd');
    const st = window.tzRtState ? window.tzRtState() : {};
    const fed = !!(window.__stkL2Live && window.__stkL2Live.has('NQ'));
    const live = !!(st.admin && fed && pill && pill.hidden);
    const skel = !!document.querySelector('.stkdp-wait:not([hidden])');
    let diag = null; try { const m = await import('/assets/chart-futures-l2.js?v=' + VER); const d = m.l2Diag('futures:NQ1!'); diag = { lv: d.liveVisible, free: d.isFree, sockets: d.sockets, tier: d.lastHubAttached }; } catch (e) { diag = String(e); }
    return { diag, ev: window.__log.ev.slice(), at: Math.round(performance.now()), mode: live ? 'live' : (pill && !pill.hidden ? 'delayed' : (st.ready ? 'other' : 'unknown')), skel, admin: !!st.admin, ready: !!st.ready, fed, pill: !!(pill && !pill.hidden),
      dot: dd ? dd.dataset.s : '', n: rb.length, lastLagMin: rb.length ? Math.round((Date.now() - rb[rb.length - 1].time) / 6000) / 10 : null, ooo, gap, bad, hub: window.__hub, sym: a.symbol, tf: a.timeframe };
  }, VER);
}

// seeded per-load latencies: Firebase apps 0.2-9 s (a slow phone past the old 8 s give-up), user 0.1-3 s, token 0-0.5 s,
// plan 0.1-3 s, rt 0.05-2.5 s (every 4th load: the first 1-2 rt calls fail), hub 0.05-1.5 s
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function cfgFor(i) {
  const r = rng(1000 + i);
  const pick = (a, z) => Math.round(a + r() * (z - a));
  const c = { appMs: pick(200, 2500), authMs: pick(100, 3000), tokMs: pick(0, 500), planMs: pick(100, 3000), rtMs: pick(50, 2500), rtFails: i % 4 === 3 ? 1 + (i % 2) : 0, hubMs: pick(50, 1500) };
  if (i % 5 === 1) c.appMs = 8500;     // Firebase later than the old 8 s give-up
  if (i % 5 === 2) c.authMs = 4500;    // the user later than the old 4 s bars wait
  return c;
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const all = [];
  try {
    await prime(b);
    console.log('saved workspace keys', Object.keys(SAVED || {}));
    const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
    for (let i = 0; i < N; i++) {
      if (ONLY && !ONLY.includes(i)) continue;
      const cfg = cfgFor(i);
      if (i === 0) cfg.shot = 'reload-0-1440';
      const r = await load(b, i, cfg);
      all.push(r);
      const s = r.s;
      console.log(`#${i} ${JSON.stringify(cfg)} -> mode=${s.mode} admin=${s.admin} fed=${s.fed} pill=${s.pill} dot=${s.dot} n=${s.n} lag=${s.lastLagMin}m ooo=${s.ooo} gap=${s.gap}m bad=${s.bad}` +
        ` | rt=${r.net.rt.join(',')} bars=${r.net.bars.join(',')} hub=${JSON.stringify(s.hub)} | early=${r.snaps.map((x) => x.mode + (x.skel ? '+skel' : '')).join('>')}${r.errors.length ? ' ERR ' + r.errors[0] : ''}`);
    }
    // phone width, one load, screenshot
    const ph = await load(b, 'phone', Object.assign(cfgFor(2), { shot: 'reload-phone-390' }), 390, 844);
    all.push(ph);
    console.log(`#phone mode=${ph.s.mode} n=${ph.s.n} ooo=${ph.s.ooo} gap=${ph.s.gap} lag=${ph.s.lastLagMin}`);
    if (SIGNIN) {
      // signed out -> sign in on the page (no reload): must end live, clean series
      const so = await load(b, 'signin', { appMs: 300, authMs: 200, tokMs: 50, planMs: 400, rtMs: 300, rtFails: 0, hubMs: 200, signedOut: true, signInAt: 6000, snapAt: [14000, 22000], shot: 'signin-1440' });
      all.push(so);
      console.log(`#signin early=${so.snaps[0].mode} final mode=${so.s.mode} n=${so.s.n} ooo=${so.s.ooo} gap=${so.s.gap} lag=${so.s.lastLagMin} bad=${so.s.bad} rt=${so.net.rt.join(',')} bars=${so.net.bars.join(',')}`);
      check(so.snaps[0].mode === 'delayed', 'signed out: delayed pill', so.snaps[0]);
      check(so.s.mode === 'live' && so.s.ooo === 0 && so.s.gap <= 2 && so.s.lastLagMin <= 2 && so.s.bad === 0, 'signed out -> signed in on the page: live, clean series', so.s);
    }
  } finally { await b.close(); }
  const loads = all.filter((r) => typeof r.i === 'number' || r.i === 'phone');
  const modes = new Set(loads.map((r) => r.s.mode));
  check(modes.size === 1 && modes.has('live'), 'same mode on every load (live): ' + [...modes].join(','));
  for (const r of loads) {
    const s = r.s;
    check(s.sym === 'futures:NQ1!' && String(s.tf) === '1', `#${r.i} chart is NQ 1m`, s);
    check(s.ooo === 0, `#${r.i} bars strictly ascending`, s);
    check(s.gap <= 2, `#${r.i} no gap above 2 min (max ${s.gap})`, s);
    check(s.lastLagMin !== null && s.lastLagMin <= 2, `#${r.i} newest bar within 2 min of now (${s.lastLagMin})`, s);
    check(s.bad === 0, `#${r.i} every closed minute matches the world (${s.bad} off)`, s);
    check(!r.snaps.some((x) => x.ready && x.pill && r.cfg && !r.cfg.signedOut), `#${r.i} never showed the delayed pill to this member`, r.snaps.map((x) => x.mode));
    check(!r.errors.length, `#${r.i} no page errors`, r.errors);
  }
  if (OUT) fs.writeFileSync(OUT + '/reload-log.json', JSON.stringify(all.map((r) => ({ i: r.i, cfg: Object.assign({}, r.cfg, { saved: undefined }), snaps: r.snaps, net: r.net, errors: r.errors })), null, 1));
  console.log(fail ? fail + ' FAILED' : 'futures-reload: all ok');
  process.exit(fail ? 1 : 0);
})();
