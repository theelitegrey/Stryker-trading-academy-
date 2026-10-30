// TradeZoro — Journal: "Import from Rithmic" sheet (ES module, loaded on demand by assets/journal-rithmic.js)
// Depends on: assets/rithmic-client.js (listSystems, explainLoginError), assets/rithmic-orders.js (read-only
// order-history session), assets/rithmic-fills.js (fills -> round trips), assets/rithmic-config.js
// (journalRithmicConfig), and the journal page globals: db, firebase, JOURNAL_UID, JOURNAL_TRADES,
// JOURNAL_SETTINGS, journalFormatCurrency, escapeJournalHtml, reloadJournalData, showToast.
//
// DATA ONLY. This sheet reads accounts and order history; it has no order buttons and no code path that
// can send an order (see the allowlist in rithmic-orders.js).
// The password goes from the input to the in-memory session and nowhere else; the input is cleared at once.
// Rithmic allows one login at a time for some firms, so the order session is closed after the history is
// read (and after 3 idle minutes, or when the sheet closes).

import { listSystems, explainLoginError } from './rithmic-client.js?v=749';
import { RithmicOrderHistory, explainHistoryError, tradeDateCT } from './rithmic-orders.js?v=749';
import { fillsFromNotes, buildTrips, tripToJournalTrade, planImport, tripDocId, crossCheck, pointValueFor, rootOf, zoneParts, EXCHANGE_TZ, IST_TZ } from './rithmic-fills.js?v=749';
import { journalRithmicConfig } from './rithmic-config.js?v=749';

const FREE_MONTHLY = 20;        // mirrors assets/plan-limits.js
const IDLE_MS = 3 * 60 * 1000;
const LS_GW = 'stryker_rithmic_gateway', LS_SYS = 'stryker_rithmic_system', LS_USER = 'stryker_rithmic_user';
const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const toast = (type, m) => { try { window.showToast(type, m); } catch (e) {} };

