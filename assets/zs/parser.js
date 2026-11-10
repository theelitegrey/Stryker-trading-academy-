// Zscript parser: tokens -> AST, with error recovery (keeps going after an error,
// resyncing at the next line). Grammar: SPEC.md section 3.
import { lex } from './lexer.js?v=942';
import { diag } from './errors.js?v=942';

export const TYPE_WORDS = new Set(['int', 'float', 'bool', 'string', 'color', 'label', 'line', 'box', 'table', 'array', 'map']);
const QUALIFIERS = new Set(['series', 'simple', 'const']);
const ASSIGN_OPS = new Set([':=', '+=', '-=', '*=', '/=', '%=']);
const MAX_DEPTH = 128;
const MAX_DIAGS = 50;

class Bail extends Error {}

export function parse(src) {
  const { toks, diags, header } = lex(src);
  const p = new Parser(toks, diags);
  let body = [];
  try { body = p.statements(true); } catch (e) { if (!(e instanceof Bail)) throw e; }
  if (header === null) diags.push(diag('E201', 1, 1));
  else if (header.version === null) diags.push(diag('E201', header.line, 1));
  else if (header.version !== '1') diags.push(diag('E202', header.line, 1, { n: header.version }));
  return { ast: { k: 'Program', body }, diags };
}

class Parser {
  constructor(toks, diags) { this.toks = toks; this.i = 0; this.diags = diags; this.depth = 0; this.loops = 0; }
  get tok() { return this.toks[this.i]; }
  peek(n = 1) { return this.toks[Math.min(this.i + n, this.toks.length - 1)]; }
  next() { const t = this.toks[this.i]; if (this.i < this.toks.length - 1) this.i++; return t; }
  is(v, t) { const k = this.tok; return k.v === v && (t ? k.t === t : (k.t === 'op' || k.t === 'kw')); }
  error(code, tok, args, extra) {
    if (this.diags.length < MAX_DIAGS) this.diags.push(diag(code, tok.l, tok.c, args, extra));
    throw new SyntaxErr();
  }
  expectOp(v, what) {
    if (this.is(v)) return this.next();
    if (v === ')' || v === ']') this.error('E204', this.tok, { close: v });
    return this.error('E203', this.tok, { token: describe(this.tok), what: what || '`' + v + '`' });
  }
  enter() { if (++this.depth > MAX_DEPTH) { if (this.diags.length < MAX_DIAGS) this.diags.push(diag('E207', this.tok.l, this.tok.c)); throw new Bail(); } }
  leave() { this.depth--; }

  // Skip to the start of the next statement at the current nesting level.
  sync() {
    let level = 0;
    while (this.tok.t !== 'eof') {
      const t = this.tok;
      if (t.t === 'indent') level++;
      else if (t.t === 'dedent') { if (level === 0) return; level--; }
      else if (t.t === 'nl' && level === 0) {
        this.next();
        // swallow a block that belonged to the broken line
        if (this.tok.t === 'indent') { this.next(); level++; continue; }
        return;
      }
      this.next();
    }
  }

  statements(top) {
    const out = [];
    while (this.tok.t !== 'eof' && !(this.tok.t === 'dedent' && !top)) {
      const t = this.tok;
      if (t.t === 'nl') { this.next(); continue; }
      if (t.t === 'dedent') { this.next(); continue; }  // stray (top level only)
      if (t.t === 'indent') {
        if (this.diags.length < MAX_DIAGS) this.diags.push(diag('E105', t.l, 1));
        this.next();
        try { this.statements(false); } catch (e) { if (e instanceof SyntaxErr) this.sync(); else throw e; }
        if (this.tok.t === 'dedent') this.next();
        continue;
      }
      try {
        const s = this.statement(top);
        if (s) out.push(s);
        this.endStatement();
      } catch (e) {
        if (!(e instanceof SyntaxErr)) throw e;
        this.sync();
      }
      if (this.diags.length >= MAX_DIAGS) throw new Bail();
    }
    return out;
  }

  endStatement() {
    const t = this.tok;
    if (t.t === 'nl') { this.next(); return; }
    if (t.t === 'eof' || t.t === 'dedent') return;
    const prev = this.toks[this.i - 1];
    if (prev && prev.t === 'dedent') return;
    this.error('E203', t, { token: describe(t), what: 'the end of the line' });
  }

