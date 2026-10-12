// TradeZoro — Charts: runtime extensions for the Pine "next" engine (ES module)
// Loaded by assets/chart-pine-next-worker.js. No imports: install(Context) receives pinets'
// exported Context class, so this file can be unit-tested in Node against any pinets copy
// (tools/tests/chart-pine-next-patches.test.mjs).
//
// WHAT: pinets 0.11.0 computes ta.pivothigh / ta.pivotlow by scanning the WHOLE series on
// every bar (new Array(n) + a loop over all n bars, then reads one element), so a script
// that calls them is O(n^2): about 1 s of a 1,500-bar run and most of a 5,000-bar run for
// the TradeZoro structure indicators. The replacement below evaluates the same rule for the
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

// SESSION-ANCHORED PERIODS (pinets 0.11.0 gap): pinets aligns every higher-timeframe period
// to UTC (days from 00:00 UTC, intraday periods restart at 00:00 UTC, weeks from Monday 00:00
// UTC). TradingView aligns them to the symbol's trading session: on CME futures
// (syminfo.session "1800-1700", America/New_York) the trading day for Tuesday opens Monday
// 18:00 ET and closes Tuesday 17:00 ET, 4H periods open at 18/22/02/06/10/14 ET, the week opens
// Sunday 18:00 ET. Without this, time("D") / time("240") / time("W") / time("M") and their
// time_close() put the day break at 20:00 ET (19:00 in winter), so previous-day / previous-week
// highs and lows and 4H candles built from them differ from TradingView (and from our own 4H
// bars, which are anchored to 18:00 ET in functions/api/chart/_bars.js).
// Scope: ONLY symbols whose session crosses midnight in its time zone (start >= end: futures
// 1800-1700, FX 1700-1700). 24x7 / "regular" / same-day sessions keep pinets' values.
// Only periods LONGER than the chart's own timeframe are re-anchored (time(timeframe.period,
// session, tz) and lower timeframes are unchanged). D, W and M with multiplier 1 and intraday
// periods that divide a day; anything else keeps pinets' value.
// The trading date of a bar = its local date, +1 when it is at/after the session start.
// With a session filter (time("D", "0930-1600", tz)) the BAR's own time is tested, as on
// TradingView (na when the bar is outside the session).
// Trading dates run Monday-Friday for the week / month close (no weekend sessions).
const wallFmt = new Map();
let wallLast = { t: NaN, tz: '', w: null };
function wallOf(t, tz){
  if (wallLast.t === t && wallLast.tz === tz) return wallLast.w;
  let f = wallFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    wallFmt.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(new Date(t))) if (p.type !== 'literal') o[p.type] = +p.value;
  if (o.hour === 24) o.hour = 0;
  wallLast = { t, tz, w: o };
  return o;
}
// Epoch ms of local wall time y-m-d hh:mm in tz (m 1-based; d may overflow, Date.UTC rolls it).
function localToUtc(y, m, d, hh, mm, tz){
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = (t) => { const w = wallOf(t, tz); return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - Math.floor(t / 6e4) * 6e4; };
  let t = guess - off(guess);
  const o2 = off(t);
  if (guess - o2 !== t) t = guess - o2;
  return t;
}
export function parseOvernightSession(spec){
  const m = /^\s*(\d{2})(\d{2})-(\d{2})(\d{2})(?::[1-7]+)?\s*$/.exec(String(spec == null ? '' : spec));
  if (!m) return null;
  const start = +m[1] * 60 + +m[2], end = +m[3] * 60 + +m[4];
  if (start >= 1440 || end > 1440 || start < end || start === 0) return null; // same-day session: not handled
  return { start, end: end % 1440 };
}
// Builds the anchoring helpers for one (session, tz); null when the symbol is not overnight.
export function sessionAnchor(spec, tz){
  const s = parseOvernightSession(spec);
  if (!s || !tz) return null;
  const dayOpenCache = new Map();
  const civil = (y, m, d) => { const u = new Date(Date.UTC(y, m - 1, d)); return { y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, d: u.getUTCDate(), dow: u.getUTCDay() }; };
  // open of trading date (y, m, d): the session start on the previous local day
  const dayOpen = (td) => {
    const k = td.y * 10000 + td.m * 100 + td.d;
    let v = dayOpenCache.get(k);
    if (v === undefined) { if (dayOpenCache.size > 4000) dayOpenCache.clear(); v = localToUtc(td.y, td.m, td.d - 1, Math.floor(s.start / 60), s.start % 60, tz); dayOpenCache.set(k, v); }
    return v;
  };
  // close of trading date td: the session end on that local day (DST-safe, unlike open + length)
  const dayClose = (td) => localToUtc(td.y, td.m, td.d, Math.floor(s.end / 60), s.end % 60, tz);
  const tradingDate = (t) => {
    const w = wallOf(t, tz);
    return civil(w.year, w.month, w.day + (w.hour * 60 + w.minute >= s.start ? 1 : 0));
  };
  const weekday = (td, dir) => { let c = td; while (c.dow === 0 || c.dow === 6) c = civil(c.y, c.m, c.d + dir); return c; };
  // { open, close } of the period of timeframe p ({unit, n}) holding time t; null = not handled
  function period(t, p){
    if (!Number.isFinite(t)) return null;
    const td = tradingDate(t);
    if (p.unit === '' && p.n < 1440 && 1440 % p.n === 0) {
      const d0 = dayOpen(td), ms = p.n * 6e4;
      const open = d0 + Math.floor((t - d0) / ms) * ms;
      return { open, close: Math.min(open + ms, dayClose(td)) };
    }
    if (p.n !== 1) return null;
    if (p.unit === 'D') return { open: dayOpen(td), close: dayClose(td) };
    if (p.unit === 'W') {
      const mon = civil(td.y, td.m, td.d - ((td.dow + 6) % 7));
      return { open: dayOpen(mon), close: dayClose(civil(mon.y, mon.m, mon.d + 4)) };
    }
    if (p.unit === 'M') {
      const first = weekday(civil(td.y, td.m, 1), 1), last = weekday(civil(td.y, td.m + 1, 0), -1);
      return { open: dayOpen(first), close: dayClose(last) };
    }
    return null;
  }
  return { period };
}
// Per-context anchor (syminfo is attached after the context is built, so it is read lazily).
function anchorOf(ctx){
  const si = ctx && ctx.pine && ctx.pine.syminfo;
  const spec = si && si.session, tz = si && si.timezone;
  const key = spec + '|' + tz;
  if (ctx.__stkAnchorKey !== key) { ctx.__stkAnchorKey = key; ctx.__stkAnchor = sessionAnchor(spec, tz); }
  return ctx.__stkAnchor;
}
// Splits time()/time_close() args into { tf, session, tz, rawArgs } where rawArgs ask pinets
// for the bar's own time (chart timeframe, no session) with the same bars_back.
function splitTimeArgs(ctx, args){
  const a0 = plain(args[0]);
  if (a0 != null && typeof a0 === 'object' && !Array.isArray(a0)) {
    const tf = plain(a0.timeframe), session = plain(a0.session), tz = plain(a0.timezone);
    return { tf, session, tz, rawArgs: [Object.assign({}, a0, { timeframe: ctx.timeframe, session: '' })] };
  }
  const rest = args.slice(1).map(plain);
  let session, tz;
  if (typeof rest[0] === 'string') { session = rest[0]; rest[0] = ''; if (typeof rest[1] === 'string') tz = rest[1]; }
  return { tf: a0, session, tz, rawArgs: [ctx.timeframe, ...rest] };
}
// The re-anchored period for a time()/time_close() call, or null to keep pinets' value.
function anchoredPeriod(ctx, args, tm, origTime){
  const anchor = anchorOf(ctx);
  if (!anchor) return null;
  const sp = splitTimeArgs(ctx, args);
  if (typeof sp.tf !== 'string' || !sp.tf) return null;
  const p = tfParse(sp.tf);
  if (!p || p.unit === 'S' || tfSeconds(p) <= tfSeconds(tfParse(ctx.timeframe))) return null;
  const raw = origTime.apply(tm, sp.rawArgs);
  if (!Number.isFinite(raw)) return { open: NaN, close: NaN };
  const per = anchor.period(raw, p);
  if (!per) return null;
  if (typeof sp.session === 'string' && sp.session !== '') {
    const tz = sp.tz || (ctx.pine.syminfo && ctx.pine.syminfo.timezone) || 'UTC';
    if (!tm._isInSession(raw, sp.session, tz)) return { open: NaN, close: NaN };
  }
  return per;
}
function patchSessionPeriods(ctx){
  const tm = ctx.pine && ctx.pine.time;
  if (!tm || typeof tm.any !== 'function' || tm.__stkAnchor) return;
  const orig = tm.any;
  tm.__stkOrigAny = orig;
  tm.any = function (...args) {
    try { const per = anchoredPeriod(ctx, args, tm, orig); if (per) return per.open; } catch (e) {}
    return orig.apply(this, args);
  };
  tm.__stkAnchor = true;
}

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
    // session-anchored symbols (see patchSessionPeriods): the period's own close
    try { const per = tm.__stkOrigAny && anchoredPeriod(ctx, args, tm, tm.__stkOrigAny); if (per) return per.close; } catch (e) {}
    const open = tm.any(...args);
    return Number.isFinite(open) ? periodClose(open, tf) : open;
  };
  tc.__stkTc = true;
}


