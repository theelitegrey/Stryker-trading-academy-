// GEX replay unit tests: no-lookahead lookup + history-snapshot -> chart levels (pure functions).
//   node tools/tests/gex-replay.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {} };
// a minimal canvas stand-in (build() only needs ImageData + putImageData)
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) }), addEventListener() {}, visibilityState: 'visible' };
await import('../../assets/gex-heat-core.js');
const L = await import('../../assets/chart-gex-levels.js');
const Hm = await import('../../assets/chart-gex-heatmap.js');
const H = globalThis.StrykerGexHeat;
const BASE = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'gex', 'hist-base-20261014.json')));
let fail = 0, n = 0;
const check = (ok, msg) => { n++; if (!ok) { fail++; console.log('FAIL ' + msg); } else console.log('PASS ' + msg); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// a session: 10 snapshots 2 min apart
const t0 = 1792000000;
const rows = Array.from({ length: 10 }, (_, i) => Object.assign({}, BASE['SPX:0'], { t: t0 + i * 120, s: BASE['SPX:0'].s + i, k: BASE['SPX:0'].k, g: BASE['SPX:0'].g }));

// ---- no-lookahead lookup (page core, chart levels, chart heatmap) ----
for (const [name, at] of [['core at', (r, t, m) => H.at(r, t, m)], ['levels snapAt', (r, t, m) => L.snapAt(r, t, m)]]) {
  check(at(rows, t0 - 1) === null, name + ': before the history begins -> null');
  check(at(rows, t0) === rows[0], name + ': exactly at a snapshot -> that snapshot');
  check(at(rows, t0 + 119) === rows[0], name + ': 1 s before the next -> still the previous (no lookahead)');
  check(at(rows, t0 + 120) === rows[1], name + ': at the next chain time -> the next');
  check(at(rows, t0 + 99999) === rows[9], name + ': after the end -> the last');
  check(at(rows, t0 + 99999, 3600) === null, name + ': older than maxAge -> null');
  check(at([], t0) === null, name + ': empty -> null');
}
const T = globalThis.__stkGexHeat || null;
check(Hm.upTo(rows, t0 + 300).length === 3 && Hm.upTo(rows, t0 + 300).every((r) => r.t <= t0 + 300), 'heatmap upTo: only rows at or before the clock');
check(Hm.upTo(rows, null) === rows, 'heatmap upTo(null): all rows (live)');
check(Hm.upTo(rows, t0 - 1).length === 0, 'heatmap upTo before the start: nothing');

// ---- heat image never paints after `until` ----
const heat = H.build(rows, { x0: t0, x1: t0 + 20 * 120, until: t0 + 3 * 120 });
check(heat && H.cellAt(heat, t0 + 2 * 120 + 5, rows[0].k[5]) !== null, 'build(until): cell before the clock exists');
check(heat && [4, 5, 8, 12].every((i) => { const c = H.cellAt(heat, t0 + i * 120 + 5, rows[0].k[5]); return c === null || c.snap.t <= t0 + 3 * 120; }), 'build(until): a cell after the clock never reads a later snapshot');

// ---- snapshot -> levels (SPX own, ES ratio 1, NQ ratio + basis from the chart close) ----
const snap = Object.assign({}, BASE['SPX:0']);
let d = L.snapData(snap, { api: 'SPX', fut: null }, null, null);
let lv = L.buildLevels(d, { api: 'SPX', fut: null }, { showVah: false, showPoc: false, showVal: false, showOnh: false, showOnl: false }, null);
const by = (id) => (lv.lines.find((l) => l.id === id) || {}).price;
check(by('call') === snap.cw && by('put') === snap.pw && near(by('zero'), snap.zg, 0.006), 'SPX replay levels = snapshot walls + zero gamma');
check(near(by('ivhi'), snap.em[0] + snap.em[1], 0.006) && near(by('ivlo'), snap.em[0] - snap.em[1], 0.006), 'SPX replay IV ±68% = snapshot expected range');
const esClose = snap.s + 50.25;
d = L.snapData(snap, { api: 'SPX', fut: 'ES' }, 1, esClose);
lv = L.buildLevels(d, { api: 'SPX', fut: 'ES' }, {}, null);
check(near(lv.lines.find((l) => l.id === 'call').price, snap.cw + 50.25, 0.006), 'ES replay: call wall = SPX + (chart close - spot)');
check(lv.noSession === true && !lv.lines.some((l) => ['vah', 'poc', 'onh'].includes(l.id)), 'ES replay: market levels left out (not recorded)');
const q = BASE['QQQ:0'], k = 41.1521, nqClose = 30100;
d = L.snapData(q, { api: 'QQQ', fut: 'NQ' }, k, nqClose);
lv = L.buildLevels(d, { api: 'QQQ', fut: 'NQ' }, {}, null);
const basis = nqClose - k * q.s;
check(near(lv.lines.find((l) => l.id === 'put').price, Math.round((q.pw * k + basis) * 100) / 100, 0.006), 'NQ replay: put wall = QQQ x ratio + basis (spot maps to the chart close)');
check(L.snapData(q, { api: 'QQQ', fut: 'NQ' }, k, null) === null, 'NQ replay without a bar at the snapshot time -> null (nothing drawn)');

// ---- heatmap per-snapshot re-anchor ----
const bars = [{ time: (t0 - 60) * 1000, close: 7700 }, { time: (t0 + 60) * 1000, close: 7710 }, { time: (t0 + 180) * 1000, close: 7720 }];
check(Hm.closeAt(bars, t0, 300) === 7700 && Hm.closeAt(bars, t0 + 120, 300) === 7710, 'closeAt: the bar open at or before the chain time');
check(Hm.closeAt(bars, t0 - 600, 300) === null, 'closeAt before the bars -> null');
const cv = Hm.conversions(rows.slice(0, 3), { api: 'SPX', fut: 'ES' }, 1, bars, 60);
check(cv.every((c, i) => c && c.mul === 1 && near(c.mul * rows[i].s + c.add, Hm.closeAt(bars, rows[i].t, 300))), 'conversions: each snapshot spot maps onto the chart close');
check(Hm.futRatio({ api: 'SPX', fut: 'ES' }) === 1 && Hm.futRatio({ api: 'QQQ', fut: 'NQ' }, { futures: { NQ: { ratio: k } } }) === k && Hm.futRatio({ api: 'QQQ', fut: null }) === null, 'futRatio: ES 1, NQ from the API, index none');

console.log(n + ' checks, ' + (fail ? fail + ' FAILED' : 'ALL PASS'));
process.exit(fail ? 1 : 0);
