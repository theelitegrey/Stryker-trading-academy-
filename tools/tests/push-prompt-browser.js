// Browser test: phone-notification prompt + status + test button (Owner bug 2026-11-07, "alerts don't pop up").
//   node tools/tests/chart-dev-server.mjs 8197 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8197 node tools/tests/push-prompt-browser.js [shotsDir]
// Firebase is stubbed (richstub) with in-memory pushTokens / notifications; Notification.permission and the
// service worker are faked so 'default' / 'granted' / 'denied' can each be driven. 1440 and 390 (touch), dark.
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8197';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;   // e.g. ONLY=dpDefault
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

// Fakes: permission, service worker, FCM token, and in-memory pushTokens / notifications / settings/push.
const fakes = ([perm, preToken]) => {
  let P = perm;
  window.__prompts = 0; window.__sysNotes = []; window.__toasts = []; window.__stkChartTestFree = false;
  try { Object.defineProperty(Notification, 'permission', { get: () => P, configurable: true }); } catch (e) {}
  Notification.requestPermission = async () => { window.__prompts++; P = 'granted'; return P; };
  const reg = { scope: '/', showNotification: async (t, o) => { window.__sysNotes.push([t, o]); } };
  try {
    navigator.serviceWorker.register = async () => reg;
    navigator.serviceWorker.getRegistration = async () => reg;
    Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve(reg), configurable: true });
  } catch (e) {}
  const tokens = window.__pushTokens = new Map(); const notifs = window.__notifs = [];
  if (preToken) { tokens.set('TOK-1', { uid: 'u1', token: 'TOK-1' }); localStorage.setItem('stryker_push_tok_u1', JSON.stringify({ t: 'TOK-1', at: Date.now() })); }
  const fbMsg = { getToken: async () => 'TOK-1', onMessage: (cb) => { window.__onMsg = cb; }, deleteToken: async () => true };
  const t = setInterval(() => {
    const db = window.__stubDb; if (!db || !window.firebase) return;
    window.firebase.messaging = () => fbMsg;
    if (db.__push) return; db.__push = 1; clearInterval(t);
    const orig = db.collection;
    db.collection = (name) => {
      const c = orig(name);
      if (name === 'pushTokens') return Object.assign({}, c, { doc: (id) => ({ id, get: async () => ({ exists: tokens.has(id), data: () => tokens.get(id) }), set: async (d) => { tokens.set(id, d); }, delete: async () => { tokens.delete(id); } }) });
      if (name === 'notifications') return Object.assign({}, c, { add: async (d) => { notifs.push(d); return { id: 'n' + notifs.length, onSnapshot: (cb) => { setTimeout(() => cb({ exists: true, data: () => Object.assign({}, d, { pushResult: { status: tokens.size ? 'sent' : 'no-device', sent: tokens.size, tokens: tokens.size } }) }), 200); return () => {}; } }; } });
      if (name === 'settings') { const od = c.doc; return Object.assign({}, c, { doc: (id) => (id === 'push' ? { get: async () => ({ exists: true, data: () => ({ vapidKey: 'VAPID' }) }) } : od(id)) }); }
      return c;
    };
  }, 0);
  const w = setInterval(() => { if (window.showToast && !window.showToast.__w) { const o = window.showToast; window.showToast = (ty, m, x) => { window.__toasts.push(String(m)); return o(ty, m, x); }; window.showToast.__w = 1; } }, 50);
  try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_dismissed_u1', '1'); localStorage.setItem('stryker_theme', 'night'); } catch (e) {}
};

