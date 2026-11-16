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
    toggleAlwaysOnTop: () => ipcRenderer.send('tz:ontop'),
    // Google refuses sign-in inside apps, so this opens tradezoro.com/desktop-login in the default browser and
    // resolves with { token } (a Firebase custom token) once the member has signed in there. Rejects with
    // Error('cancelled' | 'timeout' | 'failed' | 'no-browser'). The page then runs signInWithCustomToken(token).
    googleSignIn: () => ipcRenderer.invoke('tz:google').then((r) => ({ token: String(r && r.token || '') }),
      (e) => { const m = /cancelled|timeout|no-browser/.exec(String(e && e.message)); throw new Error(m ? m[0] : 'failed'); }),
    cancelGoogleSignIn: () => ipcRenderer.send('tz:google-cancel')
  });
}
