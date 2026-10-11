// Redirect legacy hostnames to the TradeZoro apex domain.
// Runs before static assets and API routes on Cloudflare Pages.
const CANONICAL_HOST = 'tradezoro.com';
const REDIRECT_HOSTS = new Set(['strykertrading.com', 'www.strykertrading.com', 'www.tradezoro.com']);

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (REDIRECT_HOSTS.has(url.hostname)) {
    url.hostname = CANONICAL_HOST;
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
