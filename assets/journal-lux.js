// Stryker Trading Academy — Trade Journal: LuxAlgo engine glue
// Depends on: assets/vendor/luxalgo-journal.min.js (window.LuxJournal),
// assets/journal-calc.js (journalComputeDerived), the JOURNAL_* globals.
//
// Two jobs:
//  1. Statement auto-import: hand a raw file to LuxJournal.parseAuto (which
//     recognizes TradeZella, Tradervue, TradingView, MetaTrader, IBKR,
//     ThinkorSwim, NinjaTrader, Tradovate, Webull, DAS and more), rebuild
//     round-trip trades from the fills, and map them into this journal's
//     trade schema. journal-import.js calls luxTryAutoImport() before
//     falling back to its manual column mapper.
//  2. The open Edge Score: map stored trades into the engine's AnnotatedTrade
//     shape and render the documented six-component score on the dashboard.
//
// The engine bundle is MIT (© LuxAlgo Global, LLC) — see the banner in
// assets/vendor/luxalgo-journal.min.js. Everything here degrades gracefully:
// if the bundle failed to load, imports use the manual mapper and the Edge
// panel simply stays hidden.

// Contract multipliers for common futures roots. Fill-level statements carry
// prices in points; without these, a 5-point ES win would import as $5
// instead of $250. Matched on the leading alphabetic root of the symbol
// ("ES 03-24", "MNQZ4", "NQ" all resolve). Unknown roots multiply by 1.
const LUX_FUT_MULTIPLIERS = {
  ES: 50, MES: 5, NQ: 20, MNQ: 2, YM: 5, MYM: 0.5, RTY: 50, M2K: 5,
  CL: 1000, MCL: 100, QM: 500, NG: 10000, QG: 2500,
  GC: 100, MGC: 10, SI: 5000, SIL: 1000, HG: 25000, PL: 50,
  ZB: 1000, ZN: 1000, ZF: 1000, ZT: 2000,
  ZC: 50, ZS: 50, ZW: 50,
  '6E': 125000, '6B': 62500, '6J': 12500000, '6A': 100000, '6C': 100000, M6E: 12500, M6B: 6250
};

// Per-symbol multiplier map for buildRoundTrips, covering exactly the symbols
// present in this import. Longest-prefix match against the table means a
// contract code's month/year suffix falls away naturally: "MNQZ4" tries
// MNQZ, then MNQ (hit); "ES 03-24" tokenizes to "ES" directly.
function luxMultipliersFor(executions){
  const out = {};
  executions.forEach((e) => {
    if (out[e.symbol] !== undefined) return;
    const s = String(e.symbol || '').toUpperCase();
    const token = (s.split(/[\s._-]/)[0] || s).replace(/\d+$/, '');
    let mult;
    for (let cut = token.length; cut >= 1 && mult === undefined; cut--) {
      mult = LUX_FUT_MULTIPLIERS[token.slice(0, cut)];
    }
    if (mult !== undefined) out[e.symbol] = mult;
  });
  return out;
}

// A round trip from the engine → this journal's stored trade shape.
function luxTripToTrade(trip, formatLabel){
  const d = new Date(trip.openedAt);
  const pad = (n) => String(n).padStart(2, '0');
  const r2 = (v) => (v === null || v === undefined || !isFinite(v)) ? null : Math.round(v * 100) / 100;
  const trade = {
    date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
    time: pad(d.getHours()) + ':' + pad(d.getMinutes()),
    instrument: String(trip.symbol || 'IMPORTED').toUpperCase().slice(0, 20),
    direction: trip.direction === 'short' ? 'short' : 'long',
    entryPrice: r2(trip.avgEntry),
    exitPrice: trip.avgExit !== undefined ? r2(trip.avgExit) : null,
    positionSize: trip.quantity,
    fees: r2(trip.fees) || 0,
    stopLoss: null,
    takeProfit: null,
    setup: '',
    session: '',
    account: '',
    tags: [],
    notes: '',
    imported: true,
    importFormat: formatLabel || ''
  };
  const balance = (typeof JOURNAL_SETTINGS !== 'undefined' && JOURNAL_SETTINGS && JOURNAL_SETTINGS.accountBalance) || 0;
  const derived = journalComputeDerived(trade, balance);
  // The engine's net P&L is authoritative (it already reconciled statement
  // P&L and applied contract multipliers); the price-difference recompute
  // in journalComputeDerived can't know about multipliers.
  derived.pnl = r2(trip.netPnl);
  derived.result = derived.pnl > 0 ? 'Win' : (derived.pnl < 0 ? 'Loss' : 'Breakeven');
  if (derived.riskAmount) derived.rMultiple = derived.pnl / derived.riskAmount;
  return Object.assign(trade, derived);
}

