// Passkey (WebAuthn) API for Cloudflare Pages. One catch-all route:
//   POST   /api/passkey/register/options   (Firebase ID token, signed in within 10 min)
//   POST   /api/passkey/register/verify    (Firebase ID token)
//   POST   /api/passkey/login/options      (no auth; discoverable credentials)
//   POST   /api/passkey/login/verify       (no auth; returns a Firebase custom token)
//   GET    /api/passkey                    (Firebase ID token; lists the caller's passkeys)
//   PATCH  /api/passkey/:credId            {name}   own credentials only
//   DELETE /api/passkey/:credId            own credentials only
// Bindings: KV PASSKEYS; secret FIREBASE_SA_KEY (service-account JSON, never logged); env DEV=1 allows http://127.0.0.1:*.
// Same-origin only: no CORS headers, and every state-changing call must carry our own Origin.
// Fails closed: no KV or no/odd FIREBASE_SA_KEY -> 503 "Passkeys are not available right now".
// Tested by tools/tests/passkey.test.mjs.
import { verifyIdToken, bearerOf, RT_PROJECT } from '../chart/_rt.js';
import { b64u, unb64u, safeEqual, verifyRegistration, verifyAssertion } from './_webauthn.js';

const RP_ID = 'tradezoro.com', RP_NAME = 'TradeZoro', PROD_ORIGIN = 'https://tradezoro.com';
const CHAL_TTL = 300, RATE_MAX = 30, MAX_KEYS = 10, RECENT_S = 600, CUSTOM_TOKEN_S = 3600;
const AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const enc = new TextEncoder();

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (status, error, extra) => json({ error, ...(extra || {}) }, status);
const UNAVAILABLE = () => fail(503, 'Passkeys are not available right now');
const randB64u = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));

function cfgFor(request, env) {
  const dev = env.DEV === '1';
  const devOk = (o) => { try { const u = new URL(o); return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'); } catch (e) { return false; } };
  const origin = request.headers.get('origin') || '';
  const rpId = dev && devOk(origin) ? new URL(origin).hostname : RP_ID;
  return { rpId, origins: [PROD_ORIGIN], devOriginOk: dev ? devOk : null, dev, devOk };
}

function deviceName(ua) {
  ua = String(ua || '');
  const d = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux computer' : 'This device';
  return d;
}
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);

async function readBody(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 32768) return null;
  try { const t = await request.text(); if (t.length > 32768) return null; return JSON.parse(t || '{}'); } catch (e) { return null; }
}

async function rateLimited(env, request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = 'rl:' + ip + ':' + Math.floor(Date.now() / 60000);
  const n = Number(await env.PASSKEYS.get(key)) || 0;
  if (n >= RATE_MAX) return true;
  await env.PASSKEYS.put(key, String(n + 1), { expirationTtl: 120 });
  return false;
}

// Challenges: chal:<challenge> -> {t:'reg'|'login', uid?}. Deleted on first read, win or lose.
// The in-isolate "spent" set closes the same-colo race; KV deletes reach other locations within ~60 s (see report).
const spent = new Map();
async function putChallenge(env, rec) {
  const c = randB64u(32);
  await env.PASSKEYS.put('chal:' + c, JSON.stringify(rec), { expirationTtl: CHAL_TTL });
  return c;
}
function consumer(env, type, uid) {
  return async (challenge) => {
    const k = 'chal:' + challenge, now = Date.now();
    for (const [s, t] of spent) if (now - t > CHAL_TTL * 1000) spent.delete(s);
    if (spent.has(challenge)) return false;
    spent.set(challenge, now);
    const raw = await env.PASSKEYS.get(k);
    if (!raw) return false;
    await env.PASSKEYS.delete(k);
    let rec; try { rec = JSON.parse(raw); } catch (e) { return false; }
    if (rec.t !== type) return false;
    if (type === 'reg' && rec.uid !== uid) return false;
    return true;
  };
}

const getJson = async (env, k) => { const r = await env.PASSKEYS.get(k); if (!r) return null; try { return JSON.parse(r); } catch (e) { return null; } };
const putJson = (env, k, v) => env.PASSKEYS.put(k, JSON.stringify(v));

async function authedUid(request, deps) {
  const tok = bearerOf(request);
  if (!tok) return null;
  const uid = await verifyIdToken(tok, { fetchImpl: deps.fetchImpl });
  if (!uid) return null;
  let authTime = 0;
  try { authTime = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).auth_time || 0; } catch (e) { /* stays 0 */ }
  return { uid, authTime };
}

