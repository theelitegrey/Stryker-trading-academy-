// TradeZoro — Delta Profile (L2): delta (aggressor buy minus aggressor sell) at each price, over a time window. Pure maths, no DOM.
// Input = the hub's 1-minute footprint bars ({ t, lo, buy[], sell[] }, one slot per tick from `lo`), the same bars Footprint (L2) and the
// Delta Ladder read. Resolution is one minute: a window holds whole minutes, the newest one still filling.
// Incremental: DeltaAcc keeps one running table per tick and only touches the minutes that changed (a new tick re-adds one minute,
// a minute leaving the window is subtracted), so a tick never rebuilds the window. Education only. Not financial advice.

export const MIN = 60000;

// first minute (inclusive) and end (exclusive) of a window. rolling: the last N minutes including the one in progress.
export function windowOf(mode, o) {
  const cur = Math.floor(o.now / MIN) * MIN;
  if (mode === 'fixed') {
    const a = Math.floor(Math.min(o.start, o.end || o.now) / MIN) * MIN, b = Math.floor(Math.max(o.start, o.end || o.now) / MIN) * MIN;
    return { from: a, to: b + MIN };                       // both end minutes included
  }
  if (mode === 'session') return { from: Math.floor(o.sessionStart / MIN) * MIN, to: cur + MIN };
  const n = Math.max(1, Math.round(o.mins || 15));
  return { from: cur - (n - 1) * MIN, to: cur + MIN };
}

export class DeltaAcc {
  constructor() { this.cur = new Map(); this.tab = new Map(); this.net = 0; this.vol = 0; this.touched = 0; }
  _add(bar, sgn) {
    for (let j = 0; j < bar.buy.length; j++) {
      const b = bar.buy[j], s = bar.sell[j]; if (!b && !s) continue;
      const k = bar.lo + j; let e = this.tab.get(k); if (!e) { e = [0, 0]; this.tab.set(k, e); }
      e[0] += sgn * b; e[1] += sgn * s;
      if (e[0] === 0 && e[1] === 0) this.tab.delete(k);
      this.net += sgn * (b - s); this.vol += sgn * (b + s);
    }
    this.touched++;
  }
  // bars sorted by t. Keeps exactly the minutes t in [from, to).
  update(bars, from, to) {
    this.touched = 0;
    for (const [t, bar] of this.cur) if (t < from || t >= to) { this._add(bar, -1); this.cur.delete(t); }
    let lo = 0, hi = bars.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m].t < from) lo = m + 1; else hi = m; }
    for (let i = lo; i < bars.length && bars[i].t < to; i++) {
      const bar = bars[i], old = this.cur.get(bar.t);
      if (old === bar) continue;
      if (old) this._add(old, -1);
      this._add(bar, 1); this.cur.set(bar.t, bar);
    }
    return this;
  }
  first() { let f = Infinity; for (const t of this.cur.keys()) if (t < f) f = t; return f === Infinity ? 0 : f; }
}

// Group the per-tick table into rows of m ticks. -> { r0, n, m, delta[], vol[], maxPos: {k,v}|null, maxNeg: {k,v}|null, absMax, volMax }
// k = row index (price = (r0 + k) * m * tick .. +m ticks).
export function rebucket(tab, m) {
  m = Math.max(1, Math.round(m));
  let lo = Infinity, hi = -Infinity;
  for (const k of tab.keys()) { const r = Math.floor(k / m); if (r < lo) lo = r; if (r > hi) hi = r; }
  if (hi < lo) return null;
  const n = hi - lo + 1, delta = new Float64Array(n), vol = new Float64Array(n);
  for (const [k, e] of tab) { const i = Math.floor(k / m) - lo; delta[i] += e[0] - e[1]; vol[i] += e[0] + e[1]; }
  let maxPos = null, maxNeg = null, absMax = 0, volMax = 0;
  for (let i = 0; i < n; i++) {
    const d = delta[i]; absMax = Math.max(absMax, Math.abs(d)); volMax = Math.max(volMax, vol[i]);
    if (d > 0 && (!maxPos || d > maxPos.v)) maxPos = { k: i, v: d };
    if (d < 0 && (!maxNeg || d < maxNeg.v)) maxNeg = { k: i, v: d };
  }
  return { r0: lo, n, m, delta, vol, maxPos, maxNeg, absMax, volMax };
}

// Row size in ticks: the smallest of `steps` that is at least `minPx` tall and keeps at most `maxRows` rows over the span.
export function rowTicks(spanTicks, tickPx, minPx, maxRows, steps) {
  for (const s of steps) if (tickPx * s >= minPx && spanTicks / s <= maxRows) return s;
  return steps[steps.length - 1];
}

// A footprint-data profile() result ({ r0, n, m, buy[], sell[] }) in the same shape rebucket() returns (Volume Profile (L2) "Delta" view).
export function fromProfile(tp) {
  if (!tp) return null;
  const delta = new Float64Array(tp.n), vol = new Float64Array(tp.n);
  let maxPos = null, maxNeg = null, absMax = 0, volMax = 0;
  for (let i = 0; i < tp.n; i++) {
    const d = tp.buy[i] - tp.sell[i]; delta[i] = d; vol[i] = tp.buy[i] + tp.sell[i];
    absMax = Math.max(absMax, Math.abs(d)); volMax = Math.max(volMax, vol[i]);
    if (d > 0 && (!maxPos || d > maxPos.v)) maxPos = { k: i, v: d };
    if (d < 0 && (!maxNeg || d < maxNeg.v)) maxNeg = { k: i, v: d };
  }
  return { r0: tp.r0, n: tp.n, m: tp.m, delta, vol, maxPos, maxNeg, absMax, volMax };
}
