// End-to-end proof of server-side chart alerts + phone push, against LIVE Firebase with ONE throwaway member.
//   node tools/tests/alert-engine-e2e.js <base url> <outdir>
// Needs: alert-engine.service running; a local server for <base url> (python3 -m http.server).
// Steps: create throwaway member -> push registration in a real browser (token doc) -> create price alerts through the
// Charts alert store (one BTCUSDT Once, one NQ Once, one Every-time) -> the SERVER fires -> notifications docs exist
// (+ alertFires, Once alerts deactivated) -> Charts page open: exactly ONE toast / one notification per fire (no double)
// -> prints the time window so the caller can read the onNotificationCreated function logs.
// Cleans the member up at the end (Auth user, students/profiles/usernames/notifications/pushTokens/alerts/alertFires).
const { launch } = require('./lib.js');
const fs = require('fs');
const path = require('path');
const BASE = process.argv[2], OUT = (process.argv[3] || '.') + '/';
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 300)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let G;
async function docsOf(coll, field, val) { const ps = await G.queryEq(coll, field, val); const out = []; for (const p of ps) out.push(await G.getDoc(p)); return out; }

(async () => {
  G = await import(path.join(__dirname, '..', 'demo-account', 'lib', 'gcp.mjs'));
  
  const email = 'alert-e2e-' + Date.now().toString(36) + '@example.invalid';
  const password = 'Tz-' + require('crypto').randomBytes(9).toString('base64url');
  const u = await G.authCreate({ email, password, displayName: 'Alert E2E' });
  const uid = u.localId;
  console.log('throwaway member created (uid prefix ' + uid.slice(0, 6) + ')');
  const t0 = Date.now();
  let b;
  try {
    // live prices to place alerts around
    const bn = await (await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')).json();
    const btc = Number(bn.price);
    b = await launch({ args: ['--use-fake-ui-for-media-stream'] });
    if (process.env.E2E_PERSIST) { await b.close(); b = null; }
    const ctx = process.env.E2E_PERSIST
      ? await require('./lib.js').chromium.launchPersistentContext('/root/.hermes/profiles/web-worker-1/cache/scratch/e2e-profile', { executablePath: require('./lib.js').executablePath(), viewport: { width: 1440, height: 900 }, permissions: ['notifications'] })
      : await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['notifications'] });
    global.__ctx = ctx;
    await ctx.addInitScript(() => {
      window.__toastLog = []; window.__fireEvents = [];
      window.addEventListener('stryker:chart-alert', (e) => window.__fireEvents.push(e.detail));
      new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('stk-al-toast')) window.__toastLog.push(n.textContent); }))).observe(document, { childList: true, subtree: true });
    });
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_dismissed', '1'); } catch (e) {} });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { const x = m.text(); if (/push|token|messaging|FCM/i.test(x)) console.log('  [console]', x.slice(0, 400)); });

    // ---- 1. sign in + push registration (Settings toggle code path: enablePush())
    await p.goto(BASE + '/settings.html', { waitUntil: 'load' });
    await p.waitForFunction(() => window.firebase && firebase.auth, null, { timeout: 30000 });
    await p.evaluate(async (c) => { await firebase.auth().signInWithEmailAndPassword(c.email, c.password); }, { email, password });
    await p.goto(BASE + '/settings.html', { waitUntil: 'load' });
    await p.waitForFunction(() => firebase.auth().currentUser && typeof enablePush === 'function', null, { timeout: 30000 });
    const push = await p.evaluate(async () => { try { return await enablePush(); } catch (e) { return 'throw:' + e.message; } });
    let tokens = await G.queryEq('pushTokens', 'uid', uid);
    t('push: enablePush() registers this device (Settings toggle code path)', push === 'enabled' && tokens.length >= 1, { push, tokens: tokens.length });
    if (!tokens.length) {
      // Live rules key pushTokens by uid but the client writes pushTokens/{token}: non-admin registration is denied. Until the
      // rules fix is published, store the REAL browser token with the admin route so the rest of the chain is still proven.
      const tok = await p.evaluate(() => currentPushToken());
      console.log('  (fallback) browser FCM token obtained:', !!tok);
      if (tok) await G.setDocs([{ path: 'pushTokens/' + tok, data: { uid, token: tok, userAgent: 'e2e', createdAt: G.ts(Date.now()) } }]);
      tokens = await G.queryEq('pushTokens', 'uid', uid);
    }
    await p.screenshot({ path: OUT + 'alert-e2e-settings.png' });

    // ---- 2. Charts page open (signed in): engine heartbeat fresh -> page must NOT fire server-covered alerts itself
    await p.goto(BASE + '/charts.html', { waitUntil: 'load' });
    await p.waitForFunction(() => window.__stkAlerts && window.firebase && firebase.auth().currentUser, null, { timeout: 60000 });
    await p.evaluate(() => window.__stkAlerts.reload());
    await sleep(4000);
    const hb = await G.getDoc('settings/alertEngine');
    t('engine heartbeat is fresh in Firestore', !!hb && hb.at && (Date.now() - hb.at.ms) < 120000, hb && hb.at && Math.round((Date.now() - hb.at.ms) / 1000) + 's old');

    // alerts: greater-than BELOW the live price is true at once (the browser fires these immediately too), so the fire is
    // deterministic. A (BTCUSDT, Once), B (NQ, Once), C (BTCUSDT, Every time, own message).
    const mk = (symbol, price, freq, message, cond) => ({ symbol, cond: cond || 'greater', price, message, freq, active: true });
    const ids = await p.evaluate(async (al) => { const out = []; for (const a of al) out.push(await window.__stkAlerts.add(a)); return out; },
      [mk('binance:BTCUSDT', Math.round(btc - 200), 'once', 'e2e A'), mk('futures:NQ1!', 1000, 'once', 'e2e B'), mk('binance:BTCUSDT', Math.round(btc - 300), 'every', 'e2e C')]).catch(() => null);
    console.log('alert add via page API:', JSON.stringify(ids));
    await sleep(45000);       // 30 s sync + the fire

    const base = 'students/' + uid + '/chartAlerts';
    const docs = await G.listPaths(base);
    const rows = [];
    for (const d of docs) rows.push(Object.assign({ id: d.split('/').pop() }, await G.getDoc(d)));
    const byMsg = (m) => rows.find((r) => r.message === m);
    t('Once alert A (BTCUSDT) fired and was deactivated', byMsg('e2e A') && byMsg('e2e A').active === false, byMsg('e2e A') && byMsg('e2e A').active);
    t('Once alert B (NQ, futures feed) fired and was deactivated', byMsg('e2e B') && byMsg('e2e B').active === false, byMsg('e2e B') && byMsg('e2e B').active);
    t('Every-time alert C stays active', byMsg('e2e C') && byMsg('e2e C').active === true);

    const notes = await docsOf('notifications', 'recipientUid', uid);
    const texts = notes.map((n) => n.message);
    console.log('notification texts:', JSON.stringify(texts));
    const cnt = (m) => texts.filter((x) => x.includes(m)).length;
    t('exactly one notification per Once alert (A)', cnt('e2e A') === 1, cnt('e2e A'));
    t('exactly one notification per Once alert (B)', cnt('e2e B') === 1, cnt('e2e B'));
    t('Every-time alert C notified once (edge trigger, still above)', cnt('e2e C') === 1, cnt('e2e C'));
    t('notification shape: type chart_alert, link opens /charts with the symbol, unread', notes.every((n) => n.type === 'chart_alert' && /^charts\.html\?symbol=/.test(n.link) && n.read === false), notes.map((n) => [n.type, n.link]));
    t('push text format "SYMBOL is above LEVEL · message"', texts.some((x) => /^BTCUSDT is above [\d,]+\.\d\d · e2e A$/.test(x)), texts);

    // ---- 3. no double alert with the page open: one toast per fire, none from the browser's own checker
    const toasts = await p.evaluate(() => window.__toastLog.slice());
    const evs = await p.evaluate(() => window.__fireEvents.slice());
    console.log('fire events seen by the page:', JSON.stringify(evs.map((e) => [e.symbol, !!e.server])));
    t('page open: every fire event came from the server, none from the browser checker', evs.length >= 3 && evs.every((e) => e.server === true), evs.length);
    const aToasts = toasts.filter((x) => x.includes('e2e A')).length, bToasts = toasts.filter((x) => x.includes('e2e B')).length;
    console.log('page toasts:', JSON.stringify(toasts));
    t('page open: exactly one toast for A and one for B', aToasts === 1 && bToasts === 1, { aToasts, bToasts });
    await p.screenshot({ path: OUT + 'alert-e2e-charts.png' });

    // ---- 4. a fresh page-side tick must not re-fire: poll the browser checker by hand
    const before = (await G.queryEq('notifications', 'recipientUid', uid)).length;
    await p.evaluate(() => { try { window.__stkAlerts.poll(); } catch (e) {} });
    await sleep(8000);
    const after = (await G.queryEq('notifications', 'recipientUid', uid)).length;
    t('browser poll adds no notification docs', after === before, { before, after });
    t('no page errors', errs.length === 0, errs.slice(0, 3));
  } catch (e) {
    fail++; console.log('FAIL exception', String(e && e.stack || e).slice(0, 600));
  } finally {
    if (b) await b.close();
    if (global.__ctx) await global.__ctx.close().catch(() => {});
    console.log('WINDOW start=' + new Date(t0).toISOString() + ' end=' + new Date().toISOString());
    // ---- cleanup
    try {
      for (const sub of ['chartAlerts', 'alertFires', 'chartPrefs', 'watchlists', 'chartFavorites', 'chartLayouts', 'chartTemplates', 'paperTrading', 'journal', 'bookmarks']) {
        const l = await G.listPaths('students/' + uid + '/' + sub).catch(() => []);
        if (l.length) await G.deleteDocs(l);
      }
      const prof = await G.getDoc('students/' + uid).catch(() => null);
      const paths = ['students/' + uid, 'profiles/' + uid, 'presence/' + uid];
      if (prof && prof.username) paths.push('usernames/' + String(prof.username).toLowerCase());
      for (const k of ['notifications', 'pushTokens', 'activityLog']) {
        for (const f of ['recipientUid', 'uid']) {
          const r = await G.queryEq(k, f, uid).catch(() => []);
          paths.push(...r);
        }
      }
      await G.deleteDocs(paths).catch(() => {});
      await G.authDelete(uid).catch(() => {});
      console.log('cleanup done');
    } catch (e) { console.log('cleanup problem', String(e).slice(0, 200)); }
  }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
