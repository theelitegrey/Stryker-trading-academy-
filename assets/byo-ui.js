// TradeZoro — Charts "Data source" sheet (ES module). DATA ONLY.
// Depends on: assets/byo-core.js (SOURCES, connect, forget, onByoChange, statusOf). Mounted by assets/vela-chart.js into
// the chart toolbar (.stkc-bar-r). Rithmic is listed here and opens its own existing flow (window.STRYKER_RITHMIC.open).
// Design: docs/DESIGN-STANDARD.md (bottom sheet + grabber on phones, centred dialog on desktop; 44 px taps; day + dark).
import { pair, loopbackState, HELPER_DOWNLOADS, HOWTO_URL } from './byo-bridge.js?v=963';
import { SOURCES, connect, forget, onByoChange, statusOf, connectedIds, srcById, saveKeys, loadKeys, enableSchwabIfConfigured, schwabAuthUrl } from './byo-core.js?v=963';
let CTR = null;   // byo-ctrader.js, loaded with the chart
const OAUTH = () => import('./byo-oauth.js?v=963');
const DHAN = () => import('./byo-dhan.js?v=963');
const ctr = () => CTR || import('./byo-ctrader.js?v=963').then((m) => (CTR = m));

const CSS = `
.byo-btn svg{ flex:none; }
.byo-scrim{ position:fixed; inset:0; z-index:99970; background:rgba(0,0,0,.45); opacity:0; transition:opacity .2s cubic-bezier(.2,0,0,1); }
.byo-scrim.on{ opacity:1; }
.byo-sheet{ --by-font:-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif; --by-in:#050506;
  position:fixed; z-index:99975; box-sizing:border-box; display:flex; flex-direction:column; background:var(--bg-1,#0b0b0d); color:var(--ink-0,#eee);
  border:1px solid var(--line,#2c2c32); font-family:var(--by-font); -webkit-font-smoothing:antialiased; }
:root[data-theme="light"] .byo-sheet{ --by-in:#fff; }
.byo-sheet[hidden], .byo-scrim[hidden]{ display:none; }
.byo-sheet.phone{ left:0; right:0; bottom:0; max-height:88vh; max-height:88dvh; border-radius:20px 20px 0 0; border-width:1px 0 0; transform:translateY(100%); transition:transform .3s cubic-bezier(.2,0,0,1); }
.byo-sheet.phone.on{ transform:none; }
.byo-sheet.desk{ left:50%; top:50%; width:480px; max-width:calc(100vw - 32px); max-height:calc(100vh - 64px); border-radius:16px; box-shadow:0 24px 60px -16px rgba(0,0,0,.6); transform:translate(-50%,-48%); opacity:0; transition:transform .2s cubic-bezier(.2,0,0,1), opacity .2s; }
.byo-sheet.desk.on{ transform:translate(-50%,-50%); opacity:1; }
.byo-grab{ width:36px; height:4px; border-radius:999px; background:var(--line,#2c2c32); margin:8px auto 0; flex:none; }
.byo-sheet.desk .byo-grab{ display:none; }
.byo-head{ display:flex; align-items:center; gap:8px; padding:12px 16px 8px 20px; flex:none; }
.byo-head h2{ flex:1; margin:0; font:600 20px/26px var(--by-font); color:var(--ink-0,#eee); }
.byo-x, .byo-back{ flex:none; display:inline-grid; place-items:center; width:44px; height:44px; padding:0; border:0; border-radius:50%; background:rgba(150,160,175,.16); color:var(--ink-1,#c9cdd3); cursor:pointer; -webkit-tap-highlight-color:transparent; }
.byo-x:hover, .byo-back:hover{ background:rgba(150,160,175,.26); color:var(--ink-0,#eee); }
.byo-body{ flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:0 20px 20px; padding-bottom:calc(20px + env(safe-area-inset-bottom,0px));
  scrollbar-width:thin; scrollbar-color:rgba(150,160,175,.35) transparent; }
.byo-body::-webkit-scrollbar{ width:6px; } .byo-body::-webkit-scrollbar-thumb{ background:rgba(150,160,175,.35); border-radius:3px; } .byo-body::-webkit-scrollbar-button{ display:none; }
.byo-lead{ margin:0 0 12px; font:400 14px/20px var(--by-font); color:var(--ink-2,#8b93a0); }
.byo-chips{ display:flex; flex-wrap:wrap; gap:8px; margin:0 0 12px; }
.byo-chip{ height:36px; padding:0 14px; border:1px solid var(--line,#2c2c32); border-radius:999px; background:transparent; color:var(--ink-1,#c9cdd3); font:500 14px/1 var(--by-font); cursor:pointer; -webkit-tap-highlight-color:transparent; }
.byo-chip:hover{ border-color:var(--gold,#03c988); }
.byo-chip[aria-pressed="true"]{ background:var(--gold,#03c988); border-color:var(--gold,#03c988); color:#050506; font-weight:600; }
.byo-chip:focus-visible, .byo-row-b:focus-visible, .byo-x:focus-visible, .byo-back:focus-visible, .byo-go:focus-visible, .byo-link:focus-visible{ outline:2px solid var(--gold,#03c988); outline-offset:2px; }
.byo-list{ list-style:none; margin:0; padding:0; border:1px solid var(--line,#2c2c32); border-radius:12px; overflow:hidden; }
.byo-row{ display:flex; align-items:center; gap:12px; min-height:64px; padding:10px 12px; border-top:1px solid var(--line,#2c2c32); }
.byo-row:first-child{ border-top:0; }
.byo-ic.lg{ background:#fff; border:1px solid rgba(128,128,128,.35); border-radius:8px; overflow:hidden; }
.byo-ic.lg img{ width:100%; height:100%; display:block; object-fit:contain; }
#byo-title .byo-ic{ display:inline-grid; width:28px; height:28px; vertical-align:middle; margin-right:10px; }
.byo-ic{ flex:none; width:40px; height:40px; border-radius:12px; display:grid; place-items:center; background:var(--bg-2,#131316); color:var(--ink-1,#c9cdd3); }
.byo-tx{ flex:1; min-width:0; }
.byo-nm{ display:block; font:600 15px/20px var(--by-font); color:var(--ink-0,#eee); }
.byo-cv{ display:block; font:400 13px/18px var(--by-font); color:var(--ink-2,#8b93a0); }
.byo-tag{ display:inline-block; margin-top:4px; padding:2px 8px; border-radius:999px; font:500 11px/16px var(--by-font); border:1px solid var(--line,#2c2c32); color:var(--ink-2,#8b93a0); }
.byo-tag.free{ color:var(--gold,#03c988); border-color:rgba(3,201,136,.45); }
:root[data-theme="light"] .byo-tag.free{ color:#047857; border-color:rgba(4,120,87,.45); }
.byo-row-b{ flex:none; min-width:96px; height:40px; padding:0 14px; border-radius:12px; border:1px solid var(--gold,#03c988); background:transparent; color:var(--gold,#03c988); font:600 14px/1 var(--by-font); cursor:pointer; -webkit-tap-highlight-color:transparent; }
:root[data-theme="light"] .byo-row-b{ color:#047857; border-color:#047857; }
.byo-row-b:hover{ background:rgba(3,201,136,.1); }
.byo-row-b.soon{ border-color:var(--line,#2c2c32); color:var(--ink-3,#6b7280); cursor:default; background:transparent; }
:root[data-theme="light"] .byo-row-b.soon{ border-color:#d0d5dd; color:#667085; }
.byo-row-b.on{ background:var(--gold,#03c988); color:#050506; }
:root[data-theme="light"] .byo-row-b.on{ background:#047857; color:#fff; }
.byo-empty{ padding:20px 12px; font:400 14px/20px var(--by-font); color:var(--ink-2,#8b93a0); text-align:center; }
.byo-foot{ margin:16px 0 0; display:flex; flex-wrap:wrap; gap:8px 16px; align-items:center; justify-content:space-between; }
.byo-link{ color:var(--gold,#03c988); font:500 14px/20px var(--by-font); text-decoration:none; padding:12px 0; }
:root[data-theme="light"] .byo-link{ color:#047857; }
.byo-link:hover{ text-decoration:underline; }
.byo-steps{ margin:0 0 16px; border:1px solid var(--line,#2c2c32); border-radius:12px; padding:0 14px; }
.byo-steps summary{ min-height:44px; display:flex; align-items:center; cursor:pointer; font:600 14px/20px var(--by-font); color:var(--ink-0,#eee); }
.byo-steps ol{ margin:0 0 4px; padding-left:20px; font:400 13px/20px var(--by-font); color:var(--ink-1,#c9cdd3); }
.byo-steps li{ margin:0 0 6px; }
.byo-steps .byo-link{ display:inline-block; }
.byo-disc{ margin:12px 0; padding:12px 16px; border:1px solid var(--line,#2c2c32); border-radius:12px; background:rgba(150,160,175,.1); font:400 13px/20px var(--by-font); color:var(--ink-1,#c9cdd3); }
.byo-disc strong{ color:var(--ink-0,#eee); font-weight:600; }
.byo-disc a{ color:var(--gold,#03c988); text-decoration:underline; }
:root[data-theme="light"] .byo-disc a{ color:#047857; }
.byo-disc p{ margin:0; } .byo-disc p+p{ margin-top:8px; color:var(--ink-2,#8b93a0); }
.byo-note{ margin:12px 0 0; font:400 12px/18px var(--by-font); color:var(--ink-2,#8b93a0); }
.byo-f{ display:block; margin:0 0 16px; }
.byo-f > span{ display:block; margin:0 0 8px; font:500 13px/18px var(--by-font); color:var(--ink-1,#c9cdd3); }
.byo-in{ width:100%; box-sizing:border-box; height:52px; padding:0 14px; border:1px solid var(--line,#2c2c32); border-radius:12px; background:var(--by-in); color:var(--ink-0,#eee); font:400 16px/22px var(--by-font); }
.byo-in:focus{ outline:none; border-color:var(--gold,#03c988); box-shadow:0 0 0 2px var(--gold,#03c988); }
.byo-in[aria-invalid="true"]{ border-color:#ff6b6b; }
.byo-help{ display:block; margin:6px 0 0; font:400 13px/18px var(--by-font); color:var(--ink-2,#8b93a0); }
.byo-err{ margin:0 0 16px; padding:10px 12px; border-radius:12px; border:1px solid rgba(255,107,107,.5); color:#ff6b6b; font:500 13px/18px var(--by-font); }
:root[data-theme="light"] .byo-err{ color:#b42318; border-color:rgba(180,35,24,.5); }
.byo-err[hidden]{ display:none; }
.byo-go{ width:100%; height:48px; border:0; border-radius:12px; background:var(--gold,#03c988); color:#050506; font:600 17px/22px var(--by-font); cursor:pointer; }
:root[data-theme="light"] .byo-go{ background:#047857; color:#fff; }
.byo-signin{ display:flex; align-items:center; justify-content:center; gap:12px; background:#fff; color:#111; border:1px solid rgba(128,128,128,.35); }
:root[data-theme="light"] .byo-signin{ background:#fff; color:#111; border-color:#d0d5dd; }
.byo-signin .byo-ic{ width:28px; height:28px; border-radius:6px; }
.byo-alt{ display:block; width:100%; min-height:44px; margin:8px 0 0; background:none; border:0; cursor:pointer; text-align:center; }
.byo-note2{ margin:0 0 16px; padding:10px 12px; border-radius:12px; border:1px solid var(--line,#2c2c32); font:500 13px/18px var(--by-font); color:var(--ink-1,#c9cdd3); }
.byo-go[disabled]{ opacity:.6; cursor:default; }
.byo-go.danger{ background:transparent; border:1px solid #ff6b6b; color:#ff6b6b; }
:root[data-theme="light"] .byo-go.danger{ border-color:#b42318; color:#b42318; }
.byo-lock{ display:flex; gap:8px; margin:16px 0 0; font:400 13px/18px var(--by-font); color:var(--ink-2,#8b93a0); }
.byo-lock svg{ flex:none; margin-top:1px; }
.byo-dl, .byo-dlrow{ display:block; margin:4px 0 0; font:400 12px/16px var(--by-font); color:var(--ink-2,#8b93a0); }
.byo-dlrow{ margin:0 0 16px; font-size:13px; }
.dk-red{ display:flex; align-items:center; gap:8px; margin:0 0 12px; padding:8px 8px 8px 12px; border-radius:12px; border:1px solid var(--line,#2c2c32); }
.dk-red code{ flex:1; min-width:0; overflow-wrap:anywhere; font:500 13px/18px ui-monospace,monospace; color:var(--ink-1,#c9cdd3); }
.dk-red .byo-link{ padding:12px; min-height:44px; flex:none; background:none; border:0; cursor:pointer; }
.byo-warn{ margin:0 0 12px; padding:10px 12px; border-radius:12px; border:1px solid rgba(255,176,32,.55); background:rgba(255,176,32,.08); font:400 13px/18px var(--by-font); color:var(--ink-1,#c9cdd3); }
:root[data-theme="light"] .byo-warn{ border-color:rgba(176,112,0,.55); background:rgba(176,112,0,.08); }
.byo-warn .byo-link{ padding:0; font-size:13px; }
.byo-warn b{ font-weight:600; }
.byo-steps-l{ margin:0 0 12px; padding-left:20px; font:400 14px/20px var(--by-font); color:var(--ink-1,#c9cdd3); }
.byo-steps-l li{ margin:0 0 6px; }
.byo-dlbtn{ display:flex; align-items:center; justify-content:center; box-sizing:border-box; width:100%; min-height:48px; margin:0 0 16px; border:1px solid var(--gold,#03c988); border-radius:12px; font:600 15px/20px var(--by-font); text-decoration:none !important; }
.byo-stepsh{ margin:0 0 8px; font:600 14px/20px var(--by-font); color:var(--ink-0,#eee); }
.byo-soon{ display:block; margin:0 0 16px; padding:12px; text-align:center; border-radius:12px; border:1px solid var(--line,#2c2c32); color:var(--ink-2,#8b93a0); font:600 15px/20px var(--by-font); }
.byo-state{ display:flex; align-items:center; gap:8px; margin:0 0 16px; font:500 15px/20px var(--by-font); }
.byo-state i{ width:10px; height:10px; border-radius:50%; background:#089981; box-shadow:0 0 0 2px rgba(8,153,129,.25); }
.byo-state.warn i{ background:#F5A623; box-shadow:0 0 0 2px rgba(245,166,35,.25); }
.byo-state.bad i{ background:#ff6b6b; box-shadow:none; }
@media (prefers-reduced-motion:reduce){ .byo-sheet, .byo-scrim{ transition:opacity .15s linear; transform:none !important; } .byo-sheet.desk{ transform:translate(-50%,-50%) !important; } }
`;

