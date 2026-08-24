// Stryker Trading Academy — page access guard, now role-rank aware.
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
//
// Depends on: assets/auth.js (`auth`), assets/progress.js (`db`),
// assets/roles.js (hasRoleAccess, loadPlansForRoles, loadPageAccess)

(function(){
  if (typeof db === 'undefined' || !db) return;
  if (typeof auth === 'undefined' || !auth) return;

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
          if (!plan) window.location.href = 'index.html#pricing';
          return;
        }

        // Rank-aware check.
        const rolesReady = (typeof loadPlansForRoles === 'function' && typeof loadPageAccess === 'function')
          ? Promise.all([loadPlansForRoles(), loadPageAccess()])
          : Promise.resolve([[], {}]);

        rolesReady.then(([, pageAccess]) => {
          const required = pageAccess ? pageAccess[pageKey] : null;
          if (!hasRoleAccess(plan, required)) {
            window.location.href = 'index.html#pricing';
          }
        });
      }).catch((err) => console.error('Stryker: plan check failed', err));
    }).catch((err) => console.error('Stryker: admin check failed during plan guard', err));
  });
})();
