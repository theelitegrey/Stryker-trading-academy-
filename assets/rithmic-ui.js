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
const LS_HIDE = 'stryker_rithmic_chip_hide_until';   // epoch ms: the chart shortcut stays hidden until then (7 days after the member dismisses it)
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
.stkrb-lead{ margin:0 0 12px !important; font-size:12.5px; line-height:1.5; color:var(--ink-2); }
.stkrb-prog{ display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin:0 0 6px; padding:0; list-style:none; }
.stkrb-prog li{ position:relative; display:flex; align-items:center; gap:6px; min-width:0; padding-top:9px; font-size:11.5px; font-weight:600; color:var(--ink-3, #8a8f98); }
.stkrb-prog li::before{ content:''; position:absolute; left:0; right:0; top:0; height:3px; border-radius:2px; background:var(--line); transition:background .2s; }
.stkrb-prog li b{ flex:none; display:inline-grid; place-items:center; width:18px; height:18px; border-radius:6px; border:1px solid var(--line); font-size:10.5px; font-weight:700; line-height:1; }
.stkrb-prog li span{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.stkrb-prog li.on{ color:var(--ink-0); }
.stkrb-prog li.on::before{ background:var(--gold); }
.stkrb-prog li.on b{ border-color:var(--gold); color:var(--gold); }
.stkrb-prog li.done{ color:var(--ink-1); }
.stkrb-prog li.done::before{ background:rgba(3,201,136,.45); }
.stkrb-prog li.done b{ background:var(--gold); border-color:var(--gold); color:#04120c; font-size:0; }
.stkrb-prog li.done b::after{ content:''; width:8px; height:4px; border-left:2px solid #04120c; border-bottom:2px solid #04120c; transform:rotate(-45deg) translate(1px,-1px); }
.stkrb-where{ user-select:none; -webkit-tap-highlight-color:transparent; display:inline-flex; align-items:center; gap:6px; margin:6px 0 12px; padding:0; border:0; background:transparent; color:var(--gold); font:600 12.5px/1.2 inherit; font-family:inherit; cursor:pointer; min-height:28px; }
.stkrb-where i{ display:inline-grid; place-items:center; width:17px; height:17px; border-radius:50%; border:1.5px solid currentColor; font-style:normal; font-size:11px; font-weight:800; }
.stkrb-where:hover span{ text-decoration:underline; }
.stkrb-f > span .stkrb-n{ display:inline-block; margin-right:5px; color:var(--gold); font-weight:700; }
.stkrb-two{ display:grid; grid-template-columns:1fr; gap:0; }
.stkrb-session{ display:flex; gap:7px; align-items:flex-start; margin:2px 0 10px; font-size:11.5px; line-height:1.45; color:var(--amber, #e8b04a); }
.stkrb-session svg{ flex:none; margin-top:1px; }
.stkrb-lock{ display:flex; gap:7px; align-items:flex-start; margin:9px 0 0; font-size:11.5px; line-height:1.45; color:var(--ink-2); }
.stkrb-lock svg{ flex:none; margin-top:1px; color:var(--gold); }
.stkrb-back{ position:fixed; inset:0; z-index:100010; background:rgba(0,0,0,.55); }
.stkrb-back[hidden], .stkrb-card[hidden]{ display:none; }
.stkrb-card{ position:fixed; left:0; right:0; bottom:0; z-index:100011; margin:0 auto; width:100%; max-width:480px; max-height:82vh; overflow-y:auto; box-sizing:border-box;
  padding:8px 18px 22px; background:var(--bg-2, #141a22); border:1px solid var(--line); border-bottom:0; border-radius:18px 18px 0 0; box-shadow:0 -18px 40px -12px rgba(0,0,0,.6);
  overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:rgba(150,160,175,.35) transparent; }
.stkrb-card::-webkit-scrollbar{ width:6px; }
.stkrb-card::-webkit-scrollbar-thumb{ background:rgba(150,160,175,.35); border-radius:3px; }
.stkrb-card::-webkit-scrollbar-thumb:hover{ background:rgba(150,160,175,.6); }
.stkrb-grab{ width:38px; height:4px; border-radius:2px; background:var(--line); margin:4px auto 12px; }
.stkrb-card h4{ margin:0 0 10px; font-size:15px; color:var(--ink-0); display:flex; justify-content:space-between; align-items:center; gap:8px; }
.stkrb-card .stkrb-cx{ height:32px; padding:0 12px; border:1px solid var(--line); border-radius:8px; background:transparent; color:var(--ink-0); font:600 12.5px/1 inherit; font-family:inherit; cursor:pointer; }
.stkrb-checks{ list-style:none; counter-reset:c; margin:0; padding:0; }
.stkrb-checks li{ counter-increment:c; position:relative; margin:0 0 11px; padding:0 0 0 30px; font-size:12.5px; line-height:1.5; color:var(--ink-1); }
.stkrb-checks li::before{ content:counter(c); position:absolute; left:0; top:1px; width:20px; height:20px; border-radius:7px; background:rgba(3,201,136,.14); color:var(--gold); font-size:11px; font-weight:700; display:grid; place-items:center; }
.stkrb-checks li b{ display:block; color:var(--ink-0); font-size:13px; }
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
@media (min-width:361px){ .stkrb-two{ grid-template-columns:1fr 1fr; gap:10px; } }
.stkrb-chipgo{ position:fixed; z-index:60; display:inline-flex; align-items:center; gap:2px; height:28px; border-radius:999px; background:rgba(3,201,136,.14); border:1px solid rgba(3,201,136,.5); color:var(--gold); font:600 12px/1 inherit; font-family:inherit; box-shadow:0 4px 14px -6px rgba(0,0,0,.6); backdrop-filter:blur(6px); }
.stkrb-chipgo[hidden]{ display:none; }
.stkrb-chipgo button{ display:inline-flex; align-items:center; gap:6px; height:100%; border:0; background:transparent; color:inherit; font:inherit; cursor:pointer; padding:0 4px 0 10px; border-radius:999px 0 0 999px; white-space:nowrap; }
.stkrb-chipgo button.x{ padding:0 9px 0 4px; font-size:15px; line-height:1; border-radius:0 999px 999px 0; opacity:.8; }
.stkrb-chipgo button:hover{ color:var(--ink-0); }
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
    const svg = (d, w) => el('span', { html: '<svg width="' + (w || 14) + '" height="' + (w || 14) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>' }).firstChild;
    const ICON_LOCK = '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
    const ICON_WARN = '<path d="M12 4 2.8 19h18.4z"/><path d="M12 10v4M12 17h.01"/>';
    const ICON_PLUG = '<path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/>';
    // The full checklist lives in a bottom card (opened by "Where's my Rithmic login?").
    const appName = cfg.appName || 'Stryker Charts';
    const card = el('div', { class: 'stkrb-card', id: 'stkrb-card', role: 'dialog', 'aria-label': 'Where is my Rithmic login', hidden: true }, [
      el('div', { class: 'stkrb-grab' }),
      el('h4', null, [el('span', { text: 'Before you connect' }), el('button', { type: 'button', class: 'stkrb-cx', id: 'stkrb-card-x', text: 'Done' })]),
      el('ol', { class: 'stkrb-checks', id: 'stkrb-checks' }, [
        li([el('b', { text: 'A Rithmic login, not a website login' }), t('Your prop firm sends a separate Rithmic username and password. The one for their dashboard or website will not work here.')]),
        li([el('b', { text: 'The same system name as R | Trader Pro' }), t('Pick the system you choose when you sign in to R | Trader Pro.')]),
        li([el('b', { text: 'Active account with CME market data' }), t('The login must be active and have CME data switched on.')]),
        li([el('b', { text: 'New login? Accept the data agreements once' }), t('Sign in on '), el('a', { href: 'https://rithmic.com/rtraderpro-web', target: '_blank', rel: 'noopener', text: 'R | Trader Pro on the web' }), t(' and accept them. Until then Rithmic refuses market data.')]),
        li([el('b', { text: 'Demo and trial logins cannot connect' }), t('Use a funded, evaluation or live login that has market data.')]),
        li([el('b', { text: 'Some firms must allow \u201c' + appName + '\u201d first' }), t('If you see \u201cpermission denied\u201d, ask your firm\u2019s support to allow the app name ' + appName + ' for your login.')])
      ]),
      el('p', { class: 'stkrb-note', text: 'Data only. TradeZoro cannot place, change or close trades.' })
    ]);
    const back = el('div', { class: 'stkrb-back', id: 'stkrb-back', hidden: true });
    const setCard = (open) => { card.hidden = !open; back.hidden = !open; whereBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) card.scrollTop = 0; };
    back.addEventListener('click', (e) => { e.stopPropagation(); setCard(false); });
    card.addEventListener('click', (e) => e.stopPropagation());
    card.querySelector('#stkrb-card-x').addEventListener('click', () => { setCard(false); whereBtn.focus(); });
    document.body.appendChild(back);
    document.body.appendChild(card);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !card.hidden) { e.stopPropagation(); setCard(false); } }, true);
    const whereBtn = el('button', { type: 'button', class: 'stkrb-where', id: 'stkrb-where', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, [el('i', { text: '?', 'aria-hidden': 'true' }), el('span', { text: 'Where\u2019s my Rithmic login?' })]);
    whereBtn.addEventListener('click', () => setCard(true));
    // 3-step progress header: the current step lights up as the fields fill in.
    const progItems = ['Server', 'Prop firm', 'Login'].map((n, i) => el('li', null, [el('b', { text: String(i + 1) }), el('span', { text: n })]));
    const prog = el('ol', { class: 'stkrb-prog', id: 'stkrb-prog', 'aria-label': 'Connect steps' }, progItems);
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
    const gwField = el('label', { class: 'stkrb-f', hidden: (cfg.gateways || []).length < 2 }, [el('span', null, [el('em', { class: 'stkrb-n', text: '1', style: 'font-style:normal' }), t('Server location')]), gwSel, el('small', { class: 'stkrb-help', text: 'The nearest city is fastest. Chicago suits most people.' }), hint]);
    gwSel.addEventListener('change', () => { systemsLoaded = false; syncProg(); showErr(''); cfg.gateway = gwSel.value; lsSet(LS_GW, gwSel.value); showHint(); loadSystems(); });
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
      el('h3', { text: 'Connect your prop firm' }),
      el('p', { class: 'stkrb-lead', text: 'CME futures on the chart using your prop firm\u2019s Rithmic login. Data only.' }),
      prog,
      whereBtn,
      err,
      gwField,
      el('label', { class: 'stkrb-f' }, [el('span', null, [el('em', { class: 'stkrb-n', text: '2', style: 'font-style:normal' }), t('Prop firm')]), sys, sysBtn, el('small', { class: 'stkrb-help', id: 'stkrb-sys-hint', text: 'Pick the same name R | Trader Pro shows at sign-in.' })]),
      el('div', { class: 'stkrb-two' }, [
        el('label', { class: 'stkrb-f' }, [el('span', null, [el('em', { class: 'stkrb-n', text: '3', style: 'font-style:normal' }), t('Rithmic username')]), user]),
        el('label', { class: 'stkrb-f' }, [el('span', null, [el('em', { class: 'stkrb-n', text: '3', style: 'font-style:normal' }), t('Rithmic password')]), el('span', { class: 'stkrb-passwrap' }, [pass, eye])])
      ]),
      el('small', { class: 'stkrb-help', id: 'stkrb-login-hint', style: 'margin:-3px 0 8px', text: 'From your firm\u2019s Rithmic email, not the website login.' }),
      el('div', { class: 'stkrb-row' }, [el('label', { class: 'stkc-check' }, [remember, el('span', { text: 'Save username on this device' })])]),
      el('p', { class: 'stkrb-session', id: 'stkrb-session' }, [svg(ICON_WARN, 14), el('span', { text: 'One session per login: connecting can sign out your trading app. Don\u2019t connect mid-trade.' })]),
      go,
      el('p', { class: 'stkrb-lock', id: 'stkrb-lock' }, [svg(ICON_LOCK, 14), el('span', { text: 'Your login stays private: it goes from this device straight to Rithmic. We never see or store your password.' })]),
      testNote,
      el('p', { class: 'stkrb-helplink' }, [el('a', { href: HELP_URL, target: '_blank', rel: 'noopener', text: 'Help with connecting \u2192' })]),
      el('div', { class: 'stkrb-sheet-legal', id: 'stkrb-sheet-legal' }, [logos(), noticeList()])
    ]);
    let systemsLoaded = false;
    const syncProg = () => {
      const s1 = systemsLoaded, s2 = !!sys.value, s3 = !!(user.value.trim() && pass.value);
      const done = [s1, s1 && s2, s1 && s2 && s3];
      const cur = done.findIndex((d) => !d);
      progItems.forEach((n, i) => { n.className = done[i] ? 'done' : (i === cur ? 'on' : ''); if (done[i]) n.setAttribute('aria-label', ['Server', 'Prop firm', 'Login'][i] + ' done'); else n.removeAttribute('aria-label'); n.title = ''; });
    };
    [user, pass].forEach((x) => x.addEventListener('input', syncProg));
    sys.addEventListener('change', syncProg);
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
    syncProg();

    if (touch) { sys.classList.add('stkrb-nat'); } else { sysBtn.hidden = true; }
    sys.addEventListener('change', () => { syncBtn(); if (sys.value) lsSet(LS_SYS, sys.value); });
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
          sys.value = n; lsSet(LS_SYS, n); syncBtn(); syncProg(); sysList.hidden = true; } }));
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
      sysLoading = loadSystems2().finally(() => { sysLoading = null; syncBtn(); syncProg(); });
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
      setTimeout(() => { try { syncChip(); } catch (e) {} }, 0);
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

    // ---- chart shortcut: a small mint pill on the chart for signed-in members who are not connected, on futures ----
    // Hidden while connected, on non-futures symbols, for signed-out visitors, and for 7 days after the member taps the x.
    const go7 = el('button', { type: 'button', id: 'stkrb-chipgo-b', 'aria-label': 'Live futures: connect your prop firm login' }, [svg(ICON_PLUG, 14), el('span', { text: 'Live futures: connect' })]);
    const nogo = el('button', { type: 'button', class: 'x', id: 'stkrb-chipgo-x', 'aria-label': 'Hide for 7 days', title: 'Hide for 7 days', text: '\u00d7' });
    const chipGo = el('div', { class: 'stkrb-chipgo', id: 'stkrb-chipgo', hidden: true }, [go7, nogo]);
    document.body.appendChild(chipGo);
    const isFut = (sym) => /^futures:/i.test(sym || '') || /^[A-Z0-9]+1!$/i.test(sym || '');
    const signedIn = () => { try { return !!(typeof auth !== 'undefined' && auth && auth.currentUser && auth.currentUser.uid); } catch (e) { return false; } };
    const hiddenUntil = () => { const v = Number(lsGet(LS_HIDE)); return Number.isFinite(v) ? v : 0; };
    function placeChip() {
      const host = document.getElementById('vela-chart');
      if (!host) return false;
      const r = host.getBoundingClientRect();
      if (r.width < 200 || r.height < 120) return false;
      // top-right of the plot, left of the price axis; never over the toolbar
      // phones: under the symbol line (the line itself is full width), right side is free; desktop: top-right corner
      chipGo.style.top = Math.round(r.top + (r.width < 700 ? 40 : 6)) + 'px';
      chipGo.style.right = Math.max(8, Math.round(window.innerWidth - r.right + 64)) + 'px';
      return true;
    }
    function syncChip() {
      let sym = '';
      try { sym = (ws && ws.active && ws.active.symbol) || ''; } catch (e) {}
      const on = client.state === 'connected' || client.state === 'reconnecting';
      const show = signedIn() && !on && isFut(sym) && Date.now() >= hiddenUntil() && pop.hidden;
      chipGo.hidden = !(show && placeChip());
    }
    go7.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.stkc-pop').forEach((p) => { if (p !== pop && !p.hidden) p.hidden = true; });
      setOpen(true);
    });
    nogo.addEventListener('click', (e) => { e.stopPropagation(); lsSet(LS_HIDE, String(Date.now() + 7 * 864e5)); chipGo.hidden = true; });
    ['state:changed', 'layout:changed', 'cell:active'].forEach((ev) => { try { ws.on(ev, () => setTimeout(syncChip, 0)); } catch (e) {} });
    client.on(() => syncChip());
    window.addEventListener('resize', syncChip);
    const hostEl = document.getElementById('vela-chart');
    if (hostEl && window.ResizeObserver) new ResizeObserver(syncChip).observe(hostEl);
    setInterval(syncChip, 2000);   // cheap safety net: sign-in finishing, symbol swaps, the 7 days running out
    render();
    syncChip();
  }

  return { client, providerFactory, mount, api };
}
