// Zscript VM: validates a program and runs it bar by bar.
// Series semantics (SPEC.md section 5): every slot is re-made each bar, `var` slots keep
// their value, history reads ring buffers, live updates roll back to the end of the
// previous bar (except varip). Hard limits (section 9) are enforced here.
import { OP, OP_ARGC, PROGRAM_VERSION } from './ops.js?v=964';
import { BUILTINS, formatNum } from './builtins.js?v=964';
import { VARIABLES, FUNCTIONS } from './catalog.js?v=964';
import { ZsRuntimeError, diag, MESSAGES, fmt } from './errors.js?v=964';

export const RUN_LIMITS = Object.freeze({
  bars: 50000, opsPerBar: 5000000, loopIters: 100000, firstRunMs: 20000, updateMs: 5000, maxBarsBack: 5000,
});
const NA = NaN;
const fin = (x) => typeof x === 'number' && x === x && x !== Infinity && x !== -Infinity;
const SOURCES = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'];
const BAR_FIELDS = ['time', 'time_close', 'open', 'high', 'low', 'close', 'volume'];
const NS_LABEL = { book: 'Order book (L2)', flow: 'Order flow', gex: 'GEX', opt: 'ZoroOptions' };
const NS_FN = { book: 'book.*', flow: 'flow.*', gex: 'gex.*', opt: 'opt.*' };

// ---------------------------------------------------------------- validation
// A program may come from the library (another member's compiled script), so every
// field is checked before anything runs. Nothing in it is ever evaluated as code.
export function validateProgram(p) {
  const bad = (why) => { throw new ZsRuntimeError('E499', { why: 'invalid program (' + why + ')' }); };
  if (!p || typeof p !== 'object' || p.v !== PROGRAM_VERSION) bad('version');
  if (!Array.isArray(p.units) || !p.units.length || p.units.length > 17) bad('units');
  if (!Array.isArray(p.consts) || !p.consts.every((c) => typeof c === 'number' || typeof c === 'boolean' || (typeof c === 'string' && c.length <= 4096))) bad('consts');
  if (!Array.isArray(p.fns) || !p.fns.every((f) => typeof f === 'string' && Object.prototype.hasOwnProperty.call(BUILTINS, f))) bad('fns');
  if (!Array.isArray(p.bvars) || !p.bvars.every((b) => typeof b === 'string' && (VARIABLES.has(b)))) bad('bvars');
  const m = p.meta;
  if (!m || typeof m !== 'object' || !Array.isArray(m.inputs) || m.inputs.length > 500) bad('meta');
  const nInputs = m.inputs.length;
  for (const d of m.inputs) if (!d || typeof d.kind !== 'string' || typeof d.id !== 'number') bad('input');
  const o = p.outputs;
  if (!o || !Array.isArray(o.plots) || !Array.isArray(o.hlines) || !Array.isArray(o.fills) || !Array.isArray(o.alertconditions)) bad('outputs');
  if (o.plots.length + o.hlines.length + o.fills.length > 64 || o.alertconditions.length > 64) bad('outputs');
  const L = p.limits;
  if (!L || ![L.maxBarsBack, L.labels, L.lines, L.boxes, L.tables].every((x) => Number.isInteger(x) && x >= 1 && x <= 5000)) bad('limits');
  if (!Array.isArray(p.securities) || p.securities.length > 16) bad('securities');
  for (const s of p.securities) if (!s || !Number.isInteger(s.unit) || s.unit < 1 || s.unit >= p.units.length || !Number.isInteger(s.n) || s.n < 0 || s.n > 32) bad('security');
  p.units.forEach((u, ui) => {
    if (!u || !Array.isArray(u.code) || u.code.length > 2000000 || !Number.isInteger(u.nSlots) || u.nSlots < 0 || u.nSlots > 1000000 ||
      !Number.isInteger(u.nStates) || u.nStates < 0 || u.nStates > 1000000) bad('unit');
    for (const k of ['hist', 'vars', 'varip', 'pos']) if (!Array.isArray(u[k]) || !u[k].every(Number.isInteger)) bad('unit ' + k);
    if (![...u.hist, ...u.vars, ...u.varip].every((s) => s >= 0 && s < u.nSlots)) bad('slots');
    const c = u.code, n = c.length;
    const starts = new Uint8Array(n + 1);
    for (let i = 0; i < n;) {
      const op = c[i];
      if (!Number.isInteger(op) || op < 0 || op >= OP_ARGC.length) bad('opcode at ' + i);
      const argc = OP_ARGC[op];
      if (i + argc >= n + (argc ? 0 : 1) && argc) bad('truncated');
      for (let k = 1; k <= argc; k++) if (!Number.isInteger(c[i + k])) bad('operand');
      const a = c[i + 1], b = c[i + 2], d = c[i + 3];
      switch (op) {
        case OP.CONST: if (a < 0 || a >= p.consts.length) bad('const'); break;
        case OP.LOAD: case OP.STORE: case OP.STOREK: case OP.HIST: if (a < 0 || a >= u.nSlots) bad('slot'); if (op === OP.HIST && !u.hist.includes(a)) bad('hist slot'); break;
        case OP.VARSKIP: if (a < 0 || a >= u.nSlots || b < 0 || b > n) bad('varskip'); break;
        case OP.INPUT: case OP.SRCIN: if (a < 0 || a >= nInputs) bad('input'); break;
        case OP.BVAR: case OP.BHIST: if (a < 0 || a >= p.bvars.length) bad('bvar'); break;
        case OP.JMP: case OP.JF: case OP.JT: if (a < 0 || a > n) bad('jump'); break;
        case OP.CALL: if (a < 0 || a >= p.fns.length || b < 0 || b > 256 || d < -1 || d > 1000000) bad('call'); break;
        case OP.TUPLE: case OP.UNPACK: if (a < 0 || a > 32) bad('tuple'); break;
        case OP.LOOP: case OP.LOOPRESET: if (a < 0 || a >= u.nStates) bad('loop'); break;
        case OP.SEC: if (ui !== 0 || a < 0 || a >= p.securities.length || b < 0 || b > 32) bad('sec'); break;
      }
      starts[i] = 1;
      i += 1 + argc;
      if (i === n) starts[n] = 1;
    }
    starts[n] = 1;
    // every jump must land on an instruction boundary
    for (let i = 0; i < n;) {
      const op = c[i];
      if ((op === OP.JMP || op === OP.JF || op === OP.JT || op === OP.VARSKIP) && !starts[op === OP.VARSKIP ? c[i + 2] : c[i + 1]]) bad('jump target');
      i += 1 + OP_ARGC[op];
    }
  });
  return p;
}