async function open(b, page, { w, h, mobile, perm, token, ua }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile, userAgent: ua });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakes, [perm, !!token]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/' + page, { waitUntil: 'domcontentloaded' });
  if (page === 'charts.html') { await p.waitForFunction(() => window.__stkAlerts && window.StrykerPush && window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 }); await sleep(2500); }
  else { await p.waitForFunction(() => window.StrykerPush, null, { timeout: 30000 }); await sleep(2500); }
  return { ctx, p, errors };
}
// Dark Pool Prints on SPY with its alert on, settings window open at "Alerts"; returns the push slot state.
async function openDp(p) {
  await p.evaluate(() => { const x = document.querySelector('#stk-al'); if (x) x.hidden = true; const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol('IDX:SPY'); });
  await sleep(2500);
  await p.evaluate(async () => { const m = await import('/assets/chart-dp-alerts.js?v=913'); const ws = window.STRYKER_VELA; ws.context().cells[0].chart.addNativeIndicator('stk_darkpool', { inputs: { alertOn: true } }); ws.context().stateChanged(); await new Promise((r) => setTimeout(r, 2000)); m.openIndicatorAlerts(ws, false); });
  await sleep(2000);
  await p.evaluate(() => { const e = document.querySelector('.stkdpa-inote'); if (e) e.scrollIntoView({ block: 'center' }); });
  await sleep(600);
  return slot(p, '.stkdpa-inote .stkdpa-push');
}
async function shot(p, name) { await p.mouse.move(2, 2).catch(() => {}); await sleep(500); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
const tap = async (p, sel, phone) => { const el = await p.$(sel); if (!el) return false; await el.scrollIntoViewIfNeeded(); const bb = await el.boundingBox(); if (!bb) return false; if (phone) await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); else await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); return true; };
const slot = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const b = e.querySelector('.tz-pushp-btn'); const br = b && b.getBoundingClientRect(); return { hidden: e.hidden || r.height === 0, st: e.getAttribute('data-push'), head: (e.querySelector('b') || {}).textContent, sub: (e.querySelector('.tz-pushp-tx span') || {}).textContent, btn: b && b.textContent, bh: br && Math.round(br.height), inView: r.left >= 0 && r.right <= innerWidth + 1 }; }, sel);

