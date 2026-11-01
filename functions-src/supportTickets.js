'use strict';

/**
 * TradeZoro member support tickets.
 *
 * All writes pass through this callable. Firestore clients only read tickets
 * they own (or, for admins, every ticket). Request ids make retries idempotent,
 * and each ticket/message/notification change commits atomically.
 */
const crypto = require('crypto');
const functions = require('firebase-functions');
const admin = require('firebase-admin');

const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const CATEGORIES = ['Account', 'Billing', 'Charts & data', 'Creator Hub', 'Technical issue', 'Other'];
const STATUSES = ['waiting_for_support', 'waiting_for_member', 'closed'];
const CREATE_COOLDOWN_MS = 30000;

function clean(value, max, label) {
  if (typeof value !== 'string') throw new functions.https.HttpsError('invalid-argument', label + ' is required.');
  const text = value.replace(/\r\n/g, '\n').trim();
  if (!text || text.length > max) {
    throw new functions.https.HttpsError('invalid-argument', label + ' must be 1–' + max + ' characters.');
  }
  return text;
}

function requestId(value) {
  const id = clean(value, 80, 'Request ID');
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(id)) {
    throw new functions.https.HttpsError('invalid-argument', 'Request ID is invalid.');
  }
  return id;
}

function cleanTicketId(value) {
  const id = clean(value, 100, 'Ticket');
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(id)) {
    throw new functions.https.HttpsError('invalid-argument', 'Ticket ID is invalid.');
  }
  return id;
}

function stableId(prefix, ...parts) {
  return prefix + '_' + crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

function preview(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

async function caller(uid) {
  const adminDoc = await db.collection('admins').doc(uid).get();
  return { uid, isAdmin: adminDoc.exists };
}

function notificationId(ticketId, eventId, uid) {
  return stableId('support', ticketId, eventId, uid);
}

function notificationData(recipientUid, type, message, link, ticketId) {
  return {
    recipientUid,
    type,
    message: message.slice(0, 500),
    link,
    read: false,
    ticketId,
    createdAt: FV.serverTimestamp()
  };
}

function notifyAdminsInWrite(write, admins, ticketId, eventId, message) {
  admins.forEach((doc) => {
    write.set(
      db.collection('notifications').doc(notificationId(ticketId, eventId, doc.id)),
      notificationData(doc.id, 'support_ticket_admin', message, 'support-admin#ticket-' + ticketId, ticketId),
      { merge: false }
    );
  });
}

function notifyOwnerInWrite(write, ticket, ticketId, eventId, message) {
  write.set(
    db.collection('notifications').doc(notificationId(ticketId, eventId, ticket.ownerUid)),
    notificationData(ticket.ownerUid, 'support_ticket_member', message, 'help#ticket-' + ticketId, ticketId),
    { merge: false }
  );
}

async function createTicket(data, user) {
  const opId = requestId(data.requestId);
  const category = clean(data.category, 40, 'Category');
  if (!CATEGORIES.includes(category)) throw new functions.https.HttpsError('invalid-argument', 'Choose a valid category.');
  const subject = clean(data.subject, 120, 'Subject');
  const body = clean(data.message, 4000, 'Message');
  const ticketId = stableId('ticket', user.uid, opId);
  const ticketRef = db.collection('supportTickets').doc(ticketId);
  const messageRef = ticketRef.collection('messages').doc(stableId('message', ticketId, opId));
  const throttleRef = db.collection('supportTicketThrottle').doc(user.uid);
  const admins = await db.collection('admins').get();
  const ownerName = String((user.token && user.token.name) || '').trim().slice(0, 100);
  const ownerEmail = String((user.token && user.token.email) || '').trim().slice(0, 254);
  const nowMs = Date.now();
  let duplicate = false;

  await db.runTransaction(async (tx) => {
    const [existing, throttle] = await Promise.all([tx.get(ticketRef), tx.get(throttleRef)]);
    if (existing.exists) {
      if (existing.data().ownerUid !== user.uid) {
        throw new functions.https.HttpsError('already-exists', 'Request ID is already in use.');
      }
      duplicate = true;
      return;
    }
    const lastCreatedAtMs = throttle.exists ? Number(throttle.data().lastCreatedAtMs || 0) : 0;
    if (lastCreatedAtMs && nowMs - lastCreatedAtMs < CREATE_COOLDOWN_MS) {
      throw new functions.https.HttpsError('resource-exhausted', 'Please wait a moment before creating another ticket.');
    }
    tx.set(throttleRef, { lastCreatedAtMs: nowMs, updatedAt: FV.serverTimestamp() }, { merge: true });
    tx.set(ticketRef, {
      ownerUid: user.uid,
      ownerName,
      ownerEmail,
      category,
      subject,
      status: 'waiting_for_support',
      createdAt: FV.serverTimestamp(),
      updatedAt: FV.serverTimestamp(),
      lastMessageAt: FV.serverTimestamp(),
      lastMessagePreview: preview(body),
      lastMessageRole: 'member',
      adminAttention: true,
      memberUnread: false,
      messageCount: 1
    });
    tx.set(messageRef, {
      senderUid: user.uid,
      senderRole: 'member',
      body,
      createdAt: FV.serverTimestamp()
    });
    notifyAdminsInWrite(tx, admins, ticketId, 'created-' + opId, 'New member ticket: ' + subject);
  });
  return { ticketId, duplicate };
}

async function replyTicket(data, actor) {
  const opId = requestId(data.requestId);
  const ticketId = cleanTicketId(data.ticketId);
  const body = clean(data.message, 4000, 'Message');
  const ticketRef = db.collection('supportTickets').doc(ticketId);
  const messageRef = ticketRef.collection('messages').doc(stableId('message', ticketId, actor.uid, opId));
  const admins = actor.isAdmin ? null : await db.collection('admins').get();
  let role;
  let duplicate = false;

  await db.runTransaction(async (tx) => {
    const [snap, existingMessage] = await Promise.all([tx.get(ticketRef), tx.get(messageRef)]);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Ticket not found.');
    const ticket = snap.data();
    role = actor.isAdmin ? 'admin' : 'member';
    if (!actor.isAdmin && ticket.ownerUid !== actor.uid) {
      throw new functions.https.HttpsError('permission-denied', 'You cannot reply to this ticket.');
    }
    if (existingMessage.exists) {
      const prior = existingMessage.data();
      if (prior.senderUid !== actor.uid || prior.body !== body) {
        throw new functions.https.HttpsError('already-exists', 'Request ID is already in use.');
      }
      duplicate = true;
      return;
    }
    const nextStatus = role === 'admin' ? 'waiting_for_member' : 'waiting_for_support';
    tx.set(messageRef, {
      senderUid: actor.uid,
      senderRole: role,
      body,
      createdAt: FV.serverTimestamp()
    });
    tx.update(ticketRef, {
      status: nextStatus,
      updatedAt: FV.serverTimestamp(),
      lastMessageAt: FV.serverTimestamp(),
      lastMessagePreview: preview(body),
      lastMessageRole: role,
      adminAttention: role === 'member',
      memberUnread: role === 'admin',
      messageCount: FV.increment(1)
    });
    if (role === 'admin') {
      notifyOwnerInWrite(tx, ticket, ticketId, 'message-' + opId, 'Support replied: ' + ticket.subject);
    } else {
      notifyAdminsInWrite(tx, admins, ticketId, 'message-' + opId, 'Member replied: ' + ticket.subject);
    }
  });
  return { ticketId, messageId: messageRef.id, duplicate };
}

async function setStatus(data, actor) {
  const opId = requestId(data.requestId);
  const ticketId = cleanTicketId(data.ticketId);
  const status = clean(data.status, 40, 'Status');
  if (!STATUSES.includes(status)) throw new functions.https.HttpsError('invalid-argument', 'Invalid ticket status.');
  const ref = db.collection('supportTickets').doc(ticketId);
  const admins = actor.isAdmin ? null : await db.collection('admins').get();
  let changed = false;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Ticket not found.');
    const ticket = snap.data();
    if (!actor.isAdmin && ticket.ownerUid !== actor.uid) {
      throw new functions.https.HttpsError('permission-denied', 'You cannot change this ticket.');
    }
    if (!actor.isAdmin && !(
      status === 'closed' || (ticket.status === 'closed' && status === 'waiting_for_support')
    )) throw new functions.https.HttpsError('permission-denied', 'Members can only close or reopen their own ticket.');
    changed = ticket.status !== status;
    if (!changed) return;
    const patch = { status, updatedAt: FV.serverTimestamp() };
    if (actor.isAdmin) {
      patch.memberUnread = true;
      if (status === 'closed') patch.adminAttention = false;
    } else if (status === 'waiting_for_support') {
      patch.adminAttention = true;
    } else if (status === 'closed') {
      patch.adminAttention = false;
    }
    tx.update(ref, patch);
    if (actor.isAdmin) {
      const labels = { waiting_for_support: 'Waiting for support', waiting_for_member: 'Waiting for you', closed: 'Closed' };
      notifyOwnerInWrite(tx, ticket, ticketId, 'status-' + opId, 'Ticket status: ' + labels[status] + ' — ' + ticket.subject);
    } else if (status === 'waiting_for_support') {
      notifyAdminsInWrite(tx, admins, ticketId, 'reopened-' + opId, 'Member reopened: ' + ticket.subject);
    }
  });
  return { ticketId, status, changed };
}

