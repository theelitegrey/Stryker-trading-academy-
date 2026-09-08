/**
 * Stryker Trading Academy — Replay indicator library (pure computation)
 *
 * Every indicator is a definition { id, name, group, overlay, inputs, plots,
 * compute(bars, params, ctx) } that returns
 *   { lines: { plotKey: number[] (NaN = no value) }, shapes: [...] }
 * over the bars it is given (complete candles plus the forming one). Shapes
 * are index-based so the chart can place them on any timeframe:
 *   { type:'box',    i0, i1|null, top, bottom, color, text, dashed }
 *   { type:'level',  i0, i1|null, price, color, text, dashed }
 *   { type:'marker', i, price, kind:'up'|'down'|'dot', color, text }
 *   { type:'bg',     i0, i1, color, text }
 * i1 === null means "extend to the last bar".
 *
 * The Pine-like helpers in `ta` are what a later custom-script editor will
 * expose, so keep them generic. No DOM, no chart library: runs in Node too.
 *
 * ReplayTime: cached Intl helpers (minutes-of-day, weekday, offsets) shared
 * by the chart, the indicators and the coach.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ReplayIndicators = api.indicators; root.ReplayTime = api.time; root.ta = root.ta || api.ta;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // ---- time helpers -----------------------------------------------------------
  const fmts = {}, cache = new Map();
  function fmt(tz) { return fmts[tz] || (fmts[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })); }
  function parts(tz, t) {
    const key = tz + '|' + t; const hit = cache.get(key); if (hit) return hit;
    const o = {}; for (const p of fmt(tz).formatToParts(new Date(t))) o[p.type] = p.value;
    const hh = Number(o.hour) % 24;
    const r = { min: hh * 60 + Number(o.minute), hh: String(hh).padStart(2, '0'), mm: o.minute, wd: o.weekday, mon: o.month, day: o.day, year: o.year, dayKey: o.year + '-' + o.month + '-' + o.day, weekend: o.weekday === 'Sat' || o.weekday === 'Sun' };
    if (cache.size > 60000) cache.clear();
    cache.set(key, r); return r;
  }
  // Offset of tz from UTC at time t, in ms (positive east of UTC).
  function offsetMs(tz, t) {
    const p = parts(tz, t); const d = new Date(t);
    const monIdx = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(p.mon);
    const wall = Date.UTC(Number(p.year), monIdx, Number(p.day), Number(p.hh), Number(p.mm), d.getUTCSeconds());
    return wall - Math.floor(t / 1000) * 1000;
  }
  const time = { parts, offsetMs };

  // ---- ta helpers (Pine-flavoured) ----------------------------------------------
  const NaNs = (n) => new Array(n).fill(NaN);
  const ta = {
    src(bars, which) { const k = which || 'close'; return bars.map((b) => k === 'hl2' ? (b.h + b.l) / 2 : k === 'hlc3' ? (b.h + b.l + b.c) / 3 : k === 'ohlc4' ? (b.o + b.h + b.l + b.c) / 4 : k === 'open' ? b.o : k === 'high' ? b.h : k === 'low' ? b.l : b.c); },
    sma(x, len) { const out = NaNs(x.length); let s = 0; for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= len) s -= x[i - len]; if (i >= len - 1) out[i] = s / len; } return out; },
    ema(x, len) { const out = NaNs(x.length); const k = 2 / (len + 1); let e = NaN, n = 0, s = 0; for (let i = 0; i < x.length; i++) { if (isNaN(x[i])) continue; if (n < len) { s += x[i]; n++; if (n === len) { e = s / len; out[i] = e; } continue; } e = x[i] * k + e * (1 - k); out[i] = e; } return out; },
    rma(x, len) { const out = NaNs(x.length); const k = 1 / len; let e = NaN, n = 0, s = 0; for (let i = 0; i < x.length; i++) { if (isNaN(x[i])) continue; if (n < len) { s += x[i]; n++; if (n === len) { e = s / len; out[i] = e; } continue; } e = x[i] * k + e * (1 - k); out[i] = e; } return out; },
    wma(x, len) { const out = NaNs(x.length); const den = len * (len + 1) / 2; for (let i = len - 1; i < x.length; i++) { let s = 0; for (let j = 0; j < len; j++) s += x[i - j] * (len - j); out[i] = s / den; } return out; },
    stdev(x, len) { const out = NaNs(x.length); for (let i = len - 1; i < x.length; i++) { let m = 0; for (let j = 0; j < len; j++) m += x[i - j]; m /= len; let v = 0; for (let j = 0; j < len; j++) v += (x[i - j] - m) ** 2; out[i] = Math.sqrt(v / len); } return out; },
    tr(bars) { return bars.map((b, i) => i ? Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)) : b.h - b.l); },
    atr(bars, len) { return ta.rma(ta.tr(bars), len); },
    rsi(x, len) { const up = NaNs(x.length), dn = NaNs(x.length); for (let i = 1; i < x.length; i++) { const d = x[i] - x[i - 1]; up[i] = Math.max(d, 0); dn[i] = Math.max(-d, 0); } const au = ta.rma(up.slice(1), len), ad = ta.rma(dn.slice(1), len); const out = NaNs(x.length); for (let i = 0; i < au.length; i++) { if (isNaN(au[i])) continue; out[i + 1] = ad[i] === 0 ? 100 : 100 - 100 / (1 + au[i] / ad[i]); } return out; },
    highest(x, len) { const out = NaNs(x.length); for (let i = len - 1; i < x.length; i++) { let m = -Infinity; for (let j = 0; j < len; j++) if (x[i - j] > m) m = x[i - j]; out[i] = m; } return out; },
    lowest(x, len) { const out = NaNs(x.length); for (let i = len - 1; i < x.length; i++) { let m = Infinity; for (let j = 0; j < len; j++) if (x[i - j] < m) m = x[i - j]; out[i] = m; } return out; },
    stoch(bars, kLen, kSmooth, dSmooth) { const hh = ta.highest(bars.map((b) => b.h), kLen), ll = ta.lowest(bars.map((b) => b.l), kLen); const raw = bars.map((b, i) => (isNaN(hh[i]) || hh[i] === ll[i]) ? NaN : 100 * (b.c - ll[i]) / (hh[i] - ll[i])); const k = ta.sma(raw.map((v) => isNaN(v) ? 50 : v), kSmooth); const d = ta.sma(k.map((v) => isNaN(v) ? 50 : v), dSmooth); return { k, d }; },
    // fractal swing points: true at index i if it is the highest/lowest of len bars each side
    swings(bars, len) { const hi = [], lo = []; for (let i = len; i < bars.length - len; i++) { let isH = true, isL = true; for (let j = 1; j <= len; j++) { if (bars[i - j].h >= bars[i].h || bars[i + j].h >= bars[i].h) isH = false; if (bars[i - j].l <= bars[i].l || bars[i + j].l <= bars[i].l) isL = false; if (!isH && !isL) break; } if (isH) hi.push(i); if (isL) lo.push(i); } return { hi, lo }; }
  };

  // ---- indicator definitions -----------------------------------------------------
  const C = { mint: '#03c988', red: '#e5484d', amber: '#f5c542', teal: '#00adb5', blue: '#4f8cff', purple: '#8b7dd8', grey: '#8b93a0', white: '#e6e6e6' };
  const defs = [];
  const def = (d) => { defs.push(d); return d; };
  const srcInput = { key: 'src', label: 'Source', type: 'select', def: 'close', options: ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'] };

  def({ id: 'sma', name: 'Moving average (SMA)', group: 'Classic', overlay: true, inputs: [{ key: 'len', label: 'Length', type: 'int', def: 20, min: 1, max: 500 }, srcInput], plots: [{ key: 'v', label: 'SMA', color: C.blue }],
    compute: (bars, p) => ({ lines: { v: ta.sma(ta.src(bars, p.src), p.len) } }) });
  def({ id: 'ema', name: 'Exponential MA (EMA)', group: 'Classic', overlay: true, inputs: [{ key: 'len', label: 'Length', type: 'int', def: 20, min: 1, max: 500 }, srcInput], plots: [{ key: 'v', label: 'EMA', color: C.amber }],
    compute: (bars, p) => ({ lines: { v: ta.ema(ta.src(bars, p.src), p.len) } }) });
  def({ id: 'wma', name: 'Weighted MA (WMA)', group: 'Classic', overlay: true, inputs: [{ key: 'len', label: 'Length', type: 'int', def: 20, min: 1, max: 500 }, srcInput], plots: [{ key: 'v', label: 'WMA', color: C.purple }],
    compute: (bars, p) => ({ lines: { v: ta.wma(ta.src(bars, p.src), p.len) } }) });
  def({ id: 'vwap', name: 'VWAP (session)', group: 'Classic', overlay: true, inputs: [{ key: 'bands', label: 'Show σ bands', type: 'bool', def: true }, { key: 'mult', label: 'Band multiplier', type: 'float', def: 1, min: 0.25, max: 4 }], plots: [{ key: 'v', label: 'VWAP', color: C.teal, width: 2 }, { key: 'u', label: '+σ', color: C.teal, style: 'dashed', width: 1 }, { key: 'l', label: '−σ', color: C.teal, style: 'dashed', width: 1 }],
    compute: (bars, p, ctx) => { const v = NaNs(bars.length), u = NaNs(bars.length), l = NaNs(bars.length); let day = null, pv = 0, vol = 0, pv2 = 0; for (let i = 0; i < bars.length; i++) { const b = bars[i]; const dk = parts(ctx.tz, b.t).dayKey; if (dk !== day) { day = dk; pv = 0; vol = 0; pv2 = 0; } const tp = (b.h + b.l + b.c) / 3, w = b.v || 1; pv += tp * w; vol += w; pv2 += tp * tp * w; v[i] = pv / vol; if (p.bands) { const sd = Math.sqrt(Math.max(0, pv2 / vol - v[i] * v[i])); u[i] = v[i] + p.mult * sd; l[i] = v[i] - p.mult * sd; } } return { lines: { v, u, l } }; } });
  def({ id: 'bb', name: 'Bollinger Bands', group: 'Classic', overlay: true, inputs: [{ key: 'len', label: 'Length', type: 'int', def: 20, min: 2, max: 300 }, { key: 'mult', label: 'StdDev', type: 'float', def: 2, min: 0.5, max: 5 }, srcInput], plots: [{ key: 'm', label: 'Basis', color: C.grey }, { key: 'u', label: 'Upper', color: C.blue }, { key: 'l', label: 'Lower', color: C.blue }],
    compute: (bars, p) => { const x = ta.src(bars, p.src); const m = ta.sma(x, p.len), sd = ta.stdev(x, p.len); return { lines: { m, u: m.map((v, i) => v + p.mult * sd[i]), l: m.map((v, i) => v - p.mult * sd[i]) } }; } });
  def({ id: 'supertrend', name: 'Supertrend', group: 'Classic', overlay: true, inputs: [{ key: 'len', label: 'ATR length', type: 'int', def: 10, min: 1, max: 100 }, { key: 'mult', label: 'Multiplier', type: 'float', def: 3, min: 0.5, max: 10 }], plots: [{ key: 'up', label: 'Up', color: C.mint, width: 2 }, { key: 'dn', label: 'Down', color: C.red, width: 2 }],
    compute: (bars, p) => { const atr = ta.atr(bars, p.len); const up = NaNs(bars.length), dn = NaNs(bars.length); let fu = NaN, fl = NaN, dir = 1; for (let i = 0; i < bars.length; i++) { if (isNaN(atr[i])) continue; const hl2 = (bars[i].h + bars[i].l) / 2; let bu = hl2 + p.mult * atr[i], bl = hl2 - p.mult * atr[i]; const pc = i ? bars[i - 1].c : bars[i].c; if (!isNaN(fl) && bl < fl && pc > fl) bl = fl; if (!isNaN(fu) && bu > fu && pc < fu) bu = fu; if (dir === 1 && bars[i].c < fl) dir = -1; else if (dir === -1 && bars[i].c > fu) dir = 1; fu = bu; fl = bl; if (dir === 1) up[i] = fl; else dn[i] = fu; } return { lines: { up, dn } }; } });
  def({ id: 'rsi', name: 'RSI', group: 'Classic', overlay: false, inputs: [{ key: 'len', label: 'Length', type: 'int', def: 14, min: 2, max: 200 }, srcInput], plots: [{ key: 'v', label: 'RSI', color: C.purple }], levels: [{ price: 70, color: 'rgba(229,72,77,0.45)' }, { price: 30, color: 'rgba(3,201,136,0.45)' }, { price: 50, color: 'rgba(139,147,160,0.35)' }], range: [0, 100],
    compute: (bars, p) => ({ lines: { v: ta.rsi(ta.src(bars, p.src), p.len) } }) });
  def({ id: 'macd', name: 'MACD', group: 'Classic', overlay: false, inputs: [{ key: 'fast', label: 'Fast', type: 'int', def: 12, min: 1, max: 200 }, { key: 'slow', label: 'Slow', type: 'int', def: 26, min: 1, max: 400 }, { key: 'sig', label: 'Signal', type: 'int', def: 9, min: 1, max: 100 }], plots: [{ key: 'h', label: 'Histogram', color: C.mint, type: 'hist' }, { key: 'm', label: 'MACD', color: C.blue }, { key: 's', label: 'Signal', color: C.amber }], levels: [{ price: 0, color: 'rgba(139,147,160,0.35)' }],
    compute: (bars, p) => { const x = ta.src(bars, 'close'); const f = ta.ema(x, p.fast), s = ta.ema(x, p.slow); const m = f.map((v, i) => v - s[i]); const sig = ta.ema(m.map((v) => isNaN(v) ? NaN : v), p.sig); return { lines: { m, s: sig, h: m.map((v, i) => v - sig[i]) } }; } });
  def({ id: 'atr', name: 'ATR', group: 'Classic', overlay: false, inputs: [{ key: 'len', label: 'Length', type: 'int', def: 14, min: 1, max: 200 }], plots: [{ key: 'v', label: 'ATR', color: C.amber }],
    compute: (bars, p) => ({ lines: { v: ta.atr(bars, p.len) } }) });
  def({ id: 'stoch', name: 'Stochastic', group: 'Classic', overlay: false, inputs: [{ key: 'k', label: '%K length', type: 'int', def: 14, min: 1, max: 200 }, { key: 'ks', label: '%K smoothing', type: 'int', def: 3, min: 1, max: 50 }, { key: 'd', label: '%D smoothing', type: 'int', def: 3, min: 1, max: 50 }], plots: [{ key: 'k', label: '%K', color: C.blue }, { key: 'd', label: '%D', color: C.amber }], levels: [{ price: 80, color: 'rgba(229,72,77,0.45)' }, { price: 20, color: 'rgba(3,201,136,0.45)' }], range: [0, 100],
    compute: (bars, p) => { const s = ta.stoch(bars, p.k, p.ks, p.d); return { lines: { k: s.k, d: s.d } }; } });
  def({ id: 'volma', name: 'Volume MA', group: 'Classic', overlay: false, inputs: [{ key: 'len', label: 'Length', type: 'int', def: 20, min: 1, max: 200 }], plots: [{ key: 'vol', label: 'Volume', color: C.grey, type: 'hist', byBar: true }, { key: 'ma', label: 'MA', color: C.amber }],
    compute: (bars, p) => { const v = bars.map((b) => b.v || 0); return { lines: { vol: v, ma: ta.sma(v, p.len) }, colors: { vol: bars.map((b) => b.c >= b.o ? 'rgba(3,201,136,0.5)' : 'rgba(229,72,77,0.5)') } }; } });

  // ---- ICT / smart money ------------------------------------------------------------
  def({ id: 'fvg', name: 'Fair value gaps', group: 'ICT', overlay: true, inputs: [{ key: 'minTicks', label: 'Min gap (ticks)', type: 'int', def: 1, min: 0, max: 400 }, { key: 'hideMit', label: 'Hide mitigated', type: 'bool', def: true }, { key: 'extend', label: 'Extend bars', type: 'int', def: 40, min: 5, max: 500 }], plots: [],
    compute: (bars, p, ctx) => { const shapes = []; const minGap = (p.minTicks || 0) * (ctx.tick || 0); for (let i = 2; i < bars.length; i++) { const a = bars[i - 2], c = bars[i]; if (c.l > a.h + minGap) { let end = null; for (let j = i + 1; j < bars.length; j++) { if (bars[j].l <= a.h) { end = j; break; } } if (end != null && p.hideMit) continue; shapes.push({ type: 'box', i0: i - 1, i1: end != null ? end : Math.min(bars.length - 1, i + p.extend), top: c.l, bottom: a.h, color: 'rgba(3,201,136,0.55)', fill: 'rgba(3,201,136,0.12)', text: 'FVG' }); } else if (c.h < a.l - minGap) { let end = null; for (let j = i + 1; j < bars.length; j++) { if (bars[j].h >= a.l) { end = j; break; } } if (end != null && p.hideMit) continue; shapes.push({ type: 'box', i0: i - 1, i1: end != null ? end : Math.min(bars.length - 1, i + p.extend), top: a.l, bottom: c.h, color: 'rgba(229,72,77,0.55)', fill: 'rgba(229,72,77,0.12)', text: 'FVG' }); } } return { lines: {}, shapes: shapes.slice(-120) }; } });
  def({ id: 'ob', name: 'Order blocks & breakers', group: 'ICT', overlay: true, inputs: [{ key: 'showBreakers', label: 'Show breakers', type: 'bool', def: true }, { key: 'hideMit', label: 'Hide mitigated', type: 'bool', def: true }, { key: 'body', label: 'Body only', type: 'bool', def: false }], plots: [],
    compute: (bars, p) => {
      // An order block is the last opposite candle before a displacement that leaves a fair value gap.
      const shapes = [];
      for (let i = 2; i < bars.length; i++) {
        const a = bars[i - 2], c = bars[i]; const bull = c.l > a.h, bear = c.h < a.l; if (!bull && !bear) continue;
        let k = i - 2; while (k > 0 && (bull ? bars[k].c >= bars[k].o : bars[k].c <= bars[k].o)) k--; if (k < 0) continue; const ob = bars[k];
        const top = p.body ? Math.max(ob.o, ob.c) : ob.h, bottom = p.body ? Math.min(ob.o, ob.c) : ob.l;
        let mit = null, broken = null;
        for (let j = i + 1; j < bars.length; j++) { if (bull ? bars[j].c < bottom : bars[j].c > top) { broken = j; break; } if (mit == null && (bull ? bars[j].l <= top : bars[j].h >= bottom)) mit = j; }
        const end = broken != null ? broken : null;
        if (!(p.hideMit && mit != null && broken == null)) shapes.push({ type: 'box', i0: k, i1: end, top, bottom, color: bull ? 'rgba(3,201,136,0.7)' : 'rgba(229,72,77,0.7)', fill: bull ? 'rgba(3,201,136,0.10)' : 'rgba(229,72,77,0.10)', text: bull ? 'OB+' : 'OB−' });
        if (p.showBreakers && broken != null) { let bm = null; for (let j = broken + 1; j < bars.length; j++) { if (bull ? bars[j].h >= bottom : bars[j].l <= top) { bm = j; break; } } if (!(p.hideMit && bm != null)) shapes.push({ type: 'box', i0: broken, i1: bm, top, bottom, color: bull ? 'rgba(229,72,77,0.7)' : 'rgba(3,201,136,0.7)', fill: bull ? 'rgba(229,72,77,0.08)' : 'rgba(3,201,136,0.08)', text: 'BRK', dashed: true }); }
      }
      return { lines: {}, shapes: shapes.slice(-80) }; } });
  def({ id: 'swings', name: 'Swing points & structure', group: 'ICT', overlay: true, inputs: [{ key: 'len', label: 'Strength', type: 'int', def: 5, min: 1, max: 50 }, { key: 'labels', label: 'HH/HL/LH/LL labels', type: 'bool', def: true }], plots: [],
    compute: (bars, p) => { const s = ta.swings(bars, p.len); const shapes = []; let lastH = null, lastL = null; const pts = s.hi.map((i) => ({ i, k: 'h' })).concat(s.lo.map((i) => ({ i, k: 'l' }))).sort((a, b) => a.i - b.i); for (const pt of pts) { if (pt.k === 'h') { const lbl = p.labels ? (lastH == null ? 'H' : bars[pt.i].h > lastH ? 'HH' : 'LH') : ''; lastH = bars[pt.i].h; shapes.push({ type: 'marker', i: pt.i, price: bars[pt.i].h, kind: 'down', color: C.red, text: lbl }); } else { const lbl = p.labels ? (lastL == null ? 'L' : bars[pt.i].l < lastL ? 'LL' : 'HL') : ''; lastL = bars[pt.i].l; shapes.push({ type: 'marker', i: pt.i, price: bars[pt.i].l, kind: 'up', color: C.mint, text: lbl }); } } return { lines: {}, shapes: shapes.slice(-200) }; } });
  def({ id: 'liq', name: 'Liquidity levels', group: 'ICT', overlay: true, inputs: [{ key: 'len', label: 'Swing strength', type: 'int', def: 5, min: 1, max: 50 }, { key: 'hideSwept', label: 'Hide swept', type: 'bool', def: false }, { key: 'eqTicks', label: 'Equal H/L tolerance (ticks)', type: 'int', def: 4, min: 0, max: 100 }], plots: [],
    compute: (bars, p, ctx) => { const s = ta.swings(bars, p.len); const shapes = []; const tol = p.eqTicks * (ctx.tick || 0); const mk = (idx, isHigh) => { for (let n = 0; n < idx.length; n++) { const i = idx[n]; const lvl = isHigh ? bars[i].h : bars[i].l; let swept = null; for (let j = i + 1; j < bars.length; j++) { if (isHigh ? bars[j].h > lvl : bars[j].l < lvl) { swept = j; break; } } if (swept != null && p.hideSwept) continue; const eq = n > 0 && Math.abs((isHigh ? bars[idx[n - 1]].h : bars[idx[n - 1]].l) - lvl) <= tol; shapes.push({ type: 'level', i0: i, i1: swept, price: lvl, color: isHigh ? 'rgba(229,72,77,0.8)' : 'rgba(3,201,136,0.8)', text: eq ? (isHigh ? 'EQH' : 'EQL') : (isHigh ? 'BSL' : 'SSL'), dashed: swept != null }); } }; mk(s.hi, true); mk(s.lo, false); return { lines: {}, shapes: shapes.slice(-120) }; } });
  const KZ = [{ k: 'asia', label: 'Asia', from: 20 * 60, to: 24 * 60, color: 'rgba(139,125,216,0.10)' }, { k: 'ldn', label: 'London', from: 2 * 60, to: 5 * 60, color: 'rgba(0,173,181,0.10)' }, { k: 'nyam', label: 'NY AM', from: 8 * 60 + 30, to: 11 * 60, color: 'rgba(3,201,136,0.10)' }, { k: 'nypm', label: 'NY PM', from: 13 * 60 + 30, to: 16 * 60, color: 'rgba(245,197,66,0.10)' }];
  def({ id: 'killzones', name: 'Killzones (ICT sessions)', group: 'ICT', overlay: true, inputs: [{ key: 'asia', label: 'Asia 20:00–00:00', type: 'bool', def: true }, { key: 'ldn', label: 'London 02:00–05:00', type: 'bool', def: true }, { key: 'nyam', label: 'NY AM 08:30–11:00', type: 'bool', def: true }, { key: 'nypm', label: 'NY PM 13:30–16:00', type: 'bool', def: true }], plots: [], intradayOnly: true,
    compute: (bars, p) => { const shapes = []; for (const z of KZ) { if (!p[z.k]) continue; let start = null; for (let i = 0; i <= bars.length; i++) { const b = bars[i]; const inZ = b ? (function () { const q = parts('America/New_York', b.t); return !q.weekend && q.min >= z.from && q.min < z.to; })() : false; if (inZ && start == null) start = i; if (!inZ && start != null) { shapes.push({ type: 'bg', i0: start, i1: i - 1, color: z.color, text: z.label }); start = null; } } } return { lines: {}, shapes: shapes.slice(-60) }; } });
  const SESS = [{ k: 'asia', label: 'Asia', from: 20 * 60, to: 24 * 60 + 2 * 60, color: C.purple }, { k: 'ldn', label: 'London', from: 2 * 60, to: 8 * 60 + 30, color: C.teal }, { k: 'ny', label: 'NY', from: 9 * 60 + 30, to: 16 * 60, color: C.amber }];
  def({ id: 'sesshl', name: 'Session highs & lows', group: 'ICT', overlay: true, inputs: [{ key: 'asia', label: 'Asia', type: 'bool', def: true }, { key: 'ldn', label: 'London', type: 'bool', def: true }, { key: 'ny', label: 'New York', type: 'bool', def: true }, { key: 'extend', label: 'Extend bars', type: 'int', def: 200, min: 10, max: 2000 }], plots: [], intradayOnly: true,
    compute: (bars, p) => { const shapes = []; for (const s of SESS) { if (!p[s.k]) continue; let cur = null; const flush = (endIdx) => { if (!cur) return; for (const [price, lbl] of [[cur.h, s.label + ' H'], [cur.l, s.label + ' L']]) { let swept = null; for (let j = endIdx + 1; j < Math.min(bars.length, endIdx + p.extend); j++) { if (lbl.endsWith('H') ? bars[j].h > price : bars[j].l < price) { swept = j; break; } } shapes.push({ type: 'level', i0: cur.i0, i1: swept != null ? swept : Math.min(bars.length - 1, endIdx + p.extend), price, color: s.color, text: lbl, dashed: swept != null }); } cur = null; }; for (let i = 0; i < bars.length; i++) { const q = parts('America/New_York', bars[i].t); const m = q.min < 2 * 60 ? q.min + 24 * 60 : q.min; const inS = !q.weekend && m >= s.from && m < s.to; if (inS) { if (!cur) cur = { i0: i, h: bars[i].h, l: bars[i].l }; else { cur.h = Math.max(cur.h, bars[i].h); cur.l = Math.min(cur.l, bars[i].l); } } else if (cur) flush(i - 1); } if (cur) flush(bars.length - 1); } return { lines: {}, shapes: shapes.slice(-60) }; } });
  def({ id: 'pdhl', name: 'Previous day / week high & low', group: 'ICT', overlay: true, inputs: [{ key: 'day', label: 'Previous day', type: 'bool', def: true }, { key: 'week', label: 'Previous week', type: 'bool', def: true }], plots: [],
    compute: (bars, p) => { const shapes = []; const days = []; let cur = null; for (let i = 0; i < bars.length; i++) { const q = parts('America/New_York', bars[i].t); if (!cur || cur.key !== q.dayKey) { cur = { key: q.dayKey, i0: i, i1: i, h: bars[i].h, l: bars[i].l, wd: q.wd }; days.push(cur); } else { cur.i1 = i; cur.h = Math.max(cur.h, bars[i].h); cur.l = Math.min(cur.l, bars[i].l); } } if (p.day) for (let d = 1; d < days.length; d++) { const prev = days[d - 1], cd = days[d]; shapes.push({ type: 'level', i0: cd.i0, i1: cd.i1, price: prev.h, color: 'rgba(230,230,230,0.7)', text: 'PDH' }); shapes.push({ type: 'level', i0: cd.i0, i1: cd.i1, price: prev.l, color: 'rgba(230,230,230,0.7)', text: 'PDL' }); } if (p.week) { const weeks = []; let w = null; for (const d of days) { if (!w || d.wd === 'Mon') { w = { i0: d.i0, i1: d.i1, h: d.h, l: d.l }; weeks.push(w); } else { w.i1 = d.i1; w.h = Math.max(w.h, d.h); w.l = Math.min(w.l, d.l); } } for (let k = 1; k < weeks.length; k++) { shapes.push({ type: 'level', i0: weeks[k].i0, i1: weeks[k].i1, price: weeks[k - 1].h, color: 'rgba(245,197,66,0.8)', text: 'PWH', dashed: true }); shapes.push({ type: 'level', i0: weeks[k].i0, i1: weeks[k].i1, price: weeks[k - 1].l, color: 'rgba(245,197,66,0.8)', text: 'PWL', dashed: true }); } } return { lines: {}, shapes: shapes.slice(-40) }; } });
  def({ id: 'orb', name: 'Opening range', group: 'ICT', overlay: true, inputs: [{ key: 'mins', label: 'Range minutes from 9:30', type: 'int', def: 30, min: 1, max: 120 }], plots: [], intradayOnly: true,
    compute: (bars, p) => { const shapes = []; let cur = null; for (let i = 0; i < bars.length; i++) { const q = parts('America/New_York', bars[i].t); if (q.weekend) continue; if (q.min >= 9 * 60 + 30 && q.min < 9 * 60 + 30 + p.mins) { if (!cur || cur.key !== q.dayKey) { cur = { key: q.dayKey, i0: i, i1: i, h: bars[i].h, l: bars[i].l }; shapes.push(cur); } else { cur.i1 = i; cur.h = Math.max(cur.h, bars[i].h); cur.l = Math.min(cur.l, bars[i].l); } } else if (cur && cur.key === q.dayKey && q.min >= 9 * 60 + 30 + p.mins && q.min < 16 * 60) cur.end = i; } const out = []; for (const r of shapes) { out.push({ type: 'box', i0: r.i0, i1: r.i1, top: r.h, bottom: r.l, color: 'rgba(79,140,255,0.8)', fill: 'rgba(79,140,255,0.10)', text: 'OR' }); out.push({ type: 'level', i0: r.i1, i1: r.end != null ? r.end : r.i1, price: r.h, color: 'rgba(79,140,255,0.8)', text: 'ORH', dashed: true }); out.push({ type: 'level', i0: r.i1, i1: r.end != null ? r.end : r.i1, price: r.l, color: 'rgba(79,140,255,0.8)', text: 'ORL', dashed: true }); } return { lines: {}, shapes: out.slice(-45) }; } });

  const indicators = {
    list: () => defs.map((d) => ({ id: d.id, name: d.name, group: d.group, overlay: d.overlay })),
    get: (id) => defs.find((d) => d.id === id) || null,
    defaults: (id) => { const d = indicators.get(id); const p = {}; if (d) for (const i of d.inputs) p[i.key] = i.def; return p; },
    compute: (id, params, bars, ctx) => { const d = indicators.get(id); if (!d) return { lines: {}, shapes: [] }; const p = Object.assign(indicators.defaults(id), params || {}); const out = d.compute(bars, p, ctx || {}); out.shapes = out.shapes || []; return out; }
  };
  return { indicators, ta, time };
});
