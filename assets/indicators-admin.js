// Stryker Trading Academy — Admin: Trading Indicators list (indicators-admin.html)
// Mirrors assets/models-admin.js, without the bulk "Update all" import since
// there's no seed array for indicators.

function escapeIndicatorsAdminText(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderTvRequestsPanel(students){
  const panel = document.getElementById('tv-requests-panel');
  const list = document.getElementById('tv-requests-list');
  const countEl = document.getElementById('tv-requests-count');
  if (!panel || !list) return;

  const pending = students
    .filter((s) => s.tradingViewUsername && !s.tradingViewAccessGranted)
    .sort((a, b) => {
      const aTime = (a.tradingViewRequestedAt && a.tradingViewRequestedAt.toMillis) ? a.tradingViewRequestedAt.toMillis() : 0;
      const bTime = (b.tradingViewRequestedAt && b.tradingViewRequestedAt.toMillis) ? b.tradingViewRequestedAt.toMillis() : 0;
      return aTime - bTime; // oldest first
    });

  if (!pending.length) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  countEl.textContent = pending.length + ' pending';

  list.innerHTML = '';
  pending.forEach((s) => {
    const requestedLabel = (s.tradingViewRequestedAt && s.tradingViewRequestedAt.toDate)
      ? s.tradingViewRequestedAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '';
    const row = document.createElement('div');
    row.className = 'record-card';
    row.innerHTML =
      '<div>' +
        '<span class="cell-name">' + escapeIndicatorsAdminText(s.tradingViewUsername) + '</span>' +
        '<span class="cell-sub">' + escapeIndicatorsAdminText(s.displayName || s.email || s.uid) + (requestedLabel ? ' · requested ' + requestedLabel : '') + '</span>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm" data-grant-tv="' + s.uid + '">Mark as granted</button>';
    list.appendChild(row);
  });

  list.querySelectorAll('[data-grant-tv]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.grantTv;
      btn.disabled = true;
      if (typeof logActivity === 'function') logActivity('content.indicator_saved', 'Granted TradingView indicator access', { targetUid: uid });
      db.collection('students').doc(uid).set({ tradingViewAccessGranted: true }, { merge: true })
        .then(() => {
          if (typeof createNotification === 'function') {
            createNotification(uid, 'tv_access_granted', 'Your TradingView indicator access has been granted.', 'indicators.html');
          }
          if (typeof checkAndNotifyNewAchievementsFor === 'function') checkAndNotifyNewAchievementsFor(uid, true);
        })
        .then(loadTvRequests)
        .catch((err) => {
          showToast('error', 'Could not update: ' + (err.message || err));
          btn.disabled = false;
        });
    });
  });
}

function loadTvRequests(){
  return db.collection('students').get().then((snap) => {
    const students = [];
    snap.forEach((doc) => students.push(Object.assign({ uid: doc.id }, doc.data())));
    renderTvRequestsPanel(students);
  }).catch((err) => console.error('Stryker: failed to load TradingView requests', err));
}

function renderIndicatorList(){
  const container = document.getElementById('indicator-list');
  const countEl = document.getElementById('indicator-count');
  if (!container) return;

  if (countEl) countEl.textContent = INDICATORS.length + ' indicator' + (INDICATORS.length === 1 ? '' : 's');

  if (!INDICATORS.length) {
    container.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No trading indicators yet — the public page shows "Coming soon" until you add the first one. Click "+ Add new indicator" to get started.</p>';
    return;
  }

  container.innerHTML = '';
  const sorted = INDICATORS.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  sorted.forEach((ind) => {
    const card = document.createElement('div');
    card.className = 'record-card';
    card.innerHTML =
      '<div style="flex:1 1 260px;">' +
        '<span class="cell-name">' + (ind.name || 'Untitled indicator') + '</span>' +
        (ind.summary ? '<p style="font-size:12.5px; color:var(--ink-3); margin-top:6px; max-width:520px;">' + ind.summary + '</p>' : '') +
      '</div>' +
      '<div style="display:flex; gap:8px;">' +
        '<a href="indicator.html?id=' + encodeURIComponent(ind.id) + '" class="btn btn-ghost btn-sm" target="_blank">View</a>' +
        '<a href="indicator-editor.html?id=' + encodeURIComponent(ind.id) + '" class="btn btn-primary btn-sm">Edit</a>' +
      '</div>';
    container.appendChild(card);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    loadIndicators()
      .then(() => renderIndicatorList())
      .catch((err) => {
        console.error('Stryker: failed to load trading indicators admin page', err);
        document.getElementById('indicator-list').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load: ' + (err.message || err) + '</p>';
      });
    loadTvRequests();
  });
});
