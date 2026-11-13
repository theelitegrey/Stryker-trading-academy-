// Indicator versions (assets/indicator-versions.js): manifest rules, version maths, the descriptor wrapper and migrations.
//   node tools/tests/indicator-versions.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as IV from '../../assets/indicator-versions.js?v=972';   // same URL the chart modules use = same module instance (setManifest reaches them)

let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const { VERSIONS } = IV;

// ---- the shipped manifest
// BASE IS FOREVER: an instance on base stores no version, so changing base would silently move every old chart.
// When you add an indicator to the manifest, add its base here too; never edit an existing line.
const BASES = { 'b:stk_l2f_fp': '1.1', 'b:stk_l2f_sw': '1.1', 'b:stk_l2f_dp': '1.1', 'b:stk_of_big': '1.1', 'b:stk_ts_big': '1.1', 'b:stk_l2f_big': '1.1',
  'b:stk_fpat': '1.0', 'b:stk_fpat_l2': '1.0', 'b:stk_bk_walls': '1.1', 'b:stk_footprint': '1.3', 'p:frvp': '1.3', 'b:stk_svp': '1.1', 'b:stk_gex': '1.1', 'x:htf-po3-lens-stryker': '1.1',
  'x:liquidity-master-tradezoro': '1.1', 'x:session-sweep-smt-ifvg': '1.1' };
for (const [k, e] of Object.entries(VERSIONS)) {
  assert.ok(k in BASES, k + ': add its base to BASES in this test');
  assert.equal(e.base, BASES[k], k + ': base changed (never change a shipped base)');
  assert.ok(e.versions.length >= 1 && e.versions[0].v === '1.0', k + ': history starts at v1.0');
  for (let i = 0; i < e.versions.length; i++) {
    const x = e.versions[i];
    assert.match(x.v, /^\d+\.\d+$/, k + ' version format');
    assert.match(x.date, /^\d{4}-\d{2}-\d{2}$/, k + ' ' + x.v + ' date');
    assert.ok(Array.isArray(x.notes) && x.notes.length, k + ' ' + x.v + ' notes');
    if (i) { assert.equal(IV.cmp(e.versions[i - 1].v, x.v), -1, k + ': versions in order'); assert.ok(e.versions[i - 1].date <= x.date, k + ': dates in order'); }
    const t = x.notes.join(' ');
    assert.ok(!/tradingview|luxalgo|\bvela\b|rithmic|insightsentry|databento|bookmap|\bcme\b|finra|profit|win rate|guarantee|real-time/i.test(t), k + ' ' + x.v + ': copy rules: ' + t);
    assert.ok(x.migrate === undefined || typeof x.migrate === 'function', k + ' migrate is a function');
  }
  assert.ok(e.versions.some((x) => x.v === e.base), k + ': base is one of its versions');
  assert.ok(!k.startsWith('x:') || IV.pickable(k).length === 0, k + ': Pine scripts are changelog-only until their old source is kept');
}
ok('manifest: ' + Object.keys(VERSIONS).length + ' entries, bases frozen, dates/order/copy rules');
assert.deepEqual(Object.keys(VERSIONS).filter((k) => IV.pinnable(k)), ['b:stk_l2f_fp']);
ok('only Footprint (L2) has a selectable old version today');
const first = JSON.parse(fs.readFileSync(new URL('../indicator-pages/first-release.json', import.meta.url), 'utf8'));
for (const k of Object.keys(VERSIONS)) if (first[k]) assert.ok(first[k] <= VERSIONS[k].versions[VERSIONS[k].versions.length - 1].date, k + ': first release not after the latest version');
ok('first-release.json agrees with the manifest');

// ---- maths
assert.equal(IV.cmp('1.10', '1.9'), 1); assert.equal(IV.cmp('1.1', '1.1.0'), 0); assert.equal(IV.cmp('2.0', '10.0'), -1);
ok('cmp');
assert.equal(IV.verOf('b:stk_l2f_fp', {}), '1.1');
assert.equal(IV.verOf('b:stk_l2f_fp', { ver: '1.0' }), '1.0');
assert.equal(IV.verOf('b:stk_l2f_fp', { ver: '9.4' }), '1.1');            // a chart saved by a newer page: newest known not above it
assert.equal(IV.verOf('b:stk_l2f_fp', { ver: '0.5' }), '1.0');
assert.equal(IV.verOf('b:stk_fpat', {}), null);                           // not pinnable
ok('verOf: missing = base, unknown clamped');
assert.equal(IV.below({ ver: '1.0' }, '1.1'), true); assert.equal(IV.below({ ver: '1.1' }, '1.1'), false); assert.equal(IV.below({}, '1.1'), false);
ok('below');
const w = IV.since('b:stk_l2f_fp', '1.1');
assert.ok(w.anyOf.includes('1.1') && !w.anyOf.includes('1.0') && w.anyOf.includes(undefined));
ok('since');

