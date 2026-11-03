// TradeZoro Partner programme: server side (partners/{uid}, students/{uid} grant, partnerLog).
//
// partnerAdmin  (callable, ADMIN ONLY)  { uid, action: approve|reject|renew|pause|end, note? }
// partnerLeave  (callable, the member)  {}  the member leaves; never grants anything
//
// The client can never grant Pro: the rules keep status/approvedAt/reviewNote/proUntil and the students
// plan fields (plan, planId, paidThroughMillis, subscriptionStatus, partner, planSource) server-only.
// Admin status is read from admins/{uid} in Firestore, never from the request (same as accountAdmin.js).

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const PRO_PLAN_ID = 'Sj1bjdpwvYJUVErjNMAb';
const PRO_PLAN_NAME = 'Pro';
// KEEP IN STEP with PARTNER_TERMS in assets/partner-terms.js (tools/tests/partner-grant.test.js checks it).
const GRANT_DAYS = 31;
const REAPPLY_DAYS = 30;
const DAY = 864e5;
// Approve-again / renew may only top up when the paid-through date is this close; stops stacked months.
const TOPUP_WINDOW_DAYS = 7;
const ACTIONS = ['approve', 'reject', 'renew', 'pause', 'end'];

// Does this member already have Pro-or-better access that is NOT a partner grant?
// If so a partner approval must leave their billing and dates alone.
function hasOwnAccess(s, nowMs) {
  s = s || {};
  // Our own earlier grant is never "their own access": extend it (max(now, current) + days never shortens).
  // shortcut: a partner who later starts paying keeps planSource 'partner' until billing code clears it; harmless (never shortens).
  if (s.planSource === 'partner') return false;
  if (!s.plan || s.plan === 'Starter') return false;
  if (s.foundingMember) return true;
  const pt = Number(s.paidThroughMillis) || 0;
  if (!pt) return true;                      // no end date = permanent plan (lifetime / free plan)
  return pt > nowMs;                         // lapsed payers (date in the past) can be granted
}

// Pure: the students/{uid} patch for an approve / renew. Never shortens an existing paidThroughMillis.
function grantPatch(s, nowMs, days) {
  s = s || {};
  if (hasOwnAccess(s, nowMs)) return { kind: 'keep', patch: { partner: true } };
  const cur = Number(s.paidThroughMillis) || 0;
  const paidThroughMillis = Math.max(nowMs, cur) + (days || GRANT_DAYS) * DAY;
  return {
    kind: 'grant',
    patch: {
      plan: PRO_PLAN_NAME, planId: PRO_PLAN_ID, subscriptionStatus: 'active',
      paidThroughMillis, partner: true, planSource: 'partner'
    }
  };
}

function bad(code, msg) { return new functions.https.HttpsError(code, msg); }

const MESSAGES = {
  approve: 'You are now a TradeZoro Partner. Pro is free for you while you stay a partner.',
  renew: 'Your Partner month was checked and Pro is renewed.',
  pause: 'Your Partner status is paused. Pro stays on until the end of the paid month. Open the Partner page to see what to fix.',
  reject: 'Your Partner application was not approved this time.',
  end: 'Your Partner programme ended. Pro stays on until the end of the paid month.'
};

function notify(uid, message) {
  return db.collection('notifications').add({
    recipientUid: uid, type: 'partner', message: String(message).slice(0, 240), link: 'partner.html',
    read: false, createdAt: admin.firestore.FieldValue.serverTimestamp()
  }).catch((e) => console.error('partner notify failed', uid, e.message));
}

async function assertAdmin(context) {
  if (!context.auth || !context.auth.uid) throw bad('unauthenticated', 'You must be signed in.');
  const a = await db.collection('admins').doc(context.auth.uid).get();
  if (!a.exists) throw bad('permission-denied', 'Only admins can manage partners.');
  return context.auth.uid;
}

