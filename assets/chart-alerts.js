// Stryker Trading Academy — Charts price alerts (ES module, charts.html only)
// Owner order 2026-10-06 ("Build all", Settings window → Alerts tab + basic price alerts).
//
// WHAT IT DOES
//   - Price alerts on any chart symbol: Crossing / Crossing up / Crossing down / Greater than /
//     Less than a price, a message, Once or Every time. Create from the Alerts button on our
//     top bar, or Alt+A on a chart (prefilled with the price under the cursor, else the last price).
//   - Alerts are checked IN THIS BROWSER while the Charts page is open (said in the UI) against
//     the price the charts on this page already receive, for symbols that are on a chart here.
//     Nothing runs on a server, so no notification arrives when the page is closed.
//   - Firing: toast (auto-hide optional), a short beep at the chosen volume, and a browser
//     notification if the member allowed them.
//   - Storage: signed-in members → Firestore students/{uid}/chartAlerts/{id} (owner-only rules,
//     validated shape; the 200-per-member cap is enforced here in the client). Guests → localStorage.
//   - Alert lines: dashed horizontal line per alert on charts of that symbol (renderer layer).
//   - Alerts tab in the Settings window: Alert lines on/off + colour, Only active alerts,
//     Alert volume, Automatically hide toasts (kept per browser).
// Education only. Not financial advice. Alerts are a convenience, not a trading signal.

const LAYER = 'stk_alerts';
const PREFS_KEY = 'stryker_chart_alert_prefs';
const MAX_ALERTS = 200;
const CONDS = [
  ['crossing', 'Crossing'], ['crossing_up', 'Crossing up'], ['crossing_down', 'Crossing down'],
  ['greater', 'Greater than'], ['less', 'Less than']
];
const CONDL = Object.fromEntries(CONDS);
const PREF_DEFAULTS = { lines: true, lineColor: '#f7a600', onlyActive: false, volume: 60, autoHide: true };

let WS = null, toastFn = () => {};
let alerts = [];                       // [{id, symbol, cond, price, message, freq, active, triggeredAt}]
const last = new Map();                // symbol -> last price seen
const armed = new Map();               // alert id -> false while its condition is still true (edge trigger)
let prefs = loadPrefs();
let backend = null;

function loadPrefs(){
  try { return Object.assign({}, PREF_DEFAULTS, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) { return Object.assign({}, PREF_DEFAULTS); }
}
function savePrefs(){ try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} pushLines(); }

// ---------------------------------------------------------------------------------------
// storage: Firestore for members, localStorage for guests
// ---------------------------------------------------------------------------------------
const fb = () => window.firebase;
function user(){ try { return fb() && fb().auth().currentUser; } catch (e) { return null; } }
function clean(a){
  return {
    symbol: String(a.symbol || '').slice(0, 40),
    cond: CONDL[a.cond] ? a.cond : 'crossing',
    price: Number(a.price),
    message: String(a.message || '').slice(0, 140),
    freq: a.freq === 'every' ? 'every' : 'once',
    active: a.active !== false
  };
}
function makeBackend(){
  const u = user();
  if (u) {
    const col = () => fb().firestore().collection('students').doc(u.uid).collection('chartAlerts');
    const ts = () => fb().firestore.FieldValue.serverTimestamp();
    return {
      kind: 'cloud',
      async list(){ const s = await col().get(); return s.docs.map((d) => Object.assign({ id: d.id }, d.data())); },
      async add(a){ const ref = col().doc(); await ref.set(Object.assign(clean(a), { createdAt: ts(), updatedAt: ts() })); return ref.id; },
      async update(id, a){ await col().doc(id).update(Object.assign(clean(a), { updatedAt: ts() })); },
      async remove(id){ await col().doc(id).delete(); }
    };
  }
  const key = 'stryker_chart_alerts_guest';
  const all = () => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const put = (v) => localStorage.setItem(key, JSON.stringify(v));
  return {
    kind: 'local',
    async list(){ return all(); },
    async add(a){ const id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); put(all().concat([Object.assign(clean(a), { id })])); return id; },
    async update(id, a){ put(all().map((x) => x.id === id ? Object.assign(clean(a), { id }) : x)); },
    async remove(id){ put(all().filter((x) => x.id !== id)); }
  };
}
async function reload(){
  backend = makeBackend();
  try { alerts = (await backend.list()).filter((a) => a && Number.isFinite(Number(a.price))).map((a) => Object.assign({ id: a.id }, clean(a))); }
  catch (e) { console.warn('Stryker alerts: load', e); alerts = []; }
  pushLines(); renderList();
}

