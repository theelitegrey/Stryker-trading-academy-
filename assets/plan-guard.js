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
//   indicator pages — rather than redirecting away. Redirecting to
//   index.html gave no explanation of why the student was bounced, and
//   the destination didn't even reliably show pricing.
//
// Depends on: assets/auth.js (`auth`), assets/progress.js (`db`),
// assets/roles.js (hasRoleAccess, loadPlansForRoles, loadPageAccess, labelOf).
// The host page must include the standard paywall-overlay markup (see
// courses.html for the reference structure) for the overlay to be visible;
// if that markup isn't present, this still dims the page via .paywall-dimmed
// as a fallback so access isn't silently granted.

(function(){
  if (typeof db === 'undefined' || !db) return;
  if (typeof auth === 'undefined' || !auth) return;

  function showPlanPaywall(requiredRoleName){
    const shell = document.querySelector('.dash-shell');
    if (shell) shell.classList.add('paywall-dimmed');

    const overlay = document.getElementById('guest-paywall-overlay');
    if (!overlay) return; // dimming above still blocks interaction even without the card
    const heading = document.getElementById('paywall-heading');
    const body = document.getElementById('paywall-body');
    const actions = document.getElementById('paywall-actions');
    if (heading) heading.textContent = 'Upgrade to unlock this page';
    if (body) {
      body.textContent = requiredRoleName
        ? ('This page requires the ' + requiredRoleName + ' plan. Upgrade to keep going.')
        : 'This page requires an active plan. Upgrade to keep going.';
    }
    if (actions) actions.innerHTML = '<a href="index.html#pricing" class="btn btn-primary">See plans</a>';
    overlay.style.display = 'flex';
  }

  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled || !user) return; // the page's own guard handles "not signed in"
    handled = true;

    db.collection('admins').doc(user.uid).get().then((adminDoc) => {
      if (adminDoc.exists) return; // admins never need a plan

      const pageKey = document.body.getAttribute('data-page-access');

      db.collection('students').doc(user.uid).get().then((studentDoc) => {
        const plan = studentDoc.exists ? studentDoc.data().plan : null;

        if (!pageKey) {
          // Legacy behavior: any plan at all unlocks the page.
          if (!plan) showPlanPaywall(null);
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
          }
        });
      }).catch((err) => console.error('Stryker: plan check failed', err));
    }).catch((err) => console.error('Stryker: admin check failed during plan guard', err));
  });
})();
