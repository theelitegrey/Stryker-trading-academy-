// Node unit tests for assets/paper-review-stats.js (Trade review + leaderboard maths, Owner order
// 2026-10-14) and the review fields the paper engine now records (sl0, MAE/MFE, run, src, lev).
//   node tools/tests/paper-review-stats.test.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const S = require(path.join(__dirname, '..', '..', 'assets', 'paper-review-stats.js'));
const PE = require(path.join(__dirname, '..', '..', 'assets', 'paper-engine.js'));

let n = 0, fail = 0;
function t(name, fn) { n++; try { fn(); console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n   ' + (e && e.stack || e)); } }
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= (eps || 1e-9), (msg || '') + ' ' + a + ' != ' + b);

const T0 = Date.parse('2026-10-07T14:00:00Z');   // Wed 10:00 New York
const MIN = 60000;
// NQ: point value 20. A long 1 @ 100 with stop 90 risks $200.
function tr(id, pnlPts, o) {
  o = o || {};
  const entry = o.entry != null ? o.entry : 100, qty = o.qty || 1, pv = o.pv || 20, side = o.side || 'buy';
  const exit = entry + (side === 'buy' ? pnlPts : -pnlPts);
  const at = o.at != null ? o.at : T0 + id * 10 * MIN;
  return Object.assign({ id, symbol: 'futures:NQ1!', side, qty, entry, exit, entryAt: at, exitAt: at + (o.hold != null ? o.hold : 5 * MIN),
    gross: pnlPts * qty * pv, fees: 0, pnl: pnlPts * qty * pv, sl0: o.sl0 !== undefined ? o.sl0 : (side === 'buy' ? entry - 10 : entry + 10),
    pointValue: pv, run: o.run != null ? o.run : 0, lev: o.lev != null ? o.lev : 1 }, o.extra || {});
}

t('R multiple from the FIRST stop: +20 pts on 10 pts risk = 2R, -10 = -1R, no stop = null', () => {
  assert.strictEqual(S.rOf(tr(1, 20)), 2);
  assert.strictEqual(S.rOf(tr(2, -10)), -1);
  assert.strictEqual(S.rOf(tr(3, 5, { side: 'sell' })), 0.5);
  assert.strictEqual(S.rOf(tr(4, 5, { sl0: null })), null);
  assert.strictEqual(S.riskOf(tr(5, 5, { qty: 3 })), 600);
  // a stop moved to break-even later does not change the risk the trade was taken with
  assert.strictEqual(S.rOf(Object.assign(tr(6, 20), { sl: 100 })), 2);
});

t('stats: win rate, expectancy, avg R, profit factor, best/worst', () => {
  const list = [tr(1, 20), tr(2, -10), tr(3, 10), tr(4, -10), tr(5, 0)];  // $ +400 -200 +200 -200 0
  const s = S.stats(list, 100000);
  assert.strictEqual(s.trades, 5); assert.strictEqual(s.wins, 2); assert.strictEqual(s.losses, 2); assert.strictEqual(s.scratches, 1);
  assert.strictEqual(s.winRate, 50);                  // scratches are neither
  assert.strictEqual(s.net, 200);
  assert.strictEqual(s.expectancy, 40);               // 200 / 5
  assert.strictEqual(s.avgR, 0.2);                    // (2 -1 +1 -1 +0) / 5
  assert.strictEqual(s.profitFactor, 1.5);            // 600 / 400
  assert.strictEqual(s.best.id, 1); assert.strictEqual(s.worst.pnl, -200);
  assert.strictEqual(s.endBalance, 100200);
  assert.strictEqual(s.returnPct, 0.2);
  assert.strictEqual(S.stats([tr(1, 5)], 1000).profitFactor, null);  // no loss: no factor
  assert.strictEqual(S.stats([], 5000).trades, 0);
});

t('max drawdown: largest fall from a running peak, $ and % of that peak, in exit order', () => {
  // equity 1000 -> 1400 (+20pts) -> 1200 -> 1000 -> 1600 -> 1300
  const list = [tr(4, 30), tr(1, 20), tr(2, -10), tr(3, -10), tr(5, -15)];
  // sort is by exit time: ids 1..5 -> +400, -200, -200, +600, -300
  const s = S.stats(list, 1000);
  assert.deepStrictEqual(s.equity.map((p) => p.eq), [1000, 1400, 1200, 1000, 1600, 1300]);
  assert.strictEqual(s.maxDD, 400);
  near(s.maxDDPct, 28.57, 0.01, 'dd%');
});

t('sessions by New York entry time (DST aware) and weekdays', () => {
  assert.strictEqual(S.sessionOf(Date.parse('2026-10-07T14:00:00Z')), 'New York');   // 10:00 EDT
  assert.strictEqual(S.sessionOf(Date.parse('2026-10-07T08:00:00Z')), 'London');     // 04:00 EDT
  assert.strictEqual(S.sessionOf(Date.parse('2026-10-07T01:00:00Z')), 'Asia');       // 21:00 EDT Tue
  assert.strictEqual(S.sessionOf(Date.parse('2026-01-07T07:30:00Z')), 'London');     // 02:30 EST
  assert.strictEqual(S.sessionOf(Date.parse('2026-01-07T06:30:00Z')), 'Asia');       // 01:30 EST
  assert.strictEqual(S.weekdayOf(Date.parse('2026-10-07T01:00:00Z')), 'Tue');
  const rows = S.bySession([tr(1, 10, { at: Date.parse('2026-10-07T08:00:00Z') }), tr(2, 10), tr(3, -10)]);
  assert.deepStrictEqual(rows.map((r) => r.key), ['London', 'New York']);
  assert.strictEqual(rows[1].trades, 2);
});

t('groupings by setup and weekday; filters by date, symbol, tag; tag list', () => {
  const a = tr(1, 10, { extra: { setup: 'FVG', mistake: 'Early exit' } }), b = tr(2, -10, { extra: { setup: 'OB', emotion: 'FOMO' } }), c = tr(3, 10, { extra: { setup: 'FVG' } });
  const rows = S.bySetup([a, b, c]);
  assert.strictEqual(rows[0].key, 'FVG'); assert.strictEqual(rows[0].trades, 2); assert.strictEqual(rows[0].winRate, 100);
  assert.strictEqual(S.byWeekday([a, b]).length, 1);
  assert.strictEqual(S.filterTrades([a, b, c], { tag: 'fomo' }).length, 1);
  assert.strictEqual(S.filterTrades([a, b, c], { from: b.exitAt }).length, 2);
  assert.strictEqual(S.filterTrades([a, b, c], { to: b.exitAt }).length, 1);
  assert.strictEqual(S.filterTrades([a, Object.assign({}, b, { symbol: 'binance:BTCUSDT' })], { symbol: 'BTCUSDT' }).length, 1);
  assert.deepStrictEqual(S.tagsOf([a, b, c]).setup, ['FVG', 'OB']);
});

t('CSV: header, disclaimer line, quoting, no spreadsheet formulas from notes', () => {
  const csv = S.toCSV([tr(1, 10, { extra: { note: '=HYPERLINK("x"), "quoted"\nline', setup: 'FVG' } })]);
  const lines = csv.split('\r\n');
  assert.ok(lines[0].startsWith('# Demo account. Simulated results'));
  assert.ok(lines[1].startsWith('id,account,symbol,side'));
  assert.ok(csv.includes('"\'=HYPERLINK(""x""), ""quoted""\nline"'));
  assert.ok(lines[2].includes(',NQ1!,long,1,'));
  assert.ok(lines[2].includes(',2,') || lines[2].includes(',1,'));
});

t('leaderboard eligibility: current run only, replay never, < 5 s excluded, forged P&L excluded', () => {
  const st = { startBalance: 100000, resetAt: 0, trades: [] };
  const now = T0 + 86400000;
  assert.strictEqual(S.eligible(tr(1, 10), st, now), true);
  assert.strictEqual(S.eligible(tr(1, 10, { extra: { src: 'replay' } }), st, now), false);
  assert.strictEqual(S.eligible(tr(1, 10, { hold: 4999 }), st, now), false);
  assert.strictEqual(S.eligible(tr(1, 10, { hold: 5000 }), st, now), true);
  assert.strictEqual(S.eligible(tr(1, 10, { run: 5 }), st, now), false);             // an older run
  assert.strictEqual(S.eligible(Object.assign(tr(1, 10), { pnl: 9999 }), st, now), false);   // pnl does not match prices
  assert.strictEqual(S.eligible(tr(1, 10, { at: now + 3600000 }), st, now), false);  // closes in the future
  // trades saved before runs existed: count when they closed after the last reset
  const old = tr(1, 10); delete old.run;
  assert.strictEqual(S.eligible(old, { resetAt: old.exitAt + 1 }, now), false);
  assert.strictEqual(S.eligible(old, { resetAt: old.entryAt - 1 }, now), true);
});

t('leaderboard score: % return on the start balance, 10-trade minimum, period windows, leverage flag', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');              // Friday
  const trades = [];
  for (let i = 1; i <= 9; i++) trades.push(tr(i, 10));          // 9 x $200 this week
  const st = { startBalance: 100000, resetAt: 0, trades };
  let sc = S.score(st, 'week', now);
  assert.strictEqual(sc.ranked, false); assert.strictEqual(sc.need, 1); assert.strictEqual(sc.trades, 9);
  trades.push(tr(10, -10));
  trades.push(tr(11, 10, { hold: 1000 }));                      // too short, excluded
  trades.push(tr(12, 10, { extra: { src: 'replay' } }));        // replay, excluded
  sc = S.score(st, 'week', now);
  assert.strictEqual(sc.ranked, true); assert.strictEqual(sc.trades, 10);
  assert.strictEqual(sc.returnPct, 1.6);                        // (9*200 - 200) / 100000
  assert.strictEqual(sc.winRate, 90); assert.strictEqual(sc.excluded, 2); assert.strictEqual(sc.flagged, false);
  // last week's trade counts for the month and all time, not this week
  trades.push(tr(13, 50, { at: Date.parse('2026-10-02T14:00:00Z') }));
  assert.strictEqual(S.score(st, 'week', now).returnPct, 1.6);
  assert.strictEqual(S.score(st, 'month', now).returnPct, 2.6);
  assert.strictEqual(S.score(st, 'all', now).trades, 11);
  trades.push(tr(14, 10, { lev: 45 }));
  assert.strictEqual(S.score(st, 'week', now).flagged, true);
  assert.strictEqual(S.periodStart('week', now), Date.parse('2026-10-05T00:00:00Z'));
  assert.strictEqual(S.periodStart('month', now), Date.parse('2026-10-01T00:00:00Z'));
});

