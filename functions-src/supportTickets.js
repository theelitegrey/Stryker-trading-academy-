'use strict';

/**
 * TradeZoro member support tickets.
 *
 * All writes pass through this callable. Firestore clients only read tickets
 * they own (or, for admins, every ticket). This keeps sender roles, ownership,
 * attention flags and notification recipients server-trusted.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const CATEGORIES = ['Account', 'Billing', 'Charts & data', 'Creator Hub', 'Technical issue', 'Other'];
const STATUSES = ['waiting_for_support', 'waiting_for_member', 'closed'];

function clean(value, max, label) {
  if (typeof value !== 'string') throw new functions.https.HttpsError('invalid-argument', label + ' is required.');
  const text = value.replace(/\r\n/g, '\n').trim();
  if (!text || text.length > max) {
    throw new functions.https.HttpsError('invalid-argument', label + ' must be 1–' + max + ' characters.');
  }
  return text;
}

function preview(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

async function caller(uid) {
  const adminDoc = await db.collection('admins').doc(uid).get();
  return { uid, isAdmin: adminDoc.exists };
}

function notificationId(ticketId, eventId, uid) {
  return ['support', ticketId, eventId, uid].join('_').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 1500);
}

async function notifyAdmins(ticketId, eventId, message) {
  const admins = await db.collection('admins').get();
  if (admins.empty) return;
  const batch = db.batch();
  admins.forEach((doc) => {
    batch.set(db.collection('notifications').doc(notificationId(ticketId, eventId, doc.id)), {
      recipientUid: doc.id,
      type: 'support_ticket_admin',
      message: message.slice(0, 500),
      link: 'support-admin#ticket-' + ticketId,
      read: false,
      ticketId,
      createdAt: FV.serverTimestamp()
    }, { merge: false });
  });
  await batch.commit();
}

async function notifyOwner(ticket, ticketId, eventId, message) {
  await db.collection('notifications').doc(notificationId(ticketId, eventId, ticket.ownerUid)).set({
    recipientUid: ticket.ownerUid,
    type: 'support_ticket_member',
    message: message.slice(0, 500),
    link: 'help#ticket-' + ticketId,
    read: false,
    ticketId,
    createdAt: FV.serverTimestamp()
  }, { merge: false });
}

async function createTicket(data, user) {
  const category = clean(data.category, 40, 'Category');
  if (!CATEGORIES.includes(category)) throw new functions.https.HttpsError('invalid-argument', 'Choose a valid category.');
  const subject = clean(data.subject, 120, 'Subject');
  const body = clean(data.message, 4000, 'Message');
  const ticketRef = db.collection('supportTickets').doc();
  const messageRef = ticketRef.collection('messages').doc();
  const ownerName = String((user.token && user.token.name) || '').trim().slice(0, 100);
  const ownerEmail = String((user.token && user.token.email) || '').trim().slice(0, 254);
  const batch = db.batch();
  batch.set(ticketRef, {
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
  batch.set(messageRef, {
    senderUid: user.uid,
    senderRole: 'member',
    body,
    createdAt: FV.serverTimestamp()
  });
  await batch.commit();
  await notifyAdmins(ticketRef.id, 'created', 'New member ticket: ' + subject);
  return { ticketId: ticketRef.id };
}

async function replyTicket(data, actor) {
  const ticketId = clean(data.ticketId, 200, 'Ticket');
  const body = clean(data.message, 4000, 'Message');
  const ticketRef = db.collection('supportTickets').doc(ticketId);
  const messageRef = ticketRef.collection('messages').doc();
  let ticket;
  let role;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ticketRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Ticket not found.');
    ticket = snap.data();
    role = actor.isAdmin ? 'admin' : 'member';
    if (!actor.isAdmin && ticket.ownerUid !== actor.uid) {
      throw new functions.https.HttpsError('permission-denied', 'You cannot reply to this ticket.');
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
  });
  if (role === 'admin') {
    await notifyOwner(ticket, ticketId, 'message-' + messageRef.id, 'Support replied: ' + ticket.subject);
  } else {
    await notifyAdmins(ticketId, 'message-' + messageRef.id, 'Member replied: ' + ticket.subject);
  }
  return { ticketId, messageId: messageRef.id };
}

async function setStatus(data, actor) {
  const ticketId = clean(data.ticketId, 200, 'Ticket');
  const status = clean(data.status, 40, 'Status');
  if (!STATUSES.includes(status)) throw new functions.https.HttpsError('invalid-argument', 'Invalid ticket status.');
  const ref = db.collection('supportTickets').doc(ticketId);
  let ticket;
  let changed = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Ticket not found.');
    ticket = snap.data();
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
  });
  if (changed && actor.isAdmin) {
    const labels = { waiting_for_support: 'Waiting for support', waiting_for_member: 'Waiting for you', closed: 'Closed' };
    const priorUpdate = ticket.updatedAt && typeof ticket.updatedAt.toMillis === 'function' ? ticket.updatedAt.toMillis() : 0;
    await notifyOwner(ticket, ticketId, 'status-' + status + '-' + priorUpdate, 'Ticket status: ' + labels[status] + ' — ' + ticket.subject);
  }
  return { ticketId, status, changed };
}

async function markRead(data, actor) {
  const ticketId = clean(data.ticketId, 200, 'Ticket');
  const ref = db.collection('supportTickets').doc(ticketId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Ticket not found.');
  const ticket = snap.data();
  if (!actor.isAdmin && ticket.ownerUid !== actor.uid) {
    throw new functions.https.HttpsError('permission-denied', 'You cannot open this ticket.');
  }
  await ref.update(actor.isAdmin ? { adminAttention: false } : { memberUnread: false });
  return { ticketId };
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

exports._test = { CATEGORIES, STATUSES, clean, preview, notificationId };
