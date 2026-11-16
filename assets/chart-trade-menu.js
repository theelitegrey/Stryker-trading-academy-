// TradeZoro — Charts "Trade" button + connection menu (Owner orders 2026-11-16: logo of the connection, better button; then "make it
// more proper, add proper logo, account number is wrong, add total money, add a pencil button (label / prop firm) and a disconnect icon").
// Pure view code: chart-paper.js owns the pick actions (data-a = paper | live | connect) and calls draw()/button()/keys() below.
// Broker names, logos, balances and the edit / disconnect buttons only ever appear when `live` is passed, which only the admin-only live
// module provides (window.__stkLive: balance(), metaOf(), saveMeta(), disconnect(), L = chart-live-core.js). Members see Paper only.
//
// Row layout: logo 28 | two lines (top: label or broker + account number in mono, click = copy; bottom: status dot · firm · broker ·
// balance) | pencil + disconnect (32px hit areas; on hover / focus with a mouse, always on touch) | tick on the active one.
// Keys: Up/Down/Home/End move between rows, Right/Left move into / out of a row's buttons, Esc closes an open editor first.
// Education only. Not financial advice.
const ALIAS = { interactivebrokers: 'ibkr', interactivebroker: 'ibkr', ib: 'ibkr', tasty: 'tastytrade', tastyworks: 'tastytrade', ninja: 'ninjatrader', topstep: 'topstepx', coinbaseadvanced: 'coinbase', binanceus: 'binance' };
const KNOWN = new Set(['tradovate', 'rithmic', 'ninjatrader', 'ibkr', 'tastytrade', 'alpaca', 'tradier', 'schwab', 'tradestation', 'webull', 'robinhood', 'coinbase', 'binance', 'kraken', 'topstepx', 'projectx']);
const HUES = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0d9488', '#4f46e5'];
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssId = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
export const brokerKey = (name) => { const k = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return ALIAS[k] || k; };
// Rounded-square brand mark (assets/img/brokers/<key>.png: the broker's own favicon / app icon, 56px, shown at 16-28px); a coloured
// square with the initial when we have no mark or it fails to load.
export function logo(name, size) {
  const k = brokerKey(name), ini = esc((String(name || '?').trim()[0] || '?').toUpperCase());
  const hue = HUES[[...k].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length];
  const fb = '<span class="stktm-fb" style="background:' + hue + '">' + ini + '</span>';
  return '<span class="stktm-logo ' + (size === 16 ? 'stktm-s16' : size === 24 ? 'stktm-s24' : 'stktm-s28') + '" aria-hidden="true">' + (KNOWN.has(k) ? '<img src="assets/img/brokers/' + k + '.png" alt="" width="' + size + '" height="' + size + '" decoding="async" data-fb="' + esc(fb) + '">' : fb) + '</span>';
}
const SV = (w, d, sw) => '<svg width="' + w + '" height="' + w + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.8) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const PAPER_IC = '<span class="stktm-logo stktm-s28 stktm-paper" aria-hidden="true">' + SV(16, '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>') + '</span>';
const CHK = '<span class="stktm-tick" aria-hidden="true">' + SV(16, '<path d="m5 12 5 5 9-10"/>', 2.4) + '</span>';
const NOCHK = '<span class="stktm-tick" aria-hidden="true"></span>';
const PEN = SV(16, '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>');
const UNPLUG = SV(16, '<path d="m19 5 3-3M2 22l3-3"/><path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4z"/><path d="m7.5 13.5 2.5-2.5M10.5 16.5l2.5-2.5"/><path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0z"/>');
const COPY = SV(14, '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>');

