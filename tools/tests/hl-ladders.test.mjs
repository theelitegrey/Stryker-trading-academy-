// Unit tests: assets/hl-ladders-core.js (ladder maths) over the real clusters fixture (Worker answer, 2026-11-07).
//   node tools/tests/hl-ladders.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.window = globalThis.window || {};
const W = await import('../../assets/chart-wallet-intel.js');
const C = await import('../../assets/hl-ladders-core.js');
const raw = JSON.parse(fs.readFileSync(new URL('../fixtures/hl-intel/hl-clusters-BTC.json', import.meta.url)));
const cl = W.normClusters(raw);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };
const sum = (a) => a.reduce((s, x) => s + x.ntl, 0);

const lv = C.splitLevels(cl);
const liqTot = sum(cl.liq), stopTot = sum(cl.stops);
ok(Math.abs(sum(lv.filter((l) => l.ladder === 'liq')) - liqTot) < 1, 'liquidation ladder total = sum of server liq buckets');
ok(Math.abs(sum(lv.filter((l) => l.ladder !== 'liq')) - stopTot) < 1, 'SL + TP totals = all trigger orders (nothing lost, nothing double counted)');
// fixture: sell triggers below the price are stop losses
const sl = lv.filter((l) => l.ladder === 'sl');
ok(sl.length > 0 && sl.every((l) => l.side < 0 && l.lo + cl.step <= cl.mid + 1e-9), 'sell triggers below the price land in Stop losses');
// synthetic: server names + geometry for the unlisted rest
const syn = { mid: 100, step: 1, liq: [], stops: [
  { kind: 'stop', side: -1, lo: 90, hi: 91, ntl: 100, n: 4, wallets: [{ kind: 'Take profit', ntl: 30, side: -1 }, { kind: 'Stop loss', ntl: 20, side: -1 }] },
  { kind: 'stop', side: -1, lo: 110, hi: 111, ntl: 50, n: 1, wallets: [] },
  { kind: 'stop', side: 1, lo: 120, hi: 121, ntl: 10, n: 1, wallets: [] },
  { kind: 'stop', side: 1, lo: 80, hi: 81, ntl: 10, n: 1, wallets: [] }] };
const sv = C.splitLevels(syn), by = (k, lo) => sv.find((l) => l.ladder === k && l.lo === lo);
ok(by('tp', 90).ntl === 30 && by('sl', 90).ntl === 70 && by('sl', 90).n === 3 && by('tp', 90).n === 1, 'band split: named TP kept, the unlisted rest placed by geometry (sell below price = SL)');
ok(by('tp', 110).ntl === 50 && by('sl', 120).ntl === 10 && by('tp', 80).ntl === 10, 'sell above = TP; buy above = SL; buy below = TP');
// rebucket
const r1 = C.rebucket(lv, 'liq', cl.step), r5 = C.rebucket(lv, 'liq', cl.step * 5);
ok(Math.abs(sum(r1) - liqTot) < 1 && Math.abs(sum(r5) - liqTot) < 1, 'regrouping keeps the total');
ok(r5.length <= r1.length && r5.every((r) => Math.abs(r.hi - r.lo - cl.step * 5) < 1e-6 && Math.abs(r.lo / (cl.step * 5) - Math.round(r.lo / (cl.step * 5))) < 1e-6), 'rows are aligned multiples of the row size');
ok(r5.every((r, i) => i === 0 || r5[i - 1].lo > r.lo), 'rows sorted high price first');
ok(r5.every((r) => Math.abs(r.long + r.short - r.ntl) < 1e-6), 'liquidation rows split long / short');
// size picker
ok(C.pickSize(200, 70000, 80000, 40) === 400 && C.pickSize(200, 75000, 75400, 40) === 200, 'auto size: wide range -> bigger rows; narrow -> server step');
ok(C.pickSize(200, 0, 1e9, 10) === 200 * 500 && C.pickSize(200, 75000, 76000, 40, 5) === 1000 && C.pickSize(200, 0, 1, 10, 1) === 200, 'picker clamps to the largest multiple; manual multiplier wins');
ok(C.pickSize(200, 70000, 80000, 40, 7) === C.pickSize(200, 70000, 80000, 40), 'unknown manual multiplier falls back to auto');
ok(C.pickSize(0, 1, 2, 10) === 0, 'no step -> no size');
// stats
const rows = C.rebucket(lv, 'liq', cl.step * 5), st = C.columnStats(rows, cl.mid * 0.9, cl.mid * 1.1);
ok(Math.abs(st.total - liqTot) < 1 && st.inView <= st.total + 1e-6 && st.big.size <= 3, 'column stats: total, in view, at most 3 highlighted');
ok(C.pctOf(25, 100) === 25 && C.pctOf(1, 0) === 0 && C.fmtPct(0.2) === '<1%' && C.fmtPct(12.4) === '12%' && C.fmtPct(3.04) === '3%' && C.fmtPct(0) === '0%', 'percent format');
ok(C.strength(100, 100) === 1 && C.strength(25, 100) === 0.5 && C.strength(0, 100) === 0, 'strength = sqrt(size / biggest)');
const rc = C.rowCluster(rows[0]);
ok(rc.kind === 'liq' && rc.ntl === rows[0].ntl && rc.lo === rows[0].lo && /Liquidations/.test(rc.title), 'row -> wallet-list cluster');
console.log(n + ' passed');
