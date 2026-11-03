// TradeZoro — Charts: formula symbols (TradingView style), pure core. No DOM, no network, no eval/Function.
// Roadmap: Formula charts.
//
//   "ES1!-NQ1!*0.25"   "BTCUSDT/ETHUSDT"   "(AAPL+MSFT)/2"   "SPY/QQQ"
//
// parseFormula(text)  -> { ok, ast, symbols, text } | { ok:false, code, message, hint }
//     tiny recursive-descent parser:   expr = term (('+'|'-') term)*   term = unary (('*'|'/') unary)*
//     unary = ('+'|'-') unary | atom   atom = number | symbol | '(' expr ')'
//     symbol = [PREFIX:]TICKER, letters/digits/_ . with an optional trailing '!' (ES1!, 6E1!, BINANCE:BTCUSDT).
//     Hyphenated tickers (BTC-USD) are not symbols here: '-' is minus. Use the venue form instead.
// combineBars(ast, symbols, series) -> bars: O, H, L, C each computed from the matching field, aligned on
//     time; a bar is skipped when any symbol lacks it or the result is not a finite number. Volume is 0.
// Limits: 64 characters, 2 to 4 distinct symbols, depth 16. Education only. Not financial advice.

export const MAX_CHARS = 64, MIN_SYMBOLS = 2, MAX_SYMBOLS = 4, MAX_DEPTH = 16, PREFIX = 'formula:';

const err = (code, message, hint) => ({ ok: false, code, message, hint: !!hint });   // hint: still typing, not worth a message

function tokenize(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if ('+-*/()'.includes(c)) { out.push({ t: c, at: i }); i++; continue; }
    if (/[A-Za-z0-9_.]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.:]/.test(src[j])) j++;
      if (src[j] === '!') j++;
      const w = src.slice(i, j);
      if (/^(\d+\.?\d*|\.\d+)$/.test(w)) out.push({ t: 'num', v: Number(w), at: i });
      else if (/^[A-Za-z0-9_]+:[A-Za-z0-9_.]+!?$|^[A-Za-z0-9_.]+!?$/.test(w) && /[A-Za-z]/.test(w) && /^[A-Za-z0-9_:]/.test(w)) out.push({ t: 'sym', v: w.toUpperCase(), at: i });
      else return err('bad_token', 'Cannot read "' + w + '" in the formula.');
      i = j; continue;
    }
    return err('bad_char', 'The character "' + c + '" is not allowed. Use symbols, numbers, + - * / and brackets.');
  }
  return { toks: out };
}

export function parseFormula(raw) {
  const src = String(raw == null ? '' : raw).trim();
  if (!src) return err('empty', 'Type a formula, for example ES1!-NQ1!*0.25.', true);
  if (src.length > MAX_CHARS) return err('too_long', 'A formula can be up to ' + MAX_CHARS + ' characters.');
  const tk = tokenize(src);
  if (tk.ok === false) return tk;
  const toks = tk.toks; let p = 0;
  const fail = (m, hint) => { throw Object.assign(new Error(m), { hint: !!hint }); };
  const peek = () => toks[p];
  const expr = (d) => {
    if (d > MAX_DEPTH) fail('Brackets are nested too deep.');
    let l = term(d);
    while (peek() && (peek().t === '+' || peek().t === '-')) { const op = toks[p++].t; l = { op, l, r: term(d) }; }
    return l;
  };
  const term = (d) => {
    let l = unary(d);
    while (peek() && (peek().t === '*' || peek().t === '/')) { const op = toks[p++].t; l = { op, l, r: unary(d) }; }
    return l;
  };
  const unary = (d) => {
    const t = peek();
    if (t && (t.t === '+' || t.t === '-')) {
      if (d > MAX_DEPTH) fail('Too many signs in a row.');
      p++; const a = unary(d + 1); return t.t === '-' ? { op: 'neg', a } : a;
    }
    return atom(d);
  };
  const atom = (d) => {
    const t = toks[p++];
    if (!t) fail('The formula ends too early.', true);
    if (t.t === 'num') return { num: t.v };
    if (t.t === 'sym') return { sym: t.v };
    if (t.t === '(') {
      const e = expr(d + 1);
      if (!peek() || peek().t !== ')') fail('A bracket is not closed.', true);
      p++; return e;
    }
    fail('Unexpected "' + t.t + '" in the formula.', t.t === ')' ? false : true);
  };
  let ast;
  try {
    ast = expr(0);
    if (p < toks.length) fail('Unexpected "' + (toks[p].v != null ? toks[p].v : toks[p].t) + '". Put an operator between values.');
  } catch (e) { return err('syntax', e.message, e.hint); }
  const symbols = [];
  (function walk(n) { if (n.sym) { if (!symbols.includes(n.sym)) symbols.push(n.sym); } else if (n.op) { if (n.l) walk(n.l); if (n.r) walk(n.r); if (n.a) walk(n.a); } })(ast);
  if (symbols.length > MAX_SYMBOLS) return err('too_many', 'A formula can use up to ' + MAX_SYMBOLS + ' symbols.');
  if (symbols.length < MIN_SYMBOLS) return err('too_few', 'A formula needs ' + MIN_SYMBOLS + ' to ' + MAX_SYMBOLS + ' symbols.', true);
  return { ok: true, ast, symbols, text: print(ast) };
}

