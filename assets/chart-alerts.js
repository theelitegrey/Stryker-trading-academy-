// TradeZoro — Charts price alerts (ES module, charts.html only)
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
//   - INDICATOR ALERTS (2026-10-06, the chart "+" menu, assets/chart-plus.js): the condition
//     source can be an indicator's plot on the chart (by indicator title + plot index), crossing
//     a value or crossing the candle close. Uses the plot values the chart already computed;
//     checked only while a chart of that symbol carries that indicator. These are kept in this
//     browser (localStorage) for everyone: the Firestore alert shape is price-only.
// Education only. Not financial advice. Alerts are a convenience, not a trading signal.

const LAYER = 'stk_alerts';
const PREFS_KEY = 'stryker_chart_alert_prefs';
const MAX_ALERTS = 200;
const CONDS = [
  ['crossing', 'Crossing'], ['crossing_up', 'Crossing up'], ['crossing_down', 'Crossing down'],
  ['greater', 'Greater than'], ['less', 'Less than']
];
const CONDL = Object.fromEntries(CONDS);
const IND_KEY = 'stryker_chart_alerts_ind';
const SOUND_EVENTS = [['price', 'Price alert'], ['tp', 'Take profit hit'], ['sl', 'Stop loss hit'], ['long', 'Long opened'], ['short', 'Short opened'], ['closed', 'Position closed'], ['indicator', 'Indicator signal (other)']];
const SOUND_OPTIONS = ['off', 'chime', 'bell', 'ping', 'cash', 'alarm', 'custom'];
const SOUND_LABELS = { off: 'Off', chime: 'Chime', bell: 'Bell', ping: 'Ping', cash: 'Cash register', alarm: 'Alarm', custom: 'Custom' };
const SOUND_LABEL_OPTIONS = SOUND_OPTIONS.map((k) => SOUND_LABELS[k]);
const SOUND_DEFAULTS = { price: 'chime', tp: 'cash', sl: 'alarm', long: 'bell', short: 'ping', closed: 'chime', indicator: 'ping' };
const PREF_DEFAULTS = { lines: true, lineColor: '#f7a600', onlyActive: false, volume: 60, autoHide: true, sounds: Object.assign({}, SOUND_DEFAULTS) };

let WS = null, toastFn = () => {};
let alerts = [];                       // [{id, symbol, cond, price, message, freq, active, triggeredAt}]
const last = new Map();                // symbol -> last price seen
const armed = new Map();               // alert id -> false while its condition is still true (edge trigger)
let prefs = loadPrefs();
let backend = null;

