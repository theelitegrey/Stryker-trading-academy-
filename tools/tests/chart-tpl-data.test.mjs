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

assert.ok(TEMPLATES.length >= 10 && TEMPLATES.length <= 20, 'between 10 and 20 templates');
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
assert.deepEqual(g.ind.map((x) => x[0]), ['stk_gex', 'stk_gexheat', 'stk_zzone', 'stk_optflow', 'stk_zvol', 'stk_tide']);
assert.deepEqual(proKinds(g), ['gex'], 'gex-flow is Pro (options data)');
assert.ok(!/\b(real-time|delayed)\b/i.test(g.desc), 'no live/delayed claims');
const vp = ['vp-monthly', 'vp-weekly', 'vp-daily'].map(by);
assert.ok(vp.every(Boolean), 'three volume profile templates');
assert.ok(by('vp-daily').ind.some(([t, i]) => t === 'stk_svp' && i.showDelta === true), 'daily template turns delta bars on');
assert.ok(by('vp-weekly').ind.some(([t, i]) => t === 'stk_avwap' && typeof i === 'function' && i().anchor <= Date.now()), 'weekly VWAP anchor is a past time');
const ma = by('vp-monthly').ind.find(([t]) => t === 'stk_avwap')[1]().anchor, md = new Date(ma);
assert.ok(md.getUTCDate() === 1 && md.getUTCHours() === 0 && ma <= Date.now(), 'monthly VWAP anchor = the 1st, 00:00 UTC');
const wa = new Date(by('vp-weekly').ind.find(([t]) => t === 'stk_avwap')[1]().anchor);
assert.ok(wa.getUTCDay() === 1 && wa.getUTCHours() === 0, 'weekly VWAP anchor = Monday 00:00 UTC');
for (const id of ['vp-monthly', 'vp-weekly']) { const t = by(id); assert.ok(t.frvp && t.frvp().from <= Date.now(), id + ': range profile starts in the past'); assert.ok(!t.ind.some(([x]) => x === 'vpvr'), id + ': no visible-range profile'); assert.ok(/HVN/.test(t.desc), id + ': desc mentions HVN / LVN'); }
const dt = by('vp-daily').ind.find(([x]) => x === 'stk_of_tpo')[1]; assert.ok(dt.singles === true && dt.devPoc === true, 'daily: single prints + developing POC on');
console.log('chart-tpl-data: ok (' + TEMPLATES.length + ' templates)');
