// Indicator presets: storage helpers (save / replace / list / delete / limits).  node tools/tests/chart-ind-presets.test.mjs
import assert from 'node:assert/strict';
const mem = {}; globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const { loadPresets, savePreset, deletePreset, PRESET_MAX } = await import('../../assets/chart-ind-style.js');
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
assert.deepEqual(loadPresets('n:rsi'), []); ok('empty list');
assert.equal(savePreset('n:rsi', '   ', { v: {}, s: null }), null); ok('empty name refused');
let l = savePreset('n:rsi', ' Fast ', { v: { length: 7, obj: {}, fn: 1 }, p: {}, s: { el: { x: { width: 3 } } } });
assert.equal(l.length, 1); assert.equal(l[0].n, 'Fast'); assert.deepEqual(l[0].v, { length: 7, fn: 1 }); assert.equal(l[0].s.el.x.width, 3); ok('saved, trimmed, only plain values kept');
l = savePreset('n:rsi', 'fast', { v: { length: 9 }, s: null });
assert.equal(l.length, 1); assert.equal(l[0].v.length, 9); ok('same name (any case) replaces');
savePreset('n:rsi', 'Alpha', { v: {}, s: null });
assert.deepEqual(loadPresets('n:rsi').map((x) => x.n), ['Alpha', 'fast']); ok('sorted by name');
assert.deepEqual(loadPresets('n:macd'), []); ok('presets are per indicator');
deletePreset('n:rsi', 'Alpha'); assert.deepEqual(loadPresets('n:rsi').map((x) => x.n), ['fast']);
deletePreset('n:rsi', 'fast'); assert.deepEqual(loadPresets('n:rsi'), []); assert.equal(JSON.parse(mem['stryker.indstyle.presets'])['n:rsi'], undefined); ok('delete, empty key removed');
for (let i = 0; i < PRESET_MAX; i++) savePreset('n:x', 'p' + i, { v: {}, s: null });
assert.equal(savePreset('n:x', 'extra', { v: {}, s: null }), null); ok('limit enforced');
console.log(n + ' passed');
