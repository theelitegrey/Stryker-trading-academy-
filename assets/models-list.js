// Stryker Trading Academy — trading models listing (models.html)
// Mirrors assets/courses.js.

function renderModels(){
  const container = document.getElementById('models-render-target');
  if (!container || typeof MODELS === 'undefined') return;
  container.innerHTML = '';

  if (!MODELS.length) {
    container.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No trading models have been published yet — check back soon.</p>';
    return;
  }

  const list = document.createElement('div');
  list.className = 'chapter-list';

  MODELS.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach((m) => {
    const el = document.createElement('a');
    el.href = 'model.html?id=' + encodeURIComponent(m.id);
    el.className = 'chapter';
    el.style.textDecoration = 'none';
    el.style.color = 'inherit';

    el.innerHTML =
      '<div class="chapter-num"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.1-3-3L3 17.6"/></svg></div>' +
      '<div class="chapter-body">' +
        '<h3>' + (m.name || 'Untitled model') + '</h3>' +
        '<p>' + (m.summary || '') + '</p>' +
        '<div class="chapter-meta">' +
          (m.category ? '<span class="chapter-tag tag-intermediate">' + m.category + '</span>' : '') +
          '<span>' + (m.steps ? m.steps.length : 0) + ' steps</span>' +
        '</div>' +
      '</div>' +
      '<div class="chapter-status"><svg class="chapter-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></div>';

    list.appendChild(el);
  });

  container.appendChild(list);
}

function showGuestPaywall(show){
  const overlay = document.getElementById('guest-paywall-overlay');
  const content = document.getElementById('models-content-wrap');
  if (overlay) overlay.style.display = show ? 'flex' : 'none';
  if (content) content.classList.toggle('paywall-dimmed', show);
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('models-render-target');
  if (container) showLoadingAnimation(container, 'Loading trading models…');

  loadModels().then(() => renderModels());

  if (!auth) {
    showGuestPaywall(true);
    return;
  }

  auth.onAuthStateChanged((user) => {
    showGuestPaywall(!user);
  });
});
