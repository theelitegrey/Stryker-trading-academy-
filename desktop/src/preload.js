// TradeZoro desktop preload. Runs sandboxed in an isolated world: the page never sees Node or ipcRenderer,
// only the small window.tzDesktop object below, and only on tradezoro.com pages.
const { contextBridge, ipcRenderer } = require('electron');

const host = location.hostname;
if (location.protocol === 'https:' && (host === 'tradezoro.com' || host === 'www.tradezoro.com')) {
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  contextBridge.exposeInMainWorld('tzDesktop', {
    platform: 'windows-app',
    // assets/notifications.js calls this for each new bell notification; main shows a native Windows toast.
    notify: (n) => ipcRenderer.send('tz:notify', {
      id: str(n && n.id, 200), title: str(n && n.title, 120), body: str(n && n.body, 400), link: str(n && n.link, 500)
    }),
    // Open a page (default: the chart) in its own window, e.g. to drag it to a second monitor.
    popOut: (path) => ipcRenderer.send('tz:popout', str(path, 500)),
    toggleAlwaysOnTop: () => ipcRenderer.send('tz:ontop')
  });
}
