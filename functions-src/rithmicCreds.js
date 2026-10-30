// TradeZoro — Rithmic saved login + journal auto sync (Cloud Functions). SHIPPED OFF.
//
// Switches (both default off):
//   settings/commerce.rithmicSavedLogin  must be true or every callable here refuses.
//   RITHMIC_CRED_KEY (functions env / Secret Manager, base64 of 32 random bytes) must exist or save/ticket/sync refuse.
// The Chief of Staff creates the key and flips the switch after Rithmic approves; this file never creates either.
//
// What is stored: rithmicCreds/{uid} = { system, gateway, username, encPassword, iv, tag, keyVersion, autoSync,
//   syncTime, createdAt, lastUsedAt, lastSync* }. The password is AES-256-GCM encrypted with the uid as
//   additional authenticated data (a ciphertext copied to another uid fails to decrypt). Firestore rules
//   deny all client access (functions-src/firestore.rules). The password is never logged and never returned,
//   except by rithmicSessionTicket to the same signed-in member (see the design note in the report).
//
// Key rotation: RITHMIC_CRED_KEY is the current key, RITHMIC_CRED_KEY_VERSION its number (default 1). Older
// keys stay available as RITHMIC_CRED_KEY_V<n> so existing rows still decrypt; rithmicCredRotate() (admin)
// re-encrypts every row under the current key.
//
// Auto sync runs in Cloud Functions (not the Worker cron): it needs Firestore admin access and a WebSocket that
// lives for ~10-30 s; Node 22 has a built-in WebSocket client. One scheduled job, ~96 runs a day that are no-ops
// unless a member is due; cost is the scheduler job (about $0.10 a month) plus seconds of function time per sync.
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const ALGO = 'aes-256-gcm';
const MAX = { username: 120, password: 200, system: 80 };

// ---- crypto (exported for the unit tests) --------------------------------------------------------------
function currentVersion(env = process.env) { const v = parseInt(env.RITHMIC_CRED_KEY_VERSION || '1', 10); return v > 0 ? v : 1; }
function keyFor(version, env = process.env) {
  const cur = currentVersion(env);
  const raw = version === cur ? env.RITHMIC_CRED_KEY : env['RITHMIC_CRED_KEY_V' + version];
  if (!raw) return null;
  const k = Buffer.from(String(raw).trim(), 'base64');
  return k.length === 32 ? k : null;
}
function haveKey(env = process.env) { return !!keyFor(currentVersion(env), env); }
function encryptPassword(uid, password, env = process.env) {
  const version = currentVersion(env), key = keyFor(version, env);
  if (!key) throw new functions.https.HttpsError('failed-precondition', 'Saved Rithmic login is not set up on the server yet.');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGO, key, iv);
  c.setAAD(Buffer.from('rithmic:' + uid));
  const data = Buffer.concat([c.update(String(password), 'utf8'), c.final()]);
  return { encPassword: data.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), keyVersion: version };
}
function decryptPassword(uid, row, env = process.env) {
  const key = keyFor(row.keyVersion, env);
  if (!key) throw new functions.https.HttpsError('failed-precondition', 'The key for this saved login is not available. Save the login again.');
  const d = crypto.createDecipheriv(ALGO, key, Buffer.from(row.iv, 'base64'));
  d.setAAD(Buffer.from('rithmic:' + uid));
  d.setAuthTag(Buffer.from(row.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(row.encPassword, 'base64')), d.final()]).toString('utf8');
}

// ---- guards ----------------------------------------------------------------------------------------------
function uidOf(context) {
  if (!context.auth || !context.auth.uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  return context.auth.uid;
}
async function requireSwitch() {
  const s = await db.collection('settings').doc('commerce').get();
  if (!(s.exists && s.data().rithmicSavedLogin === true)) throw new functions.https.HttpsError('failed-precondition', 'Saved Rithmic login is not available yet.');
}
function str(v, max, name) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new functions.https.HttpsError('invalid-argument', 'Check the ' + name + '.');
  return v;
}
function gatewayOk(g) { try { const u = new URL(g); return u.protocol === 'wss:' && /(^|\.)rithmic\.com$/.test(u.hostname); } catch (e) { return false; } }
function timeOk(t) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
// Audit trail: what happened and to whose row. Never the username, never the password.
function audit(uid, action, extra) {
  return db.collection('rithmicCredAudit').add(Object.assign({ uid, action, at: FV.serverTimestamp() }, extra || {})).catch(() => {});
}
const opts = { maxInstances: 3, timeoutSeconds: 30, memory: '256MB' };
const call = (fn) => functions.region('us-central1').runWith(opts).https.onCall(fn);

