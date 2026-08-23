// Stryker Trading Academy — sitewide maintenance mode gate
// Depends on: assets/progress.js (`db`), assets/auth.js (`auth`)
//
// Intentionally only included on public/student-facing pages — never on
// admin pages, login.html, signup.html, or maintenance.html itself — so an
// admin can always get in to turn maintenance mode back off. As a second
// layer of safety, this also explicitly lets a signed-in admin through even
// if it somehow ends up loaded on a page it shouldn't be.

(function(){
  if (typeof db === 'undefined' || !db) return;

  db.collection('settings').doc('site').get().then((doc) => {
    if (!doc.exists || !doc.data().maintenanceMode) return;

    function goToMaintenance(){
      window.location.href = 'maintenance.html';
    }

    if (typeof auth !== 'undefined' && auth) {
      auth.onAuthStateChanged((user) => {
        if (!user) { goToMaintenance(); return; }
        db.collection('admins').doc(user.uid).get().then((adminDoc) => {
          if (!adminDoc.exists) goToMaintenance();
        }).catch(() => goToMaintenance());
      });
    } else {
      goToMaintenance();
    }
  }).catch((err) => {
    console.error('Stryker: maintenance mode check failed', err);
  });
})();
