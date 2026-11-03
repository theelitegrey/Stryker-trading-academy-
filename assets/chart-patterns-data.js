// TradeZoro — Charts: AUTO CHART PATTERNS maths (pure, no DOM; unit-tested in tools/tests/chart-patterns.test.mjs).
// Pivots (zigzag with a strength setting) are found one closed bar at a time. Each new pivot is checked against the last few pivots
// for 12 named shapes. A shape is "forming" until a bar CLOSES through its neckline / trendline, then it is "completed".
// Bounded: only the last `maxPivots` pivots are kept, at most `maxOpen` shapes wait for a break and `maxDone` completed shapes are kept.
// Incremental: update(bars) only looks at bars it has not seen. Education only. Not financial advice.

export const PATTERNS = [
  { id: 'dtop', name: 'Double Top', dir: -1 },
  { id: 'dbot', name: 'Double Bottom', dir: 1 },
  { id: 'hs', name: 'Head & Shoulders', short: 'H&S', dir: -1 },
  { id: 'ihs', name: 'Inverse Head & Shoulders', short: 'Inv H&S', dir: 1 },
  { id: 'atri', name: 'Ascending Triangle', short: 'Asc Triangle', dir: 1 },
  { id: 'dtri', name: 'Descending Triangle', short: 'Desc Triangle', dir: -1 },
  { id: 'stri', name: 'Symmetrical Triangle', short: 'Sym Triangle', dir: 0 },
  { id: 'rwedge', name: 'Rising Wedge', dir: -1 },
  { id: 'fwedge', name: 'Falling Wedge', dir: 1 },
  { id: 'bflag', name: 'Bull Flag', dir: 1 },
  { id: 'rflag', name: 'Bear Flag', dir: -1 },
  { id: 'chan', name: 'Channel', dir: 0 }
];
export const BY_ID = Object.fromEntries(PATTERNS.map((p) => [p.id, p]));

const MIN_H = 4;        // a shape must be at least this many ATR tall
const SWING = 3;        // a pivot must be at least this many ATR from the one before it
const at = (l, i) => l.p + l.sl * (i - l.i);
const fit = (a, b) => ({ i: a.i, p: a.p, sl: (b.p - a.p) / (b.i - a.i) });

export class PatternEngine {
  constructor(o) { this.o = Object.assign({ strength: 5, maxPivots: 24, maxOpen: 12, maxDone: 150 }, o); this.o.strength = Math.max(2, Math.min(30, Math.round(this.o.strength) || 5)); this.reset(); }
  reset() { this.cur = 0; this.t0 = 0; this.tc = 0; this.atr = []; this.piv = []; this.open = []; this.done = []; this.seq = 0; this.steps = 0; }