// ---- callables --------------------------------------------------------------------------------------------
exports.rithmicCredSave = call(async (data, context) => {
  const uid = uidOf(context); await requireSwitch();
  if (!haveKey()) throw new functions.https.HttpsError('failed-precondition', 'Saved Rithmic login is not set up on the server yet.');
  const system = str(data && data.system, MAX.system, 'system'), username = str(data && data.username, MAX.username, 'username'), password = str(data && data.password, MAX.password, 'password');
  const gateway = data && data.gateway;
  if (!gatewayOk(gateway)) throw new functions.https.HttpsError('invalid-argument', 'Unknown Rithmic server.');
  const prev = await db.collection('rithmicCreds').doc(uid).get();
  const enc = encryptPassword(uid, password);
  await db.collection('rithmicCreds').doc(uid).set(Object.assign({
    system, gateway, username, autoSync: prev.exists ? prev.data().autoSync === true : false,
    syncTime: prev.exists && prev.data().syncTime ? prev.data().syncTime : '17:15',
    createdAt: prev.exists ? prev.data().createdAt : FV.serverTimestamp(), lastUsedAt: FV.serverTimestamp()
  }, enc));
  await audit(uid, prev.exists ? 'update' : 'save', { system, keyVersion: enc.keyVersion });
  return { ok: true };
});

// Metadata only. The password, iv and tag never leave the server through this.
exports.rithmicCredStatus = call(async (data, context) => {
  const uid = uidOf(context);
  const s = await db.collection('settings').doc('commerce').get();
  const on = s.exists && s.data().rithmicSavedLogin === true;
  if (!on || !haveKey()) return { available: false, saved: false };
  const d = await db.collection('rithmicCreds').doc(uid).get();
  if (!d.exists) return { available: true, saved: false };
  const r = d.data(), ms = (t) => (t && t.toMillis ? t.toMillis() : null);
  return { available: true, saved: true, system: r.system, username: r.username, autoSync: r.autoSync === true, syncTime: r.syncTime || '17:15',
    createdAt: ms(r.createdAt), lastUsedAt: ms(r.lastUsedAt), lastSyncAt: ms(r.lastSyncAt), lastSyncStatus: r.lastSyncStatus || null, lastSyncDetail: r.lastSyncDetail || null };
});

exports.rithmicCredDelete = call(async (data, context) => {
  const uid = uidOf(context);
  // Deleting is always allowed, even with the switch off: a member can always remove what we hold.
  const ref = db.collection('rithmicCreds').doc(uid);
  const d = await ref.get();
  if (d.exists) { await ref.delete(); await audit(uid, 'delete'); }
  return { ok: true, removed: d.exists };
});

exports.rithmicCredSettings = call(async (data, context) => {
  const uid = uidOf(context); await requireSwitch();
  const ref = db.collection('rithmicCreds').doc(uid), d = await ref.get();
  if (!d.exists) throw new functions.https.HttpsError('not-found', 'No saved Rithmic login.');
  const patch = {};
  if (data && typeof data.autoSync === 'boolean') patch.autoSync = data.autoSync;
  if (data && data.syncTime != null) { if (!timeOk(data.syncTime)) throw new functions.https.HttpsError('invalid-argument', 'Time must be HH:MM (New York time).'); patch.syncTime = data.syncTime; }
  if (!Object.keys(patch).length) return { ok: true };
  await ref.set(patch, { merge: true });
  await audit(uid, 'settings', patch);
  return { ok: true };
});

