// TradeZoro — Charts: shared script editor shell (ES module). The layout both editor panels use:
// assets/chart-zscript.js (Zscript) and assets/chart-pine.js (Pine import). Owner order 2026-11-15: "better and improved
// version of this indicator/script editor, with proper improved layout and alignment with good UI".
// Depends on: nothing at load. The code editor itself (assets/zs-editor/editor.js, vendored CodeMirror 6) is lazy-loaded by
// each panel. Styles: assets/style.css ".sed" block (built into style-charts.css).
//
// createShell(o) builds the DOM and owns only LAYOUT state: panel width (drag the left edge, remembered), Expand to a large
// centred editor, the narrow-mode Code | Library switch, the library tabs, the problems strip, the status pill, the More
// menu and the wrap toggle. The panels own their scripts, store and engines; nothing here touches saved data.
//
//   o = { id, label, closeLabel, ext, onClose(), onWrap(on), onFind(), onMore(key), moreItems: [[key, label, danger?]] }
//   returns { panel, segSlot, nameIn, target, edHost, errBox, addBtn, saveBtn, newBtn, moreBtn, lib, panes, setStatus,
//             problems, setOpenState(open), isPhone, isWide, setPrimary(text), docsSearch }

const W_KEY = 'stk_script_ed_w', WRAP_KEY = 'stk_script_ed_wrap';
const W_DEF = 560, W_MIN = 400, WIDE_AT = 720;
export const wrapPref = () => { try { return localStorage.getItem(WRAP_KEY) !== '0'; } catch (e) { return true; } };
const setWrapPref = (on) => { try { localStorage.setItem(WRAP_KEY, on ? '1' : '0'); } catch (e) {} };
const savedW = () => { try { const v = +localStorage.getItem(W_KEY); return v >= W_MIN ? v : W_DEF; } catch (e) { return W_DEF; } };

export const svg = (inner, size) => '<svg width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
export const ICONS = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  collapse: '<path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  play: '<path d="M7 5l11 7-11 7z"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  del: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  ren: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
  wrap: '<path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M4 18h5"/><path d="M15 16l-2 2 2 2"/>',
  find: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  err: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>'
};

