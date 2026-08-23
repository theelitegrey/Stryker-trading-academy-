// Stryker Trading Academy — Admin team management
// Depends on: assets/auth.js, assets/progress.js (for `db`)
//
// Real functionality: granting/revoking admin access writes/deletes a
// document at admins/{uid}. Firestore security rules restrict this write to
// accounts that are already admins, so a non-admin can never grant
// themselves (or anyone) access — enforced server-side, not just hidden UI.

let CURRENT_ADMIN_UIDS = new Set();
let CURRENT_ADMIN_DOCS = [];

function loadAdminList(){
  return db.collection('admins').get().then((snap) => {
    CURRENT_ADMIN_UIDS = new Set();
    CURRENT_ADMIN_DOCS = [];
    snap.forEach((doc) => {
      CURRENT_ADMIN_UIDS.add(doc.id);
      CURRENT_ADMIN_DOCS.push(Object.assign({ uid: doc.id }, doc.data()));
    });
    return CURRENT_ADMIN_DOCS;
  });
}

function grantAdmin(targetUid, targetEmail, targetName, grantedByUid){
  return db.collection('admins').doc(targetUid).set({
    email: targetEmail || '',
    displayName: targetName || '',
    grantedAt: firebase.firestore.FieldValue.serverTimestamp(),
    grantedBy: grantedByUid
  });
}

function revokeAdmin(targetUid){
  return db.collection('admins').doc(targetUid).delete();
}