// Charts auto-connect. Returns the credential ONLY to the signed-in owner of the row, over the authenticated
// callable (TLS), for the browser's Rithmic client to log in with. Safer alternative considered: log in on the
// server and stream data to the browser; rejected for charts because it needs a long-lived server socket per
// viewer and a data-feed relay (Rithmic's market-data licence and our cost), so the ticket is the smaller risk.
// Mitigations: same-uid only, rate limit of one ticket per 10 s, audit entry, App Check not required but the
// response is marked not cacheable by the client (it is never stored), and members can remove the login any time.
exports.rithmicSessionTicket = call(async (data, context) => {
  const uid = uidOf(context); await requireSwitch();
  if (!haveKey()) throw new functions.https.HttpsError('failed-precondition', 'Saved Rithmic login is not set up on the server yet.');
  const ref = db.collection('rithmicCreds').doc(uid), d = await ref.get();
  if (!d.exists) throw new functions.https.HttpsError('not-found', 'No saved Rithmic login.');
  const r = d.data(), last = r.lastTicketAt && r.lastTicketAt.toMillis ? r.lastTicketAt.toMillis() : 0;
  if (Date.now() - last < 10000) throw new functions.https.HttpsError('resource-exhausted', 'Try again in a few seconds.');
  const password = decryptPassword(uid, r);
  await ref.set({ lastUsedAt: FV.serverTimestamp(), lastTicketAt: FV.serverTimestamp() }, { merge: true });
  await audit(uid, 'ticket');
  return { system: r.system, gateway: r.gateway, username: r.username, password, expiresAt: Date.now() + 60000 };
});

// Admin: move every row to the current key (after RITHMIC_CRED_KEY / _VERSION changed, with the old key kept as _V<n>).
exports.rithmicCredRotate = call(async (data, context) => {
  const uid = uidOf(context);
  if (!(await db.collection('admins').doc(uid).get()).exists) throw new functions.https.HttpsError('permission-denied', 'Admins only.');
  if (!haveKey()) throw new functions.https.HttpsError('failed-precondition', 'Current key missing.');
  const cur = currentVersion(), snap = await db.collection('rithmicCreds').get();
  let moved = 0, failed = 0;
  for (const doc of snap.docs) {
    const r = doc.data();
    if (r.keyVersion === cur) continue;
    try { await doc.ref.set(encryptPassword(doc.id, decryptPassword(doc.id, r)), { merge: true }); moved++; } catch (e) { failed++; }
  }
  await audit(uid, 'rotate', { moved, failed, keyVersion: cur });
  return { moved, failed };
});

// ---- scheduled auto sync ------------------------------------------------------------------------------------
const ET = 'America/New_York';
function etParts(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: p.year + '-' + p.month + '-' + p.day, hm: p.hour + ':' + p.minute, wd: p.weekday };
}
// A row is due when its chosen ET time has passed today (within the last 90 min), it has not run today, and it is a weekday.
function isDue(row, now) {
  const e = etParts(now);
  if (e.wd === 'Sat' || e.wd === 'Sun') return false;
  if (row.lastSyncDay === e.date) return false;
  const [h, m] = (row.syncTime || '17:15').split(':').map(Number), [ch, cm] = e.hm.split(':').map(Number);
  const diff = (ch * 60 + cm) - (h * 60 + m);
  return diff >= 0 && diff < 90;
}

async function notify(uid, message) {
  await db.collection('notifications').add({ recipientUid: uid, type: 'rithmic_sync', message, link: 'trade-journal.html', read: false, createdAt: FV.serverTimestamp() }).catch(() => {});
}

async function freeRoom(uid) {
  // Free plan = a plan with rank < 1 (same rule as assets/plan-limits.js). Admins and paid plans: unlimited.
  const [adm, stu] = await Promise.all([db.collection('admins').doc(uid).get(), db.collection('students').doc(uid).get()]);
  if (adm.exists) return null;
  const plan = stu.exists ? stu.data().plan : null;
  if (!plan) return null;
  const pl = await db.collection('plans').get();
  const hit = pl.docs.find((x) => x.id === String(plan).toLowerCase() || (x.data().name || '').toLowerCase() === String(plan).toLowerCase());
  if (!hit || !(hit.data().rank < 1)) return null;
  const mk = etParts(Date.now()).date.slice(0, 7);
  const jr = await db.collection('students').doc(uid).collection('journal').where('date', '>=', mk + '-01').get();
  return Math.max(0, 20 - jr.docs.filter((x) => x.id[0] !== '_').length);
}

