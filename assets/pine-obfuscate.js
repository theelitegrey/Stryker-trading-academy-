// TradeZoro Creator Hub: Pine source shrinking for PROTECTED community indicators (ES module, no DOM).
// Used by: functions/api/creator/_seal.js (server, at delivery time, per buyer) and assets/creator-ind.js
// (creator's browser, at upload, to prove the shrunk form still compiles). Tests: tools/creator/pine-obf.test.mjs.
//
// What it does to a script (nothing else is touched, so line numbers of real code shift only by removed lines):
//   1. strips every // comment except //@version (Pine has no block comments), trailing spaces and blank lines;
//   2. renames the creator's own variables and functions to opaque names chosen by the caller (nameFor), so a
//      delivered copy carries no meaningful names, and every buyer gets DIFFERENT names (traceable);
//   3. can carry an invisible watermark: a comment line made of zero-width characters (encodeMark / findMarks).
// It is conservative on purpose: a name is renamed only when that is provably safe with this simple scanner.
// NOT renamed: anything used after a dot (fields, methods, namespaces), named-argument keys, function parameters,
// for/tuple variables, type/enum names, variables that hold an input (their names are the settings keys a
// member's saved settings are stored under), Pine keywords and built-ins. The caller compiles the result anyway.

const KEYWORDS = new Set(('var varip if else for to by in while switch and or not true false type enum method export import '
  + 'series simple const int float bool string void na break continue color line label box table linefill polyline array matrix map chart').split(' '));
const BUILTINS = new Set(('ta math str array matrix map color input request strategy label line box table polyline linefill chart syminfo '
  + 'timeframe barstate session ticker plot shape location size position hline display format scale xloc yloc extend text font order '
  + 'currency dayofweek alert alertcondition runtime log adjustment backadjustment dividends earnings splits settlement_as_close barmerge '
  + 'footprint volume_row plotshape plotchar plotarrow plotbar plotcandle bgcolor barcolor fill indicator library max_bars_back fixnan nz '
  + 'na time time_close timestamp year month weekofyear dayofmonth hour minute second timenow time_tradingday last_bar_index last_bar_time '
  + 'bar_index open high low close volume hl2 hlc3 ohlc4 hlcc4 int float bool string').split(' '));

