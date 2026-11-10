// Zscript compiler: AST -> checked program (bytecode). Type checking happens here, in the
// same walk that emits code. User functions are expanded (inlined) at each call site, so
// every call site has its own variables and its own ta.* state, and recursion is refused.
// Output program format: SPEC.md section 11.1. No member identifiers survive into it.
import { parse } from './parser.js?v=946';
import { diag, closest } from './errors.js?v=946';
import { OP, PROGRAM_VERSION } from './ops.js?v=946';
import { FUNCTIONS, VARIABLES, CONSTANTS, NAMESPACES, KEYWORD_LIST } from './catalog.js?v=946';
import { Scope, unify, assignable, fitsParam, typeFromSpec, describeType, isArr, isMap, isTup, elemOf, mapKV,
  tupItems, methodNs, NUM, DRAWING } from './checker.js?v=946';

export const LIMITS = Object.freeze({
  plots: 64, securities: 16, code: 2000000, maxBarsBack: 5000, labels: 500, lines: 500, boxes: 500, tables: 20,
});
// Built-in variables that are really stateful functions (no parens in source).
const VAR_FUNCS = { __proto__: null, 'ta.obv': ['__obv', []], 'ta.tr': ['ta.tr', [false]], 'ta.vwap': ['ta.vwap', ['hlc3', 'D']], 'ta.accdist': ['__accdist', []] };
// Bar fields readable n bars back without a hidden slot.
const BAR_HIST = new Set(['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'time', 'time_close', 'bar_index']);
const SOURCES = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'];
const RESERVED_ROOTS = new Set([...NAMESPACES].filter((n) => !n.includes('.')));
const INPUT_KIND = { __proto__: null, 'input.int': 'int', 'input.float': 'float', 'input.bool': 'bool', 'input.string': 'string', 'input.color': 'color',
  'input.source': 'source', 'input.timeframe': 'timeframe', 'input.price': 'price', 'input.text_area': 'text_area', 'input.symbol': 'symbol', input: null };
const PLOT_KIND = { __proto__: null, plot: 'plot', plotshape: 'shape', plotchar: 'char', plotarrow: 'arrow', plotcandle: 'candle', plotbar: 'bar', bgcolor: 'bgcolor', barcolor: 'barcolor' };

class Unit {
  constructor() { this.code = []; this.pos = []; this.nSlots = 0; this.hist = new Set(); this.vars = []; this.varip = []; this.nStates = 0; this.lastPos = null; }
}
class CompileStop extends Error {}

export function compile(src) {
  const { ast, diags } = parse(src);
  const c = new Compiler(diags);
  let program = null;
  if (!diags.some((d) => d.severity === 'error')) {
    try { program = c.program(ast); } catch (e) {
      if (!(e instanceof CompileStop)) throw e;
    }
  }
  const all = diags.slice().sort((a, b) => a.line - b.line || a.col - b.col);
  const ok = !all.some((d) => d.severity === 'error') && !!program;
  return { ok, diagnostics: all, program: ok ? program : null, meta: ok ? program.meta : (c.meta || null) };
}

class Compiler {
  constructor(diags) {
    this.diags = diags; this.consts = []; this.constIdx = new Map(); this.fns = []; this.fnIdx = new Map();
    this.bvars = []; this.bvarIdx = new Map(); this.units = []; this.funcs = new Map(); this.inline = [];
    this.loopCtx = []; this.condDepth = 0; this.loopDepth = 0; this.block = 0; this.secExpr = null;
    this.meta = null;
  }
  err(code, node, args, extra) {
    if (this.diags.filter((d) => d.severity === 'error').length >= 100) throw new CompileStop();
    this.diags.push(diag(code, node ? node.l : 1, node ? node.c : 1, args, extra));
  }
  warn(code, node, args) { if (!this.diags.some((d) => d.code === code && d.line === node.l && d.col === node.c)) this.diags.push(diag(code, node.l, node.c, args)); }

  // ---------- emission helpers ----------
  emit(op, ...a) {
    const u = this.u;
    const p = this.node ? this.node.l * 65536 + Math.min(this.node.c, 65535) : 65537;
    if (p !== u.lastPos) { u.pos.push(u.code.length, p); u.lastPos = p; }
    u.code.push(op, ...a);
    if (u.code.length > LIMITS.code) { this.err('E325', this.node); throw new CompileStop(); }
    return u.code.length - 1;   // index of the last operand (for patching jumps)
  }
  here() { return this.u.code.length; }
  patch(at, target) { this.u.code[at] = target; }
  constant(v) {
    const key = typeof v + ':' + String(v);
    let i = this.constIdx.get(key);
    if (i === undefined) { i = this.consts.length; this.consts.push(v); this.constIdx.set(key, i); }
    return i;
  }
  pushConst(v) {
    if (v === true) this.emit(OP.TRUE); else if (v === false) this.emit(OP.FALSE);
    else if (v === null || (typeof v === 'number' && v !== v)) this.emit(OP.NA);
    else this.emit(OP.CONST, this.constant(v));
  }
  fn(name) { let i = this.fnIdx.get(name); if (i === undefined) { i = this.fns.length; this.fns.push(name); this.fnIdx.set(name, i); } return i; }
  bvar(name) { let i = this.bvarIdx.get(name); if (i === undefined) { i = this.bvars.length; this.bvars.push(name); this.bvarIdx.set(name, i); } return i; }
  slot(mode) {
    const s = this.u.nSlots++;
    if (mode === 'var') this.u.vars.push(s);
    else if (mode === 'varip') { this.u.vars.push(s); this.u.varip.push(s); }
    return s;
  }
  state() { return this.u.nStates++; }
  call(name, argc, st = -1) { this.emit(OP.CALL, this.fn(name), argc, st); }
  get top() { return this.inline.length === 0 && this.block === 0; }

  // ---------- program ----------
  program(ast) {
    this.meta = { title: '', shorttitle: '', overlay: false, format: 'price', precision: null, scale: 'right', inputs: [],
      needs: { book: false, flow: false, gex: false, opt: false }, securities: [], plots: [], hlines: [], fills: [], alertconditions: [] };
    this.limits = { maxBarsBack: 500, labels: 50, lines: 50, boxes: 50, tables: 10 };
    this.outputs = { plots: [], hlines: [], fills: [], alertconditions: [] };
    this.securities = [];
    this.u = new Unit(); this.units.push(this.u);
    this.global = new Scope(null, 'global'); this.scope = this.global;
    let decl = 0;
    for (const s of ast.body) {
      if (s.k === 'FuncDef') {
        if (this.funcs.has(s.name)) this.err('E322', s, { f: s.name });
        else if (FUNCTIONS.has(s.name) || RESERVED_ROOTS.has(s.name) || VARIABLES.has(s.name)) this.err('E317', s, { x: s.name });
        else this.funcs.set(s.name, s);
      }
      if (s.k === 'ExprStmt' && s.expr.k === 'Call' && s.expr.callee.k === 'Ident' && s.expr.callee.name === 'indicator') decl++;
    }
    if (decl === 0) this.err('E301', { l: 1, c: 1 });
    for (const s of ast.body) {
      if (s.k === 'FuncDef') continue;
      this.stmt(s, false);
    }
    for (const [, v] of this.global.vars) if (!v.used && !v.input && v.node && v.kind !== 'hidden') this.warn('W103', v.node, { x: v.name });
    if (this.diags.some((d) => d.severity === 'error')) return null;
    const meta = this.meta;
    meta.plots = this.outputs.plots.map((p) => ({ id: p.id, title: p.title, kind: p.kind }));
    meta.alertconditions = this.outputs.alertconditions.map((a) => ({ id: a.id, title: a.title, message: a.message }));
    meta.securities = this.securities.map((s) => ({ id: s.id, symbol: s.symbol, timeframe: s.timeframe }));
    meta.maxBarsBack = this.limits.maxBarsBack;
    return {
      v: PROGRAM_VERSION,
      units: this.units.map((u) => ({ code: u.code, pos: u.pos, nSlots: u.nSlots, hist: [...u.hist], vars: u.vars, varip: u.varip, nStates: u.nStates })),
      consts: this.consts, fns: this.fns, bvars: this.bvars, limits: this.limits, outputs: this.outputs,
      securities: this.securities.map((s) => ({ unit: s.unit, symbol: s.symbol, timeframe: s.timeframe, n: s.n })),
      meta,
    };
  }

  // ---------- statements ----------
  // Compiles a statement. want=true leaves its value on the stack and returns its type.
  stmt(s, want) {
    const prev = this.node; this.node = s;
    try {
      switch (s.k) {
        case 'ExprStmt': {
          // every expression leaves exactly one value (void calls leave na)
          const t = this.expr(s.expr, true);
          if (!want) { this.emit(OP.POP); return 'void'; }
          return t === 'void' ? 'na' : t;
        }
        case 'VarDecl': return this.varDecl(s, want);
        case 'TupleDecl': return this.tupleDecl(s, want);
        case 'Assign': return this.assign(s, want);
        case 'If': return this.ifStmt(s, want);
        case 'For': return this.forStmt(s, want);
        case 'ForIn': return this.forIn(s, want);
        case 'While': return this.whileStmt(s, want);
        case 'Switch': return this.switchStmt(s, want);
        case 'Break': case 'Continue': {
          const lc = this.loopCtx[this.loopCtx.length - 1];
          if (!lc) { this.err('E208', s, { kw: s.k.toLowerCase() }); return 'void'; }
          if (want) this.emit(OP.NA);  // keeps the stack shape of value-producing blocks
          if (want) this.emit(OP.POP);
          this.emit(OP.JMP, 0);
          (s.k === 'Break' ? lc.breaks : lc.conts).push(this.here() - 1);
          if (want) this.emit(OP.NA);
          return want ? 'na' : 'void';
        }
        case 'FuncDef': this.err('E319', s); return want ? (this.emit(OP.NA), 'na') : 'void';
        default: this.err('E499', s, { why: 'unknown statement ' + s.k }); return 'void';
      }
    } finally { this.node = prev; }
  }

  // Runs a block in a new scope. Leaves the last statement's value if want.
  blockOf(b, want, setup) {
    const saved = this.scope;
    this.scope = new Scope(saved, 'block');
    this.block++;
    try {
      if (setup) setup();
      let t = 'void';
      const body = b.body;
      if (!body.length) { if (want) { this.emit(OP.NA); return 'na'; } return 'void'; }
      for (let i = 0; i < body.length; i++) t = this.stmt(body[i], want && i === body.length - 1);
      return t;
    } finally { this.block--; this.scope = saved; }
  }

  checkName(name, node) {
    if (RESERVED_ROOTS.has(name) || KEYWORD_LIST.includes(name)) { this.err('E327', node, { x: name }); return false; }
    return true;
  }

  declare(name, type, mode, node, extra) {
    if (this.scope.vars.has(name)) { this.err('E305', node, { x: name }); }
    const slot = this.slot(mode);
    const v = Object.assign({ name, type, slot, mode, node, used: false }, extra || {});
    this.scope.vars.set(name, v);
    return v;
  }

  varDecl(s, want) {
    this.checkName(s.name, s);
    const declared = typeFromSpec(s.type);
    if (declared && (isArr(declared) || isMap(declared))) this.checkNesting(declared, s);
    const mode = s.mode;
    let slot = -1, v = null;
    if (mode) {
      // var x = init: init runs once (first bar it is reached)
      v = this.declare(s.name, declared || 'na', mode, s);
      slot = v.slot;
      this.emit(OP.VARSKIP, slot, 0);
      const jAt = this.here() - 1;
      const t = this.rhs(s.value, declared);
      this.typeAssign(v, declared, t, s, true);
      this.emit(OP.STORE, slot);
      this.patch(jAt, this.here());
    } else {
      const isInput = this.isInputCall(s.value);
      const t = this.rhs(s.value, declared);
      v = this.declare(s.name, 'na', '', s);
      slot = v.slot;
      this.typeAssign(v, declared, t, s, true);
      if (isInput) { v.input = this.lastInput; v.used = true; }
      if (s.value.k === 'Str') v.constStr = s.value.v;
      this.emit(OP.STORE, slot);
    }
    if (want) { this.emit(OP.LOAD, slot); return v.type; }
    return 'void';
  }

  checkNesting(t, node) {
    const inner = isArr(t) ? [elemOf(t)] : mapKV(t);
    if (inner.some((x) => isArr(x) || isMap(x))) this.err('E328', node);
  }

  typeAssign(v, declared, t, node, isDecl) {
    if (t === 'void') { this.err('E326', node, { f: v.name }); v.type = declared || 'float'; return; }
    if (isTup(t)) { this.err('E314', node, { n: tupItems(t).length, m: 1 }); v.type = declared || 'float'; return; }
    if (declared) {
      if (!assignable(declared, t)) this.err('E310', node, { x: v.name, want: describeType(declared), got: describeType(t) });
      v.type = declared;
    } else v.type = t === 'na' ? 'float' : t;
    if (isArr(v.type) || isMap(v.type)) this.checkNesting(v.type, node);
  }

  isInputCall(e) {
    if (!e || e.k !== 'Call') return false;
    const n = dotted(e.callee);
    return n !== null && Object.prototype.hasOwnProperty.call(INPUT_KIND, n);
  }

  tupleDecl(s, want) {
    const t = this.rhs(s.value, null);
    const items = tupItems(t);
    if (!isTup(t)) { this.err('E314', s, { n: 1, m: s.names.length }); this.emit(OP.POP); }
    else if (items.length !== s.names.length) { this.err('E314', s, { n: items.length, m: s.names.length }); this.emit(OP.POP); }
    else {
      this.emit(OP.UNPACK, items.length);
      const vs = s.names.map((n, i) => {
        if (n.name === '_') return null;
        this.checkName(n.name, n);
        const v = this.declare(n.name, items[i] === 'na' ? 'float' : items[i], '', n);
        return v;
      });
      for (let i = vs.length - 1; i >= 0; i--) { if (vs[i]) this.emit(OP.STORE, vs[i].slot); else this.emit(OP.POP); }
    }
    if (want) { this.emit(OP.NA); return 'na'; }
    return 'void';
  }

  assign(s, want) {
    const found = this.scope.lookup(s.name);
    if (!found) {
      if (VARIABLES.has(s.name) || CONSTANTS.has(s.name)) this.err('E317', s, { x: s.name });
      else this.err('E306', s, { x: s.name }, { hint: suggest(s.name, this.scope.names()) || undefined });
      this.rhs(s.value, null);
      if (!want) this.emit(OP.POP);
      return want ? 'na' : 'void';
    }
    const v = found.v;
    if (v.kind === 'loopvar') this.err('E317', s, { x: s.name });
    v.used = true;
    let t;
    if (s.op === ':=') t = this.rhs(s.value, v.type);
    else {
      this.emit(OP.LOAD, v.slot);
      const rt = this.rhs(s.value, null);
      t = this.arith(s.op[0], v.type, rt, s);
    }
    if (t === 'void') this.err('E326', s, { f: s.name });
    else if (!assignable(v.type, t)) this.err('E311', s, { x: s.name, want: describeType(v.type), got: describeType(t) });
    if (v.type === 'float' && false) this.emit(OP.NOP);
    this.emit(want ? OP.STOREK : OP.STORE, v.slot);
    return want ? v.type : 'void';
  }

  rhs(e, hint) {
    switch (e.k) {
      case 'If': return this.ifStmt(e, true);
      case 'Switch': return this.switchStmt(e, true);
      case 'For': return this.forStmt(e, true);
      case 'ForIn': return this.forIn(e, true);
      case 'While': return this.whileStmt(e, true);
      default: { const t = this.expr(e, false, hint); return t; }
    }
  }

  condExpr(e) {
    const t = this.expr(e);
    if (!(t === 'bool' || NUM.has(t) || t === 'na' || t === 'any')) this.err('E313', e, { got: describeType(t) });
    this.emit(OP.TOBOOL);
  }

  ifStmt(s, want) {
    this.node = s;
    this.condExpr(s.cond);
    this.emit(OP.JF, 0); const jf = this.here() - 1;
    this.condDepth++;
    let ta, tb = 'na';
    try {
      ta = this.blockOf(s.then, want);
      this.emit(OP.JMP, 0); const je = this.here() - 1;
      this.patch(jf, this.here());
      if (s.else) {
        if (s.else.k === 'If') { const prev = this.node; this.block++; try { tb = this.ifStmt(s.else, want); } finally { this.block--; this.node = prev; } }
        else tb = this.blockOf(s.else, want);
      } else if (want) this.emit(OP.NA);
      this.patch(je, this.here());
    } finally { this.condDepth--; }
    if (!want) return 'void';
    return this.branchType(ta, tb, s);
  }

  branchType(a, b, node) {
    const u = unify(a, b);
    if (u === null) { this.err('E323', node, { a: describeType(a), b: describeType(b) }); return a; }
    return u;
  }

  loopBegin() { const lc = { breaks: [], conts: [], id: this.state() }; this.loopCtx.push(lc); this.loopDepth++; this.condDepth++; return lc; }
  loopEnd(lc, contTarget, endTarget) {
    for (const at of lc.conts) this.patch(at, contTarget);
    for (const at of lc.breaks) this.patch(at, endTarget);
    this.loopCtx.pop(); this.loopDepth--; this.condDepth--;
  }

  forStmt(s, want) {
    const saved = this.scope;
    this.scope = new Scope(saved, 'block'); this.block++;
    try {
      const ti = this.expr(s.from);
      if (!isNumLike(ti)) this.err('E309', s.from, { p: 'from', f: 'for', want: 'a number', got: describeType(ti) });
      const iv = this.declare(s.name, 'int', '', s, { kind: 'loopvar', used: true });
      if (ti === 'float') iv.type = 'float';
      this.emit(OP.STORE, iv.slot);
      const tt = this.expr(s.to);
      if (!isNumLike(tt)) this.err('E309', s.to, { p: 'to', f: 'for', want: 'a number', got: describeType(tt) });
      const to = this.slot(''), step = this.slot(''), val = this.slot('');
      this.emit(OP.STORE, to);
      // step = |by| (default 1), negative when counting down
      let absBy = -1;
      if (s.by) {
        const tb = this.expr(s.by);
        if (!isNumLike(tb)) this.err('E309', s.by, { p: 'by', f: 'for', want: 'a number', got: describeType(tb) });
        if (tb === 'float') iv.type = 'float';
        this.call('math.abs', 1); absBy = this.slot(''); this.emit(OP.STORE, absBy);
      }
      this.emit(OP.LOAD, to); this.emit(OP.LOAD, iv.slot); this.emit(OP.GE); this.emit(OP.JF, 0); const jneg = this.here() - 1;
      if (absBy >= 0) this.emit(OP.LOAD, absBy); else this.pushConst(1);
      this.emit(OP.JMP, 0); const jdone = this.here() - 1;
      this.patch(jneg, this.here());
      if (absBy >= 0) this.emit(OP.LOAD, absBy); else this.pushConst(1);
      this.emit(OP.NEG);
      this.patch(jdone, this.here());
      this.emit(OP.STORE, step);
      if (want) { this.emit(OP.NA); this.emit(OP.STORE, val); }
      const lc = this.loopBegin();
      this.emit(OP.LOOPRESET, lc.id);
      const top = this.here();
      this.emit(OP.LOAD, step); this.pushConst(0); this.emit(OP.GT); this.emit(OP.JF, 0); const jdown = this.here() - 1;
      this.emit(OP.LOAD, iv.slot); this.emit(OP.LOAD, to); this.emit(OP.LE); this.emit(OP.JMP, 0); const jchk = this.here() - 1;
      this.patch(jdown, this.here());
      this.emit(OP.LOAD, iv.slot); this.emit(OP.LOAD, to); this.emit(OP.GE);
      this.patch(jchk, this.here());
      this.emit(OP.JF, 0); const jend = this.here() - 1;
      const tv = this.blockOf(s.body, want);
      if (want) this.emit(OP.STORE, val);
      const cont = this.here();
      this.emit(OP.LOOP, lc.id);
      this.emit(OP.LOAD, iv.slot); this.emit(OP.LOAD, step); this.emit(OP.ADD); this.emit(OP.STORE, iv.slot);
      this.emit(OP.JMP, top);
      const end = this.here();
      this.patch(jend, end);
      this.loopEnd(lc, cont, end);
      if (want) { this.emit(OP.LOAD, val); return tv === 'void' ? 'na' : tv; }
      return 'void';
    } finally { this.block--; this.scope = saved; }
  }

  forIn(s, want) {
    const saved = this.scope;
    this.scope = new Scope(saved, 'block'); this.block++;
    try {
      const ta = this.expr(s.iter);
      if (!isArr(ta) && ta !== 'na' && ta !== 'any') this.err('E309', s.iter, { p: 'in', f: 'for', want: 'an array', got: describeType(ta) });
      const arr = this.slot(''), idx = this.slot(''), val = this.slot('');
      this.emit(OP.STORE, arr);
      this.pushConst(0); this.emit(OP.STORE, idx);
      if (want) { this.emit(OP.NA); this.emit(OP.STORE, val); }
      const lc = this.loopBegin();
      this.emit(OP.LOOPRESET, lc.id);
      const top = this.here();
      this.emit(OP.LOAD, idx); this.emit(OP.LOAD, arr); this.call('__size', 1); this.emit(OP.LT);
      this.emit(OP.JF, 0); const jend = this.here() - 1;
      const tv = this.blockOf(s.body, want, () => {
        if (s.idx) { const iv = this.declare(s.idx, 'int', '', s, { kind: 'loopvar', used: true }); this.emit(OP.LOAD, idx); this.emit(OP.STORE, iv.slot); }
        const xv = this.declare(s.name, elemOf(ta) === 'any' ? 'float' : elemOf(ta), '', s, { kind: 'loopvar', used: true });
        this.emit(OP.LOAD, arr); this.emit(OP.LOAD, idx); this.call('__get', 2); this.emit(OP.STORE, xv.slot);
      });
      if (want) this.emit(OP.STORE, val);
      const cont = this.here();
      this.emit(OP.LOOP, lc.id);
      this.emit(OP.LOAD, idx); this.pushConst(1); this.emit(OP.ADD); this.emit(OP.STORE, idx);
      this.emit(OP.JMP, top);
      const end = this.here();
      this.patch(jend, end);
      this.loopEnd(lc, cont, end);
      if (want) { this.emit(OP.LOAD, val); return tv === 'void' ? 'na' : tv; }
      return 'void';
    } finally { this.block--; this.scope = saved; }
  }

  whileStmt(s, want) {
    const val = want ? this.slot('') : -1;
    if (want) { this.emit(OP.NA); this.emit(OP.STORE, val); }
    const lc = this.loopBegin();
    this.emit(OP.LOOPRESET, lc.id);
    const top = this.here();
    this.condExpr(s.cond);
    this.emit(OP.JF, 0); const jend = this.here() - 1;
    const tv = this.blockOf(s.body, want);
    if (want) this.emit(OP.STORE, val);
    const cont = this.here();
    this.emit(OP.LOOP, lc.id);
    this.emit(OP.JMP, top);
    const end = this.here();
    this.patch(jend, end);
    this.patch(jend, end);
    this.loopEnd(lc, top, end);
    for (const at of lc.conts) this.patch(at, cont);
    if (want) { this.emit(OP.LOAD, val); return tv === 'void' ? 'na' : tv; }
    return 'void';
  }

  switchStmt(s, want) {
    let subj = -1, st = null;
    if (s.subject) { st = this.expr(s.subject); subj = this.slot(''); this.emit(OP.STORE, subj); }
    const ends = [];
    let type = 'na', haveDefault = false;
    this.condDepth++;
    try {
      for (const cs of s.cases) {
        this.node = cs;
        let jf = -1;
        if (cs.test) {
          if (subj >= 0) {
            this.emit(OP.LOAD, subj);
            const tt = this.expr(cs.test);
            if (unify(st, tt) === null) this.err('E312', cs.test, { op: '==', a: describeType(st), b: describeType(tt) });
            this.emit(OP.EQ);
          } else this.condExpr(cs.test);
          this.emit(OP.JF, 0); jf = this.here() - 1;
        } else haveDefault = true;
        const t = this.blockOf(cs.body, want);
        if (want) type = this.branchType(type, t, cs);
        this.emit(OP.JMP, 0); ends.push(this.here() - 1);
        if (jf >= 0) this.patch(jf, this.here());
      }
      if (want) this.emit(OP.NA);
    } finally { this.condDepth--; }
    for (const at of ends) this.patch(at, this.here());
    void haveDefault;
    return want ? type : 'void';
  }

  // ---------- expressions ----------
  // Leaves one value; returns its type ('void' only for calls with no value when allowVoid).
  expr(e, allowVoid, hint) {
    const prev = this.node; this.node = e;
    try {
      const t = this.expr0(e, hint);
      if (t === 'void' && !allowVoid) { this.err('E326', e, { f: calleeName(e) }); return 'na'; }
      return t;
    } finally { this.node = prev; }
  }

  expr0(e, hint) {
    switch (e.k) {
      case 'Num': this.pushConst(e.v); return e.int ? 'int' : 'float';
      case 'Str': this.pushConst(e.v); return 'string';
      case 'Color': this.pushConst(e.v); return 'color';
      case 'Bool': this.pushConst(e.v); return 'bool';
      case 'Na': this.emit(OP.NA); return 'na';
      case 'Ident': return this.ident(e);
      case 'Member': return this.member(e);
      case 'Call': return this.callExpr(e, hint);
      case 'Index': return this.index(e);
      case 'Tuple': {
        const ts = e.items.map((it) => this.expr(it));
        this.emit(OP.TUPLE, ts.length);
        return 'tup<' + ts.join(',') + '>';
      }
      case 'Unary': {
        if (e.op === 'not') { this.condExpr(e.a); this.emit(OP.NOT); return 'bool'; }
        const t = this.expr(e.a);
        if (!isNumLike(t)) { this.err('E312', e, { op: e.op, a: describeType(t), b: '(nothing)' }); return 'float'; }
        if (e.op === '-') this.emit(OP.NEG);
        return t === 'na' ? 'float' : t;
      }
      case 'Binary': return this.binary(e);
      case 'Ternary': {
        this.condExpr(e.cond);
        this.emit(OP.JF, 0); const jf = this.here() - 1;
        const ta = this.expr(e.a);
        this.emit(OP.JMP, 0); const je = this.here() - 1;
        this.patch(jf, this.here());
        const tb = this.expr(e.b);
        this.patch(je, this.here());
        return this.branchType(ta, tb, e);
      }
      case 'If': case 'Switch': case 'For': case 'ForIn': case 'While': return this.rhs(e, hint);
      default: this.err('E499', e, { why: 'unknown expression ' + e.k }); this.emit(OP.NA); return 'na';
    }
  }

  binary(e) {
    if (e.op === 'and' || e.op === 'or') {
      this.condExpr(e.a);
      this.emit(OP.DUP);
      this.emit(e.op === 'and' ? OP.JF : OP.JT, 0); const j = this.here() - 1;
      this.emit(OP.POP);
      this.condExpr(e.b);
      this.patch(j, this.here());
      return 'bool';
    }
    const ta = this.expr(e.a);
    const tb = this.expr(e.b);
    if (['+', '-', '*', '/', '%'].includes(e.op)) return this.arith(e.op, ta, tb, e);
    // comparisons
    const op = { '==': OP.EQ, '!=': OP.NE, '<': OP.LT, '<=': OP.LE, '>': OP.GT, '>=': OP.GE }[e.op];
    if (e.op === '==' || e.op === '!=') {
      const ok = unify(ta, tb) !== null && !isTup(ta) && !isTup(tb) || (isNumLike(ta) && isNumLike(tb));
      if (!ok) this.err('E312', e, { op: e.op, a: describeType(ta), b: describeType(tb) });
    } else if (!(isNumLike(ta) && isNumLike(tb)) && !(ta === 'string' && tb === 'string')) {
      this.err('E312', e, { op: e.op, a: describeType(ta), b: describeType(tb) });
    }
    this.emit(op);
    return 'bool';
  }

  arith(op, ta, tb, node) {
    if (op === '+' && (ta === 'string' || tb === 'string')) {
      if (!((ta === 'string' || ta === 'na') && (tb === 'string' || tb === 'na'))) this.err('E312', node, { op, a: describeType(ta), b: describeType(tb) }, { hint: 'Convert the number to text with str.tostring(x).' });
      this.emit(OP.SADD); return 'string';
    }
    if (!isNumLike(ta) || !isNumLike(tb)) { this.err('E312', node, { op, a: describeType(ta), b: describeType(tb) }); return 'float'; }
    this.emit({ '+': OP.ADD, '-': OP.SUB, '*': OP.MUL, '/': OP.DIV, '%': OP.MOD }[op]);
    if (op === '/') return 'float';
    return ta === 'int' && tb === 'int' ? 'int' : 'float';
  }

  ident(e) {
    const found = this.scope.lookup(e.name);
    if (found) {
      found.v.used = true;
      if (this.secExpr && found.scope === this.secExpr.outer) { this.err('E350', e, { x: e.name }); this.emit(OP.NA); return found.v.type; }
      this.emit(OP.LOAD, found.v.slot);
      return found.v.type;
    }
    return this.builtinName(e.name, e);
  }

  builtinName(name, e) {
    if (VAR_FUNCS[name]) {
      const [fname, args] = VAR_FUNCS[name];
      const f = FUNCTIONS.get(fname);
      for (const a of args) { if (SOURCES.includes(a)) this.emit(OP.BVAR, this.bvar(a)); else this.pushConst(a); }
      this.call(fname, args.length, this.state());
      if (this.condDepth && f) this.warn('W101', e, { f: name });
      return 'float';
    }
    const v = VARIABLES.get(name);
    if (v) {
      if (v.data) this.meta.needs[v.data] = true;
      this.emit(OP.BVAR, this.bvar(name));
      return v.type;
    }
    const c = CONSTANTS.get(name);
    if (c) { this.pushConst(c.value); return c.type; }
    if (FUNCTIONS.has(name) || this.funcs.has(name)) { this.err('E315', e, { x: name }, { hint: 'Call it with ( ), e.g. `' + name + '(...)`.' }); this.emit(OP.NA); return 'na'; }
    const pool = name.includes('.')
      ? [...VARIABLES.keys(), ...CONSTANTS.keys(), ...FUNCTIONS.keys()].filter((k) => k.split('.')[0] === name.split('.')[0])
      : [...this.scope.names(), ...[...VARIABLES.keys()].filter((k) => !k.includes('.')), ...this.funcs.keys()];
    const near = closest(name, pool.length ? pool : [...VARIABLES.keys(), ...CONSTANTS.keys()]);
    this.err('E303', e, { x: name }, { hint: near ? 'Did you mean `' + near + '`?' : '' });
    this.emit(OP.NA);
    return 'na';
  }

  member(e) {
    const d = dotted(e);
    if (d !== null && !this.scope.lookup(d.split('.')[0])) return this.builtinName(d, { l: e.l, c: e.c });
    // property access on a value is not part of v1 (no user types)
    this.err('E303', e, { x: d || e.name }, { hint: 'Use a function, e.g. `array.size(a)` or `a.size()`.' });
    this.emit(OP.NA);
    return 'na';
  }

  index(e) {
    // x[n]: history
    const base = e.obj;
    const lookupName = base.k === 'Ident' ? base.name : null;
    if (lookupName && !this.scope.lookup(lookupName) && BAR_HIST.has(lookupName)) {
      this.histOffset(e.index);
      this.emit(OP.BHIST, this.bvar(lookupName));
      return VARIABLES.get(lookupName).type;
    }
    if (lookupName && this.scope.lookup(lookupName)) {
      const { v, scope } = this.scope.lookup(lookupName);
      v.used = true;
      if (isArr(v.type) || isMap(v.type)) { this.err('E324', e, { t: describeType(v.type) }); this.emit(OP.NA); return 'na'; }
      if (this.secExpr && scope === this.secExpr.outer) { this.err('E350', base, { x: lookupName }); this.emit(OP.NA); return v.type; }
      this.u.hist.add(v.slot);
      this.histOffset(e.index);
      this.emit(OP.HIST, v.slot);
      return v.type;
    }
    // any other expression: keep it in a hidden slot with history
    const t = this.expr(base);
    if (isArr(t) || isMap(t) || isTup(t)) { this.err('E324', e, { t: describeType(t) }); this.emit(OP.POP); this.emit(OP.NA); return 'na'; }
    const h = this.slot('');
    this.u.hist.add(h);
    this.emit(OP.STORE, h);
    this.histOffset(e.index);
    this.emit(OP.HIST, h);
    return t;
  }

  histOffset(ix) {
    const t = this.expr(ix);
    if (!(t === 'int' || t === 'float' || t === 'na')) this.err('E316', ix, { got: describeType(t) });
    if (ix.k === 'Num' && ix.v > this.limits.maxBarsBack && ix.v <= LIMITS.maxBarsBack) this.limits.maxBarsBack = Math.ceil(ix.v);
  }

  // ---------- calls ----------
  callExpr(e, hint) {
    const callee = e.callee;
    // method call: obj.name(args) where obj is a value
    if (callee.k === 'Member') {
      const d = dotted(callee);
      const root = d === null ? null : d.split('.').slice(0, -1).join('.');
      const rootLocal = d === null || this.scope.lookup(d.split('.')[0]) || (VARIABLES.has(root) && !FUNCTIONS.has(d));
      if (rootLocal) return this.methodCall(e);
      return this.builtinCall(d, e.args, e, callee.typeArgs);
    }
    if (callee.k === 'Ident') {
      const name = callee.name;
      if (this.funcs.has(name)) return this.userCall(name, e);
      if (FUNCTIONS.has(name)) return this.builtinCall(name, e.args, e, null);
      if (this.scope.lookup(name) || VARIABLES.has(name)) { this.err('E315', callee, { x: name }); this.emit(OP.NA); return 'na'; }
      const near = closest(name, [...this.funcs.keys(), ...[...FUNCTIONS.keys()]]);
      this.err('E304', callee, { f: name }, { hint: near ? 'Did you mean `' + near + '`?' : '' });
      for (const a of e.args) { this.expr(a.value, true); this.emit(OP.POP); }
      this.emit(OP.NA);
      return 'na';
    }
    this.err('E315', callee, { x: '(expression)' });
    this.emit(OP.NA);
    return 'na';
  }

  methodCall(e) {
    const callee = e.callee;
    const pre = this.node;
    const t = this.expr(callee.obj);
    this.node = pre;
    const ns = methodNs(t);
    const fname = ns ? ns + '.' + callee.name : null;
    if (!fname || !FUNCTIONS.has(fname) || !FUNCTIONS.get(fname).params.length || !['array', 'map', 'label', 'line', 'box', 'table'].includes(FUNCTIONS.get(fname).params[0].type)) {
      const pool = ns ? [...FUNCTIONS.keys()].filter((k) => k.startsWith(ns + '.')).map((k) => k.slice(ns.length + 1)) : [];
      const near = closest(callee.name, pool);
      this.err('E320', { l: callee.nl || callee.l, c: callee.nc || callee.c }, { m: callee.name, t: describeType(t) }, { hint: near ? 'Did you mean `' + near + '`?' : '' });
      this.emit(OP.POP);
      for (const a of e.args) { this.expr(a.value, true); this.emit(OP.POP); }
      this.emit(OP.NA);
      return 'na';
    }
    return this.builtinCall(fname, e.args, e, callee.typeArgs, t);
  }

  // Map source args onto catalog params. Returns ordered list of {p, arg} (arg null = default).
  bindArgs(f, args, node, preType) {
    const out = f.params.map((p) => ({ p, arg: null, rest: p.rest ? [] : null }));
    let pos = preType !== undefined ? 1 : 0, sawNamed = false;
    // ta.highest(5) / ta.pivothigh(3, 3): a leading param with a default is skipped when the
    // positional args only cover the required params after it.
    const npos = args.filter((x) => !x.name).length;
    const req = (k) => f.params.slice(k).filter((p) => p.def === undefined && !p.rest).length;
    while (pos < f.params.length - 1 && f.params[pos].def !== undefined && req(pos + 1) > 0 && npos <= req(pos + 1) && !f.variadic) pos++;
    for (const a of args) {
      if (a.name) {
        sawNamed = true;
        const k = f.params.findIndex((p) => p.name === a.name);
        if (k < 0 || (preType !== undefined && k === 0)) {
          const near = closest(a.name, f.params.map((p) => p.name));
          this.err('E308', a, { f: f.name, p: a.name }, { hint: near ? 'Did you mean `' + near + '`?' : '' });
          continue;
        }
        out[k].arg = a;
      } else {
        if (sawNamed) this.err('E321', a);
        if (pos < out.length && out[pos].rest) { out[pos].rest.push(a); continue; }
        if (pos >= out.length) { this.err('E307', a, { f: f.name, n: countArgs(f), m: args.length + (preType !== undefined ? 1 : 0) }); break; }
        out[pos].arg = a; pos++;
      }
    }
    for (let i = 0; i < out.length; i++) {
      const b = out[i];
      if (i === 0 && preType !== undefined) continue;
      if (!b.arg && !b.rest && b.p.def === undefined) this.err('E307', node, { f: f.name, n: countArgs(f), m: args.length + (preType !== undefined ? 1 : 0) });
    }
    return out;
  }

  pushDefault(def) {
    if (def.na) { this.emit(OP.NA); return 'na'; }
    if (def.var) {
      if (SOURCES.includes(def.var)) { this.emit(OP.BVAR, this.bvar(def.var)); return 'float'; }
      const c = CONSTANTS.get(def.var); if (c) { this.pushConst(c.value); return c.type; }
      this.emit(OP.NA); return 'na';
    }
    this.pushConst(def.v);
    return def.color ? 'color' : typeof def.v === 'boolean' ? 'bool' : typeof def.v === 'string' ? 'string' : def.int ? 'int' : 'float';
  }

  builtinCall(name, args, node, typeArgs, preType) {
    const f = FUNCTIONS.get(name);
    if (!f) {
      const root = name.split('.')[0];
      const pool = [...FUNCTIONS.keys()].filter((k) => k.split('.')[0] === root);
      const near = closest(name, pool.length ? pool : [...FUNCTIONS.keys()]);
      this.err('E304', node, { f: name }, { hint: near ? 'Did you mean `' + near + '`?' : '' });
      for (const a of args) { this.expr(a.value, true); this.emit(OP.POP); }
      this.emit(OP.NA);
      return 'na';
    }
    if (f.top && !this.top) { this.err('E340', node, { f: name }); }
    if (f.data) this.meta.needs[f.data] = true;
    if (name === 'indicator') return this.indicator(f, args, node);
    if (Object.prototype.hasOwnProperty.call(INPUT_KIND, name)) return this.input(name, f, args, node);
    if (name === 'request.security') return this.security(f, args, node);
    const bound = this.bindArgs(f, args, node, preType);
    const types = [];
    let argc = 0;
    for (let i = 0; i < bound.length; i++) {
      const b = bound[i];
      if (i === 0 && preType !== undefined) { types.push(preType); this.checkArg(f, b.p, preType, node); argc++; continue; }
      if (b.rest) {
        for (const a of b.rest) { const t = this.expr(a.value); types.push(t); this.checkArg(f, b.p, t, a); argc++; }
        continue;
      }
      let t;
      if (b.arg) { t = this.expr(b.arg.value); this.checkArg(f, b.p, t, b.arg); }
      else if (b.p.def !== undefined) t = this.pushDefault(b.p.def);
      else { this.emit(OP.NA); t = 'na'; }
      types.push(t); argc++;
    }
    // the stateful / output call sites get their own state index
    let st = -1;
    const kind = PLOT_KIND[name];
    if (kind) st = this.plotOutput(name, kind, bound, node);
    else if (name === 'hline') st = this.hlineOutput(bound);
    else if (name === 'fill') st = this.fillOutput(bound, types, node);
    else if (name === 'alertcondition') st = this.alertOutput(bound);
    else if (f.state) {
      st = this.state();
      if (this.condDepth && !this.loopDepth && name.startsWith('ta.')) this.warn('W101', node, { f: name });
      else if (this.loopDepth && name.startsWith('ta.')) this.warn('W102', node, { f: name });
    }
    if (name.startsWith('array.new') || name === 'array.from' || name === 'map.new' || name === 'str.split') st = Math.max(st, -1);
    this.call(name, argc, st);
    return this.retType(f, types, typeArgs, node, bound);
  }

  checkArg(f, p, t, node) {
    if (isTup(t)) { this.err('E309', node, { p: p.name, f: f.name, want: describeType(p.type === 'num' ? 'float' : p.type), got: describeType(t) }); return; }
    if (!fitsParam(p.type, t)) this.err('E309', node, { p: p.name, f: f.name, want: p.type === 'num' ? 'a number' : describeType(p.type), got: describeType(t) });
  }

  retType(f, types, typeArgs, node, bound) {
    const r = f.ret;
    const numOf = () => { let int = true; f.params.forEach((p, i) => { if (p.type === 'num' && !p.rest && types[i] !== 'int') int = false; }); if (f.variadic) for (let i = f.params.length - 1; i < types.length; i++) if (types[i] !== 'int') int = false; return int ? 'int' : 'float'; };
    if (r === 'num') {
      if (f.name === 'math.round' && bound[1] && bound[1].arg) return 'float';
      if (f.name === 'ta.change' && types[0] === 'bool') return 'bool';
      return numOf();
    }
    if (r === 'arg0' || r === 'arg1' || r === 'arg2') {
      const t = types[Number(r[3])];
      if (t === 'na' && f.name === 'nz') return types[1] || 'float';
      return t === 'na' ? 'float' : t;
    }
    if (r === 'elem0') { const e = elemOf(types[0]); return e === 'any' ? 'float' : e; }
    if (r === 'vals0') return mapKV(types[0])[1];
    if (r === 'keys0') return 'arr<' + mapKV(types[0])[0] + '>';
    if (r === 'valarr0') return 'arr<' + mapKV(types[0])[1] + '>';
    if (r === 'fromarr') {
      let t = 'na';
      for (const x of types) { const u = unify(t, x); if (u === null) { this.err('E323', node, { a: describeType(t), b: describeType(x) }); break; } t = u; }
      return 'arr<' + (t === 'na' ? 'float' : t) + '>';
    }
    if (r === 'newarr') {
      let t = typeArgs && typeArgs[0] ? typeFromSpec(typeArgs[0]) : (types[1] && types[1] !== 'na' ? types[1] : 'float');
      if (isArr(t) || isMap(t)) this.err('E328', node);
      return 'arr<' + t + '>';
    }
    if (r === 'newmap') {
      const k = typeArgs && typeArgs[0] ? typeFromSpec(typeArgs[0]) : 'string';
      const v = typeArgs && typeArgs[1] ? typeFromSpec(typeArgs[1]) : 'float';
      if (isArr(k) || isMap(k) || isArr(v) || isMap(v)) this.err('E328', node);
      return 'map<' + k + ',' + v + '>';
    }
    if (r.startsWith('arr:')) return 'arr<' + r.slice(4) + '>';
    if (r[0] === '[') return 'tup<' + r.slice(1, -1) + '>';
    return r;
  }

  literalOf(a) {
    if (!a) return undefined;
    const e = a.value || a;
    if (e.k === 'Num' || e.k === 'Str' || e.k === 'Bool' || e.k === 'Color') return e.v;
    if (e.k === 'Na') return null;
    if (e.k === 'Unary' && e.op === '-' && e.a.k === 'Num') return -e.a.v;
    if (e.k === 'Tuple' && e.items.every((x) => this.literalOf(x) !== undefined)) return e.items.map((x) => this.literalOf(x));
    const d = dotted(e);
    if (d && !this.scope.lookup(d.split('.')[0]) && CONSTANTS.has(d)) return CONSTANTS.get(d).value;
    return undefined;
  }

  staticArgs(f, args, node) {
    const bound = this.bindArgs(f, args, node);
    const o = {};
    for (const b of bound) {
      if (b.arg) {
        const v = this.literalOf(b.arg);
        if (v === undefined) { this.err('E329', b.arg, { p: b.p.name, f: f.name }); continue; }
        o[b.p.name] = v;
      } else if (b.p.def !== undefined) o[b.p.name] = b.p.def.na ? null : b.p.def.var ? b.p.def.var : b.p.def.v;
    }
    return o;
  }

  indicator(f, args, node) {
    if (this.declared) this.err('E302', node);
    this.declared = true;
    const o = this.staticArgs(f, args, node);
    const m = this.meta;
    m.title = typeof o.title === 'string' ? o.title.slice(0, 120) : '';
    m.shorttitle = typeof o.shorttitle === 'string' ? o.shorttitle.slice(0, 40) : '';
    m.overlay = !!o.overlay; m.format = o.format || 'price'; m.precision = o.precision == null ? null : o.precision; m.scale = o.scale || 'right';
    const clamp = (v, d, hi) => (typeof v === 'number' && v === v ? Math.max(1, Math.min(hi, Math.floor(v))) : d);
    this.limits.maxBarsBack = Math.max(this.limits.maxBarsBack, clamp(o.max_bars_back, 500, LIMITS.maxBarsBack));
    this.limits.labels = clamp(o.max_labels_count, 50, LIMITS.labels);
    this.limits.lines = clamp(o.max_lines_count, 50, LIMITS.lines);
    this.limits.boxes = clamp(o.max_boxes_count, 50, LIMITS.boxes);
    this.limits.tables = clamp(o.max_tables_count, 10, LIMITS.tables);
    this.emit(OP.NA);
    return 'void';
  }

  input(name, f, args, node) {
    const first = args[0] && !args[0].name ? args[0] : args.find((a) => a.name === 'defval');
    let kind = INPUT_KIND[name];
    const bound = this.bindArgs(f, args, node);
    const desc = { id: this.meta.inputs.length, kind: null, title: '', defval: null };
    // input.source default is a built-in series name, not a literal
    if (kind === 'source') {
      let src = 'close';
      if (first) {
        const d = dotted(first.value);
        if (d && SOURCES.includes(d) && !this.scope.lookup(d)) src = d;
        else this.err('E330', first);
      }
      desc.defval = src;
    } else if (first) {
      const v = this.literalOf(first);
      if (v === undefined || Array.isArray(v)) this.err('E330', first);
      desc.defval = v === undefined ? null : v;
    } else if (kind !== 'timeframe' && kind !== 'symbol') this.err('E307', node, { f: name, n: countArgs(f), m: 0 });
    else desc.defval = '';
    if (kind === null) {
      const v = desc.defval;
      kind = typeof v === 'boolean' ? 'bool' : typeof v === 'string' ? (/^#[0-9a-f]{8}$/.test(v) && first.value.k === 'Color' ? 'color' : 'string') : typeof v === 'number' ? (first.value.k === 'Num' && first.value.int ? 'int' : 'float') : 'float';
      if (first && first.value.k === 'Color') kind = 'color';
    }
    desc.kind = kind;
    for (const b of bound) {
      if (b.p.name === 'defval' || !b.arg) continue;
      const v = this.literalOf(b.arg);
      if (v === undefined) { this.err('E329', b.arg, { p: b.p.name, f: name }); continue; }
      desc[b.p.name] = v;
    }
    if (!this.top) this.err('E330', node);
    const want = { int: 'int', float: 'float', price: 'float', bool: 'bool', string: 'string', text_area: 'string', color: 'color', timeframe: 'string', symbol: 'string' }[kind];
    if (want && desc.defval !== null) {
      const t = typeof desc.defval === 'number' ? (Number.isInteger(desc.defval) ? 'int' : 'float') : typeof desc.defval === 'boolean' ? 'bool' : (kind === 'color' && /^#[0-9a-f]{8}$/.test(desc.defval) ? 'color' : 'string');
      if (!assignable(want === 'int' ? 'float' : want, t)) this.err('E309', first, { p: 'defval', f: name, want, got: t });
    }
    if (Array.isArray(desc.options)) desc.options = desc.options.slice(0, 200);
    desc.title = typeof desc.title === 'string' ? desc.title.slice(0, 120) : '';
    this.meta.inputs.push(desc);
    this.lastInput = desc.id;
    if (kind === 'source') { this.emit(OP.SRCIN, desc.id); return 'float'; }
    this.emit(OP.INPUT, desc.id);
    return want;
  }

  // Constant string argument: literal, constant, or a variable holding an input / literal.
  fixedString(a, f, pname) {
    if (!a) return { v: '' };
    const lit = this.literalOf(a);
    if (typeof lit === 'string') return { v: lit };
    const e = a.value;
    if (e.k === 'Ident') {
      const found = this.scope.lookup(e.name);
      if (found && found.v.input !== undefined) { found.v.used = true; return { input: found.v.input }; }
      if (found && found.v.constStr !== undefined) { found.v.used = true; return { v: found.v.constStr }; }
    }
    const d = dotted(e);
    if (d === 'syminfo.tickerid' || d === 'syminfo.ticker') return { v: '' };
    if (d === 'timeframe.period') return { v: '' };
    if (e.k === 'Call' && this.isInputCall(e)) { this.expr(e); this.emit(OP.POP); return { input: this.lastInput }; }
    this.err('E329', a, { p: pname, f: f.name });
    return { v: '' };
  }

  security(f, args, node) {
    const bound = this.bindArgs(f, args, node);
    const [bs, bt, be] = bound;
    const bl = bound.find((b) => b.p.name === 'lookahead');
    if (bl && bl.arg && this.literalOf(bl.arg) !== false) this.err('E351', bl.arg);
    const symbol = this.fixedString(bs.arg, f, 'symbol');
    const timeframe = this.fixedString(bt.arg, f, 'timeframe');
    if (!be.arg) { this.emit(OP.NA); return 'na'; }
    if (this.securities.length >= LIMITS.securities) { this.err('E353', node); this.emit(OP.NA); return 'na'; }
    // compile the expression into its own unit, run on the other timeframe's bars
    const saved = { u: this.u, scope: this.scope, sec: this.secExpr, inline: this.inline, loops: this.loopCtx, cond: this.condDepth, block: this.block, depth: this.loopDepth };
    const unit = new Unit(); this.units.push(unit);
    this.u = unit;
    this.secExpr = { outer: this.global };
    this.scope = new Scope(this.global, 'sec');
    this.inline = []; this.loopCtx = []; this.condDepth = 0; this.block = 1; this.loopDepth = 0;  // block=1: plots/inputs are not allowed inside
    let t;
    try { t = this.expr(be.arg.value); } finally {
      this.u = saved.u; this.scope = saved.scope; this.secExpr = saved.sec; this.inline = saved.inline; this.loopCtx = saved.loops;
      this.condDepth = saved.cond; this.block = saved.block; this.loopDepth = saved.depth;
    }
    const n = isTup(t) ? tupItems(t).length : 0;
    const id = this.securities.length;
    this.securities.push({ id, unit: this.units.length - 1, symbol, timeframe, n });
    this.emit(OP.SEC, id, n);
    return t;
  }

  plotOutput(name, kind, bound, node) {
    if (this.outputs.plots.length + this.outputs.hlines.length + this.outputs.fills.length >= LIMITS.plots) this.err('E341', node);
    const id = this.outputs.plots.length;
    const title = bound.find((b) => b.p.name === 'title');
    const t = title && title.arg ? this.literalOf(title.arg) : '';
    const style = bound.find((b) => b.p.name === 'style');
    let k = kind;
    if (kind === 'plot') { const s = style && style.arg ? this.literalOf(style.arg) : 'line'; k = typeof s === 'string' ? s : 'line'; }
    this.outputs.plots.push({ id, kind: k, title: typeof t === 'string' ? t.slice(0, 120) : '', fn: name });
    return id;
  }
  hlineOutput(bound) {
    const id = this.outputs.hlines.length;
    this.outputs.hlines.push({ id });
    return id;
  }
  fillOutput(bound, types, node) {
    if (!((types[0] === 'plotid' && types[1] === 'plotid') || (types[0] === 'hlineid' && types[1] === 'hlineid'))) {
      this.err('E309', node, { p: 'plot1/plot2', f: 'fill', want: 'two plots or two hlines', got: describeType(types[0]) + ' and ' + describeType(types[1]) });
    }
    const id = this.outputs.fills.length;
    this.outputs.fills.push({ id, between: types[0] === 'hlineid' ? 'hline' : 'plot' });
    return id;
  }
  alertOutput(bound) {
    const id = this.outputs.alertconditions.length;
    const get = (n) => { const b = bound.find((x) => x.p.name === n); const v = b && b.arg ? this.literalOf(b.arg) : ''; return typeof v === 'string' ? v.slice(0, 300) : ''; };
    this.outputs.alertconditions.push({ id, title: get('title'), message: get('message') });
    return id;
  }

  userCall(name, e) {
    const f = this.funcs.get(name);
    if (this.inline.includes(name)) { this.err('E318', e, { f: name }); for (const a of e.args) { this.expr(a.value, true); this.emit(OP.POP); } this.emit(OP.NA); return 'na'; }
    if (this.inline.length >= 64) { this.err('E414', e); this.emit(OP.NA); return 'na'; }
    // bind args
    const binds = f.params.map(() => null);
    let pos = 0, named = false;
    for (const a of e.args) {
      if (a.name) {
        named = true;
        const k = f.params.findIndex((p) => p.name === a.name);
        if (k < 0) { const near = closest(a.name, f.params.map((p) => p.name)); this.err('E308', a, { f: name, p: a.name }, { hint: near ? 'Did you mean `' + near + '`?' : '' }); continue; }
        binds[k] = a;
      } else {
        if (named) this.err('E321', a);
        if (pos >= f.params.length) { this.err('E307', a, { f: name, n: f.params.length, m: e.args.length }); break; }
        binds[pos++] = a;
      }
    }
    const types = [];
    for (let i = 0; i < f.params.length; i++) {
      const p = f.params[i];
      if (binds[i]) types.push(this.expr(binds[i].value));
      else if (p.def) types.push(this.expr(p.def));
      else { this.err('E307', e, { f: name, n: f.params.filter((x) => !x.def).length, m: e.args.length }); this.emit(OP.NA); types.push('na'); }
    }
    const savedScope = this.scope;
    this.scope = new Scope(this.secExpr ? this.scope : this.global, 'func');
    if (this.secExpr) this.scope = new Scope(new Scope(null, 'sec-empty'), 'func');
    this.inline.push(name);
    const savedLoops = this.loopCtx, savedCond = this.condDepth, savedLD = this.loopDepth, savedBlock = this.block;
    this.loopCtx = []; this.loopDepth = 0;
    try {
      const slots = f.params.map((p, i) => {
        const declared = typeFromSpec(p.type);
        if (declared && !assignable(declared, types[i])) this.err('E309', binds[i] || e, { p: p.name, f: name, want: describeType(declared), got: describeType(types[i]) });
        const v = this.declare(p.name, declared || (types[i] === 'na' ? 'float' : types[i]), '', p, { used: true });
        return v.slot;
      });
      for (let i = slots.length - 1; i >= 0; i--) this.emit(OP.STORE, slots[i]);
      let t;
      if (f.body.k === 'Block') t = this.blockOf(f.body, true);
      else t = this.expr(f.body, true);
      return t === 'void' ? 'na' : t;
    } finally {
      this.inline.pop(); this.scope = savedScope; this.loopCtx = savedLoops; this.condDepth = savedCond; this.loopDepth = savedLD; this.block = savedBlock;
    }
  }
}

function dotted(e) {
  if (!e) return null;
  if (e.k === 'Ident') return e.name;
  if (e.k === 'Member') { const b = dotted(e.obj); return b === null ? null : b + '.' + e.name; }
  return null;
}
function calleeName(e) { return e && e.k === 'Call' ? dotted(e.callee) || 'this call' : 'this'; }
function isNumLike(t) { return t === 'int' || t === 'float' || t === 'na' || t === 'any'; }
function countArgs(f) {
  const req = f.params.filter((p) => p.def === undefined && !p.rest).length;
  return f.variadic || req !== f.params.length ? req + ' to ' + (f.variadic ? 'any number of' : f.params.length) : String(req);
}
function suggest(name, pool) { const n = closest(name, pool); return n ? 'Did you mean `' + n + '`? Or declare it first with `=`.' : null; }
export { DRAWING };