  block(kw) {
    const t = this.tok;
    if (t.t !== 'nl' || this.peek().t !== 'indent') this.error('E205', t, { kw });
    this.next(); this.next();
    this.enter();
    const stmts = this.statements(false);
    this.leave();
    if (this.tok.t === 'dedent') this.next();
    return { k: 'Block', body: stmts, l: t.l, c: t.c };
  }

  statement(top) {
    const t = this.tok;
    if (t.t === 'kw') {
      switch (t.v) {
        case 'var': case 'varip': return this.varDecl();
        case 'if': return this.ifStmt();
        case 'for': return this.forStmt();
        case 'while': return this.whileStmt();
        case 'switch': return this.switchStmt();
        case 'break': case 'continue':
          this.next();
          if (!this.loops && this.diags.length < MAX_DIAGS) this.diags.push(diag('E208', t.l, t.c, { kw: t.v }));
          return { k: t.v === 'break' ? 'Break' : 'Continue', l: t.l, c: t.c };
        case 'import': case 'export': case 'type': case 'method':
          this.error('E210', t, { w: t.v });
      }
    }
    if (t.t === 'id') {
      const n = this.peek();
      if (n.v === '(' && n.t === 'op' && this.isFuncDef()) return this.funcDef(top);
      if (n.t === 'op' && n.v === '=') return this.varDecl();
      if (n.t === 'op' && ASSIGN_OPS.has(n.v)) return this.assign();
      if ((TYPE_WORDS.has(t.v) || QUALIFIERS.has(t.v)) && this.isTypedDecl()) return this.varDecl();
    }
    if (t.t === 'op' && t.v === '[' && this.isTupleDecl()) return this.tupleDecl();
    const e = this.expr();
    if (this.is('=')) this.error('E209', this.tok);
    return { k: 'ExprStmt', expr: e, l: t.l, c: t.c };
  }

  isFuncDef() {
    let j = this.i + 1, d = 0;
    for (; j < this.toks.length; j++) {
      const t = this.toks[j];
      if (t.t === 'op' && (t.v === '(' || t.v === '[')) d++;
      else if (t.t === 'op' && (t.v === ')' || t.v === ']')) { d--; if (d === 0) break; }
      else if (t.t === 'nl' || t.t === 'eof') return false;
    }
    const a = this.toks[j + 1];
    return !!a && a.t === 'op' && a.v === '=>';
  }
  isTypedDecl() {
    let j = this.i;
    if (QUALIFIERS.has(this.toks[j].v)) j++;
    const tw = this.toks[j];
    if (!tw || tw.t !== 'id' || !TYPE_WORDS.has(tw.v)) return false;
    j++;
    if (this.toks[j].v === '<') { // generic
      let d = 0;
      for (; j < this.toks.length; j++) {
        const t = this.toks[j];
        if (t.v === '<') d++; else if (t.v === '>') { d--; if (!d) break; } else if (t.t === 'nl' || t.t === 'eof') return false;
      }
      j++;
    }
    return this.toks[j] && this.toks[j].t === 'id' && this.toks[j + 1] && this.toks[j + 1].v === '=' && this.toks[j + 1].t === 'op';
  }
  isTupleDecl() {
    let j = this.i + 1;
    while (true) {
      const t = this.toks[j];
      if (!t || t.t !== 'id') return false;
      const n = this.toks[j + 1];
      if (n.v === ',') { j += 2; continue; }
      if (n.v === ']') { const e = this.toks[j + 2]; return !!e && e.t === 'op' && e.v === '='; }
      return false;
    }
  }

  typeSpec() {
    const t = this.tok;
    if (QUALIFIERS.has(t.v) && t.t === 'id') this.next();
    const w = this.tok;
    if (w.t !== 'id' || !TYPE_WORDS.has(w.v)) this.error('E203', w, { token: describe(w), what: 'a type' });
    this.next();
    if (w.v === 'array' || w.v === 'map') {
      if (!this.is('<')) return { name: w.v, args: [] };
      this.next();
      const args = [this.typeSpec()];
      if (w.v === 'map') { this.expectOp(','); args.push(this.typeSpec()); }
      this.expectOp('>');
      return { name: w.v, args };
    }
    return { name: w.v, args: [] };
  }

