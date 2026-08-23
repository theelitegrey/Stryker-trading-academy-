// Stryker Trading Academy — shared admin-page guard
// Depends on: assets/auth.js, assets/progress.js (for `db`)
//
// Firestore security rules are the actual security boundary (see rules —
// they check for the existence of /admins/{uid}). This just gives a non-
// admin a clean redirect instead of a page full of permission-denied
// errors, and gives admin pages one place to call instead of each
// duplicating the same auth+role check.

function guardAdminPage(onAuthorized){
  if (!auth) return;
  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      setTimeout(() => { if (!handled) goToLoginPreservingReturn(); }, 1500);
      return;
    }
    handled = true;
    db.collection('admins').doc(user.uid).get()
      .then((doc) => {
        if (doc.exists) {
          onAuthorized(user);
        } else {
          alert("This account doesn't have admin access.");
          window.location.href = 'dashboard-user.html';
        }
      })
      .catch((err) => {
        console.error('Stryker: admin check failed', err);
        alert("Couldn't verify admin access. Sending you to your student dashboard.");
        window.location.href = 'dashboard-user.html';
      });
  });
}
