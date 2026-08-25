// Stryker Trading Academy — Referral / Invite tracking module
// Depends on: assets/progress.js (`db`), assets/auth.js (`auth`)
//
// Data model:
// - referralCodes/{code}: { uid } — a small, PUBLICLY READABLE lookup table
//   mapping a short code to the student who owns it. Public read is required
//   so a brand-new signup (not yet authenticated as anyone) can resolve a
//   code in the URL to a referrer. Only the owning student (or an admin)
//   can create their own entry.
// - students/{uid}.referralCode: the same code, stored on the student's own
//   profile for quick display without a second lookup.
// - students/{uid}.referralPoints: running point total, incremented here.
// - referrals/{autoId}: { referrerUid, referrerCode, referredUid,
//   referredEmail, referredName, status: 'signed_up' | 'converted',
//   pointsAwarded, createdAt } — one doc per successful referral event.
// - settings/referralConfig: { pointsPerSignup, pointsPerConversion,
//   enabled } — admin-tunable point values.
//
// Everything here fails open and logs rather than throwing where reasonable,
// since a referral-tracking hiccup should never block a signup or purchase.

const REFERRAL_STORAGE_KEY = 'stryker_referral_code';

function generateReferralCode(displayName, email){
  const base = (displayName || (email ? email.split('@')[0] : 'trader'))
    .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'trader';
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return base + suffix;
}

// Called once per student, the first time they visit a page that needs
// their referral code (e.g. the Invite & Earn page). Uses a Firestore
// transaction on the referralCodes lookup doc so two students can't
// collide on the same generated code.
function ensureReferralCode(uid, displayName, email){
  if (typeof db === 'undefined' || !db) return Promise.resolve(null);
  return db.collection('students').doc(uid).get().then((studentDoc) => {
    const existing = studentDoc.exists ? studentDoc.data().referralCode : null;
    if (existing) return existing;

    function attempt(triesLeft){
      if (triesLeft <= 0) return Promise.reject(new Error('Could not generate a unique referral code.'));
      const code = generateReferralCode(displayName, email);
      const codeRef = db.collection('referralCodes').doc(code);
      return db.runTransaction((tx) => {
        return tx.get(codeRef).then((codeDoc) => {
          if (codeDoc.exists) throw new Error('COLLISION');
          tx.set(codeRef, { uid: uid });
          tx.set(db.collection('students').doc(uid), { referralCode: code }, { merge: true });
        });
      }).then(() => code).catch((err) => {
        if (err && err.message === 'COLLISION') return attempt(triesLeft - 1);
        throw err;
      });
    }
    return attempt(5);
  });
}

function referralLinkForCode(code){
  if (!code) return '';
  const origin = window.location.origin || 'https://strykertrading.com';
  return origin + '/signup.html?ref=' + encodeURIComponent(code);
}

// Called on the signup page: stash a ?ref= code from the URL into
// sessionStorage so it survives the redirect to the dashboard, where the
// student doc actually gets created.
function capturePendingReferralCode(){
  const code = new URLSearchParams(window.location.search).get('ref');
  if (code) {
    try { sessionStorage.setItem(REFERRAL_STORAGE_KEY, code); } catch (e) { /* storage unavailable, fail open */ }
  }
}

function takePendingReferralCode(){
  try {
    const code = sessionStorage.getItem(REFERRAL_STORAGE_KEY);
    if (code) sessionStorage.removeItem(REFERRAL_STORAGE_KEY);
    return code;
  } catch (e) {
    return null;
  }
}

function loadReferralConfig(){
  if (typeof db === 'undefined' || !db) return Promise.resolve({ pointsPerSignup: 10, pointsPerConversion: 50, enabled: true });
  return db.collection('settings').doc('referralConfig').get()
    .then((doc) => doc.exists ? Object.assign({ pointsPerSignup: 10, pointsPerConversion: 50, enabled: true }, doc.data()) : { pointsPerSignup: 10, pointsPerConversion: 50, enabled: true })
    .catch(() => ({ pointsPerSignup: 10, pointsPerConversion: 50, enabled: true }));
}

// Normalizes a name that may have been stored as the literal string "null"
// or "undefined" by an earlier code path, so the UI never renders those.
function cleanReferredName(value){
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return null;
  return s;
}

