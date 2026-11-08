// TradeZoro — Metric alerts (ES module, charts.html). Owner order 2026-11-07: "alerts on any metric".
// WHAT: one "Metric alert" flow with a metric picker. Checked on OUR SERVER (workers/alert-engine: metric_alerts.py + metric_loop.py,
// and zoro_alerts.py for the three options metrics that already had an engine), so they fire with the chart closed: bell + phone push.
//   Price crosses a GEX level  (Pro)  call wall / put wall / zero gamma / pin / expected move high or low / any gamma node -> metricAlerts
//   Gamma regime flips         (Pro)  net GEX turns positive or negative                     -> zoroAlerts type zone_change
//   IV rank above / below      (Pro)                                                          -> zoroAlerts type iv_rank
//   Put/call above / below     (Pro)  by volume                                               -> zoroAlerts type pc_extreme
//   Funding rate above / below (free) OKX or Hyperliquid perpetual, % per funding period      -> metricAlerts
//   Open interest change       (free) OKX or Hyperliquid, % over 5 / 15 / 60 / 240 minutes    -> metricAlerts
// Where: the Alerts window ("+ Metric alert") and inside the GEX Levels indicator settings ("Alerts" group; assets/chart-gex-levels.js
// calls syncIndicator below, one doc per symbol, id 'ind-gex-<SYM>' / 'ind-zone-<SYM>', like the Dark Pool Prints alerts).
// Limits: 20 metric alerts per member (client + engine), options metrics share the 25 options alerts. Every time = at most one push per
// 15 minutes per alert; a condition already true when the alert is set never fires until it resets.
// Storage: Firestore students/{uid}/metricAlerts (owner-only rules, functions-src/firestore.rules). GEX/options data reads "updated" only.
// Education only. Not financial advice.
import { locked as proLocked, upgrade as proUpgrade } from './chart-pro-gate.js?v=920';

export const MAX_METRIC = 20;
const MAX_Z = 25;
export const METRICS = [
  { v: 'gex_cross', l: 'Price crosses a GEX level', pro: true, fields: ['sym', 'level', 'cdir'] },
  { v: 'gex_regime', l: 'Gamma regime flips', pro: true, z: 'zone_change', fields: ['sym'] },
  { v: 'iv_rank', l: 'IV rank above / below', pro: true, z: 'iv_rank', fields: ['sym', 'dir', 'value'] },
  { v: 'pc_ratio', l: 'Put/call ratio above / below', pro: true, z: 'pc_extreme', fields: ['sym', 'dir', 'value'] },
  { v: 'funding', l: 'Funding rate above / below', pro: false, fields: ['coin', 'venue', 'dir', 'value'] },
  { v: 'oi_change', l: 'Open interest change', pro: false, fields: ['coin', 'venue', 'odir', 'value', 'mins'] }
];
const MBY = Object.fromEntries(METRICS.map((m) => [m.v, m]));
export const LEVELS = [['call_wall', 'Call Ceiling (call wall)'], ['put_wall', 'Put Floor (put wall)'], ['gamma_flip', 'Flip Line (zero gamma)'],
  ['pin', 'Pin Strike'], ['em_high', 'Expected move high'], ['em_low', 'Expected move low'], ['any_node', 'Any Gamma Node']];
const LEVELL = Object.fromEntries(LEVELS);
const VENUES = { okx: 'OKX', hl: 'Hyperliquid' };
const NOTE = {
  gex_cross: 'Checked on our server on each options data update (index ETFs about every 2 minutes, stocks about every 15), with the chart closed. Levels are the Zoro Options levels; ES, NQ, RTY, GC and CL use their underlying.',
  gex_regime: 'When net GEX changes sign (Cushion and Swing zones). Checked on each options data update.',
  iv_rank: 'IV rank from 0 to 100. Checked on each options data update.',
  pc_ratio: 'Put/call by volume, for example 1.2. Checked on each options data update.',
  funding: 'Percent per funding period (Hyperliquid 1 hour, OKX usually 8 hours), for example 0.01 or -0.01. Checked every minute.',
  oi_change: 'Open interest in coins, compared with the value that many minutes ago. Checked every minute; the first check needs that much history.'
};
const FUT = { ES: 'SPX', MES: 'SPX', NQ: 'QQQ', MNQ: 'QQQ', RTY: 'IWM', M2K: 'IWM', GC: 'GLD', MGC: 'GLD', CL: 'USO', MCL: 'USO' };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fb = () => window.firebase;
const user = () => { try { return fb() && fb().auth().currentUser; } catch (e) { return null; } };
const col = (name) => { const u = user(); return u ? fb().firestore().collection('students').doc(u.uid).collection(name) : null; };
const ts = () => fb().firestore.FieldValue.serverTimestamp();