// SESSION STRINGS (pinets 0.11.0): Pine's time(tf, session, tz) with a string that is not a
// session spec (e.g. time("D", "America/New_York"), where the second argument is the time
// zone) makes pinets throw "Invalid session specification" and the whole script stops. We
// treat a non-session string as "no session filter" (the bar is in session), so the call
// returns the period time as it does without a session argument. Valid sessions are
// unchanged (pinets' own check runs first).
function patchSessions(ctx){
  for (const k of ['time', 'time_close']) {
    const fn = ctx.pine && ctx.pine[k];
    if (!fn || typeof fn._isInSession !== 'function' || fn.__stkSess) continue;
    const orig = fn._isInSession;
    fn._isInSession = function (t, spec, tz) {
      try { return orig.call(this, t, spec, tz); }
      catch (e) { if (/Invalid session specification/.test(String(e && e.message))) return true; throw e; }
    };
    fn.__stkSess = true;
  }
}

// request.security INSIDE A USER FUNCTION (pinets 0.11.0 bug): pinets cuts the script after
// each request.security call ("LTF slices", keyed by the call's param id, e.g. 'p3') so the
// secondary timeframe runs only the code it needs. For a call inside a function the runtime id
// is per call site ($$.id + 'p3'), but the slice is cut after the function's FIRST call, so the
// second call site (reqFvg("60") after reqFvg("15")) finds no value and the script dies with
// "Cannot read properties of undefined". We drop just those slices (the ones whose key is
// built from $$.id); those calls then run the whole script on the secondary timeframe, which
// is what pinets does without slicing. Top-level calls keep their slices.
export function pruneSlices(slices){
  if (!slices || typeof slices !== 'object') return slices;
  let kept = 0;
  for (const k of Object.keys(slices)) {
    let txt = '';
    try { txt = String(slices[k]); } catch (e) {}
    if (txt.indexOf("$$.id + '" + k + "'") >= 0 || txt.indexOf('$$.id + "' + k + '"') >= 0) delete slices[k];
    else kept++;
  }
  return kept ? slices : undefined;
}
function patchIndicator(Indicator){
  const proto = Indicator && Indicator.prototype;
  if (!proto || proto.__stkSlices || typeof proto.prepare !== 'function') return;
  const prep = proto.prepare;
  proto.prepare = function (...args) {
    const r = prep.apply(this, args);
    try {
      if (r && r.ltfSlices && !r.__stkPruned) {
        r.__stkPruned = true;
        const kept = pruneSlices(r.ltfSlices);
        if (!kept) { try { delete r.fn._ltfSlices; } catch (e) {} }
        // the prepared object exposes ltfSlices as a plain field
        try { r.ltfSlices = kept; } catch (e) {}
      }
    } catch (e) {}
    return r;
  };
  proto.__stkSlices = true;
}

