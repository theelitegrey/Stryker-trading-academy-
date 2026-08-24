// Stryker Trading Academy — trading indicators listing (indicators.html)
// Mirrors assets/models-list.js, with a proper "Coming soon" empty state
// instead of a plain one-line message, since this module is intentionally
// launching with no content yet.

function renderIndicators(){
  const container = document.getElementById('indicators-render-target');
  if (!container || typeof INDICATORS === 'undefined') return;
  container.innerHTML = '';

  if (!INDICATORS.length) {
    container.innerHTML =
      '<div class="panel" style="text-align:center; padding:56px 32px;">' +
        '<div style="width:52px; height:52px; border-radius:50%; background:rgba(3,201,136,0.1); border:1px solid rgba(3,201,136,0.3); display:flex; align-items:center; justify-content:center; margin:0 auto 20px;">' +
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>' +
        '</div>' +
        '<h2 style="font-size:19px; margin-bottom:8px;">Coming soon</h2>' +
        '<p style="color:var(--ink-3); font-size:14px; max-width:380px; margin:0 auto;">We\'re building out a library of the indicators used across the curriculum, with setup and usage notes for each. Check back soon.</p>' +
      '</div>';
    return;
  }

  const list = document.createElement('div');
  list.className = 'chapter-list';

  INDICATORS.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach((ind) => {
    const el = document.createElement('a');
    el.href = 'indicator.html?id=' + encodeURIComponent(ind.id);
    el.className = 'chapter';
    el.style.textDecoration = 'none';
    el.style.color = 'inherit';

    el.innerHTML =
      '<div class="chapter-num"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div>' +
      '<div class="chapter-body">' +
        '<h3>' + (ind.name || 'Untitled indicator') + '</h3>' +
        '<p>' + (ind.summary || '') + '</p>' +
      '</div>' +
      '<div class="chapter-status"><svg class="chapter-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></div>';

    list.appendChild(el);
  });

  container.appendChild(list);
}

function showGuestPaywall(show){
  const overlay = document.getElementById('guest-paywall-overlay');
  const content = document.getElementById('indicators-content-wrap');
  if (overlay) overlay.style.display = show ? 'flex' : 'none';
  if (content) content.classList.toggle('paywall-dimmed', show);
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('indicators-render-target');
  if (container) container.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">Loading trading indicators…</p>';

  loadIndicators().then(() => renderIndicators());

  if (!auth) {
    showGuestPaywall(true);
    return;
  }

  auth.onAuthStateChanged((user) => {
    showGuestPaywall(!user);
  });
});
