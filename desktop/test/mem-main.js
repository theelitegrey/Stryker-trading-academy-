// Test-only Electron entry (never packaged: package.json "files" ships src/ only). Opens ONE window with the same
// webPreferences main.js gives app windows and the same hidden/shown reporting (src/shown.js), on TZ_URL, so
// tools/tests/desktop-gk-memory.js can measure the member's chart layout inside the real Electron runtime.
// No tray, no updater, no sign-in. TZ_SHOWN=0 leaves the hidden/shown reporting out (the build before the fix).
const path = require('path');
const { app, BrowserWindow } = require('electron');
const reportShown = require('../src/shown');

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: +(process.env.TZ_W || 1920), height: +(process.env.TZ_H || 1080), show: true, backgroundColor: '#050506',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, backgroundThrottling: false,
      preload: path.join(__dirname, 'mem-preload.js') } });
  if (process.env.TZ_SHOWN !== '0') reportShown(win);
  win.loadURL(process.env.TZ_URL || 'about:blank');
});
