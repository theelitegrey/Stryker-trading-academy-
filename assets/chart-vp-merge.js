// TradeZoro — Charts: "Merge nearby profiles" for the Session Volume Profile (chart-orderflow.js) and the
// Market Profile (TPO) indicator (chart-of-pro.js). Member request 19 Nov (roadmap vp-combine-near).
// Pure: which neighbouring sessions are drawn as one combined profile. Off by default, so saved charts look as before.
// Unit tests: tools/tests/vp-merge.test.mjs. Depends on nothing.

export const MERGE_MODES = ['off', 'overlap', 'count'];
// Indicator inputs (same keys on both tools).
export const MERGE_INPUTS = [
  { key: 'mergeMode', title: 'Merge nearby profiles', type: 'string', defval: 'off', options: MERGE_MODES,
    tooltip: 'off = one profile per session (as before). overlap = neighbouring sessions whose value areas overlap by at least the % below are drawn as one profile with its own POC / VAH / VAL. count = every N sessions (newest last) are drawn as one profile.' },
  { key: 'mergePct', title: 'Merge when value areas overlap at least (%)', type: 'int', defval: 50, min: 1, max: 100, step: 1, when: { key: 'mergeMode', equals: 'overlap' } },
  { key: 'mergeCount', title: 'Sessions per merged profile', type: 'int', defval: 2, min: 2, max: 20, step: 1, when: { key: 'mergeMode', equals: 'count' } }
];

// Share of the smaller value area covered by the other one, 0..1. va = [lo, hi] in price.
export function vaOverlap(a, b) {
  if (!a || !b) return 0;
  const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]), w = Math.min(a[1] - a[0], b[1] - b[0]);
  if (hi < lo) return 0;
  return w > 0 ? Math.min(1, (hi - lo) / w) : 1;   // a one-row value area inside the other counts as full overlap
}

// Groups of consecutive session indexes [[0], [1, 2], ...] in order. vaOf(k) -> [lo, hi] of session k.
// overlap: session k joins the group of k-1 when their value areas overlap >= pct %. count: blocks of n, the newest block full.
export function mergeGroups(n, opts, vaOf) {
  const mode = opts && MERGE_MODES.includes(opts.mode) ? opts.mode : 'off';
  const out = [];
  if (mode === 'count') {
    const m = Math.max(1, Math.round(+opts.count || 2));
    for (let z = n; z > 0; z -= m) { const g = []; for (let k = Math.max(0, z - m); k < z; k++) g.push(k); out.unshift(g); }
    return out;
  }
  const pct = Math.min(100, Math.max(1, +opts.pct || 50)) / 100;
  for (let k = 0; k < n; k++) {
    if (mode === 'overlap' && out.length && vaOverlap(vaOf(k - 1), vaOf(k)) >= pct) out[out.length - 1].push(k);
    else out.push([k]);
  }
  return out;
}
export const mergeOpts = (I) => ({ mode: I && MERGE_MODES.includes(I.mergeMode) ? I.mergeMode : 'off', pct: +(I && I.mergePct) || 50, count: +(I && I.mergeCount) || 2 });
