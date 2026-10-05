// Stryker Trading Academy — Charts "Connect broker" sheet + Rithmic status chip (ES module)
// Depends on: assets/rithmic-client.js (RithmicClient, listSystems), assets/rithmic-provider.js
// (RithmicFuturesProvider). Loaded ONLY by assets/rithmic-config.js when the Rithmic flag is
// on for this member; with the flag off (everyone today) this file is never downloaded.
//
// Its CSS is injected from here (not assets/style.css) so the feature stays fully contained
// in its own files until it launches. Scroll regions inherit the shared thin scrollbar.
//
// PRIVACY: the form never submits anywhere (no action, submit is intercepted). The password
// is read from the input once, handed to the in-memory client, and the input is cleared.
// "Remember username" stores the username + system name in localStorage; never the password.

import { RithmicClient, listSystems } from './rithmic-client.js?v=407';
import { RithmicFuturesProvider } from './rithmic-provider.js?v=407';

const LS_USER = 'stryker_rithmic_user';
const LS_SYS = 'stryker_rithmic_system';

const CSS = `
.stkr-chip{ display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 9px; border-radius:999px;
  border:1px solid rgba(3,201,136,.45); color:var(--gold); font:600 11.5px/1 inherit; font-family:inherit; white-space:nowrap; }
.stkr-chip[hidden]{ display:none; }
.stkr-chip i{ width:7px; height:7px; border-radius:50%; background:currentColor; box-shadow:0 0 0 3px rgba(3,201,136,.18); }
.stkr-chip.warn{ color:var(--amber, #e8b04a); border-color:rgba(232,176,74,.45); }
.stkr-chip.warn i{ box-shadow:0 0 0 3px rgba(232,176,74,.18); }
.stkr-pop{ width:340px; padding:12px; }
.stkr-pop h3{ margin:0 0 10px; font-size:14px; color:var(--ink-0); }
.stkr-brokers{ display:flex; gap:6px; margin:0 0 10px; }
.stkr-broker{ flex:1; display:flex; flex-direction:column; align-items:flex-start; gap:2px; padding:8px 10px; border:1px solid var(--line);
  border-radius:8px; background:transparent; color:var(--ink-1); font:600 12.5px/1.2 inherit; font-family:inherit; text-align:left; cursor:pointer; }
.stkr-broker[aria-checked="true"]{ border-color:var(--gold); color:var(--ink-0); }
.stkr-broker:disabled{ opacity:.45; cursor:not-allowed; }
.stkr-broker small{ font-weight:500; font-size:10.5px; color:var(--ink-3); }
.stkr-f{ display:block; margin:0 0 9px; }
.stkr-f > span{ display:block; margin:0 0 4px; font-size:11px; font-weight:600; color:var(--ink-2); }
.stkr-f .stkc-in{ width:100%; height:34px; box-sizing:border-box; }
.stkr-f select.stkc-in{ padding-right:6px; }
.stkr-row{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin:2px 0 10px; }
.stkr-row .stkc-check{ padding:0; font-size:12px; color:var(--ink-2); }
.stkr-go{ width:100%; height:36px; }
.stkr-note{ margin:10px 0 0 !important; padding-top:10px; border-top:1px solid var(--line-soft, var(--line));
  font-size:11.5px; line-height:1.5; color:var(--ink-2); }
.stkr-err{ color:var(--amber, #e8b04a); font-size:12px; margin:0 0 8px !important; }
.stkr-err[hidden]{ display:none; }
.stkr-on p{ font-size:12.5px; color:var(--ink-1); }
.stkr-on b{ color:var(--ink-0); }
.stkr-off{ width:100%; height:34px; margin-top:4px; border:1px solid var(--line); border-radius:6px; background:transparent;
  color:var(--ink-0); font:600 12.5px/1 inherit; font-family:inherit; cursor:pointer; }
.stkr-off:hover{ border-color:var(--red, #e5484d); color:var(--red, #e5484d); }
@media (max-width:700px){
  .stkr-pop{ width:auto; }
  .stkr-f .stkc-in{ height:40px; font-size:16px; }
  .stkr-go, .stkr-off{ height:42px; }
}
`;

function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'text') n.textContent = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} };
const toast = (m, type) => { try { if (window.showToast) window.showToast(type || 'success', m); } catch (e) {} };

