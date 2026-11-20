// Test-only preload for desktop/test/mem-main.js: the tzDesktop.onShown part of src/preload.js, on any origin (the
// local test server is not tradezoro.com, where the real preload limits itself).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tzDesktop', {
  platform: 'windows-app',
  onShown: (cb) => { if (typeof cb === 'function') ipcRenderer.on('tz:shown', (e, v) => { try { cb(v === true); } catch (x) {} }); }
});
