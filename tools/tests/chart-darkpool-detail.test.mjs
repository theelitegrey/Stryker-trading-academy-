// Unit tests: assets/chart-darkpool-detail.js (DP-DETAIL) + the v2 part in assets/chart-darkpool.js.
// Fixtures: tools/fixtures/darkpool-v2-{spy,aapl,tsla}-2026-11-06.json = REAL parts rebuilt with the DP-DETAIL feeder logic from the saved
// SIP trades replies of 2026-11-06 (same prints as the v1 fixtures, plus the estimated side and the day's volume / VWAP).
//   node tools/tests/chart-darkpool-detail.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.window = globalThis.window || {};
const M = await import('../../assets/chart-darkpool.js');
const D = await import('../../assets/chart-darkpool-detail.js');
const fx = (s) => JSON.parse(fs.readFileSync(new URL('../fixtures/darkpool-' + s + '-2026-11-06.json', import.meta.url)));
const SPY = fx('v2-spy'), AAPL = fx('v2-aapl'), TSLA = fx('v2-tsla'), OLD = fx('spy');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };

// backward compatible: the v1 part (no side, no day stats) still gives the same prints, with no side and no % of volume
const p1 = M.prints(OLD, 1e6), p2 = M.prints(SPY, 1e6);
ok(p1.length === 982 && p2.length === 982 && p1.every((x, i) => x.t === p2[i].t && x.p === p2[i].p && x.s === p2[i].s), 'v1 and v2 parts: same 982 SPY prints');
ok(p1.every((x) => x.d === '' && x.k && x.k.pct === null && x.k.vw === null), 'v1 rows: no side, no volume / VWAP context');
ok(M.tipRows(p1[0]).side === '' && !M.tipRows(p1[0]).sideNote && !M.tipRows(p1[0]).more.some((r) => r[0] === 'Day VWAP'), 'v1 card: no side line, no VWAP row');

// side labels: counts on the real day (also in reports/workers/dp-detail.md)
const cnt = (pt) => pt.rows.reduce((m, r) => (m[r[4]] = (m[r[4]] || 0) + 1, m), {});
ok(JSON.stringify(cnt(SPY)) === JSON.stringify({ s: 104, u: 806, b: 69, l: 3 }), 'SPY sides: 69 likely buy, 104 likely sell, 806 unclear, 3 late');
ok(cnt(AAPL).b === 25 && cnt(AAPL).s === 24 && cnt(AAPL).u === 219, 'AAPL sides: 25 / 24 / 219');
ok(cnt(TSLA).b === 24 && cnt(TSLA).s === 32 && cnt(TSLA).u === 135, 'TSLA sides: 24 / 32 / 135');
ok(SPY.rows.filter((r) => /[4BW7VP]/.test(r[3])).every((r) => r[4] === 'u') && SPY.rows.filter((r) => /[ZU]/.test(r[3])).every((r) => r[4] === 'l'), 'average-price / contingent prints are never given a side; late reports say so');
ok(D.sideText('b') === 'Likely buy' && D.sideText('s') === 'Likely sell' && D.sideText('u') === 'Unclear' && D.sideText('l') === 'Unclear (late report)' && D.sideText('') === '', 'side wording');