t('rank: by % return, ties by smaller drawdown; unranked rows left out', () => {
  const rows = S.rank([{ name: 'a', ranked: true, returnPct: 1, maxDDPct: 2, trades: 10 }, { name: 'b', ranked: true, returnPct: 3, maxDDPct: 2, trades: 10 },
    { name: 'c', ranked: false, returnPct: 9 }, { name: 'd', ranked: true, returnPct: 1, maxDDPct: 1, trades: 10 }]);
  assert.deepStrictEqual(rows.map((r) => r.name + r.rank), ['b1', 'd2', 'a3']);
});

// ---- engine fields ----
let clock = T0;
const deps = (src) => ({ now: () => clock, isOpen: () => true, tickOf: () => 0.01, source: src || '' });
const seg = (o, h, l, c) => ({ t: clock, o, h, l, c });

t('engine: trade keeps the first stop, MAE/MFE from the segments, hold, run, leverage', () => {
  clock = T0;
  const a = PE.PaperAccount.fresh(100000, deps());
  a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1, sl: 20990, tp: 21030 });
  clock += 30000; a.onSegment('futures:NQ1!', seg(21000, 21012, 20994, 21008));
  a.modifyPosition('futures:NQ1!', { sl: 21000 });                 // stop to break-even
  clock += 30000; a.onSegment('futures:NQ1!', seg(21008, 21020, 21003, 21015));
  clock += 30000;
  const ev = a.onSegment('futures:NQ1!', seg(21015, 21031, 21010, 21025));   // TP 21030 hits
  const trade = ev.find((e) => e.trade).trade;
  assert.strictEqual(trade.reason, 'tp');
  assert.strictEqual(trade.sl0, 20990);                            // the risk it was taken with
  assert.strictEqual(trade.sl, 21000);
  assert.strictEqual(trade.mae, 6);                                // low 20994
  assert.strictEqual(trade.mfe, 30);                               // up to the exit price, not the segment high 21031
  assert.strictEqual(S.rOf(trade), 3);                             // +30 pts / 10 pts
  assert.strictEqual(trade.exitAt - trade.entryAt, 90000);
  assert.strictEqual(trade.run, a.state.resetAt);
  near(trade.lev, 4.2, 0.01, 'lev');                               // 21000 * 20 / 100000
  assert.strictEqual(trade.src, undefined);
});

