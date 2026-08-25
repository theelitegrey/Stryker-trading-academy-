// Stryker Trading Academy — Moderator team management
// Depends on: assets/auth.js, assets/progress.js (for `db`)
//
// Mirrors assets/admin-team.js exactly, for a separate moderators/{uid}
// collection. Deliberately kept as a distinct role from admin rather than
// a flag on the student doc — moderators can only moderate Trading Floor
// posts (enforced by Firestore rules restricting exactly which fields
// they can touch on a communityPosts doc), nothing else an admin can do.
// Granting/revoking writes/deletes a document at moderators/{uid}; the
// Firestore rule for this collection restricts the write to admins only,
// so moderators can never promote themselves or anyone else.

let CURRENT_MODERATOR_UIDS = new Set();

function loadModeratorList(){
  return db.collection('moderators').get().then((snap) => {
    CURRENT_MODERATOR_UIDS = new Set();
    snap.forEach((doc) => CURRENT_MODERATOR_UIDS.add(doc.id));
    return CURRENT_MODERATOR_UIDS;
  });
}

function grantModerator(targetUid, targetEmail, targetName, grantedByUid){
  return db.collection('moderators').doc(targetUid).set({
    email: targetEmail || '',
    displayName: targetName || '',
    grantedAt: firebase.firestore.FieldValue.serverTimestamp(),
    grantedBy: grantedByUid
  });
}

function revokeModerator(targetUid){
  return db.collection('moderators').doc(targetUid).delete();
}