// type of print
ok(D.printType('', Date.UTC(2026, 10, 6, 15), true) === 'Regular block', 'regular block in the session');
ok(D.printType('TB', Date.UTC(2026, 10, 6, 21, 15), true) === 'Average-price trade · after hours', 'average price after hours');
ok(D.printType('@TP', Date.UTC(2026, 10, 6, 21, 0, 13), true) === 'Prior reference price (priced earlier, reported now) · after hours', 'prior reference after hours');
ok(D.printType('4B', Date.UTC(2026, 10, 6, 15)) === 'Derivatively priced (tied to options or swaps) · Average-price trade', 'derivatively priced');
ok(D.printType('7V', Date.UTC(2026, 10, 6, 15)) === 'Contingent trade (paired with another deal)', 'contingent (7 and V once)');
ok(D.printType('Z', Date.UTC(2026, 10, 6, 15)) === 'Late report (original trade time not given)', 'late report');
ok(D.printType('F', Date.UTC(2026, 10, 6, 12), true) === 'Regular block · Intermarket sweep · pre-market', 'ISO in the pre-market');
const seen = new Set(); [SPY, AAPL, TSLA].forEach((pt) => pt.rows.forEach((r) => [...r[3]].forEach((c) => seen.add(c))));
// '@' = regular sale, 'T' = extended hours (said by the session word from the time); every other code gets its own words
const base = D.printType('', Date.UTC(2026, 10, 6, 15));
ok([...seen].every((c) => c === '@' || c === 'T' || D.printType(c, Date.UTC(2026, 10, 6, 15)) !== base) && D.printType('T', Date.UTC(2026, 10, 6, 22)) === 'Regular trade · after hours', 'every condition code in the data is spelled out: ' + [...seen].sort().join(''));

// day context
const top = p2.slice().sort((a, b) => b.v - a.v)[0];
ok(top.k.rank === 1 && top.k.nDay === 982 && Math.abs(top.k.pct - 1500000 / 55274671 * 100) < 1e-9, 'SPY biggest print: rank 1 of 982, 2.7% of the day\'s shares');
ok(Math.abs(top.k.typ - top.v / 1.73e6) / top.k.typ < 0.01, 'size vs the median print ($1.73M)');
const lvl = p2.filter((x) => x.p === 738.36 && !D.offMarket(x.c));
ok(lvl.length === 3 && lvl.every((x) => x.k.lvl && x.k.lvl.n === 3 && Math.round(x.k.lvl.v / 1e6) === 162), 'SPY 3 prints at 738.36 = $162M level');
const rows = D.detailRows(lvl[0]);
ok(rows.some((r) => r[0] === 'Level' && r[1] === '3 prints at 738.36 · $162M') && rows.some((r) => r[0] === 'Day VWAP' && r[1] === '0.03% above'), 'card detail rows ' + JSON.stringify(rows));
ok(D.detailRows({ k: { rank: 2, nDay: 9, pct: 0.04, typ: 3.21, lvl: null, vw: null }, p: 1 }).map((r) => r[1]).join('|') === '<0.1% of shares|3.2× typical print|2nd biggest of 9', 'small % / ordinal');

// levels
const L = D.levels(M.prints(AAPL, 1e6), 25e6);
ok(L.length === 1 && L[0].p === 342.37 && L[0].n === 26, 'AAPL: one level >= $25M (342.37, the 16:00 close: 26 market-price prints; the prior-reference prints there are left out) ' + JSON.stringify(L.map((x) => [x.p, x.n, Math.round(x.v / 1e6)])));
ok(D.levels(p2, 25e6).map((x) => x.p).join() === '738.36,737,740.49', 'SPY levels >= $25M: 738.36, 737.00, 740.49');
ok(D.levels(p2, 10e6).length === 29 && D.levels(p2, 100e6).length === 1, 'SPY level counts at $10M / $100M');
ok(D.levels([{ t: 1, p: 5000.1, ep: 700, v: 6e6, c: '', fut: 'ES' }, { t: 2, p: 5000.4, ep: 700, v: 6e6, c: '', fut: 'ES' }], 1e7)[0].p === 5000.25, 'mapped (futures) prints group by the ETF price and draw at the mean mapped price');

// list line + copy rules
const ll = M.listLine(lvl[0]);
ok(/Regular block/.test(ll.text) && /level \$162M/.test(ll.text), 'list second line: ' + ll.side + ' · ' + ll.text);
const all = JSON.stringify(p2.slice(0, 200).map((x) => [M.tipRows(x), M.listLine(x)])) + D.SIDE_NOTE;
ok(!/\blive\b|real-time|realtime|delayed/i.test(all) && !/finra|insight|tradingview/i.test(all), 'no live / vendor words');
ok(!/limit order|market order/i.test(all) && /does not give the side or the order type/.test(D.SIDE_NOTE), 'no order type shown; the note says it is not reported');
console.log(n + ' passed');
