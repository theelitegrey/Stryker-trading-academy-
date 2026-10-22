// Triggered alerts leave the chart (Owner order 2026-10-22, TradingView behaviour).
//   CHART_BASE=http://127.0.0.1:PORT node tools/tests/chart-alerts-triggered-browser.js <shotsDir>
// Runs against tools/tests/chart-dev-server.mjs. Firebase is stubbed (richstub) and the member's
// chartAlerts / alertFires / settings/alertEngine docs live in a fake Firestore kept in
// localStorage, shared by every tab of the browser context (listeners poll it), so two open
// Charts tabs, a reload and a server-engine fire can all be checked without the network.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

function fakeFs() {
  const KEY = '__fakefs';
  const all = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const put = (v) => localStorage.setItem(KEY, JSON.stringify(v));
  const now = () => Date.now();
  const tsv = (v) => (v === 'TS' ? { __ms: now() } : v);
  const thaw = (d) => { const o = {}; for (const k of Object.keys(d)) { const v = d[k]; o[k] = v && v.__ms ? { toMillis: () => v.__ms, toDate: () => new Date(v.__ms) } : v; } return o; };
  const fix = (d) => { const o = {}; for (const k of Object.keys(d)) o[k] = tsv(d[k]); return o; };
  const coll = (path) => {
    const self = {
      doc: (id) => {
        id = id || ('a' + now().toString(36) + Math.random().toString(36).slice(2, 6));
        return {
          id,
          get: async () => { const d = (all()[path] || {})[id]; return { id, exists: !!d, data: () => (d ? thaw(d) : {}) }; },
          set: async (d) => { const s = all(); s[path] = s[path] || {}; s[path][id] = fix(d); put(s); },
          update: async (d) => { const s = all(); s[path] = s[path] || {}; s[path][id] = Object.assign(s[path][id] || {}, fix(d)); put(s); },
          delete: async () => { const s = all(); if (s[path]) delete s[path][id]; put(s); }
        };
      },
      get: async () => { const rows = all()[path] || {}; const docs = Object.keys(rows).map((id) => ({ id, exists: true, data: () => thaw(rows[id]) })); return { docs, size: docs.length, empty: !docs.length, forEach: (f) => docs.forEach(f) }; },
      orderBy: () => self, limit: () => self, where: () => self,
      onSnapshot: (cb) => {
        let prev = {};
        const run = () => {
          const rows = all()[path] || {}; const ch = [];
          for (const id of Object.keys(rows)) { const j = JSON.stringify(rows[id]); if (prev[id] !== j) ch.push({ type: prev[id] === undefined ? 'added' : 'modified', doc: { id, data: () => thaw(rows[id]) } }); }
          for (const id of Object.keys(prev)) if (!rows[id]) ch.push({ type: 'removed', doc: { id, data: () => ({}) } });
          prev = Object.fromEntries(Object.keys(rows).map((id) => [id, JSON.stringify(rows[id])]));
          if (ch.length || run.first) cb({ docChanges: () => ch, docs: [] });
          run.first = false;
        };
        run.first = true; setTimeout(run, 20); const t = setInterval(run, 250); return () => clearInterval(t);
      }
    };
    return self;
  };
  const base = window.firebase.firestore;
  const db0 = base();
  const db = Object.assign({}, db0, {
    collection: (c) => {
      if (c === 'settings') { const o = db0.collection(c); return Object.assign({}, o, { doc: (id) => (id === 'alertEngine' ? coll('settings').doc('alertEngine') : o.doc(id)) }); }
      if (c !== 'students') return db0.collection(c);
      const o = db0.collection(c);
      return Object.assign({}, o, { doc: (uid) => { const d = o.doc(uid); return Object.assign({}, d, { collection: (sub) => (sub === 'chartAlerts' || sub === 'alertFires' ? coll('students/' + uid + '/' + sub) : d.collection(sub)) }); } });
    }
  });
  window.firebase.firestore = Object.assign(() => db, base);
  window.__fakeFs = { all, put, KEY };
}

async function open(ctx, w, h) {
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource|firebase|firestore|CORS policy|WebSocket/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
  await p.setViewportSize({ width: w, height: h });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return window.__stkAlerts && ws && ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 20; } catch (e) { return false; } }, null, { timeout: 60000 });
  // Capture what the alerts module pushes to the renderer layer.
  await p.evaluate(() => {
    const ws = window.STRYKER_VELA; const R = ws.cell(ws.active.id).chart.renderer.renderer;
    const orig = R.setNativeData.bind(R); window.__lines = null;
    R.setNativeData = (k, d) => { if (k === 'stk_alerts') window.__lines = d.lines.map((l) => l.price); return orig(k, d); };
  });
  await p.evaluate(() => window.__stkAlerts.reload());
  await p.waitForTimeout(600);
  return { p, errors };
}
const sym = (p) => p.evaluate(() => { const ws = window.STRYKER_VELA; return ws.cell(ws.active.id).symbol; });
// The last line set pushed to the active chart's alert layer (pushLines only pushes changes).
const lines = (p) => p.evaluate(() => { const ws = window.STRYKER_VELA; return window.__stkAlerts.linesFor(ws.cell(ws.active.id).symbol); });
const last = (p) => p.evaluate(() => { const ws = window.STRYKER_VELA; const b = ws.cell(ws.active.id).chart.renderer.renderer.scene.bars; return b[b.length - 1].close; });