// Canonical text: no spaces, upper case, only the brackets that are needed.
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2 };
export function print(n, parentPrec = 0, right = false) {
  if (n.num != null) return String(n.num);
  if (n.sym) return n.sym;
  if (n.op === 'neg') { const s = '-' + print(n.a, 3); return parentPrec >= 3 ? '(' + s + ')' : s; }
  const pr = PREC[n.op];
  const s = print(n.l, pr, false) + n.op + print(n.r, pr, true);
  return pr < parentPrec || (pr === parentPrec && right) ? '(' + s + ')' : s;
}
// "formula:ES1!-NQ1!*0.25" or just the text -> canonical "formula:..." or null
export const isFormulaSymbol = (s) => typeof s === 'string' && s.slice(0, PREFIX.length).toLowerCase() === PREFIX;
export const bodyOf = (s) => (isFormulaSymbol(s) ? s.slice(PREFIX.length) : String(s || ''));
export function canonicalSymbol(s) { const r = parseFormula(bodyOf(s)); return r.ok ? PREFIX + r.text : null; }

// Evaluate with a lookup: vals[sym] -> number. Division by zero and NaN give NaN.
export function evalAst(n, vals) {
  if (n.num != null) return n.num;
  if (n.sym) return vals[n.sym];
  if (n.op === 'neg') return -evalAst(n.a, vals);
  const a = evalAst(n.l, vals), b = evalAst(n.r, vals);
  return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : (b === 0 ? NaN : a / b);
}

// series: { SYM: [{time, open, high, low, close}] } (each sorted by time). Returns bars sorted by time.
export function combineBars(ast, symbols, series) {
  const maps = symbols.map((s) => { const m = new Map(); for (const b of series[s] || []) m.set(b.time, b); return m; });
  const first = maps.reduce((a, m) => (m.size < a.size ? m : a), maps[0]);
  const times = []; for (const t of first.keys()) if (maps.every((m) => m.has(t))) times.push(t);
  times.sort((a, b) => a - b);
  const out = [], v = {};
  for (const t of times) {
    const f = (k) => { symbols.forEach((s, i) => { v[s] = maps[i].get(t)[k]; }); return evalAst(ast, v); };
    const o = f('open'), h = f('high'), l = f('low'), c = f('close');
    if (![o, h, l, c].every(Number.isFinite)) continue;
    // each field is computed on its own, so a spread can invert high and low: keep every candle valid
    out.push({ time: t, open: o, high: Math.max(o, h, l, c), low: Math.min(o, h, l, c), close: c, volume: 0 });
  }
  return out;
}
