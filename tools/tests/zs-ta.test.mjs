// ta.* golden tests: Zscript values vs the chart's own built-in indicator math (the vendored
// chart library's classics/math.ts functions), within 1e-9, plus array reference
// implementations for the ones that library does not have.   node tools/tests/zs-ta.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, done, vals, makeBars, nearArr, near, assert } from './zs-helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Pull the indicator math section out of the vendored chart library (reference only; tests are not shipped).
const lib = fs.readFileSync(path.join(ROOT, 'assets/vendor/vela-0.9.0-s9/chunk-XIRSR3D6.js'), 'utf8');
const a = lib.indexOf('// src/core/native-indicators/classics/math.ts'), b = lib.indexOf('// src/core/native-indicators/classics/shared.ts');
assert.ok(a > 0 && b > a, 'reference section found');
const scratch = path.join(process.env.TMPDIR || '/tmp', 'zs-ref-math.mjs');
fs.writeFileSync(scratch, lib.slice(a, b) + '\nexport { sma, ema, rma, wma, vwma, hma, alma, stdev, meanDev, highest, lowest, rsi, stoch, atr, trueRange, linreg, cmo, swma, percentRank, change, roc, cumSum, sum, zip, map, sub, barsSinceHighest, barsSinceLowest };\n');
const R = await import(scratch);

const N = 600;
const B = makeBars(N, 7);
const B2 = makeBars(N, 99);
const bars = B.close.map((_, i) => ({ open: B.open[i], high: B.high[i], low: B.low[i], close: B.close[i], volume: B.volume[i] }));
const C = B.close, Hh = B.high, Ll = B.low, V = B.volume;
const hlc3 = C.map((c, i) => (Hh[i] + Ll[i] + c) / 3);
const z = (body, i = 0) => vals(body, { bars: B }, i);
const LENS = [1, 2, 3, 5, 9, 14, 20, 50];

for (const n of LENS) {
  t(`ta.sma ${n}`, () => nearArr(z(`plot(ta.sma(close, ${n}))`), R.sma(C, n)));
  t(`ta.ema ${n}`, () => nearArr(z(`plot(ta.ema(close, ${n}))`), R.ema(C, n)));
  t(`ta.rma ${n}`, () => nearArr(z(`plot(ta.rma(close, ${n}))`), R.rma(C, n)));
  t(`ta.wma ${n}`, () => nearArr(z(`plot(ta.wma(close, ${n}))`), R.wma(C, n)));
  t(`ta.vwma ${n}`, () => nearArr(z(`plot(ta.vwma(close, ${n}))`), R.vwma(C, V, n)));
  t(`ta.stdev ${n}`, () => nearArr(z(`plot(ta.stdev(close, ${n}))`), R.stdev(C, n)));
  t(`ta.dev ${n}`, () => nearArr(z(`plot(ta.dev(close, ${n}))`), R.meanDev(C, n)));
  t(`ta.highest ${n}`, () => nearArr(z(`plot(ta.highest(high, ${n}))`), R.highest(Hh, n)));
  t(`ta.lowest ${n}`, () => nearArr(z(`plot(ta.lowest(low, ${n}))`), R.lowest(Ll, n)));
  t(`ta.atr ${n}`, () => nearArr(z(`plot(ta.atr(${n}))`), R.atr(bars, n)));
  t(`ta.linreg ${n}`, () => nearArr(z(`plot(ta.linreg(close, ${n}, 0))`), R.linreg(C, n, 0)));
  t(`math.sum ${n}`, () => nearArr(z(`plot(math.sum(close, ${n}))`), R.sum(C, n)));
  t(`ta.change ${n}`, () => nearArr(z(`plot(ta.change(close, ${n}))`), R.change(C, n)));
  t(`ta.roc ${n}`, () => nearArr(z(`plot(ta.roc(close, ${n}))`), R.roc(C, n)));
}
for (const n of [2, 3, 5, 9, 14, 21, 50]) {
  t(`ta.hma ${n}`, () => nearArr(z(`plot(ta.hma(close, ${n}))`), R.hma(C, n)));
  t(`ta.rsi ${n}`, () => nearArr(z(`plot(ta.rsi(close, ${n}))`), R.rsi(C, n)));
  t(`ta.stoch ${n}`, () => nearArr(z(`plot(ta.stoch(close, high, low, ${n}))`), R.stoch(C, Hh, Ll, n)));
  t(`ta.cmo ${n}`, () => nearArr(z(`plot(ta.cmo(close, ${n}))`), R.cmo(C, n)));
  t(`ta.percentrank ${n}`, () => nearArr(z(`plot(ta.percentrank(close, ${n}))`), R.percentRank(C, n)));
  t(`ta.highestbars ${n}`, () => nearArr(z(`plot(ta.highestbars(high, ${n}))`), R.barsSinceHighest(Hh, n).map((x) => -x)));
  t(`ta.lowestbars ${n}`, () => nearArr(z(`plot(ta.lowestbars(low, ${n}))`), R.barsSinceLowest(Ll, n).map((x) => -x)));
}
t('ta.linreg offset 2', () => nearArr(z('plot(ta.linreg(close, 10, 2))'), R.linreg(C, 10, 2)));
t('ta.alma 9', () => nearArr(z('plot(ta.alma(close, 9, 0.85, 6))'), R.alma(C, 9, 0.85, 6)));
t('ta.alma 21', () => nearArr(z('plot(ta.alma(close, 21, 0.5, 4))'), R.alma(C, 21, 0.5, 4)));
t('ta.swma', () => nearArr(z('plot(ta.swma(close))'), R.swma(C)));
t('ta.tr(true)', () => nearArr(z('plot(ta.tr(true))'), R.trueRange(bars)));
t('ta.tr na first bar', () => { const v = z('plot(ta.tr)'); assert.ok(Number.isNaN(v[0])); near(v[5], R.trueRange(bars)[5]); });
t('ta.cum', () => nearArr(z('plot(ta.cum(close))'), R.cumSum(C)));
t('ta.mom', () => nearArr(z('plot(ta.mom(close, 10))'), R.change(C, 10)));
t('ta.ema on hlc3', () => nearArr(z('plot(ta.ema(hlc3, 10))'), R.ema(hlc3, 10)));
t('ta.sma of ta.ema (chained)', () => nearArr(z('plot(ta.sma(ta.ema(close, 5), 7))'), R.sma(R.ema(C, 5), 7)));
t('ta.rsi of ta.sma', () => nearArr(z('plot(ta.rsi(ta.sma(close, 3), 14))'), R.rsi(R.sma(C, 3), 14)));

