// Zscript benchmark (brief target): 5,000 bars x 3 EMAs + RSI under 150 ms, compile included.
//   node tools/tests/zs-bench.test.mjs
import { t, done, makeBars, assert, compile, run } from './zs-helpers.mjs';

const SRC = '//@zscript 1\nindicator("Sample bench", overlay=true)\nplot(ta.ema(close, 9))\nplot(ta.ema(close, 21))\nplot(ta.ema(close, 50))\nplot(ta.rsi(close, 14))\n';
const bars = makeBars(5000, 5);
const once = () => { const a = performance.now(); const c = compile(SRC); const o = run(c.program, { bars, timeframe: '1' }); const ms = performance.now() - a; assert.ok(o.ok); return ms; };
for (let i = 0; i < 3; i++) once();               // warm-up (JIT), as a chart tab would be after load
const runs = Array.from({ length: 15 }, once).sort((a, b) => a - b);
const median = runs[7], worst = runs[14];
console.log(`bench 5000 bars x 3 EMA + RSI: median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms, cold first run measured separately`);
t('median < 150 ms', () => assert.ok(median < 150, median));
t('worst < 300 ms', () => assert.ok(worst < 300, worst));
const heavy = '//@zscript 1\nindicator("Sample heavy")\n[m, s, h] = ta.macd(close, 12, 26, 9)\n[mid, up, lo] = ta.bb(close, 20, 2)\n[st, d] = ta.supertrend(3, 10)\nplot(m)\nplot(up - lo)\nplot(st)\nplot(ta.atr(14))\nplot(ta.stoch(close, high, low, 14))\nplot(ta.cci(hlc3, 20))\n';
t('heavier script on 5000 bars < 400 ms', () => { const c = compile(heavy); run(c.program, { bars, timeframe: '1' }); const a = performance.now(); run(c.program, { bars, timeframe: '1' }); const ms = performance.now() - a; console.log('heavy:', ms.toFixed(1), 'ms'); assert.ok(ms < 400, ms); });
done('zs-bench');