async function markRead(data, actor) {
  const ticketId = cleanTicketId(data.ticketId);
  if (!Number.isSafeInteger(data.expectedUpdatedAt) || data.expectedUpdatedAt < 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Expected update time is required.');
  }
  const ref = db.collection('supportTickets').doc(ticketId);
  let changed = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Ticket not found.');
    const ticket = snap.data();
    if (!actor.isAdmin && ticket.ownerUid !== actor.uid) {
      throw new functions.https.HttpsError('permission-denied', 'You cannot open this ticket.');
    }
    const updatedAt = ticket.updatedAt && typeof ticket.updatedAt.toMillis === 'function' ? ticket.updatedAt.toMillis() : 0;
    if (updatedAt !== data.expectedUpdatedAt) return;
    const field = actor.isAdmin ? 'adminAttention' : 'memberUnread';
    if (!ticket[field]) return;
    tx.update(ref, { [field]: false });
    changed = true;
  });
  return { ticketId, changed };
}

exports.supportTicketAction = functions.region('us-central1').runWith({ maxInstances: 10, timeoutSeconds: 60, memory: '256MB' }).https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  const action = data && data.action;
  const actor = await caller(context.auth.uid);
  if (action === 'create') return createTicket(data, context.auth);
  if (action === 'reply') return replyTicket(data, actor);
  if (action === 'status') return setStatus(data, actor);
  if (action === 'markRead') return markRead(data, actor);
  throw new functions.https.HttpsError('invalid-argument', 'Unknown support action.');
});

exports._test = { CATEGORIES, STATUSES, clean, requestId, cleanTicketId, stableId, preview, notificationId };
