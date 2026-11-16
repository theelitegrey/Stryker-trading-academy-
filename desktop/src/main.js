// TradeZoro for Windows: main process.
// The app is a secure window onto https://tradezoro.com (every site deploy reaches the app straight away),
// plus what a browser tab cannot do: pop-out chart windows for a second monitor, always-on-top, native
// Windows notifications while the app sits in the tray, no background throttling of charts, auto-update.
//
// Security model: every window is sandboxed, contextIsolation on, nodeIntegration off. Only TradeZoro
// pages load in app windows and only they get the tiny preload bridge (src/preload.js). Sign-in and
// payment popups open as sandboxed child windows with no preload. Everything else goes to the normal
// browser (src/policy.js decides; test/policy.test.js covers it).
const { app, BrowserWindow, Menu, Tray, Notification, shell, ipcMain, screen, session, dialog, nativeImage, net } = require('electron');
const path = require('path');
const http = require('http');
const policy = require('./policy');
const handoff = require('./handoff');
const State = require('./state');

const ORIGIN = 'https://tradezoro.com';
const HOME = ORIGIN + '/dashboard-user.html';
const CHART = ORIGIN + '/charts.html';
const ICON = path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const BG = '#050506';

app.setAppUserModelId('com.tradezoro.desktop');   // Windows toasts show "TradeZoro" and the TZ icon
// Google refuses sign-in from user agents that say "Electron"; present as the Chromium it is.
app.userAgentFallback = app.userAgentFallback.replace(/\s(TradeZoro|tradezoro-desktop|Electron)\/\S+/gi, '');

if (!app.requestSingleInstanceLock()) { app.quit(); }

// tradezoro://auth?code=... brings a Google sign-in back from the browser when the loopback port could not be used.
// '--' before the URL: Chromium stops reading switches there, so a crafted link cannot inject command-line flags.
// In a dev run (electron .) Windows needs the exe + script path to relaunch us.
if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(handoff.PROTOCOL, process.execPath, [path.resolve(process.argv[1]), '--']);
else app.setAsDefaultProtocolClient(handoff.PROTOCOL, process.execPath, ['--']);

let state, tray = null, mainWin = null, quitting = false, updateReady = false, trayHintShown = false;
const charts = new Map();            // key -> BrowserWindow (pop-out windows)
const seenNotes = new Set();

// ---------- windows ----------
function webPrefs(withPreload) {
  return {
    contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    allowRunningInsecureContent: false, webviewTag: false, spellcheck: false,
    backgroundThrottling: false,     // charts keep streaming while the window is behind another one
    preload: withPreload ? path.join(__dirname, 'preload.js') : undefined
  };
}

function restoreBounds(key, def) {
  const s = state.get(key);
  if (s && State.visibleOn(s.bounds, screen.getAllDisplays())) return s;
  return { bounds: def };
}

function makeAppWindow(key, url, def) {
  const s = restoreBounds(key, def);
  const win = new BrowserWindow(Object.assign({}, s.bounds, {
    minWidth: 480, minHeight: 360, backgroundColor: BG, icon: ICON, show: false,
    autoHideMenuBar: true, title: 'TradeZoro', webPreferences: webPrefs(true)
  }));
  win.tzKey = key;
  if (s.maximized) win.maximize();
  if (s.onTop) win.setAlwaysOnTop(true, 'floating');
  win.once('ready-to-show', () => win.show());
  const remember = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    state.set(key, { maximized: win.isMaximized(), bounds: win.isMaximized() ? (state.get(key) || {}).bounds || win.getNormalBounds() : win.getBounds() });
  };
  win.on('resize', remember); win.on('move', remember); win.on('maximize', remember); win.on('unmaximize', remember);
  win.on('page-title-updated', (e, t) => { e.preventDefault(); win.setTitle(titleFor(win, t)); });
  guard(win.webContents, false);
  win.webContents.on('did-finish-load', () => watchNotifications(win));
  win.loadURL(url);
  return win;
}

function titleFor(win, t) {
  const base = (t || win.webContents.getTitle() || 'TradeZoro').replace(/\s*[|·-]\s*TradeZoro\s*$/i, '');
  return (base === 'TradeZoro' ? 'TradeZoro' : base + ' · TradeZoro') + (win.isAlwaysOnTop() ? '  (on top)' : '');
}