  varDecl() {
    const t = this.tok;
    let mode = '';
    if (t.t === 'kw' && (t.v === 'var' || t.v === 'varip')) { mode = t.v; this.next(); }
    let type = null;
    if (this.tok.t === 'id' && (TYPE_WORDS.has(this.tok.v) || QUALIFIERS.has(this.tok.v)) && this.peek().v !== '=') type = this.typeSpec();
    const name = this.tok;
    if (name.t !== 'id') this.error(name.t === 'kw' ? 'E210' : 'E203', name, { w: name.v, token: describe(name), what: 'a variable name' });
    this.next();
    this.expectOp('=', '`=`');
    const value = this.rhs();
    return { k: 'VarDecl', mode, type, name: name.v, value, l: name.l, c: name.c };
  }

  tupleDecl() {
    const t = this.next();
    const names = [];
    while (true) {
      const n = this.next();
      names.push({ name: n.v, l: n.l, c: n.c });
      if (this.is(',')) { this.next(); continue; }
      break;
    }
    this.expectOp(']'); this.expectOp('=');
    const value = this.rhs();
    return { k: 'TupleDecl', names, value, l: t.l, c: t.c };
  }

  assign() {
    const name = this.next();
    const op = this.next().v;
    const value = this.rhs();
    return { k: 'Assign', op, name: name.v, value, l: name.l, c: name.c };
  }

  rhs() {
    const t = this.tok;
    if (t.t === 'kw') {
      if (t.v === 'if') return this.ifStmt();
      if (t.v === 'switch') return this.switchStmt();
      if (t.v === 'for') return this.forStmt();
      if (t.v === 'while') return this.whileStmt();
    }
    const e = this.expr();
    if (this.is('=')) this.error('E209', this.tok);
    return e;
  }

  funcDef(top) {
    const name = this.next();
    this.expectOp('(');
    const params = [];
    while (!this.is(')')) {
      let type = null;
      if (this.tok.t === 'id' && (TYPE_WORDS.has(this.tok.v) || QUALIFIERS.has(this.tok.v)) && (this.peek().t === 'id' || this.peek().v === '<')) type = this.typeSpec();
      const pn = this.tok;
      if (pn.t !== 'id') this.error('E203', pn, { token: describe(pn), what: 'a parameter name' });
      this.next();
      let def = null;
      if (this.is('=')) { this.next(); def = this.expr(); }
      params.push({ name: pn.v, type, def, l: pn.l, c: pn.c });
      if (this.is(',')) { this.next(); continue; }
      if (!this.is(')')) this.expectOp(')');
    }
    this.next();
    this.expectOp('=>');
    let body;
    if (this.tok.t === 'nl') body = this.block('=>');
    else body = this.expr();
    if (!top && this.diags.length < MAX_DIAGS) this.diags.push(diag('E319', name.l, name.c));
    return { k: 'FuncDef', name: name.v, params, body, l: name.l, c: name.c };
  }

  ifStmt() {
    const t = this.next();
    const cond = this.expr();
    if (this.is('=')) this.error('E209', this.tok);
    const then = this.block('if');
    let els = null;
    if (this.tok.t === 'kw' && this.tok.v === 'else') {
      this.next();
      if (this.tok.t === 'kw' && this.tok.v === 'if') els = this.ifStmt();
      else els = this.block('else');
    }
    return { k: 'If', cond, then, else: els, l: t.l, c: t.c };
  }

