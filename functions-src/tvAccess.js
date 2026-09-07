/**
 * Stryker Trading Academy — TradingView invite-only access management
 *
 * Admin-only callables that grant / revoke / verify access to the academy's
 * invite-only Pine scripts, driven from the Trading Indicators admin page.
 * A Node port of trendoscope-algorithms/Tradingview-Access-Management
 * (Python/Flask), inlined here so it deploys with the existing functions and
 * sits behind the admins collection instead of an unauthenticated Replit URL.
 *
 *   tvValidateUsername — does this TradingView username exist?
 *   tvGrantAccess      — grant (or extend) access to the configured scripts
 *   tvRevokeAccess     — remove access to the configured scripts
 *
 * CONFIG (settings/tradingview, edited in Indicators admin):
 *   { enabled: true, pineIds: ['PUB;abc123…', …], duration: '1L' }
 *   duration: <number><type> where type is D/W/M/Y, or L for lifetime.
 *
 * CREDENTIALS (functions .env — never in Firestore, which is world-readable):
 *   TV_USERNAME=…      the vendor account that owns the scripts (Premium)
 *   TV_PASSWORD=…
 *   TV_SESSIONID=…     optional: a sessionid cookie copied from a logged-in
 *                      browser. Used when password login fails (TradingView
 *                      sometimes captchas datacenter IPs). The cookie lives
 *                      for months; paste a fresh one if grants start failing.
 *
 * The logged-in session cookie is cached in tvSession/current — written only
 * by these functions (admin SDK bypasses rules; the collection needs no
 * client rule and default-deny keeps it private).
 *
 * KNOWN LIMITS, stated plainly: these are TradingView's internal endpoints —
 * automating them is against their ToS and they can change without notice.
 * The account must have no 2FA. Every failure here is non-destructive: the
 * admin page reports it and the manual "Manage Access" flow keeps working.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const URLS = {
  tvcoins: 'https://www.tradingview.com/tvcoins/details/',
  usernameHint: 'https://www.tradingview.com/username_hint/',
  listUsers: 'https://www.tradingview.com/pine_perm/list_users/',
  addAccess: 'https://www.tradingview.com/pine_perm/add/',
  modifyAccess: 'https://www.tradingview.com/pine_perm/modify_user_expiration/',
  removeAccess: 'https://www.tradingview.com/pine_perm/remove/',
  signin: 'https://www.tradingview.com/accounts/signin/'
};

// The same client identity the reference implementation presents.
const UA = 'TWAPI/3.0 (Linux; production; Stryker)';

function baseHeaders(sessionid){
  const h = {
    'User-Agent': UA,
    'Referer': 'https://www.tradingview.com',
    'Origin': 'https://www.tradingview.com'
  };
  if (sessionid) h['Cookie'] = 'sessionid=' + sessionid;
  return h;
}

async function requireAdmin(context){
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  }
  const doc = await db.collection('admins').doc(context.auth.uid).get();
  if (!doc.exists) {
    throw new functions.https.HttpsError('permission-denied', 'Admins only.');
  }
  return context.auth.uid;
}

// ---- session ----------------------------------------------------------------

const SESSION_REF = () => db.collection('tvSession').doc('current');

async function sessionIsAlive(sessionid){
  if (!sessionid) return false;
  try {
    const res = await fetch(URLS.tvcoins, {
      headers: baseHeaders(sessionid), signal: AbortSignal.timeout(15000)
    });
    return res.status === 200;
  } catch (e) { return false; }
}

async function loginWithPassword(){
  const user = process.env.TV_USERNAME, pass = process.env.TV_PASSWORD;
  if (!user || !pass) {
    throw new functions.https.HttpsError('failed-precondition',
      'TradingView credentials are not configured on the server (TV_USERNAME / TV_PASSWORD in the functions .env).');
  }
  const body = new URLSearchParams({ username: user, password: pass, remember: 'on' });
  const res = await fetch(URLS.signin, {
    method: 'POST',
    headers: Object.assign(baseHeaders(null), { 'Content-Type': 'application/x-www-form-urlencoded' }),
    body,
    signal: AbortSignal.timeout(20000)
  });
  const cookies = (typeof res.headers.getSetCookie === 'function') ? res.headers.getSetCookie() : [];
  for (const c of cookies) {
    const m = /^sessionid=([^;]+)/.exec(c);
    if (m && m[1]) return m[1];
  }
  const bodyText = await res.text().catch(() => '');
  console.error('TV login gave no sessionid', res.status, bodyText.slice(0, 500));
  // Surface TradingView's own reason so the admin can tell wrong-password
  // from captcha/2FA without digging through function logs. The body is
  // JSON like {"error": "..."} or {"code": "2FA_required", ...}.
  let reason = '';
  try {
    const j = JSON.parse(bodyText);
    reason = j.error || j.code || (j.errors && JSON.stringify(j.errors)) || '';
  } catch (e) { /* not JSON — leave reason empty */ }
  throw new functions.https.HttpsError('failed-precondition',
    'TradingView login failed (status ' + res.status + (reason ? ', "' + String(reason).slice(0, 160) + '"' : '') + '). ' +
    'Wrong password reads as an error here; for a captcha or 2FA, paste a browser sessionid cookie ' +
    'into TV_SESSIONID in the functions .env and redeploy.');
}