// MACD = chart MACD (ema fast - ema slow, ema signal)
t('ta.macd line/signal/hist', () => {
  const line = R.sub(R.ema(C, 12), R.ema(C, 26)), sig = R.ema(line, 9), hist = R.sub(line, sig);
  const body = '[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(m)\nplot(s)\nplot(h)';
  nearArr(z(body, 0), line); nearArr(z(body, 1), sig); nearArr(z(body, 2), hist);
});
t('ta.macd 5/13/4', () => { const line = R.sub(R.ema(C, 5), R.ema(C, 13)); const body = '[m, s, h] = ta.macd(close, 5, 13, 4)\nplot(m)\nplot(s)'; nearArr(z(body, 0), line); nearArr(z(body, 1), R.ema(line, 4)); });
// Bollinger = chart Bollinger (sma basis, population stdev)
t('ta.bb', () => {
  const basis = R.sma(C, 20), dev = R.map(R.stdev(C, 20), (x) => x * 2);
  const body = '[m, u, l] = ta.bb(close, 20, 2)\nplot(m)\nplot(u)\nplot(l)';
  nearArr(z(body, 0), basis); nearArr(z(body, 1), R.zip(basis, dev, (x, y) => x + y)); nearArr(z(body, 2), R.zip(basis, dev, (x, y) => x - y));
});
t('ta.bbw', () => { const basis = R.sma(C, 20), dev = R.stdev(C, 20); nearArr(z('plot(ta.bbw(close, 20, 2))'), basis.map((m, i) => (4 * dev[i]) / m * 100)); });
// CCI = (src - sma) / (0.015 * meanDev)
t('ta.cci 20', () => { const m = R.sma(hlc3, 20), d = R.meanDev(hlc3, 20); nearArr(z('plot(ta.cci(hlc3, 20))'), hlc3.map((x, i) => (d[i] === 0 ? 0 : (x - m[i]) / (0.015 * d[i])))); });
t('ta.cci 14 close', () => { const m = R.sma(C, 14), d = R.meanDev(C, 14); nearArr(z('plot(ta.cci(close, 14))'), C.map((x, i) => (x - m[i]) / (0.015 * d[i]))); });
// Keltner (EMA basis, EMA of true range)
t('ta.kc', () => {
  const tr = R.trueRange(bars).map((x, i) => (i === 0 ? NaN : x));
  const basis = R.ema(C, 20), re = R.ema(tr, 20);
  const body = '[m, u, l] = ta.kc(close, 20, 1.5)\nplot(m)\nplot(u)\nplot(l)';
  nearArr(z(body, 0), basis); nearArr(z(body, 1), basis.map((x, i) => x + 1.5 * re[i])); nearArr(z(body, 2), basis.map((x, i) => x - 1.5 * re[i]));
});
// DMI: same construction as the chart's ADX indicator (Wilder RMA of +DM/-DM/TR)
t('ta.dmi 14/14', () => {
  const n = N, pdm = new Array(n).fill(NaN), mdm = new Array(n).fill(NaN);
  for (let i = 1; i < n; i++) { const up = Hh[i] - Hh[i - 1], dn = Ll[i - 1] - Ll[i]; pdm[i] = up > dn && up > 0 ? up : 0; mdm[i] = dn > up && dn > 0 ? dn : 0; }
  const atrL = R.rma(R.trueRange(bars), 14);
  const pdi = R.zip(R.rma(pdm, 14), atrL, (d, a2) => (a2 === 0 ? 0 : 100 * d / a2)), mdi = R.zip(R.rma(mdm, 14), atrL, (d, a2) => (a2 === 0 ? 0 : 100 * d / a2));
  const dx = R.zip(pdi, mdi, (p, m) => (p + m === 0 ? 0 : 100 * Math.abs(p - m) / (p + m)));
  const body = '[p, m, adx] = ta.dmi(14, 14)\nplot(p)\nplot(m)\nplot(adx)';
  nearArr(z(body, 0), pdi); nearArr(z(body, 1), mdi); nearArr(z(body, 2), R.rma(dx, 14));
});

