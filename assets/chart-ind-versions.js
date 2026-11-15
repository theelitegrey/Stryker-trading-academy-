// TradeZoro — Charts: indicator versions on the chart (ES module). Manifest + maths: assets/indicator-versions.js.
// Imported by assets/vela-chart.js: installIndVersions(Core) right after Core is built (before any native registers), and
// mountIndVersions(ws) once the workspace exists. How-to: docs/INDICATOR-VERSIONS.md.
//   - Every pinnable TradeZoro native gets a "Version" setting (first row of its settings). Default = the manifest's base, so a
//     chart saved before versions loads exactly as before; a NEW add starts on the latest version (defaultInputs). The value
//     rides the normal settings, so the saved session, templates, layouts and shared charts keep it with no extra code.
//   - An instance below the latest version gets a small update button after its title in the legend. Hover (mouse) or tap
//     opens a popover: "Update available: vX", what is new, Update (keeps every setting, runs the manifest's migrate) and
//     Not now (hides the button for that indicator until a newer version ships; localStorage).
//   - "Reset settings" in the settings window keeps the version.
// Nothing changes on its own: a new version only shows the button. No vendor wording in view.
// ALL INDICATORS (Owner 15 Nov 2026 "i want it on all indicators"):
//   - every indicator's settings window shows its version: a small muted tag after the title, and a first "Version" row
//     (read-only "v1.0 · latest" when there is one version; a picker when there are several).
//   - built-in Pine scripts (x:) are pinnable like natives: the chart keeps the source it was saved with (chart-pine.js bv,
//     assets/pine-versions/<id>/<v>.pine); the same button and popup; Update swaps in the latest source and keeps the inputs.
//   - Community Pine scripts and Script Library Zscripts: the button shows when the author published a newer version than
//     the one on the chart (the library's own version numbers and notes). Update loads it and keeps the inputs. Never automatic.
import { withVersion, pinnable, pickable, latest, verOf, newer, upgradePatch, fmtDate, cmp, current, VER_KEY } from './indicator-versions.js?v=1037';
import { builtinOfText, builtinSource } from './chart-pine-builtins.js?v=1037';