// ---------------------------------------------------------------- bars
function tfToMs(tf) {
  const s = String(tf || '').trim().toUpperCase();
  let m;
  if ((m = /^(\d+)S$/.exec(s))) return +m[1] * 1000;
  if ((m = /^(\d+)$/.exec(s))) return +m[1] * 60000;
  if ((m = /^(\d*)D$/.exec(s))) return (+m[1] || 1) * 86400000;
  if ((m = /^(\d*)W$/.exec(s))) return (+m[1] || 1) * 7 * 86400000;
  if ((m = /^(\d*)M$/.exec(s))) return (+m[1] || 1) * 30 * 86400000;
  if ((m = /^(\d+)H$/.exec(s))) return +m[1] * 3600000;
  return NaN;
}
export { tfToMs };

function prepBars(bars, tf) {
  if (!bars || typeof bars !== 'object') throw new ZsRuntimeError('E499', { why: 'no bars' });
  const n = bars.close ? bars.close.length : 0;
  if (n > RUN_LIMITS.bars) throw new ZsRuntimeError('E413');
  const B = { n };
  for (const f of ['time', 'open', 'high', 'low', 'close', 'volume']) {
    const src = bars[f];
    const a = new Array(n);
    for (let i = 0; i < n; i++) { const v = src ? src[i] : NaN; a[i] = typeof v === 'number' ? v : NaN; }   // data only: never call valueOf on member input
    B[f] = a;
  }
  const ms = tfToMs(tf);
  B.time_close = new Array(n);
  for (let i = 0; i < n; i++) {
    const tc = bars.time_close ? +bars.time_close[i] : NaN;
    B.time_close[i] = tc === tc ? tc : fin(ms) ? B.time[i] + ms : (i + 1 < n ? B.time[i + 1] : B.time[i]);
  }
  B.tfMs = ms;
  return B;
}
function pushBar(B, bar) {
  const num = (v) => (typeof v === 'number' ? v : NaN);
  for (const f of ['time', 'open', 'high', 'low', 'close', 'volume']) B[f].push(num(bar[f]));
  B.time_close.push(fin(bar.time_close) ? bar.time_close : B.time[B.n] + (fin(B.tfMs) ? B.tfMs : 0));
  B.n++;
}
function setBar(B, i, bar) {
  for (const f of ['open', 'high', 'low', 'close', 'volume']) B[f][i] = +bar[f];
}

// ---------------------------------------------------------------- deep copy (rollback)
function clone(x) {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) { const out = new Array(x.length); for (let i = 0; i < x.length; i++) out[i] = clone(x[i]); return out; }
  if (x instanceof Map) { const m = new Map(); for (const [k, v] of x) m.set(k, clone(v)); return m; }
  const proto = Object.getPrototypeOf(x);
  const out = Object.create(proto);
  for (const k of Object.keys(x)) out[k] = clone(x[k]);
  return out;
}

