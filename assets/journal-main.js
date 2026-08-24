// Stryker Trading Academy — Trade Journal: main orchestrator (trade-journal.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/journal-calc.js,
// assets/journal-data.js, and the render functions from journal-charts.js /
// journal-history-calendar.js / journal-form-settings.js
//
// Loads the signed-in student's trades + settings ONCE, keeps them in memory
// (JOURNAL_TRADES / JOURNAL_SETTINGS), and re-renders only the active tab —
// every other tab's file exposes a single renderXTab() function this file calls.

let JOURNAL_UID = null;
let JOURNAL_TRADES = [];
let JOURNAL_SETTINGS = null;
let JOURNAL_ACTIVE_TAB = 'dashboard';

const JOURNAL_TAB_RENDERERS = {
  dashboard: () => renderDashboardTab(),
  add: () => { populateTradeFormDropdowns(); updateLiveCalc(); },
  history: () => renderHistoryTab(),
  calendar: () => renderCalendarTab(),
  analytics: () => renderAnalyticsTab(),
  settings: () => renderSettingsTab()
};

function switchJournalTab(tabName){
  if (!JOURNAL_TAB_RENDERERS[tabName]) return;
  JOURNAL_ACTIVE_TAB = tabName;

  document.querySelectorAll('.journal-tab-panel').forEach((panel) => {
    panel.style.display = panel.id === 'tab-' + tabName ? '' : 'none';
  });
  document.querySelectorAll('#journal-tabs .level-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  JOURNAL_TAB_RENDERERS[tabName]();
}

function reloadJournalData(){
  return loadAllTrades(JOURNAL_UID).then((trades) => {
    JOURNAL_TRADES = trades;
    JOURNAL_TAB_RENDERERS[JOURNAL_ACTIVE_TAB]();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;

  document.querySelectorAll('#journal-tabs .level-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchJournalTab(btn.dataset.tab));
  });

  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      setTimeout(() => { if (!handled) goToLoginPreservingReturn(); }, 1500);
      return;
    }
    handled = true;
    JOURNAL_UID = user.uid;

    Promise.all([loadAllTrades(JOURNAL_UID), loadJournalSettings(JOURNAL_UID)])
      .then(([trades, settings]) => {
        JOURNAL_TRADES = trades;
        JOURNAL_SETTINGS = settings;
        resetTradeForm();
        switchJournalTab('dashboard');
      })
      .catch((err) => {
        console.error('Stryker: failed to load journal data', err);
        document.getElementById('journal-global-error').textContent = 'Could not load your journal: ' + (err.message || err);
        document.getElementById('journal-global-error').style.display = 'block';
      });
  });
});