function status(a, live) {
  const act = live.acct && live.acct.id === a.id;
  if (act && live.readErr && /renew/i.test(live.readErr)) return { t: 'Needs reconnect', c: 'bad' };
  if (act) return live.env && live.env.enabled === false ? { t: 'View only', c: 'warn' } : { t: 'Trading on', c: 'ok' };
  return { t: 'Connected', c: 'ok' };
}
const API = () => (window.__stkLive && window.__stkLive.L ? window.__stkLive : null);
const metaOf = (id) => { const A = API(); return A && A.metaOf ? A.metaOf(id) : { label: '', firm: '', type: '' }; };
// name = label or broker; short = "Apex eval 1 · Apex" for the button; full = "Apex eval 1 · Apex · Tradovate APEX-123456-01"
export function titleOf(a) {
  const A = API(); if (!A) return { name: a.broker, short: a.broker, full: a.text || a.broker, firm: '', type: '' };
  const t = A.L.acctTitle(a, metaOf(a.id));
  return Object.assign(t, { short: t.name + (t.firm && t.firm !== t.name ? ' · ' + t.firm : '') });
}
// balance cell: skeleton while loading, "—" when the broker gives none
function balHtml(id) {
  const A = API(); const b = A && A.balance ? A.balance(id) : { state: 'none' };
  if (b.state === 'loading') return '<span class="stktm-bal" data-bal="' + esc(id) + '"><i class="stktm-skel" role="img" aria-label="Loading balance"></i></span>';
  if (b.state !== 'ok') return '<span class="stktm-bal" data-bal="' + esc(id) + '" title="Balance not available">—</span>';
  const upl = b.upl != null && b.upl !== 0 ? '<em class="' + (b.upl > 0 ? 'up' : 'down') + '" title="Open P&amp;L">' + esc(A.L.fmtMoney(b.upl, b.currency, true)) + '</em>' : '';
  return '<span class="stktm-bal" data-bal="' + esc(id) + '" title="Account balance">' + esc(A.L.fmtMoney(b.amount, b.currency)) + upl + '</span>';
}
const pickBtn = (attrs, on, label, inner) => '<button type="button" role="menuitemradio" class="stkc-item stktm-pick" ' + attrs + ' aria-checked="' + !!on + '" aria-label="' + esc(label) + '" tabindex="-1">' + inner + '</button>';
function paperRow(paper, on) {
  const p = paper || {};
  const upl = p.upl ? '<em class="' + (/^-/.test(p.upl) ? 'down' : 'up') + '" title="Open P&amp;L">' + esc(p.upl) + '</em>' : '';
  return '<div class="stktm-row" data-row="paper">' + pickBtn('data-a="paper"', on, 'Paper trading' + (p.bal ? ', balance ' + p.bal : ''), PAPER_IC +
    '<span class="stktm-tx"><span class="stktm-l1"><span class="stktm-nm">Paper trading</span></span><span class="stktm-l2"><span class="stktm-meta">Simulated</span>' +
    (p.bal ? '<span class="stktm-bal" title="Paper balance">' + esc(p.bal) + upl + '</span>' : '') + '</span></span>') + (on ? CHK : NOCHK) + '</div>';
}
function liveRow(a, live, on) {
  const s = status(a, live), t = titleOf(a), m = metaOf(a.id);
  const metaBits = [m.firm, m.label ? a.broker : '', t.type, s.c === 'ok' && s.t === 'Connected' ? '' : s.t].filter(Boolean);   // plain "Connected" = the green dot (title)
  return '<div class="stktm-row" data-row="' + esc(a.id) + '">' +
    pickBtn('data-a="live" data-id="' + esc(a.id) + '"', on, t.full + ', ' + s.t, logo(a.broker, 28) +
      '<span class="stktm-tx"><span class="stktm-l1"><span class="stktm-nm">' + esc(t.name) + '</span>' +
      (a.number ? '<span class="stktm-num" data-copy="' + esc(a.number) + '" title="Copy account number">' + esc(a.number) + '</span>' : '') + '</span>' +
      '<span class="stktm-l2"><i class="stktm-dot ' + s.c + '" title="' + esc(s.t) + '" aria-hidden="true"></i><span class="stktm-meta">' + esc(metaBits.join(' · ')) + '</span>' + balHtml(a.id) + '</span></span>') +
    '<span class="stktm-acts"><button type="button" role="menuitem" class="stktm-act" data-x="edit" data-id="' + esc(a.id) + '" tabindex="-1" aria-label="Edit ' + esc(t.full) + '" title="Edit label, prop firm, type">' + PEN + '</button>' +
    '<button type="button" role="menuitem" class="stktm-act stktm-act-off" data-x="off" data-id="' + esc(a.id) + '" tabindex="-1" aria-label="Disconnect ' + esc(a.text) + '" title="Disconnect">' + UNPLUG + '</button></span>' +
    (on ? CHK : NOCHK) + '</div>';
}

