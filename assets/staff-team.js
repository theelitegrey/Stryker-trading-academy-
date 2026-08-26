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
  var text = label || 'Stryker staff';
  return '<span class="floor-staff-badge" title="' + text + '" ' +
         'role="img" aria-label="' + text + '">' +
    // Drawn FOR 15px rather than shrunk to it, which drives every decision
    // here: at that size a silhouette reads and an outline does not, interior
    // detail vanishes, and two shapes closer than about a pixel merge into
    // one. So both forms are solid and separated by empty space, not by a line.
    //
    // Replaces supplied artwork that was a single auto-traced contour — it
    // rendered as an unreadable blob even at 256px, having lost its interior
    // holes in the trace.
    //
    // The gradient id is fixed rather than unique per instance. Browsers
    // resolve to the first matching id in the document, and since every badge
    // emits an identical definition it does not matter which one wins; this is
    // the same approach the moderator shield already uses.
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="staffGrad" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0%" stop-color="#00adb5"/>' +
        '<stop offset="100%" stop-color="#03c988"/>' +
      '</linearGradient></defs>' +
      '<g fill="url(#staffGrad)">' +
        // Head as a five-point star — the "staff" idea in one shape rather
        // than a person and a star competing for the same 15 pixels.
        '<path d="M12 1.6l1.75 3.55 3.92.57-2.84 2.76.67 3.9L12 10.55l-3.5 1.83.67-3.9-2.84-2.76 3.92-.57z"/>' +
        '<path d="M12 13.4c-4.4 0-7.8 2.6-7.8 6.1V21a1 1 0 0 0 1 1h13.6a1 1 0 0 0 1-1v-1.5c0-3.5-3.4-6.1-7.8-6.1z"/>' +
      '</g>' +
    '</svg>' +
  '</span>';
}