function createMain() {
  const wa = screen.getPrimaryDisplay().workArea;
  mainWin = makeAppWindow('main', HOME, { width: Math.min(1440, wa.width), height: Math.min(900, wa.height) });
  // Close = hide to the tray, so alerts keep arriving. Quit from the tray or File menu.
  mainWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); mainWin.hide();
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true;
      new Notification({ title: 'TradeZoro is still running', body: 'Alerts keep coming. Open or quit it from the tray icon.', icon: ICON, silent: true }).show();
    }
  });
  mainWin.webContents.on('did-finish-load', () => sendSignedOutToLogin(mainWin));
}

// Dashboard opened while signed out: go straight to sign-in instead of the "couldn't confirm" notice.
function sendSignedOutToLogin(win) {
  const u = win.webContents.getURL();
  if (!/^https:\/\/(www\.)?tradezoro\.com\/dashboard-user(\.html)?(\?|$)/.test(u)) return;
  win.webContents.executeJavaScript(`new Promise((done) => {
    if (!window.firebase || !firebase.auth) return done(true);
    const off = firebase.auth().onAuthStateChanged((u) => { off(); if (u) return done(true);
      setTimeout(() => done(!!firebase.auth().currentUser), 1500); });
  })`, true).then((signedIn) => {
    if (!signedIn && !win.isDestroyed() && win.webContents.getURL() === u) win.loadURL(ORIGIN + '/login.html');
  }).catch(() => {});
}

function nextChartKey() {
  for (let i = 1; ; i++) if (!charts.has('chart-' + i)) return 'chart-' + i;
}

function openChartWindow(url, key) {
  url = policy.isAppUrl(url) ? url : CHART;
  key = key || nextChartKey();
  const wa = screen.getPrimaryDisplay().workArea;
  const n = charts.size;
  const win = makeAppWindow(key, url, { width: Math.min(1280, wa.width), height: Math.min(800, wa.height), x: wa.x + 60 + n * 32, y: wa.y + 60 + n * 32 });
  charts.set(key, win);
  const saveOpen = () => state.setOpenCharts([...charts].map(([k, w]) => ({ key: k, url: w.isDestroyed() ? CHART : w.webContents.getURL() })));
  win.webContents.on('did-navigate', saveOpen); win.webContents.on('did-navigate-in-page', saveOpen);
  win.on('closed', () => { charts.delete(key); if (!quitting) saveOpen(); });
  saveOpen();
  return win;
}

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) createMain();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
}

function toggleOnTop(win) {
  if (!win || win.isDestroyed()) return;
  const on = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(on, 'floating');
  state.set(win.tzKey, { onTop: on });
  win.setTitle(titleFor(win));
  buildMenu();
}

// ---------- navigation guard (all windows) ----------
function openExternal(url) {
  if (policy.classify(url) === 'external') shell.openExternal(url).catch(() => {});
}

function guard(wc, isPopup) {
  const allowed = isPopup ? policy.mayNavigatePopup : policy.mayNavigateAppWindow;
  const onNav = (e, url) => {
    if (allowed(url)) return;
    e.preventDefault();
    openExternal(url);
  };
  wc.on('will-navigate', onNav);
  wc.on('will-redirect', (e, url, inPlace, isMainFrame) => { if (isMainFrame !== false) onNav(e, url); });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  // Sign-in / payment popups opened from this window get the popup rules (and no preload).
  wc.on('did-create-window', (child) => { child.setMenuBarVisibility(false); guard(child.webContents, true); });
  wc.setWindowOpenHandler(({ url }) => {
    const kind = policy.classify(url);
    if (kind === 'app' && !isPopup) { openChartWindow(url); return { action: 'deny' }; }
    if (kind === 'popup' || kind === 'oauth' || (kind === 'app' && isPopup)) {
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 520, height: 680, backgroundColor: '#ffffff', icon: ICON, autoHideMenuBar: true,
        webPreferences: webPrefs(false) } };
    }
    openExternal(url);
    return { action: 'deny' };
  });
}