// Try the engine on a raw statement file. Returns null when the format isn't
// recognized (caller falls back to the manual column mapper), otherwise
// { formatLabel, trades, openSkipped, warnings }.
function luxTryAutoImport(text, fileName){
  if (typeof LuxJournal === 'undefined' || !LuxJournal) return null;
  let tz = 'UTC';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) {}
  let parsed = null;
  try {
    parsed = LuxJournal.parseAuto(text, { timeZone: tz, fileName: fileName || undefined });
    if (parsed && parsed.needsSymbol) {
      const sym = window.prompt('This export doesn\'t name its instrument. Which symbol are these trades for? (e.g. NQ, EURUSD)');
      if (!sym) return null;
      parsed = LuxJournal.parseAuto(text, { timeZone: tz, fileName: fileName || undefined, symbol: sym.trim().toUpperCase() });
    }
  } catch (e) {
    console.error('Stryker: statement auto-parse failed, falling back to mapper', e);
    return null;
  }
  if (!parsed || !parsed.executions || !parsed.executions.length) return null;
  if (parsed.errors && parsed.errors.length) {
    console.warn('Stryker: parser reported blocking errors', parsed.errors);
    return null;
  }

  const execs = parsed.executions.map((e, i) => Object.assign({ id: 'imp' + i, accountId: 'stryker', source: 'import' }, e));
  let trips;
  try {
    trips = LuxJournal.buildRoundTrips(execs, { method: 'fifo', multipliers: luxMultipliersFor(execs) });
  } catch (e) {
    console.error('Stryker: round-trip build failed, falling back to mapper', e);
    return null;
  }
  const closed = trips.filter((t) => t.status !== 'open');
  if (!closed.length) return null;

  const fmt = (LuxJournal.FORMATS.find((f) => f.id === parsed.format) || {}).label || parsed.format;
  return {
    formatLabel: fmt,
    trades: closed.map((t) => luxTripToTrade(t, parsed.format)).filter((t) => t.pnl !== null && t.pnl !== undefined),
    openSkipped: trips.length - closed.length,
    warnings: parsed.warnings || [],
    skippedRows: parsed.skippedRows || 0
  };
}

// ---- Edge Score panel (dashboard) -------------------------------------------

// Stored trades → the engine's AnnotatedTrade shape. Manual entries have no
// fill-level data, so each becomes a minimal closed round trip carrying its
// own net P&L; stops become annotations so R statistics keep working.
function luxTradesToAnnotated(trades){
  return (trades || [])
    .filter((t) => t.pnl !== null && t.pnl !== undefined && t.date)
    .map((t, i) => {
      const iso = t.date + 'T' + (t.time || '00:00') + ':00';
      const fees = parseFloat(t.fees) || 0;
      const qty = parseFloat(t.positionSize) || 1;
      const entry = parseFloat(t.entryPrice) || 0;
      const trip = {
        key: t.id || ('t' + i),
        accountId: 'stryker',
        symbol: t.instrument || '—',
        direction: t.direction === 'short' ? 'short' : 'long',
        status: t.pnl > 0 ? 'win' : (t.pnl < 0 ? 'loss' : 'breakeven'),
        openedAt: iso,
        closedAt: iso,
        quantity: qty,
        openQuantity: 0,
        avgEntry: entry,
        avgExit: parseFloat(t.exitPrice) || undefined,
        grossPnl: t.pnl + fees,
        fees: fees,
        netPnl: t.pnl,
        executionCount: 2,
        executionIds: [],
        exits: []
      };
      const stop = parseFloat(t.stopLoss);
      if (isFinite(stop) && stop > 0) trip.annotations = { stopLoss: stop };
      return trip;
    });
}

