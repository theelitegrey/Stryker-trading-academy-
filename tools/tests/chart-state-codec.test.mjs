// Chart saved-state codec (assets/chart-state-codec.js) + built-in Pine refs. node tools/tests/chart-state-codec.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };

globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(ROOT + 'assets/chart-state-codec.js', 'utf8'));
const C = globalThis.StrykerStateCodec;

// small state: stored as the same plain JSON (older app versions keep reading it)
{ const st = { version: 1, charts: [{ id: 'A', symbol: 'futures:NQ1!' }] };
  const s = await C.encode(st); assert.equal(s, JSON.stringify(st)); assert.deepEqual(await C.decode(s), st); ok('small state stays plain JSON and round-trips'); }
// old plain JSON string reads as before; junk reads as null
{ assert.deepEqual(await C.decode('{"a":1}'), { a: 1 }); assert.equal(await C.decode('not json'), null); assert.equal(await C.decode(''), null); assert.equal(await C.decode('tz1:%%%'), null); ok('old JSON reads; junk and broken tz1 read as null'); }
// a big state (the member's 260 KB case and much more) compresses, round-trips exactly, fits the 900 000 cap
{ const draws = []; for (let i = 0; i < 8000; i++) draws.push({ id: 'd' + i, type: i % 3 ? 'trendline' : 'rectangle', points: [{ time: 1730000000000 + i * 300000, price: 97000 + (i % 97) * 13.25 }, { time: 1730000000000 + (i + 9) * 300000, price: 97100 + (i % 89) * 11.5 }], style: { color: '#26a69a', width: 2 } });
  const st = { version: 1, charts: [{ id: 'A', drawings: draws }] };
  const json = JSON.stringify(st);
  assert.ok(json.length > 1000000, 'fixture is over 1 MB of JSON: ' + json.length);
  const s = await C.encode(st);
  assert.ok(s.startsWith('tz1:') && s.length <= C.STORE_MAX, 'stored ' + s.length);
  assert.deepEqual(await C.decode(s), st);
  ok('1 MB+ state -> ' + Math.round(s.length / 1024) + ' KB stored (tz1), exact round-trip'); }
// past the cap: a clear error with .big and a userMessage, never a silent drop
{ const rnd = (() => { let x = 9; return () => (x = (x * 1664525 + 1013904223) >>> 0).toString(36); })();
  let junk = ''; while (junk.length < 1500000) junk += rnd();
  await assert.rejects(C.encode({ x: junk }), (e) => e.big === true && /could not be saved/.test(e.userMessage) && /kept on this device/.test(e.userMessage));
  ok('incompressible 1.5 MB state -> calm "kept on this device" error'); }

// built-in Pine refs: byte-identical built-in is recognised by its text, unknown text is not
{ const real = globalThis.fetch;
  globalThis.fetch = async (u) => ({ ok: true, text: async () => fs.readFileSync(ROOT + 'assets/' + String(u).replace(/^.*\/assets\//, '').replace(/\?.*$/, ''), 'utf8') });
  const B = await import('../../assets/chart-pine-builtins.js');
  const src = await B.builtinSource('liquidity-master-tradezoro');
  assert.equal(B.builtinIdOf(src), 'liquidity-master-tradezoro');
  assert.equal(B.builtinIdOf(src + ' '), null, 'an edited copy keeps its source');
  assert.equal(B.builtinIdByName('Liquidity Master [TradeZoro]'), 'liquidity-master-tradezoro');
  assert.ok(B.PICKER_SCRIPTS.every((b) => /^[a-z0-9-]{2,80}$/.test(b.id)), 'every built-in id fits the ref pattern used by chart-pine.js / sanitizeShared');
  globalThis.fetch = real;
  ok('built-in Pine source -> id (exact text only); ids fit the ref pattern'); }

console.log(n + ' passed');
