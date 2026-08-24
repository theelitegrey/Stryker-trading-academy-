// Stryker Trading Academy — Trade Journal: History + Calendar tabs
// Depends on: assets/journal-calc.js, and the global JOURNAL_TRADES /
// JOURNAL_SETTINGS / JOURNAL_UID state set up by assets/journal-main.js

// ---- Trade History ----
function populateHistoryFilterOptions(){
  const instruments = (JOURNAL_SETTINGS && JOURNAL_SETTINGS.instruments) || [];
  const setups = (JOURNAL_SETTINGS && JOURNAL_SETTINGS.setups) || [];

  const instSel = document.getElementById('jh-instrument');
  const setupSel = document.getElementById('jh-setup');
  const currentInst = instSel.value;
  const currentSetup = setupSel.value;

  instSel.innerHTML = '<option value="">All</option>' + instruments.map((i) => '<option value="' + escapeJournalHtml(i) + '">' + escapeJournalHtml(i) + '</option>').join('');
  setupSel.innerHTML = '<option value="">All</option>' + setups.map((s) => '<option value="' + escapeJournalHtml(s) + '">' + escapeJournalHtml(s) + '</option>').join('');
  instSel.value = currentInst;
  setupSel.value = currentSetup;
}

function filteredHistoryTrades(){
  const search = document.getElementById('jh-search').value.trim().toLowerCase();
  const instrument = document.getElementById('jh-instrument').value;
  const setup = document.getElementById('jh-setup').value;
  const direction = document.getElementById('jh-direction').value;

  return (JOURNAL_TRADES || []).filter((t) => {
    if (instrument && t.instrument !== instrument) return false;
    if (setup && t.setup !== setup) return false;
    if (direction && t.direction !== direction) return false;
    if (search) {
      const haystack = [(t.instrument || ''), (t.setup || ''), (t.notes || '')].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function renderHistoryTab(){
  populateHistoryFilterOptions();
  renderHistoryList();
}

function renderHistoryList(){
  const trades = filteredHistoryTrades();
  const wrap = document.getElementById('jh-list');
  const countEl = document.getElementById('jh-count');
  const currency = (JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD';
  if (countEl) countEl.textContent = trades.length + ' trade' + (trades.length === 1 ? '' : 's');

  if (!trades.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No trades match these filters.</p>';
    return;
  }

  wrap.innerHTML = '';
  trades.forEach((t) => wrap.appendChild(renderHistoryRow(t, currency)));
}

function pnlClass(pnl){
  if (pnl === null || pnl === undefined) return 'journal-pnl-flat';
  return pnl > 0 ? 'journal-pnl-pos' : (pnl < 0 ? 'journal-pnl-neg' : 'journal-pnl-flat');
}

function renderHistoryRow(t, currency){
  const row = document.createElement('div');
  row.className = 'journal-trade-row';

  const detailId = 'jh-detail-' + t.id;
  row.innerHTML =
    '<div class="journal-trade-row-top">' +
      '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">' +
        '<span style="font-family:var(--font-mono); font-size:12px; color:var(--ink-3);">' + (t.date || '—') + '</span>' +
        '<b style="font-size:14px; color:var(--ink-0);">' + escapeJournalHtml(t.instrument || '—') + '</b>' +
        '<span class="status-pill ' + (t.direction === 'short' ? 'locked' : 'unlocked') + '">' + (t.direction === 'short' ? 'Short' : 'Long') + '</span>' +
        (t.setup ? '<span style="font-size:12px; color:var(--ink-2);">' + escapeJournalHtml(t.setup) + '</span>' : '') +
      '</div>' +
      '<div style="display:flex; align-items:center; gap:14px;">' +
        '<span class="' + pnlClass(t.pnl) + '" style="font-size:14px;">' + journalFormatCurrency(t.pnl, currency) + '</span>' +
        '<span style="font-family:var(--font-mono); font-size:12px; color:var(--ink-3);">' + (t.rMultiple !== null && t.rMultiple !== undefined ? t.rMultiple.toFixed(2) + 'R' : '—') + '</span>' +
      '</div>' +
    '</div>' +
    '<div id="' + detailId + '" style="display:none; margin-top:14px; padding-top:14px; border-top:1px solid var(--line-soft);"></div>';

  row.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    const detail = row.querySelector('#' + detailId);
    const willOpen = detail.style.display === 'none';
    detail.style.display = willOpen ? 'block' : 'none';
    if (willOpen && !detail.dataset.built) {
      detail.dataset.built = '1';
      detail.appendChild(renderTradeDetail(t, currency));
    }
  });

  return row;
}

function renderTradeDetail(t, currency){
  const wrap = document.createElement('div');
  const rows = [
    ['Entry', t.entryPrice], ['Exit', t.exitPrice], ['Size', t.positionSize],
    ['Stop loss', t.stopLoss], ['Take profit', t.takeProfit], ['Fees', t.fees],
    ['Session', t.session], ['Risk amount', t.riskAmount !== null && t.riskAmount !== undefined ? journalFormatCurrency(t.riskAmount, currency) : null],
    ['Risk %', t.riskPercent !== null && t.riskPercent !== undefined ? t.riskPercent.toFixed(2) + '%' : null],
    ['Planned R:R', t.plannedRR !== null && t.plannedRR !== undefined ? t.plannedRR.toFixed(2) : null],
    ['Result', t.result]
  ];
  let html = '<div class="stat-grid-3" style="margin-bottom:16px;">' +
    rows.filter((r) => r[1] !== null && r[1] !== undefined && r[1] !== '').map((r) =>
      '<div class="stat-card" style="padding:12px;"><div class="stat-val" style="font-size:15px;">' + escapeJournalHtml(String(r[1])) + '</div><div class="stat-label">' + r[0] + '</div></div>'
    ).join('') + '</div>';

  if (t.tags && t.tags.length) {
    html += '<div style="margin-bottom:12px;">' + t.tags.map((tag) => '<span class="journal-tag-chip active" style="margin-right:6px; cursor:default;">' + escapeJournalHtml(tag) + '</span>').join('') + '</div>';
  }
  if (t.notes) html += '<p style="font-size:13.5px; color:var(--ink-2); line-height:1.6; margin-bottom:14px;">' + escapeJournalHtml(t.notes).replace(/\n/g, '<br>') + '</p>';
  if (t.screenshotDataUrl) html += '<img src="' + t.screenshotDataUrl + '" style="max-width:100%; border-radius:8px; border:1px solid var(--line); margin-bottom:14px; display:block;">';

  html += '<div style="display:flex; gap:10px;">' +
    '<button type="button" class="btn btn-ghost btn-sm" data-edit-trade="' + t.id + '">Edit</button>' +
    '<button type="button" class="btn btn-ghost btn-sm" data-delete-trade="' + t.id + '" style="color:var(--bear);">Delete</button>' +
    '</div>';

  wrap.innerHTML = html;
  wrap.querySelector('[data-edit-trade]').addEventListener('click', () => startEditTrade(t.id));
  wrap.querySelector('[data-delete-trade]').addEventListener('click', () => confirmDeleteTrade(t.id));
  return wrap;
}

function confirmDeleteTrade(tradeId){
  if (!confirm('Delete this trade? This cannot be undone.')) return;
  deleteTrade(JOURNAL_UID, tradeId)
    .then(() => reloadJournalData())
    .catch((err) => alert('Could not delete trade: ' + (err.message || err)));
}

// ---- Calendar ----
let JOURNAL_CAL_DATE = new Date();
JOURNAL_CAL_DATE.setDate(1);

function renderCalendarTab(){
  const trades = (JOURNAL_TRADES || []).filter((t) => t.date && t.pnl !== null && t.pnl !== undefined);
  const currency = (JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD';
  const byDay = {};
  trades.forEach((t) => {
    if (!byDay[t.date]) byDay[t.date] = { pnl: 0, count: 0, trades: [] };
    byDay[t.date].pnl += t.pnl;
    byDay[t.date].count += 1;
    byDay[t.date].trades.push(t);
  });

  const year = JOURNAL_CAL_DATE.getFullYear();
  const month = JOURNAL_CAL_DATE.getMonth();
  document.getElementById('jc-month-label').textContent = JOURNAL_CAL_DATE.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const grid = document.getElementById('jc-grid');
  grid.innerHTML = '';
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d) => {
    const label = document.createElement('div');
    label.className = 'journal-cal-daylabel';
    label.textContent = d;
    grid.appendChild(label);
  });
  for (let i = 0; i < firstDayOfWeek; i++) {
    const empty = document.createElement('div');
    empty.className = 'journal-cal-cell empty';
    grid.appendChild(empty);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const dayData = byDay[dateStr];
    const cell = document.createElement('div');
    cell.className = 'journal-cal-cell' + (dayData ? (dayData.pnl >= 0 ? ' win' : ' loss') : '');
    cell.innerHTML =
      '<span class="journal-cal-daynum">' + day + '</span>' +
      (dayData ? '<div><div class="journal-cal-pnl" style="color:' + (dayData.pnl >= 0 ? '#03c988' : '#e5484d') + ';">' + journalFormatCurrency(dayData.pnl, currency) + '</div><div class="journal-cal-count">' + dayData.count + ' trade' + (dayData.count === 1 ? '' : 's') + '</div></div>' : '');
    if (dayData) cell.addEventListener('click', () => showCalendarDayDetail(dateStr, dayData, currency));
    grid.appendChild(cell);
  }
}

function showCalendarDayDetail(dateStr, dayData, currency){
  const panel = document.getElementById('jc-day-detail-panel');
  panel.style.display = 'block';
  document.getElementById('jc-day-detail-heading').textContent =
    new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + ' — ' + journalFormatCurrency(dayData.pnl, currency);

  const listEl = document.getElementById('jc-day-detail-list');
  listEl.innerHTML = '';
  dayData.trades.forEach((t) => listEl.appendChild(renderHistoryRow(t, currency)));
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.addEventListener('DOMContentLoaded', () => {
  const prevBtn = document.getElementById('jc-prev-btn');
  const nextBtn = document.getElementById('jc-next-btn');
  if (prevBtn) prevBtn.addEventListener('click', () => {
    JOURNAL_CAL_DATE.setMonth(JOURNAL_CAL_DATE.getMonth() - 1);
    document.getElementById('jc-day-detail-panel').style.display = 'none';
    renderCalendarTab();
  });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    JOURNAL_CAL_DATE.setMonth(JOURNAL_CAL_DATE.getMonth() + 1);
    document.getElementById('jc-day-detail-panel').style.display = 'none';
    renderCalendarTab();
  });
  ['jh-search', 'jh-instrument', 'jh-setup', 'jh-direction'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', renderHistoryList);
  });
});