(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeFs);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());

  let { p, errors } = await open(ctx, 1440, 900);
  const S = await sym(p); const px = await last(p);
  console.log('symbol', S, 'last', px, 'engine', await p.evaluate(() => window.__STK_VELA_VERSION || window.__stkVela090));
  // Keep every alert line inside the visible price range: just above / below the last close.
  const up = +(px * 1.0004).toFixed(2), dn = +(px * 0.9996).toFixed(2), mid = +(px * 1.0002).toFixed(2);
  // A huge level for the "never fires on its own" alerts would sit off-screen; use 'greater' at up
  // (the real feed may cross it, which is fine: we drive the fire ourselves with tick()).
  const ids = await p.evaluate(async ([S, up, dn, mid]) => {
    const A = window.__stkAlerts;
    return { once: await A.add({ symbol: S, cond: 'crossing_up', price: up, freq: 'once', message: 'once test' }),
             every: await A.add({ symbol: S, cond: 'crossing_down', price: dn, freq: 'every', message: 'every test' }),
             srv: await A.add({ symbol: S, cond: 'crossing_up', price: mid, freq: 'once', message: 'server test' }) };
  }, [S, up, dn, mid]);
  let L = await lines(p);
  check(L && L.includes(up) && L.includes(dn) && L.includes(mid), 'three new alerts are drawn', L);
  await p.screenshot({ path: OUT + '/alerts-1440-before.png' });

  // Second open Charts tab on the same account.
  const t2 = await open(ctx, 1440, 900);
  check((await lines(t2.p) || []).includes(up), 'second tab draws the Only-once alert too', await lines(t2.p));

  // Fire the Only-once alert in tab 1 (and the repeating one).
  await p.evaluate(([S, up, dn]) => { const A = window.__stkAlerts; A.tick(S, up - 1); A.tick(S, up + 1); A.tick(S, dn + 1); A.tick(S, dn - 1); }, [S, up, dn]);
  await p.waitForTimeout(400);
  L = await lines(p);
  check(L && !L.includes(up), 'tab 1: fired Only-once alert is removed from the chart straight away', L);
  check(L && L.includes(dn), 'tab 1: repeating (Every time) alert that fired stays drawn', L);
  const pushed = await p.evaluate(() => window.__lines);
  check(pushed && !pushed.includes(up) && pushed.includes(dn), 'tab 1: the renderer layer got the new line set', pushed);
  const st = await p.evaluate((id) => { const a = window.__stkAlerts.alerts.find((x) => x.id === id); return a && a.active; }, ids.once);
  check(st === false, 'fired Only-once alert is inactive (kept in the list)', st);
  await p.waitForTimeout(1200);
  const L2 = await lines(t2.p);
  check(L2 && !L2.includes(up) && L2.includes(dn), 'tab 2: line removed without a reload', L2);

  // Server engine fire: heartbeat fresh, the engine claims active=false and writes alertFires.
  await p.evaluate(([uid, id]) => {
    const F = window.__fakeFs; const s = F.all(); const now = Date.now();
    s['settings'] = { alertEngine: { at: { __ms: now } } };
    const k = 'students/' + uid + '/chartAlerts'; s[k][id].active = false; s[k][id].updatedAt = { __ms: now };
    const f = 'students/' + uid + '/alertFires'; s[f] = s[f] || {}; s[f][id] = { firedAt: { __ms: now + 5 }, price: 1, text: 'server test', symbol: 'x', freq: 'once', stopped: true };
    F.put(s);
  }, ['u1', ids.srv]);
  await p.waitForTimeout(1500);
  L = await lines(p); const L3 = await lines(t2.p);
  check(L && !L.includes(mid) && L3 && !L3.includes(mid), 'server-fired Only-once alert leaves both tabs', { L, L3 });
  await p.screenshot({ path: OUT + '/alerts-1440-after-fire.png' });

  // Reload: still gone, list shows Triggered with a Restart button.
  await t2.p.close();
  await p.close();
  ({ p, errors } = await open(ctx, 1440, 900));
  L = await lines(p);
  check(L && !L.includes(up) && !L.includes(mid) && L.includes(dn), 'after reload: triggered alerts not drawn, repeating one drawn', L);
  await p.evaluate(() => window.__stkAlerts.open());
  await p.waitForTimeout(300);
  const rows = await p.evaluate(() => [...document.querySelectorAll('.stk-al-row')].map((r) => ({ t: r.querySelector('span').textContent, b: r.querySelector('[data-k=pause]').textContent })));
  check(rows.filter((r) => /Triggered/.test(r.t) && r.b === 'Restart').length === 2, 'list shows both as Triggered with Restart', rows);
  await p.screenshot({ path: OUT + '/alerts-1440-list.png' });
  // Restart the first one: drawn again.
  await p.evaluate(() => { const r = [...document.querySelectorAll('.stk-al-row')].find((x) => /once test/.test(x.textContent)); r.querySelector('[data-k=pause]').click(); });
  await p.waitForTimeout(400);
  L = await lines(p);
  check(L && L.includes(up), 'Restart draws it again', L);
  // Pause keeps the row worded "Paused" (not Triggered).
  await p.evaluate(() => { const r = [...document.querySelectorAll('.stk-al-row')].find((x) => /once test/.test(x.textContent)); r.querySelector('[data-k=pause]').click(); });
  await p.waitForTimeout(300);
  const pr = await p.evaluate(() => { const r = [...document.querySelectorAll('.stk-al-row')].find((x) => /once test/.test(x.textContent)); return { t: r.querySelector('span').textContent, b: r.querySelector('[data-k=pause]').textContent }; });
  check(/Paused/.test(pr.t) && pr.b === 'Resume', 'a paused alert reads Paused / Resume', pr);
  await p.evaluate(() => window.__stkAlerts.open && document.querySelector('.stk-al-x').click());

  // Phone width: list readable.
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => window.__stkAlerts.open());
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/alerts-390-list.png' });
  check(!errors.length, 'no page errors', errors);
  await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
