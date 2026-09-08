/**
 * Stryker Trading Academy — Backtesting app (backtests.html)
 *
 * Four views on one page, routed by hash: Dashboard (#dashboard), Sessions
 * (#sessions), Trades (#trades), Analytics (#analytics with Performance /
 * Drawdown / Simulation). Data: every replay session saved in this browser
 * (IndexedDB) plus best-effort cloud copies under students/{uid}/replay.
 * Numbers from replay-analytics.js, charts from bt-charts.js, findings from
 * replay-coach.js. Trade edits (tags, mistakes, notes) write back into the
 * session's saved simulator snapshot. Gate: Pro and above.
 */
(function () {
  'use strict';
  const D = window.ReplayData, A = window.ReplayAnalytics, CH = window.BTCharts, COACH = window.ReplayCoach;
  const MIN_RANK = 1; const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, sign) => { const v = Number(n) || 0; return (v < 0 ? '-' : (sign && v > 0 ? '+' : '')) + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
  const pct = (n) => (Number(n) || 0).toFixed(n % 1 ? 1 : 0) + '%';
  const cls = (v) => v > 0 ? 'up' : v < 0 ? 'down' : '';
  const S = { uid: null, sessions: [], rows: [], f: { assets: [], side: 'all', outcomes: [], tags: [], sessions: [], weekdays: [], hourFrom: null, hourTo: null, dateFrom: null, dateTo: null }, bucket: 'trade', aBucket: 'trade', aTab: 'perf', sort: 'recent', q: '', tf: { market: '', side: '', outcome: '', session: '' } };
  const fmtDT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

  // ---- data ------------------------------------------------------------------------------
  async function loadAll() {
    const local = await D.store.listSessions(); const byId = {};
    for (const s of local) byId[s.id] = { id: s.id, name: s.name, symbolId: s.symbolId, symbolLabel: s.symbolLabel, startMs: s.startMs, endMs: s.endMs, cursor: s.cursor, total: s.total, tf: s.tf, updatedAt: s.updatedAt, createdAt: s.createdAt, summary: s.summary, startBalance: s.sim ? s.sim.startBalance : s.balance, balance: s.sim ? s.sim.balance : s.balance, trades: s.sim ? s.sim.trades : [], equity: s.sim ? s.sim.equity : [], local: true };
    if (S.uid && typeof db !== 'undefined' && db) { try { const snap = await db.collection('students').doc(S.uid).collection('replay').get(); snap.forEach((d) => { const c = d.data(); if (!byId[d.id]) byId[d.id] = { id: d.id, name: c.name, symbolId: c.symbolId, symbolLabel: c.symbolLabel, startMs: c.startMs, endMs: c.endMs, cursor: c.cursor, total: c.total, tf: c.tf, updatedAt: c.updatedAt, summary: c.summary, startBalance: c.startBalance, balance: c.balance, trades: c.trades || [], equity: [], local: false }; }); } catch (e) { /* cloud copies unavailable */ } }
    S.sessions = Object.values(byId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    S.rows = []; for (const s of S.sessions) for (const t of s.trades) S.rows.push({ s, t });
  }
  const filteredRows = () => A.filter(S.rows, S.f);
  const startBalance = (rows) => { const ids = new Set(rows.map((r) => r.s.id)); return S.sessions.filter((s) => ids.has(s.id)).reduce((a, s) => a + (s.startBalance || 0), 0); };

  // ---- shared blocks ----------------------------------------------------------------------
  const kpi = (l, v, sub, c) => '<div class="bt-kpi"><span>' + l + '</span><b class="' + (c || '') + '">' + v + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  function winnersBlock(ov, win) {
    const rows = win ? [['Total winners', ov.wins], ['Best win', money(ov.bestWin, true), 'up'], ['Average win', money(ov.avgWin, true), 'up'], ['Average duration', A.fmtDur(ov.avgWinDur)], ['Max consecutive wins', ov.maxConsecW], ['Avg consecutive wins', ov.avgConsecW]] : [['Total losers', ov.losses], ['Worst loss', money(ov.worstLoss, true), 'down'], ['Average loss', money(ov.avgLoss, true), 'down'], ['Average duration', A.fmtDur(ov.avgLossDur)], ['Max consecutive losses', ov.maxConsecL], ['Avg consecutive losses', ov.avgConsecL]];
    return '<div class="bt-kv">' + rows.map((r) => '<div><span>' + r[0] + '</span><b class="' + (r[2] || '') + '">' + r[1] + '</b></div>').join('') + '</div>';
  }
  function sideDonuts(el, rows, mode) {
    const g = A.bySide(rows); const buy = g.find((x) => x.key === 'Buy') || { n: 0, winRate: 0, wins: 0 }, sell = g.find((x) => x.key === 'Sell') || { n: 0, winRate: 0, wins: 0 }; el.innerHTML = '';
    const c1 = getComputedStyle(document.documentElement).getPropertyValue('--chart-1').trim() || '#03a872', c2 = getComputedStyle(document.documentElement).getPropertyValue('--chart-2').trim() || '#3f7fe8';
    if (mode === 'wr') { const d1 = document.createElement('div'), d2 = document.createElement('div'); el.appendChild(d1); el.appendChild(d2); CH.donut(d1, { size: 130, parts: [{ label: 'wins', value: buy.wins, color: c1 }, { label: 'losses', value: buy.n - buy.wins, color: 'rgba(139,147,160,0.35)' }], center: pct(buy.winRate), sub: 'buy · ' + buy.n }); CH.donut(d2, { size: 130, parts: [{ label: 'wins', value: sell.wins, color: c2 }, { label: 'losses', value: sell.n - sell.wins, color: 'rgba(139,147,160,0.35)' }], center: pct(sell.winRate), sub: 'sell · ' + sell.n }); }
    else CH.donut(el, { size: 150, parts: [{ label: 'buy', value: buy.n, color: c1 }, { label: 'sell', value: sell.n, color: c2 }], center: buy.n + sell.n, sub: 'trades' });
  }
  function sessionLollipops(rows, targets) {
    const g = A.bySession(rows).filter((x) => x.key !== 'Off hours' || x.n); const mk = (key, fmt, signed, max) => g.map((x) => ({ label: x.key, value: x[key] == null ? 0 : x[key], extra: x.n + ' trades' })); 
    if (targets.wr) CH.lollipop(targets.wr, { rows: mk('winRate'), fmt: (v) => v.toFixed(0) + '%', max: 100 });
    if (targets.n) CH.lollipop(targets.n, { rows: mk('n'), fmt: (v) => String(Math.round(v)) });
    if (targets.rr) CH.lollipop(targets.rr, { rows: mk('avgRR'), fmt: (v) => v.toFixed(2) + 'R', signed: true });
    if (targets.p) CH.lollipop(targets.p, { rows: mk('net'), fmt: (v) => money(v, true), signed: true });
  }
  function pnlChart(el, rows, bucket) {
    const ser = A.pnlSeries(rows.map((r) => r.t), bucket); const pts = ser.map((p) => ({ x: p.t, y: p.v, d: p.d, n: p.n }));
    CH.line(el, { height: 260, series: [{ name: 'Closed P&L', points: pts, color: getComputedStyle(document.documentElement).getPropertyValue('--chart-2').trim() || '#3f7fe8' }], tooltip: (p) => '<b>Closed P&L</b> ' + money(p.y, true) + '<br><span>' + (bucket === 'trade' ? 'trade' : 'bucket') + ' ' + money(p.d, true) + (p.n > 1 ? ' · ' + p.n + ' trades' : '') + '</span>', empty: 'Close a trade to draw the curve' });
  }
  function calendar(el, rangeEl, trades) {
    if (!trades.length) { el.innerHTML = ''; return; } const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }); const byDay = {}; for (const t of trades) { const k = fmt.format(new Date(t.exitT)); byDay[k] = byDay[k] || { net: 0, n: 0 }; byDay[k].net += t.pnl; byDay[k].n++; }
    const keys = Object.keys(byDay).sort(); const last = new Date(keys[keys.length - 1] + 'T12:00:00Z'); const first = new Date(keys[0] + 'T12:00:00Z'); const days = Math.min(365, Math.round((last - first) / 86400000) + 1); const start = new Date(last.getTime() - (days - 1) * 86400000); const max = Math.max(1, ...Object.values(byDay).map((d) => Math.abs(d.net)));
    let html = ''; for (let i = 0; i < days; i++) { const d = new Date(start.getTime() + i * 86400000); const k = d.toISOString().slice(0, 10); const v = byDay[k]; const a = v ? 0.3 + 0.7 * Math.abs(v.net) / max : 0; html += '<i' + (v ? ' data-tip="<b>' + k + '</b> ' + v.n + ' trades · ' + money(v.net, true) + '" style="background:' + (v.net >= 0 ? 'rgba(3,201,136,' + a + ')' : 'rgba(229,72,77,' + a + ')') + '"' : ' data-tip="' + k + '"') + '></i>'; }
    el.innerHTML = html; if (rangeEl) rangeEl.textContent = keys[0] + ' → ' + keys[keys.length - 1] + ' · ' + keys.length + ' trading days';
  }
  function coachCards(el, trades, limit) { const rep = COACH.report(trades, null, {}); const list = limit ? rep.findings.slice(0, limit) : rep.findings; el.innerHTML = '<div class="rp-findings">' + list.map((f) => '<div class="rp-finding is-' + f.severity + '"><b>' + esc(f.title) + '</b><p>' + esc(f.detail) + '</p><p class="rp-sugg">' + esc(f.suggestion) + '</p></div>').join('') + '</div>'; }
  function mistakesBlock(el, trades) { const m = {}; for (const t of trades) for (const k of (t.mistakes || [])) { m[k] = m[k] || { n: 0, cost: 0 }; m[k].n++; m[k].cost += t.pnl; } const keys = Object.keys(m).sort((a, b) => m[b].n - m[a].n); const withCl = trades.filter((t) => t.checklist && t.checklist.total), full = withCl.filter((t) => t.checklist.done === t.checklist.total); el.innerHTML = (keys.length ? '<table class="rp-table"><thead><tr><th>Mistake</th><th>Count</th><th>Share</th><th>Cost</th></tr></thead><tbody>' + keys.map((k) => '<tr><td>' + esc(k) + '</td><td>' + m[k].n + '</td><td>' + (100 * m[k].n / trades.length).toFixed(0) + '%</td><td class="' + cls(m[k].cost) + '">' + money(m[k].cost, true) + '</td></tr>').join('') + '</tbody></table>' : '<p class="rp-empty">No mistakes tagged yet. Tag them from the trade editor after each close.</p>') + '<p class="bt-note">' + trades.filter((t) => t.mistakes && t.mistakes.length).length + ' of ' + trades.length + ' trades carry a mistake tag' + (withCl.length ? ' · checklist fully completed on ' + full.length + ' of ' + withCl.length : '') + '.</p>'; }

  // ---- Dashboard -----------------------------------------------------------------------------
  function renderDashboard() {
    const rows = S.rows; const trades = rows.map((r) => r.t); const ov = A.overview(trades, startBalance(rows)); const dd = A.drawdown(trades, startBalance(rows));
    $('d-kpis').innerHTML = kpi('Total P&L', money(ov.net, true), (ov.returnPct >= 0 ? '+' : '') + ov.returnPct + '% on ' + money(startBalance(rows)), cls(ov.net)) + kpi('Win rate', pct(ov.winRate), ov.wins + ' W · ' + ov.losses + ' L · ' + ov.be + ' BE') + kpi('Total trades', ov.count, ov.longs + ' long · ' + ov.shorts + ' short') + kpi('Profit factor', ov.profitFactor === Infinity ? '∞' : ov.profitFactor.toFixed(2), 'gross ' + money(ov.grossProfit) + ' / ' + money(ov.grossLoss)) + kpi('Expectancy', money(ov.expectancy, true), 'per trade', cls(ov.expectancy)) + kpi('Avg R', ov.avgRR == null ? '—' : ov.avgRR.toFixed(2) + 'R', 'ideal ' + (ov.idealAvgRR == null ? '—' : ov.idealAvgRR.toFixed(2) + 'R')) + kpi('Max drawdown', money(-dd.maxDD), dd.maxDDPct + '% · ' + A.fmtDur(dd.longestMs) + ' longest', dd.maxDD ? 'down' : '') + kpi('Sessions', S.sessions.length, S.sessions.filter((s) => s.total && s.cursor < s.total - 1).length + ' in progress');
    pnlChart($('d-pnl'), rows, S.bucket); $('d-winners').innerHTML = winnersBlock(ov, true); $('d-losers').innerHTML = winnersBlock(ov, false); sideDonuts($('d-side'), rows, 'n');
    const sess = A.bySession(rows); CH.lollipop($('d-session'), { rows: sess.map((x) => ({ label: x.key, value: x.net, extra: x.n + ' trades · ' + x.winRate + '% win' })), fmt: (v) => money(v, true), signed: true, height: 200 });
    $('d-recent').innerHTML = S.sessions.slice(0, 5).map(sessionRow).join('') || '<p class="rp-empty">No sessions yet.</p>'; coachCards($('d-coach'), trades, 3); calendar($('d-cal'), $('d-cal-range'), trades);
  }
  function sessionRow(s) { const st = s.summary || {}; const p = s.total ? Math.round(100 * ((s.cursor || 0) + 1) / s.total) : 0; return '<div class="bt-sessrow"><div class="bt-ring" style="--p:' + p + '"><b>' + p + '%</b></div><div class="bt-sessrow-main"><b>' + esc(s.name || s.symbolId) + '</b><span>' + esc((s.symbolLabel || s.symbolId || '').split(' · ')[0]) + ' · ' + esc(s.tf || '') + ' · ' + new Date(s.startMs).toISOString().slice(0, 10) + '</span></div><div class="bt-sessrow-stats"><b class="' + cls(st.net || 0) + '">' + money(st.net || 0, true) + '</b><span>' + (st.count || s.trades.length) + ' trades · ' + (st.winRate || 0) + '%</span></div>' + (s.local ? '<a class="btn btn-secondary btn-sm" href="replay.html?session=' + encodeURIComponent(s.id) + '">Resume</a>' : '<span class="bt-cloud">cloud</span>') + '</div>'; }

  // ---- Sessions -------------------------------------------------------------------------------
  function renderSessions() {
    let list = S.sessions.filter((s) => !S.q || (s.name || '').toLowerCase().includes(S.q) || (s.symbolLabel || '').toLowerCase().includes(S.q));
    if (S.sort === 'pnl') list = list.slice().sort((a, b) => ((b.summary || {}).net || 0) - ((a.summary || {}).net || 0)); else if (S.sort === 'trades') list = list.slice().sort((a, b) => b.trades.length - a.trades.length);
    $('s-list').innerHTML = list.map((s) => { const st = s.summary || {}; const p = s.total ? Math.round(100 * ((s.cursor || 0) + 1) / s.total) : 0; const ov = A.overview(s.trades, s.startBalance || 0); const spark = A.pnlSeries(s.trades, 'trade'); const w = 160, h = 40; const ys = spark.map((x) => x.v); const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys) || 1; const path = spark.length > 1 ? spark.map((x, i) => (i ? 'L' : 'M') + (i / (spark.length - 1) * w).toFixed(1) + ' ' + (h - (x.v - lo) / (hi - lo || 1) * h).toFixed(1)).join(' ') : '';
      return '<div class="bt-sesscard" data-id="' + esc(s.id) + '"><div class="bt-sesscard-top"><div><b>' + esc(s.name || s.symbolId) + '</b><span>' + esc(s.symbolLabel || s.symbolId) + ' · ' + esc(s.tf || '') + '</span></div><div class="bt-ring" style="--p:' + p + '"><b>' + p + '%</b></div></div><svg class="bt-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + (path ? '<path d="' + path + '" fill="none" stroke="' + (ov.net >= 0 ? 'var(--bull)' : 'var(--bear)') + '" stroke-width="1.6"/>' : '') + '</svg><div class="bt-sesscard-kpis"><div><span>P&L</span><b class="' + cls(ov.net) + '">' + money(ov.net, true) + '</b></div><div><span>Trades</span><b>' + ov.count + '</b></div><div><span>Win</span><b>' + pct(ov.winRate) + '</b></div><div><span>PF</span><b>' + (ov.profitFactor === Infinity ? '∞' : ov.profitFactor.toFixed(2)) + '</b></div></div><div class="bt-sesscard-foot"><span>from ' + new Date(s.startMs).toISOString().slice(0, 10) + ' · ' + (s.updatedAt ? 'updated ' + new Date(s.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '') + (s.local ? '' : ' · cloud copy') + '</span>' + (s.local ? '<a class="btn btn-primary btn-sm" href="replay.html?session=' + encodeURIComponent(s.id) + '">Resume</a><button type="button" class="icon-btn" data-del title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>' : '') + '</div></div>'; }).join('') || '<p class="rp-empty">No sessions match.</p>';
  }

  // ---- Trades --------------------------------------------------------------------------------------
  function filterBar(el, opts) {
    const markets = [...new Set(S.sessions.map((s) => s.symbolId))]; const tags = [...new Set(S.rows.flatMap((r) => r.t.tags || []))];
    el.innerHTML = '<select data-f="assets"><option value="">All markets</option>' + markets.map((m) => '<option value="' + esc(m) + '">' + esc((S.sessions.find((s) => s.symbolId === m).symbolLabel || m).split(' · ')[0]) + '</option>').join('') + '</select>' +
      '<select data-f="side"><option value="all">Long &amp; short</option><option value="buy">Long</option><option value="sell">Short</option></select>' +
      '<select data-f="outcome"><option value="">Wins &amp; losses</option><option value="win">Wins</option><option value="loss">Losses</option><option value="be">Breakeven</option></select>' +
      '<select data-f="session"><option value="">All sessions</option>' + A.SESS.map((s) => '<option>' + s + '</option>').join('') + '</select>' +
      (tags.length ? '<select data-f="tag"><option value="">All setups</option>' + tags.map((t) => '<option>' + esc(t) + '</option>').join('') + '</select>' : '') +
      '<select data-f="wd"><option value="">Any day</option>' + A.WD.map((w) => '<option>' + w + '</option>').join('') + '</select>' +
      '<label class="bt-timef">Time <input type="number" data-f="h0" min="0" max="23" placeholder="0"> – <input type="number" data-f="h1" min="0" max="23" placeholder="23"> ET</label>' +
      '<input type="date" data-f="d0" title="From"><input type="date" data-f="d1" title="To">' +
      '<button type="button" class="bt-clear" data-clear>Clear</button>';
    el.querySelectorAll('[data-f]').forEach((c) => c.addEventListener('change', () => { readFilters(el); opts.onChange(); }));
    el.querySelector('[data-clear]').addEventListener('click', () => { el.querySelectorAll('select').forEach((s) => { s.selectedIndex = 0; }); el.querySelectorAll('input').forEach((i) => { i.value = ''; }); readFilters(el); opts.onChange(); });
  }
  function readFilters(el) {
    const g = (k) => { const c = el.querySelector('[data-f="' + k + '"]'); return c ? c.value : ''; };
    S.f = { assets: g('assets') ? [g('assets')] : [], side: g('side') || 'all', outcomes: g('outcome') ? [g('outcome')] : [], tags: g('tag') ? [g('tag')] : [], sessions: g('session') ? [g('session')] : [], weekdays: g('wd') ? [g('wd')] : [], hourFrom: g('h0') !== '' ? Number(g('h0')) : null, hourTo: g('h1') !== '' ? Number(g('h1')) : null, dateFrom: g('d0') ? Date.parse(g('d0') + 'T00:00:00Z') : null, dateTo: g('d1') ? Date.parse(g('d1') + 'T23:59:59Z') : null };
    if ((S.f.hourFrom == null) !== (S.f.hourTo == null)) { if (S.f.hourFrom == null) S.f.hourFrom = 0; if (S.f.hourTo == null) S.f.hourTo = 23; }
  }
  function renderTrades() {
    const rows = filteredRows().slice().sort((a, b) => b.t.exitT - a.t.exitT); const fmtP = (s, p) => Number(p).toFixed(D.findSymbol(s.symbolId) ? D.findSymbol(s.symbolId).decimals : 2);
    $('bt-count').textContent = rows.length + ' trades in view';
    $('t-table').innerHTML = rows.length ? '<table class="rp-table bt-trades"><thead><tr><th>Date (ET)</th><th>Session</th><th>Market</th><th>Side</th><th>Size</th><th>Entry → Exit</th><th>P&amp;L</th><th>R</th><th>Exit</th><th>Held</th><th>Setup</th><th></th></tr></thead><tbody>' + rows.slice(0, 500).map(({ s, t }) => '<tr data-sid="' + esc(s.id) + '" data-tid="' + t.id + '"><td>' + fmtDT.format(new Date(t.entryT)) + '<small>' + A.sessionOf(t.entryT) + '</small></td><td><small class="bt-sessname">' + esc(s.name || '') + '</small></td><td>' + esc((s.symbolLabel || s.symbolId || '').split(' · ')[0]) + '</td><td class="' + (t.side === 'buy' ? 'up' : 'down') + '">' + (t.side === 'buy' ? 'Long' : 'Short') + '</td><td>' + t.size + '</td><td>' + fmtP(s, t.entry) + ' → ' + fmtP(s, t.exit) + '</td><td class="' + cls(t.pnl) + '"><b>' + money(t.pnl, true) + '</b></td><td>' + (t.r != null ? t.r.toFixed(2) + 'R' : '—') + '</td><td>' + ({ sl: 'Stop', tp: 'Target', manual: 'Manual' }[t.reason] || t.reason) + '</td><td>' + A.fmtDur(t.exitT - t.entryT) + '</td><td class="rp-td-tags">' + (t.tags || []).map((x) => '<i>' + esc(x) + '</i>').join('') + (t.mistakes && t.mistakes.length ? '<i class="bad">' + t.mistakes.length + ' ✕</i>' : '') + '</td><td>' + (s.local ? '<button type="button" class="rp-mini" data-edit>✎</button>' : '') + '</td></tr>').join('') + '</tbody></table>' + (rows.length > 500 ? '<p class="bt-note">Showing the latest 500 of ' + rows.length + '.</p>' : '') : '<p class="rp-empty">No trades match these filters.</p>';
  }
  async function editTrade(sid, tid) {
    const full = await D.store.getSession(sid); if (!full || !full.sim) return; const t = full.sim.trades.find((x) => x.id === tid); if (!t) return;
    const [snapIn, snapOut] = await Promise.all([D.store.getSnap(sid + ':' + t.posId + ':entry'), D.store.getSnap(sid + ':' + t.posId + ':exit')]);
    const chips = (list, sel, attr) => list.map((x) => '<button type="button" class="rp-chip' + (sel.includes(x) ? ' is-on' : '') + '" data-' + attr + '="' + esc(x) + '">' + esc(x) + '</button>').join('');
    openModal('<h3>' + (t.side === 'buy' ? 'Long' : 'Short') + ' ' + t.size + ' · <span class="' + cls(t.pnl) + '">' + money(t.pnl, true) + (t.r != null ? ' (' + t.r.toFixed(2) + 'R)' : '') + '</span></h3><p class="rp-modal-sub">' + esc(full.name) + ' · ' + fmtDT.format(new Date(t.entryT)) + ' · ' + ({ sl: 'stopped out', tp: 'target hit', manual: 'closed manually' }[t.reason] || t.reason) + ' · MFE ' + money(t.mfe) + ' · MAE ' + money(-t.mae) + '</p><div class="rp-modal-grid"><div><h4>Setup</h4><div class="rp-chips" id="te-tags">' + chips(COACH.TAGS, t.tags || [], 'tag') + '</div><h4>Mistakes</h4><div class="rp-chips" id="te-mist">' + chips(COACH.MISTAKES, t.mistakes || [], 'mist') + '</div><h4>Notes</h4><textarea id="te-notes" rows="4">' + esc(t.notes || '') + '</textarea></div><div class="rp-snaps">' + (snapIn ? '<figure><img src="' + snapIn + '" alt="Entry"><figcaption>Entry</figcaption></figure>' : '') + (snapOut ? '<figure><img src="' + snapOut + '" alt="Exit"><figcaption>Exit</figcaption></figure>' : '') + (!snapIn && !snapOut ? '<p class="rp-empty">No snapshots for this trade.</p>' : '') + '</div></div><div class="rp-modal-actions"><button type="button" class="btn btn-secondary" data-close>Close</button><button type="button" class="btn btn-primary" id="te-save">Save</button></div>');
    document.querySelectorAll('#te-tags .rp-chip, #te-mist .rp-chip').forEach((b) => b.addEventListener('click', () => b.classList.toggle('is-on')));
    $('te-save').addEventListener('click', async () => { t.tags = [...document.querySelectorAll('#te-tags .is-on')].map((b) => b.dataset.tag); t.mistakes = [...document.querySelectorAll('#te-mist .is-on')].map((b) => b.dataset.mist); t.notes = $('te-notes').value.trim(); full.updatedAt = Date.now(); await D.store.putSession(full); closeModal(); await loadAll(); route(); });
  }

  // ---- Analytics -----------------------------------------------------------------------------------------
  function renderAnalytics() {
    const rows = filteredRows(); const trades = rows.map((r) => r.t); const sb = startBalance(rows); const ov = A.overview(trades, sb);
    $('bt-count').textContent = trades.length + ' trades · ' + new Set(rows.map((r) => r.s.id)).size + ' sessions in view';
    $('a-perf').hidden = S.aTab !== 'perf'; $('a-dd').hidden = S.aTab !== 'dd'; $('a-sim').hidden = S.aTab !== 'sim';
    if (S.aTab === 'perf') {
      $('a-kpis').innerHTML = kpi('Total P&L', money(ov.net, true), (ov.returnPct >= 0 ? '+' : '') + ov.returnPct + '%', cls(ov.net)) + kpi('Account balance', money(ov.balance), 'from ' + money(sb)) + kpi('Win rate', pct(ov.winRate)) + kpi('Total trades', ov.count, ov.wins + '/' + ov.count + ' won') + kpi('Breakeven trades', ov.be) + kpi('Fees', money(ov.fees));
      pnlChart($('a-pnl'), rows, S.aBucket);
      const rr = (l, v) => '<div class="bt-kpi bt-kpi-wide"><span>' + l + '</span><b>' + v + '</b></div>';
      $('a-rr').innerHTML = '<div class="bt-card bt-rrcard">' + rr('Average RR', ov.avgRR == null ? '—' : ov.avgRR.toFixed(2)) + rr('Max RR', ov.maxRR == null ? '—' : ov.maxRR.toFixed(2)) + '</div><div class="bt-card bt-rrcard">' + rr('Ideal average RR', ov.idealAvgRR == null ? '—' : ov.idealAvgRR.toFixed(2)) + rr('Max ideal RR', ov.maxIdealRR == null ? '—' : ov.maxIdealRR.toFixed(2)) + '<p class="bt-note">Ideal = best price the trade reached (MFE) over the risk taken.</p></div><div class="bt-card bt-rrcard">' + rr('Could have been BE', ov.couldHaveBE) + rr('of losses', ov.losses) + '<p class="bt-note">Losers that went at least 1R in your favour before stopping out.</p></div>';
      const expEl = $('a-exp'); const maxAbs = Math.max(Math.abs(ov.avgWin), Math.abs(ov.avgLoss), Math.abs(ov.expectancy), 1); expEl.innerHTML = '<div class="bt-card-head"><h3>Expectancy</h3></div><div class="bt-expect"><b class="' + cls(ov.expectancy) + '">' + money(ov.expectancy, true) + '</b><span>per trade · ' + ov.count + ' trades</span></div><div class="bt-expbar"><div class="bt-expbar-track"><i class="p" style="width:' + (50 * ov.avgWin / maxAbs) + '%"></i><i class="n" style="width:' + (50 * Math.abs(ov.avgLoss) / maxAbs) + '%"></i><em style="left:' + Math.max(2, Math.min(98, 50 + 50 * ov.expectancy / maxAbs)) + '%"></em></div><div class="bt-expbar-lbl"><span class="down">avg loss ' + money(ov.avgLoss) + '</span><span class="up">avg win ' + money(ov.avgWin, true) + '</span></div></div>';
      const pfEl = $('a-pf'); pfEl.innerHTML = '<div class="bt-card-head"><h3>Profit factor</h3></div><div class="bt-gaugewrap"></div><p class="bt-note">Gross profit ÷ gross loss. Below 1 loses money; 1.5+ is a workable edge; 2+ is strong.</p>'; CH.gauge(pfEl.querySelector('.bt-gaugewrap'), { value: ov.profitFactor === Infinity ? 3 : ov.profitFactor, max: 3, display: ov.profitFactor === Infinity ? '∞' : ov.profitFactor.toFixed(2), label: 'target ≥ 1.5', good: 1.5, ok: 1, marker: 1.5, size: 200 });
      $('a-winners').innerHTML = winnersBlock(ov, true); $('a-losers').innerHTML = winnersBlock(ov, false);
      sideDonuts($('a-side-n'), rows, 'n'); sideDonuts($('a-side-wr'), rows, 'wr');
      sessionLollipops(rows, { wr: $('a-sess-wr'), n: $('a-sess-n'), rr: $('a-sess-rr'), p: $('a-sess-p') });
      const hb = (el, g, keyLabel) => CH.hbars(el, { rows: g.map((x) => ({ label: x.key, value: x.net, sub: x.n, tip: '<b>' + esc(x.key) + '</b> ' + x.n + ' trades · ' + x.winRate + '% win · ' + money(x.expectancy, true) + '/trade' })), fmt: (v) => money(v, true) });
      hb($('a-hour'), A.byHour(rows)); hb($('a-wd'), A.byWeekday(rows)); hb($('a-tag'), A.byTag(rows)); hb($('a-asset'), A.byAsset(rows)); hb($('a-exit'), A.byExit(rows));
      CH.hist($('a-rhist'), { bins: A.rHistogram(trades).map((b) => ({ label: b.label, n: b.n, neg: b.hi <= 0 })) });
      mistakesBlock($('a-mistakes'), trades); coachCards($('a-coach'), trades);
    } else if (S.aTab === 'dd') {
      const dd = A.drawdown(trades, sb);
      $('dd-kpis').innerHTML = kpi('Max drawdown', money(-dd.maxDD), dd.maxDDPct + '% of peak', dd.maxDD ? 'down' : '') + kpi('Longest drawdown', A.fmtDur(dd.longestMs), 'time under water') + kpi('Average drawdown', money(-dd.avgDD), 'while below a peak') + kpi('Recovery factor', dd.recoveryFactor == null ? '—' : dd.recoveryFactor.toFixed(2), 'net profit ÷ max DD') + kpi('Current drawdown', money(-dd.current), dd.currentPct + '%', dd.current ? 'down' : '') + kpi('Drawdown periods', dd.periods);
      const red = getComputedStyle(document.documentElement).getPropertyValue('--bear').trim() || '#e5484d';
      CH.line($('dd-chart'), { height: 240, series: [{ name: 'Drawdown', color: red, points: dd.series.map((p) => ({ x: p.t, y: p.dd, pct: p.ddPct })) }], tooltip: (p) => '<b>Drawdown</b> ' + money(p.y) + ' <span>(' + p.pct + '%)</span>', empty: 'Close a trade to measure drawdown' });
      CH.line($('dd-eq'), { height: 200, series: [{ name: 'Equity', points: dd.series.map((p) => ({ x: p.t, y: p.eq - sb })) }], tooltip: (p) => '<b>Closed P&L</b> ' + money(p.y, true), empty: 'No closed trades' });
    } else {
      const runs = Number($('sim-runs').value) || 500, ruinPct = Number($('sim-ruin').value) || 10; const mc = A.monteCarlo(trades, { runs, startBalance: sb, ruinPct });
      if (!mc) { $('sim-kpis').innerHTML = ''; $('sim-fan').innerHTML = '<p class="rp-empty">Needs at least two closed trades.</p>'; return; }
      $('sim-kpis').innerHTML = kpi('Median outcome', money(mc.final.p50, true), 'same trades, random order', cls(mc.final.p50)) + kpi('5% – 95% range', money(mc.final.p5, true) + ' … ' + money(mc.final.p95, true)) + kpi('Chance of a losing run', pct(mc.final.probLoss), 'of ' + runs + ' shuffles end negative') + kpi('Median max drawdown', money(-mc.maxDD.p50), 'worst case ' + money(-mc.maxDD.worst), 'down') + kpi('95% max drawdown', money(-mc.maxDD.p95), '1 in 20 sequences is worse', 'down') + kpi('Risk of ' + ruinPct + '% ruin', pct(mc.ruinProb), sb ? 'on ' + money(sb) : 'set a balance', mc.ruinProb > 5 ? 'down' : '');
      CH.fan($('sim-fan'), { bands: mc.bands, actual: mc.actual, runs, height: 280 });
    }
  }

  // ---- routing / boot ----------------------------------------------------------------------------------
  const TITLES = { dashboard: ['Dashboard', 'Your edge across every replay session.'], sessions: ['Sessions', 'Resume, review or clean up your backtests.'], trades: ['Trades', 'Every closed trade across all sessions, filterable.'], analytics: ['Analytics', 'FX-desk-style performance, drawdown and Monte Carlo analysis.'] };
  function route() {
    const h = (location.hash || '#dashboard').slice(1); const view = TITLES[h] ? h : 'dashboard';
    document.querySelectorAll('.bt-view').forEach((v) => { v.hidden = v.id !== 'v-' + view; }); $('bt-title').textContent = TITLES[view][0]; $('bt-sub').textContent = TITLES[view][1]; $('bt-count').textContent = '';
    const empty = !S.sessions.length; $('bt-empty').hidden = !empty; if (empty) { document.querySelectorAll('.bt-view').forEach((v) => { v.hidden = true; }); return; }
    if (view === 'dashboard') renderDashboard(); else if (view === 'sessions') renderSessions(); else if (view === 'trades') renderTrades(); else renderAnalytics();
  }
  function openModal(html) { const m = $('bt-modal'); m.querySelector('.rp-modal-card').innerHTML = html; m.hidden = false; m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal)); }
  function closeModal() { $('bt-modal').hidden = true; }
  async function boot(uid) {
    S.uid = uid; $('bt-locked').style.display = 'none'; $('bt-app').style.display = ''; await loadAll();
    filterBar($('t-filters'), { onChange: renderTrades }); filterBar($('a-filters'), { onChange: renderAnalytics });
    document.querySelectorAll('#d-bucket button').forEach((b) => b.addEventListener('click', () => { S.bucket = b.dataset.b; document.querySelectorAll('#d-bucket button').forEach((x) => x.classList.toggle('is-on', x === b)); pnlChart($('d-pnl'), S.rows, S.bucket); }));
    document.querySelectorAll('#a-bucket button').forEach((b) => b.addEventListener('click', () => { S.aBucket = b.dataset.b; document.querySelectorAll('#a-bucket button').forEach((x) => x.classList.toggle('is-on', x === b)); pnlChart($('a-pnl'), filteredRows(), S.aBucket); }));
    document.querySelectorAll('#a-tabs button').forEach((b) => b.addEventListener('click', () => { S.aTab = b.dataset.t; document.querySelectorAll('#a-tabs button').forEach((x) => x.classList.toggle('is-on', x === b)); renderAnalytics(); }));
    document.querySelectorAll('#s-sort button').forEach((b) => b.addEventListener('click', () => { S.sort = b.dataset.s; document.querySelectorAll('#s-sort button').forEach((x) => x.classList.toggle('is-on', x === b)); renderSessions(); }));
    $('s-q').addEventListener('input', (e) => { S.q = e.target.value.trim().toLowerCase(); renderSessions(); });
    $('sim-runs').addEventListener('change', renderAnalytics); $('sim-ruin').addEventListener('change', renderAnalytics);
    $('s-list').addEventListener('click', async (e) => { const card = e.target.closest('.bt-sesscard'); if (!card || !e.target.closest('[data-del]')) return; if (!confirm('Delete this session and its snapshots from this browser?')) return; await D.store.deleteSession(card.dataset.id); D.store.deleteSnaps(card.dataset.id); if (S.uid && typeof db !== 'undefined' && db) db.collection('students').doc(S.uid).collection('replay').doc(card.dataset.id).delete().catch(() => {}); await loadAll(); route(); });
    $('t-table').addEventListener('click', (e) => { const row = e.target.closest('tr[data-sid]'); if (row && e.target.closest('[data-edit]')) editTrade(row.dataset.sid, Number(row.dataset.tid)); });
    $('bt-modal').addEventListener('click', (e) => { if (e.target === $('bt-modal')) closeModal(); });
    document.addEventListener('mousemove', (e) => { const c = e.target.closest && e.target.closest('.bt-cal i[data-tip]'); if (c) { const tip = document.querySelector('.btc-tip') || (function () { const t = document.createElement('div'); t.className = 'btc-tip'; document.body.appendChild(t); return t; })(); tip.innerHTML = c.dataset.tip; tip.style.display = 'block'; tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY - 34) + 'px'; } else if (!e.target.closest || !e.target.closest('.btc, .btc-hb-row, .btc-donut')) CH.hideTip(); });
    window.addEventListener('hashchange', route); let rt = null; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(route, 150); }); route();
  }
  function showLocked() { $('bt-app').style.display = 'none'; const plans = (typeof getCachedPlansForRoles === 'function') ? getCachedPlansForRoles() : []; const m = plans.find((p) => (p.rank ?? 0) >= MIN_RANK); const btn = $('bt-locked-btn'); if (btn && m) btn.textContent = 'Go ' + m.name + ' to unlock'; $('bt-locked').style.display = ''; }
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof auth === 'undefined' || !auth || !$('bt-app')) return; let handled = false;
    auth.onAuthStateChanged((user) => { if (handled) return; if (!user) { setTimeout(() => { if (!handled && typeof goToLoginPreservingReturn === 'function') goToLoginPreservingReturn(); }, 1500); return; } handled = true;
      const a = db.collection('admins').doc(user.uid).get().catch(() => null), s = db.collection('students').doc(user.uid).get().catch(() => null), r = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();
      Promise.all([a, s, r]).then(([ad, sd]) => { if (ad && ad.exists) return true; const plan = (sd && sd.exists) ? sd.data().plan : null; if (!plan || typeof rankOf !== 'function' || typeof findPlan !== 'function' || !findPlan(plan)) return true; return rankOf(plan) >= MIN_RANK; }).catch(() => true).then((ok) => ok ? boot(user.uid) : showLocked()); });
  });
})();
