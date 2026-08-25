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
function syncPublicProfile(uid, fields){
  if (!uid || typeof db === 'undefined' || !db) return Promise.resolve();
  return db.collection('profiles').doc(uid).set(fields, { merge: true })
    .catch((err) => console.error('Stryker: failed to sync public profile', err));
}
