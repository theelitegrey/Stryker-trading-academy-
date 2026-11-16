// Desktop app Google sign-in handoff (Owner bug 15 Nov: Google refuses OAuth inside the Electron app, "This browser
// or app may not be secure"). The app opens https://tradezoro.com/desktop-login?nonce=<n>&port=<p> in the user's
// normal browser; that page signs in with Google there and hands the session back to the app:
//   POST /api/desktop/handoff          Bearer <Firebase ID token>, {nonce}, Origin https://tradezoro.com
//                                      -> {code}  one-time code, 120 s, single use, bound to the nonce
//   POST /api/desktop/handoff/redeem   {code, verifier}  (called by the app's main process, no cookies, no Origin)
//                                      -> {token}  Firebase custom token for that uid (minted here, never stored)
// PKCE-style: the URL's nonce is base64url(sha256(verifier)); the verifier never leaves the app except in the
// back-channel redeem call, so a nonce + code read from browser history is not enough to redeem.
// The code reaches the app only through http://127.0.0.1:<port> or tradezoro://auth on the user's own machine.
// KV (binding PASSKEYS): dh:<sha256(code)> -> {uid, nh: nonce, iat, exp}; rl:dh:<ip>:<min>. Secret FIREBASE_SA_KEY.
// Nothing here logs a token, code or nonce. Fails closed (503) without KV or the service-account key.
// Tests: tools/tests/desktop-handoff.test.mjs.
import { verifyIdToken, bearerOf } from '../chart/_rt.js';
import { saFrom, accountState, mintCustomToken } from '../passkey/[[path]].js';
import { b64u, safeEqual } from '../passkey/_webauthn.js';

const PROD_ORIGIN = 'https://tradezoro.com';
export const CODE_TTL_S = 120;
const RATE_MAX = 20;
const FRESH_S = 600;   // the ID token must come from a sign-in in the last 10 minutes (it just happened on the page)
const NONCE_RE = /^[A-Za-z0-9_-]{32,128}$/;
const CODE_RE = /^[A-Za-z0-9_-]{32,128}$/;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const fail = (status, error) => json({ error }, status);
const UNAVAILABLE = () => fail(503, 'Desktop sign-in is not available right now');

async function sha(s) {
  return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}

async function readBody(request) {
  if (Number(request.headers.get('content-length') || 0) > 4096) return null;
  try { const t = await request.text(); if (t.length > 4096) return null; const o = JSON.parse(t || '{}'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
}

async function rateLimited(env, request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = 'rl:dh:' + ip + ':' + Math.floor(Date.now() / 60000);
  try {
    const n = Number(await env.PASSKEYS.get(key)) || 0;
    if (n >= RATE_MAX) return true;
    await env.PASSKEYS.put(key, String(n + 1), { expirationTtl: 120 });
    return false;
  } catch (e) { return true; }   // fail closed
}

function devOk(request, env, origin) {
  if (env.DEV !== '1' || new URL(request.url).hostname === 'tradezoro.com') return false;   // never on the real domain
  try { const u = new URL(origin); return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'); } catch (e) { return false; }
}

function tokenClaims(tok) {
  try { return JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; }
}

// Same-colo replay guard on top of the KV delete (KV deletes reach other locations within ~60 s).
const spent = new Map();
function markSpent(h) {
  const now = Date.now();
  for (const [k, t] of spent) if (now - t > CODE_TTL_S * 1000) spent.delete(k);
  if (spent.size > 10000) spent.clear();
  if (spent.has(h)) return false;
  spent.set(h, now);
  return true;
}

export async function handle(request, env, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const route = new URL(request.url).pathname.replace(/^\/api\/desktop\/?/, '').replace(/\/+$/, '');
  if (request.method !== 'POST') return fail(405, 'Method not allowed');
  if (route !== 'handoff' && route !== 'handoff/redeem') return fail(404, 'Not found');
  const sa = saFrom(env);
  if (!env.PASSKEYS || !sa) return UNAVAILABLE();
  const origin = request.headers.get('origin') || '';

  if (route === 'handoff') {
    // Browser call from our own page only: a cross-site page cannot get a code minted for the visitor.
    if (!(origin === PROD_ORIGIN || devOk(request, env, origin))) return fail(403, 'Not allowed');
    if (await rateLimited(env, request)) return fail(429, 'Too many tries. Wait a minute and try again.');
    const body = await readBody(request);
    if (!body) return fail(400, 'Bad request');
    const nonce = String(body.nonce || '');
    if (!NONCE_RE.test(nonce)) return fail(400, 'This sign-in link is not valid. Start again from the TradeZoro app.');
    const tok = bearerOf(request);
    const uid = tok ? await verifyIdToken(tok, { fetchImpl, nowSec: deps.nowSec }) : null;
    if (!uid) return fail(401, 'Please sign in first');
    const c = tokenClaims(tok);
    const nowS = Math.floor((deps.nowMs || Date.now()) / 1000);
    if (!(Number(c.auth_time) >= nowS - FRESH_S)) return fail(401, 'Please sign in again.');
    const code = b64u(crypto.getRandomValues(new Uint8Array(32)));
    const now = Math.floor((deps.nowMs || Date.now()) / 1000);
    await env.PASSKEYS.put('dh:' + await sha(code), JSON.stringify({ uid, nh: nonce, iat: Number(c.iat || now), exp: now + CODE_TTL_S }), { expirationTtl: CODE_TTL_S });
    return json({ code, expiresIn: CODE_TTL_S });
  }

  // redeem: server-to-server from the app's main process. No cookies are involved, so CSRF does not apply; a web
  // page that tries it anyway (it would carry an Origin header) is refused unless it is our own.
  if (origin && !(origin === PROD_ORIGIN || devOk(request, env, origin))) return fail(403, 'Not allowed');
  if (await rateLimited(env, request)) return fail(429, 'Too many tries. Wait a minute and try again.');
  const body = await readBody(request);
  if (!body) return fail(400, 'Bad request');
  const code = String(body.code || ''), verifier = String(body.verifier || '');
  if (!CODE_RE.test(code) || !NONCE_RE.test(verifier)) return fail(400, 'Bad request');
  const h = await sha(code);
  const GONE = () => fail(410, 'This sign-in has expired or was already used. Start again from the app.');
  if (!markSpent(h)) return GONE();
  const raw = await env.PASSKEYS.get('dh:' + h);
  if (!raw) return GONE();
  await env.PASSKEYS.delete('dh:' + h);   // single use, win or lose
  let rec; try { rec = JSON.parse(raw); } catch (e) { return GONE(); }
  const now = Math.floor((deps.nowMs || Date.now()) / 1000);
  if (!rec || !(rec.exp >= now)) return GONE();
  if (!safeEqual(String(rec.nh || ''), await sha(verifier))) return fail(403, 'This sign-in belongs to another window. Start again from the app.');
  const acct = await accountState(sa, rec.uid, fetchImpl);
  if (acct.st === 'disabled' || acct.st === 'missing') return fail(403, 'This account cannot sign in.');
  if (acct.st !== 'ok') return UNAVAILABLE();
  if (rec.iat < (acct.validSince || 0)) return fail(401, 'Please sign in again.');   // sessions were revoked after that sign-in
  return json({ token: await mintCustomToken(sa, rec.uid) });
}

export const onRequest = ({ request, env }) => handle(request, env);