const I = (d, s = 20) => '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
// Our own monochrome glyphs, one per asset class. Fallback when a logo fails.
const GLYPH = {
  stocks: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  futures: '<path d="M3 17l5-6 4 3 8-9"/><path d="M15 5h5v5"/>',
  forex: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  options: '<circle cx="8" cy="12" r="4"/><circle cx="16" cy="12" r="4"/>',
  crypto: '<circle cx="12" cy="12" r="8"/><path d="M9 9h5a1.5 1.5 0 0 1 0 3H9h5.5a1.5 1.5 0 0 1 0 3H9M9 7v10"/>'
};
// Official brand marks (own-site icons, see assets/images/brokers/SOURCES.md). White tile so every mark reads in dark + light.
const LOGO = { alpaca: 'svg', oanda: 'png', ironbeam: 'png', tastytrade: 'svg', rithmic: 'png', schwab: 'png', ctrader: 'svg', upstox: 'png', fyers: 'png', mt5: 'png', ninja: 'png', ibkr: 'png' };
function logoTile(s) {
  const glyph = I(GLYPH[s.cls[0]] || GLYPH.stocks);
  if (!LOGO[s.id]) return el('span', { class: 'byo-ic', html: glyph });
  const img = new Image(); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
  const t = el('span', { class: 'byo-ic lg' }, [img]);
  img.onerror = () => { t.classList.remove('lg'); t.innerHTML = glyph; };
  img.src = '/assets/images/brokers/' + s.id + '.' + LOGO[s.id];
  return t;
}
const CHIPS = [['all', 'All'], ['stocks', 'Stocks'], ['futures', 'Futures'], ['forex', 'Forex'], ['options', 'Options'], ['crypto', 'Crypto']];
const RITHMIC = { id: 'rithmic', name: 'Rithmic', cls: ['futures'], covers: 'CME futures through your prop firm or broker login', fee: 'paid', feeNote: 'Your data fees apply.', state: 'rithmic' };
const X = I('<path d="M6 6l12 12M18 6 6 18"/>');
const BACK = I('<path d="m15 6-6 6 6 6"/>');
const LOCK = I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 16);
const NOTE = 'Your sign-in or key stays on this device. Market data goes straight from {name} to your browser.';
const noteOf = (s) => s.noteText || NOTE.replace('{name}', s.name);
const DATA_ONLY = 'Data only. TradeZoro never places, changes or cancels trades, and never reads your account, positions or balance.';

