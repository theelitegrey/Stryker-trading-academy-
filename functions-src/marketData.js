/**
 * Market Data Agreement (Owner order 2026-11-01). One shared version constant and one check.
 *   acceptMarketDataAgreement({ name, answers }) -> writes students/{uid}.marketDataAgreement (Admin SDK;
 *   the Firestore rules keep it function/admin-only). Any "yes" in answers = professional = refused.
 *   agreementOk(studentData) is what stripeCreateCheckout and razorpaySubscribe call for add-on plans.
 * DEPLOY: firebase deploy --only functions:acceptMarketDataAgreement,functions:stripeCreateCheckout,functions:stripeWebhook,functions:razorpaySubscribe,functions:razorpaySubsVerify,functions:razorpayWebhook,functions:razorpaySubsCancel (name them all).
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

const AGREEMENT_VERSION = 'v1';   // bump when the terms change; assets/market-data-agreement.js reads it from the server reply
const QUESTIONS = ['regulated', 'business', 'advisor', 'redistribute'];

function agreementOk(student) {
  const a = student && student.marketDataAgreement;
  return !!a && a.version === AGREEMENT_VERSION && a.nonProfessional === true;
}

function requireAgreement(student) {
  if (!agreementOk(student)) {
    throw new functions.https.HttpsError('failed-precondition', 'Accept the Market Data Terms first');
  }
}

exports.acceptMarketDataAgreement = functions
  .runWith({ maxInstances: 20, timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
    if (((context.auth.token || {}).firebase || {}).sign_in_provider === 'anonymous') throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');   // only a real member account may sign
    const name = String((data && data.name) || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 100) throw new functions.https.HttpsError('invalid-argument', 'Type your full name to sign.');
    const ans = data && data.answers;
    if (!ans || typeof ans !== 'object' || QUESTIONS.some((q) => typeof ans[q] !== 'boolean')) {
      throw new functions.https.HttpsError('invalid-argument', 'Answer every question with Yes or No.');
    }
    if (QUESTIONS.some((q) => ans[q] === true)) {
      throw new functions.https.HttpsError('failed-precondition', 'Professional data is not sold online. Contact support.');
    }
    if (!(data && data.confirmed === true)) throw new functions.https.HttpsError('invalid-argument', 'Tick the box to agree.');
    const answers = {}; QUESTIONS.forEach((q) => { answers[q] = false; });
    const ua = String((context.rawRequest && context.rawRequest.headers && context.rawRequest.headers['user-agent']) || '').slice(0, 200);
    await admin.firestore().collection('students').doc(context.auth.uid).set({
      marketDataAgreement: {
        version: AGREEMENT_VERSION, acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
        name, nonProfessional: true, answers, userAgent: ua
      }
    }, { merge: true });
    return { ok: true, version: AGREEMENT_VERSION };
  });

// Data add-ons (Owner 2026-11-04): plans/LiveData = L1 Data ($7) -> students.liveData; plans/LiveDataL2 = L2 Data ($20, includes L1)
// -> students.liveDataL2. Same shape, same rules, both need the agreement. Any other add-on id falls back to liveData (the original).
function addonField(planId) { return planId === 'LiveDataL2' ? 'liveDataL2' : 'liveData'; }
function addonLabel(planId) { return planId === 'LiveDataL2' ? 'Data feed L2' : 'Data feed L1'; }

exports.__marketData = { AGREEMENT_VERSION, QUESTIONS, agreementOk, requireAgreement, addonField, addonLabel };
