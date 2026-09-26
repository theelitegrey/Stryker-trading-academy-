/**
 * Stryker Trading Academy — Trading Floor like-count crediting, server side
 *
 * DRAFT — not exported/deployed. See reports/workers/w1-likes-fn-draft.md
 * for the design writeup, harness output, and the required firestore.rules
 * delta (NOT included here; rules are proposed only, never edited by this
 * branch).
 *
 * WHY THIS EXISTS
 *
 * assets/community.js toggleReaction() used to increment
 * students/{post.authorUid}.floorLikesReceived directly from the LIKER's
 * browser — a cross-user write. firestore.rules students/{uid} update is
 * `isAdmin() || isSelf(uid)`, no per-field non-owner exception (the old
 * comment claiming one was wrong), so that write was always denied. The
 * counter never moved; every like/unlike logged a console permission error
 * for nothing.
 *
 * This trigger reads communityPosts/{id}'s likedBy array before/after a
 * write, diffs it, and applies the net change to the POST AUTHOR's own
 * floorLikesReceived with the Admin SDK (which bypasses rules by design —
 * that's what makes a genuinely cross-user credit safe: only this function,
 * not any browser, can move the number).
 *
 * WHAT IT ENFORCES
 *   - self-likes never count: if authorUid is in likedBy, it is excluded
 *     from both the before and after sets before diffing, so liking (or
 *     unliking) your own post is a strict no-op on the counter
 *   - the net delta can be negative (someone unliked) or span more than 1
 *     (a batched/offline write that changed several likers at once) — this
 *     trigger handles both, it does not assume "one like at a time"
 *   - no-op fast exit when likedBy didn't change (any other field write —
 *     text edit, upvote, moderation — touches this document too and must
 *     not re-run the like math)
 *   - authorUid comes from the document itself (event.data.after / .before),
 *     never from client input to this function — there is none, it's a
 *     trigger, not a callable
 *
 * IDEMPOTENCY / RETRY NOTE (see also the handback)
 * Firestore triggers can redeliver the SAME write event at-least-once on
 * retry. This trigger is NOT naturally idempotent against that: it applies
 * a relative FieldValue.increment(delta) computed from a before/after diff,
 * so a redelivered event would double-apply the same delta. Firebase v2
 * functions provide event.id for de-duplication; a production version of
 * this should record the last-applied event id (e.g. on the post doc, or a
 * small ledger collection) inside the same transaction as the increment and
 * skip re-applying an event id already seen. Left as a documented gap for
 * this draft rather than adding that machinery before the design itself is
 * approved — see the handback's "idempotency" section for the exact
 * proposal.
 *
 * DEPLOY (name every function or the others get deleted) — NOT done here:
 *   firebase deploy --only functions:onCommunityPostLikesChanged
 *
 * DEPLOY THIS BEFORE (or with) the site build that removes the client-side
 * increment in community.js, or likes will stop being credited in the gap
 * (same sequencing note as referralPoints.js).
 *
 * AFTER DEPLOYING, firestore.rules should add floorLikesReceived to
 * privilegedKeys()/touchesPrivileged() on students/{uid} and profiles/{uid}
 * — see the handback for the exact proposed delta (not applied by this
 * branch).
 */

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

// Removes a post's own author from a likedBy array before diffing, so a
// self-like/self-unlike never moves the counter. Firestore array fields
// read back as plain JS arrays on the Admin SDK; a missing field reads as
// undefined, hence the `|| []`.
function othersOnly(likedBy, authorUid) {
  return new Set((likedBy || []).filter((uid) => uid !== authorUid));
}

exports.onCommunityPostLikesChanged = onDocumentWritten(
  {
    document: 'communityPosts/{postId}',
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
    maxInstances: 10
  },
  async (event) => {
    const before = event.data && event.data.before;
    const after = event.data && event.data.after;

    // Deleted post: nothing to credit (and no author doc changes needed —
    // a deleted post's past likes already landed when they happened).
    if (!after || !after.exists) return null;

    const afterData = after.data() || {};
    const authorUid = typeof afterData.authorUid === 'string' ? afterData.authorUid : '';
    if (!authorUid) {
      console.warn('onCommunityPostLikesChanged: post', event.params.postId, 'has no authorUid');
      return null;
    }

    const beforeData = (before && before.exists) ? before.data() || {} : {};
    const beforeLikers = othersOnly(beforeData.likedBy, authorUid);
    const afterLikers = othersOnly(afterData.likedBy, authorUid);

    // Fast no-op exit: this document also changes on text edits, upvotes/
    // downvotes, replyCount bumps and moderation actions — none of those
    // should re-run the like math. Compare as sets, not arrays, since
    // Firestore doesn't guarantee array order survives a round trip.
    let delta = 0;
    afterLikers.forEach((uid) => { if (!beforeLikers.has(uid)) delta += 1; });
    beforeLikers.forEach((uid) => { if (!afterLikers.has(uid)) delta -= 1; });
    if (delta === 0) return null;

    const db = admin.firestore();
    const studentRef = db.collection('students').doc(authorUid);
    const profileRef = db.collection('profiles').doc(authorUid);

    // The author must actually exist as a student — mirrors referralPoints.js's
    // guard. A post can in principle outlive its author's account (deleted
    // some other way); don't create a fresh doc just to hold a like count.
    const author = await studentRef.get();
    if (!author.exists) {
      console.warn('onCommunityPostLikesChanged: author', authorUid, 'is not a student');
      return null;
    }

    const inc = admin.firestore.FieldValue.increment(delta);
    await studentRef.set({ floorLikesReceived: inc }, { merge: true });
    await profileRef.set({ floorLikesReceived: inc }, { merge: true }).catch((err) => {
      // Mirror is best-effort, same pattern as referralPoints.js credit():
      // the student doc (the source of truth the achievement check reads)
      // must not fail because the public mirror write did.
      console.error('onCommunityPostLikesChanged: profile mirror failed for', authorUid, err);
    });

    console.log('onCommunityPostLikesChanged: ' + (delta > 0 ? '+' : '') + delta + ' floorLikesReceived for ' + authorUid + ' (post ' + event.params.postId + ')');
    return null;
  }
);
