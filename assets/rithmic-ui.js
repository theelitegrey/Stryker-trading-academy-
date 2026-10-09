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

import { RithmicClient, listSystems } from './rithmic-client.js?v=475';
import { RithmicFuturesProvider, rithmicTradeSource } from './rithmic-provider.js?v=475';

// Rithmic conformance part 2 (attribution). Notices verbatim from Rithmic's instructions; we use
// R | Protocol API only (not R | API+), so its line is left out. Shown ONLY while connected
// (strip under the chart) and in the Connect sheet; the same text is in the site footer.
export const RITHMIC_NOTICES = [
  'The R | Protocol API\u2122 software is Copyright \u00a9 2026 by Rithmic, LLC. All rights reserved.',
  'Trading Platform by Rithmic\u2122 is a trademark of Rithmic, LLC. All rights reserved.',
  'The OMNE\u2122 software is Copyright \u00a9 2026 by Omnesys, LLC and Omnesys Technologies, Inc. All rights reserved.',
  'Powered by OMNE\u2122 is a trademark of Omnesys, LLC and Omnesys Technologies, Inc. All rights reserved.'
];
// Official Rithmic artwork: grey/white variants on the dark theme, black/blue on the day theme.
const ART = (n) => new URL('./images/rithmic/' + n + '.png', import.meta.url).href;
// Systems Rithmic told us to list before approval: shown greyed, not selectable.
const PENDING_SYSTEMS = ['Rithmic 01', 'Rithmic 04 Colo', 'Rithmic Paper Trading'];

const LS_USER = 'stryker_rithmic_user';
const LS_SYS = 'stryker_rithmic_system';

