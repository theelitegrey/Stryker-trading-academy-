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

function initTvAccessPanel(uid){
  const statusEl = document.getElementById('tv-access-status');
  const usernameInput = document.getElementById('tv-access-username');
  const errEl = document.getElementById('tv-access-error');
  const okEl = document.getElementById('tv-access-success');

  function renderStatus(granted, hasUsername){
    if (!hasUsername) { statusEl.style.display = 'none'; return; }
    statusEl.style.display = 'inline-block';
    if (granted) {
      statusEl.textContent = 'Access granted';
      statusEl.className = 'status-tag active';
    } else {
      statusEl.textContent = 'Pending review';
      statusEl.className = 'status-tag trial';
    }
  }

  db.collection('students').doc(uid).get().then((doc) => {
    const data = doc.exists ? doc.data() : {};
    usernameInput.value = data.tradingViewUsername || '';
    renderStatus(!!data.tradingViewAccessGranted, !!data.tradingViewUsername);
  }).catch((err) => console.error('Stryker: failed to load TradingView access status', err));

  document.getElementById('tv-access-save').addEventListener('click', () => {
    errEl.style.display = 'none';
    okEl.style.display = 'none';
    const newUsername = usernameInput.value.trim();
    // Changing the username re-opens the request — an admin still needs to
    // grant the new one, so this always clears any prior "granted" flag
    // rather than only doing so conditionally, to avoid an admin missing a
    // genuine username change.
    db.collection('students').doc(uid).set({
      tradingViewUsername: newUsername || null,
      tradingViewAccessGranted: false,
      tradingViewRequestedAt: newUsername ? firebase.firestore.FieldValue.serverTimestamp() : null
    }, { merge: true }).then(() => {
      renderStatus(false, !!newUsername);
      okEl.textContent = newUsername ? "Saved — we'll grant access soon." : 'Cleared.';
      okEl.style.display = 'block';
    }).catch((err) => {
      errEl.textContent = err.message || 'Could not save.';
      errEl.style.display = 'block';
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('indicators-render-target');
  if (container) showLoadingAnimation(container, 'Loading trading indicators…');

  loadIndicators().then(() => renderIndicators());

  if (!auth) {
    showGuestPaywall(true);
    return;
  }

  auth.onAuthStateChanged((user) => {
    showGuestPaywall(!user);
    if (user) initTvAccessPanel(user.uid);
  });
});
