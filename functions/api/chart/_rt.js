// Real-time access gate for CME futures data (Owner order 2026-10-16: "remove real time candles
// access for cme futures for everyone except admin"). Pure module, no Pages context.
// Used by: functions/api/chart/stream/[sym].js, functions/api/chart/bars/[sym].js.
// IDENTICAL COPY (kept in step by tools/tests/rt-access.test.mjs): workers/book-recorder/src/rt-auth.js.
//
// Who is an admin: the site's own rule, an existing document at admins/{uid} in Firestore
// (assets/admin-guard.js, firestore.rules isAdmin()). The caller sends its Firebase ID token;
// this module (1) verifies the JWT signature (RS256) against Google's public keys (cached),
// issuer, audience, expiry, then (2) reads admins/{uid} over the Firestore REST API USING THE
// USER'S OWN TOKEN, so the live security rules decide (200 = exists = admin). No secret is
// needed and a client "isAdmin" flag is never trusted. Everything fails CLOSED (not admin).
// Result per uid is memoised 60 s in the isolate (admins); the students/{uid} answer (demo / liveFeed) 30 s,
// so an admin switching someone's live feed OFF takes effect within about a minute.
export const RT_DELAY_S = 600;          // non-admins see nothing newer than now - 10 min
export const RT_PROJECT = 'strykertrades-e0cd8';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const ISSUER = 'https://securetoken.google.com/' + RT_PROJECT;
const ADMIN_TTL_MS = 60000;
const PLANS_TTL_MS = 300000;   // plans collection (public read) memo: which plan names are paid (rank >= 1)
const GRACE_MS = 3 * 24 * 3600 * 1000;   // same grace as functions-src/subscriptions.js: access continues 3 days past paidThroughMillis
const STUDENT_TTL_MS = 30000;   // demo / liveFeed: switching a user off bites within ~1 min (memo + stream re-check)

let jwks = null, jwksAt = 0, jwksTry = 0;
const adminMemo = new Map();
const demoMemo = new Map();
let plansMemo = null;   // { at, paid:Set(lowercased plan names/ids with rank >= 1) }

// Pro = the same rule the paywall uses (assets/plan-limits.js: rankOf(students.plan) >= 1, ranks from the public plans
// collection). Read server-side from the student's own doc. Active = status not expired/cancelled and, when the member
// has a paidThroughMillis, now <= paidThrough + 3 days grace (the daily sweep downgrades plan itself; this closes the gap).
async function paidPlanNames(fetchImpl) {
  if (plansMemo && Date.now() - plansMemo.at < PLANS_TTL_MS) return plansMemo.paid;
  let paid = null;
  try {
    const r = await fetchImpl('https://firestore.googleapis.com/v1/projects/' + RT_PROJECT + '/databases/(default)/documents/plans?pageSize=100');
    if (r.ok) {
      paid = new Set();
      for (const d of (await r.json()).documents || []) {
        const f = d.fields || {}, rk = f.rank ? Number(f.rank.integerValue ?? f.rank.doubleValue ?? f.rank.stringValue) : 0;
        if (rk >= 1) {
          paid.add(d.name.split('/').pop().toLowerCase());
          if (f.name && f.name.stringValue) paid.add(f.name.stringValue.toLowerCase());
        }
      }
    }
  } catch (e) { paid = null; }
  if (!paid || !paid.size) { if (plansMemo) { plansMemo.at = Date.now() - PLANS_TTL_MS + 15000; return plansMemo.paid; } return new Set(['pro', 'elite']); }
  plansMemo = { at: Date.now(), paid };
  return paid;
}
export function isActiveProDoc(f, paid, nowMs = Date.now()) {
  const plan = f.plan && f.plan.stringValue ? f.plan.stringValue.toLowerCase() : '';
  if (!plan || !paid.has(plan)) return false;
  const st = f.subscriptionStatus && f.subscriptionStatus.stringValue;
  if (st === 'expired' || st === 'cancelled' || st === 'canceled') return false;
  if (f.foundingMember && f.foundingMember.booleanValue === true) return true;
  const pt = f.paidThroughMillis ? Number(f.paidThroughMillis.integerValue ?? f.paidThroughMillis.doubleValue ?? f.paidThroughMillis.stringValue) : 0;
  if (pt > 0 && nowMs > pt + GRACE_MS) return false;
  return true;
}

function b64uBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64uJson = (s) => JSON.parse(new TextDecoder().decode(b64uBytes(s)));

async function keyFor(kid, fetchImpl) {
  const now = Date.now();
  const fresh = jwks && now - jwksAt < 3600e3;
  if ((!fresh || !jwks.has(kid)) && now - jwksTry > 30000) {
    jwksTry = now;
    try {
      const r = await fetchImpl(JWKS_URL);
      if (r.ok) {
        const j = await r.json(), m = new Map();
        for (const k of j.keys || []) {
          try { m.set(k.kid, await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])); } catch (e) {}
        }
        if (m.size) { jwks = m; jwksAt = now; }
      }
    } catch (e) {}
  }
  return jwks && jwks.get(kid) || null;
}

