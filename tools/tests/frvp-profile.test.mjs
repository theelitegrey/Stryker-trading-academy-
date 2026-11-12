// node tools/tests/frvp-profile.test.mjs — assets/chart-frvp-data.js buildProfile: the value area must stay put when only the row count changes
// (member report: same FRVP range, rows 24 / 100 / 300 gave very different VAH / VAL).
import assert from 'node:assert/strict';
import { buildProfile } from '../../assets/chart-frvp-data.js';

// deterministic candles: a random walk with a few revisits, 1-min style bars
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
function candles(n) {
  const out = []; let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p, c = o + (rnd() - 0.5) * 0.6 + (50 - (o - 100) * 0) * 0, hi = Math.max(o, c) + rnd() * 0.25, lo = Math.min(o, c) - rnd() * 0.25;
    out.push({ time: i * 60, open: o, high: hi, low: lo, close: c, volume: 50 + Math.floor(rnd() * 400) });
    p = c + (100 - c) * 0.01;
  }
  return out;
}
// the OLD maths (four rows per candle: open/high/low/close, one-row growth) kept here only to show the test catches the reported jump
function oldProfile(bars, rowCount, frac) {
  let min = Infinity, max = -Infinity; for (const b of bars) { min = Math.min(min, b.low); max = Math.max(max, b.high); }
  const n = rowCount, rowH = (max - min) / n, rows = Array.from({ length: n }, (_, k) => ({ price: min + k * rowH, up: 0, down: 0 }));
  for (const b of bars) { const side = b.close >= b.open ? 'up' : 'down', hit = new Set(); for (const p of [b.open, b.high, b.low, b.close]) hit.add(Math.min(n - 1, Math.max(0, Math.floor((p - min) / rowH)))); for (const k of hit) rows[k][side] += b.volume; }
  let tot = 0, mx = 0, poc = 0; rows.forEach((r, k) => { const t = r.up + r.down; tot += t; if (t > mx) { mx = t; poc = k; } });
  let f = poc, to = poc, acc = mx; while (acc < tot * frac && (f > 0 || to < n - 1)) { const bl = f > 0 ? rows[f - 1].up + rows[f - 1].down : -1, ab = to < n - 1 ? rows[to + 1].up + rows[to + 1].down : -1; if (ab > bl) { to++; acc += ab; } else { f--; acc += bl; } }
  return { vah: rows[to].price + rowH, val: rows[f].price, min, max };
}
function levels(bars, rows) {
  const r = buildProfile(bars, rows, 0.7, false), P = r.profile;
  return { vah: P.rows[P.vaTo].price + P.rowH, val: P.rows[P.vaFrom].price, poc: P.rows[P.poc].price + P.rowH / 2, min: P.min, max: P.min + P.rowH * P.rows.length };
}
let worstNew = 0, worstOld = 0;
for (const len of [60, 200, 600]) {
  const bars = candles(len), res = [24, 100, 300].map((n) => levels(bars, n)), old = [24, 100, 300].map((n) => oldProfile(bars, n, 0.7));
  const range = res[0].max - res[0].min;
  for (const x of res.slice(1)) {
    worstNew = Math.max(worstNew, Math.abs(x.vah - res[0].vah) / range, Math.abs(x.val - res[0].val) / range);
    assert.ok(Math.abs(x.vah - res[0].vah) / range < 0.1, `VAH moved ${(Math.abs(x.vah - res[0].vah) / range * 100).toFixed(1)}% of range (len ${len})`);
    assert.ok(Math.abs(x.val - res[0].val) / range < 0.1, `VAL moved (len ${len})`);
    assert.ok(Math.abs(x.poc - res[0].poc) / range < 0.15, `POC moved (len ${len})`);
  }
  for (const x of old.slice(1)) worstOld = Math.max(worstOld, Math.abs(x.vah - old[0].vah) / range, Math.abs(x.val - old[0].val) / range);
  // value area really holds ~70% of the volume and contains the POC
  const P = buildProfile(bars, 300, 0.7, false).profile; let tot = 0, va = 0; P.rows.forEach((r, k) => { tot += r.up + r.down; if (k >= P.vaFrom && k <= P.vaTo) va += r.up + r.down; });
  assert.ok(P.poc >= P.vaFrom && P.poc <= P.vaTo); assert.ok(va / tot >= 0.7 && va / tot < 0.8, 'VA share ' + va / tot);
  // volume is conserved
  const sum = bars.reduce((s, b) => s + b.volume, 0); assert.ok(Math.abs(tot - sum) < 1e-6 * sum, 'volume conserved');
}
console.log('worst VAH/VAL move across 24/100/300 rows (share of range): new ' + (worstNew * 100).toFixed(1) + '%, old maths ' + (worstOld * 100).toFixed(1) + '%');
assert.ok(worstNew < worstOld, 'new maths must be steadier than the old');
// flat range / single candle still works
assert.ok(buildProfile([{ time: 0, open: 5, high: 5, low: 5, close: 5, volume: 10 }], 300, 0.7, true));
assert.equal(buildProfile([{ time: 0, open: 5, high: 6, low: 4, close: 5, volume: 0 }], 24, 0.7, false), null);
console.log('frvp-profile: all passed');
