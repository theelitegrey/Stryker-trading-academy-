// Stryker Trading Academy — Trade Journal: Zella-style dashboard widgets
// Depends on: journal-calc.js, Chart.js, the JOURNAL_* globals, and
// jCountUp (journal-propfirms.js). Called by renderDashboardTab.
//
// The layout language mirrors what serious journaling products (TradeZella
// et al.) converged on: one hero Net P&L number, a six-axis performance
// radar with a single composite score, KPI tiles that carry a small gauge
// instead of a bare number, a month calendar of daily P&L with weekly
// totals, and a recent-trades strip. All computed locally from the
// student's own trades.

let JZ_RADAR_CHART = null;

// ---- metrics ----------------------------------------------------------------
// Six axes, each normalized to 0-100. The composite "Stryker Score" is their
// mean. Normalisation caps are the conventional "excellent" thresholds:
// profit factor 3, avg win/loss 2.5, recovery factor 3.
function jzComputeMetrics(trades){
  const closed = trades.filter((t) => t.pnl !== null && t.pnl !== undefined && t.date);
  if (closed.length < 3) return null;

  const stats = journalAggregateStats(closed);

  // daily aggregates
  const byDay = {};
  closed.forEach((t) => { byDay[t.date] = (byDay[t.date] || 0) + t.pnl; });
  const days = Object.keys(byDay);
  const greenDays = days.filter((d) => byDay[d] > 0).length;
  const dayWinRate = days.length ? (greenDays / days.length) * 100 : 0;

  // max drawdown on the trade-by-trade equity curve
  const chrono = closed.slice().sort((a, b) =>
    ((a.date || '') + 'T' + (a.time || '00:00')).localeCompare((b.date || '') + 'T' + (b.time || '00:00')));
  let equity = 0, peak = 0, maxDD = 0;
  chrono.forEach((t) => {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    if (peak - equity > maxDD) maxDD = peak - equity;
  });
  const recoveryFactor = maxDD > 0 ? Math.max(0, stats.totalPnl) / maxDD : (stats.totalPnl > 0 ? 3 : 0);

  // consistency: how little the book depends on one outlier day
  const absTotal = days.reduce((s, d) => s + Math.abs(byDay[d]), 0);
  const biggestDay = days.length ? Math.max(...days.map((d) => Math.abs(byDay[d]))) : 0;
  const consistency = absTotal > 0 ? Math.max(0, (1 - biggestDay / absTotal)) * 100 / 0.9 : 0;

  const avgWL = stats.avgLoss > 0 ? stats.avgWin / stats.avgLoss : (stats.avgWin > 0 ? 2.5 : 0);
  const pf = isFinite(stats.profitFactor) ? stats.profitFactor : 3;

  const axes = {
    winRate: Math.min(100, stats.winRate),
    profitFactor: Math.min(100, (pf / 3) * 100),
    avgWinLoss: Math.min(100, (avgWL / 2.5) * 100),
    dayWinRate: Math.min(100, dayWinRate),
    recovery: Math.min(100, (recoveryFactor / 3) * 100),
    consistency: Math.min(100, consistency)
  };
  const score = Math.round(Object.values(axes).reduce((a, b) => a + b, 0) / 6);

  return {
    axes, score, stats,
    dayWinRate, greenDays, totalDays: days.length,
    maxDD, recoveryFactor, avgWL, pf: stats.profitFactor
  };
}

// ---- radar ------------------------------------------------------------------
function jzRenderRadar(m){
  const canvas = document.getElementById('jz-radar');
  const scoreEl = document.getElementById('jz-score');
  if (!canvas || typeof Chart === 'undefined') return;
  if (JZ_RADAR_CHART) { JZ_RADAR_CHART.destroy(); JZ_RADAR_CHART = null; }

  if (!m) {
    if (scoreEl) scoreEl.textContent = '—';
    return;
  }
  if (scoreEl && typeof jCountUp === 'function') {
    jCountUp(scoreEl, m.score, (v) => String(Math.round(v)));
  } else if (scoreEl) scoreEl.textContent = m.score;

  const hue = m.score >= 70 ? '#03c988' : (m.score >= 45 ? '#f5c542' : '#e5484d');
  const scoreSub = document.getElementById('jz-score-label');
  if (scoreSub) {
    scoreSub.textContent = m.score >= 70 ? 'STRONG' : (m.score >= 45 ? 'DEVELOPING' : 'AT RISK');
    scoreSub.style.color = hue;
  }

  JZ_RADAR_CHART = new Chart(canvas.getContext('2d'), {
    type: 'radar',
    data: {
      labels: ['Win %', 'Profit factor', 'Avg win/loss', 'Day win %', 'Recovery', 'Consistency'],
      datasets: [{
        data: [m.axes.winRate, m.axes.profitFactor, m.axes.avgWinLoss,
               m.axes.dayWinRate, m.axes.recovery, m.axes.consistency],
        backgroundColor: 'rgba(3,201,136,0.14)',
        borderColor: '#03c988', borderWidth: 2,
        pointBackgroundColor: '#03c988', pointRadius: 3, pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => Math.round(ctx.parsed.r) + ' / 100' } }
      },
      scales: {
        r: {
          min: 0, max: 100,
          ticks: { display: false, stepSize: 25 },
          grid: { color: 'rgba(62,69,80,0.5)' },
          angleLines: { color: 'rgba(62,69,80,0.5)' },
          pointLabels: { color: JCOLOR.ink2, font: { size: 10, family: "'JetBrains Mono', monospace" } }
        }
      }
    }
  });
}

