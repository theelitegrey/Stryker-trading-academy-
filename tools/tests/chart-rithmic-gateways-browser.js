// Rithmic production gateway picker (build 602+). Reads the REAL public gateways' system lists
// (RequestRithmicSystemInfo, no login, no credentials) and checks the Connect sheet:
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-rithmic-gateways-browser.js [shotsDir]
// The Owner-only allowlist is widened to the stub user (u1) in flight for this page load only.
// A login is NEVER attempted. Also checks: default Chicago, saved choice, systems filtered to the two
// offered ones, admin-only Test gateway, app name.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fails = 0;
const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
async function waitFor(p, fn, arg, ms = 20000) { try { await p.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; } }
async function open(b, { w, h, mobile, admin, tz, ls }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile, timezoneId: tz || 'UTC' });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((ls) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker_rithmic_dev'); if (ls) for (const k in ls) localStorage.setItem(k, ls[k]); } catch (e) {} }, ls || null);
  await ctx.route(/\/assets\/rithmic-config\.js/, async (r) => {
    const res = await r.fetch();
    const body = (await res.text()).replace("allowUids: ['0hC8vmnsh0O2CkyWiyw9X1kn1XL2'", "allowUids: ['u1'" + (admin ? "" : ", 'nobody'") + "").replace(/allowUids: \[([^\]]*)\]/, (m, x) => admin ? m : "allowUids: ['u1']");
    await r.fulfill({ response: res, body });
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = []; const sockets = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('websocket', (ws) => sockets.push(ws.url()));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 45000 });
  return { ctx, p, errors, sockets };
}
(async () => {
  const b = await launch({});
  try {
    // 1. member view (u1 treated as an ordinary rithmicBeta member would be: here via allowUids, so gateway list has Test too).
    let { ctx, p, errors, sockets } = await open(b, { w: 1440, h: 900, admin: true, tz: 'Asia/Kolkata' });
    await p.click('#stkrb-btn');
    check(await waitFor(p, () => document.querySelectorAll('#stkrb-sys option[value]:not([value=""])').length > 0), 'system list loaded from the real Chicago gateway');
    const d = await p.evaluate(() => ({
      gw: [...document.querySelectorAll('#stkrb-gw option')].map((o) => o.textContent),
      sel: document.getElementById('stkrb-gw').selectedOptions[0].textContent,
      vis: !document.getElementById('stkrb-gw').closest('label').hidden,
      sys: [...document.querySelectorAll('#stkrb-sys option[value]:not([value=""])')].map((o) => o.value),
      hintSys: (document.getElementById('stkrb-sys-hint') || {}).textContent, noteHidden: document.getElementById('stkrb-test-note').hidden,
      hint: document.querySelector('#stkrb-gw').parentNode.querySelector('small').textContent
    }));
    console.log(JSON.stringify(d));
    check(d.vis && d.gw.length >= 12, 'gateway picker visible with ' + d.gw.length + ' entries');
    check(d.sel === 'Chicago (Core)', 'default = Chicago (Core)');
    check(!d.gw.some((x) => /colo/i.test(x)), 'Colo75 not offered');
    check(d.sys[0] === 'Rithmic 01' && d.sys[1] === 'Rithmic Paper Trading', 'systems start with Rithmic 01, Rithmic Paper Trading');
    const rest = d.sys.slice(2);
    check(rest.length > 15 && rest.join('|') === [...rest].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })).join('|'), 'prop firms sorted A-Z (' + rest.length + ')');
    check(d.sys.includes('tradesea') && d.sys.includes('Apex') && d.sys.includes('Tradeify') && d.sys.includes('LucidTrading') && d.sys.includes('Bulenox') && d.sys.includes('Earn2Trade'), 'Chicago lists tradesea, Apex, Tradeify, LucidTrading, Bulenox, Earn2Trade');
    check(!d.sys.includes('Rithmic Test'), 'Rithmic Test not in the system list');
    check(d.hintSys === 'Prop firm account? Pick your firm (e.g. TradeSea, Apex).', 'system hint shown');
    check(d.noteHidden === true, 'Test-gateway note hidden on Chicago');
    check(/Closest to you: Mumbai/.test(d.hint), 'IST browser: suggests Mumbai but keeps Chicago selected (' + d.hint + ')');
    check(d.gw.some((x) => /Rithmic Test/.test(x)), 'admin (allowUids) also sees Rithmic Test');
    await p.screenshot({ path: OUT + '/rithmic-gw-1440.png' });
    // choose Mumbai -> remembered
    await p.selectOption('#stkrb-gw', { label: 'Mumbai' });
    check(await waitFor(p, () => [...document.querySelectorAll('#stkrb-sys option')].some((o) => o.value === 'tradesea')), 'Mumbai lists tradesea');
    await p.selectOption('#stkrb-sys', 'tradesea');
    check(await p.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('stryker_rithmic_system') && localStorage.getItem(k) === 'tradesea')), 'chosen system remembered (tradesea)');
    await p.selectOption('#stkrb-gw', { label: 'Rithmic Test (admin)' });
    check(await waitFor(p, () => !document.getElementById('stkrb-test-note').hidden), 'Test note shown only when Test gateway selected');
    check(await waitFor(p, () => [...document.querySelectorAll('#stkrb-sys option')].some((o) => o.value === 'Rithmic Test')), 'Rithmic Test system listed for the admin Test gateway');
    await p.selectOption('#stkrb-gw', { label: 'Mumbai' });
    await waitFor(p, () => [...document.querySelectorAll('#stkrb-sys option')].some((o) => o.value === 'tradesea'));
    console.log(sockets.join(' '));
    check(await p.evaluate(() => localStorage.getItem('stryker_rithmic_gateway')) === 'wss://rprotocol-in.rithmic.com:443', 'choice remembered');
    check(!errors.filter((e) => !/docChanges/.test(e)).length, 'no page errors (the stub-only docChanges error is ignored) ' + errors.join('|'));
    await ctx.close();
    // 2. returning visit remembers it
    ({ ctx, p, errors, sockets } = await open(b, { w: 390, h: 844, mobile: true, admin: true, ls: { stryker_rithmic_gateway: 'wss://rprotocol-sg.rithmic.com:443' } }));
    // On a phone the Connect button lives in the toolbar's ⋯ overflow menu.
    await p.click('.stkc-ob-more-btn');
    await p.waitForTimeout(400);
    check(await p.evaluate(() => { const r = document.getElementById('stkrb-btn').getBoundingClientRect(); return r.width > 0 && r.height > 0; }), '390: Connect button reachable in the ⋯ menu');
    await p.click('#stkrb-btn');
    await waitFor(p, () => document.querySelectorAll('#stkrb-sys option[value]:not([value=""])').length > 0);
    check(await p.evaluate(() => document.getElementById('stkrb-gw').selectedOptions[0].textContent) === 'Singapore', 'saved choice restored on a new visit (Singapore)');
    const g = await p.evaluate(() => { const r = document.getElementById('stkrb-pop').getBoundingClientRect(); return { l: r.left, r: r.right, vw: innerWidth, docW: document.documentElement.scrollWidth }; });
    check(g.l >= 0 && g.r <= g.vw && g.docW <= g.vw, '390: sheet fits, no sideways scroll ' + JSON.stringify(g));
    await p.screenshot({ path: OUT + '/rithmic-gw-390.png' });
    check(!errors.filter((e) => !/docChanges/.test(e)).length, 'no page errors (390) ' + errors.join('|'));
    await ctx.close();
  } finally { await b.close(); }
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
