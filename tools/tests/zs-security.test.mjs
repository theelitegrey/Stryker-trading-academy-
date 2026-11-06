// Zscript security tests (node side): member text never becomes JS, hostile names compile to
// nothing, tampered programs are rejected, prototype pollution through every input path fails.
// The real worker lockdown (fetch/importScripts/postMessage) is tested in a browser by
// tools/tests/zs-worker-browser.mjs.        node tools/tests/zs-security.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, done, exec, makeBars, assert, comp, compile, run, Session } from './zs-helpers.mjs';
import { validateProgram } from '../../assets/zs/vm.js';
import { OP, OP_ARGC } from '../../assets/zs/ops.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ZS = path.join(ROOT, 'assets/zs');
const src = Object.fromEntries(fs.readdirSync(ZS).filter((f) => f.endsWith('.js')).map((f) => [f, fs.readFileSync(path.join(ZS, f), 'utf8')]));
const code = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const polluted = () => ({}).polluted !== undefined || ({}).x1 !== undefined || [].polluted !== undefined || Object.prototype.hasOwnProperty('polluted');
const ok = (p) => { try { validateProgram(p); return true; } catch (e) { return false; } };
const base = () => JSON.parse(JSON.stringify(comp('x = ta.ema(close, 3)\nplot(x)').program));

