// TradeZoro — Charts "Trade" button + connection menu (Owner orders 2026-11-16: logo of the connection, better button; then "make it
// more proper, add proper logo, account number is wrong, add total money, add a pencil button (label / prop firm) and a disconnect icon").
// Pure view code: chart-paper.js owns the pick actions (data-a = paper | live | connect) and calls draw()/button()/keys() below.
// Broker names, logos, balances and the edit / disconnect buttons only ever appear when `live` is passed, which only the admin-only live
// module provides (window.__stkLive: balance(), metaOf(), saveMeta(), disconnect(), L = chart-live-core.js). Members see Paper only.
//
// Redesign (Owner 2026-11-17, mock): every account is a CARD (tile | name + number / dot + broker · type | divider | Balance | pencil + gear | tick).
// Gear menu: Edit details / Manage / Disconnect (paper: Turn off paper trading). Footer: Connect a broker + Manage (opens the in-chart Manage accounts sheet, no page change).
// (older notes) Row layout: logo 28 | two lines (top: label or broker + account number in mono, click = copy; bottom: status dot · firm · broker ·
// balance) | pencil + disconnect (32px hit areas; on hover / focus with a mouse, always on touch) | tick on the active one.
// Paper row (Owner order 2026-11-17): the same columns; the pencil slot is reserved (empty) and its disconnect (always visible while
// paper trading is on) turns paper trading off on the chart after a confirm (paper.off(), chart-paper.js); account + history are kept.
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
  return '<span class="stktm-logo ' + (size === 16 ? 'stktm-s16' : size === 24 ? 'stktm-s24' : size === 40 ? 'stktm-s40' : 'stktm-s28') + '" aria-hidden="true">' + (KNOWN.has(k) ? '<img src="assets/img/brokers/' + k + '.png" alt="" width="' + (size === 40 ? 28 : size) + '" height="' + (size === 40 ? 28 : size) + '" decoding="async" data-fb="' + esc(fb) + '">' : fb) + '</span>';
}
const SV = (w, d, sw) => '<svg width="' + w + '" height="' + w + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.8) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const PAPER_IC = '<span class="stktm-logo stktm-s40 stktm-paper" aria-hidden="true">' + SV(20, '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>') + '</span>';
const CHK = '<span class="stktm-tick" aria-hidden="true">' + SV(24, '<circle cx="12" cy="12" r="9.5"/><path d="m8 12.3 2.8 2.8L16 9.5"/>', 2) + '</span>';
const NOCHK = '<span class="stktm-tick" aria-hidden="true"></span>';
const GEAR = SV(16, '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>');
const SLIDERS = SV(16, '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>');
const X = SV(16, '<path d="M6 6l12 12M18 6 6 18"/>', 2);
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
// balance cell (label over amount): skeleton while loading, "—" when the broker gives none
// age (live only, 2026-11-19): "updated 4 min ago" under the amount when the broker's snapshot is older than 2 min
const balCell = (v, attrs, upl, age) => '<span class="stktm-bal"' + attrs + '><span class="stktm-bk">Balance' + (upl || '') + '</span><span class="stktm-bv">' + v + '</span>' + (age ? '<span class="stktm-age">' + esc(age) + '</span>' : '') + '</span>';
function balHtml(id) {
  const A = API(); const b = A && A.balance ? A.balance(id) : { state: 'none' }, at = ' data-bal="' + esc(id) + '"';
  if (b.state === 'loading') return balCell('<i class="stktm-skel" role="img" aria-label="Loading balance"></i>', at);
  if (b.state !== 'ok') return balCell('—', at + ' title="Balance not available"');
  const upl = b.upl != null && b.upl !== 0 ? '<em class="' + (b.upl > 0 ? 'up' : 'down') + '" title="Open P&amp;L">' + esc(A.L.fmtMoney(b.upl, b.currency, true)) + '</em>' : '';
  return balCell(esc(A.L.fmtMoney(b.amount, b.currency)), at + ' title="' + (b.adjusted ? 'Your broker’s balance plus the fills since it' : 'Account balance') + '"', upl, b.age);
}
const pickBtn = (attrs, on, label, inner) => '<button type="button" role="menuitemradio" class="stkc-item stktm-pick" ' + attrs + ' aria-checked="' + !!on + '" aria-label="' + esc(label) + '" tabindex="-1">' + inner + '</button>';
const VD = '<i class="stktm-vd" aria-hidden="true"></i>';
const iconBtn = (x, id, label, ic, cls) => '<button type="button" role="menuitem" class="stktm-act' + (cls ? ' ' + cls : '') + '" data-x="' + x + '"' + (id ? ' data-id="' + esc(id) + '"' : '') + ' tabindex="-1" aria-label="' + esc(label) + '" title="' + esc(label) + '"' + (x === 'gear' ? ' aria-haspopup="menu" aria-expanded="false"' : '') + '>' + ic + '</button>';
function paperRow(paper, on, admin) {
  const p = paper || {};
  const gear = p.off && p.enabled !== false ? iconBtn('gear', 'paper', 'Paper trading settings', GEAR) : '<span class="stktm-ph" aria-hidden="true"></span>';
  const upl = p.upl ? '<em class="' + (/^-/.test(p.upl) ? 'down' : 'up') + '" title="Open P&amp;L">' + esc(p.upl) + '</em>' : '';
  return '<div class="stktm-row" data-row="paper">' + pickBtn('data-a="paper"', on, 'Paper trading' + (p.bal ? ', balance ' + p.bal : ''), PAPER_IC +
    '<span class="stktm-tx"><span class="stktm-l1"><span class="stktm-nm">Paper Trading</span></span><span class="stktm-l2"><span class="stktm-chip">Simulated</span></span></span>' + VD +
    (p.bal ? balCell(esc(p.bal), ' title="Paper balance"', upl) : balCell('—', '')) ) +
    (admin ? '<span class="stktm-acts"><span class="stktm-ph" aria-hidden="true"></span>' + gear + '</span>' : '') + (on ? CHK : NOCHK) + '</div>';
}
// mode 'sheet' = Manage accounts sheet: no pick / tick, Disconnect shown instead of the gear
function liveRow(a, live, on, mode) {
  const s = status(a, live), t = titleOf(a), sheet = mode === 'sheet';
  const bits = [a.broker, t.firm && t.firm !== t.name ? t.firm : '', t.type, s.c === 'ok' && s.t === 'Connected' ? '' : s.t].filter(Boolean);   // plain "Connected" = the green dot (title)
  const info = logo(a.broker, 40) + '<span class="stktm-tx"><span class="stktm-l1"><span class="stktm-nm">' + esc(t.name) + '</span>' +
    (a.number ? '<span class="stktm-num" data-copy="' + esc(a.number) + '" title="Copy account number">' + esc(a.number) + '</span>' : '') + '</span>' +
    '<span class="stktm-l2"><i class="stktm-dot ' + s.c + '" title="' + esc(s.t) + '" aria-hidden="true"></i><span class="stktm-meta">' + esc(bits.join(' · ')) + '</span></span></span>' + VD + balHtml(a.id);
  const pen = iconBtn('edit', a.id, 'Edit ' + t.full, PEN);
  return '<div class="stktm-row" data-row="' + esc(a.id) + '">' +
    (sheet ? '<div class="stktm-pick stktm-static">' + info + '</div>' : pickBtn('data-a="live" data-id="' + esc(a.id) + '"', on, t.full + ', ' + s.t, info)) +
    '<span class="stktm-acts">' + pen + (sheet ? iconBtn('off', a.id, 'Disconnect ' + a.text, UNPLUG, 'stktm-act-off') : iconBtn('gear', a.id, 'Settings for ' + t.full, GEAR)) + '</span>' +
    (sheet ? '' : on ? CHK : NOCHK) + '</div>';
}