// ---------- notifications (site bell -> Windows toast) ----------
// Site alerts are documents in the Firestore notifications collection (a Cloud Function turns each one into a
// browser push). Electron has no browser push service, so instead every TradeZoro window listens to the same
// collection with the page's own signed-in Firebase session and hands NEW unread ones to main (deduped by id).
// Runs in the page, same query shape as assets/notifications.js, so the live security rules allow it.
const WATCH_JS = `(() => {
  if (window.__tzDeskNotes || !window.tzDesktop || !window.firebase || !firebase.auth || !firebase.firestore || !firebase.apps.length) return false;
  window.__tzDeskNotes = true;
  let unsub = null;
  firebase.auth().onAuthStateChanged((u) => {
    if (unsub) { unsub(); unsub = null; }
    if (!u) return;
    let first = true;
    unsub = firebase.firestore().collection('notifications').where('recipientUid', '==', u.uid).where('read', '==', false).limit(30)
      .onSnapshot((snap) => {
        if (first) { first = false; return; }   // what was already there when the page opened is not new
        snap.docChanges().forEach((c) => {
          if (c.type !== 'added') return;
          const d = c.doc.data() || {};
          window.tzDesktop.notify({ id: c.doc.id, title: d.type === 'chart_alert' ? 'TradeZoro alert' : 'TradeZoro', body: d.message || 'You have a new notification', link: d.link || '' });
        });
      }, () => {});
  });
  return true;
})()`;
function watchNotifications(win) {
  if (!win.isDestroyed() && policy.isAppUrl(win.webContents.getURL())) win.webContents.executeJavaScript(WATCH_JS, true).catch(() => {});
}

ipcMain.on('tz:notify', (e, n) => {
  if (!policy.isAppUrl(e.senderFrame && e.senderFrame.url) || !Notification.isSupported()) return;
  if (!n || !n.id || seenNotes.has(n.id)) return;
  seenNotes.add(n.id);
  const note = new Notification({ title: n.title || 'TradeZoro', body: n.body || '', icon: ICON });
  note.on('click', () => {
    showMain();
    const link = n.link ? new URL(n.link, ORIGIN).href : null;
    if (link && policy.isAppUrl(link)) mainWin.loadURL(link);
  });
  note.show();
});

ipcMain.on('tz:popout', (e, p) => {
  if (!policy.isAppUrl(e.senderFrame && e.senderFrame.url)) return;
  let url = CHART;
  try { url = new URL(p || '/charts.html', ORIGIN).href; } catch (err) { /* default */ }
  openChartWindow(url);
});

ipcMain.on('tz:ontop', (e) => {
  if (policy.isAppUrl(e.senderFrame && e.senderFrame.url)) toggleOnTop(BrowserWindow.fromWebContents(e.sender));
});

// ---------- Google sign-in in the system browser (src/handoff.js explains the flow) ----------
// Google blocks OAuth in embedded browsers, so the app never shows Google's sign-in itself. One flow at a time;
// starting a new one cancels the old. The custom token goes back only to the page that asked for it.
let gFlow = null;
function endFlow(flow, err, token) {
  if (!flow || flow.done) return;
  flow.done = true;
  clearTimeout(flow.timer);
  if (flow.server) {   // stop listening now; give the in-flight reply (the browser's redirect) a moment, then drop the rest
    const srv = flow.server;
    try { srv.close(); } catch (e) { /* already closed */ }
    setTimeout(() => { try { srv.closeAllConnections(); } catch (e) { /* gone */ } }, 2000).unref();
  }
  if (gFlow === flow) gFlow = null;
  if (err) flow.reject(new Error(err)); else flow.resolve({ token });
}

async function redeemCode(flow, code) {
  if (!flow || flow.done || flow.busy) return false;
  flow.busy = true;
  try {
    const r = await net.fetch(handoff.ORIGIN + '/api/desktop/handoff/redeem', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, verifier: flow.verifier }),
      credentials: 'omit', cache: 'no-store', redirect: 'error'
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && typeof j.token === 'string' && j.token.length > 20 && j.token.length < 8192) {
      endFlow(flow, null, j.token);
      if (flow.win && !flow.win.isDestroyed()) { if (flow.win.isMinimized()) flow.win.restore(); flow.win.show(); flow.win.focus(); }
      return true;
    }
    // A code that is not ours (403: minted for another nonce) or already spent: keep waiting for the real one,
    // but give up after a few, so a hostile page cannot keep the flow busy.
    if (++flow.bad >= handoff.MAX_BAD_CODES) endFlow(flow, 'failed');
    return false;
  } catch (e) {
    if (++flow.bad >= handoff.MAX_BAD_CODES) endFlow(flow, 'failed');
    return false;
  } finally { flow.busy = false; }
}

