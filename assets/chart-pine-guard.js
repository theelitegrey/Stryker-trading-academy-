// Stryker Trading Academy — Charts: safety check for Pine scripts written by OTHER members
// (Community / invite-link scripts). Plain script; also loads in Node for tests
// (tools/tests/chart-pine-guard.test.js).
//
// WHY: PineTS (the Pine engine) transpiles Pine to JavaScript and runs it with new
// Function. It is NOT a sandbox: tested 2026-10-05 against pinets 0.11.0, a Pine source can
// call any JavaScript global it names (eval, Function, fetch, globalThis...) and reach
// Function through `x.constructor.constructor(...)`. So a shared script is checked here
// BEFORE it is ever run, and only runs on the Web Worker engine (never the in-page
// fallback). This check is a strict allowlist, but it is defence in depth, not a proof:
// public listing also needs an admin review (pineLibrary status 'pending').
//
// Rules (any failure rejects the whole script):
//  - only ASCII outside comments; no backtick, `$`, `\` or `@` in code
//  - strings: no \u / \x escapes, no `${`
//  - a name used on its own must be a Pine built-in or keyword, or declared in the script
//    (`x = ...`, `var float x = ...`, `f(a, b) =>`, `type T`, `for i = ...`, `[a, b] = ...`)
//  - names that are JavaScript escape hatches are refused everywhere, also after a dot
//    or as a named argument (constructor, __proto__, eval, Function, fetch, self...)
//  - `import` (Pine libraries) is refused
//
// Exposes window.StrykerPineGuard = { check(source) -> { ok, msg, line } }.