// live = window.__stkLive.state or null (members); paper = { bal: "$100,022.00", upl: "+$12.00" | '' } (a plain string = bal)
let lastArgs = null;
export function draw(pop, live, paper) {
  if (typeof paper === 'string') paper = { bal: paper };
  lastArgs = [live, paper];
  closeGear();
  const act = live && live.acct;
  let h = '<div role="group" aria-label="Paper trading">' + paperRow(paper, !act && !(paper && paper.enabled === false), !!live || !!(paper && paper.off)) + '</div>';
  if (live) {
    h += '<div role="group" aria-labelledby="stktm-h2"><div class="stktm-h" id="stktm-h2">Live accounts<span class="stktm-cnt">' + live.accounts.length + '</span></div>';
    if (!live.accounts.length) h += '<div class="stktm-empty">' + (live.loaded ? 'No broker connected yet.' : 'Loading accounts…') + '</div>';
    h += live.accounts.map((a) => liveRow(a, live, act && act.id === a.id)).join('') + '</div>';
    h += '<div class="stktm-foot"><button type="button" role="menuitem" class="stktm-pill stktm-add" data-a="connect" tabindex="-1">' + SV(16, '<path d="M12 5v14M5 12h14"/>', 2.2) + 'Connect a broker</button><button type="button" role="menuitem" class="stktm-pill stktm-manage" data-x="manage" tabindex="-1">' + SLIDERS + 'Manage</button></div>';
    if (window.__stkHl) h += '<button type="button" role="menuitem" class="stktm-pill stktm-hl" data-a="hl" tabindex="-1">Hyperliquid wallet</button>';   // admin only: hl-trade.js sets window.__stkHl after its admin check
  }
  pop.innerHTML = h;
  pop.classList.toggle('stktm-admin', !!live || !!(paper && paper.off));
  pop.querySelectorAll('img[data-fb]').forEach((i) => i.addEventListener('error', () => { i.parentNode.innerHTML = i.dataset.fb; }, { once: true }));
  wire(pop);
}
// in-place refresh after a balance / label read, keeping focus; never while the editor or the dialog is open
function refresh(pop, what, id) {
  const sh = document.getElementById('stktm-mg');
  if (sh) { if (what === 'balance') sh.querySelectorAll('[data-bal="' + cssId(id) + '"]').forEach((el) => { el.outerHTML = balHtml(id); }); else if (!sh.querySelector('.stktm-ed')) drawSheet(sh); }
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
  pop.addEventListener('click', (e) => onClick(e, pop, pop));
}
// shared by the menu and the Manage sheet. root = the element holding the rows (the editor opens under a row there).
function onClick(e, root, pop) {
  const cp = e.target.closest('[data-copy]');
  if (cp && root.contains(cp)) { e.preventDefault(); e.stopPropagation(); copy(cp.dataset.copy); return; }
  const x = e.target.closest('[data-x]');
  if (x && root.contains(x)) {
    e.preventDefault(); e.stopPropagation();
    const k = x.dataset.x;
    if (k === 'gear') openGear(pop, x);
    else if (k === 'manage') openSheet(pop);
    else if (k === 'edit') { closeGear(); openEditor(root, x.dataset.id); }
    else if (k === 'paperoff') askPaperOff(pop);
    else if (k === 'off') askDisconnect(pop, x.dataset.id);
    return;
  }
  if (e.target.closest('.stktm-ed')) { e.stopPropagation(); return; }
  const row = e.target.closest('.stktm-row');   // the tick / row padding picks the row too
  if (row && root === pop && !e.target.closest('[data-a]')) { e.stopPropagation(); const b = row.querySelector('.stktm-pick'); if (b) b.click(); }
}
export const ownsClick = (t) => !!(t && t.closest && t.closest('[data-copy],[data-x],.stktm-ed,.stktm-gm'));
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
function openEditor(pop, id) {   // pop = the menu or the Manage sheet
  const A = API(); if (!A) return;
  const live = liveNow(); const a = live && live.accounts.find((x) => x.id === id); if (!a) return;
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
    closeEditor(pop); redraw(pop); focusRow(pop, id, 'edit');
    toast(r && r.local ? 'Saved on this device.' : 'Saved.', 'success');
  });
  setTimeout(() => ed.querySelector('[name=label]').focus(), 0);
}
const liveNow = () => (document.getElementById('stktm-mg') && API() ? API().state : null) || (lastArgs && lastArgs[0]);
const redraw = (root) => { if (root.id === 'stktm-mg') drawSheet(root); else draw(root, lastArgs[0], lastArgs[1]); };
function closeEditor(pop) { pop.querySelectorAll('.stktm-ed').forEach((e) => e.remove()); pop.querySelectorAll('.stktm-row.editing').forEach((r) => r.classList.remove('editing')); }
function focusRow(pop, id, k) { const el = pop.querySelector('[data-x="' + k + '"][data-id="' + cssId(id) + '"]') || pop.querySelector('[data-a=live][data-id="' + cssId(id) + '"]'); if (el) el.focus(); }

