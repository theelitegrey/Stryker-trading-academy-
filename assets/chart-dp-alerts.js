// TradeZoro — Dark pool print alerts (ES module, charts.html). Owner order 2026-11-07: "if I trade futures and set an alert for a dark pool
// print on TSLA, will it fire when I'm not on the TSLA chart?" -> yes.
// WHAT: a member picks a covered stock / ETF (the 29 of assets/chart-darkpool.js DP_SYMS), a smallest print size ($1M / $5M / $10M / $25M /
// custom), an optional price zone and Only once / Every time. Stored in Firestore students/{uid}/dpAlerts (owner-only rules,
// functions-src/firestore.rules). Checked on OUR SERVER (workers/alert-engine/dp_alerts.py) after every dark pool update, so it works with
// no chart open: the bell + the phone push (onNotificationCreated). Free for everyone (signed in: the alert lives in the account).
// Set INSIDE the Dark Pool Prints indicator (its settings, "Alerts" section; assets/chart-darkpool.js calls sync() below); the Alerts window lists them (dpRows).
// One doc per symbol, id 'ind-<SYM>' (shortcut: two Dark Pool Prints on the same symbol share it, last edit wins).
// Wording: "Dark pool print" alerts, never live / real-time; no vendor names. Education only. Not financial advice.
// Depends on: firebase compat (auth + firestore), assets/chart-darkpool.js (DP_SYMS, SIZES, usd), toast.js (showToast).
import { DP_SYMS, SIZES, usd, sizeUsd } from './chart-darkpool.js?v=911';

export const MAX_DP_ALERTS = 20;
// Truth: dp-feeder.timer runs every 2 hours on weekdays. One line to change if the feeder schedule changes (workers/alert-engine/dp_alerts.py UPDATE_NOTE too).
export const UPDATE_NOTE = 'Prints update about every 2 hours on weekdays';
const fb = () => window.firebase;
const user = () => { try { return fb() && fb().auth().currentUser; } catch (e) { return null; } };
const col = () => { const u = user(); return u ? fb().firestore().collection('students').doc(u.uid).collection('dpAlerts') : null; };
const toast = (m, t) => { try { if (window.showToast) window.showToast(t || 'info', m); } catch (e) {} };
const fmtP = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- pure ----------------------------------------------------------------------------------------
// form values -> the Firestore shape (without timestamps), or { error }
export function buildAlert(v) {
  const symbol = String(v.symbol || '').toUpperCase();
  if (!DP_SYMS.includes(symbol)) return { error: 'Pick one of the covered stocks or ETFs.' };
  const min = Math.round(Number(v.min));
  if (!isNum(min) || min < 1e6) return { error: 'The smallest size is $1M.' };
  if (min > 1e11) return { error: 'That size is too large.' };
  const a = { symbol, min, freq: v.freq === 'once' ? 'once' : 'every', active: true };
  if (v.zone) {
    let lo = Number(v.lo), hi = Number(v.hi);
    if (!isNum(lo) || !isNum(hi) || lo <= 0 || hi <= 0) return { error: 'Enter both prices of the zone.' };
    if (lo > hi) [lo, hi] = [hi, lo];
    a.lo = lo; a.hi = hi;
  }
  return a;
}
const shortTitle = (a) => a.symbol + ' ≥ ' + usd(a.min) + (isNum(a.lo) && isNum(a.hi) ? ' · ' + fmtP(a.lo) + ' to ' + fmtP(a.hi) : '');
export function alertTitle(a) {
  return a.symbol + ' · dark pool print ≥ ' + usd(a.min) + (isNum(a.lo) && isNum(a.hi) ? ' · ' + fmtP(a.lo) + ' to ' + fmtP(a.hi) : '');
}
const clean = (id, d) => ({ id, symbol: String(d.symbol || ''), min: Number(d.min) || 1e6, lo: isNum(d.lo) ? d.lo : null, hi: isNum(d.hi) ? d.hi : null, freq: d.freq === 'once' ? 'once' : 'every', active: d.active !== false });