// ---- service account: custom token + disabled-account check ----
function saFrom(env) {
  try {
    const sa = JSON.parse(env.FIREBASE_SA_KEY);
    if (!sa || typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string' || !sa.private_key.includes('PRIVATE KEY')) return null;
    return sa;
  } catch (e) { return null; }
}
async function signJwt(sa, claims) {
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', unb64(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const h = b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))), p = b64u(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(sig);
}
function unb64(s) { const bin = atob(s), o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }

async function accountState(sa, uid, fetchImpl) {   // 'ok' | 'disabled' | 'missing' | 'error'
  try {
    const now = Math.floor(Date.now() / 1000);
    const assertion = await signJwt(sa, { iss: sa.client_email, sub: sa.client_email, aud: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/cloud-platform', iat: now, exp: now + 300 });
    const tr = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + assertion });
    if (!tr.ok) return 'error';
    const at = (await tr.json()).access_token;
    if (!at) return 'error';
    const r = await fetchImpl('https://identitytoolkit.googleapis.com/v1/projects/' + RT_PROJECT + '/accounts:lookup', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + at }, body: JSON.stringify({ localId: [uid] }) });
    if (!r.ok) return 'error';
    const u = ((await r.json()).users || [])[0];
    if (!u || u.localId !== uid) return 'missing';
    return u.disabled ? 'disabled' : 'ok';
  } catch (e) { return 'error'; }
}
async function mintCustomToken(sa, uid) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(sa, { iss: sa.client_email, sub: sa.client_email, aud: AUD, iat: now, exp: now + CUSTOM_TOKEN_S, uid });
}

