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
import { withVersion, pinnable, latest, verOf, newer, upgradePatch, fmtDate, cmp, VER_KEY } from './indicator-versions.js?v=972';

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
.stk-iv-list ul{ margin:0; padding:0 0 0 16px; } .stk-iv-list li{ margin:0 0 4px; }
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

// The update status of one instance: null = nothing to show.
export function statusOf(type, inputs, dis) {
  const key = 'b:' + type;
  if (!pinnable(key)) return null;
  const v = verOf(key, inputs), to = latest(key);
  if (!v || !to || cmp(v, to) >= 0) return null;
  const d = (dis || {})[key];
  if (d && cmp(d, to) >= 0) return null;
  return { key, v, to, notes: newer(key, v) };
}

// ---------------------------------------------------------------- chart walk
let wsRef = null;
const cellsOf = () => { try { return wsRef.context().cells || []; } catch (e) { return []; } };
const uiOf = (chart) => { const r = chart && chart.renderer; return r && r.inputsUI ? r.inputsUI : r && r.renderer && r.renderer.inputsUI ? r.renderer.inputsUI : null; };
function instances() {
  const out = [];
  for (const c of cellsOf()) {
    const o = c.chart && c.chart.orchestrator, ui = (o && o.renderer && o.renderer.inputsUI) || uiOf(c.chart);
    if (!o || !ui) continue;
    let recs = []; try { recs = o.registry.all(); } catch (e) { continue; }
    for (const rec of recs) if (rec.native && pinnable('b:' + rec.native.type)) out.push({ chart: c.chart, rec, row: ui.rows.get(rec.id) });
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
  pop.dataset.stkIv = it.rec.native.type;
  pop.appendChild(el('h3', null, 'Update available: v' + st.to));
  pop.appendChild(el('p', 'stk-iv-sub', 'This chart uses v' + st.v + '.'));
  const list = el('div', 'stk-iv-list');
  st.notes.slice().reverse().forEach((x) => {
    list.appendChild(el('div', 'stk-iv-v', 'v' + x.v + ' · ' + fmtDate(x.date)));
    const ul = el('ul'); x.notes.forEach((n) => ul.appendChild(el('li', null, n))); list.appendChild(ul);
  });
  pop.appendChild(list);
  pop.appendChild(el('p', 'stk-iv-keep', 'Your settings are kept. You can go back any time in Settings > Version.'));
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

// Update: the latest version, every setting kept (migrate fills renamed keys), saved.
export function update(it) {
  const type = it.rec.native.type, key = 'b:' + type, to = latest(key);
  if (!to) return false;
  const patch = upgradePatch(key, it.rec.inputValues || {}, to);
  let h = null; try { h = it.chart.indicators().find((x) => x.id === it.rec.id); } catch (e) {}
  if (!h) return false;
  h.setInputs(patch);
  try { wsRef.context().stateChanged(); } catch (e) {}
  setTimeout(refresh, 0);
  return true;
}

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
  const dis = dismissed();
  for (const it of instances()) {
    const host = it.row && it.row.el;
    if (!host) continue;
    const st = statusOf(it.rec.native.type, it.rec.inputValues, dis);
    let b = host.querySelector(':scope > .stk-iv-btn');
    const sig = st ? st.v + '>' + st.to : '';
    if (!st) { if (b) { if (popFor === b) closePop(); b.remove(); } continue; }
    if (b && b.__sig === sig) { b.__it = it; continue; }
    if (b) b.remove();
    b = button(it, st); b.__it = it; b.__st = st; b.__sig = sig;
    const title = host.firstElementChild;
    if (title && title.nextSibling) host.insertBefore(b, title.nextSibling); else host.appendChild(b);
  }
}

// "Reset settings" in the settings window: every input back to its default, except the version.
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
  window.STRYKER_INDVER = { refresh, update: (type, cell) => { const it = instances().find((x) => x.rec.native.type === type && (cell == null || x.chart === cell)); return it ? update(it) : false; }, statusOf };
}