// Mirrors the running point total onto the PUBLIC profiles doc as well as the
// private student doc. The leaderboard has to read every competitor's total,
// and students/{uid} is readable only by its owner and admins — so a
// leaderboard built on students/ returns nothing for a normal student. The
// public profiles collection is the only place a cross-student read can work.
function awardReferralPoints(referrerUid, points){
  if (!points) return Promise.resolve();
  const inc = firebase.firestore.FieldValue.increment(points);
  return Promise.all([
    db.collection('students').doc(referrerUid).set({ referralPoints: inc }, { merge: true })
      .catch((err) => console.error('Stryker: could not award referral points on student doc', err)),
    db.collection('profiles').doc(referrerUid).set({ referralPoints: inc }, { merge: true })
      .catch((err) => console.error('Stryker: could not mirror referral points to profile', err))
  ]);
}

function notifyReferrer(referrerUid, type, message){
  if (typeof createNotification !== 'function') return Promise.resolve();
  return createNotification(referrerUid, type, message, 'referrals.html')
    .catch((err) => console.error('Stryker: referral notification failed', err));
}

// Called once, right after a brand-new student doc is created (see
// progress.js's ensureStudentDoc). Resolves any pending ?ref= code left in
// sessionStorage from signup, records the referral, and awards the
// referrer's signup points. A student can never refer themselves, and this
// only ever runs once per new account (the pending code is consumed).
//
// ORDERING MATTERS. referredBy is written FIRST, before anything else.
// It's a write to this student's OWN doc, so it always succeeds, and it is
// the marker every other part of the system uses to know this person was
// referred. Previously it was written LAST, after a cross-user points
// increment — and when that increment was rejected by the security rules the
// whole promise chain aborted, so referredBy never got set. The referral then
// looked invisible to checkout, which happily created a SECOND referral doc
// for the same person. That is why one invitee showed up as two.
//
// Every cross-user step below also catches independently, so no single
// permission failure can abort the ones after it.
function processPendingReferralForNewStudent(newUid, newDisplayName, newEmail){
  const code = takePendingReferralCode();
  if (!code || typeof db === 'undefined' || !db) return Promise.resolve(null);

  return db.collection('referralCodes').doc(code).get()
    .then((codeDoc) => {
      if (!codeDoc.exists) return null;
      const referrerUid = codeDoc.data().uid;
      if (!referrerUid || referrerUid === newUid) return null; // no self-referrals

      return loadReferralConfig().then((config) => {
        if (!config.enabled) return null;
        const points = config.pointsPerSignup || 0;
        const name = cleanReferredName(newDisplayName);

        // 1. Own doc first — this is the dedup marker, it must land.
        return db.collection('students').doc(newUid)
          .set({ referredBy: referrerUid }, { merge: true })
          .then(() => db.collection('referrals').add({
            referrerUid: referrerUid,
            referrerCode: code,
            referredUid: newUid,
            referredName: name,
            referredEmail: newEmail || null,
            status: 'signed_up',
            pointsAwarded: points,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          }))
          .then(() => awardReferralPoints(referrerUid, points))
          .then(() => notifyReferrer(
            referrerUid,
            'referral_signup',
            (name || 'Someone') + ' just signed up using your invite link — +' + points + ' pts.'
          ))
          .then(() => {
            if (typeof checkAndNotifyNewAchievementsFor === 'function') checkAndNotifyNewAchievementsFor(referrerUid, false);
          });
      });
    })
    .catch((err) => {
      console.error('Stryker: referral processing failed (non-fatal)', err);
      return null;
    });
}

// Called from checkout.js right after an order completes. If the
// purchasing student was referred by someone, award that referrer the
// one-time conversion bonus — but only once per referred student, checked
// via a marker field on their own student doc so a second purchase (e.g.
// an upgrade) doesn't pay out twice.
function processReferralConversion(purchasingUid){
  if (typeof db === 'undefined' || !db) return Promise.resolve(null);
  return db.collection('students').doc(purchasingUid).get().then((studentDoc) => {
    if (!studentDoc.exists) return null;
    const data = studentDoc.data();
    const referrerUid = data.referredBy;
    if (!referrerUid || data.referralConversionPaid) return null; // never referred, or already paid out

    return loadReferralConfig().then((config) => {
      if (!config.enabled) return null;
      const points = config.pointsPerConversion || 0;
      const name = cleanReferredName(data.displayName) || cleanReferredName(data.email);

      // Own doc first, same reasoning as the signup path: the paid marker is
      // what stops a second purchase paying out twice, so it must not depend
      // on a cross-user write succeeding.
      return db.collection('students').doc(purchasingUid)
        .set({ referralConversionPaid: true }, { merge: true })
        .then(() => db.collection('referrals')
          .where('referredUid', '==', purchasingUid)
          .where('referrerUid', '==', referrerUid)
          .limit(1).get())
        .then((snap) => {
          if (!snap.empty) {
            // Upgrade the EXISTING signup row rather than adding another —
            // one invitee is one row, whatever stage they've reached.
            return snap.docs[0].ref.update({
              status: 'converted',
              pointsAwarded: firebase.firestore.FieldValue.increment(points)
            });
          }
          return null;
        })
        .then(() => awardReferralPoints(referrerUid, points))
        .then(() => notifyReferrer(
          referrerUid,
          'referral_conversion',
          (name || 'Someone you invited') + ' upgraded to a paid plan — +' + points + ' pts.'
        ))
        .then(() => {
          if (typeof checkAndNotifyNewAchievementsFor === 'function') checkAndNotifyNewAchievementsFor(referrerUid, false);
        });
    });
  }).catch((err) => {
    console.error('Stryker: referral conversion processing failed (non-fatal)', err);
    return null;
  });
}

