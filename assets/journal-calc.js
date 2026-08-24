// Stryker Trading Academy — Trade Journal: calculations & defaults
// Pure functions, no DOM/Firestore dependency — safe to unit-reason-about
// and reused by every journal tab (dashboard, form, history, analytics).

// ---- Default settings, seeded the first time a student opens the journal ----
// The ICT/SMC setup list is exactly what was requested — fully editable
// afterward from the Settings tab, this is just the starting point.
const JOURNAL_DEFAULT_SETUPS = [
  'FVG', 'IFVG', 'Order Block', 'Liquidity Sweep', 'MSS', 'CISD', 'SMT', 'Judas Swing', 'Silver Bullet'
];
const JOURNAL_DEFAULT_INSTRUMENTS = ['NQ', 'ES', 'YM', 'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY'];
const JOURNAL_DEFAULT_SESSIONS = ['Asia', 'London', 'New York AM', 'New York PM', 'London/NY Overlap'];
const JOURNAL_DEFAULT_TAGS = ['A+ setup', 'Revenge trade', 'FOMO', 'Plan followed', 'Plan broken'];

function journalDefaultSettings(){
  return {
    instruments: JOURNAL_DEFAULT_INSTRUMENTS.slice(),
    setups: JOURNAL_DEFAULT_SETUPS.slice(),
    sessions: JOURNAL_DEFAULT_SESSIONS.slice(),
    tags: JOURNAL_DEFAULT_TAGS.slice(),
    defaultRiskPercent: 1,
    accountBalance: 10000,
    currency: 'USD'
  };
}

// ---- Per-trade calculations ----
// A trade object is expected to have: direction ('long'|'short'), entryPrice,
// exitPrice, positionSize, stopLoss (optional), takeProfit (optional), fees
// (optional, default 0). All numeric fields may be null/undefined/NaN if not
// yet entered — every function here tolerates that and returns null rather
// than NaN, so the UI can show a dash instead of "NaN" while a form is
// mid-entry.

function toNum(v){
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// Realized P&L in account currency.
function journalCalcPnl(trade){
  const entry = toNum(trade.entryPrice);
  const exit = toNum(trade.exitPrice);
  const size = toNum(trade.positionSize);
  if (entry === null || exit === null || size === null) return null;
  const fees = toNum(trade.fees) || 0;
  const raw = trade.direction === 'short' ? (entry - exit) * size : (exit - entry) * size;
  return raw - fees;
}

// Dollar amount at risk, from entry to stop loss, at the trade's size.
function journalCalcRiskAmount(trade){
  const entry = toNum(trade.entryPrice);
  const stop = toNum(trade.stopLoss);
  const size = toNum(trade.positionSize);
  if (entry === null || stop === null || size === null) return null;
  return Math.abs(entry - stop) * size;
}

// Risk as a % of the account balance the risk amount represents.
function journalCalcRiskPercent(trade, accountBalance){
  const riskAmount = journalCalcRiskAmount(trade);
  const balance = toNum(accountBalance);
  if (riskAmount === null || !balance) return null;
  return (riskAmount / balance) * 100;
}

// Realized R-multiple: how many "R" (units of risk) the trade actually made
// or lost. Requires a stop loss to define what 1R was.
function journalCalcRMultiple(trade){
  const pnl = journalCalcPnl(trade);
  const riskAmount = journalCalcRiskAmount(trade);
  if (pnl === null || !riskAmount) return null;
  return pnl / riskAmount;
}

// Planned reward-to-risk ratio, from the stop loss and take profit set
// before the trade — distinct from the realized R-multiple above.
function journalCalcPlannedRR(trade){
  const entry = toNum(trade.entryPrice);
  const stop = toNum(trade.stopLoss);
  const target = toNum(trade.takeProfit);
  if (entry === null || stop === null || target === null) return null;
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (!risk) return null;
  return reward / risk;
}

function journalCalcResult(trade){
  const pnl = journalCalcPnl(trade);
  if (pnl === null) return null;
  if (pnl > 0) return 'Win';
  if (pnl < 0) return 'Loss';
  return 'Breakeven';
}

// Computes every derived field at once — this is what gets stored alongside
// the raw inputs when a trade is saved, so history/dashboard/analytics never
// have to re-derive from scratch (and so a later change to account balance
// doesn't retroactively rewrite historical risk% — it's captured at save time).
function journalComputeDerived(trade, accountBalance){
  return {
    pnl: journalCalcPnl(trade),
    riskAmount: journalCalcRiskAmount(trade),
    riskPercent: journalCalcRiskPercent(trade, accountBalance),
    rMultiple: journalCalcRMultiple(trade),
    plannedRR: journalCalcPlannedRR(trade),
    result: journalCalcResult(trade)
  };
}

// ---- Aggregate stats across a list of trades (for Dashboard/Analytics) ----
function journalAggregateStats(trades){
  const closed = trades.filter((t) => t.pnl !== null && t.pnl !== undefined);
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl < 0);
  const totalPnl = closed.reduce((sum, t) => sum + t.pnl, 0);
  const grossWin = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);

  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    totalPnl, winCount: wins.length, lossCount: losses.length,
    avgWin, avgLoss, winRate, profitFactor, grossWin, grossLoss
  };
}

function journalDateInRange(dateStr, fromDate){
  if (!dateStr) return false;
  return new Date(dateStr + 'T00:00:00') >= fromDate;
}

function journalStatsForPeriod(trades, days){
  if (days === null) return journalAggregateStats(trades);
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - days + 1);
  return journalAggregateStats(trades.filter((t) => journalDateInRange(t.date, from)));
}

function journalFormatCurrency(amount, currency){
  if (amount === null || amount === undefined || isNaN(amount)) return '—';
  const sym = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }[currency] || (currency ? currency + ' ' : '$');
  const sign = amount < 0 ? '-' : '';
  return sign + sym + Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