const CSS = `
.rjs-back{ position:fixed; inset:0; z-index:100010; background:rgba(0,0,0,.55); display:flex; align-items:flex-end; justify-content:center; animation:rjs-fade .2s cubic-bezier(.2,0,0,1); }
.rjs{ --rz-font:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display",Roboto,"Segoe UI",system-ui,sans-serif;
  --rz-pad:20px; --rz-tap:44px; --rz-field-h:52px; --rz-field-r:12px; --rz-btn-r:14px;
  --rz-bg:var(--bg-1,#0b0b0d); --rz-field:var(--bg-2,#131316); --rz-line:var(--line,#2c2c32);
  --rz-ink:var(--ink-0,#f2f2f4); --rz-ink-1:var(--ink-1,#c9cdd3); --rz-ink-2:var(--ink-2,#8b93a0);
  --rz-mint:var(--gold,#03c988); --rz-amber:var(--amber,#f5c542); --rz-red:#ff6b6b; --rz-on-mint:#050506;
  --rz-ring:0 0 0 2px var(--gold,#03c988);
  position:relative; width:100%; max-width:560px; max-height:92vh; overflow-y:auto; box-sizing:border-box; overscroll-behavior:contain;
  padding:8px var(--rz-pad) calc(24px + env(safe-area-inset-bottom,0px)); background:var(--rz-bg); color:var(--rz-ink);
  border:1px solid var(--rz-line); border-bottom:0; border-radius:20px 20px 0 0; font-family:var(--rz-font); -webkit-font-smoothing:antialiased;
  box-shadow:0 -18px 40px -12px rgba(0,0,0,.6); animation:rjs-up .3s cubic-bezier(.2,0,0,1); }
.rjs *{ box-sizing:border-box; font-family:inherit; }
.rjs-grab{ width:36px; height:4px; border-radius:999px; background:var(--rz-line); margin:4px auto 0; }
.rjs-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:56px; }
.rjs-head h2{ margin:0; font:600 20px/26px var(--rz-font); letter-spacing:-.2px; color:var(--rz-ink); }
.rjs-x{ flex:none; display:inline-grid; place-items:center; width:var(--rz-tap); height:var(--rz-tap); padding:0; border:0; border-radius:50%; background:rgba(150,160,175,.16); color:var(--rz-ink-1); cursor:pointer; }
.rjs-x:hover{ background:rgba(150,160,175,.26); color:var(--rz-ink); }
.rjs button:focus-visible,.rjs input:focus-visible,.rjs select:focus-visible{ outline:none; box-shadow:var(--rz-ring); }
.rjs-lead{ margin:0 0 16px; font:400 15px/22px var(--rz-font); color:var(--rz-ink-2); }
.rjs-f{ display:block; margin:0 0 16px; }
.rjs-f > span{ display:block; margin:0 0 8px; font:500 13px/18px var(--rz-font); color:var(--rz-ink-2); }
.rjs-in{ display:block; width:100%; height:var(--rz-field-h); padding:0 14px; border:1px solid var(--rz-line); border-radius:var(--rz-field-r); background:var(--rz-field); color:var(--rz-ink); font:400 16px/22px var(--rz-font); -webkit-appearance:none; appearance:none; }
.rjs-in:focus{ outline:none; border-color:var(--rz-mint); box-shadow:var(--rz-ring); }
select.rjs-in{ padding-right:44px; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%238b93a0' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 12px center; background-size:20px; }
.rjs-two{ display:grid; grid-template-columns:1fr; gap:0 12px; }
@media (min-width:481px){ .rjs-two{ grid-template-columns:1fr 1fr; } }
.rjs-hint{ display:block; margin-top:6px; font:400 12px/16px var(--rz-font); color:var(--rz-ink-2); }
.rjs-note{ display:flex; gap:8px; align-items:flex-start; margin:0 0 16px; font:500 13px/18px var(--rz-font); color:var(--rz-amber); }
.rjs-note svg{ flex:none; width:16px; height:16px; margin-top:1px; }
.rjs-lock{ display:flex; gap:8px; align-items:flex-start; margin:16px 0 0; font:400 12px/16px var(--rz-font); color:var(--rz-ink-2); }
.rjs-lock svg{ flex:none; width:16px; height:16px; color:var(--rz-mint); }
.rjs-err{ margin:0 0 16px; padding:12px 14px; border:1px solid rgba(255,107,107,.4); border-radius:var(--rz-field-r); background:rgba(255,107,107,.08); color:var(--rz-red); font:400 14px/20px var(--rz-font); overflow-wrap:anywhere; }
.rjs-err small{ display:block; margin-top:6px; font:400 12px/16px var(--rz-font); opacity:.85; }
.rjs-go{ display:block; width:100%; height:52px; padding:0 16px; border:0; border-radius:var(--rz-btn-r); background:var(--rz-mint); color:var(--rz-on-mint); font:600 17px/22px var(--rz-font); cursor:pointer; transition:filter .15s; }
.rjs-go:active:not(:disabled){ filter:brightness(.94); }
.rjs-go:disabled{ background:rgba(150,160,175,.18); color:var(--rz-ink-2); cursor:default; }
.rjs-ghost{ display:block; width:100%; height:48px; margin-top:8px; padding:0 16px; border:1px solid var(--rz-line); border-radius:var(--rz-btn-r); background:transparent; color:var(--rz-ink); font:600 15px/20px var(--rz-font); cursor:pointer; }
.rjs-ghost:hover{ border-color:var(--rz-ink-2); }
.rjs-rows{ list-style:none; margin:0 0 16px; padding:0; border:1px solid var(--rz-line); border-radius:12px; overflow:hidden; }
.rjs-row{ display:flex; align-items:center; gap:12px; width:100%; min-height:56px; padding:8px 14px; border:0; border-bottom:1px solid var(--rz-line); background:transparent; color:var(--rz-ink); text-align:left; cursor:pointer; font:400 15px/20px var(--rz-font); }
.rjs-row:last-child{ border-bottom:0; }
.rjs-row[aria-checked="true"]{ background:rgba(3,201,136,.08); }
.rjs-row i{ flex:none; width:22px; height:22px; border-radius:50%; border:1.5px solid var(--rz-ink-2); display:grid; place-items:center; }
.rjs-row[aria-checked="true"] i{ border-color:var(--rz-mint); background:var(--rz-mint); }
.rjs-row[aria-checked="true"] i::after{ content:''; width:10px; height:5px; border-left:2.2px solid var(--rz-on-mint); border-bottom:2.2px solid var(--rz-on-mint); transform:rotate(-45deg) translate(1px,-1px); }
.rjs-row[role=checkbox] i{ border-radius:6px; }
.rjs-row b{ display:block; font-weight:600; }
.rjs-row small{ display:block; font:400 12px/16px var(--rz-font); color:var(--rz-ink-2); }
.rjs-seg{ display:grid; grid-template-columns:repeat(3,1fr); gap:4px; padding:4px; margin:0 0 16px; border-radius:12px; background:var(--rz-field); border:1px solid var(--rz-line); }
.rjs-seg button{ height:40px; border:0; border-radius:8px; background:transparent; color:var(--rz-ink-2); font:600 13px/18px var(--rz-font); cursor:pointer; }
.rjs-seg button[aria-checked="true"]{ background:var(--rz-mint); color:var(--rz-on-mint); }
.rjs-sub{ margin:0 0 8px; font:500 13px/18px var(--rz-font); color:var(--rz-ink-2); }
.rjs-sum{ display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:0 0 16px; }
.rjs-sum div{ padding:12px; border:1px solid var(--rz-line); border-radius:12px; background:var(--rz-field); }
.rjs-sum b{ display:block; font:600 17px/22px var(--rz-font); font-variant-numeric:tabular-nums; }
.rjs-sum span{ font:400 12px/16px var(--rz-font); color:var(--rz-ink-2); }
.rjs-up{ color:var(--bull,#03c988); } .rjs-down{ color:var(--bear,#ff6b6b); }
.rjs-tablewrap{ overflow-x:auto; margin:0 0 16px; border:1px solid var(--rz-line); border-radius:12px; }
.rjs-table{ width:100%; min-width:640px; border-collapse:collapse; font:400 13px/18px var(--rz-font); font-variant-numeric:tabular-nums; }
.rjs-table th{ padding:10px 12px; text-align:left; font:500 12px/16px var(--rz-font); color:var(--rz-ink-2); border-bottom:1px solid var(--rz-line); white-space:nowrap; }
.rjs-table td{ padding:10px 12px; border-bottom:1px solid var(--rz-line); white-space:nowrap; }
.rjs-table tr:last-child td{ border-bottom:0; }
.rjs-table .r{ text-align:right; }
.rjs-cards{ display:none; flex-direction:column; gap:8px; margin:0 0 16px; }
.rjs-card{ padding:12px 14px; border:1px solid var(--rz-line); border-radius:12px; background:var(--rz-field); }
.rjs-card .t{ display:flex; justify-content:space-between; align-items:baseline; gap:8px; font:600 15px/20px var(--rz-font); }
.rjs-card .m{ margin-top:4px; font:400 12px/16px var(--rz-font); color:var(--rz-ink-2); font-variant-numeric:tabular-nums; }
.rjs-card .m span{ display:block; }
.rjs-pv{ display:flex; gap:8px; align-items:center; margin:0 0 8px; }
.rjs-pv .rjs-in{ height:48px; }
.rjs-check{ margin:0 0 16px; padding:12px 14px; border:1px solid var(--rz-line); border-radius:12px; font:400 13px/18px var(--rz-font); color:var(--rz-ink-1); }
.rjs-check.ok{ border-color:rgba(3,201,136,.4); } .rjs-check.warn{ border-color:rgba(245,197,66,.45); color:var(--rz-amber); }
.rjs-cap{ margin:0 0 16px; padding:12px 14px; border:1px solid rgba(245,197,66,.45); border-radius:12px; font:400 13px/18px var(--rz-font); color:var(--rz-ink-1); }
.rjs-cap a{ color:var(--rz-mint); font-weight:600; }
.rjs-done{ text-align:center; padding:24px 0 8px; }
.rjs-done b{ display:block; font:600 20px/26px var(--rz-font); margin-bottom:8px; }
.rjs-done p{ margin:0 0 20px; font:400 15px/22px var(--rz-font); color:var(--rz-ink-2); }
.rjs-fine{ margin:16px 0 0; font:400 12px/16px var(--rz-font); color:var(--rz-ink-2); }
.rjs-check-row{ display:flex; align-items:center; gap:12px; min-height:var(--rz-tap); font:400 15px/20px var(--rz-font); color:var(--rz-ink-1); cursor:pointer; margin:0 0 8px; }
.rjs-check-row input{ flex:none; width:22px; height:22px; accent-color:var(--rz-mint); margin:0; }
.rjs-spin{ display:inline-block; width:16px; height:16px; margin-right:8px; vertical-align:-3px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:rjs-spin .8s linear infinite; }
@media (min-width:641px){
  .rjs-back{ align-items:center; }
  .rjs.rjs-wide{ max-width:920px; }
  .rjs{ border-radius:16px; border-bottom:1px solid var(--rz-line); max-height:88vh; padding-bottom:24px; animation:rjs-fade .2s cubic-bezier(.2,0,0,1); }
  .rjs-grab{ display:none; }
}
@media (max-width:640px){ .rjs-table,.rjs-tablewrap{ display:none; } .rjs-cards{ display:flex; } .rjs-sum b{ font-size:15px; } }
@keyframes rjs-up{ from{ transform:translateY(100%); } to{ transform:none; } }
@keyframes rjs-fade{ from{ opacity:0; } to{ opacity:1; } }
@keyframes rjs-spin{ to{ transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce){ .rjs,.rjs-back{ animation:none; } .rjs-spin{ animation-duration:2s; } }
`;