async function getSession(){
  // 1. the cached cookie from a previous run
  const doc = await SESSION_REF().get().catch(() => null);
  const cached = doc && doc.exists ? doc.data().sessionid : null;
  if (await sessionIsAlive(cached)) return cached;

  // 2. a manually seeded cookie from the environment (captcha escape hatch)
  const seeded = process.env.TV_SESSIONID || null;
  if (seeded && seeded !== cached && await sessionIsAlive(seeded)) {
    await SESSION_REF().set({ sessionid: seeded, source: 'env', updatedAtMillis: Date.now() });
    return seeded;
  }

  // 3. a fresh password login
  const fresh = await loginWithPassword();
  if (!(await sessionIsAlive(fresh))) {
    throw new functions.https.HttpsError('internal', 'TradingView issued a session that does not validate.');
  }
  await SESSION_REF().set({ sessionid: fresh, source: 'login', updatedAtMillis: Date.now() });
  return fresh;
}

// ---- TradingView operations (ported 1:1 from the reference project) --------

async function lookupUsername(username){
  const res = await fetch(URLS.usernameHint + '?s=' + encodeURIComponent(username), {
    headers: baseHeaders(null), signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new functions.https.HttpsError('internal', 'TradingView username lookup returned ' + res.status + '.');
  const users = await res.json();
  const hit = (Array.isArray(users) ? users : []).find(
    (u) => u && u.username && u.username.toLowerCase() === String(username).toLowerCase());
  return { valid: !!hit, verifiedName: hit ? hit.username : null };
}

async function getAccessDetails(sessionid, pineId, username){
  const body = new URLSearchParams({ pine_id: pineId, username });
  const res = await fetch(URLS.listUsers + '?limit=10&order_by=-created', {
    method: 'POST',
    headers: Object.assign(baseHeaders(sessionid), { 'Content-Type': 'application/x-www-form-urlencoded' }),
    body,
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new functions.https.HttpsError('internal',
    'TradingView list_users returned ' + res.status + ' for ' + pineId + '.');
  const json = await res.json();
  const hit = ((json && json.results) || []).find(
    (u) => u && u.username && u.username.toLowerCase() === String(username).toLowerCase());
  return {
    pineId,
    username,
    hasAccess: !!hit,
    noExpiration: !!hit && !hit.expiration,
    currentExpiration: hit && hit.expiration ? hit.expiration : new Date().toISOString()
  };
}

/** '1L' → lifetime; '30D'/'2W'/'3M'/'1Y' → that far past the later of now /
 *  the current expiration, so extending never shortens what someone has. */
function computeExpiration(detail, duration){
  const m = /^(\d+)\s*([DWMYL])$/i.exec(String(duration || '1L').trim());
  const type = m ? m[2].toUpperCase() : 'L';
  const n = m ? parseInt(m[1], 10) : 1;
  if (type === 'L') return { lifetime: true, expiration: null };

  let from = new Date(detail.currentExpiration);
  if (isNaN(from.getTime()) || from.getTime() < Date.now()) from = new Date();
  const d = new Date(from.getTime());
  if (type === 'D') d.setUTCDate(d.getUTCDate() + n);
  else if (type === 'W') d.setUTCDate(d.getUTCDate() + 7 * n);
  else if (type === 'M') d.setUTCMonth(d.getUTCMonth() + n);
  else if (type === 'Y') d.setUTCFullYear(d.getUTCFullYear() + n);
  return { lifetime: false, expiration: d.toISOString() };
}

async function addAccess(sessionid, detail, duration){
  const { lifetime, expiration } = computeExpiration(detail, duration);
  const fields = { pine_id: detail.pineId, username_recip: detail.username };
  if (!lifetime) fields.expiration = expiration;
  const url = detail.hasAccess ? URLS.modifyAccess : URLS.addAccess;
  const res = await fetch(url, {
    method: 'POST',
    headers: Object.assign(baseHeaders(sessionid), { 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(20000)
  });
  return {
    pineId: detail.pineId,
    ok: res.status === 200 || res.status === 201,
    status: res.status,
    expiration: lifetime ? 'lifetime' : expiration,
    action: detail.hasAccess ? 'extended' : 'granted'
  };
}

async function removeAccess(sessionid, detail){
  const res = await fetch(URLS.removeAccess, {
    method: 'POST',
    headers: Object.assign(baseHeaders(sessionid), { 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams({ pine_id: detail.pineId, username_recip: detail.username }),
    signal: AbortSignal.timeout(20000)
  });
  return { pineId: detail.pineId, ok: res.status === 200, status: res.status, action: 'removed' };
}

async function loadTvConfig(){
  const doc = await db.collection('settings').doc('tradingview').get();
  const cfg = doc.exists ? (doc.data() || {}) : {};
  const pineIds = (Array.isArray(cfg.pineIds) ? cfg.pineIds : [])
    .map((s) => String(s).trim()).filter(Boolean);
  if (!cfg.enabled) {
    throw new functions.https.HttpsError('failed-precondition',
      'TradingView auto-grant is switched off in the Indicators admin.');
  }
  if (!pineIds.length) {
    throw new functions.https.HttpsError('failed-precondition',
      'No Pine IDs configured — add your script IDs in the Indicators admin first.');
  }
  return { pineIds, duration: cfg.duration || '1L' };
}

// ---- callables --------------------------------------------------------------

exports.tvValidateUsername = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data, context) => {
    await requireAdmin(context);
    const username = String((data && data.username) || '').trim().replace(/^@/, '');
    if (!username) throw new functions.https.HttpsError('invalid-argument', 'A username is required.');
    return lookupUsername(username);
  });

exports.tvGrantAccess = functions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .https.onCall(async (data, context) => {
    await requireAdmin(context);
    const username = String((data && data.username) || '').trim().replace(/^@/, '');
    if (!username) throw new functions.https.HttpsError('invalid-argument', 'A username is required.');

    const { pineIds, duration } = await loadTvConfig();

    const check = await lookupUsername(username);
    if (!check.valid) {
      throw new functions.https.HttpsError('not-found',
        '"' + username + '" is not a TradingView username — ask the student to re-check it.');
    }

    const sessionid = await getSession();
    const results = [];
    for (const pineId of pineIds) {
      const detail = await getAccessDetails(sessionid, pineId, check.verifiedName);
      results.push(await addAccess(sessionid, detail, duration));
    }
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      throw new functions.https.HttpsError('internal',
        failed.length + ' of ' + results.length + ' scripts failed (HTTP ' + failed[0].status + '). ' +
        'None the less, ' + (results.length - failed.length) + ' succeeded — check Manage Access on TradingView.');
    }
    console.log('tvGrantAccess:', check.verifiedName, '→', results.map((r) => r.action + ' ' + r.pineId).join(', '));
    return { granted: true, username: check.verifiedName, duration, results };
  });

exports.tvRevokeAccess = functions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .https.onCall(async (data, context) => {
    await requireAdmin(context);
    const username = String((data && data.username) || '').trim().replace(/^@/, '');
    if (!username) throw new functions.https.HttpsError('invalid-argument', 'A username is required.');

    const { pineIds } = await loadTvConfig();
    const sessionid = await getSession();
    const results = [];
    for (const pineId of pineIds) {
      const detail = await getAccessDetails(sessionid, pineId, username);
      if (!detail.hasAccess) { results.push({ pineId, ok: true, action: 'already-removed' }); continue; }
      results.push(await removeAccess(sessionid, detail));
    }
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      throw new functions.https.HttpsError('internal',
        failed.length + ' of ' + results.length + ' scripts failed to revoke (HTTP ' + failed[0].status + ').');
    }
    console.log('tvRevokeAccess:', username, '→', results.map((r) => r.action + ' ' + r.pineId).join(', '));
    return { revoked: true, username, results };
  });

/**
 * Revoke every configured script for a username, without throwing — used by
 * subscriptionSweep when a lapsed student loses indicator access. Returns
 * { ok, reason?, results? }; auto-grant switched off or unconfigured is a
 * clean { ok:false } rather than an error, since manual-mode sites handle
 * revocation by hand.
 */
async function revokeAllForUsername(username){
  try {
    const doc = await db.collection('settings').doc('tradingview').get();
    const cfg = doc.exists ? (doc.data() || {}) : {};
    const pineIds = (Array.isArray(cfg.pineIds) ? cfg.pineIds : []).map((s) => String(s).trim()).filter(Boolean);
    if (!cfg.enabled || !pineIds.length) return { ok: false, reason: 'auto-grant off or no pine ids' };

    const sessionid = await getSession();
    const results = [];
    for (const pineId of pineIds) {
      const detail = await getAccessDetails(sessionid, pineId, username);
      if (!detail.hasAccess) { results.push({ pineId, ok: true, action: 'already-removed' }); continue; }
      results.push(await removeAccess(sessionid, detail));
    }
    return { ok: results.every((r) => r.ok), results };
  } catch (err) {
    return { ok: false, reason: String(err.message || err).slice(0, 200) };
  }
}

// Exported for tests and for subscriptionSweep.
exports.__internals = { computeExpiration, revokeAllForUsername };
