// Zscript built-in implementations. Every function has the shape fn(vm, args, st):
//   vm   = the running bar context (see vm.js: bar, n, B, st (state table), out, limits)
//   args = argument values in catalog order (defaults already filled by the compiler)
//   st   = this call site's state index (stateful functions) or output id (plots), else -1
// na is NaN for every type. Nothing here can reach the network, the DOM or storage.
import { ZsRuntimeError } from './errors.js?v=909';

const NA = NaN;
const isNa = (x) => x !== x || x === null || x === undefined;
const fin = (x) => typeof x === 'number' && x === x && x !== Infinity && x !== -Infinity;
export const MAX_STR = 4096;
export const MAX_ARR = 100000;
export const MAX_MAP = 50000;
export const MAX_ALLOC_PER_BAR = 1000000;
export const MAX_CELLS = 1000;

function str(x) { if (typeof x === 'string' && x.length > MAX_STR) throw new ZsRuntimeError('E407'); return x; }
function len(x, name) {
  if (!fin(x) || x < 1) throw new ZsRuntimeError('E412', { f: name, v: isNa(x) ? 'na' : x });
  return Math.floor(x);
}
function state(vm, st, init) { let s = vm.st[st]; if (s === undefined) { s = init(); vm.st[st] = s; } return s; }
export const MAX_ALLOC_TOTAL = 20000000;
// memory cap: items created per bar, and in total over one run (bounds what var arrays can hold)
function alloc(vm, n) {
  vm.allocated += n; vm.allocTotal = (vm.allocTotal || 0) + n;
  if (vm.allocated > MAX_ALLOC_PER_BAR) throw new ZsRuntimeError('E405', { lim: '1,000,000 new' });
  if (vm.allocTotal > MAX_ALLOC_TOTAL) throw new ZsRuntimeError('E405', { lim: '20,000,000 in one run' });
}
function arrOf(a, what) { if (!Array.isArray(a)) throw new ZsRuntimeError('E411', { what }); return a; }
function mapOf(m, what) { if (!(m instanceof Map)) throw new ZsRuntimeError('E411', { what }); return m; }
function growCheck(a, extra) { if (a.length + extra > MAX_ARR) throw new ZsRuntimeError('E405', { lim: '100,000' }); }
function idx(a, i) {
  if (!fin(i)) throw new ZsRuntimeError('E410', { i: 'na', n: a.length });
  let k = Math.trunc(i);
  if (k < 0) k += a.length;
  if (k < 0 || k >= a.length) throw new ZsRuntimeError('E410', { i: Math.trunc(i), n: a.length });
  return k;
}

// ---------- a fixed-size window of the last `size` values ----------
class Win {
  constructor(size) { this.size = size; this.a = new Array(size).fill(NA); this.i = 0; this.n = 0; this.run = 0; }
  push(x) { this.a[this.i] = x; this.i = (this.i + 1) % this.size; if (this.n < this.size) this.n++; this.run = fin(x) ? this.run + 1 : 0; }
  // k = 0 newest ... size-1 oldest
  get(k) { return this.a[(this.i - 1 - k + this.size * 2) % this.size]; }
  full() { return this.run >= this.size; }
}
function win(vm, st, size, key = 'w') {
  const s = state(vm, st, () => ({}));
  if (!s[key] || s[key].size !== size) s[key] = new Win(size);
  return s[key];
}

// ---------- streaming recursive average (EMA / RMA), seeded with the SMA ----------
// Same rules as the chart's built-in indicators: na resets, first value = SMA of `len` values.
function recursive(s, x, n, alpha) {
  if (!s.w || s.w.size !== n) { s.w = new Win(n); s.prev = NA; }
  if (!fin(x)) { s.w.push(NA); s.prev = NA; return NA; }
  s.w.push(x);
  if (fin(s.prev)) { s.prev = alpha * x + (1 - alpha) * s.prev; return s.prev; }
  if (s.w.run >= n) { let sum = 0; for (let k = 0; k < n; k++) sum += s.w.get(n - 1 - k); s.prev = sum / n; return s.prev; }
  return NA;
}
const ema1 = (s, x, n) => recursive(s, x, n, 2 / (n + 1));
const rma1 = (s, x, n) => recursive(s, x, n, 1 / n);
function sub(vm, st, key) { const s = state(vm, st, () => ({})); return s[key] || (s[key] = {}); }

function smaW(w, n) { if (!w.full()) return NA; let s = 0; for (let k = n - 1; k >= 0; k--) s += w.get(k); return s / n; }
function sumW(w, n) { if (!w.full()) return NA; let s = 0; for (let k = n - 1; k >= 0; k--) s += w.get(k); return s; }
function wmaW(w, n) {
  if (!w.full()) return NA;
  let s = 0; for (let k = 0; k < n; k++) s += w.get(n - 1 - k) * (k + 1);
  return s / (n * (n + 1) / 2);
}
function stdevW(w, n, biased) {
  if (!w.full()) return NA;
  let s = 0; for (let k = 0; k < n; k++) s += w.get(k);
  const mean = s / n; let sq = 0;
  for (let k = 0; k < n; k++) { const d = w.get(k) - mean; sq += d * d; }
  return Math.sqrt(sq / (biased || n < 2 ? n : n - 1));
}

// streaming SMA helper with its own window under a key
function smaK(vm, st, key, x, n) { const w = win(vm, st, n, key); w.push(x); return smaW(w, n); }
function wmaK(vm, st, key, x, n) { const w = win(vm, st, n, key); w.push(x); return wmaW(w, n); }
function emaK(vm, st, key, x, n) { return ema1(sub(vm, st, key), x, n); }
function rmaK(vm, st, key, x, n) { return rma1(sub(vm, st, key), x, n); }
function prevK(vm, st, key, x) { const s = state(vm, st, () => ({})); const p = s[key]; s[key] = x; return p === undefined ? NA : p; }

function trueRange(vm, handleNa) {
  const i = vm.bar, B = vm.B;
  if (i === 0) return handleNa ? B.high[0] - B.low[0] : NA;
  const pc = B.close[i - 1];
  return Math.max(B.high[i] - B.low[i], Math.abs(B.high[i] - pc), Math.abs(B.low[i] - pc));
}

// ---------- colors ----------
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
function parseColor(c) {
  if (typeof c !== 'string' || !/^#[0-9a-f]{8}$/.test(c)) return null;
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), parseInt(c.slice(7, 9), 16)];
}
const rgba = (r, g, b, a) => '#' + hex2(r) + hex2(g) + hex2(b) + hex2(a);
const transpToA = (t) => (100 - Math.max(0, Math.min(100, t))) / 100 * 255;

// ---------- number formatting ----------
// decimals of the tick size: 0.25 -> 2, 0.01 -> 2, 1 -> 0, 1e-8 -> 8
function tickDecimals(mt) { for (let d = 0; d <= 10; d++) if (Math.abs(Math.round(mt * 10 ** d) - mt * 10 ** d) < 1e-9) return d; return 10; }
export function formatNum(v, fmt, vm) {
  if (isNa(v)) return 'NaN';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  if (typeof v !== 'number') return String(v);
  if (fmt === 'percent') return formatNum(v, '#.##', vm) + '%';
  if (fmt === 'price' && vm) { const mt = vm.sym.mintick; const d = mt > 0 ? tickDecimals(mt) : 2; return v.toFixed(d); }
  if (fmt === 'volume') {
    const a = Math.abs(v);
    if (a >= 1e9) return +(v / 1e9).toFixed(3) + 'B';
    if (a >= 1e6) return +(v / 1e6).toFixed(3) + 'M';
    if (a >= 1e3) return +(v / 1e3).toFixed(3) + 'K';
    return String(+v.toFixed(3));
  }
  if (fmt && /^[#0,]*(\.[#0]*)?$/.test(fmt)) {
    const [ip, dp = ''] = fmt.split('.');
    const minD = (dp.match(/0/g) || []).length, maxD = dp.length;
    let s = v.toFixed(Math.min(maxD, 20));
    if (maxD > minD) s = s.replace(/0+$/, (m) => m.slice(0, Math.max(0, m.length - (maxD - minD))));
    s = s.replace(/\.$/, '');
    if (ip.includes(',')) { const [a, b] = s.split('.'); s = a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b !== undefined ? '.' + b : ''); }
    return s;
  }
  if (Number.isInteger(v)) return String(v);
  return String(+v.toPrecision(12));
}