// live = window.__stkLive.state or null (members); paper = { bal: "$100,022.00", upl: "+$12.00" | '' } (a plain string = bal)
let lastArgs = null;
export function draw(pop, live, paper) {
  if (typeof paper === 'string') paper = { bal: paper };
  lastArgs = [live, paper];
  const act = live && live.acct;
  let h = '<div role="group" aria-labelledby="stktm-h1"><div class="stktm-h" id="stktm-h1">Paper</div>' + paperRow(paper, !act) + '</div>';
  if (live) {
    h += '<div role="group" aria-labelledby="stktm-h2"><div class="stktm-h" id="stktm-h2">Live accounts</div>';
    if (!live.accounts.length) h += '<div class="stktm-empty">' + (live.loaded ? 'No broker connected yet.' : 'Loading accounts…') + '</div>';
    h += live.accounts.map((a) => liveRow(a, live, act && act.id === a.id)).join('') + '</div>';
    h += '<div class="stktm-foot"><button type="button" role="menuitem" class="stktm-pill stktm-add" data-a="connect" tabindex="-1">' + SV(14, '<path d="M12 5v14M5 12h14"/>', 2.4) + 'Connect a broker</button><a class="stktm-pill stktm-manage" role="menuitem" href="trade-journal.html#jb-panel" tabindex="-1">Manage</a></div>';
  }
  pop.innerHTML = h;
  pop.classList.toggle('stktm-admin', !!live);
  pop.querySelectorAll('img[data-fb]').forEach((i) => i.addEventListener('error', () => { i.parentNode.innerHTML = i.dataset.fb; }, { once: true }));
  wire(pop);
}
// in-place refresh after a balance / label read, keeping focus; never while the editor or the dialog is open
function refresh(pop, what, id) {
  if (pop.hidden || !lastArgs || !lastArgs[0]) return;
  if (what === 'balance') { pop.querySelectorAll('[data-bal="' + cssId(id) + '"]').forEach((el) => { el.outerHTML = balHtml(id); }); return; }
  if (pop.querySelector('.stktm-ed') || document.getElementById('stktm-dlg')) return;
  const ae = document.activeElement, f = ae && pop.contains(ae) ? [ae.dataset.x || ae.dataset.a || '', ae.dataset.id || ''] : null;
  draw(pop, lastArgs[0], lastArgs[1]);
  if (f) { const el = [...pop.querySelectorAll('[data-a],[data-x]')].find((e) => (e.dataset.x || e.dataset.a) === f[0] && (e.dataset.id || '') === f[1]); if (el) el.focus(); }
}

// ---- delegated handlers (wired once per menu element). chart-paper.js's own click handler ignores [data-copy] / [data-x] / editor.
function wire(pop) {
  if (pop.__stktm) return; pop.__stktm = true;
  window.addEventListener('stklive:menu', (e) => refresh(pop, e.detail && e.detail.what, e.detail && e.detail.id));
  pop.addEventListener('click', (e) => {
    const cp = e.target.closest('[data-copy]');
    if (cp && pop.contains(cp)) { e.preventDefault(); e.stopPropagation(); copy(cp.dataset.copy); return; }
    const x = e.target.closest('[data-x]');
    if (x && pop.contains(x)) { e.preventDefault(); e.stopPropagation(); if (x.dataset.x === 'edit') openEditor(pop, x.dataset.id); else askDisconnect(pop, x.dataset.id); return; }
    if (e.target.closest('.stktm-ed')) { e.stopPropagation(); return; }
    const row = e.target.closest('.stktm-row');   // the tick / row padding picks the row too
    if (row && !e.target.closest('[data-a]')) { e.stopPropagation(); const b = row.querySelector('.stktm-pick'); if (b) b.click(); }
  });
}
export const ownsClick = (t) => !!(t && t.closest && t.closest('[data-copy],[data-x],.stktm-ed'));
function copy(text) {
  const done = () => toast('Account number copied.', 'success');
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done)); return; } } catch (e) {}
  fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} t.remove();
  if (ok) done(); else toast('Copy failed. Select the number and copy it by hand.', 'error');
}
function toast(m, type) { try { if (window.showToast) window.showToast(type === 'error' ? 'error' : type === 'success' ? 'success' : 'info', m); } catch (e) {} }