// ---- pure ------------------------------------------------------------------------------------------------
export function underlying(s) {
  const t = String(s || '').replace(/^[a-z_]+:/i, '').trim().toUpperCase().replace(/[0-9]?!$/, '');
  return FUT[t] || t;
}
export function coinOf(s) { return String(s || '').replace(/^[a-z_]+:/i, '').trim().toUpperCase().replace(/(-USDT-SWAP|-USDT|USDT|-USD|-PERP)$/, ''); }
// form values -> { col: 'metricAlerts' | 'zoroAlerts', doc } (no timestamps) or { error }
export function buildMetric(v) {
  const m = MBY[v.metric]; if (!m) return { error: 'Pick a metric.' };
  const freq = v.freq === 'every' ? 'every' : 'once', message = String(v.message || '').trim().slice(0, 140);
  const crypto = m.v === 'funding' || m.v === 'oi_change';
  const symbol = crypto ? coinOf(v.symbol) : underlying(v.symbol);
  if (!(crypto ? /^[A-Z0-9]{1,15}$/ : /^[A-Z0-9.\-]{1,12}$/).test(symbol)) return { error: crypto ? 'Enter a coin, for example BTC.' : 'Enter a symbol, for example SPX.' };
  const value = Number(v.value);
  if (m.z) {
    const p = {};
    if (m.v !== 'gex_regime') {
      if (!isNum(value)) return { error: 'Enter a value.' };
      if (m.v === 'iv_rank' && (value < 0 || value > 100)) return { error: 'IV rank is 0 to 100.' };
      if (m.v === 'pc_ratio' && !(value > 0 && value <= 100)) return { error: 'Enter a put/call value above 0.' };
      p.dir = v.dir === 'below' ? 'below' : 'above'; p.value = value;
    }
    return { col: 'zoroAlerts', doc: { type: m.z, symbol, p, message, freq, active: true } };
  }
  const p = {};
  if (m.v === 'gex_cross') {
    if (!LEVELL[v.level]) return { error: 'Pick a level.' };
    p.level = v.level; p.dir = ['up', 'down'].includes(v.cdir) ? v.cdir : 'any';
    if (v.level === 'em_high' || v.level === 'em_low') p.range = ['0', '1', 'w', 'm'].includes(v.range) ? v.range : 's';
  } else {
    if (!VENUES[v.venue]) return { error: 'Pick an exchange.' };
    p.venue = v.venue;
    if (!isNum(value)) return { error: 'Enter a value.' };
    if (m.v === 'funding') { if (value < -5 || value > 5) return { error: 'Funding is between -5% and 5%.' }; p.dir = v.dir === 'below' ? 'below' : 'above'; p.value = value; }
    else {
      if (!(value > 0 && value <= 1000)) return { error: 'Enter a change above 0%.' };
      p.dir = ['up', 'down'].includes(v.odir) ? v.odir : 'either'; p.value = value;
      p.mins = [5, 15, 60, 240].includes(Number(v.mins)) ? Number(v.mins) : 15;
    }
  }
  return { col: 'metricAlerts', doc: { metric: m.v, symbol, p, message, freq, active: true } };
}
const f2 = (x) => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : String(+x.toFixed(4)));
export function titleOf(a) {
  const p = a.p || {};
  switch (a.metric) {
    case 'gex_cross': return a.symbol + ' crosses ' + (p.dir === 'up' ? 'above ' : p.dir === 'down' ? 'below ' : '') + 'its ' + (LEVELL[p.level] || 'level');
    case 'funding': return a.symbol + ' funding on ' + VENUES[p.venue] + ' ' + p.dir + ' ' + f2(p.value) + '%';
    case 'oi_change': return a.symbol + ' open interest on ' + VENUES[p.venue] + (p.dir === 'up' ? ' up ' : p.dir === 'down' ? ' down ' : ' moves ') + f2(p.value) + '% in ' + p.mins + ' min';
    default: return a.symbol + ' metric alert';
  }
}