function startLoopback(flow) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const code = flow.port && !flow.done ? handoff.codeFromLoopback(req.method, req.url, req.headers.host, flow.port) : null;
      if (!code) { res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); return res.end('Not found'); }
      redeemCode(flow, code).then((ok) => {
        res.writeHead(302, { location: handoff.afterUrl(ok), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', connection: 'close' });
        res.end();
      });
    });
    srv.on('error', () => resolve(null));
    srv.listen(0, '127.0.0.1', () => { flow.server = srv; flow.port = srv.address().port; resolve(flow.port); });
  });
}

ipcMain.handle('tz:google', async (e) => {
  if (!e.senderFrame || e.senderFrame !== e.sender.mainFrame || !policy.isAppUrl(e.senderFrame.url)) throw new Error('not allowed');
  if (gFlow) endFlow(gFlow, 'cancelled');
  const pair = handoff.makePair();
  const flow = { verifier: pair.verifier, challenge: pair.challenge, bad: 0, done: false, busy: false, win: BrowserWindow.fromWebContents(e.sender), sender: e.sender };
  const p = new Promise((resolve, reject) => { flow.resolve = resolve; flow.reject = reject; });
  gFlow = flow;
  flow.timer = setTimeout(() => endFlow(flow, 'timeout'), handoff.FLOW_TTL_MS);
  e.sender.once('destroyed', () => endFlow(flow, 'cancelled'));
  const port = await startLoopback(flow);   // null -> the page comes back through tradezoro://auth instead
  try { await shell.openExternal(handoff.loginUrl(flow.challenge, port)); } catch (err) { endFlow(flow, 'no-browser'); }
  return p.catch((err) => { throw new Error(err.message); });
});

ipcMain.on('tz:google-cancel', (e) => {
  if (gFlow && gFlow.sender === e.sender) endFlow(gFlow, 'cancelled');
});

function handleProtocolUrl(url) {
  const code = handoff.codeFromProtocolUrl(url);
  if (code && gFlow) redeemCode(gFlow, code);
}

// ---------- menu, shortcuts, tray ----------
function focused() { return BrowserWindow.getFocusedWindow() || mainWin; }

function popOutCurrent() {
  const w = focused();
  const u = w && !w.isDestroyed() ? w.webContents.getURL() : '';
  openChartWindow(policy.isAppUrl(u) ? u : CHART);
}