// ---------- drawings ----------
const KINDS = { __proto__: null, label: 'labels', line: 'lines', box: 'boxes', table: 'tables' };
function newDrawing(vm, kind, obj) {
  const d = vm.draw[kind];
  const id = ++vm.drawSeq;
  obj.id = id;
  d.set(id, obj);
  const lim = vm.limits[KINDS[kind]];
  if (d.size > lim) {
    if (kind === 'table') { d.delete(id); throw new ZsRuntimeError('E408', { lim }); }
    d.delete(d.keys().next().value);   // oldest goes, like the chart does
  }
  return id;
}
function dget(vm, kind, id, what) {
  if (isNa(id)) return null;
  const o = vm.draw[kind].get(id);
  return o || null;
}
function setter(kind, field) {
  return (vm, a) => { const o = dget(vm, kind, a[0]); if (o) o[field] = a[1]; };
}
function getter(kind, field) {
  return (vm, a) => { const o = dget(vm, kind, a[0]); return o ? o[field] : NA; };
}
function copyDraw(kind) {
  return (vm, a) => { const o = dget(vm, kind, a[0]); if (!o) return NA; const c = Object.assign({}, o); if (c.cells) c.cells = new Map(o.cells); return newDrawing(vm, kind, c); };
}
function delDraw(kind) { return (vm, a) => { if (!isNa(a[0])) vm.draw[kind].delete(a[0]); }; }

// ---------- data namespaces (our data) ----------
function frame(vm, ns) {
  if (!vm.allowed[ns]) { vm.notice(ns, 'locked'); return null; }
  const arr = vm.data[ns];
  if (!arr) { vm.notice(ns, 'missing'); return null; }
  const f = Array.isArray(arr) ? arr[vm.bar] : null;
  if (!f) return null;
  // never use data stamped after this bar's close (no lookahead)
  if (fin(f.t) && f.t > vm.B.time_close[vm.bar]) return null;
  return f;
}
function flowArr(vm, key) {
  if (!vm.allowed.flow) { vm.notice('flow', 'locked'); return NA; }
  const d = vm.data.flow;
  if (!d) { vm.notice('flow', 'missing'); return NA; }
  const a = d[key];
  if (!a) return NA;
  const v = a[vm.bar];
  return fin(v) ? v : NA;
}
function levelOf(side, lvl) { if (!Array.isArray(side)) return null; const k = Math.trunc(fin(lvl) ? lvl : 0); return k >= 0 && k < side.length ? side[k] : null; }
function footRows(vm) {
  if (!vm.allowed.flow) { vm.notice('flow', 'locked'); return null; }
  const d = vm.data.flow;
  if (!d) { vm.notice('flow', 'missing'); return null; }
  return d.footprint ? d.footprint[vm.bar] || null : null;
}
function valueArea(rows) {
  // rows: [price, bidVol, askVol]; returns [poc, vah, val]
  if (!rows || !rows.length) return [NA, NA, NA];
  const r = rows.filter((x) => Array.isArray(x) && fin(x[0])).map((x) => [x[0], (fin(x[1]) ? x[1] : 0) + (fin(x[2]) ? x[2] : 0)]).sort((a, b) => a[0] - b[0]);
  if (!r.length) return [NA, NA, NA];
  let pi = 0, total = 0;
  for (let i = 0; i < r.length; i++) { total += r[i][1]; if (r[i][1] > r[pi][1]) pi = i; }
  let lo = pi, hi = pi, acc = r[pi][1];
  while (acc < total * 0.7 && (lo > 0 || hi < r.length - 1)) {
    const up = hi < r.length - 1 ? r[hi + 1][1] : -1, dn = lo > 0 ? r[lo - 1][1] : -1;
    if (up >= dn) { hi++; acc += r[hi][1]; } else { lo--; acc += r[lo][1]; }
  }
  return [r[pi][0], r[hi][0], r[lo][0]];
}