// One member. `deps` lets the tests inject a fake session and a fake Firestore-free writer.
async function syncOne(uid, row, deps) {
  const mods = deps || await loadModules();
  const password = decryptPassword(uid, row);
  const h = new mods.RithmicOrderHistory({ gateway: row.gateway, appName: mods.APP_NAME, appVersion: mods.APP_VERSION, WebSocketImpl: globalThis.WebSocket });
  let notes = [], accounts = [];
  try {
    await h.connect({ user: row.username, password, systemName: row.system });
    accounts = await h.accounts();
    const today = mods.tradeDateCT(Date.now());
    for (const a of accounts) notes.push(...await h.dayNotes(a, today, { today: true }));
  } finally { try { await h.close(); } catch (e) {} }
  const { trips } = mods.buildTrips(mods.fillsFromNotes(notes));
  const priced = trips.filter((t) => t.netPnl != null);
  return { trips: priced, accounts: accounts.length };
}

let _mods = null;
async function loadModules() {
  if (_mods) return _mods;
  const orders = await import('./rithmic/rithmic-orders.mjs'), fills = await import('./rithmic/rithmic-fills.mjs');
  // Same app name the charts use (assets/rithmic-config.js APP_NAME); the server must present the registered name.
  _mods = Object.assign({}, orders, fills, { APP_NAME: 'Stryker Charts', APP_VERSION: '1.0' });
  return _mods;
}

async function writeTrips(uid, trips) {
  const mods = await loadModules();
  const room = await freeRoom(uid);
  const col = db.collection('students').doc(uid).collection('journal');
  const ids = trips.map((t) => mods.tripDocId(t));
  const snaps = await Promise.all(ids.map((id) => col.doc(id).get()));
  let fresh = trips.filter((t, i) => !snaps[i].exists);
  const skipped = room == null ? 0 : Math.max(0, fresh.length - room);
  if (room != null) fresh = fresh.slice(0, room);
  for (let i = 0; i < fresh.length; i += 400) {
    const b = db.batch();
    fresh.slice(i, i + 400).forEach((t) => b.set(col.doc(mods.tripDocId(t)), Object.assign(mods.tripToJournalTrade(t, { tz: 'Asia/Kolkata', label: t.account }), { createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(), autoSynced: true })));
    await b.commit();
  }
  if (fresh.length) await db.collection('students').doc(uid).set({ journalEntryCount: FV.increment(fresh.length) }, { merge: true }).catch(() => {});
  return { added: fresh.length, skippedCap: skipped };
}

async function runOne(uid, row) {
  const ref = db.collection('rithmicCreds').doc(uid), day = etParts(Date.now()).date;
  try {
    const r = await syncOne(uid, row);
    const w = await writeTrips(uid, r.trips);
    await ref.set({ lastSyncAt: FV.serverTimestamp(), lastSyncDay: day, lastSyncStatus: 'ok', lastSyncDetail: w.added + ' added' + (w.skippedCap ? ', ' + w.skippedCap + ' over the Free limit' : ''), lastUsedAt: FV.serverTimestamp() }, { merge: true });
    if (w.skippedCap) await notify(uid, 'Rithmic sync: ' + w.added + ' trades added, ' + w.skippedCap + ' not added (Free plan limit).');
    await audit(uid, 'sync', { added: w.added });
  } catch (e) {
    // Rithmic's own reason, trimmed. Credentials are never part of an error text.
    const why = String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 200);
    await ref.set({ lastSyncAt: FV.serverTimestamp(), lastSyncDay: day, lastSyncStatus: 'error', lastSyncDetail: why }, { merge: true });
    await notify(uid, 'Rithmic sync failed: ' + why);
    await audit(uid, 'sync_failed');
  }
}

exports.rithmicJournalSync = functions.region('us-central1')
  .runWith({ maxInstances: 1, timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('every 15 minutes').timeZone('UTC')
  .onRun(async () => {
    const s = await db.collection('settings').doc('commerce').get();
    if (!(s.exists && s.data().rithmicSavedLogin === true) || !haveKey()) return null;   // off: do nothing
    const snap = await db.collection('rithmicCreds').where('autoSync', '==', true).get();
    const now = Date.now();
    // Sequential: one login at a time, and one member's slow gateway must not starve the rest.
    for (const doc of snap.docs) if (isDue(doc.data(), now)) await runOne(doc.id, doc.data());
    return null;
  });

exports._syncOne = syncOne;
exports._test = { encryptPassword, decryptPassword, keyFor, currentVersion, haveKey, isDue, etParts, gatewayOk, timeOk };
