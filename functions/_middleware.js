// Redirect legacy hostnames to the TradeZoro apex domain.
// Runs before static assets and API routes on Cloudflare Pages.
//
// Firebase Auth helper pages (/__/auth/*, /__/firebase/*) are proxied to
// firebaseapp.com FIRST, before the redirect, so a sign-in in flight is never
// bounced between hosts. See functions/_auth-proxy.js.
//
// SANCTIONS GEO-BLOCK (Owner order 09 Nov 2026): visitors from a blocked country or region
// (list: functions/_geo-block.js) get HTTP 451 and the self-contained /unavailable page on EVERY path,
// static files included (_routes.json sends everything through this middleware). Only the block page,
// robots.txt, the favicon and the two build-check files the block page loads pass (GEO_ALLOW). Search crawlers get no special case: blocking is by country only.
// Runs before the auth proxy, so a blocked visitor can't reach the Firebase sign-in helper either.
import { isAuthProxyPath, proxyAuth } from './_auth-proxy.js';
import { isBlockedRequest, blockedJson, REGION_MESSAGE } from './_geo-block.js';

const CANONICAL_HOST = 'tradezoro.com';
const REDIRECT_HOSTS = new Set(['strykertrading.com', 'www.strykertrading.com', 'www.tradezoro.com']);
export const GEO_ALLOW = new Set(['/unavailable', '/unavailable.html', '/robots.txt', '/favicon.ico',
  '/assets/images/favicon-32.png', '/assets/images/favicon.ico', '/assets/version-check.js', '/assets/version.json']);

// Used only if the static page can't be read (keeps the 451 even then).
const FALLBACK_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<meta name="robots" content="noindex"><title>Not available in your region - TradeZoro</title></head>' +
  '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#050506;color:rgba(255,255,255,.92);font:15px/22px -apple-system,system-ui,sans-serif;padding:16px">' +
  '<main style="max-width:440px"><h1 style="font-size:22px;line-height:28px">Not available in your region</h1><p style="color:rgba(255,255,255,.64)">' + REGION_MESSAGE + '</p></main></body></html>';

export async function geoBlockedResponse(request, env) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/connect/') || request.headers.get('upgrade') === 'websocket') return blockedJson();
  let html = FALLBACK_HTML;
  try {
    if (env && env.ASSETS) {
      const r = await env.ASSETS.fetch(new Request(new URL('/unavailable.html', url).toString()));
      if (r.ok) html = await r.text();
    }
  } catch (e) { /* inline fallback */ }
  return new Response(request.method === 'HEAD' ? null : html, {
    status: 451,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', vary: 'cf-ipcountry' }
  });
}

export async function onRequest({ request, next, env }) {
  const url = new URL(request.url);
  if (isBlockedRequest(request) && !GEO_ALLOW.has(url.pathname)) {
    return geoBlockedResponse(request, env);
  }
  if (isAuthProxyPath(url.pathname)) {
    return proxyAuth(request);
  }
  // Static files never redirect (identical on every host); only pages and /api do, as before build 503's _routes.json.
  if (REDIRECT_HOSTS.has(url.hostname) && !isStaticPath(url.pathname)) {
    url.hostname = CANONICAL_HOST;
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }
  return next();
}

function isStaticPath(p) {
  return p.startsWith('/assets/') || p === '/manifest.json' || p === '/firebase-messaging-sw.js';
}