  // bars: [{ time, open, high, low, close }]. The LAST bar may still be moving, so it is never used to confirm anything.
  update(bars) {
    const n = bars.length - 1;
    if (n < 1) { this.reset(); return this; }
    if (this.cur > n || (this.cur && (bars[0].time !== this.t0 || bars[this.cur - 1].time !== this.tc))) this.reset();
    if (!this.cur) this.t0 = bars[0].time;
    for (let c = this.cur; c < n; c++) this.step(bars, c);
    this.cur = n; this.tc = bars[n - 1].time;
    return this;
  }
  step(bars, c) {
    this.steps++;
    const b = bars[c], A = this.atr;
    const tr = c ? Math.max(b.high - b.low, Math.abs(b.high - bars[c - 1].close), Math.abs(b.low - bars[c - 1].close)) : b.high - b.low;
    A[c] = c === 0 ? tr : c < 14 ? (A[c - 1] * c + tr) / (c + 1) : (A[c - 1] * 13 + tr) / 14;
    for (let k = this.open.length - 1; k >= 0; k--) { const r = this.advance(this.open[k], bars, c); if (r) { const x = this.open.splice(k, 1)[0]; if (r === 'done') this.finish(x); } }
    const s = this.o.strength, i = c - s;
    if (i < s) return;
    let isH = true, isL = true; const h = bars[i].high, l = bars[i].low;
    for (let k = i - s; k <= i + s; k++) {
      if (k === i) continue;
      if (bars[k].high > h || (k > i && bars[k].high === h)) isH = false;
      if (bars[k].low < l || (k > i && bars[k].low === l)) isL = false;
    }
    const P = this.piv, lastT = P.length ? P[P.length - 1].t : 0;
    if (lastT > 0) { if (isL) this.add(bars, c, -1, i, l); if (isH) this.add(bars, c, 1, i, h); } else { if (isH) this.add(bars, c, 1, i, h); if (isL) this.add(bars, c, -1, i, l); }
  }
  add(bars, c, t, i, p) {
    const P = this.piv, last = P[P.length - 1], atr = this.atr[c];
    if (last && last.t === t) {
      if (t * p <= t * last.p) return;   // a weaker pivot of the same side: ignore
      this.open = this.open.filter((x) => x.kid !== last.id);   // the pivot a waiting shape ended on moved: forget that shape
      P[P.length - 1] = { i, p, t, id: ++this.seq };
    } else {
      if (last && Math.abs(p - last.p) < SWING * atr) return;   // too small a swing to count
      P.push({ i, p, t, id: ++this.seq });
      if (P.length > this.o.maxPivots) P.shift();
    }
    this.detect(bars, c);
  }
  detect(bars, c) {
    const P = this.piv, k = P.length - 1, atr = this.atr[c], cands = [];
    if (!(atr > 0)) return;
    const t = P[k].t;
    cands.push(hs(P, k, atr, t), lines(P, k, atr, bars, false), dbl(P, k, atr, t), lines(P, k, atr, bars, true));   // first one wins an overlap
    for (const x of cands) {
      if (!x) continue;
      x.kid = P[k].id; x.state = 'forming';
      if (this.dup(x)) continue;
      let r = null;
      for (let j = x.end + 1; j <= c && !r; j++) r = this.advance(x, bars, j);
      if (r === 'drop') continue;
      if (r === 'done') { this.finish(x); continue; }
      this.open.push(x); if (this.open.length > this.o.maxOpen) this.open.shift();
    }
  }
  // true = skip x: the same shape already exists on mostly the same bars, or a bigger shape holds these bars.
  // A waiting shape that sits inside the span of x is replaced by x (a triangle swallows the double top inside it).
  dup(x) {
    const ov = (y) => Math.min(x.end, y.end) - Math.max(x.start, y.start);
    const same = (y) => y.id === x.id && ov(y) > 0.6 * Math.min(x.end - x.start, y.end - y.start);
    if (this.open.some(same) || this.done.slice(-12).some(same)) return true;
    if (this.open.some((y) => y.start <= x.start && y.end >= x.end && y.end - y.start > x.end - x.start)) return true;
    this.open = this.open.filter((y) => !(x.start <= y.start && x.end >= y.end && x.end - x.start > y.end - y.start));
    return false;
  }
  finish(x) { x.state = 'done'; this.done.push(x); if (this.done.length > this.o.maxDone) this.done.shift(); }

  // one closed bar for one waiting shape -> 'done' | 'drop' | null
  advance(x, bars, j) {
    const b = bars[j];
    if (x.kind === 'rev') {
      const nk = at(x.neck, j), s = x.s;
      if (s * b.close < s * nk) { x.brk = j; x.level = nk; x.target = nk - s * x.H; return 'done'; }
      if ((s > 0 ? b.high : -b.low) > x.inv) return 'drop';
    } else {
      const u = at(x.up, j), lo = at(x.lo, j);
      const dir = b.close > u ? 1 : b.close < lo ? -1 : 0;
      if (dir) {
        if (x.only && x.only !== dir) return 'drop';
        x.brk = j; x.dir = dir; x.level = dir > 0 ? u : lo; x.target = x.level + dir * x.H; return 'done';
      }
      if (u <= lo) return 'drop';
    }
    return j - x.end > x.wait ? 'drop' : null;
  }

