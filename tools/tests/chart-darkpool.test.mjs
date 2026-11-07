// Unit tests: assets/chart-darkpool.js pure helpers (symbol cover, threshold, $ format, bar mapping, grouping, conditions).
// Fixture: tools/fixtures/darkpool-spy-2026-11-06.json = the real feeder part for SPY on 2026-11-06 (982 off-exchange prints >= $1M).
//   node tools/tests/chart-darkpool.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.window = globalThis.window || {};
const M = await import('../../assets/chart-darkpool.js');
const SPY = JSON.parse(fs.readFileSync(new URL('../fixtures/darkpool-spy-2026-11-06.json', import.meta.url)));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };

ok(M.tickerOf('stocks:AMEX:SPY') === 'SPY' && M.tickerOf('IDX:spy') === 'SPY' && M.tickerOf('NASDAQ:AAPL') === 'AAPL', 'covered tickers from any symbol form');
ok(M.tickerOf('futures:ES1!') === '' && M.tickerOf('BINANCE:BTCUSDT') === '' && M.tickerOf('stocks:NYSE:F') === '', 'futures, crypto and uncovered stocks -> none');
ok(M.looksStock('stocks:NYSE:F') && !M.looksStock('futures:NQ1!') && !M.looksStock('crypto:BTCUSDT') && !M.looksStock('EURUSD=X'), 'stock vs futures / crypto / forex for the note');
ok(M.sizeUsd('$1M') === 1e6 && M.sizeUsd('$25M') === 25e6 && M.sizeUsd('junk') === 1e6, 'size presets');
ok(M.usd(1.2e6) === '$1.2M' && M.usd(1e6) === '$1M' && M.usd(40.4e6) === '$40M' && M.usd(1.104e9) === '$1.1B' && M.usd(15e9) === '$15B', '$ labels');

// threshold counts on the real day (checked against the raw 140 MB reply when the fixture was made)
ok(M.prints(SPY, 1e6).length === 982, 'SPY $1M+: 982 prints');
ok(M.prints(SPY, 5e6).length === 124, 'SPY $5M+: 124 prints');
ok(M.prints(SPY, 10e6).length === 80 && M.prints(SPY, 1e6).filter((x) => x.big).length === 80, 'SPY $10M+: 80 prints, all flagged big');
ok(M.prints(SPY, 25e6).length === 58, 'SPY $25M+: 58 prints');
const top = M.prints(SPY, 1e6).sort((a, b) => b.v - a.v)[0];
ok(top.s === 1500000 && top.p === 736.27 && M.usd(top.v) === '$1.1B', 'largest print 1,500,000 sh @ 736.27');
const ps = M.prints(SPY, 1e6);
ok(ps.every((x, i) => !i || ps[i - 1].t <= x.t), 'prints in time order');
ok(M.prints({ rows: [[1, 'x', 2, ''], null, [2, 10, 2e5, 'T']] }, 1e6).length === 1, 'bad rows skipped');
const mkt = M.prints(SPY, 1e6, true);
ok(mkt.length === 761 && mkt.every((x) => !M.condNote(x.c).off.length), 'market-price only: 761 of 982 (average-price / contingent / late dropped)');
ok(!mkt.some((x) => x.p === 733.1331) && ps.filter((x) => x.p === 733.1331).length === 24, 'the 24 reports of one contingent trade at 733.13 are dropped from the chart');

// bar mapping + grouping on 5-minute bars of the regular session (09:30-16:00 ET = 14:30-21:00 UTC on 2026-11-06)
const t0 = Date.UTC(2026, 10, 6, 14, 30), ms = 300000, bars = [];
for (let i = 0; i < 78; i++) bars.push({ time: t0 + i * ms });
ok(M.barMs(bars) === ms, 'bar length from bars');
ok(M.barIndex(bars, t0, ms) === 0 && M.barIndex(bars, t0 + ms - 1, ms) === 0 && M.barIndex(bars, t0 + ms, ms) === 1, 'bar index edges');
ok(M.barIndex(bars, t0 - 1, ms) === -1 && M.barIndex(bars, t0 + 78 * ms, ms) === -1, 'extended-hours prints fall outside regular bars');
const groups = M.groupByBar(ps, bars, ms);
const inRth = ps.filter((x) => x.t >= t0 && x.t < t0 + 78 * ms);
ok(groups.reduce((s, g) => s + g.list.length, 0) === inRth.length && inRth.length > 500, 'every regular-session print lands in one bar (' + inRth.length + ')');
ok(groups.every((g) => g.list.every((x) => M.barIndex(bars, x.t, ms) === g.i)), 'groups hold only their own bar');
ok(M.groupByBar(ps, bars, ms, 10, 20).every((g) => g.i >= 10 && g.i <= 20), 'grouping respects the visible range');
ok(Math.abs(M.radius(5, 10) - (3 + 6 * Math.sqrt(0.5))) < 1e-9 && M.radius(10, 10) === 9 && M.radius(0, 10) === 3, 'dot radius');

// conditions
ok(M.condNote('TB').ext && M.condNote('TB').off[0] === 'average price', 'extended + average price');
ok(!M.condNote('').ext && !M.condNote('').off.length && M.condNote('7V').off.length === 1, 'regular / contingent');
const tr = M.tipRows({ t: top.t, p: top.p, s: top.s, v: top.v, c: 'TB', big: true });
ok(/Block print · \$1.1B/.test(tr.title) && tr.rows.some((r) => r[0] === 'Price type') && /may differ/.test(tr.note), 'card text for an average-price block');
ok(!/live|real-time|delayed/i.test(JSON.stringify(tr)) && !/finra_adf|insight/i.test(JSON.stringify(tr)), 'no live / vendor words in the card');
ok(M.agoText(1000, 1000e3 + 30e3) === 'Updated just now' && M.agoText(1000, 1000e3 + 7 * 60e3) === 'Updated 7 min ago' && M.agoText(1000, 1000e3 + 3 * 3600e3) === 'Updated 3 h ago', 'updated X ago');
console.log(n + ' passed');
