// Stryker Trading Academy — page access guard, role-rank aware.
// Admins are always exempt. Only loaded on pages that should be gated —
// never on checkout.html, index.html, or any admin page.
//
// Behavior:
// - If the current page's <body> has a data-page-access="<key>" attribute,
//   look up that key in settings/pageAccess (a plan id, or unset/null for
//   "any signed-in student"). Compare the student's plan rank against the
//   required plan's rank, using assets/roles.js.
// - If there's no data-page-access attribute at all (older pages that
//   haven't been tagged), fall back to the original behavior: any plan at
//   all is enough, matching pre-existing behavior so nothing regresses.
// - On failure, show an in-page "upgrade to unlock" overlay — the same
//   paywall-overlay/paywall-card pattern already used on chapter/model/
//   indicator pages — rather than redirecting away.
//
// The .dash-shell on every gated page starts hidden (.gate-pending, set in
// the page's own HTML) behind a full-screen loading overlay, so a student
// without access never gets even a brief flash of the real page before the
// paywall applies. Every code path below — allowed, denied, admin-exempt,
// or an error — must end by calling revealPageContent(), or the page would
// stay stuck hidden forever. The one deliberate exception is "not signed
// in": that's left showing the loading state, since the page's own auth
// check redirects to login shortly after anyway, and that's a better look
// than briefly flashing dashboard content right before the redirect fires.
//
// Depends on: assets/auth.js (`auth`), assets/progress.js (`db`),
// assets/roles.js (hasRoleAccess, loadPlansForRoles, loadPageAccess, labelOf).

(function(){
  function revealPageContent(){
    const gateOverlay = document.getElementById('access-gate-overlay');
    const shell = document.querySelector('.dash-shell');
    if (gateOverlay) gateOverlay.style.display = 'none';
    if (shell) shell.classList.remove('gate-pending');
  }

  // If Firebase itself failed to load, there's no way to check access at
  // all — fail open rather than leave the page stuck hidden forever.
  if (typeof db === 'undefined' || !db) { revealPageContent(); return; }
  if (typeof auth === 'undefined' || !auth) { revealPageContent(); return; }

  function showPlanPaywall(requiredRoleName){
    const shell = document.querySelector('.dash-shell');
    if (shell) shell.classList.add('paywall-dimmed');

    const overlay = document.getElementById('guest-paywall-overlay');
    if (overlay) {
      const heading = document.getElementById('paywall-heading');
      const body = document.getElementById('paywall-body');
      const actions = document.getElementById('paywall-actions');
      if (heading) heading.textContent = 'Upgrade to unlock this page';
      if (body) {
        body.textContent = requiredRoleName
          ? ('This page requires the ' + requiredRoleName + ' plan. Upgrade to keep going.')
          : 'This page requires an active plan. Upgrade to keep going.';
      }
      if (actions) actions.innerHTML = '<a href="index.html#pricing" class="btn btn-primary">See plans</a><a href="dashboard-user.html" class="btn btn-ghost">Back to dashboard</a>';
      overlay.style.display = 'flex';
    }
    revealPageContent(); // reveal already-dimmed, with the card on top — never a sharp frame first
  }

  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled || !user) return; // the page's own guard handles "not signed in"
    handled = true;

    db.collection('admins').doc(user.uid).get().then((adminDoc) => {
      if (adminDoc.exists) { revealPageContent(); return; } // admins never need a plan

      const pageKey = document.body.getAttribute('data-page-access');

      db.collection('students').doc(user.uid).get().then((studentDoc) => {
        const plan = studentDoc.exists ? studentDoc.data().plan : null;

        if (!pageKey) {
          // Legacy behavior: any plan at all unlocks the page.
          if (!plan) showPlanPaywall(null);
          else revealPageContent();
          return;
        }

        // Rank-aware check.
        const rolesReady = (typeof loadPlansForRoles === 'function' && typeof loadPageAccess === 'function')
          ? Promise.all([loadPlansForRoles(), loadPageAccess()])
          : Promise.resolve([[], {}]);

        rolesReady.then(([, pageAccess]) => {
          const required = pageAccess ? pageAccess[pageKey] : null;
          if (!hasRoleAccess(plan, required)) {
            const requiredName = (required && typeof labelOf === 'function') ? labelOf(required) : null;
            showPlanPaywall(requiredName);
          } else {
            revealPageContent();
          }
        });
      }).catch((err) => { console.error('Stryker: plan check failed', err); revealPageContent(); });
    }).catch((err) => { console.error('Stryker: admin check failed during plan guard', err); revealPageContent(); });
  });
})();