// ---------------------------------------------------------------- bar-variable getters
function makeGetter(name) {
  const B = (c) => c.B;
  switch (name) {
    case 'open': case 'high': case 'low': case 'close': case 'volume': case 'time': case 'time_close': return (c) => c.B[name][c.bar];
    case 'hl2': return (c) => (c.B.high[c.bar] + c.B.low[c.bar]) / 2;
    case 'hlc3': return (c) => (c.B.high[c.bar] + c.B.low[c.bar] + c.B.close[c.bar]) / 3;
    case 'ohlc4': return (c) => (c.B.open[c.bar] + c.B.high[c.bar] + c.B.low[c.bar] + c.B.close[c.bar]) / 4;
    case 'hlcc4': return (c) => (c.B.high[c.bar] + c.B.low[c.bar] + 2 * c.B.close[c.bar]) / 4;
    case 'bar_index': return (c) => c.bar;
    case 'last_bar_index': return (c) => c.B.n - 1;
    case 'year': return (c) => new Date(c.B.time[c.bar]).getUTCFullYear();
    case 'month': return (c) => new Date(c.B.time[c.bar]).getUTCMonth() + 1;
    case 'dayofmonth': return (c) => new Date(c.B.time[c.bar]).getUTCDate();
    case 'dayofweek': return (c) => new Date(c.B.time[c.bar]).getUTCDay() + 1;
    case 'hour': return (c) => new Date(c.B.time[c.bar]).getUTCHours();
    case 'minute': return (c) => new Date(c.B.time[c.bar]).getUTCMinutes();
    case 'second': return (c) => new Date(c.B.time[c.bar]).getUTCSeconds();
    case 'weekofyear': return (c) => isoWeek(c.B.time[c.bar]);
    case 'barstate.isfirst': return (c) => c.bar === 0;
    case 'barstate.islast': return (c) => c.bar === c.B.n - 1;
    case 'barstate.isnew': return (c) => !c.rerun;
    case 'barstate.isrealtime': return (c) => c.bar >= c.realtimeFrom;
    case 'barstate.ishistory': return (c) => c.bar < c.realtimeFrom;
    case 'barstate.isconfirmed': return (c) => c.isConfirmed();
    case 'barstate.islastconfirmedhistory': return (c) => c.bar === (c.lastClosed ? c.realtimeFrom - 1 : c.realtimeFrom - 2);
    case 'syminfo.ticker': return (c) => c.sym.ticker;
    case 'syminfo.tickerid': return (c) => c.sym.tickerid;
    case 'syminfo.type': return (c) => c.sym.type;
    case 'syminfo.currency': return (c) => c.sym.currency;
    case 'syminfo.mintick': return (c) => c.sym.mintick;
    case 'syminfo.pointvalue': return (c) => c.sym.pointvalue;
    case 'timeframe.period': return (c) => c.tf.period;
    case 'timeframe.multiplier': return (c) => c.tf.multiplier;
    case 'timeframe.isintraday': return (c) => c.tf.intraday;
    case 'timeframe.isdaily': return (c) => c.tf.unit === 'D';
    case 'timeframe.isweekly': return (c) => c.tf.unit === 'W';
    case 'timeframe.ismonthly': return (c) => c.tf.unit === 'M';
    case 'timeframe.isminutes': return (c) => c.tf.unit === '';
    case 'timeframe.isseconds': return (c) => c.tf.unit === 'S';
    case 'flow.buyvol': case 'flow.sellvol': case 'flow.trades': { const k = name.slice(5); return (c) => c.flowVal(k); }
    case 'flow.delta': return (c) => c.flowDelta(c.bar);
    case 'flow.cvd': return (c) => c.flowCvd();
    case 'flow.poc': return (c) => c.flowVA()[0];
    case 'flow.vah': return (c) => c.flowVA()[1];
    case 'flow.val': return (c) => c.flowVA()[2];
    case 'gex.callwall': case 'gex.putwall': case 'gex.flip': case 'gex.zero_upper': case 'gex.zero_lower': case 'gex.net': {
      const k = name.slice(4); return (c) => { const f = c.frame('gex'); return f && fin(f[k]) ? f[k] : NA; };
    }
    case 'gex.updated': return (c) => { const f = c.frame('gex'); return f ? (fin(f.updated) ? f.updated : fin(f.t) ? f.t : NA) : NA; };
    case 'opt.ivrank': case 'opt.pc': case 'opt.maxpain': { const k = name.slice(4); return (c) => { const f = c.frame('opt'); return f && fin(f[k]) ? f[k] : NA; }; }
    case 'opt.zone': return (c) => { const f = c.frame('opt'); return f && typeof f.zone === 'string' ? f.zone.slice(0, 200) : NA; };
    case 'opt.updated': return (c) => { const f = c.frame('opt'); return f ? (fin(f.updated) ? f.updated : fin(f.t) ? f.t : NA) : NA; };
    default: void B; return () => NA;
  }
}
function isoWeek(ms) {
  const d = new Date(ms); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}
function bhistValue(name, c, k) {
  const B = c.B;
  switch (name) {
    case 'hl2': return (B.high[k] + B.low[k]) / 2;
    case 'hlc3': return (B.high[k] + B.low[k] + B.close[k]) / 3;
    case 'ohlc4': return (B.open[k] + B.high[k] + B.low[k] + B.close[k]) / 4;
    case 'hlcc4': return (B.high[k] + B.low[k] + 2 * B.close[k]) / 4;
    case 'bar_index': return k;
    default: return B[name][k];
  }
}
function parseTf(tf) {
  const s = String(tf || '').trim().toUpperCase();
  const m = /^(\d*)([SDWMH]?)$/.exec(s) || ['', '1', ''];
  let mult = +m[1] || 1, unit = m[2];
  if (unit === 'H') { unit = ''; mult *= 60; }
  return { period: String(tf || ''), multiplier: mult, unit, intraday: unit === '' || unit === 'S' };
}

