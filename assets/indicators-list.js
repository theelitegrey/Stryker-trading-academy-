// Stryker Trading Academy — trading indicators listing (indicators.html)
// Mirrors assets/models-list.js, with a proper "Coming soon" empty state
// instead of a plain one-line message, since this module is intentionally
// launching with no content yet.

// "More on the way" — replaces the old static Coming-soon card. An animated
// pulse line and a trio of shimmering ghost slots; always rendered after the
// live list (or alone while the list is empty).
function onTheWayBox(){
  return '<div class="panel ind-otw">' +
    '<svg class="ind-otw-wave" viewBox="0 0 600 40" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="M0 20 L120 20 L140 6 L160 34 L180 20 L300 20 L320 10 L340 30 L360 20 L600 20" ' +
        'fill="none" stroke="rgba(3,201,136,0.55)" stroke-width="2" pathLength="1"/>' +
    '</svg>' +
    '<div class="ind-otw-body">' +
      '<h2>More indicators on the way</h2>' +
      '<p>The lab is busy — session tools, liquidity maps and model-specific overlays are in the build queue. Each one lands here first, with setup and usage notes.</p>' +
      '<div class="ind-otw-ghosts"><i></i><i></i><i></i></div>' +
    '</div>' +
  '</div>';
}

function renderIndicators(){
  const container = document.getElementById('indicators-render-target');
  if (!container || typeof INDICATORS === 'undefined') return;
  container.innerHTML = '';

  if (!INDICATORS.length) {
    container.innerHTML = onTheWayBox();
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
  container.insertAdjacentHTML('beforeend', onTheWayBox());
}

function showGuestPaywall(show){
  const overlay = document.getElementById('guest-paywall-overlay');
  const content = document.getElementById('indicators-content-wrap');
  if (overlay) overlay.style.display = show ? 'flex' : 'none';
  if (content) content.classList.toggle('paywall-dimmed', show);
}

function initTvAccessPanel(uid){
  const statusEl = document.getElementById('tv-access-status');
  const requestSection = document.getElementById('tv-access-request-section');
  const grantedSection = document.getElementById('tv-access-granted-section');
  const usernameInput = document.getElementById('tv-access-username');
  const approvedInput = document.getElementById('tv-access-approved-username');
  const updateInput = document.getElementById('tv-access-update-username');
  const errEl = document.getElementById('tv-access-error');
  const okEl = document.getElementById('tv-access-success');

  // Renders the panel from whatever's actually stored, rather than trying
  // to hand-patch the DOM after a save — one source of truth, called both
  // on load and right after either save button succeeds.
  function renderFromData(data){
    const granted = !!data.tradingViewAccessGranted;
    const hasUsername = !!data.tradingViewUsername;

    if (!hasUsername) {
      statusEl.style.display = 'none';
    } else if (granted) {
      statusEl.style.display = 'inline-block';
      statusEl.textContent = 'Access granted';
      statusEl.className = 'status-tag active';
    } else {
      statusEl.style.display = 'inline-block';
      statusEl.textContent = 'Pending review';
      statusEl.className = 'status-tag trial';
    }

    if (granted) {
      approvedInput.value = data.tradingViewUsername;
      updateInput.value = '';
      grantedSection.style.display = 'block';
      requestSection.style.display = 'none';
    } else {
      usernameInput.value = data.tradingViewUsername || '';
      grantedSection.style.display = 'none';
      requestSection.style.display = 'block';
    }
  }

  function saveUsername(newUsername){
    errEl.style.display = 'none';
    okEl.style.display = 'none';
    // Changing the username re-opens the request — an admin still needs to
    // grant the new one, so this always clears any prior "granted" flag
    // rather than only doing so conditionally, to avoid an admin missing a
    // genuine username change.
    return db.collection('students').doc(uid).set({
      tradingViewUsername: newUsername || null,
      tradingViewAccessGranted: false,
      tradingViewRequestedAt: newUsername ? firebase.firestore.FieldValue.serverTimestamp() : null
    }, { merge: true }).then(() => {
      renderFromData({ tradingViewUsername: newUsername || null, tradingViewAccessGranted: false });
      okEl.textContent = newUsername ? "Saved — we'll review it soon." : 'Cleared.';
      okEl.style.display = 'block';
      if (typeof showToast === 'function') showToast('success', newUsername ? "Saved — we'll review it soon." : 'Cleared.');

      // Tell the admins. This request previously arrived silently: nothing was
      // written anywhere an admin would see, so a student sat on "Pending
      // review" until someone happened to open the indicators page. Only fires
      // on a new submission, not on clearing the field.
      if (newUsername && typeof createNotification === 'function') {
        const who = (auth.currentUser && (auth.currentUser.displayName || auth.currentUser.email)) || 'A student';
        db.collection('admins').get().then((snap) => {
          snap.forEach((doc) => {
            createNotification(doc.id, 'tv_access_granted',
              who + ' submitted a TradingView username for approval.', 'indicators-admin.html');
          });
        }).catch((err) => console.error('Stryker: could not notify admins of TradingView request', err));
      }
    }).catch((err) => {
      errEl.textContent = err.message || 'Could not save.';
      errEl.style.display = 'block';
    });
  }

  db.collection('students').doc(uid).get().then((doc) => {
    renderFromData(doc.exists ? doc.data() : {});
  }).catch((err) => console.error('Stryker: failed to load TradingView access status', err));

  document.getElementById('tv-access-save').addEventListener('click', () => {
    saveUsername(usernameInput.value.trim());
  });

  document.getElementById('tv-access-update-save').addEventListener('click', () => {
    const newUsername = updateInput.value.trim();
    if (!newUsername) { errEl.textContent = 'Enter the new username first.'; errEl.style.display = 'block'; return; }
    saveUsername(newUsername);
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