export function createRithmic(cfg) {
  const client = new RithmicClient(cfg);
  let ws = null;
  let Core = null;
  let lastSource = null;

  // Test/debug handle: connection state only. Never exposes credentials.
  const api = window.STRYKER_RITHMIC = {
    get state() { return client.state; },
    get system() { return client.systemName; },
    get gateway() { return cfg.gateway; },
    get appName() { return cfg.appName; },
    get appVersion() { return cfg.appVersion; },
    get lastSource() { return lastSource; },
    disconnect: () => client.disconnect(),
    reloadCharts: () => reloadCells()
  };

  const providerFactory = (FuturesProvider) => () => new RithmicFuturesProvider(client, new FuturesProvider(), cfg, {
    onSource: (src) => { lastSource = src; },
    onFallback: () => { lastSource = 'standard'; },
    onError: (e) => { console.warn('Stryker Rithmic:', e && e.message); }
  });

  // Make every chart re-read its bars from the source that is current now.
  async function reloadCells() {
    if (!ws) return;
    try { if (Core && Core.sharedBarStore) Core.sharedBarStore.clear(); } catch (e) {}
    let cells = [];
    try { cells = ws.context().cells; } catch (e) {}
    for (const c of cells) {
      if (!/^futures:/i.test(c.symbol || '') && !/^[A-Z0-9]+1!$/i.test(c.symbol || '')) continue;
      try {
        const tf = c.timeframe;
        const alt = tf === '1' ? '5' : '1';
        // Vela reloads only on an identity change: flip the timeframe and straight back.
        // The first switch is superseded at once (Vela resolves it silently).
        c.chart.setMarket({ timeframe: alt }).catch(() => {});
        await c.chart.setMarket({ timeframe: tf });
      } catch (e) { console.warn('Stryker Rithmic: reload', e); }
    }
  }

  function mount(workspace, CoreMod) {
    ws = workspace;
    Core = CoreMod;
    if (!document.getElementById('stkr-css')) document.head.appendChild(el('style', { id: 'stkr-css', text: CSS }));
    const barR = document.querySelector('.stkc-bar-r');
    if (!barR) return;

    const chip = el('span', { class: 'stkr-chip', id: 'stkr-chip', role: 'status', hidden: true });
    const btn = el('button', { type: 'button', class: 'stkc-btn', id: 'stkr-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Connect broker',
      html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/></svg><span class="stkc-btn-l">Connect broker</span>' });
    const pop = el('div', { class: 'stkc-pop stkr-pop', id: 'stkr-pop', role: 'dialog', 'aria-label': 'Connect broker', hidden: true });
    const wrap = el('div', { class: 'stkc-menu' }, [btn, pop]);
    barR.insertBefore(wrap, barR.firstChild);
    barR.insertBefore(chip, wrap);

    // ---- the sheet ----
    const err = el('p', { class: 'stkr-err', role: 'alert', hidden: true });
    const brokerR = el('button', { type: 'button', class: 'stkr-broker', role: 'radio', 'aria-checked': 'true', html: 'Rithmic<small>Apex, TradeSea, Tradeify and more</small>' });
    const brokerT = el('button', { type: 'button', class: 'stkr-broker', role: 'radio', 'aria-checked': 'false', disabled: true, html: 'Tradovate<small>Coming soon</small>' });
    const sys = el('select', { class: 'stkc-in', id: 'stkr-sys', required: true, 'aria-label': 'Rithmic system' });
    const user = el('input', { class: 'stkc-in', id: 'stkr-user', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
    const pass = el('input', { class: 'stkc-in', id: 'stkr-pass', type: 'password', autocomplete: 'current-password', required: true });
    const remember = el('input', { type: 'checkbox', id: 'stkr-remember' });
    const go = el('button', { type: 'submit', class: 'stkc-sbtn stkr-go', id: 'stkr-go', text: 'Connect' });
    const form = el('form', { class: 'stkr-form', id: 'stkr-form', novalidate: true }, [
      el('h3', { text: 'Connect broker' }),
      el('div', { class: 'stkr-brokers', role: 'radiogroup', 'aria-label': 'Broker' }, [brokerR, brokerT]),
      err,
      el('label', { class: 'stkr-f' }, [el('span', { text: 'System' }), sys]),
      el('label', { class: 'stkr-f' }, [el('span', { text: 'Rithmic username' }), user]),
      el('label', { class: 'stkr-f' }, [el('span', { text: 'Password' }), pass]),
      el('div', { class: 'stkr-row' }, [el('label', { class: 'stkc-check' }, [remember, el('span', { text: 'Remember username' })])]),
      go,
      el('p', { class: 'stkr-note', text: 'Your login goes straight from your browser to Rithmic. Stryker never sees or stores your password. Live prices come from your own Rithmic data subscription.' })
    ]);
    const onInfo = el('p', {});
    const off = el('button', { type: 'button', class: 'stkr-off', id: 'stkr-off', text: 'Disconnect' });
    const onView = el('div', { class: 'stkr-on', hidden: true }, [el('h3', { text: 'Rithmic' }), onInfo, off,
      el('p', { class: 'stkr-note', text: 'Futures charts (NQ, ES, GC, CL ...) now use your Rithmic data. Disconnect to go back to the standard data.' })]);
    pop.appendChild(form);
    pop.appendChild(onView);
    form.addEventListener('submit', (e) => { e.preventDefault(); e.stopPropagation(); doConnect(); });

    const savedUser = lsGet(LS_USER);
    if (savedUser) { user.value = savedUser; remember.checked = true; }

    let systemsLoaded = false;
    async function loadSystems() {
      if (systemsLoaded) return;
      sys.innerHTML = '';
      sys.appendChild(el('option', { value: '', text: 'Loading systems...' }));
      try {
        const names = await listSystems(cfg.gateway);
        systemsLoaded = true;
        sys.innerHTML = '';
        sys.appendChild(el('option', { value: '', text: 'Choose your system' }));
        const want = lsGet(LS_SYS);
        names.forEach((n) => sys.appendChild(el('option', { value: n, text: n, selected: n === want })));
        if (names.length === 1) sys.value = names[0];
      } catch (e) {
        sys.innerHTML = '';
        sys.appendChild(el('option', { value: '', text: 'Could not load systems' }));
        showErr('Could not reach Rithmic to list systems. Check your connection and try again.');
      }
    }

    function showErr(m) { err.textContent = m || ''; err.hidden = !m; }

    async function doConnect() {
      showErr('');
      const u = user.value.trim();
      const p = pass.value;
      const s = sys.value;
      if (!s) { showErr('Choose your Rithmic system (your prop firm or broker).'); return; }
      if (!u || !p) { showErr('Enter your Rithmic username and password.'); return; }
      go.disabled = true; go.textContent = 'Connecting...';
      pass.value = ''; // the client holds it in memory from here
      lsSet(LS_USER, remember.checked ? u : '');
      lsSet(LS_SYS, remember.checked ? s : '');
      try {
        await client.connect({ user: u, password: p, systemName: s });
        toast('Connected to Rithmic');
        setOpen(false);
      } catch (e) {
        showErr('Rithmic refused the login: ' + ((e && e.message) || 'unknown error') + '. Check the system, username and password.');
      } finally {
        go.disabled = false; go.textContent = 'Connect';
      }
    }
    off.addEventListener('click', async () => { await client.disconnect(); toast('Disconnected from Rithmic'); setOpen(false); });

    // popover open/close (same behaviour as the other toolbar menus)
    function setOpen(open) {
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { render(); if (!client.connected) { loadSystems(); setTimeout(() => (user.value ? pass : user).focus(), 30); } }
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = pop.hidden;
      document.querySelectorAll('.stkc-pop').forEach((p) => { if (p !== pop && !p.hidden) p.hidden = true; });
      setOpen(open);
    });
    pop.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { if (!pop.hidden) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) setOpen(false); });

    function render() {
      const st = client.state;
      const on = st === 'connected' || st === 'reconnecting';
      form.hidden = on;
      onView.hidden = !on;
      onInfo.innerHTML = '';
      onInfo.appendChild(document.createTextNode(st === 'connected' ? 'Connected to ' : 'Reconnecting to '));
      onInfo.appendChild(el('b', { text: client.systemName || 'Rithmic' }));
      onInfo.appendChild(document.createTextNode('.'));
      chip.hidden = !on;
      chip.className = 'stkr-chip' + (st === 'reconnecting' ? ' warn' : '');
      chip.innerHTML = '';
      chip.appendChild(el('i', { 'aria-hidden': 'true' }));
      chip.appendChild(document.createTextNode(st === 'connected' ? 'Rithmic · connected' : 'Rithmic · reconnecting'));
      btn.querySelector('.stkc-btn-l').textContent = on ? 'Broker' : 'Connect broker';
      btn.title = on ? 'Broker connection' : 'Connect broker';
      // The source line under the chart names the data source: keep it truthful.
      const credit = document.querySelector('.stkchart-credit');
      if (credit) {
        if (!credit.dataset.std) credit.dataset.std = credit.textContent;
        credit.textContent = st === 'connected'
          ? 'Futures: live from your own Rithmic connection (' + (client.systemName || 'Rithmic') + ') · crypto: public Binance, Coinbase and Hyperliquid feeds · Education only. Not financial advice.'
          : credit.dataset.std;
      }
    }

    let prevLive = false;
    client.on((ev) => {
      if (ev.type !== 'state') return;
      render();
      const live = ev.state === 'connected';
      if (ev.state === 'error' && ev.message && /ended the session/.test(ev.message)) toast(ev.message, 'error');
      // Source flipped (connected -> fallback or back): reload the futures charts.
      if (live !== prevLive && (ev.state === 'connected' || ev.state === 'reconnecting' || ev.state === 'idle' || ev.state === 'error')) {
        prevLive = live;
        reloadCells();
      }
    });
    window.addEventListener('pagehide', () => { client.disconnect(true); });
    render();
  }

  return { client, providerFactory, mount, api };
}