// ---------------------------------------------------------------------------------------
// prices + firing
// ---------------------------------------------------------------------------------------
const cellOf = (id) => { try { return WS.cell(id); } catch (e) { return null; } };
const inner = (cell) => { try { return cell.chart.renderer.renderer; } catch (e) { return null; } };
function cellsOf(sym){ return (WS ? WS.context().cells || [] : []).map((c) => cellOf(c.id)).filter((c) => c && c.symbol === sym); }
function priceOf(sym){
  for (const c of cellsOf(sym)) {
    const R = inner(c); const b = R && R.scene && R.scene.bars;
    if (b && b.length) return b[b.length - 1].close;
  }
  return null;
}
function hit(a, prev, p){
  const x = a.price;
  switch (a.cond) {
    case 'crossing_up': return prev != null && prev < x && p >= x;
    case 'crossing_down': return prev != null && prev > x && p <= x;
    case 'greater': return p > x;
    case 'less': return p < x;
    default: return prev != null && ((prev < x && p >= x) || (prev > x && p <= x));
  }
}
function tick(sym, p){
  if (!Number.isFinite(p)) return;
  const prev = last.has(sym) ? last.get(sym) : null;
  last.set(sym, p);
  for (const a of alerts) {
    if (!a.active || a.symbol !== sym) continue;
    const h = hit(a, prev, p);
    if (!h) { armed.delete(a.id); continue; }
    if (armed.get(a.id) === false) continue;          // still true since the last fire: wait for a reset
    armed.set(a.id, false);
    fire(a, p);
  }
}
function poll(){
  const syms = new Set(alerts.filter((a) => a.active).map((a) => a.symbol));
  for (const s of syms) { const p = priceOf(s); if (p != null) tick(s, p); }
}
function fire(a, p){
  const text = a.message || (a.symbol + ' ' + CONDL[a.cond].toLowerCase() + ' ' + a.price);
  showToast('Alert: ' + text, 'Price ' + p + ' · ' + new Date().toLocaleTimeString());
  beep();
  try { if (window.Notification && Notification.permission === 'granted') new Notification('Stryker chart alert', { body: text, tag: 'stk-alert-' + a.id }); } catch (e) {}
  if (a.freq === 'once') {
    a.active = false;
    backend && backend.update(a.id, a).catch((e) => console.warn('Stryker alerts: update', e));
    pushLines(); renderList();
  }
  try { window.dispatchEvent(new CustomEvent('stryker:chart-alert', { detail: { id: a.id, symbol: a.symbol, price: p } })); } catch (e) {}
}
let actx = null;
function beep(){
  const vol = Math.max(0, Math.min(100, Number(prefs.volume))) / 100;
  if (!vol) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.4 * vol, actx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.5);
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.55);
    window.__stkAlertBeeps = (window.__stkAlertBeeps || 0) + 1;
  } catch (e) {}
}
function showToast(title, sub){
  let box = document.getElementById('stk-al-toasts');
  if (!box) { box = document.createElement('div'); box.id = 'stk-al-toasts'; document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = 'stk-al-toast'; t.setAttribute('role', 'alert');
  t.innerHTML = '<b></b><span></span><button type="button" aria-label="Dismiss">×</button>';
  t.querySelector('b').textContent = title; t.querySelector('span').textContent = sub;
  t.querySelector('button').onclick = () => t.remove();
  box.appendChild(t);
  if (prefs.autoHide) setTimeout(() => t.remove(), 8000);
}

// ---------------------------------------------------------------------------------------
// alert lines (renderer layer; data per cell via setNativeData)
// ---------------------------------------------------------------------------------------
function pushLines(){
  if (!WS) return;
  for (const c of WS.context().cells || []) {
    const cell = cellOf(c.id); const R = inner(cell); if (!R || !R.setNativeData) continue;
    const lines = prefs.lines ? alerts.filter((a) => a.symbol === cell.symbol && (a.active || !prefs.onlyActive)).map((a) => ({ price: a.price, active: a.active })) : [];
    try { R.setNativeData(LAYER, { lines, color: prefs.lineColor }); } catch (e) {}
  }
}
function linesLayer(){
  let canvas = null;
  return {
    mount(c){ canvas = c; },
    render(a){
      if (!canvas) return;
      // Vela sizes layer canvases itself; only clear + scale for the DPR.
      const co = a.coords, dpr = co.dpr || 1;
      const W = co.width;
      const g = canvas.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const d = a.data; if (!d || !d.lines || !d.lines.length) return;
      const top = a.bounds.top, bot = top + a.bounds.height;
      g.save(); g.beginPath(); g.rect(0, top, W, a.bounds.height); g.clip();
      g.lineWidth = 1;
      for (const l of d.lines) {
        const y = Math.round(co.priceToY(l.price, a.scale, a.bounds)) + 0.5;
        if (y < top || y > bot) continue;
        g.globalAlpha = l.active ? 0.95 : 0.35;
        g.strokeStyle = d.color; g.setLineDash([6, 4]);
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
        g.setLineDash([]); g.fillStyle = d.color; g.font = '11px system-ui, sans-serif';
        g.fillText('\u23F0 ' + l.price, 6, y - 4);
      }
      g.restore();
    },
    destroy(){ canvas = null; }
  };
}

// ---------------------------------------------------------------------------------------
// UI: Alerts panel (list + create/edit form)
// ---------------------------------------------------------------------------------------
let panel = null, editing = null;
function activeCell(){ try { return cellOf(WS.active.id); } catch (e) { return null; } }
function crossPrice(){
  const c = activeCell(); const R = inner(c);
  try { const cp = R.scene.crosshair; if (cp && Number.isFinite(cp.price)) return cp.price; } catch (e) {}
  return c ? priceOf(c.symbol) : null;
}
function fmt(n){ return Number.isFinite(n) ? String(+n.toFixed(6)) : ''; }
export function openAlerts(prefill){
  if (!panel) build();
  panel.hidden = false;
  if (prefill) openForm(prefill);
  renderList();
}
function closePanel(){ if (panel) panel.hidden = true; editing = null; }
function build(){
  panel = document.createElement('div'); panel.id = 'stk-al'; panel.hidden = true;
  panel.innerHTML = `
  <div class="stk-al-box" role="dialog" aria-modal="true" aria-labelledby="stk-al-h">
    <div class="stk-al-head"><h2 id="stk-al-h">Price alerts</h2><button type="button" class="stk-al-x" aria-label="Close">×</button></div>
    <p class="stk-al-note">Alerts work while the Charts page is open, for symbols on a chart here. Education only. Not financial advice.</p>
    <form class="stk-al-form" hidden>
      <label>Symbol<input name="symbol" maxlength="40" required></label>
      <label>Condition<select name="cond">${CONDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label>Price<input name="price" type="number" step="any" required></label>
      <label class="stk-al-wide">Message<input name="message" maxlength="140" placeholder="Optional"></label>
      <label>Trigger<select name="freq"><option value="once">Only once</option><option value="every">Every time</option></select></label>
      <div class="stk-al-fbtn"><button type="button" class="stk-al-cancel">Cancel</button><button type="submit" class="stk-al-save">Create</button></div>
    </form>
    <div class="stk-al-tools"><button type="button" class="stk-al-new">+ New alert</button><span class="stk-al-count"></span></div>
    <div class="stk-al-list"></div>
  </div>`;
  document.body.appendChild(panel);
  panel.addEventListener('click', (e) => { if (e.target === panel) closePanel(); });
  panel.querySelector('.stk-al-x').onclick = closePanel;
  panel.querySelector('.stk-al-new').onclick = () => { const c = activeCell(); openForm({ symbol: c ? c.symbol : '', price: crossPrice() }); };
  panel.querySelector('.stk-al-cancel').onclick = () => { panel.querySelector('.stk-al-form').hidden = true; editing = null; };
  panel.querySelector('.stk-al-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target; const a = clean({ symbol: f.symbol.value.trim(), cond: f.cond.value, price: parseFloat(f.price.value), message: f.message.value.trim(), freq: f.freq.value, active: true });
    if (!a.symbol || !Number.isFinite(a.price)) { toastFn('Enter a symbol and a price.'); return; }
    try {
      if (editing) { await backend.update(editing, a); Object.assign(alerts.find((x) => x.id === editing) || {}, a); armed.delete(editing); }
      else {
        if (alerts.length >= MAX_ALERTS) { toastFn('You have ' + MAX_ALERTS + ' alerts, the most we keep. Delete one first.'); return; }
        const id = await backend.add(a); alerts.push(Object.assign({ id }, a));
      }
      try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e2) {}
      f.hidden = true; editing = null; pushLines(); renderList();
    } catch (err) { console.warn(err); toastFn('Could not save the alert. Check your connection and try again.'); }
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel && !panel.hidden) closePanel(); });
}
function openForm(a){
  const f = panel.querySelector('.stk-al-form'); f.hidden = false;
  f.symbol.value = a.symbol || ''; f.cond.value = a.cond || 'crossing'; f.price.value = fmt(Number(a.price));
  f.message.value = a.message || ''; f.freq.value = a.freq || 'once';
  editing = a.id || null;
  f.querySelector('.stk-al-save').textContent = editing ? 'Save' : 'Create';
  f.price.focus();
}
function renderList(){
  if (!panel) return;
  const list = panel.querySelector('.stk-al-list'); list.textContent = '';
  panel.querySelector('.stk-al-count').textContent = alerts.length + ' / ' + MAX_ALERTS + (backend && backend.kind === 'local' ? ' · saved in this browser (sign in to keep them in your account)' : '');
  if (!alerts.length) { const p = document.createElement('p'); p.className = 'stk-al-empty'; p.textContent = 'No alerts yet.'; list.appendChild(p); return; }
  for (const a of alerts) {
    const row = document.createElement('div'); row.className = 'stk-al-row' + (a.active ? '' : ' off');
    row.innerHTML = '<div class="stk-al-txt"><b></b><span></span></div><button type="button" data-k="pause"></button><button type="button" data-k="edit">Edit</button><button type="button" data-k="del" aria-label="Delete alert">Delete</button>';
    row.querySelector('b').textContent = a.symbol + ' · ' + CONDL[a.cond] + ' ' + fmt(a.price);
    row.querySelector('span').textContent = (a.message ? a.message + ' · ' : '') + (a.freq === 'every' ? 'Every time' : 'Only once') + (a.active ? '' : ' · stopped');
    row.querySelector('[data-k=pause]').textContent = a.active ? 'Pause' : 'Resume';
    row.querySelector('[data-k=pause]').onclick = async () => { a.active = !a.active; armed.delete(a.id); try { await backend.update(a.id, a); } catch (e) { toastFn('Could not update the alert.'); } pushLines(); renderList(); };
    row.querySelector('[data-k=edit]').onclick = () => openForm(a);
    row.querySelector('[data-k=del]').onclick = async () => { try { await backend.remove(a.id); alerts = alerts.filter((x) => x !== a); } catch (e) { toastFn('Could not delete the alert.'); } pushLines(); renderList(); };
    list.appendChild(row);
  }
}

