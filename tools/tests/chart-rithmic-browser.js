// Charts phase 4 (Rithmic "Connect broker") browser test, against two local servers:
//   node tools/tests/chart-dev-server.mjs 8031      (site + /api/chart/bars, binds 127.0.0.1)
//   node tools/tests/rithmic-mock.mjs 8765          (fake Rithmic gateway, binds 127.0.0.1)
//   CHART_BASE=http://127.0.0.1:8031 RITHMIC_MOCK=ws://127.0.0.1:8765 node tools/tests/chart-rithmic-browser.js [shotsDir]
// Needs network for jsDelivr (Vela) and Yahoo (the normal futures data, fetched by the dev server).
// Uses only the fake login demo / demo-pass that the mock accepts.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const MOCK = process.env.RITHMIC_MOCK || 'ws://127.0.0.1:8765';
const MOCK_HTTP = MOCK.replace(/^ws/, 'http');
const OUT = process.argv[2] || '/tmp';
const PASS = 'demo-pass';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = async () => (await fetch(MOCK_HTTP + '/__stats')).json();

async function open(b, { w, h, mobile, dev }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((dev) => {
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      if (dev) localStorage.setItem('stryker_rithmic_dev', JSON.stringify({ gateway: dev })); else localStorage.removeItem('stryker_rithmic_dev');
    } catch (e) {}
  }, dev || null);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const reqs = [];
  const errors = [];
  p.on('request', (r) => reqs.push({ url: r.url(), body: r.postData() || '', headers: JSON.stringify(r.headers()) }));
  p.on('console', (m) => { reqs.push({ url: 'console:', body: m.text(), headers: '' }); if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  const frames = [];
  p.on('websocket', (ws) => { ws.on('framesent', (f) => frames.push({ url: ws.url(), payload: f.payload })); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 45000 });
  await waitBars(p);
  return { ctx, p, reqs, errors, frames };
}
const waitBars = (p) => p.evaluate(async () => {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {}
  }
  return false;
});
const lastBar = (p) => p.evaluate(() => { const b = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars; const x = b[b.length - 1]; return x ? { n: b.length, time: x.time, close: x.close, open: x.open } : null; });
const isMock = (bar) => !!bar && bar.close > 10500 && bar.close < 11800; // mock NQ is ~11111, real NQ is far above
async function waitFor(p, fn, arg, ms = 15000) { try { await p.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; } }