// ---------- array reference implementations ----------
function refMfi(src, n) {
  const out = new Array(N).fill(NaN);
  for (let i = n; i < N; i++) {
    let up = 0, dn = 0;
    for (let k = i - n + 1; k <= i; k++) { const ch = src[k] - src[k - 1]; if (ch > 0) up += V[k] * src[k]; else if (ch < 0) dn += V[k] * src[k]; }
    out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  }
  return out;
}
t('ta.mfi 14', () => nearArr(z('plot(ta.mfi(hlc3, 14))'), refMfi(hlc3, 14)));
t('ta.mfi 5', () => nearArr(z('plot(ta.mfi(hlc3, 5))'), refMfi(hlc3, 5)));
t('ta.obv', () => { let s = 0; const ref = C.map((c, i) => { if (i > 0) s += Math.sign(c - C[i - 1]) * V[i]; return s; }); nearArr(z('plot(ta.obv)'), ref); });
t('ta.vwap daily reset', () => {
  const D = makeBars(N, 3, 15 * 60000);
  const h3 = D.close.map((c, i) => (D.high[i] + D.low[i] + c) / 3);
  let day = null, pv = 0, vv = 0;
  const ref = D.time.map((tm, i) => { const d = Math.floor(tm / 86400000); if (d !== day) { day = d; pv = 0; vv = 0; } pv += h3[i] * D.volume[i]; vv += D.volume[i]; return pv / vv; });
  nearArr(vals('plot(ta.vwap)', { bars: D, timeframe: '15' }), ref);
  nearArr(vals('plot(ta.vwap(hlc3))', { bars: D, timeframe: '15' }), ref);
});
t('ta.correlation', () => {
  const ref = new Array(N).fill(NaN), n = 20;
  for (let i = n - 1; i < N; i++) {
    const x = C.slice(i - n + 1, i + 1), y = B2.close.slice(i - n + 1, i + 1).map((_, k) => V[i - n + 1 + k]);
    const mx = x.reduce((p, q) => p + q) / n, my = y.reduce((p, q) => p + q) / n;
    let sxy = 0, sxx = 0, syy = 0; for (let k = 0; k < n; k++) { sxy += (x[k] - mx) * (y[k] - my); sxx += (x[k] - mx) ** 2; syy += (y[k] - my) ** 2; }
    ref[i] = sxy / Math.sqrt(sxx * syy);
  }
  nearArr(z('plot(ta.correlation(close, volume, 20))'), ref);
});
t('ta.variance = stdev^2', () => nearArr(z('plot(ta.variance(close, 10))'), R.stdev(C, 10).map((x) => x * x)));
t('ta.stdev unbiased', () => { const s = R.stdev(C, 10); nearArr(z('plot(ta.stdev(close, 10, false))'), s.map((x) => x * Math.sqrt(10 / 9))); });
t('ta.median', () => { const ref = C.map((_, i) => { if (i < 4) return NaN; const w = C.slice(i - 4, i + 1).sort((p, q) => p - q); return w[2]; }); nearArr(z('plot(ta.median(close, 5))'), ref); });
t('ta.range', () => nearArr(z('plot(ta.range(close, 10))'), R.zip(R.highest(C, 10), R.lowest(C, 10), (p, q) => p - q)));
t('ta.wpr', () => { const hh = R.highest(Hh, 14), ll = R.lowest(Ll, 14); nearArr(z('plot(ta.wpr(14))'), C.map((c, i) => 100 * (c - hh[i]) / (hh[i] - ll[i]))); });
t('ta.tsi', () => {
  const d = R.change(C, 1);
  const ref = R.zip(R.ema(R.ema(d, 25), 13), R.ema(R.ema(R.map(d, Math.abs), 25), 13), (p, q) => p / q);
  nearArr(z('plot(ta.tsi(close, 13, 25))'), ref);
});
function refPivot(src, L, Rr, hi) {
  const out = new Array(N).fill(NaN);
  for (let i = L + Rr; i < N; i++) {
    const c = src[i - Rr]; let ok = true;
    for (let k = i - L - Rr; k <= i; k++) { if (k === i - Rr) continue; if (k < i - Rr) { if (hi ? !(c > src[k]) : !(c < src[k])) ok = false; } else if (hi ? !(c >= src[k]) : !(c <= src[k])) ok = false; }
    if (ok) out[i] = c;
  }
  return out;
}
t('ta.pivothigh 5/5', () => nearArr(z('plot(ta.pivothigh(high, 5, 5))'), refPivot(Hh, 5, 5, true)));
t('ta.pivotlow 3/2', () => nearArr(z('plot(ta.pivotlow(low, 3, 2))'), refPivot(Ll, 3, 2, false)));
t('ta.pivothigh default source', () => nearArr(z('plot(ta.pivothigh(4, 4))'), refPivot(Hh, 4, 4, true)));
t('pivots are reported late, never early', () => { const v = z('plot(ta.pivothigh(high, 3, 3))'); for (let i = 0; i < 6; i++) assert.ok(Number.isNaN(v[i])); });
t('ta.crossover', () => {
  const f = R.ema(C, 5), s = R.ema(C, 20);
  const ref = C.map((_, i) => (i > 0 && f[i] > s[i] && f[i - 1] <= s[i - 1] ? 1 : 0));
  nearArr(z('plot(ta.crossover(ta.ema(close, 5), ta.ema(close, 20)) ? 1 : 0)'), ref);
});
t('ta.crossunder', () => {
  const f = R.ema(C, 5), s = R.ema(C, 20);
  const ref = C.map((_, i) => (i > 0 && f[i] < s[i] && f[i - 1] >= s[i - 1] ? 1 : 0));
  nearArr(z('plot(ta.crossunder(ta.ema(close, 5), ta.ema(close, 20)) ? 1 : 0)'), ref);
});
t('ta.cross = over or under', () => {
  const v = z('plot(ta.cross(ta.ema(close, 5), ta.ema(close, 20)) ? 1 : 0)'), o = z('plot(ta.crossover(ta.ema(close, 5), ta.ema(close, 20)) ? 1 : 0)'), u = z('plot(ta.crossunder(ta.ema(close, 5), ta.ema(close, 20)) ? 1 : 0)');
  nearArr(v, o.map((x, i) => x || u[i]));
});
t('ta.barssince', () => {
  let lastI = -1; const ref = C.map((c, i) => { if (c > B.open[i]) lastI = i; return lastI < 0 ? NaN : i - lastI; });
  nearArr(z('plot(ta.barssince(close > open))'), ref);
});
t('ta.valuewhen 0 and 1', () => {
  const hits = []; const r0 = [], r1 = [];
  C.forEach((c, i) => { if (c > B.open[i]) hits.push(Hh[i]); r0.push(hits.length ? hits[hits.length - 1] : NaN); r1.push(hits.length > 1 ? hits[hits.length - 2] : NaN); });
  nearArr(z('plot(ta.valuewhen(close > open, high, 0))'), r0);
  nearArr(z('plot(ta.valuewhen(close > open, high, 1))'), r1);
});
t('ta.rising / falling', () => {
  const r = C.map((c, i) => (i >= 3 && C[i] > C[i - 1] && C[i - 1] > C[i - 2] && C[i - 2] > C[i - 3] ? 1 : 0));
  const f = C.map((c, i) => (i >= 3 && C[i] < C[i - 1] && C[i - 1] < C[i - 2] && C[i - 2] < C[i - 3] ? 1 : 0));
  nearArr(z('plot(ta.rising(close, 3) ? 1 : 0)'), r); nearArr(z('plot(ta.falling(close, 3) ? 1 : 0)'), f);
});
// SuperTrend: independent reference (ATR = Wilder, hl2 bands, ratchet rules)
t('ta.supertrend 3/10', () => {
  const atr = R.atr(bars, 10); let up = NaN, lo = NaN, st = NaN, prevAtr = NaN; const line = [], dirs = [];
  for (let i = 0; i < N; i++) {
    const src = (Hh[i] + Ll[i]) / 2; let u = src + 3 * atr[i], l = src - 3 * atr[i];
    const pc = i > 0 ? C[i - 1] : NaN, pl = Number.isFinite(lo) ? lo : 0, pu = Number.isFinite(up) ? up : 0;
    l = l > pl || pc < pl ? l : pl; u = u < pu || pc > pu ? u : pu;
    let d; if (!Number.isFinite(prevAtr)) d = 1; else if (st === up) d = C[i] > u ? -1 : 1; else d = C[i] < l ? 1 : -1;
    const s = d === -1 ? l : u; prevAtr = atr[i]; up = u; lo = l; st = s;
    line.push(Number.isFinite(atr[i]) ? s : NaN); dirs.push(Number.isFinite(atr[i]) ? d : NaN);
  }
  const body = '[s, d] = ta.supertrend(3, 10)\nplot(s)\nplot(d)';
  nearArr(z(body, 0), line); nearArr(z(body, 1), dirs);
});
t('ta.sar stays on correct side', () => {
  const v = z('plot(ta.sar(0.02, 0.02, 0.2))');
  let ok = 0; for (let i = 5; i < N; i++) if (v[i] >= Hh[i] - 1e-9 || v[i] <= Ll[i] + 1e-9) ok++;
  assert.ok(ok > (N - 5) * 0.95, 'sar outside the bar ' + ok);
});
t('ta.fixnan', () => { const v = z('x = bar_index % 3 == 0 ? close : na\nplot(fixnan(x))'); for (let i = 0; i < N; i++) near(v[i], C[i - (i % 3)]); });

