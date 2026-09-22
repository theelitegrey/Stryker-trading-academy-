// Stryker Trading Academy — admin-only full account deletion
//
// WHY THIS EXISTS
// The browser Firebase SDK can only delete the Auth record of the user who is
// currently signed in. An admin deleting SOMEONE ELSE's login is impossible
// from the client at any privilege level — it requires the Admin SDK, which
// can only run on a trusted server. That's this function.
//
// Without it, "delete user" could only wipe Firestore data, and the person
// could sign straight back in and be recreated as a fresh student.
//
// SECURITY MODEL
// This runs with full administrative privileges over the entire project, so
// it MUST NOT trust anything the caller says beyond their verified identity.
// Firebase verifies the ID token and hands it over as context.auth; every
// other check below is done server-side against Firestore. In particular the
// caller's admin status is read from the database here, never accepted as a
// claim from the client.

const functions = require('firebase-functions/v1');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

// Deletes every document a query returns, in chunks. Firestore caps a write
// batch at 500 operations.
async function deleteByQuery(query, label, report) {
  try {
    const snap = await query.get();
    if (snap.empty) return;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    report.push(docs.length + ' ' + label);
  } catch (err) {
    console.error('deleteByQuery failed for ' + label, err);
    report.push(label + ' — FAILED (' + err.message + ')');
  }
}

exports.deleteUserAccount = functions
  .region('us-central1')
  .runWith({ maxInstances: 2, timeoutSeconds: 300, memory: '256MB' })
  .https.onCall(async (data, context) => {

    // ---- 1. Caller must be signed in ----
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
    }
    const callerUid = context.auth.uid;

    const targetUid = (data && typeof data.uid === 'string') ? data.uid.trim() : '';
    if (!targetUid) {
      throw new functions.https.HttpsError('invalid-argument', 'No user id was supplied.');
    }

    // ---- 2. Caller must be a real admin, checked against Firestore ----
    // Read from the database rather than trusting a custom claim or anything
    // in `data` — the client controls both of those.
    const callerAdminDoc = await db.collection('admins').doc(callerUid).get();
    if (!callerAdminDoc.exists) {
      throw new functions.https.HttpsError('permission-denied', 'Only admins can delete accounts.');
    }

    // ---- 3. Refuse the two footguns ----
    if (targetUid === callerUid) {
      throw new functions.https.HttpsError('failed-precondition', "You can't delete your own account with this tool.");
    }

    const targetAdminDoc = await db.collection('admins').doc(targetUid).get();
    if (targetAdminDoc.exists) {
      const allAdmins = await db.collection('admins').get();
      if (allAdmins.size <= 1) {
        throw new functions.https.HttpsError('failed-precondition', 'That is the only admin account — deleting it would lock everyone out.');
      }
    }

    const report = [];

    // Look up who this was before the record disappears, for the audit trail.
    let targetEmail = null;
    let targetName = null;
    try {
      const studentDoc = await db.collection('students').doc(targetUid).get();
      if (studentDoc.exists) {
        targetEmail = studentDoc.data().email || null;
        targetName = studentDoc.data().displayName || null;
      }
    } catch (err) {
      console.warn('could not read student doc before delete', err);
    }

    // ---- 4. Cut off access first ----
    // Revoking refresh tokens invalidates the session immediately. Deleting
    // the Auth record alone leaves any already-issued ID token valid until it
    // expires (up to an hour), which is long enough to keep writing data.
    try {
      await admin.auth().revokeRefreshTokens(targetUid);
      report.push('Sessions revoked');
    } catch (err) {
      // A missing Auth record here is fine — it means we're cleaning up
      // leftover Firestore data for a login that's already gone.
      if (err.code !== 'auth/user-not-found') {
        console.error('revokeRefreshTokens failed', err);
      }
    }

    // Tombstone, enforced by the security rules. Belt and braces: it blocks
    // writes from a still-valid token in the window before it expires, and
    // it survives if a later stage of this function fails.
    try {
      await db.collection('bannedUsers').doc(targetUid).set({
        email: targetEmail,
        displayName: targetName,
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        deletedBy: callerUid
      });
    } catch (err) {
      console.error('could not write tombstone', err);
    }

    // ---- 5. Cascade the Firestore data ----
    // recursiveDelete handles the journal/bookmarks subcollections, which a
    // plain doc delete would orphan.
    try {
      await db.recursiveDelete(db.collection('students').doc(targetUid));
      report.push('Student record, journal and bookmarks');
    } catch (err) {
      console.error('recursiveDelete on student failed', err);
      report.push('Student record — FAILED (' + err.message + ')');
    }

    // Posts are deleted recursively too, so their replies subcollection goes
    // with them instead of being left behind unreachable.
    try {
      const posts = await db.collection('communityPosts').where('authorUid', '==', targetUid).get();
      for (const post of posts.docs) {
        await db.recursiveDelete(post.ref);
      }
      if (posts.size) report.push(posts.size + ' trading floor posts');
    } catch (err) {
      console.error('post deletion failed', err);
      report.push('Trading floor posts — FAILED (' + err.message + ')');
    }

    await deleteByQuery(db.collection('notifications').where('recipientUid', '==', targetUid), 'notifications', report);
    await deleteByQuery(db.collection('referralCodes').where('uid', '==', targetUid), 'invite codes', report);
    await deleteByQuery(db.collection('referrals').where('referrerUid', '==', targetUid), 'invites they sent', report);

    // NOT deleted. Rows where this person was the INVITEE belong to whoever
    // invited them. Removing them erases someone else's earned history and
    // drops their invite count, while the points those invites paid remain on
    // their profile — leaving a total that matches no visible row. Tombstone
    // instead, so the credit outlives the account.
    try {
      const invitedBy = await db.collection('referrals').where('referredUid', '==', targetUid).get();
      if (!invitedBy.empty) {
        const batch = db.batch();
        invitedBy.forEach((d) => batch.update(d.ref, {
          referredUserDeleted: true,
          referredName: d.data().referredName || targetName || 'A former member',
          referredEmail: null,   // account is gone; do not retain the address
          referredUid: null      // break the link to a uid that no longer exists
        }));
        await batch.commit();
        report.push(invitedBy.size + ' invite record(s) kept for whoever invited them');
      }
    } catch (err) {
      console.error('tombstoning referral rows failed', err);
      report.push('invite records — FAILED (' + err.message + ')');
    }

    for (const col of ['profiles', 'admins', 'moderators']) {
      try {
        await db.collection(col).doc(targetUid).delete();
      } catch (err) {
        console.error('could not delete ' + col + ' doc', err);
      }
    }
    report.push('Public profile and role grants');

    // ---- 6. Finally, the Auth record itself ----
    // Last, deliberately: if this succeeded first and something above then
    // failed, there would be orphaned data with no account to retry against.
    let authDeleted = false;
    try {
      await admin.auth().deleteUser(targetUid);
      authDeleted = true;
      report.push('Login deleted');
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        authDeleted = true;
        report.push('Login already gone');
      } else {
        console.error('deleteUser failed', err);
        throw new functions.https.HttpsError('internal', 'Data was removed but the login could not be deleted: ' + err.message);
      }
    }

    // The tombstone's only job was covering the window before the Auth record
    // went away. Once the login is gone it can't be used, so clear it and keep
    // the collection meaningful.
    if (authDeleted) {
      try { await db.collection('bannedUsers').doc(targetUid).delete(); } catch (err) { /* harmless if it lingers */ }
    }

    console.log('Admin ' + callerUid + ' deleted account ' + targetUid + ' (' + (targetEmail || 'unknown email') + ')');

    return { ok: true, authDeleted: authDeleted, report: report };
  });

