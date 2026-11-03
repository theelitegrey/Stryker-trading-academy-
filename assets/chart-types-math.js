// TradeZoro: pure maths for the extra chart types (no DOM). Input = the timeframe's OHLC bars
// ({time, open, high, low, close, volume?}); output = derived "elements" in the same bar shape so the
// chart engine, crosshair and indicators keep working. Research + rules: stryker-notes/reports/workers/chart-types.md
// Used by assets/chart-types.js (chart) and tools/tests/chart-types-math.test.mjs (hand-computed examples).

// ---- helpers
export function atr(raw, n) {
  // Wilder ATR over the whole series; the last value is used as a fixed size for the whole chart
  let a = 0, c = 0;
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i], p = i ? raw[i - 1].close : b.open;
    const tr = Math.max(b.high - b.low, Math.abs(b.high - p), Math.abs(b.low - p));
    if (c < n) { a = (a * c + tr) / (c + 1); c++; } else a = (a * (n - 1) + tr) / n;
  }
  return a;
}
// shortcut: tick size is guessed from the data (smallest price step seen), when the symbol spec is unknown
export function guessTick(raw) {
  let m = Infinity;
  const n = Math.min(raw.length, 600);
  for (let i = raw.length - n; i < raw.length; i++) {
    if (i < 0) continue;
    const b = raw[i];
    for (const [x, y] of [[b.open, b.close], [b.high, b.low], [b.open, b.high], [b.close, b.low]]) { const d = Math.abs(x - y); if (d > 1e-9 && d < m) m = d; }
  }
  if (!isFinite(m)) return 0.01;
  const e = Math.pow(10, Math.floor(Math.log10(m)));
  return Math.round(m / e * 4) / 4 * e || m;   // snap to 1/4 of a power of ten (0.25, 0.5, 1 ...)
}
// 2 significant digits, so an ATR size reads as a clean number and stays steady between ticks
export function nice(x) {
  if (!(x > 0)) return 0;
  const e = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  return Math.max(Math.round(x / e) * e, e);
}
// method: 'atr' | 'fixed' | 'pct' | 'ticks'
export function sizeOf(raw, o) {
  const last = raw.length ? raw[raw.length - 1].close : 0;
  let s = 0;
  if (o.method === 'fixed') s = +o.fixed || 0;
  else if (o.method === 'pct') s = last * (+o.pct || 1) / 100;
  else if (o.method === 'ticks') s = guessTick(raw) * (+o.ticks || 10);
  else s = atr(raw, +o.atrLen || 14);
  return s > 0 ? nice(s) : 0;
}
// the price walk of each bar: close only, or the real path of the bar (up bar O-L-H-C, down bar O-H-L-C)
export function stream(raw, source) {
  const out = [];
  for (const b of raw) {
    if (source === 'hl') {
      const p = b.close >= b.open ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close];
      for (const x of p) out.push([x, b.time]);
    } else out.push([b.close, b.time]);
  }
  return out;
}
// distinct, ascending times for several elements born in one source bar (ms or seconds)
function stamper(raw) {
  const unit = raw.length && raw[0].time > 1e11 ? 1 : 1e-3;
  let lastT = -Infinity;
  return (t) => { let x = t; if (x <= lastT) x = lastT + unit; lastT = x; return x; };
}
const el = (t, o, c, extra) => Object.assign({ time: t, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c }, extra);

// ---- Renko: bricks of `size`; up when price >= top + size, down when price <= bottom - size (a reversal
// therefore needs two bricks of movement); bricks touch corners; no wicks.
export function renko(raw, size, source) {
  if (!(size > 0) || !raw.length) return [];
  const st = stamper(raw), out = [];
  let top = null, bot = null;
  for (const [p, t] of stream(raw, source)) {
    if (top === null) { top = bot = p; continue; }
    for (let guard = 0; guard < 5000; guard++) {
      if (p >= top + size - 1e-9 * size) { out.push(el(st(t), top, top + size)); bot = top; top += size; }
      else if (p <= bot - size + 1e-9 * size) { out.push(el(st(t), bot, bot - size)); top = bot; bot -= size; }
      else break;
    }
  }
  return out;
}

// ---- Range bars: a bar closes when high - low reaches `size`; the next opens at that close. Built from the
// real bar path (always high/low).
export function range(raw, size) {
  if (!(size > 0) || !raw.length) return [];
  const st = stamper(raw), out = [];
  let o = raw[0].open, hi = o, lo = o, t0 = raw[0].time, any = false;
  const push = (c, t) => { out.push({ time: st(t0), open: o, high: hi, low: lo, close: c }); o = c; hi = lo = c; t0 = t; };
  for (const [p, t] of stream(raw, 'hl')) {
    for (let guard = 0; guard < 5000; guard++) {
      const nh = Math.max(hi, p), nl = Math.min(lo, p);
      if (nh - nl < size - 1e-9 * size) { hi = nh; lo = nl; break; }
      if (p > hi) { hi = lo + size; push(hi, t); } else { lo = hi - size; push(lo, t); }
    }
    if (!any) { t0 = t; any = true; }
  }
  // forming bar (not yet a full range): keep it so the last element follows live price
  const last = raw[raw.length - 1];
  out.push({ time: st(Math.max(t0, last.time)), open: o, high: hi, low: lo, close: last.close, forming: true });
  return out;
}

