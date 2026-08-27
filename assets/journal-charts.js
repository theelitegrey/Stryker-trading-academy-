// Stryker Trading Academy — Trade Journal: Dashboard + Analytics tabs
// Depends on: assets/journal-calc.js, Chart.js (CDN), and the global
// JOURNAL_TRADES / JOURNAL_SETTINGS state set up by assets/journal-main.js

const JCOLOR = {
  win: '#03c988', winSoft: 'rgba(3,201,136,0.15)',
  loss: '#e5484d', lossSoft: 'rgba(229,72,77,0.15)',
  ink0: '#eeeeee', ink2: '#8b93a0', ink3: '#5c6472',
  line: 'rgba(62,69,80,0.6)', gold: '#f5c542'
};

let JOURNAL_EQUITY_CHART = null;
let JOURNAL_DAILY_CHART = null;

if (typeof Chart !== 'undefined') {
  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.color = JCOLOR.ink2;
}

// ---- Dashboard (Zella-style layout; widgets live in journal-zella.js) ----
function renderDashboardTab(){
  const allTrades = JOURNAL_TRADES || [];
  // Everything below the hero minis respects the dashboard range filter;
  // the Today/This-week minis stay fixed-period on purpose.
  const trades = (typeof jzRangeTrades === 'function') ? jzRangeTrades(allTrades) : allTrades;
  const currency = (JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD';

  const all = journalAggregateStats(trades);
  const today = journalStatsForPeriod(allTrades, 1);
  const week = journalStatsForPeriod(allTrades, 7);

  setPnlStat('jstat-total-pnl', all.totalPnl, currency);
  setPnlStat('jstat-today-pnl', today.totalPnl, currency);
  setPnlStat('jstat-week-pnl', week.totalPnl, currency);
  const nTrades = document.getElementById('jz-trade-count');
  if (nTrades) {
    const rangeNames = { all: '', today: ' today', week: ' this week', month: ' this month', quarter: ' this quarter', year: ' this year' };
    const suffix = (typeof JZ_RANGE !== 'undefined' && rangeNames[JZ_RANGE]) || '';
    nTrades.textContent = all.closedTrades + ' closed trades' + suffix;
  }

  const m = (typeof jzComputeMetrics === 'function') ? jzComputeMetrics(trades) : null;
  if (typeof jzRenderAiBox === 'function') jzRenderAiBox();
  if (typeof jzRenderRadar === 'function') jzRenderRadar(m);
  if (typeof jzRenderKpis === 'function') jzRenderKpis(m, currency);
  if (typeof jzRenderMiniCalendar === 'function') jzRenderMiniCalendar(trades, currency);
  if (typeof jzRenderRecent === 'function') jzRenderRecent(trades, currency);

  const emptyNote = document.getElementById('jz-empty-note');
  if (emptyNote) emptyNote.style.display = m ? 'none' : '';

  renderEquityCurveChart(trades);
  renderDailyPnlChart(trades);
}

function setPnlStat(elId, value, currency){
  const el = document.getElementById(elId);
  if (!el) return;
  // Count-up animation when the helper (journal-propfirms.js) is loaded;
  // plain text otherwise, so this file stays usable standalone.
  if (typeof jCountUp === 'function' && typeof value === 'number' && isFinite(value)) {
    jCountUp(el, value, (v) => journalFormatCurrency(v, currency));
  } else {
    el.textContent = journalFormatCurrency(value, currency);
  }
  el.style.color = value > 0 ? JCOLOR.win : (value < 0 ? JCOLOR.loss : JCOLOR.ink0);
}

function closedTradesChronological(trades){
  return trades.filter((t) => t.pnl !== null && t.pnl !== undefined && t.date)
    .slice()
    .sort((a, b) => ((a.date || '') + 'T' + (a.time || '00:00')).localeCompare((b.date || '') + 'T' + (b.time || '00:00')));
}

function renderEquityCurveChart(trades){
  const canvas = document.getElementById('journal-equity-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  const closed = closedTradesChronological(trades);

  let running = 0;
  const labels = closed.map((t) => t.date);
  const values = closed.map((t) => { running += t.pnl; return running; });

  if (JOURNAL_EQUITY_CHART) JOURNAL_EQUITY_CHART.destroy();
  if (!closed.length) return;

  JOURNAL_EQUITY_CHART = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        data: values, borderColor: JCOLOR.gold, backgroundColor: 'rgba(245,197,66,0.08)',
        fill: true, tension: 0.15, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: JCOLOR.line }, ticks: { maxTicksLimit: 6, font: { size: 10 } } },
        y: { grid: { color: JCOLOR.line }, ticks: { font: { size: 10 } } }
      }
    }
  });
}

