// Reverse proxy for Firebase Auth's helper pages: /__/auth/* and /__/firebase/*.
//
// Why: the Google sign-in popup names the site it is "continuing to" after the
// Firebase authDomain. With authDomain = strykertrades-e0cd8.firebaseapp.com
// it shows that raw project host. Firebase's documented fix ("custom
// authDomain", option 3 in the redirect best-practices guide) is to serve
// /__/auth/* from your own domain by proxying it to <project>.firebaseapp.com,
// then set authDomain to your own host. assets/auth.js decides when to use it.
//
// Called first thing from functions/_middleware.js, BEFORE the legacy-domain
// 301, so a helper page is never redirected mid sign-in. Not cached anywhere:
// the upstream fetch bypasses the Cloudflare cache and the reply is no-store.
//
// Depends on: nothing (plain fetch). Exported for the middleware and the test
// in tools/tests/auth-proxy.test.mjs.

export const FIREBASE_AUTH_ORIGIN = 'https://strykertrades-e0cd8.firebaseapp.com';

export function isAuthProxyPath(pathname) {
  return pathname.startsWith('/__/auth/') || pathname.startsWith('/__/firebase/');
}

// Hop-by-hop and Cloudflare-added headers that must not be forwarded upstream.
const DROP_REQ = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-connection', 'te', 'trailer', 'content-length']);

export async function proxyAuth(request) {
  const src = new URL(request.url);
  const target = FIREBASE_AUTH_ORIGIN + src.pathname + src.search;

  const headers = new Headers();
  for (const [k, v] of request.headers) {
    const key = k.toLowerCase();
    if (DROP_REQ.has(key) || key.startsWith('cf-') || key.startsWith('x-forwarded-') || key === 'x-real-ip') continue;
    headers.set(k, v);
  }

  const method = request.method.toUpperCase();
  const init = {
    method,
    headers,
    redirect: 'manual',
    // Workers: never serve these from (or store them in) the Cloudflare cache.
    cf: { cacheTtlByStatus: { '100-599': -1 }, cacheEverything: false },
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }

  const upstream = await fetch(target, init);

  // Copy the headers one by one so every Set-Cookie survives as its own line.
  const out = new Headers();
  for (const [k, v] of upstream.headers) {
    const key = k.toLowerCase();
    if (key === 'set-cookie' || key === 'content-length') continue;
    out.append(k, v);
  }
  const cookies = typeof upstream.headers.getSetCookie === 'function'
    ? upstream.headers.getSetCookie()
    : (upstream.headers.get('set-cookie') ? [upstream.headers.get('set-cookie')] : []);
  for (const c of cookies) out.append('set-cookie', c);
  out.set('cache-control', 'no-store');

  // An upstream redirect pointing back at firebaseapp.com is rewritten to the
  // host the browser actually used, so the flow stays on one origin.
  const loc = out.get('location');
  if (loc && loc.startsWith(FIREBASE_AUTH_ORIGIN + '/')) {
    out.set('location', src.origin + loc.slice(FIREBASE_AUTH_ORIGIN.length));
  }

  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}