// ---------------------------------------------------------------- context (one per unit run)
class Ctx {
  constructor(exec, unit, B, main) {
    this.exec = exec; this.u = unit; this.B = B; this.main = main;
    this.bar = 0; this.rerun = false;
    this.slots = new Array(unit.nSlots).fill(NA);
    this.inited = new Uint8Array(unit.nSlots);
    this.st = new Array(unit.nStates);
    this.loops = new Int32Array(unit.nStates);
    this.cap = exec.p.limits.maxBarsBack + 1;
    this.rings = new Map(unit.hist.map((s) => [s, new Array(this.cap).fill(NA)]));
    this.histSlots = unit.hist;
    this.allocated = 0;
    this.stack = new Array(256);
    // shared with builtins
    this.sym = exec.sym; this.tf = main ? exec.tf : parseTf(''); this.limits = exec.p.limits;
    this.allowed = main ? exec.allowed : {};
    this.data = main ? exec.data : {};
    this.draw = main ? exec.draw : { label: new Map(), line: new Map(), box: new Map(), table: new Map() };
    this.out = exec.out;
    this.alertSeen = exec.alertSeen;
    this.realtimeFrom = main ? exec.realtimeFrom : Infinity;
    this.lastClosed = exec.lastClosed;
    this.cvd = [];
  }
  get drawSeq() { return this.exec.drawSeq; }
  set drawSeq(v) { this.exec.drawSeq = v; }
  notice(ns, kind) { if (this.main) this.exec.notice(ns, kind); }
  isConfirmed() { return this.bar < this.B.n - 1 || this.lastClosed || !this.main; }
  plot(id, candle) { return this.exec.plotBuf(id, candle); }
  fill(id) { return this.exec.fillBuf(id); }
  alertcond(id) { return this.exec.alertBuf(id); }
  frame(ns) {
    if (!this.main) return null;
    if (!this.allowed[ns]) { this.notice(ns, 'locked'); return null; }
    const arr = this.data[ns];
    if (!Array.isArray(arr)) { this.notice(ns, 'missing'); return null; }
    const f = arr[this.bar];
    if (!f || typeof f !== 'object') return null;
    if (fin(f.t) && f.t > this.B.time_close[this.bar]) return null;   // never data from after this bar
    return f;
  }
  flowOk() {
    if (!this.main) return null;
    if (!this.allowed.flow) { this.notice('flow', 'locked'); return null; }
    const d = this.data.flow;
    if (!d || typeof d !== 'object') { this.notice('flow', 'missing'); return null; }
    return d;
  }
  flowVal(k) { const d = this.flowOk(); if (!d || !d[k]) return NA; const v = +d[k][this.bar]; return v === v ? v : NA; }
  flowDelta(i) {
    const d = this.flowOk(); if (!d) return NA;
    if (d.delta) { const v = +d.delta[i]; return v === v ? v : NA; }
    if (!d.buyvol || !d.sellvol) return NA;
    const b = +d.buyvol[i], s = +d.sellvol[i];
    return b === b && s === s ? b - s : NA;
  }
  flowCvd() {
    const d = this.flowOk(); if (!d) return NA;
    if (d.cvd) { const v = +d.cvd[this.bar]; return v === v ? v : NA; }
    // running total up to this bar only (prefix, so no lookahead)
    const c = this.cvd;
    for (let i = c.length; i <= this.bar; i++) { const x = this.flowDelta(i); c.push((i ? c[i - 1] : 0) + (x === x ? x : 0)); }
    return c[this.bar];
  }
  flowVA() {
    const d = this.flowOk(); if (!d) return [NA, NA, NA];
    if (d.poc && fin(+d.poc[this.bar])) { const g = (k) => (d[k] && fin(+d[k][this.bar]) ? +d[k][this.bar] : NA); return [g('poc'), g('vah'), g('val')]; }   // hub-computed
    if (!d.footprint) return [NA, NA, NA];
    return valueAreaOf(d.footprint[this.bar]);
  }
}
function valueAreaOf(rows) {
  if (!Array.isArray(rows) || !rows.length) return [NA, NA, NA];
  const r = [];
  for (const x of rows) if (Array.isArray(x) && fin(+x[0])) r.push([+x[0], (fin(+x[1]) ? +x[1] : 0) + (fin(+x[2]) ? +x[2] : 0)]);
  if (!r.length) return [NA, NA, NA];
  r.sort((a, b) => a[0] - b[0]);
  let pi = 0, total = 0;
  for (let i = 0; i < r.length; i++) { total += r[i][1]; if (r[i][1] > r[pi][1]) pi = i; }
  let lo = pi, hi = pi, acc = r[pi][1];
  while (acc < total * 0.7 && (lo > 0 || hi < r.length - 1)) {
    const up = hi < r.length - 1 ? r[hi + 1][1] : -1, dn = lo > 0 ? r[lo - 1][1] : -1;
    if (up >= dn) { hi++; acc += r[hi][1]; } else { lo--; acc += r[lo][1]; }
  }
  return [r[pi][0], r[hi][0], r[lo][0]];
}

