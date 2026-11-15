// TradeZoro — Charts: "Days of history to load" setting (member request GK, thread 1571115613198352505).
// Pure helpers + per-timeframe store, no imports so node can test it. Used by chart-history-pager.js (loads)
// and chart-settings.js (row + persistence, ext['stryker.daysload'] per chart cell).
// Rule: the choice is a MINIMUM to load for that timeframe. Auto (0) = old behaviour. We never offer more
// days than the data source really holds (depth) or than the chart can keep in memory (maxBars).
export const AUTO = 'Auto';
const STEPS = [1, 2, 3, 5, 7, 14, 30, 60, 90, 180, 365, 730, 1825, 3650];
const TF_S = { '1': 60, '3': 180, '5': 300, '15': 900, '30': 1800, '45': 2700, '60': 3600, '120': 7200, '180': 10800, '240': 14400, D: 86400, W: 604800, M: 2592000 };
const store = new Map();   // cellId -> { [timeframe]: days }

// Largest number of days we can honestly offer: source depth, and what fits in maxBars (24 h a day = safe side).
export function capDays(tf, depthDays, maxBars) {
  const s = TF_S[String(tf)]; if (!s) return 0;
  return Math.max(0, Math.min(Math.floor(depthDays), Math.floor(maxBars * s / 86400)));
}
// Menu: Auto, the steps that fit, and "Max (N days)" at the cap. Under 2 days of room = only Auto.
export function optionsFor(cap) {
  if (cap < 2) return [AUTO];
  const o = STEPS.filter((d) => d < cap).map(labelOf);
  return [AUTO, ...o, 'Max (' + cap + ' days)'];
}
export const labelOf = (d) => d + (d === 1 ? ' day' : ' days');
export function parseLabel(s, cap) {
  const n = parseInt(String(s).replace(/^Max \(/, ''), 10);
  return s === AUTO || !(n >= 1) ? 0 : Math.min(n, cap);
}
export const displayOf = (days, cap) => (!days ? AUTO : days >= cap ? 'Max (' + cap + ' days)' : labelOf(days));

export const getDays = (id, tf) => (store.get(id) || {})[String(tf)] || 0;
export function setDays(id, tf, d) {
  const o = Object.assign({}, store.get(id) || {});
  if (d > 0) o[String(tf)] = d; else delete o[String(tf)];
  store.set(id, o);
}
export const serialize = (id) => { const o = store.get(id); return o && Object.keys(o).length ? Object.assign({}, o) : undefined; };
export function restore(id, p) {
  const o = {};
  if (p && typeof p === 'object') for (const k of Object.keys(p)) { const v = p[k]; if (TF_S[k] && Number.isFinite(v) && v >= 1 && v <= 3650) o[k] = Math.floor(v); }
  store.set(id, o);
}

// Bars still to fetch so the oldest loaded bar reaches `days` back from the newest. 0 = enough (or no data to judge).
export function barsNeeded(oldest, newest, count, days) {
  if (!days || count < 2 || !(newest > oldest)) return 0;
  const missing = newest - days * 864e5 - oldest;          // ms still uncovered (negative = covered)
  if (missing >= 0) return 0;
  return Math.max(200, Math.ceil(-missing * (count / (newest - oldest)) * 1.1));
}
