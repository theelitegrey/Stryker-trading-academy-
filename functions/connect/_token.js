// Shared OAuth token swap for the "Sign in with …" data sources (Alpaca, tastytrade). Same rules as functions/connect/ctrader/token.js:
//   GET  ?probe=1 -> {configured, client_id?} (public: the client id is in every sign-in URL anyway)
//   POST {grant:'code', code} | {grant:'refresh', refresh_token}  with Origin https://tradezoro.com and Authorization: Bearer <Firebase ID token>.
// Only swaps / refreshes at the broker's token URL, returns a trimmed reply, stores nothing, logs nothing. redirect_uri is fixed here.
import { verifyIdToken, bearerOf } from '../api/chart/_rt.js';

const ORIGIN = 'https://tradezoro.com', RATE_MAX = 20, TIMEOUT_MS = 8000;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
const fail = (status, error) => json({ error }, status);
const mem = new Map();

async function rateLimited(env, request, name) {
  const key = 'rl:' + name + ':' + (request.headers.get('cf-connecting-ip') || 'unknown') + ':' + Math.floor(Date.now() / 60000);
  try {
    if (env.PASSKEYS) {   // shortcut: KV counter is not atomic; the hard limit is a Cloudflare WAF rule
      const n = Number(await env.PASSKEYS.get(key)) || 0;
      if (n >= RATE_MAX) return true;
      await env.PASSKEYS.put(key, String(n + 1), { expirationTtl: 120 });
      return false;
    }
    for (const k of mem.keys()) if (!k.endsWith(':' + Math.floor(Date.now() / 60000))) mem.delete(k);
    const n = (mem.get(key) || 0) + 1; mem.set(key, n); return n > RATE_MAX;
  } catch (e) { return true; }
}
const okOrigin = (request, env) => {
  const o = request.headers.get('origin');
  const dev = env.DEV === '1' && new URL(request.url).hostname !== 'tradezoro.com' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(o || '');
  const sfs = request.headers.get('sec-fetch-site');
  return (o === ORIGIN || dev) && (!sfs || sfs === 'same-origin');
};

// cfg: { name, idVar, secretVar, redirect, upstream, as: 'form'|'json', refresh: bool }
export function makeHandler(cfg) {
  return async function handle(request, env, deps = {}) {
    const configured = !!(env[cfg.idVar] && env[cfg.secretVar]);
    const url = new URL(request.url);
    if (request.method === 'GET') {
      if (url.searchParams.get('probe') !== '1') return fail(404, 'Not found');
      return configured ? json({ configured: true, client_id: env[cfg.idVar] }) : json({ configured: false }, 503);
    }
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
    if (!configured) return fail(503, cfg.label + ' is coming soon');
    if (!okOrigin(request, env)) return fail(403, 'Forbidden');
    if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return fail(415, 'JSON only');
    if (await rateLimited(env, request, cfg.name)) return fail(429, 'Too many tries. Wait a minute.');
    const uid = await verifyIdToken(bearerOf(request), { fetchImpl: deps.verifyFetch });
    if (!uid) return fail(401, 'Sign in first');
    let b = null;
    try { const t = await request.text(); if (t.length <= 4096) b = JSON.parse(t); } catch (e) { b = null; }
    const tok = (v) => typeof v === 'string' && /^[A-Za-z0-9._~+\/=\-]{8,2048}$/.test(v);
    let q;
    if (b && b.grant === 'code' && tok(b.code)) q = { grant_type: 'authorization_code', code: b.code, redirect_uri: cfg.redirect };
    else if (cfg.refresh && b && b.grant === 'refresh' && tok(b.refresh_token)) q = { grant_type: 'refresh_token', refresh_token: b.refresh_token };
    else return fail(400, 'Bad request');
    q.client_id = env[cfg.idVar]; q.client_secret = env[cfg.secretVar];
    let r;
    try {
      r = await (deps.fetchImpl || fetch)(cfg.upstream, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: 'application/json', 'Content-Type': cfg.as === 'form' ? 'application/x-www-form-urlencoded' : 'application/json' },
        body: cfg.as === 'form' ? new URLSearchParams(q).toString() : JSON.stringify(q) });
    } catch (e) { return fail(502, cfg.label + ' did not answer'); }
    let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
    if (!r.ok || !j || typeof j.access_token !== 'string') return fail(r.status >= 500 ? 502 : 400, r.status >= 500 ? cfg.label + ' did not answer' : cfg.label + ' did not accept this sign-in');
    // Only these fields go back.
    const scope = typeof j.scope === 'string' ? j.scope.slice(0, 200) : Array.isArray(j.scope) ? j.scope.join(' ').slice(0, 200) : undefined;
    return json({ access_token: j.access_token, refresh_token: cfg.refresh && typeof j.refresh_token === 'string' ? j.refresh_token : undefined, expires_in: Number(j.expires_in) || undefined, token_type: 'Bearer', scope });
  };
}