exports.partnerAdmin = functions
  .region('us-central1')
  .runWith({ maxInstances: 2, timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const adminUid = await assertAdmin(context);
    const uid = data && typeof data.uid === 'string' ? data.uid.trim() : '';
    const action = data && data.action;
    const note = data && typeof data.note === 'string' ? data.note.trim().slice(0, 400) : '';
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) throw bad('invalid-argument', 'No member id.');
    if (!ACTIONS.includes(action)) throw bad('invalid-argument', 'Unknown action.');
    if (action === 'reject' && !note) throw bad('invalid-argument', 'Give a reason for the rejection.');

    const pRef = db.collection('partners').doc(uid);
    const sRef = db.collection('students').doc(uid);
    const now = Date.now();
    const FV = admin.firestore.FieldValue;

    const out = await db.runTransaction(async (tx) => {
      const [pSnap, sSnap] = await Promise.all([tx.get(pRef), tx.get(sRef)]);
      if (!pSnap.exists) throw bad('not-found', 'No partner application for this member.');
      if (!sSnap.exists) throw bad('not-found', 'No member record.');
      const p = pSnap.data() || {}, s = sSnap.data() || {};
      const st = p.status || 'pending';
      let pPatch, sPatch = null, kind = null;

      if (action === 'approve') {
        if (st !== 'pending' && st !== 'paused') throw bad('failed-precondition', 'Only pending or paused partners can be approved.');
        const g = grantPatch(s, now);
        if (g.kind === 'grant' && st !== 'pending' && (Number(s.paidThroughMillis) || 0) - now > TOPUP_WINDOW_DAYS * DAY) throw bad('failed-precondition', 'Pro already runs for more than ' + TOPUP_WINDOW_DAYS + ' days. Do this closer to the date.');
        kind = g.kind; sPatch = g.patch;
        const proUntil = g.kind === 'grant' ? g.patch.paidThroughMillis : (Number(s.paidThroughMillis) || 0);
        pPatch = { status: 'active', approvedAt: p.approvedAt || FV.serverTimestamp(), approvedAtMillis: p.approvedAtMillis || now, reviewNote: note || FV.delete(), proUntil, grantKind: g.kind, updatedAt: FV.serverTimestamp() };
      } else if (action === 'renew') {
        if (st !== 'active') throw bad('failed-precondition', 'Only active partners can be renewed.');
        const cur = Number(p.proUntil) || 0;
        const g = grantPatch(s, now);
        // Source of truth is the member's paidThroughMillis, not partners.proUntil: a second click must not stack months.
        if (g.kind === 'grant' && (Number(s.paidThroughMillis) || 0) - now > TOPUP_WINDOW_DAYS * DAY) throw bad('failed-precondition', 'Pro already runs for more than ' + TOPUP_WINDOW_DAYS + ' days. Renew closer to the date.');
        kind = g.kind; sPatch = g.patch;
        const proUntil = g.kind === 'grant' ? g.patch.paidThroughMillis : (Number(s.paidThroughMillis) || cur);
        pPatch = { proUntil, lastRenewedAt: FV.serverTimestamp(), grantKind: g.kind, updatedAt: FV.serverTimestamp() };
        if (note) pPatch.reviewNote = note;
      } else if (action === 'reject') {
        if (st !== 'pending') throw bad('failed-precondition', 'Only pending applications can be rejected.');
        pPatch = { status: 'rejected', reviewNote: note, reapplyAfterMillis: now + REAPPLY_DAYS * DAY, updatedAt: FV.serverTimestamp() };
      } else if (action === 'pause') {
        if (st !== 'active') throw bad('failed-precondition', 'Only active partners can be paused.');
        sPatch = { partner: false };   // no new grant; access runs out at paidThroughMillis
        pPatch = { status: 'paused', pausedAt: FV.serverTimestamp(), reviewNote: note || FV.delete(), updatedAt: FV.serverTimestamp() };
      } else { // end
        if (!['active', 'paused', 'pending'].includes(st)) throw bad('failed-precondition', 'This partnership is already closed.');
        sPatch = { partner: false };
        pPatch = { status: 'ended', endedAt: FV.serverTimestamp(), reviewNote: note || FV.delete(), reapplyAfterMillis: now + REAPPLY_DAYS * DAY, updatedAt: FV.serverTimestamp() };
      }

      tx.set(pRef, pPatch, { merge: true });
      if (sPatch) tx.set(sRef, sPatch, { merge: true });
      tx.set(db.collection('partnerLog').doc(), {
        uid, action, by: adminUid, note, fromStatus: st, kind,
        paidThroughBefore: Number(s.paidThroughMillis) || 0,
        paidThroughAfter: sPatch && sPatch.paidThroughMillis ? sPatch.paidThroughMillis : (Number(s.paidThroughMillis) || 0),
        at: FV.serverTimestamp()
      });
      return { status: pPatch.status || st, kind, proUntil: pPatch.proUntil || null };
    });

    const msg = action === 'reject' && note ? MESSAGES.reject + ' Reason: ' + note : MESSAGES[action];
    await notify(uid, msg);
    return out;
  });

// The member leaves (or withdraws a pending application). Closes the partnership; grants nothing.
exports.partnerLeave = functions
  .region('us-central1')
  .runWith({ maxInstances: 2, timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) throw bad('unauthenticated', 'You must be signed in.');
    const uid = context.auth.uid;
    const pRef = db.collection('partners').doc(uid);
    const FV = admin.firestore.FieldValue;
    const now = Date.now();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(pRef);
      if (!snap.exists) throw bad('not-found', 'No partnership to leave.');
      const st = snap.data().status || 'pending';
      if (!['pending', 'active', 'paused'].includes(st)) throw bad('failed-precondition', 'Already closed.');
      tx.set(pRef, { status: 'left', endedAt: FV.serverTimestamp(), reapplyAfterMillis: now + REAPPLY_DAYS * DAY, updatedAt: FV.serverTimestamp() }, { merge: true });
      tx.set(db.collection('students').doc(uid), { partner: false }, { merge: true });
      tx.set(db.collection('partnerLog').doc(), { uid, action: 'leave', by: uid, note: '', fromStatus: st, kind: null, at: FV.serverTimestamp() });
    });
    return { status: 'left' };
  });

exports._test = { grantPatch, hasOwnAccess, GRANT_DAYS, PRO_PLAN_ID };