t('engine: replay account trades are tagged src=replay; a stop added after the fill becomes sl0', () => {
  clock = T0;
  const a = PE.PaperAccount.fresh(100000, deps('replay'));
  a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'sell', type: 'market', qty: 2 });
  a.modifyPosition('futures:NQ1!', { sl: 21010 });
  clock += 60000; a.setLast('futures:NQ1!', 20990);
  const ev = a.closePosition('futures:NQ1!');
  const trade = ev.find((e) => e.trade).trade;
  assert.strictEqual(trade.src, 'replay');
  assert.strictEqual(trade.sl0, 21010);
  assert.strictEqual(S.rOf(trade), 1);
  assert.strictEqual(S.eligible(trade, a.state, clock), false);
});

t('engine: reset starts a new run; old trades are gone and new ones carry the new run id', () => {
  clock = T0;
  const a = PE.PaperAccount.fresh(100000, deps());
  a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 });
  clock += 10000; a.setLast('futures:NQ1!', 21001); a.closePosition('futures:NQ1!');
  const run1 = a.state.trades[0].run;
  clock += 60000; a.reset(50000);
  assert.strictEqual(a.state.trades.length, 0);
  a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 });
  clock += 10000; a.setLast('futures:NQ1!', 21002); a.closePosition('futures:NQ1!');
  assert.notStrictEqual(a.state.trades[0].run, run1);
  assert.strictEqual(a.state.trades[0].run, a.state.resetAt);
  // a trade copied in from the old run does not count
  const st = JSON.parse(JSON.stringify(a.state));
  st.trades.unshift(Object.assign({}, st.trades[0], { id: 99, run: run1 }));
  assert.strictEqual(S.score(st, 'all', clock).trades, 1);
});

