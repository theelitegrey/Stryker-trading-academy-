/**
 * TradeZoro — Paper trading REVIEW maths (pure, no DOM, no network)
 *
 * Owner order 2026-10-14: "Paper trading leaderboard + trade review". This file turns the closed
 * trades of a paper account (assets/paper-engine.js state.trades) into the numbers the Trade
 * review shows (assets/paper-review.js) and, for the opt-in leaderboard, the per-period score.
 * The same file is copied byte for byte to functions-src/paper-stats.js for the leaderboard job
 * (tools/tests/paper-review-stats.test.js asserts the two copies are identical).
 *
 * DEMO MONEY ONLY: every number here is a SIMULATED result of the member's own paper account.
 * Demo account. Simulated results, not real trading. Education only. Not financial advice.
 *
 * Definitions (one place, so the review and the leaderboard agree):
 *   R multiple   pnl / risk, risk = |entry - first stop loss| x qty x point value. No stop = no R.
 *   MAE / MFE    worst / best price excursion while open, in price points (engine fields mae/mfe),
 *                also shown in R when the trade has a stop.
 *   hold         exitAt - entryAt.
 *   session      by the ENTRY time in New York: Asia 17:00-02:00, London 02:00-08:00,
 *                New York 08:00-17:00 (ET, daylight saving handled by Intl).
 *   weekday      New York weekday of the entry.
 *   win          pnl > 0 (a zero trade is a scratch: counted, neither win nor loss).
 *   expectancy   average P&L per trade in $ (and the average R for trades with a stop).
 *   profit factor  gross profit / gross loss (null when there is no losing trade).
 *   max drawdown largest fall from a running equity peak, in $ and % of that peak; equity starts at
 *                the account's starting balance and adds trades in exit order.
 * Leaderboard eligibility (anti-gaming):
 *   - only the CURRENT run counts: a reset starts a new run (trade.run == state.resetAt; trades
 *     saved before runs existed count when they closed after the last reset);
 *   - bar-replay trades never count (trade.src == 'replay'; the replay account is also never
 *     saved to the cloud);
 *   - trades held under 5 seconds are excluded;
 *   - a trade whose size was over LEV_FLAG x the balance (notional / balance) flags the row;
 *   - at least MIN_TRADES eligible closed trades in the period to be ranked.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PaperReviewStats = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const MIN_HOLD_MS = 5000;
  const MIN_TRADES = 10;
  const LEV_FLAG = 20;
  const SESSIONS = ['Asia', 'London', 'New York'];
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DISCLAIMER = 'Demo account. Simulated results, not real trading. Education only. Not financial advice.';

  const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const r2 = (n) => Math.round(n * 100) / 100;

  let nyFmt = null;
  function nyParts(ms) {
    if (!nyFmt) nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23', weekday: 'short' });
    const out = {};
    for (const p of nyFmt.formatToParts(new Date(ms))) out[p.type] = p.value;
    return { hour: Number(out.hour) % 24, weekday: out.weekday };
  }
  function sessionOf(ms) {
    if (!Number.isFinite(ms)) return null;
    const h = nyParts(ms).hour;
    if (h >= 2 && h < 8) return 'London';
    if (h >= 8 && h < 17) return 'New York';
    return 'Asia';
  }
  function weekdayOf(ms) { return Number.isFinite(ms) ? nyParts(ms).weekday : null; }

  function riskOf(t) {
    const sl = num(t.sl0) != null ? num(t.sl0) : num(t.sl);
    const entry = num(t.entry), qty = num(t.qty), pv = num(t.pointValue) || 1;
    if (sl == null || entry == null || !(qty > 0)) return null;
    const risk = Math.abs(entry - sl) * qty * pv;
    return risk > 0 ? risk : null;
  }
  function rOf(t) { const risk = riskOf(t); return risk ? r2(num(t.pnl) / risk) : null; }
  function excursionR(t, pts) {
    const sl = num(t.sl0) != null ? num(t.sl0) : num(t.sl), entry = num(t.entry);
    if (sl == null || entry == null || pts == null) return null;
    const d = Math.abs(entry - sl); return d > 0 ? r2(pts / d) : null;
  }
  function holdOf(t) { const a = num(t.entryAt), b = num(t.exitAt); return a != null && b != null ? Math.max(0, b - a) : null; }

  /** One closed trade -> the row the review shows. */
  function enrich(t) {
    const pnl = num(t.pnl) || 0;
    return Object.assign({}, t, {
      pnl, r: rOf(t), risk: riskOf(t), hold: holdOf(t), session: sessionOf(num(t.entryAt)), weekday: weekdayOf(num(t.entryAt)),
      maeR: excursionR(t, num(t.mae)), mfeR: excursionR(t, num(t.mfe)),
      outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'scratch'
    });
  }

  function emptyStats(start) {
    return { trades: 0, wins: 0, losses: 0, scratches: 0, winRate: null, net: 0, grossProfit: 0, grossLoss: 0, avgWin: null, avgLoss: null,
      expectancy: null, avgR: null, rTrades: 0, profitFactor: null, maxDD: 0, maxDDPct: 0, best: null, worst: null, avgHold: null,
      startBalance: start, endBalance: start, returnPct: 0, equity: [] };
  }
  /**
   * stats(trades, startBalance): summary over closed trades (any order; sorted by exit time here).
   * equity = [{ t, eq, id }] starting with the start balance.
   */
  function stats(trades, startBalance) {
    const start = num(startBalance) > 0 ? num(startBalance) : 100000;
    const list = (trades || []).map(enrich).sort((a, b) => (num(a.exitAt) || 0) - (num(b.exitAt) || 0) || (num(a.id) || 0) - (num(b.id) || 0));
    const s = emptyStats(start);
    if (!list.length) { s.equity = [{ t: null, eq: start }]; return s; }
    let eq = start, peak = start, rSum = 0, holdSum = 0, holdN = 0;
    s.equity.push({ t: num(list[0].entryAt), eq: start });
    for (const t of list) {
      s.trades++;
      if (t.pnl > 0) { s.wins++; s.grossProfit += t.pnl; } else if (t.pnl < 0) { s.losses++; s.grossLoss += -t.pnl; } else s.scratches++;
      if (t.r != null) { rSum += t.r; s.rTrades++; }
      if (t.hold != null) { holdSum += t.hold; holdN++; }
      if (!s.best || t.pnl > s.best.pnl) s.best = t;
      if (!s.worst || t.pnl < s.worst.pnl) s.worst = t;
      eq += t.pnl;
      s.equity.push({ t: num(t.exitAt), eq: r2(eq), id: t.id });
      if (eq > peak) peak = eq;
      const dd = peak - eq;
      if (dd > s.maxDD) s.maxDD = dd;
      const ddp = peak > 0 ? dd / peak * 100 : 0;
      if (ddp > s.maxDDPct) s.maxDDPct = ddp;
    }
    s.net = r2(s.grossProfit - s.grossLoss);
    s.grossProfit = r2(s.grossProfit); s.grossLoss = r2(s.grossLoss);
    s.maxDD = r2(s.maxDD); s.maxDDPct = r2(s.maxDDPct);
    const decided = s.wins + s.losses;
    s.winRate = decided ? r2(s.wins / decided * 100) : null;
    s.avgWin = s.wins ? r2(s.grossProfit / s.wins) : null;
    s.avgLoss = s.losses ? r2(-s.grossLoss / s.losses) : null;
    s.expectancy = r2(s.net / s.trades);
    s.avgR = s.rTrades ? r2(rSum / s.rTrades) : null;
    s.profitFactor = s.grossLoss > 0 ? r2(s.grossProfit / s.grossLoss) : null;
    s.avgHold = holdN ? Math.round(holdSum / holdN) : null;
    s.endBalance = r2(eq);
    s.returnPct = r2((eq - start) / start * 100);
    return s;
  }

  /** Group closed trades by a key function -> [{ key, trades, winRate, net, avgR, expectancy }]. */
  function groupBy(trades, keyFn, order) {
    const m = new Map();
    for (const t of (trades || []).map(enrich)) {
      const keys = [].concat(keyFn(t)).filter((k) => k != null && k !== '');
      for (const k of keys.length ? keys : ['(none)']) { if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
    }
    const rows = [];
    for (const [key, list] of m) {
      const s = stats(list, 100000);
      rows.push({ key, trades: s.trades, wins: s.wins, losses: s.losses, winRate: s.winRate, net: s.net, avgR: s.avgR, expectancy: s.expectancy, profitFactor: s.profitFactor });
    }
    if (order) rows.sort((a, b) => { const ia = order.indexOf(a.key), ib = order.indexOf(b.key); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    else rows.sort((a, b) => b.trades - a.trades || String(a.key).localeCompare(String(b.key)));
    return rows;
  }
  const bySetup = (tr) => groupBy(tr, (t) => t.setup || null);
  const bySession = (tr) => groupBy(tr, (t) => t.session, SESSIONS);
  const byWeekday = (tr) => groupBy(tr, (t) => t.weekday, WEEKDAYS);
  const bySymbol = (tr) => groupBy(tr, (t) => String(t.symbol || '').replace(/^[^:]+:/, ''));

  /** filter: { from, to (ms, on exit time), symbol, tag (matches setup / mistake / emotion), outcome } */
  function filterTrades(trades, f) {
    f = f || {};
    const tag = f.tag ? String(f.tag).toLowerCase() : '';
    return (trades || []).filter((t) => {
      const x = num(t.exitAt);
      if (f.from != null && !(x >= f.from)) return false;
      if (f.to != null && !(x < f.to)) return false;
      if (f.symbol && String(t.symbol || '').replace(/^[^:]+:/, '') !== String(f.symbol).replace(/^[^:]+:/, '')) return false;
      if (tag && ![t.setup, t.mistake, t.emotion].some((v) => v && String(v).toLowerCase() === tag)) return false;
      if (f.outcome && enrich(t).outcome !== f.outcome) return false;
      return true;
    });
  }
  function tagsOf(trades) {
    const out = { setup: new Set(), mistake: new Set(), emotion: new Set(), symbol: new Set() };
    for (const t of trades || []) {
      for (const k of ['setup', 'mistake', 'emotion']) if (t[k]) out[k].add(String(t[k]));
      if (t.symbol) out.symbol.add(String(t.symbol).replace(/^[^:]+:/, ''));
    }
    const sort = (s) => Array.from(s).sort((a, b) => a.localeCompare(b));
    return { setup: sort(out.setup), mistake: sort(out.mistake), emotion: sort(out.emotion), symbol: sort(out.symbol) };
  }

  // ---- CSV ----
  function csvCell(v) {
    if (v == null) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = "'" + s;      // no spreadsheet formulas from a note
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(trades, opts) {
    const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : '');
    const head = ['id', 'account', 'symbol', 'side', 'qty', 'entry_time_utc', 'exit_time_utc', 'entry', 'exit', 'first_stop', 'take_profit', 'exit_by',
      'pnl_usd', 'fees_usd', 'r_multiple', 'mae_points', 'mfe_points', 'hold_seconds', 'session', 'weekday', 'setup', 'mistake', 'emotion', 'note'];
    const lines = [head.join(',')];
    for (const t of (trades || []).map(enrich)) {
      lines.push([t.id, t.src === 'replay' ? 'replay' : 'paper', String(t.symbol || '').replace(/^[^:]+:/, ''), t.side === 'buy' ? 'long' : 'short', t.qty,
        iso(num(t.entryAt)), iso(num(t.exitAt)), t.entry, t.exit, t.sl0 != null ? t.sl0 : t.sl, t.tp, t.reason, t.pnl, t.fees, t.r, t.mae, t.mfe,
        t.hold != null ? Math.round(t.hold / 1000) : '', t.session, t.weekday, t.setup, t.mistake, t.emotion, t.note].map(csvCell).join(','));
    }
    const disc = (opts && opts.disclaimer === false) ? [] : ['# ' + DISCLAIMER];
    return disc.concat(lines).join('\r\n') + '\r\n';
  }

  // ---- leaderboard ----
  /** Period start (ms, UTC): 'week' = Monday 00:00 UTC, 'month' = the 1st 00:00 UTC, 'all' = 0. */
  function periodStart(period, now) {
    const d = new Date(now);
    if (period === 'week') { const dow = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow); }
    if (period === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    return 0;
  }
  /** A trade the leaderboard can count (see the header). */
  function eligible(t, state, now) {
    if (!t || typeof t !== 'object') return false;
    if (t.src === 'replay') return false;
    const a = num(t.entryAt), b = num(t.exitAt), pnl = num(t.pnl);
    if (a == null || b == null || pnl == null || b < a) return false;
    if (b - a < MIN_HOLD_MS) return false;
    if (now != null && b > now + 60000) return false;                   // closed in the future: not a real fill
    const resetAt = num(state && state.resetAt) || 0;
    if (t.run != null ? num(t.run) !== resetAt : b < resetAt) return false;
    if (a < resetAt) return false;
    // the P&L must match the prices it claims (gross - fees), so a hand-written state cannot add money
    const entry = num(t.entry), exit = num(t.exit), qty = num(t.qty), pv = num(t.pointValue), fees = num(t.fees) || 0;
    if (entry == null || exit == null || !(qty > 0) || !(pv > 0) || fees < 0) return false;
    const gross = (exit - entry) * qty * pv * (t.side === 'sell' ? -1 : 1);
    if (Math.abs(gross - fees - pnl) > Math.max(0.05, Math.abs(gross) * 1e-6)) return false;
    return true;
  }
  /**
   * score(state, period, now): one member's leaderboard row for a period (or null when the state
   * is unusable). ranked = at least MIN_TRADES eligible trades in the period.
   */
  function score(state, period, now) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.trades)) return null;
    const start = num(state.startBalance);
    if (!(start > 0)) return null;
    const from = periodStart(period, now);
    const runTrades = state.trades.filter((t) => eligible(t, state, now));
    const inPeriod = runTrades.filter((t) => num(t.exitAt) >= from);
    // equity at the start of the period = start balance + run trades closed before it
    const before = runTrades.filter((t) => num(t.exitAt) < from).reduce((a, t) => a + num(t.pnl), 0);
    const s = stats(inPeriod, start + before);
    const lev = inPeriod.reduce((m, t) => Math.max(m, num(t.lev) || 0), 0);
    return {
      trades: s.trades, winRate: s.winRate, returnPct: r2(s.net / start * 100), maxDDPct: s.maxDDPct,
      ranked: s.trades >= MIN_TRADES, need: Math.max(0, MIN_TRADES - s.trades), flagged: lev > LEV_FLAG, maxLev: r2(lev),
      excluded: state.trades.length - runTrades.length
    };
  }
  /** rows: [{ key, name, ...score }] -> ranked rows sorted by return (ties: fewer drawdown, more trades). */
  function rank(rows) {
    const ranked = rows.filter((r) => r && r.ranked).sort((a, b) => b.returnPct - a.returnPct || a.maxDDPct - b.maxDDPct || b.trades - a.trades || String(a.name).localeCompare(String(b.name)));
    ranked.forEach((r, i) => { r.rank = i + 1; });
    return ranked;
  }

  // ---- formatting helpers shared by the review UI ----
  function fmtHold(ms) {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60); if (m < 60) return m + 'm ' + (s % 60 ? (s % 60) + 's' : '').trim();
    const h = Math.floor(m / 60); if (h < 48) return h + 'h ' + (m % 60) + 'm';
    return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  }

  return { MIN_HOLD_MS, MIN_TRADES, LEV_FLAG, SESSIONS, WEEKDAYS, DISCLAIMER, sessionOf, weekdayOf, riskOf, rOf, holdOf, enrich, stats, groupBy,
    bySetup, bySession, byWeekday, bySymbol, filterTrades, tagsOf, toCSV, periodStart, eligible, score, rank, fmtHold };
});