// deterministic PRNG (mulberry32)
function rand(seed) { let t = (seed + 0x6D2B79F5) | 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

const cmpAsc = (x, y) => (isNa(x) ? 1 : isNa(y) ? -1 : x < y ? -1 : x > y ? 1 : 0);
const nums = (a) => a.filter(fin);

// ---------- the table ----------
export const BUILTINS = { __proto__: null,
  // general
  na: (vm, a) => isNa(a[0]),
  nz: (vm, a) => (isNa(a[0]) ? a[1] : a[0]),
  fixnan: (vm, a, st) => { const s = state(vm, st, () => ({ v: NA })); if (!isNa(a[0])) s.v = a[0]; return s.v; },
  int: (vm, a) => (typeof a[0] === 'boolean' ? +a[0] : fin(a[0]) ? Math.trunc(a[0]) : NA),
  float: (vm, a) => (typeof a[0] === 'boolean' ? +a[0] : typeof a[0] === 'number' ? a[0] : NA),
  bool: (vm, a) => (a[0] === true || (typeof a[0] === 'number' && a[0] === a[0] && a[0] !== 0)),
  string: (vm, a) => (typeof a[0] === 'string' ? a[0] : NA),
  color: (vm, a) => (typeof a[0] === 'string' ? a[0] : NA),
  timestamp: (vm, a) => (a.slice(0, 6).every(fin) ? Date.UTC(a[0], a[1] - 1, a[2], a[3], a[4], a[5]) : NA),

  // ta
  'ta.sma': (vm, a, st) => smaK(vm, st, 'w', a[0], len(a[1], 'ta.sma')),
  'ta.ema': (vm, a, st) => emaK(vm, st, 'e', a[0], len(a[1], 'ta.ema')),
  'ta.rma': (vm, a, st) => rmaK(vm, st, 'r', a[0], len(a[1], 'ta.rma')),
  'ta.wma': (vm, a, st) => wmaK(vm, st, 'w', a[0], len(a[1], 'ta.wma')),
  'ta.vwma': (vm, a, st) => {
    const n = len(a[1], 'ta.vwma'); const v = vm.B.volume[vm.bar];
    const pv = win(vm, st, n, 'pv'), vv = win(vm, st, n, 'v');
    pv.push(fin(a[0]) && fin(v) ? a[0] * v : NA); vv.push(fin(v) ? v : NA);
    const s1 = sumW(pv, n), s2 = sumW(vv, n);
    return fin(s1) && fin(s2) && s2 > 0 ? s1 / s2 : NA;
  },
  'ta.hma': (vm, a, st) => {
    const n = Math.max(2, Math.trunc(len(a[1], 'ta.hma')));
    const h = Math.max(1, Math.trunc(n / 2)), r = Math.max(1, Math.round(Math.sqrt(n)));
    const w1 = wmaK(vm, st, 'a', a[0], h), w2 = wmaK(vm, st, 'b', a[0], n);
    return wmaK(vm, st, 'c', fin(w1) && fin(w2) ? 2 * w1 - w2 : NA, r);
  },
  'ta.alma': (vm, a, st) => {
    const n = len(a[1], 'ta.alma'); const w = win(vm, st, n, 'w'); w.push(a[0]);
    if (!w.full()) return NA;
    const m = a[2] * (n - 1), s = n / Math.max(a[3], 1e-9);
    let acc = 0, norm = 0;
    for (let i = 0; i < n; i++) { const d = i - m; const wt = Math.exp(-(d * d) / (2 * s * s)); norm += wt; acc += w.get(n - 1 - i) * wt; }
    return norm === 0 ? NA : acc / norm;
  },
  'ta.swma': (vm, a, st) => { const w = win(vm, st, 4, 'w'); w.push(a[0]); return w.full() ? (w.get(3) + 2 * w.get(2) + 2 * w.get(1) + w.get(0)) / 6 : NA; },
  'ta.rsi': (vm, a, st) => {
    const n = len(a[1], 'ta.rsi');
    const p = prevK(vm, st, 'p', a[0]);
    const d = fin(a[0]) && fin(p) ? a[0] - p : NA;
    const u = rmaK(vm, st, 'u', fin(d) ? Math.max(d, 0) : NA, n), w = rmaK(vm, st, 'd', fin(d) ? Math.max(-d, 0) : NA, n);
    if (!fin(u) || !fin(w)) return NA;
    return w === 0 ? 100 : 100 - 100 / (1 + u / w);
  },
  'ta.macd': (vm, a, st) => {
    const f = emaK(vm, st, 'f', a[0], len(a[1], 'ta.macd')), s = emaK(vm, st, 's', a[0], len(a[2], 'ta.macd'));
    const m = fin(f) && fin(s) ? f - s : NA;
    const sig = emaK(vm, st, 'g', m, len(a[3], 'ta.macd'));
    return [m, sig, fin(m) && fin(sig) ? m - sig : NA];
  },
  'ta.stoch': (vm, a, st) => {
    const n = len(a[3], 'ta.stoch');
    const hw = win(vm, st, n, 'h'), lw = win(vm, st, n, 'l'); hw.push(a[1]); lw.push(a[2]);
    if (!hw.full() || !lw.full() || !fin(a[0])) return NA;
    let h = -Infinity, l = Infinity;
    for (let k = 0; k < n; k++) { h = Math.max(h, hw.get(k)); l = Math.min(l, lw.get(k)); }
    return h === l ? 50 : 100 * (a[0] - l) / (h - l);
  },
  'ta.tr': (vm, a) => trueRange(vm, a[0] === true),
  'ta.atr': (vm, a, st) => rmaK(vm, st, 'r', trueRange(vm, true), len(a[0], 'ta.atr')),
  'ta.bb': (vm, a, st) => {
    const n = len(a[1], 'ta.bb'); const w = win(vm, st, n, 'w'); w.push(a[0]);
    const m = smaW(w, n), d = stdevW(w, n, true) * a[2];
    return [m, fin(m) ? m + d : NA, fin(m) ? m - d : NA];
  },
  'ta.bbw': (vm, a, st) => {
    const n = len(a[1], 'ta.bbw'); const w = win(vm, st, n, 'w'); w.push(a[0]);
    const m = smaW(w, n), d = stdevW(w, n, true) * a[2];
    return fin(m) && m !== 0 ? (2 * d) / m * 100 : NA;
  },
  'ta.kc': (vm, a, st) => {
    const n = len(a[1], 'ta.kc');
    const b = emaK(vm, st, 'b', a[0], n);
    const r = a[3] ? trueRange(vm, false) : vm.B.high[vm.bar] - vm.B.low[vm.bar];
    const re = emaK(vm, st, 'r', r, n);
    return [b, fin(b) && fin(re) ? b + re * a[2] : NA, fin(b) && fin(re) ? b - re * a[2] : NA];
  },
  'ta.kcw': (vm, a, st) => {
    const n = len(a[1], 'ta.kcw');
    const b = emaK(vm, st, 'b', a[0], n);
    const r = a[3] ? trueRange(vm, false) : vm.B.high[vm.bar] - vm.B.low[vm.bar];
    const re = emaK(vm, st, 'r', r, n);
    return fin(b) && fin(re) && b !== 0 ? (2 * re * a[2]) / b : NA;
  },
  'ta.cci': (vm, a, st) => {
    const n = len(a[1], 'ta.cci'); const w = win(vm, st, n, 'w'); w.push(a[0]);
    const m = smaW(w, n); if (!fin(m)) return NA;
    let dev = 0; for (let k = 0; k < n; k++) dev += Math.abs(w.get(k) - m); dev /= n;
    return dev === 0 ? 0 : (a[0] - m) / (0.015 * dev);
  },
  'ta.mfi': (vm, a, st) => {
    const n = len(a[1], 'ta.mfi'); const v = vm.B.volume[vm.bar];
    const p = prevK(vm, st, 'p', a[0]);
    const ch = fin(a[0]) && fin(p) ? a[0] - p : NA;
    const uw = win(vm, st, n, 'u'), dw = win(vm, st, n, 'd');
    uw.push(fin(ch) ? (ch <= 0 ? 0 : v * a[0]) : NA); dw.push(fin(ch) ? (ch >= 0 ? 0 : v * a[0]) : NA);
    const up = sumW(uw, n), dn = sumW(dw, n);
    if (!fin(up) || !fin(dn)) return NA;
    return dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  },
  __obv: (vm, a, st) => {
    const s = state(vm, st, () => ({ v: 0 })); const i = vm.bar;
    if (i > 0) { const d = vm.B.close[i] - vm.B.close[i - 1]; const vol = vm.B.volume[i]; if (fin(d) && fin(vol)) s.v += Math.sign(d) * vol; }
    return s.v;
  },
  __accdist: (vm, a, st) => {
    const s = state(vm, st, () => ({ v: 0 })); const i = vm.bar, B = vm.B;
    const r = B.high[i] - B.low[i];
    const mfm = r === 0 ? 0 : ((B.close[i] - B.low[i]) - (B.high[i] - B.close[i])) / r;
    if (fin(mfm) && fin(B.volume[i])) s.v += mfm * B.volume[i];
    return s.v;
  },
  'ta.vwap': (vm, a, st) => {
    const s = state(vm, st, () => ({ pv: 0, v: 0, key: null }));
    const t = new Date(vm.B.time[vm.bar]);
    const anchor = a[1] || 'D';
    const key = anchor === 'W' ? Math.floor((vm.B.time[vm.bar] / 86400000 + 3) / 7) : anchor === 'M' ? t.getUTCFullYear() * 12 + t.getUTCMonth() : Math.floor(vm.B.time[vm.bar] / 86400000);
    if (key !== s.key) { s.key = key; s.pv = 0; s.v = 0; }
    const vol = vm.B.volume[vm.bar];
    if (fin(a[0]) && fin(vol)) { s.pv += a[0] * vol; s.v += vol; }
    return s.v > 0 ? s.pv / s.v : NA;
  },
  'ta.cum': (vm, a, st) => { const s = state(vm, st, () => ({ v: 0 })); if (fin(a[0])) s.v += a[0]; return s.v; },
  'ta.change': (vm, a, st) => {
    const n = Math.max(1, Math.trunc(fin(a[1]) ? a[1] : 1)); const w = win(vm, st, n + 1, 'w');
    w.push(typeof a[0] === 'boolean' ? +a[0] : a[0]);
    if (w.n <= n) return typeof a[0] === 'boolean' ? false : NA;
    const d = w.get(0) - w.get(n);
    return typeof a[0] === 'boolean' ? d !== 0 : d;
  },
  'ta.mom': (vm, a, st) => { const n = len(a[1], 'ta.mom'); const w = win(vm, st, n + 1, 'w'); w.push(a[0]); return w.n > n ? w.get(0) - w.get(n) : NA; },
  'ta.roc': (vm, a, st) => { const n = len(a[1], 'ta.roc'); const w = win(vm, st, n + 1, 'w'); w.push(a[0]); if (w.n <= n) return NA; const b = w.get(n); return fin(b) && b !== 0 ? 100 * (w.get(0) - b) / b : NA; },
  'ta.crossover': (vm, a, st) => { const s = state(vm, st, () => ({ a: NA, b: NA })); const r = a[0] > a[1] && s.a <= s.b; s.a = a[0]; s.b = a[1]; return r; },
  'ta.crossunder': (vm, a, st) => { const s = state(vm, st, () => ({ a: NA, b: NA })); const r = a[0] < a[1] && s.a >= s.b; s.a = a[0]; s.b = a[1]; return r; },
  'ta.cross': (vm, a, st) => { const s = state(vm, st, () => ({ a: NA, b: NA })); const r = (a[0] > a[1] && s.a <= s.b) || (a[0] < a[1] && s.a >= s.b); s.a = a[0]; s.b = a[1]; return r; },
  'ta.highest': (vm, a, st) => { const n = len(a[1], 'ta.highest'); const w = win(vm, st, n); w.push(a[0]); if (!w.full()) return NA; let m = -Infinity; for (let k = 0; k < n; k++) m = Math.max(m, w.get(k)); return m; },
  'ta.lowest': (vm, a, st) => { const n = len(a[1], 'ta.lowest'); const w = win(vm, st, n); w.push(a[0]); if (!w.full()) return NA; let m = Infinity; for (let k = 0; k < n; k++) m = Math.min(m, w.get(k)); return m; },
  'ta.highestbars': (vm, a, st) => { const n = len(a[1], 'ta.highestbars'); const w = win(vm, st, n); w.push(a[0]); if (!w.full()) return NA; let m = -Infinity, at = 0; for (let k = n - 1; k >= 0; k--) if (w.get(k) >= m) { m = w.get(k); at = k; } return -at; },
  'ta.lowestbars': (vm, a, st) => { const n = len(a[1], 'ta.lowestbars'); const w = win(vm, st, n); w.push(a[0]); if (!w.full()) return NA; let m = Infinity, at = 0; for (let k = n - 1; k >= 0; k--) if (w.get(k) <= m) { m = w.get(k); at = k; } return -at; },
  'ta.pivothigh': (vm, a, st) => pivot(vm, a, st, 1),
  'ta.pivotlow': (vm, a, st) => pivot(vm, a, st, -1),
  'ta.valuewhen': (vm, a, st) => {
    const s = state(vm, st, () => ({ vals: [] }));
    const occ = Math.max(0, Math.trunc(fin(a[2]) ? a[2] : 0));
    if (a[0] === true || (typeof a[0] === 'number' && a[0] && a[0] === a[0])) { s.vals.push(a[1]); if (s.vals.length > 5001) s.vals.shift(); }
    const k = s.vals.length - 1 - occ;
    return k >= 0 ? s.vals[k] : NA;
  },
  'ta.barssince': (vm, a, st) => { const s = state(vm, st, () => ({ last: -1 })); if (a[0] === true) s.last = vm.bar; return s.last < 0 ? NA : vm.bar - s.last; },
  'ta.stdev': (vm, a, st) => { const n = len(a[1], 'ta.stdev'); const w = win(vm, st, n); w.push(a[0]); return stdevW(w, n, a[2] !== false); },
  'ta.variance': (vm, a, st) => { const n = len(a[1], 'ta.variance'); const w = win(vm, st, n); w.push(a[0]); const s = stdevW(w, n, a[2] !== false); return s * s; },
  'ta.dev': (vm, a, st) => { const n = len(a[1], 'ta.dev'); const w = win(vm, st, n); w.push(a[0]); const m = smaW(w, n); if (!fin(m)) return NA; let d = 0; for (let k = 0; k < n; k++) d += Math.abs(w.get(k) - m); return d / n; },
  'ta.correlation': (vm, a, st) => {
    const n = len(a[2], 'ta.correlation'); const x = win(vm, st, n, 'x'), y = win(vm, st, n, 'y'); x.push(a[0]); y.push(a[1]);
    if (!x.full() || !y.full()) return NA;
    let sx = 0, sy = 0; for (let k = 0; k < n; k++) { sx += x.get(k); sy += y.get(k); }
    const mx = sx / n, my = sy / n; let cxy = 0, cxx = 0, cyy = 0;
    for (let k = 0; k < n; k++) { const dx = x.get(k) - mx, dy = y.get(k) - my; cxy += dx * dy; cxx += dx * dx; cyy += dy * dy; }
    const den = Math.sqrt(cxx * cyy);
    return den === 0 ? NA : cxy / den;
  },
  'ta.linreg': (vm, a, st) => {
    const n = len(a[1], 'ta.linreg'); const w = win(vm, st, n); w.push(a[0]);
    if (!w.full()) return NA;
    const off = fin(a[2]) ? a[2] : 0;
    const sx = (n - 1) * n / 2, sxx = (n - 1) * n * (2 * n - 1) / 6, den = n * sxx - sx * sx;
    let sy = 0, sxy = 0;
    for (let x = 0; x < n; x++) { const v = w.get(n - 1 - x); sy += v; sxy += x * v; }
    const slope = den === 0 ? 0 : (n * sxy - sx * sy) / den;
    const icpt = (sy - slope * sx) / n;
    return icpt + slope * (n - 1 - off);
  },
  'ta.supertrend': (vm, a, st) => {
    const s = state(vm, st, () => ({ up: NA, lo: NA, st: NA, dir: 1, atrPrev: NA }));
    const B = vm.B, i = vm.bar;
    const atr = rmaK(vm, st, 'atr', trueRange(vm, true), len(a[1], 'ta.supertrend'));
    const src = (B.high[i] + B.low[i]) / 2;
    let up = src + a[0] * atr, lo = src - a[0] * atr;
    const pc = i > 0 ? B.close[i - 1] : NA;
    const pLo = fin(s.lo) ? s.lo : 0, pUp = fin(s.up) ? s.up : 0;
    lo = lo > pLo || pc < pLo ? lo : pLo;
    up = up < pUp || pc > pUp ? up : pUp;
    let dir;
    if (!fin(s.atrPrev)) dir = 1;
    else if (s.st === s.up) dir = B.close[i] > up ? -1 : 1;
    else dir = B.close[i] < lo ? 1 : -1;
    const line = dir === -1 ? lo : up;
    s.atrPrev = atr; s.up = up; s.lo = lo; s.st = line; s.dir = dir;
    return fin(atr) ? [line, dir] : [NA, NA];
  },
  'ta.percentrank': (vm, a, st) => {
    const n = len(a[1], 'ta.percentrank'); const w = win(vm, st, n + 1); w.push(a[0]);
    if (w.n <= n || !fin(a[0])) return NA;
    let below = 0; for (let k = 1; k <= n; k++) { const y = w.get(k); if (!fin(y)) return NA; if (y <= a[0]) below++; }
    return 100 * below / n;
  },
  'ta.median': (vm, a, st) => { const n = len(a[1], 'ta.median'); const w = win(vm, st, n); w.push(a[0]); if (!w.full()) return NA; const v = []; for (let k = 0; k < n; k++) v.push(w.get(k)); return median(v); },
  'ta.mode': (vm, a, st) => {
    const n = len(a[1], 'ta.mode'); const w = win(vm, st, n); w.push(a[0]); if (!w.full()) return NA;
    const c = new Map(); let best = NA, bc = 0;
    for (let k = 0; k < n; k++) { const v = w.get(k); const m = (c.get(v) || 0) + 1; c.set(v, m); if (m > bc || (m === bc && v < best)) { bc = m; best = v; } }
    return best;
  },
  'ta.range': (vm, a, st) => { const n = len(a[1], 'ta.range'); const w = win(vm, st, n); w.push(a[0]); if (!w.full()) return NA; let h = -Infinity, l = Infinity; for (let k = 0; k < n; k++) { h = Math.max(h, w.get(k)); l = Math.min(l, w.get(k)); } return h - l; },
  'ta.rising': (vm, a, st) => { const n = len(a[1], 'ta.rising'); const w = win(vm, st, n + 1); w.push(a[0]); if (w.n <= n) return false; for (let k = 0; k < n; k++) if (!(w.get(k) > w.get(k + 1))) return false; return true; },
  'ta.falling': (vm, a, st) => { const n = len(a[1], 'ta.falling'); const w = win(vm, st, n + 1); w.push(a[0]); if (w.n <= n) return false; for (let k = 0; k < n; k++) if (!(w.get(k) < w.get(k + 1))) return false; return true; },
  'ta.dmi': (vm, a, st) => {
    const n = len(a[0], 'ta.dmi'), m = len(a[1], 'ta.dmi'); const B = vm.B, i = vm.bar;
    let pdm = NA, mdm = NA;
    if (i > 0) { const up = B.high[i] - B.high[i - 1], dn = B.low[i - 1] - B.low[i]; pdm = up > dn && up > 0 ? up : 0; mdm = dn > up && dn > 0 ? dn : 0; }
    const tr = rmaK(vm, st, 't', trueRange(vm, true), n);
    const p = rmaK(vm, st, 'p', pdm, n), q = rmaK(vm, st, 'q', mdm, n);
    const pdi = fin(p) && fin(tr) ? (tr === 0 ? 0 : 100 * p / tr) : NA, mdi = fin(q) && fin(tr) ? (tr === 0 ? 0 : 100 * q / tr) : NA;
    const dx = fin(pdi) && fin(mdi) ? (pdi + mdi === 0 ? 0 : 100 * Math.abs(pdi - mdi) / (pdi + mdi)) : NA;
    return [pdi, mdi, rmaK(vm, st, 'x', dx, m)];
  },
  'ta.wpr': (vm, a, st) => {
    const n = len(a[0], 'ta.wpr'); const B = vm.B, i = vm.bar;
    const hw = win(vm, st, n, 'h'), lw = win(vm, st, n, 'l'); hw.push(B.high[i]); lw.push(B.low[i]);
    if (!hw.full()) return NA;
    let h = -Infinity, l = Infinity; for (let k = 0; k < n; k++) { h = Math.max(h, hw.get(k)); l = Math.min(l, lw.get(k)); }
    return h === l ? NA : 100 * (B.close[i] - h) / (h - l);
  },
  'ta.cmo': (vm, a, st) => {
    const n = len(a[1], 'ta.cmo'); const p = prevK(vm, st, 'p', a[0]); const d = fin(a[0]) && fin(p) ? a[0] - p : NA;
    const uw = win(vm, st, n, 'u'), dw = win(vm, st, n, 'd'); uw.push(fin(d) ? Math.max(d, 0) : NA); dw.push(fin(d) ? Math.max(-d, 0) : NA);
    const u = sumW(uw, n), w = sumW(dw, n); if (!fin(u) || !fin(w)) return NA;
    return u + w === 0 ? 0 : 100 * (u - w) / (u + w);
  },
  'ta.tsi': (vm, a, st) => {
    const sh = len(a[1], 'ta.tsi'), lg = len(a[2], 'ta.tsi'); const p = prevK(vm, st, 'p', a[0]); const d = fin(a[0]) && fin(p) ? a[0] - p : NA;
    const n1 = emaK(vm, st, 'b', emaK(vm, st, 'a', d, lg), sh);
    const d1 = emaK(vm, st, 'd', emaK(vm, st, 'c', fin(d) ? Math.abs(d) : NA, lg), sh);
    return fin(n1) && fin(d1) && d1 !== 0 ? n1 / d1 : NA;
  },
  'ta.sar': (vm, a, st) => {
    const s = state(vm, st, () => ({ init: false }));
    const B = vm.B, i = vm.bar, [start, inc, max] = a;
    if (i === 0) { s.init = false; return NA; }
    if (!s.init) {
      s.init = true; s.long = B.close[i] >= B.close[i - 1];
      s.ep = s.long ? Math.max(B.high[i], B.high[i - 1]) : Math.min(B.low[i], B.low[i - 1]);
      s.sar = s.long ? Math.min(B.low[i], B.low[i - 1]) : Math.max(B.high[i], B.high[i - 1]);
      s.af = start; return s.sar;
    }
    let sar = s.sar + s.af * (s.ep - s.sar);
    if (s.long) {
      sar = Math.min(sar, B.low[i - 1], i > 1 ? B.low[i - 2] : B.low[i - 1]);
      if (B.low[i] < sar) { s.long = false; sar = s.ep; s.ep = B.low[i]; s.af = start; }
      else if (B.high[i] > s.ep) { s.ep = B.high[i]; s.af = Math.min(max, s.af + inc); }
    } else {
      sar = Math.max(sar, B.high[i - 1], i > 1 ? B.high[i - 2] : B.high[i - 1]);
      if (B.high[i] > sar) { s.long = true; sar = s.ep; s.ep = B.high[i]; s.af = start; }
      else if (B.low[i] < s.ep) { s.ep = B.low[i]; s.af = Math.min(max, s.af + inc); }
    }
    s.sar = sar;
    return sar;
  },

  // math
  'math.abs': (vm, a) => Math.abs(a[0]),
  'math.sign': (vm, a) => Math.sign(a[0]),
  'math.sqrt': (vm, a) => (a[0] < 0 ? NA : Math.sqrt(a[0])),
  'math.exp': (vm, a) => Math.exp(a[0]),
  'math.log': (vm, a) => (a[0] <= 0 ? NA : Math.log(a[0])),
  'math.log10': (vm, a) => (a[0] <= 0 ? NA : Math.log10(a[0])),
  'math.pow': (vm, a) => { const r = Math.pow(a[0], a[1]); return fin(r) ? r : NA; },
  'math.round': (vm, a) => { if (!fin(a[0])) return NA; if (!fin(a[1])) return Math.round(a[0]); const p = Math.pow(10, Math.max(0, Math.min(15, Math.trunc(a[1])))); return Math.round(a[0] * p) / p; },
  'math.floor': (vm, a) => Math.floor(a[0]),
  'math.ceil': (vm, a) => Math.ceil(a[0]),
  'math.min': (vm, a) => { let m = Infinity; for (const x of a) { if (!fin(x)) return NA; if (x < m) m = x; } return a.length ? m : NA; },
  'math.max': (vm, a) => { let m = -Infinity; for (const x of a) { if (!fin(x)) return NA; if (x > m) m = x; } return a.length ? m : NA; },
  'math.avg': (vm, a) => { let s = 0; for (const x of a) { if (!fin(x)) return NA; s += x; } return a.length ? s / a.length : NA; },
  'math.sum': (vm, a, st) => { const n = len(a[1], 'math.sum'); const w = win(vm, st, n); w.push(a[0]); return sumW(w, n); },
  'math.sin': (vm, a) => Math.sin(a[0]), 'math.cos': (vm, a) => Math.cos(a[0]), 'math.tan': (vm, a) => Math.tan(a[0]),
  'math.asin': (vm, a) => Math.asin(a[0]), 'math.acos': (vm, a) => Math.acos(a[0]), 'math.atan': (vm, a) => Math.atan(a[0]),
  'math.todegrees': (vm, a) => a[0] * 180 / Math.PI,
  'math.toradians': (vm, a) => a[0] * Math.PI / 180,
  'math.random': (vm, a, st) => {
    const s = state(vm, st, () => ({ k: 0 }));
    const seed = fin(a[2]) ? Math.trunc(a[2]) : 0;
    const r = rand((seed * 1000003 + vm.bar * 7919 + (s.k++)) | 0);
    return a[0] + r * (a[1] - a[0]);
  },
  'math.round_to_mintick': (vm, a) => { const t = vm.sym.mintick; return fin(a[0]) && t > 0 ? Math.round(a[0] / t) * t : a[0]; },

  // str
  'str.tostring': (vm, a) => str(formatNum(a[0], a[1], vm)),
  'str.tonumber': (vm, a) => { if (typeof a[0] !== 'string' || !/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(a[0])) return NA; return Number(a[0]); },
  'str.length': (vm, a) => (typeof a[0] === 'string' ? a[0].length : NA),
  'str.contains': (vm, a) => typeof a[0] === 'string' && typeof a[1] === 'string' && a[0].includes(a[1]),
  'str.startswith': (vm, a) => typeof a[0] === 'string' && typeof a[1] === 'string' && a[0].startsWith(a[1]),
  'str.endswith': (vm, a) => typeof a[0] === 'string' && typeof a[1] === 'string' && a[0].endsWith(a[1]),
  'str.pos': (vm, a) => { if (typeof a[0] !== 'string' || typeof a[1] !== 'string') return NA; const k = a[0].indexOf(a[1]); return k < 0 ? NA : k; },
  'str.substring': (vm, a) => (typeof a[0] === 'string' ? a[0].substring(fin(a[1]) ? a[1] : 0, fin(a[2]) ? a[2] : undefined) : NA),
  'str.replace': (vm, a) => {
    if (typeof a[0] !== 'string' || typeof a[1] !== 'string' || typeof a[2] !== 'string' || a[1] === '') return a[0];
    let from = 0, k = -1; const occ = fin(a[3]) ? a[3] : 0;
    for (let n = 0; n <= occ; n++) { k = a[0].indexOf(a[1], from); if (k < 0) return a[0]; from = k + a[1].length; }
    return str(a[0].slice(0, k) + a[2] + a[0].slice(k + a[1].length));
  },
  'str.replace_all': (vm, a) => (typeof a[0] === 'string' && typeof a[1] === 'string' && typeof a[2] === 'string' && a[1] !== '' ? str(a[0].split(a[1]).join(a[2])) : a[0]),
  'str.lower': (vm, a) => (typeof a[0] === 'string' ? a[0].toLowerCase() : NA),
  'str.upper': (vm, a) => (typeof a[0] === 'string' ? a[0].toUpperCase() : NA),
  'str.trim': (vm, a) => (typeof a[0] === 'string' ? a[0].trim() : NA),
  'str.split': (vm, a) => { if (typeof a[0] !== 'string') return NA; const r = a[0].split(typeof a[1] === 'string' ? a[1] : ''); if (r.length > MAX_ARR) throw new ZsRuntimeError('E405', { lim: '100,000' }); alloc(vm, r.length); return r; },
  'str.format': (vm, a) => {
    if (typeof a[0] !== 'string') return NA;
    return str(a[0].replace(/\{(\d+)(?:,\s*number\s*,\s*([^}]*))?(?:,\s*(percent|integer))?\}/g, (m, n, f, kind) => {
      const v = a[1 + Number(n)];
      if (v === undefined) return m;
      if (kind === 'integer') return formatNum(Math.round(v), '', vm);
      if (kind === 'percent') return formatNum(v * 100, '#.##', vm) + '%';
      return formatNum(v, f ? f.trim() : '', vm);
    }));
  },
  'str.repeat': (vm, a) => { if (typeof a[0] !== 'string' || !fin(a[1]) || a[1] < 0) return NA; const n = Math.trunc(a[1]); const sep = typeof a[2] === 'string' ? a[2] : ''; if ((a[0].length + sep.length) * n > MAX_STR) throw new ZsRuntimeError('E407'); return new Array(n).fill(a[0]).join(sep); },

  // color
  'color.new': (vm, a) => { const c = parseColor(a[0]); return c && fin(a[1]) ? rgba(c[0], c[1], c[2], transpToA(a[1])) : (c ? a[0] : NA); },
  'color.rgb': (vm, a) => (fin(a[0]) && fin(a[1]) && fin(a[2]) ? rgba(a[0], a[1], a[2], transpToA(fin(a[3]) ? a[3] : 0)) : NA),
  'color.from_gradient': (vm, a) => {
    const [v, lo, hi] = a; const c1 = parseColor(a[3]), c2 = parseColor(a[4]);
    if (!fin(v) || !c1 || !c2) return NA;
    const t = hi === lo ? 0 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    return rgba(...c1.map((x, k) => x + (c2[k] - x) * t));
  },
  'color.r': (vm, a) => { const c = parseColor(a[0]); return c ? c[0] : NA; },
  'color.g': (vm, a) => { const c = parseColor(a[0]); return c ? c[1] : NA; },
  'color.b': (vm, a) => { const c = parseColor(a[0]); return c ? c[2] : NA; },
  'color.t': (vm, a) => { const c = parseColor(a[0]); return c ? Math.round((1 - c[3] / 255) * 100) : NA; },

  // arrays
  'array.new': (vm, a) => newArr(vm, a[0], a[1]),
  'array.new_float': (vm, a) => newArr(vm, a[0], a[1]), 'array.new_int': (vm, a) => newArr(vm, a[0], a[1]),
  'array.new_bool': (vm, a) => newArr(vm, a[0], a[1]), 'array.new_string': (vm, a) => newArr(vm, a[0], a[1]),
  'array.new_color': (vm, a) => newArr(vm, a[0], a[1]), 'array.new_label': (vm, a) => newArr(vm, a[0], a[1]),
  'array.new_line': (vm, a) => newArr(vm, a[0], a[1]), 'array.new_box': (vm, a) => newArr(vm, a[0], a[1]),
  'array.from': (vm, a) => { alloc(vm, a.length); return a.slice(); },
  'array.copy': (vm, a) => { const x = arrOf(a[0], 'array.copy'); alloc(vm, x.length); return x.slice(); },
  'array.size': (vm, a) => arrOf(a[0], 'array.size').length,
  __size: (vm, a) => (Array.isArray(a[0]) ? a[0].length : 0),
  'array.get': (vm, a) => { const x = arrOf(a[0], 'array.get'); return x[idx(x, a[1])]; },
  __get: (vm, a) => (Array.isArray(a[0]) && Number.isInteger(a[1]) && a[1] >= 0 && a[1] < a[0].length ? a[0][a[1]] : NA),
  'array.set': (vm, a) => { const x = arrOf(a[0], 'array.set'); x[idx(x, a[1])] = a[2]; },
  'array.push': (vm, a) => { const x = arrOf(a[0], 'array.push'); growCheck(x, 1); alloc(vm, 1); x.push(a[1]); },
  'array.pop': (vm, a) => { const x = arrOf(a[0], 'array.pop'); if (!x.length) throw new ZsRuntimeError('E410', { i: -1, n: 0 }); return x.pop(); },
  'array.unshift': (vm, a) => { const x = arrOf(a[0], 'array.unshift'); growCheck(x, 1); alloc(vm, 1); x.unshift(a[1]); },
  'array.shift': (vm, a) => { const x = arrOf(a[0], 'array.shift'); if (!x.length) throw new ZsRuntimeError('E410', { i: 0, n: 0 }); return x.shift(); },
  'array.insert': (vm, a) => { const x = arrOf(a[0], 'array.insert'); growCheck(x, 1); alloc(vm, 1); const k = Math.trunc(a[1]); if (!(k >= 0 && k <= x.length)) throw new ZsRuntimeError('E410', { i: k, n: x.length }); x.splice(k, 0, a[2]); },
  'array.remove': (vm, a) => { const x = arrOf(a[0], 'array.remove'); return x.splice(idx(x, a[1]), 1)[0]; },
  'array.clear': (vm, a) => { arrOf(a[0], 'array.clear').length = 0; },
  'array.concat': (vm, a) => { const x = arrOf(a[0], 'array.concat'), y = arrOf(a[1], 'array.concat'); growCheck(x, y.length); alloc(vm, y.length); for (const v of y) x.push(v); return x; },
  'array.slice': (vm, a) => { const x = arrOf(a[0], 'array.slice'); const r = x.slice(Math.trunc(a[1]) || 0, fin(a[2]) ? Math.trunc(a[2]) : undefined); alloc(vm, r.length); return r; },
  'array.reverse': (vm, a) => { arrOf(a[0], 'array.reverse').reverse(); },
  'array.sort': (vm, a) => { const x = arrOf(a[0], 'array.sort'); x.sort(cmpAsc); if (a[1] === 'descending') { x.reverse(); const k = x.findIndex((v) => !isNa(v)); if (k > 0) x.push(...x.splice(0, k)); } },
  'array.sort_indices': (vm, a) => { const x = arrOf(a[0], 'array.sort_indices'); alloc(vm, x.length); const ix = x.map((_, i) => i).sort((i, j) => cmpAsc(x[i], x[j]) || i - j); if (a[1] === 'descending') ix.reverse(); return ix; },
  'array.includes': (vm, a) => arrOf(a[0], 'array.includes').includes(a[1]),
  'array.indexof': (vm, a) => arrOf(a[0], 'array.indexof').indexOf(a[1]),
  'array.lastindexof': (vm, a) => arrOf(a[0], 'array.lastindexof').lastIndexOf(a[1]),
  'array.first': (vm, a) => { const x = arrOf(a[0], 'array.first'); if (!x.length) throw new ZsRuntimeError('E410', { i: 0, n: 0 }); return x[0]; },
  'array.last': (vm, a) => { const x = arrOf(a[0], 'array.last'); if (!x.length) throw new ZsRuntimeError('E410', { i: -1, n: 0 }); return x[x.length - 1]; },
  'array.fill': (vm, a) => { const x = arrOf(a[0], 'array.fill'); const from = Math.max(0, Math.trunc(a[2]) || 0), to = fin(a[3]) ? Math.min(x.length, Math.trunc(a[3])) : x.length; for (let i = from; i < to; i++) x[i] = a[1]; },
  'array.sum': (vm, a) => { const x = arrOf(a[0], 'array.sum'); let s = 0; for (const v of x) if (fin(v)) s += v; return s; },
  'array.avg': (vm, a) => { const x = nums(arrOf(a[0], 'array.avg')); if (!x.length) return NA; let s = 0; for (const v of x) s += v; return s / x.length; },
  'array.min': (vm, a) => { const x = nums(arrOf(a[0], 'array.min')); return x.length ? Math.min(...x) : NA; },
  'array.max': (vm, a) => { const x = nums(arrOf(a[0], 'array.max')); return x.length ? Math.max(...x) : NA; },
  'array.median': (vm, a) => median(nums(arrOf(a[0], 'array.median'))),
  'array.stdev': (vm, a) => Math.sqrt(variance(nums(arrOf(a[0], 'array.stdev')), a[1] !== false)),
  'array.variance': (vm, a) => variance(nums(arrOf(a[0], 'array.variance')), a[1] !== false),
  'array.range': (vm, a) => { const x = nums(arrOf(a[0], 'array.range')); return x.length ? Math.max(...x) - Math.min(...x) : NA; },
  'array.abs': (vm, a) => { const x = arrOf(a[0], 'array.abs'); alloc(vm, x.length); return x.map((v) => Math.abs(v)); },
  'array.join': (vm, a) => str(arrOf(a[0], 'array.join').map((v) => formatNum(v, '', vm)).join(typeof a[1] === 'string' ? a[1] : '')),

  // maps
  'map.new': () => new Map(),
  'map.put': (vm, a) => { const m = mapOf(a[0], 'map.put'); if (!m.has(a[1]) && m.size >= MAX_MAP) throw new ZsRuntimeError('E406'); alloc(vm, 1); const old = m.get(a[1]); m.set(a[1], a[2]); return old === undefined ? NA : old; },
  'map.get': (vm, a) => { const v = mapOf(a[0], 'map.get').get(a[1]); return v === undefined ? NA : v; },
  'map.contains': (vm, a) => mapOf(a[0], 'map.contains').has(a[1]),
  'map.remove': (vm, a) => { const m = mapOf(a[0], 'map.remove'); const v = m.get(a[1]); m.delete(a[1]); return v === undefined ? NA : v; },
  'map.size': (vm, a) => mapOf(a[0], 'map.size').size,
  'map.keys': (vm, a) => { const m = mapOf(a[0], 'map.keys'); alloc(vm, m.size); return [...m.keys()]; },
  'map.values': (vm, a) => { const m = mapOf(a[0], 'map.values'); alloc(vm, m.size); return [...m.values()]; },
  'map.clear': (vm, a) => { mapOf(a[0], 'map.clear').clear(); },
  'map.copy': (vm, a) => { const m = mapOf(a[0], 'map.copy'); alloc(vm, m.size); return new Map(m); },
  'map.put_all': (vm, a) => { const m = mapOf(a[0], 'map.put_all'), o = mapOf(a[1], 'map.put_all'); for (const [k, v] of o) { if (!m.has(k) && m.size >= MAX_MAP) throw new ZsRuntimeError('E406'); m.set(k, v); } alloc(vm, o.size); },

  // plots: st = output id. Values per bar; style from the last call.
  plot: (vm, a, st) => {
    const p = vm.plot(st);
    p.values[vm.bar] = typeof a[0] === 'number' ? a[0] : NA;
    p.colors[vm.bar] = colorOrNull(a[2]);
    p.props = { linewidth: a[3], style: a[4], trackprice: a[5], histbase: a[6], offset: a[7], join: a[8], show_last: a[10], display: a[11], format: a[12], precision: a[13] };
    return st;
  },
  plotshape: (vm, a, st) => shapeLike(vm, a, st, { style: a[2], location: a[3], offset: a[5], text: a[6], textcolor: colorOrNull(a[7]), size: a[9], show_last: a[10], display: a[11] }, 4),
  plotchar: (vm, a, st) => shapeLike(vm, a, st, { char: typeof a[2] === 'string' ? a[2].slice(0, 2) : '•', location: a[3], offset: a[5], text: a[6], textcolor: colorOrNull(a[7]), size: a[9], show_last: a[10], display: a[11] }, 4),
  plotarrow: (vm, a, st) => { const p = vm.plot(st); p.values[vm.bar] = typeof a[0] === 'number' && a[0] !== 0 ? a[0] : NA; p.colors[vm.bar] = colorOrNull(a[0] > 0 ? a[2] : a[3]); p.props = { offset: a[4], minheight: a[5], maxheight: a[6], show_last: a[8], display: a[9] }; },
  plotcandle: (vm, a, st) => candle(vm, a, st, { wickcolor: a[6], bordercolor: a[9], show_last: a[8], display: a[10] }),
  plotbar: (vm, a, st) => candle(vm, a, st, { show_last: a[7], display: a[8] }),
  bgcolor: (vm, a, st) => { const p = vm.plot(st); p.colors[vm.bar] = colorOrNull(a[0]); p.values[vm.bar] = p.colors[vm.bar] ? 1 : NA; p.props = { offset: a[1], show_last: a[3], display: a[5] }; },
  barcolor: (vm, a, st) => { const p = vm.plot(st); p.colors[vm.bar] = colorOrNull(a[0]); p.values[vm.bar] = p.colors[vm.bar] ? 1 : NA; p.props = { offset: a[1], show_last: a[3], display: a[5] }; },
  hline: (vm, a, st) => { vm.out.hlines[st] = { id: st, price: fin(a[0]) ? a[0] : null, title: a[1], color: colorOrNull(a[2]), linestyle: a[3], linewidth: a[4], display: a[6] }; return st; },
  fill: (vm, a, st) => {
    const f = vm.fill(st);
    f.a = a[0]; f.b = a[1]; f.colors[vm.bar] = colorOrNull(a[2]); f.title = a[3]; f.show_last = a[5]; f.fillgaps = a[6]; f.display = a[7];
  },

  // drawings
  'label.new': (vm, a) => newDrawing(vm, 'label', { x: a[0], y: a[1], text: str(a[2]), xloc: a[3], yloc: a[4], color: a[5], style: a[6], textcolor: a[7], size: a[8], textalign: a[9], tooltip: a[10], font: a[11] }),
  'label.set_x': setter('label', 'x'), 'label.set_y': setter('label', 'y'),
  'label.set_xy': (vm, a) => { const o = dget(vm, 'label', a[0]); if (o) { o.x = a[1]; o.y = a[2]; } },
  'label.set_text': (vm, a) => { const o = dget(vm, 'label', a[0]); if (o) o.text = str(a[1]); },
  'label.set_color': setter('label', 'color'), 'label.set_textcolor': setter('label', 'textcolor'), 'label.set_style': setter('label', 'style'),
  'label.set_size': setter('label', 'size'), 'label.set_tooltip': setter('label', 'tooltip'), 'label.set_textalign': setter('label', 'textalign'),
  'label.set_xloc': (vm, a) => { const o = dget(vm, 'label', a[0]); if (o) { o.x = a[1]; o.xloc = a[2]; } },
  'label.set_yloc': setter('label', 'yloc'),
  'label.get_x': getter('label', 'x'), 'label.get_y': getter('label', 'y'), 'label.get_text': getter('label', 'text'),
  'label.delete': delDraw('label'), 'label.copy': copyDraw('label'),
  'line.new': (vm, a) => newDrawing(vm, 'line', { x1: a[0], y1: a[1], x2: a[2], y2: a[3], xloc: a[4], extend: a[5], color: a[6], style: a[7], width: a[8] }),
  'line.set_x1': setter('line', 'x1'), 'line.set_y1': setter('line', 'y1'), 'line.set_x2': setter('line', 'x2'), 'line.set_y2': setter('line', 'y2'),
  'line.set_xy1': (vm, a) => { const o = dget(vm, 'line', a[0]); if (o) { o.x1 = a[1]; o.y1 = a[2]; } },
  'line.set_xy2': (vm, a) => { const o = dget(vm, 'line', a[0]); if (o) { o.x2 = a[1]; o.y2 = a[2]; } },
  'line.set_color': setter('line', 'color'), 'line.set_width': setter('line', 'width'), 'line.set_style': setter('line', 'style'), 'line.set_extend': setter('line', 'extend'),
  'line.set_xloc': (vm, a) => { const o = dget(vm, 'line', a[0]); if (o) { o.x1 = a[1]; o.x2 = a[2]; o.xloc = a[3]; } },
  'line.get_x1': getter('line', 'x1'), 'line.get_y1': getter('line', 'y1'), 'line.get_x2': getter('line', 'x2'), 'line.get_y2': getter('line', 'y2'),
  'line.get_price': (vm, a) => { const o = dget(vm, 'line', a[0]); if (!o || o.x2 === o.x1) return o ? o.y1 : NA; return o.y1 + (a[1] - o.x1) * (o.y2 - o.y1) / (o.x2 - o.x1); },
  'line.delete': delDraw('line'), 'line.copy': copyDraw('line'),
  'box.new': (vm, a) => newDrawing(vm, 'box', { left: a[0], top: a[1], right: a[2], bottom: a[3], border_color: a[4], border_width: a[5], border_style: a[6], extend: a[7], xloc: a[8], bgcolor: a[9], text: str(a[10]), text_size: a[11], text_color: a[12], text_halign: a[13], text_valign: a[14] }),
  'box.set_left': setter('box', 'left'), 'box.set_top': setter('box', 'top'), 'box.set_right': setter('box', 'right'), 'box.set_bottom': setter('box', 'bottom'),
  'box.set_lefttop': (vm, a) => { const o = dget(vm, 'box', a[0]); if (o) { o.left = a[1]; o.top = a[2]; } },
  'box.set_rightbottom': (vm, a) => { const o = dget(vm, 'box', a[0]); if (o) { o.right = a[1]; o.bottom = a[2]; } },
  'box.set_bgcolor': setter('box', 'bgcolor'), 'box.set_border_color': setter('box', 'border_color'), 'box.set_border_width': setter('box', 'border_width'),
  'box.set_border_style': setter('box', 'border_style'), 'box.set_extend': setter('box', 'extend'),
  'box.set_text': (vm, a) => { const o = dget(vm, 'box', a[0]); if (o) o.text = str(a[1]); },
  'box.set_text_color': setter('box', 'text_color'),
  'box.get_left': getter('box', 'left'), 'box.get_top': getter('box', 'top'), 'box.get_right': getter('box', 'right'), 'box.get_bottom': getter('box', 'bottom'),
  'box.delete': delDraw('box'), 'box.copy': copyDraw('box'),
  'table.new': (vm, a) => {
    const cols = Math.max(1, Math.min(100, Math.trunc(a[1]) || 1)), rows = Math.max(1, Math.min(1000, Math.trunc(a[2]) || 1));
    return newDrawing(vm, 'table', { position: a[0], columns: cols, rows, bgcolor: a[3], frame_color: a[4], frame_width: a[5], border_color: a[6], border_width: a[7], cells: new Map() });
  },
  'table.cell': (vm, a) => {
    const t = dget(vm, 'table', a[0]); if (!t) return;
    const c = Math.trunc(a[1]), r = Math.trunc(a[2]);
    if (!(c >= 0 && c < t.columns && r >= 0 && r < t.rows)) throw new ZsRuntimeError('E410', { i: c + ',' + r, n: t.columns + 'x' + t.rows });
    const key = r * 1000 + c;
    if (!t.cells.has(key) && t.cells.size >= MAX_CELLS) throw new ZsRuntimeError('E416');
    t.cells.set(key, { c, r, text: str(a[3]), width: a[4], height: a[5], text_color: a[6], text_halign: a[7], text_valign: a[8], text_size: a[9], bgcolor: a[10], tooltip: a[11] });
  },
  'table.cell_set_text': (vm, a) => cellSet(vm, a, 'text'),
  'table.cell_set_bgcolor': (vm, a) => cellSet(vm, a, 'bgcolor'),
  'table.cell_set_text_color': (vm, a) => cellSet(vm, a, 'text_color'),
  'table.clear': (vm, a) => {
    const t = dget(vm, 'table', a[0]); if (!t) return;
    const c0 = Math.trunc(a[1]), r0 = Math.trunc(a[2]), c1 = fin(a[3]) ? Math.trunc(a[3]) : c0, r1 = fin(a[4]) ? Math.trunc(a[4]) : r0;
    for (const [k, cell] of t.cells) if (cell.c >= c0 && cell.c <= c1 && cell.r >= r0 && cell.r <= r1) t.cells.delete(k);
  },
  'table.delete': delDraw('table'),

  // alerts
  alertcondition: (vm, a, st) => { const ac = vm.alertcond(st); ac.values[vm.bar] = a[0] === true ? 1 : 0; },
  alert: (vm, a) => {
    if (typeof a[0] !== 'string') return;
    const freq = a[1] || 'once_per_bar';
    if (freq === 'once_per_bar_close' && !vm.isConfirmed()) return;
    const msg = a[0].slice(0, 1000);
    if (freq !== 'all' && vm.alertSeen.has(vm.bar + ':' + msg)) return;
    vm.alertSeen.add(vm.bar + ':' + msg);
    vm.out.alerts.push({ bar: vm.bar, time: vm.B.time[vm.bar], message: msg });
    if (vm.out.alerts.length > 500) vm.out.alerts.shift();
  },

  // our data: order book
  'book.bid': (vm, a) => { const f = frame(vm, 'book'); const l = f && levelOf(f.bids, a[0]); return l ? l[0] : NA; },
  'book.ask': (vm, a) => { const f = frame(vm, 'book'); const l = f && levelOf(f.asks, a[0]); return l ? l[0] : NA; },
  'book.bidsize': (vm, a) => { const f = frame(vm, 'book'); const l = f && levelOf(f.bids, a[0]); return l ? l[1] : NA; },
  'book.asksize': (vm, a) => { const f = frame(vm, 'book'); const l = f && levelOf(f.asks, a[0]); return l ? l[1] : NA; },
  'book.depth': (vm, a) => { const f = frame(vm, 'book'); if (!f) return NA; return depth(isAsk(a[0]) ? f.asks : f.bids, a[1]); },
  'book.imbalance': (vm, a) => { const f = frame(vm, 'book'); if (!f) return NA; const b = depth(f.bids, a[0]), s = depth(f.asks, a[0]); return fin(b) && fin(s) && b + s > 0 ? (b - s) / (b + s) : NA; },
  'book.wall': (vm, a) => {
    const f = frame(vm, 'book'); if (!f) return NA;
    const side = isAsk(a[0]) ? f.asks : f.bids;
    if (!Array.isArray(side)) return NA;
    for (const l of side) if (Array.isArray(l) && l[1] >= a[1]) return l[0];
    return NA;
  },
  'book.heat': (vm, a) => {
    const f = frame(vm, 'book'); if (!f || !fin(a[0])) return NA;
    const h = f.heat;   // heat grid from the data hub: resting size per price row
    if (h && fin(h.step) && h.step > 0 && fin(h.i0) && Array.isArray(h.v)) { const k = Math.floor(a[0] / h.step + 1e-9) - h.i0; return k >= 0 && k < h.v.length && fin(h.v[k]) ? Math.abs(h.v[k]) : NA; }
    let best = null, bd = Infinity;
    for (const side of [f.bids, f.asks]) if (Array.isArray(side)) for (const l of side) { if (!Array.isArray(l)) continue; const d = Math.abs(l[0] - a[0]); if (d < bd) { bd = d; best = l; } }
    const tick = vm.sym.mintick > 0 ? vm.sym.mintick : 0;
    return best && bd <= tick * 1.0000001 ? best[1] : (best && tick === 0 && bd === 0 ? best[1] : NA);
  },
  // order flow
  'flow.bigtrades': (vm, a) => { const t = bigTrades(vm); if (!t) return NA; let n = 0; for (const x of t) if (Array.isArray(x) && x[1] >= a[0]) n++; return n; },
  'flow.bigtrades_vol': (vm, a) => { const t = bigTrades(vm); if (!t) return NA; let n = 0; for (const x of t) if (Array.isArray(x) && x[1] >= a[0]) n += x[1]; return n; },
  'flow.footprint': (vm, a) => {
    const rows = footRows(vm); if (!rows || !fin(a[0])) return NA;
    const tick = vm.sym.mintick > 0 ? vm.sym.mintick / 2 : 1e-9;
    for (const r of rows) if (Array.isArray(r) && Math.abs(r[0] - a[0]) <= tick) return a[1] === 'sell' ? r[1] : a[1] === 'buy' ? r[2] : r[1] + r[2];
    return 0;
  },
  // GEX
  'gex.level': (vm, a) => { const f = frame(vm, 'gex'); const k = Math.trunc(fin(a[0]) ? a[0] : 0); return f && Array.isArray(f.levels) && k >= 0 && fin(f.levels[k]) ? f.levels[k] : NA; },
  // ZoroOptions
  'opt.node': (vm, a) => { const f = frame(vm, 'opt'); const k = Math.trunc(fin(a[0]) ? a[0] : 0); return f && Array.isArray(f.nodes) && k >= 0 && fin(f.nodes[k]) ? f.nodes[k] : NA; },
  'opt.range': (vm, a) => { const f = frame(vm, 'opt'); const r = f && f.ranges && f.ranges[a[0]]; return Array.isArray(r) ? [fin(r[0]) ? r[0] : NA, fin(r[1]) ? r[1] : NA] : [NA, NA]; },
};

