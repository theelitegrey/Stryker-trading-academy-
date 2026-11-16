// Linux smoke test of the TradeZoro desktop app (run under xvfb-run).
//   xvfb-run -a node test/smoke.js [path-to-unpacked-binary] [screenshot-dir]
// Proves: the app starts, loads tradezoro.com, signed-out users land on sign-in, the Google button hands sign-in to the
// system browser (tradezoro.com/desktop-login + loopback/protocol return + custom token), Razorpay popups stay in-app, Ctrl+Shift+N style
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

    // Google sign-in now runs in the SYSTEM browser (Google blocks OAuth inside apps). The live site may not have
    // the new assets/auth.js yet, so this branch's copy is served for tradezoro.com/assets/auth.js. shell.openExternal
    // is captured (no real browser here) and the redeem call to tradezoro.com is stubbed; the loopback server,
    // nonce/code checks, IPC and page code are the real ones.
    const LOCAL_AUTH = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'auth.js'), 'utf8');
    await app.evaluate(({ session, shell, net }, src) => {
      global.__opened = []; global.__redeems = [];
      shell.openExternal = (u) => { global.__opened.push(u); return Promise.resolve(); };
      const realFetch = net.fetch.bind(net);
      global.__redeemAnswer = 'bad';
      net.fetch = (input, init) => {
        const u = typeof input === 'string' ? input : input.url;
        if (u === 'https://tradezoro.com/api/desktop/handoff/redeem') {
          global.__redeems.push(JSON.parse(init.body));
          return Promise.resolve(global.__redeemAnswer === 'ok'
            ? new Response(JSON.stringify({ token: 'header.' + 'p'.repeat(40) + '.sig' }), { status: 200 })
            : new Response(JSON.stringify({ error: 'x' }), { status: 403 }));
        }
        return realFetch(input, init);
      };
      session.defaultSession.protocol.handle('https', (req) => {
        if (/^https:\/\/tradezoro\.com\/assets\/auth\.js/.test(req.url)) return new Response(src, { headers: { 'content-type': 'text/javascript' } });
        return realFetch(req, { bypassCustomProtocolHandlers: true });
      });
    }, LOCAL_AUTH);
    await main.reload(); await main.waitForLoadState('load'); await main.waitForTimeout(2500);
    const hasG = await main.evaluate(() => typeof window.tzDesktop.googleSignIn === 'function' && typeof tzDesktopGoogleSignIn === 'function');
    ok('page has tzDesktop.googleSignIn and the new auth.js', hasG);
    await main.evaluate(() => { window.__ct = null; auth.signInWithCustomToken = (t) => { window.__ct = t; return new Promise(() => {}); }; });
    const nWin0 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    await main.locator('[data-google-signin]').first().click();
    await main.waitForTimeout(1500);
    const opened = await app.evaluate(() => global.__opened.slice());
    const nWin1 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    ok('Google sign-in opens no window inside the app', nWin1 === nWin0, nWin0 + ' -> ' + nWin1);
    let lu = null; try { lu = new URL(opened[0]); } catch (e) { /* none */ }
    const nonce = lu && lu.searchParams.get('nonce'), port = lu && Number(lu.searchParams.get('port'));
    ok('default browser gets https://tradezoro.com/desktop-login?nonce=<43>&port=<loopback>', lu && lu.origin === 'https://tradezoro.com' && lu.pathname === '/desktop-login' && /^[A-Za-z0-9_-]{43}$/.test(nonce) && port > 1024, opened.length + ' opened, ' + (lu ? lu.pathname + ' port ' + port : 'none'));
    const waitNote = await main.evaluate(() => { const n = document.getElementById('tz-desk-wait'); return n ? n.textContent : ''; });
    ok('login page shows "We opened your web browser" while waiting', /opened your web browser/.test(waitNote), waitNote.slice(0, 80));
    await main.screenshot({ path: path.join(OUT, '02-google-waiting.png') });
    const CODE = 'C'.repeat(43);
    const hit = (p, host) => new Promise((res) => {
      const rq = require('http').request({ host: '127.0.0.1', port, path: p, method: 'GET', agent: false, headers: host ? { host } : {} }, (r) => { r.resume(); res({ status: r.statusCode, loc: r.headers.location || '' }); });
      rq.on('error', (e) => res({ status: 'error', loc: e.code })); rq.end();
    });
    const wrongHost = await hit('/done?code=' + CODE, 'evil.example:' + port);
    const wrongPath = await hit('/x?code=' + CODE);
    ok('loopback refuses wrong Host / path (404)', wrongHost.status === 404 && wrongPath.status === 404, JSON.stringify([wrongHost.status, wrongPath.status]));
    const bad = await hit('/done?code=' + CODE);   // server says 403 (code minted for another nonce): keep waiting
    ok('a code the server refuses redirects to ?failed=1 and the app keeps waiting', bad.status === 302 && /desktop-login\?failed=1$/.test(bad.loc), JSON.stringify(bad));
    await app.evaluate(() => { global.__redeemAnswer = 'ok'; });
    const good = await hit('/done?code=' + 'D'.repeat(43));
    const redeems = await app.evaluate(() => global.__redeems.slice());
    ok('the right code: redeem sent with the secret verifier (sha256 = URL nonce), browser sent to ?done=1', good.status === 302 && /desktop-login\?done=1$/.test(good.loc) && redeems.length === 2 && redeems[1].verifier && require('crypto').createHash('sha256').update(redeems[1].verifier).digest('base64url') === nonce && !('nonce' in redeems[1]) && redeems[1].code === 'D'.repeat(43), JSON.stringify(good) + ' redeems ' + redeems.length);
    await main.waitForTimeout(800);
    const ct = await main.evaluate(() => window.__ct);
    ok('page signs in with the custom token (signInWithCustomToken)', typeof ct === 'string' && ct.startsWith('header.'), String(ct).slice(0, 12));
    const closed = await hit('/done?code=' + CODE);
    ok('loopback server is closed after use', closed.status === 'error', JSON.stringify(closed));
    // Protocol fallback: tradezoro://auth?code=... arrives on a second-instance command line.
    await main.reload(); await main.waitForLoadState('load'); await main.waitForTimeout(2000);
    await main.evaluate(() => { window.__ct = null; auth.signInWithCustomToken = (t) => { window.__ct = t; return new Promise(() => {}); }; });
    await main.locator('[data-google-signin]').first().click();
    await main.waitForTimeout(1200);
    await app.evaluate(({ app }) => { app.emit('second-instance', {}, ['TradeZoro.exe', 'tradezoro://auth?code=' + 'E'.repeat(43)], process.cwd()); });
    await main.waitForTimeout(1200);
    const ct2 = await main.evaluate(() => window.__ct);
    const r2 = await app.evaluate(() => global.__redeems.slice(-1)[0]);
    ok('tradezoro://auth?code= fallback completes the sign-in too', typeof ct2 === 'string' && r2.code === 'E'.repeat(43), r2 && r2.code.slice(0, 4));
    // Cancel: the waiting note's Cancel button ends the flow and the page says so.
    await main.reload(); await main.waitForLoadState('load'); await main.waitForTimeout(2000);
    await main.locator('[data-google-signin]').first().click();
    await main.waitForTimeout(1000);
    await main.locator('#tz-desk-wait .auth-note-action').click();
    await main.waitForTimeout(800);
    const cancelMsg = await main.evaluate(() => document.getElementById('login-error').textContent);
    ok('Cancel ends the browser sign-in and says so', /cancelled/.test(cancelMsg), cancelMsg);
    await main.screenshot({ path: path.join(OUT, '02b-google-cancelled.png') });
    // Razorpay / Firebase popups still open as sandboxed in-app child windows (unchanged).
    const pay = app.waitForEvent('window', { timeout: 15000 }).catch(() => null);
    await main.evaluate(() => { window.open('https://checkout.razorpay.com/v1/checkout.js', 'rzp', 'width=500,height=600'); });
    const payWin = await pay;
    const payPrefs = payWin && await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => /razorpay/.test(x.webContents.getURL()) || x.webContents.opener);
      if (!w) return null; const p = w.webContents.getLastWebPreferences(); return { sb: p.sandbox, preload: !!p.preload, opener: !!w.webContents.opener };
    });
    ok('Razorpay checkout still opens as a sandboxed in-app popup (no preload)', payPrefs && payPrefs.sb && !payPrefs.preload && payPrefs.opener, JSON.stringify(payPrefs));
    if (payWin) await payWin.close().catch(() => {});

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