// ---- store (metricAlerts) -------------------------------------------------------------------------------
let list = [], loaded = false;
const subs = new Set();
const changed = (zoro) => subs.forEach((f) => { try { f(zoro); } catch (e) {} });
export const onChange = (f) => { subs.add(f); return () => subs.delete(f); };
export const metricAlerts = () => list;
const clean = (id, d) => ({ id, metric: d.metric, symbol: String(d.symbol || ''), p: d.p || {}, message: String(d.message || ''), freq: d.freq === 'every' ? 'every' : 'once', active: d.active !== false });
export async function reload() {
  const c = col('metricAlerts');
  if (!c) { list = []; loaded = true; changed(); return list; }
  try { list = (await c.get()).docs.map((d) => clean(d.id, d.data())).filter((a) => MBY[a.metric]); loaded = true; } catch (e) { console.warn('TradeZoro metric alerts: load', e && e.code); }
  changed();
  return list;
}
async function zCount() { const c = col('zoroAlerts'); try { return c ? (await c.get()).size : 0; } catch (e) { return 0; } }
// create (id = null) or replace one alert. Returns the doc id. Throws { full } / { pro } / Error.
export async function save(b, id) {
  const c = col(b.col); if (!c) throw Object.assign(new Error('signin'), { signin: true });
  if (b.col === 'zoroAlerts' || (b.doc.metric === 'gex_cross')) { if (proLocked('gex')) throw Object.assign(new Error('pro'), { pro: true }); }
  if (!id) {
    if (b.col === 'metricAlerts') { if (!loaded) await reload(); if (list.length >= MAX_METRIC) throw Object.assign(new Error('full'), { full: MAX_METRIC }); }
    else if (await zCount() >= MAX_Z) throw Object.assign(new Error('full'), { full: MAX_Z, z: true });
  }
  const ref = id ? c.doc(id) : c.doc();
  const snap = id ? await ref.get() : null;
  if (snap && snap.exists) await ref.update(Object.assign({}, b.doc, { updatedAt: ts() }));
  else await ref.set(Object.assign({}, b.doc, { createdAt: ts(), updatedAt: ts() }));
  try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
  if (b.col === 'metricAlerts') await reload(); else changed(true);
  return ref.id;
}
export async function setActive(a, on) { await col('metricAlerts').doc(a.id).update({ active: !!on, updatedAt: ts() }); a.active = !!on; changed(); }
export async function remove(a) { await col('metricAlerts').doc(a.id).delete(); list = list.filter((x) => x.id !== a.id); changed(); }

// ---- the GEX Levels indicator's "Alerts" group (assets/chart-gex-levels.js) ------------------------------------------
// spec: { symbol (underlying), cross: { on, level, dir, once }, regime: { on } }. Idempotent: an unchanged doc is never written, so a page
// load never re-arms it. Turning a toggle off deletes that doc. One chain so writes never overlap.
let chain = Promise.resolve();
const sameDoc = (d, w) => !!d && d.active === true && JSON.stringify([d.metric || d.type, d.symbol, d.p, d.freq]) === JSON.stringify([w.metric || w.type, w.symbol, w.p, w.freq]);
async function one(name, id, want) {
  const ref = col(name).doc(id), s = await ref.get();
  if (!want) { if (s.exists) await ref.delete(); return 'off'; }
  if (s.exists && sameDoc(s.data(), want)) return 'on';
  if (s.exists) await ref.update(Object.assign({}, want, { updatedAt: ts() }));
  else {
    if (name === 'metricAlerts') { if (!loaded) await reload(); if (list.length >= MAX_METRIC) return 'full'; }
    else if (await zCount() >= MAX_Z) return 'full';
    await ref.set(Object.assign({}, want, { createdAt: ts(), updatedAt: ts() }));
  }
  return 'on';
}
export function syncIndicator(spec) {
  const run = async () => {
    if (!user()) return 'signin';
    if (!spec.symbol || proLocked('gex')) return 'off';
    try {
      const L = LEVELL[spec.cross.level] ? spec.cross.level : 'gamma_flip';
      const cross = spec.cross.on ? buildMetric({ metric: 'gex_cross', symbol: spec.symbol, level: L, cdir: spec.cross.dir, freq: spec.cross.once ? 'once' : 'every' }) : null;
      const reg = spec.regime.on ? buildMetric({ metric: 'gex_regime', symbol: spec.symbol, freq: 'every' }) : null;
      const r1 = await one('metricAlerts', 'ind-gex-' + spec.symbol, cross && cross.doc);
      const r2 = await one('zoroAlerts', 'ind-zone-' + spec.symbol, reg && reg.doc);
      await reload(); changed(true);
      if (r1 === 'full' || r2 === 'full') { toast('You have the most alerts we keep. Delete one in the Alerts window.', 'error'); return 'full'; }
      return 'ok';
    } catch (e) { console.warn('TradeZoro metric alerts: sync', e); return 'error'; }
  };
  chain = chain.then(run, run);
  return chain;
}
const toast = (m, t) => { try { if (window.showToast) window.showToast(t || 'info', m); } catch (e) {} };

