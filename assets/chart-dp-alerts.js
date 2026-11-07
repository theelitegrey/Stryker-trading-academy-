// TradeZoro — Dark pool print alerts (ES module, charts.html). Owner order 2026-11-07: "if I trade futures and set an alert for a dark pool
// print on TSLA, will it fire when I'm not on the TSLA chart?" -> yes.
// WHAT: a member picks a covered stock / ETF (the 29 of assets/chart-darkpool.js DP_SYMS), a smallest print size ($1M / $5M / $10M / $25M /
// custom), an optional price zone and Only once / Every time. Stored in Firestore students/{uid}/dpAlerts (owner-only rules,
// functions-src/firestore.rules). Checked on OUR SERVER (workers/alert-engine/dp_alerts.py) after every dark pool update, so it works with
// no chart open: the bell + the phone push (onNotificationCreated). Free for everyone (signed in: the alert lives in the account).
// Opened from the Dark pool list ("Alert me") and from the Alerts window ("+ Dark pool alert"); rows also listed there (dpRows).
// Wording: "Dark pool print" alerts, never live / real-time; no vendor names. Education only. Not financial advice.
// Depends on: firebase compat (auth + firestore), assets/chart-darkpool.js (DP_SYMS, SIZES, usd), toast.js (showToast).
import { DP_SYMS, SIZES, usd, targetOf } from './chart-darkpool.js?v=907';

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
export async function create(a) {
  const c = col(); if (!c) throw Object.assign(new Error('signed out'), { signin: true });
  if (!loaded) await reload();
  if (list.length >= MAX_DP_ALERTS) throw Object.assign(new Error('full'), { full: true });
  const ts = fb().firestore.FieldValue.serverTimestamp();
  const ref = c.doc();
  await ref.set(Object.assign({}, a, { createdAt: ts, updatedAt: ts }));
  list = list.concat([clean(ref.id, a)]); changed();
  return ref.id;
}
export async function remove(id) {
  const c = col(); if (!c) return;
  await c.doc(id).delete();
  list = list.filter((x) => x.id !== id); changed();
}
export async function setActive(id, on) {
  const c = col(); if (!c) return;
  await c.doc(id).update({ active: !!on, updatedAt: fb().firestore.FieldValue.serverTimestamp() });
  list = list.map((x) => (x.id === id ? Object.assign({}, x, { active: !!on }) : x)); changed();
}

// ---- rows (the dialog list and the Alerts window share them) ----------------------------------------
// host: an element; cls: the row classes of the caller (the Alerts window passes its own stk-al-row so the rows match)
export function dpRows(host, opts) {
  const o = Object.assign({ rowClass: 'stkdpa-row', after: () => {} }, opts);
  for (const a of list) {
    const row = document.createElement('div'); row.className = o.rowClass + (a.active ? '' : ' off');
    row.innerHTML = '<div class="' + (o.rowClass === 'stkdpa-row' ? 'stkdpa-txt' : 'stk-al-txt') + '"><b></b><span></span></div><button type="button" data-k="pause"></button><button type="button" data-k="del">Delete</button>';
    row.querySelector('b').textContent = shortTitle(a);
    row.querySelector('span').textContent = (a.active ? '' : 'Paused · ') + 'Dark pool print · ' + (a.freq === 'once' ? 'Only once' : 'Every time') + ' · phone push';
    const pb = row.querySelector('[data-k=pause]'); pb.textContent = a.active ? 'Pause' : 'Resume';
    pb.setAttribute('aria-label', (a.active ? 'Pause ' : 'Resume ') + alertTitle(a));
    row.querySelector('[data-k=del]').setAttribute('aria-label', 'Delete ' + alertTitle(a));
    pb.onclick = async () => { try { await setActive(a.id, !a.active); } catch (e) { toast('Could not update the alert.', 'error'); } o.after(); };
    row.querySelector('[data-k=del]').onclick = async () => { try { await remove(a.id); } catch (e) { toast('Could not delete the alert.', 'error'); } o.after(); };
    host.appendChild(row);
  }
}

