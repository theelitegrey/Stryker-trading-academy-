// Order flow: feeder aggregation, wire format, Worker validation and the client maths.
// Run: node workers/book-recorder/test/orderflow.test.mjs   (needs python3 for the feeder dry run)
//
// Fixture: fixtures/nq-trades-20261013-12utc.json.gz = one real hour of InsightSentry tick trades
// for CME_MINI:NQZ2026 (2026-10-13 12:00-13:00 UTC, 9,826 prints), trimmed from the full day reply.
// The feeder (of-feeder/of_feeder.py --dry-run) aggregates it in Python; this test rebuilds every
// bar independently from the raw prints in JS and compares them, then checks the client maths
// (assets/chart-footprint-data.js) against hand counts from the same prints.
import assert from 'node:assert/strict';
import { gunzipSync, gzipSync } from 'node:zlib';
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateOfIngest, splitPayload, decodeRecord, ofRange, buildPayload, ticksJson, ticksRange } from '../src/orderflow.js';
import { decodeOrderflow, aggregate, clipTo, rows, poc, imbalances, stacked, unfinished, cvdCandles, profile, vwapSeries } from '../../../assets/chart-footprint-data.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures/nq-trades-20261013-12utc.json.gz');
const TICK = 0.25;
let pass = 0;
const ok = (name) => { pass++; console.log('PASS', name); };

// ---- 1. the feeder's dry run on the real hour
const out = join(mkdtempSync(join(tmpdir(), 'of-')), 'nq.bin');
const stats = JSON.parse(execFileSync('python3', [join(here, '../of-feeder/of_feeder.py'), '--dry-run', FIX, 'NQ', out]).toString());
const payload = new Uint8Array(readFileSync(out));
const { header, bars } = decodeOrderflow(payload);
assert.equal(header.sym, 'NQ'); assert.equal(header.tick, TICK);
assert.equal(bars.length, 60); assert.equal(stats.bars, 60); assert.equal(stats.prints, 9826);
ok('feeder dry run: 9,826 prints -> 60 one-minute bars, ' + stats.bytes + ' B raw, ' + stats.gzip + ' B gzip, big >= ' + stats.big_thr);

// ---- 2. rebuild every bar from the raw prints in JS (independent of the Python code)
const raw = JSON.parse(gunzipSync(readFileSync(FIX)).toString()).series;
const ref = new Map();
for (const x of raw) {
  const m = Math.floor(x.time / 60), p = Math.round(x.close / TICK), v = Math.round(x.volume);
  let b = ref.get(m);
  if (!b) { b = { o: p, c: p, lv: new Map(), d: 0, dmax: 0, dmin: 0, n: 0 }; ref.set(m, b); }
  b.c = p; b.n++;
  const l = b.lv.get(p) || [0, 0]; b.lv.set(p, l);
  if (x.type === 'buy') { l[0] += v; b.d += v; } else if (x.type === 'sell') { l[1] += v; b.d -= v; }
  b.dmax = Math.max(b.dmax, b.d); b.dmin = Math.min(b.dmin, b.d);
}
let checked = 0;
for (const b of bars) {
  const r = ref.get(b.t / 60000);
  assert.ok(r, 'bar ' + b.t);
  assert.equal(b.o, r.o); assert.equal(b.c, r.c); assert.equal(b.trades, r.n);
  assert.equal(b.dmax, r.dmax); assert.equal(b.dmin, r.dmin); assert.equal(b.delta, r.d);
  for (let j = 0; j < b.buy.length; j++) {
    const l = r.lv.get(b.lo + j) || [0, 0];
    assert.equal(b.buy[j], l[0]); assert.equal(b.sell[j], l[1]);
    checked++;
  }
  assert.equal(b.lo, Math.min(...r.lv.keys())); assert.equal(b.hi, Math.max(...r.lv.keys()));
}
ok('all 60 bars equal a JS rebuild from the raw prints (' + checked + ' price rows: buy, sell, open, close, delta, delta high/low, prints)');

