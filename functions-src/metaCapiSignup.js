/**
 * Stryker Trading Academy — Meta CAPI hook for sign-up
 *
 * Fires CompleteRegistration server-side, once, the moment a student doc is
 * first created (ensureStudentDoc in assets/progress.js, called right after
 * Firebase Auth account creation) — this is the "sign-up success" moment,
 * confirmed by an actual account existing, not just a client-side claim.
 *
 * A Firestore onCreate trigger, not a call inline in the sign-up flow: it
 * fires from Firestore itself, entirely decoupled from the browser request
 * that created the account, so it is structurally unable to slow down or
 * fail a sign-up — by the time this runs, sign-up has already succeeded.
 *
 * DEPLOY (once ids exist — NOT yet):
 *   firebase deploy --only functions:metaCapiOnSignup
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');

exports.metaCapiOnSignup = onDocumentCreated(
  { document: 'students/{uid}', region: 'us-central1', maxInstances: 5 },
  async (event) => {
    // One-line hook, wrapped so a Meta/network failure here can never
    // surface anywhere near the sign-up flow that already completed.
    try {
      const uid = event.params.uid;
      const data = (event.data && event.data.data()) || {};
      await require('./metaCapi').sendEvent({
        eventName: 'CompleteRegistration',
        eventId: 'signup_' + uid,
        eventSourceUrl: 'https://strykertrading.com/signup',
        email: data.email || null,
        externalId: uid
      });
    } catch (e) { /* never let this affect the student doc it fired from */ }
    return null;
  }
);
