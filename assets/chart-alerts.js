// TradeZoro — Charts price alerts (ES module, charts.html only)
// Owner order 2026-10-06 ("Build all", Settings window → Alerts tab + basic price alerts).
//
// WHAT IT DOES
//   - Price alerts on any chart symbol: Crossing / Crossing up / Crossing down / Greater than /
//     Less than a price, a message, Once or Every time. Create from the Alerts button on our
//     top bar, or Alt+A on a chart (prefilled with the price under the cursor, else the last price).
//   - SERVER-SIDE PRICE ALERTS (Owner 2026-10-16: "why aren't chart alerts pushed on mobile?"):
//     a service on our server (workers/alert-engine) checks every signed-in member's active PRICE
//     alerts on futures and Binance/Coinbase crypto against the real-time price and, on a fire,
//     writes a notifications doc (the bell + the phone push through onNotificationCreated) and
//     students/{uid}/alertFires/{id}. While the engine's heartbeat (settings/alertEngine) is fresh
//     this page does NOT fire those alerts itself (no double alert): it listens to alertFires and
//     shows the toast + sound. If the heartbeat is stale, this page falls back to firing them here.
//   - Everything else is checked IN THIS BROWSER while the Charts page is open: indicator alerts,
//     forex / Hyperliquid price alerts, and alerts saved in this browser (signed out), for symbols
//     that are on a chart here. No notification arrives for those when the page is closed.
//   - Firing in the browser: toast (auto-hide optional), a short beep at the chosen volume, and a
//     browser notification if the member allowed them.
//   - Storage: signed-in members → Firestore students/{uid}/chartAlerts/{id} (owner-only rules,
//     validated shape; the 200-per-member cap is enforced here in the client). Guests → localStorage.
//   - Alert lines: dashed horizontal line per ACTIVE alert on charts of that symbol (renderer layer).
//     TRIGGERED ALERTS LEAVE THE CHART (Owner order 2026-10-22, like TradingView): an alert that can't
//     fire again (Only once after its fire, expired, stopped; fired here or by the server engine,
//     which sets active=false) is not drawn on any chart, now or after a reload. It stays in the
//     Alerts list as "Triggered" (or "Paused" when the member paused it); Restart draws it again.
//     Repeating alerts stay active, so they stay drawn. Paused ids are remembered per browser
//     (PAUSED_KEY) only to word the list; the Firestore alert shape is unchanged.
//   - OWNER ORDER 2026-10-27 (alerts list cleanup): an "Only once" alert that fired is DELETED right after the
//     toast / sound / push (browser store and Firestore), not kept as "Triggered". Triggered once-only alerts
//     left over from before are removed on the next load (cleanupFired). "Delete all" in the panel's top row
//     (confirm sheet) removes every alert. The long how-it-works paragraph lives in an (i) popover by the title.
//   - Alerts tab in the Settings window: Alert lines on/off + colour, Only active alerts,
//     Alert volume, Automatically hide toasts (kept per browser).
//   - INDICATOR ALERTS (2026-10-06, the chart "+" menu, assets/chart-plus.js): the condition
//     source can be an indicator's plot on the chart (by indicator title + plot index), crossing
//     a value or crossing the candle close. Uses the plot values the chart already computed;
//     checked only while a chart of that symbol carries that indicator. These are kept in this
//     browser (localStorage) for everyone: the Firestore alert shape is price-only.
//   - INDICATOR CONDITION ALERTS (Owner 2026-10-22: "why getting alerts for indicators, add alert
//     setting to indicators like tradingview"): a script's alertcondition()/alert() calls are SILENT
//     by default (assets/chart-pine.js wraps every Pine engine and hands each call to
//     window.__stkIndAlerts.event). They fire only for alerts the member created here: Condition =
//     "<indicator> → <alertcondition title>" or "Any alert() function call", Trigger = Only once /
//     Once per bar / Once per bar close, optional expiration, message (prefilled from the script),
//     popup and sound on/off. Also opened from the bell on each indicator's legend row and from
//     "Add alert…" in the indicator's settings window. Kept in this browser (localStorage, like the
//     plot alerts above; the Firestore alert shape is price-only) and checked only while Charts is
//     open: no phone push for them.
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
const PAUSED_KEY = 'stryker_chart_alerts_paused';
const pausedIds = () => { try { const v = JSON.parse(localStorage.getItem(PAUSED_KEY) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch (e) { return new Set(); } };
function markPaused(id, on){ try { const s = pausedIds(); if (on) s.add(id); else s.delete(id); localStorage.setItem(PAUSED_KEY, JSON.stringify([...s].slice(-400))); } catch (e) {} }
// Only alerts that can still fire are drawn on the chart.
export function drawsOnChart(a){ return !!(a && a.active === true); }
const SOUND_EVENTS = [['price', 'Price alert'], ['tp', 'Take profit hit'], ['sl', 'Stop loss hit'], ['long', 'Long opened'], ['short', 'Short opened'], ['closed', 'Position closed'], ['indicator', 'Indicator signal (other)']];
const SOUND_OPTIONS = ['off', 'tz1', 'tz2', 'tz3', 'tz4', 'tz5', 'tz6', 'chime', 'bell', 'ping', 'cash', 'alarm', 'custom'];
const SOUND_LABELS = { off: 'Off', tz1: 'TradeZoro 1', tz2: 'TradeZoro 2', tz3: 'TradeZoro 3', tz4: 'TradeZoro 4', tz5: 'TradeZoro 5', tz6: 'TradeZoro 6', chime: 'Chime', bell: 'Bell', ping: 'Ping', cash: 'Cash register', alarm: 'Alarm', custom: 'Custom' };
const SOUND_LABEL_OPTIONS = SOUND_OPTIONS.map((k) => SOUND_LABELS[k]);
const SOUND_DEFAULTS = { price: 'chime', tp: 'cash', sl: 'alarm', long: 'bell', short: 'ping', closed: 'chime', indicator: 'ping' };
const PREF_DEFAULTS = { lines: true, lineColor: '#f7a600', onlyActive: false, volume: 60, autoHide: true, sounds: Object.assign({}, SOUND_DEFAULTS) };

let WS = null, toastFn = () => {};
let alerts = [];                       // [{id, symbol, cond, price, message, freq, active, triggeredAt}]
const last = new Map();                // symbol -> last price seen
const armed = new Map();               // alert id -> false while its condition is still true (edge trigger)
let prefs = loadPrefs();
let backend = null;
const engine = { on: false, at: 0, timer: null };   // server alert engine heartbeat (settings/alertEngine)
let firesUnsub = null, firesUid = null;
const pageStart = Date.now();

// Same mapping as workers/alert-engine/alert_core.py symbol_key(): does the server have a real-time feed for
// this chart symbol? Futures roots, Binance and Coinbase only (forex and Hyperliquid stay in the browser).
const SRV_FUT = ['NQ', 'MNQ', 'ES', 'MES', 'RTY', 'YM', 'MYM', 'GC', 'MGC', 'SI', 'SIL', 'CL', 'MCL'];
export function serverCovers(sym){
  const m = /^([A-Za-z_]+):(.+)$/.exec(String(sym || '').trim());
  const pre = m ? m[1].toLowerCase() : ''; const t = (m ? m[2] : String(sym || '')).trim().toUpperCase();
  if (pre === 'binance' || pre === 'coinbase') return /^[A-Z0-9._\-]{3,30}$/.test(t);
  if (pre === '' || /^(futures|cme|cme_mini|cbot|cbot_mini|comex|comex_mini|nymex|nymex_mini)$/.test(pre)) return SRV_FUT.includes(t.replace(/1!$/, ''));
  return false;
}
// True when the server fires this alert, so this page must not: a signed-in member's PRICE alert on a
// covered symbol while the engine heartbeat is fresh.
function serverOwns(a){ return engine.on && backend && backend.kind === 'cloud' && !a.src && serverCovers(a.symbol); }
async function checkEngine(){
  try {
    if (!user()) { engine.on = false; return; }
    const d = await fb().firestore().collection('settings').doc('alertEngine').get();
    const at = d.exists && d.data().at && d.data().at.toMillis ? d.data().at.toMillis() : 0;
    engine.at = at; engine.on = at > 0 && Date.now() - at < 180000;
  } catch (e) { engine.on = false; }
}
function startEngineWatch(){
  checkEngine();
  if (!engine.timer) engine.timer = setInterval(() => { checkEngine(); }, 60000);
}
// Server fires arrive as students/{uid}/alertFires/{alertId} (written by the engine, one doc per alert,
// overwritten on every fire of an Every-time alert): toast + sound here, and a Once alert shows stopped.
function listenFires(){
  const u = user(); if (!u || (firesUid === u.uid && firesUnsub)) return;
  if (firesUnsub) { try { firesUnsub(); } catch (e) {} }
  firesUid = u.uid;
  const seen = new Map(); let first = true;
  try {
    firesUnsub = fb().firestore().collection('students').doc(u.uid).collection('alertFires').orderBy('firedAt', 'desc').limit(20).onSnapshot((snap) => {
      if (!snap || typeof snap.docChanges !== 'function') return;
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') continue;
        const d = ch.doc.data(); const ms = d.firedAt && d.firedAt.toMillis ? d.firedAt.toMillis() : 0;
        if (!ms || seen.get(ch.doc.id) === ms) continue;
        seen.set(ch.doc.id, ms);
        const a = alerts.find((x) => x.id === ch.doc.id);
        // A stopped fire removes the line straight away (even an old one, if this page still holds
        // the alert as active, e.g. the fire landed while the list was loading).
        const recent = !(first && ms < pageStart - 20000);
        if (a && d.stopped && a.active && (recent || !a.updatedMs || ms >= a.updatedMs)) { a.active = false; armed.delete(a.id); markPaused(a.id, false); pushLines(); renderList(); }
        if (!recent) continue;                                   // an old fire already in the list: not news
        showToast('Alert: ' + (d.text || d.symbol || ''), 'Price ' + d.price + ' \u00b7 ' + new Date(ms).toLocaleTimeString());
        playAlertSound('price');
        try { window.dispatchEvent(new CustomEvent('stryker:chart-alert', { detail: { id: ch.doc.id, symbol: d.symbol, price: d.price, server: true } })); } catch (e) {}
        if (a && d.stopped) removeFired(a);                      // Only once: the alert is gone after it fired
      }
      first = false;
    }, (e) => console.warn('TradeZoro alerts: fires listener', e && e.code));
  } catch (e) { console.warn('TradeZoro alerts: fires listener', e); }
}

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
// Indicator alertcondition()/alert() alerts (src.kind === 'cond'): same local store as the plot alerts.
const CFREQ = [['once', 'Only once'], ['bar', 'Once per bar'], ['close', 'Once per bar close']];
const CFREQL = Object.fromEntries(CFREQ);
function cleanCond(a){
  const s = a.src || {};
  const exp = Number(a.expires);
  return {
    symbol: String(a.symbol || '').slice(0, 40), cond: 'crossing', price: 0,
    message: String(a.message || '').slice(0, 300),
    freq: CFREQL[a.freq] ? a.freq : 'bar',
    active: a.active !== false,
    expires: Number.isFinite(exp) && exp > 0 ? exp : 0,
    popup: a.popup !== false, sound: a.sound !== false, fired: !!a.fired,
    src: { kind: 'cond', title: String(s.title || '').slice(0, 80), cond: s.any ? '' : String(s.cond || '').slice(0, 80), any: !!s.any }
  };
}
const isCond = (a) => !!(a && a.src && a.src.kind === 'cond');
const cleanLocal = (a) => isCond(a) ? cleanCond(a) : cleanInd(a);
const indAll = () => { try { const v = JSON.parse(localStorage.getItem(IND_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const indPut = (v) => localStorage.setItem(IND_KEY, JSON.stringify(v));
const indStore = {
  kind: 'local',
  async list(){ return indAll(); },
  async add(a){ const id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); indPut(indAll().concat([Object.assign(cleanLocal(a), { id })])); return id; },
  async update(id, a){ indPut(indAll().map((x) => x.id === id ? Object.assign(cleanLocal(a), { id }) : x)); },
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
      async list(){ const s = await col().get(); return s.docs.map((d) => { const x = d.data(); return Object.assign({ id: d.id, updatedMs: x.updatedAt && x.updatedAt.toMillis ? x.updatedAt.toMillis() : 0 }, x); }); },
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
  try { alerts = (await backend.list()).filter((a) => a && Number.isFinite(Number(a.price))).map((a) => Object.assign({ id: a.id, updatedMs: a.updatedMs || 0 }, clean(a))); }
  catch (e) { console.warn('TradeZoro alerts: load', e); alerts = []; }
  try { alerts = alerts.concat(indAll().filter((a) => a && a.src && a.src.title).map((a) => Object.assign({ id: a.id }, cleanLocal(a)))); } catch (e) {}
  pushLines(); renderList();
  if (backend.kind === 'cloud') { startEngineWatch(); listenFires(); watchCloud(); }
  cleanupFired().catch(() => {});
}
// Every open Charts tab follows its alerts' active flag in Firestore, so an Only-once alert that
// fired in another tab (or was stopped by the server engine) leaves this tab's chart straight away.
let cloudUnsub = null, cloudUid = null;
function watchCloud(){
  const u = user(); if (!u || (cloudUid === u.uid && cloudUnsub)) return;
  if (cloudUnsub) { try { cloudUnsub(); } catch (e) {} }
  cloudUid = u.uid;
  try {
    cloudUnsub = fb().firestore().collection('students').doc(u.uid).collection('chartAlerts').onSnapshot((snap) => {
      let changed = false;
      if (!snap || typeof snap.docChanges !== 'function') return;
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') {            // deleted in another tab (fired Only-once, Delete, Delete all)
          const i = alerts.findIndex((x) => x.id === ch.doc.id && !x.src);
          if (i >= 0) { alerts.splice(i, 1); armed.delete(ch.doc.id); changed = true; }
          continue;
        }
        if (ch.type !== 'modified') continue;
        const a = alerts.find((x) => x.id === ch.doc.id && !x.src); const d = ch.doc.data();
        if (!a || typeof d.active !== 'boolean' || a.active === d.active) continue;
        a.active = d.active; armed.delete(a.id); if (!d.active) markPaused(a.id, false); changed = true;
      }
      if (changed) { pushLines(); renderList(); }
    }, (e) => console.warn('TradeZoro alerts: sync', e && e.code));
  } catch (e) { console.warn('TradeZoro alerts: sync', e); }
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
  if (isCond(a)) return a.symbol + ' ' + a.src.title + ' \u2192 ' + (a.src.any ? 'Any alert() function call' : a.src.cond);
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
    if (serverOwns(a)) { armed.delete(a.id); continue; }   // the server fires this one (no double alert)
    const h = hit(a, prev, p);
    if (!h) { armed.delete(a.id); continue; }
    if (armed.get(a.id) === false) continue;          // still true since the last fire: wait for a reset
    armed.set(a.id, false);
    fire(a, p);
  }
}
function poll(){
  if (window.__stkReplay && window.__stkReplay.on) return;   // bar replay: alerts watch live prices only
  const syms = new Set(alerts.filter((a) => a.active && !a.src).map((a) => a.symbol));
  for (const s of syms) { const p = priceOf(s); if (p != null) tick(s, p); }
  for (const a of alerts) if (a.active && a.src && !isCond(a)) tickInd(a);
  for (const a of alerts) if (a.active && isCond(a) && a.expires && Date.now() > a.expires) stopCond(a);
}
function fire(a, p){
  const text = a.message || describe(a);
  showToast('Alert: ' + text, (a.src ? 'Value ' : 'Price ') + p + ' · ' + new Date().toLocaleTimeString());
  playAlertSound(a.src ? 'indicator' : 'price');
  try { if (window.Notification && Notification.permission === 'granted') new Notification('TradeZoro chart alert', { body: text, tag: 'stk-alert-' + a.id }); } catch (e) {}
  try { window.dispatchEvent(new CustomEvent('stryker:chart-alert', { detail: { id: a.id, symbol: a.symbol, price: p } })); } catch (e) {}
  if (a.freq === 'once') removeFired(a);
}
// An Only-once alert that fired is deleted (list + store), after its toast / sound / push went out.
function removeFired(a){
  a.active = false; armed.delete(a.id); lastInd.delete(a.id); pendClose.delete(a.id); markPaused(a.id, false);
  alerts = alerts.filter((x) => x !== a && x.id !== a.id);
  const st = storeOf(a); if (st) Promise.resolve(st.remove(a.id)).catch((e) => console.warn('TradeZoro alerts: remove fired', e));
  pushLines(); renderList();
}
// Is this alert a leftover "Triggered" Only-once alert (fired earlier, still in the store)?
function isFiredOnce(a){
  if (!a || a.active || a.freq !== 'once') return false;
  if (isCond(a)) return !!a.fired;
  return !pausedIds().has(a.id);
}
// One-time cleanup on load: remove them everywhere. Idempotent, so it simply finds nothing afterwards.
async function cleanupFired(){
  const dead = alerts.filter(isFiredOnce); if (!dead.length) return 0;
  alerts = alerts.filter((x) => !dead.includes(x));
  pushLines(); renderList();
  for (const a of dead) { markPaused(a.id, false); try { await storeOf(a).remove(a.id); } catch (e) { console.warn('TradeZoro alerts: cleanup', e); } }
  return dead.length;
}
// Delete every alert (browser + account stores).
async function deleteAll(){
  const all = alerts.slice(); alerts = [];
  armed.clear(); lastInd.clear(); pendClose.clear();
  pushLines(); renderList();
  let failed = 0;
  for (let i = 0; i < all.length; i += 10) {
    await Promise.all(all.slice(i, i + 10).map(async (a) => { try { markPaused(a.id, false); await storeOf(a).remove(a.id); } catch (e) { failed++; alerts.push(a); } }));
  }
  if (failed) { toastFn('Could not delete ' + failed + ' alert' + (failed > 1 ? 's' : '') + '. Try again.'); pushLines(); renderList(); }
}

// ---------------------------------------------------------------------------------------
// indicator alertcondition()/alert() alerts
// ---------------------------------------------------------------------------------------
// Parse a Pine source for its alertcondition(cond, title, message) calls (literal strings, positional
// or named) and whether it calls alert(). Comments and strings are respected by a tiny scanner.
const condCache = new Map();
function splitArgs(src, start){
  const out = []; let depth = 0, cur = '', i = start, q = null;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (q) { cur += ch; if (ch === '\\') { cur += src[++i] || ''; continue; } if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') { if (depth === 0) { out.push(cur.trim()); return out; } depth--; }
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  return out;
}
const lit = (x) => { const m = /^\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*$/.exec(x || ''); return m ? (m[1] != null ? m[1] : m[2]).replace(/\\(.)/g, '$1') : null; };
export function alertConditionsOf(source){
  source = String(source || '');
  if (condCache.has(source)) return condCache.get(source);
  const clean = source.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  const conds = []; const re = /\balertcondition\s*\(/g; let m;
  while ((m = re.exec(clean))) {
    const args = splitArgs(clean, m.index + m[0].length);
    const named = {}; const pos = [];
    for (const a of args) { const n = /^(condition|title|message)\s*=\s*([\s\S]*)$/.exec(a); if (n) named[n[1]] = n[2]; else pos.push(a); }
    const title = lit(named.title != null ? named.title : pos[1]) || ('Condition ' + (conds.length + 1));
    const message = lit(named.message != null ? named.message : pos[2]) || '';
    if (!conds.some((c) => c.title === title)) conds.push({ title, message });
  }
  const hasAlertCall = /(^|[^\w.])alert\s*\(/m.test(clean);
  const r = { conds, hasAlertCall };
  condCache.set(source, r);
  return r;
}
// Every Pine indicator on a chart cell, with its alert conditions: [{ id, title, conds, hasAlertCall }].
function chartOf(cell){ try { return cell.chart; } catch (e) { return null; } }
export function chartIndicatorConds(cell){
  const out = []; const ch = chartOf(cell);
  try {
    for (const rec of ch.orchestrator.registry.all()) {
      if (rec.native || !rec.source) continue;
      const title = (rec.prepared && rec.prepared.meta && rec.prepared.meta.title) || (rec.options && rec.options.title) || rec.title;
      if (!title) continue;
      const c = alertConditionsOf(rec.source);
      out.push({ id: rec.id, title: String(title), conds: c.conds, hasAlertCall: c.hasAlertCall });
    }
  } catch (e) {}
  return out;
}
const symKey = (s) => String(s || '').split(':').pop().trim().toUpperCase();
const firedBars = new Set();          // alert id + bar time already fired (Once per bar / per bar close)
const pendClose = new Map();          // alert id -> { t, msg, sym } waiting for its bar to close
window.__stkIndAlertFires = 0;
// Same rule as price alerts (web-temp-4, Owner 2026-10-22): an alert that can't fire again shows as
// "Triggered" (Only once after its fire) or "Expired" in the list; one the member paused shows "Paused".
function stopCond(a){
  a.active = false; a.fired = true; pendClose.delete(a.id);
  indStore.update(a.id, a).catch(() => {});
  renderList();
}
function fillMsg(text, req){
  let close = '';
  try { const b = req.getBars ? req.getBars() : req.bars; close = b && b.length ? String(b[b.length - 1].close) : ''; } catch (e) {}
  const sym = (req && req.market && req.market.symbol) || '';
  return String(text || '').replace(/\{\{\s*ticker\s*\}\}/gi, symKey(sym)).replace(/\{\{\s*close\s*\}\}/gi, close).replace(/\{\{\s*interval\s*\}\}/gi, (req && req.market && req.market.timeframe) || '');
}
function fireCond(a, msg){
  if (a.expires && Date.now() > a.expires) { stopCond(a); return; }
  const text = a.message || msg || describe(a);
  window.__stkIndAlertFires++;
  if (a.popup) {
    showToast('Alert: ' + a.src.title + (a.src.any ? '' : ' \u2192 ' + a.src.cond), text + ' \u00b7 ' + a.symbol + ' \u00b7 ' + new Date().toLocaleTimeString());
    try { if (window.Notification && Notification.permission === 'granted') new Notification('TradeZoro indicator alert', { body: text, tag: 'stk-alert-' + a.id }); } catch (e) {}
  }
  if (a.sound) { let ev = 'indicator'; try { ev = window.StrykerChartSounds.classify(text); } catch (e) {} playAlertSound(ev); }
  try { window.dispatchEvent(new CustomEvent('stryker:chart-alert', { detail: { id: a.id, symbol: a.symbol, indicator: a.src.title, condition: a.src.any ? 'alert()' : a.src.cond, message: text } })); } catch (e) {}
  if (a.freq === 'once') removeFired(a);
}
function lastBarTime(req){ try { const b = req.getBars ? req.getBars() : req.bars; return b && b.length ? b[b.length - 1].time : null; } catch (e) { return null; } }
// Called by assets/chart-pine.js for every engine callback: kind 'model' (a run landed) or 'alert'.
function indEvent(ev){
  const req = ev.req || {}; const sess = ev.sess || {};
  const sym = symKey(req.market && req.market.symbol);
  if (ev.kind === 'model') {
    if (!sess.primed) { sess.primed = true; sess.primedAt = Date.now(); }
    // Once per bar close: a newer bar exists for that symbol, so the bar the condition fired on has closed.
    const lt = lastBarTime(req);
    if (lt != null) for (const [id, p] of pendClose) {
      if (p.sym !== sym || !(lt > p.t)) continue;
      pendClose.delete(id);
      const a = alerts.find((x) => x.id === id); if (!a || !a.active) continue;
      const k = id + ':' + p.t; if (firedBars.has(k)) continue; firedBars.add(k);
      fireCond(a, p.msg);
    }
    return;
  }
  if (!sess.primed) return;                                   // history load: never alert
  if (Date.now() - sess.primedAt < 1500) return;              // the first run's last-bar calls land with it: not news
  if (window.__stkReplay && window.__stkReplay.on) return;    // bar replay: alerts watch live bars only
  const al = ev.alert || {}; const title = req.prepared && req.prepared.meta && req.prepared.meta.title;
  if (!title) return;
  const fromCond = /^alertcondition/.test(String(al.id || ''));
  const t = Number(al.time) || lastBarTime(req) || 0;
  for (const a of alerts) {
    if (!a.active || !isCond(a) || a.src.title !== title || symKey(a.symbol) !== sym) continue;
    if (a.src.any ? fromCond : (!fromCond || al.title !== a.src.cond)) continue;
    if (a.expires && Date.now() > a.expires) { stopCond(a); continue; }
    const msg = fillMsg(a.message || al.message, req);
    if (a.freq === 'close') { pendClose.set(a.id, { t, msg, sym }); continue; }
    if (a.freq === 'bar') { const k = a.id + ':' + t; if (firedBars.has(k)) continue; firedBars.add(k); }
    fireCond(a, msg);
  }
}
window.__stkIndAlerts = { event: indEvent, conditionsOf: alertConditionsOf };

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
// The alert lines a chart of this symbol draws (also the test hook __stkAlerts.linesFor).
function chartLines(sym){
  return prefs.lines ? alerts.filter((a) => a.symbol === sym && (!a.src || (a.src.vs !== 'close' && !isCond(a))) && drawsOnChart(a)).map((a) => ({ price: a.price, active: a.active })) : [];
}
function pushLines(){
  if (!WS) return;
  for (const c of WS.context().cells || []) {
    const cell = cellOf(c.id); const R = inner(cell); if (!R || !R.setNativeData) continue;
    const lines = chartLines(cell.symbol);
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
    <div class="stk-al-head"><div class="stk-al-ttl"><h2 id="stk-al-h">Alerts</h2><button type="button" class="stk-al-info" aria-label="How alerts work" aria-expanded="false" aria-controls="stk-al-pop">i</button></div><button type="button" class="stk-al-x" aria-label="Close">×</button>
      <div class="stk-al-pop" id="stk-al-pop" role="note" hidden><button type="button" class="stk-al-popx" aria-label="Close info">×</button><ul><li><b>Price alerts</b> on futures and crypto are checked on our server and sent to your phone, even when Charts is closed (turn on push in Settings; on iPhone, add TradeZoro to your Home Screen first).</li><li><b>Indicator alerts</b>, forex alerts and alerts saved in this browser only work while Charts is open (no phone push). Indicators never alert on their own: pick one under Condition to get its signals.</li></ul><p>Education only. Not financial advice.</p></div></div>
    <form class="stk-al-form" hidden>
      <label>Symbol<input name="symbol" maxlength="40" required></label>
      <label class="stk-al-wide">Condition<select name="src"></select></label>
      <label class="stk-al-cw">When<select name="cond">${CONDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="stk-al-vsw" hidden>Against<select name="vs"><option value="value">Value</option><option value="close">Candle close</option></select></label>
      <label class="stk-al-pw">Price<input name="price" type="number" step="any"></label>
      <label class="stk-al-wide">Message<input name="message" maxlength="300" placeholder="Optional"></label>
      <label>Trigger<select name="freq"></select></label>
      <label class="stk-al-xw" hidden>Expiration<select name="expires"><option value="0">Open-ended</option><option value="3600000">In 1 hour</option><option value="86400000">In 1 day</option><option value="604800000">In 1 week</option><option value="2592000000">In 30 days</option></select></label>
      <div class="stk-al-wide stk-al-nw" hidden><span>Notify</span><label class="stk-al-chk"><input type="checkbox" name="popup" checked> Popup</label><label class="stk-al-chk"><input type="checkbox" name="sound" checked> Sound</label><em>Phone push: price alerts only</em></div>
      <div class="stk-al-fbtn"><button type="button" class="stk-al-cancel">Cancel</button><button type="submit" class="stk-al-save">Create</button></div>
    </form>
    <div class="stk-al-tools"><button type="button" class="stk-al-new">+ New alert</button><button type="button" class="stk-al-sounds">Sounds</button><button type="button" class="stk-al-delall" hidden>Delete all</button><span class="stk-al-count"></span></div>
    <div class="stk-al-confirm" hidden role="alertdialog" aria-modal="true" aria-labelledby="stk-al-ctl"><div class="stk-al-csheet"><p id="stk-al-ctl"></p><div class="stk-al-cbtn"><button type="button" class="stk-al-ccancel">Cancel</button><button type="button" class="stk-al-cok">Delete all</button></div></div></div>
    <div class="stk-al-list"></div>
  </div>`;
  document.body.appendChild(panel);
  panel.addEventListener('click', (e) => { if (e.target === panel) closePanel(); });
  panel.querySelector('.stk-al-x').onclick = closePanel;
  panel.querySelector('.stk-al-new').onclick = () => { const c = activeCell(); openForm({ symbol: c ? c.symbol : '', price: crossPrice() }); };
  panel.querySelector('.stk-al-sounds').onclick = () => openSoundPanel();
  const conf = panel.querySelector('.stk-al-confirm');
  panel.querySelector('.stk-al-delall').onclick = () => { if (!alerts.length) return; panel.querySelector('#stk-al-ctl').textContent = 'Delete all ' + alerts.length + ' alert' + (alerts.length === 1 ? '' : 's') + '? This can\u2019t be undone.'; conf.hidden = false; panel.querySelector('.stk-al-ccancel').focus(); };
  panel.querySelector('.stk-al-ccancel').onclick = () => { conf.hidden = true; };
  conf.addEventListener('click', (e) => { if (e.target === conf) conf.hidden = true; });
  panel.querySelector('.stk-al-cok').onclick = async () => { conf.hidden = true; await deleteAll(); };
  // (i) popover: hover or click on desktop, tap on touch; tap outside / x / Esc closes.
  const info = panel.querySelector('.stk-al-info'), pop = panel.querySelector('.stk-al-pop');
  const setPop = (on) => { pop.hidden = !on; info.setAttribute('aria-expanded', on ? 'true' : 'false'); };
  let hoverT = 0;
  let hoverAt = 0;
  info.onclick = (e) => { e.stopPropagation(); if (Date.now() - hoverAt < 700) { setPop(true); return; } setPop(pop.hidden); };   // a click right after the hover-open keeps it open
  info.addEventListener('mouseenter', (e) => { if (window.matchMedia('(hover:hover)').matches) { clearTimeout(hoverT); hoverAt = Date.now(); setPop(true); } });
  const leave = () => { if (window.matchMedia('(hover:hover)').matches) { clearTimeout(hoverT); hoverT = setTimeout(() => setPop(false), 220); } };
  info.addEventListener('mouseleave', leave); pop.addEventListener('mouseleave', leave);
  pop.addEventListener('mouseenter', () => clearTimeout(hoverT));
  panel.querySelector('.stk-al-popx').onclick = () => setPop(false);
  panel.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== info) setPop(false); });
  panel.querySelector('.stk-al-cancel').onclick = () => { panel.querySelector('.stk-al-form').hidden = true; editing = null; };
  panel.querySelector('.stk-al-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target; const base = { symbol: f.symbol.value.trim(), cond: f.cond.value, price: parseFloat(f.price.value), message: f.message.value.trim(), freq: f.freq.value, active: true };
    const so = f.src.value ? srcOpts[Number(f.src.value)] : null;
    let a;
    if (so && so.kind === 'cond') {
      const ex = f.expires.value === 'keep' ? Number(f.expires.dataset.keep) : Number(f.expires.value);
      a = cleanCond(Object.assign(base, { price: 0, popup: f.popup.checked, sound: f.sound.checked, expires: ex > 1e12 ? ex : ex > 0 ? Date.now() + ex : 0, src: { kind: 'cond', title: so.title, cond: so.cond, any: so.any } }));
    } else {
      if (so) { base.src = { title: so.title, plot: so.plot, plotTitle: so.plotTitle, vs: f.vs.value }; if (base.src.vs === 'close') base.price = 0; }
      a = so ? cleanInd(base) : clean(base);
    }
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
      try {
        if (!a.src && backend && backend.kind === 'cloud' && serverCovers(a.symbol) && !sessionStorage.getItem('stk_al_pushhint') && !(window.Notification && Notification.permission === 'granted')) {
          sessionStorage.setItem('stk_al_pushhint', '1');
          toastFn('To get this on your phone, turn on push notifications in Settings.');
        }
      } catch (e3) {}
      f.hidden = true; editing = null; pushLines(); renderList();
    } catch (err) { console.warn(err); toastFn('Could not save the alert. Check your connection and try again.'); }
  };
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape' || !panel || panel.hidden) return; const cf = panel.querySelector('.stk-al-confirm'), pp = panel.querySelector('.stk-al-pop'); if (cf && !cf.hidden) { cf.hidden = true; return; } if (pp && !pp.hidden) { pp.hidden = true; panel.querySelector('.stk-al-info').setAttribute('aria-expanded', 'false'); return; } closePanel(); });
  const f = panel.querySelector('.stk-al-form');
  f.src.onchange = () => syncSrc(f);
  f.vs.onchange = () => syncSrc(f);
  f.message.oninput = () => { f.dataset.prefill = ''; };
}
// Condition list (TradingView-style): "Price", then per indicator on the active chart its
// alertcondition() titles ("Volume Bubbles → Big Cluster") and "Any alert() function call" when the
// script calls alert(), then its plots (crossing a value / the candle close). When editing an alert
// whose indicator isn't on this chart, its own entry is added so nothing is lost.
let srcOpts = [];
function fillSrc(f, a){
  const cell = activeCell(); const R = inner(cell);
  srcOpts = [];
  const groups = [];
  const conds = cell ? chartIndicatorConds(cell) : [];
  const seenT = new Set();
  for (const ind of conds) {
    if (seenT.has(ind.title)) continue; seenT.add(ind.title);
    const g = { label: ind.title, items: [] };
    for (const c of ind.conds) g.items.push({ kind: 'cond', title: ind.title, cond: c.title, message: c.message, any: false });
    if (ind.hasAlertCall) g.items.push({ kind: 'cond', title: ind.title, cond: '', message: '', any: true });
    groups.push(g);
  }
  for (const ind of (R ? chartPlots(R) : [])) {
    let g = groups.find((x) => x.label === ind.title); if (!g) { g = { label: ind.title, items: [] }; groups.push(g); }
    for (const pl of ind.plots) g.items.push({ kind: 'plot', title: ind.title, plot: pl.index, plotTitle: ind.plots.length > 1 ? pl.title : '' });
  }
  const same = (o) => a && a.src && (isCond(a) ? (o.kind === 'cond' && o.title === a.src.title && o.any === !!a.src.any && (a.src.any || o.cond === a.src.cond)) : (o.kind === 'plot' && o.title === a.src.title && o.plot === a.src.plot));
  if (a && a.src && a.src.title && !a.src.pick && !groups.some((g) => g.items.some(same))) {
    groups.push({ label: a.src.title + ' (not on this chart)', items: [isCond(a) ? { kind: 'cond', title: a.src.title, cond: a.src.cond, any: !!a.src.any, message: '' } : { kind: 'plot', title: a.src.title, plot: a.src.plot, plotTitle: a.src.plotTitle || '' }] });
  }
  f.src.textContent = '';
  const o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Price'; f.src.appendChild(o0);
  for (const g of groups) {
    const og = document.createElement('optgroup'); og.label = g.label;
    for (const o of g.items) {
      const op = document.createElement('option'); op.value = String(srcOpts.length); srcOpts.push(o);
      op.textContent = o.kind === 'cond' ? (o.title + ' \u2192 ' + (o.any ? 'Any alert() function call' : o.cond)) : (o.title + (o.plotTitle ? ' \u00b7 ' + o.plotTitle : '') + ' (value)');
      og.appendChild(op);
    }
    f.src.appendChild(og);
  }
  let idx = a && a.src ? srcOpts.findIndex(same) : -1;
  if (idx < 0 && a && a.src && a.src.kind === 'cond' && a.src.pick) idx = srcOpts.findIndex((o) => o.kind === 'cond' && o.title === a.src.title);
  if (idx < 0 && a && a.src && a.src.pick) idx = srcOpts.findIndex((o) => o.title === a.src.title);
  f.src.value = idx >= 0 ? String(idx) : '';
  f.vs.value = a && a.src && a.src.vs === 'close' ? 'close' : 'value';
  f.dataset.prefill = '';
  syncSrc(f, a);
}
function setFreqs(f, cond, val){
  const list = cond ? CFREQ : [['once', 'Only once'], ['every', 'Every time']];
  if (f.freq.dataset.mode !== (cond ? 'c' : 'p')) {
    f.freq.textContent = '';
    for (const [v, l] of list) { const o = document.createElement('option'); o.value = v; o.textContent = l; f.freq.appendChild(o); }
    f.freq.dataset.mode = cond ? 'c' : 'p';
    f.freq.value = val && list.some((x) => x[0] === val) ? val : (cond ? 'bar' : 'once');
    return;
  }
  if (val && list.some((x) => x[0] === val)) f.freq.value = val;
}
function syncSrc(f, a){
  const so = f.src.value ? srcOpts[Number(f.src.value)] : null;
  const cond = !!(so && so.kind === 'cond');
  const ind = !!so && !cond;
  f.querySelector('.stk-al-vsw').hidden = !ind;
  f.querySelector('.stk-al-cw').hidden = cond;
  f.querySelector('.stk-al-xw').hidden = !cond;
  f.querySelector('.stk-al-nw').hidden = !cond;
  const needPrice = !cond && (!ind || f.vs.value !== 'close');
  f.querySelector('.stk-al-pw').hidden = !needPrice;
  f.price.required = needPrice;
  setFreqs(f, cond, a ? a.freq : null);
  // Message prefilled from the script's alertcondition() message, unless the member typed their own.
  if (cond) {
    const cur = f.message.value;
    if (!cur || cur === f.dataset.prefill) { f.message.value = so.message || ''; f.dataset.prefill = so.message || ''; }
  } else if (f.message.value && f.message.value === f.dataset.prefill) { f.message.value = ''; f.dataset.prefill = ''; }
}
function openForm(a){
  const f = panel.querySelector('.stk-al-form'); f.hidden = false;
  f.symbol.value = a.symbol || ''; f.cond.value = a.cond || 'crossing'; f.price.value = fmt(Number(a.price));
  f.message.value = a.message || '';
  const cond = isCond(a) || (a.src && a.src.kind === 'cond');
  f.popup.checked = !(cond && a.popup === false); f.sound.checked = !(cond && a.sound === false);
  const keep = f.expires.querySelector('option[value=keep]'); if (keep) keep.remove();
  if (a.expires) { const o = document.createElement('option'); o.value = 'keep'; o.textContent = 'Until ' + new Date(a.expires).toLocaleString(); f.expires.appendChild(o); f.expires.dataset.keep = String(a.expires); f.expires.value = 'keep'; }
  else f.expires.value = '0';
  f.freq.dataset.mode = '';
  fillSrc(f, a);
  if (a.src && a.src.vs === 'close') f.price.value = '';
  editing = a.id || null;
  f.querySelector('.stk-al-save').textContent = editing ? 'Save' : 'Create';
  try { (f.price.required ? f.price : f.src).focus(); } catch (e) {}
}
function renderList(){
  if (!panel) return;
  const list = panel.querySelector('.stk-al-list'); list.textContent = '';
  panel.querySelector('.stk-al-delall').hidden = !alerts.length;
  panel.querySelector('.stk-al-count').textContent = alerts.length + ' / ' + MAX_ALERTS + (backend && backend.kind === 'local' ? ' · saved in this browser (sign in to keep them in your account)' : '');
  if (!alerts.length) { const p = document.createElement('p'); p.className = 'stk-al-empty'; p.textContent = 'No alerts yet.'; list.appendChild(p); return; }
  for (const a of alerts) {
    const row = document.createElement('div'); row.className = 'stk-al-row' + (a.active ? '' : ' off');
    row.innerHTML = '<div class="stk-al-txt"><b></b><span></span></div><button type="button" data-k="pause"></button><button type="button" data-k="edit">Edit</button><button type="button" data-k="del" aria-label="Delete alert">Delete</button>';
    row.querySelector('b').textContent = isCond(a) ? (a.symbol + ' \u00b7 ' + a.src.title + ' \u2192 ' + (a.src.any ? 'Any alert() function call' : a.src.cond)) : a.src ? (a.symbol + ' · ' + a.src.title + (a.src.plotTitle ? ' (' + a.src.plotTitle + ')' : '') + ' ' + CONDL[a.cond] + ' ' + (a.src.vs === 'close' ? 'candle close' : fmt(a.price))) : (a.symbol + ' · ' + CONDL[a.cond] + ' ' + fmt(a.price));
    const paused = !a.active && (isCond(a) ? !a.fired && !(a.expires && Date.now() > a.expires) : pausedIds().has(a.id));
    if (isCond(a)) row.querySelector('span').textContent = (a.message ? a.message + ' \u00b7 ' : '') + CFREQL[a.freq] + (a.expires ? ' \u00b7 until ' + new Date(a.expires).toLocaleString() : '') + (a.popup ? '' : ' \u00b7 no popup') + (a.sound ? '' : ' \u00b7 no sound') + (a.active ? '' : (a.expires && Date.now() > a.expires ? ' \u00b7 Expired' : a.fired ? ' \u00b7 Triggered' : ' \u00b7 Paused')) + ' \u00b7 needs Charts open';
    else row.querySelector('span').textContent = (a.active ? '' : paused ? 'Paused · ' : 'Triggered · ') + (a.message ? a.message + ' · ' : '') + (a.freq === 'every' ? 'Every time' : 'Only once') + (a.src ? ' · needs Charts open' : (backend && backend.kind === 'cloud' && serverCovers(a.symbol) ? ' · phone push' : ' · needs Charts open'));
    row.querySelector('[data-k=pause]').textContent = a.active ? 'Pause' : paused ? 'Resume' : 'Restart';
    row.querySelector('[data-k=pause]').onclick = async () => { a.active = !a.active; markPaused(a.id, !a.active); armed.delete(a.id); pendClose.delete(a.id); if (isCond(a)) a.fired = false; if (a.active && isCond(a) && a.expires && Date.now() > a.expires) a.expires = 0; try { await storeOf(a).update(a.id, a); } catch (e) { toastFn('Could not update the alert.'); } pushLines(); renderList(); };
    row.querySelector('[data-k=edit]').onclick = () => openForm(a);
    row.querySelector('[data-k=del]').onclick = async () => { pendClose.delete(a.id); try { await storeOf(a).remove(a.id); alerts = alerts.filter((x) => x !== a); } catch (e) { toastFn('Could not delete the alert.'); } pushLines(); renderList(); };
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
.stk-al-head{ position:relative; }
.stk-al-ttl{ display:flex; align-items:center; gap:8px; min-width:0; }
.stk-al-box .stk-al-info{ width:24px; height:24px; min-width:24px; padding:0; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font:italic 700 13px/1 Georgia,serif; background:transparent; border-color:rgba(238,238,238,.4); color:rgba(238,238,238,.85); }
:root[data-theme="light"] .stk-al-box .stk-al-info{ border-color:rgba(19,19,22,.4); color:rgba(19,19,22,.8); }
.stk-al-box .stk-al-info[aria-expanded="true"]{ background:#03c988; border-color:#03c988; color:#07110d; }
.stk-al-pop{ position:absolute; z-index:5; top:calc(100% + 8px); left:0; width:min(380px,100%); box-sizing:border-box; padding:12px 34px 12px 14px; background:#131316; color:#eeeeee; border:1px solid rgba(3,201,136,.4); border-radius:12px; box-shadow:0 14px 40px rgba(0,0,0,.55); font:14px/1.45 Archivo,system-ui,sans-serif; }
:root[data-theme="light"] .stk-al-pop{ background:#fff; color:#131316; box-shadow:0 14px 40px rgba(0,0,0,.22); }
.stk-al-pop[hidden]{ display:none; }
.stk-al-pop ul{ margin:0; padding-left:18px; display:flex; flex-direction:column; gap:8px; }
.stk-al-pop p{ margin:8px 0 0; font-size:12.5px; opacity:.7; }
.stk-al-box .stk-al-popx{ position:absolute; top:4px; right:4px; width:30px; height:30px; padding:0; border:0; background:none; font-size:20px; line-height:1; border-radius:50%; }
.stk-al-box .stk-al-delall{ background:transparent; border-color:rgba(255,92,92,.6); color:#ff6b6b; font-weight:600; }
.stk-al-box .stk-al-delall:hover{ background:rgba(255,92,92,.14); border-color:#ff6b6b; }
:root[data-theme="light"] .stk-al-box .stk-al-delall{ color:#c62828; border-color:rgba(198,40,40,.55); }
.stk-al-box{ position:relative; }
.stk-al-confirm{ position:absolute; inset:0; z-index:8; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(0,0,0,.6); border-radius:inherit; }
.stk-al-confirm[hidden]{ display:none; }
.stk-al-csheet{ width:min(340px,100%); background:#131316; color:#eeeeee; border:1px solid rgba(238,238,238,.14); border-radius:14px; padding:18px; box-shadow:0 18px 50px rgba(0,0,0,.6); }
:root[data-theme="light"] .stk-al-csheet{ background:#fff; color:#131316; }
.stk-al-csheet p{ margin:0 0 14px; font-size:15px; font-weight:600; }
.stk-al-cbtn{ display:flex; justify-content:flex-end; gap:8px; }
.stk-al-box .stk-al-cbtn button{ min-height:44px; padding:8px 18px; }
.stk-al-box .stk-al-cok{ background:#e5484d; border-color:#e5484d; color:#fff; font-weight:700; }
.stk-al-box .stk-al-cok:hover{ background:#f05a5f; }
.stk-al-x{ background:none; border:0; color:inherit; font-size:22px; cursor:pointer; }
.stk-al-note{ margin:6px 0 12px; font-size:12.5px; color:rgba(238,238,238,.68); }
:root[data-theme="light"] .stk-al-note{ color:rgba(19,19,22,.68); }
.stk-al-form{ display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px; }
.stk-al-form[hidden],.stk-al-form label[hidden]{ display:none; }
.stk-al-form label{ display:flex; flex-direction:column; gap:4px; font-size:12px; opacity:.9; }
.stk-al-form .stk-al-wide{ grid-column:1/-1; }
.stk-al-form optgroup{ color:#131316; font-style:normal; font-weight:700; }
.stk-al-nw{ display:flex; align-items:center; flex-wrap:wrap; gap:8px 16px; font-size:12px; }
.stk-al-nw[hidden]{ display:none; }
.stk-al-nw > span{ opacity:.9; }
.stk-al-nw em{ font-style:normal; opacity:.6; font-size:11.5px; }
.stk-al-form .stk-al-chk{ flex-direction:row; align-items:center; gap:7px; font-size:13px; cursor:pointer; opacity:1; }
.stk-al-chk input{ appearance:none; -webkit-appearance:none; width:18px; height:18px; margin:0; padding:0 !important; border-radius:6px !important; border:1px solid rgba(3,201,136,.45) !important; background:transparent !important; display:inline-grid; place-content:center; cursor:pointer; }
.stk-al-chk input:checked{ background:#03c988 !important; border-color:#03c988 !important; }
.stk-al-chk input:checked::after{ content:''; width:9px; height:5px; border:2px solid #07110d; border-top:0; border-right:0; transform:translateY(-1px) rotate(-45deg); }
.stk-al-chk input:focus-visible{ outline:2px solid rgba(3,201,136,.6); outline-offset:2px; }
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
@media (max-width:600px){
  .stk-al-txt{ flex:1 1 100%; }
  .stk-al-txt span{ white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; font-size:13px; }
  .stk-al-row{ gap:8px; padding:10px 0; }
  .stk-al-row button{ min-height:44px; min-width:44px; }
  .stk-al-tools button{ min-height:44px; }
  .stk-al-pop{ width:100%; }
  .stk-al-box .stk-al-info{ width:32px; height:32px; }
  .stk-al-box .stk-al-popx{ width:44px; height:44px; top:0; right:0; }
}
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

// "Add alert…" on each Pine indicator: a bell on its legend row (Vela's legend-actions hook, same look
// as the eye / cog) and a button in its settings window footer. Both open the Create alert form with
// that indicator's first alert condition preselected (its first plot when it has no alertcondition).
const nativeOf = (chart) => { const r = chart && chart.renderer; if (r && r.inputsUI) return r; if (r && r.renderer && r.renderer.inputsUI) return r.renderer; return null; };
function recOf(cell, id){ try { return cell.chart.orchestrator.registry.get(id); } catch (e) { return null; } }
export function addAlertFor(cell, id){
  const rec = recOf(cell, id); if (!rec) return false;
  try { if (WS && WS.active && WS.active.id !== cell.id && WS.setActiveCell) WS.setActiveCell(cell.id); } catch (e) {}
  const title = (rec.prepared && rec.prepared.meta && rec.prepared.meta.title) || rec.title;
  openAlerts({ symbol: cell.symbol, src: { kind: 'cond', title, pick: true } });
  return true;
}
function wireIndicatorEntries(){
  if (!WS) return;
  let cells = []; try { cells = WS.context().cells || []; } catch (e) {}
  for (const c of cells) {
    const cell = cellOf(c.id); const n = nativeOf(cell && cell.chart);
    if (!n || n.__stkAlertLegend) continue;
    try {
      n.setLegendActions((id) => { const r = recOf(cell, id); return r && !r.native && r.source ? [{ id: 'stk-add-alert', icon: 'bell', tooltip: 'Add alert\u2026', run: () => addAlertFor(cell, id) }] : []; });
      n.__stkAlertLegend = true;
    } catch (e) { console.warn('TradeZoro alerts: legend action', e); }
  }
}
function wireSettingsAlert(){
  if (wireSettingsAlert.done) return; wireSettingsAlert.done = true;
  const scan = () => {
    for (const dlg of document.querySelectorAll('.vela-ind-dialog')) {
      if (dlg.querySelector('.stk-al-dlgbtn')) continue;
      const foot = dlg.querySelector('.vela-dialog-footer'); if (!foot) continue;
      let cells = []; try { cells = WS.context().cells || []; } catch (e) {}
      let hit = null;
      for (const c of cells) { const cell = cellOf(c.id); const n = nativeOf(cell && cell.chart); const oid = n && n.inputsUI && n.inputsUI.inputsDialog && n.inputsUI.inputsDialog.openId; if (oid != null) { const r = recOf(cell, oid); if (r && !r.native && r.source) { hit = { cell, id: oid, n }; break; } } }
      if (!hit) continue;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'vela-dialog-btn stk-al-dlgbtn'; b.textContent = 'Add alert\u2026';
      b.onclick = () => { try { hit.n.inputsUI.inputsDialog.close(); } catch (e) {} addAlertFor(hit.cell, hit.id); };
      const reset = foot.firstElementChild;
      if (reset && reset.nextSibling) foot.insertBefore(b, reset.nextSibling); else foot.appendChild(b);
    }
  };
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
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
  try { ws.on('state:changed', () => setTimeout(() => { pushLines(); wireIndicatorEntries(); }, 0)); } catch (e) {}
  try { ws.on('layout:changed', () => setTimeout(wireIndicatorEntries, 0)); } catch (e) {}
  wireIndicatorEntries(); wireSettingsAlert();
  try { fb().auth().onAuthStateChanged(() => reload()); } catch (e) { reload(); }
  // Another tab fired / restarted a browser-stored alert: follow it here (lines + list).
  window.addEventListener('storage', (e) => { if (e.key === IND_KEY || e.key === 'stryker_chart_alerts_guest') reload(); });
  setInterval(poll, 1000);
  setInterval(() => { pushLines(); wireIndicatorEntries(); }, 5000);   // new cells / symbol switches pick up their lines
  window.__stkAlerts = { tick, poll, cleanupFired, deleteAll, removeFired, open: openAlerts, openSounds: openSoundPanel, add: addAlert, sound: playAlertSound, indicatorAlert: (message, meta) => window.StrykerChartSounds && window.StrykerChartSounds.indicatorAlert(message, meta), simEvent: (kind, detail) => window.StrykerChartSounds && window.StrykerChartSounds.simEvent(kind, detail), get alerts(){ return alerts; }, get prefs(){ return prefs; }, reload, pushLines, addAlertFor, conditionsOf: alertConditionsOf, chartIndicatorConds, linesFor: (sym) => chartLines(sym).map((l) => l.price) };
}
