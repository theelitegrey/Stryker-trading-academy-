// Stryker Trading Academy — public profile sync
// Depends on: assets/progress.js (`db`)
//
// Writes a deliberately narrow, public-safe subset of a student's data to
// profiles/{uid} — a separate collection from students/{uid}, specifically
// because the full student doc holds data that should never be broadly
// readable (email address, referral code, exact chapter/journal progress).
// Firestore security rules can't restrict which FIELDS within a document
// are readable, only whether the whole document is — so the only way to
// let other signed-in students see "a profile" without also exposing
// everything else is to keep the public-safe fields in their own document.
//
// Call this any time one of these fields changes for a student. Failures
// are logged but never block the caller — a profile page is a nice-to-have,
// not something that should ever be able to break account creation, an
// avatar upload, or an admin's plan change.
//
// A permission-denied on the very first write right after sign-up/sign-in
// is almost always the Firestore client racing the fresh ID token (the
// same race assets/reader.js's withAuthRetry works around for chapter
// reads) — isSelf(uid) in firestore.rules needs request.auth to already
// carry the new uid, which can lag the SDK's own onAuthStateChanged by a
// beat. One bounded retry after forcing a token refresh clears it without
// changing what anyone can read or write.
function syncPublicProfile(uid, fields){
  if (!uid || typeof db === 'undefined' || !db) return Promise.resolve();
  const write = () => db.collection('profiles').doc(uid).set(fields, { merge: true });
  return write().catch((err) => {
    if (!err || err.code !== 'permission-denied') {
      console.error('Stryker: failed to sync public profile', err);
      return;
    }
    const user = (typeof auth !== 'undefined' && auth) ? auth.currentUser : null;
    if (!user || user.uid !== uid) {
      console.error('Stryker: failed to sync public profile', err);
      return;
    }
    return new Promise((r) => setTimeout(r, 400))
      .then(() => (user.getIdToken) ? user.getIdToken(true) : null)
      .catch(() => null)
      .then(write)
      .catch((err2) => console.error('Stryker: failed to sync public profile', err2));
  });
}