// ---- the router ----
export async function handle(request, env, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/passkey\/?/, '').split('/').filter(Boolean);
  const method = request.method;
  if (!env.PASSKEYS || !saFrom(env)) return UNAVAILABLE();

  const cfg = cfgFor(request, env);
  if (method !== 'GET') {   // same-origin only: a cross-site page cannot make us act
    const o = request.headers.get('origin') || '';
    if (!(o === PROD_ORIGIN || (cfg.dev && cfg.devOk(o)))) return fail(403, 'Not allowed');
  }
  const route = parts.join('/');
  const body = method === 'GET' || method === 'DELETE' ? {} : await readBody(request);
  if (body === null) return fail(400, 'Bad request');

  // ---- login (no auth) ----
  if (method === 'POST' && route === 'login/options') {
    if (await rateLimited(env, request)) return fail(429, 'Too many tries. Wait a minute and try again.');
    const challenge = await putChallenge(env, { t: 'login' });
    return json({ publicKey: { challenge, rpId: cfg.rpId, timeout: 60000, userVerification: 'required', allowCredentials: [] } });
  }
  if (method === 'POST' && route === 'login/verify') {
    if (await rateLimited(env, request)) return fail(429, 'Too many tries. Wait a minute and try again.');
    const BAD = () => fail(401, "That passkey didn't work. Try again or use your email.");
    try {
      const r = body.response || {};
      const credId = String(body.id || '');
      if (!credId || credId.length > 1400) return BAD();
      const cred = await getJson(env, 'cred:' + credId);
      if (!cred) { await consumer(env, 'login')(String((() => { try { return JSON.parse(new TextDecoder().decode(unb64u(r.clientDataJSON))).challenge; } catch (e) { return ''; } })())); return BAD(); }
      if (cred.flagged) return fail(401, 'This passkey was blocked for safety. Sign in another way and remove it.');
      const res = await verifyAssertion({ clientDataJSON: unb64u(r.clientDataJSON), authenticatorData: unb64u(r.authenticatorData), signature: unb64u(r.signature) },
        cred, cfg, consumer(env, 'login')).catch(async (e) => {
          if (e && e.clone) { cred.flagged = true; await putJson(env, 'cred:' + credId, cred); }
          throw e;
        });
      if (r.userHandle) {   // when the device sends it, it must be the handle we issued to this uid
        const h = await env.PASSKEYS.get('handle:' + cred.uid);
        if (!h || !safeEqual(h, String(r.userHandle))) return BAD();
      }
      const sa = saFrom(env);
      const st = await accountState(sa, cred.uid, fetchImpl);
      if (st === 'disabled' || st === 'missing') return fail(403, 'This account cannot sign in.');
      if (st !== 'ok') return UNAVAILABLE();
      cred.signCount = res.signCount; cred.lastUsedAt = Date.now();
      await putJson(env, 'cred:' + credId, cred);
      return json({ token: await mintCustomToken(sa, cred.uid) });
    } catch (e) { return BAD(); }   // never echo why (and never log the credential)
  }

  // ---- everything below needs a signed-in user ----
  const who = await authedUid(request, deps);
  if (!who) return fail(401, 'Please sign in first');
  const uid = who.uid;

  if (method === 'GET' && route === '') {
    const ids = (await getJson(env, 'user:' + uid)) || [];
    const list = [];
    for (const id of ids) { const c = await getJson(env, 'cred:' + id); if (c && c.uid === uid) list.push({ id, name: c.name, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt || null, flagged: !!c.flagged }); }
    return json({ passkeys: list });
  }

  if (method === 'POST' && route === 'register/options') {
    if (await rateLimited(env, request)) return fail(429, 'Too many tries. Wait a minute and try again.');
    if (!who.authTime || Math.floor(Date.now() / 1000) - who.authTime > RECENT_S) return fail(403, 'Please sign in again first', { code: 'recent-login' });
    const ids = (await getJson(env, 'user:' + uid)) || [];
    if (ids.length >= MAX_KEYS) return fail(400, 'You have reached the limit of ' + MAX_KEYS + ' passkeys.');
    let handle = await env.PASSKEYS.get('handle:' + uid);
    if (!handle) { handle = randB64u(32); await env.PASSKEYS.put('handle:' + uid, handle); }
    const challenge = await putChallenge(env, { t: 'reg', uid });
    return json({ publicKey: {
      challenge, rp: { id: cfg.rpId, name: RP_NAME },
      user: { id: handle, name: String(body.email || uid).slice(0, 100), displayName: String(body.displayName || body.email || 'TradeZoro member').slice(0, 100) },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      timeout: 60000, attestation: 'none',
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      excludeCredentials: ids.map((id) => ({ type: 'public-key', id }))
    } });
  }

  if (method === 'POST' && route === 'register/verify') {
    if (await rateLimited(env, request)) return fail(429, 'Too many tries. Wait a minute and try again.');
    if (!who.authTime || Math.floor(Date.now() / 1000) - who.authTime > RECENT_S + 300) return fail(403, 'Please sign in again first', { code: 'recent-login' });
    try {
      const r = body.response || {};
      const ids = (await getJson(env, 'user:' + uid)) || [];
      if (ids.length >= MAX_KEYS) return fail(400, 'You have reached the limit of ' + MAX_KEYS + ' passkeys.');
      const v = await verifyRegistration({ clientDataJSON: unb64u(r.clientDataJSON), attestationObject: unb64u(r.attestationObject), rawId: unb64u(String(body.rawId || body.id || '')) }, cfg, consumer(env, 'reg', uid));
      if (await env.PASSKEYS.get('cred:' + v.credId)) return fail(409, 'That passkey is already saved.');
      const now = Date.now();
      await putJson(env, 'cred:' + v.credId, { uid, jwk: v.jwk, alg: v.alg, signCount: v.signCount, transports: Array.isArray(body.transports) ? body.transports.filter((t) => typeof t === 'string').slice(0, 6) : [], name: cleanName(body.name) || deviceName(request.headers.get('user-agent')), createdAt: now, lastUsedAt: null });
      ids.push(v.credId);
      await putJson(env, 'user:' + uid, ids);
      return json({ ok: true, id: v.credId });
    } catch (e) { return fail(400, "We couldn't save that passkey. Please try again."); }
  }

  if (parts.length === 1 && (method === 'DELETE' || method === 'PATCH')) {
    const id = parts[0];
    const c = await getJson(env, 'cred:' + id);
    if (!c || c.uid !== uid) return fail(404, 'Passkey not found');   // not "403": do not reveal other people's ids
    if (method === 'PATCH') {
      const name = cleanName(body.name);
      if (!name) return fail(400, 'Give it a name');
      c.name = name; await putJson(env, 'cred:' + id, c);
      return json({ ok: true });
    }
    await env.PASSKEYS.delete('cred:' + id);
    const ids = ((await getJson(env, 'user:' + uid)) || []).filter((x) => x !== id);
    await putJson(env, 'user:' + uid, ids);
    return json({ ok: true });
  }
  return fail(404, 'Not found');
}

export const onRequest = ({ request, env }) => handle(request, env);