  forStmt() {
    const t = this.next();
    // for [i, x] in arr  |  for x in arr  |  for i = a to b [by s]
    if (this.is('[')) {
      this.next();
      const a = this.next(); this.expectOp(','); const b = this.next(); this.expectOp(']');
      if (a.t !== 'id' || b.t !== 'id') this.error('E203', a, { token: describe(a), what: 'a variable name' });
      if (!(this.tok.t === 'kw' && this.tok.v === 'in')) this.error('E203', this.tok, { token: describe(this.tok), what: '`in`' });
      this.next();
      const iter = this.expr();
      const body = this.loopBody('for');
      return { k: 'ForIn', idx: a.v, name: b.v, iter, body, l: t.l, c: t.c };
    }
    const v = this.next();
    if (v.t !== 'id') this.error('E203', v, { token: describe(v), what: 'a loop variable' });
    if (this.tok.t === 'kw' && this.tok.v === 'in') {
      this.next();
      const iter = this.expr();
      const body = this.loopBody('for');
      return { k: 'ForIn', idx: null, name: v.v, iter, body, l: t.l, c: t.c };
    }
    this.expectOp('=', '`=` or `in`');
    const from = this.expr();
    if (!(this.tok.t === 'kw' && this.tok.v === 'to')) this.error('E203', this.tok, { token: describe(this.tok), what: '`to`' });
    this.next();
    const to = this.expr();
    let by = null;
    if (this.tok.t === 'kw' && this.tok.v === 'by') { this.next(); by = this.expr(); }
    const body = this.loopBody('for');
    return { k: 'For', name: v.v, from, to, by, body, l: t.l, c: t.c };
  }
  loopBody(kw) { this.loops++; try { return this.block(kw); } finally { this.loops--; } }

  whileStmt() {
    const t = this.next();
    const cond = this.expr();
    if (this.is('=')) this.error('E209', this.tok);
    const body = this.loopBody('while');
    return { k: 'While', cond, body, l: t.l, c: t.c };
  }

  switchStmt() {
    const t = this.next();
    let subject = null;
    if (this.tok.t !== 'nl') subject = this.expr();
    if (this.tok.t !== 'nl' || this.peek().t !== 'indent') this.error('E205', this.tok, { kw: 'switch' });
    this.next(); this.next();
    this.enter();
    const cases = [];
    let sawDefault = false;
    while (this.tok.t !== 'dedent' && this.tok.t !== 'eof') {
      if (this.tok.t === 'nl') { this.next(); continue; }
      const ct = this.tok;
      try {
        let test = null;
        if (!this.is('=>')) test = this.expr();
        else if (sawDefault) this.error('E206', ct);
        if (sawDefault && this.diags.length < MAX_DIAGS) this.diags.push(diag('E206', ct.l, ct.c));
        if (test === null) sawDefault = true;
        this.expectOp('=>');
        let body;
        if (this.tok.t === 'nl' && this.peek().t === 'indent') body = this.block('=>');
        else { const e = this.statement(false); body = { k: 'Block', body: [e], l: ct.l, c: ct.c }; }
        cases.push({ test, body, l: ct.l, c: ct.c });
        this.endStatement();
      } catch (e) { if (!(e instanceof SyntaxErr)) throw e; this.sync(); }
    }
    this.leave();
    if (this.tok.t === 'dedent') this.next();
    return { k: 'Switch', subject, cases, l: t.l, c: t.c };
  }

