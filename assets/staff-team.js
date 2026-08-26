// Stryker Trading Academy — Staff role management
// Depends on: assets/auth.js, assets/progress.js (for `db`)
//
// Mirrors assets/moderator-team.js for a separate staff/{uid} collection.
//
// STAFF CARRIES NO PERMISSIONS TODAY. It is recognition, not capability: a
// badge marking someone as part of the team. That is deliberate and worth
// stating, because the obvious shortcut would have been to reuse the
// moderators collection and hide the moderation UI from staff. Doing that
// would make a purely cosmetic label silently grant real moderation rights the
// moment someone changed a client-side check — the rules would already permit
// it.
//
// A separate collection with no rule granting it anything means staff is
// exactly as powerless as it looks. When staff does need a capability later,
// it gets added to the rules explicitly, once, in one place.
//
// Granting writes staff/{uid}; the Firestore rule restricts that write to
// admins, so staff can never promote themselves or anyone else.

let CURRENT_STAFF_UIDS = new Set();

function loadStaffList(){
  return db.collection('staff').get().then((snap) => {
    CURRENT_STAFF_UIDS = new Set();
    snap.forEach((doc) => CURRENT_STAFF_UIDS.add(doc.id));
    return CURRENT_STAFF_UIDS;
  }).catch((err) => {
    // Non-fatal: a failed read should cost a badge, not the page.
    console.error('Stryker: could not load the staff list', err);
    return CURRENT_STAFF_UIDS;
  });
}

function grantStaff(targetUid, targetEmail, targetName, grantedByUid){
  return db.collection('staff').doc(targetUid).set({
    email: targetEmail || '',
    displayName: targetName || '',
    grantedAt: firebase.firestore.FieldValue.serverTimestamp(),
    grantedBy: grantedByUid
  });
}

function revokeStaff(targetUid){
  return db.collection('staff').doc(targetUid).delete();
}

function isStaffUid(uid){
  return CURRENT_STAFF_UIDS.has(uid);
}

// The badge itself. Shared so the floor, profiles and the admin table cannot
// drift apart — three hand-written copies of the same SVG is how a badge ends
// up looking different depending on where you see it.
function staffBadgeHtml(label){
  return '<span class="floor-staff-badge" title="' + (label || 'Stryker staff') + '" ' +
         'role="img" aria-label="' + (label || 'Stryker staff') + '">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 2.6l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.1l6.1-.9z"/>' +
    '</svg>' +
  '</span>';
}
