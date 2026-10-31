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

import { RithmicClient, listSystems, explainLoginError } from './rithmic-client.js?v=769';
import { RithmicFuturesProvider, rithmicTradeSource, rithmicBookSource } from './rithmic-provider.js?v=769';

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
const HELP_URL = '/help#rithmic-connect';
// The chosen system is remembered per signed-in member (not a credential, so no checkbox needed).
const LS_SYS = (() => { try { const u = typeof auth !== 'undefined' && auth && auth.currentUser && auth.currentUser.uid; return 'stryker_rithmic_system' + (u ? '_' + u : ''); } catch (e) { return 'stryker_rithmic_system'; } })();

const CSS = `
/* ---- Connect sheet design tokens (--rz-*): native iOS / Material 3 bottom-sheet form. Reuse on other sheets. ---- */
:root{
  --rz-font:-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Google Sans", "Helvetica Neue", Arial, sans-serif;
  --rz-pad:20px; --rz-head-h:56px; --rz-tap:44px;
  --rz-field-h:52px; --rz-field-r:12px; --rz-field-px:14px; --rz-btn-r:14px;
  --rz-sheet-bg:var(--bg-1, #0b0b0d); --rz-field-bg:var(--bg-2, #131316); --rz-line:var(--line, #2c2c32);
  --rz-ink:var(--ink-0, #eee); --rz-ink-1:var(--ink-1, #c9cdd3); --rz-ink-2:var(--ink-2, #8b93a0);
  --rz-mint:var(--gold, #03c988); --rz-amber:var(--amber, #f5c542); --rz-red:#ff6b6b; --rz-on-mint:#050506;
  --rz-ring:0 0 0 2px var(--gold, #03c988);
  --rz-t-title:600 20px/26px var(--rz-font); --rz-t-step:500 13px/18px var(--rz-font); --rz-t-label:500 13px/18px var(--rz-font);
  --rz-t-value:400 17px/22px var(--rz-font); --rz-t-hint:400 13px/18px var(--rz-font); --rz-t-warn:500 13px/18px var(--rz-font);
  --rz-t-btn:600 17px/22px var(--rz-font); --rz-t-body:400 15px/20px var(--rz-font); --rz-t-legal:400 12px/18px var(--rz-font);
  --rz-chev:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%238b93a0' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
}
.stkrb-pop, .stkrb-card, .stkrb-syslist{ font-family:var(--rz-font); -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; text-rendering:optimizeLegibility; }
.stkrb-pop button, .stkrb-pop input, .stkrb-pop select, .stkrb-card button, .stkrb-syslist button, .stkrb-syslist input{ font-family:var(--rz-font); }
.stkrb-chip{ display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 9px; border-radius:999px;
  border:1px solid rgba(3,201,136,.45); color:var(--gold); font-family:inherit; font-weight:600; font-size:11.5px; line-height:1; white-space:nowrap; flex:none; }
@media (max-width:480px){ .stkrb-chip{ padding:0 7px; font-size:11px; gap:5px; } }
.stkrb-chip[hidden]{ display:none; }
.stkrb-chip i{ width:7px; height:7px; border-radius:50%; background:currentColor; box-shadow:0 0 0 3px rgba(3,201,136,.18); }
.stkrb-chip.warn{ color:var(--amber, #e8b04a); border-color:rgba(232,176,74,.45); }
.stkrb-chip.warn i{ box-shadow:0 0 0 3px rgba(232,176,74,.18); }
.stkrb-pop h3{ margin:0 0 10px; font-size:14px; color:var(--ink-0); }
.stkrb-brokers{ display:flex; gap:6px; margin:0 0 10px; }
.stkrb-broker{ flex:1; display:flex; flex-direction:column; align-items:flex-start; gap:2px; padding:8px 10px; border:1px solid var(--line);
  border-radius:8px; background:transparent; color:var(--ink-1); font:600 12.5px/1.2 inherit; font-family:inherit; text-align:left; cursor:pointer; }
.stkrb-broker[aria-checked="true"]{ border-color:var(--gold); color:var(--ink-0); }
.stkrb-broker:disabled{ opacity:.45; cursor:not-allowed; }
.stkrb-broker small{ font-weight:500; font-size:10.5px; color:var(--ink-3); }
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
@media (max-width:480px){ .stkrb-attr{ padding:3px 8px; gap:6px; } .stkrb-attr .stkrb-l-rith, .stkrb-attr .stkrb-l-omne{ height:16px; } }
.stkrb-err{ color:var(--rz-red); font:var(--rz-t-hint); font-size:14px; line-height:20px; margin:0 0 20px !important; padding:12px 14px; border:1px solid rgba(255,107,107,.4); border-radius:var(--rz-field-r); background:rgba(255,107,107,.08); overflow-wrap:anywhere; }
.stkrb-err .stkrb-copy{ display:inline-flex; align-items:center; margin-top:12px; height:var(--rz-tap); padding:0 16px; border:1px solid rgba(255,107,107,.5); border-radius:10px; background:transparent; color:inherit; font:600 15px/20px var(--rz-font); cursor:pointer; }
.stkrb-lead{ margin:0 0 20px !important; font:var(--rz-t-body); font-size:15px; line-height:22px; color:var(--rz-ink-2); }
.stkrb-form > h3{ margin:0; display:flex; align-items:center; min-height:var(--rz-head-h); font:var(--rz-t-title); letter-spacing:-.2px; color:var(--rz-ink); }
.stkrb-on > h3{ margin:0 0 8px; font:var(--rz-t-title); color:var(--rz-ink); }
.stkrb-prog{ display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:0 0 8px; padding:0; list-style:none; }
.stkrb-prog li{ position:relative; display:flex; align-items:center; gap:8px; min-width:0; padding-top:14px; font:var(--rz-t-step); color:var(--rz-ink-2); }
.stkrb-prog li::before{ content:''; position:absolute; left:0; right:0; top:0; height:4px; border-radius:999px; background:var(--rz-line); transition:background .2s; }
.stkrb-prog li b{ flex:none; display:inline-grid; place-items:center; width:18px; height:18px; border-radius:50%; border:1.5px solid var(--rz-line); font:600 11px/1 var(--rz-font); font-feature-settings:"tnum"; }
.stkrb-prog li span{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.stkrb-prog li.on{ color:var(--rz-ink); }
.stkrb-prog li.on::before{ background:var(--rz-mint); }
.stkrb-prog li.on b{ border-color:var(--rz-mint); color:var(--rz-mint); }
.stkrb-prog li.done{ color:var(--rz-ink-1); }
.stkrb-prog li.done::before{ background:var(--rz-mint); opacity:.55; }
.stkrb-prog li.done b{ background:var(--rz-mint); border-color:var(--rz-mint); font-size:0; }
.stkrb-prog li.done b::after{ content:''; width:8px; height:4px; border-left:2px solid var(--rz-on-mint); border-bottom:2px solid var(--rz-on-mint); transform:rotate(-45deg) translate(1px,-1px); }
.stkrb-where{ user-select:none; -webkit-tap-highlight-color:transparent; display:inline-flex; align-items:center; gap:8px; margin:0 0 8px; padding:0; border:0; background:transparent; color:var(--rz-mint); font:600 15px/20px var(--rz-font); cursor:pointer; min-height:var(--rz-tap); }
.stkrb-where i{ display:inline-grid; place-items:center; width:20px; height:20px; border-radius:50%; border:1.5px solid currentColor; font-style:normal; font-size:12px; font-weight:700; }
.stkrb-where:hover span{ text-decoration:underline; }
.stkrb-two{ display:grid; grid-template-columns:1fr; gap:20px; margin:0; }
.stkrb-two > .stkrb-f{ margin:0; }
.stkrb-pop .stkrb-session{ display:flex; gap:8px; align-items:flex-start; margin:12px 0 12px !important; font:var(--rz-t-warn); color:var(--rz-amber); }
.stkrb-session svg, .stkrb-lock svg{ flex:none; width:16px; height:16px; margin-top:1px; }
.stkrb-pop .stkrb-lock{ display:flex; gap:8px; align-items:flex-start; margin:12px 0 0 !important; font:var(--rz-t-hint); color:var(--rz-ink-2); }
.stkrb-lock svg{ color:var(--rz-mint); }
.stkrb-back{ position:fixed; inset:0; z-index:100010; background:rgba(0,0,0,.55); animation:rz-fade .2s ease-out; }
.stkrb-back[hidden], .stkrb-card[hidden]{ display:none; }
.stkrb-card{ position:fixed; left:0; right:0; bottom:0; z-index:100011; margin:0 auto; width:100%; max-width:480px; max-height:86vh; overflow-y:auto; box-sizing:border-box;
  padding:8px var(--rz-pad) calc(24px + env(safe-area-inset-bottom, 0px)); background:var(--rz-sheet-bg); color:var(--rz-ink); border:1px solid var(--rz-line); border-bottom:0; border-radius:20px 20px 0 0; box-shadow:0 -18px 40px -12px rgba(0,0,0,.6);
  overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:rgba(150,160,175,.35) transparent; animation:rz-up .24s ease-out; }
.stkrb-card::-webkit-scrollbar{ width:6px; }
.stkrb-card::-webkit-scrollbar-thumb{ background:rgba(150,160,175,.35); border-radius:3px; }
.stkrb-card::-webkit-scrollbar-thumb:hover{ background:rgba(150,160,175,.6); }
.stkrb-grab{ width:36px; height:4px; border-radius:999px; background:var(--rz-line); margin:4px auto 0; }
.stkrb-card h4{ margin:0; min-height:var(--rz-head-h); font:var(--rz-t-title); color:var(--rz-ink); display:flex; justify-content:space-between; align-items:center; gap:8px; }
.stkrb-xbtn{ flex:none; display:inline-grid; place-items:center; width:var(--rz-tap); height:var(--rz-tap); padding:0; border:0; border-radius:50%; background:rgba(150,160,175,.16); color:var(--rz-ink-1); cursor:pointer; -webkit-tap-highlight-color:transparent; }
.stkrb-xbtn:hover{ background:rgba(150,160,175,.26); color:var(--rz-ink); }
.stkrb-xbtn:focus-visible, .stkrb-eye:focus-visible, .stkrb-where:focus-visible, .stkrb-go:focus-visible{ outline:none; box-shadow:var(--rz-ring); }
.stkrb-checks{ list-style:none; counter-reset:c; margin:0 0 4px; padding:0; }
.stkrb-checks li{ counter-increment:c; position:relative; margin:0 0 16px; padding:0 0 0 36px; font:400 14px/20px var(--rz-font); color:var(--rz-ink-2); }
.stkrb-checks li::before{ content:counter(c); position:absolute; left:0; top:0; width:24px; height:24px; border-radius:50%; background:rgba(3,201,136,.16); color:var(--rz-mint); font:600 13px/1 var(--rz-font); display:grid; place-items:center; }
.stkrb-checks li b{ display:block; margin:0 0 2px; color:var(--rz-ink); font:600 15px/20px var(--rz-font); }
.stkrb-checks a, .stkrb-helplink a{ color:var(--rz-mint); }
.stkrb-card .stkrb-note{ margin:0 !important; padding-top:16px; font:var(--rz-t-hint); }
/* fields */
.stkrb-f{ display:block; margin:0 0 20px; }
.stkrb-f > span:first-child{ display:block; margin:0 0 8px; font:var(--rz-t-label); color:var(--rz-ink-2); }
.stkrb-pop .stkrb-f .stkc-in{ display:block; width:100%; height:var(--rz-field-h); box-sizing:border-box; padding:0 var(--rz-field-px); border:1px solid var(--rz-line); border-radius:var(--rz-field-r);
  background:var(--rz-field-bg); color:var(--rz-ink); font:var(--rz-t-value); -webkit-appearance:none; appearance:none; transition:box-shadow .12s, border-color .12s; }
.stkrb-pop .stkrb-f .stkc-in:focus{ outline:none; border-color:var(--rz-mint); box-shadow:var(--rz-ring); }
.stkrb-pop .stkrb-f select.stkc-in, .stkrb-pop .stkrb-f .stkrb-sysbtn{ padding-right:44px; background-image:var(--rz-chev); background-repeat:no-repeat; background-position:right 12px center; background-size:20px; }
.stkrb-sysbtn{ text-align:left; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.stkrb-sysbtn[hidden]{ display:none; }
.stkrb-sysbtn:disabled{ opacity:.6; }
.stkrb-pop .stkrb-f select.stkrb-nat{ display:none; }
.stkrb-pop .stkrb-f .stkrb-sysbtn[hidden]{ display:none; }
.stkrb-help, .stkrb-hint, .stkrb-raw{ display:block; margin-top:6px; font:var(--rz-t-hint); color:var(--rz-ink-2); }
.stkrb-hint{ margin-top:4px; }
.stkrb-hint[hidden]{ display:none; }
.stkrb-hint a{ display:inline-block; padding:8px 6px; margin:-8px -2px; color:var(--rz-mint); font-weight:600; }
.stkrb-help.stkrb-login-hint{ margin:6px 0 20px; }
.stkrb-raw{ margin-top:8px; overflow-wrap:anywhere; }
.stkrb-err[hidden]{ display:none; }
.stkrb-passwrap{ position:relative; display:block; }
.stkrb-pop .stkrb-passwrap .stkc-in{ padding-right:52px; }
.stkrb-eye{ position:absolute; right:4px; top:50%; transform:translateY(-50%); display:grid; place-items:center; width:var(--rz-tap); height:var(--rz-tap); padding:0; border:0; border-radius:50%; background:transparent; color:var(--rz-ink-2); cursor:pointer; -webkit-tap-highlight-color:transparent; }
.stkrb-eye:hover{ color:var(--rz-ink); }
.stkrb-row{ display:block; margin:0; }
.stkrb-pop .stkrb-row .stkc-check{ display:flex; align-items:center; gap:12px; min-height:var(--rz-tap); padding:0; font:var(--rz-t-body); color:var(--rz-ink-1); cursor:pointer; -webkit-tap-highlight-color:transparent; }
.stkrb-pop .stkrb-row .stkc-check input{ flex:none; -webkit-appearance:none; appearance:none; width:22px; height:22px; margin:0; border:1.5px solid var(--rz-ink-2); border-radius:6px; background:transparent; display:grid; place-items:center; cursor:pointer; transition:background .12s, border-color .12s; }
.stkrb-pop .stkrb-row .stkc-check input:checked{ background:var(--rz-mint); border-color:var(--rz-mint); }
.stkrb-pop .stkrb-row .stkc-check input:checked::after{ content:''; width:10px; height:5px; border-left:2.2px solid var(--rz-on-mint); border-bottom:2.2px solid var(--rz-on-mint); transform:rotate(-45deg) translate(1px,-1px); }
.stkrb-pop .stkrb-row .stkc-check input:focus-visible{ outline:none; box-shadow:var(--rz-ring); }
/* primary button */
.stkrb-pop .stkrb-go{ display:block; width:100%; height:52px; padding:0 16px; border:0; border-radius:var(--rz-btn-r); background:var(--rz-mint); color:var(--rz-on-mint); font:var(--rz-t-btn); letter-spacing:-.1px; cursor:pointer; -webkit-tap-highlight-color:transparent; transition:filter .12s, transform .08s; }
.stkrb-pop .stkrb-go:active:not(:disabled){ transform:scale(.99); filter:brightness(.94); }
.stkrb-pop .stkrb-go:disabled{ opacity:1; background:rgba(150,160,175,.18); color:var(--rz-ink-2); cursor:default; }
.stkrb-pop .stkrb-helplink{ margin:20px 0 0 !important; font:600 15px/20px var(--rz-font); }
.stkrb-helplink a{ display:inline-flex; align-items:center; min-height:var(--rz-tap); margin:-12px 0; }
.stkrb-on p{ font:var(--rz-t-body); color:var(--rz-ink-1); }
.stkrb-on b{ color:var(--rz-ink); }
.stkrb-ids{ margin:0 0 12px; font:var(--rz-t-hint); color:var(--rz-ink-2); overflow-wrap:anywhere; }
.stkrb-ids span{ display:block; }
.stkrb-ids code{ font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; color:var(--rz-ink-1); user-select:all; }
.stkrb-off{ width:100%; height:var(--rz-field-h); margin-top:4px; border:1px solid var(--rz-line); border-radius:var(--rz-btn-r); background:transparent; color:var(--rz-ink); font:var(--rz-t-btn); cursor:pointer; }
.stkrb-off:hover{ border-color:var(--red, #e5484d); color:var(--red, #e5484d); }
/* system picker (phones) */
.stkrb-syslist{ position:fixed; inset:0; z-index:100000; background:var(--rz-sheet-bg); display:flex; flex-direction:column; padding:8px var(--rz-pad) env(safe-area-inset-bottom, 0px); gap:12px; box-sizing:border-box; }
.stkrb-syslist[hidden]{ display:none; }
.stkrb-syshead{ display:flex; align-items:center; justify-content:space-between; min-height:var(--rz-head-h); color:var(--rz-ink); font:var(--rz-t-title); }
.stkrb-sysx{ height:var(--rz-tap); padding:0 4px; border:0; background:transparent; color:var(--rz-mint); font:600 17px/22px var(--rz-font); cursor:pointer; }
.stkrb-syslist > input{ width:100%; flex:none; height:var(--rz-field-h); box-sizing:border-box; padding:0 var(--rz-field-px); border:1px solid var(--rz-line); border-radius:var(--rz-field-r); background:var(--rz-field-bg); color:var(--rz-ink); font:var(--rz-t-value); }
.stkrb-syslist > input:focus{ outline:none; border-color:var(--rz-mint); box-shadow:var(--rz-ring); }
.stkrb-sysrows{ flex:1; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:rgba(150,160,175,.35) transparent; }
.stkrb-sysrows::-webkit-scrollbar{ width:6px; }
.stkrb-sysrows::-webkit-scrollbar-thumb{ background:rgba(150,160,175,.35); border-radius:3px; }
.stkrb-sysrow{ display:block; width:100%; min-height:56px; text-align:left; padding:0 4px; border:0; border-bottom:1px solid var(--rz-line); background:transparent; color:var(--rz-ink); font:var(--rz-t-value); cursor:pointer; }
.stkrb-sysrow.on{ color:var(--rz-mint); font-weight:600; }
/* the sheet: popover on desktop, bottom sheet on phones */
.stkc-pop.stkrb-pop{ width:440px; max-width:calc(100vw - 16px); padding:0 var(--rz-pad) var(--rz-pad); box-sizing:border-box; background:var(--rz-sheet-bg); color:var(--rz-ink); border-radius:16px; }
.stkrb-grab-s, .stkrb-fullx{ display:none; }
.stkc-pop.stkrb-pop.stkrb-full{ position:fixed; inset:calc(env(safe-area-inset-top, 0px) + 16px) 0 0 0; width:auto; max-width:none; min-width:0; max-height:none; height:auto; z-index:99990;
  border:1px solid var(--rz-line); border-bottom:0; border-radius:20px 20px 0 0; padding:0 var(--rz-pad) calc(24px + env(safe-area-inset-bottom, 0px)); overflow-y:auto; overscroll-behavior:contain;
  box-shadow:0 0 0 100vmax rgba(0,0,0,.55); scrollbar-width:thin; scrollbar-color:rgba(150,160,175,.35) transparent; }
.stkrb-pop:not([hidden]).stkrb-full{ animation:rz-up .24s ease-out; }
.stkrb-full::-webkit-scrollbar{ width:6px; }
.stkrb-full::-webkit-scrollbar-thumb{ background:rgba(150,160,175,.35); border-radius:3px; }
.stkrb-full .stkrb-grab-s{ display:block; position:absolute; top:8px; left:50%; width:36px; height:4px; margin-left:-18px; border-radius:999px; background:var(--rz-line); }
.stkrb-full .stkrb-fullx{ display:grid; position:absolute; top:6px; right:12px; z-index:3; }
.stkrb-full .stkrb-form > h3{ padding:6px 52px 0 0; box-sizing:border-box; }
.stkrb-sheet-legal{ margin:24px 0 0; padding-top:16px; border-top:1px solid var(--rz-line); }
.stkrb-sheet-legal .stkrb-logos{ margin:0 0 12px; gap:16px; align-items:center; }
.stkrb-sheet-legal .stkrb-legal{ font:var(--rz-t-legal); color:var(--rz-ink-2); }
.stkrb-sheet-legal .stkrb-legal li{ margin:0 0 8px; }
.stkrb-sheet-legal .stkrb-legal li:last-child{ margin:0; }
.stkrb-pop .stkrb-note{ margin:12px 0 0 !important; font:var(--rz-t-hint); color:var(--rz-ink-2); }
.stkrb-note.stkrb-test{ border-top:0; padding-top:0; color:var(--rz-amber); }
@media (min-width:481px){ .stkrb-two{ grid-template-columns:1fr 1fr; gap:12px; } }
@media (min-width:361px) and (max-width:480px){ .stkrb-two{ grid-template-columns:1fr; } }
@keyframes rz-up{ from{ transform:translateY(100%); } to{ transform:none; } }
@keyframes rz-fade{ from{ opacity:0; } to{ opacity:1; } }
@media (prefers-reduced-motion:reduce){ .stkrb-pop:not([hidden]).stkrb-full, .stkrb-card{ animation:rz-fade .2s linear; } }
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
const EYE_ON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.5A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.2-.9M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const X_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
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
      pop.appendChild(el('div', { class: 'stkrb-grab-s', 'aria-hidden': 'true' }));
      pop.appendChild(el('button', { type: 'button', class: 'stkrb-xbtn stkrb-fullx', 'aria-label': 'Close', html: X_ICON, onclick: () => setOpen(false) }));
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
    // The full checklist lives in a bottom card (opened by "Where's my Rithmic login?").
    const appName = cfg.appName;
    const card = el('div', { class: 'stkrb-card', id: 'stkrb-card', role: 'dialog', 'aria-label': 'Where is my Rithmic login', hidden: true }, [
      el('div', { class: 'stkrb-grab' }),
      el('h4', null, [el('span', { text: 'Before you connect' }), el('button', { type: 'button', class: 'stkrb-xbtn', id: 'stkrb-card-x', 'aria-label': 'Close', html: X_ICON })]),
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
    const gwField = el('label', { class: 'stkrb-f', hidden: (cfg.gateways || []).length < 2 }, [el('span', null, [t('Server location')]), gwSel, el('small', { class: 'stkrb-help', text: 'The nearest city is fastest. Chicago suits most people.' }), hint]);
    gwSel.addEventListener('change', () => { systemsLoaded = false; syncProg(); showErr(''); cfg.gateway = gwSel.value; lsSet(LS_GW, gwSel.value); showHint(); loadSystems(); });
    setTimeout(showHint, 0);
    const sys = el('select', { class: 'stkc-in', id: 'stkrb-sys', required: true, 'aria-label': 'Rithmic system' });
    const touch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    // Phones: our own tappable list instead of the native picker (Android closes that one on any layout change).
    const sysBtn = el('button', { type: 'button', class: 'stkc-in stkrb-sysbtn', id: 'stkrb-sysbtn', 'aria-haspopup': 'listbox', text: 'Loading systems...' });
    const user = el('input', { class: 'stkc-in', id: 'stkrb-user', type: 'text', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true });
    const pass = el('input', { class: 'stkc-in', id: 'stkrb-pass', type: 'password', autocomplete: 'current-password', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true });
    const eye = el('button', { type: 'button', class: 'stkrb-eye', 'aria-label': 'Show password', 'aria-pressed': 'false', html: EYE_ON });
    eye.addEventListener('click', () => { const show = pass.type === 'password'; pass.type = show ? 'text' : 'password'; eye.innerHTML = show ? EYE_OFF : EYE_ON; eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); eye.setAttribute('aria-pressed', show ? 'true' : 'false'); });
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
      el('label', { class: 'stkrb-f' }, [el('span', null, [t('Prop firm')]), sys, sysBtn, el('small', { class: 'stkrb-help', id: 'stkrb-sys-hint', text: 'Pick the same name R | Trader Pro shows at sign-in.' })]),
      el('div', { class: 'stkrb-two' }, [
        el('label', { class: 'stkrb-f' }, [el('span', null, [t('Rithmic username')]), user]),
        el('label', { class: 'stkrb-f' }, [el('span', null, [t('Rithmic password')]), el('span', { class: 'stkrb-passwrap' }, [pass, eye])])
      ]),
      el('small', { class: 'stkrb-help stkrb-login-hint', id: 'stkrb-login-hint', text: 'From your firm\u2019s Rithmic email, not the website login.' }),
      el('div', { class: 'stkrb-row' }, [el('label', { class: 'stkc-check' }, [remember, el('span', { text: 'Save username on this device' })])]),
      el('div', { id: 'stkrb-save-slot' }),
      el('p', { class: 'stkrb-session', id: 'stkrb-session' }, [svg(ICON_WARN, 14), el('span', { text: 'One session per login: connecting can sign out your trading app. Don\u2019t connect mid-trade.' })]),
      go,
      el('p', { class: 'stkrb-lock', id: 'stkrb-lock' }, [svg(ICON_LOCK, 14), el('span', { text: 'Your login stays private: it goes from this device straight to Rithmic. We never see or store your password.' })]),
      testNote,
      el('p', { class: 'stkrb-helplink' }, [el('a', { href: HELP_URL, target: '_blank', rel: 'noopener', text: 'Help with connecting \u2192' })]),
      el('div', { class: 'stkrb-sheet-legal', id: 'stkrb-sheet-legal' }, [logos(), noticeList()])
    ]);
    let systemsLoaded = false;
    let busy = false;
    const syncProg = () => {
      const s1 = systemsLoaded, s2 = !!sys.value, s3 = !!(user.value.trim() && pass.value);
      const done = [s1, s1 && s2, s1 && s2 && s3];
      const cur = done.findIndex((d) => !d);
      go.disabled = busy || !(s2 && s3);
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
          const txt = 'ZoroCharts connect error\nSystem: ' + (sys.value || '-') + '\nGateway: ' + (gw ? gw.label : '-') + '\nMessage: ' + m + (raw ? '\nRithmic said: ' + raw : '') + '\nTime: ' + new Date().toISOString();
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

    // Saved login (ships OFF): assets/rithmic-saved.js answers { available:false } until the server switch and key exist,
    // so nothing below shows or runs by default. Default for the checkbox is OFF.
    let savedHook = null;
    function loadSaved() {
      if (window.strykerRithmicSaved) return Promise.resolve(window.strykerRithmicSaved);
      return new Promise((res) => { const sc = document.createElement('script'); sc.src = 'assets/rithmic-saved.js?v=769'; sc.onload = () => res(window.strykerRithmicSaved || null); sc.onerror = () => res(null); document.head.appendChild(sc); });
    }
    loadSaved().then((m) => m && m.sheetHook()).then((h) => {
      if (!h) return; savedHook = h;
      const slot = form.querySelector('#stkrb-save-slot'); if (!slot) return;
      h.mount(slot);
      slot.querySelectorAll('.rjs-check-row').forEach((n) => { n.className = 'stkc-check'; });
      slot.querySelectorAll('.rjs-hint').forEach((n) => { n.className = 'stkrb-help'; n.removeAttribute('style'); });
    }).catch(() => {});

    async function doConnect() {
      showErr('');
      const u = user.value.trim();
      const p = pass.value;
      const s = sys.value;
      if (!s) { showErr('Choose your Rithmic system (your prop firm or broker).'); return; }
      if (!u || !p) { showErr('Enter your Rithmic username and password.'); return; }
      busy = true; go.disabled = true; go.textContent = 'Connecting...';
      pass.value = ''; // the client holds it in memory from here
      lsSet(LS_USER, remember.checked ? u : '');
      lsSet(LS_SYS, s);
      try {
        await client.connect({ user: u, password: p, systemName: s, gateway: gwSel.value || cfg.gateway });
        if (savedHook && savedHook.afterLogin) { try { await savedHook.afterLogin({ system: s, user: u, password: p, gateway: gwSel.value || cfg.gateway }); } catch (e2) {} }
        toast('Connected to Rithmic');
        setOpen(false);
      } catch (e) {
        const gw = (cfg.gateways || []).find((g) => g.uri === (gwSel.value || cfg.gateway));
        const r = explainLoginError({ codes: e && e.rpRaw, text: e && e.message, system: s, gateway: gw && gw.label, appName: cfg.appName });
        showErr(r.message, r.raw || '');
      } finally {
        busy = false; go.textContent = 'Connect'; syncProg();
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
    // The one entry point other modules use (the delayed-data banner, assets/chart-data-banner.js): opens the Connect broker sheet.
    api.open = () => { document.querySelectorAll('.stkc-pop').forEach((p) => { if (p !== pop && !p.hidden) p.hidden = true; }); setOpen(true) };
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

    // Charts auto-connect with a saved login (ships OFF: ticket() resolves null unless the server switch, the key and a saved row exist).
    // Runs once per page load, never retries on failure, and never when the member is already connected.
    loadSaved().then((m) => (m ? m.ticket() : null)).then(async (tk) => {
      if (!tk || !tk.password || (api.state && api.state !== 'idle')) return;
      try { await client.connect({ user: tk.username, password: tk.password, systemName: tk.system, gateway: tk.gateway || cfg.gateway }); toast('Reconnected to Rithmic with your saved login'); }
      catch (e) { const r = explainLoginError({ codes: e && e.rpRaw, text: e && e.message, system: tk.system, appName: cfg.appName }); toast(r.message, 'error'); }
    }).catch(() => {});
  }

  return { client, providerFactory, mount, api };
}