const DISMISS_LS = 'stk_ind_ver_dismissed';
const STYLE_ID = 'stk-indver-css';
const ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>';
const CSS = `
.stk-iv-btn{ position:relative; flex:none; display:inline-grid; place-items:center; width:18px; height:18px; margin:0 2px 0 6px; padding:0; border:0; border-radius:50%;
  background:rgba(3,201,136,.16); color:#03c988; cursor:pointer; transition:background .15s cubic-bezier(.2,0,0,1); }
.stk-iv-btn:hover, .stk-iv-btn[aria-expanded="true"]{ background:rgba(3,201,136,.28); }
.stk-iv-btn:focus-visible{ outline:2px solid #03c988; outline-offset:2px; }
.stk-iv-btn::before{ content:''; position:absolute; inset:-13px; }   /* 44 x 44 touch target around the 18 px dot */
.stk-iv-pop{ position:fixed; z-index:2147483000; width:300px; max-width:calc(100vw - 32px); box-sizing:border-box; padding:16px; border-radius:16px;
  background:#131316; border:1px solid rgba(255,255,255,.08); color:rgba(255,255,255,.92); box-shadow:0 8px 24px rgba(0,0,0,.4);
  font:400 13px/18px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; }
.stk-iv-pop h3{ margin:0; font-size:15px; line-height:22px; font-weight:600; }
.stk-iv-sub{ margin:2px 0 0; color:rgba(255,255,255,.64); font-size:12px; line-height:16px; }
.stk-iv-list{ margin:12px 0 0; max-height:180px; overflow:auto; scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.18) transparent; }
.stk-iv-list::-webkit-scrollbar{ width:6px; } .stk-iv-list::-webkit-scrollbar-track{ background:transparent; }
.stk-iv-list::-webkit-scrollbar-thumb{ background:rgba(255,255,255,.18); border-radius:6px; } .stk-iv-list::-webkit-scrollbar-thumb:hover{ background:rgba(255,255,255,.3); }
.stk-iv-list::-webkit-scrollbar-button{ display:none; }
.stk-iv-v{ margin:8px 0 4px; font-size:12px; line-height:16px; font-weight:600; color:rgba(255,255,255,.64); font-variant-numeric:tabular-nums; }
.stk-iv-v:first-child{ margin-top:0; }
.stk-iv-list, .stk-iv-v{ padding:0; } .stk-iv-v{ margin-left:0; }
.stk-iv-list ul{ margin:0; padding:0 0 0 16px; list-style:disc; } .stk-iv-list li{ margin:0 0 4px; padding:0; } .stk-iv-list li::marker{ color:#03c988; }
.stk-iv-keep{ margin:12px 0 0; color:rgba(255,255,255,.44); font-size:12px; line-height:16px; }
.stk-iv-acts{ display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }
.stk-iv-acts button{ height:40px; min-width:88px; padding:0 16px; border-radius:12px; font:600 14px/20px inherit; font-family:inherit; cursor:pointer; border:1px solid transparent; }
.stk-iv-later{ background:transparent; color:rgba(255,255,255,.92); border-color:rgba(255,255,255,.16) !important; }
.stk-iv-later:hover{ background:rgba(255,255,255,.06); }
.stk-iv-go{ background:#03c988; color:#04140e; } .stk-iv-go:hover{ background:#4fe3ac; }
.stk-iv-acts button:focus-visible{ outline:2px solid #03c988; outline-offset:2px; }
:root[data-theme="light"] .stk-iv-btn{ background:rgba(7,153,106,.14); color:#07996a; }
:root[data-theme="light"] .stk-iv-btn:hover, :root[data-theme="light"] .stk-iv-btn[aria-expanded="true"]{ background:rgba(7,153,106,.24); }
:root[data-theme="light"] .stk-iv-pop{ background:#fff; border-color:rgba(0,0,0,.1); color:#1d1d1f; box-shadow:0 8px 24px rgba(0,0,0,.12); }
:root[data-theme="light"] .stk-iv-sub, :root[data-theme="light"] .stk-iv-v{ color:rgba(0,0,0,.6); }
:root[data-theme="light"] .stk-iv-keep{ color:rgba(0,0,0,.5); }
:root[data-theme="light"] .stk-iv-later{ color:#1d1d1f; border-color:rgba(0,0,0,.16) !important; } :root[data-theme="light"] .stk-iv-later:hover{ background:rgba(0,0,0,.04); }
:root[data-theme="light"] .stk-iv-go{ background:#07996a; color:#fff; } :root[data-theme="light"] .stk-iv-go:hover{ background:#06835a; }
:root[data-theme="light"] .stk-iv-list::-webkit-scrollbar-thumb{ background:rgba(0,0,0,.18); }
.vela-ind-fold.stk-iv-has{ position:relative; }
.vela-ind-fold.stk-iv-has::after{ content:''; position:absolute; top:-3px; right:-3px; width:8px; height:8px; border-radius:50%; background:#03c988; box-shadow:0 0 0 2px #0f0f0f; }
:root[data-theme="light"] .vela-ind-fold.stk-iv-has::after{ background:#07996a; box-shadow:0 0 0 2px #fff; }
/* the settings window follows the CHART's theme (Vela tokens on the panel), not the page's: so the tag and row use those tokens */
.stk-iv-tag{ flex:none; margin:0 auto 0 8px; padding:0 8px; height:20px; display:inline-flex; align-items:center; border-radius:10px; background:var(--vela-hover, rgba(255,255,255,.06));
  color:var(--vela-fg, rgba(255,255,255,.9)); font-size:12px; line-height:16px; font-weight:500; font-variant-numeric:tabular-nums; white-space:nowrap; }
.vela-ind-dialog .vela-dialog-header:has(.stk-iv-tag){ align-items:center; }   /* title, tag and close on one centre line */
.vela-ind-dialog .vela-dialog-header:has(.stk-iv-tag) .vela-dialog-close{ margin-left:8px; }
.vela-ind-dialog .vela-dialog-header:has(.stk-iv-tag) .vela-dialog-title{ flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.stk-iv-ro{ display:flex; align-items:center; min-height:32px; color:var(--vela-fg, rgba(255,255,255,.9)); font-size:13px; line-height:18px; font-variant-numeric:tabular-nums; }
@media (prefers-reduced-motion: reduce){ .stk-iv-btn{ transition:none; } }
`;

