// Stryker Trading Academy — deleted-account lockout
// Depends on: assets/auth.js (auth), assets/progress.js (db)
//
// When an admin deletes a user, their Firestore data is wiped — but the
// browser SDK cannot delete another person's Firebase Auth record (that needs
// the Admin SDK). So the login itself survives, and without this check the
// person could simply sign in again and ensureStudentDoc() would build them a
// fresh student doc, resurrecting the account the admin just removed.
//
// The delete writes bannedUsers/{uid}. This runs early on every student page,
// and on finding that doc signs the person out and sends them to the login
// page with an explanation. The security rules enforce the same thing
// server-side, so nothing here is load-bearing for actual data protection —
// it just makes the block visible rather than a wall of silent permission
// errors.

(function () {

  function lockOut() {
    // Replace the page wholesale: whatever else was mid-render, it's showing
    // an account that no longer exists.
    try {
      document.documentElement.innerHTML =
        '<body style="margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; ' +
        'background:#050506; color:#e8e8ea; font-family:Archivo, system-ui, sans-serif; padding:24px;">' +
        '<div style="max-width:420px; text-align:center;">' +
        '<h1 style="font-size:20px; margin:0 0 12px;">This account is no longer active</h1>' +
        '<p style="font-size:14px; line-height:1.6; color:#8b93a0; margin:0 0 20px;">' +
        'Your access to Stryker Trading Academy has been removed. If you think this is a mistake, ' +
        'get in touch through the contact page.</p>' +
        '<a href="contact.html" style="display:inline-block; padding:10px 18px; border-radius:8px; ' +
        'background:#00adb5; color:#050506; font-weight:700; text-decoration:none; font-size:14px;">Contact support</a>' +
        '</div></body>';
    } catch (e) { /* fall through to the sign-out below regardless */ }

    if (typeof auth !== 'undefined' && auth) {
      auth.signOut().catch(function (err) {
        console.warn('Stryker: sign-out after lockout failed', err);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof auth === 'undefined' || !auth) return;

    var checked = false;
    auth.onAuthStateChanged(function (user) {
      if (checked || !user) return;
      checked = true;

      if (typeof db === 'undefined' || !db) return;

      db.collection('bannedUsers').doc(user.uid).get()
        .then(function (doc) {
          if (doc.exists) lockOut();
        })
        .catch(function (err) {
          // Fail open. A failed lookup must not lock out a legitimate
          // student — the security rules are the real boundary, so the worst
          // case here is a deleted user briefly seeing a broken page whose
          // every write is rejected.
          console.warn('Stryker: lockout check failed', err);
        });
    });
  });

})();