// ---- dialog (desktop: centred dialog; phone: bottom sheet) -----------------------------------------
const IC_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
let dlg = null, lastFocus = null;
function build() {
  dlg = document.createElement('div'); dlg.id = 'stkdpa'; dlg.hidden = true;
  dlg.innerHTML = `<div class="stkdpa-box" role="dialog" aria-modal="true" aria-labelledby="stkdpa-h">
    <div class="stkdpa-grab" aria-hidden="true"></div>
    <div class="stkdpa-hd"><h2 id="stkdpa-h">Dark pool print alert</h2><button type="button" class="stkdpa-x" aria-label="Close">${IC_X}</button></div>
    <div class="stkdpa-body">
      <form class="stkdpa-form" novalidate>
        <label class="stkdpa-f"><span>Symbol</span><select name="symbol">${DP_SYMS.map((s) => `<option value="${s}">${s}</option>`).join('')}</select></label>
        <div class="stkdpa-f"><span id="stkdpa-szl">Smallest print</span><div class="stkdpa-seg" role="radiogroup" aria-labelledby="stkdpa-szl">${SIZES.concat(['Custom']).map((s) => `<button type="button" role="radio" data-s="${s}" aria-checked="false">${s === 'Custom' ? s : s + '+'}</button>`).join('')}</div></div>
        <label class="stkdpa-f stkdpa-cust" hidden><span>Custom size, $ millions</span><input name="custom" type="number" min="1" step="0.5" inputmode="decimal" placeholder="e.g. 50"></label>
        <label class="stkdpa-chk"><input type="checkbox" name="zone"><span>Only prints inside a price zone</span></label>
        <div class="stkdpa-zone" hidden><label class="stkdpa-f"><span>From</span><input name="lo" type="number" step="any" min="0" inputmode="decimal"></label><label class="stkdpa-f"><span>To</span><input name="hi" type="number" step="any" min="0" inputmode="decimal"></label></div>
        <div class="stkdpa-f"><span id="stkdpa-trl">Trigger</span><div class="stkdpa-seg" role="radiogroup" aria-labelledby="stkdpa-trl"><button type="button" role="radio" data-f="once" aria-checked="false">Only once</button><button type="button" role="radio" data-f="every" aria-checked="false">Every time</button></div></div>
        <p class="stkdpa-note">Checked on our server, so it reaches the bell and your phone with no chart open. ${UPDATE_NOTE}. One notification per new print, or one summary when more than 3 arrive together.</p>
        <p class="stkdpa-err" role="alert" hidden></p>
        <div class="stkdpa-btns"><button type="button" class="stkdpa-cancel">Cancel</button><button type="submit" class="stkdpa-save">Create alert</button></div>
      </form>
      <div class="stkdpa-signin" hidden><p>Sign in to get dark pool print alerts on your phone. They are free.</p><a class="stkdpa-save" href="login.html?next=${encodeURIComponent('/charts.html')}">Sign in</a></div>
      <div class="stkdpa-mine"><div class="stkdpa-mh"></div><div class="stkdpa-list"></div></div>
      <p class="stkdpa-foot">Large trades reported off the exchanges. Education only. Not financial advice.</p>
    </div></div>`;
  document.body.appendChild(dlg);
  const f = dlg.querySelector('form'), $ = (s) => dlg.querySelector(s);
  const pick = (sel, attr, v) => dlg.querySelectorAll(sel).forEach((b) => b.setAttribute('aria-checked', String(b.dataset[attr] === v)));
  dlg._size = '$1M'; dlg._freq = 'every';
  dlg.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { dlg._size = b.dataset.s; pick('[data-s]', 's', dlg._size); $('.stkdpa-cust').hidden = dlg._size !== 'Custom'; if (dlg._size === 'Custom') f.custom.focus(); }));
  dlg.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { dlg._freq = b.dataset.f; pick('[data-f]', 'f', dlg._freq); }));
  // arrow keys inside a radio group
  dlg.querySelectorAll('.stkdpa-seg').forEach((g) => g.addEventListener('keydown', (e) => {
    if (!/^Arrow(Left|Right)$/.test(e.key)) return;
    const bs = [...g.querySelectorAll('button')], i = bs.indexOf(document.activeElement); if (i < 0) return;
    const n = bs[(i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length]; n.focus(); n.click(); e.preventDefault();
  }));
  f.zone.onchange = () => { $('.stkdpa-zone').hidden = !f.zone.checked; if (f.zone.checked) f.lo.focus(); };
  dlg._pick = pick;
  const err = (m) => { const e = $('.stkdpa-err'); e.textContent = m || ''; e.hidden = !m; };
  dlg._err = err;
  f.onsubmit = async (e) => {
    e.preventDefault(); err('');
    const min = dlg._size === 'Custom' ? Number(f.custom.value) * 1e6 : Number(dlg._size.replace(/\D/g, '')) * 1e6;
    const a = buildAlert({ symbol: f.symbol.value, min, freq: dlg._freq, zone: f.zone.checked, lo: f.lo.value === '' ? NaN : +f.lo.value, hi: f.hi.value === '' ? NaN : +f.hi.value });
    if (a.error) return err(a.error);
    const btn = $('.stkdpa-save'); btn.disabled = true;
    try {
      await create(a);
      toast('Dark pool print alert set: ' + alertTitle(a) + '.', 'success');
      try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (x) {}
      render();
    } catch (x) {
      if (x && x.full) err('You have ' + MAX_DP_ALERTS + ' dark pool alerts, the most we keep. Delete one first.');
      else if (x && x.signin) render();
      else { console.warn(x); err('Could not save the alert. Check your connection and try again.'); }
    } finally { btn.disabled = false; }
  };
  $('.stkdpa-cancel').onclick = close; $('.stkdpa-x').onclick = close;
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const fs = [...dlg.querySelectorAll('button, input, select, a[href]')].filter((n) => !n.disabled && n.offsetParent !== null);
    if (!fs.length) return;
    if (e.shiftKey && document.activeElement === fs[0]) { fs[fs.length - 1].focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === fs[fs.length - 1]) { fs[0].focus(); e.preventDefault(); }
  });
  onChange(() => { if (!dlg.hidden) render(); });
}
function render() {
  const $ = (s) => dlg.querySelector(s), signed = !!user();
  $('.stkdpa-form').hidden = !signed; $('.stkdpa-signin').hidden = signed;
  const mine = $('.stkdpa-mine'); mine.hidden = !signed || !list.length;
  $('.stkdpa-mh').textContent = 'Your dark pool alerts · ' + list.length + ' of ' + MAX_DP_ALERTS;
  const l = $('.stkdpa-list'); l.textContent = '';
  dpRows(l, { after: render });
}
function close() { if (!dlg || dlg.hidden) return; dlg.hidden = true; document.documentElement.classList.remove('stkdpa-on'); try { if (lastFocus && lastFocus.focus) lastFocus.focus(); } catch (e) {} }
// prefill: { symbol (ticker or chart symbol), min (USD) }
export function openDpAlert(prefill) {
  if (!dlg) build();
  const p = prefill || {}, f = dlg.querySelector('form');
  lastFocus = document.activeElement;
  const sym = targetOf(p.symbol) || 'SPY';   // ES / NQ / YM / RTY charts -> SPY / QQQ / DIA / IWM (their prints)
  f.symbol.value = sym;
  const sz = SIZES.find((s) => Number(s.replace(/\D/g, '')) * 1e6 === p.min);
  dlg._size = sz || (p.min > 1e6 ? 'Custom' : '$1M'); f.custom.value = dlg._size === 'Custom' ? p.min / 1e6 : '';
  dlg._freq = 'every'; f.zone.checked = false; f.lo.value = ''; f.hi.value = '';
  dlg.querySelector('.stkdpa-cust').hidden = dlg._size !== 'Custom'; dlg.querySelector('.stkdpa-zone').hidden = true;
  dlg._pick('[data-s]', 's', dlg._size); dlg._pick('[data-f]', 'f', dlg._freq); dlg._err('');
  dlg.hidden = false; document.documentElement.classList.add('stkdpa-on');
  render(); reload();
  setTimeout(() => { try { (user() ? f.symbol : dlg.querySelector('.stkdpa-signin a')).focus(); } catch (e) {} }, 30);
}
export const isOpen = () => !!dlg && !dlg.hidden;
export { close as closeDpAlert };