// ---- paper disconnect: confirm, then paper.off() (chart-paper.js: panel closed, paper lines gone, Trade button back to "Trade")
function askPaperOff(pop) {
  const off = lastArgs && lastArgs[1] && lastArgs[1].off; if (!off) return;
  dialog(pop, '<span class="stktm-logo stktm-s28 stktm-paper" aria-hidden="true">' + SV(16, '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>') + '</span><h2 id="stktm-dlg-h">Turn off paper trading on this chart?</h2>',
    'Your paper account and history are kept. Pick Paper trading in the Trade menu to turn it back on.', 'Turn off', async () => { await off(); return { ok: true }; });
}
// shared confirm dialog (focus trapped, Esc / backdrop = cancel). run() -> { ok } | { error }
function dialog(pop, top, text, yesText, run) {
  const opener = document.getElementById('stkc-paper-btn');
  const old = document.getElementById('stktm-dlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'stktm-dlg';
  d.innerHTML = '<div class="stktm-dlg-box" role="alertdialog" aria-modal="true" aria-labelledby="stktm-dlg-h" aria-describedby="stktm-dlg-d">' +
    '<div class="stktm-dlg-top">' + top + '</div><p id="stktm-dlg-d">' + esc(text) + '</p><p class="stktm-dlg-err" role="alert" hidden></p>' +
    '<div class="stktm-dlg-btns"><button type="button" class="stktm-pill" data-k="no">Cancel</button><button type="button" class="stktm-pill stktm-danger" data-k="yes">' + esc(yesText) + '</button></div></div>';
  document.body.appendChild(d);
  pop.hidden = true; if (opener) opener.setAttribute('aria-expanded', 'false');
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
    yes.disabled = true; err.hidden = true;
    const r = await run();
    if (r && r.ok) { close(); return; }
    yes.disabled = false; err.textContent = (r && r.error) || 'Something went wrong. Try again.'; err.hidden = false;
  });
  setTimeout(() => d.querySelector('[data-k=no]').focus(), 0);
}

