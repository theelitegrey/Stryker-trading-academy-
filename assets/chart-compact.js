// TradeZoro — Charts "Compact layout" (member request 19 Nov 2026). OFF by default; nobody's chart changes until they
// switch it on in Chart settings > Canvas > Toolbars. Saved per member in localStorage 'stryker_chart_compact' ('1'),
// synced through assets/account-sync.js (group chart).
// ON (html.stk-compact, style.css): slimmer bottom dock / range bar, the site header strip is hidden, and what lived only
// there stays reachable: menu button + market clock join the chart toolbar, Trade/workspaces already fall back to the
// toolbar, and the three icons (community, messages, bell) + the account button float in the chart's top-right corner.
// Nodes are MOVED (comment placeholder), never rebuilt, so every handler survives; turning it off puts them back.
const KEY = 'stryker_chart_compact';
const html = document.documentElement;
const byId = (id) => document.getElementById(id);
const moved = [];
let float = null, menuBtn = null, builtPhone = null;

function mv(node, parent, before) {
  if (!node || !parent || parent.contains(node)) return;
  const ph = document.createComment('stkcmp home');
  node.parentNode.insertBefore(ph, node);
  parent.insertBefore(node, before || null);
  moved.push({ node, ph });
}
function putBack() { while (moved.length) { const m = moved.pop(); if (m.ph.parentNode) m.ph.parentNode.replaceChild(m.node, m.ph); } }
const isPhone = () => html.classList.contains('stk-cps');
const stored = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };

function build() {
  const panel = document.querySelector('.stkchart-panel');
  const barL = byId('stkc-bar-l'), barR = document.querySelector('#stkc-bar .stkc-bar-r');
  if (!panel || !barL || !barR) return;
  builtPhone = isPhone();
  if (!isPhone()) {   // the phone already has one top bar; its icons are in the toolbar
    if (!float) {
      float = document.createElement('div');
      float.id = 'stkcmp-float'; float.className = 'stkcmp-float'; float.setAttribute('role', 'group'); float.setAttribute('aria-label', 'Messages, notifications and account');
    }
    panel.appendChild(float);
    ['gm-icon-wrap', 'msg-icon-wrap'].forEach((id) => mv(byId(id), float));
    mv(document.querySelector('.mobile-topnav .notif-bell-wrap'), float);
    mv(byId('account-menu'), float);
    if (!menuBtn) {
      menuBtn = document.createElement('button');
      menuBtn.type = 'button'; menuBtn.className = 'stkc-ib stkcmp-menu'; menuBtn.id = 'stkcmp-menu';
      menuBtn.title = 'Menu'; menuBtn.setAttribute('aria-label', 'Open menu');
      menuBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg>';
      menuBtn.addEventListener('click', (e) => { e.stopPropagation(); const t = byId('dash-menu-toggle'); if (t) t.click(); });
    }
    barL.insertBefore(menuBtn, barL.firstChild);
    const mc = byId('mclock'), sp = barR.querySelector('.stkc-ob-sp');
    if (mc) mv(mc, barR, sp ? sp.nextSibling : barR.firstChild);
  }
}
function unbuild() {
  putBack();
  if (menuBtn && menuBtn.parentNode) menuBtn.remove();
  if (float && float.parentNode) float.remove();
}
let on = false;
function set(v, persist) {
  v = !!v;
  if (persist) { try { v ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch (e) {} }
  if (v === on) return;
  on = v;
  html.classList.toggle('stk-compact', on);
  on ? build() : unbuild();
  window.dispatchEvent(new Event('resize'));   // vela-chart.js re-measures header / dock, the one bar re-fits
  try { window.dispatchEvent(new CustomEvent('stk-compact-change', { detail: { on } })); } catch (e) {}
}
export function mountCompact() {
  if (window.STRYKER_COMPACT) return window.STRYKER_COMPACT;
  const api = { get on() { return on; }, set: (v) => set(v, true) };
  window.STRYKER_COMPACT = api;
  // phone <-> desktop switches (rotate, resize) re-place the nodes
  window.addEventListener('resize', () => { if (on && isPhone() !== builtPhone) { unbuild(); build(); } }, { passive: true });
  // another device changed the pref (account-sync writes localStorage, then fires this)
  window.addEventListener('stk:acct-pref', () => set(stored(), false));
  window.addEventListener('storage', (e) => { if (e.key === KEY) set(stored(), false); });
  set(stored(), false);
  return api;
}