const CSS = `
#stkdpa{ position:fixed; inset:0; z-index:9100; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(0,0,0,.6);
  font:400 15px/22px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; }
#stkdpa[hidden], #stkdpa [hidden]{ display:none !important; }
#stkdpa button, #stkdpa input, #stkdpa select, #stkdpa a{ font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; letter-spacing:normal; }
#stkdpa input[type=number]{ -moz-appearance:textfield; appearance:textfield; }
#stkdpa input[type=number]::-webkit-inner-spin-button, #stkdpa input[type=number]::-webkit-outer-spin-button{ -webkit-appearance:none; margin:0; }
.stkdpa-box{ width:min(440px,100%); max-height:min(92vh,800px); display:flex; flex-direction:column; background:#0b0b0d; color:rgba(255,255,255,.92); border:1px solid rgba(255,255,255,.08); border-radius:16px; box-shadow:0 16px 48px rgba(0,0,0,.5); }
.stkdpa-grab{ display:none; }
.stkdpa-hd{ flex:none; display:flex; align-items:center; gap:8px; padding:12px 12px 12px 24px; border-bottom:1px solid rgba(255,255,255,.08); }
.stkdpa-hd h2{ flex:1; margin:0; font-size:17px; line-height:22px; font-weight:600; }
.stkdpa-x{ width:44px; height:44px; flex:none; display:inline-flex; align-items:center; justify-content:center; border:0; border-radius:50%; background:#131316; color:rgba(255,255,255,.92); cursor:pointer; }
.stkdpa-body{ flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:16px 24px 20px; }
.stkdpa-form{ display:flex; flex-direction:column; gap:16px; }
.stkdpa-f{ display:flex; flex-direction:column; gap:8px; min-width:0; }
.stkdpa-f > span, .stkdpa-mh{ font-size:13px; line-height:18px; font-weight:500; color:rgba(255,255,255,.64); }
.stkdpa-f select, .stkdpa-f input{ height:44px; box-sizing:border-box; width:100%; padding:0 12px; border-radius:12px; border:1px solid rgba(255,255,255,.08); background:#131316; color:rgba(255,255,255,.92); font:inherit; font-size:15px; font-variant-numeric:tabular-nums; }
.stkdpa-f select option{ color:#1d1d1f; }
.stkdpa-seg{ display:flex; padding:2px; border-radius:12px; background:#131316; border:1px solid rgba(255,255,255,.08); }
.stkdpa-seg button{ flex:1; min-width:0; min-height:40px; padding:0 4px; border:0; border-radius:10px; background:none; color:rgba(255,255,255,.64); font:inherit; font-size:13px; font-weight:500; cursor:pointer; white-space:nowrap; font-variant-numeric:tabular-nums; }
.stkdpa-seg button[aria-checked="true"]{ background:#050506; color:rgba(255,255,255,.92); box-shadow:0 0 0 1px rgba(255,255,255,.12); }
.stkdpa-chk{ display:flex; align-items:center; gap:12px; min-height:44px; font-size:15px; cursor:pointer; }
.stkdpa-chk input{ appearance:none; -webkit-appearance:none; flex:none; width:20px; height:20px; margin:0; border-radius:6px; border:1.5px solid rgba(255,255,255,.44); background:transparent; display:inline-grid; place-content:center; cursor:pointer; }
.stkdpa-chk input:checked{ background:#03c988; border-color:#03c988; }
.stkdpa-chk input:checked::after{ content:''; width:10px; height:5px; border:2px solid #050506; border-top:0; border-right:0; transform:translateY(-1px) rotate(-45deg); }
.stkdpa-zone{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.stkdpa-note, .stkdpa-foot, .stkdpa-signin p{ margin:0; font-size:12px; line-height:16px; color:rgba(255,255,255,.64); }
.stkdpa-foot{ margin-top:16px; }
.stkdpa-err{ margin:0; font-size:13px; line-height:18px; color:#ff6b6b; }
.stkdpa-btns{ display:flex; justify-content:flex-end; gap:12px; }
.stkdpa-btns button, .stkdpa-signin a{ min-height:44px; padding:0 20px; border-radius:12px; font:inherit; font-size:15px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; text-decoration:none; }
.stkdpa-cancel{ border:1px solid rgba(255,255,255,.12); background:none; color:rgba(255,255,255,.92); }
.stkdpa-save{ border:0; background:#03c988; color:#050506; }
.stkdpa-save:hover{ background:#4fe3ac; }
.stkdpa-save:disabled{ opacity:.6; cursor:default; }
.stkdpa-signin{ display:flex; flex-direction:column; align-items:flex-start; gap:16px; }
.stkdpa-mine{ margin-top:24px; padding-top:16px; border-top:1px solid rgba(255,255,255,.08); }
.stkdpa-list{ margin-top:8px; }
.stkdpa-row{ display:flex; align-items:center; gap:8px; min-height:56px; border-bottom:1px solid rgba(255,255,255,.08); }
.stkdpa-row.off .stkdpa-txt{ opacity:.6; }
.stkdpa-txt{ flex:1; min-width:0; display:flex; flex-direction:column; }
.stkdpa-txt b{ font-size:14px; line-height:20px; font-weight:600; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.stkdpa-txt span{ font-size:12px; line-height:16px; color:rgba(255,255,255,.64); }
.stkdpa-row button{ flex:none; min-height:44px; padding:0 12px; border:0; border-radius:12px; background:none; color:rgba(255,255,255,.92); font:inherit; font-size:13px; font-weight:500; cursor:pointer; }
.stkdpa-row button:hover, .stkdpa-cancel:hover, .stkdpa-x:hover{ background:rgba(255,255,255,.06); }
.stkdpa-row button[data-k="del"]{ color:#ff6b6b; }
#stkdpa button:focus-visible, #stkdpa input:focus-visible, #stkdpa select:focus-visible, #stkdpa a:focus-visible{ outline:2px solid #03c988; outline-offset:2px; }
.stkdpa-body{ scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.18) transparent; }
.stkdpa-body::-webkit-scrollbar{ width:8px; } .stkdpa-body::-webkit-scrollbar-thumb{ background:rgba(255,255,255,.18); border-radius:999px; } .stkdpa-body::-webkit-scrollbar-thumb:hover{ background:rgba(255,255,255,.32); } .stkdpa-body::-webkit-scrollbar-track{ background:transparent; }
:root[data-theme="light"] .stkdpa-box{ background:#fff; color:#1d1d1f; border-color:rgba(0,0,0,.12); }
:root[data-theme="light"] .stkdpa-hd, :root[data-theme="light"] .stkdpa-mine, :root[data-theme="light"] .stkdpa-row{ border-color:rgba(0,0,0,.08); }
:root[data-theme="light"] .stkdpa-x, :root[data-theme="light"] .stkdpa-seg, :root[data-theme="light"] .stkdpa-f select, :root[data-theme="light"] .stkdpa-f input{ background:#f5f5f7; color:#1d1d1f; border-color:rgba(0,0,0,.12); }
:root[data-theme="light"] .stkdpa-seg button[aria-checked="true"]{ background:#fff; color:#1d1d1f; box-shadow:0 0 0 1px rgba(0,0,0,.12); }
:root[data-theme="light"] .stkdpa-f > span, :root[data-theme="light"] .stkdpa-mh, :root[data-theme="light"] .stkdpa-note, :root[data-theme="light"] .stkdpa-foot, :root[data-theme="light"] .stkdpa-signin p, :root[data-theme="light"] .stkdpa-txt span, :root[data-theme="light"] .stkdpa-seg button{ color:#515154; }
:root[data-theme="light"] .stkdpa-seg button[aria-checked="true"]{ color:#1d1d1f; }
:root[data-theme="light"] .stkdpa-cancel, :root[data-theme="light"] .stkdpa-row button{ color:#1d1d1f; border-color:rgba(0,0,0,.16); }
:root[data-theme="light"] .stkdpa-chk input{ border-color:rgba(0,0,0,.44); }
:root[data-theme="light"] .stkdpa-err, :root[data-theme="light"] .stkdpa-row button[data-k="del"]{ color:#c62828; }
:root[data-theme="light"] .stkdpa-save{ background:#047857; color:#fff; }
@media (max-width:700px){
  #stkdpa{ align-items:flex-end; padding:0; }
  .stkdpa-box{ width:100%; max-height:92vh; border-radius:20px 20px 0 0; border-bottom:0; }
  .stkdpa-grab{ display:block; flex:none; width:36px; height:4px; border-radius:2px; margin:8px auto 0; background:rgba(255,255,255,.2); }
  .stkdpa-hd{ padding:4px 12px 8px 16px; }
  .stkdpa-body{ padding:16px 16px calc(24px + env(safe-area-inset-bottom)); }
  .stkdpa-f select, .stkdpa-f input{ height:48px; font-size:16px; }
  .stkdpa-seg button{ min-height:44px; }
  .stkdpa-btns button{ flex:1; min-height:48px; }
}
`;
if (typeof document !== 'undefined' && !document.getElementById('stkdpa-css')) { const st = document.createElement('style'); st.id = 'stkdpa-css'; st.textContent = CSS; document.head.appendChild(st); }
try { const a = fb() && fb().auth && fb().auth(); if (a && a.onAuthStateChanged) a.onAuthStateChanged(() => { loaded = false; reload(); }); } catch (e) {}
window.__stkDpAlerts = { open: openDpAlert, close, reload, get list() { return list; }, isOpen };