// Settings window → Alerts tab (a Vela host section; global prefs, not per chart)
function alertsSection(){
  const g = (k) => () => prefs[k]; const s = (k) => (v) => { prefs[k] = v; savePrefs(); };
  return [{ title: 'Alerts', id: 'stk-alerts', placement: 'end', rows: [
    { kind: 'heading', label: 'Alerts work while the Charts page is open' },
    { kind: 'toggle', label: 'Alert lines', id: 'al-lines', get: g('lines'), set: s('lines') },
    { kind: 'color', label: 'Alert line color', id: 'al-color', get: g('lineColor'), set: s('lineColor') },
    { kind: 'toggle', label: 'Only active alerts', id: 'al-only', get: g('onlyActive'), set: s('onlyActive') },
    { kind: 'select', label: 'Alert volume', id: 'al-vol', options: ['0', '20', '40', '60', '80', '100'], get: () => String(prefs.volume), set: (v) => { prefs.volume = Number(v); savePrefs(); beep(); } },
    { kind: 'toggle', label: 'Automatically hide toasts', id: 'al-hide', get: g('autoHide'), set: s('autoHide') }
  ] }];
}

const CSS = `
#stk-al{ position:fixed; inset:0; z-index:9000; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; padding:16px; }
#stk-al[hidden]{ display:none; }
.stk-al-box{ width:min(560px,100%); max-height:min(80vh,680px); display:flex; flex-direction:column; background:#1a1b1f; color:#e6e7ea; border:1px solid #2e3036; border-radius:12px; padding:16px; box-shadow:0 20px 60px rgba(0,0,0,.5); font:14px/1.4 system-ui,sans-serif; }
:root[data-theme="light"] .stk-al-box{ background:#fff; color:#131722; border-color:#e0e3eb; }
.stk-al-head{ display:flex; align-items:center; justify-content:space-between; }
.stk-al-head h2{ margin:0; font-size:18px; }
.stk-al-x{ background:none; border:0; color:inherit; font-size:22px; cursor:pointer; }
.stk-al-note{ margin:6px 0 12px; font-size:12.5px; opacity:.75; }
.stk-al-form{ display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px; }
.stk-al-form[hidden]{ display:none; }
.stk-al-form label{ display:flex; flex-direction:column; gap:4px; font-size:12px; opacity:.9; }
.stk-al-form .stk-al-wide{ grid-column:1/-1; }
.stk-al-form input,.stk-al-form select{ background:transparent; color:inherit; border:1px solid #3a3d45; border-radius:6px; padding:7px 8px; font:inherit; }
:root[data-theme="light"] .stk-al-form input,:root[data-theme="light"] .stk-al-form select{ border-color:#d1d4dc; }
.stk-al-form select option{ color:#131722; }
.stk-al-fbtn{ grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px; }
.stk-al-box button{ border-radius:6px; padding:6px 12px; border:1px solid #3a3d45; background:transparent; color:inherit; cursor:pointer; font:inherit; font-size:13px; }
.stk-al-box .stk-al-save,.stk-al-box .stk-al-new{ background:#2962ff; border-color:#2962ff; color:#fff; }
.stk-al-tools{ display:flex; align-items:center; gap:10px; margin-bottom:8px; font-size:12px; opacity:.95; }
.stk-al-list{ overflow:auto; min-height:60px; scrollbar-width:thin; scrollbar-color:rgba(140,145,160,.35) transparent; }
.stk-al-list::-webkit-scrollbar{ width:8px; } .stk-al-list::-webkit-scrollbar-thumb{ background:rgba(140,145,160,.35); border-radius:8px; }
.stk-al-list::-webkit-scrollbar-thumb:hover{ background:rgba(140,145,160,.6); } .stk-al-list::-webkit-scrollbar-track{ background:transparent; }
.stk-al-row{ display:flex; align-items:center; gap:6px; padding:8px 0; border-top:1px solid rgba(128,128,128,.18); }
.stk-al-row.off{ opacity:.55; }
.stk-al-txt{ flex:1; min-width:0; display:flex; flex-direction:column; }
.stk-al-txt span{ font-size:12px; opacity:.75; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.stk-al-empty{ opacity:.6; font-size:13px; }
#stk-al-toasts{ position:fixed; right:16px; bottom:16px; z-index:9100; display:flex; flex-direction:column; gap:8px; max-width:min(360px,calc(100vw - 32px)); }
.stk-al-toast{ position:relative; background:#1a1b1f; color:#e6e7ea; border:1px solid #f7a600; border-radius:10px; padding:10px 34px 10px 12px; box-shadow:0 10px 30px rgba(0,0,0,.45); display:flex; flex-direction:column; font:13px/1.35 system-ui,sans-serif; }
:root[data-theme="light"] .stk-al-toast{ background:#fff; color:#131722; }
.stk-al-toast span{ font-size:12px; opacity:.75; }
.stk-al-toast button{ position:absolute; top:4px; right:6px; background:none; border:0; color:inherit; font-size:18px; cursor:pointer; }
@media (max-width:600px){ #stk-al{ padding:0; align-items:stretch; } .stk-al-box{ max-height:none; border-radius:0; width:100%; } .stk-al-row{ flex-wrap:wrap; } }
`;