// ---- store ----------------------------------------------------------------------------------------
let list = [], loaded = false;
const subs = new Set();
const changed = () => subs.forEach((f) => { try { f(); } catch (e) {} });
export const onChange = (f) => { subs.add(f); return () => subs.delete(f); };
export const dpAlerts = () => list;
export async function reload() {
  const c = col();
  if (!c) { list = []; loaded = true; changed(); return list; }
  try { list = (await c.get()).docs.map((d) => clean(d.id, d.data())); loaded = true; } catch (e) { console.warn('TradeZoro dark pool alerts: load', e && e.code); }
  changed();
  return list;
}
const ref = (c, id) => c.doc(id);
const idFor = (sym) => 'ind-' + sym;
export const forSymbol = (sym) => list.find((x) => x.symbol === sym) || null;
const same = (x, a) => x && x.min === a.min && x.freq === a.freq && x.active && (x.lo || null) === (a.lo || null) && (x.hi || null) === (a.hi || null);
// create / update the one alert of a symbol (idempotent: nothing is written when it already matches, so a page load never re-arms it)
async function upsert(a) {
  const c = col(); if (!c) return null;
  if (!loaded) await reload();
  const old = forSymbol(a.symbol);
  if (same(old, a)) return old.id;
  const F = fb().firestore.FieldValue, ts = F.serverTimestamp();
  if (old) {
    const d = { min: a.min, freq: a.freq, active: true, updatedAt: ts, lo: a.lo == null ? F.delete() : a.lo, hi: a.hi == null ? F.delete() : a.hi };
    await ref(c, old.id).update(d);
    list = list.map((x) => (x.id === old.id ? clean(old.id, a) : x));
  } else {
    if (list.length >= MAX_DP_ALERTS) throw Object.assign(new Error('full'), { full: true });
    const d = { symbol: a.symbol, min: a.min, freq: a.freq, active: true, createdAt: ts, updatedAt: ts };
    if (a.lo != null) { d.lo = a.lo; d.hi = a.hi; }
    await ref(c, idFor(a.symbol)).set(d);
    list = list.concat([clean(idFor(a.symbol), a)]);
  }
  changed();
  return idFor(a.symbol);
}
export async function removeAlert(a) {
  const c = col(); if (!c || !a) return false;
  await ref(c, a.id).delete();
  list = list.filter((x) => x.id !== a.id); changed();
  return true;
}
// the indicator calls this (debounced, one chain so writes never overlap). spec: { symbol, on, min, zone, lo, hi, freq }
// returns 'on' | 'off' | 'signin' | 'full' | 'error'
let chain = Promise.resolve();
const owned = new Map();   // indicator instance -> the symbol its alert is on (a chart symbol change moves the doc)
export function syncAlert(spec) {
  const run = async () => {
    if (!user()) return 'signin';
    try {
      if (!loaded) await reload();
      const prev = owned.get(spec.key);
      if (prev && prev !== spec.symbol) { const o = forSymbol(prev); if (o && ![...owned].some(([k, v]) => k !== spec.key && v === prev)) await removeAlert(o); }
      if (spec.on) owned.set(spec.key, spec.symbol); else owned.delete(spec.key);
      const old = forSymbol(spec.symbol);
      if (!spec.on || !DP_SYMS.includes(spec.symbol)) { if (old) await removeAlert(old); return 'off'; }
      const a = buildAlert({ symbol: spec.symbol, min: spec.min, freq: spec.freq, zone: spec.zone, lo: spec.lo, hi: spec.hi });
      if (a.error) return 'error';
      await upsert(a); return 'on';
    } catch (e) { if (e && e.full) { toast('You have ' + MAX_DP_ALERTS + ' dark pool alerts, the most we keep. Delete one in the Alerts window.', 'error'); return 'full'; } console.warn('TradeZoro dark pool alerts: sync', e); return 'error'; }
  };
  chain = chain.then(run, run);
  return chain;
}
export function dropForIndicator(key, sym) {
  const run = async () => { if (!user()) return; try { owned.delete(key); if (!loaded) await reload(); const old = forSymbol(owned.get(key) || sym); if (old && await removeAlert(old)) toast('Dark pool alert removed', 'info'); } catch (e) { console.warn('TradeZoro dark pool alerts: remove', e); } };
  chain = chain.then(run, run);
  return chain;
}
// live indicator instances (chart-darkpool.js): re-sync when the member signs in
export const instances = new Set();   // live Dark Pool Prints instances (chart-darkpool.js); re-synced when the member signs in
export const isSignedIn = () => !!user();
export const effMin = (filterUsd, choice, customM) => {
  const c = choice === 'Custom' ? Math.round(Number(customM) * 1e6) : /^\$\d+M$/.test(choice) ? sizeUsd(choice) : 0;
  return Math.max(filterUsd, Number.isFinite(c) ? c : 0);
};
// ---- rows (the dialog list and the Alerts window share them) ----------------------------------------
// host: an element; cls: the row classes of the caller (the Alerts window passes its own stk-al-row so the rows match)
export function dpRows(host, opts) {
  const o = Object.assign({ rowClass: 'stk-al-row', after: () => {}, edit: null }, opts);
  for (const a of list) {
    const row = document.createElement('div'); row.className = o.rowClass;
    row.innerHTML = '<div class="stk-al-txt"><b></b><span></span></div><button type="button" data-k="edit">Edit</button><button type="button" data-k="del">Delete</button>';
    row.querySelector('b').textContent = shortTitle(a);
    row.querySelector('span').textContent = 'Dark Pool Prints indicator · ' + (a.freq === 'once' ? 'Only once' : 'Every time') + ' · phone push';
    const eb = row.querySelector('[data-k=edit]'), can = !!(o.edit && o.edit(a, true));
    eb.hidden = !can; eb.setAttribute('aria-label', 'Edit ' + alertTitle(a) + ' in the indicator settings');
    eb.onclick = () => { if (o.edit) o.edit(a, false); };
    row.querySelector('[data-k=del]').setAttribute('aria-label', 'Delete ' + alertTitle(a));
    row.querySelector('[data-k=del]').onclick = async () => { try { await removeAlert(a); } catch (e) { toast('Could not delete the alert.', 'error'); } o.after(); };
    host.appendChild(row);
  }
}
// ---- the note inside the indicator's settings window ("Alerts" section) -------------------------------------
// Vela builds the inputs; this adds the text it cannot: which symbol the alert is for, its state, the update note, Sign in.
const nativeOf = (chart) => { const r = chart && chart.renderer; if (r && r.inputsUI) return r; if (r && r.renderer && r.renderer.inputsUI) return r.renderer; return null; };
export function openInstance(ws) {   // the instance whose settings window is open, or null
  for (const c of (ws.context().cells || [])) {
    let cell = null; try { cell = ws.cell(c.id); } catch (e) {}
    const n = nativeOf(cell && cell.chart), id = n && n.inputsUI && n.inputsUI.inputsDialog && n.inputsUI.inputsDialog.openId;
    if (id == null) continue;
    for (const i of instances) if (i.id === id && i.chart === cell.chart) return i;
  }
  return null;
}
const dpHandle = (cell) => { try { return cell.chart.indicators().find((h) => h.nativeType === 'stk_darkpool') || null; } catch (e) { return null; } };
const activeCellOf = (ws) => { try { return ws.cell(ws.active.id); } catch (e) { return null; } };
// open the settings window of the Dark Pool Prints on the active chart, at its Alerts section. add: put the indicator on the chart first.
export function openIndicatorAlerts(ws, add) {
  const cell = activeCellOf(ws); if (!cell) return false;
  let h = dpHandle(cell);
  if (!h) { if (!add) return false; try { cell.chart.addNativeIndicator('stk_darkpool', { inputs: { alertOn: true } }); ws.context().stateChanged(); } catch (e) { return false; } h = dpHandle(cell); if (!h) return false; }
  const n = nativeOf(cell.chart); if (!n || !n.inputsUI) return false;
  try { n.inputsUI.openDialog(h.id); } catch (e) { return false; }
  setTimeout(() => { const hd = [...document.querySelectorAll('.vela-ind-dialog *')].find((x) => x.children.length === 0 && (x.textContent || '').trim() === 'Alerts'); if (hd && hd.scrollIntoView) hd.scrollIntoView({ block: 'start' }); }, 250);
  return true;
}
// Alerts window: Edit is offered when the active chart shows that symbol's prints with the indicator on it
export function editInIndicator(ws, a, probe) {
  const cell = activeCellOf(ws); if (!cell || !dpHandle(cell)) return false;
  const i = [...instances].find((x) => x.chart === cell.chart);
  if (!i || i.sym() !== a.symbol) return false;
  return probe ? true : openIndicatorAlerts(ws, false);
}
function noteText(inst) {
  const sym = inst.sym(), raw = inst.ctx && inst.ctx.symbol, I = inst.inputs;
  if (!sym) return { head: 'Alerts', lines: ['Dark pool prints are not covered for this chart symbol, so there is nothing to alert on.'] };
  const fut = inst.fut && inst.fut();
  const lines = [];
  const a = forSymbol(sym);
  if (!user()) lines.push('signin');
  else if (a && I.alertOn) lines.push('Alert on · ≥ ' + usd(a.min) + (isNum(a.lo) ? ' · ' + fmtP(a.lo) + ' to ' + fmtP(a.hi) : '') + ' · ' + (a.freq === 'once' ? 'only once' : 'every time'));
  else lines.push(I.alertOn ? 'Setting up…' : 'Alert off');
  if (I.alertOn && I.alertZone === true && !(Number(I.alertLo) > 0 && Number(I.alertHi) > 0)) lines.push('Enter both prices of the zone, or turn the zone off.');
  lines.push('Works with the chart closed. ' + UPDATE_NOTE + '.');
  return { head: 'Alerts for ' + sym + ' prints' + (fut ? ' (' + fut + ' chart)' : ''), lines };
}
export function installDialogNote(ws) {
  if (installDialogNote.done) return; installDialogNote.done = true;
  let timer = 0;
  const paint = () => {
    const dlg = document.querySelector('.vela-ind-dialog');
    const inst = dlg && openInstance(ws);
    if (!inst) { if (!dlg) { clearInterval(timer); timer = 0; } return; }
    const hd = [...dlg.querySelectorAll('*')].find((n) => n.children.length === 0 && (n.textContent || '').trim() === 'Alerts');
    if (!hd) return;
    const host = hd.parentNode;   // the section's grid cell; the note goes after its last control
    let box = host.querySelector('.stkdpa-inote');
    if (!box) { box = document.createElement('div'); box.className = 'stkdpa-inote'; }
    const last = [...host.children].filter((n) => n !== box).pop();
    if (last && box.previousElementSibling !== last) host.insertBefore(box, null);
    else if (!box.parentNode) host.appendChild(box);
    const t = noteText(inst), sig = JSON.stringify(t) + user();
    if (box.__sig === sig) return; box.__sig = sig;
    box.textContent = '';
    const h = document.createElement('p'); h.className = 'stkdpa-ih'; h.textContent = t.head; box.appendChild(h);
    for (const l of t.lines) {
      const p = document.createElement('p'); p.className = 'stkdpa-il';
      if (l === 'signin') { const a = document.createElement('a'); a.href = 'login.html?next=' + encodeURIComponent('/charts.html'); a.textContent = 'Sign in to get alerts'; p.appendChild(a); } else p.textContent = l;
      box.appendChild(p);
    }
  };
  const go = () => { if (!timer && document.querySelector('.vela-ind-dialog')) timer = setInterval(paint, 400); paint(); };
  new MutationObserver(go).observe(document.body, { childList: true, subtree: true });
  onChange(paint);
}
const NOTE_CSS = `.stkdpa-inote{ grid-column:1 / -1; padding:12px 0 4px; font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; }
.stkdpa-inote p{ margin:0; }
.stkdpa-ih{ font-size:14px; line-height:20px; font-weight:600; color:var(--vela-fg-bright, #f2f2f4); }
.stkdpa-il{ font-size:12px; line-height:16px; color:var(--vela-fg-muted, #9a9aa3); padding-top:4px; }
.stkdpa-il a{ color:#03c988; font-weight:600; font-size:13px; line-height:20px; text-decoration:underline; }
:root[data-theme="light"] .stkdpa-il a{ color:#047857; }
.stkdpa-il a:focus-visible{ outline:2px solid #03c988; outline-offset:2px; border-radius:4px; }
`;
if (typeof document !== 'undefined' && !document.getElementById('stkdpa-icss')) { const st = document.createElement('style'); st.id = 'stkdpa-icss'; st.textContent = NOTE_CSS; document.head.appendChild(st); }
try { const a = fb() && fb().auth && fb().auth(); if (a && a.onAuthStateChanged) a.onAuthStateChanged(() => { loaded = false; reload().then(() => instances.forEach((i) => { try { i.syncAlert(); } catch (e) {} })); }); } catch (e) {}
window.__stkDpAlerts = { reload, get list() { return list; }, sync: syncAlert };
