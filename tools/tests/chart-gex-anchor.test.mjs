// GEX audit 2026-10-13: futures basis re-anchor for the Charts "TradeZoro GEX Levels" indicator.
// Pure node, no browser, no network:  node tools/tests/chart-gex-anchor.test.mjs
// Uses the real QQQ 0DTE response saved in tools/tests/fixtures/gex/QQQ-0.json and synthetic
// 1-minute bars. Checks anchorShift() and that buildLevels() moves only the futures-converted
// GEX levels (never the session levels) by exactly the shift.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { anchorShift, buildLevels } from '../../assets/chart-gex-levels.js';

const QQQ = JSON.parse(fs.readFileSync(new URL('./fixtures/gex/QQQ-0.json', import.meta.url)));
const open = (d, ts) => Object.assign({}, d, { market: Object.assign({}, d.market, { state: 'open', options_ts: ts }) });
const F = QQQ.futures.NQ;
const T = 1791910000;                       // options time
// last bar CLOSED by T opens at t0 = T - 90 (closes T - 30); the bar holding T (still forming) is ignored
const bars = (close, t0 = T - 90) => [[t0 - 120, 1, 1, 1, close - 7, 1], [t0 - 60, 1, 1, 1, close - 3, 1], [t0, 1, 1, 1, close, 1], [t0 + 60, 1, 1, 1, close + 50, 1]];
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };

// shift = chart 1m close of the bar holding the options time - API futures price
const d = open(QQQ, T);
ok(anchorShift(d, 'NQ', bars(F.futures_price - 30.25)) === -30.25, 'shift = chart close at options time - API futures price (-30.25)');
ok(anchorShift(d, 'NQ', bars(F.futures_price + 4.5)) === 4.5, 'positive shift (+4.5)');
// later bars (after the options time) are ignored
ok(anchorShift(d, 'NQ', bars(F.futures_price)) === 0, 'forming bar (holding the options time) ignored');
// no usable bar -> null (API conversion kept)
ok(anchorShift(d, 'NQ', bars(F.futures_price, T - 600)) === null, 'last closed bar ended over 2 min before options time -> null');
ok(anchorShift(d, 'NQ', []) === null, 'no bars -> null');
ok(anchorShift(open(QQQ, null), 'NQ', bars(F.futures_price - 5)) === null, 'no options time -> null');
ok(anchorShift(Object.assign({}, d, { market: Object.assign({}, d.market, { state: 'cash_closed' }) }), 'NQ', bars(F.futures_price - 5)) === null, 'market not open -> null');
ok(anchorShift(d, 'NQ', bars(F.futures_price * 1.05)) === null, 'shift > 3% treated as bad data -> null');
ok(anchorShift(d, 'ES', bars(100)) === null, 'no futures block -> null');

// buildLevels: futures GEX levels move by the shift; session levels do not
const src = { api: 'QQQ', fut: 'NQ', label: 'NQ (from QQQ)', pro: true };
const base = buildLevels(QQQ, src, {});
const moved = buildLevels(QQQ, src, {}, -30.25);
const get = (o, id) => o.lines.find((l) => l.id === id);
for (const id of ['call', 'zero', 'put', 'ivhi', 'ivlo']) {
  ok(Math.abs(get(moved, id).price - (get(base, id).price - 30.25)) < 0.011, id + ' shifted by -30.25 (' + get(base, id).price + ' -> ' + get(moved, id).price + ')');
}
for (const id of ['vah', 'poc', 'val', 'onh', 'onl']) {
  ok(get(moved, id).price === get(base, id).price, id + ' (session level) not shifted');
}
ok(moved.shift === -30.25 && base.shift === 0, 'shift reported on the output');
// strikes extra follows the same shift
const sb = buildLevels(QQQ, src, { showStrikes: true }), sm = buildLevels(QQQ, src, { showStrikes: true }, 10);
ok(sb.lines.filter((l) => /^strike/.test(l.id)).every((l) => Math.abs(sm.lines.find((x) => x.id === l.id).price - (l.price + 10)) < 0.011), 'GEX strike lines shifted too');
// index chart (no futures): shift ignored
const spx = buildLevels(QQQ, { api: 'QQQ', fut: null, label: 'QQQ', pro: true }, {}, 12);
ok(get(spx, 'call').price === QQQ.call_wall && spx.shift === 0, 'index/ETF chart: shift ignored');
console.log(n + ' checks, ALL PASS');