const CSS = `
.stkr-chip{ display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 9px; border-radius:999px;
  border:1px solid rgba(3,201,136,.45); color:var(--gold); font-family:inherit; font-weight:600; font-size:11.5px; line-height:1; white-space:nowrap; flex:none; }
@media (max-width:480px){ .stkr-chip{ padding:0 7px; font-size:11px; gap:5px; } }
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
.stkr-note.stkr-test{ border-top:0; padding-top:0; color:var(--amber, #e8b04a); }
.stkr-logos{ display:inline-flex; align-items:center; gap:10px; flex-wrap:wrap; }
.stkr-logos img{ display:block; width:auto; }
.stkr-logos .stkr-l-rith{ height:18px; }
.stkr-logos .stkr-l-omne{ height:18px; }
.stkr-logos .day{ display:none; }
:root[data-theme="light"] .stkr-logos .day{ display:block; }
:root[data-theme="light"] .stkr-logos .dark{ display:none; }
.stkr-attr{ flex:none; position:relative; display:flex; align-items:center; gap:8px; padding:3px 12px;
  border-top:1px solid var(--line-soft, var(--line)); background:var(--bg-1); min-height:26px; }
.stkr-attr[hidden]{ display:none; }
.stkr-i{ flex:none; width:18px; height:18px; padding:0; border-radius:50%; border:1px solid var(--line); background:transparent;
  color:var(--ink-2); font:700 10.5px/16px Georgia, serif; font-style:italic; cursor:pointer; }
.stkr-i:hover, .stkr-i[aria-expanded="true"]{ color:var(--ink-0); border-color:var(--ink-3); }
.stkr-legal-pop{ position:absolute; left:8px; bottom:calc(100% + 6px); z-index:60; width:min(420px, calc(100vw - 16px));
  padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--bg-2);
  box-shadow:0 18px 40px -12px rgba(0,0,0,.6); }
.stkr-legal-pop[hidden]{ display:none; }
.stkr-legal{ margin:0; padding:0; list-style:none; font-size:11px; line-height:1.5; color:var(--ink-2); }
.stkr-legal li{ margin:0 0 4px; }
.stkr-legal li:last-child{ margin:0; }
.stkr-sheet-legal{ margin:10px 0 0; padding-top:10px; border-top:1px solid var(--line-soft, var(--line)); }
.stkr-sheet-legal .stkr-logos{ margin:0 0 6px; }
.stkr-sheet-legal .stkr-legal{ font-size:10.5px; color:var(--ink-3); }
@media (max-width:480px){ .stkr-attr{ padding:3px 8px; gap:6px; } .stkr-attr .stkr-l-rith, .stkr-attr .stkr-l-omne{ height:16px; } }
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

function logos() {
  const img = (n, cls, alt) => el('img', { src: ART(n), class: cls, alt, decoding: 'async' });
  return el('span', { class: 'stkr-logos' }, [
    img('trading-platform-by-rithmic-gray', 'stkr-l-rith dark', 'Trading Platform by Rithmic'),
    img('trading-platform-by-rithmic-black', 'stkr-l-rith day', 'Trading Platform by Rithmic'),
    img('powered-by-omne-white', 'stkr-l-omne dark', 'Powered by OMNE'),
    img('powered-by-omne-blue', 'stkr-l-omne day', 'Powered by OMNE')
  ]);
}
const noticeList = () => el('ul', { class: 'stkr-legal' }, RITHMIC_NOTICES.map((t) => el('li', { text: t })));

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

    // ---- attribution strip: under the chart, only while a Rithmic connection is active ----
    const legalPop = el('div', { class: 'stkr-legal-pop', id: 'stkr-legal-pop', role: 'dialog', 'aria-label': 'Rithmic and OMNE notices', hidden: true }, [noticeList()]);
    const info = el('button', { type: 'button', class: 'stkr-i', id: 'stkr-i', 'aria-label': 'Rithmic and OMNE notices', 'aria-expanded': 'false', 'aria-controls': 'stkr-legal-pop', text: 'i' });
    const attr = el('div', { class: 'stkr-attr', id: 'stkr-attr', hidden: true }, [logos(), info, legalPop]);
    const setLegal = (open) => { legalPop.hidden = !open; info.setAttribute('aria-expanded', open ? 'true' : 'false'); };
    info.addEventListener('click', (e) => { e.stopPropagation(); setLegal(legalPop.hidden); });
    document.addEventListener('click', (e) => { if (!legalPop.hidden && !attr.contains(e.target)) setLegal(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !legalPop.hidden) { setLegal(false); info.focus(); } });
    const creditEl = document.querySelector('.stkchart-credit');
    if (creditEl && creditEl.parentNode) creditEl.parentNode.insertBefore(attr, creditEl);
    else document.body.appendChild(attr);

    // ---- the sheet ----
    const err = el('p', { class: 'stkr-err', role: 'alert', hidden: true });
    const brokerR = el('button', { type: 'button', class: 'stkr-broker', role: 'radio', 'aria-checked': 'true', html: 'Rithmic<small>Apex, TradeSea, Tradeify and more</small>' });
    const sys = el('select', { class: 'stkc-in', id: 'stkr-sys', required: true, 'aria-label': 'Rithmic system' });
    const user = el('input', { class: 'stkc-in', id: 'stkr-user', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
    const pass = el('input', { class: 'stkc-in', id: 'stkr-pass', type: 'password', autocomplete: 'current-password', required: true });
    const remember = el('input', { type: 'checkbox', id: 'stkr-remember' });
    const go = el('button', { type: 'submit', class: 'stkc-sbtn stkr-go', id: 'stkr-go', text: 'Connect' });
    const form = el('form', { class: 'stkr-form', id: 'stkr-form', novalidate: true }, [
      el('h3', { text: 'Connect broker' }),
      el('div', { class: 'stkr-brokers', role: 'radiogroup', 'aria-label': 'Broker' }, [brokerR]),
      err,
      el('label', { class: 'stkr-f' }, [el('span', { text: 'System' }), sys]),
      el('label', { class: 'stkr-f' }, [el('span', { text: 'Rithmic username' }), user]),
      el('label', { class: 'stkr-f' }, [el('span', { text: 'Password' }), pass]),
      el('div', { class: 'stkr-row' }, [el('label', { class: 'stkc-check' }, [remember, el('span', { text: 'Remember username' })])]),
      go,
      cfg.isTest ? el('p', { class: 'stkr-note stkr-test', text: 'Test server: prices may differ from the live market.' }) : null,
      el('p', { class: 'stkr-note', text: 'Your login goes straight from your browser to Rithmic. Stryker never sees or stores your password. Live prices come from your own Rithmic data subscription.' }),
      el('div', { class: 'stkr-sheet-legal', id: 'stkr-sheet-legal' }, [logos(), noticeList()])
    ]);
    const onInfo = el('p', {});
    const off = el('button', { type: 'button', class: 'stkr-off', id: 'stkr-off', text: 'Disconnect' });
    const onView = el('div', { class: 'stkr-on', hidden: true }, [el('h3', { text: 'Rithmic' }), onInfo, off,
      el('p', { class: 'stkr-note', text: 'Futures charts (NQ, ES, GC, CL ...) now use your Rithmic data. Disconnect to go back to the standard data.' }),
      el('div', { class: 'stkr-sheet-legal' }, [logos(), noticeList()])]);
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
        // Production systems Rithmic asked us to show: greyed until our app is approved.
        PENDING_SYSTEMS.filter((n) => !names.includes(n)).forEach((n) =>
          sys.appendChild(el('option', { value: '', text: n + ' (available after approval)', disabled: true, 'data-pending': '1' })));
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
      attr.hidden = !on;  // Rithmic data stays on the chart while reconnecting
      if (attr.hidden) setLegal(false);
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
        // Order-flow tools (footprint / delta / CVD) light up on futures only while connected.
        // Handed over by event (no module import here, so the build-stamped ?v= URLs never split
        // chart-orderflow.js into two copies); window.__stkTradeSources covers a late load.
        const reg = window.__stkTradeSources || (window.__stkTradeSources = {});
        reg.futures = live ? rithmicTradeSource(client) : null;
        window.dispatchEvent(new CustomEvent('stryker:tradesource', { detail: { provider: 'futures', fn: reg.futures } }));
      }
    });
    window.addEventListener('pagehide', () => { client.disconnect(true); });
    render();
  }

  return { client, providerFactory, mount, api };
}
