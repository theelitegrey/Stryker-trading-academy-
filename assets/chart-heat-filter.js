// TradeZoro — Charts: shared display filter for the order-book heatmaps (ES module). Owner order 2026-11-04.
// One helper for Futures DOM, Crypto DOM and Liquidity Map: hide cells by colour step, min / max resting size, top N per column.
// Filtering only HIDES cells: the colour scale is always worked out from the unfiltered data, so a kept cell never changes colour.
// Education only. Not financial advice.
// Colour steps: [name, ramp position 0..1] read from each heatmap's real ramp (chart-bookmap.js RAMPS, chart-liquidity-data.js
// DEEP_RAMP, chart-liquidity-map.js RAMP). A cell is kept when its ramp position >= the step's.
export const HF_TABLES = {
  midnight: [['Blue', 0.34], ['Cyan', 0.5], ['Green', 0.64], ['Yellow', 0.74], ['Orange', 0.84], ['Red', 0.93]],
  zoro: [['Grey', 0.34], ['Green', 0.64], ['Yellow', 0.74], ['Orange', 0.84], ['Red', 0.93]],
  splitSide: [['Medium', 0.45], ['Strong', 0.7], ['Neon', 0.85], ['Brightest', 0.95]],
  splitHeat: [['Blue', 0.4], ['White', 0.6], ['Yellow', 0.75], ['Orange', 0.88], ['Red', 0.94]],
  deep: [['Teal', 0.25], ['Cyan', 0.5], ['Yellow', 0.625], ['Orange', 0.75], ['Red', 0.875]],
  lm: [['Blue', 0.25], ['Light blue', 0.42], ['Yellow', 0.66], ['Orange', 0.8], ['Red', 0.92]]
};
export const hfOptions = (t) => ['All'].concat(HF_TABLES[t].map((s, k, a) => s[0] + (k === a.length - 1 ? ' only' : ' and above')));
// specs: [{ table, when }] one colour dropdown per ramp family (shown by its `when`); unit: 'contracts' | 'coins' | 'contracts / coins'
export function hfSchema(unit, specs) {
  const out = specs.map((s) => ({ group: 'Filter', key: 'hfStep_' + s.table, title: 'Show from colour', type: 'string', defval: 'All', options: hfOptions(s.table), when: s.when,
    tooltip: 'Hide cells below this colour step. The colours of the cells that stay do not change.' }));
  return out.concat(hfSizeSchema(unit));
}
export const hfSizeSchema = (unit, minToo = true) => [
  minToo && { group: 'Filter', key: 'hfMin', title: 'Min size (' + unit + ', 0 = off)', type: 'float', defval: 0, min: 0, max: 1000000, step: 1, tooltip: 'Hide resting sizes below this.' },
  { group: 'Filter', key: 'hfMax', title: 'Max size (' + unit + ', 0 = off)', type: 'float', defval: 0, min: 0, max: 1000000, step: 1, tooltip: 'Hide the giant outliers above this.' },
  { group: 'Filter', key: 'hfTop', title: 'Top N levels per column (0 = off)', type: 'int', defval: 0, min: 0, max: 500, step: 1, tooltip: 'Show only the N largest levels at each moment in time.' }
].filter(Boolean);
const nn = (v) => (typeof v === 'number' && v > 0 && Number.isFinite(v) ? v : 0);
// inputs + ramp table name -> { p: min ramp position (0 = off), min, max, top, on, key }
export function hfConfig(i, table) {
  i = i || {};
  const k = table ? hfOptions(table).indexOf(i['hfStep_' + table]) : 0, p = k > 0 ? HF_TABLES[table][k - 1][1] : 0;
  const c = { p, min: nn(i.hfMin), max: nn(i.hfMax), top: Math.floor(nn(i.hfTop)) };
  c.on = !!(c.p || c.min || c.max || c.top); c.key = c.on ? c.p + ':' + c.min + ':' + c.max + ':' + c.top : '';
  return c;
}
// The futures heatmap's colour step per book root, so Wall Events (L2) can follow it: root -> { p (ramp position), look }. Set by
// chart-futures-l2.js FutDomNative.render, removed on stop. shortcut: one heatmap per root wins (the last drawn); per-chart once two differ.
export const hfLive = new Map();
export const hfSize = (c, a) => a >= c.min && !(c.max > 0 && a > c.max);
// the size of the N-th largest level among |vals[0..n)| (scratch: a Float64Array >= n); a level below it is hidden, ties stay
let scr = new Float64Array(2048);
export function hfCut(top, vals, n, scratch, stride = 1, off = 0) {
  scratch = scratch || (n > scr.length ? (scr = new Float64Array(n * 2)) : scr);
  let m = 0;
  for (let k = off; k < n; k += stride) { const a = vals[k] < 0 ? -vals[k] : vals[k]; if (a > 0) scratch[m++] = a; }
  if (m <= top) return 0;
  scratch.subarray(0, m).sort();
  return scratch[m - top];
}
// the cut of one stored sample (its v array), cached per sample so a frame costs one lookup
const cutMemo = new WeakMap();
export function hfCutOf(top, v) {
  let c = cutMemo.get(v);
  if (!c || c.top !== top) cutMemo.set(v, c = { top, cut: hfCut(top, v, v.length) });
  return c.cut;
}
