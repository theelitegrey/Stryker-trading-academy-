/**
 * Stryker Trading Academy — Backtests dashboard (backtests.html)
 *
 * Aggregates every replay session saved in this browser (IndexedDB) plus the
 * best-effort cloud copies under students/{uid}/replay, and shows the edge
 * across all of them: tiles, breakdowns by market / setup / hour / weekday /
 * session / R, a P&L calendar, cumulative equity, mistake tracking, the
 * coach's read over the pooled trades, and the session list.
 * Gate: Pro and above, same as the replay page.
 */
(function () {
  'use strict';
  const D = window.ReplayData, E = window.ReplayEngine, COACH = window.ReplayCoach;
  const MIN_RANK = 1; const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, sign) => { const v = Number(n) || 0; return (v < 0 ? '-' : (sign && v > 0 ? '+' : '')) + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
  let ALL = [];   // { session, trade }

  async function loadAll(uid) {
    const local = await D.store.listSessions(); const byId = {};
    for (const s of local) byId[s.id] = { id: s.id, name: s.name, symbolId: s.symbolId, symbolLabel: s.symbolLabel, startMs: s.startMs, cursor: s.cursor, total: s.total, tf: s.tf, updatedAt: s.updatedAt, summary: s.summary, startBalance: s.sim ? s.sim.startBalance : s.balance, trades: s.sim ? s.sim.trades : [], local: true };
    if (uid && typeof db !== 'undefined' && db) { try { const snap = await db.collection('students').doc(uid).collection('replay').get(); snap.forEach((d) => { const c = d.data(); if (!byId[d.id]) byId[d.id] = { id: d.id, name: c.name, symbolId: c.symbolId, symbolLabel: c.symbolLabel, startMs: c.startMs, cursor: c.cursor, total: c.total, tf: c.tf, updatedAt: c.updatedAt, summary: c.summary, startBalance: c.startBalance, trades: c.trades || [], local: false }; }); } catch (e) { console.warn('cloud sessions unavailable', e && e.message); } }
    return Object.values(byId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  function filtered(sessions) {
    const mk = $('bt-f-market').value, ss = $('bt-f-session').value, per = $('bt-f-period').value; const since = per === 'all' ? 0 : Date.now() - Number(per) * 86400000;
    const out = []; for (const s of sessions) { if (mk && s.symbolId !== mk) continue; if (since && (s.updatedAt || 0) < since) continue; for (const t of s.trades) { if (ss && COACH.sessionOf(t.entryT) !== ss) continue; out.push({ s, t }); } }
    return out;
  }
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  function bars(el, groups, fmtKey) {
    if (!groups.length) { el.innerHTML = '<p class="rp-empty">No trades in this view.</p>'; return; }
    const max = Math.max(1, ...groups.map((g) => Math.abs(g.net)));
    el.innerHTML = groups.map((g) => '<div class="bt-bar"><span title="' + esc(g.key) + '">' + esc(fmtKey ? fmtKey(g.key) : g.key) + '</span><div class="bt-track"><i class="' + (g.net >= 0 ? 'pos' : 'neg') + '" style="width:' + (50 * Math.abs(g.net) / max) + '%"></i></div><span class="' + (g.net >= 0 ? 'up' : 'down') + '">' + money(g.net, true) + '<small>' + g.n + '</small></span></div>').join('');
  }
  function group(rows, keyFn, order) { const g = {}; for (const r of rows) { const k = keyFn(r); if (k == null) continue; (g[k] = g[k] || []).push(r.t); } const out = Object.keys(g).map((k) => ({ key: k, n: g[k].length, net: sum(g[k].map((t) => t.pnl)), wins: g[k].filter((t) => t.pnl > 0).length })); if (order) out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)); else out.sort((a, b) => b.net - a.net); return out; }

  function render(sessions) {
    const rows = filtered(sessions); const trades = rows.map((r) => r.t).sort((a, b) => a.exitT - b.exitT);
    $('bt-count').textContent = trades.length + ' trades · ' + new Set(rows.map((r) => r.s.id)).size + ' sessions in view';
    $('bt-empty').hidden = sessions.length > 0; $('bt-content').hidden = sessions.length === 0; if (!sessions.length) return;
    const st = E.stats(trades, null, 0); const pf = st.profitFactor == null ? '—' : st.profitFactor === Infinity ? '∞' : st.profitFactor.toFixed(2);
    const tile = (l, v, cls) => '<div class="rp-stat"><span>' + l + '</span><b class="' + (cls || '') + '">' + v + '</b></div>';
    $('bt-tiles').innerHTML = tile('Net P&L', money(st.net, true), st.net > 0 ? 'up' : st.net < 0 ? 'down' : '') + tile('Trades', st.count + ' <small>' + st.longs + 'L / ' + st.shorts + 'S</small>') + tile('Win rate', st.winRate + '%') + tile('Profit factor', pf) + tile('Expectancy', money(st.expectancy, true) + ' <small>/ trade</small>') + tile('Avg R', st.avgR != null ? st.avgR.toFixed(2) + 'R' : '—') + tile('Avg win / loss', money(st.avgWin) + ' / ' + money(st.avgLoss)) + tile('Best / worst', money(st.best, true) + ' / ' + money(st.worst, true)) + tile('Longest streaks', st.maxWinStreak + ' W · ' + st.maxLossStreak + ' L') + tile('Fees', money(st.fees));
    bars($('bt-by-market'), group(rows, (r) => (r.s.symbolLabel || r.s.symbolId || '').split(' · ')[0]));
    bars($('bt-by-tag'), group(rows.flatMap((r) => (r.t.tags && r.t.tags.length ? r.t.tags : ['Untagged']).map((tag) => ({ s: r.s, t: r.t, tag }))), (r) => r.tag));
    const hours = Array.from({ length: 24 }, (_, i) => String(i)); bars($('bt-by-hour'), group(rows, (r) => String(COACH.nyMinutes(r.t.entryT).hour), hours), (k) => String(k).padStart(2, '0') + ':00');
    const wds = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; bars($('bt-by-wd'), group(rows, (r) => COACH.nyMinutes(r.t.entryT).wd, wds));
    bars($('bt-by-sess'), group(rows, (r) => COACH.sessionOf(r.t.entryT), ['Asia', 'London', 'New York', 'Off hours']));
    const rb = (r) => r == null ? null : r <= -1.5 ? '< -1.5R' : r < -0.5 ? '-1.5 … -0.5R' : r < 0.5 ? '-0.5 … 0.5R' : r < 1.5 ? '0.5 … 1.5R' : r < 3 ? '1.5 … 3R' : '> 3R'; bars($('bt-by-r'), group(rows, (r) => rb(r.t.r), ['< -1.5R', '-1.5 … -0.5R', '-0.5 … 0.5R', '0.5 … 1.5R', '1.5 … 3R', '> 3R']));
    renderCalendar(trades); renderEquity(trades); renderMistakes(trades);
    const rep = COACH.report(trades, null, {}); $('bt-coach').innerHTML = '<div class="rp-findings">' + rep.findings.map((f) => '<div class="rp-finding is-' + f.severity + '"><b>' + esc(f.title) + '</b><p>' + esc(f.detail) + '</p><p class="rp-sugg">' + esc(f.suggestion) + '</p></div>').join('') + '</div>';
    renderSessions(sessions);
  }
  function renderCalendar(trades) {
    const el = $('bt-cal'); if (!trades.length) { el.innerHTML = ''; return; }
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }); const byDay = {}; for (const t of trades) { const k = fmt.format(new Date(t.exitT)); byDay[k] = byDay[k] || { net: 0, n: 0 }; byDay[k].net += t.pnl; byDay[k].n++; }
    const keys = Object.keys(byDay).sort(); const first = new Date(keys[0] + 'T12:00:00Z'), last = new Date(keys[keys.length - 1] + 'T12:00:00Z'); const days = Math.min(400, Math.round((last - first) / 86400000) + 1); const start = new Date(last.getTime() - (days - 1) * 86400000);
    const max = Math.max(1, ...Object.values(byDay).map((d) => Math.abs(d.net))); let html = '';
    for (let i = 0; i < days; i++) { const d = new Date(start.getTime() + i * 86400000); const k = d.toISOString().slice(0, 10); const v = byDay[k]; const a = v ? 0.25 + 0.75 * Math.abs(v.net) / max : 0; const col = v ? (v.net >= 0 ? 'rgba(3,201,136,' + a + ')' : 'rgba(229,72,77,' + a + ')') : ''; html += '<i' + (v ? ' title="' + k + ' · ' + v.n + ' trades · ' + money(v.net, true) + '" style="background:' + col + '"' : ' title="' + k + '"') + '></i>'; }
    el.innerHTML = html; $('bt-cal-range').textContent = keys[0] + ' → ' + keys[keys.length - 1] + ' · ' + keys.length + ' trading days';
  }
  function renderEquity(trades) {
    const c = $('bt-eq'); const w = c.clientWidth || 500, h = c.clientHeight || 180; const d = window.devicePixelRatio || 1; c.width = w * d; c.height = h * d; const ctx = c.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
    if (trades.length < 2) { ctx.fillStyle = '#8b93a0'; ctx.font = '12px sans-serif'; ctx.fillText('Needs at least two closed trades.', 12, 24); return; }
    const pts = [0]; let acc = 0; for (const t of trades) { acc += t.pnl; pts.push(acc); } const mn = Math.min(0, ...pts), mx = Math.max(0, ...pts); const pad = (mx - mn || 1) * 0.1;
    const x = (i) => 8 + i / (pts.length - 1) * (w - 16), y = (v) => 8 + (mx + pad - v) / (mx - mn + 2 * pad) * (h - 16);
    ctx.strokeStyle = 'rgba(139,147,160,0.4)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(8, y(0)); ctx.lineTo(w - 8, y(0)); ctx.stroke(); ctx.setLineDash([]);
    const col = acc >= 0 ? '#03c988' : '#e5484d'; ctx.beginPath(); pts.forEach((v, i) => { i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)); }); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineTo(x(pts.length - 1), y(0)); ctx.lineTo(8, y(0)); ctx.closePath(); ctx.fillStyle = acc >= 0 ? 'rgba(3,201,136,0.12)' : 'rgba(229,72,77,0.12)'; ctx.fill();
    ctx.fillStyle = '#8b93a0'; ctx.font = '11px JetBrains Mono, monospace'; ctx.fillText(money(mx, true), 10, 18); ctx.fillText(money(mn, true), 10, h - 12);
  }
  function renderMistakes(trades) {
    const m = {}; let tagged = 0; for (const t of trades) { if (t.mistakes && t.mistakes.length) tagged++; for (const k of (t.mistakes || [])) { m[k] = m[k] || { n: 0, cost: 0 }; m[k].n++; m[k].cost += t.pnl; } }
    const keys = Object.keys(m).sort((a, b) => m[b].n - m[a].n); const withCl = trades.filter((t) => t.checklist && t.checklist.total); const full = withCl.filter((t) => t.checklist.done === t.checklist.total);
    $('bt-mistakes').innerHTML = (keys.length ? '<table class="rp-table"><thead><tr><th>Mistake</th><th>Count</th><th>Share</th><th>Cost</th></tr></thead><tbody>' + keys.map((k) => '<tr><td>' + esc(k) + '</td><td>' + m[k].n + '</td><td>' + (100 * m[k].n / trades.length).toFixed(0) + '%</td><td class="' + (m[k].cost >= 0 ? 'up' : 'down') + '">' + money(m[k].cost, true) + '</td></tr>').join('') + '</tbody></table>' : '<p class="rp-empty">No mistakes tagged yet. Tag them from the trade editor after each close.</p>') +
      '<p class="rp-fine">' + tagged + ' of ' + trades.length + ' trades carry a mistake tag' + (withCl.length ? ' · checklist completed fully on ' + full.length + ' of ' + withCl.length + ' checked trades' : '') + '.</p>';
  }
  function renderSessions(sessions) {
    $('bt-sess-count').textContent = sessions.length + ' total';
    $('bt-sessions').innerHTML = sessions.map((s) => { const st = s.summary || {}; const pct = s.total ? Math.round(100 * ((s.cursor || 0) + 1) / s.total) : 0; return '<div class="rp-sess" data-id="' + esc(s.id) + '"><div class="rp-sess-main"><b>' + esc(s.name || s.symbolId) + '</b><span>' + esc(s.symbolLabel || s.symbolId) + ' · ' + esc(s.tf || '') + ' · from ' + new Date(s.startMs).toISOString().slice(0, 10) + ' · ' + pct + '% replayed' + (s.local ? '' : ' · cloud copy') + '</span></div><div class="rp-sess-stats"><span class="' + ((st.net || 0) >= 0 ? 'up' : 'down') + '">' + money(st.net || 0, true) + '</span><span>' + (st.count || s.trades.length || 0) + ' trades · ' + (st.winRate || 0) + '% win' + (st.pf != null ? ' · PF ' + st.pf : '') + '</span></div><div class="rp-sess-actions">' + (s.local ? '<a class="btn btn-primary btn-sm" href="replay.html?session=' + encodeURIComponent(s.id) + '">Resume</a><button type="button" class="icon-btn" data-del title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>' : '<span class="rp-fine" style="margin:0">Saved on another device</span>') + '</div></div>'; }).join('');
  }
  function fillFilters(sessions) { const mk = $('bt-f-market'); const seen = {}; for (const s of sessions) if (!seen[s.symbolId]) { seen[s.symbolId] = true; mk.insertAdjacentHTML('beforeend', '<option value="' + esc(s.symbolId) + '">' + esc((s.symbolLabel || s.symbolId).split(' · ')[0]) + '</option>'); } const ss = $('bt-f-session'); for (const k of ['Asia', 'London', 'New York', 'Off hours']) ss.insertAdjacentHTML('beforeend', '<option value="' + k + '">' + k + '</option>'); }

  async function boot(uid) {
    $('bt-locked').style.display = 'none'; $('bt-app').style.display = '';
    let sessions = await loadAll(uid); fillFilters(sessions); render(sessions);
    ['bt-f-market', 'bt-f-session', 'bt-f-period'].forEach((id) => $(id).addEventListener('change', () => render(sessions)));
    $('bt-sessions').addEventListener('click', async (e) => { const card = e.target.closest('.rp-sess'); if (!card || !e.target.closest('[data-del]')) return; if (!confirm('Delete this saved session and its snapshots from this browser?')) return; await D.store.deleteSession(card.dataset.id); D.store.deleteSnaps(card.dataset.id); if (uid && typeof db !== 'undefined' && db) db.collection('students').doc(uid).collection('replay').doc(card.dataset.id).delete().catch(() => {}); sessions = await loadAll(uid); render(sessions); });
    window.addEventListener('resize', () => render(sessions));
  }
  function showLocked() { $('bt-app').style.display = 'none'; const plans = (typeof getCachedPlansForRoles === 'function') ? getCachedPlansForRoles() : []; const m = plans.find((p) => (p.rank ?? 0) >= MIN_RANK); const btn = $('bt-locked-btn'); if (btn && m) btn.textContent = 'Go ' + m.name + ' to unlock'; $('bt-locked').style.display = ''; }
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof auth === 'undefined' || !auth || !$('bt-app')) return; let handled = false;
    auth.onAuthStateChanged((user) => {
      if (handled) return; if (!user) { setTimeout(() => { if (!handled && typeof goToLoginPreservingReturn === 'function') goToLoginPreservingReturn(); }, 1500); return; } handled = true;
      const a = db.collection('admins').doc(user.uid).get().catch(() => null), s = db.collection('students').doc(user.uid).get().catch(() => null), r = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();
      Promise.all([a, s, r]).then(([ad, sd]) => { if (ad && ad.exists) return true; const plan = (sd && sd.exists) ? sd.data().plan : null; if (!plan || typeof rankOf !== 'function' || typeof findPlan !== 'function' || !findPlan(plan)) return true; return rankOf(plan) >= MIN_RANK; }).catch(() => true).then((ok) => ok ? boot(user.uid) : showLocked());
    });
  });
})();