// ---- pencil: inline editor under the row (label, prop firm, account type)
function openEditor(pop, id) {
  const A = API(); if (!A) return;
  const live = lastArgs && lastArgs[0]; const a = live && live.accounts.find((x) => x.id === id); if (!a) return;
  closeEditor(pop);
  const m = metaOf(id), firms = A.L.FIRMS, other = !!m.firm && !firms.includes(m.firm);
  const row = pop.querySelector('.stktm-row[data-row="' + cssId(id) + '"]'); if (!row) return;
  row.classList.add('editing');
  const ed = document.createElement('form'); ed.className = 'stktm-ed'; ed.setAttribute('aria-label', 'Edit ' + a.text); ed.noValidate = true;
  ed.innerHTML =
    '<div class="stktm-ed-id"><span class="stktm-ed-k">' + esc(a.broker) + '</span>' + (a.number ? '<button type="button" class="stktm-ed-num" data-copy="' + esc(a.number) + '" title="Copy account number"><span>' + esc(a.number) + '</span>' + COPY + '</button>' : '<span class="stktm-ed-k">No account number from the broker</span>') + '</div>' +
    '<label class="stktm-f"><span>Label</span><input name="label" type="text" maxlength="40" autocomplete="off" placeholder="e.g. Apex eval 1" value="' + esc(m.label) + '"></label>' +
    '<label class="stktm-f"><span>Prop firm</span><span class="stktm-sel"><select name="firm"><option value="">None</option>' + firms.map((f) => '<option' + (f === m.firm ? ' selected' : '') + '>' + esc(f) + '</option>').join('') + '<option value="__other"' + (other ? ' selected' : '') + '>Other…</option></select>' + SV(12, '<path d="m6 9 6 6 6-6"/>', 2.2) + '</span></label>' +
    '<label class="stktm-f stktm-f-other"' + (other ? '' : ' hidden') + '><span>Firm name</span><input name="other" type="text" maxlength="40" autocomplete="off" placeholder="Firm name" value="' + esc(other ? m.firm : '') + '"></label>' +
    '<div class="stktm-f"><span id="stktm-ty">Account type</span><div class="stktm-seg" role="radiogroup" aria-labelledby="stktm-ty">' + A.L.TYPES.map(([k, t]) => '<button type="button" role="radio" data-ty="' + k + '" aria-checked="' + (m.type === k) + '">' + t + '</button>').join('') + '</div></div>' +
    '<div class="stktm-ed-btns"><button type="button" class="stktm-pill" data-ed="cancel">Cancel</button><button type="submit" class="stktm-pill stktm-pri">Save</button></div>';
  row.after(ed);
  const sel = ed.querySelector('select'), oth = ed.querySelector('.stktm-f-other');
  sel.addEventListener('change', () => { oth.hidden = sel.value !== '__other'; if (!oth.hidden) oth.querySelector('input').focus(); });
  ed.querySelectorAll('[data-ty]').forEach((b) => b.addEventListener('click', () => { const on = b.getAttribute('aria-checked') !== 'true'; ed.querySelectorAll('[data-ty]').forEach((x) => x.setAttribute('aria-checked', 'false')); b.setAttribute('aria-checked', String(on)); }));
  ed.querySelector('[data-ed=cancel]').addEventListener('click', () => { closeEditor(pop); focusRow(pop, id, 'edit'); });
  ed.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeEditor(pop); focusRow(pop, id, 'edit'); } else e.stopPropagation(); });
  ed.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ty = ed.querySelector('[data-ty][aria-checked="true"]');
    const firm = sel.value === '__other' ? ed.querySelector('[name=other]').value : sel.value;
    const save = ed.querySelector('.stktm-pri'); save.disabled = true; save.textContent = 'Saving…';
    const r = await A.saveMeta(id, { label: ed.querySelector('[name=label]').value, firm, type: ty ? ty.dataset.ty : '' });
    closeEditor(pop); draw(pop, lastArgs[0], lastArgs[1]); focusRow(pop, id, 'edit');
    toast(r && r.local ? 'Saved on this device.' : 'Saved.', 'success');
  });
  setTimeout(() => ed.querySelector('[name=label]').focus(), 0);
}
function closeEditor(pop) { pop.querySelectorAll('.stktm-ed').forEach((e) => e.remove()); pop.querySelectorAll('.stktm-row.editing').forEach((r) => r.classList.remove('editing')); }
function focusRow(pop, id, k) { const el = pop.querySelector('[data-x="' + k + '"][data-id="' + cssId(id) + '"]') || pop.querySelector('[data-a=live][data-id="' + cssId(id) + '"]'); if (el) el.focus(); }

