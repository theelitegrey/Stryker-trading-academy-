// Stryker Trading Academy — require a selected plan before accessing
// private student content. Admins are always exempt. This is intentionally
// only loaded on pages that should be gated this way — never on
// checkout.html (where a plan is actually chosen), the public curriculum
// pages (courses.html / chapter.html — those use their own guest-paywall
// dimming instead), index.html, or any admin page.
//
// Depends on: assets/auth.js (`auth`), assets/progress.js (`db`)

(function(){
  if (typeof db === 'undefined' || !db) return;
  if (typeof auth === 'undefined' || !auth) return;

  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled || !user) return; // the page's own guard handles "not signed in"
    handled = true;

    db.collection('admins').doc(user.uid).get().then((adminDoc) => {
      if (adminDoc.exists) return; // admins never need a plan

      db.collection('students').doc(user.uid).get().then((studentDoc) => {
        const plan = studentDoc.exists ? studentDoc.data().plan : null;
        if (!plan) {
          window.location.href = 'index.html#pricing';
        }
      }).catch((err) => console.error('Stryker: plan check failed', err));
    }).catch((err) => console.error('Stryker: admin check failed during plan guard', err));
  });
})();
