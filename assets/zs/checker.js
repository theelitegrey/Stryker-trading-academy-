// Zscript type checker helpers: type strings, unification, assignability, scopes.
// Types are plain strings: int float bool string color na void any label line box table
// plotid hlineid  arr<T>  map<K,V>  tup<a,b,...>
export const NUM = new Set(['int', 'float']);
export const DRAWING = new Set(['label', 'line', 'box', 'table']);

export const isArr = (t) => typeof t === 'string' && t.startsWith('arr<');
export const isMap = (t) => typeof t === 'string' && t.startsWith('map<');
export const isTup = (t) => typeof t === 'string' && t.startsWith('tup<');
export const isNumT = (t) => t === 'int' || t === 'float' || t === 'na' || t === 'any';

export function splitArgs(inner) {
  const out = []; let d = 0, cur = '';
  for (const ch of inner) {
    if (ch === '<') d++;
    if (ch === '>') d--;
    if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
export const inner = (t) => t.slice(t.indexOf('<') + 1, -1);
export const elemOf = (t) => (isArr(t) ? inner(t) : 'any');
export const mapKV = (t) => (isMap(t) ? splitArgs(inner(t)) : ['any', 'any']);
export const tupItems = (t) => (isTup(t) ? splitArgs(inner(t)) : []);

export function typeFromSpec(spec) {
  if (!spec) return null;
  if (spec.name === 'array') return 'arr<' + (spec.args[0] ? typeFromSpec(spec.args[0]) : 'any') + '>';
  if (spec.name === 'map') return 'map<' + (spec.args[0] ? typeFromSpec(spec.args[0]) : 'any') + ',' + (spec.args[1] ? typeFromSpec(spec.args[1]) : 'any') + '>';
  return spec.name;
}

// Catalog param type -> does a value of type t fit?
export function fitsParam(want, t) {
  if (t === 'na' || t === 'any' || want === 'any') return true;
  switch (want) {
    case 'num': case 'float': return t === 'int' || t === 'float' || t === 'bool' && false;
    case 'int': return t === 'int' || t === 'float';   // floats are truncated where an int is needed
    case 'bool': return t === 'bool' || t === 'int' || t === 'float';
    case 'string': return t === 'string';
    case 'color': return t === 'color';
    case 'array': return isArr(t);
    case 'map': return isMap(t);
    default: return t === want;
  }
}

// Common type of two branches (ternary, if/switch value, array items); null = incompatible.
export function unify(a, b) {
  if (a === b) return a;
  if (a === 'na') return b;
  if (b === 'na') return a;
  if (a === 'any' || b === 'any') return 'any';
  if (NUM.has(a) && NUM.has(b)) return 'float';
  if (a === 'void') return b;
  if (b === 'void') return a;
  if (isArr(a) && isArr(b)) { const e = unify(elemOf(a), elemOf(b)); return e ? 'arr<' + e + '>' : null; }
  if (isMap(a) && isMap(b)) return a.replace(/na|any/g, '') === b.replace(/na|any/g, '') ? a : 'map<any,any>';
  return null;
}

// Can a value of type src be stored in a variable of type dst?
export function assignable(dst, src) {
  if (dst === src || src === 'na' || dst === 'any' || src === 'any' || dst === 'na') return true;
  if (dst === 'float' && src === 'int') return true;
  if (isArr(dst) && isArr(src)) return assignable(elemOf(dst), elemOf(src)) || elemOf(src) === 'any';
  if (isMap(dst) && isMap(src)) return true;
  return false;
}

export function describeType(t) {
  if (t === 'na') return 'na';
  if (isArr(t)) return 'array<' + describeType(elemOf(t)) + '>';
  if (isMap(t)) { const [k, v] = mapKV(t); return 'map<' + describeType(k) + ', ' + describeType(v) + '>'; }
  if (isTup(t)) return 'a tuple of ' + tupItems(t).length;
  if (t === 'plotid') return 'a plot';
  if (t === 'hlineid') return 'an hline';
  return t;
}

// Method namespace for a value type (a.push(x) -> array.push(a, x)).
export function methodNs(t) {
  if (isArr(t)) return 'array';
  if (isMap(t)) return 'map';
  if (DRAWING.has(t)) return t;
  return null;
}

export class Scope {
  constructor(parent, kind) { this.parent = parent; this.kind = kind; this.vars = new Map(); }
  lookup(name) {
    for (let s = this; s; s = s.parent) { const v = s.vars.get(name); if (v) return { v, scope: s }; }
    return null;
  }
  names() { const out = []; for (let s = this; s; s = s.parent) out.push(...s.vars.keys()); return out; }
}