// ---- descriptor wrapper
const schemaArr = [{ key: 'a', type: 'int', defval: 1 }, { key: 'b', type: 'string', defval: 'x', options: ['x', 'y'] }];
const desc = { type: 'stk_l2f_fp', inputsSchema: () => schemaArr, defaultInputs: () => ({ a: 1, b: 'x' }), create: () => ({}) };
const d2 = IV.withVersion(desc);
const s1 = d2.inputsSchema(), s2 = d2.inputsSchema();
assert.equal(s1, s2, 'schema is memoised (same array each call)');
assert.equal(s1[0].key, 'ver'); assert.equal(s1[0].defval, '1.1'); assert.deepEqual(s1[0].options, ['1.0', '1.1']);
assert.equal(s1.length, 3); assert.equal(schemaArr.length, 2, 'original schema untouched');
assert.deepEqual(d2.defaultInputs(), { a: 1, b: 'x', ver: '1.1' });
assert.match(s1[0].display.options['1.1'], /^v1\.1 · 11 Nov 2026 \(latest\)$/);
assert.equal(IV.withVersion({ type: 'stk_fpat', inputsSchema: () => [] }).inputsSchema().length, 0, 'not pinnable: unchanged');
ok('withVersion: Version first, default = base, new adds = latest, memoised');

// ---- "a new version ships": test manifest with a v1.2 that renames a setting
const TEST = { 'b:stk_l2f_fp': { base: '1.1', versions: [
  { v: '1.0', date: '2026-11-03', notes: ['First.'] },
  { v: '1.1', date: '2026-11-11', notes: ['Near.'] },
  { v: '1.2', date: '2026-11-12', all: true, notes: ['A fix for everyone.'] },
  { v: '1.3', date: '2026-11-20', notes: ['Renamed rows.'], migrate: (i) => (i.restRows != null ? { nearRows: i.restRows } : {}) }] } };
IV.setManifest(TEST);
try {
  assert.equal(IV.latest('b:stk_l2f_fp'), '1.3'); assert.equal(IV.current('b:stk_l2f_fp'), '1.3');
  assert.deepEqual(IV.pickable('b:stk_l2f_fp').map((x) => x.v), ['1.0', '1.1', '1.3']);
  assert.equal(IV.verOf('b:stk_l2f_fp', {}), '1.1', 'old saved chart (no ver) stays on base after a new version ships');
  assert.equal(IV.verOf('b:stk_l2f_fp', { ver: '1.0' }), '1.0', 'pinned 1.0 stays 1.0');
  assert.deepEqual(IV.newer('b:stk_l2f_fp', '1.1').map((x) => x.v), ['1.2', '1.3']);
  const p = IV.upgradePatch('b:stk_l2f_fp', { restRows: 5, restShow: 'Off' }, '1.3');
  assert.deepEqual(p, { nearRows: 5, ver: '1.3' }, 'Update keeps settings, maps the renamed one');
  assert.deepEqual(IV.upgradePatch('b:stk_l2f_fp', { ver: '1.0' }, '1.3'), { ver: '1.3' }, 'nothing to map');
  const d3 = IV.withVersion(desc);
  assert.deepEqual(d3.defaultInputs().ver, '1.3', 'new adds start on the new latest');
  assert.equal(d3.inputsSchema()[0].defval, '1.1', 'default stays base');
  ok('test manifest: pinned stays, Update maps renamed settings, new adds = latest');
} finally { IV.setManifest(null); }
assert.equal(IV.latest('b:stk_l2f_fp'), '1.1');
ok('setManifest(null) restores the shipped manifest');

// ---- chart side status (assets/chart-ind-versions.js statusOf), with a test manifest
const CIV = await import('../../assets/chart-ind-versions.js').catch((e) => ({ err: e }));
if (CIV.err) throw CIV.err;
IV.setManifest(TEST);
try {
  assert.equal(CIV.statusOf('stk_l2f_fp', {}, {}).to, '1.3');
  assert.equal(CIV.statusOf('stk_l2f_fp', { ver: '1.3' }, {}), null, 'latest: no button');
  assert.equal(CIV.statusOf('stk_l2f_fp', {}, { 'b:stk_l2f_fp': '1.3' }), null, 'Not now hides it');
  assert.equal(CIV.statusOf('stk_l2f_fp', {}, { 'b:stk_l2f_fp': '1.1' }).to, '1.3', '...until the next version');
  assert.equal(CIV.statusOf('stk_fpat', {}, {}), null);
  ok('statusOf: button only below latest and not dismissed for that version');
} finally { IV.setManifest(null); }
assert.equal(CIV.statusOf('stk_l2f_fp', {}, {}), null, 'shipped manifest: nobody sees an update button today');
ok('shipped manifest: no update button for anyone today');
console.log(n + ' passed');
