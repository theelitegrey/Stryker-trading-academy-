// Zscript diagnostics: codes -> plain-English messages (SPEC.md section 10).
export const MESSAGES = { __proto__: null,
  E101: 'Unexpected character `{c}`.',
  E102: 'Unterminated string (the closing quote is missing).',
  E103: 'Bad color `{text}`. Use #RRGGBB or #RRGGBBAA.',
  E104: 'Bad number `{text}`.',
  E105: 'This line\'s indentation does not match any outer block.',
  E106: 'The script is too large (limit 256 KB / 20,000 lines).',
  E201: 'Missing header.',
  E202: 'Unsupported Zscript version `{n}`.',
  E203: 'Unexpected {token}, expected {what}.',
  E204: 'Missing closing `{close}`.',
  E205: 'Expected an indented block after `{kw}`.',
  E206: 'The default case `=>` must be the last case of a switch.',
  E207: 'The code is nested too deeply (limit 128).',
  E208: '`{kw}` can only be used inside a loop.',
  E209: '`=` cannot be used inside an expression.',
  E210: '`{w}` is a reserved word and cannot be used here.',
  E301: 'Missing `indicator(...)` declaration.',
  E302: '`indicator()` is declared more than once.',
  E303: 'Unknown name `{x}`.',
  E304: 'Unknown function `{f}`.',
  E305: '`{x}` is already declared in this scope.',
  E306: 'Cannot change `{x}` with `:=` before it is declared.',
  E307: '`{f}` expects {n} arguments, got {m}.',
  E308: '`{f}` has no parameter named `{p}`.',
  E309: 'Argument `{p}` of `{f}` must be {want}, got {got}.',
  E310: 'Cannot assign {got} to `{x}`, which is declared as {want}.',
  E311: '`{x}` holds {want}; it cannot be given {got}.',
  E312: 'Operator `{op}` cannot be used with {a} and {b}.',
  E313: 'A condition must be bool or a number, got {got}.',
  E314: 'The function returns {n} values but {m} names were given.',
  E315: '`{x}` is not a function.',
  E316: 'History `[]` needs a number of bars, got {got}.',
  E317: 'Built-in `{x}` cannot be reassigned.',
  E318: 'Function `{f}` calls itself (recursion is not allowed).',
  E319: 'Functions must be defined at the top level, before they are used.',
  E320: 'Method `{m}` does not exist for {t}.',
  E321: 'A positional argument cannot come after a named one.',
  E322: 'Function `{f}` is declared more than once.',
  E323: 'The branches give different types ({a} and {b}).',
  E324: 'History `[]` cannot be used on {t}.',
  E325: 'The script is too large after expanding its functions.',
  E326: '`{f}` gives no value, so it cannot be assigned.',
  E327: '`{x}` cannot be used as a variable name.',
  E328: 'Arrays and maps cannot hold arrays or maps in v1.',
  E329: '`{p}` of `{f}` must be a fixed value (a literal or an input).',
  E330: 'Inputs must be called at the top level with a literal default value.',
  E340: '`{f}` must be called at the top level (not inside if/for/while/switch or a function).',
  E341: 'Too many plots (limit 64).',
  E350: 'The request.security expression uses the script variable `{x}`.',
  E351: 'lookahead is not allowed in Zscript.',
  E352: 'Timeframe `{tf}` is not supported here.',
  E353: 'Too many request.security calls (limit 16).',
  W101: '`{f}` runs only on some bars (inside a condition), so its history skips the other bars.',
  W102: '`{f}` inside a loop shares one state for every pass of the loop.',
  W103: 'Variable `{x}` is never used.',
  E401: 'The script took longer than 20 seconds.',
  E402: 'History `[{n}]` goes back further than max_bars_back ({m}).',
  E403: 'Too many operations on one bar (limit 5,000,000).',
  E404: 'A loop ran more than 100,000 times on one bar.',
  E405: 'Array too large (limit {lim} items).',
  E406: 'Map too large (limit 50,000 keys).',
  E407: 'Text too long (limit 4,096 characters).',
  E408: 'Too many tables (limit {lim}).',
  E410: 'Index {i} is out of range for an array of size {n}.',
  E411: 'Called `{what}` on na.',
  E412: '`{f}` length must be a positive number, got {v}.',
  E413: 'Too many bars (limit 50,000).',
  E414: 'Function calls are nested too deep (limit 64).',
  E415: 'Data for {sym} {tf} is not available.',
  E416: 'Too many table cells (limit 1,000 per table).',
  E499: 'Internal engine error: {why}',
};

const HINTS = { __proto__: null,
  E201: 'Put `//@zscript 1` on the first line.',
  E202: 'Use `//@zscript 1`.',
  E209: 'Use `==` to compare, or `:=` to change a variable.',
  E301: 'Add `indicator("My script")` after the header.',
  E305: 'Use `:=` to change an existing variable.',
  E306: 'Declare it first with `=`.',
  E318: 'Rewrite it with a loop.',
  E330: 'Example: `len = input.int(14, "Length")` at the top level.',
  E340: 'Use `plot(cond ? value : na)` instead of plotting inside `if`.',
  E324: 'To read an array item use `array.get(a, i)` (or `a.get(i)`).',
  E323: 'Make both branches give the same type (use na for "no value").',
  E350: 'Compute the value inside the expression, or put it in a function and call that.',
  E351: 'Remove lookahead; Zscript never looks at future bars.',
  W101: 'Compute it at the top level and use the result inside the condition.',
  E402: 'Raise max_bars_back in indicator(), e.g. `indicator("x", max_bars_back=2000)`.',
  E403: 'A loop may be too large; reduce its range.',
  E404: 'Check the loop condition; it may never become false.',
};

export function fmt(template, args) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (args && args[k] != null ? String(args[k]) : '?'));
}

export function diag(code, line, col, args, extra) {
  const d = {
    code,
    severity: code[0] === 'W' ? 'warning' : 'error',
    line: line || 1, col: col || 1,
    endLine: (extra && extra.endLine) || line || 1,
    endCol: (extra && extra.endCol) || (col || 1) + 1,
    message: fmt(MESSAGES[code] || code, args),
    hint: (extra && extra.hint) || HINTS[code] || '',
  };
  return d;
}

// Edit distance for "did you mean" (small strings only).
export function closest(name, candidates, max = 2) {
  let best = null, bestD = Infinity;
  const n = String(name).toLowerCase();
  for (const c of candidates) {
    const d = lev(n, String(c).toLowerCase(), bestD);
    if (d < bestD) { bestD = d; best = c; }
  }
  const lim = Math.max(max, Math.floor(n.length / 3));
  return bestD <= lim ? best : null;
}

function lev(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return Infinity;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

export class ZsRuntimeError extends Error {
  constructor(code, args, node) {
    super(fmt(MESSAGES[code] || code, args));
    this.code = code; this.args = args || {}; this.node = node || null;
  }
}
