// Schwab OAuth token swap for Cloudflare Pages. DATA ONLY site feature ("connect your own data").
//   GET  /connect/schwab/token?probe=1  -> {configured, client_id?}  (public: the client id is in every sign-in URL anyway)
//   POST /connect/schwab/token          {grant:'code', code, verifier?} | {grant:'refresh', refresh_token}
//        Headers: Origin https://tradezoro.com, Authorization: Bearer <Firebase ID token>.
// It ONLY swaps a code / refreshes a token at https://api.schwabapi.com/v1/oauth/token, returns the tokens to the browser and
// stores nothing. It never sees quotes, accounts or orders. Env (Pages secrets): SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET.
// Missing env -> 503. Rate limit: KV counter (binding PASSKEYS, same as the passkey functions), in-memory fallback.
// Never logs bodies, tokens or upstream replies. Tested by tools/tests/schwab-token.test.mjs.
import { verifyIdToken, bearerOf } from '../../api/chart/_rt.js';

const ORIGIN = 'https://tradezoro.com', REDIRECT = ORIGIN + '/connect/schwab/callback', UPSTREAM = 'https://api.schwabapi.com/v1/oauth/token';
const RATE_MAX = 20, TIMEOUT_MS = 8000;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
const fail = (status, error) => json({ error }, status);
const mem = new Map();

async function rateLimited(env, request) {
  const key = 'rl:schwab:' + (request.headers.get('cf-connecting-ip') || 'unknown') + ':' + Math.floor(Date.now() / 60000);
  try {
    if (env.PASSKEYS) {   // shortcut: KV counter is not atomic; the hard limit is a Cloudflare WAF rule
      const n = Number(await env.PASSKEYS.get(key)) || 0;
      if (n >= RATE_MAX) return true;
      await env.PASSKEYS.put(key, String(n + 1), { expirationTtl: 120 });
      return false;
    }
    for (const k of mem.keys()) if (k !== key) mem.delete(k);
    const n = (mem.get(key) || 0) + 1; mem.set(key, n); return n > RATE_MAX;
  } catch (e) { return true; }
}

const okOrigin = (request, env) => {
  const o = request.headers.get('origin');
  const dev = env.DEV === '1' && new URL(request.url).hostname !== 'tradezoro.com' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(o || '');
  const sfs = request.headers.get('sec-fetch-site');
  return (o === ORIGIN || dev) && (!sfs || sfs === 'same-origin');
};

export async function handle(request, env, deps = {}) {
  const configured = !!(env.SCHWAB_CLIENT_ID && env.SCHWAB_CLIENT_SECRET);
  const url = new URL(request.url);
  if (request.method === 'GET') {
    if (url.searchParams.get('probe') !== '1') return fail(404, 'Not found');
    return configured ? json({ configured: true, client_id: env.SCHWAB_CLIENT_ID }) : json({ configured: false }, 503);
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
  if (!configured) return fail(503, 'Schwab is coming soon');
  if (!okOrigin(request, env)) return fail(403, 'Forbidden');
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return fail(415, 'JSON only');
  if (await rateLimited(env, request)) return fail(429, 'Too many tries. Wait a minute.');
  const uid = await verifyIdToken(bearerOf(request), { fetchImpl: deps.verifyFetch });
  if (!uid) return fail(401, 'Sign in first');
  let b = null;
  try { const t = await request.text(); if (t.length <= 4096) b = JSON.parse(t); } catch (e) { b = null; }
  const tok = (v) => typeof v === 'string' && /^[A-Za-z0-9._~+\/=\-]{8,2048}$/.test(v);
  let form;
  if (b && b.grant === 'code' && tok(b.code)) {
    form = { grant_type: 'authorization_code', code: b.code, redirect_uri: REDIRECT };
    if (b.verifier != null) { if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(b.verifier)) return fail(400, 'Bad request'); form.code_verifier = b.verifier; }
  } else if (b && b.grant === 'refresh' && tok(b.refresh_token)) form = { grant_type: 'refresh_token', refresh_token: b.refresh_token };
  else return fail(400, 'Bad request');
  let r;
  try {
    r = await (deps.fetchImpl || fetch)(UPSTREAM, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: 'Basic ' + btoa(env.SCHWAB_CLIENT_ID + ':' + env.SCHWAB_CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString()
    });
  } catch (e) { return fail(502, 'Schwab did not answer'); }
  let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
  if (!r.ok || !j || typeof j.access_token !== 'string') return fail(r.status === 400 || r.status === 401 ? 400 : 502, r.status === 400 || r.status === 401 ? 'Schwab did not accept this sign-in' : 'Schwab did not answer');
  // Only these fields go back (no id_token).
  return json({ access_token: j.access_token, refresh_token: typeof j.refresh_token === 'string' ? j.refresh_token : undefined, expires_in: Number(j.expires_in) || 1800, token_type: 'Bearer', scope: typeof j.scope === 'string' ? j.scope : undefined });
}
export const onRequest = ({ request, env }) => handle(request, env);
