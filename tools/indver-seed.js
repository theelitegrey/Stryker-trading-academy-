#!/usr/bin/env node
// Seed assets/indicator-versions.js: every Indicators-window key in tools/indicator-pages/first-release.json that has no
// manifest entry gets { base: '1.0', versions: [{ v: '1.0', date: <first release>, notes: [...] }] }, one line each, so
// every indicator has a version. Idempotent (existing entries are never touched). Owner order 15 Nov 2026.
//   node tools/indver-seed.js            write
//   node tools/indver-seed.js --check    exit 1 if a key is missing (tools/tests/indicator-versions.test.mjs runs the same rule)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const MAN = path.join(ROOT, 'assets/indicator-versions.js');
const FIRST = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/indicator-pages/first-release.json'), 'utf8'));
// third-party built-in Pine scripts (chart-pine-builtins.js section 'community'): the page says "Added to ZoroCharts."
const builtins = fs.readFileSync(path.join(ROOT, 'assets/chart-pine-builtins.js'), 'utf8');
const third = new Set([...builtins.matchAll(/\{ id: '([^']+)'[^\n]*?section: '(\w+)'/g)].filter((m) => m[2] !== 'picks').map((m) => 'x:' + m[1]));

const src = fs.readFileSync(MAN, 'utf8');
const m = src.match(/export const VERSIONS = (\{[\s\S]*?\n\});/);
if (!m) throw new Error('VERSIONS block not found');
const have = vm.runInNewContext('(' + m[1] + ')');
const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const missing = Object.keys(FIRST).filter((k) => !k.startsWith('_') && !(k in have)).sort();
if (process.argv.includes('--check')) { if (missing.length) { console.error('not in the manifest: ' + missing.join(', ')); process.exit(1); } console.log('every indicator has a version'); process.exit(0); }
if (!missing.length) { console.log('nothing to seed'); process.exit(0); }
const lines = missing.map((k) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(FIRST[k])) throw new Error(k + ': bad first-release date');
  return '  ' + q(k) + ": { base: '1.0', versions: [{ v: '1.0', date: " + q(FIRST[k]) + ', notes: [' + q(third.has(k) ? 'Added to ZoroCharts.' : 'First release.') + '] }] },';
});
const HEAD = '  // ---- every other indicator: v1.0 on its first release (tools/indver-seed.js)\n';
const block = m[1].replace(/\n\}$/, ',\n' + (m[1].includes(HEAD) ? '' : HEAD) + lines.join('\n').replace(/,$/, '') + '\n}');
const out = src.replace(m[1], block);
vm.runInNewContext('(' + out.match(/export const VERSIONS = (\{[\s\S]*?\n\});/)[1] + ')');   // still valid
fs.writeFileSync(MAN, out);
console.log('seeded ' + missing.length + ' entries');