// ---------------------------------------------------------------------------
// Push notifications
//
// Triggered by document creation in the notifications collection rather than
// called from each place that notifies. That matters: likes, replies,
// moderation, achievements, referrals and admin task alerts all already write
// there, so every one of them gains push without being touched — and anything
// added later gets it for free. Calling a send function from each site would
// mean instrumenting a dozen places and forgetting some.
//
// Sending requires the Admin SDK, so it cannot happen in the browser. The web
// client only ever registers a token; it can never send to anyone.
// ---------------------------------------------------------------------------

// GEN 2, deployed to us-central1.
//
// Two separate failures got us here, and they pull in opposite directions:
//
//   1. Gen 1 in us-central1 was rejected — a Gen 1 Firestore trigger must sit
//      in the same region as the database, and this database is the nam5
//      MULTI-region, which Gen 1 cannot target at all.
//   2. Gen 2 in nam5 was then rejected with "Location nam5 is not found or
//      access is unauthorized" — because nam5 is a FIRESTORE location, not a
//      Cloud Functions one. There is no compute there to deploy into.
//
// Gen 2 resolves it: the function runs in a real compute region and Eventarc
// routes events from the multi-region database to it. us-central1 is the
// correct pairing for nam5 (europe-west4 would be the one for eur3).
//
// So `region` here is where the CODE runs, not where the data lives — the
// opposite of the Gen 1 rule, which is what made this confusing.
exports.onNotificationCreated = onDocumentCreated({
  document: 'notifications/{notificationId}',
  region: 'us-central1',
  memory: '256MiB',
  maxInstances: 20
}, async (event) => {
    const snap = event.data;
    if (!snap) return null;
    const n = snap.data() || {};
    if (!n.recipientUid) return null;

    const tokensSnap = await db.collection('pushTokens')
      .where('uid', '==', n.recipientUid).get();
    if (tokensSnap.empty) return null;   // recipient has no device registered

    const tokens = tokensSnap.docs.map((d) => d.id);

    // DATA-ONLY, no `notification` block. With a notification payload the
    // browser renders its own popup AND fires onBackgroundMessage, so the user
    // sees the same thing twice. Data-only leaves the service worker solely in
    // charge of what is shown.
    const message = {
      data: {
        title: 'Stryker Trading Academy',
        body: String(n.message || 'You have a new notification').slice(0, 240),
        link: '/' + String(n.link || 'dashboard-user.html'),
        type: String(n.type || 'stryker')
      },
      webpush: {
        headers: { Urgency: 'high', TTL: '86400' },
        fcmOptions: { link: 'https://strykertrading.com/' + String(n.link || 'dashboard-user.html') }
      }
    };

    const results = await Promise.allSettled(
      tokens.map((t) => admin.messaging().send(Object.assign({ token: t }, message)))
    );

    // Tokens die routinely — cleared site data, uninstalled PWA, a browser
    // rotating its registration. Left in place they are retried forever and
    // every send slowly gets more expensive, so prune the ones FCM rejects as
    // permanently invalid. Transient failures are NOT pruned; a network blip
    // must not cost someone their registration.
    const dead = [];
    results.forEach((r, i) => {
      if (r.status !== 'rejected') return;
      const code = r.reason && r.reason.errorInfo && r.reason.errorInfo.code;
      if (code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument') {
        dead.push(tokens[i]);
      } else {
        console.warn('push send failed (kept)', code || r.reason);
      }
    });

    if (dead.length) {
      const batch = db.batch();
      dead.forEach((t) => batch.delete(db.collection('pushTokens').doc(t)));
      await batch.commit();
      console.log('pruned ' + dead.length + ' dead push token(s)');
    }

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    console.log('push: ' + sent + '/' + tokens.length + ' delivered for ' + n.recipientUid);
    return null;
  });

