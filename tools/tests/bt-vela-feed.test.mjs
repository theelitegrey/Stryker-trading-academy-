// Backtest Vela feed: no look-ahead + parity with Series.view. Run: node tools/tests/bt-vela-feed.test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createBtFeed } from '../../assets/bt-vela-feed.js';
const require = createRequire(import.meta.url);
const E = require('../../assets/replay-engine.js');

// 3 days of fake 1m bars
const base = []; let p = 100; const t0 = Date.UTC(2026, 0, 5, 0, 0);
for (let i = 0; i < 3 * 1440; i++) { const o = p; p += Math.sin(i / 37) * 0.7 + ((i * 7919) % 13 - 6) * 0.05; base.push({ t: t0 + i * 60000, o, h: Math.max(o, p) + 0.3, l: Math.min(o, p) - 0.3, c: p, v: 10 + (i % 5) }); }
const series = new E.Series(base, '1m');
let cursor = 500;
const feed = createBtFeed({ series, getCursor: () => cursor, spec: { tick: 0.25, pointValue: 20, symbol: 'NQ' } });

// 1. nothing after the cursor, for every timeframe
for (const tf of ['1', '5', '15', '60', '240', 'D']) {
  const bars = await feed.provider.getBars('SESSION', tf, {});
  assert.ok(bars.length > 0, 'bars for ' + tf);
  assert.ok(bars[bars.length - 1].time <= base[cursor].t, 'last bar of ' + tf + ' starts at or before the cursor');
  const re = { '1': '1m', '5': '5m', '15': '15m', '60': '1h', '240': '4h', 'D': '1D' }[tf];
  const v = series.view(re, cursor);
  assert.equal(bars.length, v.n);
  // forming bar only contains base bars <= cursor
  const last = bars[bars.length - 1];
  let hi = -Infinity; for (let i = 0; i <= cursor; i++) if (base[i].t >= last.time && base[i].t < last.time + E.TF[re]) hi = Math.max(hi, base[i].h);
  assert.equal(last.high, hi, 'forming high ' + tf);
}
// 2. the value of an indicator computed on the visible bars at cursor N does not change when later bars exist
const sma = (bars, n) => { const a = bars.slice(-n); return a.reduce((s, b) => s + b.close, 0) / a.length; };
const at = async () => sma(await feed.provider.getBars('SESSION', '5', {}), 20);
const v1 = await at();
const longer = base.concat(base.slice(0, 400).map((b, i) => ({ t: base[base.length - 1].t + (i + 1) * 60000, o: b.o + 50, h: b.h + 50, l: b.l + 50, c: b.c + 50, v: b.v })));
const series2 = new E.Series(longer, '1m');
const feed2 = createBtFeed({ series: series2, getCursor: () => cursor, spec: {} });
const v2 = sma(await feed2.provider.getBars('SESSION', '5', {}), 20);
assert.equal(v1, v2, 'SMA at cursor must not change when future bars exist');
// 3. stepping forward pushes the forming bar; range filters
const got = []; const off = feed.provider.subscribe('SESSION', '5', (b) => got.push(b));
cursor++; feed.push(); assert.equal(got.length, 1); off(); cursor++; feed.push(); assert.equal(got.length, 1);
const lim = await feed.provider.getBars('SESSION', '5', { limit: 10 }); assert.equal(lim.length, 10);
console.log('bt-vela-feed: OK');
