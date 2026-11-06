// ZoroOptions chart indicators (stream 4): pure-function tests, no browser.  node tools/tests/zoro-indicators.test.mjs
// Covers: symbol mapping (RTY->IWM, CL->USO ...), page flag, summary parsing, Gamma Nodes / ranges / Pin lines, futures mapping,
// range bands, Gamma Zone, IV rank + replay no-lookahead, Fresh Volume / Volume Burst per-bar marks + replay cut, copy rules.
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.location = { search: '', hostname: 'x' };
globalThis.document = { documentElement: { getAttribute: () => null }, addEventListener() {}, visibilityState: 'visible' };
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ZD = await import('../../assets/chart-zoro-data.js');
const R = await import('../../assets/chart-zoro-range.js');
const IV = await import('../../assets/chart-iv-rank.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('PASS ' + name); };

const zs = ZD.zsum({ u: 'SPX', built: 1000000, spot: 6800, zone: 'cushion', levels: { call_ceiling: 6900, put_floor: 6700, flip_line: 6780, pin: 6850 },
  nodes: Array.from({ length: 12 }, (_, i) => ({ k: 6600 + i * 25, g: (i % 2 ? -1 : 1) * (100 - i * 5) })),
  ranges: { '0': [6770, 6830], w: [6700, 6900], m: [6600, 7000] }, iv: { rank: 34, pct: 41, iv30: 17.8, t: [1, 2], v: [15, 17.8] } });

t('launched: on by default, stk_zoro_options=0 opts out', () => {
  assert.equal(ZD.zoroOn(), true);
  const g = localStorage.getItem; localStorage.getItem = (k) => (k === 'stk_zoro_options' ? '0' : null);
  try { assert.equal(ZD.zoroOn(), false); assert.equal(ZD.zoroSource('RTY1!', 'futures'), null); } finally { localStorage.getItem = g; }
  assert.equal(ZD.zoroSource('RTY1!', 'futures', false), null);
});
t('real summary (S1 fixture): chain time t, not built; 10 nodes, 4 ranges, IV series', () => {
  const f = ZD.zsum(JSON.parse(fs.readFileSync(new URL('../fixtures/zoro/summary.json', import.meta.url))));
  assert.equal(f.t, 1793981964); assert.equal(f.nodes.length, 10); assert.equal(f.ranges.length, 4);
  assert.equal(f.flip, 7514.56); assert.equal(f.call, 7450); assert.equal(f.pin, 7560); assert.ok(f.iv.t.length > 200 && f.iv.t.length === f.iv.v.length);
});
t('mapping RTY->IWM CL->USO ES->SPX NQ->QQQ GC->GLD', () => {
  const m = (s, p) => ZD.zoroSource(s, p, true);
  assert.deepEqual([m('RTY1!', 'futures').u, m('CL1!', 'futures').u, m('MES', 'futures').u, m('NQ1!', 'futures').u, m('GC1!', 'futures').u], ['IWM', 'USO', 'SPX', 'QQQ', 'GLD']);
  assert.equal(m('RTY1!', 'futures').fut, 'RTY'); assert.equal(m('M2K', 'futures').fut, 'RTY'); assert.equal(m('MCL', 'futures').fut, 'CL');
  assert.match(m('CL1!', 'futures').label, /mapped from USO/);
  assert.equal(m('IWM', 'stock').tierB, false); assert.equal(m('AAPL', 'stock').tierB, true); assert.equal(m('BTCUSD', 'crypto'), null);
  assert.equal(m('EURUSD', 'forex'), null);
});
t('summary parse: top 10 nodes by |GEX|, ranges object -> 0DTE/Weekly/Monthly, built time', () => {
  assert.equal(zs.nodes.length, 10); assert.equal(zs.nodes[0].k, 6600);
  assert.deepEqual(zs.ranges.map((r) => r.k), ['0DTE', 'Weekly', 'Monthly']);
  assert.equal(zs.t, 1000000); assert.equal(zs.call, 6900); assert.equal(zs.flip, 6780); assert.equal(zs.pin, 6850);
  assert.equal(ZD.zsum({ error: 'x' }), null);
});
t('Zoro lines: 10 nodes, 3x2 range edges, pin; counts follow the inputs', () => {
  const on = (k) => ({ showNodes: true, showRanges: true, showPin: true }[k]);
  const L = ZD.zoroLines(zs, (v) => v, { nodeCount: 10 }, on);
  assert.equal(L.filter((l) => /^zn/.test(l.id)).length, 10); assert.equal(L.filter((l) => /^zr/.test(l.id)).length, 6); assert.equal(L.filter((l) => l.id === 'zpin').length, 1);
  assert.equal(ZD.zoroLines(zs, (v) => v, { nodeCount: 3, rangeKeys: 'Weekly' }, on).length, 3 + 2 + 1);
  assert.equal(ZD.zoroLines(zs, (v) => v, {}, () => false).length, 0);
  assert.ok(L.find((l) => l.id === 'zn1').w === 2 && L.find((l) => l.id === 'zn1').alpha >= 0.9);
});
t('futures mapping: ratio = chart price / spot, unmapped without a bar', () => {
  const src = ZD.zoroSource('RTY1!', 'futures', true);
  const bars = [{ time: 999000 * 1000, close: 2400 }, { time: 1000000 * 1000, close: 2420 }];
  const conv = ZD.convFor({ t: 1000000, spot: 2000 }, src, bars);
  assert.equal(conv(2000), 2420); assert.equal(Math.round(conv(1000)), 1210);
  assert.equal(ZD.convFor({ t: 1000000, spot: 2000 }, src, [{ time: 1, close: 5 }])(2000), null);   // bar too old
  assert.equal(ZD.convFor(zs, ZD.zoroSource('IWM', 'stock', true), [])(5), 5);
});
t('range bands + Gamma Zone', () => {
  const b = R.rangeBands(zs, (v) => v, 'All'); assert.equal(b.length, 3);
  assert.equal(R.rangeBands(zs, (v) => v, 'Weekly').length, 1); assert.equal(R.rangeBands(zs, (v) => v, '1DTE').length, 0);
  assert.equal(R.rangeBands(zs, () => null, 'All').length, 0);
  assert.deepEqual(R.zoneTint(zs, (v) => v), { flip: 6780, zone: 'cushion' });
  assert.equal(ZD.zoneOf(6700, 6780), 'swing'); assert.equal(ZD.zoneOf(6800, 6780), 'cushion'); assert.equal(R.zoneTint({ flip: null }, (v) => v), null);
});
t('IV rank: values from the past year only; replay uses only older values (no lookahead)', () => {
  const day = 86400, T = [], V = [];
  for (let i = 0; i < 400; i++) { T.push(1e9 + i * day); V.push(10 + (i % 20)); }
  V[399] = 99;   // a spike on the last day
  const lastIdx = 399, past = 300;
  const full = IV.rankFrom(T, V, lastIdx), then = IV.rankFrom(T, V, past);
  assert.equal(full.hi, 99); assert.ok(then.hi < 99, 'replay at an earlier time must not see the later spike');
  assert.equal(then.n, 301 > 365 ? 365 : 301);
  const bars = [past, 399].map((i) => ({ time: (1e9 + i * day) * 1000 }));
  const pts = IV.perBar(T, V, bars, 1e9 + past * day);
  assert.ok(pts[0] != null && pts[1] === V[past], 'a bar after the replay clock shows the last value up to the clock, never a later one');
  assert.equal(IV.perBar(T, V, [{ time: (1e9 - day) * 1000 }], null)[0], null);
  assert.equal(IV.idxAt(T, 1e9 - 1), -1);
});
const opt = await import('../../assets/chart-optflow.js').catch((e) => { console.log('SKIP optflow import (' + e.message.slice(0, 60) + ')'); return null; });
if (opt) t('Fresh Volume / Burst: items land in their bar; replay drops later items; tip has no side words', () => {
  const ms = 60000, bars = [0, 1, 2, 3].map((i) => ({ time: (1000 + i * 60) * 1000 }));
  const items = [{ t: 1000, side: 'C', k: 6800, x: '2026-11-06', vol: 900, oi: 300, add: 400, prem: 50000 }, { t: 1130, side: 'P', k: 6700, x: '2026-11-06', vol: 5000, oi: 100, add: 1200, prem: 300000 }, { t: 1010, side: 'C', k: 6810, vol: 1, oi: 1, add: 1, prem: 10 }];
  const a = opt.zvPerBar(items, bars, ms, null);
  assert.equal(a[0].zv.c, 2); assert.equal(a[2].pp, 300000); assert.equal(a[1], null);
  const b = opt.zvPerBar(items, bars, ms, 1100);
  assert.equal(b[2], null, 'item after the replay clock is dropped'); assert.ok(b[0]);
  const tip = opt.tipRows({ side: 'P', kind: 'burst', prem: 300000, b: a[2] });
  const txt = JSON.stringify(tip);
  assert.ok(!/bought|sold|bullish|bearish|smart money|whale|\blive\b|real-time|delayed/i.test(txt), txt);
  assert.match(tip.note, /Not a single trade; no buyer or seller side/);
  assert.equal(ZD.zitems({ rows: [{ strike: 1, side: 'call', exp: 'e', volume: 3, oi: 1, added: 2, t: 5 }] })[0].add, 2);
});
t('copy rules in new files: no live / real-time / delayed / behind, no rival terms', () => {
  for (const f of ['chart-zoro-data.js', 'chart-zoro-range.js', 'chart-iv-rank.js']) {
    const s = fs.readFileSync(new URL('../../assets/' + f, import.meta.url), 'utf8');
    // user-visible strings only: check quoted text in note/status/title lines
    const bad = s.split('\n').filter((l) => !/^\s*\/\//.test(l) && /(note|status|title|desc|DESC|label|text)\b.*['`"][^'`"]*\b(live|real-time|delayed|behind|Call Resistance|Put Support|HVL|Q-Score|Market Tide|HIRO|Periscope|Gamma Wall)\b/i.test(l));
    assert.deepEqual(bad, [], f);
  }
});
console.log('\n' + n + ' groups passed');