let installed = false;
export function installIndVersions(Core) {
  if (installed || !Core || typeof Core.registerNativeIndicator !== 'function') return;
  installed = true;
  const reg = Core.registerNativeIndicator;
  Core.registerNativeIndicator = (desc) => reg.call(Core, withVersion(desc));
}

// ---------------------------------------------------------------- dismissals ("Not now" = until the next version)
function dismissed() { try { return JSON.parse(localStorage.getItem(DISMISS_LS) || '{}') || {}; } catch (e) { return {}; } }
function dismiss(key, v) { try { const d = dismissed(); d[key] = v; localStorage.setItem(DISMISS_LS, JSON.stringify(d)); } catch (e) {} }

// The update status of one native instance: null = nothing to show.
export function statusOf(type, inputs, dis) { return statusOfKey('b:' + type, verOf('b:' + type, inputs), dis); }
// Same for any manifest key (b:, x:) at instance version v.
export function statusOfKey(key, v, dis) {
  if (!pinnable(key)) return null;
  const to = latest(key);
  if (!v || !to || cmp(v, to) >= 0) return null;
  const d = (dis || {})[key];
  if (d && cmp(d, to) >= 0) return null;
  return { key, v, to, notes: newer(key, v) };
}
// Library scripts (Community Pine c:<id>, Script Library Zscript zl:<sid>): integer versions from the author's publishes.
function statusOfLib(key, v, info, dis) {
  if (!info || !(info.version > v)) return null;
  const d = (dis || {})[key];
  if (d && +d >= info.version) return null;
  const notes = (info.notes || []).filter((x) => x.v > v).sort((x, y) => x.v - y.v).map((x) => ({ v: String(x.v), date: x.date || '', notes: [x.text || 'No notes.'] }));
  return { key, v: String(v), to: String(info.version), notes: notes.length ? notes : [{ v: String(info.version), date: '', notes: ['A newer version from the author.'] }], lib: true };
}