// na handling (same rules as the chart: na resets the run)
t('ema restarts after na', () => {
  const D = makeBars(80, 5); D.close[30] = NaN;
  const ref = R.ema(D.close, 10);
  nearArr(vals('plot(ta.ema(close, 10))', { bars: D }), ref);
});
t('sma na window', () => { const D = makeBars(80, 5); D.close[30] = NaN; nearArr(vals('plot(ta.sma(close, 10))', { bars: D }), R.sma(D.close, 10)); });
t('rsi with na', () => { const D = makeBars(80, 5); D.close[30] = NaN; nearArr(vals('plot(ta.rsi(close, 14))', { bars: D }), R.rsi(D.close, 14)); });
t('length 0 is an error E412', () => { const o = (() => { try { return vals('plot(ta.sma(close, 0))'); } catch (e) { return e.message; } })(); assert.match(String(o), /E412/); });
t('length na is an error E412', () => { const o = (() => { try { return vals('plot(ta.ema(close, na))'); } catch (e) { return e.message; } })(); assert.match(String(o), /E412/); });
t('float length truncated', () => nearArr(z('plot(ta.sma(close, 5.7))'), R.sma(C, 5)));
t('length from input', () => nearArr(z('len = input.int(9)\nplot(ta.ema(close, len))'), R.ema(C, 9)));

done('zs-ta');