function luxEdgeGrade(score){
  if (score >= 80) return ['A', 'Elite edge'];
  if (score >= 65) return ['B', 'Solid edge'];
  if (score >= 50) return ['C', 'Developing'];
  if (score >= 35) return ['D', 'Fragile'];
  return ['E', 'No edge yet'];
}

function jzRenderEdge(trades, currency){
  const host = document.getElementById('jz-edge');
  if (!host) return;
  if (typeof LuxJournal === 'undefined' || !LuxJournal) { host.style.display = 'none'; return; }

  let tz = 'UTC';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) {}
  const annotated = luxTradesToAnnotated(trades);
  if (annotated.length < 5) { host.style.display = 'none'; return; }

  let metrics, edge;
  try {
    metrics = LuxJournal.computeMetrics(annotated, {
      timeZone: tz,
      initialBalance: (typeof JOURNAL_SETTINGS !== 'undefined' && JOURNAL_SETTINGS && JOURNAL_SETTINGS.accountBalance) || undefined
    });
    edge = LuxJournal.computeEdgeScore(metrics);
  } catch (e) {
    console.error('Stryker: edge score failed', e);
    host.style.display = 'none';
    return;
  }
  if (edge.score === null) { host.style.display = 'none'; return; }

  const COMP = [
    ['winRate', 'Win rate'],
    ['profitFactor', 'Profit factor'],
    ['avgWinLoss', 'Avg win / loss'],
    ['drawdown', 'Drawdown control'],
    ['recovery', 'Recovery'],
    ['consistency', 'Consistency']
  ];
  const grade = luxEdgeGrade(edge.score);
  const pf = metrics.profitFactorIsInfinite ? '∞' : (metrics.profitFactor === null ? '—' : metrics.profitFactor.toFixed(2));
  const exp = metrics.expectancy === null ? '—' : journalFormatCurrency(metrics.expectancy, currency);

  host.style.display = '';
  host.innerHTML =
    '<div class="jz-edge-head">' +
      '<div>' +
        '<div class="jz-hero-label">Edge Score <span class="jz-edge-open">open formula v' + LuxJournal.EDGE_SCORE_VERSION + '</span></div>' +
        '<div class="jz-edge-score">' + Math.round(edge.score) + '<span>/100</span></div>' +
        '<div class="jz-edge-grade">' + grade[0] + ' · ' + grade[1] + '</div>' +
      '</div>' +
      '<div class="jz-edge-facts">' +
        '<div><span>Profit factor</span><b>' + pf + '</b></div>' +
        '<div><span>Expectancy / trade</span><b>' + exp + '</b></div>' +
        '<div><span>Max drawdown</span><b>' + journalFormatCurrency(-Math.abs(metrics.maxDrawdown), currency) + '</b></div>' +
        '<div><span>Streak</span><b>' + (metrics.currentStreak > 0 ? metrics.currentStreak + 'W' : (metrics.currentStreak < 0 ? (-metrics.currentStreak) + 'L' : '—')) + '</b></div>' +
      '</div>' +
    '</div>' +
    '<div class="jz-edge-bars">' +
      COMP.map(function(c){
        const v = Math.round(edge.components[c[0]]);
        return '<div class="jz-edge-bar">' +
          '<span class="jeb-name">' + c[1] + '</span>' +
          '<span class="jeb-track"><i style="width:' + v + '%"></i></span>' +
          '<span class="jeb-val">' + v + '</span>' +
        '</div>';
      }).join('') +
    '</div>' +
    '<p class="gm-fineprint" style="margin:10px 0 0;">Documented, versioned formula from the open-source LuxAlgo journal engine — six components, fixed weights, no black box.</p>';
}