// ---------- the engine source itself ----------
t('no eval / new Function / Function( in engine', () => { for (const [f, s] of Object.entries(src)) assert.ok(!/\beval\s*\(|new\s+Function\b|\bFunction\s*\(|setTimeout\s*\(\s*['"`]/.test(code(s)), f); });
t('no network/storage/DOM APIs in engine (except worker/runner plumbing)', () => {
  for (const [f, s] of Object.entries(src)) {
    if (f === 'runner.js' || f === 'worker.js') continue;
    assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|importScripts|localStorage|sessionStorage|indexedDB|document|window|cookie|postMessage|navigator)\b/.test(code(s)), f);
  }
});
t('no dynamic import() in engine', () => { for (const [f, s] of Object.entries(src)) assert.ok(!/\bimport\s*\(/.test(code(s)), f); });
t('engine imports only its own files', () => { for (const [f, s] of Object.entries(src)) for (const m of s.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.match(m[1], f === 'worker.js' ? /^(\.\/[a-z-]+|\.\.\/creator-seal)\.js\?v=\d+$/ : /^\.\/[a-z-]+\.js\?v=\d+$/, f + ' imports ' + m[1]); });
t('worker closes the doors before handling messages', () => {
  const w = code(src['worker.js']);
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'EventSource', 'WebTransport', 'Function', 'eval', 'MessageChannel']) assert.ok(w.includes(`'${k}'`), k);
  assert.ok(w.indexOf('DOORS') < w.indexOf('self.onmessage'));
});
t('worker freezes the core prototypes', () => assert.match(src['worker.js'], /Object\.freeze\(o\)/));
t('_headers gives the worker an enforced no-network CSP', () => {
  const h = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
  const i = h.indexOf('/assets/zs/worker.js');
  assert.ok(i >= 0, 'rule present');
  const block = h.slice(i, i + 600);
  assert.match(block, /\n\s+Content-Security-Policy: /);
  assert.match(block, /connect-src 'none'/);
  assert.match(block, /default-src 'none'/);
});

// ---------- hostile member text ----------
const HOSTILE = ['constructor', '__proto__', 'prototype', 'self', 'globalThis', 'window', 'fetch', 'importScripts', 'eval', 'Function', 'this', 'process', 'require', 'postMessage', 'document', 'toString', 'valueOf', 'hasOwnProperty'];
for (const h of HOSTILE) {
  t(`name "${h}" is just an unknown name`, () => { const r = comp(`plot(${h})`); assert.equal(r.ok, false); assert.ok(r.diagnostics.some((d) => ['E303', 'E203', 'E210'].includes(d.code)), r.diagnostics.map((d) => d.code).join()); });
  t(`member "${h}" on a namespace is unknown`, () => assert.equal(comp(`plot(ta.${h}(close))`).ok, false));
  t(`method "${h}" on an array is unknown`, () => assert.equal(comp(`a = array.new_float(0)\nx = a.${h}()\nplot(close)`).ok, false));
}
t('user variables named like JS globals stay private slots', () => {
  const r = comp('self2 = 1\nfetchx = 2\nplot(self2 + fetchx)'); assert.equal(r.ok, true);
  assert.ok(!JSON.stringify(r.program).includes('fetchx'));
});
t('strings are data, never code', () => { const o = exec('label.new(0, 0, "fetch(\'https://evil.example\')")\nplot(close)', { bars: makeBars(1) }); assert.equal(o.labels[0].text, "fetch('https://evil.example')"); });
t('str.format does not evaluate placeholders', () => assert.equal(exec('label.new(0, 0, str.format("{0}{constructor}{__proto__}", "a"))\nplot(close)', { bars: makeBars(1) }).labels[0].text, 'a{constructor}{__proto__}'));
t('map keys __proto__/constructor do not pollute', () => { exec('m = map.new<string, string>()\nm.put("__proto__", "x")\nm.put("polluted", "y")\nm.put("constructor", "z")\nplot(close)'); assert.ok(!polluted()); });
t('array.join / str.split on __proto__ text', () => { exec('a = str.split("__proto__,constructor", ",")\nb = array.join(a, ".")\nplot(close)'); assert.ok(!polluted()); });
t('labels with hostile text are plain strings', () => { const o = exec('label.new(0, 0, "<img src=x onerror=alert(1)>")\nplot(close)', { bars: makeBars(1) }); assert.equal(typeof o.labels[0].text, 'string'); });
t('colors out of the engine are always #rrggbbaa', () => { const o = exec('plot(close, color=input.color(color.red))', { bars: makeBars(2), inputs: { 0: 'red;background:url(javascript:x)' } }); assert.match(o.plots[0].color, /^#[0-9a-f]{8}$/); });

// ---------- hostile run options ----------
t('inputs object with __proto__ key', () => { const p = comp('n = input.int(3)\nplot(n)').program; const inputs = JSON.parse('{"__proto__": {"polluted": 1}, "0": 4}'); const o = run(p, { bars: makeBars(2), inputs }); assert.equal(o.plots[0].values[0], 4); assert.ok(!polluted()); });
t('symbol object with __proto__', () => { const p = comp('plot(syminfo.mintick)').program; const o = run(p, { bars: makeBars(2), symbol: JSON.parse('{"__proto__": {"polluted": 1}, "mintick": 0.5, "ticker": {"toString": 1}}') }); assert.equal(o.ok, true); assert.ok(!polluted()); });
t('source input "constructor" falls back', () => { const p = comp('s = input.source(close)\nplot(s)').program; const o = run(p, { bars: makeBars(3), inputs: { 0: '__proto__' } }); assert.equal(o.ok, true); });
t('bars with getters are read as data only', () => {
  const p = comp('plot(close)').program; let hits = 0;
  const bars = makeBars(3); const evil = { get close() { hits++; return bars.close; }, open: bars.open, high: bars.high, low: bars.low, volume: bars.volume, time: bars.time };
  const o = run(p, { bars: evil }); assert.equal(o.ok, true); assert.ok(hits < 10);
});
t('bars with non-numbers become na, not code', () => { const b = makeBars(3); b.close[1] = { valueOf() { throw new Error('x'); } }; b.close[2] = '7'; const o = run(comp('plot(close)').program, { bars: b }); assert.equal(o.ok, true); assert.ok(Number.isNaN(o.plots[0].values[1])); });
t('data frames with __proto__', () => { const p = comp('plot(gex.flip)').program; const o = run(p, { bars: makeBars(2), allowed: { gex: true }, data: { gex: JSON.parse('[{"__proto__": {"polluted": 1}, "flip": 5}, {"flip": 6}]') } }); assert.equal(o.ok, true); assert.ok(!polluted()); });
t('allowed must be literally true', () => { const p = comp('plot(gex.flip)').program; const o = run(p, { bars: makeBars(2), allowed: { gex: 'yes' }, data: { gex: [{ flip: 5 }, { flip: 6 }] } }); assert.ok(Number.isNaN(o.plots[0].values[0])); });
t('limitsOverride cannot raise limits', () => { const p = comp('i = 0\nwhile true\n    i += 1\nplot(i)').program; const o = new Session(p, { limitsOverride: { loopIters: Infinity, opsPerBar: 1e15 } }).run(makeBars(1)); assert.equal(o.ok, false); });
t('output has no functions (structured clone safe)', () => { const o = exec('var t = table.new(position.top_left, 1, 1)\ntable.cell(t, 0, 0, "a")\nlabel.new(0, 0, "x")\nline.new(0, 0, 1, 1)\nbox.new(0, 1, 1, 0)\nplot(close)'); structuredClone(o); });

// ---------- tampered programs (a library program is untrusted input) ----------
t('valid program passes validation', () => assert.ok(ok(base())));
t('rejects wrong version', () => { const p = base(); p.v = 99; assert.ok(!ok(p)); });
t('rejects unknown builtin name', () => { const p = base(); p.fns.push('constructor'); assert.ok(!ok(p)); });
t('rejects inherited builtin names', () => { for (const n of ['__proto__', 'toString', 'hasOwnProperty', 'valueOf']) { const p = base(); p.fns[0] = n; assert.ok(!ok(p), n); } });
t('rejects unknown builtin variable', () => { const p = base(); p.bvars.push('process'); assert.ok(!ok(p)); });
t('rejects bad opcode', () => { const p = base(); p.units[0].code.push(9999); assert.ok(!ok(p)); });
t('rejects fractional opcode', () => { const p = base(); p.units[0].code[0] = 0.5; assert.ok(!ok(p)); });
t('rejects string opcode', () => { const p = base(); p.units[0].code[0] = 'CALL'; assert.ok(!ok(p)); });
t('rejects truncated instruction', () => { const p = base(); p.units[0].code.pop(); assert.ok(!ok(p) || run(p, { bars: makeBars(2) }).ok !== undefined); });
t('rejects jump out of range', () => { const p = base(); p.units[0].code.push(OP.JMP, 1e6); assert.ok(!ok(p)); });
t('rejects jump into the middle of an instruction', () => {
  const p = base(); const c = p.units[0].code;
  let i = 0; while (OP_ARGC[c[i]] === 0) i++;          // first instruction with an operand
  c.unshift(OP.JMP, i + 2 + 1);                          // land on that operand
  assert.ok(!ok(p));
});
t('rejects slot out of range', () => { const p = base(); p.units[0].code.push(OP.LOAD, p.units[0].nSlots + 5); assert.ok(!ok(p)); });
t('rejects const out of range', () => { const p = base(); p.units[0].code.push(OP.CONST, 1e5); assert.ok(!ok(p)); });
t('rejects object constants', () => { const p = base(); p.consts.push({ toString: 1 }); assert.ok(!ok(p)); });
t('rejects huge constants', () => { const p = base(); p.consts.push('x'.repeat(5000)); assert.ok(!ok(p)); });
t('rejects absurd limits', () => { const p = base(); p.limits.labels = 1e9; assert.ok(!ok(p)); });
t('rejects missing outputs', () => { const p = base(); delete p.outputs; assert.ok(!ok(p)); });
t('rejects too many units', () => { const p = base(); p.units = Array(40).fill(p.units[0]); assert.ok(!ok(p)); });
t('program JSON with __proto__ does not pollute', () => { const s = JSON.stringify(base()).replace('{', '{"__proto__":{"polluted":1},'); try { new Session(s, {}).run(makeBars(2)); } catch (e) { /* rejected is fine */ } assert.ok(!polluted()); });
t('random bit flips never crash the VM', () => {
  let s = 7; const r = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  const good = comp('[m, sg, h] = ta.macd(close, 12, 26, 9)\nvar a = array.new_float(0)\na.push(m)\nif a.size() > 3\n    a.shift()\nplot(a.avg())\nlabel.new(bar_index, h, str.tostring(sg))').program;
  const bars = makeBars(20);
  for (let i = 0; i < 3000; i++) {
    const p = JSON.parse(JSON.stringify(good)); const c = p.units[0].code;
    for (let k = 0; k < 1 + Math.floor(r() * 3); k++) c[Math.floor(r() * c.length)] = Math.floor(r() * 120) - 10;
    let o; try { o = new Session(p, { limitsOverride: { firstRunMs: 500 } }).run(bars); } catch (e) { assert.equal(e.code, 'E499', 'only validation errors may throw: ' + e.message); continue; }
    assert.equal(typeof o.ok, 'boolean');
  }
  assert.ok(!polluted());
});
t('compiled program never contains member identifiers or comments', () => {
  const r = comp('// secret sauce: buy when moon\nsecretSauceLength = input.int(7, "Length")\nmySignal(x) => ta.ema(x, secretSauceLength)\nplot(mySignal(close), "Signal")');
  const s = JSON.stringify(r.program);
  for (const w of ['secret sauce', 'secretSauceLength', 'mySignal']) assert.ok(!s.includes(w), w);
});
t('compile() never throws on hostile source', () => { for (const s of ['\u0000', '\uffff'.repeat(1000), '"'.repeat(5000), '//@zscript 1\n' + '['.repeat(10000), '//@zscript 1\nindicator("x")\n' + 'x = f(' + 'a,'.repeat(20000)]) compile(s); });

done('zs-security');
