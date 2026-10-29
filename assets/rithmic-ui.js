// TradeZoro — Charts "Connect broker" sheet + Rithmic status chip (ES module)
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

import { RithmicClient, listSystems, explainLoginError } from './rithmic-client.js?v=730';
import { RithmicFuturesProvider, rithmicTradeSource, rithmicBookSource } from './rithmic-provider.js?v=730';

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
const LS_GW = 'stryker_rithmic_gateway';

const LS_USER = 'stryker_rithmic_user';
const LS_GUIDE = 'stryker_rithmic_guide_closed';   // '1' after a successful connect (or when the member closes the box)
const HELP_URL = '/help#rithmic-connect';
// The chosen system is remembered per signed-in member (not a credential, so no checkbox needed).
const LS_SYS = (() => { try { const u = typeof auth !== 'undefined' && auth && auth.currentUser && auth.currentUser.uid; return 'stryker_rithmic_system' + (u ? '_' + u : ''); } catch (e) { return 'stryker_rithmic_system'; } })();

const CSS = `
.stkrb-chip{ display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 9px; border-radius:999px;
  border:1px solid rgba(3,201,136,.45); color:var(--gold); font-family:inherit; font-weight:600; font-size:11.5px; line-height:1; white-space:nowrap; flex:none; }
@media (max-width:480px){ .stkrb-chip{ padding:0 7px; font-size:11px; gap:5px; } }
.stkrb-chip[hidden]{ display:none; }
.stkrb-chip i{ width:7px; height:7px; border-radius:50%; background:currentColor; box-shadow:0 0 0 3px rgba(3,201,136,.18); }
.stkrb-chip.warn{ color:var(--amber, #e8b04a); border-color:rgba(232,176,74,.45); }
.stkrb-chip.warn i{ box-shadow:0 0 0 3px rgba(232,176,74,.18); }
.stkrb-pop{ width:340px; padding:12px; }
.stkrb-pop h3{ margin:0 0 10px; font-size:14px; color:var(--ink-0); }
.stkrb-brokers{ display:flex; gap:6px; margin:0 0 10px; }
.stkrb-broker{ flex:1; display:flex; flex-direction:column; align-items:flex-start; gap:2px; padding:8px 10px; border:1px solid var(--line);
  border-radius:8px; background:transparent; color:var(--ink-1); font:600 12.5px/1.2 inherit; font-family:inherit; text-align:left; cursor:pointer; }
.stkrb-broker[aria-checked="true"]{ border-color:var(--gold); color:var(--ink-0); }
.stkrb-broker:disabled{ opacity:.45; cursor:not-allowed; }
.stkrb-broker small{ font-weight:500; font-size:10.5px; color:var(--ink-3); }
.stkrb-f{ display:block; margin:0 0 9px; }
.stkrb-f > span{ display:block; margin:0 0 4px; font-size:11px; font-weight:600; color:var(--ink-2); }
.stkrb-f .stkc-in{ width:100%; height:34px; box-sizing:border-box; }
.stkrb-f select.stkc-in{ padding-right:6px; }
.stkrb-row{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin:2px 0 10px; }
.stkrb-row .stkc-check{ padding:0; font-size:12px; color:var(--ink-2); }
.stkrb-go{ width:100%; height:36px; }
.stkrb-note{ margin:10px 0 0 !important; padding-top:10px; border-top:1px solid var(--line-soft, var(--line));
  font-size:11.5px; line-height:1.5; color:var(--ink-2); }
.stkrb-note.stkrb-test{ border-top:0; padding-top:0; color:var(--amber, #e8b04a); }
.stkrb-logos{ display:inline-flex; align-items:center; gap:10px; flex-wrap:wrap; }
.stkrb-logos img{ display:block; width:auto; }
.stkrb-logos .stkrb-l-rith{ height:18px; }
.stkrb-logos .stkrb-l-omne{ height:18px; }
.stkrb-logos .day{ display:none; }
:root[data-theme="light"] .stkrb-logos .day{ display:block; }
:root[data-theme="light"] .stkrb-logos .dark{ display:none; }
.stkrb-attr{ flex:none; position:relative; display:flex; align-items:center; gap:8px; padding:3px 12px;
  border-top:1px solid var(--line-soft, var(--line)); background:var(--bg-1); min-height:26px; }
.stkrb-attr[hidden]{ display:none; }
.stkrb-i{ flex:none; width:18px; height:18px; padding:0; border-radius:50%; border:1px solid var(--line); background:transparent;
  color:var(--ink-2); font:700 10.5px/16px Georgia, serif; font-style:italic; cursor:pointer; }
.stkrb-i:hover, .stkrb-i[aria-expanded="true"]{ color:var(--ink-0); border-color:var(--ink-3); }
.stkrb-legal-pop{ position:absolute; left:8px; bottom:calc(100% + 6px); z-index:60; width:min(420px, calc(100vw - 16px));
  padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--bg-2);
  box-shadow:0 18px 40px -12px rgba(0,0,0,.6); }
.stkrb-legal-pop[hidden]{ display:none; }
.stkrb-legal{ margin:0; padding:0; list-style:none; font-size:11px; line-height:1.5; color:var(--ink-2); }
.stkrb-legal li{ margin:0 0 4px; }
.stkrb-legal li:last-child{ margin:0; }
.stkrb-sheet-legal{ margin:10px 0 0; padding-top:10px; border-top:1px solid var(--line-soft, var(--line)); }
.stkrb-sheet-legal .stkrb-logos{ margin:0 0 6px; }
.stkrb-sheet-legal .stkrb-legal{ font-size:10.5px; color:var(--ink-3); }
@media (max-width:480px){ .stkrb-attr{ padding:3px 8px; gap:6px; } .stkrb-attr .stkrb-l-rith, .stkrb-attr .stkrb-l-omne{ height:16px; } }
.stkrb-err{ color:#ff6b6b; font-size:12.5px; line-height:1.5; margin:0 0 10px !important; padding:10px 12px; border:1px solid rgba(255,107,107,.4); border-radius:8px; background:rgba(255,107,107,.07); overflow-wrap:anywhere; }
.stkrb-err .stkrb-copy{ display:inline-block; margin-top:8px; height:30px; padding:0 12px; border:1px solid rgba(255,107,107,.5); border-radius:6px; background:transparent; color:inherit; font:600 12px/1 inherit; font-family:inherit; cursor:pointer; }
.stkrb-guide{ margin:0 0 12px; border:1px solid rgba(3,201,136,.3); border-radius:10px; background:rgba(3,201,136,.05); }
.stkrb-guide > summary{ list-style:none; cursor:pointer; padding:11px 12px; font-size:13.5px; font-weight:700; color:var(--ink-0); display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:20px; }
.stkrb-guide > summary::-webkit-details-marker{ display:none; }
.stkrb-guide > summary::after{ content:''; width:7px; height:7px; border-right:2px solid var(--gold); border-bottom:2px solid var(--gold); transform:rotate(45deg); transition:transform .15s; margin-right:3px; }
.stkrb-guide[open] > summary::after{ transform:rotate(-135deg); }
.stkrb-checks{ list-style:none; margin:0; padding:0 12px 10px; }
.stkrb-checks li{ position:relative; margin:0 0 9px; padding:0 0 0 22px; font-size:12.5px; line-height:1.5; color:var(--ink-1); }
.stkrb-checks li::before{ content:''; position:absolute; left:2px; top:5px; width:9px; height:5px; border-left:2px solid var(--gold); border-bottom:2px solid var(--gold); transform:rotate(-45deg); }
.stkrb-checks li b{ color:var(--ink-0); }
.stkrb-checks li.warn{ margin-right:0; padding:8px 10px 8px 30px; border:1px solid rgba(232,176,74,.4); border-radius:8px; background:rgba(232,176,74,.07); color:var(--ink-1); }
.stkrb-checks li.warn::before{ content:'!'; left:10px; top:8px; width:auto; height:auto; border:0; transform:none; font-weight:800; color:var(--amber, #e8b04a); }
.stkrb-checks a, .stkrb-helplink a{ color:var(--gold); }
.stkrb-help{ display:block; margin-top:4px; font-size:11.5px; line-height:1.45; color:var(--ink-3, #8a8f98); }
.stkrb-passwrap{ position:relative; display:block; }
.stkrb-passwrap .stkc-in{ padding-right:56px; }
.stkrb-eye{ position:absolute; right:4px; top:50%; transform:translateY(-50%); height:30px; min-width:48px; padding:0 8px; border:0; border-radius:6px; background:transparent; color:var(--ink-2); font:600 12px/1 inherit; font-family:inherit; cursor:pointer; }
.stkrb-eye:hover{ color:var(--ink-0); }
.stkrb-helplink{ margin:12px 0 0 !important; font-size:13px; font-weight:600; }
.stkrb-err[hidden]{ display:none; }
.stkrb-hint{ display:block; margin-top:4px; font-size:11px; color:var(--ink-3, #8a8f98); }
.stkrb-hint[hidden]{ display:none; }
.stkrb-raw{ display:block; margin-top:4px; font-size:11px; color:var(--ink-3, #8a8f98); overflow-wrap:anywhere; }
.stkrb-on p{ font-size:12.5px; color:var(--ink-1); }
.stkrb-on b{ color:var(--ink-0); }
.stkrb-ids{ margin:0 0 8px; font-size:10.5px; line-height:1.5; color:var(--ink-3); overflow-wrap:anywhere; }
.stkrb-ids span{ display:block; }
.stkrb-ids code{ font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:10.5px; color:var(--ink-2); user-select:all; }
.stkrb-off{ width:100%; height:34px; margin-top:4px; border:1px solid var(--line); border-radius:6px; background:transparent;
  color:var(--ink-0); font:600 12.5px/1 inherit; font-family:inherit; cursor:pointer; }
.stkrb-off:hover{ border-color:var(--red, #e5484d); color:var(--red, #e5484d); }
.stkrb-f select.stkrb-nat{ display:none; }
.stkrb-sysbtn{ text-align:left; cursor:pointer; color:var(--ink-0); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.stkrb-sysbtn[hidden]{ display:none; }
.stkrb-sysbtn:disabled{ opacity:.6; }
.stkrb-syslist{ position:fixed; inset:0; z-index:100000; background:var(--bg-1, #0b0f14); display:flex; flex-direction:column; padding:12px; gap:10px; box-sizing:border-box; }
.stkrb-syslist[hidden]{ display:none; }
.stkrb-syshead{ display:flex; align-items:center; justify-content:space-between; color:var(--ink-0); font-size:15px; }
.stkrb-sysx{ height:36px; padding:0 12px; border:1px solid var(--line); border-radius:6px; background:transparent; color:var(--ink-0); font:inherit; cursor:pointer; }
.stkrb-syslist > input{ width:100%; flex:none; height:44px; font-size:16px; box-sizing:border-box; }
.stkrb-sysrows{ flex:1; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:rgba(150,160,175,.35) transparent; }
.stkrb-sysrows::-webkit-scrollbar{ width:6px; }
.stkrb-sysrows::-webkit-scrollbar-thumb{ background:rgba(150,160,175,.35); border-radius:3px; }
.stkrb-sysrow{ display:block; width:100%; min-height:52px; text-align:left; padding:0 14px; border:0; border-bottom:1px solid var(--line); background:transparent; color:var(--ink-0); font:600 16px/1.2 inherit; font-family:inherit; cursor:pointer; }
.stkrb-sysrow.on{ color:var(--gold); }
/* Phones: the sheet is a fixed full-screen layer on <body>, away from the toolbar popover and chart relayout. */
.stkc-pop.stkrb-pop.stkrb-full{ position:fixed; inset:0; top:0; left:0; right:0; bottom:0; width:auto; max-width:none; min-width:0; max-height:none; height:100%; z-index:99990;
  border:0; border-radius:0; padding:14px 14px 28px; box-sizing:border-box; overflow-y:auto; overscroll-behavior:contain; background:var(--bg-1, #0b0f14);
  scrollbar-width:thin; scrollbar-color:rgba(150,160,175,.35) transparent; }
.stkrb-full::-webkit-scrollbar{ width:6px; }
.stkrb-full::-webkit-scrollbar-thumb{ background:rgba(150,160,175,.35); border-radius:3px; }
.stkrb-fullx{ display:none; }
.stkrb-full .stkrb-fullx{ display:block; margin:0 0 10px auto; height:36px; padding:0 14px; border:1px solid var(--line); border-radius:6px; background:transparent; color:var(--ink-0); font:inherit; cursor:pointer; }
@media (max-width:700px){
  .stkrb-pop{ width:auto; }
  .stkrb-f .stkc-in{ height:40px; font-size:16px; }
  .stkrb-go, .stkrb-off{ height:42px; }
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
  return el('span', { class: 'stkrb-logos' }, [
    img('trading-platform-by-rithmic-gray', 'stkrb-l-rith dark', 'Trading Platform by Rithmic'),
    img('trading-platform-by-rithmic-black', 'stkrb-l-rith day', 'Trading Platform by Rithmic'),
    img('powered-by-omne-white', 'stkrb-l-omne dark', 'Powered by OMNE'),
    img('powered-by-omne-blue', 'stkrb-l-omne day', 'Powered by OMNE')
  ]);
}
const noticeList = () => el('ul', { class: 'stkrb-legal' }, RITHMIC_NOTICES.map((t) => el('li', { text: t })));

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
    get depthEnabled() { return !!cfg.depthEnabled; },
    // Requests sent to Rithmic this page session, per plant (no ids, no credentials).
    get counts() { return JSON.parse(JSON.stringify(client.counts)); },
    // This member's own plant sessions (unique_user_id + login/logout epoch ms), current and ended.
    get sessions() { return client.sessions().concat(client.sessionLog).map((x) => ({ ...x })); },
    disconnect: () => client.disconnect(),
    reloadCharts: () => reloadCells()
  };

  const providerFactory = (FuturesProvider) => () => new RithmicFuturesProvider(client, new FuturesProvider(), cfg, {
    onSource: (src) => { lastSource = src; },
    onFallback: () => { lastSource = 'standard'; },
    onError: (e) => { console.warn('TradeZoro Rithmic:', e && e.message); }
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
        // The flip's load is thrown away, so the provider answers it empty instead of asking
        // Rithmic for history nobody will see (client.skipLoads, read by rithmic-provider.js).
        client.skipLoads.add(alt);
        try {
          c.chart.setMarket({ timeframe: alt }).catch(() => {});
          await c.chart.setMarket({ timeframe: tf });
        } finally { client.skipLoads.delete(alt); }
      } catch (e) { console.warn('TradeZoro Rithmic: reload', e); }
    }
  }

  function mount(workspace, CoreMod) {
    ws = workspace;
    Core = CoreMod;
    if (!document.getElementById('stkrb-css')) document.head.appendChild(el('style', { id: 'stkrb-css', text: CSS }));
    const barR = document.querySelector('.stkc-bar-r');
    if (!barR) return;

    const chip = el('span', { class: 'stkrb-chip', id: 'stkrb-chip', role: 'status', hidden: true });
    const btn = el('button', { type: 'button', class: 'stkc-btn', id: 'stkrb-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Connect broker',
      html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/></svg><span class="stkc-btn-l">Connect broker</span>' });
    const pop = el('div', { class: 'stkc-pop stkrb-pop', id: 'stkrb-pop', role: 'dialog', 'aria-label': 'Connect broker', hidden: true });
    const phone = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    const wrap = el('div', { class: 'stkc-menu' }, phone ? [btn] : [btn, pop]);
    if (phone) {
      pop.classList.add('stkrb-full');
      pop.appendChild(el('button', { type: 'button', class: 'stkrb-fullx', 'aria-label': 'Close', text: 'Close', onclick: () => setOpen(false) }));
      document.body.appendChild(pop);
    }
    barR.insertBefore(wrap, barR.firstChild);
    barR.insertBefore(chip, wrap);

    // ---- attribution strip: under the chart, only while a Rithmic connection is active ----
    const legalPop = el('div', { class: 'stkrb-legal-pop', id: 'stkrb-legal-pop', role: 'dialog', 'aria-label': 'Rithmic and OMNE notices', hidden: true }, [noticeList()]);
    const info = el('button', { type: 'button', class: 'stkrb-i', id: 'stkrb-i', 'aria-label': 'Rithmic and OMNE notices', 'aria-expanded': 'false', 'aria-controls': 'stkrb-legal-pop', text: 'i' });
    const attr = el('div', { class: 'stkrb-attr', id: 'stkrb-attr', hidden: true }, [logos(), info, legalPop]);
    const setLegal = (open) => { legalPop.hidden = !open; info.setAttribute('aria-expanded', open ? 'true' : 'false'); };
    info.addEventListener('click', (e) => { e.stopPropagation(); setLegal(legalPop.hidden); });
    document.addEventListener('click', (e) => { if (!legalPop.hidden && !attr.contains(e.target)) setLegal(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !legalPop.hidden) { setLegal(false); info.focus(); } });
    const creditEl = document.querySelector('.stkchart-credit');
    if (creditEl && creditEl.parentNode) creditEl.parentNode.insertBefore(attr, creditEl);
    else document.body.appendChild(attr);

    // ---- the sheet ----
    const li = (kids, cls) => el('li', cls ? { class: cls } : null, kids);
    const t = (x) => document.createTextNode(x);
    const guide = el('details', { class: 'stkrb-guide', id: 'stkrb-guide' }, [
      el('summary', { text: 'Before you connect' }),
      el('ul', { class: 'stkrb-checks' }, [
        li([el('b', { text: 'Use your Rithmic login. ' }), t('It is the one your prop firm or broker gave you (often letters and numbers), not your login for their website.')]),
        li([el('b', { text: 'The account must be active with CME market data. ' }), t('A brand-new login must first accept the market data agreements once in '), el('a', { href: 'https://rithmic.com/rtraderpro-web', target: '_blank', rel: 'noopener', text: 'R | Trader Pro' }), t('.')]),
        li([el('b', { text: 'Heads up: ' }), t('Rithmic allows a limited number of sessions per login. Connecting here can log out another app using the same login, like your trading platform. Avoid connecting while you are in a trade.')], 'warn'),
        li([el('b', { text: 'Data only. ' }), t('TradeZoro cannot place, change or close trades. Your password goes from your browser straight to Rithmic. We never see or store it.')])
      ])
    ]);
    guide.open = lsGet(LS_GUIDE) !== '1';
    guide.addEventListener('toggle', () => { if (!guide.open) lsSet(LS_GUIDE, '1'); else { try { localStorage.removeItem(LS_GUIDE); } catch (e) {} } });
    const err = el('p', { class: 'stkrb-err', id: 'stkrb-err', role: 'alert', hidden: true });
    const brokerR = el('button', { type: 'button', class: 'stkrb-broker', role: 'radio', 'aria-checked': 'true', html: 'Rithmic<small>Rithmic 01, TradeSea, Apex, Tradeify and more</small>' });
    const gwSel = el('select', { class: 'stkc-in', id: 'stkrb-gw', 'aria-label': 'Rithmic gateway' });
    (cfg.gateways || []).forEach((g) => gwSel.appendChild(el('option', { value: g.uri, text: g.label })));
    // Default = the first gateway (Chicago); a remembered choice wins; a time-zone suggestion is only a hint.
    const savedGw = lsGet(LS_GW);
    if ((cfg.gateways || []).some((g) => g.uri === savedGw)) gwSel.value = savedGw;
    const near = (cfg.gateways || []).find((g) => g.id === cfg.nearest && !g.test);
    const hint = el('small', { class: 'stkrb-hint', hidden: true });
    const showHint = () => {
      const cur = (cfg.gateways || []).find((g) => g.uri === gwSel.value);
      hint.hidden = !(near && cur && cur.id !== near.id);
      if (!hint.hidden) { hint.textContent = 'Closest to you: ' + near.label + '. '; hint.appendChild(el('a', { href: '#', text: 'Use it', onclick: (e) => { e.preventDefault(); gwSel.value = near.uri; gwSel.dispatchEvent(new Event('change')); } })); }
    };
    const gwField = el('label', { class: 'stkrb-f', hidden: (cfg.gateways || []).length < 2 }, [el('span', { text: 'Gateway (server location)' }), gwSel, el('small', { class: 'stkrb-help', text: 'Pick the closest location. Chicago works for most people.' }), hint]);
    gwSel.addEventListener('change', () => { systemsLoaded = false; showErr(''); cfg.gateway = gwSel.value; lsSet(LS_GW, gwSel.value); showHint(); loadSystems(); });
    setTimeout(showHint, 0);
    const sys = el('select', { class: 'stkc-in', id: 'stkrb-sys', required: true, 'aria-label': 'Rithmic system' });
    const touch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    // Phones: our own tappable list instead of the native picker (Android closes that one on any layout change).
    const sysBtn = el('button', { type: 'button', class: 'stkc-in stkrb-sysbtn', id: 'stkrb-sysbtn', 'aria-haspopup': 'listbox', text: 'Loading systems...' });
    const user = el('input', { class: 'stkc-in', id: 'stkrb-user', type: 'text', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true });
    const pass = el('input', { class: 'stkc-in', id: 'stkrb-pass', type: 'password', autocomplete: 'current-password', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true });
    const eye = el('button', { type: 'button', class: 'stkrb-eye', 'aria-label': 'Show password', 'aria-pressed': 'false', text: 'Show' });
    eye.addEventListener('click', () => { const show = pass.type === 'password'; pass.type = show ? 'text' : 'password'; eye.textContent = show ? 'Hide' : 'Show'; eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); eye.setAttribute('aria-pressed', show ? 'true' : 'false'); });
    const remember = el('input', { type: 'checkbox', id: 'stkrb-remember' });
    const go = el('button', { type: 'submit', class: 'stkc-sbtn stkrb-go', id: 'stkrb-go', text: 'Connect' });
    const testNote = el('p', { class: 'stkrb-note stkrb-test', id: 'stkrb-test-note', hidden: true, text: 'Admin: the Rithmic Test gateway has no real market prices.' });
    const syncTestNote = () => { const g = (cfg.gateways || []).find((x) => x.uri === (gwSel.value || cfg.gateway)); testNote.hidden = !(g && g.test); };
    gwSel.addEventListener('change', syncTestNote);
    setTimeout(syncTestNote, 0);
    const form = el('form', { class: 'stkrb-form', id: 'stkrb-form', novalidate: true }, [
      el('h3', { text: 'Connect broker' }),
      el('div', { class: 'stkrb-brokers', role: 'radiogroup', 'aria-label': 'Broker' }, [brokerR]),
      guide,
      err,
      gwField,
      el('label', { class: 'stkrb-f' }, [el('span', { text: 'System' }), sys, sysBtn, el('small', { class: 'stkrb-help', id: 'stkrb-sys-hint', text: "Your prop firm or broker. Not sure? It's the system name you pick when you log in to R | Trader Pro." })]),
      el('label', { class: 'stkrb-f' }, [el('span', { text: 'Rithmic username' }), user]),
      el('label', { class: 'stkrb-f' }, [el('span', { text: 'Rithmic password' }), el('span', { class: 'stkrb-passwrap' }, [pass, eye])]),
      el('div', { class: 'stkrb-row' }, [el('label', { class: 'stkc-check' }, [remember, el('span', { text: 'Remember username' })])]),
      go,
      testNote,
      false ? el('p', { class: 'stkrb-note stkrb-test', text: 'Admin: the Rithmic Test gateway has no real market prices.' }) : null,
      el('p', { class: 'stkrb-note', text: 'Your password goes straight from your browser to Rithmic. TradeZoro never sees or stores it. Live prices come from your own Rithmic data subscription.' }),
      el('p', { class: 'stkrb-helplink' }, [el('a', { href: HELP_URL, target: '_blank', rel: 'noopener', text: 'Help with connecting \u2192' })]),
      el('div', { class: 'stkrb-sheet-legal', id: 'stkrb-sheet-legal' }, [logos(), noticeList()])
    ]);
    const onInfo = el('p', {});
    // Rithmic's unique_user_id per plant (from the login response), for the member's own reference
    // (Rithmic support asks for it). In memory only; never sent anywhere.
    const ids = el('p', { class: 'stkrb-ids', id: 'stkrb-ids' });
    const off = el('button', { type: 'button', class: 'stkrb-off', id: 'stkrb-off', text: 'Disconnect' });
    const onView = el('div', { class: 'stkrb-on', hidden: true }, [el('h3', { text: 'Rithmic' }), onInfo, ids, off,
      el('p', { class: 'stkrb-note', text: 'Futures charts (NQ, ES, GC, CL ...) now use your Rithmic data. Disconnect to go back to the standard data.' }),
      el('div', { class: 'stkrb-sheet-legal' }, [logos(), noticeList()])]);
    pop.appendChild(form);
    pop.appendChild(onView);
    form.addEventListener('submit', (e) => { e.preventDefault(); e.stopPropagation(); doConnect(); });

    const savedUser = lsGet(LS_USER);
    if (savedUser) { user.value = savedUser; remember.checked = true; }

    if (touch) { sys.classList.add('stkrb-nat'); } else { sysBtn.hidden = true; }
    sys.addEventListener('change', () => { syncBtn(); if (sys.value) lsSet(LS_SYS, sys.value); });
    let systemsLoaded = false;
    const sysList = el('div', { class: 'stkrb-syslist', id: 'stkrb-syslist', role: 'listbox', hidden: true });
    const sysSearch = el('input', { class: 'stkc-in', type: 'search', placeholder: 'Search your firm', 'aria-label': 'Search systems', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    const sysRows = el('div', { class: 'stkrb-sysrows' });
    const sysClose = el('button', { type: 'button', class: 'stkrb-sysx', text: 'Cancel' });
    sysList.appendChild(el('div', { class: 'stkrb-syshead' }, [el('strong', { text: 'Choose your system' }), sysClose]));
    sysList.appendChild(sysSearch);
    sysList.appendChild(sysRows);
    sysList.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(sysList);
    let sysNames = [];
    const syncBtn = () => { sysBtn.textContent = sys.selectedOptions[0] ? sys.selectedOptions[0].text : 'Choose your system'; sysBtn.disabled = sys.disabled; };
    const drawRows = () => {
      const q = sysSearch.value.trim().toLowerCase();
      sysRows.innerHTML = '';
      sysNames.filter((n) => !q || n.toLowerCase().includes(q)).forEach((n) => {
        sysRows.appendChild(el('button', { type: 'button', class: 'stkrb-sysrow' + (n === sys.value ? ' on' : ''), role: 'option', text: n, onclick: () => {
          sys.value = n; lsSet(LS_SYS, n); syncBtn(); sysList.hidden = true; } }));
      });
      if (!sysRows.children.length) sysRows.appendChild(el('p', { class: 'stkrb-note', text: 'No match.' }));
    };
    sysBtn.addEventListener('click', () => { if (sys.disabled) return; sysSearch.value = ''; drawRows(); sysList.hidden = false; });
    sysClose.addEventListener('click', () => { sysList.hidden = true; });
    sysSearch.addEventListener('input', drawRows);
    let sysLoading = null;
    function loadSystems() {
      if (systemsLoaded) return Promise.resolve();
      if (sysLoading) return sysLoading;
      sysLoading = loadSystems2().finally(() => { sysLoading = null; syncBtn(); });
      return sysLoading;
    }
    async function loadSystems2() {
      sys.disabled = true;
      sys.innerHTML = '';
      sys.appendChild(el('option', { value: '', text: 'Loading systems...' }));
      syncBtn();
      try {
        const names = await listSystems(gwSel.value || cfg.gateway);
        systemsLoaded = true;
        sys.disabled = false;
        sys.innerHTML = '';
        sys.appendChild(el('option', { value: '', text: 'Choose your system' }));
        const want = lsGet(LS_SYS);
        const gw = (cfg.gateways || []).find((g) => g.uri === (gwSel.value || cfg.gateway));
        // Production gateways list every prop firm; members only get the systems we offer (exact names from the gateway).
        const first = cfg.systemFirst || [];
        const rank = (n) => { const i = first.indexOf(n); return i < 0 ? first.length : i; };
        const shown = names.filter((n) => (gw && gw.test) || n !== 'Rithmic Test')
          .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en', { sensitivity: 'base' }));
        if (!shown.length) showErr('This location returned no systems. Try another gateway.');
        shown.forEach((n) => sys.appendChild(el('option', { value: n, text: n, selected: n === want })));
        if (shown.length === 1) sys.value = shown[0];
        sysNames = shown;
      } catch (e) {
        sys.innerHTML = '';
        sys.appendChild(el('option', { value: '', text: 'Could not load systems' }));
        sysNames = [];
        { const g0 = (cfg.gateways || []).find((g) => g.uri === (gwSel.value || cfg.gateway)); showErr(explainLoginError({ text: 'could not reach', gateway: g0 && g0.label }).message); }
      }
    }

    // m = our plain-English message; raw = Rithmic's own response text (small grey print), if any.
    function showErr(m, raw) {
      err.textContent = m || '';
      if (m && raw && !m.includes(raw)) err.appendChild(el('small', { class: 'stkrb-raw', id: 'stkrb-raw', text: 'Rithmic said: ' + raw }));
      if (m && raw !== undefined) {   // a login failure (not a form-validation hint): offer a copy for support
        const cp = el('button', { type: 'button', class: 'stkrb-copy', id: 'stkrb-copy', text: 'Copy error' });
        cp.addEventListener('click', async () => {
          const gw = (cfg.gateways || []).find((g) => g.uri === gwSel.value);
          const txt = 'Stryker Charts connect error\nSystem: ' + (sys.value || '-') + '\nGateway: ' + (gw ? gw.label : '-') + '\nMessage: ' + m + (raw ? '\nRithmic said: ' + raw : '') + '\nTime: ' + new Date().toISOString();
          let done = false;
          try { await navigator.clipboard.writeText(txt); done = true; } catch (e) {}
          if (!done) { try { const ta = el('textarea', { style: 'position:fixed;opacity:0;left:-999px' }); ta.value = txt; document.body.appendChild(ta); ta.select(); done = document.execCommand('copy'); ta.remove(); } catch (e) {} }
          cp.textContent = done ? 'Copied' : 'Copy failed';
          setTimeout(() => { cp.textContent = 'Copy error'; }, 2000);
        });
        err.appendChild(el('br'));
        err.appendChild(cp);
      }
      err.hidden = !m;
    }

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
      lsSet(LS_SYS, s);
      try {
        await client.connect({ user: u, password: p, systemName: s, gateway: gwSel.value || cfg.gateway });
        lsSet(LS_GUIDE, '1'); guide.open = false;
        toast('Connected to Rithmic');
        setOpen(false);
      } catch (e) {
        const gw = (cfg.gateways || []).find((g) => g.uri === (gwSel.value || cfg.gateway));
        const r = explainLoginError({ codes: e && e.rpRaw, text: e && e.message, system: s, gateway: gw && gw.label, appName: cfg.appName });
        showErr(r.message, r.raw || '');
      } finally {
        go.disabled = false; go.textContent = 'Connect';
      }
    }
    off.addEventListener('click', async () => { await client.disconnect(); toast('Disconnected from Rithmic'); setOpen(false); });

    // popover open/close (same behaviour as the other toolbar menus)
    function setOpen(open) {
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { render(); if (!client.connected) { loadSystems(); if (!touch) setTimeout(() => (user.value ? pass : user).focus(), 30); }
      else if (!sysList.hidden) sysList.hidden = true; }
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = pop.hidden;
      document.querySelectorAll('.stkc-pop').forEach((p) => { if (p !== pop && !p.hidden) p.hidden = true; });
      setOpen(open);
    });
    pop.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', (e) => { if (!pop.hidden && !(phone && pop.contains(document.activeElement)) && !(e.target && e.target.closest && e.target.closest('.stkrb-syslist'))) setOpen(false); });
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
      ids.innerHTML = '';
      const sess = on && client.sessions ? client.sessions() : [];
      for (const x of sess) {
        if (!x.uniqueUserId) continue;
        const line = el('span', {});
        line.appendChild(document.createTextNode('Session ID (' + x.plant + '): '));
        line.appendChild(el('code', { text: x.uniqueUserId }));
        if (x.loginAt) line.title = 'Logged in ' + new Date(x.loginAt).toISOString();
        ids.appendChild(line);
      }
      ids.hidden = !ids.childNodes.length;
      chip.hidden = !on;
      attr.hidden = !on;  // Rithmic data stays on the chart while reconnecting
      if (attr.hidden) setLegal(false);
      chip.className = 'stkrb-chip' + (st === 'reconnecting' ? ' warn' : '');
      chip.innerHTML = '';
      chip.appendChild(el('i', { 'aria-hidden': 'true' }));
      chip.appendChild(document.createTextNode(st === 'connected' ? 'Rithmic · connected' : 'Rithmic · reconnecting'));
      btn.querySelector('.stkc-btn-l').textContent = on ? 'Broker' : 'Connect broker';
      btn.title = on ? 'Broker connection' : 'Connect broker';
      // The source line under the chart names the data source: keep it truthful.
      const credit = document.querySelector('.stkchart-credit');
      if (credit) {
        if (!credit.dataset.std) credit.dataset.std = credit.textContent;
        const fut = st === 'connected'
          ? 'Futures: live from your own Rithmic connection (' + (client.systemName || 'Rithmic') + ') · crypto: public Binance, Coinbase and Hyperliquid feeds · Education only. Not financial advice.'
          : credit.dataset.std;
        credit.dataset.fut = fut;
        // a crypto chart shows its own venue line (assets/chart-data-dot.js syncCredit)
        if (!credit.dataset.crypto) credit.textContent = fut;
      }
    }

    let prevLive = false;
    client.on((ev) => {
      if (ev.type !== 'state') return;
      render();
      const live = ev.state === 'connected';
      if (ev.state === 'error' && ev.message && /closed this session/.test(ev.message)) toast(ev.message, 'error');
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
        // Order book for the Liquidity Map (futures): only where cfg.depthEnabled (admins now; everyone = RITHMIC_FLAG.depthForAll).
        window.__stkBookSources = window.__stkBookSources || {};
        window.__stkBookSources.futures = live && cfg.depthEnabled ? rithmicBookSource(client) : null;
        window.dispatchEvent(new CustomEvent('stryker:booksource', { detail: { provider: 'futures' } }));
      }
    });
    window.addEventListener('pagehide', () => { client.disconnect(true); });
    render();
  }

  return { client, providerFactory, mount, api };
}
