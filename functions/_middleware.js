// Redirect legacy hostnames to the TradeZoro apex domain.
// Runs before static assets and API routes on Cloudflare Pages.
//
// Firebase Auth helper pages (/__/auth/*, /__/firebase/*) are proxied to
// firebaseapp.com FIRST, before the redirect, so a sign-in in flight is never
// bounced between hosts. See functions/_auth-proxy.js.
import { isAuthProxyPath, proxyAuth } from './_auth-proxy.js';

const CANONICAL_HOST = 'tradezoro.com';
const REDIRECT_HOSTS = new Set(['strykertrading.com', 'www.strykertrading.com', 'www.tradezoro.com']);

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (isAuthProxyPath(url.pathname)) {
    return proxyAuth(request);
  }
  if (REDIRECT_HOSTS.has(url.hostname)) {
    url.hostname = CANONICAL_HOST;
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