const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4 2.8 19h18.4z"/><path d="M12 10v4M12 17h.01"/></svg>';
const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const X_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

const fmtDate = (d) => d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
const money = (v) => { const c = (typeof JOURNAL_SETTINGS !== 'undefined' && JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD'; try { return journalFormatCurrency(v, c); } catch (e) { return '$' + Number(v).toFixed(2); } };
const fmtTime = (ms, tz) => { const z = zoneParts(ms, tz); return z.date.slice(5) + ' ' + z.time; };
const px = (v) => (Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

export function openRithmicJournalImport({ uid, savedLogin } = {}) {
  const cfg = journalRithmicConfig(uid);
  if (!cfg) { toast('error', 'Rithmic is not available yet.'); return; }
  if (!document.getElementById('rjs-css')) { const s = document.createElement('style'); s.id = 'rjs-css'; s.textContent = CSS; document.head.appendChild(s); }

  const back = document.createElement('div'); back.className = 'rjs-back'; back.id = 'rjs-back';
  const sheet = document.createElement('div'); sheet.className = 'rjs'; sheet.id = 'rjs'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Import from Rithmic');
  back.appendChild(sheet); document.body.appendChild(back);
  const prevFocus = document.activeElement;

  const S = { step: 'login', hist: null, idle: 0, accounts: [], dates: [], account: null, mode: 'last5', picked: new Set(), trips: [], open: [], pv: {}, check: null, gwLabel: '', busy: false, today: tradeDateCT(Date.now()), imported: null };
  // For tests/automation only: connection facts, never credentials.
  window.STRYKER_RJOURNAL = { get step() { return S.step; }, get sent() { return S.hist ? S.hist.sent.slice() : []; } };

  async function endSession() {
    clearTimeout(S.idle);
    const h = S.hist; S.hist = null;
    if (h) { try { await h.close(); } catch (e) {} }
  }
  const armIdle = () => { clearTimeout(S.idle); S.idle = setTimeout(() => { endSession(); if (S.step === 'pick') { S.step = 'login'; draw('Your Rithmic session ended after a few idle minutes. Log in again to continue.'); } }, IDLE_MS); };
  function close() { endSession(); back.remove(); document.removeEventListener('keydown', onKey, true); delete window.STRYKER_RJOURNAL; try { prevFocus && prevFocus.focus(); } catch (e) {} }
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });

  const head = (title) => '<div class="rjs-grab"></div><div class="rjs-head"><h2>' + esc(title) + '</h2><button type="button" class="rjs-x" id="rjs-x" aria-label="Close">' + X_ICON + '</button></div>';
  const wireX = () => { const x = sheet.querySelector('#rjs-x'); if (x) x.addEventListener('click', close); };

  // ---------------------------------------------------------------- step 1: log in
  let sysLoaded = false;
  function drawLogin(error, raw) {
    const gws = cfg.gateways || [];
    const savedGw = lsGet(LS_GW);
    const gwVal = gws.some((g) => g.uri === savedGw) ? savedGw : cfg.gateway;
    sheet.innerHTML = head('Import from Rithmic') +
      '<p class="rjs-lead">Bring in trades you took elsewhere on the same account. Data only: we read your order history and never place or change an order.</p>' +
      (error ? '<div class="rjs-err" id="rjs-err" role="alert">' + esc(error) + (raw ? '<small>Rithmic said: ' + esc(raw) + '</small>' : '') + '</div>' : '') +
      '<label class="rjs-f"' + (gws.length < 2 ? ' hidden' : '') + '><span>Server location</span><select class="rjs-in" id="rjs-gw">' + gws.map((g) => '<option value="' + esc(g.uri) + '"' + (g.uri === gwVal ? ' selected' : '') + '>' + esc(g.label) + '</option>').join('') + '</select></label>' +
      '<label class="rjs-f"><span>Prop firm</span><select class="rjs-in" id="rjs-sys"><option value="">Loading systems...</option></select><small class="rjs-hint">Pick the same name R | Trader Pro shows at sign-in.</small></label>' +
      '<div class="rjs-two"><label class="rjs-f"><span>Rithmic username</span><input class="rjs-in" id="rjs-user" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"></label>' +
      '<label class="rjs-f"><span>Rithmic password</span><input class="rjs-in" id="rjs-pass" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false"></label></div>' +
      '<label class="rjs-check-row"><input type="checkbox" id="rjs-remember"><span>Save username on this device</span></label>' +
      (savedLogin ? '<div id="rjs-save-slot"></div>' : '') +
      '<p class="rjs-note">' + ICON_WARN + '<span>Some prop firms allow one login at a time. Import after you finish trading to avoid logging out of your trading app.</span></p>' +
      '<button type="button" class="rjs-go" id="rjs-go" disabled>Log in</button>' +
      '<p class="rjs-lock">' + ICON_LOCK + '<span>' + (savedLogin ? 'Your login goes from this device straight to Rithmic unless you choose to save it.' : 'Your login goes from this device straight to Rithmic. We never see or store your password.') + '</span></p>';
    wireX();
    const gw = sheet.querySelector('#rjs-gw'), sys = sheet.querySelector('#rjs-sys'), user = sheet.querySelector('#rjs-user'), pass = sheet.querySelector('#rjs-pass'), go = sheet.querySelector('#rjs-go'), rem = sheet.querySelector('#rjs-remember');
    const su = lsGet(LS_USER); if (su) { user.value = su; rem.checked = true; }
    const sync = () => { go.disabled = S.busy || !(sys.value && user.value.trim() && pass.value); };
    [user, pass].forEach((x) => x.addEventListener('input', sync)); sys.addEventListener('change', sync);
    async function loadSys() {
      sysLoaded = false; sys.disabled = true; sys.innerHTML = '<option value="">Loading systems...</option>'; sync();
      try {
        const names = await listSystems(gw.value);
        const first = cfg.systemFirst || [];
        const g0 = gws.find((g) => g.uri === gw.value);
        const rank = (n) => { const i = first.indexOf(n); return i < 0 ? first.length : i; };
        const shown = names.filter((n) => (g0 && g0.test) || n !== 'Rithmic Test').sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en', { sensitivity: 'base' }));
        const want = lsGet(LS_SYS);
        sys.innerHTML = '<option value="">Choose your system</option>' + shown.map((n) => '<option value="' + esc(n) + '"' + (n === want ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
        if (shown.length === 1) sys.value = shown[0];
        sys.disabled = false; sysLoaded = true;
      } catch (e) {
        const g0 = gws.find((g) => g.uri === gw.value);
        sys.innerHTML = '<option value="">Could not load systems</option>';
        const er = explainLoginError({ text: 'could not reach', gateway: g0 && g0.label });
        const box = sheet.querySelector('#rjs-err') || (() => { const d = document.createElement('div'); d.className = 'rjs-err'; d.id = 'rjs-err'; d.setAttribute('role', 'alert'); sheet.querySelector('.rjs-lead').after(d); return d; })();
        box.textContent = er.message;
      }
      sync();
    }
    gw.addEventListener('change', () => { lsSet(LS_GW, gw.value); loadSys(); });
    loadSys();
    if (savedLogin && typeof savedLogin.mount === 'function') savedLogin.mount(sheet.querySelector('#rjs-save-slot'));
    const submit = async () => {
      if (go.disabled) return;
      const u = user.value.trim(), p = pass.value, s = sys.value;
      S.busy = true; go.disabled = true; go.innerHTML = '<span class="rjs-spin"></span>Logging in';
      pass.value = '';
      lsSet(LS_USER, rem.checked ? u : ''); lsSet(LS_SYS, s); lsSet(LS_GW, gw.value);
      const g0 = gws.find((g) => g.uri === gw.value); S.gwLabel = g0 ? g0.label : '';
      const h = new RithmicOrderHistory({ gateway: gw.value, appName: cfg.appName, appVersion: (g0 && g0.test && cfg.testAppVersion) ? cfg.testAppVersion : cfg.appVersion, templateVersion: cfg.templateVersion });
      try {
        await h.connect({ user: u, password: p, systemName: s });
        S.hist = h;
        S.accounts = await h.accounts();
        if (!S.accounts.length) throw new Error('Rithmic returned no accounts for this login.');
        try { S.dates = (await h.historyDates()).filter((d) => d < S.today); } catch (e) { if (explainHistoryError(e).kind === 'permission') throw e; S.dates = []; }
        S.account = S.accounts[0]; S.picked = new Set(); S.mode = 'last5';
        if (savedLogin && typeof savedLogin.afterLogin === 'function') { try { await savedLogin.afterLogin({ system: s, user: u, password: p, gateway: gw.value }); } catch (e) {} }
        S.busy = false; S.step = 'pick'; armIdle(); draw();
      } catch (e) {
        await endSession();
        S.busy = false; S.step = 'login';
        const ph = h.order || null;
        const isHist = S.accounts.length > 0 || /order history|show order|history/i.test(String(e && e.message));
        if (isHist) { const r = explainHistoryError(e); drawLogin(r.message, r.kind === 'permission' ? '' : r.raw); }
        else { const r = explainLoginError({ codes: e && e.rpRaw, text: e && e.message, system: s, gateway: S.gwLabel, appName: cfg.appName }); drawLogin(r.message, r.raw || ''); }
        S.accounts = [];
        // keep what the member typed (except the password)
        const nu = sheet.querySelector('#rjs-user'); if (nu) nu.value = u;
      }
    };
    go.addEventListener('click', submit);
    [user, pass].forEach((x) => x.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }));
    if (!user.value) setTimeout(() => user.focus({ preventScroll: true }), 30); else setTimeout(() => pass.focus({ preventScroll: true }), 30);
  }

  // ---------------------------------------------------------------- step 2: account + dates
  function drawPick(error) {
    const dates = S.dates.slice().reverse();                 // newest first
    const last5 = dates.slice(0, 5);
    sheet.innerHTML = head('Choose what to import') +
      (error ? '<div class="rjs-err" id="rjs-err" role="alert">' + esc(error) + '</div>' : '') +
      '<p class="rjs-sub">Account</p>' +
      '<div class="rjs-rows" role="radiogroup" aria-label="Account" id="rjs-accts">' + S.accounts.map((a) =>
        '<button type="button" class="rjs-row" role="radio" aria-checked="' + (a.id === S.account.id) + '" data-acct="' + esc(a.id) + '"><i></i><span><b>' + esc(a.name) + '</b><small>' + esc(a.id) + ' · ' + esc(a.currency) + '</small></span></button>').join('') + '</div>' +
      '<p class="rjs-sub">Days</p>' +
      '<div class="rjs-seg" role="radiogroup" aria-label="Days" id="rjs-seg">' +
        [['today', 'Today'], ['last5', 'Last 5'], ['custom', 'Pick days']].map(([k, l]) => '<button type="button" role="radio" aria-checked="' + (S.mode === k) + '" data-mode="' + k + '">' + l + '</button>').join('') + '</div>' +
      (S.mode === 'custom' ? (dates.length ? '<div class="rjs-rows" id="rjs-days">' + dates.map((d) => '<button type="button" class="rjs-row" role="checkbox" aria-checked="' + S.picked.has(d) + '" data-day="' + d + '"><i></i><span><b>' + fmtDate(d) + '</b></span></button>').join('') + '</div>' : '<p class="rjs-hint">Rithmic reported no past days with order history for this login.</p>') :
        '<p class="rjs-hint" style="margin:-4px 0 16px">' + (S.mode === 'today' ? 'Today\u2019s orders and fills (trade date ' + fmtDate(S.today) + ').' : (last5.length ? 'Sessions: ' + last5.map(fmtDate).join(', ') + '.' : 'Rithmic reported no past days with order history for this login.')) + '</p>') +
      '<button type="button" class="rjs-go" id="rjs-load">Load trades</button>' +
      '<button type="button" class="rjs-ghost" id="rjs-out">Log out of Rithmic</button>';
    wireX();
    sheet.querySelectorAll('[data-acct]').forEach((b) => b.addEventListener('click', () => { S.account = S.accounts.find((a) => a.id === b.dataset.acct); armIdle(); drawPick(); }));
    sheet.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { S.mode = b.dataset.mode; armIdle(); drawPick(); }));
    sheet.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => { const d = b.dataset.day; S.picked.has(d) ? S.picked.delete(d) : S.picked.add(d); armIdle(); drawPick(); }));
    sheet.querySelector('#rjs-out').addEventListener('click', async () => { await endSession(); S.step = 'login'; drawLogin(); });
    const load = sheet.querySelector('#rjs-load');
    load.addEventListener('click', async () => {
      const days = S.mode === 'today' ? ['today'] : S.mode === 'last5' ? last5 : dates.filter((d) => S.picked.has(d));
      if (!days.length) { drawPick(S.mode === 'custom' ? 'Pick at least one day.' : 'No past days to load. Try Today.'); return; }
      load.disabled = true; load.innerHTML = '<span class="rjs-spin"></span>Reading your order history';
      armIdle();
      try {
        const notes = [];
        let snap = null;
        for (const d of days) notes.push(...await S.hist.dayNotes(S.account, d === 'today' ? S.today : d, { today: d === 'today' }));
        if (days.includes('today') && days.length === 1) snap = await S.hist.pnlSnapshot(S.account);
        const fills = fillsFromNotes(notes);
        S.fills = fills;
        const r = buildTrips(fills, { pointValues: S.pv });
        S.trips = r.trips; S.open = r.open; S.need = r.needsPointValue; S.snapOnly = days.length === 1 && days[0] === 'today';
        S.check = S.snapOnly ? crossCheck(r.trips.filter((t) => t.pointValue), snap, S.account.id) : { status: 'unavailable' };
        S.noFills = !fills.length;
        await endSession();                       // history is in memory: log out so the trading app is free
        S.step = 'preview'; draw();
      } catch (e) {
        const er = explainHistoryError(e);
        await endSession(); S.step = 'login';
        drawLogin(er.message, er.kind === 'permission' ? '' : er.raw);
      }
    });
  }

  // ---------------------------------------------------------------- step 3: preview + import
  function existingKeys() { return new Set((typeof JOURNAL_TRADES !== 'undefined' ? JOURNAL_TRADES : []).map((t) => t.syncKey).filter(Boolean)); }
  function freeRoom() {
    // Free plan: 20 NEW trades per calendar month (assets/plan-limits.js). Pro/admin: unlimited (null).
    if (!S.free) return null;
    const now = new Date(), key = now.getFullYear() + '-' + (now.getMonth() + 1);
    const used = (JOURNAL_TRADES || []).filter((t) => {
      const c = t.createdAt, ms = c && typeof c.toMillis === 'function' ? c.toMillis() : (c && c.seconds ? c.seconds * 1000 : null);
      if (ms) { const d = new Date(ms); return d.getFullYear() + '-' + (d.getMonth() + 1) === key; }
      return /^\d{4}-\d{2}/.test(t.date || '') && t.date.slice(0, 4) + '-' + parseInt(t.date.slice(5, 7), 10) === key;
    }).length;
    return Math.max(0, FREE_MONTHLY - used);
  }
  function drawPreview() {
    const priced = S.trips.filter((t) => t.netPnl != null);
    const plan = planImport(priced, { existingKeys: existingKeys(), freeRoom: freeRoom() });
    S.plan = plan;
    const total = priced.reduce((a, t) => a + t.netPnl, 0);
    const wins = priced.filter((t) => t.netPnl > 0).length;
    const feesKnown = priced.some((t) => t.fees != null);
    const lab = S.account.name || S.account.id;
    const trade = (t) => tripToJournalTrade(t, { label: S.account.id });
    const rowsHtml = priced.map((t) => {
      const dup = plan.dupes.includes(t), over = plan.overCap.includes(t);
      return '<tr><td>' + fmtTime(t.openedAt, IST_TZ) + '</td><td>' + fmtTime(t.openedAt, EXCHANGE_TZ) + '</td><td><b>' + esc(t.symbol) + '</b></td><td>' + (t.direction === 'short' ? 'Short' : 'Long') + '</td><td class="r">' + t.quantity + '</td><td class="r">' + px(t.avgEntry) + '</td><td class="r">' + px(t.avgExit) + '</td><td class="r ' + (t.netPnl > 0 ? 'rjs-up' : t.netPnl < 0 ? 'rjs-down' : '') + '">' + money(t.netPnl) + '</td><td>' + (dup ? 'Already in journal' : over ? 'Over Free limit' : 'New') + '</td></tr>';
    }).join('');
    const cardsHtml = priced.map((t) => {
      const dup = plan.dupes.includes(t), over = plan.overCap.includes(t);
      return '<div class="rjs-card"><div class="t"><span>' + esc(t.symbol) + ' · ' + (t.direction === 'short' ? 'Short' : 'Long') + ' ' + t.quantity + '</span><span class="' + (t.netPnl > 0 ? 'rjs-up' : t.netPnl < 0 ? 'rjs-down' : '') + '">' + money(t.netPnl) + '</span></div>' +
        '<div class="m"><span>In ' + px(t.avgEntry) + ' → out ' + px(t.avgExit) + '</span><span>' + fmtTime(t.openedAt, IST_TZ) + ' IST · ' + fmtTime(t.openedAt, EXCHANGE_TZ) + ' Chicago</span>' + ((dup || over) ? '<span>' + (dup ? 'Already in your journal' : 'Over the Free limit') + '</span>' : '') + '</div></div>';
    }).join('');
    const need = (S.need || []);
    sheet.innerHTML = head('Review trades') +
      (S.noFills ? '<p class="rjs-lead">No fills found for ' + esc(lab) + ' on those days.</p>' : '') +
      (need.length ? '<div class="rjs-cap"><b>Point value needed.</b> We don\u2019t have a dollar value per point for ' + need.map(esc).join(', ') + '. Enter it once and we\u2019ll price those trades.' +
        need.map((r) => '<div class="rjs-pv"><span style="min-width:56px"><b>' + esc(r) + '</b></span><input class="rjs-in" inputmode="decimal" data-pv="' + esc(r) + '" placeholder="$ per point" aria-label="Dollars per point for ' + esc(r) + '"><button type="button" class="rjs-ghost" style="width:auto;margin:0" data-setpv="' + esc(r) + '">Apply</button></div>').join('') + '</div>' : '') +
      (priced.length ? '<div class="rjs-sum"><div><b>' + priced.length + '</b><span>Trades</span></div><div><b class="' + (total > 0 ? 'rjs-up' : total < 0 ? 'rjs-down' : '') + '">' + money(total) + '</b><span>Net P&amp;L</span></div><div><b>' + Math.round(wins / priced.length * 100) + '%</b><span>Winners</span></div></div>' : '') +
      (S.check && S.check.status === 'match' ? '<div class="rjs-check ok">Cross-check: matches Rithmic\u2019s closed P&amp;L for today (' + money(S.check.rithmic) + ').</div>' : '') +
      (S.check && S.check.status === 'differs' ? '<div class="rjs-check warn">Cross-check: our total (' + money(S.check.ours) + ') differs from Rithmic\u2019s closed P&amp;L (' + money(S.check.rithmic) + '). Check the list below before importing.</div>' : '') +
      (priced.length ? '<div class="rjs-tablewrap"><table class="rjs-table"><thead><tr><th>Opened (IST)</th><th>Chicago</th><th>Symbol</th><th>Side</th><th class="r">Qty</th><th class="r">Entry</th><th class="r">Exit</th><th class="r">P&amp;L</th><th>Status</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div><div class="rjs-cards">' + cardsHtml + '</div>' : '') +
      (S.open.length ? '<p class="rjs-hint">Still open, not imported: ' + S.open.map((o) => esc(o.symbol) + ' ' + o.side + ' ' + o.qty).join(', ') + '.</p>' : '') +
      (plan.dupes.length ? '<p class="rjs-hint">' + plan.dupes.length + ' already in your journal. They won\u2019t be added again.</p>' : '') +
      (S.free && plan.overCap.length ? '<div class="rjs-cap" id="rjs-cap"><b>Free plan limit.</b> ' + plan.take.length + ' of ' + plan.fresh.length + ' new trades fit this month (' + FREE_MONTHLY + ' a month on Free). The other ' + plan.overCap.length + ' won\u2019t be imported. <a href="#" data-open-plan-modal data-upgrade-reason="Pro removes the monthly trade limit and adds import, broker sync, analytics and the AI coach.">Pro is unlimited</a>.</div>' : '') +
      '<p class="rjs-hint">' + (feesKnown ? 'Fees are included where Rithmic sent them.' : 'Fees not included: Rithmic did not send commissions for these fills.') + ' Gross P&amp;L = points × the contract\u2019s dollar value per point. Education only. Not financial advice.</p>' +
      '<div style="height:16px"></div>' +
      '<button type="button" class="rjs-go" id="rjs-import"' + (plan.take.length ? '' : ' disabled') + '>' + (plan.take.length ? 'Import ' + plan.take.length + ' trade' + (plan.take.length === 1 ? '' : 's') : (plan.dupes.length && !plan.fresh.length ? 'Nothing new to import' : 'No trades to import')) + '</button>' +
      '<button type="button" class="rjs-ghost" id="rjs-back2">Back</button>';
    wireX();
    sheet.querySelectorAll('[data-setpv]').forEach((b) => b.addEventListener('click', () => {
      const r = b.dataset.setpv, v = Number(String(sheet.querySelector('[data-pv="' + r + '"]').value).replace(/[$,\s]/g, ''));
      if (!(v > 0)) { toast('error', 'Enter a dollar value per point greater than 0.'); return; }
      S.pv[r] = v;
      const rb = buildTrips(S.fills || [], { pointValues: S.pv });
      S.trips = rb.trips; S.open = rb.open; S.need = rb.needsPointValue; drawPreview();
    }));
    const bk = sheet.querySelector('#rjs-back2'); bk.addEventListener('click', async () => { S.step = 'login'; drawLogin(); });
    const imp = sheet.querySelector('#rjs-import');
    if (imp) imp.addEventListener('click', () => runImport(plan.take, lab));
  }

  // ---------------------------------------------------------------- import
  async function runImport(trips, lab) {
    const btn = sheet.querySelector('#rjs-import'); btn.disabled = true; btn.innerHTML = '<span class="rjs-spin"></span>Importing';
    try {
      const col = journalCollectionRef(JOURNAL_UID);
      // Never overwrite a trade that exists (the member may have added notes): look each id up first.
      const ids = trips.map((t) => tripDocId(t));
      const snaps = await Promise.all(ids.map((id) => col.doc(id).get()));
      const todo = trips.filter((t, i) => !snaps[i].exists);
      for (let i = 0; i < todo.length; i += 350) {
        const batch = db.batch();
        todo.slice(i, i + 350).forEach((t) => {
          batch.set(col.doc(tripDocId(t)), Object.assign(tripToJournalTrade(t, { label: S.account.id }), {
            createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }));
        });
        await batch.commit();
      }
      if (todo.length) {
        const upd = { journalEntryCount: firebase.firestore.FieldValue.increment(todo.length) };
        if (todo.some((t) => t.netPnl > 0)) upd.hasWinningTrade = true;
        await db.collection('students').doc(JOURNAL_UID).set(upd, { merge: true }).catch(() => {});
      }
      S.imported = { added: todo.length, skipped: trips.length - todo.length };
      toast('success', 'Imported ' + todo.length + ' trade' + (todo.length === 1 ? '' : 's') + ' from Rithmic.');
      try { await reloadJournalData(); } catch (e) {}
      S.step = 'done'; draw();
    } catch (e) {
      console.error('TradeZoro: Rithmic import failed', e);
      btn.disabled = false; btn.textContent = 'Import ' + trips.length + ' trades';
      toast('error', 'Import failed: ' + (e && e.message || e));
    }
  }
  function drawDone() {
    const r = S.imported || { added: 0 };
    sheet.innerHTML = head('Done') + '<div class="rjs-done"><b>' + r.added + ' trade' + (r.added === 1 ? '' : 's') + ' added</b><p>Tagged \u201cRithmic \u00b7 ' + esc(S.account.id) + '\u201d. Importing the same days again adds nothing.</p></div><button type="button" class="rjs-go" id="rjs-fin">Close</button>';
    wireX(); sheet.querySelector('#rjs-fin').addEventListener('click', close);
  }

  function draw(err) {
    sheet.classList.toggle('rjs-wide', S.step === 'preview');
    if (S.step === 'login') drawLogin(err);
    else if (S.step === 'pick') drawPick(err);
    else if (S.step === 'preview') drawPreview();
    else drawDone();
    sheet.scrollTop = 0;
  }
  // Plan tier for the Free cap (fail open, same as plan-limits.js).
  Promise.resolve(window.strykerPlanTier ? window.strykerPlanTier() : { free: false }).then((t) => { S.free = !!(t && t.free); }).catch(() => {});
  draw();
}
