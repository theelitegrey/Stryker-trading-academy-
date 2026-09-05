/**
 * Stryker Trading Academy — broker sync
 *
 * Multi-tenant broker synchronization for the trade journal, built on the
 * MIT-licensed LuxAlgo packages:
 *   @luxalgo/broker-sdk    — read-only connectivity to 20+ brokers, one schema
 *   @luxalgo/journal-core  — fills -> FIFO round-trip trades
 *
 * A student connects a broker with READ-ONLY API credentials from the journal
 * page. Credentials are validated with a live fetch, encrypted with
 * AES-256-GCM under a server-held secret, and stored in brokerSync/{uid}__
 * {broker}. A scheduled sweep (and a "Sync now" button) pulls each account's
 * fill history, rebuilds closed round-trip trades, and writes them into the
 * student's existing journal collection with DETERMINISTIC doc ids — so
 * re-syncs never duplicate a trade and never touch one the student has since
 * annotated (existing docs are skipped, not overwritten).
 *
 * FUNCTIONS (deploy names):
 *   brokerCatalog     callable — supported brokers + credential fields (from SDK metadata)
 *   brokerConnect     callable — validate, encrypt, store, first sync
 *   brokerSyncNow     callable — on-demand sync of one connection
 *   brokerDisconnect  callable — delete a connection (journal trades stay)
 *   brokerSyncSweep   schedule — every 6 hours, sync every stored connection
 *
 * DEPLOY (from the functions directory, alongside the existing functions —
 * name every function or the others get deleted):
 *   npm install @luxalgo/broker-sdk@0.5.0 @luxalgo/journal-core@0.1.0
 *   echo 'BROKER_SYNC_SECRET=<long random string>' >> .env
 *   firebase deploy --only functions:brokerCatalog,functions:brokerConnect,functions:brokerSyncNow,functions:brokerDisconnect,functions:brokerSyncSweep
 *
 * FIRESTORE RULES needed (clients read their own connection status; ONLY
 * these functions ever write the collection):
 *   match /brokerSync/{id} {
 *     allow read: if request.auth != null && resource.data.uid == request.auth.uid;
 *     allow write: if false;
 *   }
 *
 * SECURITY invariants:
 *  - Only the SDK's read-only root export is used — nothing here can trade.
 *  - Credentials exist in plaintext only inside a function invocation; at
 *    rest they are AES-256-GCM under BROKER_SYNC_SECRET, which lives in the
 *    functions runtime env, never in Firestore or the client.
 *  - Rotated credentials (Questrade's single-use refresh tokens) are
 *    re-encrypted and persisted the moment the SDK hands them back.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { connect, listBrokers } = require('@luxalgo/broker-sdk');
const { buildRoundTrips } = require('@luxalgo/journal-core');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Brokers whose API actually returns trade history (per the SDK's support
// table) AND whose credentials are plain fields a student can paste — the
// bring-your-own-OAuth-app brokers (Schwab, E*TRADE, Coinbase, TradeStation)
// need a developer app per user and are out of scope here.
const SYNCABLE = [
  'alpaca', 'hyperliquid', 'ibkr-flex', 'kucoin', 'public',
  'questrade', 'robinhood-crypto', 'tastytrade', 'topstep', 'tradier'
];

// Same futures contract-multiplier table as the client importer
// (assets/journal-lux.js) — point moves become dollars.
const FUT_MULT = {
  ES: 50, MES: 5, NQ: 20, MNQ: 2, YM: 5, MYM: 0.5, RTY: 50, M2K: 5,
  CL: 1000, MCL: 100, QM: 500, NG: 10000, QG: 2500,
  GC: 100, MGC: 10, SI: 5000, SIL: 1000, HG: 25000, PL: 50,
  ZB: 1000, ZN: 1000, ZF: 1000, ZT: 2000, ZC: 50, ZS: 50, ZW: 50,
  '6E': 125000, '6B': 62500, '6J': 12500000, '6A': 100000, '6C': 100000, M6E: 12500, M6B: 6250
};

function multipliersFor(executions){
  const out = {};
  executions.forEach((e) => {
    if (out[e.symbol] !== undefined) return;
    const s = String(e.symbol || '').toUpperCase();
    const token = (s.split(/[\s._-]/)[0] || s).replace(/\d+$/, '');
    let mult;
    for (let cut = token.length; cut >= 1 && mult === undefined; cut--) {
      mult = FUT_MULT[token.slice(0, cut)];
    }
    if (mult !== undefined) out[e.symbol] = mult;
  });
  return out;
}

// ---- credential encryption --------------------------------------------------

function cipherKey(){
  const secret = process.env.BROKER_SYNC_SECRET;
  if (!secret || secret.length < 16) {
    throw new functions.https.HttpsError('failed-precondition',
      'Broker sync is not configured on the server yet (BROKER_SYNC_SECRET missing).');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptCredentials(credentials){
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decryptCredentials(enc){
  const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey(), Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
  const out = Buffer.concat([decipher.update(Buffer.from(enc.data, 'base64')), decipher.final()]);
  return JSON.parse(out.toString('utf8'));
}

// ---- fills -> journal trades ------------------------------------------------

function pad(n){ return String(n).padStart(2, '0'); }
function r2(v){ return (v === null || v === undefined || !isFinite(v)) ? null : Math.round(v * 100) / 100; }

function tripToJournalTrade(trip, broker){
  const d = new Date(trip.openedAt);
  const pnl = r2(trip.netPnl);
  return {
    date: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()),
    time: pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()),
    instrument: String(trip.symbol || 'SYNC').toUpperCase().slice(0, 20),
    direction: trip.direction === 'short' ? 'short' : 'long',
    entryPrice: r2(trip.avgEntry),
    exitPrice: trip.avgExit !== undefined ? r2(trip.avgExit) : null,
    positionSize: trip.quantity,
    fees: r2(trip.fees) || 0,
    stopLoss: null, takeProfit: null,
    setup: '', session: '', account: '', tags: [], notes: '',
    pnl,
    result: pnl > 0 ? 'Win' : (pnl < 0 ? 'Loss' : 'Breakeven'),
    riskAmount: null, riskPercent: null, rMultiple: null, plannedRR: null,
    imported: true,
    importFormat: 'sync:' + broker,
    syncKey: trip.key
  };
}

function tradeDocId(uid, broker, tripKey){
  return 'sync' + crypto.createHash('sha1').update(uid + '|' + broker + '|' + tripKey).digest('hex').slice(0, 28);
}

// Pull the broker's fill history and add any round trips the journal doesn't
// have yet. Existing docs are left alone so student annotations survive.
async function runSync(connDoc){
  const { uid, broker } = connDoc;
  const credentials = decryptCredentials(connDoc.enc);
  const connRef = db.collection('brokerSync').doc(uid + '__' + broker);

  const connection = connect({
    broker,
    credentials,
    onCredentialsRotated: async (rotated) => {
      await connRef.set({ enc: encryptCredentials(rotated) }, { merge: true });
    }
  });

  const snapshot = await connection.fetchSnapshot();

  // Normalize every account's fills into journal-core executions.
  const executions = [];
  (snapshot.accounts || []).forEach((account) => {
    (account.trades || []).forEach((fill, i) => {
      if (!fill.symbol || !fill.executedAt || !(fill.quantity > 0) || !isFinite(fill.price)) return;
      executions.push({
        id: account.id + ':' + i,
        accountId: account.id,
        symbol: fill.symbol,
        side: fill.side === 'sell' ? 'sell' : 'buy',
        quantity: fill.quantity,
        price: fill.price,
        fee: isFinite(fill.fee) ? Math.abs(fill.fee) : 0,
        executedAt: fill.executedAt,
        source: 'sync'
      });
    });
  });

  if (!executions.length) {
    await connRef.set({
      status: 'ok', statusDetail: 'Connected — no fills reported yet.',
      lastSyncAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { added: 0, closed: 0 };
  }

  const trips = buildRoundTrips(executions, { method: 'fifo', multipliers: multipliersFor(executions) });
  const closed = trips.filter((t) => t.status !== 'open');

  const journal = db.collection('students').doc(uid).collection('journal');
  let added = 0;
  // Deterministic ids make this idempotent: check-then-add in chunks.
  for (let i = 0; i < closed.length; i += 200) {
    const chunk = closed.slice(i, i + 200);
    const refs = chunk.map((t) => journal.doc(tradeDocId(uid, broker, t.key)));
    const existing = await db.getAll(...refs);
    const batch = db.batch();
    chunk.forEach((trip, j) => {
      if (existing[j].exists) return;
      batch.set(refs[j], Object.assign(tripToJournalTrade(trip, broker), {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }));
      added++;
    });
    if (added) await batch.commit();
  }

  if (added) {
    const counters = { journalEntryCount: admin.firestore.FieldValue.increment(added) };
    if (closed.some((t) => t.netPnl > 0)) counters.hasWinningTrade = true;
    await db.collection('students').doc(uid).set(counters, { merge: true }).catch(() => {});
  }

  await connRef.set({
    status: 'ok',
    statusDetail: added + ' new trade' + (added === 1 ? '' : 's') + ' · ' + closed.length + ' on record',
    lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
    lastTradeCount: closed.length
  }, { merge: true });

  return { added, closed: closed.length };
}

function requireAuth(context){
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  }
  return context.auth.uid;
}

// ---- callables --------------------------------------------------------------

exports.brokerCatalog = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  return {
    brokers: listBrokers()
      .filter((b) => SYNCABLE.indexOf(b.id) !== -1)
      .map((b) => ({ id: b.id, displayName: b.displayName, credentials: b.credentials, readOnlySetup: b.readOnlySetup }))
  };
});

exports.brokerConnect = functions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const broker = String((data && data.broker) || '');
    const credentials = (data && data.credentials) || {};
    if (SYNCABLE.indexOf(broker) === -1) {
      throw new functions.https.HttpsError('invalid-argument', 'That broker is not supported for sync.');
    }
    Object.keys(credentials).forEach((k) => { credentials[k] = String(credentials[k] || '').trim(); });

    // Validate before storing anything: a live read-only fetch either works
    // or the student gets the broker's rejection immediately. Brokers with
    // single-use tokens (Questrade) rotate during this very fetch, so what
    // gets stored is whatever the SDK says is current afterwards.
    let effectiveCredentials = credentials;
    try {
      await connect({
        broker,
        credentials,
        onCredentialsRotated: (rotated) => { effectiveCredentials = rotated; }
      }).fetchSnapshot();
    } catch (err) {
      throw new functions.https.HttpsError('failed-precondition',
        'The broker rejected those credentials: ' + (err.message || err));
    }

    await db.collection('brokerSync').doc(uid + '__' + broker).set({
      uid,
      broker,
      enc: encryptCredentials(effectiveCredentials),
      status: 'ok',
      statusDetail: 'Connected — first sync running…',
      autoSync: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const doc = await db.collection('brokerSync').doc(uid + '__' + broker).get();
    const result = await runSync(doc.data());
    return { ok: true, added: result.added, closed: result.closed };
  });

exports.brokerSyncNow = functions
  .runWith({ timeoutSeconds: 300, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const broker = String((data && data.broker) || '');
    const ref = db.collection('brokerSync').doc(uid + '__' + broker);
    const doc = await ref.get();
    if (!doc.exists || doc.data().uid !== uid) {
      throw new functions.https.HttpsError('not-found', 'No such broker connection.');
    }
    try {
      return Object.assign({ ok: true }, await runSync(doc.data()));
    } catch (err) {
      await ref.set({ status: 'error', statusDetail: String(err.message || err).slice(0, 300),
        lastSyncAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      throw new functions.https.HttpsError('internal', 'Sync failed: ' + (err.message || err));
    }
  });

exports.brokerDisconnect = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const broker = String((data && data.broker) || '');
  const ref = db.collection('brokerSync').doc(uid + '__' + broker);
  const doc = await ref.get();
  if (doc.exists && doc.data().uid === uid) await ref.delete();
  return { ok: true };
});

// ---- scheduled sweep --------------------------------------------------------

exports.brokerSyncSweep = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('every 360 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    const snap = await db.collection('brokerSync').get();
    const conns = [];
    snap.forEach((d) => { const c = d.data(); if (c.autoSync !== false) conns.push(c); });

    // Sequential on purpose: this is a background sweep, and one student's
    // broker being slow must not starve the rest via parallel rate limits.
    for (const conn of conns) {
      try {
        await runSync(conn);
      } catch (err) {
        await db.collection('brokerSync').doc(conn.uid + '__' + conn.broker).set({
          status: 'error',
          statusDetail: String(err.message || err).slice(0, 300),
          lastSyncAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(() => {});
      }
    }
    return null;
  });