// SPEED: pinets formats every bar's time in the script's time zone with
// `new Intl.DateTimeFormat(...)` built on EVERY call (hour(time, tz), session checks, ...).
// Building the formatter is the expensive part (most of a 5,000-bar run for scripts with
// session / killzone logic). In the Pine worker only, the constructor is memoised by
// (locale, options): same formatter object, same output, built once.
// The same bar time is formatted many times per bar (every hour()/minute()/session call), so
// each cached formatter also remembers its last few formatToParts results (by timestamp).
// pinets only reads the returned parts.
function remember(f){
  const fp = f.formatToParts.bind(f), last = new Map();
  f.formatToParts = function (d) {
    const t = d == null ? Date.now() : +d;
    let r = last.get(t);
    if (!r) { if (last.size > 64) last.clear(); r = fp(d); last.set(t, r); }
    return r;
  };
  return f;
}
export function cacheDateTimeFormat(scope){
  const I = scope && scope.Intl;
  if (!I || !I.DateTimeFormat || I.DateTimeFormat.__stkCached) return false;
  const Orig = I.DateTimeFormat, memo = new Map();
  function Cached(locales, options){
    let key;
    try { key = JSON.stringify([locales, options]); } catch (e) { return new Orig(locales, options); }
    let f = memo.get(key);
    if (!f) { if (memo.size > 500) memo.clear(); f = remember(new Orig(locales, options)); memo.set(key, f); }
    return f;
  }
  Cached.prototype = Orig.prototype;
  Cached.supportedLocalesOf = Orig.supportedLocalesOf.bind(Orig);
  Cached.__stkCached = true;
  I.DateTimeFormat = Cached;
  return true;
}

export function patchContext(ctx){
  try { patchSessionPeriods(ctx); } catch (e) {}
  try { patchTimeClose(ctx); } catch (e) {}
  try { patchSessions(ctx); } catch (e) {}
  const ta = ctx && ctx.pine && ctx.pine.ta;
  if (!ta || ta.__stkPivot) return false;
  if (typeof ta.pivothigh === 'function') ta.pivothigh = makePivot(ctx, ta.pivothigh, true);
  if (typeof ta.pivotlow === 'function') ta.pivotlow = makePivot(ctx, ta.pivotlow, false);
  ta.__stkPivot = true;
  return true;
}

// pinets = the pinets module (optional): adds the Indicator fix. scope = the worker global
// (optional): adds the formatter cache.
export function install(Context, pinets, scope){
  try { if (pinets && pinets.Indicator) patchIndicator(pinets.Indicator); } catch (e) {}
  try { if (scope) cacheDateTimeFormat(scope); } catch (e) {}
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
