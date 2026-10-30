// Order-history fixtures for the Rithmic mock and the node tests. SYNTHETIC data, never a real account.
// Each order: { basket, acct, sym, side: 'buy'|'sell', fills: [[qty, price, tsMs, fee?]...] }.
// "set" = what one history day (or today's show-orders) returns for an account.
//
// Expected round trips (gross P&L = points x point value), so the tests can assert exact numbers:
//   APEX-1001, 2026-10-26: MNQ short 2 @ 20050 -> 20040 covered... see TRIPS below.

const UTC = (d, h, m, s = 0) => Date.UTC(2026, 9, d, h, m, s);
let n = 0;
const O = (acct, sym, side, fills, extra) => ({ basket: 'B' + (++n), acct, sym, side, fills, ...(extra || {}) });

export const ACCOUNTS = [
  { id: 'APEX-1001', name: 'Apex 50K eval', currency: 'USD' },
  { id: 'APEX-2002', name: 'Apex 100K funded', currency: 'USD' }
];
export const DATES = ['20261026', '20261027'];

// ---- 2026-10-26 (Mon), APEX-1001: a losing MNQ short with a 1.24 per-contract fee ----
const D26 = [
  O('APEX-1001', 'MNQZ6', 'sell', [[2, 20050, UTC(26, 14, 31), 1.24]]),
  O('APEX-1001', 'MNQZ6', 'buy', [[2, 20060, UTC(26, 14, 40), 1.24]])
];
// ---- 2026-10-27 (Tue), APEX-1001 ----
const D27 = [
  // simple long MNQ: +10 pts x 2 x $2 = +40
  O('APEX-1001', 'MNQZ6', 'buy', [[2, 20000, UTC(27, 14, 30)]]),
  O('APEX-1001', 'MNQZ6', 'sell', [[2, 20010, UTC(27, 14, 35)]]),
  // simple short ES: +5 pts x 1 x $50 = +250
  O('APEX-1001', 'ESZ6', 'sell', [[1, 5000, UTC(27, 15, 0)]]),
  O('APEX-1001', 'ESZ6', 'buy', [[1, 4995, UTC(27, 15, 20)]]),
  // scale in / scale out NQ: buy 1@20000, buy 1@20010, sell 1@20020, sell 1@20030
  //   FIFO: (20020-20000) + (20030-20010) = 40 pts x $20 = +800
  O('APEX-1001', 'NQZ6', 'buy', [[1, 20000, UTC(27, 16, 0)]]),
  O('APEX-1001', 'NQZ6', 'buy', [[1, 20010, UTC(27, 16, 2)]]),
  O('APEX-1001', 'NQZ6', 'sell', [[1, 20020, UTC(27, 16, 10)]]),
  O('APEX-1001', 'NQZ6', 'sell', [[1, 20030, UTC(27, 16, 12)]]),
  // flip on MNQ: long 2 @ 20100, one sell of 3 @ 20110 (closes the long: +10 x 2 x $2 = +40, opens short 1),
  //   then buy 1 @ 20100 closes the short: +10 x 1 x $2 = +20
  O('APEX-1001', 'MNQZ6', 'buy', [[2, 20100, UTC(27, 17, 0)]]),
  O('APEX-1001', 'MNQZ6', 'sell', [[3, 20110, UTC(27, 17, 5)]]),
  O('APEX-1001', 'MNQZ6', 'buy', [[1, 20100, UTC(27, 17, 9)]]),
  // partial fills: one buy order of 3 filled in three pieces, then one sell of 3
  //   avg entry (20200 + 20201 + 20202)/3 = 20201; exit 20205 -> +4 pts x 3 x $2 = +24
  O('APEX-1001', 'MNQZ6', 'buy', [[1, 20200, UTC(27, 18, 0)], [1, 20201, UTC(27, 18, 0, 2)], [1, 20202, UTC(27, 18, 0, 5)]]),
  O('APEX-1001', 'MNQZ6', 'sell', [[3, 20205, UTC(27, 18, 20)]]),
  // a position still open at the end of the day (not importable): 1 ES long
  O('APEX-1001', 'ESZ6', 'buy', [[1, 5010, UTC(27, 19, 55)]]),
  // account 2: MES long 1 @ 5000 -> 5004: +4 x $5 = +20
  O('APEX-2002', 'MESZ6', 'buy', [[1, 5000, UTC(27, 15, 5)]]),
  O('APEX-2002', 'MESZ6', 'sell', [[1, 5004, UTC(27, 15, 25)]])
];
// ---- "today" (RequestShowOrders) APEX-1001: one winning NQ long, +5 pts x 1 x $20 = +100 ----
const TODAY = [
  O('APEX-1001', 'NQZ6', 'buy', [[1, 20300, UTC(28, 14, 30)]]),
  O('APEX-1001', 'NQZ6', 'sell', [[1, 20305, UTC(28, 14, 50)]])
];

export const SETS = {
  'APEX-1001': { '20261026': D26.filter((o) => o.acct === 'APEX-1001'), '20261027': D27.filter((o) => o.acct === 'APEX-1001'), today: TODAY },
  'APEX-2002': { '20261027': D27.filter((o) => o.acct === 'APEX-2002') }
};
// PnL snapshot "day closed P&L" for today (gross): +100 on APEX-1001
export const PNL_TODAY = { 'APEX-1001': 100, 'APEX-2002': 0 };

// Expected gross P&L per closed trip, in time order, per account (the test asserts these exactly).
export const EXPECTED_1027_A1 = [
  { symbol: 'MNQZ6', direction: 'long', quantity: 2, avgEntry: 20000, avgExit: 20010, grossPnl: 40 },
  { symbol: 'ESZ6', direction: 'short', quantity: 1, avgEntry: 5000, avgExit: 4995, grossPnl: 250 },
  { symbol: 'NQZ6', direction: 'long', quantity: 2, avgEntry: 20005, avgExit: 20025, grossPnl: 800 },
  { symbol: 'MNQZ6', direction: 'long', quantity: 2, avgEntry: 20100, avgExit: 20110, grossPnl: 40 },
  { symbol: 'MNQZ6', direction: 'short', quantity: 1, avgEntry: 20110, avgExit: 20100, grossPnl: 20 },
  { symbol: 'MNQZ6', direction: 'long', quantity: 3, avgEntry: 20201, avgExit: 20205, grossPnl: 24 }
];
export const EXPECTED_1026_A1 = [{ symbol: 'MNQZ6', direction: 'short', quantity: 2, avgEntry: 20050, avgExit: 20060, grossPnl: -40, fees: 4.96, netPnl: -44.96 }];