// ---------------------------------------------------------------- interpreter
function runBar(ctx, deadline) {
  const exec = ctx.exec, p = exec.p, u = ctx.u, code = u.code, consts = p.consts;
  const fns = exec.fnTable, getters = exec.getters, bvars = p.bvars;
  const slots = ctx.slots, stack = ctx.stack;
  let sp = 0, pc = 0, ops = 0;
  const end = code.length;
  ctx.allocated = 0;
  // plain (non-var) slots start each bar as na
  const keep = ctx.inited;
  for (let i = 0; i < slots.length; i++) if (!exec.isVarSlot[u.idx][i]) slots[i] = NA;
  const maxOps = exec.lim.opsPerBar, maxLoop = exec.lim.loopIters;
  try {
    while (pc < end) {
      if (++ops > maxOps) throw new ZsRuntimeError('E403');
      if ((ops & 8191) === 0 && Date.now() > deadline) throw new ZsRuntimeError('E401');
      const op = code[pc];
      switch (op) {
        case OP.NOP: pc++; break;
        case OP.CONST: stack[sp++] = consts[code[pc + 1]]; pc += 2; break;
        case OP.NA: stack[sp++] = NA; pc++; break;
        case OP.TRUE: stack[sp++] = true; pc++; break;
        case OP.FALSE: stack[sp++] = false; pc++; break;
        case OP.POP: sp--; pc++; break;
        case OP.DUP: stack[sp] = stack[sp - 1]; sp++; pc++; break;
        case OP.LOAD: stack[sp++] = slots[code[pc + 1]]; pc += 2; break;
        case OP.STORE: slots[code[pc + 1]] = stack[--sp]; pc += 2; break;
        case OP.STOREK: slots[code[pc + 1]] = stack[sp - 1]; pc += 2; break;
        case OP.INPUT: stack[sp++] = exec.inputVals[code[pc + 1]]; pc += 2; break;
        case OP.SRCIN: stack[sp++] = exec.srcGetters[code[pc + 1]](ctx); pc += 2; break;
        case OP.BVAR: stack[sp++] = getters[code[pc + 1]](ctx); pc += 2; break;
        case OP.HIST: {
          const n = stack[sp - 1], s = code[pc + 1];
          stack[sp - 1] = histRead(ctx, s, n);
          pc += 2; break;
        }
        case OP.BHIST: {
          const n = stack[sp - 1];
          let v = NA;
          if (fin(n) && n >= 0) {
            if (Math.trunc(n) > ctx.cap - 1) throw new ZsRuntimeError('E402', { n: Math.trunc(n), m: ctx.cap - 1 });
            const k = ctx.bar - Math.trunc(n);
            if (k >= 0) v = bhistValue(bvars[code[pc + 1]], ctx, k);
          }
          stack[sp - 1] = v;
          pc += 2; break;
        }
        case OP.ADD: { const b = stack[--sp]; stack[sp - 1] = stack[sp - 1] + b; pc++; break; }
        case OP.SUB: { const b = stack[--sp]; stack[sp - 1] = stack[sp - 1] - b; pc++; break; }
        case OP.MUL: { const b = stack[--sp]; stack[sp - 1] = stack[sp - 1] * b; pc++; break; }
        case OP.DIV: { const b = stack[--sp]; const a = stack[sp - 1]; stack[sp - 1] = b === 0 ? NA : a / b; pc++; break; }
        case OP.MOD: { const b = stack[--sp]; const a = stack[sp - 1]; stack[sp - 1] = b === 0 ? NA : a % b; pc++; break; }
        case OP.NEG: stack[sp - 1] = -stack[sp - 1]; pc++; break;
        case OP.NOT: stack[sp - 1] = !stack[sp - 1]; pc++; break;
        case OP.EQ: { const b = stack[--sp]; stack[sp - 1] = stack[sp - 1] === b; pc++; break; }
        case OP.NE: { const b = stack[--sp]; const a = stack[sp - 1]; stack[sp - 1] = a !== b && a === a && b === b; pc++; break; }
        case OP.LT: { const b = stack[--sp]; stack[sp - 1] = stack[sp - 1] < b; pc++; break; }
        case OP.LE: { const b = stack[--sp]; stack[sp - 1] = stack[sp - 1] <= b; pc++; break; }
        case OP.GT: { const b = stack[--sp]; stack[sp - 1] = stack[sp - 1] > b; pc++; break; }
        case OP.GE: { const b = stack[--sp]; stack[sp - 1] = stack[sp - 1] >= b; pc++; break; }
        case OP.SADD: {
          const b = stack[--sp], a = stack[sp - 1];
          if (typeof a !== 'string' || typeof b !== 'string') stack[sp - 1] = NA;
          else { if (a.length + b.length > 4096) throw new ZsRuntimeError('E407'); stack[sp - 1] = a + b; }
          pc++; break;
        }
        case OP.TOBOOL: { const v = stack[sp - 1]; stack[sp - 1] = v === true || (typeof v === 'number' && v === v && v !== 0); pc++; break; }
        case OP.JMP: pc = code[pc + 1]; break;
        case OP.JF: if (!stack[--sp]) pc = code[pc + 1]; else pc += 2; break;
        case OP.JT: if (stack[--sp]) pc = code[pc + 1]; else pc += 2; break;
        case OP.VARSKIP: { const s = code[pc + 1]; if (keep[s]) pc = code[pc + 2]; else { keep[s] = 1; pc += 3; } break; }
        case OP.CALL: {
          const argc = code[pc + 2];
          if (sp > 200) throw new ZsRuntimeError('E414');
          const args = stack.slice(sp - argc, sp);
          sp -= argc;
          const r = fns[code[pc + 1]](ctx, args, code[pc + 3]);
          stack[sp++] = r === undefined ? NA : r;
          pc += 4; break;
        }
        case OP.TUPLE: { const n = code[pc + 1]; const t = stack.slice(sp - n, sp); sp -= n; stack[sp++] = t; pc += 2; break; }
        case OP.UNPACK: {
          const n = code[pc + 1]; const t = stack[--sp];
          for (let k = 0; k < n; k++) stack[sp++] = Array.isArray(t) && k < t.length ? t[k] : NA;
          pc += 2; break;
        }
        case OP.LOOP: { const id = code[pc + 1]; if (++ctx.loops[id] > maxLoop) throw new ZsRuntimeError('E404'); pc += 2; break; }
        case OP.LOOPRESET: ctx.loops[code[pc + 1]] = 0; pc += 2; break;
        case OP.SEC: { const v = exec.secValue(code[pc + 1], ctx); stack[sp++] = v; pc += 3; break; }
        default: throw new ZsRuntimeError('E499', { why: 'bad opcode ' + op });
      }
      if (sp > 250 || sp < 0) throw new ZsRuntimeError(sp < 0 ? 'E499' : 'E414', { why: 'stack' });
    }
  } catch (e) {
    e.pc = pc;
    throw e;
  }
  // commit history
  for (const s of ctx.histSlots) ctx.rings.get(s)[ctx.bar % ctx.cap] = slots[s];
  return ops;
}

