// Order flow pro maths (assets/chart-of-pro-data.js) on REAL recorded NQ order flow
// (book-recorder /orderflow, 2026-10-20 + 2026-10-21, gzipped in fixtures/orderflow/).
//   node tools/tests/chart-of-pro.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
globalThis.window = globalThis.window || {};
const D = await import('../../assets/chart-footprint-data.js');
const P = await import('../../assets/chart-of-pro-data.js');
let n = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? '' : ' ' + JSON.stringify(x))); n++; console.log('PASS ' + m); };
const load = (day) => D.decodeOrderflow(new Uint8Array(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/orderflow/NQ-' + day + '.bin.gz', import.meta.url)))));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const A = load('2026-10-20'), B = load('2026-10-21');
const MA = A.bars, MB = B.bars;
ok(MA.length > 1000 && MB.length > 1000 && B.header.tick === 0.25 && B.header.thr > 0, 'fixtures: two recorded NQ days, tick 0.25, big-trade threshold ' + B.header.thr);

// ---- 1. Big Trades
const raw = P.bigPrints(MB, { cluster: false });
ok(raw.length === sum(MB.map((b) => b.bigs.length)) && raw.every((p, i) => i === 0 || p.ms >= raw[i - 1].ms), 'big: ' + raw.length + ' recorded big prints, time-sorted');
ok(raw.every((p) => p.size >= B.header.thr), 'big: every recorded print >= the recorder threshold ' + B.header.thr);
const cl = P.bigPrints(MB);
ok(sum(cl.map((p) => p.size)) === sum(raw.map((p) => p.size)) && sum(cl.map((p) => p.n)) === raw.length, 'big: clustering keeps every contract (' + sum(raw.map((p) => p.size)) + ') and every print');
ok(cl.length < raw.length && cl.some((p) => p.n > 1), 'big: ' + (raw.length - cl.length) + ' split fills merged into clusters');
// a synthetic split order: same side, 1 tick, inside 1 s -> one cluster; the other side stays apart
const syn = P.bigPrints([{ bigs: [[1000, 400, 30, 1], [1300, 401, 40, 1], [1400, 401, 50, 0], [2600, 401, 25, 1]] }]);
ok(syn.length === 3 && syn[0].size === 70 && syn[0].n === 2 && syn[0].pi === 401 && syn[1].side === 0 && syn[2].size === 25, 'big: synthetic split order merges; opposite side and >1 s gap do not', syn);
ok(P.bigThreshold(20, 2, 0) === 40 && P.bigThreshold(20, 1, 60) === 60 && P.bigThreshold(0, 1, 0) === 1, 'big: threshold = auto x multiplier, floored by min size');
const thr2 = P.bigThreshold(B.header.thr, 2, 0);
ok(cl.filter((p) => p.size >= thr2).length < cl.length, 'big: 2x threshold keeps ' + cl.filter((p) => p.size >= thr2).length + ' of ' + cl.length);

// ---- 2. Absorption
for (const [name, M] of [['20 Oct', MA], ['21 Oct', MB]]) {
  const ev = P.absorptionEvents(M);
  ok(ev.length >= 3 && ev.length <= 40, name + ' absorption: ' + ev.length + ' events on ' + M.length + ' one-minute bars (rare, not every bar)');
  for (const e of ev) {
    const b = M[e.i], w = M.slice(Math.max(0, e.i - 30), e.i);
    const av = sum(w.map((x) => x.vol)) / w.length;
    assert.ok(b.vol >= 1.2 * av - 1e-9, 'volume test');
    assert.ok(Math.abs(b.delta) * 100 >= 8 * b.vol, 'delta test');
    assert.ok(e.side === 1 ? b.delta > 0 && b.c <= b.o : b.delta < 0 && b.c >= b.o, 'delta against the close');
    assert.ok(e.level >= b.lo && e.level <= b.hi, 'level inside the bar');
    const arr = e.side ? b.buy : b.sell;
    assert.equal(arr[e.level - b.lo], Math.max(...arr), 'level = the absorbed side\'s biggest row');
  }
  ok(true, name + ' absorption: each event re-checked against its bar (volume, delta, close, level)');
  const BUF = 2;   // the indicator's default: a close more than 2 ticks beyond
  const br = P.levelBreaks(ev, M, BUF);
  br.forEach((j, k) => {
    const e = ev[k], lv = e.side ? e.level + BUF : e.level - BUF;
    if (j < 0) { for (let q = e.i + 1; q < M.length; q++) assert.ok(e.side ? M[q].c <= lv : M[q].c >= lv); return; }
    assert.ok(e.side ? M[j].c > lv : M[j].c < lv, 'break bar closes through');
    for (let q = e.i + 1; q < j; q++) assert.ok(e.side ? M[q].c <= lv : M[q].c >= lv, 'no earlier close through');
  });
  const br0 = P.levelBreaks(ev, M, 0);
  assert.ok(br0.every((j, k) => (br[k] < 0 ? true : j >= 0 && j <= br[k])), 'a zero buffer breaks no later');
  ok(true, name + ' absorption: level breaks are the first close through (' + br.filter((x) => x >= 0).length + ' broken, ' + br.filter((x) => x < 0).length + ' holding)');
}
// a flat synthetic tape: no absorption
const flat = Array.from({ length: 60 }, (_, i) => ({ t: i * 60000, lo: 100, hi: 103, o: 100, c: 103, buy: [5, 5, 5, 5], sell: [5, 5, 5, 5], vol: 40, delta: 0 }));
ok(P.absorptionEvents(flat).length === 0, 'absorption: a flat tape has none');
// planted event: 3x volume, 1-tick range, heavy buying, red close
const planted = flat.slice(0, 40).concat([{ t: 40 * 60000, lo: 101, hi: 101, o: 101, c: 101, buy: [100], sell: [20], vol: 120, delta: 80 }]);
const pe = P.absorptionEvents(planted);
ok(pe.length === 1 && pe[0].side === 1 && pe[0].level === 101, 'absorption: a planted high-volume one-tick bar with buying is found (buyers absorbed at 101)', pe);

// ---- 3. Imbalance zones
const B5 = D.aggregate(MB, 300000);
const zs = P.imbalanceZones(B5, { m: 1, ratio: 3, stack: 3 });
ok(zs.length > 50, '5m 21 Oct: ' + zs.length + ' stacked-imbalance zones at 300% x3');
for (const z of zs.slice(0, 200)) {
  const rs = D.rows(B5[z.i], 1);
  const f = D.imbalances(rs, 3);
  const flags = z.side ? f.buy : f.sell;
  const k0 = rs.findIndex((r) => r.p === z.lo), k1 = rs.findIndex((r) => r.p === z.hi);
  assert.ok(k0 >= 0 && k1 - k0 + 1 === z.rows && z.rows >= 3);
  for (let k = k0; k <= k1; k++) assert.equal(flags[k], 1, 'every zone row is an imbalance');
  if (z.fill >= 0) {
    assert.ok(z.side ? B5[z.fill].lo < z.lo : B5[z.fill].hi > z.hi, 'fill bar trades through');
    for (let j = z.i + 1; j < z.fill; j++) assert.ok(z.side ? B5[j].lo >= z.lo : B5[j].hi <= z.hi, 'no earlier trade-through');
  } else for (let j = z.i + 1; j < B5.length; j++) assert.ok(z.side ? B5[j].lo >= z.lo : B5[j].hi <= z.hi, 'open zone never traded through');
}
ok(true, 'imbalance: every zone row re-checked as a diagonal imbalance; fills are the first trade-through');
const open = zs.filter((z) => z.fill < 0).length;
ok(open > 0 && open < zs.length, 'imbalance: ' + open + ' zones still open at the end of the day, the rest filled');
const z5 = P.imbalanceZones(B5, { m: 1, ratio: 5, stack: 3 }), s4 = P.imbalanceZones(B5, { m: 1, ratio: 3, stack: 4 });
ok(z5.length < zs.length && s4.length < zs.length, 'imbalance: stricter ratio (500%) or longer stack (4) finds fewer zones', [z5.length, s4.length]);

// ---- 4. swing / session profile + naked POC
const hi = B5.map((b) => b.hi), lo = B5.map((b) => b.lo);
const pv = P.swingPivots(hi, lo, 10);
ok(pv.length >= 4 && pv.every((p, i) => i === 0 || p.kind !== pv[i - 1].kind), '5m swings: ' + pv.length + ' pivots, alternating high / low');
for (const p of pv) for (let j = Math.max(0, p.i - 10); j <= Math.min(B5.length - 1, p.i + 10); j++) assert.ok(p.kind === 'hi' ? hi[j] <= hi[p.i] : lo[j] >= lo[p.i]);
ok(true, 'swings: every pivot is the extreme of its 21-bar window');
const segs = P.swingSegments(hi, lo, 10);
ok(segs[0].i0 === 0 && segs[segs.length - 1].i1 === B5.length - 1 && segs.every((s, i) => i === 0 || s.i0 === segs[i - 1].i1 + 1) && segs[segs.length - 1].open, 'swings: ' + segs.length + ' segments tile the day, the last one developing');
const prof = segs.filter((s) => !s.open).map((s) => ({ i1: s.i1, poc: P.profile(B5.slice(s.i0, s.i1 + 1), 4, 70).poc }));
const hit = P.pocRevisits(prof, B5, 4);
hit.forEach((j, k) => {
  const a = prof[k].poc * 4, z = a + 3;
  if (j < 0) for (let q = prof[k].i1 + 1; q < B5.length; q++) assert.ok(!(B5[q].lo <= z && B5[q].hi >= a));
  else { assert.ok(B5[j].lo <= z && B5[j].hi >= a); for (let q = prof[k].i1 + 1; q < j; q++) assert.ok(!(B5[q].lo <= z && B5[q].hi >= a)); }
});
ok(true, 'naked POC: ' + hit.filter((x) => x < 0).length + ' of ' + hit.length + ' swing POCs still naked; revisits are the first bar trading the POC row');
// session profile: 20 Oct POC vs the raw volume at price
const pA = P.profile(MA, 1, 70);
let best = -1, bk = 0;
const vat = new Map();
for (const b of MA) for (let j = 0; j < b.buy.length; j++) vat.set(b.lo + j, (vat.get(b.lo + j) || 0) + b.buy[j] + b.sell[j]);
vat.forEach((v, p) => { if (v > best) { best = v; bk = p; } });
ok(pA.poc === bk && pA.val <= pA.poc && pA.vah >= pA.poc, '20 Oct session POC ' + bk * 0.25 + ' matches volume at price; VA brackets it');

// ---- 5. Market Profile (TPO)
const rth = (bars) => bars.filter((b) => P.rthKey(b.t));
const R = D.aggregate(rth(MB), 300000).map((b) => ({ time: b.t, open: b.o * 0.25, high: b.hi * 0.25, low: b.lo * 0.25, close: b.c * 0.25 }));
ok(R.length === 78 && P.nyClock(R[0].time).min === 570, '21 Oct RTH: 78 five-minute bars from 09:30 New York');
const row = P.autoRow(Math.max(...R.map((b) => b.high)) - Math.min(...R.map((b) => b.low)), 0.25);
const T = P.tpoProfile(R, { row, periodMs: 1800000 });
ok(T.periods === 13, 'TPO: 6.5 h = 13 half-hour periods (A-M)', T.periods);
for (let k = 0; k < T.n; k++) {
  const pr = new Set();
  R.forEach((b) => { const p = Math.floor((b.time - R[0].time) / 1800000); const r0 = Math.floor(b.low / row + 1e-9) - T.r0, r1 = Math.floor(b.high / row + 1e-9) - T.r0; if (k >= r0 && k <= r1) pr.add(p); });
  assert.deepEqual(T.cols[k], [...pr].sort((x, y) => x - y));
}
ok(true, 'TPO: every row\'s letters re-counted from the bars');
ok(T.counts[T.poc] === Math.max(...T.counts) && T.val <= T.poc && T.vah >= T.poc, 'TPO: POC = most TPOs (' + T.counts[T.poc] + '), value area brackets it');
const vaT = sum(T.counts.slice(T.val, T.vah + 1));
ok(vaT >= 0.7 * T.total && vaT - Math.min(T.counts[T.val], T.counts[T.vah]) < 0.7 * T.total + Math.max(T.counts[T.val], T.counts[T.vah]), 'TPO: value area holds >= 70% of TPOs (' + vaT + '/' + T.total + ')');
const ib = R.filter((b) => b.time < R[0].time + 3600000);
ok(T.ibHi === Math.max(...ib.map((b) => b.high)) && T.ibLo === Math.min(...ib.map((b) => b.low)), 'TPO: IB = the first hour range ' + T.ibLo + '-' + T.ibHi);
ok(P.tpoLetter(0) === 'A' && P.tpoLetter(12) === 'M' && P.tpoLetter(26) === 'a', 'TPO letters A..Z then a..z');

// ---- 5b. TPO extras (member request 13 Nov): single prints, poor high / low, naked POC, developing
// POC / VA, initial balance + extensions. Hand-made session first (every number worked out by hand).
{
  const T0 = Date.UTC(2026, 9, 21, 13, 30), M = 60000;
  const bar = (min, low, high) => ({ time: T0 + min * M, open: low, high, low, close: high });
  // 30 min periods, row 1. A: 100-104, B: 100-102 (both 30 min), C: 104-109 (single prints 105-109
  // above A/B), D: 106-109 (fills 106-109 again, so only row 105 stays single) ... built per period:
  const S = [bar(0, 100, 104), bar(15, 101, 103), bar(30, 100, 102), bar(45, 101, 102), bar(60, 105, 108), bar(90, 106, 108), bar(120, 106, 107)];
  const p = P.tpoProfile(S, { row: 1, periodMs: 30 * M });
  // rows 100..108 (r0 100, n 9). counts: 100:A B =2, 101:A B =2, 102:A B =2, 103:A=1, 104:A=1, 105:C=1, 106:C D E=3, 107:C D E=3, 108:C D=2
  ok(p.r0 === 100 && p.n === 9 && p.counts.join() === '2,2,2,1,1,1,3,3,2', 'TPO extras: hand profile counts', p.counts);
  ok(p.poc === 6 && p.periods === 5, 'TPO extras: POC = row 106 (3 TPOs, nearest the middle of the tie 106/107)', p.poc);
  const runs = P.tpoSingleRuns(p);
  ok(runs.length === 1 && runs[0].a === 3 && runs[0].z === 5 && runs[0].lo === 103 && runs[0].hi === 106, 'TPO extras: single prints 103-105 grouped into one run 103..106', runs);
  // poor extremes on exact prices: high 108 made in C and D (2 periods) = poor high; low 100 made in A and B = poor low
  const pe = P.tpoPoorExtremes(S, { periodMs: 30 * M, tick: 0.25 });
  ok(pe.high === 108 && pe.highN === 2 && pe.low === 100 && pe.lowN === 2, 'TPO extras: poor high 108 (2 periods) and poor low 100 (2 periods)', pe);
  // E only reaches 107: change D's high to 107.5 -> high 108 in C only -> not poor
  const S2 = S.map((b, i) => (i === 5 ? Object.assign({}, b, { high: 107.5 }) : b));
  const pe2 = P.tpoPoorExtremes(S2, { periodMs: 30 * M, tick: 0.25 });
  ok(pe2.high === null && pe2.highN === 1 && pe2.low === 100, 'TPO extras: a single-period high is a clean high (not poor)', pe2);
  ok(P.tpoPoorExtremes(S, { periodMs: 30 * M, tick: 0.25, min: 3 }).high === null, 'TPO extras: min 3 periods turns the 2-period high off');
  // developing values: after bar 0 only rows 100-104 exist (1 TPO each): POC = the middle row 102 -> 102.5
  const dv = P.tpoDeveloping(S, { row: 1, periodMs: 30 * M });
  ok(dv.poc.length === S.length && dv.poc[0] === 102.5, 'TPO extras: developing POC after the first bar = 102.5', dv.poc);
  for (let i = 0; i < S.length; i++) {
    const q = P.tpoProfile(S.slice(0, i + 1), { row: 1, periodMs: 30 * M });
    assert.equal(dv.poc[i], (q.r0 + q.poc + 0.5)); assert.equal(dv.vah[i], (q.r0 + q.vah + 0.5)); assert.equal(dv.val[i], (q.r0 + q.val + 0.5));
  }
  ok(dv.poc[S.length - 1] === 106.5, 'TPO extras: developing POC/VAH/VAL after every bar = the full profile on the bars so far; ends at 106.5', dv.poc);
  // IB: first 60 min = bars at 0, 15, 30, 45 -> 100..104; 30 min -> bars 0, 15 -> 100..104 too; ibMs overrides periods
  ok(p.ibHi === 104 && p.ibLo === 100, 'TPO extras: IB (2 periods) = 100-104');
  const p30 = P.tpoProfile(S.map((b, i) => (i === 2 ? Object.assign({}, b, { low: 99 }) : b)), { row: 1, periodMs: 30 * M, ibMs: 30 * M });
  ok(p30.ibLo === 100 && p30.ibHi === 104, 'TPO extras: 30 min IB ignores the 99 low printed at minute 30', p30.ibLo);
  const ext = P.ibExtensions(104, 100, [1.5, 2, 3, 0]);
  ok(ext.length === 3 && ext[0].up === 110 && ext[0].dn === 94 && ext[1].up === 112 && ext[2].dn === 88, 'TPO extras: IB extensions 1.5x/2x/3x of a 4-point IB = 110/112/116 and 94/92/88', ext);
  // first touch after the session: a level at 105.5 (the single-print middle) is first touched by the bar whose range holds it
  const after = S.concat([bar(400, 109, 111), bar(430, 106, 110), bar(460, 104, 106)]);
  ok(P.firstTouch(after, S.length, 103, 106) === S.length + 1 && P.firstTouch(after, S.length, 106.5, 106.5) === S.length + 1 && P.firstTouch(after, S.length, 90, 95) === -1, 'TPO extras: first touch finds the filling bar, -1 while still open');
}
// The same extras on the REAL 21 Oct RTH session (5 min bars)
{
  const dv = P.tpoDeveloping(R, { row, periodMs: 1800000 });
  ok(dv.poc[R.length - 1] === (T.r0 + T.poc + 0.5) * row && dv.vah[R.length - 1] === (T.r0 + T.vah + 0.5) * row && dv.val[R.length - 1] === (T.r0 + T.val + 0.5) * row, '21 Oct: developing POC/VAH/VAL end on the session POC/VAH/VAL ' + dv.poc[R.length - 1]);
  const mid = P.tpoProfile(R.slice(0, 40), { row, periodMs: 1800000 });
  ok(dv.poc[39] === (mid.r0 + mid.poc + 0.5) * row, '21 Oct: developing POC at bar 40 = the profile of the first 40 bars ' + dv.poc[39]);
  const runs = P.tpoSingleRuns(T);
  ok(runs.reduce((x, r) => x + r.z - r.a + 1, 0) === T.singles.length && runs.every((r) => T.counts.slice(r.a, r.z + 1).every((c) => c === 1)), '21 Oct: ' + runs.length + ' single-print runs cover all ' + T.singles.length + ' single rows');
  const pe = P.tpoPoorExtremes(R, { periodMs: 1800000, tick: 0.25 });
  const hiP = new Set(R.filter((b) => b.high === T.hi).map((b) => Math.floor((b.time - R[0].time) / 1800000)));
  const loP = new Set(R.filter((b) => b.low === T.lo).map((b) => Math.floor((b.time - R[0].time) / 1800000)));
  ok(pe.highN === hiP.size && pe.lowN === loP.size && (pe.high === null) === (hiP.size < 2) && (pe.low === null) === (loP.size < 2), '21 Oct: high ' + T.hi + ' in ' + hiP.size + ' period(s), low ' + T.lo + ' in ' + loP.size + ' -> poor high ' + pe.high + ', poor low ' + pe.low);
}

// ---- 6. Effort vs Result
for (const tf of [1, 5]) {
  const bars = D.aggregate(MB, tf * 60000);
  const items = bars.map((b) => ({ vol: b.vol, range: (b.hi - b.lo + 1) * 0.25 }));
  const er = P.effortResult(items);
  const i = 40, w = items.slice(i - 20, i);
  const e = items[i].vol / (sum(w.map((x) => x.vol)) / 20), r = items[i].range / (sum(w.map((x) => x.range)) / 20);
  ok(Math.abs(er[i].e - e) < 1e-9 && Math.abs(er[i].r - r) < 1e-9, tf + 'm effort / result = volume / range vs the 20-bar average (bar 40: ' + e.toFixed(2) + ' / ' + r.toFixed(2) + ')');
  const f1 = er.filter((x) => x.flag === 1);
  ok(f1.length > 0 && f1.length < bars.length * 0.1 && f1.every((x) => x.e >= 1.5 && x.e >= 2 * x.r), tf + 'm: ' + f1.length + ' high-effort / low-result bars flagged (rule re-checked)');
  ok(er.filter((x) => x.flag === 2).every((x) => x.r >= 1.5 && x.r >= 2 * x.e), tf + 'm: low-effort / high-result flags obey the rule');
}

// ---- 7. Stop runs / sweeps (batch 2)
const vb = (bars) => bars.map((b) => ({ high: b.hi * 0.25, low: b.lo * 0.25, close: b.c * 0.25, vol: b.vol }));
for (const [name, M] of [['20 Oct', MA], ['21 Oct', MB]]) for (const tf of [1, 5]) {
  const B = vb(D.aggregate(M, tf * 60000)), L = 5, LB = 20;
  const ev = P.sweepEvents(B, { len: L, lookback: LB, volMult: 1.5 });
  ok(ev.length >= 1 && ev.length <= B.length * 0.05, name + ' ' + tf + 'm sweeps: ' + ev.length + ' on ' + B.length + ' bars (rare)');
  for (const e of ev) {
    const b = B[e.i], pv = B[e.p];
    // the swing is the extreme of its +-5 window, confirmed before the sweep bar
    assert.ok(e.p + L < e.i, 'swing confirmed before the sweep');
    for (let j = Math.max(0, e.p - L); j <= Math.min(B.length - 1, e.p + L); j++) if (j !== e.p) assert.ok(e.side ? B[j].high <= pv.high : B[j].low >= pv.low, 'pivot is the window extreme');
    assert.equal(e.level, e.side ? pv.high : pv.low);
    // poke beyond, close back inside
    assert.ok(e.side ? b.high > e.level && b.close < e.level : b.low < e.level && b.close > e.level, 'poke + close back inside');
    // volume spike vs the previous 20 bars
    const w = B.slice(Math.max(0, e.i - LB), e.i), av = sum(w.map((x) => x.vol)) / w.length;
    assert.ok(b.vol >= 1.5 * av - 1e-9 && Math.abs(e.volX - b.vol / av) < 1e-9, 'volume spike');
    // nothing traded beyond the level between the swing's confirmation and the sweep (first run only)
    for (let j = e.p + L + 1; j < e.i; j++) assert.ok(e.side ? B[j].high <= e.level : B[j].low >= e.level, 'first time beyond the level');
  }
  ok(true, name + ' ' + tf + 'm sweeps: each re-checked against the bars (swing window, poke + close back inside, ' + LB + '-bar volume spike, first run)');
}
// synthetic: a planted sweep is found; the same poke without the volume, or a close outside, is not
const base = Array.from({ length: 30 }, (_, i) => ({ high: 100 + (i === 10 ? 5 : 0), low: 95 - (i === 20 ? 5 : 0), close: 98, vol: 10 }));
const planted2 = base.concat([{ high: 106, low: 97, close: 99, vol: 40 }]);
const sw = P.sweepEvents(planted2);
ok(sw.length === 1 && sw[0].side === 1 && sw[0].level === 105 && sw[0].p === 10 && sw[0].extreme === 106, 'sweep: planted poke above the 105 swing high on 4x volume, closed back inside', sw);
ok(P.sweepEvents(base.concat([{ high: 106, low: 97, close: 99, vol: 12 }])).length === 0, 'sweep: the same poke on normal volume is not one');
ok(P.sweepEvents(base.concat([{ high: 106, low: 97, close: 105.5, vol: 40 }])).length === 0, 'sweep: a close beyond the high is a break, not a sweep');
const low2 = P.sweepEvents(base.concat([{ high: 99, low: 88, close: 96, vol: 40 }]));
ok(low2.length === 1 && low2[0].side === 0 && low2[0].level === 90, 'sweep: planted run below the 90 swing low', low2);
const twice = P.sweepEvents(planted2.concat([{ high: 100, low: 97, close: 98, vol: 10 }, { high: 106.5, low: 97, close: 99, vol: 50 }]));
ok(twice.length === 1, 'sweep: a level is only run once', twice);
console.log('\n' + n + ' checks passed');
