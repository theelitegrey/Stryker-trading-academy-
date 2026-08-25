// Stryker Trading Academy — single Trading Indicator reader (indicator.html)
// Mirrors assets/model-reader.js, simplified: indicators are title +
// summary + rich body only, no video/steps structure.

function getIndicatorIdFromQuery(){
  return new URLSearchParams(window.location.search).get('id');
}

function showIndicatorGuestBanner(show){
  const overlay = document.getElementById('guest-paywall-overlay');
  const content = document.getElementById('reader-content-wrap');
  if (overlay) overlay.style.display = show ? 'flex' : 'none';
  if (content) content.classList.toggle('paywall-dimmed', show);
}

function setIndicatorPaywallMessage(reason, requiredRoleName){
  const heading = document.getElementById('paywall-heading');
  const body = document.getElementById('paywall-body');
  const actions = document.getElementById('paywall-actions');
  if (!heading || !body || !actions) return;
  if (reason === 'role') {
    heading.textContent = 'Upgrade to unlock this indicator';
    body.textContent = 'This indicator requires the ' + (requiredRoleName || 'a higher') + ' plan. Upgrade to keep reading.';
    actions.innerHTML = '<a href="index.html#pricing" class="btn btn-primary">See plans</a><a href="dashboard-user.html" class="btn btn-ghost">Back to dashboard</a>';
  } else {
    heading.textContent = 'Sign in to keep reading';
    body.textContent = "Create a free account or log in to read this indicator's full write-up.";
    actions.innerHTML = '<a href="login.html" class="btn btn-primary">Log in</a><a href="signup.html" class="btn btn-ghost">Create free account</a>';
  }
}

function checkIndicatorRoleAccess(ind, uid){
  if (!ind.minRole) return Promise.resolve(true);
  if (!uid || typeof db === 'undefined' || !db) return Promise.resolve(true);

  return db.collection('admins').doc(uid).get().then((adminDoc) => {
    if (adminDoc.exists) return true;
    return db.collection('students').doc(uid).get().then((studentDoc) => {
      const plan = studentDoc.exists ? studentDoc.data().plan : null;
      if (typeof loadPlansForRoles !== 'function') return true;
      return loadPlansForRoles().then(() => hasRoleAccess(plan, ind.minRole));
    });
  }).catch((err) => {
    console.error('Stryker: indicator role check failed', err);
    return true;
  });
}

function buildIndicatorTOC(activeId){
  const toc = document.getElementById('indicator-toc-list');
  if (!toc) return;
  toc.innerHTML = '';
  INDICATORS.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach((ind) => {
    const item = document.createElement('a');
    item.href = 'indicator.html?id=' + encodeURIComponent(ind.id);
    item.className = 'toc-item' + (ind.id === activeId ? ' current' : '');
    item.innerHTML = '<span>' + (ind.name || 'Untitled') + '</span>';
    toc.appendChild(item);
  });
}

function renderIndicator(ind){
  document.getElementById('indicator-crumb-title').textContent = ind.name || 'Indicator';
  document.getElementById('indicator-title').textContent = ind.name || 'Untitled indicator';
  document.getElementById('indicator-meta').innerHTML =
    (ind.summary ? '<span style="font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3);">' + ind.summary + '</span>' : '');

  const body = document.getElementById('indicator-body');
  body.innerHTML = ind.bodyHtml || '<p style="color:var(--ink-3);">No write-up yet.</p>';

  buildIndicatorTOC(ind.id);
  window.scrollTo({ top: 0 });
}

document.addEventListener('DOMContentLoaded', () => {
  const body = document.getElementById('indicator-body');
  if (body) showLoadingAnimation(body, 'Loading indicator…');

  loadIndicators().then(() => {
    const id = getIndicatorIdFromQuery();
    const ind = INDICATORS.find((x) => x.id === id) || INDICATORS[0];
    if (!ind) {
      if (body) body.innerHTML = '<p style="color:var(--ink-3);">No trading indicators found yet.</p>';
      return;
    }
    renderIndicator(ind);

    if (!auth) { setIndicatorPaywallMessage('signin'); showIndicatorGuestBanner(true); return; }
    auth.onAuthStateChanged((user) => {
      if (!user) {
        setIndicatorPaywallMessage('signin');
        showIndicatorGuestBanner(true);
        return;
      }
      showIndicatorGuestBanner(false);
      checkIndicatorRoleAccess(ind, user.uid).then((allowed) => {
        if (!allowed) {
          const requiredName = (typeof labelOf === 'function') ? labelOf(ind.minRole) : null;
          setIndicatorPaywallMessage('role', requiredName);
          showIndicatorGuestBanner(true);
        }
      });
    });
  });
});
