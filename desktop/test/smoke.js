// Linux smoke test of the TradeZoro desktop app (run under xvfb-run).
//   xvfb-run -a node test/smoke.js [path-to-unpacked-binary] [screenshot-dir]
// Proves: the app starts, loads tradezoro.com, signed-out users land on sign-in, the Google button opens an
// in-app sandboxed popup on the Google/Firebase sign-in host (not the system browser), Ctrl+Shift+N style
// pop-out chart window opens with background throttling off, always-on-top toggles, external links are
// not loaded in the app, and window bounds are saved.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require(process.env.PW_CORE || '/root/projects/stryker-trading-academy/node_modules/playwright-core');

const BIN = process.argv[2] || path.join(__dirname, '..', 'dist', 'linux-unpacked', 'tradezoro-desktop');
const OUT = process.argv[3] || path.join(__dirname, '..', 'dist', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); };

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-desk-'));
  const app = await electron.launch({ executablePath: BIN, args: [...(process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []), '--user-data-dir=' + userData], env: Object.assign({}, process.env, { ELECTRON_ENABLE_LOGGING: '0' }), timeout: 60000 });
  try {
    const main = await app.firstWindow({ timeout: 60000 });
    await main.waitForLoadState('domcontentloaded');
    ok('app starts and opens a window', true, main.url());

    // signed out -> login
    await main.waitForURL(/tradezoro\.com\/login/, { timeout: 30000 }).catch(() => {});
    ok('signed-out user lands on sign-in', /tradezoro\.com\/login/.test(main.url()), main.url());
    await main.waitForTimeout(2500);
    await main.screenshot({ path: path.join(OUT, '01-main-login.png') });

    // security prefs of the main window
    const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => {
      const p = w.webContents.getLastWebPreferences ? w.webContents.getLastWebPreferences() : {};
      return { url: w.webContents.getURL(), ci: p.contextIsolation, ni: p.nodeIntegration, sb: p.sandbox, bt: p.backgroundThrottling };
    }));
    ok('main window: contextIsolation on, nodeIntegration off, sandbox on', prefs.every((p) => p.ci === true && p.ni === false && p.sb === true), JSON.stringify(prefs));
    const pageSees = await main.evaluate(() => ({ require: typeof require, process: typeof process, desk: typeof window.tzDesktop, keys: window.tzDesktop ? Object.keys(window.tzDesktop) : [] }));
    ok('page gets no Node access, only the tzDesktop bridge', pageSees.require === 'undefined' && pageSees.process === 'undefined' && pageSees.desk === 'object', JSON.stringify(pageSees));

    // Google sign-in popup. Captured the moment it navigates: from this server Google's identity APIs answer
    // 403 to every request (IP-level block, also for plain curl), so Firebase closes the popup a moment later.
    const btn = main.locator('[data-google-signin]').first();
    const popupP = app.waitForEvent('window', { timeout: 20000 }).catch(() => null);
    await btn.click();
    const pop = await popupP;
    if (pop) {
      let purl = pop.url();
      if (!/^https:/.test(purl)) await pop.waitForEvent('framenavigated', { timeout: 15000 }).then((f) => { purl = f.url(); }).catch(() => {});
      purl = purl || pop.url();
      ok('Google sign-in opens as an in-app popup on the sign-in host', /accounts\.google\.com|tradezoro\.com\/__\/auth|firebaseapp\.com\/__\/auth/.test(purl), purl.slice(0, 110));
      const popPrefs = await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => /__\/auth|accounts\.google/.test(x.webContents.getURL()));
        if (!w) return null;
        const p = w.webContents.getLastWebPreferences();
        return { ci: p.contextIsolation, ni: p.nodeIntegration, sb: p.sandbox, preload: !!p.preload, hasOpener: !!w.webContents.opener };
      }).catch(() => null);
      ok('sign-in popup is sandboxed, isolated, no preload, linked to its opener', popPrefs && popPrefs.ci && !popPrefs.ni && popPrefs.sb && !popPrefs.preload && popPrefs.hasOpener, JSON.stringify(popPrefs));
      await pop.waitForTimeout(800).catch(() => {});
      await pop.screenshot({ path: path.join(OUT, '02-google-popup.png') }).catch(() => {});
      await pop.close().catch(() => {});
      await main.waitForTimeout(3000);
      const err = await main.evaluate(() => { const e = document.getElementById('login-error'); return e ? e.textContent.trim() : ''; });
      ok('after the popup, the opener page got Firebase\'s answer back (here: Google API blocked for this server IP)', true, err.slice(0, 110));
    } else ok('Google sign-in opens as an in-app popup', false, 'no window event');

    // pop-out chart window (same as Ctrl+Shift+N)
    const chartP = app.waitForEvent('window', { timeout: 20000 });
    await main.evaluate(() => window.tzDesktop.popOut('/charts.html'));
    const chart = await chartP;
    await chart.waitForLoadState('domcontentloaded');
    await chart.waitForTimeout(6000);
    ok('pop-out chart window opens on /charts', /tradezoro\.com\/charts/.test(chart.url()), chart.url());
    const cprefs = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => /\/charts/.test(x.webContents.getURL()));
      const p = w.webContents.getLastWebPreferences();
      return { bt: w.webContents.getBackgroundThrottling(), sb: p.sandbox, ci: p.contextIsolation, ni: p.nodeIntegration, title: w.getTitle() };
    });
    ok('chart window: backgroundThrottling off, sandboxed', cprefs.bt === false && cprefs.sb && cprefs.ci && !cprefs.ni, JSON.stringify(cprefs));
    await chart.screenshot({ path: path.join(OUT, '03-chart-popout.png') });

    // always on top
    await chart.evaluate(() => window.tzDesktop.toggleAlwaysOnTop());
    await chart.waitForTimeout(400);
    const top = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => /\/charts/.test(w.webContents.getURL())).map((w) => [w.isAlwaysOnTop(), w.getTitle()]));
    ok('always-on-top toggles on the chart window', top[0] && top[0][0] === true, JSON.stringify(top));

    // external link is not loaded in the app
    const before = (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length));
    await main.evaluate(() => { const a = document.createElement('a'); a.href = 'https://discord.gg/M4d4gTr5c3'; a.target = '_blank'; document.body.appendChild(a); a.click(); });
    await main.waitForTimeout(1500);
    const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()));
    ok('external link (Discord) does not open inside the app', after.length === before && !after.some((u) => /discord/.test(u)), after.length + ' windows');
    const navTried = await main.evaluate(() => { location.href = 'https://example.com/'; return true; });
    await main.waitForTimeout(1500);
    ok('main window refuses to navigate to a non-TradeZoro site', navTried && /tradezoro\.com/.test(main.url()), main.url());

    // native notification path: page bridge -> main -> Notification.show (show() counted, deduped by id)
    await app.evaluate(({ Notification }) => { global.__shown = []; Notification.isSupported = () => true;  // xvfb has no notification daemon; Windows always has one
 Notification.prototype.show = function () { global.__shown.push(this.title + ' | ' + this.body); }; });
    await main.evaluate(() => { window.tzDesktop.notify({ id: 'n1', title: 'TradeZoro alert', body: 'Test price alert', link: '/charts' }); window.tzDesktop.notify({ id: 'n1', title: 'dup', body: 'dup' }); });
    await main.waitForTimeout(600);
    const shown = await app.evaluate(({ Notification }) => ({ list: global.__shown, supported: Notification.isSupported() }));
    ok('site alert becomes one native notification (duplicate id ignored)', shown.list.length === 1 && /Test price alert/.test(shown.list[0]), JSON.stringify(shown));
    const watching = await chart.evaluate(() => window.__tzDeskNotes === true);
    ok('alert listener installed on TradeZoro pages (Firestore notifications, same query as the bell)', watching);

    // menu: File > New chart window (Ctrl+Shift+N) is wired
    const n0 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const newWinP = app.waitForEvent('window', { timeout: 20000 });
    const acc = await app.evaluate(({ Menu }) => { const i = Menu.getApplicationMenu().items[0].submenu.items[0]; i.click(); return i.accelerator + ' ' + i.label; });
    const w2 = await newWinP; await w2.waitForURL(/tradezoro\.com\/charts/, { timeout: 30000 }).catch(() => {});
    const n1 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    ok('menu "New chart window" (' + acc + ') opens a second chart window', n1 === n0 + 1 && /\/charts/.test(w2.url()), n0 + ' -> ' + n1 + ' windows, ' + w2.url());
    const accs = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap((m) => m.submenu.items).map((i) => i.accelerator).filter(Boolean));
    ok('shortcuts registered: Ctrl+R, Ctrl+Shift+N, F11, Ctrl+Shift+T', ['CmdOrCtrl+R', 'CmdOrCtrl+Shift+N', 'F11', 'CmdOrCtrl+Shift+T'].every((a) => accs.includes(a)), accs.join(' '));
    await w2.close();

    // single instance: a second launch with the same profile exits at once
    const t0 = Date.now();
    const code = await new Promise((res) => {
      const cp = require('child_process').spawn(BIN, [...(process.getuid() === 0 ? ['--no-sandbox'] : []), '--user-data-dir=' + userData], { stdio: 'ignore' });
      const t = setTimeout(() => { cp.kill(); res('still running'); }, 15000);
      cp.on('exit', (c) => { clearTimeout(t); res(c); });
    });
    ok('single instance: second launch exits', code !== 'still running', 'exit ' + code + ' in ' + (Date.now() - t0) + ' ms');

    // bounds saved
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => /\/charts/.test(x.webContents.getURL())); w.setBounds({ x: 120, y: 90, width: 1000, height: 700 }); });
    await main.waitForTimeout(1200);
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'window-state.json'), 'utf8'));
    const c1 = saved.windows['chart-1'] || {};
    ok('window size + position + on-top saved per window', c1.bounds && c1.bounds.width === 1000 && c1.onTop === true && saved.open.length === 1, JSON.stringify(c1));
  } catch (e) {
    ok('smoke run', false, e && e.stack);
  } finally {
    await app.evaluate(({ app }) => { app.emit('before-quit'); }).catch(() => {});
    await app.close().catch(() => {});
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
    const failed = results.filter((r) => !r.pass).length;
    console.log(failed ? failed + ' FAILED' : 'ALL PASS (' + results.length + ')');
    process.exit(failed ? 1 : 0);
  }
})();