// Leaderboard: top N by referralPoints, read from the PUBLIC profiles
// collection. It used to query students/, which the rules restrict to the
// owning student and admins — so a list query from a normal student was
// rejected outright and the leaderboard silently came back empty for
// everyone. profiles/ is readable by any signed-in user, which is exactly
// what a leaderboard needs.
function loadReferralLeaderboard(limitCount){
  if (typeof db === 'undefined' || !db) return Promise.resolve([]);
  return db.collection('profiles')
    .orderBy('referralPoints', 'desc')
    .limit(limitCount || 10)
    .get()
    .then((snap) => {
      const list = [];
      snap.forEach((doc) => {
        const d = doc.data();
        if (d.referralPoints > 0) list.push({ uid: doc.id, name: cleanReferredName(d.displayName) || (d.email ? d.email.split('@')[0] : 'Trader'), points: d.referralPoints || 0, plan: d.plan || null, photoURL: d.photoURL || null, customPhotoURL: d.customPhotoURL || null, avatarSeed: d.avatarSeed || null });
      });
      return list;
    })
    .catch((err) => {
      console.error('Stryker: failed to load referral leaderboard', err);
      return [];
    });
}

// Called from checkout.js when the person manually typed an invite code at
// checkout (rather than arriving via a signup link). Only applies if this
// student doesn't already have a referrer on record — it won't override an
// existing signup-time referral, and won't pay out twice. Since both the
// "signup" and "conversion" events are effectively happening at once here,
// the referrer receives both point values in a single award.
function applyReferralCodeAtCheckout(purchasingUid, rawCode){
  const code = (rawCode || '').trim();
  if (!code || typeof db === 'undefined' || !db) return Promise.resolve(null);

  return db.collection('students').doc(purchasingUid).get().then((studentDoc) => {
    const data = studentDoc.exists ? studentDoc.data() : {};
    if (data.referredBy || data.referralConversionPaid) return null; // already tracked, don't override or double-pay

    return db.collection('referralCodes').doc(code).get().then((codeDoc) => {
      if (!codeDoc.exists) return null;
      const referrerUid = codeDoc.data().uid;
      if (!referrerUid || referrerUid === purchasingUid) return null;

      // Second line of defence against duplicate rows: even if referredBy is
      // missing for some reason, a referral doc may already exist for this
      // person. Adding another would show one invitee as two.
      return db.collection('referrals')
        .where('referredUid', '==', purchasingUid)
        .limit(1).get()
        .then((existing) => {
          if (!existing.empty) return null;

          return loadReferralConfig().then((config) => {
            if (!config.enabled) return null;
            const points = (config.pointsPerSignup || 0) + (config.pointsPerConversion || 0);
            const name = cleanReferredName(data.displayName) || cleanReferredName(data.email);

            return db.collection('students').doc(purchasingUid)
              .set({ referredBy: referrerUid, referralConversionPaid: true }, { merge: true })
              .then(() => db.collection('referrals').add({
                referrerUid: referrerUid,
                referrerCode: code,
                referredUid: purchasingUid,
                referredName: name,
                referredEmail: data.email || null,
                status: 'converted',
                pointsAwarded: points,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
              }))
              .then(() => awardReferralPoints(referrerUid, points))
              .then(() => notifyReferrer(
                referrerUid,
                'referral_conversion',
                (name || 'Someone') + ' joined on a paid plan using your invite code — +' + points + ' pts.'
              ))
              .then(() => {
                if (typeof checkAndNotifyNewAchievementsFor === 'function') checkAndNotifyNewAchievementsFor(referrerUid, false);
              });
          });
        });
    });
  }).catch((err) => {
    console.error('Stryker: checkout-time referral code failed (non-fatal)', err);
    return null;
  });
}