// ---- the Alerts window: "+ Metric alert" form + rows ------------------------------------------------------------------
const opt = (pairs) => pairs.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
export function formHtml() {
  return `<form class="stk-al-form stk-al-mform" hidden>
      <label class="stk-al-wide">Metric<select name="mm">${METRICS.map((m) => `<option value="${m.v}">${m.l}${m.pro ? ' (Pro)' : ''}</option>`).join('')}</select></label>
      <label data-m="sym">Symbol<input name="ms" maxlength="12" value="SPX" autocapitalize="characters" autocomplete="off"></label>
      <label data-m="coin" hidden>Coin<input name="mc" maxlength="15" value="BTC" autocapitalize="characters" autocomplete="off"></label>
      <label data-m="venue" hidden>Exchange<select name="mv">${opt(Object.entries(VENUES))}</select></label>
      <label data-m="level">Level<select name="ml">${opt(LEVELS)}</select></label>
      <label data-m="range" hidden>Expected move<select name="mr">${opt([['s', 'Session 68%'], ['0', '0DTE'], ['1', '1DTE'], ['w', 'Weekly'], ['m', 'Monthly']])}</select></label>
      <label data-m="cdir">Direction<select name="mx">${opt([['any', 'Either way'], ['up', 'Crossing up'], ['down', 'Crossing down']])}</select></label>
      <label data-m="dir" hidden>When<select name="md">${opt([['above', 'Above'], ['below', 'Below']])}</select></label>
      <label data-m="odir" hidden>Change<select name="mo">${opt([['either', 'Up or down'], ['up', 'Up'], ['down', 'Down']])}</select></label>
      <label data-m="value" hidden><span class="stk-al-mvl">Value</span><input name="mval" type="number" step="any" inputmode="decimal"></label>
      <label data-m="mins" hidden>Over<select name="mn">${opt([['5', '5 minutes'], ['15', '15 minutes'], ['60', '1 hour'], ['240', '4 hours']])}</select></label>
      <label>Trigger<select name="mf"><option value="once">Only once</option><option value="every">Every time</option></select></label>
      <label class="stk-al-wide">Message<input name="mmsg" maxlength="140" placeholder="Optional"></label>
      <p class="stk-al-wide stk-al-znote stk-al-mnote"></p>
      <div class="stk-al-fbtn"><button type="button" class="stk-al-mcancel">Cancel</button><button type="submit" class="stk-al-save">Create</button></div>
    </form>`;
}
function syncForm(f) {
  const m = MBY[f.mm.value] || METRICS[0];
  const want = new Set(m.fields); if (m.v === 'gex_cross' && /^em_/.test(f.ml.value)) want.add('range');
  f.querySelectorAll('[data-m]').forEach((l) => { l.hidden = !want.has(l.dataset.m); });
  f.querySelector('.stk-al-mvl').textContent = { iv_rank: 'IV rank (0 to 100)', pc_ratio: 'Put/call value', funding: 'Funding, %', oi_change: 'Change, %' }[m.v] || 'Value';
  f.querySelector('.stk-al-mnote').textContent = NOTE[m.v] + ' Education only. Not financial advice.';
}
let editing = null;
export function openForm(panel, a) {
  const f = panel.querySelector('.stk-al-mform'); editing = a ? a.id : null;
  panel.querySelectorAll('.stk-al-form').forEach((x) => { x.hidden = x !== f; });
  f.hidden = false; const p = (a && a.p) || {};
  f.mm.value = a ? a.metric : 'gex_cross';
  if (a && (a.metric === 'funding' || a.metric === 'oi_change')) f.mc.value = a.symbol; else f.ms.value = a ? a.symbol : (f.ms.value || 'SPX');
  f.ml.value = p.level || 'gamma_flip'; f.mr.value = p.range || 's'; f.mx.value = p.dir && a.metric === 'gex_cross' ? p.dir : 'any';
  f.md.value = p.dir === 'below' ? 'below' : 'above'; f.mo.value = a && a.metric === 'oi_change' ? p.dir : 'either';
  f.mv.value = p.venue || 'okx'; f.mn.value = String(p.mins || 15); f.mval.value = p.value != null ? p.value : '';
  f.mf.value = a ? a.freq : 'once'; f.mmsg.value = a ? a.message : '';
  f.mm.disabled = !!a;   // editing keeps the metric (its store may differ); delete and create to change it
  f.querySelector('.stk-al-save').textContent = a ? 'Save' : 'Create';
  syncForm(f); try { f.mm.focus(); } catch (e) {}
}
export function wireForm(panel, toastFn) {
  const f = panel.querySelector('.stk-al-mform');
  f.mm.onchange = () => syncForm(f); f.ml.onchange = () => syncForm(f);
  f.querySelector('.stk-al-mcancel').onclick = () => { f.hidden = true; editing = null; };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const m = MBY[f.mm.value];
    if (m && m.pro && proLocked('gex')) { proUpgrade('gex'); return; }
    if (!user()) { toastFn('Sign in to create metric alerts.'); return; }
    const b = buildMetric({ metric: f.mm.value, symbol: m && (m.v === 'funding' || m.v === 'oi_change') ? f.mc.value : f.ms.value, level: f.ml.value, range: f.mr.value, cdir: f.mx.value,
      dir: f.md.value, odir: f.mo.value, venue: f.mv.value, mins: f.mn.value, value: f.mval.value === '' ? NaN : Number(f.mval.value), freq: f.mf.value, message: f.mmsg.value });
    if (b.error) { toastFn(b.error); return; }
    try { await save(b, editing); f.hidden = true; editing = null; }
    catch (err) {
      if (err && err.pro) proUpgrade('gex');
      else if (err && err.full) toastFn('You have ' + err.full + (err.z ? ' options alerts' : ' metric alerts') + ', the most we keep. Delete one first.');
      else { console.warn(err); toastFn('Could not save the alert. Check your connection and try again.'); }
    }
  };
}
export function rows(host, opts) {
  const o = Object.assign({ after: () => {}, edit: null, toast: () => {} }, opts);
  for (const a of list) {
    const row = document.createElement('div'); row.className = 'stk-al-row' + (a.active ? '' : ' off');
    row.innerHTML = '<div class="stk-al-txt"><b></b><span></span></div><button type="button" data-k="pause"></button><button type="button" data-k="edit">Edit</button><button type="button" data-k="del">Delete</button>';
    row.querySelector('b').textContent = titleOf(a);
    row.querySelector('span').textContent = (a.active ? '' : 'Stopped · ') + (a.message ? a.message + ' · ' : '') + (a.freq === 'every' ? 'Every time' : 'Only once') + ' · metric alert, phone push' + (/^ind-/.test(a.id) ? ' · set in GEX Levels' : '');
    const pb = row.querySelector('[data-k=pause]'); pb.textContent = a.active ? 'Pause' : 'Restart';
    pb.setAttribute('aria-label', (a.active ? 'Pause ' : 'Restart ') + titleOf(a));
    pb.onclick = async () => { try { await setActive(a, !a.active); } catch (e) { o.toast('Could not update the alert.'); } o.after(); };
    row.querySelector('[data-k=edit]').setAttribute('aria-label', 'Edit ' + titleOf(a));
    row.querySelector('[data-k=edit]').onclick = () => { if (o.edit) o.edit(a); };
    row.querySelector('[data-k=del]').setAttribute('aria-label', 'Delete ' + titleOf(a));
    row.querySelector('[data-k=del]').onclick = async () => { try { await remove(a); } catch (e) { o.toast('Could not delete the alert.'); } o.after(); };
    host.appendChild(row);
  }
}
try { const au = fb() && fb().auth && fb().auth(); if (au && au.onAuthStateChanged) au.onAuthStateChanged(() => { loaded = false; reload(); }); } catch (e) {}
if (typeof window !== 'undefined') window.__stkMetricAlerts = { reload, build: buildMetric, get list() { return list; }, sync: syncIndicator };