t('engine: review fields survive a save/load round trip; old positions without them still load', () => {
  clock = T0;
  const a = PE.PaperAccount.fresh(100000, deps());
  a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1, sl: 20990 });
  a.onSegment('futures:NQ1!', seg(21000, 21004, 20997, 21001));
  const b = new PE.PaperAccount(JSON.parse(JSON.stringify(a.state)), deps());
  const p = b.position('futures:NQ1!');
  assert.strictEqual(p.sl0, 20990); assert.strictEqual(p.hi, 21004); assert.strictEqual(p.lo, 20997);
  const raw = JSON.parse(JSON.stringify(a.state));
  for (const k of ['sl0', 'hi', 'lo', 'bal0', 'maxQty']) delete raw.positions['futures:NQ1!'][k];
  const c = new PE.PaperAccount(raw, deps());
  const q = c.position('futures:NQ1!');
  assert.strictEqual(q.sl0, 20990); assert.strictEqual(q.hi, 21000);
  // a trade's review note + tags are kept by sanitize
  a.setLast('futures:NQ1!', 21003); a.closePosition('futures:NQ1!');
  Object.assign(a.state.trades[0], { note: 'waited for the retrace', setup: 'FVG', mistake: '', emotion: 'Calm' });
  const d = new PE.PaperAccount(JSON.parse(JSON.stringify(a.state)), deps());
  assert.strictEqual(d.state.trades[0].note, 'waited for the retrace');
  assert.strictEqual(d.state.trades[0].setup, 'FVG');
});

t('functions copy (when present) is identical to assets/paper-review-stats.js', () => {
  const fn = path.join(__dirname, '..', '..', 'functions-src', 'paper-stats.js');
  if (!fs.existsSync(fn)) return;
  assert.strictEqual(fs.readFileSync(fn, 'utf8'), fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'paper-review-stats.js'), 'utf8'));
});

console.log('\n' + (n - fail) + '/' + n + ' passed');
process.exit(fail ? 1 : 0);