// -> uid string, or null. opts.fetchImpl / opts.nowSec are for tests.
export async function verifyIdToken(token, opts = {}) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || token.length > 4096) return null;
    const head = b64uJson(parts[0]), p = b64uJson(parts[1]);
    if (head.alg !== 'RS256' || !head.kid) return null;
    const now = opts.nowSec || Math.floor(Date.now() / 1000);
    if (p.iss !== ISSUER || p.aud !== RT_PROJECT) return null;
    if (typeof p.sub !== 'string' || !p.sub || p.sub.length > 128) return null;
    if (!(p.exp > now) || !(p.iat <= now + 300)) return null;
    const key = await keyFor(head.kid, opts.fetchImpl || fetch);
    if (!key) return null;
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    return ok ? p.sub : null;
  } catch (e) { return null; }
}

// true only for a verified token whose uid has an admins/{uid} document.
export async function isAdminToken(token, opts = {}) {
  const uid = await verifyIdToken(token, opts);
  if (!uid) return false;
  const hit = adminMemo.get(uid);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.v;
  let v = false, ttl = ADMIN_TTL_MS;
  try {
    const url = 'https://firestore.googleapis.com/v1/projects/' + RT_PROJECT + '/databases/(default)/documents/admins/' + encodeURIComponent(uid);
    // Frozen-candles fix 2026-10-20: a "no" must never stick. One retry on any non-definitive answer, and a
    // negative answer is remembered only 5 s (a positive 60 s), so a Firestore blip cannot hold an admin on
    // the delayed feed for a minute. 404 = no admins/{uid} doc = a definite "not admin".
    let r = null;
    for (let i = 0; i < 2; i++) {
      try { r = await (opts.fetchImpl || fetch)(url, { headers: { authorization: 'Bearer ' + token } }); } catch (e) { r = null; }
      if (r && (r.status === 200 || r.status === 404)) break;
    }
    if (r && r.status === 200) v = true;
    else if (r && r.status === 404) ttl = 5000;
    else ttl = 3000; // outage / 403 / 5xx: fail closed, ask again very soon
  } catch (e) { ttl = 3000; }
  if (adminMemo.size > 500) adminMemo.clear();
  adminMemo.set(uid, { v, at: Date.now(), ttl });
  return v;
}

// Real-time entitlement = admin, OR the marketing demo account (CoS decision 2026-10-17), OR a member the
// Owner switched on from the admin page (liveFeed, Owner 2026-10-26 "I can select which users get live feed"):
// a token-verified uid whose OWN students/{uid} document has demo === true or liveFeed === true, OR an active Pro plan (Owner 2026-10-26 "real time on automatically for all pro members"). The doc is read
// over the Firestore REST API with the caller's own token, so the live rules decide (a student can only read
// their own doc), and `demo` / `liveFeed` are server-only fields (privileged in firestore.rules: only an admin
// writes them). Fails CLOSED. Nobody else gets in.
export async function isDemoToken(token, opts = {}) {
  const uid = await verifyIdToken(token, opts);
  if (!uid) return false;
  const hit = demoMemo.get(uid);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.v;
  let v = false, ttl = STUDENT_TTL_MS;
  try {
    const url = 'https://firestore.googleapis.com/v1/projects/' + RT_PROJECT + '/databases/(default)/documents/students/' + encodeURIComponent(uid);
    const r = await (opts.fetchImpl || fetch)(url, { headers: { authorization: 'Bearer ' + token } });
    if (r.status === 200) {
      const f = ((await r.json()) || {}).fields || {};
      v = !!((f.demo && f.demo.booleanValue === true) || (f.liveFeed && f.liveFeed.booleanValue === true));
      if (!v) v = isActiveProDoc(f, await paidPlanNames(opts.fetchImpl || fetch), opts.nowMs || Date.now());
    }
    else if (r.status !== 404 && r.status !== 403) ttl = 10000;
  } catch (e) { ttl = 10000; }
  if (demoMemo.size > 500) demoMemo.clear();
  demoMemo.set(uid, { v, at: Date.now(), ttl });
  return v;
}
export async function isRealtimeToken(token, opts = {}) {
  return (await isAdminToken(token, opts)) || (await isDemoToken(token, opts));
}

export const bearerOf = (request) => {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '');
  return m ? m[1] : '';
};
// WebSocket: the browser sends the token as a subprotocol ("tz-auth", "<jwt>"), never in the URL.
export function wsTokenOf(request) {
  const list = String(request.headers.get('sec-websocket-protocol') || '').split(',').map((x) => x.trim());
  const i = list.indexOf('tz-auth');
  return i >= 0 && list[i + 1] ? list[i + 1] : '';
}
export const _resetForTests = () => { jwks = null; jwksAt = 0; jwksTry = 0; adminMemo.clear(); demoMemo.clear(); plansMemo = null; };