// Tokens keep their exact text so the output is the input with only comments/names changed.
export function scan(src) {
  const out = []; let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { out.push({ t: 'nl', v: '\n' }); i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { let k = i; while (k < n && (src[k] === ' ' || src[k] === '\t' || src[k] === '\r')) k++; out.push({ t: 'ws', v: src.slice(i, k) }); i = k; continue; }
    if (c === '/' && src[i + 1] === '/') { let k = i; while (k < n && src[k] !== '\n') k++; out.push({ t: 'cm', v: src.slice(i, k) }); i = k; continue; }
    if (c === '"' || c === "'") {
      let k = i + 1; while (k < n && src[k] !== c && src[k] !== '\n') { if (src[k] === '\\') k++; k++; }
      out.push({ t: 'str', v: src.slice(i, Math.min(n, k + 1)) }); i = Math.min(n, k + 1); continue;
    }
    if (/[A-Za-z_]/.test(c)) { let k = i; while (k < n && /[A-Za-z0-9_]/.test(src[k])) k++; out.push({ t: 'id', v: src.slice(i, k) }); i = k; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let k = i; while (k < n && /[0-9A-Za-z_.]/.test(src[k])) { if ((src[k] === 'e' || src[k] === 'E') && (src[k + 1] === '-' || src[k + 1] === '+')) k++; k++; }
      out.push({ t: 'num', v: src.slice(i, k) }); i = k; continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', ':=', '=>', '+=', '-=', '*=', '/=', '%='].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    out.push({ t: 'op', v: c }); i++;
  }
  return out;
}

// Significant (non-space, non-comment) neighbours.
function sig(T, i, dir) { for (let k = i + dir; k >= 0 && k < T.length; k += dir) { const t = T[k]; if (t.t !== 'ws' && t.t !== 'cm') return t; } return null; }

// Names that are safe to rename (see header). Returns a Set.
export function renamable(src) {
  const T = scan(src);
  const declared = new Set(), banned = new Set();
  let depth = 0, lineStart = true;
  for (let i = 0; i < T.length; i++) {
    const t = T[i];
    if (t.t === 'nl') { if (depth === 0) lineStart = true; continue; }
    if (t.t === 'ws' || t.t === 'cm') continue;
    const wasStart = lineStart; lineStart = false;
    if (t.t === 'op' && (t.v === '(' || t.v === '[')) {
      if (t.v === '[' && depth === 0) {   // tuple: [a, b] = ... / for [i, x] in ...
        let k = i + 1; const ids = [];
        for (; k < T.length && !(T[k].t === 'op' && T[k].v === ']'); k++) if (T[k].t === 'id') ids.push(T[k].v);
        const nx = sig(T, k, 1);
        if (nx && ((nx.t === 'op' && (nx.v === '=' || nx.v === ':=')) || (nx.t === 'id' && nx.v === 'in'))) ids.forEach((x) => banned.add(x));
      }
      depth++; continue;
    }
    if (t.t === 'op' && (t.v === ')' || t.v === ']')) { depth = Math.max(0, depth - 1); continue; }
    if (t.t !== 'id') continue;
    const prev = sig(T, i, -1), next = sig(T, i, 1);
    if (prev && prev.t === 'op' && prev.v === '.') { banned.add(t.v); continue; }
    if (depth > 0 && next && next.t === 'op' && next.v === '=') { banned.add(t.v); continue; }
    if ((t.v === 'type' || t.v === 'enum' || t.v === 'for') && next && next.t === 'id') banned.add(next.v);
    if (t.v === 'method' || t.v === 'export') { if (next && next.t === 'id') banned.add(next.v); }
    // function definition at the start of a line: name(params) =>  (params are never renamed)
    if (wasStart && next && next.t === 'op' && next.v === '(') {
      let d = 0, k = i + 1; const ids = [];
      for (; k < T.length; k++) {
        const u = T[k];
        if (u.t === 'op' && (u.v === '(' || u.v === '[')) d++;
        else if (u.t === 'op' && (u.v === ')' || u.v === ']')) { d--; if (d === 0) break; }
        else if (u.t === 'id') ids.push(u.v);
      }
      const after = sig(T, k, 1);
      if (after && after.t === 'op' && after.v === '=>') { declared.add(t.v); ids.forEach((x) => banned.add(x)); }
    }
    // variable declaration at depth 0: [var|varip] [type words] name = ...  (not :=, that's reassignment)
    if (depth === 0 && next && next.t === 'op' && next.v === '=') {
      const rhs = sig(T, T.indexOf(next), 1);
      if (rhs && rhs.t === 'id' && rhs.v === 'input') banned.add(t.v);
      else declared.add(t.v);
    }
  }
  const ok = new Set();
  declared.forEach((x) => { if (!banned.has(x) && !KEYWORDS.has(x) && !BUILTINS.has(x) && !x.startsWith('_')) ok.add(x); });
  return ok;
}

// Every identifier in the source (to avoid collisions when picking new names).
export function identifiers(src) { return new Set(scan(src).filter((t) => t.t === 'id').map((t) => t.v)); }

// Strip comments (keep //@version), rename (map: old -> new), drop trailing spaces and blank lines.
export function rewrite(src, map) {
  const T = scan(String(src).replace(/\r\n?/g, '\n'));
  let out = '', depth = 0;
  for (let i = 0; i < T.length; i++) {
    const t = T[i];
    if (t.t === 'cm') { if (/^\/\/\s*@version\s*=/.test(t.v)) out += t.v.trim(); continue; }
    if (t.t === 'op' && (t.v === '(' || t.v === '[')) depth++;
    if (t.t === 'op' && (t.v === ')' || t.v === ']')) depth = Math.max(0, depth - 1);
    if (t.t === 'id' && map && map.has(t.v)) {
      const prev = sig(T, i, -1), next = sig(T, i, 1);
      const member = prev && prev.t === 'op' && prev.v === '.';
      const namedArg = depth > 0 && next && next.t === 'op' && next.v === '=';
      out += member || namedArg ? t.v : map.get(t.v);
      continue;
    }
    out += t.v;
  }
  return out.split('\n').map((l) => l.replace(/[ \t]+$/, '')).filter((l) => l.trim() !== '').join('\n') + '\n';
}

// Build the rename map with a caller-supplied name function (server: keyed HMAC per buyer, so the same
// variable gets the same name for that buyer across versions and his saved settings keep working).
export function renameMap(src, nameFor) {
  const names = renamable(src), taken = identifiers(src), map = new Map(), used = new Set();
  [...names].sort().forEach((x) => {
    let nm = nameFor(x), salt = 0;
    while (!/^[a-z][a-z0-9]{3,}$/.test(nm) || taken.has(nm) || used.has(nm) || KEYWORDS.has(nm) || BUILTINS.has(nm)) nm = nameFor(x + '#' + (++salt));
    used.add(nm); map.set(x, nm);
  });
  return map;
}

// ---- invisible watermark: bytes -> zero-width characters in a comment line ----
const ZW = ['\u200b', '\u200c', '\u200d', '\u2060'];   // 2 bits each
export function encodeMark(bytes) {
  let s = '';
  for (const b of bytes) for (let k = 6; k >= 0; k -= 2) s += ZW[(b >> k) & 3];
  return '//' + '\u2063' + s + '\u2063';
}
export function findMarks(text) {
  const out = []; const re = /\u2063([\u200b\u200c\u200d\u2060]+)\u2063/g; let m;
  while ((m = re.exec(String(text)))) {
    const z = m[1]; if (z.length % 4) continue;
    const b = new Uint8Array(z.length / 4);
    for (let i = 0; i < b.length; i++) { let v = 0; for (let k = 0; k < 4; k++) v = (v << 2) | ZW.indexOf(z[i * 4 + k]); b[i] = v; }
    out.push(b);
  }
  return out;
}
// Put the mark line after line `at` (0-based, clamped; never before //@version).
export function insertMark(src, markLine, at) {
  const lines = String(src).replace(/\n$/, '').split('\n');
  let pos = Math.max(1, Math.min(lines.length, at | 0));
  if (/^\s/.test(lines[pos] || '')) {   // never inside an indented block / continuation: next top-level line
    while (pos < lines.length && /^\s/.test(lines[pos])) pos++;
  }
  lines.splice(pos, 0, markLine);
  return lines.join('\n') + '\n';
}

// ---- delivery template (server, per buyer, cheap) ----
// template() does the expensive part ONCE, when the creator publishes a version: comments stripped, and every
// renamable name replaced by a marker \u0001<n>\u0001. fill() then only swaps markers for one buyer's names, so a
// Pages Function serves a 100 KB script in about a millisecond instead of re-scanning it on every chart load.
export function template(src) {
  const names = [...renamable(src)].sort();
  const idx = new Map(names.map((x, i) => [x, '\u0001' + i + '\u0001']));
  return { tpl: rewrite(src, idx), names, taken: [...identifiers(src)] };
}
// nameFor(name, salt) -> candidate; same collision rules as renameMap.
export function fill(t, nameFor) {
  const taken = new Set(t.taken), used = new Set();
  const out = t.names.map((x) => {
    let nm = nameFor(x, 0), salt = 0;
    while (!/^[a-z][a-z0-9]{3,}$/.test(nm) || taken.has(nm) || used.has(nm) || KEYWORDS.has(nm) || BUILTINS.has(nm)) nm = nameFor(x, ++salt);
    used.add(nm); return nm;
  });
  return t.tpl.replace(/\u0001(\d+)\u0001/g, (m, i) => out[+i]);
}
// Fast keyed namer: seed = hex string from a server-side HMAC (per buyer + indicator). FNV-1a, 2 x 32 bits.
export function namer(seed) {
  const h = (s) => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return x; };
  return (name, salt) => { const k = seed + '|' + name + '|' + salt; return 'v' + (h(k).toString(36) + h(k + '#').toString(36)).slice(0, 8); };
}
