// Unit test: built-in chart templates (assets/chart-tpl-gallery.js data) reference real indicators,
// have unique ids, honest copy, and the Pro kinds are what chart-pro-gate says.
//   node tools/tests/chart-tpl-data.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
globalThis.window = {}; globalThis.document = { createElement() { return {}; } };
const { TEMPLATES, proKinds, toolNames } = await import('../../assets/chart-tpl-gallery.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const reg = JSON.parse(fs.readFileSync(path.join(root, 'tools/indicator-pages/registry.json'), 'utf8'));
const natives = new Set(reg.rows.filter((r) => r.native).map((r) => r.nativeType));
['stk_zzone', 'stk_zvol'].forEach((x) => natives.add(x));   // installed with the options (Zoro) flag, not in the registry

assert.ok(TEMPLATES.length >= 10 && TEMPLATES.length <= 15, 'between 10 and 15 templates');
assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length, 'unique ids');
for (const t of TEMPLATES) {
  assert.ok(t.name && t.desc && t.tf, t.id + ': name, desc, tf');
  assert.ok(t.ind.length >= 1, t.id + ': has indicators');
  for (const [type] of t.ind) assert.ok(natives.has(type), t.id + ': unknown native indicator ' + type);
  assert.ok(!/delayed|behind|real-time|\blive\b|win rate|profit|accura|tradingview|luxalgo|vela/i.test(t.name + ' ' + t.desc), t.id + ': banned word');
  if (t.thumb) assert.ok(fs.existsSync(path.join(root, 'assets/images/chart-templates', t.id + '.webp')), t.id + ': thumbnail missing');
  assert.ok(toolNames(t).every((n) => !/^stk_|^[a-z0-9]+(-[a-z0-9]+)+$/.test(n)), t.id + ': tool without a display name');
}
const by = (id) => TEMPLATES.find((t) => t.id === id);
assert.deepEqual(proKinds(by('clean')), [], 'clean is fully free');
assert.deepEqual(proKinds(by('scalp-nq')), ['of']);
assert.deepEqual(proKinds(by('options-levels')).sort(), ['gex']);
const g = by('gex-flow');
assert.deepEqual(g.ind.map((x) => x[0]), ['stk_gex', 'stk_zzone', 'stk_optflow', 'stk_zvol', 'stk_tide']);
assert.deepEqual(proKinds(g), ['gex'], 'gex-flow is Pro (options data)');
assert.ok(!/\b(real-time|delayed)\b/i.test(g.desc), 'no live/delayed claims');
console.log('chart-tpl-data: ok (' + TEMPLATES.length + ' templates)');
