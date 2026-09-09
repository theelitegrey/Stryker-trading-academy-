/**
 * Stryker Trading Academy — referral point crediting, server side
 *
 * WHY THIS EXISTS
 *
 * Referral points used to be written by the browser of the person being
 * referred: assets/referrals.js called increment() on students/{referrerUid}
 * and profiles/{referrerUid}. That is a cross-user write, so the Firestore
 * rules had to allow one account to modify another's document — and once that
 * door is open, anyone can award themselves any number of points from the
 * console. Points feed the leaderboard and the giveaway draws, so they are
 * worth something.
 *
 * Now the browser only records the referral event. This trigger reads the
 * point values from settings/referralConfig (NOT from the event document) and
 * credits the referrer with the Admin SDK.
 *
 * WHAT IT ENFORCES
 *   - point amounts come from settings/referralConfig, never from the client
 *   - a referral cannot credit its own referrer twice: creditedSignup and
 *     creditedConversion are stamped inside the same transaction as the credit
 *   - a row where referrerUid === referredUid credits nobody
 *   - the referrer must actually exist as a student
 *
 * DEPLOY (name every function or the others get deleted):
 *   firebase deploy --only functions:onReferralWritten
 *
 * DEPLOY THIS BEFORE (or with) the site build that removes the client-side
 * award, or referral points will stop being credited in the gap. If rows are
 * created during a gap, re-saving them from the Referrals admin page will fire
 * this trigger and credit them late.
 *
 * AFTER DEPLOYING, the Firestore rules should stop allowing any client write
 * to referralPoints on students/* and profiles/*, and should require that a
 * referrals document is created by the person being referred
 * (request.resource.data.referredUid == request.auth.uid).
 */

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const DEFAULTS = { pointsPerSignup: 0, pointsPerConversion: 0 };
const MAX_POINTS = 10000;   // a sane ceiling; a mistyped config should not mint a million points

async function loadConfig(db) {
  try {
    const doc = await db.collection('settings').doc('referralConfig').get();
    if (!doc.exists) return DEFAULTS;
    const d = doc.data() || {};
    if (d.enabled === false) return { pointsPerSignup: 0, pointsPerConversion: 0 };
    const clamp = (v) => {
      const n = Math.floor(Number(v));
      return isFinite(n) && n > 0 ? Math.min(n, MAX_POINTS) : 0;
    };
    return {
      pointsPerSignup: clamp(d.pointsPerSignup),
      pointsPerConversion: clamp(d.pointsPerConversion)
    };
  } catch (e) {
    console.error('onReferralWritten: could not read settings/referralConfig', e);
    return DEFAULTS;
  }
}

// Credits both the private student doc and the public profile mirror the
// leaderboard reads, and stamps the referral row so this can never run twice
// for the same stage.
async function credit(db, referralRef, referrerUid, points, flagField) {
  if (!points) return false;

  const studentRef = db.collection('students').doc(referrerUid);
  const profileRef = db.collection('profiles').doc(referrerUid);

  const credited = await db.runTransaction(async (tx) => {
    const doc = await tx.get(referralRef);
    if (!doc.exists) return false;
    if (doc.data()[flagField]) return false;          // already credited
    tx.update(referralRef, {
      [flagField]: true,
      [flagField + 'At']: admin.firestore.FieldValue.serverTimestamp(),
      [flagField + 'Points']: points
    });
    return true;
  });

  if (!credited) return false;

  const inc = admin.firestore.FieldValue.increment(points);
  await studentRef.set({ referralPoints: inc }, { merge: true });
  await profileRef.set({ referralPoints: inc }, { merge: true }).catch(() => {});
  return true;
}

exports.onReferralWritten = onDocumentWritten(
  {
    document: 'referrals/{referralId}',
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB'
  },
  async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return null;          // deleted: nothing to credit

    const row = after.data() || {};
    const db = admin.firestore();

    const referrerUid = typeof row.referrerUid === 'string' ? row.referrerUid : '';
    const referredUid = typeof row.referredUid === 'string' ? row.referredUid : '';

    if (!referrerUid) {
      console.warn('onReferralWritten: row', event.params.referralId, 'has no referrerUid');
      return null;
    }
    // Self-referral: a row pointing at its own creator earns nothing. Cheap to
    // check here and the obvious first thing anyone would try.
    if (referrerUid === referredUid) {
      console.warn('onReferralWritten: self-referral ignored for', referrerUid);
      return null;
    }

    const referrer = await db.collection('students').doc(referrerUid).get();
    if (!referrer.exists) {
      console.warn('onReferralWritten: referrer', referrerUid, 'is not a student');
      return null;
    }

    const config = await loadConfig(db);
    const ref = after.ref;

    // Signing up is credited once, when the row first appears.
    if (config.pointsPerSignup) {
      const did = await credit(db, ref, referrerUid, config.pointsPerSignup, 'creditedSignup');
      if (did) console.log('onReferralWritten: +' + config.pointsPerSignup + ' signup pts to ' + referrerUid);
    }

    // Converting is credited once, when the row reaches that status.
    if (row.status === 'converted' && config.pointsPerConversion) {
      const did = await credit(db, ref, referrerUid, config.pointsPerConversion, 'creditedConversion');
      if (did) console.log('onReferralWritten: +' + config.pointsPerConversion + ' conversion pts to ' + referrerUid);
    }

    return null;
  }
);