const stepsEl = (list) => list && list.length ? [el('p', { class: 'byo-stepsh', text: 'Steps' }), el('ol', { class: 'byo-steps-l' }, list.map((t) => el('li', { text: t })))] : [];

function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (k === 'text') n.textContent = v; else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}

export function mountByo(opts = {}) {
  const bar = opts.bar || document.querySelector('#stkc-bar .stkc-bar-r') || document.querySelector('.stkc-bar-r');
  if (!bar || document.getElementById('byo-btn')) return null;
  if (!document.getElementById('byo-css')) document.head.appendChild(el('style', { id: 'byo-css', text: CSS }));
  const phone = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches) || innerWidth < 600;

  const btn = el('button', { type: 'button', class: 'stkc-btn byo-btn', id: 'byo-btn', 'aria-haspopup': 'dialog', title: 'Data source', html: I('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>', 16) + '<span class="stkc-btn-l">Data source</span>' });
  const wrap = el('div', { class: 'stkc-menu' }, [btn]);
  bar.insertBefore(wrap, bar.firstChild);

  const scrim = el('div', { class: 'byo-scrim', hidden: true });
  const title = el('h2', { id: 'byo-title', text: 'Data source' });
  const backBtn = el('button', { type: 'button', class: 'byo-back', 'aria-label': 'Back', html: BACK, hidden: true });
  const closeBtn = el('button', { type: 'button', class: 'byo-x', 'aria-label': 'Close', html: X });
  const body = el('div', { class: 'byo-body' });
  const sheet = el('div', { class: 'byo-sheet ' + (phone ? 'phone' : 'desk'), id: 'byo-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'byo-title', hidden: true },
    [el('div', { class: 'byo-grab' }), el('div', { class: 'byo-head' }, [backBtn, title, closeBtn]), body]);
  document.body.append(scrim, sheet);

  let filter = 'all', view = 'list', cur = null, open = false, lastFocus = null;

  function setOpen(o) {
    if (o === open) return; open = o;
    if (o) {
      lastFocus = document.activeElement; scrim.hidden = false; sheet.hidden = false; render();
      requestAnimationFrame(() => { scrim.classList.add('on'); sheet.classList.add('on'); closeBtn.focus(); });
    } else {
      scrim.classList.remove('on'); sheet.classList.remove('on');
      setTimeout(() => { if (!open) { scrim.hidden = true; sheet.hidden = true; } }, 260);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    btn.setAttribute('aria-expanded', o ? 'true' : 'false');
  }
  function go(v, src) { view = v; cur = src || null; render(); body.scrollTop = 0; }

  function rowFor(s) {
    const connected = connectedIds().includes(s.id);
    let b;
    const R = window.STRYKER_RITHMIC, rOn = !!R && (R.state === 'connected' || R.state === 'reconnecting');
    if (s.state === 'rithmic' && rOn) b = el('button', { type: 'button', class: 'byo-row-b on', text: 'Disconnect', 'aria-label': 'Disconnect Rithmic', onclick: () => { try { R.disconnect(); } catch (e) { /* ignore */ } } });
    else if (s.state === 'rithmic') b = el('button', { type: 'button', class: 'byo-row-b', text: 'Connect', 'aria-label': 'Connect Rithmic', onclick: (e) => { e.stopPropagation(); setOpen(false); try { window.STRYKER_RITHMIC && window.STRYKER_RITHMIC.open && window.STRYKER_RITHMIC.open(); } catch (err) { /* not loaded yet */ } } });
    else if (s.state === 'ready' && s.bridge) b = el('button', { type: 'button', class: 'byo-row-b' + (connected ? ' on' : ''), text: connected ? 'Connected' : 'Pair', 'aria-label': (connected ? 'Manage ' : 'Pair ') + s.name, onclick: () => go(connected ? 'manage' : 'pair', s) });
    else if (s.state === 'ready' && s.oauth) {
      const re = connected && /^Reconnect /.test((statusOf(s.id) || {}).msg || '');
      b = el('button', { type: 'button', class: 'byo-row-b' + (connected && !re ? ' on' : ''), text: re ? 'Reconnect' : connected ? 'Connected' : s.cta ? 'Sign in' : 'Connect', 'aria-label': (re ? 'Reconnect ' : connected ? 'Manage ' : s.cta ? 'Sign in with ' : 'Connect ') + s.name, onclick: () => (connected && !re ? go('manage', s) : s.keyAlt || s.signin ? go('signin', s) : startOauth(s)) });
    } else if (s.state === 'ready' && s.keyLogin) {
      const re = connected && /^Reconnect /.test((statusOf(s.id) || {}).msg || '');
      b = el('button', { type: 'button', class: 'byo-row-b' + (connected && !re ? ' on' : ''), text: re ? 'Reconnect' : connected ? 'Connected' : 'Connect', 'aria-label': (re ? 'Reconnect ' : connected ? 'Manage ' : 'Connect ') + s.name, onclick: () => go(connected && !re ? 'manage' : 'dhankey', s) });
    } else if (s.state === 'ready') b = el('button', { type: 'button', class: 'byo-row-b' + (connected ? ' on' : ''), text: connected ? 'Connected' : 'Connect', 'aria-label': (connected ? 'Manage ' : 'Connect ') + s.name, onclick: () => go(connected ? 'manage' : 'form', s) });
    else b = el('button', { type: 'button', class: 'byo-row-b soon', text: 'Coming soon', 'aria-label': s.name + ', coming soon, see steps', onclick: () => go('soon', s) });
    return el('li', { class: 'byo-row', 'data-src': s.id }, [
      logoTile(s),
      el('span', { class: 'byo-tx' }, [el('span', { class: 'byo-nm', text: s.name + (s.beta ? ' · Beta' : '') }), el('span', { class: 'byo-cv', text: s.state === 'rithmic' && rOn ? 'Connected to ' + (R.system || 'Rithmic') : s.covers }), s.relay && s.state === 'ready' ? el('span', { class: 'byo-cv', text: s.noteText }) : null,
        el('span', { class: 'byo-tag' + (s.fee === 'free' ? ' free' : ''), text: s.fee === 'free' ? 'Free with your account' : 'Your data fees apply' })]),
      b]);
  }

  async function startOauth(s) {
    try {
      const u = window.firebase && firebase.auth().currentUser;
      if (!u) { go('list'); body.prepend(el('p', { class: 'byo-err', role: 'alert', text: 'Sign in to connect your own data.' })); return; }
      location.assign(s.keyAlt || s.signin ? (await OAUTH()).oauthAuthUrl(s.id, s.clientId, u.uid) : s.id === 'ctrader' ? (await ctr()).ctraderAuthUrl(s.clientId, u.uid) : await schwabAuthUrl(s.clientId, u.uid));
    } catch (e) { /* stays on the list */ }
  }

  // Mode C (recommended): the member's own Dhan API key. Keys live only in the device vault; the daily tap runs steps 1-2 and the callback page finishes step 3.
  function renderDhanKey(s) {
    title.replaceChildren(logoTile(s), 'Connect ' + s.name); backBtn.hidden = false;
    body.replaceChildren();
    const err = el('p', { class: 'byo-err', role: 'alert', hidden: true });
    const showErr = (m) => { err.textContent = m; err.hidden = false; };
    const connected = connectedIds().includes(s.id), again = connected && /^Reconnect /.test((statusOf(s.id) || {}).msg || '');
    body.appendChild(el('p', { class: 'byo-lead', text: 'Sign in with your own Dhan API key. You set it up once, then it is one tap a day. TradeZoro only reads prices. It can\'t place trades.' }));
    const paint = async (editing) => {
      body.querySelectorAll('.dk').forEach((n) => n.remove());
      const add = (n) => { n.classList.add('dk'); body.appendChild(n); return n; };
      let keys = null; try { keys = await loadKeys('dhan-key'); } catch (e) { keys = null; }
      const has = !!keys && !editing;
      const go1 = async (k) => {
        try {
          const u = window.firebase && firebase.auth().currentUser;
          if (!u) { showErr('Sign in to connect your own data.'); return; }
          const dh = await DHAN(); go1b.disabled = true;
          location.assign(await dh.dhanKeyStart(k, u.uid, await u.getIdToken()));
        } catch (x) { go1b.disabled = false; showErr(x && x.show ? x.message : 'Dhan sign-in is not available right now. Try again, or paste a token instead.'); }
      };
      let go1b;
      if (has) {
        add(err);
        go1b = add(el('button', { type: 'button', class: 'byo-go byo-signin', id: 'dhan-signin', onclick: () => go1(keys) }, [logoTile(s), el('span', { text: again ? 'Sign in with Dhan again' : 'Sign in with Dhan' })]));
        add(el('button', { type: 'button', class: 'byo-link byo-alt', id: 'dhan-edit', text: 'Change my API key', onclick: () => paint(true) }));
      } else {
        stepsEl(['Open web.dhan.co, tap My Profile, then Access DhanHQ APIs.', 'Turn on API key. App name: TradeZoro. Redirect URL: the one below (tap Copy).', 'Copy the API key and API secret, and paste them here with your Client ID.', 'Tap Sign in with Dhan.']).forEach(add);
        const red = el('div', { class: 'dk-red' }, [el('code', { id: 'dhan-redirect', text: 'https://tradezoro.com/connect/dhan/callback' }),
          el('button', { type: 'button', class: 'byo-link', id: 'dhan-copy', text: 'Copy', onclick: async (e) => { try { await navigator.clipboard.writeText('https://tradezoro.com/connect/dhan/callback'); e.target.textContent = 'Copied'; } catch (x) { e.target.textContent = 'Press and hold to copy'; } } })]);
        add(red);
        add(el('p', { class: 'byo-warn', text: 'Dhan charges for market data. This works only if the Data plan is on your Dhan account.' }));
        add(err);
        const f = el('form', { novalidate: true, autocomplete: 'off' }); const ins = {};
        [['clientId', 'Dhan Client ID', false, '1000000001'], ['appId', 'API key', true, ''], ['appSecret', 'API secret', true, '']].forEach(([k, l, sec, ph]) => {
          ins[k] = el('input', { class: 'byo-in', id: 'dhan-k-' + k, type: sec ? 'password' : 'text', placeholder: ph, autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', 'data-lpignore': 'true' });
          f.appendChild(el('label', { class: 'byo-f' }, [el('span', { text: l }), ins[k]]));
        });
        go1b = el('button', { type: 'submit', class: 'byo-go', id: 'dhan-save', text: 'Save and sign in with Dhan' }); f.appendChild(go1b);
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          const k = {}; for (const n of Object.keys(ins)) k[n] = String(ins[n].value || '').trim();
          const dh = await DHAN();
          if (!dh.keyShape(k)) { showErr('Enter your Dhan Client ID (numbers), API key and API secret.'); return; }
          err.hidden = true;
          try { const u = window.firebase && firebase.auth().currentUser; if (!u) { showErr('Sign in to connect your own data.'); return; } await saveKeys('dhan-key', k); } catch (x) { showErr('Sign in to connect your own data.'); return; }
          go1(k);
        });
        add(f);
        if (editing) add(el('button', { type: 'button', class: 'byo-link byo-alt', text: 'Cancel', onclick: () => paint(false) }));
      }
      add(el('button', { type: 'button', class: 'byo-link byo-alt', id: 'dhan-paste', text: 'Paste a token instead', onclick: () => go('form', s) }));
      add(el('p', { class: 'byo-lock', html: LOCK + '<span></span>' })).querySelector('span').textContent = 'Your Client ID, API key and secret stay in this device\'s encrypted store. TradeZoro passes them to Dhan for the sign-in call only and does not keep them. Live prices come from Dhan straight to your browser.';
      add(el('p', { class: 'byo-note', text: DATA_ONLY }));
    };
    paint(false);
  }

  function renderList() {
    title.textContent = 'Data source'; backBtn.hidden = true;
    body.replaceChildren();
    body.appendChild(el('p', { class: 'byo-lead', text: 'Plot market data from your own broker or data account.' }));
    body.appendChild(el('div', { class: 'byo-chips', role: 'group', 'aria-label': 'Filter by market' }, CHIPS.map(([k, l]) =>
      el('button', { type: 'button', class: 'byo-chip', text: l, 'aria-pressed': filter === k ? 'true' : 'false', 'data-f': k, onclick: () => { filter = k; renderList(); } }))));
    const list = [RITHMIC, ...SOURCES].filter((s) => filter === 'all' || s.cls.includes(filter));
    body.appendChild(list.length ? el('ul', { class: 'byo-list' }, list.map(rowFor)) : el('div', { class: 'byo-empty', text: 'Nothing here yet. Request a source below.' }));
    body.appendChild(el('div', { class: 'byo-foot' }, [
      el('a', { class: 'byo-link', id: 'byo-request', href: '/suggestions?new=' + encodeURIComponent('Data source: '), text: 'Request a source' })]));
    body.appendChild(el('p', { class: 'byo-note', text: DATA_ONLY }));
  }

  function renderForm(s) {
    title.replaceChildren(logoTile(s), 'Connect ' + s.name); backBtn.hidden = false;
    body.replaceChildren();
    const err = el('p', { class: 'byo-err', role: 'alert', hidden: true });
    const inputs = {};
    const form = el('form', { novalidate: true, autocomplete: 'off' });
    body.appendChild(el('p', { class: 'byo-lead', text: s.help }));
    stepsEl(s.steps).forEach((n) => body.appendChild(n));
    if (s.docs) body.appendChild(el('a', { class: 'byo-link', href: s.docs, target: '_blank', rel: 'noopener noreferrer', text: s.name + ' API page' }));
    form.appendChild(err);
    if (s.id === 'dhan') form.appendChild(el('p', { class: 'byo-warn', text: 'Dhan charges for market data. This works only if the Data plan is on your Dhan account.' }));
    s.fields.forEach((f) => {
      const id = 'byo-f-' + f.k;
      let inp;
      if (f.type === 'select') { inp = el('select', { class: 'byo-in', id }, f.opts.map(([v, t]) => el('option', { value: v, text: t }))); }
      else inp = el('input', { class: 'byo-in', id, type: f.secret ? 'password' : 'text', placeholder: f.ph || '', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', 'data-lpignore': 'true' });
      inputs[f.k] = inp;
      form.appendChild(el('label', { class: 'byo-f' }, [el('span', { text: f.label }), inp]));
    });
    const submit = el('button', { type: 'submit', class: 'byo-go', text: 'Connect' });
    form.appendChild(submit);
    form.appendChild(el('p', { class: 'byo-lock', html: LOCK + '<span></span>' }));
    form.querySelector('.byo-lock span').textContent = noteOf(s);
    form.appendChild(el('p', { class: 'byo-note', text: DATA_ONLY }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const creds = {}; let bad = null;
      s.fields.forEach((f) => {
        const v = String(inputs[f.k].value || '').trim(); creds[f.k] = v;
        const miss = !v && !f.optional && f.type !== 'select';
        inputs[f.k].setAttribute('aria-invalid', miss ? 'true' : 'false');
        if (miss && !bad) bad = f;
      });
      if (bad) { err.textContent = 'Enter your ' + bad.label.replace(/^(\w+)( |$)/, (m, w) => (w === 'API' || w === 'ID' ? w : w.toLowerCase()) + m.slice(w.length)) + '.'; err.hidden = false; inputs[bad.k].focus(); return; }
      if (s.id === 'oanda' && creds.account && !/^\d{3}-\d{3}-\d{4,}-\d{3}$/.test(creds.account)) { err.textContent = 'Account ID looks like 101-001-1234567-001.'; err.hidden = false; inputs.account.focus(); return; }
      err.hidden = true; submit.disabled = true; submit.textContent = 'Checking…';
      try { await connect(s.id, creds); Object.values(inputs).forEach((i) => { i.value = ''; }); go('manage', s); }
      catch (x) {
        const st = x && x.status;
        err.textContent = x && (x.show || /^(Sign in|Enter your OANDA|This token can)/.test(x.message)) ? x.message : st === 401 || st === 403 ? s.name + ' did not accept this key. Check it and try again.' : st === 429 ? 'Too many tries. Wait a minute and try again.' : 'Could not reach ' + s.name + '. Check your connection and try again.';
        err.hidden = false;
      } finally { if (view === 'form') { submit.disabled = false; submit.textContent = 'Connect'; } }
    });
    body.appendChild(form);
    setTimeout(() => { const f = body.querySelector('input,select'); if (f && !phone) f.focus(); }, 30);
  }

  // One-tap sign-in screen for Alpaca / tastytrade, with the paste-a-key form one tap away.
  function renderSignin(s) {
    title.replaceChildren(logoTile(s), s.name); backBtn.hidden = false;
    body.replaceChildren();
    body.appendChild(el('p', { class: 'byo-lead', text: s.signin ? 'Sign in on ' + s.name + (s.name.endsWith('s') ? '’' : '’s') + ' own page. TradeZoro only reads prices. It can\'t place trades.' : 'Sign in on ' + s.name + '\'s own page. Only market data is requested (read-only). You can take it back any time from ' + s.name + '.' }));
    stepsEl(s.signSteps || s.steps).forEach((n) => body.appendChild(n));
    if (s.signinNote) body.appendChild(el('p', { class: 'byo-note2', text: s.signinNote }));
    if (s.id === 'alpaca') {   // Alpaca's required OAuth disclosure, exact text, plus our own data-only line
      body.appendChild(el('div', { class: 'byo-disc', id: 'byo-alpaca-disc' }, [
        el('p', {}, [el('strong', { text: 'Authorize TradeZoro. ' }), document.createTextNode('By allowing TradeZoro to access your Alpaca account, you are granting TradeZoro access to your account information and authorization to place transactions in your account at your direction. Alpaca does not warrant or guarantee that TradeZoro will work as advertised or expected. Before authorizing, '), el('a', { href: '/help/connect-your-own-data', target: '_blank', rel: 'noopener', text: 'learn more about TradeZoro' }), document.createTextNode('.')]),
        el('p', { text: 'TradeZoro only reads market data. It never places orders.' })]));
    }
    const go1 = el('button', { type: 'button', class: 'byo-go byo-signin', id: 'byo-signin', onclick: () => startOauth(s) }, [logoTile(s), el('span', { text: s.cta })]);
    body.appendChild(go1);
    if (!s.signin) body.appendChild(el('button', { type: 'button', class: 'byo-link byo-alt', id: 'byo-keyalt', text: 'Use an API key instead', onclick: () => go('form', s) }));
    body.appendChild(el('p', { class: 'byo-lock', html: LOCK + '<span></span>' }));
    body.querySelector('.byo-lock span').textContent = noteOf(s);
    body.appendChild(el('p', { class: 'byo-note', text: DATA_ONLY }));
  }

  function renderPair(s) {
    title.textContent = 'Pair ' + s.name; backBtn.hidden = false;
    body.replaceChildren();
    const err = el('p', { class: 'byo-err', role: 'alert', hidden: true });
    const safari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
    body.appendChild(el('p', { class: 'byo-lead', text: s.note }));
    if (safari) body.appendChild(el('p', { class: 'byo-err', text: 'Safari does not allow this. Use Chrome, Edge or Firefox.' }));
    stepsEl(s.steps).forEach((n) => body.appendChild(n));
    body.appendChild(HELPER_DOWNLOADS[s.id] ? el('a', { class: 'byo-dlbtn byo-link', id: 'byo-dl', href: HELPER_DOWNLOADS[s.id], rel: 'noopener', text: s.id === 'ninja' ? 'Download the add-on (.zip)' : 'Download TradeZoroBridge.exe' }) : el('span', { class: 'byo-dlrow', 'data-dl': 'off', text: 'Download not available yet' }));
    body.appendChild(el('a', { class: 'byo-link', href: HOWTO_URL, target: '_blank', rel: 'noopener', text: 'Step-by-step guide (how-to)' }));
    const inp = el('input', { class: 'byo-in', id: 'byo-f-code', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '8', placeholder: '12345678', autocomplete: 'one-time-code', 'aria-label': 'Code from the helper' });
    const form = el('form', { novalidate: true, autocomplete: 'off' }, [err, el('label', { class: 'byo-f' }, [el('span', { text: 'Code from the helper' }), inp])]);
    const submit = el('button', { type: 'submit', class: 'byo-go', text: 'Pair' });
    form.append(submit, el('p', { class: 'byo-lock', html: LOCK + '<span>Your browser may ask to allow tradezoro.com to connect to apps on this device. Choose Allow. The helper only listens on this computer.</span>' }), el('p', { class: 'byo-note', text: DATA_ONLY }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true; submit.disabled = true; submit.textContent = 'Pairing…';
      try {
        const st = await loopbackState();
        if (st === 'denied') throw Object.assign(new Error('Allow local access for tradezoro.com in the address-bar lock menu, then try again.'), { code: 'denied' });
        const r = await pair(s.id, inp.value);
        await connect(s.id, { token: r.token, port: r.port }); inp.value = ''; go('manage', s);
      } catch (x) {
        const c = x && x.code;
        err.textContent = c === 'unreachable' ? 'Could not reach the helper. Start it first. If your browser asked about local access, choose Allow.' : c === 'bad-code' || c === 'code' ? (x.message || 'That code is not right.') : x && x.message ? x.message : 'Could not pair. Try again.';
        err.hidden = false;
      } finally { if (view === 'pair') { submit.disabled = false; submit.textContent = 'Pair'; } }
    });
    body.appendChild(form);
  }

  function renderSoon(s) {
    title.replaceChildren(logoTile(s), s.name); backBtn.hidden = false;
    body.replaceChildren();
    body.appendChild(el('p', { class: 'byo-lead', text: s.help || s.covers }));
    stepsEl(s.steps).forEach((n) => body.appendChild(n));
    body.appendChild(el('span', { class: 'byo-soon', text: 'Coming soon' }));
    body.appendChild(el('p', { class: 'byo-note', text: DATA_ONLY }));
  }

  function renderManage(s) {
    title.replaceChildren(logoTile(s), s.name); backBtn.hidden = false;
    body.replaceChildren();
    const st = statusOf(s.id) || { status: 'idle' };
    const live = st.status === 'live';
    const bad = st.status === 'error';
    body.appendChild(el('p', { class: 'byo-state' + (bad ? ' bad' : live ? '' : ' warn'), 'data-state': st.status, html: '<i aria-hidden="true"></i><span></span>' }));
    body.querySelector('.byo-state span').textContent = bad ? (st.msg || 'Connection refused') : live ? 'Connected, live data' : 'Connected, waiting for a chart that uses ' + s.name + (st.msg ? ' · ' + st.msg : '');
    body.appendChild(el('p', { class: 'byo-lead', text: s.manage ? s.manage : s.bridge ? 'Open a symbol by typing it like byo:' + (s.id === 'ibkr' ? 'AAPL' : s.id === 'ninja' ? 'ES 12-26' : 'EURUSD') + '. Prices come from ' + s.name + ' on this computer.' : s.id === 'alpaca' || s.id === 'schwab' ? 'Open a stock or ETF with the symbol picker (Your data tab) or type it, for example AAPL. SPY, QQQ, IWM and DIA also use it.' : 'Open any forex pair, for example EURUSD. It now plots your OANDA prices.' }));
    if (s.keyLogin && bad && /^Reconnect /.test(st.msg || '')) body.appendChild(el('button', { type: 'button', class: 'byo-go', id: 'dhan-again', text: 'Sign in with Dhan again', onclick: () => go('dhankey', s) }));
    body.appendChild(el('button', { type: 'button', class: 'byo-go danger', id: 'byo-forget', text: 'Forget this connection', onclick: async () => { await forget(s.id); go('list'); } }));
    body.appendChild(el('p', { class: 'byo-lock', html: LOCK + '<span></span>' }));
    body.querySelector('.byo-lock span').textContent = s.bridge ? 'The pairing token stays on this device. Prices go from ' + s.name + ' to the helper to this tab, never through TradeZoro.' : noteOf(s);
  }

  function render() {
    if (view === 'pair' && cur) renderPair(cur); else if (view === 'form' && cur) renderForm(cur); else if (view === 'manage' && cur) renderManage(cur); else if (view === 'signin' && cur) renderSignin(cur); else if (view === 'dhankey' && cur) renderDhanKey(cur); else if (view === 'soon' && cur) renderSoon(cur); else renderList();
  }

  btn.addEventListener('click', (e) => { e.stopPropagation(); document.querySelectorAll('.stkc-pop').forEach((p) => { p.hidden = true; }); view = 'list'; setOpen(!open); });
  closeBtn.addEventListener('click', () => setOpen(false));
  backBtn.addEventListener('click', () => go('list'));
  scrim.addEventListener('click', () => setOpen(false));
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); return; }
    if (e.key === 'Tab') {
      const f = [...sheet.querySelectorAll('button:not([disabled]),a[href],input,select')].filter((x) => !x.hidden && x.offsetParent !== null);
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  });
  window.addEventListener('stryker-rithmic-state', () => { if (open && view === 'list') renderList(); });
  onByoChange(() => { if (open && view === 'manage') render(); else if (open && view === 'list') renderList(); });

  if (/[?&]byoPreview\b/.test(location.search)) { const a = srcById('alpaca'); if (a) Object.assign(a, { oauth: true, clientId: 'PREVIEW', cta: 'Sign in with Alpaca', keyAlt: true, signinNote: '' }); }   // preview only: shows the sign-in step while the flag is off
  enableSchwabIfConfigured().then((on) => { if (on && open) render(); }).catch(() => {});
  OAUTH().then((m) => m.enableOauthIfConfigured()).then((on) => { if (on && open) render(); }).catch(() => {});
  ctr().then((m) => m.enableCtraderIfConfigured()).then((on) => { if (on && open) render(); }).catch(() => {});
  const api = window.STRYKER_BYO = { open: () => { view = 'list'; setOpen(true); }, close: () => setOpen(false), get isOpen() { return open; } };
  return api;
}
void srcById;
