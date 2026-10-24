// Liquidity heatmap maths (assets/chart-liquidity-data.js): colour scale, traded-at-price, pulled vs filled, iceberg hint.
// Synthetic cases first, then a REAL recording of the Binance BTCUSDT public book (5000-level snapshot + @depth@100ms
// diffs, 1-second samples, bucketed with the client's own rule) and its aggTrades, fixtures/liquidity/btcusdt-*.json.gz.
//   node tools/tests/chart-liquidity.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
globalThis.window = globalThis.window || {};
const L = await import('../../assets/chart-liquidity-data.js');
let n = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); n++; console.log('PASS ' + m); };

// ---- colour scale
const c0 = L.deepColor(0), c1 = L.deepColor(1), cm = L.deepColor(0.5);
ok(c0.every((v) => v < 30) && c1[0] > 240 && L.deepColor(-1).join() === c0.join() && L.deepColor(2).join() === c1.join(), 'scale: near-black at 0, near-white at 1, clamped');
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
ok(lum(L.deepColor(0.1)) < lum(L.deepColor(0.4)) && lum(L.deepColor(0.4)) < lum(L.deepColor(0.65)), 'scale: brighter as size grows (dark -> teal -> cyan -> yellow)');
ok(L.deepColor(0.875)[0] > 230 && L.deepColor(0.875)[1] < 120, 'scale: red near the top', L.deepColor(0.875));
ok(cm[2] > cm[0], 'scale: mid is teal / cyan', cm);

// ---- traded at price: asks are eaten by buyers, bids by sellers
const mins = [{ t: 60000, lo: 100, buy: [1, 2, 3], sell: [4, 5, 6] }, { t: 120000, lo: 101, buy: [10, 0], sell: [0, 7] }];
ok(L.tradedAt(mins, 1, 101, 102, 60000, 120000, -1) === 2 + 10, 'traded: ask wall at 101 consumed by buys in both minutes (12)');
ok(L.tradedAt(mins, 1, 102, 103, 60000, 120000, 1) === 6 + 7, 'traded: bid wall at 102 consumed by sells (13)');
ok(L.tradedAt(mins, 1, 200, 201, 60000, 120000, 1) === 0, 'traded: nothing printed at a far price');
ok(L.tradedAt(mins, 1, 101, 102, 60000, 120000, -1, 90000) === null, 'traded: window before the trade coverage -> null (no claim)');
ok(L.vanishKind(100, 40) === 'filled' && L.vanishKind(100, 10) === 'pulled' && L.vanishKind(100, null) === null, 'vanish: >= 30% traded = filled, less = pulled, no trades = no tag');

// ---- iceberg: a bid row that trades 10x its visible size and keeps refilling; a normal row does not flag
const S = [];
for (let s = 0; s < 60; s++) {
  const v = new Float32Array(10);
  v[2] = 2;             // bid row 2 (price 102): 2 visible, refills every second
  v[5] = 50;            // big bid at row 5, barely trades
  v[8] = -3;            // ask at 108
  S.push({ ts: 60000 + s * 1000, mid: 107, step: 1, i0: 100, v });
}
const M = [{ t: 60000, lo: 100, buy: new Array(10).fill(0).map((_, k) => (k === 8 ? 4 : 0.2)), sell: new Array(10).fill(0).map((_, k) => (k === 2 ? 30 : k === 5 ? 3 : 0.2)) }];
const ice = L.icebergEvents(S, M, { step: 1, tick: 1, topPct: 0.5 });
ok(ice.length === 1 && ice[0].side === 1 && ice[0].price === 102 && ice[0].traded === 30 && ice[0].visible === 2, 'iceberg: 30 traded into a 2-lot bid that kept refilling -> one hint at 102', ice);
const sparse = L.icebergEvents(S.filter((_, k) => k % 30 === 0), M, { step: 1, tick: 1, topPct: 0.5 });
ok(sparse.length === 0, 'iceberg: 2 samples in the minute (recorder-like) cannot show a refill -> nothing');
const S2 = S.map((s, k) => { if (k < 30) return s; const v = Float32Array.from(s.v); v[2] = 0; return Object.assign({}, s, { v }); });
ok(L.icebergEvents(S2, M, { step: 1, tick: 1, topPct: 0.5 }).length === 0, 'iceberg: a level that vanished half the minute (not refilled) is not one');