// ---- Line break (Nison): only closes. New same-direction line when the close passes the last line's end; a
// reversal line when the close passes the extreme of the last `n` lines; the reversal opens at the last line's
// open. Lines have no wicks.
export function lineBreak(raw, n) {
  n = Math.max(1, Math.round(n) || 3);
  const st = stamper(raw), out = [];
  let prev = null;
  for (const b of raw) {
    const c = b.close;
    if (prev === null) { prev = c; continue; }
    if (!out.length) { if (c !== prev) out.push(el(st(b.time), prev, c)); continue; }
    const last = out[out.length - 1], up = last.close > last.open;
    const win = out.slice(-n);
    if (up && c > last.close) out.push(el(st(b.time), last.close, c));
    else if (!up && c < last.close) out.push(el(st(b.time), last.close, c));
    else if (up && c < Math.min(...win.map((x) => x.low))) out.push(el(st(b.time), last.open, c));
    else if (!up && c > Math.max(...win.map((x) => x.high))) out.push(el(st(b.time), last.open, c));
  }
  return out;
}

// ---- Kagi (Nison): one line that goes on while price extends and turns when price moves `rev` against it.
// Each element = one vertical stroke (open = where it starts, close = where it ends). `thick0` is its thickness at
// the start (yang = thick, yin = thin), `brk` the price where it changes (breaking the previous shoulder/waist),
// `thick1` the thickness after `brk`. A horizontal joins neighbours at the earlier stroke's close.
export function kagi(raw, rev, source) {
  if (!(rev > 0) || !raw.length) return [];
  const st = stamper(raw), out = [];
  let p0 = null, dir = 0, cur = null, yang = true, lastPeak = null, lastTrough = null;
  const finish = () => {
    // thickness state after the stroke
    if (cur.up) { if (lastPeak !== null && cur.close > lastPeak) yang = true; lastPeak = cur.close; }
    else { if (lastTrough !== null && cur.close < lastTrough) yang = false; lastTrough = cur.close; }
  };
  const begin = (t, o, c, up) => {
    cur = el(st(t), o, c, { up, thick0: yang, brk: null, thick1: yang });
    if (up && lastPeak !== null && lastPeak > o && c > lastPeak) { cur.brk = lastPeak; cur.thick1 = true; }
    if (!up && lastTrough !== null && lastTrough < o && c < lastTrough) { cur.brk = lastTrough; cur.thick1 = false; }
    out.push(cur);
  };
  const extend = (c) => {
    cur.close = c; cur.high = Math.max(cur.open, c); cur.low = Math.min(cur.open, c);
    if (cur.up && lastPeak !== null && lastPeak > cur.open && c > lastPeak && cur.brk === null) { cur.brk = lastPeak; cur.thick1 = true; }
    if (!cur.up && lastTrough !== null && lastTrough < cur.open && c < lastTrough && cur.brk === null) { cur.brk = lastTrough; cur.thick1 = false; }
  };
  for (const [p, t] of stream(raw, source)) {
    if (p0 === null) { p0 = p; continue; }
    if (!cur) {
      if (p - p0 >= rev) { yang = true; begin(t, p0, p, true); }
      else if (p0 - p >= rev) { yang = false; begin(t, p0, p, false); }
      continue;
    }
    if (cur.up) {
      if (p > cur.close) extend(p);
      else if (cur.close - p >= rev) { finish(); begin(t, cur.close, p, false); }
    } else {
      if (p < cur.close) extend(p);
      else if (p - cur.close >= rev) { finish(); begin(t, cur.close, p, true); }
    }
  }
  return out;
}

// ---- Point & Figure (Cohen / Dorsey; ChartSchool): boxes of `box`; an X column grows when price reaches the next
// box up; a reversal of `rev` boxes starts the other column one box away from the old column's end. Each column =
// one element: low/high = the first/last box's span; `boxes` = count; `up` = X column.
export function pnf(raw, box, rev, source) {
  rev = Math.max(1, Math.round(rev) || 3);
  if (!(box > 0) || !raw.length) return [];
  const st = stamper(raw), out = [];
  const idx = (p) => Math.floor(p / box + 1e-9);
  let i0 = null, col = null;   // col = {up, lo, hi, t} in box indexes
  const flush = () => {
    if (!col) return;
    const lo = col.lo * box, hi = (col.hi + 1) * box;
    out.push({ time: col.time, open: col.up ? lo : hi, high: hi, low: lo, close: col.up ? hi : lo, up: col.up, boxes: col.hi - col.lo + 1, box });
  };
  for (const [p, t] of stream(raw, source)) {
    const i = idx(p);
    if (i0 === null) { i0 = i; continue; }
    if (!col) {
      if (i > i0) col = { up: true, lo: i0, hi: i, time: st(t) };
      else if (i < i0) col = { up: false, lo: i, hi: i0, time: st(t) };
      continue;
    }
    if (col.up) {
      if (i > col.hi) col.hi = i;
      else if (i <= col.hi - rev) { flush(); col = { up: false, lo: i, hi: col.hi - 1, time: st(t) }; }
    } else {
      if (i < col.lo) col.lo = i;
      else if (i >= col.lo + rev) { flush(); col = { up: true, lo: col.lo + 1, hi: i, time: st(t) }; }
    }
  }
  flush();
  return out;
}

// ---- Heikin Ashi (reference formula, for the test; the chart uses the built-in transform)
export function heikin(raw) {
  const out = [];
  for (const b of raw) {
    const c = (b.open + b.high + b.low + b.close) / 4;
    const o = out.length ? (out[out.length - 1].open + out[out.length - 1].close) / 2 : (b.open + b.close) / 2;
    out.push({ time: b.time, open: o, high: Math.max(b.high, o, c), low: Math.min(b.low, o, c), close: c });
  }
  return out;
}

// hollow candles: is the body hollow, and which colour (close vs previous close)
export function hollowLook(bar, prevClose) {
  const ref = prevClose == null ? bar.open : prevClose;
  return { hollow: bar.close > bar.open, up: bar.close >= ref };
}