export function el(tag, attrs, kids){
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
// icon button (44 tap target on phone via CSS)
export const ib = (label, icon, fn, cls) => el('button', { type: 'button', class: 'sed-ib' + (cls ? ' ' + cls : ''), title: label, 'aria-label': label, html: svg(icon, 18), onclick: fn });

// First "// ..." comment under the header: the row's one-line description.
export function descOf(src){
  const lines = String(src || '').split('\n');
  for (const l of lines.slice(0, 12)) { const m = /^\s*\/\/\s*(?!@)(.{3,})$/.exec(l); if (m) return m[1].trim().slice(0, 120); }
  return '';
}
export function ago(ms){
  if (!ms) return '';
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return 'Edited just now';
  if (d < 3600) return 'Edited ' + Math.round(d / 60) + ' min ago';
  if (d < 86400) return 'Edited ' + Math.round(d / 3600) + ' h ago';
  return 'Edited ' + new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const TABS = [['chart', 'On chart'], ['mine', 'My scripts'], ['examples', 'Examples'], ['docs', 'Docs']];

export function createShell(o){
  const panel = el('div', { class: 'stkc-pine sed' + (o.cls ? ' ' + o.cls : ''), id: o.id, role: 'dialog', 'aria-label': o.label, hidden: true });
  const grip = el('div', { class: 'sed-grip', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the editor', tabindex: '0', title: 'Drag to resize' });
  const segSlot = el('div', { class: 'sed-seg-slot' });
  const status = el('span', { class: 'sed-status', 'data-s': 'idle', role: 'status' });
  const expandBtn = ib('Expand the editor', ICONS.expand, () => setMax(!panel.classList.contains('is-max')), 'sed-expand');
  const closeBtn = ib(o.closeLabel || 'Close', ICONS.close, () => o.onClose && o.onClose(), 'sed-x');
  const nameIn = el('input', { type: 'text', class: 'sed-name', maxlength: '60', placeholder: 'Untitled script', 'aria-label': 'Script name', spellcheck: 'false', autocomplete: 'off' });
  const target = el('span', { class: 'sed-chip stkc-pine-target' });
  const hd = el('header', { class: 'stkc-pine-hd sed-hd' }, [
    el('div', { class: 'sed-hd-r1' }, [segSlot, el('div', { class: 'sed-hd-acts' }, [status, expandBtn, closeBtn])]),
    el('div', { class: 'sed-hd-r2' }, [nameIn, target])
  ]);

  // library: tabs + panes (each pane = a .stkc-tlist)
  const panes = {}, tabBtns = {};
  const tabRow = el('div', { class: 'sed-tabs', role: 'tablist', 'aria-label': 'Script library' });
  TABS.forEach(([k, label]) => {
    const b = el('button', { type: 'button', role: 'tab', class: 'sed-tab', 'data-k': k, id: o.id + '-tab-' + k, 'aria-selected': 'false', 'aria-controls': o.id + '-pane-' + k, tabindex: '-1' }, [el('span', { text: label }), el('span', { class: 'sed-tab-n' })]);
    b.addEventListener('click', () => pickTab(k, true));
    tabRow.appendChild(b); tabBtns[k] = b;
    panes[k] = el('div', { class: 'sed-pane', role: 'tabpanel', id: o.id + '-pane-' + k, 'aria-labelledby': o.id + '-tab-' + k, hidden: true });
  });
  tabRow.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const ks = TABS.map((t) => t[0]), i = ks.indexOf(curTab), n = ks[(i + (e.key === 'ArrowRight' ? 1 : ks.length - 1)) % ks.length];
    pickTab(n, true); tabBtns[n].focus();
  });
  const docsSearch = el('input', { type: 'search', class: 'sed-search', placeholder: 'Search built-ins', 'aria-label': 'Search built-ins', spellcheck: 'false', autocomplete: 'off' });
  panes.docs.appendChild(el('div', { class: 'sed-docs-hd' }, [docsSearch]));
  const libScroll = el('div', { class: 'sed-lib-scroll' }, TABS.map(([k]) => panes[k]));
  const note = el('p', { class: 'sed-note', text: o.note || '' });
  const lib = el('aside', { class: 'stkc-pine-lib sed-lib' }, [tabRow, libScroll, note]);
  let curTab = 'examples';
  function pickTab(k, user){
    curTab = k;
    TABS.forEach(([t]) => { const on = t === k; tabBtns[t].setAttribute('aria-selected', on ? 'true' : 'false'); tabBtns[t].tabIndex = on ? 0 : -1; panes[t].hidden = !on; });
    if (!user) return;   // the first pick runs while the panel is still being built
    try { sessionStorage.setItem('stk_script_ed_tab', k); } catch (e) {}
    if (o.onTab) o.onTab(k);
  }
  try { const t = sessionStorage.getItem('stk_script_ed_tab'); if (t && panes[t]) curTab = t; } catch (e) {}
  pickTab(curTab);
  const setCount = (k, n) => { tabBtns[k].querySelector('.sed-tab-n').textContent = n ? String(n) : ''; };

  // editor column: toolbar, code, problems
  const viewSeg = el('div', { class: 'sed-view', role: 'tablist', 'aria-label': 'View' });
  const viewBtns = {};
  [['code', 'Code'], ['lib', 'Library']].forEach(([k, label]) => {
    const b = el('button', { type: 'button', role: 'tab', class: 'sed-view-b', 'data-v': k, 'aria-selected': k === 'code' ? 'true' : 'false', text: label, onclick: () => setView(k) });
    viewSeg.appendChild(b); viewBtns[k] = b;
  });
  const keys = el('span', { class: 'sed-keys', html: '<kbd>' + mod() + '↵</kbd> Add <kbd>' + mod() + 'S</kbd> Save <kbd>' + mod() + '/</kbd> Comment' });
  let wrapOn = wrapPref();
  const wrapBtn = el('button', { type: 'button', class: 'sed-tool', 'aria-pressed': wrapOn ? 'true' : 'false', title: 'Soft wrap long lines', html: svg(ICONS.wrap, 16) + '<span>Wrap</span>', onclick: () => { wrapOn = !wrapOn; wrapBtn.setAttribute('aria-pressed', wrapOn ? 'true' : 'false'); setWrapPref(wrapOn); if (o.onWrap) o.onWrap(wrapOn); } });
  const findBtn = el('button', { type: 'button', class: 'sed-tool', title: 'Find and replace (' + mod() + 'F)', html: svg(ICONS.find, 16) + '<span>Find</span>', onclick: () => o.onFind && o.onFind() });
  const tools = el('div', { class: 'sed-toolbar' }, [viewSeg, keys, el('div', { class: 'sed-tools' }, [wrapBtn, findBtn])]);
  const edHost = el('div', { class: 'stkc-pine-ed sed-ed' });
  const probHd = el('div', { class: 'sed-prob-hd', 'data-s': 'idle' });
  const errBox = el('div', { class: 'stkc-pine-err sed-prob-list', role: 'alert', hidden: true });
  const prob = el('div', { class: 'sed-prob' }, [probHd, errBox]);
  const main = el('div', { class: 'sed-main' }, [tools, edHost, prob]);
  const body = el('div', { class: 'stkc-pine-body sed-body' }, [lib, main]);

  // footer: primary · Save · New ······ More
  const addBtn = el('button', { type: 'button', class: 'sed-btn is-primary stkc-zs-run', title: 'Add to chart (' + mod() + '↵)', html: svg(ICONS.play, 16) + '<span>Add to chart</span>' });
  const saveBtn = el('button', { type: 'button', class: 'sed-btn', title: 'Save (' + mod() + 'S)', text: 'Save' });
  const newBtn = el('button', { type: 'button', class: 'sed-btn', text: 'New' });
  const moreBtn = el('button', { type: 'button', class: 'sed-btn is-icon', 'aria-label': 'More actions', title: 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false', html: svg(ICONS.more, 20) });
  const menu = el('div', { class: 'sed-menu', role: 'menu', hidden: true });
  (o.moreItems || []).forEach(([k, label, danger]) => menu.appendChild(el('button', { type: 'button', role: 'menuitem', class: 'sed-mi' + (danger ? ' is-danger' : ''), 'data-k': k, text: label, onclick: () => { closeMenu(); if (o.onMore) o.onMore(k); } })));
  const ft = el('div', { class: 'stkc-pine-acts sed-ft' }, [addBtn, saveBtn, newBtn, el('span', { class: 'sed-ft-sp' }), el('div', { class: 'sed-more' }, [moreBtn, menu])]);
  function closeMenu(){ menu.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); }
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!menu.hidden) { closeMenu(); return; }
    if (o.onMenu) o.onMenu(menu);
    menu.hidden = false; moreBtn.setAttribute('aria-expanded', 'true');
    const f = menu.querySelector('.sed-mi:not([disabled])'); if (f) f.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('.sed-mi:not([disabled])')], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]; if (n) n.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); moreBtn.focus(); }
  });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== moreBtn && !moreBtn.contains(e.target)) closeMenu(); }, true);

  panel.append(grip, hd, body, ft);
  const backdrop = el('div', { class: 'sed-backdrop', hidden: true, onclick: () => setMax(false) });

  // ---- width, expand, narrow/wide ----
  const isPhone = () => window.innerWidth <= 700;
  function applyW(){ if (!isPhone() && !panel.classList.contains('is-max')) panel.style.width = Math.min(savedW(), Math.max(W_MIN, (panel.parentElement ? panel.parentElement.clientWidth : innerWidth) - 120)) + 'px'; else panel.style.width = ''; }
  function layout(){
    const w = panel.getBoundingClientRect().width;
    const wide = !isPhone() && w >= WIDE_AT;
    panel.classList.toggle('is-wide', wide);
    if (wide) setView('code', true);
  }
  let view = 'code';
  function setView(v, quiet){
    view = v;
    panel.dataset.view = v;
    Object.keys(viewBtns).forEach((k) => viewBtns[k].setAttribute('aria-selected', k === v ? 'true' : 'false'));
    if (!quiet && o.onView) o.onView(v);
  }
  setView('code', true);
  function setMax(on){
    if (isPhone()) on = false;
    panel.classList.toggle('is-max', on);
    backdrop.hidden = !on || panel.hidden;
    expandBtn.innerHTML = svg(on ? ICONS.collapse : ICONS.expand, 18);
    expandBtn.title = expandBtn.ariaLabel = on ? 'Back to the side panel' : 'Expand the editor';
    expandBtn.setAttribute('aria-label', expandBtn.title);
    applyW(); requestAnimationFrame(layout);
  }
  // drag the left edge
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    if (isPhone() || panel.classList.contains('is-max')) return;
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, w: panel.getBoundingClientRect().width, max: (panel.parentElement ? panel.parentElement.clientWidth : innerWidth) - 120 };
    panel.classList.add('is-drag');
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const w = Math.round(Math.max(W_MIN, Math.min(drag.max, drag.w + (drag.x - e.clientX))));
    panel.style.width = w + 'px'; layout();
  });
  const endDrag = () => { if (!drag) return; drag = null; panel.classList.remove('is-drag'); try { localStorage.setItem(W_KEY, String(Math.round(panel.getBoundingClientRect().width))); } catch (e) {} };
  grip.addEventListener('pointerup', endDrag); grip.addEventListener('pointercancel', endDrag);
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const w = Math.max(W_MIN, panel.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 40 : -40));
    try { localStorage.setItem(W_KEY, String(Math.round(w))); } catch (er) {} applyW(); layout();
  });
  grip.addEventListener('dblclick', () => { try { localStorage.removeItem(W_KEY); } catch (e) {} applyW(); layout(); });
  try { new ResizeObserver(() => { if (!panel.hidden) layout(); }).observe(panel); } catch (e) {}
  window.addEventListener('resize', () => { if (!panel.hidden) { if (isPhone()) setMax(false); applyW(); layout(); } });

  function setOpenState(open){
    if (open) { if (backdrop.parentElement !== document.body) document.body.appendChild(backdrop); applyW(); requestAnimationFrame(layout); backdrop.hidden = !panel.classList.contains('is-max'); }
    else { backdrop.hidden = true; closeMenu(); }
  }

  // ---- status pill + problems strip ----
  const STATUS = { idle: '', saved: 'Saved', unsaved: 'Unsaved', example: 'Example', error: 'Error', running: 'Running…' };
  function setStatus(s){ status.dataset.s = s; status.textContent = STATUS[s] || ''; status.hidden = !STATUS[s]; }
  setStatus('idle');
  const problems = {
    // state: 'ok' | 'err' | 'info' | 'busy'
    head(state, text){ probHd.dataset.s = state; probHd.innerHTML = state === 'busy' ? '<span class="sed-spin" aria-hidden="true"></span>' : svg(state === 'ok' ? ICONS.ok : state === 'err' ? ICONS.err : ICONS.info, 16); probHd.appendChild(el('span', { text })); },
    // list: [{ text, line, col }] ; onPick(line, col)
    list(items, onPick){
      errBox.innerHTML = '';
      errBox.hidden = !items.length;
      items.forEach((it) => {
        const row = it.line ? el('button', { type: 'button', class: 'sed-prob-row', title: 'Go to line ' + it.line, onclick: () => onPick && onPick(it.line, it.col) }) : el('div', { class: 'sed-prob-row' });
        row.textContent = it.text;
        errBox.appendChild(row);
      });
    }
  };
  function setPrimary(text){ addBtn.lastChild.textContent = text; }
  return { panel, segSlot, nameIn, target, edHost, errBox, addBtn, saveBtn, newBtn, moreBtn, menu, lib, panes, setCount, pickTab, tab: () => curTab, setStatus, problems, setOpenState, setMax, isPhone, isWide: () => panel.classList.contains('is-wide'), setPrimary, docsSearch, setView, view: () => view, wrap: () => wrapOn, closeMenu };
}
function mod(){ try { return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'; } catch (e) { return 'Ctrl+'; } }

// A library row: name (+badge) / description on the left, aligned icon actions on the right.
export function libRow({ name, badge, desc, onOpen, actions, title }){
  const li = el('li', { class: 'stkc-trow sed-row' });
  const b = el('button', { type: 'button', class: 'stkc-tname sed-row-main', title: title || 'Open in the editor', onclick: onOpen }, [
    el('span', { class: 'sed-row-l1' }, [el('span', { class: 'sed-row-nm', text: name }), badge ? el('span', { class: 'stkc-badge sed-badge', text: badge }) : null]),
    desc ? el('span', { class: 'sed-row-desc', text: desc }) : null
  ]);
  li.appendChild(b);
  const acts = el('span', { class: 'stkc-tacts sed-row-acts' });
  (actions || []).forEach((a) => a && acts.appendChild(a));
  li.appendChild(acts);
  return li;
}
// Empty state: a helpful line + a "New script" button.
export const emptyState = (text, btnLabel, fn) => el('li', { class: 'stkc-empty sed-empty' }, [el('p', { text }), btnLabel ? el('button', { type: 'button', class: 'sed-btn is-tonal', text: btnLabel, onclick: fn }) : null]);

// Docs pane rows: click inserts at the cursor.
export function renderDocs(pane, list, q, onInsert){
  pane.querySelectorAll('.stkc-tlist').forEach((n) => n.remove());
  const ul = el('ul', { class: 'stkc-tlist sed-docs' });
  const qq = String(q || '').trim().toLowerCase();
  const rows = list.filter((b) => !qq || b.name.toLowerCase().includes(qq)).slice(0, 120);
  if (!rows.length) ul.appendChild(el('li', { class: 'stkc-empty sed-empty' }, [el('p', { text: qq ? 'No built-in matches "' + q + '".' : 'Loading the reference…' })]));
  rows.forEach((b) => ul.appendChild(el('li', { class: 'sed-doc' }, [el('button', { type: 'button', class: 'sed-doc-b', title: 'Insert ' + b.name + ' at the cursor', onclick: () => onInsert(b.insert || b.name) }, [
    el('code', { class: 'sed-doc-sig', text: b.sig || b.name }), b.doc ? el('span', { class: 'sed-doc-doc', text: b.doc }) : null
  ])])));
  pane.appendChild(ul);
}

export function download(name, text){
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: name });
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export function pickFile(accept){
  return new Promise((res) => {
    const i = el('input', { type: 'file', accept, hidden: true });
    i.addEventListener('change', () => {
      const f = i.files && i.files[0]; i.remove();
      if (!f) return res(null);
      if (f.size > 65536) return res({ error: 'This file is larger than 64 KB.' });
      f.text().then((text) => res({ name: f.name.replace(/\.[^.]+$/, '').slice(0, 60), text })).catch(() => res({ error: 'Could not read the file.' }));
    });
    document.body.appendChild(i); i.click();
  });
}
export const fileName = (name, ext) => (String(name || 'script').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'script') + ext;