  // What to draw. `last` = index of the newest bar. Completed shapes are newest first, bounded by `max`.
  view(enabled, showForming, max) {
    const ok = (x) => !enabled || enabled[x.id] !== false;
    const done = this.done.filter(ok).slice(-max);
    const forming = showForming ? this.open.filter(ok).slice(-Math.max(1, Math.min(4, max))) : [];
    return { done, forming };
  }
}

// ------------------------------------------------------------------------------------------------ double top / bottom
function dbl(P, k, atr, s) {
  if (k < 3) return null;
  const H2 = P[k], V = P[k - 1], H1 = P[k - 2], L0 = P[k - 3];
  const depth = (s * H1.p + s * H2.p) / 2 - s * V.p;
  if (!(depth >= MIN_H * atr)) return null;
  if (Math.abs(H1.p - H2.p) > 0.15 * depth) return null;   // the two tops are level
  if (H2.i - H1.i < 8 || H2.i - H1.i > 200) return null;
  if (s * H1.p - s * L0.p < 0.8 * depth) return null;      // price came up into the first top
  const top = Math.max(s * H1.p, s * H2.p);
  return { id: s > 0 ? 'dtop' : 'dbot', kind: 'rev', s, start: H1.i, end: H2.i, pts: [H1, V, H2], neck: { i: V.i, p: V.p, sl: 0 }, H: depth, inv: top + 0.5 * depth, wait: Math.max(30, 1.5 * (H2.i - H1.i)), dir: -s };
}

// ------------------------------------------------------------------------------------------------ head and shoulders
function hs(P, k, atr, s) {
  if (k < 4) return null;
  const RS = P[k], L2 = P[k - 1], HD = P[k - 2], L1 = P[k - 3], LS = P[k - 4];
  const neck = fit(L1, L2), nh = at(neck, HD.i), H = s * HD.p - s * nh;
  if (!(H >= MIN_H * atr)) return null;
  const lh = s * LS.p - s * at(neck, LS.i), rh = s * RS.p - s * at(neck, RS.i);
  if (lh < 0.25 * H || lh > 0.85 * H || rh < 0.25 * H || rh > 0.85 * H) return null;   // shoulders clearly lower than the head
  if (Math.abs(lh - rh) > 0.35 * H) return null;                                         // and about the same height
  if (Math.abs(L2.p - L1.p) > 0.6 * H) return null;                                      // neckline not too steep
  const a = HD.i - LS.i, b = RS.i - HD.i;
  if (a < 4 || b < 4 || b / a < 0.4 || b / a > 2.5 || RS.i - LS.i > 300) return null;
  return { id: s > 0 ? 'hs' : 'ihs', kind: 'rev', s, start: LS.i, end: RS.i, pts: [LS, L1, HD, L2, RS], neck, H, inv: s * HD.p + 0.25 * H, wait: Math.max(30, 1.5 * (RS.i - LS.i)), dir: -s };
}