function renderDailyPnlChart(trades){
  const canvas = document.getElementById('journal-daily-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  const closed = closedTradesChronological(trades);

  const byDay = {};
  closed.forEach((t) => { byDay[t.date] = (byDay[t.date] || 0) + t.pnl; });
  const days = Object.keys(byDay).sort();

  if (JOURNAL_DAILY_CHART) JOURNAL_DAILY_CHART.destroy();
  if (!days.length) return;

  JOURNAL_DAILY_CHART = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: days,
      datasets: [{
        data: days.map((d) => byDay[d]),
        backgroundColor: days.map((d) => byDay[d] >= 0 ? JCOLOR.winSoft : JCOLOR.lossSoft),
        borderColor: days.map((d) => byDay[d] >= 0 ? JCOLOR.win : JCOLOR.loss),
        borderWidth: 1.5, borderRadius: 3
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 } } },
        y: { grid: { color: JCOLOR.line }, ticks: { font: { size: 10 } } }
      }
    }
  });
}

// ---- Analytics ----
function renderAnalyticsTab(){
  const trades = (JOURNAL_TRADES || []).filter((t) => t.pnl !== null && t.pnl !== undefined);
  const currency = (JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD';

  renderBreakdown('ja-by-instrument', groupAndAggregate(trades, (t) => t.instrument || 'Unset'), currency);
  renderBreakdown('ja-by-setup', groupAndAggregate(trades, (t) => t.setup || 'Unset'), currency);
  renderBreakdown('ja-by-session', groupAndAggregate(trades, (t) => t.session || 'Unset'), currency);
  renderBreakdown('ja-by-direction', groupAndAggregate(trades, (t) => t.direction === 'short' ? 'Short' : 'Long'), currency);
  renderBreakdown('ja-by-account', groupAndAggregate(trades, (t) => t.account || 'Personal'), currency);
  renderBreakdown('ja-by-dow', groupAndAggregate(trades, (t) => dayOfWeekName(t.date)), currency, DOW_ORDER);
}

const DOW_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayOfWeekName(dateStr){
  if (!dateStr) return 'Unset';
  const d = new Date(dateStr + 'T00:00:00');
  return isNaN(d.getTime()) ? 'Unset' : DOW_ORDER[d.getDay()];
}

function groupAndAggregate(trades, keyFn){
  const groups = {};
  trades.forEach((t) => {
    const key = keyFn(t);
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });
  return Object.keys(groups).map((key) => {
    const stats = journalAggregateStats(groups[key]);
    return { key: key, count: groups[key].length, pnl: stats.totalPnl, winRate: stats.winRate };
  });
}

function renderBreakdown(elId, rows, currency, sortOrder){
  const wrap = document.getElementById(elId);
  if (!wrap) return;
  if (!rows.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No closed trades yet.</p>';
    return;
  }
  rows = sortOrder
    ? rows.slice().sort((a, b) => sortOrder.indexOf(a.key) - sortOrder.indexOf(b.key))
    : rows.slice().sort((a, b) => b.pnl - a.pnl);

  const maxAbsPnl = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1);
  wrap.innerHTML = '';
  rows.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'journal-analytics-row';
    const barPct = Math.min(100, (Math.abs(r.pnl) / maxAbsPnl) * 100);
    const barColor = r.pnl >= 0 ? JCOLOR.win : JCOLOR.loss;
    row.innerHTML =
      '<span style="font-size:13px; color:var(--ink-0); min-width:110px;">' + escapeJournalHtml(r.key) + '</span>' +
      '<div class="journal-analytics-bar-track"><div class="journal-analytics-bar-fill" style="width:' + barPct + '%; background:' + barColor + ';"></div></div>' +
      '<span style="font-family:var(--font-mono); font-size:12.5px; color:' + barColor + '; min-width:80px; text-align:right;">' + journalFormatCurrency(r.pnl, currency) + '</span>' +
      '<span style="font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3); min-width:70px; text-align:right;">' + r.count + ' trade' + (r.count === 1 ? '' : 's') + ' · ' + Math.round(r.winRate) + '%</span>';
    wrap.appendChild(row);
  });
}

function escapeJournalHtml(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