// ---- disconnect: confirm dialog, then revoke the account's grant (chart-live.js disconnect -> data.js op 'revoke'), back to Paper
function askDisconnect(pop, id) {
  const A = API(); if (!A) return;
  const live = liveNow(); const a = live && live.accounts.find((x) => x.id === id); if (!a) return;
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
    if (r && r.ok) { close(); const sh = document.getElementById('stktm-mg'); if (sh) drawSheet(sh); return; }
    yes.disabled = false; yes.textContent = 'Disconnect'; err.textContent = (r && r.error) || 'Could not disconnect.'; err.hidden = false;
  });
  setTimeout(() => d.querySelector('[data-k=no]').focus(), 0);
}

// ---- gear menu: small popover (fixed, so the menu's scroll never clips it)
function closeGear() { const g = document.getElementById('stktm-gm'); if (!g) return; const b = g.__btn; g.remove(); document.removeEventListener('click', g.__off, true); if (b) b.setAttribute('aria-expanded', 'false'); }
function openGear(pop, btn) {
  const had = document.getElementById('stktm-gm') && document.getElementById('stktm-gm').__btn === btn; closeGear(); if (had) return;
  const id = btn.dataset.id, paper = id === 'paper', g = document.createElement('div'); g.id = 'stktm-gm'; g.className = 'stktm-gm'; g.setAttribute('role', 'menu');
  const it = (k, t, cls) => '<button type="button" role="menuitem" class="stktm-gi' + (cls ? ' ' + cls : '') + '" data-g="' + k + '" tabindex="-1">' + t + '</button>';
  g.innerHTML = paper ? it('paperoff', 'Turn off paper trading on this chart', 'stktm-gi-bad') : it('edit', 'Edit details') + it('manage', 'Manage') + it('off', 'Disconnect', 'stktm-gi-bad');
  document.body.appendChild(g); g.__btn = btn; btn.setAttribute('aria-expanded', 'true');
  const R = btn.getBoundingClientRect(), w = g.offsetWidth, h = g.offsetHeight;
  g.style.left = Math.max(8, Math.min(innerWidth - w - 8, R.right - w)) + 'px';
  g.style.top = (R.bottom + 4 + h > innerHeight - 8 ? Math.max(8, R.top - 4 - h) : R.bottom + 4) + 'px';
  const act = (k) => { closeGear(); if (k === 'edit') openEditor(pop, id); else if (k === 'manage') openSheet(pop); else if (k === 'paperoff') askPaperOff(pop); else askDisconnect(pop, id); };
  g.addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (b) { e.stopPropagation(); act(b.dataset.g); } });
  g.addEventListener('keydown', (e) => {
    const f = [...g.querySelectorAll('[data-g]')], i = f.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeGear(); btn.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); f[(i + (e.key === 'ArrowDown' ? 1 : f.length - 1)) % f.length].focus(); }
    else if (e.key === 'Tab') { e.preventDefault(); closeGear(); btn.focus(); }
    else e.stopPropagation();
  });
  g.__off = (e) => { if (!g.contains(e.target) && !btn.contains(e.target)) closeGear(); };
  document.addEventListener('click', g.__off, true);
  g.querySelector('[data-g]').focus();
}