async function chartCase(b, tag, o) {
  const { ctx, p, errors } = await open(b, 'charts.html', o);
  const phone = !!o.mobile;
  await p.evaluate(() => window.__stkAlerts.open({ symbol: 'CME:NQ1!', price: 21000 }));
  await sleep(1200);
  const form = await slot(p, '.stk-al-form:not(.stk-al-zform) .stk-al-push');
  const mgr = await slot(p, '.stk-al-pstat');
  if (o.perm === 'default') {
    check(form && !form.hidden && form.head === 'Get this alert as a phone notification' && form.btn === 'Turn on' && form.inView, tag + ': price form shows the prompt ' + JSON.stringify(form));
    if (phone) check(form && form.bh >= 44, tag + ': Turn on tap target >= 44 (' + (form && form.bh) + ')');
    check(mgr && mgr.st === 'off' && /off for this device/i.test(mgr.head) && mgr.hidden, tag + ': manager status is Off, hidden while the form shows its own Turn on');
    check(await p.evaluate(() => window.__prompts) === 0, tag + ': nothing prompted on open');
    await shot(p, 'push-' + tag + '-form-prompt.png');
    await p.evaluate(() => document.querySelector('.stk-al-cancel').click()); await sleep(300);
    check(!(await slot(p, '.stk-al-pstat')).hidden, tag + ': manager status shows once the form is closed');
    await shot(p, 'push-' + tag + '-manager-off.png');
    await p.evaluate(() => document.querySelector('#stk-al .stk-al-new').click()); await sleep(800);
    // a forex symbol is checked in this browser only: no phone push, so no prompt
    await p.evaluate(() => { const f = document.querySelector('.stk-al-form:not(.stk-al-zform)'); f.symbol.value = 'fx:EURUSD'; f.symbol.dispatchEvent(new Event('change')); });
    await sleep(300);
    check((await slot(p, '.stk-al-form:not(.stk-al-zform) .stk-al-push')).hidden, tag + ': no prompt for a browser-only (forex) alert');
    await p.evaluate(() => { const f = document.querySelector('.stk-al-form:not(.stk-al-zform)'); f.symbol.value = 'binance:BTCUSDT'; f.symbol.dispatchEvent(new Event('change')); });
    await sleep(600);
    check(!(await slot(p, '.stk-al-form:not(.stk-al-zform) .stk-al-push')).hidden, tag + ': prompt back for a server (Binance) alert');
    check(await tap(p, '.stk-al-form:not(.stk-al-zform) .stk-al-push .tz-pushp-btn', phone), tag + ': tap Turn on');
    await sleep(1500);
    const after = await slot(p, '.stk-al-form:not(.stk-al-zform) .stk-al-push');
    const st = await p.evaluate(() => ({ prompts: window.__prompts, perm: Notification.permission, tok: [...window.__pushTokens.keys()], doc: window.__pushTokens.get('TOK-1') }));
    check(st.prompts === 1 && st.perm === 'granted' && st.tok.join() === 'TOK-1' && st.doc && st.doc.uid === 'u1', tag + ': Turn on asked once and saved pushTokens/TOK-1 ' + JSON.stringify({ prompts: st.prompts, tok: st.tok }));
    check(after && after.st === 'on' && after.btn === 'Send test', tag + ': prompt turns into "on" + Send test ' + JSON.stringify(after));
    await shot(p, 'push-' + tag + '-form-on.png');
    // dark pool dialog
    await p.evaluate(() => { window.__stkAlerts && document.querySelector('#stk-al .stk-al-x').click(); });
  } else if (o.perm === 'denied') {
    check(form && !form.hidden && /blocked/i.test(form.head) && !form.btn && form.sub.length > 20, tag + ': denied: blocked + how to unblock ' + JSON.stringify(form));
    check(o.mobile ? /Android|address/.test(form.sub) : /address bar/.test(form.sub), tag + ': unblock help for this platform');
    await shot(p, 'push-' + tag + '-form-denied.png');
  } else {
    check(form && form.hidden, tag + ': granted + registered: no prompt in the form');
    check(mgr && !mgr.hidden && mgr.head === 'Notifications on for this device' && mgr.btn === 'Send test', tag + ': manager says on + Send test ' + JSON.stringify(mgr));
    check(await tap(p, '.stk-al-pstat .tz-pushp-btn', phone), tag + ': tap Send test');
    await sleep(1500);
    const n = await p.evaluate(() => ({ n: window.__notifs.slice(-1)[0], toasts: window.__toasts.slice(-2) }));
    check(n.n && n.n.type === 'test' && n.n.recipientUid === 'u1' && n.n.senderUid === 'u1' && n.n.read === false, tag + ': test notification addressed to self ' + JSON.stringify(n.n && { type: n.n.type }));
    check(n.toasts.some((t) => /Test sent to 1 of 1 device/.test(t)), tag + ': toast reports delivery ' + JSON.stringify(n.toasts));
    // rate limit (client side; the function enforces it too)
    for (let i = 0; i < 2; i++) { await p.evaluate(() => window.StrykerPush.sendTest()); }
    const r4 = await p.evaluate(() => window.StrykerPush.sendTest());
    check(r4.status === 'rate-limited', tag + ': 4th test in an hour refused');
    await shot(p, 'push-' + tag + '-manager-on.png');
    // foreground message while this tab is hidden: system notification through the service worker
    const sys = await p.evaluate(async () => { Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true }); window.__onMsg({ data: { title: 'TradeZoro', body: 'NQ crossed 21,000', type: 'chart_alert', nid: 'x1', link: '/charts.html?symbol=CME:NQ1!' } }); await new Promise((r) => setTimeout(r, 300)); return window.__sysNotes.slice(-1)[0]; });
    check(sys && sys[1].body === 'NQ crossed 21,000' && sys[1].requireInteraction === true && sys[1].tag === 'alert-chart_alert-x1', tag + ': hidden tab still gets a system notification ' + JSON.stringify(sys && sys[1].tag));
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true }); });
  }
  // dark pool alert (Dark Pool Prints indicator settings, Alerts section): same prompt
  const dp = await openDp(p);
  if (o.perm === 'granted' || o.perm === 'default') check(dp && dp.hidden, tag + ': dark pool settings: no prompt once on ' + JSON.stringify(dp));
  else check(dp && !dp.hidden && /blocked/i.test(dp.head), tag + ': dark pool settings show the blocked line ' + JSON.stringify(dp));
  if (o.perm === 'denied') await shot(p, 'push-' + tag + '-dp-denied.png');
  check(!errors.length, tag + ': no page errors ' + errors.slice(0, 2).join(' | '));
  await ctx.close();
}

async function dpDefault(b, tag, o) {
  const { ctx, p, errors } = await open(b, 'charts.html', o);
  const dp = await openDp(p);
  check(dp && !dp.hidden && dp.head === 'Get this alert as a phone notification' && dp.btn === 'Turn on', tag + ': dark pool alert settings show the prompt ' + JSON.stringify(dp));
  await shot(p, 'push-' + tag + '-dp-prompt.png');
  // options (ZoroOptions) alert form
  await p.keyboard.press('Escape'); await sleep(400);
  await p.evaluate(() => { const d = document.querySelector('.vela-ind-dialog'); if (d) d.remove(); window.__stkAlerts.open(); });
  await sleep(600);
  await p.evaluate(() => document.querySelector('#stk-al .stk-al-znew:not(.stk-al-dpnew)').click());
  await sleep(800);
  const z = await slot(p, '.stk-al-zform .stk-al-push');
  check(z && !z.hidden && z.btn === 'Turn on', tag + ': options alert form shows the prompt ' + JSON.stringify(z));
  check(!errors.length, tag + ': no page errors ' + errors.slice(0, 2).join(' | '));
  await ctx.close();
}