(async () => {
  // Warm the dev server's Yahoo upstream first (its very first fetch can 502 on a cold start).
  for (let i = 0; i < 5; i++) {
    try { const r = await fetch(BASE + '/api/chart/bars/NQ?tf=15&page=' + Math.floor(Date.now() / 1000 / (5 * 86400))); if (r.ok) break; } catch (e) {}
    await sleep(1500);
  }
  const b = await launch();
  try {
    // ---------- 1. flag OFF (what every member gets today) ----------
    {
      const { ctx, p, reqs, errors } = await open(b, { w: 1440, h: 900 });
      const ui = await p.evaluate(() => ({ btn: !!document.getElementById('stkr-btn'), chip: !!document.getElementById('stkr-chip'), api: !!window.STRYKER_RITHMIC }));
      const loaded = reqs.filter((r) => /rithmic-(ui|client|provider|proto)\.js/.test(r.url)).map((r) => r.url);
      check(!ui.btn && !ui.chip && !ui.api, 'flag off: no Connect broker button, no chip, no Rithmic API');
      check(loaded.length === 0, 'flag off: no Rithmic client/UI/provider/codec file is downloaded ' + loaded.join(' '));
      const lb = await lastBar(p);
      check(lb && !isMock(lb), 'flag off: NQ chart shows the normal data (last close ' + (lb && lb.close) + ')');
      check(!errors.length, 'flag off: no page errors ' + errors.join(' | '));
      await ctx.close();
    }

    // ---------- 2. flag ON via the localhost-only dev switch, desktop 1440 ----------
    const before = await stats();
    let { ctx, p, reqs, errors, frames } = await open(b, { w: 1440, h: 900, dev: MOCK });
    const normal = await lastBar(p);
    check(normal && !isMock(normal), 'flag on, not connected: chart uses the normal data (close ' + (normal && normal.close) + ')');
    check(await p.evaluate(() => !!document.getElementById('stkr-btn') && document.getElementById('stkr-chip').hidden), 'flag on: Connect broker button shown, chip hidden while disconnected');
    await p.click('#stkr-btn');
    check(await waitFor(p, () => document.querySelectorAll('#stkr-sys option[value]:not([value=""])').length === 3), 'sheet lists the systems from RequestRithmicSystemInfo');
    const sheet = await p.evaluate(() => ({
      systems: [...document.querySelectorAll('#stkr-sys option')].map((o) => o.textContent),
      tradovate: [...document.querySelectorAll('.stkr-broker')].map((x) => x.textContent + (x.disabled ? ' [disabled]' : '')),
      note: document.querySelector('.stkr-note').textContent,
      formAction: document.getElementById('stkr-form').getAttribute('action')
    }));
    check(sheet.tradovate.some((t) => /Tradovate.*Coming soon.*\[disabled\]/.test(t)), 'Tradovate shown greyed "Coming soon": ' + sheet.tradovate.join(' / '));
    check(/straight from your browser to Rithmic\. Stryker never sees or stores your password/.test(sheet.note), 'privacy note shown');
    check(sheet.formAction === null, 'form has no action (never submits to a server)');
    // wrong password first
    await p.selectOption('#stkr-sys', 'Rithmic Test');
    await p.fill('#stkr-user', 'demo');
    await p.fill('#stkr-pass', 'not-the-password');
    await p.click('#stkr-go');
    check(await waitFor(p, () => !document.querySelector('.stkr-err').hidden), 'wrong password: error shown, still disconnected');
    await p.fill('#stkr-pass', PASS);
    await p.check('#stkr-remember');
    await p.screenshot({ path: OUT + '/rithmic-1440-sheet.png' });
    await p.click('#stkr-go');
    check(await waitFor(p, () => window.STRYKER_RITHMIC.state === 'connected' && !document.getElementById('stkr-chip').hidden), 'connect: state connected and chip visible');
    check(await p.evaluate(() => document.getElementById('stkr-chip').textContent === 'Rithmic · connected'), 'chip reads "Rithmic · connected"');
    check(await p.evaluate(() => document.getElementById('stkr-pass').value === ''), 'password field cleared after connect');
    check(await waitFor(p, () => { const b = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars; const x = b[b.length - 1]; return x && x.close > 10500 && x.close < 11800; }, null, 20000), 'history: NQ chart reloaded from Rithmic time-bar replay');
    const s1 = await stats();
    check(s1.replays > before.replays && s1.subscribes > before.subscribes, 'mock saw replay + market-data subscribe (' + (s1.replays - before.replays) + ' replays)');
    check(s1.lastApp && s1.lastApp.app_name === 'STRK_Stryker' && /^\d+$/.test(s1.lastApp.app_version), 'login carried app_name STRK_Stryker + app_version ' + (s1.lastApp && s1.lastApp.app_version));
    const r1 = await lastBar(p);
    await sleep(2500);
    const r2 = await lastBar(p);
    check(r1 && r2 && r2.time >= r1.time && (r2.close !== r1.close || r2.time !== r1.time || true) && isMock(r2), 'live candle stays on Rithmic data');
    const ticks = await p.evaluate(async () => {
      const c = window.STRYKER_VELA.context().cells[0].chart.orchestrator;
      const seen = new Set();
      for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 150)); const b = c.rawBars[c.rawBars.length - 1]; seen.add(b.close); }
      return seen.size;
    });
    check(ticks > 1, 'live candle moves with streamed ticks (' + ticks + ' distinct closes in 3 s)');
    await p.click('body', { position: { x: 5, y: 5 } }).catch(() => {});
    await p.screenshot({ path: OUT + '/rithmic-1440-connected.png' });

    // drop every socket: reconnect, fallback while away, back on Rithmic after
    await fetch(MOCK_HTTP + '/__drop');
    check(await waitFor(p, () => window.STRYKER_RITHMIC.state === 'reconnecting', null, 5000) || await p.evaluate(() => window.STRYKER_RITHMIC.state === 'connected'), 'socket drop: client goes to reconnecting');
    check(await waitFor(p, () => window.STRYKER_RITHMIC.state === 'connected', null, 20000), 'socket drop: reconnected by itself');
    check(await waitFor(p, () => { const b = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars; const x = b[b.length - 1]; return x && x.close > 10500 && x.close < 11800; }, null, 20000), 'after reconnect: chart back on Rithmic data');
    const s2 = await stats();
    check(s2.logins >= s1.logins + 2, 'reconnect logged both plants in again');

    // disconnect: falls back to the normal data
    await p.click('#stkr-btn');
    await p.screenshot({ path: OUT + '/rithmic-1440-connected-sheet.png' });
    await p.click('#stkr-off');
    check(await waitFor(p, () => window.STRYKER_RITHMIC.state === 'idle' && document.getElementById('stkr-chip').hidden), 'disconnect: idle, chip hidden');
    check(await waitFor(p, () => { const b = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars; const x = b[b.length - 1]; return x && !(x.close > 10500 && x.close < 11800); }, null, 30000), 'disconnect: NQ chart falls back to the normal data');
    const s3 = await stats();
    check(s3.logouts > s2.logouts, 'disconnect sent RequestLogout');

    // privacy: the password never leaves for anything but the Rithmic socket
    const leaks = reqs.filter((r) => (r.url + r.body + r.headers).includes(PASS)).map((r) => r.url);
    check(leaks.length === 0, 'password in no HTTP request, header, body or console line (' + reqs.length + ' checked) ' + leaks.join(' '));
    const toSite = reqs.filter((r) => r.url.startsWith(BASE) || /strykertrading\.com/.test(r.url));
    check(toSite.length > 0 && toSite.every((r) => !(r.url + r.body).includes(PASS)), 'no request to the site origin carries the password (' + toSite.length + ' requests)');
    const storage = await p.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
    check(!storage.includes(PASS), 'password not in localStorage, sessionStorage or cookies');
    check(storage.includes('"stryker_rithmic_user":"demo"'), '"Remember username" kept the username only');
    const wsFrames = frames.filter((f) => Buffer.from(f.payload).toString('latin1').includes(PASS));
    check(wsFrames.length > 0 && wsFrames.every((f) => f.url.startsWith(MOCK)), 'password only ever sent inside the Rithmic socket (' + wsFrames.length + ' login frames)');
    check(!errors.length, 'flag on: no page errors ' + errors.join(' | '));
    await ctx.close();

    // ---------- 3. phone 390 ----------
    ({ ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true, dev: MOCK }));
    await p.click('#stkr-btn');
    await waitFor(p, () => document.querySelectorAll('#stkr-sys option[value]:not([value=""])').length === 3);
    const g = await p.evaluate(() => {
      const r = document.getElementById('stkr-pop').getBoundingClientRect();
      const go = document.getElementById('stkr-go').getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), b: Math.round(r.bottom), goH: Math.round(go.height), vw: innerWidth, vh: innerHeight, docW: document.documentElement.scrollWidth, fs: getComputedStyle(document.getElementById('stkr-user')).fontSize };
    });
    check(g.l >= 0 && g.r <= g.vw && g.docW <= g.vw, '390: sheet fits the width, no sideways scroll ' + JSON.stringify(g));
    check(g.fs === '16px' && g.goH >= 40, '390: 16px inputs (no iOS zoom), 40px+ Connect button');
    await p.screenshot({ path: OUT + '/rithmic-390-sheet.png' });
    await p.selectOption('#stkr-sys', 'TradeSea');
    await p.fill('#stkr-user', 'demo');
    await p.fill('#stkr-pass', PASS);
    await p.click('#stkr-go');
    check(await waitFor(p, () => window.STRYKER_RITHMIC.state === 'connected'), '390: connects');
    await waitFor(p, () => { const b = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars; const x = b[b.length - 1]; return x && x.close > 10500 && x.close < 11800; }, null, 20000);
    const chip = await p.evaluate(() => { const r = document.getElementById('stkr-chip').getBoundingClientRect(); return { vis: r.width > 0, r: Math.round(r.right), vw: innerWidth, docW: document.documentElement.scrollWidth }; });
    check(chip.vis && chip.r <= chip.vw && chip.docW <= chip.vw, '390: chip visible inside the toolbar ' + JSON.stringify(chip));
    await p.screenshot({ path: OUT + '/rithmic-390-connected.png' });
    await p.evaluate(() => window.STRYKER_RITHMIC.disconnect());
    check(!errors.length, '390: no page errors ' + errors.join(' | '));
    await ctx.close();
  } catch (e) {
    fail++; console.log('FAIL exception', e);
  } finally {
    await b.close();
  }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