function histRead(ctx, s, n) {
  if (!fin(n) || n < 0) return NA;          // negative offsets would look into the future
  const k = Math.trunc(n);
  if (k === 0) return ctx.slots[s];
  if (k > ctx.cap - 1) throw new ZsRuntimeError('E402', { n: k, m: ctx.cap - 1 });
  if (ctx.bar - k < 0) return NA;
  return ctx.rings.get(s)[(ctx.bar - k) % ctx.cap];
}

function posOf(unit, pc) {
  const pos = unit.pos;
  let best = 65537;
  for (let i = 0; i < pos.length; i += 2) { if (pos[i] <= pc) best = pos[i + 1]; else break; }
  return { line: Math.floor(best / 65536), col: best % 65536 };
}

// ---------------------------------------------------------------- Exec: one script run
export class Exec {
  constructor(program, opts) {
    this.p = validateProgram(program);
    const o = opts || {};
    // limitsOverride can only make limits stricter (tests, slow devices), never looser
    this.lim = Object.assign({}, RUN_LIMITS);
    if (o.limitsOverride && typeof o.limitsOverride === 'object') for (const k of ['opsPerBar', 'loopIters', 'firstRunMs', 'updateMs']) { const v = o.limitsOverride[k]; if (fin(v) && v > 0 && v < this.lim[k]) this.lim[k] = v; }
    this.sym = Object.assign({ ticker: '', tickerid: '', type: '', currency: '', mintick: 0.01, pointvalue: 1 }, sanitizeSym(o.symbol));
    this.tfStr = typeof o.timeframe === 'string' ? o.timeframe.slice(0, 8) : '';
    this.tf = parseTf(this.tfStr);
    const al = o.allowed || {};
    this.allowed = { book: al.book === true, flow: al.flow === true, gex: al.gex === true, opt: al.opt === true };
    this.data = o.data && typeof o.data === 'object' ? o.data : {};
    this.lastClosed = !!o.lastBarClosed;
    this.fnTable = this.p.fns.map((f) => BUILTINS[f]);
    this.getters = this.p.bvars.map(makeGetter);
    this.inputVals = this.p.meta.inputs.map((d) => resolveInput(d, o.inputs ? o.inputs[d.id] : undefined));
    this.srcGetters = this.p.meta.inputs.map((d, i) => (d.kind === 'source' ? makeGetter(SOURCES.includes(this.inputVals[i]) ? this.inputVals[i] : 'close') : () => NA));
    this.isVarSlot = this.p.units.map((u) => { const a = new Uint8Array(u.nSlots); for (const s of u.vars) a[s] = 1; return a; });
    this.p.units.forEach((u, i) => { u.idx = i; });
    this.notices = new Map();
    this.draw = { label: new Map(), line: new Map(), box: new Map(), table: new Map() };
    this.drawSeq = 0;
    this.alertSeen = new Set();
    this.out = { alerts: [], hlines: [] };
    this.plots = []; this.fills = []; this.alerts = [];
    this.secOpts = o.securities || {};
    this.ms = 0;
  }

  notice(ns, kind) {
    const key = ns + ':' + kind;
    if (this.notices.has(key)) return;
    this.notices.set(key, kind === 'locked'
      ? NS_LABEL[ns] + ' data is part of Pro, so ' + NS_FN[ns] + ' values are na on this chart.'
      : 'No ' + NS_LABEL[ns].toLowerCase() + ' data for this symbol, so ' + NS_FN[ns] + ' values are na.');
  }
  plotBuf(id, candle) {
    let p = this.plots[id];
    if (!p) {
      p = this.plots[id] = { values: new Array(this.B.n).fill(NA), colors: new Array(this.B.n).fill(null), props: {} };
      if (candle) for (const k of ['open', 'high', 'low', 'close']) p[k] = new Array(this.B.n).fill(NA);
    }
    return p;
  }
  fillBuf(id) { let f = this.fills[id]; if (!f) f = this.fills[id] = { colors: new Array(this.B.n).fill(null) }; return f; }
  alertBuf(id) { let a = this.alerts[id]; if (!a) a = this.alerts[id] = { values: new Array(this.B.n).fill(0) }; return a; }

  // Full run over all bars. Returns the output object (SPEC 11.4).
  run(bars) {
    const t0 = Date.now();
    const deadline = t0 + this.lim.firstRunMs;
    try {
      this.B = prepBars(bars, this.tfStr);
      this.realtimeFrom = this.B.n;      // bars added later by update() are live
      this.main = new Ctx(this, this.p.units[0], this.B, true);
      this.prepSecurities(deadline);
      for (let i = 0; i < this.B.n; i++) {
        if (i === this.B.n - 1) this.snapshot();
        this.main.bar = i;
        runBar(this.main, deadline);
      }
      this.ms = Date.now() - t0;
      return this.output();
    } catch (e) { this.ms = Date.now() - t0; return this.fail(e); }
  }