// ---- disconnect: confirm dialog, then revoke the account's grant (chart-live.js disconnect -> data.js op 'revoke'), back to Paper
function askDisconnect(pop, id) {
  const A = API(); if (!A) return;
  const live = lastArgs && lastArgs[0]; const a = live && live.accounts.find((x) => x.id === id); if (!a) return;
  const opener = document.getElementById('stkc-paper-btn');
  const old = document.getElementById('stktm-dlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'stktm-dlg';
  const t = titleOf(a);
  d.innerHTML = '<div class="stktm-dlg-box" role="alertdialog" aria-modal="true" aria-labelledby="stktm-dlg-h" aria-describedby="stktm-dlg-d">' +
    '<div class="stktm-dlg-top">' + logo(a.broker, 28) + '<h2 id="stktm-dlg-h">Disconnect ' + esc(a.broker) + (a.number ? ' <span class="stktm-nw">' + esc(a.number) + '?</span>' : '?') + '</h2></div>' +
    '<p id="stktm-dlg-d">' + (t.name !== a.broker ? esc(t.name) + '. ' : '') + 'You can connect it again any time.' + (live.acct && live.acct.id === id ? ' The chart goes back to Paper.' : '') + '</p><p class="stktm-dlg-err" role="alert" hidden></p>' +
    '<div class="stktm-dlg-btns"><button type="button" class="stktm-pill" data-k="no">Cancel</button><button type="button" class="stktm-pill stktm-danger" data-k="yes">Disconnect</button></div></div>';
  document.body.appendChild(d);
  d.querySelectorAll('img[data-fb]').forEach((i) => i.addEventListener('error', () => { i.parentNode.innerHTML = i.dataset.fb; }, { once: true }));
  pop.hidden = true; if (opener) opener.setAttribute('aria-expanded', 'false');   // the menu closes behind the dialog
  const close = () => { d.remove(); document.removeEventListener('keydown', key, true); if (opener) opener.focus(); };
  const yes = d.querySelector('[data-k=yes]'), err = d.querySelector('.stktm-dlg-err');
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') { const f = [...d.querySelectorAll('button:not([disabled])')]; const i = f.indexOf(document.activeElement); e.preventDefault(); if (f.length) f[(i + (e.shiftKey ? f.length - 1 : 1) + f.length) % f.length].focus(); }
  };
  document.addEventListener('keydown', key, true);
  d.addEventListener('mousedown', (e) => { if (e.target === d) close(); });
  d.querySelector('[data-k=no]').addEventListener('click', close);
  yes.addEventListener('click', async () => {
    yes.disabled = true; yes.textContent = 'Disconnecting…'; err.hidden = true;
    const r = await A.disconnect(id);
    if (r && r.ok) { close(); return; }
    yes.disabled = false; yes.textContent = 'Disconnect'; err.textContent = (r && r.error) || 'Could not disconnect.'; err.hidden = false;
  });
  setTimeout(() => d.querySelector('[data-k=no]').focus(), 0);
}

// Trade button face: logo/icon + name (+ live dot). Returns the text for aria/phone label.
export function button(b, live) {
  const act = live && live.acct, t = act ? titleOf(act) : null, name = act ? t.short : 'Paper';
  const sig = act ? act.id + '|' + name + '|' + (live.env && live.env.env) : 'paper';
  if (b.dataset.tmSig !== sig) {
    b.dataset.tmSig = sig;
    b.innerHTML = (act ? logo(act.broker, 16) + '<i class="stktm-live" aria-hidden="true"></i>' : SV(16, '<path d="M7 17 17 7M9 7h8v8"/>')) + '<span class="stkc-btn-l">' + esc(name) + '</span><svg class="stktm-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    b.querySelectorAll('img[data-fb]').forEach((i) => i.addEventListener('error', () => { i.parentNode.innerHTML = i.dataset.fb; }, { once: true }));
    b.title = act ? 'Trading on ' + t.full : 'Trade: pick paper or a live account';
  }
  return act ? ((live.env && live.env.env === 'sandbox' ? 'SANDBOX ' : 'LIVE ') + name) : 'Paper';
}
// Up/Down/Home/End move between rows; Right/Left into / out of a row's buttons; Enter/Space use the button's own click.
export function keys(pop, e) {
  const t = e.target;
  if (t && t.closest && (t.closest('.stktm-ed') || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return false;
  const main = [...pop.querySelectorAll('[role^=menuitem]:not(.stktm-act)')]; if (!main.length) return false;
  const inAct = !!(t && t.classList && t.classList.contains('stktm-act'));
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const row = t && t.closest && t.closest('.stktm-row'); if (!row) return false;
    const acts = [...row.querySelectorAll('.stktm-act')]; if (!acts.length) return false;
    const i = acts.indexOf(t);
    const n = e.key === 'ArrowRight' ? (inAct ? acts[Math.min(i + 1, acts.length - 1)] : acts[0]) : (inAct ? (i > 0 ? acts[i - 1] : row.querySelector('.stktm-pick')) : null);
    if (!n) return false; e.preventDefault(); n.focus(); return true;
  }
  const cur = inAct ? t.closest('.stktm-row').querySelector('.stktm-pick') : document.activeElement;
  const i = main.indexOf(cur); let n = -1;
  if (e.key === 'ArrowDown') n = (i + 1) % main.length; else if (e.key === 'ArrowUp') n = (i <= 0 ? main.length : i) - 1; else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = main.length - 1;
  if (n < 0) return false; e.preventDefault(); main[n].focus(); return true;
}
export const focusFirst = (pop) => { const e = pop.querySelector('.stktm-pick[aria-checked="true"]') || pop.querySelector('[role^=menuitem]'); if (e) e.focus(); };