// ---- Manage accounts sheet (Owner 2026-11-17): every connected account, Edit (the same inline editor) + Disconnect (the same confirm + revoke).
// Centre dialog on desktop, bottom sheet on phones. Esc / X / backdrop close it. No page change.
function openSheet(pop) {
  const A = API(); if (!A || !A.state) return;
  closeGear();
  const opener = document.getElementById('stkc-paper-btn'), old = document.getElementById('stktm-mg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'stktm-mg';
  d.innerHTML = '<div class="stktm-mg-box" role="dialog" aria-modal="true" aria-labelledby="stktm-mg-h"><div class="stktm-mg-hd"><h2 id="stktm-mg-h">Manage accounts</h2><span class="stktm-cnt" data-cnt></span><button type="button" class="stktm-act stktm-mg-x" data-k="x" aria-label="Close" title="Close">' + X + '</button></div><div class="stktm-mg-body"></div><div class="stktm-mg-ft"><button type="button" class="stktm-pill stktm-add" data-k="connect">' + SV(16, '<path d="M12 5v14M5 12h14"/>', 2.2) + 'Connect a broker</button></div></div>';
  document.body.appendChild(d);
  pop.hidden = true; if (opener) opener.setAttribute('aria-expanded', 'false');
  drawSheet(d);
  const close = () => { d.remove(); if (opener) opener.focus(); };
  d.addEventListener('mousedown', (e) => { if (e.target === d) close(); });
  d.addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]');
    if (k && k.dataset.k === 'x') { close(); return; }
    if (k && k.dataset.k === 'connect') { close(); const L = API(); if (L && L.connect) L.connect(); return; }
    onClick(e, d, pop);
  });
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (d.querySelector('.stktm-ed')) { const id = d.querySelector('.stktm-row.editing'); closeEditor(d); if (id) focusRow(d, id.dataset.row, 'edit'); } else close(); }
    else if (e.key === 'Tab') { const f = [...d.querySelectorAll('button:not([disabled]),input,select,[data-copy]')].filter((x) => x.offsetParent); const i = f.indexOf(document.activeElement); if (f.length && !(e.shiftKey ? i === 0 : i === f.length - 1)) return; e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
    else e.stopPropagation();
  });
  setTimeout(() => { const x = d.querySelector('[data-x=edit]') || d.querySelector('.stktm-mg-x'); x.focus(); }, 0);
}
function drawSheet(d) {
  const A = API(), live = A && A.state; if (!live) return;
  const act = live.acct, body = d.querySelector('.stktm-mg-body');
  body.innerHTML = (live.accounts.length ? live.accounts.map((a) => liveRow(a, live, act && act.id === a.id, 'sheet')).join('') : '<div class="stktm-empty">No broker connected yet.</div>');
  d.querySelector('[data-cnt]').textContent = live.accounts.length;
  d.querySelectorAll('img[data-fb]').forEach((i) => i.addEventListener('error', () => { i.parentNode.innerHTML = i.dataset.fb; }, { once: true }));
}

// Trade button face: logo/icon + name (+ live dot). Returns the text for aria/phone label.
// paperOn === false (paper switched off, no live account): the "not trading" face, "Trade".
export function button(b, live, paperOn) {
  const act = live && live.acct, t = act ? titleOf(act) : null, off = !act && paperOn === false, name = act ? t.short : off ? 'Trade' : 'Paper';
  const sig = act ? act.id + '|' + name + '|' + (live.env && live.env.env) : off ? 'off' : 'paper';
  if (b.dataset.tmSig !== sig) {
    b.dataset.tmSig = sig;
    b.innerHTML = (act ? logo(act.broker, 16) + '<i class="stktm-live" aria-hidden="true"></i>' : SV(16, '<path d="M7 17 17 7M9 7h8v8"/>')) + '<span class="stkc-btn-l">' + esc(name) + '</span><svg class="stktm-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    b.querySelectorAll('img[data-fb]').forEach((i) => i.addEventListener('error', () => { i.parentNode.innerHTML = i.dataset.fb; }, { once: true }));
    b.title = act ? 'Trading on ' + t.full : off ? 'Trade: paper trading is off. Pick Paper trading to turn it on' : 'Trade: pick paper or a live account';
  }
  b.classList.toggle('stktm-off', off);
  return act ? ((live.env && live.env.env === 'sandbox' ? 'SANDBOX ' : 'LIVE ') + name) : off ? 'Trade' : 'Paper';
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