  // Live update: same time = the last bar changed; newer time = a new bar.
  update(bar) {
    const t0 = Date.now();
    const deadline = t0 + this.lim.updateMs;
    try {
      if (!this.main || !bar) throw new ZsRuntimeError('E499', { why: 'update before run' });
      const B = this.B, last = B.n - 1, t = typeof bar.time === 'number' ? bar.time : NaN;
      if (last >= 0 && t === B.time[last]) {
        setBar(B, last, bar);
        this.restore();
        this.main.rerun = true;
      } else if (last < 0 || t > B.time[last]) {
        if (B.n >= RUN_LIMITS.bars) throw new ZsRuntimeError('E413');
        pushBar(B, bar);
        for (const p of this.plots) if (p) { p.values.push(NA); p.colors.push(null); if (p.open) for (const k of ['open', 'high', 'low', 'close']) p[k].push(NA); }
        for (const f of this.fills) if (f) f.colors.push(null);
        for (const a of this.alerts) if (a) a.values.push(0);
        this.snapshot();
        this.main.rerun = false;
      } else return this.output();       // an older bar: ignored
      if (bar.data) this.mergeData(bar.data);
      this.main.bar = B.n - 1;
      runBar(this.main, deadline);
      this.ms = Date.now() - t0;
      return this.output();
    } catch (e) { this.ms = Date.now() - t0; return this.fail(e); }
  }

  mergeData(d) {
    // per-bar data for the live bar: { book?, flow?: {buyvol, sellvol, ...}, gex?, opt? }
    const i = this.B.n - 1;
    for (const ns of ['book', 'gex', 'opt']) if (d[ns] !== undefined) { if (!Array.isArray(this.data[ns])) this.data[ns] = []; this.data[ns][i] = d[ns]; }
    if (d.flow && typeof d.flow === 'object') {
      if (!this.data.flow) this.data.flow = {};
      for (const k of ['buyvol', 'sellvol', 'trades', 'delta', 'cvd', 'poc', 'vah', 'val', 'bigtrades', 'footprint']) if (d.flow[k] !== undefined) { if (!this.data.flow[k]) this.data.flow[k] = []; this.data.flow[k][i] = d.flow[k]; }
      this.main.cvd.length = Math.min(this.main.cvd.length, i);
    }
  }

  snapshot() {
    const c = this.main;
    this.snap = {
      slots: clone(c.slots), inited: c.inited.slice(), st: clone(c.st), draw: clone(this.draw), drawSeq: this.drawSeq,
      alerts: this.out.alerts.length,
    };
  }
  restore() {
    const c = this.main, s = this.snap;
    if (!s) return;
    const keep = this.p.units[0].varip.map((k) => [k, c.slots[k], c.inited[k]]);
    c.slots = clone(s.slots); c.inited = s.inited.slice(); c.st = clone(s.st);
    for (const [k, v, ini] of keep) { c.slots[k] = v; c.inited[k] = ini; }
    this.draw = clone(s.draw); c.draw = this.draw; this.drawSeq = s.drawSeq;
    this.out.alerts.length = Math.min(this.out.alerts.length, s.alerts);
  }

  // request.security: run each expression unit on its own bars, then on each chart bar
  // return the value of the last higher-timeframe bar that has closed by this bar's close.
  prepSecurities(deadline) {
    this.sec = this.p.securities.map((s, id) => {
      const symbol = resolveFixed(s.symbol, this.inputVals);
      const timeframe = resolveFixed(s.timeframe, this.inputVals);
      const r = { id, n: s.n, symbol, timeframe, times: null, vals: null, j: -1, same: false };
      const sameSym = !symbol || symbol === this.sym.tickerid || symbol === this.sym.ticker;
      const sameTf = !timeframe || timeframe === this.tfStr;
      const given = this.secOpts[id];
      let B = null;
      if (sameSym && sameTf) { B = this.B; r.same = true; }
      else if (given && given.bars) B = prepBars(given.bars, timeframe);
      else { this.notices.set('sec:' + id, fmt(MESSAGES.E415, { sym: symbol || this.sym.ticker || 'this symbol', tf: timeframe || this.tfStr })); return r; }
      if (!sameTf && fin(tfToMs(timeframe)) && fin(this.B.tfMs) && tfToMs(timeframe) < this.B.tfMs) {
        this.notices.set('sec:' + id, fmt(MESSAGES.E352, { tf: timeframe }) + ' Use a timeframe equal to or higher than the chart.');
        return r;
      }
      const ctx = new Ctx(this, this.p.units[s.unit], B, false);
      const vals = new Array(B.n);
      for (let i = 0; i < B.n; i++) { ctx.bar = i; vals[i] = this.evalUnit(ctx, deadline); }
      r.times = B.time_close; r.vals = vals;
      return r;
    });
  }
  evalUnit(ctx, deadline) {
    // the unit's code leaves one value on the stack; runBar discards the stack, so read it here
    const u = ctx.u;
    runBar(ctx, deadline);
    return ctx.stack[0];
  }
  secValue(id, ctx) {
    const r = this.sec[id];
    const na = r.n ? new Array(r.n).fill(NA) : NA;
    if (!r.vals) return na;
    // shortcut: on the same symbol+timeframe a live bar added by update() has no value until the
    // next full run (hosts re-run on a new bar); upgrade when live request.security is needed.
    if (r.same) return ctx.bar < r.vals.length ? clone(r.vals[ctx.bar]) : na;
    const tClose = this.B.time_close[ctx.bar];
    // the pointer only moves forward (bars arrive in time order)
    if (r.j >= 0 && r.times[r.j] > tClose) r.j = -1;
    while (r.j + 1 < r.times.length && r.times[r.j + 1] <= tClose) r.j++;
    return r.j >= 0 ? clone(r.vals[r.j]) : na;
  }