function buildMenu() {
  const w = focused();
  const template = [
    { label: 'File', submenu: [
      { label: 'New chart window', accelerator: 'CmdOrCtrl+Shift+N', click: () => openChartWindow(CHART) },
      { label: 'Pop out this page', accelerator: 'CmdOrCtrl+Shift+P', click: popOutCurrent },
      { type: 'separator' },
      { label: 'Dashboard', accelerator: 'CmdOrCtrl+Shift+H', click: () => { showMain(); mainWin.loadURL(HOME); } },
      { type: 'separator' },
      { label: 'Quit TradeZoro', accelerator: 'CmdOrCtrl+Q', click: quit }
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [
      { role: 'reload', accelerator: 'CmdOrCtrl+R' },
      { role: 'forceReload', accelerator: 'CmdOrCtrl+Shift+R' },
      { label: 'Back', accelerator: 'Alt+Left', click: () => { const f = focused(); if (f && f.webContents.navigationHistory.canGoBack()) f.webContents.navigationHistory.goBack(); } },
      { type: 'separator' },
      { label: 'Always on top', type: 'checkbox', accelerator: 'CmdOrCtrl+Shift+T', checked: !!(w && !w.isDestroyed() && w.isAlwaysOnTop()), click: () => toggleOnTop(focused()) },
      { role: 'togglefullscreen', accelerator: 'F11' },
      { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }
    ] },
    { label: 'Help', submenu: [
      { label: 'Help Center', click: () => shell.openExternal(ORIGIN + '/help') },
      { label: 'Check for updates', click: () => checkUpdates(true) },
      { label: 'About TradeZoro', click: () => dialog.showMessageBox({ type: 'info', title: 'TradeZoro', icon: ICON,
        message: 'TradeZoro for Windows ' + app.getVersion(), detail: 'Education only. Not financial advice.' }) }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  if (tray) tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open TradeZoro', click: showMain },
    { label: 'New chart window', click: () => openChartWindow(CHART) },
    ...(updateReady ? [{ label: 'Restart to update', click: installUpdate }] : []),
    { type: 'separator' },
    { label: 'Quit', click: quit }
  ]));
}

function createTray() {
  const img = nativeImage.createFromPath(ICON);
  tray = new Tray(process.platform === 'win32' ? img : img.resize({ width: 22, height: 22 }));
  tray.setToolTip('TradeZoro');
  tray.on('click', showMain);
  tray.on('double-click', showMain);
}

function quit() { quitting = true; app.quit(); }

// ---------- auto-update (GitHub Releases, tag desktop-v*) ----------
let autoUpdater = null;
function setupUpdates() {
  // Portable .exe cannot self-update, and a dev run has no release feed.
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;     // a downloaded update installs the next time the app quits
  autoUpdater.on('error', (err) => console.warn('update check failed:', err && err.message));
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true; buildMenu();
    // Never restart on our own. Inside market hours: only a quiet note. Outside: ask.
    if (policy.isMarketHours(new Date())) {
      if (Notification.isSupported()) new Notification({ title: 'TradeZoro update ready', body: 'Version ' + info.version + ' installs when you quit, or choose Restart to update in the tray.', icon: ICON, silent: true }).show();
      return;
    }
    dialog.showMessageBox({ type: 'info', icon: ICON, buttons: ['Restart now', 'Later'], defaultId: 1, cancelId: 1,
      title: 'Update ready', message: 'TradeZoro ' + info.version + ' is ready.', detail: 'Restart now, or it installs the next time you quit.' })
      .then((r) => { if (r.response === 0) installUpdate(); });
  });
  checkUpdates(false);
  setInterval(() => checkUpdates(false), 4 * 60 * 60 * 1000);
}

function checkUpdates(manual) {
  if (!autoUpdater) {
    if (manual) dialog.showMessageBox({ type: 'info', icon: ICON, message: process.env.PORTABLE_EXECUTABLE_DIR ? 'The portable version does not update itself.' : 'Updates are only checked in the installed app.',
      detail: process.env.PORTABLE_EXECUTABLE_DIR ? 'Download the newest version from tradezoro.com/download.' : '' });
    return;
  }
  autoUpdater.checkForUpdates().then((r) => {
    if (manual && (!r || !r.isUpdateAvailable)) dialog.showMessageBox({ type: 'info', icon: ICON, message: 'You have the latest version (' + app.getVersion() + ').' });
  }).catch(() => { if (manual) dialog.showMessageBox({ type: 'warning', icon: ICON, message: 'Could not check for updates. Try again later.' }); });
}

function installUpdate() { quitting = true; autoUpdater && autoUpdater.quitAndInstall(false, true); }

// ---------- start ----------
app.on('second-instance', (e, argv) => {
  const u = handoff.protocolArg(argv);
  if (u) handleProtocolUrl(u);
  showMain();
});
app.on('open-url', (e, url) => { e.preventDefault(); handleProtocolUrl(url); });   // macOS form of the same
app.on('before-quit', () => { quitting = true; state && state.flush(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && quitting) app.quit(); });
app.on('browser-window-focus', () => buildMenu());

app.whenReady().then(() => {
  state = State.create(app.getPath('userData'));
  // Permissions: TradeZoro pages may show notifications, go full screen, write the clipboard and reach the
  // Data Bridge on 127.0.0.1. Nothing else, and nothing for any other site.
  const OK = new Set(['notifications', 'fullscreen', 'clipboard-sanitized-write', 'local-network-access', 'loopback-network', 'local-network']);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(OK.has(perm) && policy.isAppUrl(details.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((wc, perm, origin) => OK.has(perm) && policy.isAppUrl(origin));
  createTray();
  createMain();
  for (const c of state.openCharts()) if (c && c.key) openChartWindow(c.url, c.key);
  buildMenu();
  setupUpdates();
});

