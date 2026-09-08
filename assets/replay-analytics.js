/**
 * Stryker Trading Academy — Backtest analytics (pure computation)
 *
 * Everything the Backtesting dashboard and its Analytics view compute from a
 * list of closed trades: filters, the overview block (P&L, win rate, realised
 * and ideal R, expectancy, profit factor, winners/losers), P&L over time at
 * several bucket sizes, breakdowns by side / session / hour / weekday / tag /
 * asset, drawdown analysis and a Monte Carlo re-ordering simulation.
 *
 * A "row" is { s: sessionMeta, t: trade } so breakdowns by asset can read the
 * session's market. Trade shape comes from replay-engine.js. Runs in Node too.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ReplayAnalytics = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const sum = (a) => a.reduce((x, y) => x + y, 0), mean = (a) => a.length ? sum(a) / a.length : 0, r2 = (n) => Math.round(n * 100) / 100;
  let fmtNY = null;
  function ny(t) { fmtNY = fmtNY || new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }); const o = {}; for (const p of fmtNY.formatToParts(new Date(t))) o[p.type] = p.value; return { hour: Number(o.hour) % 24, min: (Number(o.hour) % 24) * 60 + Number(o.minute), wd: o.weekday, day: o.year + '-' + o.month + '-' + o.day }; }
  function sessionOf(t) { const m = ny(t).min; if (m >= 18 * 60 || m < 2 * 60) return 'Asia'; if (m < 9 * 60 + 30) return 'London'; if (m < 16 * 60) return 'New York'; return 'Off hours'; }
  const outcome = (t) => t.pnl > 0 ? 'win' : t.pnl < 0 ? 'loss' : 'be';

  // ---- filters ---------------------------------------------------------------------
  function filter(rows, f) {
    f = f || {};
    return rows.filter(({ s, t }) => {
      if (f.assets && f.assets.length && !f.assets.includes(s.symbolId)) return false;
      if (f.side && f.side !== 'all' && t.side !== f.side) return false;
      if (f.outcomes && f.outcomes.length && !f.outcomes.includes(outcome(t))) return false;
      if (f.tags && f.tags.length && !(t.tags || []).some((x) => f.tags.includes(x))) return false;
      if (f.sessions && f.sessions.length && !f.sessions.includes(sessionOf(t.entryT))) return false;
      if (f.weekdays && f.weekdays.length && !f.weekdays.includes(ny(t.entryT).wd)) return false;
      if (f.hourFrom != null && f.hourTo != null) { const h = ny(t.entryT).hour; if (f.hourFrom <= f.hourTo ? (h < f.hourFrom || h > f.hourTo) : (h < f.hourFrom && h > f.hourTo)) return false; }
      if (f.dateFrom && t.entryT < f.dateFrom) return false; if (f.dateTo && t.entryT > f.dateTo) return false;
      if (f.sessionIds && f.sessionIds.length && !f.sessionIds.includes(s.id)) return false;
      return true;
    });
  }

  // ---- overview ---------------------------------------------------------------------
  function streaks(trades) { let w = 0, l = 0, maxW = 0, maxL = 0; const ws = [], ls = []; for (const t of trades) { if (t.pnl > 0) { w++; if (l) { ls.push(l); l = 0; } } else if (t.pnl < 0) { l++; if (w) { ws.push(w); w = 0; } } else { if (w) ws.push(w); if (l) ls.push(l); w = 0; l = 0; } maxW = Math.max(maxW, w); maxL = Math.max(maxL, l); } if (w) ws.push(w); if (l) ls.push(l); return { maxW, maxL, avgW: r2(mean(ws)), avgL: r2(mean(ls)) }; }
  function overview(trades, startBalance) {
    const sorted = trades.slice().sort((a, b) => a.exitT - b.exitT);
    const wins = sorted.filter((t) => t.pnl > 0), losses = sorted.filter((t) => t.pnl < 0), be = sorted.filter((t) => t.pnl === 0);
    const net = sum(sorted.map((t) => t.pnl)), gp = sum(wins.map((t) => t.pnl)), gl = -sum(losses.map((t) => t.pnl));
    const withRisk = sorted.filter((t) => t.risk > 0); const rs = withRisk.map((t) => t.pnl / t.risk); const ideal = withRisk.map((t) => (t.mfe || 0) / t.risk);
    const st = streaks(sorted);
    const dur = (list) => mean(list.map((t) => t.exitT - t.entryT));
    return {
      count: sorted.length, wins: wins.length, losses: losses.length, be: be.length, winRate: sorted.length ? r2(100 * wins.length / sorted.length) : 0,
      net: r2(net), balance: r2((startBalance || 0) + net), returnPct: startBalance ? r2(100 * net / startBalance) : 0, grossProfit: r2(gp), grossLoss: r2(gl), fees: r2(sum(sorted.map((t) => t.fees || 0))),
      avgRR: rs.length ? r2(mean(rs)) : null, maxRR: rs.length ? r2(Math.max(...rs)) : null, idealAvgRR: ideal.length ? r2(mean(ideal)) : null, maxIdealRR: ideal.length ? r2(Math.max(...ideal)) : null,
      couldHaveBE: withRisk.filter((t) => t.pnl < 0 && (t.mfe || 0) >= t.risk).length,
      expectancy: sorted.length ? r2(net / sorted.length) : 0, profitFactor: gl > 0 ? r2(gp / gl) : (gp > 0 ? Infinity : 0),
      avgWin: r2(mean(wins.map((t) => t.pnl))), avgLoss: r2(mean(losses.map((t) => t.pnl))), bestWin: wins.length ? r2(Math.max(...wins.map((t) => t.pnl))) : 0, worstLoss: losses.length ? r2(Math.min(...losses.map((t) => t.pnl))) : 0,
      avgWinDur: dur(wins), avgLossDur: dur(losses), avgHold: dur(sorted), maxConsecW: st.maxW, maxConsecL: st.maxL, avgConsecW: st.avgW, avgConsecL: st.avgL,
      longs: sorted.filter((t) => t.side === 'buy').length, shorts: sorted.filter((t) => t.side === 'sell').length
    };
  }

  // ---- series -----------------------------------------------------------------------------
  const BUCKET = { trade: 0, '15m': 900000, hour: 3600000, day: 86400000 };
  function pnlSeries(trades, bucket) {
    const sorted = trades.slice().sort((a, b) => a.exitT - b.exitT); const out = []; let acc = 0; const size = BUCKET[bucket] || 0;
    if (!size) { for (const t of sorted) { acc += t.pnl; out.push({ t: t.exitT, v: r2(acc), d: t.pnl, n: 1 }); } return out; }
    let cur = null;
    for (const t of sorted) { const k = Math.floor(t.exitT / size) * size; if (!cur || cur.k !== k) { cur = { k, t: k, d: 0, n: 0 }; out.push(cur); } cur.d += t.pnl; cur.n++; acc += t.pnl; cur.v = r2(acc); }
    return out.map((p) => ({ t: p.t, v: p.v, d: r2(p.d), n: p.n }));
  }
  function group(rows, keyFn, order) {
    const g = {}; for (const r of rows) { const k = keyFn(r); if (k == null) continue; (g[k] = g[k] || []).push(r.t); }
    const out = Object.keys(g).map((k) => { const ts = g[k]; const wins = ts.filter((t) => t.pnl > 0).length; const rs = ts.filter((t) => t.risk > 0).map((t) => t.pnl / t.risk); return { key: k, n: ts.length, wins, winRate: r2(100 * wins / ts.length), net: r2(sum(ts.map((t) => t.pnl))), avgRR: rs.length ? r2(mean(rs)) : null, expectancy: r2(mean(ts.map((t) => t.pnl))) }; });
    if (order) out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)); else out.sort((a, b) => b.net - a.net); return out;
  }
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], SESS = ['Asia', 'London', 'New York', 'Off hours'];
  const bySide = (rows) => group(rows, (r) => r.t.side === 'buy' ? 'Buy' : 'Sell', ['Buy', 'Sell']);
  const bySession = (rows) => group(rows, (r) => sessionOf(r.t.entryT), SESS);
  const byHour = (rows) => group(rows, (r) => String(ny(r.t.entryT).hour).padStart(2, '0') + ':00', Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00'));
  const byWeekday = (rows) => group(rows, (r) => ny(r.t.entryT).wd, WD);
  const byTag = (rows) => group(rows.flatMap((r) => (r.t.tags && r.t.tags.length ? r.t.tags : ['Untagged']).map((tag) => ({ s: r.s, t: r.t, tag }))), (r) => r.tag);
  const byAsset = (rows) => group(rows, (r) => (r.s.symbolLabel || r.s.symbolId || '').split(' · ')[0]);
  const byExit = (rows) => group(rows, (r) => ({ sl: 'Stop', tp: 'Target', manual: 'Manual' }[r.t.reason] || r.t.reason), ['Target', 'Stop', 'Manual']);
  function rHistogram(trades) {
    const bins = [{ label: '≤ −2R', lo: -Infinity, hi: -2 }, { label: '−2 … −1R', lo: -2, hi: -1 }, { label: '−1 … 0R', lo: -1, hi: 0 }, { label: '0 … 1R', lo: 0, hi: 1 }, { label: '1 … 2R', lo: 1, hi: 2 }, { label: '2 … 3R', lo: 2, hi: 3 }, { label: '> 3R', lo: 3, hi: Infinity }];
    for (const b of bins) b.n = 0; for (const t of trades) { if (!(t.risk > 0)) continue; const r = t.pnl / t.risk; for (const b of bins) if (r > b.lo && r <= b.hi) { b.n++; break; } if (r <= -2) bins[0].n += 0; }
    return bins;
  }

  // ---- drawdown -------------------------------------------------------------------------------
  function drawdown(trades, startBalance) {
    const sorted = trades.slice().sort((a, b) => a.exitT - b.exitT); const base = startBalance || 0; let eq = base, peak = base, peakT = sorted.length ? sorted[0].entryT : 0;
    const series = []; let maxDD = 0, maxDDPct = 0, maxStart = null, maxEnd = null, curStart = null, longest = 0, ddSum = 0, ddN = 0, periods = 0;
    for (const t of sorted) { eq += t.pnl; if (eq >= peak) { if (curStart != null) { longest = Math.max(longest, t.exitT - curStart); periods++; curStart = null; } peak = eq; peakT = t.exitT; } else if (curStart == null) curStart = peakT; const dd = peak - eq; const ddPct = peak > 0 ? 100 * dd / peak : 0; if (dd > 0) { ddSum += dd; ddN++; } if (dd > maxDD) { maxDD = dd; maxDDPct = ddPct; maxStart = curStart; maxEnd = t.exitT; } series.push({ t: t.exitT, dd: -r2(dd), ddPct: -r2(ddPct), eq: r2(eq) }); }
    if (curStart != null) longest = Math.max(longest, (sorted.length ? sorted[sorted.length - 1].exitT : 0) - curStart);
    const net = eq - base;
    return { series, maxDD: r2(maxDD), maxDDPct: r2(maxDDPct), maxStart, maxEnd, longestMs: longest, avgDD: r2(ddN ? ddSum / ddN : 0), periods: periods + (curStart != null ? 1 : 0), recoveryFactor: maxDD > 0 ? r2(net / maxDD) : null, current: r2(peak - eq), currentPct: peak > 0 ? r2(100 * (peak - eq) / peak) : 0 };
  }

  // ---- Monte Carlo -------------------------------------------------------------------------------
  function monteCarlo(trades, opts) {
    opts = opts || {}; const runs = opts.runs || 500, pnls = trades.map((t) => t.pnl); const n = pnls.length; if (n < 2) return null;
    let seed = opts.seed || 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const base = opts.startBalance || 0, ruinPct = opts.ruinPct || 10; const finals = [], maxDDs = [], paths = []; let ruined = 0;
    for (let r = 0; r < runs; r++) {
      const arr = pnls.slice(); for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp; }
      let eq = 0, peak = 0, dd = 0, hitRuin = false; const path = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) { eq += arr[i]; path[i + 1] = eq; if (eq > peak) peak = eq; dd = Math.max(dd, peak - eq); if (base && (base + eq) <= base * (1 - ruinPct / 100)) hitRuin = true; }
      finals.push(eq); maxDDs.push(dd); paths.push(path); if (hitRuin) ruined++;
    }
    const pct = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
    const bands = { p5: [], p25: [], p50: [], p75: [], p95: [] };
    for (let i = 0; i <= n; i++) { const col = paths.map((p) => p[i]); bands.p5.push(r2(pct(col, 5))); bands.p25.push(r2(pct(col, 25))); bands.p50.push(r2(pct(col, 50))); bands.p75.push(r2(pct(col, 75))); bands.p95.push(r2(pct(col, 95))); }
    const actual = []; let acc = 0; actual.push(0); for (const p of trades.slice().sort((a, b) => a.exitT - b.exitT)) { acc += p.pnl; actual.push(r2(acc)); }
    return { runs, steps: n, bands, actual, final: { mean: r2(mean(finals)), p5: r2(pct(finals, 5)), p50: r2(pct(finals, 50)), p95: r2(pct(finals, 95)), probLoss: r2(100 * finals.filter((f) => f < 0).length / runs) }, maxDD: { p50: r2(pct(maxDDs, 50)), p95: r2(pct(maxDDs, 95)), worst: r2(Math.max(...maxDDs)) }, ruinProb: r2(100 * ruined / runs), ruinPct };
  }
  const fmtDur = (ms) => { if (!ms || ms < 0) return '0m'; const m = Math.round(ms / 60000); if (m < 60) return m + 'm'; const h = Math.floor(m / 60); if (h < 48) return h + 'h ' + (m % 60) + 'm'; return Math.floor(h / 24) + 'd ' + (h % 24) + 'h'; };
  return { filter, overview, pnlSeries, group, bySide, bySession, byHour, byWeekday, byTag, byAsset, byExit, rHistogram, drawdown, monteCarlo, sessionOf, ny, fmtDur, WD, SESS };
});