  fail(e) {
    const out = this.output();
    out.ok = false;
    if (e instanceof ZsRuntimeError) {
      const unit = this.p.units[0];
      const pos = e.pc !== undefined ? posOf(unit, e.pc) : { line: 1, col: 1 };
      const d = diag(e.code, pos.line, pos.col, e.args);
      d.message = e.message; d.bar = this.main ? this.main.bar : 0;
      out.error = d;
    } else {
      out.error = diag('E499', 1, 1, { why: 'unexpected failure' });
      out.error.bar = this.main ? this.main.bar : 0;
    }
    return out;
  }

  output() {
    const n = this.B ? this.B.n : 0;
    const o = this.p.outputs;
    const plots = o.plots.map((d) => {
      const b = this.plots[d.id] || { values: new Array(n).fill(NA), colors: new Array(n).fill(null), props: {} };
      const pr = b.props || {};
      let color = null;
      for (let i = b.colors.length - 1; i >= 0; i--) if (b.colors[i]) { color = b.colors[i]; break; }
      const uniform = b.colors.every((c) => c === color || c === null);
      const out = { id: d.id, kind: d.kind, fn: d.fn, title: d.title, values: Float64Array.from(b.values), colors: uniform ? null : b.colors.slice(), color };
      for (const [k, v] of Object.entries(pr)) out[k] = typeof v === 'number' && v !== v ? null : v;
      if (b.open) for (const k of ['open', 'high', 'low', 'close']) out[k] = Float64Array.from(b[k]);
      return out;
    });
    const hlines = o.hlines.map((d) => this.out.hlines[d.id] || { id: d.id, price: null });
    const fills = o.fills.map((d) => {
      const f = this.fills[d.id] || { colors: [] };
      let color = null;
      for (let i = f.colors.length - 1; i >= 0; i--) if (f.colors[i]) { color = f.colors[i]; break; }
      const uniform = f.colors.every((c) => c === color || c === null);
      return { id: d.id, between: d.between, a: f.a, b: f.b, color, colors: uniform ? null : f.colors.slice(), title: f.title || '' };
    });
    const nn = (v) => (typeof v === 'number' && v !== v ? null : v);
    const plain = (m) => [...m.values()].map((x) => { const r = {}; for (const [k, v] of Object.entries(x)) if (k !== 'cells') r[k] = nn(v); return r; });
    const tables = [...this.draw.table.values()].map((t) => {
      const r = {}; for (const [k, v] of Object.entries(t)) if (k !== 'cells') r[k] = nn(v);
      r.cells = [...t.cells.values()].map((c) => { const x = {}; for (const [k, v] of Object.entries(c)) x[k] = nn(v); return x; });
      return r;
    });
    return {
      ok: true, error: null, bars: n, ms: this.ms,
      notices: [...this.notices.values()],
      plots, hlines, fills,
      labels: plain(this.draw.label), lines: plain(this.draw.line), boxes: plain(this.draw.box), tables,
      alerts: this.out.alerts.slice(),
      alertconditions: o.alertconditions.map((d) => ({ id: d.id, title: d.title, message: d.message, values: Uint8Array.from((this.alerts[d.id] || { values: new Array(n).fill(0) }).values) })),
    };
  }
}

function resolveFixed(v, inputVals) {
  if (!v) return '';
  if (typeof v.v === 'string') return v.v;
  if (Number.isInteger(v.input) && v.input >= 0) { const x = inputVals[v.input]; return typeof x === 'string' ? x : ''; }
  return '';
}

function sanitizeSym(s) {
  if (!s || typeof s !== 'object') return {};
  const o = {};
  for (const k of ['ticker', 'tickerid', 'type', 'currency']) if (typeof s[k] === 'string') o[k] = s[k].slice(0, 64);
  for (const k of ['mintick', 'pointvalue']) if (fin(s[k]) && s[k] > 0) o[k] = s[k];
  return o;
}

// Turn a member's setting into a value of the input's type; anything invalid -> default.
export function resolveInput(d, v) {
  const def = d.defval;
  const opt = Array.isArray(d.options) && d.options.length ? d.options : null;
  const pick = (x) => (opt && !opt.includes(x) ? def : x);
  switch (d.kind) {
    case 'int': case 'float': case 'price': {
      let x = typeof v === 'number' && fin(v) ? v : (typeof def === 'number' ? def : NA);
      if (d.kind === 'int' && fin(x)) x = Math.trunc(x);
      if (fin(d.minval) && x < d.minval) x = d.minval;
      if (fin(d.maxval) && x > d.maxval) x = d.maxval;
      return pick(x);
    }
    case 'bool': return typeof v === 'boolean' ? v : !!def;
    case 'color': {
      if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase() + 'ff';
      if (typeof v === 'string' && /^#[0-9a-fA-F]{8}$/.test(v)) return v.toLowerCase();
      return typeof def === 'string' ? def : NA;
    }
    case 'source': return typeof v === 'string' && SOURCES.includes(v) ? v : (SOURCES.includes(def) ? def : 'close');
    default: return pick(typeof v === 'string' && v.length <= 4096 ? v : (typeof def === 'string' ? def : ''));
  }
}

export { formatNum, FUNCTIONS, BAR_FIELDS };