// ---- REAL recording (if present)
const FX = new URL('./fixtures/liquidity/', import.meta.url);
const files = fs.existsSync(FX) ? fs.readdirSync(FX).filter((f) => /\.json\.gz$/.test(f)) : [];
ok(files.length > 0, 'fixture: recorded Binance book + trades present (' + files.join(', ') + ')');
for (const fn of files) {
  const R = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(fn, FX))).toString());
  const samples = R.samples.map((s) => Object.assign({}, s, { v: Float32Array.from(s.v), fv: Float32Array.from(s.fv) }));
  ok(samples.length > 600 && R.trades.length > 1000, fn + ': ' + samples.length + ' one-second samples, ' + R.trades.length + ' trades');
  // footprint minutes from the trades (the same shape the crypto feed builds)
  const tick = 1, byM = new Map();
  for (const [, p, q, mk, T] of R.trades) {
    const t = Math.floor(T / 60000) * 60000; let b = byM.get(t); if (!b) { b = new Map(); byM.set(t, b); }
    const i = Math.floor(p / tick + 1e-9); let e = b.get(i); if (!e) { e = [0, 0]; b.set(i, e); }
    if (mk) e[1] += q; else e[0] += q;   // m = buyer is maker = a SELL
  }
  const fm = [...byM.keys()].sort((a, b) => a - b).map((t) => { const b = byM.get(t), ks = [...b.keys()], lo = Math.min(...ks), hi = Math.max(...ks); const buy = new Array(hi - lo + 1).fill(0), sell = buy.slice(); b.forEach((e, i) => { buy[i - lo] = e[0]; sell[i - lo] = e[1]; }); return { t, lo, buy, sell }; });
  const cover = fm[1].t;   // the first minute is partial
  // traded-at-price agrees with a direct sum over the raw trades
  const mid = samples[Math.floor(samples.length / 2)].mid, a = Math.floor(mid) - 20, z = a + 40;
  const t0 = cover, t1 = fm[fm.length - 2].t + 59999;
  const direct = R.trades.filter(([, p, , mk, T]) => T >= t0 && T <= t1 && p >= a && p < z && mk === 1).reduce((s, x) => s + x[2], 0);
  const got = L.tradedAt(fm, tick, a, z, t0, t1, 1, cover);
  ok(Math.abs(got - direct) < 1e-6, fn + ': traded into bids over ' + a + '-' + z + ' = the raw sells summed (' + got.toFixed(4) + ' BTC)');
  // pulled vs filled on the recorded fine book: every big bid/ask row that vanished
  const step = samples[0].fs, rows = (s) => { const m = new Map(); s.fv.forEach((v, k) => { if (v) m.set(s.fi0 + k, v); }); return m; };
  const R0 = samples.map(rows), sizes = [];
  R0.forEach((m) => m.forEach((v) => sizes.push(Math.abs(v))));
  sizes.sort((x, y) => x - y);
  const big = sizes[Math.floor(sizes.length * 0.995)];
  const events = [];
  for (let k = 1; k < samples.length; k++) {
    R0[k - 1].forEach((v, i) => {
      if (Math.abs(v) < big) return;
      const now = R0[k].get(i) || 0;
      if (Math.sign(now) === Math.sign(v) && Math.abs(now) >= 0.25 * Math.abs(v)) return;
      const side = v > 0 ? 1 : -1, tr = L.tradedAt(fm, tick, i * step, (i + 1) * step, samples[k - 1].ts, samples[k].ts + 1000, side, cover);
      events.push({ k, i, side, last: Math.abs(v), tr, kind: L.vanishKind(Math.abs(v), tr) });
    });
  }
  const pulled = events.filter((e) => e.kind === 'pulled').length, filled = events.filter((e) => e.kind === 'filled').length;
  ok(events.length > 0 && pulled + filled + events.filter((e) => e.kind == null).length === events.length, fn + ': ' + events.length + ' big levels vanished: ' + pulled + ' pulled, ' + filled + ' filled, ' + events.filter((e) => e.kind == null).length + ' before trade coverage');
  for (const e of events.filter((x) => x.kind)) {
    const ts0 = samples[e.k - 1].ts, m0 = Math.floor(ts0 / 60000) * 60000, ts1 = samples[e.k].ts + 1000;
    const direct2 = R.trades.filter(([, p, , mk, T]) => T >= m0 && T <= ts1 + 60000 && Math.floor(T / 60000) * 60000 <= ts1 && p >= e.i * step && p < (e.i + 1) * step && mk === (e.side > 0 ? 1 : 0)).reduce((s, x) => s + x[2], 0);
    assert.ok(Math.abs(direct2 - e.tr) < 1e-6, 'traded re-summed from raw trades');
    assert.equal(e.kind, direct2 >= 0.3 * e.last ? 'filled' : 'pulled');
  }
  ok(true, fn + ': every pulled / filled tag re-checked against the raw trades at that price');
  const ice2 = L.icebergEvents(samples, fm.filter((b) => b.t >= cover), { step, tick });
  for (const e of ice2) {
    assert.ok(e.traded >= 4 * e.visible && e.samples >= 20);
    const inMin = samples.filter((s) => Math.floor(s.ts / 60000) * 60000 === e.t);
    const vis = inMin.map(rows).map((m) => m.get(e.i) || 0).filter((x) => (e.side > 0 ? x > 0 : x < 0));
    assert.ok(vis.length >= 0.8 * inMin.length, 'present in >= 80% of the samples');
  }
  ok(ice2.length <= fm.length * 3, fn + ': iceberg hints ' + ice2.length + ' over ' + fm.length + ' minutes (rare), each re-checked (>= 4x visible, present >= 80% of the minute)', ice2.slice(0, 3));
}
console.log('\n' + n + ' checks passed');