// ---------------------------------------------------------------------------------------
export function installChartAlerts(Core){
  try { Core.registerRendererLayer({ id: LAYER, placement: 'above-data', create: linesLayer }); } catch (e) { console.warn('Stryker alerts: layer', e); }
  window.__stkExtraSections = (window.__stkExtraSections || []).concat([alertsSection]);
}
export function mountChartAlerts(ws, opts){
  WS = ws; toastFn = (opts && opts.toast) || toastFn;
  if (!document.getElementById('stk-al-css')) { const st = document.createElement('style'); st.id = 'stk-al-css'; st.textContent = CSS; document.head.appendChild(st); }
  const bar = opts && opts.bar;
  if (bar && !document.getElementById('stkc-alerts-btn')) {
    const b = document.createElement('button'); b.type = 'button'; b.id = 'stkc-alerts-btn'; b.className = 'stkc-btn stkc-icon'; b.title = 'Price alerts (Alt+A)'; b.setAttribute('aria-label', 'Price alerts');
    b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2 2M5 4 2.5 6.5M19 4l2.5 2.5"/></svg>';
    b.onclick = () => openAlerts();
    bar.insertBefore(b, bar.firstChild);
  }
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'a' && e.key !== 'A' && e.code !== 'KeyA')) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault(); const c = activeCell(); openAlerts({ symbol: c ? c.symbol : '', price: crossPrice() });
  });
  try { ws.on('state:changed', () => setTimeout(pushLines, 0)); } catch (e) {}
  try { fb().auth().onAuthStateChanged(() => reload()); } catch (e) { reload(); }
  setInterval(poll, 1000);
  setInterval(pushLines, 5000);   // new cells / symbol switches pick up their lines
  window.__stkAlerts = { tick, open: openAlerts, get alerts(){ return alerts; }, get prefs(){ return prefs; }, reload, pushLines };
}