// ---------------------------------------------------------------- chart walk
let wsRef = null;
const cellsOf = () => { try { return wsRef.context().cells || []; } catch (e) { return []; } };
const uiOf = (chart) => { const r = chart && chart.renderer; return r && r.inputsUI ? r.inputsUI : r && r.renderer && r.renderer.inputsUI ? r.renderer.inputsUI : null; };
// Latest published version of a library script, fetched once per page load: id -> Promise<{ version, notes }|null>
const libInfo = new Map(), libReady = new Map();
function libLatest(key) {
  if (!libInfo.has(key)) {
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    let p = Promise.resolve(null);
    if (kind === 'c' && window.StrykerPineLibrary) p = window.StrykerPineLibrary.get(id).then((x) => (x && x.status === 'ok' ? { version: +x.version || 1, notes: [] } : null));
    else if (kind === 'zl' && window.STRYKER_ZS && window.STRYKER_ZS.libVersions) p = window.STRYKER_ZS.libVersions(id);
    p = p.catch(() => null).then((x) => { libReady.set(key, x); setTimeout(refresh, 0); return x; });
    libInfo.set(key, p);
  }
  return libReady.get(key);
}
// What one indicator on a chart is: its key, its version, and (when one exists) a newer version.
//   kind native | builtin (x:) | plib (Community Pine) | zlib (Script Library Zscript) | sealed | other (no version)
export function describe(rec, dis) {
  if (!rec) return null;
  if (rec.native) {
    const key = 'b:' + rec.native.type;
    return { kind: 'native', key, v: verOf(key, rec.inputValues) || current(key), st: statusOf(rec.native.type, rec.inputValues, dis) };
  }
  const src = typeof rec.source === 'string' ? rec.source : '';
  const P = window.STRYKER_PINE, h = P && rec.__stkHandle;
  const L = h && P.libOf && P.libOf.get(h);
  if (L) { const key = 'c:' + L.id; return { kind: 'plib', key, v: String(+L.version || 1), st: statusOfLib(key, +L.version || 1, libLatest(key), dis), lib: L }; }
  const Z = h && P.sealOf && P.sealOf.get(h);
  if (Z) return { kind: 'sealed', key: 'ci:' + Z.cid + '/' + Z.iid, v: Z.version != null ? String(Z.version) : null, st: null };
  const zs = window.STRYKER_ZS, zl = h && zs && zs.libOf ? zs.libOf(h) : null;
  // protected library scripts run the author's latest sealed build on every load (server side), so they show that version and no button
  if (zl) { const key = 'zl:' + zl.sid, info = libLatest(key); const v = zl.open && zl.v ? zl.v : info ? info.version : zl.v; return { kind: 'zlib', key, v: v ? String(v) : null, st: zl.open && zl.v ? statusOfLib(key, zl.v, info, dis) : null, lib: zl }; }
  const b = builtinOfText(src);
  if (b) { const key = 'x:' + b.id, v = b.v || current(key); return { kind: 'builtin', key, id: b.id, v, st: statusOfKey(key, v, dis) }; }
  const ex = /^\s*\/\/@zscript/.test(src) ? null : exampleKey(src);
  if (ex) return { kind: 'builtin', key: ex, v: current(ex), st: null };
  return null;
}
// The Pine editor examples (chart-pine-scripts.js) are x:<id> too; matched by their exact source.
function exampleKey(src) {
  const ex = (window.StrykerPineScripts && window.StrykerPineScripts.EXAMPLES) || [];
  const x = ex.find((e) => e.source === src);
  return x ? 'x:' + String(x.id).replace(/^example:/, '') : null;
}
function handleOf(chart, id) { try { return chart.indicators().find((x) => x.id === id) || null; } catch (e) { return null; } }
function instances() {
  const out = [];
  for (const c of cellsOf()) {
    const o = c.chart && c.chart.orchestrator, ui = (o && o.renderer && o.renderer.inputsUI) || uiOf(c.chart);
    if (!o || !ui) continue;
    let recs = []; try { recs = o.registry.all(); } catch (e) { continue; }
    for (const rec of recs) {
      if (!rec.native && !rec.__stkHandle) { const h = handleOf(c.chart, rec.id); if (h) try { Object.defineProperty(rec, '__stkHandle', { value: h, configurable: true }); } catch (e) {} }
      out.push({ chart: c.chart, rec, row: ui.rows.get(rec.id) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- popover
let pop = null, popFor = null, hoverTm = 0;
function closePop() {
  clearTimeout(hoverTm);
  if (pop) { pop.remove(); pop = null; }
  if (popFor) { popFor.setAttribute('aria-expanded', 'false'); popFor = null; }
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('keydown', onKey, true);
}
function outside(e) { if (pop && !pop.contains(e.target) && e.target !== popFor && !(popFor && popFor.contains(e.target))) closePop(); }
function onKey(e) { if (e.key === 'Escape') { const b = popFor; closePop(); if (b) b.focus(); } }
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
function place(btn) {
  const r = btn.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight, w = pop.offsetWidth, h = pop.offsetHeight;
  let x = Math.min(Math.max(16, r.left - 12), W - w - 16), y = r.bottom + 8;
  if (y + h > H - 16) y = Math.max(16, r.top - h - 8);
  pop.style.left = Math.round(x) + 'px'; pop.style.top = Math.round(y) + 'px';
}
function openPop(btn, it, st) {
  closePop();
  pop = el('div', 'stk-iv-pop'); pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Update available: v' + st.to);
  pop.dataset.stkIv = st.key;
  pop.appendChild(el('h3', null, 'Update available: v' + st.to));
  pop.appendChild(el('p', 'stk-iv-sub', 'This chart uses v' + st.v + '.'));
  const list = el('div', 'stk-iv-list');
  st.notes.slice().reverse().forEach((x) => {
    list.appendChild(el('div', 'stk-iv-v', 'v' + x.v + (x.date ? ' · ' + fmtDate(x.date) : '')));
    const ul = el('ul'); x.notes.forEach((n) => ul.appendChild(el('li', null, n))); list.appendChild(ul);
  });
  pop.appendChild(list);
  pop.appendChild(el('p', 'stk-iv-keep', st.lib ? 'Your settings are kept. The author published this version.' : 'Your settings are kept. You can go back any time in Settings > Version.'));
  const acts = el('div', 'stk-iv-acts');
  const later = el('button', 'stk-iv-later', 'Not now'); later.type = 'button';
  const go = el('button', 'stk-iv-go', 'Update'); go.type = 'button';
  later.addEventListener('click', () => { dismiss(st.key, st.to); closePop(); refresh(); });
  go.addEventListener('click', () => { update(it); closePop(); });
  acts.appendChild(later); acts.appendChild(go); pop.appendChild(acts);
  document.body.appendChild(pop);
  popFor = btn; btn.setAttribute('aria-expanded', 'true');
  place(btn);
  pop.addEventListener('mouseenter', () => clearTimeout(hoverTm));
  pop.addEventListener('mouseleave', () => { if (pop && pop.__hover) hoverTm = setTimeout(closePop, 300); });
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', onKey, true);
  return pop;
}

// Update: the latest version, every setting kept (natives: migrate fills renamed keys; scripts: the new source keeps the
// inputs it still declares), saved.
export function update(it) {
  const d = describe(it.rec, {});
  if (!d || !d.st) return false;
  const h = handleOf(it.chart, it.rec.id);
  if (!h) return false;
  const done = () => { try { wsRef.context().stateChanged(); } catch (e) {} setTimeout(refresh, 0); };
  if (d.kind === 'native') { h.setInputs(upgradePatch(d.key, it.rec.inputValues || {}, d.st.to)); done(); return true; }
  return swapCode(it, h, d, d.st.to).then((ok) => { done(); return ok; });
}
// A script indicator onto another source (built-in version / the author's newer publish). Vela's updateCode keeps every
// input the new source still declares and puts the old code back if the new one fails.
async function swapCode(it, h, d, to) {
  let src;
  try {
    if (d.kind === 'builtin') src = await builtinSource(d.id, to === current(d.key) ? null : to);
    else if (d.kind === 'plib') { const s = await window.StrykerPineLibrary.get(d.lib.id); if (!s || s.status !== 'ok' || !s.source) throw new Error('gone'); src = s.source; if (!(window.StrykerPineGuard && window.StrykerPineGuard.check(src).ok)) throw new Error('guard'); d.lib.version = +s.version || d.lib.version; }
    else if (d.kind === 'zlib') { const m = await window.STRYKER_ZS.libSource(d.lib.sid); src = m.source; d.lib.v = m.version; }
    else return false;
  } catch (e) { toastMsg('Could not load the new version. Check your connection.'); return false; }
  const inputs = Object.assign({}, it.rec.inputValues || {});
  const r = typeof h.updateCode === 'function' ? await h.updateCode(src) : { ok: false };
  if (!r || !r.ok) { toastMsg('The new version did not run, so your chart stays as it was.'); return false; }
  try { const keep = {}; const now = h.inputValues() || {}; for (const k in inputs) if (k in now && now[k] !== inputs[k]) keep[k] = inputs[k]; if (Object.keys(keep).length) h.setInputs(keep); } catch (e) {}
  return true;
}
const toastMsg = (m) => { try { if (window.STRYKER_PINE && window.STRYKER_PINE.toast) window.STRYKER_PINE.toast(m, 'error'); } catch (e) {} };

// ---------------------------------------------------------------- legend buttons
const fine = () => { try { return window.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) { return false; } };
function button(it, st) {
  const b = el('button', 'stk-iv-btn'); b.type = 'button';
  b.innerHTML = ICON;
  b.setAttribute('aria-label', 'Update available: v' + st.to); b.title = 'Update available: v' + st.to;
  b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false');
  b.addEventListener('click', (e) => { e.stopPropagation(); if (popFor === b) closePop(); else openPop(b, b.__it, b.__st); });
  b.addEventListener('dblclick', (e) => e.stopPropagation());
  b.addEventListener('mouseenter', () => { if (!fine() || popFor === b) return; clearTimeout(hoverTm); hoverTm = setTimeout(() => { const p = openPop(b, b.__it, b.__st); p.__hover = true; }, 250); });
  b.addEventListener('mouseleave', () => { clearTimeout(hoverTm); if (pop && pop.__hover && popFor === b) hoverTm = setTimeout(closePop, 300); });
  return b;
}
export function refresh() {
  const dis = dismissed(), folds = new Map();   // phone legend folded behind its toggle: a dot on the toggle says an update waits
  for (const it of instances()) {
    const host = it.row && it.row.el;
    if (!host) continue;
    const d = describe(it.rec, dis), st = d && d.st;
    const cellEl = host.closest('.vela-cell'), fold = cellEl && cellEl.querySelector('.vela-ind-fold');
    if (fold) { folds.set(fold, folds.get(fold) || !!st); if (!fold.__stkIv) { fold.__stkIv = 1; fold.addEventListener('click', () => setTimeout(refresh, 0)); } }
    let b = host.querySelector(':scope > .stk-iv-btn');
    const sig = st ? st.v + '>' + st.to : '';
    if (!st) { if (b) { if (popFor === b) closePop(); b.remove(); } continue; }
    if (b && b.__sig === sig) { b.__it = it; continue; }
    if (b) b.remove();
    b = button(it, st); b.__it = it; b.__st = st; b.__sig = sig;
    const title = host.firstElementChild;
    if (title && title.nextSibling) host.insertBefore(b, title.nextSibling); else host.appendChild(b);
  }
  for (const [fold, has] of folds) {
    fold.classList.toggle('stk-iv-has', has && /^Show/.test(fold.getAttribute('aria-label') || ''));   // dot only while the rows are folded away
    const base = (fold.getAttribute('aria-label') || '').replace(/ \(update available\)$/, '');
    if (base) fold.setAttribute('aria-label', has ? base + ' (update available)' : base);
  }
}

// "Reset settings" in the settings window: every input back to its default, except the version.
// Every build of the window: the version tag after the title, and the Version row for indicators that have no Version input.
function patchDialog(dlg) {
  const proto = dlg && Object.getPrototypeOf(dlg);
  if (!proto || proto.__stkIndVer || typeof proto.resetToDefaults !== 'function') return;
  proto.__stkIndVer = true;
  const orig = proto.resetToDefaults;
  proto.resetToDefaults = function () {
    const row = this.row, inp = row && (row.inputs || []).find((i) => i.key === VER_KEY);
    if (!inp || row.values[VER_KEY] == null) return orig.apply(this, arguments);
    const keep = inp.defval;
    inp.defval = row.values[VER_KEY];
    try { return orig.apply(this, arguments); } finally { inp.defval = keep; }
  };
  if (typeof proto.build === 'function') {
    const build = proto.build;
    proto.build = function (row) {
      const r = build.apply(this, arguments);
      try { decorate(this, row); } catch (e) { console.warn('TradeZoro: version row', e); }
      return r;
    };
  }
}
const panelOf = (dlg) => (dlg.uiDialog && dlg.uiDialog.panel) || document.querySelector('.vela-ind-dialog');
function decorate(dlg, row) {
  const panel = row && panelOf(dlg);
  if (!panel) return;
  const it = instances().find((x) => x.rec.id === row.id && uiOf(x.chart) && uiOf(x.chart).inputsDialog === dlg) || instances().find((x) => x.rec.id === row.id);
  const d = it && describe(it.rec, {});
  if (!d || !d.v) return;
  const title = panel.querySelector('.vela-dialog-header .vela-dialog-title');
  let tag = panel.querySelector('.stk-iv-tag');
  if (title && !tag) { tag = el('span', 'stk-iv-tag'); title.after(tag); }
  if (tag) { tag.textContent = 'v' + d.v; tag.title = 'Version ' + d.v; }
  if ((row.inputs || []).some((i) => i.key === VER_KEY)) return;   // a pinnable native: its own Version setting is the first row
  // first row of the Inputs tab, above any group heading
  const f0 = panel.querySelector('.vela-dialog-body .vela-field-row, .vela-dialog-body .vela-field-span');
  if (!f0 || panel.querySelector('.stk-iv-row')) return;
  const first = f0.parentNode.firstElementChild;
  const rid = 'stk-iv-' + row.id;
  const line = el('div', 'vela-field-row stk-iv-row');
  const lab = el('span', 'vela-field-label', 'Version'); lab.id = rid + '--title';
  const cell = el('div', 'vela-field-cell'), wrap = el('div');
  const picks = d.kind === 'builtin' ? pickable(d.key) : [];
  if (picks.length > 1 && typeof dlg.selectPairs === 'function') {
    const last = picks[picks.length - 1].v;
    const ctl = dlg.selectPairs(rid, picks.map((x) => ({ value: x.v, label: 'v' + x.v + ' · ' + fmtDate(x.date) + (x.v === last ? ' (latest)' : '') })), d.v, (v) => {
      const h = handleOf(it.chart, it.rec.id);
      if (!h || v === d.v) return;
      const ui = uiOf(it.chart);
      swapCode(it, h, d, v).then((ok) => { try { wsRef.context().stateChanged(); } catch (e) {} setTimeout(refresh, 0); if (ok && ui) { try { ui.closeOpenDialog(); } catch (e) {} setTimeout(() => { try { ui.openDialog(it.rec.id); } catch (e) {} }, 50); } });
    });
    const trig = ctl.querySelector && ctl.querySelector('button'); if (trig) { trig.id = rid; trig.setAttribute('aria-labelledby', lab.id); }
    wrap.appendChild(ctl);
  } else {
    const ro = el('span', 'stk-iv-ro', 'v' + d.v + ' · ' + (d.st ? 'v' + d.st.to + ' available' : 'latest'));
    ro.setAttribute('aria-labelledby', lab.id);
    wrap.appendChild(ro);
  }
  cell.appendChild(wrap); line.appendChild(lab); line.appendChild(cell);
  first.parentNode.insertBefore(line, first);
}

export function mountIndVersions(ws) {
  wsRef = ws;
  if (!document.getElementById(STYLE_ID)) { const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.appendChild(s); }
  const apply = () => {
    for (const c of cellsOf()) { const ui = uiOf(c.chart); if (ui && ui.inputsDialog) patchDialog(ui.inputsDialog); }
    refresh();
  };
  apply();
  const later = () => setTimeout(apply, 0);
  try { ws.on('layout:changed', later); } catch (e) {}
  try { ws.on('state:changed', later); } catch (e) {}
  // legend rows are rebuilt by the chart at times no event reports (pane moves, symbol loads): a light re-check
  setInterval(() => { if (!document.hidden) apply(); }, 2000);
  window.addEventListener('resize', () => { if (pop && popFor) place(popFor); });
  // update(type or key, cell?): a native type ('stk_l2f_fp') or any key ('x:<id>', 'c:<id>', 'zl:<sid>')
  const find = (k, cell) => instances().find((x) => { const d = describe(x.rec, {}); return d && (d.key === k || d.key === 'b:' + k) && (cell == null || x.chart === cell); });
  window.STRYKER_INDVER = { refresh, update: (k, cell) => { const it = find(k, cell); return it ? update(it) : false; }, describe: (k, cell) => { const it = find(k, cell); return it ? describe(it.rec, dismissed()) : null; }, statusOf, statusOfKey };
}