// ---- gauge tiles ------------------------------------------------------------
function jzArc(pct, colour){
  const clamped = Math.max(0, Math.min(1, pct));
  const circ = 2 * Math.PI * 26;
  const dash = clamped * circ * 0.75;
  return '<svg viewBox="0 0 64 54" class="jz-arc">' +
    '<path d="M9 46 A 26 26 0 1 1 55 46" fill="none" stroke="#1e1e22" stroke-width="6" stroke-linecap="round"/>' +
    '<path d="M9 46 A 26 26 0 1 1 55 46" fill="none" stroke="' + colour + '" stroke-width="6" stroke-linecap="round" ' +
      'stroke-dasharray="' + dash.toFixed(1) + ' ' + circ.toFixed(1) + '"/>' +
  '</svg>';
}

function jzRenderKpis(m, currency){
  const host = document.getElementById('jz-kpis');
  if (!host) return;
  if (!m) { host.innerHTML = ''; return; }
  const s = m.stats;
  const pfDisplay = isFinite(m.pf) ? m.pf.toFixed(2) : '∞';
  const pfCol = (isFinite(m.pf) ? m.pf : 3) >= 1.5 ? '#03c988' : (m.pf >= 1 ? '#f5c542' : '#e5484d');
  const wrCol = s.winRate >= 50 ? '#03c988' : (s.winRate >= 40 ? '#f5c542' : '#e5484d');
  const dwCol = m.dayWinRate >= 50 ? '#03c988' : (m.dayWinRate >= 40 ? '#f5c542' : '#e5484d');
  const wlTotal = (s.avgWin + s.avgLoss) || 1;

  host.innerHTML =
    '<div class="jz-kpi">' +
      jzArc((isFinite(m.pf) ? Math.min(m.pf, 3) : 3) / 3, pfCol) +
      '<div class="jz-kpi-val" style="color:' + pfCol + '">' + pfDisplay + '</div>' +
      '<div class="jz-kpi-label">Profit factor</div>' +
    '</div>' +
    '<div class="jz-kpi">' +
      jzArc(s.winRate / 100, wrCol) +
      '<div class="jz-kpi-val">' + Math.round(s.winRate) + '%</div>' +
      '<div class="jz-kpi-label">Trade win %</div>' +
      '<div class="jz-kpi-sub"><b class="gm-up">' + s.winCount + 'W</b> · <b class="gm-down">' + s.lossCount + 'L</b></div>' +
    '</div>' +
    '<div class="jz-kpi">' +
      jzArc(m.dayWinRate / 100, dwCol) +
      '<div class="jz-kpi-val">' + Math.round(m.dayWinRate) + '%</div>' +
      '<div class="jz-kpi-label">Day win %</div>' +
      '<div class="jz-kpi-sub">' + m.greenDays + ' of ' + m.totalDays + ' green</div>' +
    '</div>' +
    '<div class="jz-kpi">' +
      '<div class="jz-wl-split">' +
        '<i class="is-win" style="width:' + Math.round((s.avgWin / wlTotal) * 100) + '%"></i>' +
        '<i class="is-loss" style="width:' + Math.round((s.avgLoss / wlTotal) * 100) + '%"></i>' +
      '</div>' +
      '<div class="jz-kpi-val">' + (s.avgLoss > 0 ? (s.avgWin / s.avgLoss).toFixed(2) : '—') + '</div>' +
      '<div class="jz-kpi-label">Avg win / loss</div>' +
      '<div class="jz-kpi-sub"><b class="gm-up">' + journalFormatCurrency(s.avgWin, currency) + '</b> · ' +
        '<b class="gm-down">-' + journalFormatCurrency(s.avgLoss, currency).replace('-', '') + '</b></div>' +
    '</div>';
  if (typeof gmAnimate === 'function') gmAnimate(host);
}

// ---- month calendar with weekly totals --------------------------------------
let JZ_CAL_OFFSET = 0;   // months back from the current month