function loadPrefs(){
  try { const p = Object.assign({}, PREF_DEFAULTS, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); p.sounds = Object.assign({}, SOUND_DEFAULTS, p.sounds || {}); return p; }
  catch (e) { return Object.assign({}, PREF_DEFAULTS, { sounds: Object.assign({}, SOUND_DEFAULTS) }); }
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
// Indicator-plot alerts: always local (the Firestore rules validate a price-only shape).
function cleanInd(a){
  const c = clean(a); const s = a.src || {};
  c.src = { title: String(s.title || '').slice(0, 80), plot: Math.max(0, Math.min(20, parseInt(s.plot, 10) || 0)), plotTitle: String(s.plotTitle || '').slice(0, 40), vs: s.vs === 'close' ? 'close' : 'value' };
  if (c.src.vs === 'close') c.price = 0;
  return c;
}
const indAll = () => { try { const v = JSON.parse(localStorage.getItem(IND_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const indPut = (v) => localStorage.setItem(IND_KEY, JSON.stringify(v));
const indStore = {
  kind: 'local',
  async list(){ return indAll(); },
  async add(a){ const id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); indPut(indAll().concat([Object.assign(cleanInd(a), { id })])); return id; },
  async update(id, a){ indPut(indAll().map((x) => x.id === id ? Object.assign(cleanInd(a), { id }) : x)); },
  async remove(id){ indPut(indAll().filter((x) => x.id !== id)); }
};
const storeOf = (a) => (a && a.src) ? indStore : backend;
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
  catch (e) { console.warn('TradeZoro alerts: load', e); alerts = []; }
  try { alerts = alerts.concat(indAll().filter((a) => a && a.src && a.src.title).map((a) => Object.assign({ id: a.id }, cleanInd(a)))); } catch (e) {}
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
// Indicator plots on a chart (renderer scene), line-like series only (what the crosshair reads).
function plotSeries(model){ return (model.series || []).filter((s) => s.kind !== 'candle' && s.kind !== 'bar' && s.kind !== 'markers' && s.points && s.points.length); }
export function chartPlots(R){
  const out = [];
  try {
    for (const m of R.scene.indicators.values()) {
      const ser = plotSeries(m); if (!ser.length || !m.title) continue;
      out.push({ title: m.title, plots: ser.map((s, i) => ({ index: i, title: s.title || ('Plot ' + (i + 1)) })) });
    }
  } catch (e) {}
  return out;
}
function plotValueOf(sym, src){
  for (const c of cellsOf(sym)) {
    const R = inner(c); if (!R || !R.scene) continue;
    for (const m of R.scene.indicators.values()) {
      if (m.title !== src.title) continue;
      const s = plotSeries(m)[src.plot || 0]; if (!s) continue;
      for (let i = s.points.length - 1; i >= 0 && i >= s.points.length - 3; i--) { const v = s.points[i] && s.points[i].value; if (Number.isFinite(v)) return v; }
    }
  }
  return null;
}
const lastInd = new Map();             // indicator alert id -> last (plot - reference) seen
function tickInd(a){
  const v = plotValueOf(a.symbol, a.src); if (v == null) return;
  const ref = a.src.vs === 'close' ? priceOf(a.symbol) : a.price; if (!Number.isFinite(ref)) return;
  const d = v - ref; const prev = lastInd.has(a.id) ? lastInd.get(a.id) : null; lastInd.set(a.id, d);
  const h = hit({ cond: a.cond, price: 0 }, prev, d);
  if (!h) { armed.delete(a.id); return; }
  if (armed.get(a.id) === false) return;
  armed.set(a.id, false);
  fire(a, +v.toFixed(6));
}
function describe(a){
  if (a.src) return a.symbol + ' ' + a.src.title + (a.src.plotTitle ? ' (' + a.src.plotTitle + ')' : '') + ' ' + CONDL[a.cond].toLowerCase() + ' ' + (a.src.vs === 'close' ? 'candle close' : fmt(a.price));
  return a.symbol + ' ' + CONDL[a.cond].toLowerCase() + ' ' + a.price;
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
    if (!a.active || a.symbol !== sym || a.src) continue;
    const h = hit(a, prev, p);
    if (!h) { armed.delete(a.id); continue; }
    if (armed.get(a.id) === false) continue;          // still true since the last fire: wait for a reset
    armed.set(a.id, false);
    fire(a, p);
  }
}
function poll(){
  const syms = new Set(alerts.filter((a) => a.active && !a.src).map((a) => a.symbol));
  for (const s of syms) { const p = priceOf(s); if (p != null) tick(s, p); }
  for (const a of alerts) if (a.active && a.src) tickInd(a);
}
function fire(a, p){
  const text = a.message || describe(a);
  showToast('Alert: ' + text, (a.src ? 'Value ' : 'Price ') + p + ' · ' + new Date().toLocaleTimeString());
  playAlertSound(a.src ? 'indicator' : 'price');
  try { if (window.Notification && Notification.permission === 'granted') new Notification('TradeZoro chart alert', { body: text, tag: 'stk-alert-' + a.id }); } catch (e) {}
  if (a.freq === 'once') {
    a.active = false;
    const st = storeOf(a); st && st.update(a.id, a).catch((e) => console.warn('TradeZoro alerts: update', e));
    pushLines(); renderList();
  }
  try { window.dispatchEvent(new CustomEvent('stryker:chart-alert', { detail: { id: a.id, symbol: a.symbol, price: p } })); } catch (e) {}
}
let actx = null;
function beep(){ playAlertSound('price', { noRateLimit: true }); }
function playAlertSound(event, opts){
  const S = window.StrykerChartSounds;
  if (S && S.play) return S.play(event || 'price', opts || {});
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
const lineSig = new WeakMap();   // renderer -> last pushed lines signature
function pushLines(){
  if (!WS) return;
  for (const c of WS.context().cells || []) {
    const cell = cellOf(c.id); const R = inner(cell); if (!R || !R.setNativeData) continue;
    const lines = prefs.lines ? alerts.filter((a) => a.symbol === cell.symbol && (!a.src || a.src.vs !== 'close') && (a.active || !prefs.onlyActive)).map((a) => ({ price: a.price, active: a.active })) : [];
    // only push when something changed: every setNativeData repaints the whole chart
    const sig = JSON.stringify(lines) + prefs.lineColor;
    if (lineSig.get(R) === sig) continue;
    lineSig.set(R, sig);
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
      <label class="stk-al-wide">Source<select name="src"></select></label>
      <label>Condition<select name="cond">${CONDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="stk-al-vsw" hidden>Against<select name="vs"><option value="value">Value</option><option value="close">Candle close</option></select></label>
      <label class="stk-al-pw">Price<input name="price" type="number" step="any"></label>
      <label class="stk-al-wide">Message<input name="message" maxlength="140" placeholder="Optional"></label>
      <label>Trigger<select name="freq"><option value="once">Only once</option><option value="every">Every time</option></select></label>
      <div class="stk-al-fbtn"><button type="button" class="stk-al-cancel">Cancel</button><button type="submit" class="stk-al-save">Create</button></div>
    </form>
    <div class="stk-al-tools"><button type="button" class="stk-al-new">+ New alert</button><button type="button" class="stk-al-sounds">Sounds</button><span class="stk-al-count"></span></div>
    <div class="stk-al-list"></div>
  </div>`;
  document.body.appendChild(panel);
  panel.addEventListener('click', (e) => { if (e.target === panel) closePanel(); });
  panel.querySelector('.stk-al-x').onclick = closePanel;
  panel.querySelector('.stk-al-new').onclick = () => { const c = activeCell(); openForm({ symbol: c ? c.symbol : '', price: crossPrice() }); };
  panel.querySelector('.stk-al-sounds').onclick = () => openSoundPanel();
  panel.querySelector('.stk-al-cancel').onclick = () => { panel.querySelector('.stk-al-form').hidden = true; editing = null; };
  panel.querySelector('.stk-al-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target; const base = { symbol: f.symbol.value.trim(), cond: f.cond.value, price: parseFloat(f.price.value), message: f.message.value.trim(), freq: f.freq.value, active: true };
    const so = f.src.value ? srcOpts[Number(f.src.value)] : null;
    if (so) { base.src = { title: so.title, plot: so.plot, plotTitle: so.plotTitle, vs: f.vs.value }; if (base.src.vs === 'close') base.price = 0; }
    const a = so ? cleanInd(base) : clean(base);
    if (!a.symbol || !Number.isFinite(a.price)) { toastFn('Enter a symbol and a price.'); return; }
    try {
      if (!backend) await reload();   // never mounted / auth not resolved yet: build the store first
      if (!storeOf(a)) throw new Error('no alert store');
      const old = editing ? alerts.find((x) => x.id === editing) : null;
      if (old && !!old.src === !!a.src) { await storeOf(a).update(editing, a); for (const k of Object.keys(old)) if (k !== 'id') delete old[k]; Object.assign(old, a); armed.delete(editing); lastInd.delete(editing); }
      else {
        if (!old && alerts.length >= MAX_ALERTS) { toastFn('You have ' + MAX_ALERTS + ' alerts, the most we keep. Delete one first.'); return; }
        if (old) { await storeOf(old).remove(old.id); alerts = alerts.filter((x) => x !== old); }
        const id = await storeOf(a).add(a); alerts.push(Object.assign({ id }, a));
      }
      try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e2) {}
      f.hidden = true; editing = null; pushLines(); renderList();
    } catch (err) { console.warn(err); toastFn('Could not save the alert. Check your connection and try again.'); }
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel && !panel.hidden) closePanel(); });
  const f = panel.querySelector('.stk-al-form');
  f.src.onchange = () => syncSrc(f);
  f.vs.onchange = () => syncSrc(f);
}
// Source list: "Price" + every plot of every indicator on the active chart (+ the alert's own
// source when editing one whose indicator isn't on this chart).
let srcOpts = [];
function fillSrc(f, a){
  const R = inner(activeCell());
  srcOpts = [];
  for (const ind of (R ? chartPlots(R) : [])) for (const pl of ind.plots) srcOpts.push({ title: ind.title, plot: pl.index, plotTitle: ind.plots.length > 1 ? pl.title : '' });
  if (a && a.src && !srcOpts.some((o) => o.title === a.src.title && o.plot === a.src.plot)) srcOpts.push({ title: a.src.title, plot: a.src.plot, plotTitle: a.src.plotTitle || '' });
  f.src.textContent = '';
  const o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Price'; f.src.appendChild(o0);
  srcOpts.forEach((o, i) => { const op = document.createElement('option'); op.value = String(i); op.textContent = o.title + (o.plotTitle ? ' · ' + o.plotTitle : ''); f.src.appendChild(op); });
  const idx = a && a.src ? srcOpts.findIndex((o) => o.title === a.src.title && o.plot === a.src.plot) : -1;
  f.src.value = idx >= 0 ? String(idx) : '';
  f.vs.value = a && a.src && a.src.vs === 'close' ? 'close' : 'value';
  syncSrc(f);
}
function syncSrc(f){
  const ind = !!f.src.value;
  f.querySelector('.stk-al-vsw').hidden = !ind;
  const needPrice = !ind || f.vs.value !== 'close';
  f.querySelector('.stk-al-pw').hidden = !needPrice;
  f.price.required = needPrice;
}
function openForm(a){
  const f = panel.querySelector('.stk-al-form'); f.hidden = false;
  f.symbol.value = a.symbol || ''; f.cond.value = a.cond || 'crossing'; f.price.value = fmt(Number(a.price));
  f.message.value = a.message || ''; f.freq.value = a.freq || 'once';
  fillSrc(f, a);
  if (a.src && a.src.vs === 'close') f.price.value = '';
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
    row.querySelector('b').textContent = a.src ? (a.symbol + ' · ' + a.src.title + (a.src.plotTitle ? ' (' + a.src.plotTitle + ')' : '') + ' ' + CONDL[a.cond] + ' ' + (a.src.vs === 'close' ? 'candle close' : fmt(a.price))) : (a.symbol + ' · ' + CONDL[a.cond] + ' ' + fmt(a.price));
    row.querySelector('span').textContent = (a.message ? a.message + ' · ' : '') + (a.freq === 'every' ? 'Every time' : 'Only once') + (a.active ? '' : ' · stopped') + (a.src ? ' · this browser' : '');
    row.querySelector('[data-k=pause]').textContent = a.active ? 'Pause' : 'Resume';
    row.querySelector('[data-k=pause]').onclick = async () => { a.active = !a.active; armed.delete(a.id); try { await storeOf(a).update(a.id, a); } catch (e) { toastFn('Could not update the alert.'); } pushLines(); renderList(); };
    row.querySelector('[data-k=edit]').onclick = () => openForm(a);
    row.querySelector('[data-k=del]').onclick = async () => { try { await storeOf(a).remove(a.id); alerts = alerts.filter((x) => x !== a); } catch (e) { toastFn('Could not delete the alert.'); } pushLines(); renderList(); };
    list.appendChild(row);
  }
}


let soundPanel = null;
function openSoundPanel(){
  if (!soundPanel) buildSoundPanel();
  renderSoundControls(soundPanel.querySelector('.stk-snd-body'), { modal: true });
  soundPanel.hidden = false;
}
function closeSoundPanel(){ if (soundPanel) soundPanel.hidden = true; }
function buildSoundPanel(){
  soundPanel = document.createElement('div'); soundPanel.id = 'stk-snd'; soundPanel.hidden = true;
  soundPanel.innerHTML = '<div class="stk-snd-box" role="dialog" aria-modal="true" aria-labelledby="stk-snd-h"><div class="stk-al-head"><h2 id="stk-snd-h">Sounds</h2><button type="button" class="stk-al-x" aria-label="Close">×</button></div><p class="stk-al-note">Pick alert sounds for chart notifications. Custom files stay in this browser only (MP3/WAV/OGG, max 1 MB and 10 seconds).</p><div class="stk-snd-body"></div></div>';
  document.body.appendChild(soundPanel);
  soundPanel.addEventListener('click', (e) => { if (e.target === soundPanel) closeSoundPanel(); });
  soundPanel.querySelector('.stk-al-x').onclick = closeSoundPanel;
}
function soundName(k){ const S = window.StrykerChartSounds; return S && S.soundLabel ? S.soundLabel(k) : (SOUND_LABELS[k] || k); }
function soundKey(v){
  const s = String(v || '').trim().toLowerCase();
  for (const k of SOUND_OPTIONS) if (s === k || s === String(SOUND_LABELS[k]).toLowerCase()) return k;
  if (s === 'cash register') return 'cash';
  return '';
}
function saveSound(event, val){
  const k = soundKey(val) || SOUND_DEFAULTS[event] || 'chime';
  prefs.sounds = Object.assign({}, SOUND_DEFAULTS, prefs.sounds || {});
  prefs.sounds[event] = k; savePrefs();
  try { window.StrykerChartSounds && window.StrykerChartSounds.setEventSound(event, k); } catch (e) {}
  return k;
}
function renderSoundControls(host, opts){
  if (!host) return;
  const S = window.StrykerChartSounds;
  prefs = loadPrefs();
  const volume = Math.max(0, Math.min(100, Number(prefs.volume)));
  host.classList.add('stk-snd-ui');
  host.innerHTML = '<div class="stk-snd-card stk-snd-preview"><div><h3>Preview sounds</h3><p>Tap a sound to hear it.</p></div><div class="stk-snd-pills"></div></div><label class="stk-snd-vol"><span>Volume</span><input type="range" min="0" max="100" step="1"><b></b></label><div class="stk-snd-card"><h3>Event sounds</h3><div class="stk-snd-events"></div></div>';
  const pills = host.querySelector('.stk-snd-pills');
  SOUND_OPTIONS.filter((x) => x !== 'custom').forEach((k) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'stk-snd-pill'; b.dataset.preview = k; b.textContent = k === 'off' ? 'Off' : '▶ ' + soundName(k);
    b.onclick = () => { if (S && S.preview) S.preview(k, 'price'); else beep(); };
    pills.appendChild(b);
  });
  const vr = host.querySelector('.stk-snd-vol input'), vrTxt = host.querySelector('.stk-snd-vol b');
  vr.value = String(volume); vrTxt.textContent = volume + '%'; vr.style.setProperty('--stk-vol', volume + '%');
  vr.oninput = () => { prefs.volume = Number(vr.value); savePrefs(); vrTxt.textContent = prefs.volume + '%'; vr.style.setProperty('--stk-vol', prefs.volume + '%'); };
  vr.onchange = () => beep();
  const ev = host.querySelector('.stk-snd-events');
  for (const [event, label] of SOUND_EVENTS) {
    const row = document.createElement('div'); row.className = 'stk-snd-row';
    row.innerHTML = '<div class="stk-snd-event"><strong></strong><em></em></div><div class="stk-snd-pick"><select aria-label="Sound"></select><button type="button" class="stk-snd-mini stk-snd-play" data-k="play" aria-label="Play sound" title="Play sound">▶</button></div><input type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg" hidden><button type="button" class="stk-snd-mini" data-k="upload">Custom</button><button type="button" class="stk-snd-mini" data-k="remove" hidden>Remove</button><small></small>';
    row.querySelector('strong').textContent = label;
    const sel = row.querySelector('select');
    for (const k of SOUND_OPTIONS) { const op = document.createElement('option'); op.value = k; op.textContent = soundName(k); sel.appendChild(op); }
    sel.value = (prefs.sounds || {})[event] || SOUND_DEFAULTS[event];
    sel.onchange = () => { sel.value = saveSound(event, sel.value); };
    row.querySelector('[data-k=play]').onclick = () => { if (S && S.play) S.play(event, { preview: true, noRateLimit: true }); else beep(); };
    const file = row.querySelector('input[type=file]'), msg = row.querySelector('small'), sub = row.querySelector('em'), rm = row.querySelector('[data-k=remove]');
    const setSub = async () => { try { const rec = S && S.getCustom ? await S.getCustom(event) : null; sub.textContent = rec ? ('Custom: ' + rec.name) : 'Default: ' + soundName(SOUND_DEFAULTS[event]); rm.hidden = !rec; } catch (e) { sub.textContent = 'Default: ' + soundName(SOUND_DEFAULTS[event]); rm.hidden = true; } };
    setSub();
    row.querySelector('[data-k=upload]').onclick = () => file.click();
    file.onchange = async () => {
      msg.textContent = '';
      try { if (!S || !S.putCustom) throw new Error('Custom sounds are not ready yet.'); const rec = await S.putCustom(event, file.files[0]); prefs = loadPrefs(); sel.value = 'custom'; msg.textContent = 'Saved ' + rec.name; setSub(); }
      catch (err) { msg.textContent = (err && err.message) || 'Could not save that file.'; }
      finally { file.value = ''; }
    };
    row.querySelector('[data-k=remove]').onclick = async () => {
      try { if (S && S.removeCustom) await S.removeCustom(event); prefs = loadPrefs(); sel.value = (prefs.sounds || {})[event] || SOUND_DEFAULTS[event]; msg.textContent = 'Custom sound removed.'; setSub(); }
      catch (err) { msg.textContent = 'Could not remove it.'; }
    };
    ev.appendChild(row);
  }
}
function wireSettingsSounds(dlg){
  if (!dlg || dlg.__stkSoundsWired) return;
  dlg.__stkSoundsWired = true;
  const scan = () => {
    const rail = dlg.querySelector('.vela-sd-rail'), paneHost = dlg.querySelector('.vela-sd-pane');
    if (!rail || !paneHost) return;
    const tabs = [...rail.querySelectorAll('.vela-sd-tab')];
    const panes = [...paneHost.children];
    const i = tabs.findIndex((t) => (t.textContent || '').trim() === 'Sounds');
    const pane = i >= 0 ? panes[i] : null;
    if (!pane) return;
    if (!pane.querySelector('.stk-snd-settings')) {
      pane.textContent = '';
      const wrap = document.createElement('div'); wrap.className = 'stk-snd-settings';
      pane.appendChild(wrap);
      renderSoundControls(wrap, { settings: true });
    }
  };
  scan();
  new MutationObserver(scan).observe(dlg, { childList: true, subtree: true });
}
function watchSoundSettings(){
  if (watchSoundSettings.done) return;
  watchSoundSettings.done = true;
  const scan = () => document.querySelectorAll('.vela-dialog--settings').forEach(wireSettingsSounds);
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
}

// Settings window → Alerts tab (a Vela host section; global prefs, not per chart)
function alertsSection(){
  const g = (k) => () => prefs[k]; const s = (k) => (v) => { prefs[k] = v; savePrefs(); };
  const setSound = (event) => (v) => saveSound(event, v);
  const soundRows = SOUND_EVENTS.map(([event, label]) => ({ kind: 'select', label, id: 'snd-' + event, options: SOUND_LABEL_OPTIONS, get: () => SOUND_LABELS[String((prefs.sounds || {})[event] || SOUND_DEFAULTS[event])] || 'Chime', set: setSound(event) }));
  return [
    { title: 'Alerts', id: 'stk-alerts', placement: 'end', rows: [
      { kind: 'heading', label: 'Alerts work while the Charts page is open' },
      { kind: 'toggle', label: 'Alert lines', id: 'al-lines', get: g('lines'), set: s('lines') },
      { kind: 'color', label: 'Alert line color', id: 'al-color', get: g('lineColor'), set: s('lineColor') },
      { kind: 'toggle', label: 'Only active alerts', id: 'al-only', get: g('onlyActive'), set: s('onlyActive') },
      { kind: 'select', label: 'Alert volume', id: 'al-vol', options: ['0', '20', '40', '60', '80', '100'], get: () => String(prefs.volume), set: (v) => { prefs.volume = Number(v); savePrefs(); beep(); } },
      { kind: 'toggle', label: 'Automatically hide toasts', id: 'al-hide', get: g('autoHide'), set: s('autoHide') }
    ] },
    { title: 'Sounds', id: 'stk-sounds', placement: 'end', rows: [
      { kind: 'heading', label: 'Alert sounds. Preview, upload and volume controls load below.' },
      { kind: 'select', label: 'Volume', id: 'snd-vol', options: ['0', '20', '40', '60', '80', '100'], get: () => String(prefs.volume), set: (v) => { prefs.volume = Number(v); savePrefs(); beep(); } },
      ...soundRows
    ] }
  ];
}

const CSS = `
#stk-al,#stk-snd{ position:fixed; inset:0; z-index:9000; background:rgba(0,0,0,.62); display:flex; align-items:center; justify-content:center; padding:16px; }
#stk-al[hidden],#stk-snd[hidden]{ display:none; }
.stk-al-box,.stk-snd-box{ width:min(600px,100%); max-height:min(84vh,720px); display:flex; flex-direction:column; background:#0b0b0d; color:#eeeeee; border:1px solid rgba(3,201,136,.22); border-radius:18px; padding:18px; box-shadow:0 24px 80px rgba(0,0,0,.62); font:14px/1.45 Archivo,system-ui,sans-serif; }
:root[data-theme="light"] .stk-al-box,:root[data-theme="light"] .stk-snd-box{ background:#ffffff; color:#131316; border-color:rgba(3,201,136,.32); }
.stk-al-head{ display:flex; align-items:center; justify-content:space-between; gap:12px; }
.stk-al-head h2{ margin:0; font-size:18px; letter-spacing:-.01em; }
.stk-al-x{ background:none; border:0; color:inherit; font-size:22px; cursor:pointer; }
.stk-al-note{ margin:6px 0 12px; font-size:12.5px; color:rgba(238,238,238,.68); }
:root[data-theme="light"] .stk-al-note{ color:rgba(19,19,22,.68); }
.stk-al-form{ display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px; }
.stk-al-form[hidden],.stk-al-form label[hidden]{ display:none; }
.stk-al-form label{ display:flex; flex-direction:column; gap:4px; font-size:12px; opacity:.9; }
.stk-al-form .stk-al-wide{ grid-column:1/-1; }
.stk-al-form input,.stk-al-form select{ background:#131316; color:#eeeeee; border:1px solid rgba(238,238,238,.14); border-radius:10px; padding:8px 10px; font:inherit; }
:root[data-theme="light"] .stk-al-form input,:root[data-theme="light"] .stk-al-form select{ background:#fff; color:#131316; border-color:rgba(19,19,22,.16); }
.stk-al-form select option,.stk-snd-row select option{ color:#131316; }
.stk-al-fbtn{ grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px; }
.stk-al-box button,.stk-snd-box button,.stk-snd-ui button{ border-radius:999px; padding:7px 13px; border:1px solid rgba(3,201,136,.28); background:rgba(3,201,136,.08); color:inherit; cursor:pointer; font:inherit; font-size:13px; transition:background .16s ease,border-color .16s ease,transform .16s ease; }
.stk-al-box button:hover,.stk-snd-box button:hover,.stk-snd-ui button:hover{ background:rgba(3,201,136,.15); border-color:rgba(3,201,136,.55); transform:translateY(-1px); }
.stk-al-box .stk-al-save,.stk-al-box .stk-al-new,.stk-al-box .stk-al-sounds,.stk-snd-pill{ background:#03c988; border-color:#03c988; color:#07110d; font-weight:700; }
.stk-al-tools{ display:flex; align-items:center; gap:10px; margin-bottom:8px; font-size:12px; opacity:.95; flex-wrap:wrap; }
.stk-snd-body,.stk-snd-settings,.stk-snd-ui{ min-height:0; }
.stk-snd-ui{ display:flex; flex-direction:column; gap:12px; color:#eeeeee; font-family:Archivo,system-ui,sans-serif; }
:root[data-theme="light"] .stk-snd-ui{ color:#131316; }
.stk-snd-card{ background:#131316; border:1px solid rgba(238,238,238,.09); border-radius:16px; padding:14px; box-shadow:inset 0 1px 0 rgba(255,255,255,.03); }
:root[data-theme="light"] .stk-snd-card{ background:#f7f8f8; border-color:rgba(19,19,22,.10); }
.stk-snd-preview{ display:grid; grid-template-columns:minmax(0,1fr) minmax(220px,1.25fr); gap:14px; align-items:start; }
.stk-snd-ui h3{ margin:0 0 4px; font-size:14px; letter-spacing:.01em; }
.stk-snd-ui p{ margin:0; font-size:12px; color:rgba(238,238,238,.62); }
:root[data-theme="light"] .stk-snd-ui p{ color:rgba(19,19,22,.62); }
.stk-snd-pills{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
.stk-snd-pill{ min-height:34px; }
.stk-snd-vol{ display:grid; grid-template-columns:auto minmax(0,1fr) 46px; gap:10px; align-items:center; background:#131316; border:1px solid rgba(3,201,136,.18); border-radius:16px; padding:12px 14px; font-size:12px; }
:root[data-theme="light"] .stk-snd-vol{ background:#f7f8f8; }
.stk-snd-vol span{ font-weight:700; }
.stk-snd-vol b{ text-align:right; color:#03c988; }
.stk-snd-vol input[type=range]{ appearance:none; -webkit-appearance:none; width:100%; height:8px; border-radius:999px; background:linear-gradient(90deg,#03c988 0%,#03c988 var(--stk-vol,60%),rgba(238,238,238,.14) var(--stk-vol,60%),rgba(238,238,238,.14) 100%); outline:none; }
.stk-snd-vol input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; appearance:none; width:18px; height:18px; border-radius:50%; background:#03c988; border:3px solid #0b0b0d; box-shadow:0 0 0 2px rgba(3,201,136,.35); }
.stk-snd-vol input[type=range]::-moz-range-thumb{ width:18px; height:18px; border-radius:50%; background:#03c988; border:3px solid #0b0b0d; box-shadow:0 0 0 2px rgba(3,201,136,.35); }
.stk-snd-events{ overflow:auto; max-height:42vh; padding-right:2px; scrollbar-width:thin; scrollbar-color:rgba(3,201,136,.42) rgba(255,255,255,.04); }
.stk-snd-events::-webkit-scrollbar,.stk-al-list::-webkit-scrollbar{ width:8px; height:8px; }
.stk-snd-events::-webkit-scrollbar-thumb,.stk-al-list::-webkit-scrollbar-thumb{ background:rgba(3,201,136,.42); border-radius:999px; }
.stk-snd-events::-webkit-scrollbar-thumb:hover,.stk-al-list::-webkit-scrollbar-thumb:hover{ background:rgba(3,201,136,.72); }
.stk-snd-events::-webkit-scrollbar-track,.stk-al-list::-webkit-scrollbar-track{ background:rgba(255,255,255,.04); border-radius:999px; }
.stk-snd-row{ display:grid; grid-template-columns:minmax(128px,1fr) minmax(176px,208px) auto auto; gap:8px; align-items:center; padding:11px 0; border-top:1px solid rgba(238,238,238,.08); }
.stk-snd-row:first-child{ border-top:0; }
.stk-snd-event{ min-width:0; display:flex; flex-direction:column; gap:2px; }
.stk-snd-event strong{ font-size:13px; }
.stk-snd-event em{ color:rgba(238,238,238,.56); font-size:11px; font-style:normal; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
:root[data-theme="light"] .stk-snd-event em{ color:rgba(19,19,22,.56); }
.stk-snd-row select{ width:100%; min-height:36px; background:#0b0b0d; color:#eeeeee; border:1px solid rgba(238,238,238,.14); border-radius:999px; padding:7px 12px; font:inherit; }
:root[data-theme="light"] .stk-snd-row select{ background:#fff; color:#131316; border-color:rgba(19,19,22,.14); }
.stk-snd-mini{ white-space:nowrap; min-height:34px; }
.stk-snd-mini[hidden]{ display:none; }
.stk-snd-pick{ display:flex; align-items:center; gap:6px; min-width:0; }
.stk-snd-pick select{ flex:1 1 auto; min-width:0; }
.stk-snd-ui .stk-snd-play{ flex:0 0 36px; width:36px; height:36px; min-height:36px; padding:0; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:12px; line-height:1; }
.stk-snd-row small{ grid-column:1/-1; min-height:16px; color:#03c988; font-size:11px; }
.stk-al-list{ overflow:auto; min-height:60px; scrollbar-width:thin; scrollbar-color:rgba(3,201,136,.42) rgba(255,255,255,.04); }
.stk-al-row{ display:flex; align-items:center; gap:6px; padding:8px 0; border-top:1px solid rgba(128,128,128,.18); }
.stk-al-row.off{ opacity:.55; }
.stk-al-txt{ flex:1; min-width:0; display:flex; flex-direction:column; }
.stk-al-txt span{ font-size:12px; opacity:.75; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.stk-al-empty{ opacity:.6; font-size:13px; }
#stk-al-toasts{ position:fixed; right:16px; bottom:16px; z-index:9100; display:flex; flex-direction:column; gap:8px; max-width:min(360px,calc(100vw - 32px)); }
.stk-al-toast{ position:relative; background:#0b0b0d; color:#eeeeee; border:1px solid #03c988; border-radius:12px; padding:10px 34px 10px 12px; box-shadow:0 10px 30px rgba(0,0,0,.45); display:flex; flex-direction:column; font:13px/1.35 Archivo,system-ui,sans-serif; }
:root[data-theme="light"] .stk-al-toast{ background:#fff; color:#131316; }
.stk-al-toast span{ font-size:12px; opacity:.75; }
.stk-al-toast button{ position:absolute; top:4px; right:6px; background:none; border:0; color:inherit; font-size:18px; cursor:pointer; }
.vela-dialog--settings .stk-snd-settings{ padding:2px 0 12px; }
.vela-dialog--settings .stk-snd-events{ max-height:none; overflow:visible; }
@media (max-width:700px){ .stk-snd-preview{ grid-template-columns:1fr; } .stk-snd-pills{ justify-content:flex-start; } .stk-snd-row{ grid-template-columns:auto auto 1fr; align-items:center; } .stk-snd-event,.stk-snd-pick{ grid-column:1/-1; } .stk-snd-row small{ grid-column:1/-1; } }
@media (max-width:600px){ #stk-al,#stk-snd{ padding:0; align-items:stretch; } .stk-al-box,.stk-snd-box{ max-height:none; border-radius:0; width:100%; } .stk-al-row{ flex-wrap:wrap; } .stk-snd-events{ max-height:46vh; } }
`

// ---------------------------------------------------------------------------------------
// Programmatic create (assets/chart-watchlist.js "Add alert on the list…"): same store, cap and lines.
export async function addAlert(a){
  if (!backend) { const e = new Error('not ready'); throw e; }
  if (alerts.length >= MAX_ALERTS) { const e = new Error('full'); e.full = true; toastFn('You have ' + MAX_ALERTS + ' alerts, the most we keep. Delete one first.'); throw e; }
  const c = clean(a);
  if (!c.symbol || !Number.isFinite(c.price)) throw new Error('bad alert');
  const id = await backend.add(c); alerts.push(Object.assign({ id }, c));
  pushLines(); renderList();
  return id;
}

export function installChartAlerts(Core){
  try { Core.registerRendererLayer({ id: LAYER, placement: 'above-data', create: linesLayer }); } catch (e) { console.warn('TradeZoro alerts: layer', e); }
  window.__stkExtraSections = (window.__stkExtraSections || []).concat([alertsSection]);
}
export function mountChartAlerts(ws, opts){
  WS = ws; toastFn = (opts && opts.toast) || toastFn;
  if (!document.getElementById('stk-al-css')) { const st = document.createElement('style'); st.id = 'stk-al-css'; st.textContent = CSS; document.head.appendChild(st); }
  watchSoundSettings();
  const bar = opts && opts.bar;
  if (bar && !document.getElementById('stkc-alerts-btn')) {
    const b = document.createElement('button'); b.type = 'button'; b.id = 'stkc-alerts-btn'; b.className = 'stkc-btn stkc-icon'; b.title = 'Price alerts (Alt+A)'; b.setAttribute('aria-label', 'Price alerts');
    b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2 2M5 4 2.5 6.5M19 4l2.5 2.5"/></svg>';
    b.onclick = () => openAlerts();
    bar.insertBefore(b, bar.firstChild);
  }
  document.addEventListener('keydown', (e) => {
    if (window.__stkPlusKeys) return;   // assets/chart-plus.js owns Alt+A (crosshair price, tick-rounded)
    if (!e.altKey || (e.key !== 'a' && e.key !== 'A' && e.code !== 'KeyA')) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault(); const c = activeCell(); openAlerts({ symbol: c ? c.symbol : '', price: crossPrice() });
  });
  try { ws.on('state:changed', () => setTimeout(pushLines, 0)); } catch (e) {}
  try { fb().auth().onAuthStateChanged(() => reload()); } catch (e) { reload(); }
  setInterval(poll, 1000);
  setInterval(pushLines, 5000);   // new cells / symbol switches pick up their lines
  window.__stkAlerts = { tick, poll, open: openAlerts, openSounds: openSoundPanel, add: addAlert, sound: playAlertSound, indicatorAlert: (message, meta) => window.StrykerChartSounds && window.StrykerChartSounds.indicatorAlert(message, meta), simEvent: (kind, detail) => window.StrykerChartSounds && window.StrykerChartSounds.simEvent(kind, detail), get alerts(){ return alerts; }, get prefs(){ return prefs; }, reload, pushLines };
}
