/**
 * Stryker Trading Academy — Replay coach (rule-based, no model, no API)
 *
 * Three jobs, all computed from the session's own trades on the device:
 *   report(trades, equity, ctx)  → post-session findings with suggestions
 *   nudge(event, ctx)            → a one-line warning while trading, or null
 *   checklist                    → default pre-trade checklist items
 * Plus the shared tag / mistake vocabularies used by the ticket and the
 * dashboard. Pure logic (works in Node) so it can be unit-tested.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ReplayCoach = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const TAGS = ['FVG', 'iFVG', 'Order block', 'Breaker', 'SMT', 'Liquidity sweep', 'BOS', 'CHoCH', 'Silver bullet', 'PO3', 'Opening range', 'Trend continuation', 'Reversal', 'Other'];
  const MISTAKES = ['Chased entry', 'No confirmation', 'Early exit', 'Moved stop', 'Oversized', 'Revenge trade', 'Outside plan hours', 'Ignored HTF bias', 'Hesitated / late'];
  const CHECKLIST = ['Higher-timeframe bias is defined', 'Setup matches one of my models', 'Confirmation on the entry timeframe', 'Risk is within my plan for this trade', 'Stop sits at invalidation, not at a round number'];
  const SESSION_BOUNDS = [['Asia', 18 * 60, 24 * 60], ['Asia', 0, 2 * 60], ['London', 2 * 60, 9 * 60 + 30], ['New York', 9 * 60 + 30, 16 * 60], ['Off hours', 16 * 60, 18 * 60]];
  let fmtNY = null;
  function nyMinutes(t) { fmtNY = fmtNY || new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short' }); const o = {}; for (const p of fmtNY.formatToParts(new Date(t))) o[p.type] = p.value; return { min: (Number(o.hour) % 24) * 60 + Number(o.minute), hour: Number(o.hour) % 24, wd: o.weekday }; }
  function sessionOf(t) { const m = nyMinutes(t).min; for (const [name, a, b] of SESSION_BOUNDS) if (m >= a && m < b) return name; return 'Off hours'; }
  const sum = (a) => a.reduce((x, y) => x + y, 0), mean = (a) => a.length ? sum(a) / a.length : 0, median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  function groupStats(trades, keyFn) { const g = {}; for (const t of trades) { const k = keyFn(t); if (k == null) continue; (g[k] = g[k] || []).push(t); } return Object.keys(g).map((k) => { const ts = g[k]; const net = sum(ts.map((t) => t.pnl)); return { key: k, n: ts.length, net, exp: net / ts.length, winRate: 100 * ts.filter((t) => t.pnl > 0).length / ts.length }; }); }

  function report(trades, equity, ctx) {
    ctx = ctx || {}; const F = []; const add = (severity, title, detail, suggestion) => F.push({ severity, title, detail, suggestion });
    const n = trades.length;
    if (n < 5) { add('info', 'Not enough trades yet', n + ' closed trade' + (n === 1 ? '' : 's') + ' in this session. Most findings need at least 5, and hour/setup breakdowns need 3 per bucket.', 'Keep replaying — the coach gets sharper with every trade.'); return { findings: F, groups: {} }; }
    const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0);
    const net = sum(trades.map((t) => t.pnl)), gp = sum(wins.map((t) => t.pnl)), gl = -sum(losses.map((t) => t.pnl));
    const pf = gl > 0 ? gp / gl : Infinity, exp = net / n, wr = 100 * wins.length / n;
    const avgW = mean(wins.map((t) => t.pnl)), avgL = mean(losses.map((t) => t.pnl));
    // 1. edge headline
    if (pf >= 1.5 && exp > 0) add('good', 'You have an edge in this sample', 'Profit factor ' + (pf === Infinity ? '∞' : pf.toFixed(2)) + ', expectancy ' + money(exp) + ' per trade, win rate ' + wr.toFixed(0) + '%.', 'Protect it: the fastest way to lose an edge is to change size or rules mid-sample. Run the same plan on a second period before trusting it.');
    else if (pf >= 1) add('info', 'Marginal edge', 'Profit factor ' + pf.toFixed(2) + ' with ' + money(exp) + ' expectancy. A handful of trades decides the outcome.', 'Look at the setup and hour breakdowns below; usually one bucket is carrying the rest.');
    else add('bad', 'No edge in this sample', 'Profit factor ' + pf.toFixed(2) + ', expectancy ' + money(exp) + ' per trade, win rate ' + wr.toFixed(0) + '%.', 'Do not tweak size. Cut to one setup and one session window, then re-test.');
    // 2. win/loss shape
    if (losses.length && wins.length) { const ratio = avgW / Math.abs(avgL); if (ratio < 1 && wr < 60) add('warn', 'Losses are bigger than wins', 'Average win ' + money(avgW) + ' vs average loss ' + money(avgL) + ' (' + ratio.toFixed(2) + ':1) at a ' + wr.toFixed(0) + '% win rate. That combination cannot be profitable for long.', 'Either widen targets to 2R+ or tighten stops to invalidation. The R column in the trades table shows which side to fix.'); else if (ratio >= 2) add('good', 'Healthy payoff ratio', 'Average win is ' + ratio.toFixed(1) + '× the average loss.', 'Fine to run a lower win rate with this shape — do not cut winners early to raise it.'); }
    // 3. R distribution
    const rs = trades.filter((t) => t.r != null).map((t) => t.r); if (rs.length >= 5) { const bigL = rs.filter((r) => r < -1.3).length; if (bigL) add('warn', bigL + ' trade' + (bigL > 1 ? 's' : '') + ' lost more than 1.3R', 'Stops were moved, gapped through, or filled with slippage. Planned risk was exceeded on ' + (100 * bigL / rs.length).toFixed(0) + '% of trades.', 'Never move a stop away from price. If gaps are the cause, avoid holding through news or the open.'); const avgR = mean(rs); add(avgR > 0.3 ? 'good' : 'info', 'Average result ' + (avgR >= 0 ? '+' : '') + avgR.toFixed(2) + 'R', 'Across ' + rs.length + ' trades with a defined stop.', avgR < 0.3 ? 'Aim for +0.3R or better per trade after costs; below that, fees and slippage eat the edge live.' : 'Solid. Keep stops at invalidation so R stays meaningful.'); }
    // 4. early exits
    const early = trades.filter((t) => t.reason === 'manual' && t.pnl > 0 && t.mfe >= 2 * t.pnl); if (early.length >= 2) add('warn', early.length + ' winners closed early', 'These trades showed at least twice the profit you took: ' + money(sum(early.map((t) => t.mfe - t.pnl))) + ' left on the table.', 'Decide the target before entry and let the target or the stop end the trade. Use partials only at a planned level.');
    // 5. fast stop-outs
    const fast = losses.filter((t) => t.bars <= 2); if (fast.length >= 3 && fast.length / losses.length >= 0.4) add('warn', 'Many stops hit within 2 bars', fast.length + ' of ' + losses.length + ' losses ended almost immediately.', 'Entries are chasing or stops sit inside normal noise. Enter on the retrace into the level and place the stop beyond the swing, not behind the candle.');
    // 6. hour / session / setup / direction
    const byHour = groupStats(trades, (t) => nyMinutes(t.entryT).hour).filter((g) => g.n >= 3).sort((a, b) => b.exp - a.exp);
    if (byHour.length >= 2) { const b = byHour[0], w = byHour[byHour.length - 1]; add(b.exp > 0 ? 'good' : 'info', 'Best hour: ' + b.key + ':00 ET', money(b.exp) + ' per trade over ' + b.n + ' trades (' + b.winRate.toFixed(0) + '% win).', w.exp < 0 ? 'Worst hour is ' + w.key + ':00 ET at ' + money(w.exp) + ' per trade — consider a no-trade rule there.' : 'Every hour bucket is positive; keep the schedule.'); }
    const bySess = groupStats(trades, (t) => sessionOf(t.entryT)).filter((g) => g.n >= 3).sort((a, b) => b.exp - a.exp);
    if (bySess.length >= 2 && bySess[bySess.length - 1].exp < 0) add('warn', bySess[bySess.length - 1].key + ' session is costing you', money(bySess[bySess.length - 1].net) + ' over ' + bySess[bySess.length - 1].n + ' trades, while ' + bySess[0].key + ' made ' + money(bySess[0].net) + '.', 'Trade only the session that pays until the other proves itself in a separate test.');
    const byTag = groupStats(trades.flatMap((t) => (t.tags && t.tags.length ? t.tags : ['Untagged']).map((tag) => Object.assign({}, t, { _tag: tag }))), (t) => t._tag).filter((g) => g.n >= 3).sort((a, b) => b.exp - a.exp);
    if (byTag.length >= 2) { const b = byTag[0], w = byTag[byTag.length - 1]; add('info', 'Setups: ' + b.key + ' leads, ' + w.key + ' lags', b.key + ' ' + money(b.exp) + '/trade (' + b.n + '), ' + w.key + ' ' + money(w.exp) + '/trade (' + w.n + ').', w.exp < 0 ? 'Drop ' + w.key + ' for now and re-test it alone.' : 'Both positive; size the leader slightly higher only after 30+ trades.'); }
    const untagged = trades.filter((t) => !t.tags || !t.tags.length).length; if (untagged / n > 0.5) add('info', untagged + ' trades have no setup tag', 'Tags are what make the setup and mistake breakdowns useful.', 'Tag trades right after the close while the reason is fresh.');
    const longs = trades.filter((t) => t.side === 'buy'), shorts = trades.filter((t) => t.side === 'sell'); if (longs.length >= 3 && shorts.length >= 3) { const le = mean(longs.map((t) => t.pnl)), se = mean(shorts.map((t) => t.pnl)); if (Math.sign(le) !== Math.sign(se)) add('info', (le > se ? 'Longs' : 'Shorts') + ' work, ' + (le > se ? 'shorts' : 'longs') + ' do not', 'Long expectancy ' + money(le) + ', short expectancy ' + money(se) + '.', 'Check whether the losing direction was fighting the higher-timeframe bias.'); }
    // 7. discipline: risk creep, revenge, overtrading, streaks
    const sizes = trades.map((t) => t.size); const afterLoss = [], afterWin = []; for (let i = 1; i < trades.length; i++) (trades[i - 1].pnl < 0 ? afterLoss : afterWin).push(trades[i].size);
    if (afterLoss.length >= 3 && afterWin.length >= 3 && mean(afterLoss) > 1.25 * mean(afterWin)) add('bad', 'Size grows after losses', 'Average size after a loss is ' + mean(afterLoss).toFixed(2) + ' vs ' + mean(afterWin).toFixed(2) + ' after a win.', 'Fix size per trade before the session. Increasing after a loss is how a red day becomes a blown account.');
    const revenge = []; for (let i = 1; i < trades.length; i++) if (trades[i - 1].pnl < 0 && trades[i].entryIdx - trades[i - 1].exitIdx <= 3) revenge.push(trades[i]);
    if (revenge.length >= 2) add(sum(revenge.map((t) => t.pnl)) < 0 ? 'bad' : 'warn', revenge.length + ' re-entries within 3 bars of a loss', 'Those trades netted ' + money(sum(revenge.map((t) => t.pnl))) + ' with a ' + (100 * revenge.filter((t) => t.pnl > 0).length / revenge.length).toFixed(0) + '% win rate.', 'After a stop-out, wait for a fresh setup — at least one full candle of your entry timeframe with no order in the market.');
    let ls = 0, maxLs = 0; for (const t of trades) { if (t.pnl < 0) { ls++; if (ls > maxLs) maxLs = ls; } else ls = 0; } if (maxLs >= 4) add('warn', 'Longest losing streak: ' + maxLs, 'Streaks of four or more usually mean conditions changed and the plan did not.', 'Adopt a hard rule: after 3 consecutive losses, stop for the day or drop to minimum size.');
    const perDay = groupStats(trades, (t) => new Date(t.entryT).toISOString().slice(0, 10)); if (perDay.length >= 3) { const counts = perDay.map((d) => d.n), med = median(counts); const heavy = perDay.filter((d) => d.n >= Math.max(4, 2 * med)); if (heavy.length) add('warn', 'Overtrading on ' + heavy.length + ' day' + (heavy.length > 1 ? 's' : ''), heavy.map((d) => d.key + ' (' + d.n + ' trades, ' + money(d.net) + ')').join(', ') + '. Median is ' + med + ' per day.', 'Cap trades per day at ' + Math.max(2, Math.round(med * 1.5)) + '. Extra trades on busy days are usually the worst ones.'); }
    // 8. mistakes and checklist
    const mist = {}; for (const t of trades) for (const m of (t.mistakes || [])) { mist[m] = mist[m] || { n: 0, cost: 0 }; mist[m].n++; mist[m].cost += t.pnl; }
    const mk = Object.keys(mist).sort((a, b) => mist[b].n - mist[a].n); if (mk.length) add('warn', 'Most frequent mistake: ' + mk[0], mk.slice(0, 3).map((k) => k + ' ×' + mist[k].n + ' (' + money(mist[k].cost) + ')').join(' · ') + '.', 'Turn the top mistake into a checklist item so it is checked before every order.');
    const withCl = trades.filter((t) => t.checklist && t.checklist.total); if (withCl.length >= 5) { const full = withCl.filter((t) => t.checklist.done === t.checklist.total), part = withCl.filter((t) => t.checklist.done < t.checklist.total); if (full.length >= 3 && part.length >= 3) add(mean(full.map((t) => t.pnl)) > mean(part.map((t) => t.pnl)) ? 'good' : 'info', 'Checklist adherence vs results', 'Full checklist: ' + money(mean(full.map((t) => t.pnl))) + '/trade over ' + full.length + '. Skipped items: ' + money(mean(part.map((t) => t.pnl))) + '/trade over ' + part.length + '.', mean(full.map((t) => t.pnl)) > mean(part.map((t) => t.pnl)) ? 'The checklist is earning its keep — make it mandatory.' : 'Results do not yet favour the checklist; revisit whether its items describe your real edge.'); }
    // 9. fees, drawdown
    const fees = sum(trades.map((t) => t.fees || 0)); if (gp > 0 && fees / gp > 0.2) add('warn', 'Fees eat ' + (100 * fees / gp).toFixed(0) + '% of gross profit', money(fees) + ' in commissions against ' + money(gp) + ' gross.', 'Fewer, larger-R trades. Scalping with these costs needs a much higher win rate than you have.');
    if (equity && equity.length > 2) { let peak = -Infinity, dd = 0; for (const e of equity) { if (e.equity > peak) peak = e.equity; dd = Math.max(dd, peak - e.equity); } const start = ctx.startBalance || equity[0].balance; if (start && dd / start > 0.05) add(dd / start > 0.1 ? 'bad' : 'warn', 'Max drawdown ' + (100 * dd / start).toFixed(1) + '% of starting balance', money(dd) + ' peak to trough.', dd / start > 0.1 ? 'Most prop firms fail you at 8–10%. Halve risk per trade and add a daily loss limit.' : 'Acceptable, but set a daily loss limit at ~2% so one bad day cannot become this.'); }
    const order = { bad: 0, warn: 1, good: 2, info: 3 }; F.sort((a, b) => order[a.severity] - order[b.severity]);
    return { findings: F, groups: { byHour, bySess, byTag } };
  }

  // ---- live nudges -------------------------------------------------------------------
  function nudge(ev, ctx) {
    const trades = ctx.trades || []; const last = trades[trades.length - 1];
    if (ev.type === 'submit') {
      if (ev.order.sl == null) return { level: 'warn', text: 'No stop-loss on this order. Every trade in a backtest without a stop is a trade you could not take live.' };
      let streak = 0; for (let i = trades.length - 1; i >= 0 && trades[i].pnl < 0; i--) streak++;
      if (streak >= 3) return { level: 'bad', text: streak + ' losses in a row. A pause beats a fourth — step to the next day and re-read the higher timeframe first.' };
      if (last && last.pnl < 0 && ev.cursor - last.exitIdx <= 3) return { level: 'warn', text: 'Re-entering ' + (ev.cursor - last.exitIdx) + ' bar' + (ev.cursor - last.exitIdx === 1 ? '' : 's') + ' after a stop-out. This is how revenge trades start — is there a fresh setup, or a wish to be right?' };
      const sizes = trades.slice(-10).map((t) => t.size); if (sizes.length >= 4) { const med = median(sizes); if (ev.order.size > 1.5 * med) return { level: 'warn', text: 'Size is ' + (ev.order.size / med).toFixed(1) + '× your recent usual (' + med + '). Bigger size after a run of results is risk creep, not conviction.' }; }
      if (trades.length >= 10) { const h = nyMinutes(ev.t).hour; const bucket = trades.filter((t) => nyMinutes(t.entryT).hour === h); if (bucket.length >= 3) { const e = mean(bucket.map((t) => t.pnl)); if (e < 0) return { level: 'info', text: 'Your record at ' + h + ':00 ET in this session: ' + bucket.length + ' trades, ' + money(e) + ' per trade. Trade it only if the setup is A+.' }; } }
      return null;
    }
    if (ev.type === 'close') {
      const t = ev.trade; if (t.pnl < 0 && t.bars <= 1) return { level: 'info', text: 'Stopped within one bar. Was the stop at invalidation or inside normal noise? Check ATR for the timeframe.' };
      if (t.reason === 'manual' && t.pnl > 0 && t.mfe > 2 * t.pnl) return { level: 'info', text: 'Closed with ' + money(t.pnl) + ' while the trade showed ' + money(t.mfe) + ' at best. If the target was not reached, why exit?' };
      if (t.reason === 'tp') return { level: 'good', text: 'Target hit for ' + (t.r != null ? (t.r >= 0 ? '+' : '') + t.r.toFixed(2) + 'R' : money(t.pnl)) + '. Tag the setup while it is fresh.' };
      return null;
    }
    return null;
  }
  return { TAGS, MISTAKES, CHECKLIST, report, nudge, sessionOf, nyMinutes };
});
