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

// time_close(tf) (pinets 0.11.0 bug): with a timeframe argument pinets aligns the CHART bar's
// close time down to the start of the higher-timeframe period, so time_close("15") returns the
// same value as time("15") (the period's OPEN; seen on HTF PO3 Lens, where every countdown read
// "0s"). Pine's time_close(tf) is the period's CLOSE. The fix takes pinets' own time(tf) (same
// argument handling: bars_back, session -> na) and adds the period length with the same
// calendar rules pinets uses to align periods (intraday periods restart at 00:00 UTC; D from
// 1 Jan; W from the first Monday of the year; M by calendar month). Without a timeframe, or
// with the chart's own, pinets' value (the bar's close) is kept.
function tfParse(tf){
  const m = /^(\d*)([a-zA-Z]?)$/.exec(String(tf == null ? '' : tf).trim());
  if (!m || (!m[1] && !m[2])) return null;
  const n = m[1] === '' ? 1 : parseInt(m[1], 10);
  if (!(n >= 1)) return null;
  const u = m[2];
  if (u === '') return { unit: '', n };
  if (u === 'S' || u === 's') return { unit: 'S', n };
  if (u === 'D' || u === 'd') return { unit: 'D', n };
  if (u === 'W' || u === 'w') return { unit: 'W', n };
  if (u === 'M') return { unit: 'M', n };
  if (u === 'm') return m[1] === '' ? { unit: 'M', n: 1 } : { unit: '', n };
  if (u === 'h' || u === 'H') return { unit: '', n: n * 60 };
  return null;
}
function tfSeconds(p){
  return !p ? 0 : p.unit === 'S' ? p.n : p.unit === '' ? p.n * 60 : p.unit === 'D' ? p.n * 86400 : p.unit === 'W' ? p.n * 604800 : p.n * 2628003;
}
function firstMonday(y){ const e = Date.UTC(y, 0, 1), d = new Date(e).getUTCDay(); return e + ((8 - d) % 7) * 864e5; }
// Close of the period that opens at `open` (ms) for timeframe string tf; NaN if unknown.
export function periodClose(open, tf){
  const p = tfParse(tf);
  if (!p || !Number.isFinite(open)) return NaN;
  const y = new Date(open).getUTCFullYear();
  switch (p.unit) {
    case 'S': case '': return Math.min(open + tfSeconds(p) * 1000, (Math.floor(open / 864e5) + 1) * 864e5);
    case 'D': return Math.min(open + p.n * 864e5, Date.UTC(y + 1, 0, 1));
    case 'W': return Math.min(open + p.n * 6048e5, firstMonday(y + 1));
    case 'M': { const d = new Date(open); return Math.min(Date.UTC(y, d.getUTCMonth() + p.n, 1), Date.UTC(y + 1, 0, 1)); }
  }
  return NaN;
}
function plain(v){ return v != null && typeof v === 'object' && typeof v.get === 'function' ? v.get(0) : v; }
function patchTimeClose(ctx){
  const pine = ctx.pine, tc = pine && pine.time_close, tm = pine && pine.time;
  if (!tc || !tm || typeof tc.any !== 'function' || typeof tm.any !== 'function' || tc.__stkTc) return;
  const orig = tc.any;
  tc.any = function (...args) {
    let tf = plain(args[0]);
    if (tf != null && typeof tf === 'object') tf = plain(tf.timeframe);
    if (typeof tf !== 'string' || !tf) return orig.apply(this, args);
    const chartSec = tfSeconds(tfParse(ctx.timeframe)), sec = tfSeconds(tfParse(tf));
    if (!sec || sec === chartSec) return orig.apply(this, args);
    const open = tm.any(...args);
    return Number.isFinite(open) ? periodClose(open, tf) : open;
  };
  tc.__stkTc = true;
}

export function patchContext(ctx){
  try { patchTimeClose(ctx); } catch (e) {}
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
