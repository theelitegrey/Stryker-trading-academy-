// Stryker Trading Academy — Charts: runtime extensions for the Pine "next" engine (ES module)
// Loaded by assets/chart-pine-next-worker.js. No imports: install(Context) receives pinets'
// exported Context class, so this file can be unit-tested in Node against any pinets copy
// (tools/tests/chart-pine-next-patches.test.mjs).
//
// WHAT: pinets 0.11.0 computes ta.pivothigh / ta.pivotlow by scanning the WHOLE series on
// every bar (new Array(n) + a loop over all n bars, then reads one element), so a script
// that calls them is O(n^2): about 1 s of a 1,500-bar run and most of a 5,000-bar run for
// the Stryker structure indicators. The replacement below evaluates the same rule for the
// current bar only (O(left + right) per bar), with identical semantics: the candidate is
// the bar `right` bars back; it must be strictly above (below) the `left` bars before it
// and strictly above (below) or equal-excluded vs the `right` bars after it, exactly as
// pinets' own loops (`>`/`>=` for highs, `<`/`<=` for lows; an undefined/NaN neighbour
// stops that side's check without failing it).
//
// HOW: pinets builds `context.pine.ta` in the Context constructor and then calls
// `this.bindContextObject(...)`; vela-pinets already hooks that same method to add table
// and marker fixes. We wrap it once and swap the two functions on each new context.
// pinets' code itself is not modified (AGPL: loaded unmodified from jsDelivr).

// SOURCE REWRITE (pinets 0.11.0 bug): `var table t = cond ? table.new(...) : na` creates the
// object but every later `t.cell(...)` / `t.set_*` is lost (pinets re-evaluates the var
// initialiser as a thunk and the drawing ends up empty; seen on the Stoic Edge Compass
// status panel). The equivalent Pine form below works, so we rewrite it before compiling:
//   var table t = na
//   if (cond) and na(t)
//       t := table.new(...)
// Only this exact single-line shape (var + drawing type + `cond ? T.new(...) : na`) is
// touched; anything else passes through unchanged.
const DRAW_TYPES = 'table|box|line|label|linefill|polyline';
const VAR_TERNARY = new RegExp('^(\\s*)var\\s+(' + DRAW_TYPES + ')\\s+([A-Za-z_]\\w*)\\s*=\\s*(.+?)\\s*\\?\\s*((?:' + DRAW_TYPES + ')\\.new\\(.*\\))\\s*:\\s*na\\s*(//.*)?$');
function balanced(str){
  let d = 0, q = null;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '(') d++;
    else if (c === ')') { d--; if (d < 0) return false; }
  }
  return d === 0 && !q;
}
export function rewriteSource(src){
  if (typeof src !== 'string' || src.indexOf('.new(') < 0) return src;
  const nl = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  return src.split(/\r?\n/).map((line) => {
    const m = VAR_TERNARY.exec(line);
    if (!m) return line;
    const [, ind, type, name, cond, ctor] = m;
    // the condition must be a whole expression and the constructor one whole call
    if (!balanced(cond) || !balanced(ctor) || /\?/.test(cond) || ctor.indexOf(type + '.new(') !== 0) return line;
    return ind + 'var ' + type + ' ' + name + ' = na' + nl +
      ind + 'if (' + cond + ') and na(' + name + ')' + nl +
      ind + '    ' + name + ' := ' + ctor;
  }).join(nl);
}

function lastOf(v){
  if (v != null && typeof v === 'object') {
    if (typeof v.get === 'function') return v.get(0);
    if (Array.isArray(v)) return v[v.length - 1];
    if ('__value' in v) return lastOf(v.__value);
  }
  return v;
}
function arrayOf(v){
  if (v != null && typeof v === 'object') {
    if (typeof v.toArray === 'function') return v.toArray();
    if (Array.isArray(v)) return v;
  }
  return null;
}

// One bar of pinets' pivot rule. hi=true: pivot high. Returns the pivot value or NaN.
export function pivotAt(arr, idx, left, right, hi){
  const n = idx;
  if (!(left >= 0) || !(right >= 0) || n < left + right || n >= arr.length) return NaN;
  const s = arr[n - right];
  if (s === undefined || Number.isNaN(s)) return NaN;
  for (let o = 1; o <= left; o++) {
    const l = arr[n - right - o];
    if (l === undefined || Number.isNaN(l)) break;
    if (hi ? l > s : l < s) return NaN;
  }
  for (let o = 1; o <= right; o++) {
    const l = arr[n - right + o];
    if (l === undefined || Number.isNaN(l)) break;
    if (hi ? l >= s : l <= s) return NaN;
  }
  return s;
}

function makePivot(ctx, orig, hi){
  return function (src, left, right, extra) {
    // Two-number form pivothigh(left, right): pinets passes a callsite string third.
    if (typeof right === 'string') { extra = right; right = left; left = src; src = hi ? ctx.data.high : ctx.data.low; }
    const arr = arrayOf(src);
    const L = Number(lastOf(left)), R = Number(lastOf(right));
    if (!arr || !Number.isFinite(L) || !Number.isFinite(R)) return orig.apply(this, arguments);
    return ctx.precision(pivotAt(arr, ctx.idx, Math.trunc(L), Math.trunc(R), hi));
  };
}

export function patchContext(ctx){
  const ta = ctx && ctx.pine && ctx.pine.ta;
  if (!ta || ta.__stkPivot) return false;
  if (typeof ta.pivothigh === 'function') ta.pivothigh = makePivot(ctx, ta.pivothigh, true);
  if (typeof ta.pivotlow === 'function') ta.pivotlow = makePivot(ctx, ta.pivotlow, false);
  ta.__stkPivot = true;
  return true;
}

export function install(Context){
  const proto = Context && Context.prototype;
  if (!proto || proto.__stkNextPatched || typeof proto.bindContextObject !== 'function') return false;
  const bind = proto.bindContextObject;
  proto.bindContextObject = function (...args) {
    const r = bind.apply(this, args);
    try { patchContext(this); } catch (e) {}
    return r;
  };
  proto.__stkNextPatched = true;
  return true;
}