(function (root) {
  'use strict';

  var KEYWORDS = ('var varip if else for to by in while switch and or not true false type enum method export '
    + 'series simple const int float bool string void na break continue color line label box table linefill '
    + 'polyline array matrix map chart').split(' ');
  var BUILTINS = ('ta math str array matrix map color input request strategy label line box table polyline '
    + 'linefill chart syminfo timeframe barstate session ticker plot shape location size position hline display format '
    + 'scale xloc yloc extend text font order currency dayofweek alert alertcondition runtime log adjustment backadjustment '
    + 'dividends earnings splits settlement_as_close barmerge footprint volume_row '
    + 'plotshape plotchar plotarrow plotbar plotcandle bgcolor barcolor fill indicator library max_bars_back '
    + 'fixnan nz na time time_close timestamp year month weekofyear dayofmonth hour minute second timenow time_tradingday '
    + 'last_bar_index last_bar_time bar_index open high low close volume hl2 hlc3 ohlc4 hlcc4').split(' ');
  // JavaScript escape hatches and engine internals: refused anywhere in code.
  var DENY = ('constructor prototype __proto__ __defineGetter__ __defineSetter__ __lookupGetter__ __lookupSetter__ '
    + 'caller callee arguments call apply bind eval Function globalThis self window document top parent frames opener '
    + 'importScripts fetch XMLHttpRequest WebSocket EventSource indexedDB caches localStorage sessionStorage cookieStore '
    + 'postMessage onmessage close_worker Worker SharedWorker ServiceWorker navigator setTimeout setInterval '
    + 'queueMicrotask requestAnimationFrame Reflect Proxy Object Symbol Promise Atomics SharedArrayBuffer WebAssembly '
    + 'import require process module exports this new_function context $ JSON Blob URL').split(' ');
  // `new` is fine after a dot (T.new, array.new_float); `close` etc. are Pine built-ins.
  var ALLOW = Object.create(null), DENYSET = Object.create(null);
  KEYWORDS.concat(BUILTINS).forEach(function (k) { ALLOW[k] = 1; });
  DENY.forEach(function (k) { DENYSET[k] = 1; });

  function fail(msg, line) { return { ok: false, msg: msg, line: line || null }; }

  function tokenize(src) {
    var toks = [], i = 0, line = 1, n = src.length;
    while (i < n) {
      var c = src[i];
      if (c === '\n') { toks.push({ t: 'nl', line: line }); line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '"' || c === "'") {
        var q = c, j = i + 1, s = '';
        while (j < n && src[j] !== q) {
          if (src[j] === '\n') return { err: fail('A text value is not closed.', line) };
          if (src[j] === '\\') {
            var e = src[j + 1];
            if (e === 'u' || e === 'x' || e === undefined) return { err: fail('Escape codes like \\u or \\x are not allowed in shared scripts.', line) };
            s += src[j] + e; j += 2; continue;
          }
          s += src[j]; j++;
        }
        if (j >= n) return { err: fail('A text value is not closed.', line) };
        if (s.indexOf('${') >= 0) return { err: fail('"${" is not allowed in text in shared scripts.', line) };
        toks.push({ t: 'str', line: line }); i = j + 1; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        var k = i; while (k < n && /[A-Za-z0-9_]/.test(src[k])) k++;
        toks.push({ t: 'id', v: src.slice(i, k), line: line }); i = k; continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        var m = i; while (m < n && /[0-9A-Za-z_.]/.test(src[m])) { if ((src[m] === 'e' || src[m] === 'E') && (src[m + 1] === '-' || src[m + 1] === '+')) m++; m++; }
        toks.push({ t: 'num', line: line }); i = m; continue;
      }
      if (c.charCodeAt(0) > 126 || c === '`' || c === '$' || c === '\\' || c === '@' || c === '{' || c === '}' || c === ';') {
        return { err: fail('The character "' + (c.charCodeAt(0) > 126 ? 'U+' + c.charCodeAt(0).toString(16).toUpperCase() : c) + '" is not allowed in shared scripts.', line) };
      }
      var two = src.slice(i, i + 2);
      if (['==', '!=', '<=', '>=', ':=', '=>', '+=', '-=', '*=', '/=', '%='].indexOf(two) >= 0) { toks.push({ t: 'op', v: two, line: line }); i += 2; continue; }
      toks.push({ t: 'op', v: c, line: line }); i++;
    }
    return { toks: toks };
  }

  function check(source) {
    var src = String(source || '');
    if (!src.trim()) return fail('The script is empty.');
    if (src.length > 65536) return fail('The script is longer than 64 KB.');
    var r = tokenize(src);
    if (r.err) return r.err;
    var T = r.toks, declared = Object.create(null), i, t;
    // Pass 1: declarations.
    var depth = 0, stmtStart = true;
    for (i = 0; i < T.length; i++) {
      t = T[i];
      if (t.t === 'nl') { stmtStart = depth === 0; continue; }
      if (t.t === 'op' && (t.v === '(' || t.v === '[')) {
        // tuple declaration [a, b] = / for [i, x] in
        if (t.v === '[' && depth === 0) {
          var j2 = i + 1, ids = [], ok = true;
          while (j2 < T.length && !(T[j2].t === 'op' && T[j2].v === ']')) { if (T[j2].t === 'id') ids.push(T[j2].v); else if (!(T[j2].t === 'op' && T[j2].v === ',')) { ok = false; break; } j2++; }
          var nx = T[j2 + 1];
          if (ok && nx && ((nx.t === 'op' && (nx.v === '=' || nx.v === ':=')) || (nx.t === 'id' && nx.v === 'in'))) ids.forEach(function (x) { declared[x] = 1; });
        }
        depth++; stmtStart = false; continue;
      }
      if (t.t === 'op' && (t.v === ')' || t.v === ']')) { depth = Math.max(0, depth - 1); continue; }
      if (t.t === 'id') {
        var nt = T[i + 1];
        if (t.v === 'type' || t.v === 'enum') { if (nt && nt.t === 'id') declared[nt.v] = 1; }
        if (t.v === 'for' && nt && nt.t === 'id') declared[nt.v] = 1;
        if (depth === 0 && nt && nt.t === 'op' && nt.v === '=') declared[t.v] = 1;
        // function / method definition: name(params) =>
        if (stmtStart || (i > 0 && T[i - 1].t === 'id' && (T[i - 1].v === 'method' || T[i - 1].v === 'export'))) {
          if (nt && nt.t === 'op' && nt.v === '(') {
            var d = 0, k2 = i + 1, piece = [];
            var params = [];
            for (; k2 < T.length; k2++) {
              var u = T[k2];
              if (u.t === 'op' && (u.v === '(' || u.v === '[')) { d++; if (d === 1) continue; }
              if (u.t === 'op' && (u.v === ')' || u.v === ']')) { d--; if (d === 0) break; }
              if (d === 1 && u.t === 'op' && u.v === ',') { params.push(piece); piece = []; continue; }
              if (d === 1) piece.push(u);
            }
            params.push(piece);
            var after = T[k2 + 1];
            if (after && after.t === 'op' && after.v === '=>') {
              declared[t.v] = 1;
              params.forEach(function (p) {
                var eq = p.findIndex(function (x) { return x.t === 'op' && x.v === '='; });
                var head = eq >= 0 ? p.slice(0, eq) : p;
                for (var z = head.length - 1; z >= 0; z--) if (head[z].t === 'id') { declared[head[z].v] = 1; break; }
              });
            }
          }
        }
        if (stmtStart && !(t.v === 'var' || t.v === 'varip' || t.v === 'method' || t.v === 'export' || ALLOW[t.v])) stmtStart = false;
      }
    }
    // Pass 2: every identifier.
    depth = 0;
    for (i = 0; i < T.length; i++) {
      t = T[i];
      if (t.t === 'op' && (t.v === '(' || t.v === '[')) depth++;
      if (t.t === 'op' && (t.v === ')' || t.v === ']')) depth = Math.max(0, depth - 1);
      if (t.t !== 'id') continue;
      var v = t.v;
      if (v === 'import') return fail('Pine libraries (import) are not supported in shared scripts.', t.line);
      if (DENYSET[v] || v.slice(0, 2) === '__') return fail('"' + v + '" is not allowed in shared scripts.', t.line);
      var prev = T[i - 1], next = T[i + 1];
      if (prev && prev.t === 'op' && prev.v === '.') continue;              // member name
      if (depth > 0 && next && next.t === 'op' && next.v === '=') continue;   // named argument key
      if (ALLOW[v] || declared[v]) continue;
      return fail('"' + v + '" is not a Pine built-in or a name declared in this script, so it can\'t run as a shared script.', t.line);
    }
    return { ok: true };
  }

  var api = { check: check };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StrykerPineGuard = api;
})(typeof window !== 'undefined' ? window : this);