function jzRenderMiniCalendar(trades, currency){
  const host = document.getElementById('jz-cal');
  const label = document.getElementById('jz-cal-label');
  if (!host) return;

  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() - JZ_CAL_OFFSET);
  const year = base.getFullYear(), month = base.getMonth();
  if (label) label.textContent = base.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const byDay = {};
  trades.forEach((t) => {
    if (!t.date || t.pnl === null || t.pnl === undefined) return;
    if (!byDay[t.date]) byDay[t.date] = { pnl: 0, n: 0 };
    byDay[t.date].pnl += t.pnl;
    byDay[t.date].n++;
  });

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let html = '';
  ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((d) => { html += '<div class="jz-cal-h">' + d + '</div>'; });
  html += '<div class="jz-cal-h jz-cal-wk">WEEK</div>';

  let day = 1, monthTotal = 0;
  while (day <= daysInMonth) {
    let weekPnl = 0, weekHas = false;
    for (let dow = 0; dow < 7; dow++) {
      const inMonth = !(day > daysInMonth || (day === 1 && dow < firstDow));
      if (!inMonth) { html += '<div class="jz-cal-c empty"></div>'; continue; }
      const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      const d = byDay[dateStr];
      if (d) { weekPnl += d.pnl; weekHas = true; monthTotal += d.pnl; }
      const cls = d ? (d.pnl > 0 ? ' win' : (d.pnl < 0 ? ' loss' : ' flat')) : '';
      html += '<div class="jz-cal-c' + cls + '" title="' +
        (d ? journalFormatCurrency(d.pnl, currency) + ' · ' + d.n + ' trade' + (d.n === 1 ? '' : 's') : '') + '">' +
        '<span>' + day + '</span>' +
        (d ? '<b>' + jzShortMoney(d.pnl) + '</b>' : '') +
      '</div>';
      day++;
    }
    html += '<div class="jz-cal-c jz-cal-wk' + (weekHas ? (weekPnl >= 0 ? ' win' : ' loss') : ' empty') + '">' +
      (weekHas ? '<b>' + jzShortMoney(weekPnl) + '</b>' : '') + '</div>';
  }
  host.innerHTML = html;

  const total = document.getElementById('jz-cal-total');
  if (total) {
    total.textContent = journalFormatCurrency(monthTotal, currency);
    total.className = 'jz-cal-total ' + (monthTotal > 0 ? 'gm-up' : (monthTotal < 0 ? 'gm-down' : ''));
  }
}

function jzShortMoney(v){
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 10000) return sign + (a / 1000).toFixed(0) + 'k';
  if (a >= 1000) return sign + (a / 1000).toFixed(1) + 'k';
  return sign + Math.round(a);
}

// ---- recent trades strip ----------------------------------------------------
function jzRenderRecent(trades, currency){
  const host = document.getElementById('jz-recent');
  if (!host) return;
  const recent = trades.filter((t) => t.pnl !== null && t.pnl !== undefined).slice(0, 6);
  if (!recent.length) {
    host.innerHTML = '<p class="term-empty">Your latest trades will appear here.</p>';
    return;
  }
  host.innerHTML = recent.map((t) => {
    const win = t.pnl > 0;
    return '<div class="jz-recent-row">' +
      '<span class="jz-pill ' + (win ? 'is-win' : (t.pnl < 0 ? 'is-loss' : 'is-flat')) + '">' +
        (win ? 'WIN' : (t.pnl < 0 ? 'LOSS' : 'BE')) + '</span>' +
      '<b>' + escapeJournalHtml(t.instrument || '—') + '</b>' +
      '<span class="jz-recent-side">' + (t.direction === 'short' ? 'SHORT' : 'LONG') + '</span>' +
      '<span class="jz-recent-date">' + (t.date || '') + '</span>' +
      '<span class="jz-recent-pnl ' + (win ? 'gm-up' : (t.pnl < 0 ? 'gm-down' : '')) + '">' +
        journalFormatCurrency(t.pnl, currency) + '</span>' +
    '</div>';
  }).join('');
  if (typeof gmAnimate === 'function') gmAnimate(host);
}

// ---- calendar month switcher -----------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const prev = document.getElementById('jz-cal-prev');
  const next = document.getElementById('jz-cal-next');
  if (prev) prev.addEventListener('click', () => {
    JZ_CAL_OFFSET++;
    jzRenderMiniCalendar(JOURNAL_TRADES || [], (JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD');
  });
  if (next) next.addEventListener('click', () => {
    if (JZ_CAL_OFFSET > 0) JZ_CAL_OFFSET--;
    jzRenderMiniCalendar(JOURNAL_TRADES || [], (JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD');
  });
});