// ---- 3. one bar by hand: 12:30 UTC, straight from the prints
const T = Date.UTC(2026, 9, 13, 12, 30) / 1000;
const ticks = raw.filter((x) => x.time >= T && x.time < T + 60);
const B = bars.find((b) => b.t === T * 1000);
const buyV = ticks.filter((x) => x.type === 'buy').reduce((s, x) => s + x.volume, 0);
const sellV = ticks.filter((x) => x.type === 'sell').reduce((s, x) => s + x.volume, 0);
assert.equal(B.vol, buyV + sellV); assert.equal(B.delta, buyV - sellV);
const atP = new Map();
ticks.forEach((x) => atP.set(x.close, (atP.get(x.close) || 0) + x.volume));
const pocPrice = [...atP.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
const rs = rows(B, 1), k = poc(rs);
assert.equal(rs[k].buy + rs[k].sell, pocPrice[1]);
let pv = 0, vv = 0; ticks.forEach((x) => { pv += x.close * x.volume; vv += x.volume; });
const w = vwapSeries([B], TICK, 'none')[0].vwap;
assert.ok(Math.abs(w - pv / vv) < 1e-9);
console.log('      12:30 bar from the raw ticks: %d prints, buy %d, sell %d, delta %d, POC %s (%d lots), VWAP %s',
  ticks.length, buyV, sellV, buyV - sellV, (rs[k].p * TICK).toFixed(2), pocPrice[1], w.toFixed(4));
ok('12:30 UTC bar: volume, delta, POC volume and VWAP equal the raw prints');

// ---- 4. big trades: one aggressive order = same millisecond + same side, summed
const thr = header.thr;
const orders = [];
let g = null;
for (const x of raw) {
  if (x.type !== 'buy' && x.type !== 'sell') continue;
  const ms = Math.floor(x.time * 1000), side = x.type === 'buy' ? 1 : 0;
  if (g && g.ms === ms && g.side === side) g.size += Math.round(x.volume);
  else { if (g) orders.push(g); g = { ms, side, size: Math.round(x.volume), p: Math.round(x.close / TICK) }; }
}
orders.push(g);
const bigRef = orders.filter((o) => o.size >= thr).map((o) => [o.ms, o.p, o.size, o.side]);
const bigGot = bars.flatMap((b) => b.bigs);
assert.deepEqual(bigGot.sort((a, b) => a[0] - b[0] || a[1] - b[1]), bigRef.sort((a, b) => a[0] - b[0] || a[1] - b[1]));
const sorted = orders.map((o) => o.size).sort((a, b) => a - b);
const q = sorted[Math.min(sorted.length - 1, Math.floor(0.995 * (sorted.length - 1) + 0.5))];
assert.equal(thr, Math.max(5, q));
ok('big trades: ' + bigGot.length + ' orders >= ' + thr + ' lots (the hour\'s 99.5th percentile) match the raw prints');

// ---- 5. re-aggregation to 5m / 15m equals aggregating the raw prints directly
for (const tf of [5, 15]) {
  const agg = aggregate(bars, tf * 60000);
  assert.equal(agg.length, 60 / tf);
  for (const a of agg) {
    const tk = raw.filter((x) => x.time * 1000 >= a.t && x.time * 1000 < a.t + tf * 60000);
    let d = 0, dmax = 0, dmin = 0, v = 0;
    const lv = new Map();
    for (const x of tk) {
      const p = Math.round(x.close / TICK);
      if (x.type === 'buy') d += x.volume; else if (x.type === 'sell') d -= x.volume;
      if (x.type) { v += x.volume; const l = lv.get(p) || [0, 0]; l[x.type === 'buy' ? 0 : 1] += x.volume; lv.set(p, l); }
      dmax = Math.max(dmax, d); dmin = Math.min(dmin, d);
    }
    assert.equal(a.delta, d); assert.equal(a.vol, v); assert.equal(a.dmax, dmax); assert.equal(a.dmin, dmin);
    assert.equal(a.trades, tk.length); assert.equal(a.o, Math.round(tk[0].close / TICK)); assert.equal(a.c, Math.round(tk[tk.length - 1].close / TICK));
    lv.forEach((l, p) => { assert.equal(a.buy[p - a.lo], l[0]); assert.equal(a.sell[p - a.lo], l[1]); });
  }
  ok(tf + 'm re-aggregation equals the raw prints (levels, delta, running delta high/low, open/close)');
}

// ---- 6. coarser price rows keep the totals and align to multiples
const a15 = aggregate(bars, 15 * 60000)[0];
for (const m of [2, 4, 8]) {
  const r = rows(a15, m);
  assert.equal(r.reduce((s, x) => s + x.buy + x.sell, 0), a15.vol);
  assert.ok(r.every((x) => x.p % m === 0));
}
ok('price rows x2 / x4 / x8: volume kept, rows aligned');

// ---- 7. imbalance, stacked, unfinished auction on a hand-made bar
const hb = { lo: 100, buy: Int32Array.from([5, 40, 60, 90, 2]), sell: Int32Array.from([10, 12, 15, 20, 7]), t: 0 };
const hr = rows(hb, 1);
const im = imbalances(hr, 3);
// buy imbalance at k when buy[k] >= 3 x sell[k-1]: k1 40>=30 yes, k2 60>=36 yes, k3 90>=45 yes, k4 2>=60 no
assert.deepEqual([...im.buy], [0, 1, 1, 1, 0]);
// sell imbalance at k when sell[k] >= 3 x buy[k+1]: 10>=120, 12>=180, 15>=270 no; 20>=6 yes; top row has none above
assert.deepEqual([...im.sell], [0, 0, 0, 1, 0]);
assert.deepEqual(stacked(im, 3), [{ side: 1, k0: 1, k1: 3 }]);
assert.deepEqual(stacked(im, 4), []);
assert.deepEqual(unfinished(hr), { high: true, low: true });
assert.deepEqual(unfinished(rows({ lo: 1, buy: Int32Array.from([0, 3]), sell: Int32Array.from([4, 0]) }, 1)), { high: false, low: false });
ok('diagonal imbalance 300%, stacked (3 rows), unfinished auction');

// ---- 8. CVD candles + session reset, profile value area, VWAP bands
const cv = cvdCandles(bars, 'none');
assert.equal(cv[cv.length - 1].c, bars.reduce((s, b) => s + b.delta, 0));
assert.ok(cv.every((c, i) => c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c) && (i === 0 || c.o === cv[i - 1].c)));
const cvR = cvdCandles(bars, 'session', (t) => (t >= T * 1000 ? 'b' : 'a'));
assert.equal(cvR.find((c) => c.t === T * 1000).o, 0);
const pf = profile(bars, 1, 70);
let inVa = 0; for (let k2 = pf.val - pf.r0; k2 <= pf.vah - pf.r0; k2++) inVa += pf.buy[k2] + pf.sell[k2];
assert.ok(inVa >= pf.total * 0.7);
assert.equal(pf.total, bars.reduce((s, b) => s + b.vol, 0));
const pocV = pf.buy[pf.poc - pf.r0] + pf.sell[pf.poc - pf.r0];
for (let k2 = 0; k2 < pf.n; k2++) assert.ok(pf.buy[k2] + pf.sell[k2] <= pocV);
const vw = vwapSeries(bars, TICK, 'none');
let PV = 0, P2V = 0, V = 0; raw.forEach((x) => { if (x.type) { PV += x.close * x.volume; P2V += x.close * x.close * x.volume; V += x.volume; } });
assert.ok(Math.abs(vw[vw.length - 1].vwap - PV / V) < 1e-6);
assert.ok(Math.abs(vw[vw.length - 1].sd - Math.sqrt(P2V / V - (PV / V) ** 2)) < 1e-6);
ok('CVD candles (+ session reset), volume profile POC / 70% value area, VWAP + SD from the raw prints');