async function iosCase(b, tag) {
  const { ctx, p } = await open(b, 'charts.html', { w: 390, h: 844, mobile: true, perm: 'default', ua: IPHONE });
  await p.evaluate(() => window.__stkAlerts.open({ symbol: 'CME:NQ1!', price: 21000 }));
  await sleep(1000);
  const form = await slot(p, '.stk-al-form:not(.stk-al-zform) .stk-al-push');
  check(form && !form.hidden && /Home Screen/.test(form.head) && !form.btn, tag + ': iPhone Safari: add to Home Screen first ' + JSON.stringify(form && form.head));
  await shot(p, 'push-' + tag + '-ios.png');
  await ctx.close();
}

async function settingsCase(b, tag, o) {
  const { ctx, p, errors } = await open(b, 'settings.html', o);
  await p.evaluate(() => { const e = document.getElementById('push-state'); if (e) e.closest('.panel').scrollIntoView({ block: 'center' }); });
  await sleep(1500);
  const s = await p.evaluate(() => { const v = (id) => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none' && !e.hidden; }; return { state: (document.getElementById('push-state') || {}).textContent, enable: v('push-enable-btn'), test: v('push-test-btn'), off: v('push-disable-btn') }; });
  if (o.perm === 'granted') {
    check(s.state === 'Notifications on for this device.' && s.test && s.off && !s.enable, tag + ': Settings on + Send test + Turn off ' + JSON.stringify(s));
    await shot(p, 'push-' + tag + '-settings-on.png');
    check(await tap(p, '#push-test-btn', !!o.mobile), tag + ': tap Send test notification');
    await sleep(1500);
    const n = await p.evaluate(() => ({ n: window.__notifs.length, state: document.getElementById('push-state').textContent }));
    check(n.n === 1 && /Test sent/.test(n.state), tag + ': test sent from Settings ' + JSON.stringify(n));
  } else if (o.perm === 'denied') {
    check(/^Blocked for this site\./.test(s.state) && !s.test, tag + ': Settings blocked + how to unblock ' + JSON.stringify(s));
  } else {
    check(/^Off for this device/.test(s.state) && s.enable && !s.test, tag + ': Settings off + Enable ' + JSON.stringify(s));
    await shot(p, 'push-' + tag + '-settings-off.png');
  }
  check(!errors.length, tag + ': no page errors ' + errors.slice(0, 2).join(' | '));
  await ctx.close();
}

(async () => {
  const b = await launch();
  try {
    const D = { w: 1440, h: 900 }, M = { w: 390, h: 844, mobile: true };
    if (!ONLY || ONLY.test('chartCase')) await chartCase(b, '1440-default', Object.assign({ perm: 'default' }, D));
    if (!ONLY || ONLY.test('chartCase')) await chartCase(b, '390-default', Object.assign({ perm: 'default' }, M));
    if (!ONLY || ONLY.test('chartCase')) await chartCase(b, '1440-granted', Object.assign({ perm: 'granted', token: true }, D));
    if (!ONLY || ONLY.test('chartCase')) await chartCase(b, '390-granted', Object.assign({ perm: 'granted', token: true }, M));
    if (!ONLY || ONLY.test('chartCase')) await chartCase(b, '1440-denied', Object.assign({ perm: 'denied' }, D));
    if (!ONLY || ONLY.test('chartCase')) await chartCase(b, '390-denied', Object.assign({ perm: 'denied', ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36' }, M));
    if (!ONLY || ONLY.test('dpDefault')) await dpDefault(b, '390-default', Object.assign({ perm: 'default' }, M));
    if (!ONLY || ONLY.test('dpDefault')) await dpDefault(b, '1440-default', Object.assign({ perm: 'default' }, D));
    if (!ONLY || ONLY.test('iosCase')) await iosCase(b, '390');
    if (!ONLY || ONLY.test('settingsCase')) await settingsCase(b, '390-granted', Object.assign({ perm: 'granted', token: true }, M));
    if (!ONLY || ONLY.test('settingsCase')) await settingsCase(b, '1440-granted', Object.assign({ perm: 'granted', token: true }, D));
    if (!ONLY || ONLY.test('settingsCase')) await settingsCase(b, '390-default', Object.assign({ perm: 'default' }, M));
    if (!ONLY || ONLY.test('settingsCase')) await settingsCase(b, '390-denied', Object.assign({ perm: 'denied' }, M));
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
