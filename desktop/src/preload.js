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
  updateBanner();
}

// In-app update banner, drawn by the app (not the site) in a shadow root so site CSS cannot touch it.
// Main sends { kind: 'ready' | 'block', version, note, ready, canInstall } or null (src/updates.js).
// Same look as the Android banner: dark card, mint edge, 16 radius, mint pill, round X. Follows the site's
// Day/Night theme (html[data-theme="light"]).
function updateBanner() {
  const CSS = `
  :host{ all:initial; }
  .w{ --s:#131316; --l:rgba(255,255,255,.08); --t1:rgba(255,255,255,.92); --t2:rgba(255,255,255,.64); --m:#03c988; --mh:#4fe3ac; --on:#04140e; --ov:rgba(5,5,6,.92);
      font:400 15px/22px -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,system-ui,sans-serif; color:var(--t1); }
  .w.light{ --s:#ffffff; --l:rgba(0,0,0,.10); --t1:#1d1d1f; --t2:rgba(29,29,31,.66); --m:#02875c; --mh:#026e4b; --on:#ffffff; --ov:rgba(244,246,250,.94); }
  .bar{ position:fixed; z-index:2147483646; top:12px; left:50%; transform:translateX(-50%); box-sizing:border-box; width:min(560px, calc(100vw - 32px));
      display:flex; align-items:center; gap:12px; padding:12px 12px 12px 16px; background:var(--s); border:1px solid var(--l); border-left:3px solid var(--m);
      border-radius:16px; box-shadow:0 8px 24px rgba(0,0,0,.28); animation:in .2s cubic-bezier(.2,0,0,1); }
  .tx{ flex:1; min-width:0; }
  .t{ font-weight:600; font-size:15px; line-height:20px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .n{ font-size:13px; line-height:18px; color:var(--t2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  button{ font:inherit; cursor:pointer; border:0; margin:0; }
  button:focus-visible{ outline:2px solid var(--m); outline-offset:2px; }
  .p{ flex:none; height:32px; padding:0 16px; border-radius:999px; background:var(--m); color:var(--on); font-size:13px; line-height:32px; font-weight:600; white-space:nowrap; }
  .p:hover{ background:var(--mh); }
  .x{ flex:none; width:32px; height:32px; border-radius:50%; background:transparent; color:var(--t2); display:grid; place-items:center; padding:0; }
  .x:hover{ background:var(--l); color:var(--t1); }
  .x svg{ width:20px; height:20px; display:block; }
  .ov{ position:fixed; inset:0; z-index:2147483647; background:var(--ov); display:grid; place-items:center; padding:16px; box-sizing:border-box; }
  .card{ box-sizing:border-box; width:min(420px, 100%); padding:24px; background:var(--s); border:1px solid var(--l); border-top:3px solid var(--m); border-radius:16px; text-align:center; }
  .card h2{ margin:0 0 8px; font-size:22px; line-height:28px; font-weight:700; }
  .card p{ margin:0 0 24px; font-size:15px; line-height:22px; color:var(--t2); }
  .card .p{ height:48px; line-height:48px; padding:0 24px; font-size:15px; min-width:200px; }
  @keyframes in{ from{ opacity:0; transform:translate(-50%,-8px); } }
  @media (prefers-reduced-motion:reduce){ .bar{ animation:none; } }`;
  const X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  let root = null, shadow = null, last = null;
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function render(st) {
    last = st;
    if (!document.documentElement) return;
    if (!root) { root = document.createElement('tz-app-update'); shadow = root.attachShadow({ mode: 'open' }); }
    if (!st) { root.remove(); return; }
    if (!root.isConnected) document.documentElement.appendChild(root);
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    const v = esc(st.version);
    let html;
    if (st.kind === 'block') {
      const btn = st.ready ? '<button class="p" data-a="install">Restart to update</button>' : '<button class="p" data-a="download">Download the update</button>';
      const msg = st.ready ? 'Version ' + v + ' is ready. Restart TradeZoro to finish.' : (st.canInstall ? 'The new version is downloading. You can also get it from tradezoro.com.' : 'Get the newest version from tradezoro.com.');
      html = '<div class="ov" role="alertdialog" aria-modal="true" aria-labelledby="h"><div class="card"><h2 id="h">Please update to keep using TradeZoro</h2><p>' + msg + '</p>' + btn + '</div></div>';
    } else {
      html = '<div class="bar" role="status"><div class="tx"><div class="t">Update ready · v' + v + '</div>' + (st.note ? '<div class="n">' + esc(st.note) + '</div>' : '') +
        '</div><button class="p" data-a="install">Restart to update</button><button class="x" data-a="dismiss" aria-label="Close" title="Remind me next time">' + X + '</button></div>';
    }
    shadow.innerHTML = '<style>' + CSS + '</style><div class="w' + (light ? ' light' : '') + '">' + html + '</div>';
    shadow.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => ipcRenderer.send('tz:update-action', b.dataset.a)));
    if (st.kind === 'block') shadow.querySelector('.p').focus();
  }
  ipcRenderer.on('tz:update', (e, st) => render(st));
  const start = () => {
    ipcRenderer.invoke('tz:update-state').then(render).catch(() => {});
    new MutationObserver(() => { if (last) render(last); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}