const isAsk = (s) => s === 'ask' || s === 'sell';
function bigTrades(vm) {
  if (!vm.allowed.flow) { vm.notice('flow', 'locked'); return null; }
  const d = vm.data.flow;
  if (!d) { vm.notice('flow', 'missing'); return null; }
  return d.bigtrades ? d.bigtrades[vm.bar] || [] : null;
}
function depth(side, n) {
  if (!Array.isArray(side)) return NA;
  const k = Math.min(side.length, Math.max(0, Math.trunc(fin(n) ? n : 10)));
  let s = 0; for (let i = 0; i < k; i++) if (Array.isArray(side[i]) && fin(side[i][1])) s += side[i][1];
  return s;
}
function cellSet(vm, a, field) {
  const t = dget(vm, 'table', a[0]); if (!t) return;
  const c = Math.trunc(a[1]), r = Math.trunc(a[2]);
  if (!(c >= 0 && c < t.columns && r >= 0 && r < t.rows)) throw new ZsRuntimeError('E410', { i: c + ',' + r, n: t.columns + 'x' + t.rows });
  const key = r * 1000 + c;
  let cell = t.cells.get(key);
  if (!cell) { if (t.cells.size >= MAX_CELLS) throw new ZsRuntimeError('E416'); cell = { c, r, text: '' }; t.cells.set(key, cell); }
  cell[field] = field === 'text' ? str(a[3]) : a[3];
}
function newArr(vm, size, init) {
  const n = fin(size) ? Math.trunc(size) : 0;
  if (n < 0) throw new ZsRuntimeError('E410', { i: n, n: 0 });
  if (n > MAX_ARR) throw new ZsRuntimeError('E405', { lim: '100,000' });
  alloc(vm, n);
  return new Array(n).fill(init);
}
function median(v) { if (!v.length) return NA; const s = v.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function variance(v, biased) { const n = v.length; if (!n) return NA; let s = 0; for (const x of v) s += x; const m = s / n; let q = 0; for (const x of v) q += (x - m) * (x - m); return q / (biased || n < 2 ? n : n - 1); }
function colorOrNull(c) { return typeof c === 'string' && c.length === 9 && c[0] === '#' ? c : null; }
function shapeLike(vm, a, st, props, colorAt) {
  const p = vm.plot(st);
  const v = a[0];
  const on = v === true || (typeof v === 'number' && v === v && v !== 0);
  p.values[vm.bar] = on ? (typeof v === 'number' ? v : 1) : NA;
  p.colors[vm.bar] = on ? colorOrNull(a[colorAt]) : null;
  p.props = props;
}
function candle(vm, a, st, props) {
  const p = vm.plot(st, true);
  const i = vm.bar;
  p.open[i] = a[0]; p.high[i] = a[1]; p.low[i] = a[2]; p.close[i] = a[3]; p.values[i] = a[3];
  p.colors[i] = colorOrNull(a[5]);
  props.wickcolor = colorOrNull(props.wickcolor); props.bordercolor = colorOrNull(props.bordercolor);
  p.props = props;
}
function pivot(vm, a, st, sign) {
  const L = Math.max(0, Math.trunc(a[1])), R = Math.max(0, Math.trunc(a[2]));
  if (!fin(a[1]) || !fin(a[2])) throw new ZsRuntimeError('E412', { f: sign > 0 ? 'ta.pivothigh' : 'ta.pivotlow', v: 'na' });
  const n = L + R + 1; const w = win(vm, st, n); w.push(a[0]);
  if (w.n < n) return NA;
  const c = w.get(R);
  if (!fin(c)) return NA;
  for (let k = 0; k < n; k++) {
    if (k === R) continue;
    const v = w.get(k);
    if (!fin(v)) return NA;
    if (k > R) { if (sign > 0 ? !(c > v) : !(c < v)) return NA; }   // older bars (left): strictly beyond
    else if (sign > 0 ? !(c >= v) : !(c <= v)) return NA;            // newer bars (right): ties allowed
  }
  return c;
}

Object.freeze(BUILTINS);
