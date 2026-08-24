// Stryker Trading Academy — Admin: Trading Indicators list (indicators-admin.html)
// Mirrors assets/models-admin.js, without the bulk "Update all" import since
// there's no seed array for indicators.

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
  });
});