// ---- 9. no lookahead: clipTo at a replay time mid-bar
const E = (T + 30) * 1000;                       // 12:30:30
const cl = clipTo(bars, E);
assert.ok(cl.every((b) => b.t + 60000 <= E));
assert.equal(cl[cl.length - 1].t, (T - 60) * 1000);
const f15 = aggregate(cl, 15 * 60000);
const last = f15[f15.length - 1];                // the forming 12:30 bar has no minute yet -> 12:15 bar is the last
assert.equal(last.t, Date.UTC(2026, 9, 13, 12, 15));
assert.equal(last.mins, 15);
const E2 = (T + 5 * 60) * 1000;                  // 12:35:00 -> the 12:30 15m bar = 5 complete minutes
const f2 = aggregate(clipTo(bars, E2), 15 * 60000);
assert.equal(f2[f2.length - 1].mins, 5);
const inRange = raw.filter((x) => x.time >= T && x.time < T + 300 && x.type);
assert.equal(f2[f2.length - 1].vol, inRange.reduce((s, x) => s + x.volume, 0));
assert.ok(f2.flatMap((b) => b.bigs).every((x) => x[0] < E2));
ok('no lookahead: replay clock mid-bar shows only complete minutes; the forming 15m bar = its complete minutes only');

// ---- 10. Worker validation and ranges
const now = Date.UTC(2026, 9, 13, 13, 5);
const gz = gzipSync(payload);
let v = await validateOfIngest('NQ', gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.length), now);
assert.ok(!v.error, v.error); assert.equal(v.bars.length, 60);
v = await validateOfIngest('ES', gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.length), now);
assert.equal(v.error, 'bad header');
v = await validateOfIngest('NQ', gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.length), Date.UTC(2026, 9, 13, 12, 10));
assert.equal(v.error, 'bar time out of range');
v = await validateOfIngest('BTC', new ArrayBuffer(40), now); assert.equal(v.error, 'symbol not recorded');
const sp = splitPayload(payload);
const bad = sp.recs[0].slice(); bad[bad.length - 1] = 0xff;
assert.equal(decodeRecord(bad), null);
const reb = buildPayload(sp.header, sp.recs);
assert.deepEqual(Buffer.from(reb), Buffer.from(payload));
ok('Worker: valid hour accepted; wrong symbol, future bars, unknown symbol, corrupt record refused; JS re-pack is byte-identical to Python');
const r1 = ofRange(new URLSearchParams('day=2026-10-12'), now);
assert.deepEqual(r1, { from: Date.UTC(2026, 9, 12) / 60000, to: Date.UTC(2026, 9, 12) / 60000 + 1439, final: true });
const r2 = ofRange(new URLSearchParams('day=2026-10-13'), now);
assert.equal(r2.to, now / 60000); assert.equal(r2.final, false);
const r3 = ofRange(new URLSearchParams('from=' + (now / 1000 - 10 * 86400)), now);
assert.equal(r3.to - r3.from, 4 * 1440);
assert.equal(ofRange(new URLSearchParams('day=garbage'), now), null);
ok('ranges: a past UTC day is final (cached a day), today ends now, from/to capped at 4 days');

// ---- 11. the 1-second path (tick-by-tick replay, /ticks1s) equals the raw prints
const tj = ticksJson('NQ', splitPayload(payload).recs);
assert.equal(tj.m.length, 60);
const sec = new Map();
for (const x of raw) {
  const s = Math.floor(x.time), q = sec.get(s);
  if (!q) sec.set(s, [x.close, x.close, x.close, x.close, x.volume]);
  else { q[1] = Math.max(q[1], x.close); q[2] = Math.min(q[2], x.close); q[3] = x.close; q[4] += x.volume; }
}
let ns = 0;
for (const [ms, list] of tj.m) for (const [s, o, hh, l, c, vol] of list) { assert.deepEqual([o, hh, l, c, vol], sec.get(ms + s)); ns++; }
assert.equal(ns, sec.size);
const tjs = JSON.stringify(tj).length;
const tr = ticksRange(new URLSearchParams('from=' + (now / 1000 - 3 * 86400)), now);
assert.equal(tr.to - tr.from, 1440);
ok('1-second path: ' + ns + ' traded seconds equal the raw prints (o/h/l/c/volume), ' + tjs + ' B JSON for the hour; /ticks1s range capped at 1 day');

console.log('\n' + pass + ' passed');
