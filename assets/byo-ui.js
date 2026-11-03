// TradeZoro — Charts "Data source" sheet (ES module). DATA ONLY.
// Depends on: assets/byo-core.js (SOURCES, connect, forget, onByoChange, statusOf). Mounted by assets/vela-chart.js into
// the chart toolbar (.stkc-bar-r). Rithmic is listed here and opens its own existing flow (window.STRYKER_RITHMIC.open).
// Design: docs/DESIGN-STANDARD.md (bottom sheet + grabber on phones, centred dialog on desktop; 44 px taps; day + dark).
import { SOURCES, connect, forget, onByoChange, statusOf, connectedIds, srcById } from './byo-core.js?v=825';

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
.byo-go[disabled]{ opacity:.6; cursor:default; }
.byo-go.danger{ background:transparent; border:1px solid #ff6b6b; color:#ff6b6b; }
:root[data-theme="light"] .byo-go.danger{ border-color:#b42318; color:#b42318; }
.byo-lock{ display:flex; gap:8px; margin:16px 0 0; font:400 13px/18px var(--by-font); color:var(--ink-2,#8b93a0); }
.byo-lock svg{ flex:none; margin-top:1px; }
.byo-state{ display:flex; align-items:center; gap:8px; margin:0 0 16px; font:500 15px/20px var(--by-font); }
.byo-state i{ width:10px; height:10px; border-radius:50%; background:#089981; box-shadow:0 0 0 2px rgba(8,153,129,.25); }
.byo-state.warn i{ background:#F5A623; box-shadow:0 0 0 2px rgba(245,166,35,.25); }
.byo-state.bad i{ background:#ff6b6b; box-shadow:none; }
@media (prefers-reduced-motion:reduce){ .byo-sheet, .byo-scrim{ transition:opacity .15s linear; transform:none !important; } .byo-sheet.desk{ transform:translate(-50%,-50%) !important; } }
`;

const I = (d, s = 20) => '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
// Our own monochrome glyphs, one per asset class. No broker logos.
const GLYPH = {
  stocks: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  futures: '<path d="M3 17l5-6 4 3 8-9"/><path d="M15 5h5v5"/>',
  forex: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  options: '<circle cx="8" cy="12" r="4"/><circle cx="16" cy="12" r="4"/>',
  crypto: '<circle cx="12" cy="12" r="8"/><path d="M9 9h5a1.5 1.5 0 0 1 0 3H9h5.5a1.5 1.5 0 0 1 0 3H9M9 7v10"/>'
};
const CHIPS = [['all', 'All'], ['stocks', 'Stocks'], ['futures', 'Futures'], ['forex', 'Forex'], ['options', 'Options'], ['crypto', 'Crypto']];
const RITHMIC = { id: 'rithmic', name: 'Rithmic', cls: ['futures'], covers: 'CME futures through your prop firm or broker login', fee: 'paid', feeNote: 'Your data fees apply.', state: 'rithmic' };
const X = I('<path d="M6 6l12 12M18 6 6 18"/>');
const BACK = I('<path d="m15 6-6 6 6 6"/>');
const LOCK = I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 16);
const NOTE = 'Your sign-in or key stays on this device. Market data goes straight from {name} to your browser.';
const DATA_ONLY = 'Data only. TradeZoro never places, changes or cancels trades, and never reads your account, positions or balance.';

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
    const glyph = GLYPH[s.cls[0]] || GLYPH.stocks;
    let b;
    if (s.state === 'rithmic') b = el('button', { type: 'button', class: 'byo-row-b', text: 'Connect', 'aria-label': 'Connect Rithmic', onclick: () => { setOpen(false); try { window.STRYKER_RITHMIC && window.STRYKER_RITHMIC.open && window.STRYKER_RITHMIC.open(); } catch (e) { /* not loaded yet */ } } });
    else if (s.state === 'ready') b = el('button', { type: 'button', class: 'byo-row-b' + (connected ? ' on' : ''), text: connected ? 'Connected' : 'Connect', 'aria-label': (connected ? 'Manage ' : 'Connect ') + s.name, onclick: () => go(connected ? 'manage' : 'form', s) });
    else b = el('button', { type: 'button', class: 'byo-row-b soon', text: 'Coming soon', disabled: true, 'aria-label': s.name + ', coming soon' });
    return el('li', { class: 'byo-row', 'data-src': s.id }, [
      el('span', { class: 'byo-ic', html: I(glyph) }),
      el('span', { class: 'byo-tx' }, [el('span', { class: 'byo-nm', text: s.name }), el('span', { class: 'byo-cv', text: s.covers }),
        el('span', { class: 'byo-tag' + (s.fee === 'free' ? ' free' : ''), text: s.fee === 'free' ? 'Free with your account' : 'Your data fees apply' })]),
      b]);
  }

  function renderList() {
    title.textContent = 'Data source'; backBtn.hidden = true;
    body.replaceChildren();
    body.appendChild(el('p', { class: 'byo-lead', text: 'Plot market data from your own broker or data account.' }));
    body.appendChild(el('div', { class: 'byo-chips', role: 'group', 'aria-label': 'Filter by market' }, CHIPS.map(([k, l]) =>
      el('button', { type: 'button', class: 'byo-chip', text: l, 'aria-pressed': filter === k ? 'true' : 'false', 'data-f': k, onclick: () => { filter = k; renderList(); } }))));
    const list = [...SOURCES, RITHMIC].filter((s) => filter === 'all' || s.cls.includes(filter));
    body.appendChild(list.length ? el('ul', { class: 'byo-list' }, list.map(rowFor)) : el('div', { class: 'byo-empty', text: 'Nothing here yet. Request a source below.' }));
    body.appendChild(el('div', { class: 'byo-foot' }, [
      el('a', { class: 'byo-link', id: 'byo-request', href: '/suggestions?new=' + encodeURIComponent('Data source: '), text: 'Request a source' })]));
    body.appendChild(el('p', { class: 'byo-note', text: DATA_ONLY }));
  }

  function renderForm(s) {
    title.textContent = 'Connect ' + s.name; backBtn.hidden = false;
    body.replaceChildren();
    const err = el('p', { class: 'byo-err', role: 'alert', hidden: true });
    const inputs = {};
    const form = el('form', { novalidate: true, autocomplete: 'off' });
    body.appendChild(el('p', { class: 'byo-lead', text: s.help }));
    form.appendChild(err);
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
    form.querySelector('.byo-lock span').textContent = NOTE.replace('{name}', s.name);
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
        err.textContent = x && /^(Sign in|Enter your OANDA)/.test(x.message) ? x.message : st === 401 || st === 403 ? s.name + ' did not accept this key. Check it and try again.' : st === 429 ? 'Too many tries. Wait a minute and try again.' : 'Could not reach ' + s.name + '. Check your connection and try again.';
        err.hidden = false;
      } finally { if (view === 'form') { submit.disabled = false; submit.textContent = 'Connect'; } }
    });
    body.appendChild(form);
    setTimeout(() => { const f = body.querySelector('input,select'); if (f && !phone) f.focus(); }, 30);
  }

  function renderManage(s) {
    title.textContent = s.name; backBtn.hidden = false;
    body.replaceChildren();
    const st = statusOf(s.id) || { status: 'idle' };
    const live = st.status === 'live';
    const bad = st.status === 'error';
    body.appendChild(el('p', { class: 'byo-state' + (bad ? ' bad' : live ? '' : ' warn'), 'data-state': st.status, html: '<i aria-hidden="true"></i><span></span>' }));
    body.querySelector('.byo-state span').textContent = bad ? (st.msg || 'Connection refused') : live ? 'Connected, live data' : 'Connected, waiting for a chart that uses ' + s.name + (st.msg ? ' · ' + st.msg : '');
    body.appendChild(el('p', { class: 'byo-lead', text: s.id === 'alpaca' ? 'Open a stock or ETF with the symbol picker (Your data tab) or type it, for example AAPL. SPY, QQQ, IWM and DIA also use it.' : 'Open any forex pair, for example EURUSD. It now plots your OANDA prices.' }));
    body.appendChild(el('button', { type: 'button', class: 'byo-go danger', id: 'byo-forget', text: 'Forget this connection', onclick: async () => { await forget(s.id); go('list'); } }));
    body.appendChild(el('p', { class: 'byo-lock', html: LOCK + '<span></span>' }));
    body.querySelector('.byo-lock span').textContent = NOTE.replace('{name}', s.name);
  }

  function render() {
    if (view === 'form' && cur) renderForm(cur); else if (view === 'manage' && cur) renderManage(cur); else renderList();
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
  onByoChange(() => { if (open && view === 'manage') render(); else if (open && view === 'list') renderList(); });

  const api = window.STRYKER_BYO = { open: () => { view = 'list'; setOpen(true); }, close: () => setOpen(false), get isOpen() { return open; } };
  return api;
}
void srcById;