  // ---------------- expressions ----------------
  expr() {
    this.enter();
    try { return this.ternary(); } finally { this.leave(); }
  }
  ternary() {
    const c = this.binary(0);
    if (this.is('?')) {
      const t = this.next();
      const a = this.expr();
      this.expectOp(':');
      const b = this.expr();
      return { k: 'Ternary', cond: c, a, b, l: t.l, c: t.c };
    }
    return c;
  }
  binary(level) {
    const LEVELS = [['or'], ['and'], null, ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];
    if (level >= LEVELS.length) return this.unary();
    if (level === 2) { // not
      if (this.tok.t === 'kw' && this.tok.v === 'not') {
        const t = this.next();
        this.enter();
        try { return { k: 'Unary', op: 'not', a: this.binary(2), l: t.l, c: t.c }; } finally { this.leave(); }
      }
      return this.binary(3);
    }
    let a = this.binary(level + 1);
    while (LEVELS[level].includes(this.tok.v) && (this.tok.t === 'op' || this.tok.t === 'kw')) {
      const t = this.next();
      const b = this.binary(level + 1);
      a = { k: 'Binary', op: t.v, a, b, l: t.l, c: t.c };
    }
    return a;
  }
  unary() {
    if (this.is('-') || this.is('+')) {
      const t = this.next();
      this.enter();
      try { return { k: 'Unary', op: t.v, a: this.unary(), l: t.l, c: t.c }; } finally { this.leave(); }
    }
    return this.postfix();
  }
  postfix() {
    let e = this.primary();
    while (true) {
      const t = this.tok;
      if (t.t !== 'op') break;
      if (t.v === '[') {
        this.next();
        const idx = this.expr();
        this.expectOp(']');
        e = { k: 'Index', obj: e, index: idx, l: t.l, c: t.c };
      } else if (t.v === '(') {
        this.next();
        const args = [];
        while (!this.is(')')) {
          const a = this.tok;
          if (a.t === 'id' && this.peek().v === '=' && this.peek().t === 'op') {
            this.next(); this.next();
            args.push({ name: a.v, value: this.expr(), l: a.l, c: a.c });
          } else args.push({ name: null, value: this.expr(), l: a.l, c: a.c });
          if (this.is(',')) { this.next(); continue; }
          if (!this.is(')')) this.expectOp(')');
        }
        this.next();
        e = { k: 'Call', callee: e, args, typeArgs: e.typeArgs || null, l: e.l, c: e.c };
      } else if (t.v === '.') {
        this.next();
        const n = this.tok;
        if (n.t !== 'id' && n.t !== 'kw') this.error('E203', n, { token: describe(n), what: 'a name after `.`' });
        this.next();
        e = { k: 'Member', obj: e, name: n.v, l: e.l, c: e.c, nl: n.l, nc: n.c };
      } else if (t.v === '<' && e.k === 'Member' && e.name === 'new' && this.looksGeneric()) {
        this.next();
        const args = [this.typeSpec()];
        while (this.is(',')) { this.next(); args.push(this.typeSpec()); }
        this.expectOp('>');
        e = Object.assign({}, e, { typeArgs: args });
      } else break;
    }
    return e;
  }
  looksGeneric() {
    let j = this.i + 1, d = 1;
    for (; j < this.toks.length && j < this.i + 16; j++) {
      const t = this.toks[j];
      if (t.v === '<') d++;
      else if (t.v === '>') { d--; if (!d) return this.toks[j + 1] && this.toks[j + 1].v === '('; }
      else if (!(t.t === 'id' || t.v === ',')) return false;
    }
    return false;
  }
  primary() {
    const t = this.tok;
    switch (t.t) {
      case 'num': this.next(); return { k: 'Num', v: t.v, int: t.int, l: t.l, c: t.c };
      case 'str': this.next(); return { k: 'Str', v: t.v, l: t.l, c: t.c };
      case 'color': this.next(); return { k: 'Color', v: t.v, l: t.l, c: t.c };
      case 'id': this.next(); return { k: 'Ident', name: t.v, l: t.l, c: t.c, e: t.e };
      case 'kw':
        if (t.v === 'true' || t.v === 'false') { this.next(); return { k: 'Bool', v: t.v === 'true', l: t.l, c: t.c }; }
        if (t.v === 'na') {
          this.next();
          // `na(x)` is the built-in test; bare `na` is the value.
          if (this.peek(0).t === 'op' && this.peek(0).v === '(') return { k: 'Ident', name: 'na', l: t.l, c: t.c, e: t.e };
          return { k: 'Na', l: t.l, c: t.c };
        }
        break;
      case 'op':
        if (t.v === '(') {
          this.next();
          const e = this.expr();
          this.expectOp(')');
          return e;
        }
        if (t.v === '[') {
          this.next();
          const items = [];
          while (!this.is(']')) {
            items.push(this.expr());
            if (this.is(',')) { this.next(); continue; }
            if (!this.is(']')) this.expectOp(']');
          }
          this.next();
          return { k: 'Tuple', items, l: t.l, c: t.c };
        }
    }
    this.error('E203', t, { token: describe(t), what: 'a value' });
  }
}

class SyntaxErr extends Error {}

function describe(t) {
  switch (t.t) {
    case 'eof': return 'end of script';
    case 'nl': return 'end of line';
    case 'indent': return 'indentation';
    case 'dedent': return 'end of block';
    case 'str': return 'text "' + String(t.v).slice(0, 20) + '"';
    case 'num': return 'number ' + t.v;
    default: return '`' + t.v + '`';
  }
}