// ------------------------------------------------------------------------------------------------ triangles, wedges, flags, channels
function lines(P, k, atr, bars, chan) {
  for (let m = 6; m >= 4; m--) {
    if (k - m + 1 < 0) continue;
    const W = P.slice(k - m + 1, k + 1), hi = W.filter((q) => q.t > 0), lw = W.filter((q) => q.t < 0);
    if (hi.length < 2 || lw.length < 2) continue;
    const up = fit(hi[0], hi[hi.length - 1]), lo = fit(lw[0], lw[lw.length - 1]);
    const iS = W[0].i, iE = W[m - 1].i, L = iE - iS;
    if (L < 12 || L > 120) continue;
    const w0 = at(up, iS) - at(lo, iS), w1 = at(up, iE) - at(lo, iE);
    if (!(w0 > 0 && w1 > 0)) continue;
    const avg = (w0 + w1) / 2;
    if (avg < MIN_H * atr) continue;
    const tol = 0.3 * atr + 0.06 * avg;
    let bad = false;
    for (const q of W) { const l = q.t > 0 ? up : lo; if (Math.abs(q.p - at(l, q.i)) > tol) { bad = true; break; } }
    let off = 0;   // price must live inside the lines: its average distance from the middle of the lines stays under 26 % of their gap
    for (let j = iS; j <= iE && !bad; j++) { const cl = bars[j].close, u = at(up, j), l = at(lo, j); if (cl > u + tol || cl < l - tol) bad = true; off += Math.abs(cl - (u + l) / 2) / Math.max(1e-9, u - l); }
    if (off / (L + 1) > 0.26) bad = true;
    if (bad) continue;
    const nu = up.sl * L / avg, nl = lo.sl * L / avg, r = w1 / w0, sm = (nu + nl) / 2;
    const base = { kind: 'line', start: iS, end: iE, up: { i: up.i, p: up.p, sl: up.sl }, lo: { i: lo.i, p: lo.p, sl: lo.sl }, pts: W, H: Math.max(w0, w1), only: 0, dir: 0 };
    const apex = w1 / Math.max(1e-12, lo.sl - up.sl);   // bars from the last pivot until the lines meet
    if (r <= 0.65) {
      if (chan) continue;
      const conv = Object.assign(base, { wait: Math.max(8, Math.min(1.5 * L, 1.3 * apex)) });
      if (Math.abs(nu) <= 0.15 && nl >= 0.35) return Object.assign(conv, { id: 'atri', dir: 1 });
      if (Math.abs(nl) <= 0.15 && nu <= -0.35) return Object.assign(conv, { id: 'dtri', dir: -1 });
      if (nu <= -0.2 && nl >= 0.2) return Object.assign(conv, { id: 'stri' });
      if (nu >= 0.15 && nl >= 0.15) return Object.assign(conv, { id: 'rwedge', dir: -1 });
      if (nu <= -0.15 && nl <= -0.15) return Object.assign(conv, { id: 'fwedge', dir: 1 });
      continue;
    }
    if (!chan && !(r > 0.65)) continue;
    if (r < 0.85 || r > 1.2 || Math.abs(nu - nl) > 0.12) continue;
    const wait = Math.max(15, 0.75 * L), P0 = k - m >= 0 ? P[k - m] : null;
    if (!chan && P0 && W[0].t > 0 && P0.t < 0 && sm <= 0.1 && sm >= -1.2) {   // bull flag: sharp rise, then a small drift down
      const Hp = W[0].p - P0.p, hold = Math.min(...lw.map((q) => q.p));
      if (Hp >= Math.max(4 * atr, avg / 0.6) && hold >= P0.p + 0.5 * Hp && W[0].i - P0.i <= Math.max(1.5 * L, 12) && L <= 4 * (W[0].i - P0.i) + 16)
        return Object.assign(base, { id: 'bflag', dir: 1, only: 1, H: Hp, wait, pole: P0 });
    }
    if (!chan && P0 && W[0].t < 0 && P0.t > 0 && sm >= -0.1 && sm <= 1.2) {   // bear flag: sharp fall, then a small drift up
      const Hp = P0.p - W[0].p, hold = Math.max(...hi.map((q) => q.p));
      if (Hp >= Math.max(4 * atr, avg / 0.6) && hold <= P0.p - 0.5 * Hp && W[0].i - P0.i <= Math.max(1.5 * L, 12) && L <= 4 * (W[0].i - P0.i) + 16)
        return Object.assign(base, { id: 'rflag', dir: -1, only: -1, H: Hp, wait, pole: P0 });
    }
    if (chan && L >= 20 && Math.abs(sm) >= 0.3) return Object.assign(base, { id: 'chan', wait, slope: sm });
  }
  return null;
}
