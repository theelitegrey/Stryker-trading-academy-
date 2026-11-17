// TradeZoro — "Connect your AI" popup on the chart (Owner order 16 Nov 2026: no page change when clicking AI).
// Centred dialog on desktop, bottom sheet on phones. Reuses assets/ai-connect.js (setup steps + AI apps / personal tokens),
// which is loaded on first open. Status + Pause/Resume/Disconnect come from assets/chart-ai-agent.js via `ctl`.
// OAuth consent (/ai/consent) stays a full page: an AI app sends the member there, nothing here touches it.
const SRC = '/assets/ai-connect.js?v=1096';
let box = null;

function loadAic() {
  if (window.STRYKER_AIC) return Promise.resolve(window.STRYKER_AIC);
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = SRC;
    s.onload = () => (window.STRYKER_AIC ? res(window.STRYKER_AIC) : rej(new Error('ai-connect')));
    s.onerror = () => rej(new Error('ai-connect load'));
    document.head.appendChild(s);
  });
}

export async function openAiPopup(ctl) {
  if (box) return;
  const aic = await loadAic();
  const root = document.createElement('div');
  root.className = 'stkaip'; box = root;
  root.innerHTML = '<div class="stkaip-box" role="dialog" aria-modal="true" aria-labelledby="stkaip-h" tabindex="-1">' +
    '<span class="stkaip-grab" aria-hidden="true"></span>' +
    '<div class="stkaip-head"><h2 id="stkaip-h">Connect your AI</h2><button type="button" class="stkaip-x" aria-label="Close">' +
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
    '<div class="stkaip-body">' +
    '<section class="stkaip-sec" id="stkaip-status" aria-live="polite"></section>' +
    '<section class="stkaip-sec"><h3 class="aic-h2">Add it to your AI app</h3><p class="aic-note">Add TradeZoro to your AI app with this address, then sign in when it asks. Your AI works on your open chart. It can never place trades.</p><div id="stkaip-url"></div><div class="stkaip-folds" id="stkaip-clients"></div></section>' +
    '<div class="stkaip-agents" id="stkaip-agents"></div>' +
    '<p class="aic-note stkaip-foot">Education only. Not financial advice.</p></div></div>';
  document.body.appendChild(root);
  const dlg = root.querySelector('.stkaip-box');
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';

  // status
  const st = root.querySelector('#stkaip-status');
  function paint() {
    const s = ctl.status();
    const dot = s.on ? (s.paused ? 'paused' : 'on') : 'off';
    const text = s.on ? (s.paused ? 'Paused' : 'Connected') : (s.off ? 'Turned off in this tab' : 'Not connected');
    const sub = s.on ? (s.paused ? 'Your AI is told to wait. Resume when you are ready.' : 'Connected: ' + s.names.join(', ') + '. Every action shows a message on the chart.')
      : (s.off ? 'Your AI cannot reach this chart until you turn it on.' : 'Add an AI app below, or make a personal token.');
    const btn = (a, l, c) => '<button type="button" class="btn ' + (c || 'btn-ghost') + ' aic-btn aic-btn-sm" data-a="' + a + '">' + l + '</button>';
    st.innerHTML = '<div class="stkaip-st"><span class="stkaip-dot ' + dot + '" aria-hidden="true"></span><div class="stkaip-st-t"><b>' + text + '</b><span>' + sub.replace(/[<>&]/g, '') + '</span></div></div>' +
      '<div class="stkaip-acts">' + (s.on ? btn('pause', s.paused ? 'Resume' : 'Pause') + btn('off', 'Disconnect') : (s.off ? btn('on', 'Turn on', 'btn-primary') : '')) + '</div>';
  }
  st.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    ({ pause: ctl.togglePause, off: ctl.turnOff, on: ctl.turnOn })[b.dataset.a]();
    setTimeout(paint, 50);
  });
  ctl.bind(paint); paint();

  // setup steps
  root.querySelector('#stkaip-url').innerHTML = '<div class="aic-copy"><code class="aic-code" tabindex="0">' + aic.MCP + '</code><button type="button" class="aic-copy-b" data-copy="' + aic.MCP + '" aria-label="Copy connector address"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg><span class="aic-copy-l">Copy</span></button></div>';
  aic.renderClients(root.querySelector('#stkaip-clients'), true);

  // AI apps + personal tokens (needs sign-in)
  const ag = root.querySelector('#stkaip-agents');
  aic.whenAuth().then((u) => {
    if (!box) return;
    if (!u) { ag.innerHTML = '<section class="aic-card"><p class="aic-note">Sign in to see your AI apps and make a personal token.</p><div class="aic-actions"><a class="btn btn-primary aic-btn aic-btn-sm" href="/login">Sign in</a></div></section>'; return; }
    ag.innerHTML = aic.AGENTS_HTML;
    aic.mountAgents(ag, { onChange: ctl.onChange });
  });

  // close, focus trap
  function close() {
    if (!box) return;
    ctl.bind(null); document.removeEventListener('keydown', onKey, true);
    root.remove(); box = null; document.documentElement.style.overflow = prevOverflow;
    try { ctl.opener && ctl.opener.isConnected && ctl.opener.offsetParent && ctl.opener.focus(); } catch (e) {}
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...dlg.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,summary,[tabindex="0"]')].filter((n) => n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!dlg.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  root.querySelector('.stkaip-x').addEventListener('click', close);
  root.querySelector('.stkaip-x').focus();
}
